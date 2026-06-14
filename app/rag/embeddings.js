/**
 * Local embeddings using @xenova/transformers (all-MiniLM-L6-v2).
 * Model is downloaded on first use (~25MB) and cached.
 * Requires glibc (node:20-slim, not Alpine).
 */

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

let embedder = null;

async function initEmbeddings() {
  if (embedder) return embedder;

  console.log(`[RAG] Loading embedding model (${MODEL_NAME})...`);
  const { pipeline } = await import("@xenova/transformers");
  embedder = await pipeline("feature-extraction", MODEL_NAME);
  console.log("[RAG] Embedding model ready");
  return embedder;
}

async function embedText(text) {
  const model = await initEmbeddings();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

async function embedBatch(texts) {
  const results = [];
  for (const text of texts) {
    results.push(await embedText(text));
  }
  return results;
}

module.exports = { initEmbeddings, embedText, embedBatch };
