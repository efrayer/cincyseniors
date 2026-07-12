import React, { useState, useEffect } from 'react';
import { Link } from 'wouter';
import Layout, { BucketBadge } from '../components/Layout.jsx';
import MarkdownRenderer from '../components/MarkdownRenderer.jsx';
import { api } from '../api.js';

const LAYERS = [
  { value: 'summary', label: 'Layer 4 — Summaries', icon: '📋', desc: 'Notes with an executive summary written.' },
  { value: 'highlight', label: 'Layer 3 — Highlights', icon: '🟡', desc: 'Notes with ==highlighted== passages.' },
  { value: 'bold', label: 'Layer 2 — Bold', icon: '✏️', desc: 'Notes with **bolded** key passages.' },
];

const BUCKETS = ['', 'inbox', 'project', 'area', 'resource', 'archive'];

export default function DistillPage() {
  const [layer, setLayer] = useState('summary');
  const [bucket, setBucket] = useState('');
  const [items, setItems] = useState(null);
  const [scanned, setScanned] = useState(0);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const result = await api.distill({ layer, bucket });
    setItems(result.items);
    setScanned(result.scanned);
    setLoading(false);
  }

  useEffect(() => { load(); }, [layer, bucket]);

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h1>Distill View</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            Skim the essence of many notes at once — Progressive Summarization layers.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {LAYERS.map((l) => (
            <button
              key={l.value}
              className={`btn ${layer === l.value ? 'btn-primary' : 'btn-ghost'} btn-sm`}
              onClick={() => setLayer(l.value)}
            >
              {l.icon} {l.label}
            </button>
          ))}
        </div>
        <select
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          style={{ width: 'auto', padding: '6px 10px', fontSize: '0.85rem' }}
        >
          <option value="">All buckets</option>
          {BUCKETS.slice(1).map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="spinner" />
      ) : items === null ? null : (
        <>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            {items.length} notes with {LAYERS.find((l) => l.value === layer)?.desc?.toLowerCase()} (scanned {scanned})
          </p>
          {items.length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: '2rem' }}>{LAYERS.find((l) => l.value === layer)?.icon}</div>
              <p>No notes with this distillation layer yet.</p>
              <p style={{ marginTop: 8, fontSize: '0.85rem' }}>
                {layer === 'summary' && 'Add a summary to a note to see it here.'}
                {layer === 'highlight' && 'Use ==text== to highlight passages in your notes.'}
                {layer === 'bold' && 'Use **text** to bold key passages in your notes.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map((item) => (
                <div key={item.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <Link href={`/notes/${item.id}`} style={{ color: 'var(--heading)', fontWeight: 600, fontSize: '1rem', flex: 1 }}>
                      {item.title}
                    </Link>
                    <BucketBadge bucket={item.bucket} />
                  </div>
                  {item.content && (
                    <div className="summary-block">
                      <h4>Summary</h4>
                      <MarkdownRenderer md={item.content} />
                    </div>
                  )}
                  {item.fragments?.length > 0 && (
                    <ul style={{ paddingLeft: '1.2em', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {item.fragments.map((frag, i) => (
                        <li key={i} style={{ fontSize: '0.9rem' }}>{frag}</li>
                      ))}
                    </ul>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <Link href={`/notes/${item.id}/edit`} className="btn btn-ghost btn-sm">Edit note</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
