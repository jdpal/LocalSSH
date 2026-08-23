import { FormEvent, useEffect, useMemo, useState } from 'react';
import { clearLocalData, closeSftp, deleteServer, listServers, upsertServer } from './api';
import { groupAndFilterServers } from './serverModel.js';
import { addSessionTab, removeSessionTab, serverConnectionState, terminalStackState } from './terminalModel.js';
import { ensureSftpTab, removeSftpTab, updateSftpTabStatus } from './sftpSessionModel.js';
import FileBrowser from './components/FileBrowser';
import Icon from './components/Icon';
import TerminalPane from './components/TerminalPane';
import localSshIcon from './assets/localssh-icon.png';
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

type SftpTab = {
  id: string;
  serverId: string;
  server: ServerProfile;
  label: string;
  status: SessionStatus;
};

const emptyForm: ServerInput = {
  name: '', host: '', port: 22, username: '', groupName: 'Servers', favourite: false,
  identityFile: '', sftpUsername: '', useSshCredentialsForSftp: true,
  sshPassword: '', clearSshPassword: false, sftpPassword: '', clearSftpPassword: false
};

function editForm(server: ServerProfile): ServerInput {
  return {
    ...server,
    sshPassword: '',
    clearSshPassword: false,
    sftpPassword: '',
    clearSftpPassword: false
  };
}

