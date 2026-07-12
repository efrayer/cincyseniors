import React, { useState, useEffect } from 'react';
import { useParams, useLocation, Link } from 'wouter';
import Layout, { BucketBadge } from '../components/Layout.jsx';
import MarkdownRenderer from '../components/MarkdownRenderer.jsx';
import NoteCard from '../components/NoteCard.jsx';
import Modal from '../components/Modal.jsx';
import { api } from '../api.js';
import { useAi } from '../App.jsx';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function NoteDetailPage() {
  const { id } = useParams();
  const [, navigate] = useLocation();
  const { enabled: aiEnabled } = useAi();

  const [note, setNote] = useState(null);
  const [folder, setFolder] = useState(null);
  const [related, setRelated] = useState([]);
  const [error, setError] = useState('');
  const [deleteModal, setDeleteModal] = useState(false);
  const [moveModal, setMoveModal] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [folders, setFolders] = useState([]);
  const [moveBucket, setMoveBucket] = useState('');
  const [moveFolderId, setMoveFolderId] = useState('');

  useEffect(() => {
    setNote(null);
    setAiSuggestions(null);
    api.note(id).then(({ note: n, folder: f }) => {
      setNote(n);
      setFolder(f);
      setMoveBucket(n.bucket);
    });
    api.relatedNotes(id).then(({ related: r }) => setRelated(r));
    api.folders().then(({ folders: f }) => setFolders(f));
  }, [id]);

  async function handleDelete() {
    await api.deleteNote(id);
    navigate('/notes');
  }

  async function handleMove(e) {
    e.preventDefault();
    await api.moveNote(id, moveBucket, moveFolderId || null);
    const { note: n, folder: f } = await api.note(id);
    setNote(n);
    setFolder(f);
    setMoveModal(false);
  }

  async function handleAiDistill() {
    setAiLoading(true);
    setAiSuggestions(null);
    try {
      const result = await api.aiDistill(id);
      setAiSuggestions(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setAiLoading(false);
    }
  }

  async function applyAiSuggestions() {
    if (!aiSuggestions || !note) return;
    let body = note.body_md;
    for (const passage of aiSuggestions.bold_passages ?? []) {
      body = body.replaceAll(passage, `**${passage}**`);
    }
    const updated = await api.updateNote(id, {
      body_md: body,
      summary_md: aiSuggestions.summary || note.summary_md,
    });
    setNote(updated.note);
    setAiSuggestions(null);
  }

  if (!note) return <Layout><div className="spinner" /></Layout>;

  const bucketFolders = folders.filter((f) => f.bucket === moveBucket);

  return (
    <Layout>
      {/* Breadcrumb */}
      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        <Link href="/notes">Notes</Link>
        {folder && (
          <>
            <span>/</span>
            <Link href={`/notes?bucket=${note.bucket}&folder_id=${folder.id}`}>{folder.name}</Link>
          </>
        )}
        <span>/</span>
        <span style={{ color: 'var(--text-primary)' }}>{note.title}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
        {/* Main note */}
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '1.5rem', color: 'var(--heading)', flex: 1 }}>{note.title}</h1>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
              <Link href={`/notes/${id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
              <button className="btn btn-ghost btn-sm" onClick={() => setMoveModal(true)}>Move</button>
              <button className="btn btn-danger btn-sm" onClick={() => setDeleteModal(true)}>Delete</button>
            </div>
          </div>

          {/* Meta */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
            <BucketBadge bucket={note.bucket} />
            {folder && <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>📁 {folder.name}</span>}
            {note.packet_type && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', background: 'var(--surface-alt)', padding: '2px 8px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border-strong)' }}>
                {note.packet_type}
              </span>
            )}
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Created {formatDate(note.created_at)}</span>
            {note.source_url && (
              <a href={note.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.78rem' }}>
                Source ↗
              </a>
            )}
          </div>

          {/* Tags */}
          {note.tags?.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {note.tags.map((t) => (
                <Link key={t} href={`/notes?tag=${encodeURIComponent(t)}`} className="tag">{t}</Link>
              ))}
            </div>
          )}

          {/* Linked problems */}
          {note.problems?.length > 0 && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: 'rgba(200,149,42,0.07)', border: '1px solid rgba(200,149,42,0.3)', borderRadius: 'var(--radius)' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}>💡 Linked to: </span>
              {note.problems.map((p, i) => (
                <React.Fragment key={p.id}>
                  {i > 0 && ', '}
                  <Link href={`/problems/${p.id}`} style={{ fontSize: '0.82rem' }}>{p.question}</Link>
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Layer 4: Summary */}
          {note.summary_md && (
            <div className="summary-block" style={{ marginBottom: 20 }}>
              <h4>Summary (Layer 4)</h4>
              <MarkdownRenderer md={note.summary_md} />
            </div>
          )}

          {/* Body */}
          <div className="card" style={{ marginBottom: 16 }}>
            {note.body_md ? (
              <MarkdownRenderer md={note.body_md} />
            ) : (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No body content.</p>
            )}
          </div>

          {/* AI Distill Assist */}
          {aiEnabled && (
            <div style={{ marginBottom: 16 }}>
              {!aiSuggestions ? (
                <button className="btn btn-ghost btn-sm" onClick={handleAiDistill} disabled={aiLoading}>
                  {aiLoading ? '🤖 Thinking…' : '✨ AI Distill Assist'}
                </button>
              ) : (
                <div className="card" style={{ borderColor: 'rgba(200,149,42,0.4)' }}>
                  <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '0.9rem', color: 'var(--accent)', fontWeight: 700 }}>AI Suggestions</h3>
                    <button className="btn btn-ghost btn-sm" onClick={() => setAiSuggestions(null)}>Dismiss</button>
                  </div>
                  {aiSuggestions.summary && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>Suggested summary:</div>
                      <p style={{ fontSize: '0.9rem' }}>{aiSuggestions.summary}</p>
                    </div>
                  )}
                  {aiSuggestions.bold_passages?.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>Passages to bold:</div>
                      {aiSuggestions.bold_passages.map((p, i) => (
                        <div key={i} style={{ padding: '4px 0', fontSize: '0.88rem', borderBottom: '1px solid var(--border)' }}>"{p}"</div>
                      ))}
                    </div>
                  )}
                  <button className="btn btn-accent btn-sm" onClick={applyAiSuggestions}>Apply suggestions</button>
                </div>
              )}
            </div>
          )}

          {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
        </div>

        {/* Related notes sidebar */}
        <div>
          <h3 style={{ fontSize: '0.9rem', color: 'var(--heading)', fontWeight: 700, marginBottom: 12 }}>Related Notes</h3>
          {related.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No related notes found.</p>
          ) : (
            related.map((r) => (
              <div key={r.id} style={{ marginBottom: 8 }}>
                <Link href={`/notes/${r.id}`} style={{ display: 'block', textDecoration: 'none' }}>
                  <div className="card" style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 500, fontSize: '0.9rem', color: 'var(--heading)', marginBottom: 4 }}>{r.title}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <BucketBadge bucket={r.bucket} />
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.why?.join(', ')}</span>
                    </div>
                  </div>
                </Link>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Delete modal */}
      {deleteModal && (
        <Modal title="Delete Note" onClose={() => setDeleteModal(false)}>
          <p style={{ marginBottom: 16 }}>Are you sure you want to delete "<strong>{note.title}</strong>"? This cannot be undone.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={() => setDeleteModal(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
          </div>
        </Modal>
      )}

      {/* Move modal */}
      {moveModal && (
        <Modal title="Move Note" onClose={() => setMoveModal(false)}>
          <form onSubmit={handleMove} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label>Bucket</label>
              <select value={moveBucket} onChange={(e) => { setMoveBucket(e.target.value); setMoveFolderId(''); }}>
                {['inbox', 'project', 'area', 'resource', 'archive'].map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            {moveBucket !== 'inbox' && bucketFolders.length > 0 && (
              <div className="form-group">
                <label>Folder (optional)</label>
                <select value={moveFolderId} onChange={(e) => setMoveFolderId(e.target.value)}>
                  <option value="">— No folder —</option>
                  {bucketFolders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setMoveModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Move</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}
