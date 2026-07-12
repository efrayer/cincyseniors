import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'wouter';
import Layout from '../components/Layout.jsx';
import NoteCard from '../components/NoteCard.jsx';
import Modal from '../components/Modal.jsx';
import { api } from '../api.js';

export default function ProblemsPage() {
  const { id } = useParams();
  const [problems, setProblems] = useState([]);
  const [selected, setSelected] = useState(null); // { problem, notes }
  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { problems: p } = await api.problems();
    setProblems(p);
    setLoading(false);
    if (id) {
      const data = await api.problem(id);
      setSelected(data);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function handleDelete(pid, question) {
    if (!confirm(`Delete problem "${question}"?`)) return;
    await api.deleteProblem(pid);
    if (selected?.problem?.id === pid) setSelected(null);
    load();
  }

  async function handleSelect(p) {
    const data = await api.problem(p.id);
    setSelected(data);
  }

  return (
    <Layout>
      <div className="page-header">
        <div>
          <h1>12 Favorite Problems</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            Richard Feynman: "You have to keep a dozen of your favorite problems constantly present in your mind."
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateModal(true)}>+ Add Problem</button>
      </div>

      {loading ? (
        <div className="spinner" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '300px 1fr' : '1fr', gap: 24, alignItems: 'start' }}>
          {/* Problem list */}
          <div>
            {problems.length === 0 ? (
              <div className="empty-state">
                <div style={{ fontSize: '2rem' }}>💡</div>
                <p>No problems yet. Add your 12 favorite open questions.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {problems.map((p, i) => (
                  <div
                    key={p.id}
                    className="card"
                    style={{
                      padding: '12px 16px', cursor: 'pointer',
                      borderColor: selected?.problem?.id === p.id ? 'var(--brand)' : 'var(--border)',
                    }}
                    onClick={() => handleSelect(p)}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0, minWidth: 20 }}>
                        {i + 1}.
                      </span>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: '0.9rem', fontWeight: 500 }}>{p.question}</p>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{p.note_count} linked notes</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => { e.stopPropagation(); setEditModal(p); }}
                        >Edit</button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={(e) => { e.stopPropagation(); handleDelete(p.id, p.question); }}
                        >×</button>
                      </div>
                    </div>
                  </div>
                ))}
                {problems.length > 12 && (
                  <p style={{ fontSize: '0.82rem', color: 'var(--accent)', padding: '4px 0' }}>
                    ⚠️ You have {problems.length} problems — consider retiring some to keep it at 12.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Selected problem notes */}
          {selected && (
            <div>
              <h2 style={{ fontSize: '1.05rem', color: 'var(--heading)', fontWeight: 700, marginBottom: 16 }}>
                "{selected.problem.question}"
              </h2>
              {selected.notes.length === 0 ? (
                <div className="empty-state">
                  <div style={{ fontSize: '1.5rem' }}>📎</div>
                  <p>No notes linked yet. Edit a note and link it to this problem.</p>
                </div>
              ) : (
                selected.notes.map((n) => <NoteCard key={n.id} note={n} />)
              )}
            </div>
          )}
        </div>
      )}

      {createModal && (
        <ProblemModal
          onClose={() => setCreateModal(false)}
          onSaved={() => { setCreateModal(false); load(); }}
        />
      )}
      {editModal && (
        <ProblemModal
          problem={editModal}
          onClose={() => setEditModal(null)}
          onSaved={() => { setEditModal(null); load(); }}
        />
      )}
    </Layout>
  );
}

function ProblemModal({ problem, onClose, onSaved }) {
  const [question, setQuestion] = useState(problem?.question ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (problem) {
        await api.updateProblem(problem.id, { question });
      } else {
        await api.createProblem({ question });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={problem ? 'Edit Problem' : 'Add Problem'} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="form-group">
          <label>Question</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What is a question you keep coming back to?"
            required
            autoFocus
            style={{ minHeight: 80 }}
          />
        </div>
        {error && <div className="error-msg">{error}</div>}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Saving…' : problem ? 'Save' : 'Add Problem'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