export default function App() {
  const [servers, setServers] = useState<ServerProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('terminal');
  const [form, setForm] = useState<ServerInput | null>(null);
  const [error, setError] = useState('');
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [sftpTabs, setSftpTabs] = useState<SftpTab[]>([]);
  const [activeSftpTabId, setActiveSftpTabId] = useState<string | null>(null);
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [showSftpPassword, setShowSftpPassword] = useState(false);

  useEffect(() => {
    void listServers().then((items) => {
      setServers(items);
      setSelectedId(items[0]?.id ?? null);
    }).catch((err) => setError(String(err)));
  }, []);

  const selected = servers.find((server) => server.id === selectedId) ?? null;
  const groups = useMemo(() => groupAndFilterServers(servers, query), [servers, query]);
  const terminalState = terminalStackState(tabs, view);

  function openForm(input: ServerInput) {
    setShowSshPassword(false);
    setShowSftpPassword(false);
    setForm(input);
  }

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
      await closeSftp(selected.id);
      await deleteServer(selected.id);
      const remaining = servers.filter((item) => item.id !== selected.id);
      const remainingSftpTabs = sftpTabs.filter((tab) => tab.serverId !== selected.id);
      setServers(remaining);
      setSftpTabs(remainingSftpTabs);
      if (activeSftpTabId && !remainingSftpTabs.some((tab) => tab.id === activeSftpTabId)) {
        setActiveSftpTabId(remainingSftpTabs[0]?.id ?? null);
      }
      setSelectedId(remaining[0]?.id ?? null);
    } catch (err) { setError(String(err)); }
  }

  function openSftpServer(server: ServerProfile) {
    const result = ensureSftpTab(sftpTabs, server, crypto.randomUUID());
    setSftpTabs(result.tabs as SftpTab[]);
    setActiveSftpTabId(result.activeId);
    setSelectedId(server.id);
    setView('files');
  }

  function selectServer(server: ServerProfile) {
    setSelectedId(server.id);
    if (view === 'files') openSftpServer(server);
  }

  function activateSftpTab(tab: SftpTab) {
    setActiveSftpTabId(tab.id);
    setSelectedId(tab.serverId);
    setView('files');
  }

  async function closeSftpTab(id: string) {
    const closing = sftpTabs.find((tab) => tab.id === id);
    if (!closing) return;
    try { await closeSftp(closing.serverId); } catch (err) { setError(String(err)); }
    const index = sftpTabs.findIndex((tab) => tab.id === id);
    const next = removeSftpTab(sftpTabs, id) as SftpTab[];
    setSftpTabs(next);
    if (activeSftpTabId === id) {
      const replacement = next[Math.max(0, index - 1)] ?? next[0] ?? null;
      setActiveSftpTabId(replacement?.id ?? null);
      if (replacement) setSelectedId(replacement.serverId);
    }
  }

  function updateSftpStatus(id: string, status: SessionStatus) {
    setSftpTabs((current) => updateSftpTabStatus(current, id, status) as SftpTab[]);
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

  function connectionClass(serverId: string) {
    return serverConnectionState(tabs, serverId);
  }

  async function clearEverything() {
    const confirmed = window.confirm('Delete all saved LocalSSH servers and Keychain passwords from this Mac? Active sessions will close.');
    if (!confirmed) return;
    try {
      await clearLocalData();
      setServers([]);
      setSelectedId(null);
      setTabs([]);
      setActiveTabId(null);
      setSftpTabs([]);
      setActiveSftpTabId(null);
      setError('');
    } catch (err) { setError(String(err)); }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row"><img className="brand-icon" src={localSshIcon} alt="LocalSSH"/><div><strong>LocalSSH</strong><span>macOS SSH manager</span></div></div>
        <label className="search-wrap"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search servers" aria-label="Search servers" /></label>
        <div className="server-scroll">
          {groups.map((group) => (
            <section key={group.name} className="server-group">
              <h2>{group.name}</h2>
              {group.servers.map((server: ServerProfile) => (
                <button key={server.id} className={`server-row ${server.id === selectedId ? 'selected' : ''}`} onClick={() => selectServer(server)}>
                  <span className={`status-dot ${connectionClass(server.id)}`}/><span className="server-copy"><strong>{server.name}</strong><small>{server.username}@{server.host}</small></span><span className="server-star">{server.favourite ? '★' : ''}</span>
                </button>
              ))}
            </section>
          ))}
          {!groups.length && <div className="empty-note">No matching servers.</div>}
        </div>
        <div className="sidebar-actions">
          <button className="add-server button-with-icon" onClick={() => openForm({ ...emptyForm })}><Icon name="add"/> Add server</button>
          <button className="clear-local-data" onClick={() => void clearEverything()}>Clear local data</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          {selected ? <div className="active-server"><span className={`status-dot ${connectionClass(selected.id)}`}/><div><strong>{selected.name}</strong><small>{selected.username}@{selected.host}:{selected.port}</small></div></div> : <strong>No server selected</strong>}
          <div className="top-actions">
            {selected && <button className="subtle button-with-icon" onClick={() => openForm(editForm(selected))}><Icon name="edit"/> Edit</button>}
            {selected && <button className="subtle danger button-with-icon" onClick={() => void removeSelected()}><Icon name="delete"/> Delete</button>}
            <button className="primary button-with-icon" disabled={!selected} onClick={connectSelected}><Icon name="connect"/> Connect</button>
          </div>
        </header>

        <nav className="view-tabs" aria-label="Workspace views">
          <button className={view === 'terminal' ? 'active' : ''} onClick={() => setView('terminal')}><Icon name="terminal"/> Terminal</button>
          <button className={view === 'files' ? 'active' : ''} onClick={() => selected ? openSftpServer(selected) : setView('files')}><Icon name="files"/> Files / SFTP</button>
        </nav>
        {error && <div className="error-banner">{error}</div>}

        {view === 'terminal' && tabs.length > 0 && (
          <div className="session-tabs">
            {tabs.map((tab) => <div key={tab.id} className={`session-tab ${tab.id === activeTabId ? 'active' : ''}`}><button onClick={() => setActiveTabId(tab.id)}><span className={`session-dot ${tab.status}`}/><span>{tab.label}</span></button><button className="tab-close" onClick={() => closeTab(tab.id)} aria-label={`Close ${tab.label}`}>×</button></div>)}
            <button className="new-tab" disabled={!selected} onClick={connectSelected} aria-label="New SSH tab"><Icon name="add"/></button>
          </div>
        )}

        {view === 'files' && sftpTabs.length > 0 && (
          <div className="session-tabs sftp-session-tabs">
            {sftpTabs.map((tab) => <div key={tab.id} className={`session-tab ${tab.id === activeSftpTabId ? 'active' : ''}`}><button onClick={() => activateSftpTab(tab)}><span className={`session-dot ${tab.status}`}/><span>{tab.label}</span></button><button className="tab-close" onClick={() => void closeSftpTab(tab.id)} aria-label={`Close SFTP ${tab.label}`}>×</button></div>)}
            <button className="new-tab" disabled={!selected} onClick={() => selected && openSftpServer(selected)} aria-label="New SFTP tab"><Icon name="add"/></button>
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
            <div className="terminal-placeholder"><div className="terminal-chrome"><span className="traffic red"/><span className="traffic amber"/><span className="traffic green"/><span>SSH terminal</span></div></div>
          )}

          {sftpTabs.length > 0 && (
            <div className={`workspace-panel ${view === 'files' ? 'active' : 'hidden'}`}>
              <div className="sftp-stack">{sftpTabs.map((tab) => (
                <div key={tab.id} className={`sftp-pane ${tab.id === activeSftpTabId ? 'active' : ''}`}>
                  <FileBrowser server={tab.server} active={view === 'files' && tab.id === activeSftpTabId} onStatus={(status) => updateSftpStatus(tab.id, status)} />
                </div>
              ))}</div>
            </div>
          )}
          {view === 'files' && sftpTabs.length === 0 && <div className="empty-workspace">Choose a server to open an SFTP session.</div>}
        </div>
      </section>

      {form && <div className="modal-backdrop" role="presentation"><form className="server-modal credential-modal" onSubmit={saveServer}>
        <div className="modal-title"><div><strong>{form.id ? 'Edit server' : 'Add server'}</strong><span>Saved passwords are protected by macOS Keychain, not SQLite.</span></div><button type="button" className="icon-button" onClick={() => setForm(null)} aria-label="Close"><Icon name="close" size={18}/></button></div>
        <div className="form-section-title">Server</div>
        <div className="form-grid">
          <label><span>Name</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Production Web" /></label>
          <label><span>Group</span><input required value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} placeholder="Production" /></label>
          <label className="wide"><span>Host / IP</span><input required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="10.20.0.15" /></label>
          <label><span>SSH username</span><input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="jd" /></label>
          <label><span>Port</span><input required type="number" min="1" max="65535" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></label>
          <label className="wide"><span>Identity file (optional)</span><input value={form.identityFile ?? ''} onChange={(e) => setForm({ ...form, identityFile: e.target.value })} placeholder="~/.ssh/id_ed25519" /></label>
        </div>

        <div className="form-section-title">SSH authentication</div>
        <div className="form-grid">
          <label className="wide"><span>SSH password {form.hasSshPassword && !form.clearSshPassword ? '· saved in Keychain' : ''}</span><div className="password-field"><input type={showSshPassword ? 'text' : 'password'} autoComplete="new-password" value={form.sshPassword ?? ''} onChange={(e) => setForm({ ...form, sshPassword: e.target.value, clearSshPassword: false })} placeholder={form.hasSshPassword ? 'Leave blank to keep saved password' : 'Optional password'} /><button type="button" onClick={() => setShowSshPassword((value) => !value)} aria-label="Show or hide SSH password"><Icon name={showSshPassword ? 'eyeOff' : 'eye'}/></button></div></label>
          {form.hasSshPassword && <label className="check-row wide"><input type="checkbox" checked={Boolean(form.clearSshPassword)} onChange={(e) => setForm({ ...form, clearSshPassword: e.target.checked, sshPassword: e.target.checked ? '' : form.sshPassword })}/><span>Clear saved SSH password</span></label>}
        </div>

        <div className="form-section-title">SFTP authentication</div>
        <div className="form-grid">
          <label className="check-row wide"><input type="checkbox" checked={form.useSshCredentialsForSftp} onChange={(e) => setForm({ ...form, useSshCredentialsForSftp: e.target.checked })}/><span>Use SSH credentials for SFTP</span></label>
          {!form.useSshCredentialsForSftp && <>
            <label className="wide"><span>SFTP username</span><input required value={form.sftpUsername ?? ''} onChange={(e) => setForm({ ...form, sftpUsername: e.target.value })} placeholder={form.username || 'files'} /></label>
            <label className="wide"><span>SFTP password {form.hasSftpPassword && !form.clearSftpPassword ? '· saved in Keychain' : ''}</span><div className="password-field"><input type={showSftpPassword ? 'text' : 'password'} autoComplete="new-password" value={form.sftpPassword ?? ''} onChange={(e) => setForm({ ...form, sftpPassword: e.target.value, clearSftpPassword: false })} placeholder={form.hasSftpPassword ? 'Leave blank to keep saved password' : 'Optional password'} /><button type="button" onClick={() => setShowSftpPassword((value) => !value)} aria-label="Show or hide SFTP password"><Icon name={showSftpPassword ? 'eyeOff' : 'eye'}/></button></div></label>
            {form.hasSftpPassword && <label className="check-row wide"><input type="checkbox" checked={Boolean(form.clearSftpPassword)} onChange={(e) => setForm({ ...form, clearSftpPassword: e.target.checked, sftpPassword: e.target.checked ? '' : form.sftpPassword })}/><span>Clear saved SFTP password</span></label>}
          </>}
          <label className="check-row wide"><input type="checkbox" checked={form.favourite} onChange={(e) => setForm({ ...form, favourite: e.target.checked })}/><span>Favourite server</span></label>
        </div>
        <p className="keychain-note">Passwords are stored as generic passwords in macOS Keychain. LocalSSH never writes password values to its SQLite database.</p>
        <div className="modal-actions"><button type="button" className="subtle" onClick={() => setForm(null)}>Cancel</button><button className="primary button-with-icon" type="submit"><Icon name="save"/> Save server</button></div>
      </form></div>}
    </main>
  );
}
