import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isTauri, listRemote, pickLocalFiles, uploadRemote } from '../api';
import { sftpAuthAction } from '../sftpAuthModel.js';
import { parentRemotePath, sortRemoteEntries } from '../sftpModel.js';
import { remoteUploadTarget, uploadErrorAction } from '../sftpUploadModel.js';
import type { RemoteEntry, ServerProfile } from '../types';

type Props = { server: ServerProfile | null; active: boolean };
type UploadState = 'queued' | 'uploading' | 'uploaded' | 'failed' | 'skipped';
type UploadItem = { id: string; localPath: string; name: string; remotePath: string; status: UploadState; message?: string };
type ConflictPrompt = { name: string; remotePath: string; resolve: (replace: boolean) => void };

function formatSize(size?: number | null) {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function localName(localPath: string) {
  const normalised = localPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalised.slice(normalised.lastIndexOf('/') + 1) || localPath;
}

export default function FileBrowser({ server, active }: Props) {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [conflict, setConflict] = useState<ConflictPrompt | null>(null);
  const passwordsRef = useRef(new Map<string, string>());

  useEffect(() => {
    setPath('/');
    setError('');
    setShowPasswordPrompt(false);
    setPasswordInput('');
    setUploads([]);
    setDropActive(false);
    setConflict((current) => {
      current?.resolve(false);
      return null;
    });
  }, [server?.id]);

  useEffect(() => {
    if (!server || !active) {
      if (!server) setEntries([]);
      return;
    }
    let cancelled = false;
    const password = passwordsRef.current.get(server.id) ?? '';
    setLoading(true);
    setError('');
    setShowPasswordPrompt(false);
    void listRemote(server.id, path, password || null)
      .then((items) => {
        if (!cancelled) {
          setEntries(sortRemoteEntries(items) as RemoteEntry[]);
          setPasswordInput('');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setEntries([]);
        const action = sftpAuthAction(err, password);
        if (action === 'prompt') {
          passwordsRef.current.delete(server.id);
          setPasswordInput('');
          setShowPasswordPrompt(true);
          setError(String(err).includes('SFTP_AUTH_FAILED') ? 'SFTP password was rejected. Try again.' : 'SFTP needs your server password for this app session.');
        } else {
          setError(String(err));
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [server?.id, path, refreshKey, active]);

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (!server || !passwordInput) return;
    passwordsRef.current.set(server.id, passwordInput);
    setShowPasswordPrompt(false);
    setError('');
    setRefreshKey((value) => value + 1);
  }

  const updateUpload = useCallback((id: string, patch: Partial<UploadItem>) => {
    setUploads((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const askReplace = useCallback((name: string, remotePath: string) => new Promise<boolean>((resolve) => {
    setConflict({ name, remotePath, resolve });
  }), []);

  const performUploads = useCallback(async (localPaths: string[]) => {
    if (!server || localPaths.length === 0) return;
    const password = passwordsRef.current.get(server.id) ?? '';
    const batch = localPaths.map((localPath) => ({
      id: crypto.randomUUID(),
      localPath,
      name: localName(localPath),
      remotePath: remoteUploadTarget(path, localPath),
      status: 'queued' as UploadState
    }));
    setUploads(batch);
    setError('');
    let uploadedAny = false;

    for (const item of batch) {
      updateUpload(item.id, { status: 'uploading', message: 'Uploading…' });
      try {
        await uploadRemote(server.id, item.localPath, path, password || null, false);
        updateUpload(item.id, { status: 'uploaded', message: 'Uploaded' });
        uploadedAny = true;
      } catch (err) {
        const action = uploadErrorAction(err);
        if (action === 'confirm-replace') {
          const replace = await askReplace(item.name, item.remotePath);
          if (!replace) {
            updateUpload(item.id, { status: 'skipped', message: 'Skipped' });
            continue;
          }
          try {
            await uploadRemote(server.id, item.localPath, path, password || null, true);
            updateUpload(item.id, { status: 'uploaded', message: 'Replaced' });
            uploadedAny = true;
          } catch (replaceError) {
            updateUpload(item.id, { status: 'failed', message: String(replaceError) });
          }
          continue;
        }
        if (action === 'directory-unsupported') {
          updateUpload(item.id, { status: 'skipped', message: 'Folder upload is not supported yet' });
          continue;
        }
        const authAction = sftpAuthAction(err, password);
        if (authAction === 'prompt') {
          passwordsRef.current.delete(server.id);
          setShowPasswordPrompt(true);
          setError('SFTP authentication expired or was rejected. Authenticate again, then retry the upload.');
        }
        updateUpload(item.id, { status: 'failed', message: String(err) });
      }
    }

    if (uploadedAny) setRefreshKey((value) => value + 1);
  }, [askReplace, path, server, updateUpload]);

  useEffect(() => {
    if (!active || !server || !isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setDropActive(true);
      } else if (event.payload.type === 'drop') {
        setDropActive(false);
        if (!showPasswordPrompt) void performUploads(event.payload.paths);
      } else {
        setDropActive(false);
      }
    }).then((stop) => { unlisten = stop; }).catch((err) => setError(String(err)));
    return () => { unlisten?.(); };
  }, [active, performUploads, server, showPasswordPrompt]);

  async function chooseFiles() {
    try {
      const files = await pickLocalFiles();
      if (files.length) await performUploads(files);
    } catch (err) {
      setError(String(err));
    }
  }

  function resolveConflict(replace: boolean) {
    const current = conflict;
    setConflict(null);
    current?.resolve(replace);
  }

  if (!server) return <div className="empty-workspace">Choose a server to browse files.</div>;
  const uploading = uploads.some((item) => item.status === 'queued' || item.status === 'uploading');

  return (
    <div className={`file-browser ${dropActive ? 'drop-active' : ''}`}>
      <div className="file-toolbar">
        <button className="subtle" disabled={path === '/'} onClick={() => setPath(parentRemotePath(path))}>↑ Parent</button>
        <div className="remote-path"><span>SFTP</span><code>{path}</code></div>
        <button className="subtle" disabled={showPasswordPrompt || uploading} onClick={() => void chooseFiles()}>Upload</button>
        <button className="subtle" disabled={uploading} onClick={() => setRefreshKey((value) => value + 1)}>Refresh</button>
      </div>
      {dropActive && <div className="drop-overlay"><strong>Drop files to upload</strong><span>Files will be uploaded to <code>{path}</code></span></div>}
      {error && <div className="inline-error">{error}</div>}
      {showPasswordPrompt && (
        <form className="sftp-auth" onSubmit={submitPassword}>
          <label htmlFor="sftp-password"><span>Password for {server.username}@{server.host}</span><input id="sftp-password" autoFocus type="password" autoComplete="off" value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} /></label>
          <button className="primary" type="submit" disabled={!passwordInput}>Authenticate</button>
          <small>Kept in memory only until LocalSSH is closed. It is not written to SQLite or disk.</small>
        </form>
      )}
      {uploads.length > 0 && (
        <div className="upload-status-list" aria-live="polite">
          {uploads.map((item) => <div key={item.id} className={`upload-status ${item.status}`}><span>{item.status === 'uploaded' ? '✓' : item.status === 'failed' ? '!' : item.status === 'skipped' ? '–' : '↑'}</span><strong>{item.name}</strong><small>{item.message ?? item.status}</small></div>)}
        </div>
      )}
      <div className="file-table" role="table" aria-label={`Remote files on ${server.name}`}>
        <div className="file-row file-header" role="row"><span>Name</span><span>Type</span><span>Size</span></div>
        {loading && <div className="loading-row">Loading remote directory…</div>}
        {!loading && entries.map((entry) => (
          <button key={entry.path} className="file-row file-entry" onDoubleClick={() => entry.kind === 'directory' && setPath(entry.path)} onClick={() => entry.kind === 'directory' && setPath(entry.path)}>
            <span className="file-name"><span>{entry.kind === 'directory' ? '📁' : entry.kind === 'symlink' ? '↗' : '📄'}</span>{entry.name}</span>
            <span>{entry.kind}</span><span>{formatSize(entry.size)}</span>
          </button>
        ))}
        {!loading && !error && entries.length === 0 && <div className="loading-row">This directory is empty.</div>}
      </div>
      <p className="sftp-note">SFTP verifies the server against <code>~/.ssh/known_hosts</code>. Click Upload or drag files from Finder into this pane. Passwords remain in memory only for the current LocalSSH session.</p>

      {conflict && <div className="replace-backdrop" role="presentation"><div className="replace-dialog" role="dialog" aria-modal="true" aria-labelledby="replace-title"><strong id="replace-title">Replace existing file?</strong><p><code>{conflict.remotePath}</code> already exists on the server.</p><div><button className="subtle" onClick={() => resolveConflict(false)}>Cancel</button><button className="primary" onClick={() => resolveConflict(true)}>Replace</button></div></div></div>}
    </div>
  );
}
