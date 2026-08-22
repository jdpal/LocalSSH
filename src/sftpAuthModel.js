export function classifySftpError(error) {
  const value = String(error ?? '');
  if (value.includes('SFTP_AUTH_FAILED')) return 'auth-failed';
  if (value.includes('SFTP_AUTH_REQUIRED')) return 'auth-required';
  return 'other';
}

export function sftpAuthAction(error, password) {
  const kind = classifySftpError(error);
  if (kind === 'auth-failed') return 'prompt';
  if (kind === 'auth-required') return password ? 'retry-password' : 'prompt';
  return 'error';
}
