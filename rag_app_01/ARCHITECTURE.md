# RAG Application Architecture

A local Retrieval-Augmented Generation (RAG) pipeline built with LangGraph, ChromaDB, and LM Studio. All components run locally — no cloud APIs or API keys required.

---

## What is RAG?

Retrieval-Augmented Generation combines two steps to answer questions about your documents:

1. **Retrieval** — Find the most relevant passages from your documents based on the question.
2. **Generation** — Feed those passages as context to a large language model, which produces an answer grounded in your actual data.

This approach lets the LLM answer questions about documents it was never trained on, while reducing hallucination by constraining it to the retrieved context.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      INGESTION PIPELINE                     │
│                                                             │
│   data/*.pdf                                                │
│       │                                                     │
│       ▼                                                     │
│   ┌──────────┐    ┌──────────────┐    ┌───────────────┐     │
│   │ PyPDFLoader│──▶│ Text Splitter │──▶│  Sentence      │    │
│   │          │    │ (1000 chars)  │    │  Transformers  │    │
│   └──────────┘    └──────────────┘    │  (embed)       │    │
│                                       └───────┬───────┘     │
│                                               │             │
│                                               ▼             │
│                                       ┌──────────────┐      │
│                                       │   ChromaDB    │      │
│                                       │  (persistent) │      │
│                                       └──────────────┘      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    QUERY PIPELINE (LangGraph)                │
│                                                             │
│   User Question                                             │
│       │                                                     │
│       ▼                                                     │
│   ┌──────────────────┐    ┌──────────────────────────┐      │
│   │  RETRIEVE node   │    │     GENERATE node        │      │
│   │                  │    │                          │      │
│   │  Embed question  │    │  Question + retrieved    │      │
│   │  with Sentence   │──▶│  context sent to         │      │
│   │  Transformers,   │    │  LM Studio LLM via      │      │
│   │  query ChromaDB  │    │  OpenAI-compatible API   │      │
│   │  for top-4 chunks│    │                          │      │
│   └──────────────────┘    └───────────┬──────────────┘      │
│                                       │                     │
│                                       ▼                     │
│                                    Answer                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Components

### Embedding Model — Sentence Transformers

| Detail        | Value                          |
|---------------|--------------------------------|
| Model         | `all-MiniLM-L6-v2`            |
| Runs on       | Local CPU (no GPU required)    |
| Vector size   | 384 dimensions                 |
| Purpose       | Converts text into numerical vectors for similarity search |

This model is used in both pipelines: during ingestion to embed document chunks, and during queries to embed the user's question. Because the same model is used for both, the vectors are directly comparable.

### Vector Store — ChromaDB

| Detail        | Value                          |
|---------------|--------------------------------|
| Storage       | `chroma_store/` (local, persistent) |
| Search method | Cosine similarity              |
| Results per query | 4 chunks (configurable)   |

ChromaDB stores the embedded document chunks on disk. When a question is asked, it finds the chunks whose embeddings are most similar to the question's embedding.

### LLM — LM Studio

| Detail        | Value                                    |
|---------------|------------------------------------------|
| Endpoint      | `http://192.168.68.69:1234/v1`           |
| Protocol      | OpenAI-compatible REST API               |
| Integration   | LangChain `ChatOpenAI` with dummy API key |
| Temperature   | 0.7                                      |

LM Studio serves a local LLM and exposes an OpenAI-compatible API. The application connects to it using LangChain's `ChatOpenAI` class — no OpenAI account needed.

### Orchestration — LangGraph

The query pipeline is defined as a LangGraph `StateGraph` with a typed state object:

```
START ──▶ retrieve ──▶ generate ──▶ END
```

**State** carries three fields through the graph:

| Field       | Type             | Set by   |
|-------------|------------------|----------|
| `question`  | `str`            | User input |
| `documents` | `list[Document]` | `retrieve` node |
| `answer`    | `str`            | `generate` node |

---

## Ingestion Pipeline

**Script:** `app/ingest.py`

The ingestion pipeline processes PDF files and stores them in the vector database. It uses incremental ingestion — only new or modified files are processed.

### Steps

1. **Scan** — Read all `*.pdf` files from the `data/` directory.
2. **Diff** — Compare against `chroma_store/ingested_manifest.json` (tracks filename + last-modified timestamp). Skip files that haven't changed.
3. **Load** — Extract text from each new PDF page-by-page using `PyPDFLoader`.
4. **Chunk** — Split the text into overlapping segments using `RecursiveCharacterTextSplitter`:
   - **Chunk size:** 1000 characters
   - **Overlap:** 200 characters (ensures context isn't lost at boundaries)
5. **Embed & Store** — Each chunk is embedded with `all-MiniLM-L6-v2` and added to the persistent ChromaDB collection.
6. **Update manifest** — Record the ingested files so they are skipped next time.

### Usage

```bash
# Drop PDFs into data/, then run:
python -m app.ingest
```

On subsequent runs, only new or modified PDFs are processed. Already-ingested files are skipped.

---

## Query Pipeline

**Script:** `app/graph.py` | **Entry point:** `app/main.py`

### Steps

1. **User asks a question** via the interactive CLI.
2. **Retrieve node** — The question is embedded using `all-MiniLM-L6-v2`, then ChromaDB returns the 4 most similar document chunks.
3. **Generate node** — The question and retrieved chunks are assembled into a prompt and sent to LM Studio. The system prompt instructs the LLM to answer using only the provided context.
4. **Answer is displayed** to the user.

### System Prompt

The LLM receives the following instruction:

> You are a helpful assistant. Answer the user's question using only the provided context. If the context doesn't contain enough information, say so.

This constrains the model to the retrieved documents and reduces hallucination.

### Usage

```bash
python -m app.main
```

---

## Project Structure

```
rag_app_01/
├── app/
│   ├── __init__.py          # Package marker
│   ├── config.py            # All configuration (paths, URLs, model params)
│   ├── ingest.py            # Ingestion pipeline (PDF → chunks → ChromaDB)
│   ├── graph.py             # LangGraph RAG pipeline (retrieve → generate)
│   └── main.py              # Interactive CLI entry point
├── data/                    # Place PDF files here for ingestion
├── chroma_store/            # Persistent vector database (auto-created)
│   └── ingested_manifest.json  # Tracks ingested files
├── requirements.txt         # Pinned Python dependencies
└── venv/                    # Python 3.12 virtual environment
```

---

## Configuration

All tunable parameters are centralized in `app/config.py`:

| Parameter        | Default                             | Description                        |
|------------------|-------------------------------------|------------------------------------|
| `DATA_DIR`       | `data/`                             | Directory to scan for PDFs         |
| `CHROMA_DIR`     | `chroma_store/`                     | Persistent vector store location   |
| `LLM_BASE_URL`   | `http://192.168.68.69:1234/v1`     | LM Studio API endpoint            |
| `LLM_API_KEY`    | `lm-studio`                         | Dummy key for OpenAI compatibility |
| `EMBEDDING_MODEL` | `all-MiniLM-L6-v2`                | Sentence Transformers model name   |
| `CHUNK_SIZE`      | `1000`                             | Characters per chunk               |
| `CHUNK_OVERLAP`   | `200`                              | Overlap between consecutive chunks |
| `RETRIEVAL_K`     | `4`                                | Number of chunks retrieved per query |
