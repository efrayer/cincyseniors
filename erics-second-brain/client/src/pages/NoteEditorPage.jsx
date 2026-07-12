import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, Link } from 'wouter';
import Layout from '../components/Layout.jsx';
import TagInput from '../components/TagInput.jsx';
import { api } from '../api.js';

const BUCKETS = ['inbox', 'project', 'area', 'resource', 'archive'];
const PACKET_TYPES = [
  { value: '', label: '— None —' },
  { value: 'distilled-note', label: 'Distilled Note' },
  { value: 'outtake', label: 'Outtake' },
  { value: 'work-in-process', label: 'Work in Process' },
  { value: 'final-deliverable', label: 'Final Deliverable' },
  { value: 'document-by-other', label: 'Document by Other' },
];

export default function NoteEditorPage() {
  const { id } = useParams();
  const [, navigate] = useLocation();
  const isEdit = Boolean(id);

  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [summaryMd, setSummaryMd] = useState('');
  const [bucket, setBucket] = useState('inbox');
  const [folderId, setFolderId] = useState('');
  const [packetType, setPacketType] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [tags, setTags] = useState([]);
  const [problemIds, setProblemIds] = useState([]);

  const [folders, setFolders] = useState([]);
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [urlFetching, setUrlFetching] = useState(false);

  const urlTimer = useRef(null);

  useEffect(() => {
    api.folders().then(({ folders: f }) => setFolders(f));
    api.problems().then(({ problems: p }) => setProblems(p));
    if (isEdit) {
      api.note(id).then(({ note }) => {
        setTitle(note.title ?? '');
        setBodyMd(note.body_md ?? '');
        setSummaryMd(note.summary_md ?? '');
        setBucket(note.bucket);
        setFolderId(note.folder_id ? String(note.folder_id) : '');
        setPacketType(note.packet_type ?? '');
        setSourceUrl(note.source_url ?? '');
        setTags(note.tags ?? []);
        setProblemIds((note.problems ?? []).map((p) => p.id));
      });
    }
  }, [id, isEdit]);

  async function handleUrlFetch(url) {
    if (!url || !url.startsWith('http')) return;
    setUrlFetching(true);
    try {
      const { title: t, description } = await api.fetchUrl(url);
      if (t && !title) setTitle(t);
      if (description && !bodyMd) setBodyMd(description);
    } catch {
      // ignore
    } finally {
      setUrlFetching(false);
    }
  }

  function onUrlChange(e) {
    const val = e.target.value;
    setSourceUrl(val);
    clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => handleUrlFetch(val), 900);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const body = {
      title, body_md: bodyMd, summary_md: summaryMd,
      bucket, folder_id: folderId ? Number(folderId) : null,
      packet_type: packetType || null,
      source_url: sourceUrl || null,
      tags, problem_ids: problemIds,
    };
    try {
      if (isEdit) {
        await api.updateNote(id, body);
        navigate(`/notes/${id}`);
      } else {
        const { note } = await api.createNote(body);
        navigate(`/notes/${note.id}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const bucketFolders = folders.filter((f) => f.bucket === bucket && bucket !== 'inbox');

  function toggleProblem(pid) {
    setProblemIds((prev) =>
      prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]
    );
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>{isEdit ? 'Edit Note' : 'Capture Note'}</h1>
        {isEdit && <Link href={`/notes/${id}`} className="btn btn-ghost btn-sm">Cancel</Link>}
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
          {/* Left: main content */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label>Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Note title…"
                autoFocus={!isEdit}
              />
            </div>

            <div className="form-group">
              <label>Source URL</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="url"
                  value={sourceUrl}
                  onChange={onUrlChange}
                  placeholder="https://…"
                  style={{ flex: 1 }}
                />
                {urlFetching && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Fetching…</span>}
              </div>
            </div>

            <div className="form-group">
              <label>Body (Markdown)</label>
              <textarea
                value={bodyMd}
                onChange={(e) => setBodyMd(e.target.value)}
                placeholder="Write your note in Markdown. Use **bold** for Layer 2, ==highlight== for Layer 3."
                style={{ minHeight: 280, fontFamily: 'monospace', fontSize: '0.9rem' }}
              />
            </div>

            <div className="form-group">
              <label>Summary (Layer 4 — optional)</label>
              <textarea
                value={summaryMd}
                onChange={(e) => setSummaryMd(e.target.value)}
                placeholder="Executive summary in your own words…"
                style={{ minHeight: 80 }}
              />
            </div>

            <div className="form-group">
              <label>Tags</label>
              <TagInput tags={tags} onChange={setTags} />
            </div>

            {error && <div className="error-msg">{error}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Saving…' : isEdit ? 'Save Changes' : 'Capture Note'}
              </button>
              {isEdit && (
                <Link href={`/notes/${id}`} className="btn btn-ghost">Cancel</Link>
              )}
            </div>
          </div>

          {/* Right: metadata */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label>Bucket</label>
                  <select value={bucket} onChange={(e) => { setBucket(e.target.value); setFolderId(''); }}>
                    {BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                {bucketFolders.length > 0 && (
                  <div className="form-group">
                    <label>Folder</label>
                    <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                      <option value="">— No folder —</option>
                      {bucketFolders.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label>Packet Type</label>
                  <select value={packetType} onChange={(e) => setPacketType(e.target.value)}>
                    {PACKET_TYPES.map((pt) => (
                      <option key={pt.value} value={pt.value}>{pt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {problems.length > 0 && (
              <div className="card">
                <h3 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Link to Problems
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {problems.map((p) => (
                    <label key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: '0.88rem' }}>
                      <input
                        type="checkbox"
                        checked={problemIds.includes(p.id)}
                        onChange={() => toggleProblem(p.id)}
                        style={{ marginTop: 2, flexShrink: 0 }}
                      />
                      <span>{p.question}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </form>
    </Layout>
  );
}
