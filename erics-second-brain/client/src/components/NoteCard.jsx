import React from 'react';
import { Link } from 'wouter';
import { BucketBadge } from './Layout.jsx';

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NoteCard({ note, showBucket = true }) {
  const snippet = note.body_md?.slice(0, 200).replace(/[#*`_>~]/g, '').trim();

  return (
    <Link href={`/notes/${note.id}`} style={{ display: 'block', textDecoration: 'none' }}>
      <div className="card" style={{ marginBottom: 12, cursor: 'pointer', transition: 'box-shadow 0.15s' }}
        onMouseEnter={(e) => e.currentTarget.style.boxShadow = 'var(--shadow-lg)'}
        onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'var(--shadow)'}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <h3 style={{ fontSize: '1rem', color: 'var(--heading)', fontWeight: 600, flex: 1 }}>
            {note.title || 'Untitled'}
          </h3>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {showBucket && <BucketBadge bucket={note.bucket} />}
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {relativeTime(note.updated_at ?? note.created_at)}
            </span>
          </div>
        </div>
        {snippet && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 8 }}>
            {snippet}{note.body_md?.length > 200 ? '…' : ''}
          </p>
        )}
        {note.tags?.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {note.tags.map((t) => (
              <span key={t} className="tag">{t}</span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
