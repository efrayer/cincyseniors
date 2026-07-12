import React, { useEffect } from 'react';

export default function Modal({ title, children, onClose, width = 480 }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)', width: '100%', maxWidth: width,
        maxHeight: '90dvh', overflow: 'auto',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
        }}>
          <h2 style={{ fontSize: '1.05rem', color: 'var(--heading)', fontWeight: 700 }}>{title}</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: 'var(--text-muted)', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: '20px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
