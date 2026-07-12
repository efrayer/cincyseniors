import { Router } from 'express';
import { db, attachTags } from '../db.js';

export const searchRouter = Router();

// Escape user input for FTS5 MATCH: quote every token, add prefix `*`
// to the last one so search feels incremental in the palette (F6).
function ftsQuery(q) {
  const tokens = String(q)
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '""').trim())
    .filter(Boolean)
    .slice(0, 12);
  if (tokens.length === 0) return null;
  return tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`)).join(' ');
}

// GET /api/search?q=... — sub-second FTS5 over titles, bodies, summaries (F6)
searchRouter.get('/', (req, res) => {
  const match = ftsQuery(req.query.q ?? '');
  if (!match) return res.json({ results: [] });
  let rows;
  try {
    rows = db
      .prepare(
        `SELECT n.id, n.title, n.bucket, n.folder_id, n.source_url, n.updated_at,
                snippet(notes_fts, 1, '\u3010', '\u3011', ' … ', 18) AS snippet,
                bm25(notes_fts) AS rank
         FROM notes_fts
         JOIN notes n ON n.id = notes_fts.rowid
         WHERE notes_fts MATCH ?
         ORDER BY rank LIMIT 30`
      )
      .all(match);
  } catch {
    rows = []; // malformed FTS input should never 500 the palette
  }
  // also match tag names so tag search works from the same box (F7)
  const tagRows = db
    .prepare(
      `SELECT DISTINCT n.id, n.title, n.bucket, n.folder_id, n.source_url, n.updated_at,
              '#' || t.name AS snippet, 0 AS rank
       FROM tags t
       JOIN note_tags nt ON nt.tag_id = t.id
       JOIN notes n ON n.id = nt.note_id
       WHERE t.name LIKE ? LIMIT 10`
    )
    .all(`%${String(req.query.q).trim()}%`);
  const seen = new Set(rows.map((r) => r.id));
  for (const r of tagRows) if (!seen.has(r.id)) rows.push(r);
  res.json({ results: attachTags(rows.slice(0, 30)) });
});
