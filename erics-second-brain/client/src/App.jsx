import React, { useState, useEffect, createContext, useContext } from 'react';
import { Router, Route, Switch, Redirect, useLocation } from 'wouter';
import { api } from './api.js';

import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import NotesListPage from './pages/NotesListPage.jsx';
import NoteDetailPage from './pages/NoteDetailPage.jsx';
import NoteEditorPage from './pages/NoteEditorPage.jsx';
import FoldersPage from './pages/FoldersPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import ProblemsPage from './pages/ProblemsPage.jsx';
import DistillPage from './pages/DistillPage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import ExportImportPage from './pages/ExportImportPage.jsx';

// ── Auth context ──────────────────────────────────────────────────
export const AuthCtx = createContext({ authed: false, setAuthed: () => {} });
export const useAuth = () => useContext(AuthCtx);

// ── AI context (status loaded once) ──────────────────────────────
export const AiCtx = createContext({ enabled: false });
export const useAi = () => useContext(AiCtx);

// Strip the base path prefix for wouter
const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || '/';

export default function App() {
  const [authed, setAuthed] = useState(null); // null = loading
  const [aiStatus, setAiStatus] = useState({ enabled: false });

  useEffect(() => {
    api.me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
    api.aiStatus()
      .then(setAiStatus)
      .catch(() => {});
  }, []);

  if (authed === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh' }}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <AuthCtx.Provider value={{ authed, setAuthed }}>
      <AiCtx.Provider value={aiStatus}>
        <Router base={base === '/' ? '' : base}>
          {authed ? <AppRoutes aiEnabled={aiStatus.enabled} /> : <LoginPage />}
        </Router>
      </AiCtx.Provider>
    </AuthCtx.Provider>
  );
}

function AppRoutes({ aiEnabled }) {
  return (
    <Switch>
      <Route path="/" component={DashboardPage} />
      <Route path="/notes" component={NotesListPage} />
      <Route path="/notes/new" component={NoteEditorPage} />
      <Route path="/notes/:id" component={NoteDetailPage} />
      <Route path="/notes/:id/edit" component={NoteEditorPage} />
      <Route path="/folders" component={FoldersPage} />
      <Route path="/search" component={SearchPage} />
      <Route path="/problems" component={ProblemsPage} />
      <Route path="/problems/:id" component={ProblemsPage} />
      <Route path="/distill" component={DistillPage} />
      {aiEnabled && <Route path="/chat" component={ChatPage} />}
      <Route path="/export" component={ExportImportPage} />
      <Route>
        <Redirect to="/" />
      </Route>
    </Switch>
  );
}
