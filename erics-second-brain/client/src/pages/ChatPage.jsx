import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'wouter';
import Layout, { BucketBadge } from '../components/Layout.jsx';
import MarkdownRenderer from '../components/MarkdownRenderer.jsx';
import { api } from '../api.js';

export default function ChatPage() {
  const [messages, setMessages] = useState([]); // { role, content, sources? }
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSubmit(e) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;
    setInput('');
    const newMessages = [...messages, { role: 'user', content: question }];
    setMessages(newMessages);
    setLoading(true);
    try {
      // Build history for the API (last 6, text-only)
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const { answer, sources } = await api.aiChat(question, history);
      setMessages([...newMessages, { role: 'assistant', content: answer, sources }]);
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: `Error: ${e.message}`, sources: [] }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function handleClear() {
    if (messages.length && confirm('Clear this conversation?')) {
      setMessages([]);
    }
  }

  // Replace [[note:ID]] citations with links
  function formatAnswer(content) {
    return content.replace(/\[\[note:(\d+)\]\]/g, (_, id) => `[note:${id}](/notes/${id})`);
  }

  return (
    <Layout>
      <div className="page-header">
        <h1>🤖 Chat with my Brain</h1>
        <button className="btn btn-ghost btn-sm" onClick={handleClear} disabled={!messages.length}>
          Clear
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 200px)', minHeight: 400 }}>
        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
          {messages.length === 0 && (
            <div className="empty-state" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🧠</div>
              <p style={{ fontWeight: 600 }}>Ask anything about your notes.</p>
              <p>I'll search your Second Brain and cite my sources.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 8 }}>
              <div style={{
                maxWidth: '80%', padding: '12px 16px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: msg.role === 'user' ? 'var(--brand)' : 'var(--surface)',
                color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                boxShadow: 'var(--shadow)',
              }}>
                {msg.role === 'user' ? (
                  <p style={{ margin: 0 }}>{msg.content}</p>
                ) : (
                  <MarkdownRenderer md={formatAnswer(msg.content)} />
                )}
              </div>
              {msg.sources?.length > 0 && (
                <div style={{ maxWidth: '80%' }}>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>Sources:</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {msg.sources.map((s) => (
                      <Link key={s.id} href={`/notes/${s.id}`} style={{
                        fontSize: '0.78rem', padding: '2px 10px',
                        borderRadius: 'var(--radius-pill)',
                        background: 'var(--surface)', border: '1px solid var(--border-strong)',
                        color: 'var(--link)',
                      }}>
                        {s.title}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <div style={{
                padding: '12px 16px', borderRadius: '16px 16px 16px 4px',
                background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)',
              }}>
                <span style={{ fontSize: '1.1rem' }}>🤖</span> <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Thinking…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your notes…"
            disabled={loading}
            autoFocus
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary" disabled={loading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </Layout>
  );
}
