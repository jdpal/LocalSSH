/**
 * @param {Array<any>} servers
 * @param {string} query
 * @returns {Array<{name: string, servers: Array<any>}>}
 */
export function groupAndFilterServers(servers, query) {
  const needle = query.trim().toLowerCase();
  const filtered = servers.filter((server) => {
    if (!needle) return true;
    return [server.name, server.host, server.username, server.groupName]
      .some((value) => String(value ?? '').toLowerCase().includes(needle));
  });

  const groups = new Map();
  for (const server of filtered) {
    const name = server.groupName?.trim() || 'Servers';
    const list = groups.get(name) ?? [];
    list.push(server);
    groups.set(name, list);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, groupServers]) => ({
      name,
      servers: [...groupServers].sort((a, b) => {
        if (a.favourite !== b.favourite) return a.favourite ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
    }));
}

/** @param {Array<any>} servers @param {any} server */
export function addServerImmutable(servers, server) {
  return [...servers, server];
}
