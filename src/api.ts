import { invoke } from '@tauri-apps/api/core';
import type { ServerInput, ServerProfile } from './types';

const demoServers: ServerProfile[] = [
  { id: 'demo-web-01', name: 'Web-01', host: '10.20.0.15', port: 22, username: 'jd', groupName: 'Production', favourite: true },
  { id: 'demo-db-01', name: 'DB-01', host: '10.20.0.30', port: 22, username: 'postgres', groupName: 'Production', favourite: false },
  { id: 'demo-proxmox', name: 'Proxmox', host: '192.168.1.5', port: 22, username: 'root', groupName: 'Home Lab', favourite: true },
  { id: 'demo-nas', name: 'NAS', host: '192.168.1.10', port: 22, username: 'jd', groupName: 'Home Lab', favourite: false }
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
  if (!isTauri()) {
    const profile: ServerProfile = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      lastConnectedAt: null
    };
    browserServers = [...browserServers.filter((item) => item.id !== profile.id), profile];
    return profile;
  }
  return invoke<ServerProfile>('upsert_server', { input });
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

export async function listRemote(serverId: string, path: string, password: string | null = null) {
  if (!isTauri()) {
    return [
      { name: 'apps', path: `${path === '/' ? '' : path}/apps`, kind: 'directory', size: null, modified: null },
      { name: 'logs', path: `${path === '/' ? '' : path}/logs`, kind: 'directory', size: null, modified: null },
      { name: '.bashrc', path: `${path === '/' ? '' : path}/.bashrc`, kind: 'file', size: 3421, modified: null }
    ];
  }
  return invoke('sftp_list', { serverId, path, password });
}

export async function pickLocalFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>('pick_local_files');
}

export async function uploadRemote(serverId: string, localPath: string, remoteDir: string, password: string | null = null, replace = false): Promise<{ name: string; path: string; size: number }> {
  if (!isTauri()) {
    const name = localPath.replace(/\\/g, '/').split('/').pop() || 'file';
    return { name, path: `${remoteDir === '/' ? '' : remoteDir}/${name}`, size: 0 };
  }
  return invoke('sftp_upload', { serverId, localPath, remoteDir, password, replace });
}
