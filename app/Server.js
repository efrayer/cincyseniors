require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const nodemailer = require("nodemailer");
const rag = require("./rag");

const app = express();

// File upload config for RAG documents
const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".csv", ".txt"]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Allowed: PDF, DOCX, CSV, TXT"));
    }
  },
});

// Public-safety defaults
const MAX_JSON_BODY = "64kb";
const MAX_MESSAGE_CHARS = 4000;
const DEFAULT_TEMP = 0.7;
const LLM_TIMEOUT_MS = 60_000; // 60 seconds

// Parse JSON with a size limit
app.use(express.json({ limit: MAX_JSON_BODY }));

// Parse URL-encoded form bodies (standard HTML form POST)
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

// Serve static files (chat UI assets)
app.use(express.static(path.join(__dirname, "public")));

// ──────────────────────────────────────────────
//  SerpAPI Web Search Helper
// ──────────────────────────────────────────────

const SEARCH_PROVIDER = process.env.SEARCH_PROVIDER || "serpapi";
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY || "";
const SERPAPI_ENGINE = process.env.SERPAPI_ENGINE || "google";

/**
 * Search Google via SerpAPI.
 * Returns an array of { title, url, snippet } objects.
 */
async function searchWeb(query, numResults = 5) {
  if (!SERPAPI_API_KEY) {
    console.warn("[search] SERPAPI_API_KEY is not set – skipping web search");
    return [];
  }

  const params = new URLSearchParams({
    q: query,
    engine: SERPAPI_ENGINE,
    api_key: SERPAPI_API_KEY,
    num: String(numResults),
  });

  const url = `https://serpapi.com/search.json?${params}`;
  console.log(`[search] Querying SerpAPI: "${query}" (${numResults} results)`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error(`[search] SerpAPI error HTTP ${r.status}: ${text}`);
      return [];
    }

    const data = await r.json();
    const organic = data.organic_results || [];

    return organic.slice(0, numResults).map((item) => ({
      title: item.title || "",
      url: item.link || "",
      snippet: item.snippet || "",
    }));
  } catch (err) {
    console.error("[search] SerpAPI request failed:", err.message);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Build a context block from search results that can be injected
 * into the LLM system/user prompt.
 */
function buildSearchContext(results) {
  if (!results || results.length === 0) return "";

  const lines = results.map(
    (r, i) =>
      `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.snippet}`
  );

  return (
    "Here are relevant web search results. Use them to inform your answer, " +
    "and cite sources by number when appropriate:\n\n" +
    lines.join("\n\n")
  );
}

// ──────────────────────────────────────────────
//  Helper: get LM Studio base URL
// ──────────────────────────────────────────────

function getLmBase() {
  return process.env.LMSTUDIO_BASE_URL || "http://host.docker.internal:1234";
}

// ──────────────────────────────────────────────
//  Routes
// ──────────────────────────────────────────────

// Simple health check
app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// Nice default: go to the chat UI
app.get("/", (req, res) => res.redirect("/chat"));

// Serve the chat UI
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// Serve the advanced chat UI
app.get("/chat-advanced", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat-advanced.html"));
});

// ──────────────────────────────────────────────
//  Standalone search endpoint
// ──────────────────────────────────────────────

