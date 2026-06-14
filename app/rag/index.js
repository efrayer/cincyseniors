/**
 * RAG module — orchestrator and public API.
 */

const { initEmbeddings } = require("./embeddings");
const { initChroma, deleteByDocumentId, listDocuments } = require("./vectorstore");
const { ingestDocument, ingestPDF, SUPPORTED_EXTENSIONS } = require("./documents");
const { retrieveContext, buildRagContext } = require("./retriever");

async function initialize() {
  console.log("[RAG] Initializing RAG system...");
  await initEmbeddings();
  await initChroma();
  console.log("[RAG] RAG system ready");
}

module.exports = {
  initialize,
  ingestDocument,
  ingestPDF,
  SUPPORTED_EXTENSIONS,
  retrieveContext,
  buildRagContext,
  deleteByDocumentId,
  listDocuments,
};
