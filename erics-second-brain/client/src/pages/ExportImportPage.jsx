import React, { useState, useRef } from 'react';
import Layout from '../components/Layout.jsx';
import { api } from '../api.js';

export default function ExportImportPage() {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const fileRef = useRef(null);

  async function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('This will replace all your current data. Are you sure?')) {
      fileRef.current.value = '';
      return;
    }
    setImporting(true);
    setImportError('');
    setImportResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const result = await api.importJson(data);
      setImportResult(result);
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
      fileRef.current.value = '';
    }
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>Export & Import</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20, maxWidth: 800 }}>
        {/* JSON Export */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', color: 'var(--heading)', fontWeight: 700, marginBottom: 8 }}>
            📦 Export JSON
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Full backup — all notes, folders, tags, problems, and progressive summarization data in a single JSON file.
          </p>
          <a
            href={api.exportJsonUrl()}
            download="second-brain-export.json"
            className="btn btn-primary"
          >
            Download JSON
          </a>
        </div>

        {/* Markdown Export */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', color: 'var(--heading)', fontWeight: 700, marginBottom: 8 }}>
            📝 Export Markdown
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            All notes as Markdown files in a zip, organized by PARA bucket with YAML frontmatter. Compatible with Obsidian and other tools.
          </p>
          <a
            href={api.exportMarkdownUrl()}
            download="second-brain-markdown.zip"
            className="btn btn-ghost"
          >
            Download Markdown ZIP
          </a>
        </div>

        {/* Import */}
        <div className="card">
          <h2 style={{ fontSize: '1rem', color: 'var(--heading)', fontWeight: 700, marginBottom: 8 }}>
            ⬆️ Import JSON
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            Restore from a previously exported JSON file. <strong style={{ color: 'var(--danger)' }}>This replaces all current data.</strong>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            disabled={importing}
            style={{ display: 'none' }}
            id="import-file"
          />
          <label htmlFor="import-file" className="btn btn-danger" style={{ cursor: 'pointer', display: 'inline-flex' }}>
            {importing ? 'Importing…' : 'Choose JSON file'}
          </label>

          {importResult && (
            <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(26,118,77,0.08)', border: '1px solid rgba(26,118,77,0.3)', borderRadius: 'var(--radius)', fontSize: '0.88rem' }}>
              ✅ Import complete:
              {importResult.imported && (
                <ul style={{ marginTop: 6, paddingLeft: '1.2em' }}>
                  {Object.entries(importResult.imported).map(([k, v]) => (
                    <li key={k}>{v} {k}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {importError && <div className="error-msg" style={{ marginTop: 12 }}>{importError}</div>}
        </div>
      </div>

      {/* Progressive Summarization conventions reminder */}
      <div className="card" style={{ marginTop: 28, maxWidth: 600 }}>
        <h3 style={{ fontSize: '0.9rem', color: 'var(--heading)', fontWeight: 700, marginBottom: 10 }}>
          📖 Markdown Format Conventions
        </h3>
        <table style={{ fontSize: '0.88rem', borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 12px 4px 0', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>Layer</th>
              <th style={{ textAlign: 'left', padding: '4px 12px 4px 0', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>Syntax</th>
              <th style={{ textAlign: 'left', padding: '4px 0', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>Meaning</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Layer 1', 'Plain text', 'Raw captured notes'],
              ['Layer 2', '**bold**', 'Key passages (bold)'],
              ['Layer 3', '==highlight==', 'Most important fragments'],
              ['Layer 4', 'summary_md field', 'Executive summary'],
            ].map(([layer, syntax, meaning]) => (
              <tr key={layer}>
                <td style={{ padding: '6px 12px 6px 0', color: 'var(--text-muted)' }}>{layer}</td>
                <td style={{ padding: '6px 12px 6px 0', fontFamily: 'monospace' }}>{syntax}</td>
                <td style={{ padding: '6px 0' }}>{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
