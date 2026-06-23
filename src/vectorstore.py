import os
import faiss
import numpy as np
import pickle
from typing import List, Any
from sentence_transformers import SentenceTransformer
from src.embedding import EmbeddingPipeline

class FaissVectorStore:
    def __init__(self, persist_dir: str = "faiss_store", embedding_model: str = "all-MiniLM-L6-v2", chunk_size: int = 1000, chunk_overlap: int = 200):
        self.persist_dir = persist_dir
        os.makedirs(self.persist_dir, exist_ok=True)
        self.index = None
        self.metadata = []
        self.embedding_model = embedding_model
        self.model = SentenceTransformer(embedding_model)
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        print(f"[INFO] Loaded embedding model: {embedding_model}")

    def build_from_documents(self, documents: List[Any]):
        print(f"[INFO] Building vector store from {len(documents)} raw documents...")
        emb_pipe = EmbeddingPipeline(model_name=self.embedding_model, chunk_size=self.chunk_size, chunk_overlap=self.chunk_overlap)
        chunks = emb_pipe.chunk_documents(documents)
        embeddings = emb_pipe.embed_chunks(chunks)
        # Note: documents loaded this way (from the local data/ folder at
        # startup) have no owning user, so user_id is left as None. They
        # will not appear in any per-user search once user filtering is
        # active. This path is mainly useful for local testing.
        metadatas = [{"text": chunk.page_content, "document_id": None, "filename": None, "user_id": None} for chunk in chunks]
        self.add_embeddings(np.array(embeddings).astype('float32'), metadatas)
        self.save()
        print(f"[INFO] Vector store built and saved to {self.persist_dir}")

    def add_embeddings(self, embeddings: np.ndarray, metadatas: List[Any] = None):
        dim = embeddings.shape[1]
        if self.index is None:
            self.index = faiss.IndexFlatL2(dim)
        self.index.add(embeddings)
        if metadatas:
            self.metadata.extend(metadatas)
        print(f"[INFO] Added {embeddings.shape[0]} vectors to Faiss index.")

    def save(self):
        faiss_path = os.path.join(self.persist_dir, "faiss.index")
        meta_path = os.path.join(self.persist_dir, "metadata.pkl")
        faiss.write_index(self.index, faiss_path)
        with open(meta_path, "wb") as f:
            pickle.dump(self.metadata, f)
        print(f"[INFO] Saved Faiss index and metadata to {self.persist_dir}")

    def load(self):
        faiss_path = os.path.join(self.persist_dir, "faiss.index")
        meta_path = os.path.join(self.persist_dir, "metadata.pkl")
        self.index = faiss.read_index(faiss_path)
        with open(meta_path, "rb") as f:
            self.metadata = pickle.load(f)
        print(f"[INFO] Loaded Faiss index and metadata from {self.persist_dir}")

    def search(self, query_embedding: np.ndarray, top_k: int = 5, user_id: str = None):
        """
        Searches the FAISS index. If user_id is provided, only chunks
        belonging to that user are returned — this keeps each user's
        documents private from other users during search.
        """
        if self.index is None or self.index.ntotal == 0:
            return []

        # Search a larger pool than top_k so that after filtering by
        # user_id we still have enough matching results left over.
        search_k = min(top_k * 5, self.index.ntotal) if user_id else min(top_k, self.index.ntotal)

        D, I = self.index.search(query_embedding, search_k)
        results = []
        for idx, dist in zip(I[0], D[0]):
            if idx < 0 or idx >= len(self.metadata):
                continue
            meta = self.metadata[idx]
            if meta is None:
                continue
            # Skip any chunk that doesn't belong to this user
            if user_id and meta.get("user_id") != user_id:
                continue
            results.append({"index": idx, "distance": dist, "metadata": meta})
            if len(results) >= top_k:
                break
        return results

    def query(self, query_text: str, top_k: int = 5, user_id: str = None):
        print(f"[INFO] Querying vector store for: '{query_text}' (user={user_id})")
        query_emb = self.model.encode([query_text]).astype('float32')
        return self.search(query_emb, top_k=top_k, user_id=user_id)

    # ---------------------------------------------------------------
    # Document upload and delete features
    # ---------------------------------------------------------------

    def add_document(self, document_id: str, filename: str, raw_text: str, user_id: str):
        """
        Adds a new document: splits the text into chunks, generates
        embeddings, and saves them to FAISS with document_id, filename,
        and user_id attached to each chunk's metadata. The user_id is
        later used to make sure search results only include documents
        belonging to the user who is searching.
        """
        from langchain_core.documents import Document as LangchainDocument

        print(f"[INFO] Adding document '{filename}' (id={document_id}, user={user_id}) to vector store...")

        doc_obj = LangchainDocument(page_content=raw_text, metadata={})

        emb_pipe = EmbeddingPipeline(
            model_name=self.embedding_model,
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
        )
        chunks = emb_pipe.chunk_documents([doc_obj])
        embeddings = emb_pipe.embed_chunks(chunks)

        metadatas = [
            {
                "text": chunk.page_content,
                "document_id": document_id,
                "filename": filename,
                "user_id": user_id,
            }
            for chunk in chunks
        ]

        self.add_embeddings(np.array(embeddings).astype('float32'), metadatas)
        self.save()
        print(f"[INFO] Document '{filename}' added with {len(chunks)} chunks.")

    def delete_document(self, document_id: str):
        """
        'Rebuild' approach: keeps every chunk EXCEPT the ones belonging
        to the given document_id, then rebuilds the FAISS index from
        the remaining chunks. This avoids index corruption issues that
        come from trying to remove individual vectors from IndexFlatL2.
        """
        if self.index is None or not self.metadata:
            print("[WARN] Vector store is empty, nothing to delete.")
            return False

        kept_metadata = [m for m in self.metadata if m.get("document_id") != document_id]

        if len(kept_metadata) == len(self.metadata):
            print(f"[WARN] document_id={document_id} not found, nothing was deleted.")
            return False

        if not kept_metadata:
            self.index = None
            self.metadata = []
            self.save()
            print("[INFO] All documents deleted, vector store is now empty.")
            return True

        texts = [m["text"] for m in kept_metadata]
        new_embeddings = self.model.encode(texts).astype('float32')

        dim = new_embeddings.shape[1]
        self.index = faiss.IndexFlatL2(dim)
        self.index.add(new_embeddings)
        self.metadata = kept_metadata

        self.save()
        print(f"[INFO] document_id={document_id} deleted. New total chunks: {len(self.metadata)}")
        return True

    def list_documents(self):
        """
        Returns a list of unique documents (document_id + filename)
        currently stored, so the frontend can display them to the user.
        """
        seen = {}
        for m in self.metadata:
            doc_id = m.get("document_id")
            if doc_id and doc_id not in seen:
                seen[doc_id] = m.get("filename", "unknown")
        return [{"document_id": doc_id, "filename": fname} for doc_id, fname in seen.items()]


# Example usage
if __name__ == "__main__":
    from data_loader import load_all_documents
    docs = load_all_documents("data")
    store = FaissVectorStore("faiss_store")
    store.build_from_documents(docs)
    store.load()
    print(store.query("What is attention mechanism?", top_k=3))