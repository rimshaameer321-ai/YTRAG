# api.py
# Main FastAPI backend.
# NEW: /search now accepts chat_history so the AI has conversation context.
# NEW: documents can be enabled/disabled per query via enabled_document_ids.

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
    chat_history: list of previous messages — NEW, used for context
    enabled_document_ids: if provided, search ONLY these documents — NEW
    """
    query: str
    top_k: int = 5
    chat_history: List[ChatMessage] = []           # NEW: previous messages (default empty list)
    enabled_document_ids: Optional[List[str]] = None  # NEW: None means use all documents


# --- Single RAGSearch instance shared across all requests ---
rag = RAGSearch()


@app.post("/search")
async def search(req: SearchRequest, user=Depends(get_current_user)):
    """
    Main search endpoint.
    - Receives the query + chat history + optional document filter
    - Searches FAISS for relevant document chunks
    - Sends everything to the AI with full context
    - Returns the AI's answer
    """
    try:
        # Convert Pydantic ChatMessage objects to plain dicts for the search function
        # e.g. [{"role": "user", "content": "What is X?"}, {"role": "assistant", "content": "X is..."}]
        history_dicts = [{"role": m.role, "content": m.content} for m in req.chat_history]

        summary = rag.search_and_summarize(
            query=req.query,
            top_k=req.top_k,
            user_id=user.id,
            chat_history=history_dicts,                   # NEW: pass history to RAGSearch
            enabled_document_ids=req.enabled_document_ids  # NEW: pass document filter to RAGSearch
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
    try:
        user_supabase.table("documents").insert({
            "id": document_id,
            "user_id": user.id,
            "filename": file.filename,
            "storage_path": str(saved_path),
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