import os
from dotenv import load_dotenv
from src.vectorstore import FaissVectorStore
from langchain_groq import ChatGroq

load_dotenv()

class RAGSearch:
    def __init__(self, persist_dir: str = "faiss_store", embedding_model: str = "all-MiniLM-L6-v2", llm_model: str = "llama-3.1-8b-instant"):
        self.vectorstore = FaissVectorStore(persist_dir, embedding_model)
        # Load or build vectorstore
        faiss_path = os.path.join(persist_dir, "faiss.index")
        meta_path = os.path.join(persist_dir, "metadata.pkl")
        if not (os.path.exists(faiss_path) and os.path.exists(meta_path)):
            from src.data_loader import load_all_documents
            docs = load_all_documents("data")
            self.vectorstore.build_from_documents(docs)
        else:
            self.vectorstore.load()

        # Read the Groq API key from the .env file instead of hardcoding it
        groq_api_key = os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise RuntimeError("GROQ_API_KEY is missing from the .env file.")

        self.llm = ChatGroq(groq_api_key=groq_api_key, model_name=llm_model)
        print(f"[INFO] Groq LLM initialized: {llm_model}")

    def search_and_summarize(self, query: str, top_k: int = 5, user_id: str = None) -> str:
        """
        Searches the vector store and summarizes the matching chunks.
        If user_id is provided, only documents belonging to that user
        are considered — this keeps each user's search results private
        from other users.
        """
        results = self.vectorstore.query(query, top_k=top_k, user_id=user_id)

        # DEBUG: show exactly which chunks (and which document_id they
        # came from) are about to be sent to the LLM. This makes it easy
        # to catch cases where deleted/foreign content is still leaking
        # into the context.
        print(f"[DEBUG] search_and_summarize: {len(results)} chunk(s) matched for user={user_id}")
        for r in results:
            meta = r.get("metadata", {}) or {}
            print(
                f"[DEBUG]   -> document_id={meta.get('document_id')} "
                f"filename={meta.get('filename')} "
                f"distance={r.get('distance')}"
            )

        texts = [r["metadata"].get("text", "") for r in results if r["metadata"]]
        context = "\n\n".join(texts)

        if not context.strip():
            return "No relevant documents found."

        # IMPORTANT: explicitly instruct the model to answer ONLY from the
        # provided context, and to say so plainly if the context doesn't
        # contain the answer. Without this, the model tends to blend in
        # its own general/pretrained knowledge on common topics (e.g.
        # "cartesian space" in robotics) even when the retrieved context
        # is empty, irrelevant, or only weakly related — making it look
        # like deleted/foreign documents are still being searched, when
        # in fact the model is just answering from memory.
        prompt = f"""You are answering ONLY using the context below, which comes from documents the user has uploaded. Do not use any outside knowledge.

If the context does not contain information relevant to the query, respond with exactly: "I couldn't find anything about that in your documents."

Context:
{context}

Query: '{query}'

Answer (based only on the context above):"""

        response = self.llm.invoke([prompt])
        return response.content

# Example usage
if __name__ == "__main__":
    rag_search = RAGSearch()
    query = "What is attention mechanism?"
    summary = rag_search.search_and_summarize(query, top_k=3)
    print("Summary:", summary)