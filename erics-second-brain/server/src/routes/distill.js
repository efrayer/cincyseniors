import { Router } from 'express';
import { db, extractLayers } from '../db.js';

export const distillRouter = Router();

// F10 — cross-note distill view: skim the essence of many notes at once.
// GET /api/distill?layer=summary|highlight|bold&bucket=&folder_id=
// Returns only notes that HAVE content at the requested layer.
distillRouter.get('/', (req, res) => {
  const layer = ['summary', 'highlight', 'bold'].includes(req.query.layer)
    ? req.query.layer
    : 'summary';
  const where = [];
  const params = [];
  if (req.query.bucket) {
    where.push('bucket = ?');
    params.push(String(req.query.bucket));
  }
  if (req.query.folder_id) {
    where.push('folder_id = ?');
    params.push(Number(req.query.folder_id));
  }
  const rows = db
    .prepare(
      `SELECT id, title, body_md, summary_md, bucket, folder_id, packet_type, source_url, updated_at
       FROM notes ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY updated_at DESC LIMIT 500`
    )
    .all(...params);

  const items = [];
  for (const n of rows) {
    const { highlights, bolds } = extractLayers(n.body_md);
    const base = {
      id: n.id, title: n.title, bucket: n.bucket, folder_id: n.folder_id,
      packet_type: n.packet_type, updated_at: n.updated_at,
    };
    if (layer === 'summary' && n.summary_md.trim()) {
      items.push({ ...base, content: n.summary_md.trim() });
    } else if (layer === 'highlight' && highlights.length) {
      items.push({ ...base, fragments: highlights });
    } else if (layer === 'bold' && (bolds.length || highlights.length)) {
      // Layer ≥ 2: bolds include the highlights conceptually
      items.push({ ...base, fragments: [...bolds, ...highlights.filter((h) => !bolds.includes(h))] });
    }
  }
  res.json({ layer, items, scanned: rows.length });
});
