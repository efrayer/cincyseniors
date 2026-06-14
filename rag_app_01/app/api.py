"""FastAPI web interface for the RAG application."""

import html
import json
import re
from pathlib import Path

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from app.config import (
    LLM_API_KEY, LLM_BASE_URL,
    CHROMA_DIR, EMBEDDING_MODEL, CHUNK_SIZE, CHUNK_OVERLAP,
    CINDY_DATA_DIR, CINDY_COLLECTION, CINDY_MANIFEST_PATH,
    TTS_ENGINE, OPENAI_API_KEY, TTS_VOICE, TTS_MODEL, TTS_INSTRUCTIONS,
    ADMIN_API_KEY,
)
from app.graph import build_graph, retrieve, generate_stream
from app.ingest import ingest_file, run as ingest_run, _load_manifest, _save_manifest, delete_document
from app.chat_logger import init_db, log_turn, log_read_aloud, new_session_id

STATIC_DIR = Path(__file__).resolve().parent / "static"


def _esc(value: str) -> str:
    """HTML-escape a user-supplied string before storing in the database."""
    return html.escape(value.strip(), quote=True)


def require_admin_key(x_admin_key: str = Header(default="")):
    """Dependency: reject requests that don't carry the correct admin API key."""
    if not ADMIN_API_KEY:
        raise HTTPException(status_code=500, detail="ADMIN_API_KEY is not configured on the server.")
    if x_admin_key != ADMIN_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing admin API key.")

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="RAG Chat")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://www.cincyseniors.org", "https://cincyseniors.org"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "X-Admin-Key"],
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Build the graph once at startup
rag_graph = build_graph()


@app.on_event("startup")
async def startup_ingest():
    """Auto-ingest any new PDFs in data/ on startup and initialise the chat log DB."""
    init_db()
    print("Checking for new documents to ingest...")
    result = ingest_run()
    print(f"Startup ingest: {result}")


# ── Request / Response models ────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: str


class QueryResponse(BaseModel):
    answer: str
    sources: list[dict]


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/ingest")
async def ingest(files: list[UploadFile] = File(...)):
    """Upload and ingest one or more PDF files."""
    results = []
    for f in files:
        contents = await f.read()
        result = ingest_file(f.filename, contents)
        results.append(result)
    return {"results": results}


@app.post("/api/query", response_model=QueryResponse)
async def query(req: QueryRequest):
    """Run a question through the RAG pipeline (non-streaming)."""
    result = rag_graph.invoke({"question": req.question})

    sources = []
    for doc in result.get("documents", []):
        sources.append({
            "content": doc.page_content[:300],
            "metadata": doc.metadata,
        })

    return QueryResponse(answer=result["answer"], sources=sources)


@app.post("/api/query/stream")
async def query_stream(req: QueryRequest):
    """Run a question through the RAG pipeline with streaming response."""

    # Retrieve documents first
    state = retrieve({"question": req.question})
    docs = state["documents"]

    sources = []
    for doc in docs:
        sources.append({
            "content": doc.page_content[:300],
            "metadata": doc.metadata,
        })

    async def event_generator():
        # Send sources first
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"

        # Stream the answer tokens
        full_answer = ""
        for chunk in generate_stream({"question": req.question, "documents": docs}):
            full_answer += chunk
            yield f"data: {json.dumps({'type': 'token', 'token': chunk})}\n\n"

        yield f"data: {json.dumps({'type': 'done', 'answer': full_answer})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/documents")
async def list_documents():
    """List all ingested documents."""
    manifest = _load_manifest()
    return {"documents": list(manifest.keys())}


@app.delete("/api/documents/{filename}")
async def remove_document(filename: str):
    """Delete a document from the vector store and manifest."""
    result = delete_document(filename)
    return result


# ── CincySeniors "Ask Cindy" chat endpoint ───────────────────────────────────

