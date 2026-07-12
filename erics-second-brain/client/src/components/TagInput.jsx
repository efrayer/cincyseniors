import React, { useState, useRef } from 'react';

// Normalize tag: lowercase, replace spaces/special chars with hyphens, max 64 chars
function normalize(tag) {
  return tag.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

export default function TagInput({ tags = [], onChange }) {
  const [input, setInput] = useState('');
  const inputRef = useRef(null);

  function addTag(raw) {
    const tag = normalize(raw);
    if (tag && !tags.includes(tag)) {
      onChange([...tags, tag]);
    }
    setInput('');
  }

  function removeTag(tag) {
    onChange(tags.filter((t) => t !== tag));
  }

  function handleKey(e) {
    if (['Enter', ',', ' '].includes(e.key)) {
      e.preventDefault();
      if (input.trim()) addTag(input.trim());
    } else if (e.key === 'Backspace' && !input && tags.length) {
      removeTag(tags[tags.length - 1]);
    }
  }

  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
        padding: '6px 10px', border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius)', background: 'var(--surface)', cursor: 'text',
        minHeight: 42,
      }}
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag) => (
        <span key={tag} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 'var(--radius-pill)',
          background: 'var(--surface-alt)', border: '1px solid var(--border-strong)',
          fontSize: '0.8rem', color: 'var(--text-muted)',
        }}>
          {tag}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1, padding: 0, fontSize: '1rem' }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => { if (input.trim()) addTag(input.trim()); }}
        placeholder={tags.length === 0 ? 'Add tags (Enter or comma to add)' : ''}
        style={{
          border: 'none', outline: 'none', background: 'transparent',
          fontSize: '0.9rem', color: 'var(--text-primary)', flex: '1 1 120px', minWidth: 80,
          padding: 0,
        }}
      />
    </div>
  );
}
