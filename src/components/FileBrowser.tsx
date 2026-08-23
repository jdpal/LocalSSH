import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { downloadRemote, isTauri, listRemote, pickDownloadDirectory, pickLocalFiles, uploadRemote } from '../api';
import { sftpAuthAction } from '../sftpAuthModel.js';
import { parentRemotePath, sortRemoteEntries } from '../sftpModel.js';
import { remoteUploadTarget, uploadErrorAction } from '../sftpUploadModel.js';
import { resolveSftpCredentialSummary } from '../credentialModel.js';
import Icon from './Icon';
import type { LocalFileGrant, RemoteEntry, ServerProfile } from '../types';

type Props = { server: ServerProfile | null; active: boolean; onStatus?: (status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error') => void };
type UploadState = 'queued' | 'uploading' | 'uploaded' | 'failed' | 'skipped';
type UploadItem = { id: string; localFileId: string; name: string; remotePath: string; status: UploadState; message?: string };
type ConflictPrompt = { name: string; remotePath: string; resolve: (replace: boolean) => void };
type DownloadState = 'queued' | 'downloading' | 'downloaded' | 'failed';
type DownloadItem = { id: string; remotePath: string; name: string; status: DownloadState; message?: string };

function formatSize(size?: number | null) {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default function FileBrowser({ server, active, onStatus = () => {} }: Props) {
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
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const passwordsRef = useRef(new Map<string, string>());
  const onStatusRef = useRef(onStatus);

  useEffect(() => { onStatusRef.current = onStatus; }, [onStatus]);

  useEffect(() => {
    setPath('/');
    setError('');
    setShowPasswordPrompt(false);
    setPasswordInput('');
    setUploads([]);
    setDownloads([]);
    setSelectedFiles(new Set());
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
    onStatusRef.current('connecting');
    setShowPasswordPrompt(false);
    void listRemote(server.id, path, password || null)
      .then((items) => {
        if (!cancelled) {
          setEntries(sortRemoteEntries(items));
          setPasswordInput('');
          onStatusRef.current('connected');
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
          onStatusRef.current('disconnected');
        } else {
          setError(String(err));
          onStatusRef.current('error');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [server?.id, path, refreshKey, active]);

  useEffect(() => {
    setSelectedFiles(new Set());
    setDownloads([]);
  }, [path]);

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

  const performUploads = useCallback(async (localFiles: LocalFileGrant[]) => {
    if (!server || localFiles.length === 0) return;
    const password = passwordsRef.current.get(server.id) ?? '';
    const batch = localFiles.map((localFile) => ({
      id: crypto.randomUUID(),
      localFileId: localFile.id,
      name: localFile.name,
      remotePath: remoteUploadTarget(path, localFile.name),
      status: 'queued' as UploadState
    }));
    setUploads(batch);
    setError('');
    let uploadedAny = false;

    for (const item of batch) {
      updateUpload(item.id, { status: 'uploading', message: 'Uploading…' });
      try {
        await uploadRemote(server.id, item.localFileId, path, password || null, false);
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
            await uploadRemote(server.id, item.localFileId, path, password || null, true);
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
    void listen<LocalFileGrant[]>('local-files-dropped', (event) => {
      if (showPasswordPrompt || event.payload.length === 0) return;
      setDropActive(false);
      void performUploads(event.payload);
    }).then((stop) => { unlisten = stop; }).catch((err) => setError(String(err)));
    return () => { unlisten?.(); };
  }, [active, performUploads, server, showPasswordPrompt]);

  const updateDownload = useCallback((id: string, patch: Partial<DownloadItem>) => {
    setDownloads((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  function toggleFileSelection(entry: RemoteEntry) {
    if (entry.kind === 'directory') {
      setPath(entry.path);
      return;
    }
    if (entry.kind !== 'file') return;
    setSelectedFiles((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
  }

  async function downloadSelected() {
    if (!server || selectedFiles.size === 0) return;
    const destination = await pickDownloadDirectory();
    if (!destination) return;

    const password = passwordsRef.current.get(server.id) ?? '';
    const selectedEntries = entries.filter((entry) => entry.kind === 'file' && selectedFiles.has(entry.path));
    const batch = selectedEntries.map((entry) => ({
      id: crypto.randomUUID(),
      remotePath: entry.path,
      name: entry.name,
      status: 'queued' as DownloadState
    }));
    setDownloads(batch);
    setError('');

    for (const item of batch) {
      updateDownload(item.id, { status: 'downloading', message: 'Downloading…' });
      try {
        const result = await downloadRemote(server.id, item.remotePath, destination.id, password || null);
        updateDownload(item.id, { status: 'downloaded', message: `Saved to ${result.path}` });
      } catch (err) {
        const authAction = sftpAuthAction(err, password);
        if (authAction === 'prompt') {
          passwordsRef.current.delete(server.id);
          setShowPasswordPrompt(true);
          setError('SFTP authentication expired or was rejected. Authenticate again, then retry the download.');
        }
        const message = String(err).includes('SFTP_LOCAL_FILE_EXISTS:')
          ? 'A file with this name already exists in the selected folder'
          : String(err).includes('SFTP_DIRECTORY_DOWNLOAD_UNSUPPORTED:')
            ? 'Folder download is not supported yet'
            : String(err);
        updateDownload(item.id, { status: 'failed', message });
      }
    }
  }

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
  const sftpCredential = resolveSftpCredentialSummary(server);
  const uploading = uploads.some((item) => item.status === 'queued' || item.status === 'uploading');
  const downloading = downloads.some((item) => item.status === 'queued' || item.status === 'downloading');

  return (
    <div className={`file-browser ${dropActive ? 'drop-active' : ''}`}>
      <div className="file-toolbar">
        <button className="subtle" disabled={path === '/'} onClick={() => setPath(parentRemotePath(path))}><Icon name="parent"/> Parent</button>
        <div className="remote-path"><span>SFTP</span><code>{path}</code></div>
        <button className="subtle" disabled={showPasswordPrompt || uploading || downloading} onClick={() => void chooseFiles()}><Icon name="upload"/> Upload</button>
        <button className="subtle" disabled={showPasswordPrompt || downloading || selectedFiles.size === 0} onClick={() => void downloadSelected()}><Icon name="download"/> Download{selectedFiles.size ? ` (${selectedFiles.size})` : ''}</button>
        <button className="subtle" disabled={uploading || downloading} onClick={() => setRefreshKey((value) => value + 1)}><Icon name="refresh"/> Refresh</button>
      </div>
      {dropActive && <div className="drop-overlay"><strong>Drop files to upload</strong><span>Files will be uploaded to <code>{path}</code></span></div>}
      {error && <div className="inline-error">{error}</div>}
      {showPasswordPrompt && (
        <form className="sftp-auth" onSubmit={submitPassword}>
          <label htmlFor="sftp-password"><span>Password for {sftpCredential.username}@{server.host}</span><input id="sftp-password" autoFocus type="password" autoComplete="off" value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} /></label>
          <button className="primary" type="submit" disabled={!passwordInput}>Authenticate</button>
          <small>This fallback password is kept in memory only. Save it in the server editor to protect it with macOS Keychain.</small>
        </form>
      )}
      {uploads.length > 0 && (
        <div className="upload-status-list" aria-live="polite">
          {uploads.map((item) => <div key={item.id} className={`upload-status ${item.status}`}><span>{item.status === 'uploaded' ? '✓' : item.status === 'failed' ? '!' : item.status === 'skipped' ? '–' : '↑'}</span><strong>{item.name}</strong><small>{item.message ?? item.status}</small></div>)}
        </div>
      )}
      {downloads.length > 0 && (
        <div className="download-status-list" aria-live="polite">
          {downloads.map((item) => <div key={item.id} className={`download-status ${item.status}`}><span>{item.status === 'downloaded' ? '✓' : item.status === 'failed' ? '!' : '↓'}</span><strong>{item.name}</strong><small>{item.message ?? item.status}</small></div>)}
        </div>
      )}
      <div className="file-table-scroll">
        <div className="file-table" role="table" aria-label={`Remote files on ${server.name}`}>
          <div className="file-row file-header" role="row"><span>Name</span><span>Type</span><span>Size</span></div>
          {loading && <div className="loading-row">Loading remote directory…</div>}
          {!loading && entries.map((entry) => {
            const selected = selectedFiles.has(entry.path);
            return <button key={entry.path} className={`file-row file-entry ${selected ? 'selected' : ''}`} aria-pressed={entry.kind === 'file' ? selected : undefined} onClick={() => toggleFileSelection(entry)}>
              <span className="file-name"><span>{entry.kind === 'directory' ? '📁' : entry.kind === 'symlink' ? '↗' : '📄'}</span><span className="selection-check">{entry.kind === 'file' ? (selected ? '✓' : '○') : ''}</span>{entry.name}</span>
              <span>{entry.kind}</span><span>{formatSize(entry.size)}</span>
            </button>;
          })}
          {!loading && !error && entries.length === 0 && <div className="loading-row">This directory is empty.</div>}
        </div>
      </div>
      <p className="sftp-note">Select one or more files, then click Download to save them to a folder on your Mac. Click a directory to open it. Upload also supports Finder drag and drop. Saved passwords are read from macOS Keychain.</p>

      {conflict && <div className="replace-backdrop" role="presentation"><div className="replace-dialog" role="dialog" aria-modal="true" aria-labelledby="replace-title"><strong id="replace-title">Replace existing file?</strong><p><code>{conflict.remotePath}</code> already exists on the server.</p><div><button className="subtle" onClick={() => resolveConflict(false)}>Cancel</button><button className="primary" onClick={() => resolveConflict(true)}>Replace</button></div></div></div>}
    </div>
  );
}
