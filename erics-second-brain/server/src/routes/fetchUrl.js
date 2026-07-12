import dns from 'node:dns/promises';
import net from 'node:net';
import { Router } from 'express';

export const fetchUrlRouter = Router();

// ── SSRF guard ─────────────────────────────────────────────────────
// This endpoint fetches arbitrary URLs on my behalf (F2). Since the app
// is internet-facing, refuse anything that resolves to a private,
// loopback, or link-local address so it can't be used to probe the
// internal network or the Cloudflare tunnel host.
function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === '::1' || low.startsWith('fe80:') || low.startsWith('fc') || low.startsWith('fd')) return true;
    if (low.startsWith('::ffff:')) return isPrivateIp(low.slice(7)); // v4-mapped
    return false;
  }
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Refusing to fetch private addresses.');
    return;
  }
  const records = await dns.lookup(hostname, { all: true }).catch(() => {
    throw new Error('Could not resolve host.');
  });
  if (records.length === 0 || records.some((r) => isPrivateIp(r.address))) {
    throw new Error('Refusing to fetch private addresses.');
  }
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// POST /api/fetch-url { url } → { title, description, url }
// Server-side to avoid CORS; only title/description TEXT is extracted —
// no fetched HTML is ever stored or rendered.
fetchUrlRouter.post('/', async (req, res) => {
  let url;
  try {
    url = new URL(String(req.body?.url ?? ''));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: 'Enter a valid http(s) URL.' });
  }
  try {
    await assertPublicHost(url.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'erics-second-brain/1.0 (+personal note capture)' },
    });
    clearTimeout(timer);
    // re-check the final host after redirects
    await assertPublicHost(new URL(resp.url).hostname);
    const type = resp.headers.get('content-type') ?? '';
    if (!type.includes('html') && !type.includes('xml')) {
      return res.json({ url: resp.url, title: url.hostname, description: null });
    }
    // read at most 256 KB — the <title> lives at the top
    const reader = resp.body.getReader();
    let html = '';
    const decoder = new TextDecoder();
    while (html.length < 256 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/title>/i.test(html) && /name=["']description["']/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const descMatch =
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html) ??
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html) ??
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(html);
    const title = titleMatch ? decodeEntities(titleMatch[1].replace(/\s+/g, ' ').trim()).slice(0, 300) : url.hostname;
    const description = descMatch ? decodeEntities(descMatch[1].replace(/\s+/g, ' ').trim()).slice(0, 500) : null;
    res.json({ url: resp.url, title: title || url.hostname, description });
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'The page took too long to respond.' : e.message;
    res.status(422).json({ error: `Could not fetch that page: ${msg}` });
  }
});
