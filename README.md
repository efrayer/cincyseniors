# CincySeniors.org — Open Source Senior Services Platform

A full-stack web platform built for **CincySeniors.org**, designed to help older adults in the Greater Cincinnati area find senior services, get answers from an AI assistant, and connect with their community.

Built to be **free and reusable** — any non-profit serving seniors (or any community) can fork this and adapt it to their own region.

---

## What's Included

| Layer | Technology | Purpose |
|---|---|---|
| **Static site** | HTML / CSS / JS | Public-facing pages (home, resources, news, health, etc.) |
| **AI assistant (Cindy)** | Python / FastAPI / ChromaDB / OpenAI | RAG-powered chat with text-to-speech |
| **Reverse proxy** | Caddy | HTTPS termination, routing, security headers, basicauth |
| **Node backend** | Node.js / Express | Signups, feedback forms, notes |
| **Vector database** | ChromaDB | Stores and retrieves knowledge base documents |
| **Infrastructure** | Docker Compose | Runs Caddy, Node, and ChromaDB as containers |

---

## Architecture

```
Internet (HTTPS via Cloudflare)
        │
        ▼
  Caddy (port 80)
  ├── /cindy/chat, /cindy/tts, etc.  → FastAPI (Python, port 8000, runs on host)
  ├── /cindy/admin/*, /cindy/chat-log/*, /cindy/rag-admin/*  → Static (basicauth protected)
  ├── /chat*, /api/*  → Node.js / Express (port 3000, Docker)
  └── everything else  → Static HTML files (cincyseniors/)

FastAPI
  ├── RAG pipeline: ChromaDB + HuggingFace embeddings + OpenAI/LM Studio LLM
  ├── Text-to-speech: OpenAI TTS API
  ├── Admin API: API-key protected write endpoints
  └── Chat logger: SQLite database

ChromaDB (Docker)
  └── Stores document chunks for semantic search
```

### Key Design Decisions

- **No framework dependencies on the frontend** — pure HTML/CSS/JS for maximum accessibility and simplicity. Senior users benefit from fast, simple pages.
- **RAG over fine-tuning** — local knowledge (senior services directory, FAQs) is stored in ChromaDB and retrieved at query time. No model training required.
- **OpenAI TTS with fallback** — voice responses use OpenAI's `gpt-4o-mini-tts` model with a warm, calm persona. Falls back to browser Web Speech API if preferred (free, no API key needed).
- **Caddy for everything security** — security headers, basicauth on admin pages, and access logging all live in one `Caddyfile`.

---

## Repository Structure

```
webstack/
├── Caddyfile                   # Reverse proxy config (routing + security headers + basicauth)
├── docker-compose.yml          # Caddy + Node + ChromaDB containers
├── cincyseniors/               # Static website (served by Caddy)
│   ├── index.html              # Homepage
│   ├── favicon.svg             # Site favicon
│   ├── health/                 # Health resources section
│   ├── learn/                  # Learning resources section
│   ├── news/                   # News section
│   ├── resources/              # Senior services directory (public)
│   ├── wealth/                 # Financial resources section
│   ├── signups/                # Event signup pages
│   ├── feedback/               # Feedback form
│   └── cindy/                  # AI assistant
│       ├── index.html          # Cindy chat interface
│       ├── about/              # About Cindy page
│       ├── admin/              # Admin console (password protected)
│       │   ├── index.html      # Admin landing page
│       │   ├── directory/      # Directory enrichment tool
│       │   └── traffic/        # Site traffic analytics
│       ├── chat-log/           # Chat log viewer (password protected)
│       └── rag-admin/          # RAG knowledge base manager (password protected)
├── app/                        # Node.js backend
│   ├── server.js               # Express server (signups, feedback, notes)
│   └── public/                 # Static assets for Node app
└── rag_app_01/                 # Python FastAPI RAG backend
    ├── app/
    │   ├── api.py              # FastAPI routes (chat, TTS, admin, directory, traffic)
    │   ├── config.py           # Configuration (reads from .env)
    │   ├── graph.py            # LangGraph RAG pipeline
    │   ├── ingest.py           # Document ingestion into ChromaDB
    │   ├── chat_logger.py      # SQLite chat log
    │   └── main.py             # CLI entrypoint
    ├── start.sh                # Startup script (loads .env, starts uvicorn)
    ├── requirements.txt        # Python dependencies
    └── .env.example            # Template for required environment variables
```

---

## Admin Pages

Three password-protected admin interfaces are included, all accessible via `/cindy/admin/`:

