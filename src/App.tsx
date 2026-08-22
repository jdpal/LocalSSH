import { FormEvent, useEffect, useMemo, useState } from 'react';
import { deleteServer, listServers, upsertServer } from './api';
import { groupAndFilterServers } from './serverModel.js';
import { addSessionTab, removeSessionTab, terminalStackState } from './terminalModel.js';
import FileBrowser from './components/FileBrowser';
import TerminalPane from './components/TerminalPane';
import type { ServerInput, ServerProfile } from './types';

type View = 'terminal' | 'files';
type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
type TerminalTab = {
  id: string;
  serverId: string;
  server: ServerProfile;
  label: string;
  backendSessionId: string | null;
  status: SessionStatus;
};

const emptyForm: ServerInput = { name: '', host: '', port: 22, username: '', groupName: 'Servers', favourite: false, identityFile: '' };

export default function App() {
  const [servers, setServers] = useState<ServerProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('terminal');
  const [form, setForm] = useState<ServerInput | null>(null);
  const [error, setError] = useState('');
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  useEffect(() => {
    void listServers().then((items) => {
      setServers(items);
      setSelectedId(items[0]?.id ?? null);
    }).catch((err) => setError(String(err)));
  }, []);

  const selected = servers.find((server) => server.id === selectedId) ?? null;
  const groups = useMemo(() => groupAndFilterServers(servers, query), [servers, query]);
  const terminalState = terminalStackState(tabs, view);

  async function saveServer(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setError('');
    try {
      const saved = await upsertServer(form);
      setServers((current) => [...current.filter((item) => item.id !== saved.id), saved]);
      setSelectedId(saved.id);
      setForm(null);
    } catch (err) { setError(String(err)); }
  }

  async function removeSelected() {
    if (!selected) return;
    setError('');
    try {
      await deleteServer(selected.id);
      const remaining = servers.filter((item) => item.id !== selected.id);
      setServers(remaining);
      setSelectedId(remaining[0]?.id ?? null);
    } catch (err) { setError(String(err)); }
  }

  function connectSelected() {
    if (!selected) return;
    const tabId = crypto.randomUUID();
    setTabs((current) => addSessionTab(current, selected, tabId) as TerminalTab[]);
    setActiveTabId(tabId);
    setView('terminal');
  }

  function closeTab(id: string) {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      const next = removeSessionTab(current, id) as TerminalTab[];
      if (activeTabId === id) {
        const replacement = next[Math.max(0, index - 1)] ?? next[0] ?? null;
        setActiveTabId(replacement?.id ?? null);
      }
      return next;
    });
  }

  function updateTabStatus(id: string, status: Exclude<SessionStatus, 'idle'>) {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, status } : tab));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row"><div className="brand-mark">S/</div><div><strong>LocalSSH</strong><span>macOS SSH manager</span></div></div>
        <label className="search-wrap"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search servers" aria-label="Search servers" /></label>
        <div className="server-scroll">
          {groups.map((group) => (
            <section key={group.name} className="server-group">
              <h2>{group.name}</h2>
              {group.servers.map((server: ServerProfile) => (
                <button key={server.id} className={`server-row ${server.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(server.id)}>
                  <span className="online-dot"/><span className="server-copy"><strong>{server.name}</strong><small>{server.username}@{server.host}</small></span><span className="server-star">{server.favourite ? '★' : ''}</span>
                </button>
              ))}
            </section>
          ))}
          {!groups.length && <div className="empty-note">No matching servers.</div>}
        </div>
        <button className="add-server" onClick={() => setForm({ ...emptyForm })}>＋ Add server</button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          {selected ? <div className="active-server"><span className="online-dot"/><div><strong>{selected.name}</strong><small>{selected.username}@{selected.host}:{selected.port}</small></div></div> : <strong>No server selected</strong>}
          <div className="top-actions">
            {selected && <button className="subtle" onClick={() => setForm({ ...selected })}>Edit</button>}
            {selected && <button className="subtle danger" onClick={() => void removeSelected()}>Delete</button>}
            <button className="primary" disabled={!selected} onClick={connectSelected}>Connect</button>
          </div>
        </header>

        <nav className="view-tabs" aria-label="Workspace views"><button className={view === 'terminal' ? 'active' : ''} onClick={() => setView('terminal')}>Terminal</button><button className={view === 'files' ? 'active' : ''} onClick={() => setView('files')}>Files / SFTP</button></nav>
        {error && <div className="error-banner">{error}</div>}

        {view === 'terminal' && tabs.length > 0 && (
          <div className="session-tabs">
            {tabs.map((tab) => <div key={tab.id} className={`session-tab ${tab.id === activeTabId ? 'active' : ''}`}><button onClick={() => setActiveTabId(tab.id)}><span className={`session-dot ${tab.status}`}/><span>{tab.label}</span></button><button className="tab-close" onClick={() => closeTab(tab.id)} aria-label={`Close ${tab.label}`}>×</button></div>)}
            <button className="new-tab" disabled={!selected} onClick={connectSelected}>＋</button>
          </div>
        )}

        <div className="workspace-body">
          {terminalState.mounted && (
            <div className={`workspace-panel ${terminalState.visible ? 'active' : 'hidden'}`}>
              <div className="terminal-stack">{tabs.map((tab) => (
                <TerminalPane
                  key={tab.id}
                  server={tab.server}
                  active={terminalState.visible && tab.id === activeTabId}
                  onStatus={(status) => updateTabStatus(tab.id, status)}
                />
              ))}</div>
            </div>
          )}

          {!terminalState.mounted && view === 'terminal' && (
            <div className="terminal-placeholder"><div className="terminal-chrome"><span className="traffic red"/><span className="traffic amber"/><span className="traffic green"/><span>SSH terminal</span></div><pre>{selected ? `Ready for ${selected.name}.\n\nClick Connect to start /usr/bin/ssh.` : 'Choose a server from the sidebar.'}</pre></div>
          )}

          <div className={`workspace-panel ${view === 'files' ? 'active' : 'hidden'}`}>
            <FileBrowser server={selected} active={view === 'files'} />
          </div>
        </div>
      </section>

      {form && <div className="modal-backdrop" role="presentation"><form className="server-modal" onSubmit={saveServer}>
        <div className="modal-title"><div><strong>{form.id ? 'Edit server' : 'Add server'}</strong><span>No passwords or private keys are stored.</span></div><button type="button" className="icon-button" onClick={() => setForm(null)}>×</button></div>
        <div className="form-grid">
          <label><span>Name</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Production Web" /></label>
          <label><span>Group</span><input required value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} placeholder="Production" /></label>
          <label className="wide"><span>Host / IP</span><input required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="10.20.0.15" /></label>
          <label><span>Username</span><input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="jd" /></label>
          <label><span>Port</span><input required type="number" min="1" max="65535" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></label>
          <label className="wide"><span>Identity file (optional)</span><input value={form.identityFile ?? ''} onChange={(e) => setForm({ ...form, identityFile: e.target.value })} placeholder="~/.ssh/id_ed25519" /></label>
          <label className="check-row wide"><input type="checkbox" checked={form.favourite} onChange={(e) => setForm({ ...form, favourite: e.target.checked })}/><span>Favourite server</span></label>
        </div>
        <div className="modal-actions"><button type="button" className="subtle" onClick={() => setForm(null)}>Cancel</button><button className="primary" type="submit">Save server</button></div>
      </form></div>}
    </main>
  );
}
