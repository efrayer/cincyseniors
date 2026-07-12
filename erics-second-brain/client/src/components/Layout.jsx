import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { api } from '../api.js';
import { useAuth, useAi } from '../App.jsx';

const BUCKET_LABELS = {
  inbox: 'Inbox',
  project: 'Projects',
  area: 'Areas',
  resource: 'Resources',
  archive: 'Archive',
};

export default function Layout({ children }) {
  const { setAuthed } = useAuth();
  const { enabled: aiEnabled } = useAi();
  const [location] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await api.logout().catch(() => {});
    setAuthed(false);
  }

  function navLink(href, label, exact = false) {
    const active = exact ? location === href : location.startsWith(href);
    return (
      <Link
        href={href}
        style={{
          display: 'block', padding: '7px 14px',
          borderRadius: 'var(--radius)',
          fontWeight: active ? 700 : 400,
          background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
          color: active ? '#fff' : 'var(--chrome-muted)',
          fontSize: '0.9rem',
          transition: 'background 0.12s',
        }}
        onClick={() => setMenuOpen(false)}
      >
        {label}
      </Link>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100dvh', flexDirection: 'column' }}>
      {/* Top chrome */}
      <header style={{
        background: 'var(--chrome-deep)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '0 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 52, flexShrink: 0,
      }}>
        <Link href="/" style={{ color: '#fff', fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          🧠 <span>Second Brain</span>
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link href="/search" style={{ color: 'var(--chrome-muted)', padding: '6px 10px', borderRadius: 'var(--radius)', fontSize: '0.9rem' }}>
            🔍 Search
          </Link>
          <Link href="/notes/new" style={{
            background: 'var(--accent)', color: '#fff', padding: '5px 12px',
            borderRadius: 'var(--radius)', fontWeight: 600, fontSize: '0.85rem',
          }}>
            + Capture
          </Link>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--chrome-muted)', cursor: 'pointer', fontSize: '1.3rem', padding: '4px 6px' }}
            aria-label="Menu"
          >
            ☰
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <nav style={{
          width: menuOpen ? 220 : 0,
          overflow: 'hidden',
          transition: 'width 0.2s',
          background: 'var(--chrome-bg)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          paddingTop: menuOpen ? 12 : 0,
        }}>
          {menuOpen && (
            <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {navLink('/', '🏠 Dashboard', true)}
              <div style={{ color: 'var(--chrome-muted)', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '10px 14px 4px' }}>
                PARA
              </div>
              {navLink('/notes?bucket=inbox', '📥 Inbox')}
              {navLink('/notes?bucket=project', '🎯 Projects')}
              {navLink('/notes?bucket=area', '🗂 Areas')}
              {navLink('/notes?bucket=resource', '📚 Resources')}
              {navLink('/notes?bucket=archive', '📦 Archive')}
              {navLink('/folders', '🗄 Folders')}
              <div style={{ color: 'var(--chrome-muted)', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '10px 14px 4px' }}>
                Tools
              </div>
              {navLink('/problems', '💡 12 Problems')}
              {navLink('/distill', '✨ Distill')}
              {aiEnabled && navLink('/chat', '🤖 Chat')}
              {navLink('/export', '⬇️ Export/Import')}
              <div style={{ flex: 1 }} />
              <button
                onClick={handleLogout}
                style={{ margin: '12px 8px', background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 'var(--radius)', color: 'var(--chrome-muted)', cursor: 'pointer', padding: '8px', fontSize: '0.85rem' }}
              >
                Sign out
              </button>
            </div>
          )}
        </nav>

        {/* Main content */}
        <main style={{ flex: 1, overflow: 'auto', padding: '24px 28px', maxWidth: '100%' }}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function BucketBadge({ bucket }) {
  return <span className={`bucket-badge bucket-${bucket}`}>{BUCKET_LABELS[bucket] ?? bucket}</span>;
}