| Page | Path | Purpose |
|---|---|---|
| **Admin Console** | `/cindy/admin/` | Landing page with links to all admin tools |
| **Site Traffic** | `/cindy/admin/traffic/` | Web analytics dashboard (parsed from Caddy access logs) |
| **Directory Admin** | `/cindy/admin/directory/` | Enrich senior services directory entries |
| **RAG Admin** | `/cindy/rag-admin/` | Upload documents / manage knowledge base |
| **Chat Log** | `/cindy/chat-log/` | Review AI conversation history |

All admin pages are protected by both:
1. **Caddy HTTP Basic Auth** — browser login prompt (server-side)
2. **API key header** (`X-Admin-Key`) — required on all write API calls

---

## Security Features

- **API key authentication** on all write/admin FastAPI endpoints
- **Caddy HTTP Basic Auth** on all admin static pages (server-side — not bypassable client-side)
- **Rate limiting** via `slowapi`: chat (10/min), TTS (20/min), public endpoints (30/min)
- **HTML escaping** on all user-supplied input before storage in ChromaDB
- **Security headers** on every response: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- **HTTPS** enforced via Cloudflare (set "Always Use HTTPS" in Cloudflare dashboard)

---

## Setup Guide

### Prerequisites

- Docker + Docker Compose
- Python 3.11+
- Node.js 20+
- A Cloudflare account (free tier) pointing to your server
- An OpenAI API key (for TTS; chat can use a local LLM)

### 1. Clone the repository

```bash
git clone https://github.com/ericfrayer/cincyseniors.git
cd cincyseniors
```

### 2. Configure environment variables

```bash
cd rag_app_01
cp .env.example .env
```

Edit `.env` and fill in your values:

```env
OPENAI_API_KEY=sk-...          # Required for TTS
ADMIN_API_KEY=<64-hex-chars>   # Generate with: python -c "import secrets; print(secrets.token_hex(32))"
TTS_ENGINE=openai
TTS_VOICE=nova
TTS_MODEL=gpt-4o-mini-tts
```

### 3. Set the admin API key in the frontend

Replace `YOUR_ADMIN_API_KEY_HERE` with your actual `ADMIN_API_KEY` value in these files:

```
cincyseniors/cindy/rag-admin/index.html
cincyseniors/cindy/admin/traffic/index.html
cincyseniors/cindy/admin/directory/index.html
cincyseniors/cindy/chat-log/index.html
```

### 4. Set up Caddy basic auth

Generate a bcrypt hash for your admin password:

```bash
# After starting Docker:
docker exec caddy caddy hash-password --plaintext 'your-password-here'
```

Add the hash to `docker-compose.yml`:

```yaml
environment:
  - CADDY_ADMIN_HASH=$$2a$$14$$<rest-of-your-hash>
```

> **Note:** Every `$` in the bcrypt hash must be doubled (`$$`) to prevent Docker Compose from treating it as a variable.

### 5. Start the infrastructure

```bash
# Start Caddy, Node.js, and ChromaDB
cd webstack
docker compose up -d
```

### 6. Start the Python backend

```bash
cd rag_app_01
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
bash start.sh web
```

### 7. Ingest your knowledge base

Upload documents via the RAG Admin page at `/cindy/rag-admin/`, or place PDFs in `rag_app_01/data_cincyseniors/` and restart the Python server (auto-ingested on startup).

---

## Adapting for Your Non-Profit

This platform is designed to be forked and reused. Here's what to customize:

| What to change | Where |
|---|---|
| Organization name, colors, content | `cincyseniors/index.html` and all section pages |
| AI assistant name and persona | `cincyseniors/cindy/index.html` (change "Cindy" throughout) |
| TTS voice and speaking style | `ADMIN_API_KEY` in `.env` → `TTS_INSTRUCTIONS` |
| Knowledge base content | Upload via RAG Admin or drop PDFs in `data_cincyseniors/` |
| Domain name | `Caddyfile` (replace `cincyseniors.org`) |
| Branding colors | CSS variables in each page's `<style>` block |

### Running fully offline (no OpenAI)

Set `TTS_ENGINE=browser` in `.env` to use the browser's built-in Web Speech API (free). For the LLM, point `LLM_BASE_URL` to a local [LM Studio](https://lmstudio.ai) instance running a model like Llama 3 or Mistral.

---

## Local Development

```bash
# Watch the site locally (no Docker needed for static pages)
cd cincyseniors
python -m http.server 8080

# Run Python backend in dev mode
cd rag_app_01
source venv/bin/activate
bash start.sh web
```

---

## License

MIT License — free to use, modify, and distribute. Attribution appreciated but not required.

If you build something with this for your community, we'd love to hear about it!

---

*Built with care for Cincinnati's senior community. Questions? Open an issue or reach out via [CincySeniors.org](https://www.cincyseniors.org).*
