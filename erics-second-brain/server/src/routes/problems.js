import { Router } from 'express';
import { db, attachTags } from '../db.js';

export const problemsRouter = Router();

// §3.6 — Twelve Favorite Problems. A short list of open guiding questions;
// each collects the notes linked to it over time.
problemsRouter.get('/', (req, res) => {
  const problems = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM note_problems np WHERE np.problem_id = p.id) AS note_count
       FROM favorite_problems p ORDER BY p.position, p.id`
    )
    .all();
  res.json({ problems });
});

problemsRouter.post('/', (req, res) => {
  const question = String(req.body?.question ?? '').trim().slice(0, 500);
  if (!question) return res.status(400).json({ error: 'A question is required.' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM favorite_problems').get().c;
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM favorite_problems').get().p;
  const info = db
    .prepare('INSERT INTO favorite_problems (question, position) VALUES (?, ?)')
    .run(question, pos);
  res.status(201).json({
    problem: db.prepare('SELECT * FROM favorite_problems WHERE id = ?').get(info.lastInsertRowid),
    // the method suggests ~a dozen; nudge, don't block
    hint: count >= 12 ? 'You have more than twelve problems now — consider retiring one.' : null,
  });
});

problemsRouter.put('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM favorite_problems WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Problem not found.' });
  const question = 'question' in (req.body ?? {})
    ? String(req.body.question).trim().slice(0, 500) || p.question
    : p.question;
  const position = Number.isFinite(Number(req.body?.position)) ? Number(req.body.position) : p.position;
  db.prepare('UPDATE favorite_problems SET question = ?, position = ? WHERE id = ?').run(
    question, position, req.params.id
  );
  res.json({ problem: db.prepare('SELECT * FROM favorite_problems WHERE id = ?').get(req.params.id) });
});

problemsRouter.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM favorite_problems WHERE id = ?').run(req.params.id); // links cascade
  res.json({ ok: true });
});

// A problem's page: the question + every note linked to it.
problemsRouter.get('/:id', (req, res) => {
  const problem = db.prepare('SELECT * FROM favorite_problems WHERE id = ?').get(req.params.id);
  if (!problem) return res.status(404).json({ error: 'Problem not found.' });
  const notes = attachTags(
    db
      .prepare(
        `SELECT n.id, n.title, n.body_md, n.summary_md, n.bucket, n.folder_id, n.packet_type,
                n.source_url, n.created_at, n.updated_at
         FROM notes n JOIN note_problems np ON np.note_id = n.id
         WHERE np.problem_id = ? ORDER BY n.updated_at DESC`
      )
      .all(req.params.id)
  );
  res.json({ problem, notes });
});