CINDY_SYSTEM_PROMPT = """You are Cindy, a warm and helpful guide for CincySeniors.org — \
a community resource website for older adults and caregivers in the Greater Cincinnati area.

IMPORTANT — YOUR ONLY SOURCE OF INFORMATION:
You must answer questions ONLY using the context provided from the CincySeniors knowledge base \
below. Do not use any outside knowledge, general facts, or information from your training data. \
If the provided context does not contain enough information to answer the question, respond with \
something like: "I'm sorry, I don't have enough information in my knowledge base to fully answer \
that. I'd recommend contacting a local senior resource center or visiting CincySeniors.org for \
more help." Never guess, infer beyond the context, or fill in gaps with general knowledge.

Guidelines:
- Be warm, patient, and clear. Use plain language — avoid jargon.
- Base every answer strictly on the provided context. If it's not in the context, say so.
- When the context supports it, provide names, descriptions, and suggest users call or visit \
the organization to confirm current details.
- Keep responses concise but complete. Use short paragraphs or bullet points for readability.
- Never provide medical diagnoses or legal advice.
- Never make up phone numbers, addresses, hours, or program details not found in the context."""


class CindyChatMessage(BaseModel):
    role: str
    content: str


class CindyChatRequest(BaseModel):
    messages: list[CindyChatMessage]
    temperature: float = 0.65
    session_id: str = ""


@app.post("/cindy/chat")
@limiter.limit("10/minute")
async def cindy_chat(request: Request, req: CindyChatRequest):
    """CincySeniors RAG chat — accepts the same message format as cindychat.html."""
    session_id = req.session_id or new_session_id()

    # Separate out user/assistant turns (ignore any system message from the client)
    conversation = [m for m in req.messages if m.role in ("user", "assistant")]

    # Use the last user message as the RAG retrieval query
    last_user = next((m.content for m in reversed(conversation) if m.role == "user"), None)
    if not last_user:
        return {"reply": "I didn't receive a question. How can I help you today?", "sources": []}

    # Retrieve relevant chunks from the CincySeniors collection
    from langchain_chroma import Chroma
    from langchain_huggingface import HuggingFaceEmbeddings
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    cindy_store = Chroma(
        persist_directory=str(CHROMA_DIR),
        collection_name=CINDY_COLLECTION,
        embedding_function=embeddings,
    )
    docs = cindy_store.similarity_search(last_user, k=6)

    # Keyword boost: if the query looks like a facility/org name lookup, also run a
    # direct keyword search against all directory entries and merge unique results.
    query_lower = last_user.lower()
    all_data = cindy_store._collection.get()
    keyword_hits = []
    for meta, content in zip(all_data["metadatas"], all_data["documents"]):
        if meta.get("type") == "directory_entry":
            # Check if any word from the query (3+ chars) appears in the entry
            words = [w for w in re.findall(r"[a-z]{3,}", query_lower)]
            if any(w in content.lower() for w in words):
                from langchain_core.documents import Document as LCDoc
                keyword_hits.append(LCDoc(page_content=content, metadata=meta))
    # Merge: add keyword hits not already in semantic results (by content)
    seen = {d.page_content for d in docs}
    for hit in keyword_hits:
        if hit.page_content not in seen:
            docs.append(hit)
            seen.add(hit.page_content)

    # Build context string
    context = "\n\n---\n\n".join(doc.page_content for doc in docs)

    # If no relevant context was retrieved, return a fallback immediately
    if not context.strip():
        fallback = (
            "I'm sorry, I don't have enough information in my knowledge base to answer that. "
            "I'd recommend reaching out to a local senior resource center or visiting "
            "CincySeniors.org for more help."
        )
        log_id = log_turn(
            session_id=session_id,
            user_message=last_user,
            cindy_reply=fallback,
            sources=[],
            had_context=False,
        )
        return {"reply": fallback, "sources": [], "log_id": log_id}

    # Map Chroma metadata to the { title, url, snippet } shape cindychat.html renders
    sources = []
    for doc in docs:
        meta = doc.metadata
        raw_source = meta.get("source", "")
        title = Path(raw_source).stem.replace("_", " ").title() if raw_source else "CincySeniors Resource"
        sources.append({
            "title": title,
            "url": meta.get("url", "#"),
            "snippet": doc.page_content[:200],
        })

    # Build the message list for LM Studio
    system_content = CINDY_SYSTEM_PROMPT + f"\n\nContext from CincySeniors knowledge base:\n{context}"

    lm_messages: list = [SystemMessage(content=system_content)]
    for m in conversation:
        if m.role == "user":
            lm_messages.append(HumanMessage(content=m.content))
        else:
            lm_messages.append(AIMessage(content=m.content))

    llm = ChatOpenAI(
        base_url=LLM_BASE_URL,
        api_key=LLM_API_KEY,
        temperature=req.temperature,
    )
    response = llm.invoke(lm_messages)

    log_id = log_turn(
        session_id=session_id,
        user_message=last_user,
        cindy_reply=response.content,
        sources=sources,
        had_context=True,
    )

    return {"reply": response.content, "sources": sources, "log_id": log_id}


