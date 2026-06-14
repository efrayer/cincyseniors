/**
 * ChromaDB vector store — connects to ChromaDB server via HTTP.
 * Embeddings are pre-computed by LM Studio and sent with the data.
 */

const COLLECTION_NAME = "documents";

let client = null;
let collection = null;

async function initChroma() {
  if (collection) return collection;

  const chromaUrl = process.env.CHROMA_URL || "http://chromadb:8000";
  console.log(`[RAG] Connecting to ChromaDB at ${chromaUrl}`);

  const { ChromaClient } = await import("chromadb");
  client = new ChromaClient({ path: chromaUrl });

  // Verify connection
  const hb = await client.heartbeat();
  console.log(`[RAG] ChromaDB heartbeat: ${JSON.stringify(hb)}`);

  collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: { "hnsw:space": "cosine" },
  });

  const count = await collection.count();
  console.log(`[RAG] ChromaDB ready (${count} vectors in store)`);
  return collection;
}

/**
 * Add documents with pre-computed embeddings.
 */
async function addDocuments(docs) {
  const coll = await initChroma();

  await coll.add({
    ids: docs.map((d) => d.id),
    embeddings: docs.map((d) => d.embedding),
    documents: docs.map((d) => d.text),
    metadatas: docs.map((d) => d.metadata),
  });
}

/**
 * Query by pre-computed embedding vector.
 */
async function queryByEmbedding(embedding, topK = 4) {
  const coll = await initChroma();

  // Skip query if collection is empty
  const count = await coll.count();
  if (count === 0) return [];

  const results = await coll.query({
    queryEmbeddings: [embedding],
    nResults: Math.min(topK, count),
  });

  if (!results.ids || !results.ids[0] || results.ids[0].length === 0) {
    return [];
  }

  return results.ids[0].map((id, i) => ({
    id,
    text: results.documents[0][i],
    metadata: results.metadatas[0][i],
    distance: results.distances ? results.distances[0][i] : null,
  }));
}

async function deleteByDocumentId(documentId) {
  const coll = await initChroma();

  const existing = await coll.get({
    where: { documentId: documentId },
  });

  if (existing.ids.length === 0) return 0;

  await coll.delete({ ids: existing.ids });
  return existing.ids.length;
}

async function listDocuments() {
  const coll = await initChroma();

  const all = await coll.get({});

  // Group chunks by documentId
  const docMap = {};
  all.ids.forEach((id, i) => {
    const meta = all.metadatas[i];
    const docId = meta.documentId;
    if (!docMap[docId]) {
      docMap[docId] = {
        documentId: docId,
        filename: meta.filename,
        uploadedAt: meta.uploadedAt,
        chunks: 0,
        totalChars: 0,
      };
    }
    docMap[docId].chunks++;
    docMap[docId].totalChars += (all.documents[i] || "").length;
  });

  return Object.values(docMap);
}

module.exports = { initChroma, addDocuments, queryByEmbedding, deleteByDocumentId, listDocuments };
