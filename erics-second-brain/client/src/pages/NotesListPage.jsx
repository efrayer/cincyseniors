import React, { useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import Layout, { BucketBadge } from '../components/Layout.jsx';
import NoteCard from '../components/NoteCard.jsx';
import { api } from '../api.js';

const BUCKET_LABELS = {
  inbox: '📥 Inbox',
  project: '🎯 Projects',
  area: '🗂 Areas',
  resource: '📚 Resources',
  archive: '📦 Archive',
};

const PACKET_TYPES = [
  { value: '', label: 'Any type' },
  { value: 'distilled-note', label: 'Distilled Note' },
  { value: 'outtake', label: 'Outtake' },
  { value: 'work-in-process', label: 'Work in Process' },
  { value: 'final-deliverable', label: 'Final Deliverable' },
  { value: 'document-by-other', label: 'Document by Other' },
];

export default function NotesListPage() {
  const [location] = useLocation();
  const params = new URLSearchParams(location.includes('?') ? location.split('?')[1] : '');
  const bucket = params.get('bucket') ?? '';
  const folder_id = params.get('folder_id') ?? '';
  const tag = params.get('tag') ?? '';

  const [notes, setNotes] = useState(null);
  const [folders, setFolders] = useState([]);
  const [packetType, setPacketType] = useState('');

  useEffect(() => {
    setNotes(null);
    api.notes({ bucket, folder_id, tag, packet_type: packetType }).then((d) => setNotes(d.notes));
    api.folders().then((d) => setFolders(d.folders));
  }, [bucket, folder_id, tag, packetType]);

  const folder = folders.find((f) => String(f.id) === String(folder_id));

  function pageTitle() {
    if (tag) return `#${tag}`;
    if (folder) return folder.name;
    if (bucket) return BUCKET_LABELS[bucket] ?? bucket;
    return 'All Notes';
  }

  // Group by folder for bucket views
  const grouped = React.useMemo(() => {
    if (!notes || folder_id || tag) return null;
    if (!bucket) return null;
    const byFolder = {};
    const noFolder = [];
    for (const n of notes) {
      if (n.folder_id) {
        (byFolder[n.folder_id] = byFolder[n.folder_id] ?? []).push(n);
      } else {
        noFolder.push(n);
      }
    }
    return { byFolder, noFolder };
  }, [notes, folder_id, tag, bucket]);

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h1>{pageTitle()}</h1>
          {folder?.outcome && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
              Outcome: {folder.outcome}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={packetType}
            onChange={(e) => setPacketType(e.target.value)}
            style={{ width: 'auto', padding: '6px 10px', fontSize: '0.85rem' }}
          >
            {PACKET_TYPES.map((pt) => (
              <option key={pt.value} value={pt.value}>{pt.label}</option>
            ))}
          </select>
          <Link href="/notes/new" className="btn btn-primary">+ Capture</Link>
        </div>
      </div>

      {notes === null ? (
        <div className="spinner" />
      ) : notes.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '2rem' }}>📭</div>
          <p>No notes here yet.</p>
          <Link href="/notes/new" className="btn btn-primary" style={{ marginTop: 16 }}>Capture a note</Link>
        </div>
      ) : grouped ? (
        // Grouped view by folder
        <>
          {grouped.noFolder.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Unfiled ({grouped.noFolder.length})
              </h3>
              {grouped.noFolder.map((n) => <NoteCard key={n.id} note={n} showBucket={false} />)}
            </div>
          )}
          {Object.entries(grouped.byFolder).map(([fid, fnotes]) => {
            const f = folders.find((x) => String(x.id) === String(fid));
            return (
              <div key={fid} style={{ marginBottom: 24 }}>
                <Link
                  href={`/notes?bucket=${bucket}&folder_id=${fid}`}
                  style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}
                >
                  📁 {f?.name ?? 'Folder'} ({fnotes.length})
                </Link>
                {fnotes.map((n) => <NoteCard key={n.id} note={n} showBucket={false} />)}
              </div>
            );
          })}
        </>
      ) : (
        notes.map((n) => <NoteCard key={n.id} note={n} showBucket={!bucket && !folder_id} />)
      )}
    </Layout>
  );
}