# ── CincySeniors document management ─────────────────────────────────────────

def _cindy_load_manifest() -> dict:
    if CINDY_MANIFEST_PATH.exists():
        return json.loads(CINDY_MANIFEST_PATH.read_text())
    return {}


def _cindy_save_manifest(manifest: dict):
    CINDY_MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    CINDY_MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))


@app.post("/cindy/ingest")
async def cindy_ingest(files: list[UploadFile] = File(...), _: None = Depends(require_admin_key)):
    """Upload and ingest PDFs into the CincySeniors collection."""
    from langchain_community.document_loaders import PyPDFLoader
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from langchain_chroma import Chroma
    from langchain_huggingface import HuggingFaceEmbeddings

    CINDY_DATA_DIR.mkdir(parents=True, exist_ok=True)
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    cindy_store = Chroma(
        persist_directory=str(CHROMA_DIR),
        collection_name=CINDY_COLLECTION,
        embedding_function=embeddings,
    )
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP
    )
    manifest = _cindy_load_manifest()
    results = []

    for f in files:
        contents = await f.read()
        file_path = CINDY_DATA_DIR / f.filename
        file_path.write_bytes(contents)

        loader = PyPDFLoader(str(file_path))
        docs = loader.load()
        chunks = splitter.split_documents(docs)
        cindy_store.add_documents(chunks)

        manifest[f.filename] = str(file_path.stat().st_mtime)
        results.append({
            "filename": f.filename,
            "pages": len(docs),
            "chunks": len(chunks),
        })

    _cindy_save_manifest(manifest)
    total = cindy_store._collection.count()
    return {"results": results, "total_vectors": total}


class CindyIngestTextRequest(BaseModel):
    title: str
    text: str


@app.post("/cindy/ingest-text")
async def cindy_ingest_text(req: CindyIngestTextRequest, _: None = Depends(require_admin_key)):
    """Ingest a plain-text snippet into the CincySeniors collection."""
    from langchain_core.documents import Document
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from langchain_chroma import Chroma
    from langchain_huggingface import HuggingFaceEmbeddings

    if not req.title.strip() or not req.text.strip():
        raise HTTPException(status_code=400, detail="Both title and text are required.")

    title = _esc(req.title)
    text  = _esc(req.text)

    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    cindy_store = Chroma(
        persist_directory=str(CHROMA_DIR),
        collection_name=CINDY_COLLECTION,
        embedding_function=embeddings,
    )
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP
    )

    doc = Document(page_content=text, metadata={"source": title, "type": "text"})
    chunks = splitter.split_documents([doc])
    cindy_store.add_documents(chunks)

    manifest = _cindy_load_manifest()
    manifest[title] = "text"
    _cindy_save_manifest(manifest)

    total = cindy_store._collection.count()
    return {"results": [{"filename": title, "chunks": len(chunks)}], "total_vectors": total}


class CindyIngestUrlRequest(BaseModel):
    urls: list[str]


