"""Document ingestion: load PDFs from data/, chunk, embed, store in Chroma.

Only new or modified files are processed. A manifest file tracks what has
already been ingested (filename + last-modified timestamp).
"""

import json
import sys
from pathlib import Path

from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma

from app.config import DATA_DIR, CHROMA_DIR, EMBEDDING_MODEL, CHUNK_SIZE, CHUNK_OVERLAP

MANIFEST_PATH = CHROMA_DIR / "ingested_manifest.json"


def _load_manifest() -> dict:
    """Load the manifest of previously ingested files."""
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text())
    return {}


def _save_manifest(manifest: dict):
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))


def _get_new_pdfs(directory: Path, manifest: dict) -> list[Path]:
    """Return PDFs that are new or modified since last ingestion."""
    new_paths = []
    for path in sorted(directory.glob("*.pdf")):
        mtime = str(path.stat().st_mtime)
        if manifest.get(path.name) != mtime:
            new_paths.append(path)
    return new_paths


def load_pdfs(pdf_paths: list[Path]) -> list:
    """Load the given PDF files."""
    docs = []
    for path in pdf_paths:
        print(f"  Loading {path.name}...")
        loader = PyPDFLoader(str(path))
        docs.extend(loader.load())
    print(f"  Loaded {len(docs)} pages from {len(pdf_paths)} PDF(s)")
    return docs


def chunk_documents(docs: list) -> list:
    """Split documents into chunks."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
    )
    chunks = splitter.split_documents(docs)
    print(f"  Split into {len(chunks)} chunks")
    return chunks


def add_to_vector_store(chunks: list) -> Chroma:
    """Embed chunks and add them to the existing Chroma store."""
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    vector_store = Chroma(
        persist_directory=str(CHROMA_DIR),
        embedding_function=embeddings,
    )
    vector_store.add_documents(chunks)
    total = vector_store._collection.count()
    print(f"  Added {len(chunks)} vectors (total in store: {total})")
    return vector_store


def ingest_file(filename: str, file_bytes: bytes) -> dict:
    """Save an uploaded PDF to data/ and ingest it into the vector store."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    file_path = DATA_DIR / filename
    file_path.write_bytes(file_bytes)
    print(f"  Saved {filename} to {DATA_DIR}")

    docs = load_pdfs([file_path])
    chunks = chunk_documents(docs)
    store = add_to_vector_store(chunks)
    total = store._collection.count()

    manifest = _load_manifest()
    manifest[filename] = str(file_path.stat().st_mtime)
    _save_manifest(manifest)

    return {
        "filename": filename,
        "pages": len(docs),
        "chunks": len(chunks),
        "total_vectors": total,
    }


def delete_document(filename: str) -> dict:
    """Remove a document from the vector store and manifest."""
    manifest = _load_manifest()
    if filename not in manifest:
        return {"status": "not_found", "message": f"{filename} not in manifest"}

    # Remove matching vectors from Chroma
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    vector_store = Chroma(
        persist_directory=str(CHROMA_DIR),
        embedding_function=embeddings,
    )
    collection = vector_store._collection

    # Find IDs where source metadata ends with this filename
    results = collection.get(where={"source": str(DATA_DIR / filename)})
    if results["ids"]:
        collection.delete(ids=results["ids"])
        removed = len(results["ids"])
    else:
        # Fallback: match by filename suffix
        all_data = collection.get()
        ids_to_delete = [
            doc_id for doc_id, meta in zip(all_data["ids"], all_data["metadatas"])
            if meta.get("source", "").endswith(filename)
        ]
        if ids_to_delete:
            collection.delete(ids=ids_to_delete)
        removed = len(ids_to_delete)

    # Remove from manifest
    del manifest[filename]
    _save_manifest(manifest)

    # Remove the PDF file itself
    file_path = DATA_DIR / filename
    if file_path.exists():
        file_path.unlink()

    print(f"  Deleted {filename}: removed {removed} vectors")
    return {"status": "deleted", "filename": filename, "vectors_removed": removed}


def run() -> dict:
    if not DATA_DIR.exists():
        DATA_DIR.mkdir(parents=True)

    manifest = _load_manifest()
    new_pdfs = _get_new_pdfs(DATA_DIR, manifest)

    if not new_pdfs:
        all_pdfs = list(DATA_DIR.glob("*.pdf"))
        if not all_pdfs:
            msg = "Nothing to ingest. Add PDF files to the data/ directory."
        else:
            msg = f"All {len(all_pdfs)} PDF(s) already ingested. Nothing new to process."
        print(msg)
        return {"status": "skipped", "message": msg, "new_files": 0}

    print(f"Found {len(new_pdfs)} new/modified PDF(s):")
    for p in new_pdfs:
        print(f"  - {p.name}")

    docs = load_pdfs(new_pdfs)
    chunks = chunk_documents(docs)
    add_to_vector_store(chunks)

    # Update manifest with newly ingested files
    for path in new_pdfs:
        manifest[path.name] = str(path.stat().st_mtime)
    _save_manifest(manifest)

    print("Ingestion complete.")
    return {
        "status": "completed",
        "new_files": len(new_pdfs),
        "pages": len(docs),
        "chunks": len(chunks),
    }


if __name__ == "__main__":
    run()
