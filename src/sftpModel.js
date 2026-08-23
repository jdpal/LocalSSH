/** @param {string} path */
export function normalizeRemotePath(path) {
  const parts = [];
  for (const part of String(path ?? '').trim().split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length ? `/${parts.join('/')}` : '/';
}

/** @param {string} currentPath @param {string} entryName */
export function joinRemotePath(currentPath, entryName) {
  const current = normalizeRemotePath(currentPath);
  const raw = String(entryName ?? '').trim();
  if (!raw) return current;

  if (raw.startsWith('/')) return normalizeRemotePath(raw);

  const candidate = normalizeRemotePath(`/${raw}`);
  const currentRelative = current.slice(1);
  const candidateRelative = candidate.slice(1);
  if (currentRelative && (candidateRelative === currentRelative || candidateRelative.startsWith(`${currentRelative}/`))) {
    return candidate;
  }

  return normalizeRemotePath(`${current}/${raw}`);
}

/** @param {string} path */
export function parentRemotePath(path) {
  const clean = normalizeRemotePath(path);
  if (clean === '/') return '/';
  const parts = clean.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  return `/${parts.slice(0, -1).join('/')}`;
}

/** @param {Array<any>} entries @param {string} currentPath */
export function filterNavigationalEntries(entries, currentPath) {
  const current = normalizeRemotePath(currentPath);
  const parent = parentRemotePath(current);
  return entries.filter((entry) => {
    const entryPath = normalizeRemotePath(entry?.path ?? '');
    return entryPath !== current && entryPath !== parent;
  });
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
