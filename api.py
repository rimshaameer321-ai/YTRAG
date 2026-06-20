# ✅ Yeh sahi hai — frontend JSON body bhejta hai
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from src.search import RAGSearch

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Yeh class frontend ka JSON pakadti hai
class SearchRequest(BaseModel):
    query: str
    top_k: int = 5

# RAG ek baar load karo — server start hone par
rag = RAGSearch()

@app.post("/search")
async def search(req: SearchRequest):
    try:
        summary = rag.search_and_summarize(req.query, req.top_k)
        return {"summary": summary, "documents": []}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)