// Base path is baked in at build time via Vite's import.meta.env.BASE_URL.
// Strip trailing slash so we can always write `base + '/api/...'`.
const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

async function req(method, path, body) {
  const opts = {
    method,
    credentials: 'same-origin',
    headers: {},
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(base + path, opts);
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  // Auth
  login: (username, password) => req('POST', '/api/auth/login', { username, password }),
  logout: () => req('POST', '/api/auth/logout'),
  me: () => req('GET', '/api/auth/me'),

  // Dashboard
  dashboard: () => req('GET', '/api/dashboard'),
  resurface: (not) => req('GET', `/api/dashboard/resurface${not ? `?not=${not}` : ''}`),

  // Notes
  notes: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
    ).toString();
    return req('GET', `/api/notes${qs ? '?' + qs : ''}`);
  },
  note: (id) => req('GET', `/api/notes/${id}`),
  relatedNotes: (id) => req('GET', `/api/notes/${id}/related`),
  createNote: (body) => req('POST', '/api/notes', body),
  updateNote: (id, body) => req('PUT', `/api/notes/${id}`, body),
  moveNote: (id, bucket, folder_id) => req('POST', `/api/notes/${id}/move`, { bucket, folder_id }),
  deleteNote: (id) => req('DELETE', `/api/notes/${id}`),

  // Folders
  folders: () => req('GET', '/api/folders'),
  createFolder: (body) => req('POST', '/api/folders', body),
  updateFolder: (id, body) => req('PUT', `/api/folders/${id}`, body),
  archiveFolder: (id) => req('POST', `/api/folders/${id}/archive`),
  deleteFolder: (id) => req('DELETE', `/api/folders/${id}`),

  // Tags
  tags: () => req('GET', '/api/tags'),

  // Search
  search: (q) => req('GET', `/api/search?q=${encodeURIComponent(q)}`),

  // Favorite Problems
  problems: () => req('GET', '/api/problems'),
  problem: (id) => req('GET', `/api/problems/${id}`),
  createProblem: (body) => req('POST', '/api/problems', body),
  updateProblem: (id, body) => req('PUT', `/api/problems/${id}`, body),
  deleteProblem: (id) => req('DELETE', `/api/problems/${id}`),

  // Fetch URL
  fetchUrl: (url) => req('POST', '/api/fetch-url', { url }),

  // Export / Import
  exportJsonUrl: () => base + '/api/export/json',
  exportMarkdownUrl: () => base + '/api/export/markdown',
  importJson: (data) => req('POST', '/api/import', data),

  // Distill view
  distill: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
    ).toString();
    return req('GET', `/api/distill${qs ? '?' + qs : ''}`);
  },

  // AI
  aiStatus: () => req('GET', '/api/ai/status'),
  aiDistill: (note_id) => req('POST', '/api/ai/distill', { note_id }),
  aiChat: (question, history) => req('POST', '/api/ai/chat', { question, history }),
};
