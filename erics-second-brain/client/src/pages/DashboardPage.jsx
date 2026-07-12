import React, { useState, useEffect } from 'react';
import { Link } from 'wouter';
import Layout, { BucketBadge } from '../components/Layout.jsx';
import NoteCard from '../components/NoteCard.jsx';
import MarkdownRenderer from '../components/MarkdownRenderer.jsx';
import { api } from '../api.js';

function StatCard({ label, value, href }) {
  const content = (
    <div className="card" style={{ textAlign: 'center', padding: '16px 20px' }}>
      <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--brand)' }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
    </div>
  );
  if (href) return <Link href={href} style={{ display: 'block', textDecoration: 'none', flex: 1 }}>{content}</Link>;
  return <div style={{ flex: 1 }}>{content}</div>;
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [resurface, setResurface] = useState(null);
  const [resurfaceLoading, setResurfaceLoading] = useState(false);

  useEffect(() => {
    api.dashboard().then((d) => {
      setData(d);
      setResurface(d.resurfaced);
    });
  }, []);

  async function handleReshuffle() {
    setResurfaceLoading(true);
    try {
      const { resurfaced } = await api.resurface(resurface?.id);
      setResurface(resurfaced);
    } finally {
      setResurfaceLoading(false);
    }
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>Dashboard</h1>
        <Link href="/notes/new" className="btn btn-primary">+ Capture Note</Link>
      </div>

      {!data ? (
        <div className="spinner" />
      ) : (
        <>
          {/* Stats */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
            <StatCard label="Active Projects" value={data.stats.active_projects} href="/notes?bucket=project" />
            <StatCard label="Inbox" value={data.stats.inbox_count} href="/notes?bucket=inbox" />
            <StatCard label="Notes This Week" value={data.stats.notes_this_week} />
            <StatCard label="Total Notes" value={data.stats.total_notes} href="/notes" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 24, alignItems: 'start' }}>
            {/* Recent captures */}
            <div>
              <h2 style={{ fontSize: '1rem', color: 'var(--heading)', marginBottom: 12, fontWeight: 700 }}>Recent Captures</h2>
              {data.recent.length === 0 ? (
                <div className="empty-state">
                  <div style={{ fontSize: '2rem' }}>📝</div>
                  <p>No notes yet. <Link href="/notes/new">Capture your first note.</Link></p>
                </div>
              ) : (
                data.recent.map((note) => <NoteCard key={note.id} note={note} />)
              )}
            </div>

            {/* Right column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Serendipity */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <h2 style={{ fontSize: '1rem', color: 'var(--heading)', fontWeight: 700 }}>Resurfaced</h2>
                  <button className="btn btn-ghost btn-sm" onClick={handleReshuffle} disabled={resurfaceLoading}>
                    {resurfaceLoading ? '…' : '🔀 Another'}
                  </button>
                </div>
                {resurface ? (
                  <div className="card">
                    <Link href={`/notes/${resurface.id}`} style={{ color: 'var(--heading)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                      {resurface.title}
                    </Link>
                    <BucketBadge bucket={resurface.bucket} />
                    {resurface.summary_md && (
                      <div className="summary-block" style={{ marginTop: 10 }}>
                        <h4>Summary</h4>
                        <MarkdownRenderer md={resurface.summary_md} />
                      </div>
                    )}
                    {!resurface.summary_md && resurface.body_md && (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 8 }}>
                        {resurface.body_md.slice(0, 180).replace(/[#*`_>~]/g, '')}…
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="card" style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '24px' }}>
                    No notes to resurface yet.
                  </div>
                )}
              </div>

              {/* Active projects */}
              {data.active_projects.length > 0 && (
                <div>
                  <h2 style={{ fontSize: '1rem', color: 'var(--heading)', fontWeight: 700, marginBottom: 10 }}>Active Projects</h2>
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {data.active_projects.map((p, i) => (
                      <Link key={p.id} href={`/notes?bucket=project&folder_id=${p.id}`} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '11px 16px', borderBottom: i < data.active_projects.length - 1 ? '1px solid var(--border)' : 'none',
                        textDecoration: 'none', color: 'var(--text-primary)',
                      }}>
                        <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{p.name}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.note_count} notes</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}
