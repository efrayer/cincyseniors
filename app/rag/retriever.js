/**
 * RAG retrieval — embed query via LM Studio, search ChromaDB, format context.
 */

const { embedText } = require("./embeddings");
const { queryByEmbedding } = require("./vectorstore");

const TOP_K = 4;

/**
 * Retrieve relevant document chunks for a query.
 */
async function retrieveContext(queryText, topK = TOP_K) {
  console.log(
    `[RAG] Retrieving context for: "${queryText.substring(0, 60)}..."`
  );

  const queryEmbedding = await embedText(queryText);
  const results = await queryByEmbedding(queryEmbedding, topK);

  console.log(`[RAG] Found ${results.length} results`);
  return results;
}

/**
 * Format retrieved chunks into a context string for the LLM.
 * Mirrors the buildSearchContext() pattern in Server.js.
 */
function buildRagContext(results) {
  if (!results || results.length === 0) return "";

  const lines = results.map((r, i) => {
    const source = r.metadata.filename || "Unknown";
    const chunk = r.metadata.chunkIndex + 1;
    const total = r.metadata.totalChunks;

    return `[${i + 1}] ${source} (chunk ${chunk}/${total})\n    ${r.text}`;
  });

  return (
    "Here are relevant excerpts from uploaded documents. Use them to inform your answer, " +
    "and cite sources by number when appropriate:\n\n" +
    lines.join("\n\n")
  );
}

module.exports = { retrieveContext, buildRagContext };
