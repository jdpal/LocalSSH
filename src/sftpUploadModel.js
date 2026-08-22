function localBaseName(localPath) {
  const normalised = String(localPath ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  return normalised.slice(normalised.lastIndexOf('/') + 1);
}

export function remoteUploadTarget(remoteDir, localPath) {
  const name = localBaseName(localPath);
  const dir = !remoteDir || remoteDir === '/' ? '' : String(remoteDir).replace(/\/+$/, '');
  return `${dir}/${name}` || '/';
}

export function uploadErrorAction(error) {
  const message = String(error ?? '');
  if (message.includes('SFTP_FILE_EXISTS:')) return 'confirm-replace';
  if (message.includes('SFTP_DIRECTORY_UNSUPPORTED:')) return 'directory-unsupported';
  return 'other';
}
