# api.py
# Main FastAPI backend. Handles search, document upload, listing, and deletion.

from dotenv import load_dotenv
load_dotenv()

import uuid
from pathlib import Path

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
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".csv", ".xlsx", ".docx", ".json"}


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


rag = RAGSearch()


@app.post("/search")
async def search(req: SearchRequest, user=Depends(get_current_user)):
    try:
        summary = rag.search_and_summarize(req.query, req.top_k, user_id=user.id)
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

    # Load ONLY this specific file (not the whole uploads folder)
    try:
        loaded_docs = load_single_file(str(saved_path))
        if not loaded_docs:
            raise ValueError("No text could be extracted from the uploaded file.")
        raw_text = "\n\n".join(d.page_content for d in loaded_docs)
    except Exception as e:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"Failed to read file content: {e}")

    # Add to FAISS
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
        response = user_supabase.table("documents").select("*").eq("user_id", user.id).execute()
        return {"documents": response.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch documents: {e}")


@app.delete("/documents/{document_id}")
async def delete_document(
    document_id: str,
    user=Depends(get_current_user),
    user_supabase: Client = Depends(get_supabase_for_user),
):
    result = user_supabase.table("documents").select("*").eq("id", document_id).eq("user_id", user.id).execute()
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