@app.post("/cindy/ingest-url")
async def cindy_ingest_url(req: CindyIngestUrlRequest, _: None = Depends(require_admin_key)):
    """Fetch one or more URLs, scrape their text, and ingest into the CincySeniors collection."""
    import re
    import requests as http_requests
    from bs4 import BeautifulSoup
    from langchain_core.documents import Document
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from langchain_chroma import Chroma
    from langchain_huggingface import HuggingFaceEmbeddings

    if not req.urls:
        raise HTTPException(status_code=400, detail="At least one URL is required.")

    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    cindy_store = Chroma(
        persist_directory=str(CHROMA_DIR),
        collection_name=CINDY_COLLECTION,
        embedding_function=embeddings,
    )
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP
    )
    manifest = _cindy_load_manifest()
    results = []

    for url in req.urls:
        url = url.strip()
        if not url:
            continue
        try:
            resp = http_requests.get(url, timeout=15, headers={"User-Agent": "CincySeniors-Bot/1.0"})
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "lxml")
            # Remove nav, footer, script, style noise
            for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
                tag.decompose()
            text = soup.get_text(separator="\n", strip=True)
            # Collapse excessive blank lines
            text = re.sub(r"\n{3,}", "\n\n", text)
            if len(text.strip()) < 100:
                results.append({"url": url, "status": "skipped", "reason": "too little text after scraping"})
                continue
            title = soup.title.string.strip() if soup.title and soup.title.string else url
            doc = Document(page_content=text, metadata={"source": url, "title": title, "type": "url"})
            chunks = splitter.split_documents([doc])
            cindy_store.add_documents(chunks)
            manifest[url] = title
            _cindy_save_manifest(manifest)
            results.append({"url": url, "title": title, "chunks": len(chunks), "status": "ok"})
        except Exception as e:
            results.append({"url": url, "status": "error", "reason": str(e)})

    total = cindy_store._collection.count()
    return {"results": results, "total_vectors": total}


@app.get("/cindy/chat-log")
async def cindy_chat_log(limit: int = 10, _: None = Depends(require_admin_key)):
    """Return the most recent chat log entries."""
    import sqlite3
    from app.chat_logger import DB_PATH
    if not DB_PATH.exists():
        return {"entries": []}
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM chat_log ORDER BY timestamp DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return {
        "entries": [
            {
                "id": r["id"],
                "session_id": r["session_id"],
                "timestamp": r["timestamp"],
                "user_message": r["user_message"],
                "cindy_reply": r["cindy_reply"],
                "sources": json.loads(r["sources"]),
                "num_docs": r["num_docs"],
                "had_context": bool(r["had_context"]),
                "read_aloud_count": r["read_aloud_count"] if "read_aloud_count" in r.keys() else 0,
            }
            for r in rows
        ]
    }


class ReadAloudRequest(BaseModel):
    log_id: int


@app.post("/cindy/log-read-aloud")
@limiter.limit("30/minute")
async def cindy_log_read_aloud(request: Request, req: ReadAloudRequest):
    """Record that a user clicked Read Aloud for a given chat log entry."""
    if req.log_id > 0:
        log_read_aloud(req.log_id)
    return {"status": "ok"}


# ── Text-to-Speech endpoints ──────────────────────────────────────────────────

@app.get("/cindy/tts-config")
@limiter.limit("30/minute")
async def cindy_tts_config(request: Request):
    """Tell the frontend which TTS engine is active."""
    return {"engine": TTS_ENGINE, "voice": TTS_VOICE}


class CindyTTSRequest(BaseModel):
    text: str
    voice: str = ""


