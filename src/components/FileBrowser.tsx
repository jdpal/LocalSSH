import { useEffect, useState } from 'react';
import { listRemote } from '../api';
import { parentRemotePath, sortRemoteEntries } from '../sftpModel.js';
import type { RemoteEntry, ServerProfile } from '../types';

type Props = { server: ServerProfile | null };

function formatSize(size?: number | null) {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default function FileBrowser({ server }: Props) {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setPath('/');
  }, [server?.id]);

  useEffect(() => {
    if (!server) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    void listRemote(server.id, path)
      .then((items) => { if (!cancelled) setEntries(sortRemoteEntries(items) as RemoteEntry[]); })
      .catch((err) => { if (!cancelled) { setEntries([]); setError(String(err)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [server?.id, path, refreshKey]);

  if (!server) return <div className="empty-workspace">Choose a server to browse files.</div>;

  return (
    <div className="file-browser">
      <div className="file-toolbar">
        <button className="subtle" disabled={path === '/'} onClick={() => setPath(parentRemotePath(path))}>↑ Parent</button>
        <div className="remote-path"><span>SFTP</span><code>{path}</code></div>
        <button className="subtle" onClick={() => setRefreshKey((value) => value + 1)}>Refresh</button>
      </div>
      {error && <div className="inline-error">{error}</div>}
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
      <p className="sftp-note">SFTP verifies the server against <code>~/.ssh/known_hosts</code> and uses your local <code>ssh-agent</code> or an unencrypted identity file.</p>
    </div>
  );
}
