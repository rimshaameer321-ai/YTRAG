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

        # CHANGED: pehle yahan empty context pe seedha "No relevant documents
        # found" return ho jata tha — matlab koi bhi general/basic sawal
        # (jaise "hi", "what is 2+2") ka jawab kabhi nahi milta tha.
        # Ab context empty ho ya na ho, hum hamesha AI ko call karte hain —
        # bas prompt mein AI ko batate hain ke documents available hain ya
        # nahi, aur usi ke mutabiq decide karne dete hain.
        has_context = bool(context.strip())

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

        # CHANGED: naya hybrid prompt — agar relevant document context mile
        # to usi se answer do (jaisa pehle tha), warna apne general knowledge
        # se ek normal, helpful jawab do (jaise koi normal AI assistant deta).
        # NEW: AI ko hamesha English mein jawab dene ka explicit instruction —
        # chahe user kisi bhi language (Urdu, Roman Urdu, etc.) mein poochay.
        history_block = f"\n\nPrevious conversation (for context only — do not answer these again):\n{history_text}" if history_text else ""
        language_instruction = "Always respond in English only, regardless of the language the question is asked in."

        if has_context:
            prompt = f"""You are a helpful assistant with access to documents the user has uploaded.

Below is context retrieved from the user's documents that may be relevant to their question. If this context answers the question, base your answer primarily on it. If the context is only partially relevant, you may combine it with your own general knowledge to give a complete, helpful answer. If the context is not relevant to the question at all, ignore it and just answer normally using your own knowledge.

{language_instruction}{history_block}

Context from documents:
{context}

Current question: '{query}'

Answer:"""
        else:
            # Koi document chunk match nahi hua (ya saare docs disabled hain,
            # ya sawal documents se related hi nahi tha) — phir bhi normal
            # AI assistant ki tarah jawab do, basic/general sawalon ka jawab
            # zaroor milna chahiye.
            # CHANGED: extra instructions for tone — casual messages (e.g.
            # "hi", "hy", "thanks") should get a short, natural, casual
            # reply, not a long formal explanation.
            prompt = f"""You are a helpful, friendly assistant having a normal conversation. Reply naturally and conversationally — keep greetings and small talk short and casual, and only go into detail when the question actually calls for it.

{language_instruction}{history_block}

Current message: '{query}'

Reply:"""

        # Groq LLM ko prompt bhejo
        response = self.llm.invoke([prompt])
        return response.content


if __name__ == "__main__":
    rag_search = RAGSearch()
    query = "What is attention mechanism?"
    summary = rag_search.search_and_summarize(query, top_k=3)
    print("Summary:", summary)