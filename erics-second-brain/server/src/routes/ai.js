import { Router } from 'express';
import { db, extractLayers } from '../db.js';
import { config } from '../config.js';

// ══════════════════════════════════════════════════════════════════
// Optional AI module (§7). Fully opt-in and removable:
//   - Every route below is gated on AI_ENABLED + ANTHROPIC_API_KEY.
//   - No note content leaves the box unless the flag is on AND you
//     trigger an action. Nothing runs in the background.
//   - The AI assists the methodology, never overwrites it: distill
//     suggestions are returned for you to accept/edit — never saved.
// To remove the module entirely: delete this file, its mount line in
// index.js, and the client Chat page / DistillAssist component.
// ══════════════════════════════════════════════════════════════════

export const aiRouter = Router();

let _client = null;
async function client() {
  if (!_client) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    _client = new Anthropic({ apiKey: config.ai.apiKey });
  }
  return _client;
}

aiRouter.get('/status', (req, res) => {
  res.json({ enabled: config.ai.enabled, model: config.ai.enabled ? config.ai.model : null });
});

// Everything past here requires the module to be switched on.
aiRouter.use((req, res, next) => {
  if (!config.ai.enabled) {
    return res.status(403).json({
      error: 'AI module is disabled. Set AI_ENABLED=true and ANTHROPIC_API_KEY to enable it.',
    });
  }
  next();
});

function textOf(message) {
  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// Pull a JSON object out of a model reply, tolerating code fences.
function parseJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in model reply.');
  return JSON.parse(match[0]);
}

// ── Distill assist (§7) ────────────────────────────────────────────
// POST /api/ai/distill { note_id } → { summary, bold_passages[] }
// Suggestions only — the client shows them for accept/edit; nothing
// is written to the database here.
aiRouter.post('/distill', async (req, res) => {
  const note = db
    .prepare('SELECT id, title, body_md, summary_md FROM notes WHERE id = ?')
    .get(Number(req.body?.note_id));
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  if (!note.body_md.trim()) return res.status(400).json({ error: 'Note has no body to distill.' });

  const { bolds } = extractLayers(note.body_md);
  try {
    const anthropic = await client();
    const stream = anthropic.messages.stream({
      model: config.ai.model,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      system: [
        'You assist with Progressive Summarization (Tiago Forte) on a personal note.',
        'Layer 2 = bolding the passages that carry the meaning. Layer 4 = a short executive summary in the note-owner\'s own words.',
        'Reply with ONLY a JSON object, no prose: {"summary": string, "bold_passages": string[]}.',
        'Rules for bold_passages: 3-6 items, each an EXACT VERBATIM substring copied from the note body (so they can be matched programmatically), each a meaningful phrase or clause (not a whole paragraph, not a single word). Never suggest passages that are already bold.',
        'Rules for summary: 1-3 plain sentences capturing the takeaway, written in first person as the note-owner, no preamble.',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content:
            `Note title: ${note.title}\n\n` +
            (bolds.length ? `Already bolded (do not repeat): ${JSON.stringify(bolds)}\n\n` : '') +
            `Note body (Markdown):\n${note.body_md.slice(0, 24000)}`,
        },
      ],
    });
    const message = await stream.finalMessage();
    const parsed = parseJson(textOf(message));
    const summary = String(parsed.summary ?? '').trim();
    // keep only passages that truly exist in the body and aren't bolded yet
    const bold_passages = (Array.isArray(parsed.bold_passages) ? parsed.bold_passages : [])
      .map((p) => String(p).trim())
      .filter((p) => p.length > 3 && note.body_md.includes(p) && !bolds.includes(p))
      .slice(0, 6);
    res.json({ summary, bold_passages, model: config.ai.model });
  } catch (e) {
    console.error('[ai/distill]', e.message);
    res.status(502).json({ error: `Distill assist failed: ${e.message}` });
  }
});

// ── Chat with my brain — RAG (§7) ──────────────────────────────────
// POST /api/ai/chat { question, history? } → { answer, sources[] }
// Retrieval: FTS5 over the question's terms (+ tag matches), top notes
// go into the prompt. Answers must cite [[note:ID]]; we return the
// cited notes so the client can link them.
function retrieve(question, limit = 10) {
  const terms = String(question)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2)
    .slice(0, 12);
  const found = new Map();
  if (terms.length) {
    const match = terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
    try {
      for (const row of db
        .prepare(
          `SELECT n.id, n.title, n.body_md, n.summary_md, n.bucket, n.source_url,
                  bm25(notes_fts) AS rank
           FROM notes_fts JOIN notes n ON n.id = notes_fts.rowid
           WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?`
        )
        .all(match, limit)) {
        found.set(row.id, row);
      }
    } catch {
      /* malformed FTS input — fall through to tag search */
    }
  }
  for (const t of terms) {
    for (const row of db
      .prepare(
        `SELECT n.id, n.title, n.body_md, n.summary_md, n.bucket, n.source_url, 0 AS rank
         FROM tags tg JOIN note_tags nt ON nt.tag_id = tg.id JOIN notes n ON n.id = nt.note_id
         WHERE tg.name LIKE ? LIMIT 3`
      )
      .all(`%${t.toLowerCase()}%`)) {
      if (!found.has(row.id) && found.size < limit + 3) found.set(row.id, row);
    }
  }
  return [...found.values()];
}

aiRouter.post('/chat', async (req, res) => {
  const question = String(req.body?.question ?? '').trim();
  if (!question) return res.status(400).json({ error: 'Ask a question.' });

  const notes = retrieve(question);
  if (notes.length === 0) {
    return res.json({
      answer: "I couldn't find any notes related to that question in your Second Brain.",
      sources: [],
    });
  }

  const contextBlocks = notes.map((n) => {
    const summary = n.summary_md?.trim() ? `Summary: ${n.summary_md.trim()}\n` : '';
    return `[[note:${n.id}]] "${n.title}" (${n.bucket})\n${summary}${n.body_md.slice(0, 3000)}`;
  });

  // short prior conversation, text-only, capped
  const history = (Array.isArray(req.body?.history) ? req.body.history : [])
    .slice(-6)
    .filter((m) => ['user', 'assistant'].includes(m?.role) && typeof m?.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  try {
    const anthropic = await client();
    const stream = anthropic.messages.stream({
      model: config.ai.model,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      system: [
        "You answer questions using ONLY the owner's personal notes provided below. This is their private Second Brain.",
        'Cite every claim with the note token(s) it came from, inline, exactly as given: [[note:ID]].',
        'If the notes do not contain the answer, say so plainly — never invent content.',
        'Be concise and direct. Markdown is fine.',
        '',
        '--- NOTES ---',
        contextBlocks.join('\n\n'),
      ].join('\n'),
      messages: [...history, { role: 'user', content: question }],
    });
    const message = await stream.finalMessage();
    const answer = textOf(message);
    // return only the notes actually cited (fall back to all retrieved)
    const citedIds = [...new Set([...answer.matchAll(/\[\[note:(\d+)\]\]/g)].map((m) => Number(m[1])))];
    const pool = new Map(notes.map((n) => [n.id, n]));
    const sources = (citedIds.length ? citedIds : notes.map((n) => n.id))
      .map((id) => pool.get(id))
      .filter(Boolean)
      .map((n) => ({ id: n.id, title: n.title, bucket: n.bucket }));
    res.json({ answer, sources, model: config.ai.model });
  } catch (e) {
    console.error('[ai/chat]', e.message);
    res.status(502).json({ error: `Chat failed: ${e.message}` });
  }
});
