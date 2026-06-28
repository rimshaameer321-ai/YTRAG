# search.py
# NEW: enabled_document_ids ab vectorstore.query() ko directly pass hota hai
# taake FAISS filter pehle lage — baad mein nahi.
# CHANGED: Startup pe vector store ab Supabase (document_chunks table) se
# rebuild hota hai — yeh fix karta hai Railway jaisi ephemeral-disk
# environments ka masla, jahan local FAISS files restart pe gayab ho jaati thi.

import os
from dotenv import load_dotenv
from src.vectorstore import FaissVectorStore
from langchain_groq import ChatGroq
from typing import List, Dict, Optional

load_dotenv()

class RAGSearch:
    def __init__(
        self,
        persist_dir: str = "faiss_store",
        embedding_model: str = "all-MiniLM-L6-v2",
        llm_model: str = "llama-3.1-8b-instant"
    ):
        self.vectorstore = FaissVectorStore(persist_dir, embedding_model)

        # CHANGED: pehle Supabase se try karo (permanent storage, sab users
        # ke documents). Yeh restart-safe hai — chahe disk ephemeral ho.
        loaded_from_supabase = False
        try:
            loaded_from_supabase = self.vectorstore.build_from_supabase()
        except Exception as e:
            print(f"[WARN] Could not load from Supabase: {e}")

        if not loaded_from_supabase:
            # Fallback: local disk cache try karo (agar pehle se exist karta hai)
            faiss_path = os.path.join(persist_dir, "faiss.index")
            meta_path = os.path.join(persist_dir, "metadata.pkl")
            if os.path.exists(faiss_path) and os.path.exists(meta_path):
                self.vectorstore.load()
            else:
                # Aakhri fallback: data/ folder ke default demo documents
                from src.data_loader import load_all_documents
                docs = load_all_documents("data")
                self.vectorstore.build_from_documents(docs)

        groq_api_key = os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise RuntimeError("GROQ_API_KEY is missing from the .env file.")

        self.llm = ChatGroq(groq_api_key=groq_api_key, model_name=llm_model)
        print(f"[INFO] Groq LLM initialized: {llm_model}")

    def search_and_summarize(
        self,
        query: str,
        top_k: int = 5,
        user_id: str = None,
        chat_history: List[Dict[str, str]] = None,
        enabled_document_ids: Optional[List[str]] = None
    ) -> str:
        """
        1. FAISS mein query karo — enabled_document_ids filter andar hi lagta hai
        2. Chat history + context + query AI ko bhejo
        3. AI ka jawab return karo
        """

        # enabled_document_ids seedha vectorstore.query() ko pass karo
        # Pehle filter FAISS ke andar lagta hai — isliye sahi results milte hain
        results = self.vectorstore.query(
            query,
            top_k=top_k,
            user_id=user_id,
            enabled_document_ids=enabled_document_ids  # NEW: andar filter lagao
        )

        # DEBUG: console mein dikhao ke kaunse chunks match hue
        print(f"[DEBUG] search_and_summarize: {len(results)} chunk(s) matched for user={user_id}")
        for r in results:
            meta = r.get("metadata", {}) or {}
            print(
                f"[DEBUG]   -> document_id={meta.get('document_id')} "
                f"filename={meta.get('filename')} "
                f"distance={r.get('distance')}"
            )

        # Matched chunks se text nikalo
        texts = [r["metadata"].get("text", "") for r in results if r["metadata"]]
        context = "\n\n".join(texts)

        if not context.strip():
            # Koi relevant chunk nahi mila — yeh tab hoga jab:
            # - Saare docs disabled hain
            # - Ya query se koi match nahi
            return "No relevant documents found. Please enable some documents or upload new ones."

        # Chat history ko readable string mein badlo
        history_text = ""
        if chat_history:
            history_lines = []
            for msg in chat_history:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                label = "User" if role == "user" else "Assistant"
                history_lines.append(f"{label}: {content}")
            history_text = "\n".join(history_lines)

        # AI ke liye prompt banao
        if history_text:
            prompt = f"""You are answering ONLY using the context below, which comes from documents the user has uploaded. Do not use any outside knowledge.

If the context does not contain information relevant to the query, respond with exactly: "I couldn't find anything about that in your documents."

Previous conversation (for context only — do not answer these again):
{history_text}

Context from documents:
{context}

Current question: '{query}'

Answer (based only on the document context above, keeping previous conversation in mind):"""
        else:
            prompt = f"""You are answering ONLY using the context below, which comes from documents the user has uploaded. Do not use any outside knowledge.

If the context does not contain information relevant to the query, respond with exactly: "I couldn't find anything about that in your documents."

Context:
{context}

Query: '{query}'

Answer (based only on the context above):"""

        # Groq LLM ko prompt bhejo
        response = self.llm.invoke([prompt])
        return response.content


if __name__ == "__main__":
    rag_search = RAGSearch()
    query = "What is attention mechanism?"
    summary = rag_search.search_and_summarize(query, top_k=3)
    print("Summary:", summary)