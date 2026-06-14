"""Generate a PDF report documenting the RAG integration project."""

from fpdf import FPDF
from datetime import date


class Report(FPDF):
    def header(self):
        self.set_font("Helvetica", "B", 10)
        self.set_text_color(120, 120, 120)
        self.cell(0, 8, "RAG Integration Project Report", align="R")
        self.ln(12)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def title_page(self):
        self.add_page()
        self.ln(50)
        self.set_font("Helvetica", "B", 28)
        self.set_text_color(30, 30, 30)
        self.cell(0, 14, "RAG Integration Project", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(6)
        self.set_font("Helvetica", "", 16)
        self.set_text_color(80, 80, 80)
        self.cell(0, 10, "Retrieval-Augmented Generation for", align="C", new_x="LMARGIN", new_y="NEXT")
        self.cell(0, 10, "the Webstack Chat Application", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(20)
        self.set_font("Helvetica", "", 12)
        self.set_text_color(100, 100, 100)
        self.cell(0, 8, f"Built with Claude Code  |  {date.today().strftime('%B %d, %Y')}", align="C", new_x="LMARGIN", new_y="NEXT")
        self.ln(40)
        self.set_draw_color(76, 110, 245)
        self.set_line_width(0.5)
        self.line(60, self.get_y(), self.w - 60, self.get_y())

    def section_title(self, title):
        self.set_font("Helvetica", "B", 18)
        self.set_text_color(30, 30, 30)
        self.ln(4)
        self.cell(0, 12, title, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(76, 110, 245)
        self.set_line_width(0.4)
        self.line(self.l_margin, self.get_y() + 1, self.l_margin + 50, self.get_y() + 1)
        self.ln(6)

    def sub_title(self, title):
        self.set_font("Helvetica", "B", 13)
        self.set_text_color(50, 50, 50)
        self.ln(2)
        self.cell(0, 9, title, new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def body_text(self, text):
        self.set_font("Helvetica", "", 10.5)
        self.set_text_color(40, 40, 40)
        self.multi_cell(0, 5.5, text)
        self.ln(2)

    def bullet(self, text, indent=10):
        x = self.get_x()
        self.set_font("Helvetica", "", 10.5)
        self.set_text_color(40, 40, 40)
        self.set_x(x + indent)
        self.cell(5, 5.5, "-")
        self.multi_cell(0, 5.5, text)
        self.ln(1)

    def code_block(self, text):
        self.set_font("Courier", "", 9)
        self.set_fill_color(245, 245, 248)
        self.set_text_color(50, 50, 50)
        self.set_draw_color(220, 220, 225)
        x = self.l_margin + 4
        w = self.w - self.l_margin - self.r_margin - 8
        lines = text.split("\n")
        h = len(lines) * 5 + 6
        y = self.get_y()
        if y + h > self.h - 25:
            self.add_page()
            y = self.get_y()
        self.rect(x, y, w, h, style="DF")
        self.set_xy(x + 4, y + 3)
        for line in lines:
            self.set_x(x + 4)
            self.cell(0, 5, line, new_x="LMARGIN", new_y="NEXT")
        self.ln(4)

    def table_row(self, cols, widths, bold=False, fill=False):
        style = "B" if bold else ""
        self.set_font("Helvetica", style, 9.5)
        if fill:
            self.set_fill_color(240, 242, 248)
        self.set_text_color(40, 40, 40)
        h = 7
        x = self.get_x()
        for i, (col, w) in enumerate(zip(cols, widths)):
            self.set_x(x + sum(widths[:i]))
            self.cell(w, h, col, border=1, fill=fill)
        self.ln(h)


def build():
    pdf = Report()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)

    # ── Title page ──
    pdf.title_page()

    # ── 1. Overview ──
    pdf.add_page()
    pdf.section_title("1. Project Overview")
    pdf.body_text(
        "This project adds Retrieval-Augmented Generation (RAG) capabilities to an existing "
        "production webstack running on a Mac Mini. The webstack serves a chat interface powered "
        "by LM Studio (a local LLM server) through a Docker Compose stack of Caddy, Node.js/Express, "
        "and ChromaDB, accessible via Cloudflare."
    )
    pdf.body_text(
        "The RAG system allows users to upload documents (PDF, DOCX, CSV, TXT), which are chunked, "
        "embedded, and stored in a ChromaDB vector database. When the RAG toggle is enabled in the "
        "chat interface, user queries are matched against stored document chunks and the relevant "
        "context is injected into the LLM prompt, enabling accurate answers grounded in the uploaded content."
    )

    pdf.sub_title("Goals")
    pdf.bullet("Enable document-grounded Q&A in the existing chat interface")
    pdf.bullet("Support multiple document formats: PDF, Word, CSV, and plain text")
    pdf.bullet("Provide a dedicated admin page for document upload and management")
    pdf.bullet("Preserve all existing functionality (chat, web search, streaming, memory)")
    pdf.bullet("Run entirely locally with no external API dependencies for embeddings")

    # ── 2. Architecture ──
    pdf.add_page()
    pdf.section_title("2. System Architecture")

    pdf.sub_title("Infrastructure (Docker Compose)")
    pdf.body_text("The system runs three containers orchestrated by Docker Compose:")

    w = [45, 45, 85]
    pdf.table_row(["Service", "Image", "Purpose"], w, bold=True, fill=True)
    pdf.table_row(["caddy", "caddy:latest", "Reverse proxy, SSL termination (port 80)"], w)
    pdf.table_row(["app (nodeapp)", "node:20-slim", "Express server, RAG pipeline, chat API"], w)
    pdf.table_row(["chromadb", "chromadb/chroma", "Vector database for document embeddings"], w)

    pdf.ln(4)
    pdf.body_text(
        "The node:20-slim image (Debian-based) is required because the embedding library "
        "(onnxruntime) needs glibc, which Alpine Linux does not provide. ChromaDB runs as a "
        "separate service because the JS client is HTTP-only and cannot run in-process."
    )
    pdf.body_text(
        "LM Studio runs directly on the Mac host (not in Docker) and is accessible from "
        "containers via host.docker.internal:1234. Cloudflare handles external SSL termination "
        "and proxies traffic to Caddy on port 80."
    )

    pdf.sub_title("Data Flow: Document Ingestion")
    pdf.body_text("When a user uploads a document through the /rag-admin page:")
    pdf.bullet("1. The file is uploaded to the Express server via multipart form POST")
    pdf.bullet("2. A format-specific extractor converts the file to plain text")
    pdf.bullet("3. The text is split into overlapping chunks (500 chars, 50 char overlap)")
    pdf.bullet("4. Each chunk is embedded using all-MiniLM-L6-v2 (384-dimensional vectors)")
    pdf.bullet("5. Chunks, embeddings, and metadata are stored in ChromaDB")

    pdf.sub_title("Data Flow: RAG Query")
    pdf.body_text("When a user sends a chat message with the RAG toggle enabled:")
    pdf.bullet("1. The user's query is embedded using the same model")
    pdf.bullet("2. ChromaDB performs cosine similarity search (top 4 results)")
    pdf.bullet("3. Matching chunks are formatted into a context block with source citations")
    pdf.bullet("4. The context is appended to the system prompt sent to LM Studio")
    pdf.bullet("5. The LLM generates a response grounded in the retrieved documents")

    # ── 3. RAG Module ──
    pdf.add_page()
    pdf.section_title("3. RAG Module (app/rag/)")
    pdf.body_text(
        "The RAG logic is organized as a self-contained module under app/rag/ with five files:"
    )

    pdf.sub_title("embeddings.js")
    pdf.body_text(
        "Handles local text embedding using @xenova/transformers, which runs the "
        "all-MiniLM-L6-v2 model via ONNX Runtime directly in Node.js. The model (~25MB) "
        "is downloaded on first use and cached in a persistent Docker volume (hf_cache)."
    )
    pdf.body_text("Exports: initEmbeddings(), embedText(string), embedBatch(string[])")

    pdf.sub_title("vectorstore.js")
    pdf.body_text(
        "Manages the ChromaDB connection and collection operations. Connects to the ChromaDB "
        "container via HTTP (http://chromadb:8000). Uses pre-computed embeddings rather than "
        "relying on ChromaDB's built-in embedding functions, avoiding native dependency issues."
    )
    pdf.body_text("Exports: initChroma(), addDocuments(), queryByEmbedding(), deleteByDocumentId(), listDocuments()")

    pdf.sub_title("documents.js")
    pdf.body_text(
        "Handles document ingestion for all supported file types. Contains a shared ingestText() "
        "core that chunks, embeds, and stores text, plus format-specific extractors:"
    )

    w2 = [30, 35, 110]
    pdf.table_row(["Format", "Library", "Strategy"], w2, bold=True, fill=True)
    pdf.table_row(["PDF", "pdf-parse", "Extract text from all pages"], w2)
    pdf.table_row(["DOCX", "mammoth", "Extract raw text content"], w2)
    pdf.table_row(["CSV", "(built-in)", "Convert rows to 'Header: value' natural language"], w2)
    pdf.table_row(["TXT", "(built-in)", "Read as UTF-8 string directly"], w2)

    pdf.ln(3)
    pdf.body_text("Exports: ingestDocument(buffer, filename), ingestPDF() [backward compat]")

    pdf.sub_title("retriever.js")
    pdf.body_text(
        "Embeds the user's query, searches ChromaDB for the top-K most similar chunks, "
        "and formats them into a context string for the LLM. The buildRagContext() function "
        "mirrors the existing buildSearchContext() pattern used by web search, with numbered "
        "citations and source filenames."
    )

    pdf.sub_title("index.js")
    pdf.body_text(
        "Orchestrator module that initializes embeddings and ChromaDB in parallel at startup, "
        "and re-exports all public functions as the module's API."
    )

    # ── 4. Server Changes ──
    pdf.add_page()
    pdf.section_title("4. Server.js Modifications")

    pdf.sub_title("Startup")
    pdf.body_text(
        "The RAG module is initialized at server startup with a non-blocking call. If initialization "
        "fails (e.g., ChromaDB not ready yet), a warning is logged but the server continues to "
        "operate normally for non-RAG features."
    )

    pdf.sub_title("Chat Endpoint (/api/chat)")
    pdf.body_text(
        "The existing /api/chat endpoint was extended to support RAG alongside web search. "
        "When the request includes useRag: true, the server:"
    )
    pdf.bullet("Embeds the user's query and retrieves matching document chunks")
    pdf.bullet("Formats the chunks into a context block injected into the system prompt")
    pdf.bullet("Returns RAG source metadata alongside the LLM response")
    pdf.body_text(
        "RAG and web search are mutually exclusive. If both are requested, web search takes "
        "precedence. The system prompt injection follows the same pattern: "
        "baseSystem + separator + context."
    )

    pdf.sub_title("RAG Admin Endpoints")
    w3 = [30, 60, 85]
    pdf.table_row(["Method", "Path", "Purpose"], w3, bold=True, fill=True)
    pdf.table_row(["POST", "/api/rag/documents", "Upload and ingest a document"], w3)
    pdf.table_row(["GET", "/api/rag/documents", "List all ingested documents"], w3)
    pdf.table_row(["DELETE", "/api/rag/documents/:id", "Delete a document and its chunks"], w3)
    pdf.table_row(["GET", "/rag-admin", "Serve the admin page"], w3)

    pdf.ln(3)
    pdf.sub_title("File Upload Handling")
    pdf.body_text(
        "Multer handles multipart file uploads with a 10MB size limit. The file filter accepts "
        ".pdf, .docx, .csv, and .txt extensions. Files are stored in memory (not disk) and "
        "passed directly to the ingestion pipeline."
    )

    # ── 5. Frontend ──
    pdf.add_page()
    pdf.section_title("5. Frontend Changes")

    pdf.sub_title("chat-advanced.html")
    pdf.body_text(
        "The existing RAG checkbox toggle was wired into the /api/chat request flow, following "
        "the same pattern as the web search toggle:"
    )
    pdf.bullet("RAG and Web Search checkboxes are mutually exclusive (checking one unchecks the other)")
    pdf.bullet("When RAG is enabled, the thinking indicator shows 'Searching documents...'")
    pdf.bullet("RAG sources display inline with snippet text (no URLs, unlike web search results)")
    pdf.bullet("Debug panel shows RAG-specific metrics (ragUsed, ragResults count)")
    pdf.body_text(
        "All existing functionality (streaming, memory, web search, theme toggle) continues "
        "to work unchanged."
    )

    pdf.sub_title("rag-admin.html")
    pdf.body_text(
        "A new dedicated page for document management, styled to match the existing dark/light "
        "theme system used across the webstack. Features:"
    )
    pdf.bullet("Drag-and-drop upload zone supporting PDF, DOCX, CSV, and TXT files")
    pdf.bullet("Real-time processing status indicator during upload and ingestion")
    pdf.bullet("Document list showing filename, upload date, chunk count, and character count")
    pdf.bullet("Delete button with confirmation dialog for each document")
    pdf.bullet("Dark/light theme toggle matching the chat pages")
    pdf.bullet("Navigation link back to the chat interface")

    # ── 6. Files Created/Modified ──
    pdf.add_page()
    pdf.section_title("6. File Summary")

    pdf.sub_title("Files Created")
    w4 = [65, 110]
    pdf.table_row(["File", "Purpose"], w4, bold=True, fill=True)
    pdf.table_row(["app/rag/embeddings.js", "Local embedding via @xenova/transformers"], w4)
    pdf.table_row(["app/rag/vectorstore.js", "ChromaDB client operations"], w4)
    pdf.table_row(["app/rag/documents.js", "Multi-format ingestion pipeline"], w4)
    pdf.table_row(["app/rag/retriever.js", "Query embedding + similarity search"], w4)
    pdf.table_row(["app/rag/index.js", "Module orchestrator and public API"], w4)
    pdf.table_row(["app/public/rag-admin.html", "Document upload and management UI"], w4)

    pdf.ln(4)
    pdf.sub_title("Files Modified")
    pdf.table_row(["File", "Change"], w4, bold=True, fill=True)
    pdf.table_row(["docker-compose.yml", "Added ChromaDB service, node:20-slim, volumes"], w4)
    pdf.table_row(["Caddyfile", "Added /rag-admin reverse proxy route"], w4)
    pdf.table_row(["app/package.json", "Added chromadb, transformers, mammoth, etc."], w4)
    pdf.table_row(["app/Server.js", "RAG init, chat endpoint, admin API routes"], w4)
    pdf.table_row(["app/public/chat-advanced.html", "RAG toggle wiring, source rendering"], w4)

    # ── 7. Dependencies ──
    pdf.ln(6)
    pdf.section_title("7. Dependencies Added")

    w5 = [55, 120]
    pdf.table_row(["Package", "Purpose"], w5, bold=True, fill=True)
    pdf.table_row(["chromadb", "JavaScript client for ChromaDB vector database"], w5)
    pdf.table_row(["@xenova/transformers", "Run all-MiniLM-L6-v2 embedding model in Node.js"], w5)
    pdf.table_row(["pdf-parse", "Extract text content from PDF files"], w5)
    pdf.table_row(["multer", "Handle multipart file uploads in Express"], w5)
    pdf.table_row(["mammoth", "Extract text from DOCX (Word) files"], w5)

    # ── 8. Challenges ──
    pdf.add_page()
    pdf.section_title("8. Technical Challenges Solved")

    pdf.sub_title("Alpine Linux vs glibc")
    pdf.body_text(
        "The initial Docker image (node:20-alpine) caused crashes because @xenova/transformers "
        "depends on onnxruntime-node, which requires glibc. Alpine Linux uses musl instead. "
        "Resolved by switching to node:20-slim (Debian-based), which provides glibc."
    )

    pdf.sub_title("ChromaDB Client Architecture")
    pdf.body_text(
        "The ChromaDB JavaScript client is HTTP-only and cannot run as an in-process database "
        "(unlike the Python client). This required adding ChromaDB as a separate Docker service "
        "and connecting via the internal Docker network (http://chromadb:8000)."
    )

    pdf.sub_title("Embedding Function Requirements")
    pdf.body_text(
        "ChromaDB's JS client demands an embedding function (chromadb-default-embed) when using "
        "document-based add/query operations. This package also pulled in onnxruntime and caused "
        "the same Alpine crashes. Resolved by computing embeddings independently via "
        "@xenova/transformers and passing pre-computed embedding vectors directly to ChromaDB."
    )

    pdf.sub_title("LM Studio Embedding Limitations")
    pdf.body_text(
        "An attempt to use LM Studio's /v1/embeddings endpoint failed because the GGUF-format "
        "embedding model could not be loaded by LM Studio's runtime. This confirmed that local "
        "embedding via @xenova/transformers was the correct approach."
    )

    # ── 9. Python RAG App ──
    pdf.add_page()
    pdf.section_title("9. Python RAG Application (Prototype)")
    pdf.body_text(
        "Before integrating into the webstack, a standalone Python RAG application was built "
        "as a prototype at /Users/ericfrayer/Development/rag_app_01/. This served as the proof "
        "of concept and informed the architecture of the Node.js implementation."
    )

    pdf.sub_title("Stack")
    pdf.bullet("LangGraph StateGraph for the retrieve-then-generate pipeline")
    pdf.bullet("LangChain ChatOpenAI class pointed at LM Studio (OpenAI-compatible API)")
    pdf.bullet("ChromaDB (in-process persistent) for vector storage")
    pdf.bullet("sentence-transformers / all-MiniLM-L6-v2 for embeddings")
    pdf.bullet("FastAPI web interface for upload and chat")

    pdf.sub_title("Key Files")
    w6 = [50, 125]
    pdf.table_row(["File", "Purpose"], w6, bold=True, fill=True)
    pdf.table_row(["app/config.py", "Central configuration (LM Studio URL, model, params)"], w6)
    pdf.table_row(["app/ingest.py", "PDF ingestion with incremental processing via manifest"], w6)
    pdf.table_row(["app/graph.py", "LangGraph RAG pipeline (retrieve -> generate)"], w6)
    pdf.table_row(["app/main.py", "CLI entry point for interactive queries"], w6)
    pdf.table_row(["app/api.py", "FastAPI web interface"], w6)

    pdf.ln(3)
    pdf.body_text(
        "The Python app features incremental ingestion: a manifest file (ingested_manifest.json) "
        "tracks which files have been processed and their modification times, so only new or "
        "changed files are re-ingested on subsequent runs."
    )

    # ── 10. Summary ──
    pdf.add_page()
    pdf.section_title("10. Summary")
    pdf.body_text(
        "This project successfully integrates a complete RAG pipeline into an existing production "
        "webstack, enabling document-grounded Q&A through the chat interface. The entire system "
        "runs locally with no external API dependencies for embeddings or vector storage."
    )
    pdf.ln(2)
    pdf.body_text("Key outcomes:")
    pdf.bullet("Four document formats supported: PDF, DOCX, CSV, and TXT")
    pdf.bullet("Local embeddings via all-MiniLM-L6-v2 (no API calls, no data leaves the network)")
    pdf.bullet("Persistent vector storage in ChromaDB survives container restarts")
    pdf.bullet("Seamless integration with existing chat UI (toggle on/off, mutually exclusive with web search)")
    pdf.bullet("Dedicated admin page for document lifecycle management")
    pdf.bullet("All existing features preserved: streaming, memory, web search, themes")
    pdf.ln(4)
    pdf.set_draw_color(76, 110, 245)
    pdf.set_line_width(0.5)
    mid = pdf.w / 2
    pdf.line(mid - 30, pdf.get_y(), mid + 30, pdf.get_y())
    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 10)
    pdf.set_text_color(120, 120, 120)
    pdf.cell(0, 8, "Document generated with Claude Code", align="C")

    # ── Output ──
    out = "/Users/ericfrayer/Development/rag_app_01/RAG_Integration_Report.pdf"
    pdf.output(out)
    print(f"PDF saved to: {out}")


if __name__ == "__main__":
    build()
