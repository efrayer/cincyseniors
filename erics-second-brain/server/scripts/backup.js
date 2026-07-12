#!/usr/bin/env node
// Online SQLite backup using SQLite's backup API (safe while the app runs).
// Usage:  npm run backup            → data/backups/second-brain-<stamp>.db
//         npm run backup -- /path   → custom destination directory
// Keeps the 30 most recent backups.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config, dbFile } from '../src/config.js';

const destDir = path.resolve(process.argv[2] ?? path.join(config.dataDir, 'backups'));
fs.mkdirSync(destDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(destDir, `second-brain-${stamp}.db`);

const db = new Database(dbFile(), { readonly: true });
await db.backup(dest);
db.close();
console.log(`[backup] wrote ${dest}`);

// retention: keep newest 30
const backups = fs
  .readdirSync(destDir)
  .filter((f) => f.startsWith('second-brain-') && f.endsWith('.db'))
  .sort()
  .reverse();
for (const old of backups.slice(30)) {
  fs.unlinkSync(path.join(destDir, old));
  console.log(`[backup] pruned ${old}`);
}
