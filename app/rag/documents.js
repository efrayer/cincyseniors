/**
 * Document ingestion — text extraction, chunking, embedding, storage.
 * Supports PDF, DOCX, CSV, and plain text files.
 */

const crypto = require("crypto");
const { embedBatch } = require("./embeddings");
const { addDocuments } = require("./vectorstore");

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

/**
 * Split text into overlapping chunks.
 */
function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    start += size - overlap;
  }
  return chunks;
}

/**
 * Core ingestion — takes extracted text, chunks/embeds/stores it.
 */
async function ingestText(fullText, filename, extraMeta = {}) {
  if (!fullText.trim()) {
    throw new Error("Document contains no extractable text");
  }

  const chunks = chunkText(fullText);
  console.log(`[RAG] Split into ${chunks.length} chunks`);

  console.log(`[RAG] Embedding ${chunks.length} chunks...`);
  const embeddings = await embedBatch(chunks);

  const documentId = crypto.randomUUID();
  const now = new Date().toISOString();

  const docs = chunks.map((text, i) => ({
    id: `${documentId}_chunk_${i}`,
    text,
    embedding: embeddings[i],
    metadata: {
      documentId,
      filename,
      chunkIndex: i,
      totalChunks: chunks.length,
      uploadedAt: now,
      ...extraMeta,
    },
  }));

  await addDocuments(docs);
  console.log(
    `[RAG] Ingested ${filename} → ${documentId} (${chunks.length} chunks)`
  );

  return {
    documentId,
    filename,
    chunks: chunks.length,
    uploadedAt: now,
    ...extraMeta,
  };
}

// ── Format-specific extractors ──

async function extractPDF(buffer) {
  const pdfParse = require("pdf-parse");
  const pdfData = await pdfParse(buffer);
  console.log(
    `[RAG] Extracted ${pdfData.text.length} chars from ${pdfData.numpages} pages`
  );
  return { text: pdfData.text, meta: { pageCount: pdfData.numpages } };
}

async function extractDOCX(buffer) {
  const mammoth = require("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  console.log(`[RAG] Extracted ${result.value.length} chars from DOCX`);
  return { text: result.value, meta: {} };
}

function extractTXT(buffer) {
  const text = buffer.toString("utf-8");
  console.log(`[RAG] Read ${text.length} chars from text file`);
  return { text, meta: {} };
}

function extractCSV(buffer) {
  const raw = buffer.toString("utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());

  if (lines.length < 2) {
    return { text: raw, meta: { rowCount: lines.length } };
  }

  // Parse header row
  const headers = parseCSVLine(lines[0]);

  // Convert each data row to "Header: value" format
  const textRows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const parts = headers.map(
      (h, idx) => `${h}: ${(values[idx] || "").trim()}`
    );
    textRows.push(parts.join(", "));
  }

  const text = textRows.join("\n");
  console.log(
    `[RAG] Parsed CSV: ${headers.length} columns, ${textRows.length} rows (${text.length} chars)`
  );
  return { text, meta: { rowCount: textRows.length, columns: headers.length } };
}

/**
 * Simple CSV line parser that handles quoted fields.
 */
function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

// ── Extension → extractor mapping ──

const EXTRACTORS = {
  ".pdf": extractPDF,
  ".docx": extractDOCX,
  ".txt": extractTXT,
  ".csv": extractCSV,
};

const SUPPORTED_EXTENSIONS = Object.keys(EXTRACTORS);

/**
 * Ingest any supported document type.
 */
async function ingestDocument(buffer, filename) {
  const ext = (filename.match(/\.[^.]+$/) || [""])[0].toLowerCase();

  if (!EXTRACTORS[ext]) {
    throw new Error(
      `Unsupported file type: ${ext || "(none)"}. Supported: ${SUPPORTED_EXTENSIONS.join(", ")}`
    );
  }

  console.log(`[RAG] Processing ${ext.toUpperCase().slice(1)}: ${filename}`);
  const { text, meta } = await EXTRACTORS[ext](buffer);
  return ingestText(text, filename, meta);
}

/**
 * Keep backward compatibility — ingestPDF still works.
 */
async function ingestPDF(buffer, filename) {
  return ingestDocument(buffer, filename);
}

module.exports = { ingestDocument, ingestPDF, SUPPORTED_EXTENSIONS };
