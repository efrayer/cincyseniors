import fs from 'node:fs';
import Database from 'better-sqlite3';
import { config, dbFile } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(dbFile());
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ─────────────────────────────────────────────────────────
// Buckets follow PARA (§3.2) plus 'inbox' for unfiled captures (§6).
// Progressive Summarization (§3.3) convention, documented for export:
//   Layer 1 = raw body_md + source_url
//   Layer 2 = **bold** (standard Markdown)
//   Layer 3 = ==highlight== (rendered as <mark>)
//   Layer 4 = summary_md (pinned executive-summary block)
db.exec(`
CREATE TABLE IF NOT EXISTS folders (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  bucket     TEXT NOT NULL CHECK (bucket IN ('project','area','resource','archive')),
  outcome    TEXT,
  status     TEXT CHECK (status IN ('active','completed','on_hold')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id                 INTEGER PRIMARY KEY,
  title              TEXT NOT NULL DEFAULT '',
  body_md            TEXT NOT NULL DEFAULT '',
  summary_md         TEXT NOT NULL DEFAULT '',
  bucket             TEXT NOT NULL DEFAULT 'inbox'
                     CHECK (bucket IN ('inbox','project','area','resource','archive')),
  folder_id          INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  packet_type        TEXT CHECK (packet_type IN
                     ('distilled-note','outtake','work-in-process','final-deliverable','document-by-other')),
  source_url         TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_resurfaced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_bucket ON notes(bucket);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);

-- Twelve Favorite Problems (§3.6) — open guiding questions; notes can be
-- linked to one or more problems.
CREATE TABLE IF NOT EXISTS favorite_problems (
  id         INTEGER PRIMARY KEY,
  question   TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS note_problems (
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES favorite_problems(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, problem_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title, body_md, summary_md,
  content='notes', content_rowid='id',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, body_md, summary_md)
  VALUES (new.id, new.title, new.body_md, new.summary_md);
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body_md, summary_md)
  VALUES ('delete', old.id, old.title, old.body_md, old.summary_md);
END;
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE OF title, body_md, summary_md ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body_md, summary_md)
  VALUES ('delete', old.id, old.title, old.body_md, old.summary_md);
  INSERT INTO notes_fts(rowid, title, body_md, summary_md)
  VALUES (new.id, new.title, new.body_md, new.summary_md);
END;
`);

// ── Helpers ────────────────────────────────────────────────────────
export const now = () => new Date().toISOString();

export function tagsForNote(noteId) {
  return db
    .prepare(
      `SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id
       WHERE nt.note_id = ? ORDER BY t.name`
    )
    .all(noteId)
    .map((r) => r.name);
}

export function attachTags(noteRows) {
  if (noteRows.length === 0) return noteRows;
  const ids = noteRows.map((n) => n.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
       WHERE nt.note_id IN (${placeholders}) ORDER BY t.name`
    )
    .all(...ids);
  const byNote = new Map();
  for (const r of rows) {
    if (!byNote.has(r.note_id)) byNote.set(r.note_id, []);
    byNote.get(r.note_id).push(r.name);
  }
  for (const n of noteRows) n.tags = byNote.get(n.id) ?? [];
  return noteRows;
}

export const setNoteTags = db.transaction((noteId, tagNames) => {
  db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
  const insTag = db.prepare('INSERT INTO tags(name) VALUES (?) ON CONFLICT(name) DO NOTHING');
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
  const link = db.prepare('INSERT OR IGNORE INTO note_tags(note_id, tag_id) VALUES (?, ?)');
  for (const raw of tagNames ?? []) {
    const name = String(raw).trim().toLowerCase().replace(/\s+/g, '-').slice(0, 64);
    if (!name) continue;
    insTag.run(name);
    link.run(noteId, getTag.get(name).id);
  }
  // prune orphaned tags
  db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM note_tags)').run();
});

export function problemsForNote(noteId) {
  return db
    .prepare(
      `SELECT p.id, p.question FROM favorite_problems p
       JOIN note_problems np ON np.problem_id = p.id
       WHERE np.note_id = ? ORDER BY p.position, p.id`
    )
    .all(noteId);
}

export const setNoteProblems = db.transaction((noteId, problemIds) => {
  db.prepare('DELETE FROM note_problems WHERE note_id = ?').run(noteId);
  const link = db.prepare(
    `INSERT OR IGNORE INTO note_problems(note_id, problem_id)
     SELECT ?, id FROM favorite_problems WHERE id = ?`
  );
  for (const pid of problemIds ?? []) link.run(noteId, Number(pid));
});

// Extract Progressive Summarization fragments from body_md (used by the
// distill view, F10). ==…== is Layer 3; **…** is Layer 2.
export function extractLayers(body_md) {
  const highlights = [...String(body_md ?? '').matchAll(/==([^=\n](?:[^=\n]|=(?!=))*)==/g)].map(
    (m) => m[1].trim()
  );
  const bolds = [...String(body_md ?? '').matchAll(/\*\*([^*\n](?:[^*\n]|\*(?!\*))*)\*\*/g)].map(
    (m) => m[1].trim()
  );
  return { highlights, bolds };
}
