import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function basePath() {
  let p = process.env.BASE_PATH ?? '/erics_second_brain';
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p; // '/' means no prefix
}

export const config = {
  basePath: basePath(),
  port: parseInt(process.env.PORT ?? '3111', 10),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(__dirname, '../../data')),
  authUsername: process.env.AUTH_USERNAME ?? 'eric',
  authPasswordHash: process.env.AUTH_PASSWORD_HASH ?? '',
  authDisabled: process.env.AUTH_DISABLED === 'true',
  sessionTtlMs: parseInt(process.env.SESSION_TTL_HOURS ?? '720', 10) * 3600 * 1000,
  cookieSecure: (process.env.COOKIE_SECURE ?? 'true') === 'true',
  clientDist: path.resolve(__dirname, '../../client/dist'),
  // ── Optional AI module (§7) — fully opt-in, off by default ──
  ai: {
    enabled: process.env.AI_ENABLED === 'true' && !!process.env.ANTHROPIC_API_KEY,
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'claude-opus-4-6',
  },
};

export const dbFile = () => path.join(config.dataDir, 'second-brain.db');
