export interface ServerProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  groupName: string;
  favourite: boolean;
  identityFile?: string | null;
  lastConnectedAt?: string | null;
}

export interface ServerInput extends Omit<ServerProfile, 'id' | 'lastConnectedAt'> {
  id?: string;
}

export interface RemoteEntry {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'symlink';
  size?: number | null;
  modified?: number | null;
}
