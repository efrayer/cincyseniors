import { Router } from 'express';
import {
  db, now, attachTags, tagsForNote, setNoteTags, problemsForNote, setNoteProblems,
} from '../db.js';

export const notesRouter = Router();

const BUCKETS = ['inbox', 'project', 'area', 'resource', 'archive'];
const PACKET_TYPES = [
  'distilled-note',
  'outtake',
  'work-in-process',
  'final-deliverable',
  'document-by-other',
];

const NOTE_COLS = `id, title, body_md, summary_md, bucket, folder_id, packet_type,
  source_url, created_at, updated_at, last_resurfaced_at`;

function cleanBucket(b, fallback = 'inbox') {
  return BUCKETS.includes(b) ? b : fallback;
}

// GET /api/notes?bucket=&folder_id=&tag=&packet_type=&limit=&offset=
notesRouter.get('/', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.bucket && BUCKETS.includes(req.query.bucket)) {
    where.push('n.bucket = ?');
    params.push(req.query.bucket);
  }
  if (req.query.folder_id) {
    where.push('n.folder_id = ?');
    params.push(Number(req.query.folder_id));
  }
  if (req.query.tag) {
    where.push(
      `n.id IN (SELECT nt.note_id FROM note_tags nt
        JOIN tags t ON t.id = nt.tag_id WHERE t.name = ? COLLATE NOCASE)`
    );
    params.push(String(req.query.tag));
  }
  if (req.query.packet_type === 'any') {
    where.push('n.packet_type IS NOT NULL');
  } else if (req.query.packet_type && PACKET_TYPES.includes(req.query.packet_type)) {
    where.push('n.packet_type = ?');
    params.push(req.query.packet_type);
  }
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const offset = Number(req.query.offset) || 0;
  const rows = db
    .prepare(
      `SELECT ${NOTE_COLS}
       FROM notes n
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY n.updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  res.json({ notes: attachTags(rows) });
});

notesRouter.get('/:id', (req, res) => {
  const note = db.prepare(`SELECT ${NOTE_COLS} FROM notes WHERE id = ?`).get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  note.tags = tagsForNote(note.id);
  note.problems = problemsForNote(note.id);
  const folder = note.folder_id
    ? db.prepare('SELECT id, name, bucket, outcome, status FROM folders WHERE id = ?').get(note.folder_id)
    : null;
  res.json({ note, folder });
});

// GET /api/notes/:id/related — serendipity panel (F8, §3.5.4).
// Blend of: shared tags, FTS similarity on the note's title + summary,
// and same-folder neighbours. Scored, deduped, capped.
notesRouter.get('/:id/related', (req, res) => {
  const note = db.prepare(`SELECT ${NOTE_COLS} FROM notes WHERE id = ?`).get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  const scores = new Map(); // id → { row, score, why:Set }
  const add = (row, score, why) => {
    if (row.id === note.id) return;
    const cur = scores.get(row.id) ?? { row, score: 0, why: new Set() };
    cur.score += score;
    cur.why.add(why);
    scores.set(row.id, cur);
  };

  // 1. shared tags (strongest signal)
  const sharedTagRows = db
    .prepare(
      `SELECT n.id, n.title, n.bucket, n.folder_id, n.packet_type, n.updated_at,
              COUNT(*) AS shared
       FROM note_tags a
       JOIN note_tags b ON b.tag_id = a.tag_id AND b.note_id != a.note_id
       JOIN notes n ON n.id = b.note_id
       WHERE a.note_id = ?
       GROUP BY b.note_id ORDER BY shared DESC LIMIT 10`
    )
    .all(note.id);
  for (const r of sharedTagRows) add(r, 3 * r.shared, 'shared tags');

  // 2. FTS similarity — search with the note's own title + summary terms
  const terms = `${note.title} ${note.summary_md}`
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 3)
    .slice(0, 8);
  if (terms.length) {
    const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
    try {
      const ftsRows = db
        .prepare(
          `SELECT n.id, n.title, n.bucket, n.folder_id, n.packet_type, n.updated_at,
                  bm25(notes_fts) AS rank
           FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid
           WHERE notes_fts MATCH ? ORDER BY rank LIMIT 10`
        )
        .all(match);
      for (const r of ftsRows) add(r, 2, 'similar content');
    } catch {
      /* ignore malformed */
    }
  }

  // 3. same folder
  if (note.folder_id) {
    const folderRows = db
      .prepare(
        `SELECT id, title, bucket, folder_id, packet_type, updated_at
         FROM notes WHERE folder_id = ? AND id != ? ORDER BY updated_at DESC LIMIT 6`
      )
      .all(note.folder_id, note.id);
    for (const r of folderRows) add(r, 1, 'same folder');
  }

  const related = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ row, why }) => ({ ...row, why: [...why] }));
  res.json({ related });
});

// POST /api/notes — capture (F1). Everything optional except some content.
notesRouter.post('/', (req, res) => {
  const b = req.body ?? {};
  const title = String(b.title ?? '').trim().slice(0, 300);
  const body_md = String(b.body_md ?? '');
  if (!title && !body_md.trim()) {
    return res.status(400).json({ error: 'A title or body is required.' });
  }
  const bucket = cleanBucket(b.bucket);
  const folder_id = b.folder_id ? Number(b.folder_id) : null;
  const packet_type = PACKET_TYPES.includes(b.packet_type) ? b.packet_type : null;
  const source_url = b.source_url ? String(b.source_url).slice(0, 2000) : null;
  const info = db
    .prepare(
      `INSERT INTO notes (title, body_md, summary_md, bucket, folder_id, packet_type, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(title || 'Untitled', body_md, String(b.summary_md ?? ''), bucket, folder_id, packet_type, source_url);
  if (Array.isArray(b.tags)) setNoteTags(info.lastInsertRowid, b.tags);
  if (Array.isArray(b.problem_ids)) setNoteProblems(info.lastInsertRowid, b.problem_ids);
  const note = db.prepare(`SELECT ${NOTE_COLS} FROM notes WHERE id = ?`).get(info.lastInsertRowid);
  note.tags = tagsForNote(note.id);
  res.status(201).json({ note });
});

