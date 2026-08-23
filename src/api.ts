import { invoke } from '@tauri-apps/api/core';
import type { LocalDirectoryGrant, LocalFileGrant, RemoteEntry, ServerInput, ServerProfile } from './types';

const demoServers: ServerProfile[] = [
  { id: 'demo-web-01', name: 'Web-01', host: '10.20.0.15', port: 22, username: 'jd', groupName: 'Production', favourite: true, useSshCredentialsForSftp: true, hasSshPassword: false, hasSftpPassword: false },
  { id: 'demo-db-01', name: 'DB-01', host: '10.20.0.30', port: 22, username: 'postgres', groupName: 'Production', favourite: false, useSshCredentialsForSftp: true, hasSshPassword: false, hasSftpPassword: false }
];

let browserServers = [...demoServers];

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function listServers(): Promise<ServerProfile[]> {
  if (!isTauri()) return browserServers;
  return invoke<ServerProfile[]>('list_servers');
}

export async function upsertServer(input: ServerInput): Promise<ServerProfile> {
  const { sshPassword = null, clearSshPassword = false, sftpPassword = null, clearSftpPassword = false, ...profileInput } = input;
  if (!isTauri()) {
    const profile: ServerProfile = {
      ...profileInput,
      id: input.id ?? crypto.randomUUID(),
      hasSshPassword: clearSshPassword ? false : Boolean(sshPassword) || Boolean(input.hasSshPassword),
      hasSftpPassword: profileInput.useSshCredentialsForSftp ? false : (clearSftpPassword ? false : Boolean(sftpPassword) || Boolean(input.hasSftpPassword)),
      lastConnectedAt: null
    };
    browserServers = [...browserServers.filter((item) => item.id !== profile.id), profile];
    return profile;
  }
  return invoke<ServerProfile>('upsert_server', { input: profileInput, sshPassword, clearSshPassword, sftpPassword, clearSftpPassword });
}

export async function deleteServer(id: string): Promise<void> {
  if (!isTauri()) {
    browserServers = browserServers.filter((item) => item.id !== id);
    return;
  }
  await invoke('delete_server', { id });
}

export async function startSsh(serverId: string, cols: number, rows: number): Promise<string> {
  if (!isTauri()) return `demo-${serverId}-${Date.now()}`;
  return invoke<string>('start_ssh', { serverId, cols, rows });
}

export async function writeSsh(sessionId: string, data: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('write_ssh', { sessionId, data });
}

export async function resizeSsh(sessionId: string, cols: number, rows: number): Promise<void> {
  if (!isTauri()) return;
  await invoke('resize_ssh', { sessionId, cols, rows });
}

export async function stopSsh(sessionId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('stop_ssh', { sessionId });
}

export async function closeSftp(serverId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('sftp_close', { serverId });
}

export async function listRemote(serverId: string, path: string, password: string | null = null): Promise<RemoteEntry[]> {
  if (!isTauri()) {
    return [
      { name: 'apps', path: `${path === '/' ? '' : path}/apps`, kind: 'directory', size: null, modified: null },
      { name: 'logs', path: `${path === '/' ? '' : path}/logs`, kind: 'directory', size: null, modified: null },
      { name: '.bashrc', path: `${path === '/' ? '' : path}/.bashrc`, kind: 'file', size: 3421, modified: null }
    ];
  }
  return invoke<RemoteEntry[]>('sftp_list', { serverId, path, password });
}

export async function pickLocalFiles(): Promise<LocalFileGrant[]> {
  if (!isTauri()) return [];
  return invoke<LocalFileGrant[]>('pick_local_files');
}

export async function uploadRemote(serverId: string, localFileId: string, remoteDir: string, password: string | null = null, replace = false): Promise<{ name: string; path: string; size: number }> {
  if (!isTauri()) return { name: localFileId, path: `${remoteDir === '/' ? '' : remoteDir}/${localFileId}`, size: 0 };
  return invoke('sftp_upload', { serverId, localFileId, remoteDir, password, replace });
}

export async function pickDownloadDirectory(): Promise<LocalDirectoryGrant | null> {
  if (!isTauri()) return null;
  return invoke<LocalDirectoryGrant | null>('pick_download_directory');
}

export async function downloadRemote(serverId: string, remotePath: string, localDirectoryId: string, password: string | null = null): Promise<{ name: string; path: string; size: number }> {
  if (!isTauri()) {
    const name = remotePath.replace(/\\/g, '/').split('/').pop() || 'file';
    return { name, path: `${localDirectoryId}/${name}`, size: 0 };
  }
  return invoke('sftp_download', { serverId, remotePath, localDirectoryId, password });
}

export async function clearLocalData(): Promise<void> {
  if (!isTauri()) { browserServers = []; return; }
  await invoke('clear_local_data');
}
