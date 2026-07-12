import { Router } from 'express';
import { db, now, attachTags } from '../db.js';

export const dashboardRouter = Router();

// GET /api/dashboard/resurface — "show me another" shuffle (F8)
dashboardRouter.get('/resurface', (req, res) => {
  const resurfaced = db
    .prepare(
      `SELECT id, title, body_md, summary_md, bucket, folder_id, source_url, created_at
       FROM notes WHERE bucket != 'inbox' AND id != ?
       ORDER BY RANDOM() LIMIT 1`
    )
    .get(Number(req.query.not ?? 0));
  if (resurfaced) {
    db.prepare('UPDATE notes SET last_resurfaced_at = ? WHERE id = ?').run(now(), resurfaced.id);
    attachTags([resurfaced]);
  }
  res.json({ resurfaced: resurfaced ?? null });
});

// GET /api/dashboard — stats, recent captures, resurfaced note (F12)
dashboardRouter.get('/', (req, res) => {
  const stats = {
    active_projects: db
      .prepare("SELECT COUNT(*) AS c FROM folders WHERE bucket = 'project' AND status = 'active'")
      .get().c,
    inbox_count: db.prepare("SELECT COUNT(*) AS c FROM notes WHERE bucket = 'inbox'").get().c,
    notes_this_week: db
      .prepare("SELECT COUNT(*) AS c FROM notes WHERE created_at >= datetime('now', '-7 days')")
      .get().c,
    total_notes: db.prepare('SELECT COUNT(*) AS c FROM notes').get().c,
  };

  const recent = attachTags(
    db
      .prepare(
        `SELECT id, title, body_md, bucket, folder_id, source_url, created_at, updated_at
         FROM notes ORDER BY created_at DESC LIMIT 8`
      )
      .all()
  );

  // Serendipity (§3.5): resurface a note not touched or resurfaced lately.
  let resurfaced = db
    .prepare(
      `SELECT id, title, body_md, summary_md, bucket, folder_id, source_url, created_at
       FROM notes
       WHERE bucket != 'inbox'
         AND updated_at < datetime('now', '-14 days')
         AND (last_resurfaced_at IS NULL OR last_resurfaced_at < datetime('now', '-2 days'))
       ORDER BY RANDOM() LIMIT 1`
    )
    .get();
  if (!resurfaced) {
    resurfaced = db
      .prepare(
        `SELECT id, title, body_md, summary_md, bucket, folder_id, source_url, created_at
         FROM notes WHERE bucket != 'inbox' ORDER BY RANDOM() LIMIT 1`
      )
      .get();
  }
  if (resurfaced) {
    db.prepare('UPDATE notes SET last_resurfaced_at = ? WHERE id = ?').run(now(), resurfaced.id);
    attachTags([resurfaced]);
  }

  const active_projects = db
    .prepare(
      `SELECT f.*, (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id) AS note_count
       FROM folders f WHERE f.bucket = 'project' AND f.status = 'active'
       ORDER BY f.created_at DESC LIMIT 8`
    )
    .all();

  res.json({ stats, recent, resurfaced: resurfaced ?? null, active_projects });
});