notesRouter.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM notes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Note not found.' });
  const b = req.body ?? {};
  const sets = [];
  const params = [];
  const assign = (col, val) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };
  if ('title' in b) assign('title', String(b.title).trim().slice(0, 300) || 'Untitled');
  if ('body_md' in b) assign('body_md', String(b.body_md));
  if ('summary_md' in b) assign('summary_md', String(b.summary_md));
  if ('bucket' in b) assign('bucket', cleanBucket(b.bucket));
  if ('folder_id' in b) assign('folder_id', b.folder_id ? Number(b.folder_id) : null);
  if ('packet_type' in b)
    assign('packet_type', PACKET_TYPES.includes(b.packet_type) ? b.packet_type : null);
  if ('source_url' in b) assign('source_url', b.source_url ? String(b.source_url).slice(0, 2000) : null);
  if (sets.length) {
    assign('updated_at', now());
    db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...params, req.params.id);
  }
  if (Array.isArray(b.tags)) setNoteTags(Number(req.params.id), b.tags);
  if (Array.isArray(b.problem_ids)) setNoteProblems(Number(req.params.id), b.problem_ids);
  const note = db.prepare(`SELECT ${NOTE_COLS} FROM notes WHERE id = ?`).get(req.params.id);
  note.tags = tagsForNote(note.id);
  note.problems = problemsForNote(note.id);
  res.json({ note });
});

// POST /api/notes/:id/move — one-action reclassify (F5)
notesRouter.post('/:id/move', (req, res) => {
  const existing = db.prepare('SELECT id FROM notes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Note not found.' });
  const bucket = cleanBucket(req.body?.bucket, null);
  if (!bucket) return res.status(400).json({ error: 'Invalid bucket.' });
  const folder_id = req.body?.folder_id ? Number(req.body.folder_id) : null;
  db.prepare('UPDATE notes SET bucket = ?, folder_id = ?, updated_at = ? WHERE id = ?').run(
    bucket,
    folder_id,
    now(),
    req.params.id
  );
  res.json({ ok: true });
});

notesRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)').run();
  res.json({ ok: true });
});
