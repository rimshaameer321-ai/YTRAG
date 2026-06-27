# api.py
# Main FastAPI backend.
# NEW: /search now accepts chat_history so the AI has conversation context.
# CHANGED: Document enable/disable is now a GLOBAL setting per document
#          (stored in Supabase), controlled from the Settings panel.
#          /search no longer needs enabled_document_ids from the frontend —
#          it looks up which documents are enabled itself.

from dotenv import load_dotenv
load_dotenv()  # Load .env file so OPENAI_KEY, SUPABASE_URL etc. are available

import uuid
from pathlib import Path
from typing import List, Optional  # NEW: List and Optional for typed fields in request body

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import Client

from src.search import RAGSearch
from src.data_loader import load_single_file
from auth import get_current_user, get_supabase_for_user

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Allow all origins (frontend can call this API)
    allow_methods=["*"],   # Allow all HTTP methods (GET, POST, DELETE, etc.)
    allow_headers=["*"],   # Allow all headers (including Authorization)
)

UPLOAD_DIR = Path("uploads")        # Folder where uploaded files are saved on disk
UPLOAD_DIR.mkdir(exist_ok=True)     # Create folder if it doesn't already exist

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".csv", ".xlsx", ".docx", ".json"}


# --- Request / Response Models ---

class ChatMessage(BaseModel):
    """
    Represents a single message in the conversation history.
    role: "user" (human) or "assistant" (AI)
    content: the actual text of that message
    """
    role: str     # "user" or "assistant"
    content: str  # The message text


class SearchRequest(BaseModel):
    """
    Body of the POST /search request.
    query: the current question being asked
    top_k: how many document chunks to retrieve from FAISS (default 5)
    chat_history: list of previous messages — used for context
    enabled_document_ids: CHANGED — now optional/legacy. If the frontend sends
        it, it's still respected (e.g. for future per-chat overrides). If not
        sent, the backend looks up the user's globally-enabled documents
        from Supabase instead.
    """
    query: str
    top_k: int = 5
    chat_history: List[ChatMessage] = []
    enabled_document_ids: Optional[List[str]] = None  # CHANGED: now a fallback override, not the primary source


class ToggleDocumentRequest(BaseModel):
    """Body of the PATCH /documents/{document_id} request — flips global enabled state."""
    enabled: bool


# --- Single RAGSearch instance shared across all requests ---
rag = RAGSearch()


def _get_globally_enabled_document_ids(user_supabase: Client, user_id: str) -> List[str]:
    """
    NEW: Fetch the IDs of all documents this user has marked as enabled=True.
    Used by /search when the frontend doesn't explicitly override the filter,
    so document visibility is controlled centrally from the Settings panel
    rather than per-chat.
    """
    response = (
        user_supabase.table("documents")
        .select("id")
        .eq("user_id", user_id)
        .eq("enabled", True)
        .execute()
    )
    return [row["id"] for row in response.data]


@app.post("/search")
async def search(
    req: SearchRequest,
    user=Depends(get_current_user),
    user_supabase: Client = Depends(get_supabase_for_user),  # NEW: needed to look up enabled docs
):
    """
    Main search endpoint.
    - Receives the query + chat history
    - CHANGED: Determines which documents to search using the GLOBAL
      enabled/disabled setting (from Settings), unless the request
      explicitly overrides it with enabled_document_ids.
    - Searches FAISS for relevant document chunks
    - Sends everything to the AI with full context
    - Returns the AI's answer
    """
    try:
        # Convert Pydantic ChatMessage objects to plain dicts for the search function
        history_dicts = [{"role": m.role, "content": m.content} for m in req.chat_history]

        # CHANGED: if the frontend didn't explicitly pass a filter, use the
        # user's globally-enabled documents (controlled from Settings).
        enabled_ids = req.enabled_document_ids
        if enabled_ids is None:
            enabled_ids = _get_globally_enabled_document_ids(user_supabase, user.id)

        summary = rag.search_and_summarize(
            query=req.query,
            top_k=req.top_k,
            user_id=user.id,
            chat_history=history_dicts,
            enabled_document_ids=enabled_ids,  # CHANGED: always a concrete list now (global setting applied)
        )
        return {"summary": summary, "documents": []}
    except Exception as e:
        return {"error": str(e)}


@app.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
    user_supabase: Client = Depends(get_supabase_for_user),
):
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{file_ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    document_id = str(uuid.uuid4())
    saved_filename = f"{document_id}_{file.filename}"
    saved_path = UPLOAD_DIR / saved_filename

    # Save file to disk
    try:
        contents = await file.read()
        with open(saved_path, "wb") as f:
            f.write(contents)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    # Extract text from the saved file
    try:
        loaded_docs = load_single_file(str(saved_path))
        if not loaded_docs:
            raise ValueError("No text could be extracted from the uploaded file.")
        raw_text = "\n\n".join(d.page_content for d in loaded_docs)
    except Exception as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Failed to read file content: {e}")

    # Add to FAISS vector store
    try:
        rag.vectorstore.add_document(document_id, file.filename, raw_text, user_id=user.id)
    except Exception as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to index document: {e}")

    # Save record in Supabase
    # CHANGED: enabled=True by default — new uploads are immediately active
    # for every chat until the user disables them from Settings.
    try:
        user_supabase.table("documents").insert({
            "id": document_id,
            "user_id": user.id,
            "filename": file.filename,
            "storage_path": str(saved_path),
            "enabled": True,  # NEW: global enabled flag, default on
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save document record: {e}")

    return {"document_id": document_id, "filename": file.filename, "message": "Document uploaded successfully."}


@app.get("/documents")
async def list_documents(
    user=Depends(get_current_user),
    user_supabase: Client = Depends(get_supabase_for_user),
):
    try:
        response = (
            user_supabase.table("documents")
            .select("*")
            .eq("user_id", user.id)
            .execute()
        )
        return {"documents": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch documents: {e}")


@app.patch("/documents/{document_id}")
async def toggle_document(
    document_id: str,
    req: ToggleDocumentRequest,
    user=Depends(get_current_user),
    user_supabase: Client = Depends(get_supabase_for_user),
):
    """
    NEW: Globally enable or disable a document. This is the endpoint the
    Settings panel calls — the change applies everywhere (every chat),
    not just the current session.
    """
    result = (
        user_supabase.table("documents")
        .select("id")
        .eq("id", document_id)
        .eq("user_id", user.id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Document not found or no permission.")

    user_supabase.table("documents").update({"enabled": req.enabled}).eq("id", document_id).eq("user_id", user.id).execute()

    return {"message": "Document updated successfully.", "enabled": req.enabled}


@app.delete("/documents/{document_id}")
async def delete_document(
    document_id: str,
    user=Depends(get_current_user),
    user_supabase: Client = Depends(get_supabase_for_user),
):
    result = (
        user_supabase.table("documents")
        .select("*")
        .eq("id", document_id)
        .eq("user_id", user.id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Document not found or no permission.")

    record = result.data[0]
    rag.vectorstore.delete_document(document_id)

    storage_path = Path(record["storage_path"])
    storage_path.unlink(missing_ok=True)

    user_supabase.table("documents").delete().eq("id", document_id).eq("user_id", user.id).execute()

    return {"message": "Document deleted successfully."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)