@app.post("/cindy/tts")
@limiter.limit("20/minute")
async def cindy_tts(request: Request, req: CindyTTSRequest):
    """Convert text to speech using OpenAI TTS and stream back an MP3."""
    if TTS_ENGINE != "openai":
        raise HTTPException(status_code=400, detail="OpenAI TTS is not enabled on this server.")
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured on the server.")

    import openai as openai_lib
    client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)

    voice = req.voice or TTS_VOICE

    # Strip markdown before sending to TTS
    import re
    clean = req.text
    clean = re.sub(r"#{1,6}\s+", "", clean)
    clean = re.sub(r"\*\*(.+?)\*\*", r"\1", clean)
    clean = re.sub(r"\*(.+?)\*", r"\1", clean)
    clean = re.sub(r"`{1,3}[^`]*`{1,3}", "", clean)
    clean = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", clean)
    clean = re.sub(r"^[-*+]\s+", "", clean, flags=re.MULTILINE)
    clean = re.sub(r"^\d+\.\s+", "", clean, flags=re.MULTILINE)
    clean = re.sub(r"\|[^\n]+", "", clean)
    clean = re.sub(r"-{3,}", "", clean)
    clean = re.sub(r"\n{2,}", ". ", clean)
    clean = clean.replace("\n", " ").strip()

    # OpenAI TTS — returns raw MP3 bytes
    # instructions= is only supported by gpt-4o-mini-tts; ignored silently for other models
    create_kwargs = dict(
        model=TTS_MODEL,
        voice=voice,
        input=clean,
        response_format="mp3",
    )
    if TTS_INSTRUCTIONS and TTS_MODEL == "gpt-4o-mini-tts":
        create_kwargs["instructions"] = TTS_INSTRUCTIONS

    response = client.audio.speech.create(**create_kwargs)

    audio_bytes = response.content

    return StreamingResponse(
        iter([audio_bytes]),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/cindy/documents")
async def cindy_list_documents(_: None = Depends(require_admin_key)):
    """List all documents ingested into the CincySeniors collection."""
    manifest = _cindy_load_manifest()
    return {"documents": list(manifest.keys())}


@app.delete("/cindy/documents/{filename}")
async def cindy_remove_document(filename: str, _: None = Depends(require_admin_key)):
    """Remove a document from the CincySeniors collection."""
    from langchain_chroma import Chroma
    from langchain_huggingface import HuggingFaceEmbeddings

    manifest = _cindy_load_manifest()
    if filename not in manifest:
        return {"status": "not_found", "message": f"{filename} not in CincySeniors manifest"}

    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    cindy_store = Chroma(
        persist_directory=str(CHROMA_DIR),
        collection_name=CINDY_COLLECTION,
        embedding_function=embeddings,
    )
    collection = cindy_store._collection
    is_url  = filename.startswith("http://") or filename.startswith("https://")
    is_text = manifest.get(filename) == "text"

    if is_url:
        # URL-ingested chunks store the URL as the source
        results = collection.get(where={"source": filename})
        ids_to_delete = results["ids"]
    elif is_text:
        # Plain-text entries store the title as the source
        results = collection.get(where={"source": filename})
        ids_to_delete = results["ids"]
    else:
        # PDF entries store the full file path as the source
        source_path = str(CINDY_DATA_DIR / filename)
        results = collection.get(where={"source": source_path})
        ids_to_delete = results["ids"]

    # Fallback: scan all metadata if the targeted query found nothing
    if not ids_to_delete:
        all_data = collection.get()
        ids_to_delete = [
            doc_id for doc_id, meta in zip(all_data["ids"], all_data["metadatas"])
            if meta.get("source", "") == filename
            or meta.get("source", "").endswith(filename)
        ]

    if ids_to_delete:
        collection.delete(ids=ids_to_delete)

    del manifest[filename]
    _cindy_save_manifest(manifest)

    # Only try to remove a file for PDF entries
    if not is_url and not is_text:
        file_path = CINDY_DATA_DIR / filename
        if file_path.exists():
            file_path.unlink()

    return {"status": "deleted", "filename": filename, "vectors_removed": len(ids_to_delete)}


# ── Directory Admin endpoints ─────────────────────────────────────────────────

@app.get("/cindy/directory/entries")
async def cindy_directory_entries(_: None = Depends(require_admin_key)):
    """Return all directory_entry chunks with completeness metadata."""
    from langchain_chroma import Chroma
    from langchain_huggingface import HuggingFaceEmbeddings

    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    cindy_store = Chroma(
        persist_directory=str(CHROMA_DIR),
        collection_name=CINDY_COLLECTION,
        embedding_function=embeddings,
    )
    data = cindy_store._collection.get()
    entries = []
    for doc_id, meta, content in zip(data["ids"], data["metadatas"], data["documents"]):
        if meta.get("type") != "directory_entry":
            continue
        lines = content.split("\n")
        first_line = lines[0].replace("Organization: ", "")
        has_street = bool(re.search(r"\d{2,5}\s+\w", first_line))
        has_phone = any(l.startswith("Phone:") for l in lines)
        has_website = any(l.startswith("Website:") for l in lines)
        is_enriched = meta.get("source", "") == "cincinnati_senior_directory_enriched"
        entries.append({
            "id": doc_id,
            "content": content,
            "has_street": has_street,
            "has_phone": has_phone,
            "has_website": has_website,
            "is_enriched": is_enriched,
        })
    entries.sort(key=lambda e: e["content"].split("\n")[0])
    return {"entries": entries}


class DirectoryEnrichRequest(BaseModel):
    doc_id: str
    name: str
    address: str = ""
    city_state_zip: str = ""
    county: str = ""
    org_type: str = ""
    phone: str = ""
    website: str = ""


@app.post("/cindy/directory/enrich")
async def cindy_directory_enrich(req: DirectoryEnrichRequest, _: None = Depends(require_admin_key)):
    """Replace a directory entry with an enriched version."""
    from langchain_chroma import Chroma
    from langchain_huggingface import HuggingFaceEmbeddings
    from langchain_core.documents import Document as LCDoc

    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    cindy_store = Chroma(
        persist_directory=str(CHROMA_DIR),
        collection_name=CINDY_COLLECTION,
        embedding_function=embeddings,
    )

    # Build location string (all fields HTML-escaped before storage)
    name    = _esc(req.name)
    address = _esc(req.address)
    csz     = _esc(req.city_state_zip)
    county  = _esc(req.county)
    org_type = _esc(req.org_type)
    phone   = _esc(req.phone)
    website = _esc(req.website)

    if address:
        location = f"{address}, {csz} {county}".strip()
    else:
        location = f"{csz} {county}".strip()

    lines = [f"Organization: {name} {location}".strip()]
    if org_type:
        lines.append(f"Type: {org_type}")
    if phone:
        lines.append(f"Phone: {phone}")
    if website:
        lines.append(f"Website: {website}")
    lines.append("Source: Greater Cincinnati Senior Services Directory")
    new_text = "\n".join(lines)

    # Delete old entry
    cindy_store._collection.delete(ids=[req.doc_id])

    # Add enriched entry
    doc = LCDoc(
        page_content=new_text,
        metadata={
            "type": "directory_entry",
            "source": "cincinnati_senior_directory_enriched",
        },
    )
    cindy_store.add_documents([doc])

    return {"status": "ok", "new_content": new_text}


class DirectoryAddRequest(BaseModel):
    name: str
    address: str = ""
    city_state_zip: str = ""
    county: str = ""
    org_type: str = ""
    phone: str = ""
    website: str = ""


@app.post("/cindy/directory/add")
async def cindy_directory_add(req: DirectoryAddRequest, _: None = Depends(require_admin_key)):
    """Add a brand-new directory entry to the CincySeniors collection."""
    from langchain_chroma import Chroma
    from langchain_huggingface import HuggingFaceEmbeddings
    from langchain_core.documents import Document as LCDoc

    if not req.name.strip():
        raise HTTPException(status_code=400, detail="name is required")

    # HTML-escape all user-supplied fields before storage
    name     = _esc(req.name)
    address  = _esc(req.address)
    csz      = _esc(req.city_state_zip)
    county   = _esc(req.county)
    org_type = _esc(req.org_type)
    phone    = _esc(req.phone)
    website  = _esc(req.website)

    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    cindy_store = Chroma(
        persist_directory=str(CHROMA_DIR),
        collection_name=CINDY_COLLECTION,
        embedding_function=embeddings,
    )

    if address:
        location = f"{address}, {csz} {county}".strip()
    else:
        location = f"{csz} {county}".strip()

    lines = [f"Organization: {name} {location}".strip()]
    if org_type:
        lines.append(f"Type: {org_type}")
    if phone:
        lines.append(f"Phone: {phone}")
    if website:
        lines.append(f"Website: {website}")
    lines.append("Source: Greater Cincinnati Senior Services Directory")
    new_text = "\n".join(lines)

    doc = LCDoc(
        page_content=new_text,
        metadata={
            "type": "directory_entry",
            "source": "cincinnati_senior_directory_enriched",
        },
    )
    cindy_store.add_documents([doc])

    return {"status": "ok", "new_content": new_text}


# ── Traffic / Analytics endpoint ─────────────────────────────────────────────

ACCESS_LOG_PATH = Path("/Users/ericfrayer/webstack/logs/cincyseniors_access.log")

_IGNORE_PREFIXES = (
    "/cindy/tts", "/cindy/chat", "/cindy/log-", "/cindy/directory",
    "/cindy/ingest", "/cindy/documents", "/cindy/chat-log",
    "/static/", "/favicon", "/robots", "/sitemap",
)
_ASSET_EXTS = (".css", ".js", ".png", ".jpg", ".jpeg", ".gif",
               ".svg", ".ico", ".woff", ".woff2", ".ttf", ".map", ".webp")
_BOT_PATTERNS = (
    "bot", "crawler", "spider", "slurp", "facebookexternalhit",
    "semrush", "ahrefsbot", "mj12bot", "dotbot", "petalbot",
    "bingpreview", "google-inspectiontool", "headlesschrome",
    "python-requests", "curl/", "wget/",
)


def _is_bot(ua: str) -> bool:
    ua_lower = ua.lower()
    return any(p in ua_lower for p in _BOT_PATTERNS)


def _is_page_request(uri: str, method: str) -> bool:
    if method != "GET":
        return False
    if any(uri.startswith(p) for p in _IGNORE_PREFIXES):
        return False
    if any(uri.lower().endswith(ext) for ext in _ASSET_EXTS):
        return False
    return True


@app.get("/cindy/traffic")
async def cindy_traffic(days: int = 30, _: None = Depends(require_admin_key)):
    """Parse Caddy access logs and return traffic statistics."""
    import json as _json
    from datetime import datetime, timezone, timedelta
    from collections import defaultdict
    from urllib.parse import urlparse

    if not ACCESS_LOG_PATH.exists():
        return {"error": "Access log not found", "path": str(ACCESS_LOG_PATH)}

    cutoff_ts = (datetime.now(timezone.utc) - timedelta(days=days)).timestamp()

    total_requests = 0
    human_requests = 0
    bot_requests = 0
    page_views = 0
    status_counts: dict = defaultdict(int)
    page_counts:   dict = defaultdict(int)
    day_counts:    dict = defaultdict(int)
    referrer_counts: dict = defaultdict(int)
    recent: list = []

    with open(ACCESS_LOG_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = _json.loads(line)
            except Exception:
                continue

            ts = entry.get("ts", 0)
            if ts < cutoff_ts:
                continue

            req    = entry.get("request", {})
            method = req.get("method", "GET")
            uri    = req.get("uri", "/")
            ua     = (req.get("headers", {}).get("User-Agent") or [""])[0]
            ref    = (req.get("headers", {}).get("Referer") or [""])[0]
            ip     = req.get("client_ip", req.get("remote_ip", ""))
            status = entry.get("status", 0)
            size   = entry.get("size", 0)
            dur    = entry.get("duration", 0)

            dt      = datetime.fromtimestamp(ts, tz=timezone.utc)
            day_key = dt.strftime("%Y-%m-%d")

            total_requests += 1
            status_counts[str(status)] += 1

            is_bot = _is_bot(ua)
            if is_bot:
                bot_requests += 1
            else:
                human_requests += 1
                day_counts[day_key] += 1

                if _is_page_request(uri, method):
                    page_views += 1
                    clean_uri = uri.split("?")[0].rstrip("/") or "/"
                    page_counts[clean_uri] += 1

                if ref and "cincyseniors.org" not in ref:
                    try:
                        host = urlparse(ref).netloc or ref
                        referrer_counts[host] += 1
                    except Exception:
                        pass

                if len(recent) < 200:
                    recent.append({
                        "ts":     dt.strftime("%Y-%m-%d %H:%M:%S"),
                        "method": method,
                        "uri":    uri[:120],
                        "status": status,
                        "size":   size,
                        "dur_ms": round(dur * 1000),
                        "ua":     ua[:80],
                        "ip":     ip,
                    })

    top_pages = sorted(page_counts.items(), key=lambda x: -x[1])[:20]
    top_refs  = sorted(referrer_counts.items(), key=lambda x: -x[1])[:10]

    from datetime import date, timedelta as td
    today = date.today()
    daily_series = []
    for i in range(days - 1, -1, -1):
        d = (today - td(days=i)).strftime("%Y-%m-%d")
        daily_series.append({"date": d, "count": day_counts.get(d, 0)})

    recent.reverse()

    return {
        "days":           days,
        "total_requests": total_requests,
        "human_requests": human_requests,
        "bot_requests":   bot_requests,
        "page_views":     page_views,
        "status_counts":  dict(status_counts),
        "top_pages":      [{"uri": u, "views": v} for u, v in top_pages],
        "top_referrers":  [{"host": h, "count": c} for h, c in top_refs],
        "daily_series":   daily_series,
        "recent":         recent[:100],
    }


if __name__ == "__main__":
    import os
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
