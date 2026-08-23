export interface ServerProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  groupName: string;
  favourite: boolean;
  identityFile?: string | null;
  sftpUsername?: string | null;
  useSshCredentialsForSftp: boolean;
  hasSshPassword: boolean;
  hasSftpPassword: boolean;
  lastConnectedAt?: string | null;
}

export interface ServerInput extends Omit<ServerProfile, 'id' | 'lastConnectedAt' | 'hasSshPassword' | 'hasSftpPassword'> {
  id?: string;
  sshPassword?: string | null;
  clearSshPassword?: boolean;
  sftpPassword?: string | null;
  clearSftpPassword?: boolean;
  hasSshPassword?: boolean;
  hasSftpPassword?: boolean;
}

export interface RemoteEntry {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'symlink';
  size?: number | null;
  modified?: number | null;
}

export interface LocalFileGrant {
  id: string;
  name: string;
}

export interface LocalDirectoryGrant {
  id: string;
  name: string;
}
