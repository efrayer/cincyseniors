import os
from pathlib import Path

# Paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
CHROMA_DIR = PROJECT_ROOT / "chroma_store"

# CincySeniors-specific RAG
CINDY_DATA_DIR = PROJECT_ROOT / "data_cincyseniors"
CINDY_COLLECTION = "cincyseniors"
CINDY_MANIFEST_PATH = CHROMA_DIR / "ingested_manifest_cincyseniors.json"

# LM Studio
LLM_BASE_URL = "http://192.168.68.69:1234/v1"
LLM_API_KEY = "lm-studio"

# Embeddings
EMBEDDING_MODEL = "all-MiniLM-L6-v2"

# Chunking
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200

# Retrieval
RETRIEVAL_K = 4

# ── Text-to-Speech ────────────────────────────────────────────────────────────
# Set TTS_ENGINE to "openai" to use OpenAI TTS, or "browser" to use the
# browser's built-in Web Speech API (free, no API key required).
TTS_ENGINE = os.environ.get("TTS_ENGINE", "openai")

# OpenAI TTS settings (only used when TTS_ENGINE = "openai")
# Set the OPENAI_API_KEY environment variable on your server — do not hard-code it here.
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

# Voice options: alloy | echo | fable | onyx | nova | shimmer
# "nova" and "shimmer" are the most natural-sounding for conversation.
TTS_VOICE = os.environ.get("TTS_VOICE", "nova")

# Model: "gpt-4o-mini-tts" supports voice instructions (calm, warm, etc.)
# "tts-1-hd" is higher quality but does not support instructions.
TTS_MODEL = os.environ.get("TTS_MODEL", "gpt-4o-mini-tts")

# Style instructions — only applied when using gpt-4o-mini-tts.
# Describe the speaking style you want. Keep it concise.
TTS_INSTRUCTIONS = os.environ.get(
    "TTS_INSTRUCTIONS",
    "Speak in a calm, warm, and reassuring tone. "
    "Be clear and gentle — like a friendly community guide helping an older adult. "
    "Take your time and speak naturally.",
)

# ── Admin API key ─────────────────────────────────────────────────────────────
# Required header on all admin/write endpoints: X-Admin-Key: <value>
ADMIN_API_KEY = os.environ.get("ADMIN_API_KEY", "")
