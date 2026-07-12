import { Router } from 'express';
import archiver from 'archiver';
import { db, attachTags, setNoteTags, setNoteProblems } from '../db.js';

export const exportRouter = Router();

function fullExport() {
  const folders = db.prepare('SELECT * FROM folders ORDER BY id').all();
  const notes = attachTags(db.prepare('SELECT * FROM notes ORDER BY id').all());
  const problems = db.prepare('SELECT * FROM favorite_problems ORDER BY position, id').all();
  const links = db.prepare('SELECT note_id, problem_id FROM note_problems').all();
  const byNote = new Map();
  for (const l of links) {
    if (!byNote.has(l.note_id)) byNote.set(l.note_id, []);
    byNote.get(l.note_id).push(l.problem_id);
  }
  for (const n of notes) n.problem_ids = byNote.get(n.id) ?? [];
  return {
    app: 'erics-second-brain',
    format_version: 2,
    exported_at: new Date().toISOString(),
    conventions: {
      layer2_bold: '**text** (standard Markdown bold)',
      layer3_highlight: '==text== (rendered as a highlight)',
      layer4_summary: 'summary_md field (executive summary block)',
    },
    folders,
    favorite_problems: problems,
    notes,
  };
}

// GET /api/export/json — one-click full export (F11)
exportRouter.get('/json', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="second-brain-${stamp}.json"`);
  res.json(fullExport());
});

function safeName(s, fallback) {
  const cleaned = String(s || fallback)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

// GET /api/export/markdown — zip of .md files organized by PARA (F11)
exportRouter.get('/markdown', (req, res) => {
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="second-brain-md-${stamp}.zip"`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);

  const folders = new Map(db.prepare('SELECT * FROM folders').all().map((f) => [f.id, f]));
  const notes = attachTags(db.prepare('SELECT * FROM notes ORDER BY id').all());
  const bucketDir = { inbox: 'Inbox', project: 'Projects', area: 'Areas', resource: 'Resources', archive: 'Archives' };

  for (const n of notes) {
    const folder = n.folder_id ? folders.get(n.folder_id) : null;
    const dir = [bucketDir[n.bucket] ?? 'Notes', folder ? safeName(folder.name, 'folder') : null]
      .filter(Boolean)
      .join('/');
    const front = [
      '---',
      `title: ${JSON.stringify(n.title)}`,
      `bucket: ${n.bucket}`,
      folder ? `folder: ${JSON.stringify(folder.name)}` : null,
      n.packet_type ? `packet_type: ${n.packet_type}` : null,
      n.source_url ? `source: ${n.source_url}` : null,
      n.tags.length ? `tags: [${n.tags.join(', ')}]` : null,
      `created: ${n.created_at}`,
      `updated: ${n.updated_at}`,
      '---',
      '',
    ]
      .filter((l) => l !== null)
      .join('\n');
    const summary = n.summary_md?.trim()
      ? `> **Summary (Layer 4)**\n${n.summary_md.trim().split('\n').map((l) => '> ' + l).join('\n')}\n\n`
      : '';
    archive.append(`${front}# ${n.title}\n\n${summary}${n.body_md}\n`, {
      name: `${dir}/${safeName(n.title, 'untitled')}-${n.id}.md`,
    });
  }
  archive.append(JSON.stringify(fullExport(), null, 2), { name: 'second-brain-full.json' });
  archive.finalize();
});

// POST /api/import — restore from a JSON export (F11). Imports into the
// current database, creating fresh ids; import into an empty DB for an
// exact restore. Runs in one transaction: all-or-nothing.
export function importHandler(req, res) {
  const data = req.body;
  if (!data || data.app !== 'erics-second-brain' || !Array.isArray(data.notes)) {
    return res.status(400).json({ error: 'Not a valid Second Brain JSON export.' });
  }
  const FOLDER_BUCKETS = ['project', 'area', 'resource', 'archive'];
  const NOTE_BUCKETS = ['inbox', ...FOLDER_BUCKETS];
  let imported = { folders: 0, notes: 0 };
  const tx = db.transaction(() => {
    const problemIdMap = new Map();
    const insProblem = db.prepare(
      'INSERT INTO favorite_problems (question, position, created_at) VALUES (?, ?, ?)'
    );
    for (const p of data.favorite_problems ?? []) {
      const info = insProblem.run(
        String(p.question ?? '').slice(0, 500) || 'Untitled question',
        Number(p.position) || 0,
        p.created_at ?? new Date().toISOString()
      );
      problemIdMap.set(p.id, info.lastInsertRowid);
    }
    const folderIdMap = new Map();
    const insFolder = db.prepare(
      'INSERT INTO folders (name, bucket, outcome, status, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const f of data.folders ?? []) {
      const bucket = FOLDER_BUCKETS.includes(f.bucket) ? f.bucket : 'resource';
      const info = insFolder.run(
        String(f.name ?? 'Untitled').slice(0, 200),
        bucket,
        f.outcome ? String(f.outcome).slice(0, 1000) : null,
        ['active', 'completed', 'on_hold'].includes(f.status) ? f.status : null,
        f.created_at ?? new Date().toISOString()
      );
      folderIdMap.set(f.id, info.lastInsertRowid);
      imported.folders++;
    }
    const insNote = db.prepare(
      `INSERT INTO notes (title, body_md, summary_md, bucket, folder_id, packet_type,
         source_url, created_at, updated_at, last_resurfaced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const n of data.notes) {
      const info = insNote.run(
        String(n.title ?? 'Untitled').slice(0, 300),
        String(n.body_md ?? ''),
        String(n.summary_md ?? ''),
        NOTE_BUCKETS.includes(n.bucket) ? n.bucket : 'inbox',
        n.folder_id ? folderIdMap.get(n.folder_id) ?? null : null,
        n.packet_type ?? null,
        n.source_url ? String(n.source_url).slice(0, 2000) : null,
        n.created_at ?? new Date().toISOString(),
        n.updated_at ?? new Date().toISOString(),
        n.last_resurfaced_at ?? null
      );
      if (Array.isArray(n.tags)) setNoteTags(info.lastInsertRowid, n.tags);
      if (Array.isArray(n.problem_ids)) {
        setNoteProblems(
          info.lastInsertRowid,
          n.problem_ids.map((pid) => problemIdMap.get(pid)).filter(Boolean)
        );
      }
      imported.notes++;
    }
  });
  try {
    tx();
  } catch (e) {
    return res.status(400).json({ error: 'Import failed: ' + e.message });
  }
  res.json({ ok: true, imported });
}