app.post("/api/search", async (req, res) => {
  try {
    const { query, num } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }
    const results = await searchWeb(query.trim(), Number(num) || 5);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ──────────────────────────────────────────────
//  /api/chat  –  search-augmented chat endpoint
//  Supports: forceSearch, useMemory, messages history
// ──────────────────────────────────────────────

app.post("/api/chat", async (req, res) => {
  const started = Date.now();

  try {
    const {
      message,
      messages: incomingMessages,
      model,
      system,
      temperature,
      forceSearch,
      useMemory,
      useRag,
      sessionId,
    } = req.body || {};

    // Accept either a single message string or a messages array
    const userMessage =
      typeof message === "string" ? message.trim() : null;

    if (!userMessage && (!Array.isArray(incomingMessages) || incomingMessages.length === 0)) {
      return res.status(400).json({ error: "message or messages[] is required" });
    }
    if (userMessage && userMessage.length > MAX_MESSAGE_CHARS) {
      return res
        .status(413)
        .json({ error: `message must be <= ${MAX_MESSAGE_CHARS} characters` });
    }

    const temp =
      typeof temperature === "number" && Number.isFinite(temperature)
        ? temperature
        : DEFAULT_TEMP;

    // ── Step 1: Web search (if requested) ──
    let searchResults = [];
    let searchContext = "";

    if (forceSearch) {
      const searchQuery = userMessage ||
        (incomingMessages && incomingMessages.filter(m => m.role === "user").pop()?.content) ||
        "";
      if (searchQuery) {
        searchResults = await searchWeb(searchQuery, 5);
        searchContext = buildSearchContext(searchResults);
      }
    }

    // ── Step 1.5: RAG retrieval (if requested, and search not active) ──
    let ragResults = [];
    let ragContext = "";

    if (useRag && !forceSearch) {
      const ragQuery = userMessage ||
        (incomingMessages && incomingMessages.filter(m => m.role === "user").pop()?.content) ||
        "";
      if (ragQuery) {
        try {
          ragResults = await rag.retrieveContext(ragQuery);
          ragContext = rag.buildRagContext(ragResults);
        } catch (err) {
          console.error("[RAG] Retrieval error:", err);
        }
      }
    }

    // ── Step 2: Build messages for LM Studio ──
    const llmMessages = [];

    // System prompt (with optional search or RAG context injected)
    const baseSystem = system || "You are a helpful assistant.";
    const contextToInject = searchContext || ragContext;
    const fullSystem = contextToInject
      ? `${baseSystem}\n\n---\n\n${contextToInject}`
      : baseSystem;
    llmMessages.push({ role: "system", content: fullSystem });

    // Conversation history (if provided as messages array)
    if (Array.isArray(incomingMessages) && incomingMessages.length > 0) {
      // Filter out any system messages (we already built our own)
      const historyMsgs = incomingMessages.filter((m) => m.role !== "system");
      llmMessages.push(...historyMsgs);
    }

    // Current user message (if provided as standalone string)
    if (userMessage && !Array.isArray(incomingMessages)) {
      llmMessages.push({ role: "user", content: userMessage });
    }

    // ── Step 3: Call LM Studio ──
    const lmBase = getLmBase();
    const url = `${lmBase}/v1/chat/completions`;

    const payload = {
      model: (model || "").trim() || undefined,
      messages: llmMessages,
      temperature: temp,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const json = await r.json().catch(() => null);
    if (!r.ok) {
      const detail =
        json?.error?.message ||
        json?.error ||
        `LM Studio error (HTTP ${r.status})`;
      return res.status(502).json({ error: String(detail) });
    }

    // Normalize reply
    const reply =
      json?.choices?.[0]?.message?.content ??
      json?.choices?.[0]?.text ??
      "";

    const ms = Date.now() - started;
    console.log(
      `[api/chat] ${r.status} ${ms}ms search=${!!forceSearch} rag=${!!(useRag && !forceSearch)} results=${searchResults.length + ragResults.length}`
    );

    // ── Step 4: Return response ──
    const ragSources = ragResults.map((r) => ({
      title: `${r.metadata.filename} (chunk ${r.metadata.chunkIndex + 1}/${r.metadata.totalChunks})`,
      url: null,
      snippet: r.text.substring(0, 200) + (r.text.length > 200 ? "..." : ""),
    }));

    res.json({
      reply,
      sources: searchResults.length > 0 ? searchResults : ragSources,
      model: json?.model || payload.model || "",
      usage: json?.usage || null,
      metrics: {
        totalDurationMs: ms,
        searchResults: searchResults.length,
        ragResults: ragResults.length,
        searchUsed: !!forceSearch,
        ragUsed: !!(useRag && !forceSearch),
      },
      sessionId: sessionId || null,
    });
  } catch (err) {
    const msg = String(err || "");
    if (msg.includes("AbortError")) {
      return res.status(504).json({ error: "LM Studio timed out" });
    }
    res.status(500).json({ error: msg });
  }
});

// ──────────────────────────────────────────────
//  /api/session/new  –  generate a new session ID
// ──────────────────────────────────────────────

app.post("/api/session/new", (req, res) => {
  const sessionId =
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  res.json({ sessionId });
});

// ──────────────────────────────────────────────
//  List available models
// ──────────────────────────────────────────────

app.get("/api/models", async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let r;
    try {
      r = await fetch(`${getLmBase()}/v1/models`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!r.ok)
      return res
        .status(502)
        .json({ error: `LM Studio error (HTTP ${r.status})` });
    const json = await r.json();
    res.json(json);
  } catch (err) {
    res.status(502).json({ error: "Cannot reach LM Studio" });
  }
});

// ──────────────────────────────────────────────
//  OpenAI-compatible chat completions proxy (supports streaming)
// ──────────────────────────────────────────────

app.post("/api/v1/chat/completions", async (req, res) => {
  const started = Date.now();
  try {
    const body = req.body || {};
    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    let r;
    try {
      r = await fetch(`${getLmBase()}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!r.ok) {
      const errJson = await r.json().catch(() => null);
      const detail =
        errJson?.error?.message ||
        errJson?.error ||
        `LM Studio error (HTTP ${r.status})`;
      return res.status(502).json({ error: String(detail) });
    }

    // If streaming, pipe the SSE response through
    if (body.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const reader = r.body.getReader();
      const push = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              res.end();
              return;
            }
            res.write(Buffer.from(value));
          }
        } catch (e) {
          res.end();
        }
      };
      push();

      req.on("close", () => {
        try {
          reader.cancel();
        } catch {}
      });
      return;
    }

    // Non-streaming: forward JSON response
    const json = await r.json();
    const ms = Date.now() - started;
    console.log(
      `[api/v1/chat/completions] ${r.status} ${ms}ms model=${body.model}`
    );
    res.json(json);
  } catch (err) {
    const msg = String(err || "");
    if (msg.includes("AbortError")) {
      return res.status(504).json({ error: "LM Studio timed out" });
    }
    res.status(500).json({ error: msg });
  }
});

// ──────────────────────────────────────────────
//  RAG Document Management
// ──────────────────────────────────────────────

app.get("/rag-admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "rag-admin.html"));
});

app.post("/api/rag/documents", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const result = await rag.ingestDocument(req.file.buffer, req.file.originalname);
    res.status(201).json(result);
  } catch (err) {
    console.error("[RAG] Upload error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/rag/documents", async (req, res) => {
  try {
    const docs = await rag.listDocuments();
    res.json({ documents: docs });
  } catch (err) {
    console.error("[RAG] List error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete("/api/rag/documents/:id", async (req, res) => {
  try {
    const deletedCount = await rag.deleteByDocumentId(req.params.id);
    if (deletedCount === 0) {
      return res.status(404).json({ error: "Document not found" });
    }
    res.json({ success: true, deletedChunks: deletedCount });
  } catch (err) {
    console.error("[RAG] Delete error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ──────────────────────────────────────────────
//  Eric's Notes — Bookmark API
//  Data stored in notes.json alongside server.js
// ──────────────────────────────────────────────

const NOTES_FILE = path.join(__dirname, "notes.json");

const NOTES_DEFAULT_CATEGORIES = {
  Claude: "#8B5CF6",
  AI: "#3B82F6",
  BI: "#10B981",
  Azure: "#0078D4",
  Local: "#F59E0B",
};

function loadNotes() {
  try {
    if (!fs.existsSync(NOTES_FILE)) {
      return { bookmarks: [], categories: NOTES_DEFAULT_CATEGORIES };
    }
    const data = JSON.parse(fs.readFileSync(NOTES_FILE, "utf8"));
    if (!data.categories) data.categories = NOTES_DEFAULT_CATEGORIES;
    return data;
  } catch {
    return { bookmarks: [], categories: NOTES_DEFAULT_CATEGORIES };
  }
}

function saveNotes(data) {
  fs.writeFileSync(NOTES_FILE, JSON.stringify(data, null, 2), "utf8");
}

app.get("/api/notes/bookmarks", (req, res) => {
  const data = loadNotes();
  let { bookmarks, categories } = data;
  const { category, search } = req.query;

  if (category && category !== "All") {
    bookmarks = bookmarks.filter((b) => b.category === category);
  }
  if (search) {
    const s = search.toLowerCase();
    bookmarks = bookmarks.filter(
      (b) =>
        (b.url || "").toLowerCase().includes(s) ||
        (b.note || "").toLowerCase().includes(s) ||
        (b.category || "").toLowerCase().includes(s)
    );
  }

  res.json({ bookmarks, categories });
});

app.post("/api/notes/bookmarks", (req, res) => {
  const data = loadNotes();
  const body = req.body || {};

  if (!body.url) return res.status(400).json({ error: "URL is required" });

  let url = body.url.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const bookmark = {
    id: Date.now(),
    url,
    note: (body.note || "").trim(),
    category: body.category || "Uncategorized",
    date_added: new Date().toISOString(),
  };

  data.bookmarks.unshift(bookmark);
  saveNotes(data);
  res.status(201).json(bookmark);
});

app.put("/api/notes/bookmarks/:id", (req, res) => {
  const data = loadNotes();
  const id = parseInt(req.params.id);
  const body = req.body || {};
  const idx = data.bookmarks.findIndex((b) => b.id === id);

  if (idx === -1) return res.status(404).json({ error: "Bookmark not found" });

  if ("url" in body) {
    let url = body.url.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    data.bookmarks[idx].url = url;
  }
  if ("note" in body) data.bookmarks[idx].note = body.note.trim();
  if ("category" in body) data.bookmarks[idx].category = body.category;

  saveNotes(data);
  res.json(data.bookmarks[idx]);
});

app.delete("/api/notes/bookmarks/:id", (req, res) => {
  const data = loadNotes();
  const id = parseInt(req.params.id);
  const before = data.bookmarks.length;

  data.bookmarks = data.bookmarks.filter((b) => b.id !== id);

  if (data.bookmarks.length === before) {
    return res.status(404).json({ error: "Bookmark not found" });
  }

  saveNotes(data);
  res.json({ success: true });
});

app.get("/api/notes/categories", (req, res) => {
  res.json(loadNotes().categories);
});

app.post("/api/notes/categories", (req, res) => {
  const data = loadNotes();
  const body = req.body || {};
  const name = (body.name || "").trim();
  const color = body.color || "#6B7280";

  if (!name) return res.status(400).json({ error: "Category name is required" });

  data.categories[name] = color;
  saveNotes(data);
  res.json(data.categories);
});

// ──────────────────────────────────────────────
//  CincySeniors Signup Form Handler
// ──────────────────────────────────────────────

// Nodemailer transporter (created once, reused)
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
});

const SIGNUP_TO = process.env.SIGNUP_TO || "info@cincyseniors.org";
const SIGNUPS_FILE = path.join(__dirname, "signups.json");

// Append one signup record to signups.json
function logSignup(formType, fields) {
  try {
    let records = [];
    if (fs.existsSync(SIGNUPS_FILE)) {
      records = JSON.parse(fs.readFileSync(SIGNUPS_FILE, "utf8"));
    }
    const record = { id: Date.now(), form_type: formType, submitted_at: new Date().toISOString() };
    for (const [key, val] of Object.entries(fields)) {
      if (key !== "_gotcha" && val) record[key] = val;
    }
    records.push(record);
    fs.writeFileSync(SIGNUPS_FILE, JSON.stringify(records, null, 2), "utf8");
  } catch (err) {
    console.error("[signup] Failed to write log:", err.message);
  }
}

// Build a plain-text email body from form fields
function formatSignupEmail(formType, fields) {
  const formLabels = {
    newsletter: "Newsletter Signup",
    volunteer: "Volunteer Application",
    townhall: "Town Hall Event Signup",
    smallgroup: "Small Group Session Signup",
  };
  const label = formLabels[formType] || formType;

  const lines = [`CincySeniors.org — New ${label}`, "=".repeat(50), ""];
  for (const [key, val] of Object.entries(fields)) {
    if (key === "form_type" || !val) continue;
    const fieldLabel = key
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(`${fieldLabel}: ${val}`);
  }
  lines.push("", "-".repeat(50));
  lines.push(`Submitted: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`);
  return lines.join("\n");
}

app.post("/api/signup", async (req, res) => {
  const body = req.body || {};
  const formType = (body.form_type || "unknown").toLowerCase().trim();

  // Basic honeypot — if _gotcha is filled a bot submitted this
  if (body._gotcha) {
    return res.redirect("/signups/thankyou.html");
  }

  // Require at least a name or email
  if (!body.name && !body.email) {
    return res.redirect("/signups/?error=missing-fields");
  }

  try {
    await mailer.sendMail({
      from: `"CincySeniors Signups" <${process.env.SMTP_USER}>`,
      to: SIGNUP_TO,
      subject: `[CincySeniors] New ${formType} signup — ${body.name || body.email}`,
      text: formatSignupEmail(formType, body),
    });

    logSignup(formType, body);
    console.log(`[signup] ${formType} from ${body.email || body.name}`);
    res.redirect("/signups/thankyou.html");
  } catch (err) {
    console.error("[signup] Email send failed:", err.message);
    res.redirect("/signups/?error=send-failed");
  }
});

// ──────────────────────────────────────────────
//  CincySeniors Signup Log Viewer
//  GET /api/signups          → JSON array of all submissions
//  GET /api/signups?form=newsletter  → filter by form type
// ──────────────────────────────────────────────

app.get("/api/signups", (req, res) => {
  try {
    let records = fs.existsSync(SIGNUPS_FILE)
      ? JSON.parse(fs.readFileSync(SIGNUPS_FILE, "utf8"))
      : [];
    if (req.query.form) {
      records = records.filter((r) => r.form_type === req.query.form);
    }
    res.json({ total: records.length, signups: records });
  } catch (err) {
    res.status(500).json({ error: "Could not read signup log" });
  }
});

// ──────────────────────────────────────────────
//  CincySeniors Feedback
//  POST /api/feedback  → appends record to feedback.json
//  GET  /api/feedback  → returns all records
// ──────────────────────────────────────────────

const FEEDBACK_FILE = path.join(__dirname, "feedback.json");

app.post("/api/feedback", (req, res) => {
  try {
    const { q_helpful, q_ease, q_recommend, q_comments } = req.body;
    const record = {
      id: Date.now(),
      submitted_at: new Date().toISOString(),
      q_helpful: q_helpful ? Number(q_helpful) : null,
      q_ease: q_ease ? Number(q_ease) : null,
      q_recommend: q_recommend ? Number(q_recommend) : null,
      q_comments: q_comments || "",
    };
    let records = [];
    if (fs.existsSync(FEEDBACK_FILE)) {
      records = JSON.parse(fs.readFileSync(FEEDBACK_FILE, "utf8"));
    }
    records.push(record);
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(records, null, 2), "utf8");
    res.json({ ok: true });
  } catch (err) {
    console.error("[feedback] Write failed:", err.message);
    res.status(500).json({ error: "Could not save feedback" });
  }
});

app.get("/api/feedback", (req, res) => {
  try {
    const records = fs.existsSync(FEEDBACK_FILE)
      ? JSON.parse(fs.readFileSync(FEEDBACK_FILE, "utf8"))
      : [];
    res.json({ total: records.length, feedback: records });
  } catch (err) {
    res.status(500).json({ error: "Could not read feedback log" });
  }
});

// ──────────────────────────────────────────────
//  Start server
// ──────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Search provider: ${SEARCH_PROVIDER}`);
  console.log(`SerpAPI key: ${SERPAPI_API_KEY ? "configured" : "NOT SET"}`);
  console.log(`SerpAPI engine: ${SERPAPI_ENGINE}`);
  console.log(`LM Studio: ${getLmBase()}`);

  // Initialize RAG system (non-blocking)
  rag.initialize().catch((err) => {
    console.warn("[RAG] Init failed (RAG features disabled):", err.message);
  });
});
