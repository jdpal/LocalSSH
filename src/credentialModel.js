/**
 * @param {{username:string,useSshCredentialsForSftp:boolean,sftpUsername?:string|null,hasSshPassword?:boolean,hasSftpPassword?:boolean}} server
 */
export function resolveSftpCredentialSummary(server) {
  if (server.useSshCredentialsForSftp) {
    return { username: server.username, hasSavedPassword: Boolean(server.hasSshPassword), source: 'ssh' };
  }
  return {
    username: (server.sftpUsername || '').trim() || server.username,
    hasSavedPassword: Boolean(server.hasSftpPassword),
    source: 'sftp'
  };
}
