import os
import faiss
import numpy as np
import pickle
from typing import List, Any, Optional
from sentence_transformers import SentenceTransformer
from src.embedding import EmbeddingPipeline

class FaissVectorStore:
    def __init__(self, persist_dir: str = "faiss_store", embedding_model: str = "all-MiniLM-L6-v2", chunk_size: int = 1000, chunk_overlap: int = 200):
        self.persist_dir = persist_dir
        os.makedirs(self.persist_dir, exist_ok=True)  # Folder banao agar nahi hai
        self.index = None      # FAISS index — vectors yahan store hote hain
        self.metadata = []     # Har vector ka metadata (filename, user_id, document_id, text)
        self.embedding_model = embedding_model
        self.model = SentenceTransformer(embedding_model)  # Text ko vector mein badlne wala model
        self.chunk_size = chunk_size      # Har chunk kitne characters ka hoga
        self.chunk_overlap = chunk_overlap  # Consecutive chunks mein kitna overlap hoga
        print(f"[INFO] Loaded embedding model: {embedding_model}")

    def build_from_documents(self, documents: List[Any]):
        """
        Local "data/" folder ke documents se FAISS index banao.
        Yeh sirf local testing/default-docs ke liye hai — in chunks ka
        user_id None hota hai isliye yeh per-user search mein nahi aayenge,
        aur yeh Supabase mein bhi save NAHI hote (sirf demo content hai).
        """
        print(f"[INFO] Building vector store from {len(documents)} raw documents...")
        emb_pipe = EmbeddingPipeline(model_name=self.embedding_model, chunk_size=self.chunk_size, chunk_overlap=self.chunk_overlap)
        chunks = emb_pipe.chunk_documents(documents)       # Documents ko chunks mein todo
        embeddings = emb_pipe.embed_chunks(chunks)         # Har chunk ka embedding vector banao
        metadatas = [{"text": chunk.page_content, "document_id": None, "filename": None, "user_id": None} for chunk in chunks]
        self.add_embeddings(np.array(embeddings).astype('float32'), metadatas)
        self.save()
        print(f"[INFO] Vector store built and saved to {self.persist_dir}")

    def build_from_supabase(self):
        """
        NEW: Saare users ke saare document_chunks Supabase (pgvector) se
        fetch karo aur unse FAISS index memory mein (re)build karo.
        Yeh Railway jaisi ephemeral-disk environments ke liye zaroori hai —
        disk pe save kiya FAISS index restart pe gayab ho jata hai, lekin
        Supabase mein data permanently mehfooz rehta hai.
        Returns True agar kuch chunks mile aur load ho gaye, warna False.
        """
        from auth import get_service_supabase

        print("[INFO] Rebuilding vector store from Supabase document_chunks...")
        service_client = get_service_supabase()

        # Saare chunks ek sath fetch karo (paginated — Supabase default 1000/page hota hai)
        all_rows = []
        page_size = 1000
        start = 0
        while True:
            response = (
                service_client.table("document_chunks")
                .select("document_id, user_id, filename, chunk_text, embedding")
                .range(start, start + page_size - 1)
                .execute()
            )
            rows = response.data or []
            all_rows.extend(rows)
            if len(rows) < page_size:
                break
            start += page_size

        if not all_rows:
            print("[INFO] No chunks found in Supabase yet.")
            return False

        embeddings = []
        metadatas = []
        for row in all_rows:
            # pgvector se aane wala embedding ek list[float] (ya string) ho sakta hai —
            # dono cases handle karo
            emb = row["embedding"]
            if isinstance(emb, str):
                # Kabhi-kabhi pgvector text format mein aata hai: "[0.1,0.2,...]"
                emb = [float(x) for x in emb.strip("[]").split(",")]
            embeddings.append(emb)
            metadatas.append({
                "text": row["chunk_text"],
                "document_id": row["document_id"],
                "filename": row["filename"],
                "user_id": row["user_id"],
            })

        self.index = None  # Fresh start
        self.metadata = []
        self.add_embeddings(np.array(embeddings).astype('float32'), metadatas)
        self.save()  # Local disk pe bhi rakho — agar disk persist hua to fayda, warna no harm
        print(f"[INFO] Rebuilt vector store from Supabase: {len(all_rows)} chunk(s) loaded.")
        return True

    def add_embeddings(self, embeddings: np.ndarray, metadatas: List[Any] = None):
        """
        Vectors FAISS index mein add karo aur unka metadata list mein store karo.
        embeddings: numpy array of shape (n, dim)
        metadatas: list of dicts, ek har vector ke liye
        """
        dim = embeddings.shape[1]          # Vector ki dimension (e.g. 384 for MiniLM)
        if self.index is None:
            self.index = faiss.IndexFlatL2(dim)  # Naya L2 distance index banao
        self.index.add(embeddings)         # Vectors index mein daalo
        if metadatas:
            self.metadata.extend(metadatas)  # Metadata list mein append karo
        print(f"[INFO] Added {embeddings.shape[0]} vectors to Faiss index.")

    def save(self):
        """FAISS index aur metadata disk pe save karo (best-effort cache)."""
        faiss_path = os.path.join(self.persist_dir, "faiss.index")
        meta_path = os.path.join(self.persist_dir, "metadata.pkl")
        faiss.write_index(self.index, faiss_path)   # Binary format mein save
        with open(meta_path, "wb") as f:
            pickle.dump(self.metadata, f)            # Python object ko binary mein serialize karo
        print(f"[INFO] Saved Faiss index and metadata to {self.persist_dir}")

    def load(self):
        """Disk se FAISS index aur metadata load karo."""
        faiss_path = os.path.join(self.persist_dir, "faiss.index")
        meta_path = os.path.join(self.persist_dir, "metadata.pkl")
        self.index = faiss.read_index(faiss_path)   # Binary index file padhlo
        with open(meta_path, "rb") as f:
            self.metadata = pickle.load(f)           # Metadata deserialize karo
        print(f"[INFO] Loaded Faiss index and metadata from {self.persist_dir}")

    def search(
        self,
        query_embedding: np.ndarray,
        top_k: int = 5,
        user_id: str = None,
        enabled_document_ids: Optional[List[str]] = None  # NEW: sirf yeh docs search karo
    ):
        """
        FAISS index mein search karo.

        Filters (dono ek saath kaam karte hain):
        1. user_id   — sirf is user ke documents return karo (privacy)
        2. enabled_document_ids — NEW: agar list di gayi hai toh sirf
           un documents ke chunks return karo jo is list mein hain.
           None ka matlab hai "saare documents allowed hain".

        Kyun filter FAISS ke ANDAR hai:
        Pehle saare results laake baad mein filter karne se top_k galat
        ho jaata hai — e.g. top_k=5 mein 5 results aaye lekin saare
        disabled doc ke the, toh 0 results bach te. Ab hum ek bada pool
        (top_k * 10) laate hain aur usme se filter karke top_k results dete hain.
        """
        if self.index is None or self.index.ntotal == 0:
            return []  # Index khali hai — kuch nahi milega

        # Itna bada pool lo ke filtering ke baad bhi top_k results bach jayein
        search_k = min(top_k * 10, self.index.ntotal)
        # top_k * 10 isliye: agar 50 chunks hain aur 40 disabled doc ke hain
        # toh 5 results chahiye — chota pool lene se sab filter ho jaate

        D, I = self.index.search(query_embedding, search_k)
        # D = distances array, I = indices array
        # D[0] aur I[0] kyunki hum ek hi query bhejte hain

        results = []
        for idx, dist in zip(I[0], D[0]):
            if idx < 0 or idx >= len(self.metadata):
                continue  # Invalid index — skip karo

            meta = self.metadata[idx]  # Is vector ka metadata nikalo
            if meta is None:
                continue  # Metadata nahi hai — skip karo

            # Filter 1: user_id check — doosre users ke docs nahi chahiye
            if user_id and meta.get("user_id") != user_id:
                continue  # Yeh chunk doosre user ka hai — skip karo

            # Filter 2: NEW — enabled_document_ids check
            # Agar list di gayi hai toh sirf us list ke documents accept karo
            if enabled_document_ids is not None:
                if meta.get("document_id") not in enabled_document_ids:
                    continue  # Yeh document disabled hai — skip karo

            results.append({"index": idx, "distance": dist, "metadata": meta})

            if len(results) >= top_k:
                break  # Enough results mil gaye — stop karo

        return results

    def query(
        self,
        query_text: str,
        top_k: int = 5,
        user_id: str = None,
        enabled_document_ids: Optional[List[str]] = None  # NEW: filter pass karo
    ):
        """
        Text query ko embed karo aur FAISS mein search karo.
        enabled_document_ids seedha search() ko pass hota hai.
        """
        print(f"[INFO] Querying vector store for: '{query_text}' (user={user_id}, enabled_docs={enabled_document_ids})")
        query_emb = self.model.encode([query_text]).astype('float32')  # Text ko vector banao
        return self.search(
            query_emb,
            top_k=top_k,
            user_id=user_id,
            enabled_document_ids=enabled_document_ids  # NEW: filter andar bhejo
        )

    def add_document(self, document_id: str, filename: str, raw_text: str, user_id: str):
        """
        Naya document add karo:
        1. Text ko chunks mein todo
        2. Har chunk ka embedding banao
        3. FAISS mein add karo (document_id, filename, user_id ke saath)
        4. NEW: Har chunk Supabase document_chunks table mein bhi save karo
           (permanent storage — FAISS sirf in-memory cache hai ab).
        """
        from langchain_core.documents import Document as LangchainDocument
        from auth import get_service_supabase

        print(f"[INFO] Adding document '{filename}' (id={document_id}, user={user_id}) to vector store...")

        doc_obj = LangchainDocument(page_content=raw_text, metadata={})

        emb_pipe = EmbeddingPipeline(
            model_name=self.embedding_model,
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
        )
        chunks = emb_pipe.chunk_documents([doc_obj])    # Text ko chunks mein todo
        embeddings = emb_pipe.embed_chunks(chunks)       # Chunks embed karo

        metadatas = [
            {
                "text": chunk.page_content,    # Chunk ka actual text
                "document_id": document_id,    # Kis document ka chunk hai
                "filename": filename,          # Original filename
                "user_id": user_id,            # Kis user ne upload kiya
            }
            for chunk in chunks
        ]

        self.add_embeddings(np.array(embeddings).astype('float32'), metadatas)
        self.save()  # Local disk cache (best-effort)

        # NEW: Supabase mein bhi permanently save karo — yeh hi asal source of truth hai
        try:
            service_client = get_service_supabase()
            rows = [
                {
                    "document_id": document_id,
                    "user_id": user_id,
                    "filename": filename,
                    "chunk_text": chunk.page_content,
                    "embedding": embedding.tolist() if hasattr(embedding, "tolist") else list(embedding),
                }
                for chunk, embedding in zip(chunks, embeddings)
            ]
            service_client.table("document_chunks").insert(rows).execute()
            print(f"[INFO] Saved {len(rows)} chunk(s) to Supabase document_chunks.")
        except Exception as e:
            # Agar Supabase save fail ho jaye, FAISS mein to add ho hi gaya hai
            # (current session ke liye chalega), lekin warning print karo —
            # restart ke baad yeh document gayab ho jayega.
            print(f"[WARN] Failed to persist chunks to Supabase: {e}")

        print(f"[INFO] Document '{filename}' added with {len(chunks)} chunks.")

    def delete_document(self, document_id: str):
        """
        Document delete karo — 'rebuild' approach:
        Is document ke saare chunks hataao aur baaki chunks se
        naya FAISS index banao. IndexFlatL2 individual delete support
        nahi karta isliye yeh tarika use karte hain.
        NEW: Supabase document_chunks se bhi delete karo — yeh asal
        permanent record hai.
        """
        from auth import get_service_supabase

        # NEW: Supabase se permanently delete karo (source of truth)
        try:
            service_client = get_service_supabase()
            service_client.table("document_chunks").delete().eq("document_id", document_id).execute()
            print(f"[INFO] Deleted chunks for document_id={document_id} from Supabase.")
        except Exception as e:
            print(f"[WARN] Failed to delete chunks from Supabase: {e}")

        if self.index is None or not self.metadata:
            print("[WARN] Vector store is empty, nothing to delete locally.")
            return False

        # Sirf woh chunks rakho jinka document_id match nahi karta
        kept_metadata = [m for m in self.metadata if m.get("document_id") != document_id]

        if len(kept_metadata) == len(self.metadata):
            print(f"[WARN] document_id={document_id} not found in memory, nothing was deleted locally.")
            return False

        if not kept_metadata:
            # Saare documents delete ho gaye — index bilkul khali karo
            self.index = None
            self.metadata = []
            self.save()
            print("[INFO] All documents deleted, vector store is now empty.")
            return True

        # Baaki chunks ko re-embed karo aur naya index banao
        texts = [m["text"] for m in kept_metadata]
        new_embeddings = self.model.encode(texts).astype('float32')  # Re-embed

        dim = new_embeddings.shape[1]
        self.index = faiss.IndexFlatL2(dim)   # Naya khali index banao
        self.index.add(new_embeddings)         # Baaki chunks add karo
        self.metadata = kept_metadata          # Metadata bhi update karo

        self.save()  # Disk pe save karo
        print(f"[INFO] document_id={document_id} deleted. New total chunks: {len(self.metadata)}")
        return True

    def list_documents(self):
        """
        Unique documents ki list return karo (document_id + filename).
        Frontend is se documents dikhata hai user ko.
        """
        seen = {}
        for m in self.metadata:
            doc_id = m.get("document_id")
            if doc_id and doc_id not in seen:
                seen[doc_id] = m.get("filename", "unknown")
        return [{"document_id": doc_id, "filename": fname} for doc_id, fname in seen.items()]


if __name__ == "__main__":
    from data_loader import load_all_documents
    docs = load_all_documents("data")
    store = FaissVectorStore("faiss_store")
    store.build_from_documents(docs)
    store.load()
    print(store.query("What is attention mechanism?", top_k=3))