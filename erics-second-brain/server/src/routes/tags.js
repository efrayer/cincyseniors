import { Router } from 'express';
import { db } from '../db.js';

export const tagsRouter = Router();

// GET /api/tags — tag index with counts (F7)
tagsRouter.get('/', (req, res) => {
  const tags = db
    .prepare(
      `SELECT t.name, COUNT(nt.note_id) AS note_count
       FROM tags t LEFT JOIN note_tags nt ON nt.tag_id = t.id
       GROUP BY t.id ORDER BY note_count DESC, t.name`
    )
    .all();
  res.json({ tags });
});
