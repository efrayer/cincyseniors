import { Router } from 'express';
import { db, now } from '../db.js';

export const foldersRouter = Router();

const FOLDER_BUCKETS = ['project', 'area', 'resource', 'archive'];
const STATUSES = ['active', 'completed', 'on_hold'];

// GET /api/folders — the whole PARA tree with note counts (F4)
foldersRouter.get('/', (req, res) => {
  const folders = db
    .prepare(
      `SELECT f.*, (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id) AS note_count
       FROM folders f ORDER BY f.bucket, f.name COLLATE NOCASE`
    )
    .all();
  const counts = {};
  for (const row of db.prepare('SELECT bucket, COUNT(*) AS c FROM notes GROUP BY bucket').all()) {
    counts[row.bucket] = row.c;
  }
  res.json({ folders, bucket_counts: counts });
});

foldersRouter.post('/', (req, res) => {
  const b = req.body ?? {};
  const name = String(b.name ?? '').trim().slice(0, 200);
  if (!name) return res.status(400).json({ error: 'Folder name is required.' });
  const bucket = FOLDER_BUCKETS.includes(b.bucket) ? b.bucket : 'resource';
  const outcome = bucket === 'project' ? String(b.outcome ?? '').slice(0, 1000) || null : null;
  const status = bucket === 'project' ? (STATUSES.includes(b.status) ? b.status : 'active') : null;
  const info = db
    .prepare('INSERT INTO folders (name, bucket, outcome, status) VALUES (?, ?, ?, ?)')
    .run(name, bucket, outcome, status);
  res.status(201).json({ folder: db.prepare('SELECT * FROM folders WHERE id = ?').get(info.lastInsertRowid) });
});

foldersRouter.put('/:id', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found.' });
  const b = req.body ?? {};
  const name = 'name' in b ? String(b.name).trim().slice(0, 200) || folder.name : folder.name;
  const bucket = FOLDER_BUCKETS.includes(b.bucket) ? b.bucket : folder.bucket;
  const outcome = 'outcome' in b ? String(b.outcome ?? '').slice(0, 1000) || null : folder.outcome;
  const status = STATUSES.includes(b.status) ? b.status : folder.status;
  db.prepare('UPDATE folders SET name = ?, bucket = ?, outcome = ?, status = ? WHERE id = ?').run(
    name, bucket, outcome, status, req.params.id
  );
  if (bucket !== folder.bucket) {
    // keep contained notes in the same bucket as their folder
    db.prepare('UPDATE notes SET bucket = ?, updated_at = ? WHERE folder_id = ?').run(
      bucket, now(), req.params.id
    );
  }
  res.json({ folder: db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id) });
});

// POST /api/folders/:id/archive — archive a whole project/area/resource (F5).
// Nothing is deleted: folder + all its notes move to Archives, stay searchable.
foldersRouter.post('/:id/archive', (req, res) => {
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
  if (!folder) return res.status(404).json({ error: 'Folder not found.' });
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE folders SET bucket = 'archive',
         status = CASE WHEN status = 'active' THEN 'completed' ELSE status END
       WHERE id = ?`
    ).run(folder.id);
    db.prepare("UPDATE notes SET bucket = 'archive', updated_at = ? WHERE folder_id = ?").run(
      now(), folder.id
    );
  });
  tx();
  res.json({ ok: true });
});

// DELETE only allowed for empty folders — the method says archive, not delete.
foldersRouter.delete('/:id', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM notes WHERE folder_id = ?').get(req.params.id).c;
  if (count > 0) {
    return res.status(409).json({ error: 'Folder has notes. Archive it instead, or move the notes out.' });
  }
  db.prepare('DELETE FROM folders WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
