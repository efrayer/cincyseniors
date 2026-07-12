import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import Layout, { BucketBadge } from '../components/Layout.jsx';
import { api } from '../api.js';

export default function SearchPage() {
  const [location] = useLocation();
  const qParam = new URLSearchParams(location.includes('?') ? location.split('?')[1] : '').get('q') ?? '';
  const [query, setQuery] = useState(qParam);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);

  function doSearch(q) {
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    api.search(q)
      .then(({ notes }) => setResults(notes))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (qParam) doSearch(qParam);
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => doSearch(val), 350);
  }

  function handleSubmit(e) {
    e.preventDefault();
    clearTimeout(timer.current);
    doSearch(query);
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>Search</h1>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <input
          type="search"
          value={query}
          onChange={handleChange}
          placeholder="Search notes by content, title, or tag…"
          autoFocus
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary">Search</button>
      </form>

      {loading && <div className="spinner" />}

      {!loading && results !== null && results.length === 0 && (
        <div className="empty-state">
          <div style={{ fontSize: '2rem' }}>🔍</div>
          <p>No results for "{query}".</p>
        </div>
      )}

      {!loading && results?.length > 0 && (
        <div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 14 }}>
            {results.length} result{results.length !== 1 ? 's' : ''}
          </p>
          {results.map((note) => (
            <Link key={note.id} href={`/notes/${note.id}`} style={{ display: 'block', textDecoration: 'none', marginBottom: 10 }}>
              <div className="card"
                onMouseEnter={(e) => e.currentTarget.style.boxShadow = 'var(--shadow-lg)'}
                onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'var(--shadow)'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <h3 style={{ fontSize: '1rem', color: 'var(--heading)', fontWeight: 600, flex: 1 }}>
                    {note.title}
                  </h3>
                  <BucketBadge bucket={note.bucket} />
                </div>
                {note.snippet && (
                  <p
                    style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}
                    dangerouslySetInnerHTML={{ __html: note.snippet }}
                  />
                )}
                {note.tags?.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {note.tags.map((t) => (
                      <span key={t} className="tag">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {!loading && results === null && !query && (
        <div>
          <TagCloud />
        </div>
      )}
    </Layout>
  );
}

function TagCloud() {
  const [tags, setTags] = useState([]);
  useEffect(() => { api.tags().then(({ tags: t }) => setTags(t)); }, []);
  if (!tags.length) return null;
  return (
    <div>
      <h3 style={{ fontSize: '0.9rem', color: 'var(--heading)', fontWeight: 700, marginBottom: 12 }}>Browse by Tag</h3>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {tags.map((t) => (
          <Link key={t.name} href={`/notes?tag=${encodeURIComponent(t.name)}`} className="tag">
            {t.name} <span style={{ opacity: 0.6 }}>({t.note_count})</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
