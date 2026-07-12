import React, { useState, useEffect } from 'react';
import { Link } from 'wouter';
import Layout, { BucketBadge } from '../components/Layout.jsx';
import Modal from '../components/Modal.jsx';
import { api } from '../api.js';

const BUCKETS = ['project', 'area', 'resource', 'archive'];
const STATUSES = ['active', 'completed', 'on_hold'];
const BUCKET_ICONS = { project: '🎯', area: '🗂', resource: '📚', archive: '📦' };

export default function FoldersPage() {
  const [folders, setFolders] = useState([]);
  const [bucketCounts, setBucketCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [createModal, setCreateModal] = useState(false);
  const [editFolder, setEditFolder] = useState(null);

  async function load() {
    const { folders: f, bucket_counts: bc } = await api.folders();
    setFolders(f);
    setBucketCounts(bc);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleArchive(id, name) {
    if (!confirm(`Archive folder "${name}" and all its notes?`)) return;
    await api.archiveFolder(id);
    load();
  }

  async function handleDelete(id, name) {
    if (!confirm(`Delete empty folder "${name}"?`)) return;
    try {
      await api.deleteFolder(id);
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  const grouped = BUCKETS.reduce((acc, b) => {
    acc[b] = folders.filter((f) => f.bucket === b);
    return acc;
  }, {});

  return (
    <Layout>
      <div className="page-header">
        <h1>Folders</h1>
        <button className="btn btn-primary" onClick={() => setCreateModal(true)}>+ New Folder</button>
      </div>

      {loading ? (
        <div className="spinner" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {BUCKETS.map((bucket) => (
            <div key={bucket}>
              <h2 style={{ fontSize: '1rem', color: 'var(--heading)', fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                {BUCKET_ICONS[bucket]} {bucket.charAt(0).toUpperCase() + bucket.slice(1)}s
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                  ({bucketCounts[bucket] ?? 0} notes)
                </span>
              </h2>
              {grouped[bucket].length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', padding: '8px 0' }}>No folders yet.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                  {grouped[bucket].map((f) => (
                    <div key={f.id} className="card" style={{ padding: '14px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <Link href={`/notes?bucket=${f.bucket}&folder_id=${f.id}`} style={{ color: 'var(--heading)', fontWeight: 600, fontSize: '0.95rem', flex: 1 }}>
                          {f.name}
                        </Link>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>{f.note_count} notes</span>
                      </div>
                      {f.outcome && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
                          {f.outcome}
                        </p>
                      )}
                      {f.status && (
                        <span style={{
                          display: 'inline-block', marginTop: 6, padding: '1px 8px',
                          borderRadius: 'var(--radius-pill)', fontSize: '0.72rem', fontWeight: 600,
                          background: f.status === 'active' ? 'rgba(26,118,77,0.1)' : 'var(--surface-alt)',
                          color: f.status === 'active' ? 'var(--c-resource)' : 'var(--text-muted)',
                          border: '1px solid var(--border-strong)',
                        }}>
                          {f.status.replace('_', ' ')}
                        </span>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditFolder(f)}>Edit</button>
                        {f.bucket !== 'archive' && (
                          <button className="btn btn-ghost btn-sm" onClick={() => handleArchive(f.id, f.name)}>Archive</button>
                        )}
                        {f.note_count === 0 && (
                          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(f.id, f.name)}>Delete</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(createModal || editFolder) && (
        <FolderModal
          folder={editFolder}
          onClose={() => { setCreateModal(false); setEditFolder(null); }}
          onSaved={() => { setCreateModal(false); setEditFolder(null); load(); }}
        />
      )}
    </Layout>
  );
}

function FolderModal({ folder, onClose, onSaved }) {
  const [name, setName] = useState(folder?.name ?? '');
  const [bucket, setBucket] = useState(folder?.bucket ?? 'resource');
  const [outcome, setOutcome] = useState(folder?.outcome ?? '');
  const [status, setStatus] = useState(folder?.status ?? 'active');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const body = { name, bucket, outcome: outcome || null, status: bucket === 'project' ? status : null };
    try {
      if (folder) {
        await api.updateFolder(folder.id, body);
      } else {
        await api.createFolder(body);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={folder ? 'Edit Folder' : 'New Folder'} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-group">
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div className="form-group">
          <label>Bucket</label>
          <select value={bucket} onChange={(e) => setBucket(e.target.value)}>
            {BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        {bucket === 'project' && (
          <>
            <div className="form-group">
              <label>Outcome (optional)</label>
              <input type="text" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What does done look like?" />
            </div>
            <div className="form-group">
              <label>Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
          </>
        )}
        {error && <div className="error-msg">{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving…' : folder ? 'Save Changes' : 'Create Folder'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
