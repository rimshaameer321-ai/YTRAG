from pathlib import Path
from typing import List, Any, Optional
from langchain_community.document_loaders import PyPDFLoader, TextLoader, CSVLoader
from langchain_community.document_loaders import Docx2txtLoader
from langchain_community.document_loaders.excel import UnstructuredExcelLoader
from langchain_community.document_loaders import JSONLoader


# Map of file extension -> (LoaderClass, extra kwargs for the loader)
# This is the single source of truth for "how do we load this file type".
# Both load_all_documents() and load_single_file() use this.
_LOADER_MAP = {
    ".pdf": (PyPDFLoader, {}),
    ".txt": (TextLoader, {}),
    ".csv": (CSVLoader, {}),
    ".xlsx": (UnstructuredExcelLoader, {}),
    ".docx": (Docx2txtLoader, {}),
    ".json": (JSONLoader, {"jq_schema": ".", "text_content": False}),
}


def _load_file(file_path: Path) -> List[Any]:
    """
    Internal helper: load a single file using the correct LangChain loader
    based on its extension. Raises an exception on failure (caller decides
    whether to catch it or let it propagate).
    """
    ext = file_path.suffix.lower()
    if ext not in _LOADER_MAP:
        raise ValueError(f"Unsupported file extension: {ext}")

    loader_cls, kwargs = _LOADER_MAP[ext]
    loader = loader_cls(str(file_path), **kwargs)
    return loader.load()


def load_single_file(file_path: str) -> List[Any]:
    """
    Load ONE specific file and return its LangChain documents.
    Used by /upload so that uploading one file never touches or
    reloads any other previously uploaded files.
    """
    path = Path(file_path)
    print(f"[DEBUG] Loading single file: {path}")

    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")

    try:
        loaded = _load_file(path)
        print(f"[DEBUG] Loaded {len(loaded)} docs from {path}")
        return loaded
    except Exception as e:
        print(f"[ERROR] Failed to load {path}: {e}")
        raise


def load_all_documents(data_dir: str, extensions: Optional[List[str]] = None) -> List[Any]:
    """
    Load all supported files from a directory and convert to LangChain document structure.
    Supported: PDF, TXT, CSV, Excel, Word, JSON

    extensions: optional list like [".pdf", ".txt"] to restrict which types are scanned.
                Defaults to all supported types.
    """
    data_path = Path(data_dir).resolve()
    print(f"[DEBUG] Data path: {data_path}")
    documents = []

    exts_to_scan = extensions if extensions else list(_LOADER_MAP.keys())

    for ext in exts_to_scan:
        files = list(data_path.glob(f"**/*{ext}"))
        print(f"[DEBUG] Found {len(files)} {ext} files: {[str(f) for f in files]}")
        for file_path in files:
            print(f"[DEBUG] Loading: {file_path}")
            try:
                loaded = _load_file(file_path)
                print(f"[DEBUG] Loaded {len(loaded)} docs from {file_path}")
                documents.extend(loaded)
            except Exception as e:
                print(f"[ERROR] Failed to load {file_path}: {e}")

    print(f"[DEBUG] Total loaded documents: {len(documents)}")
    return documents


# Example usage
if __name__ == "__main__":
    docs = load_all_documents("data")
    print(f"Loaded {len(docs)} documents.")
    print("Example document:", docs[0] if docs else None)