import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import './db.js';
import {
  loginHandler, logoutHandler, meHandler, requireAuth, sameOriginGuard,
} from './auth.js';
import { notesRouter } from './routes/notes.js';
import { foldersRouter } from './routes/folders.js';
import { tagsRouter } from './routes/tags.js';
import { searchRouter } from './routes/search.js';
import { dashboardRouter } from './routes/dashboard.js';
import { exportRouter, importHandler } from './routes/exportImport.js';
import { problemsRouter } from './routes/problems.js';
import { fetchUrlRouter } from './routes/fetchUrl.js';
import { distillRouter } from './routes/distill.js';
import { aiRouter } from './routes/ai.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' })); // import payloads can be large
app.use(cookieParser());

const base = config.basePath === '/' ? '' : config.basePath;

// Convenience: hitting the bare host lands on the app. (The bare prefix
// without a trailing slash is redirected by express.static below —
// don't add an app.get(base) redirect here: non-strict routing would
// match base + '/' too and loop.)
if (base) {
  app.get('/', (req, res) => res.redirect(base + '/'));
}

// ── API ────────────────────────────────────────────────────────────
const api = express.Router();
api.use(sameOriginGuard);
api.get('/health', (req, res) => res.json({ ok: true }));
api.post('/auth/login', loginHandler);
api.post('/auth/logout', requireAuth, logoutHandler);
api.get('/auth/me', requireAuth, meHandler);

// Everything below requires a valid session — reads and writes alike.
api.use(requireAuth);
api.use('/notes', notesRouter);
api.use('/folders', foldersRouter);
api.use('/tags', tagsRouter);
api.use('/search', searchRouter);
api.use('/dashboard', dashboardRouter);
api.use('/export', exportRouter);
api.post('/import', importHandler);
api.use('/problems', problemsRouter);
api.use('/fetch-url', fetchUrlRouter);
api.use('/distill', distillRouter);
api.use('/ai', aiRouter); // optional module — inert unless AI_ENABLED

app.use(`${base}/api`, api);

// ── Static SPA ─────────────────────────────────────────────────────
if (fs.existsSync(config.clientDist)) {
  // express.static also 301s the bare prefix → prefix + '/'
  app.use(base || '/', express.static(config.clientDist, { index: 'index.html', maxAge: '1h' }));
  // SPA fallback for client-side routes (never for /api)
  app.get(`${base}/*`, (req, res) => {
    res.sendFile(path.join(config.clientDist, 'index.html'));
  });
} else {
  app.get(`${base}/*`, (req, res) =>
    res.status(503).send('Client not built. Run: npm run build')
  );
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(config.port, () => {
  console.log(
    `[esb] Eric's Second Brain listening on :${config.port} at base path "${config.basePath}"` +
      (config.authDisabled ? ' — WARNING: app-level auth DISABLED (Cloudflare Access mode)' : '')
  );
});
