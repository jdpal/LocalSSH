/** @param {string} path */
export function parentRemotePath(path) {
  const clean = path.trim() || '/';
  if (clean === '/') return '/';
  const parts = clean.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  return `/${parts.slice(0, -1).join('/')}`;
}

/** @param {Array<any>} entries */
export function sortRemoteEntries(entries) {
  return [...entries].sort((a, b) => {
    const ad = a.kind === 'directory';
    const bd = b.kind === 'directory';
    if (ad !== bd) return ad ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}
