/** @param {Array<any>} tabs @param {any} server @param {string} id */
export function ensureSftpTab(tabs, server, id = crypto.randomUUID()) {
  const existing = tabs.find((tab) => tab.serverId === server.id);
  if (existing) return { tabs, activeId: existing.id };
  const tab = {
    id,
    serverId: server.id,
    server: { ...server },
    label: server.name,
    status: 'idle'
  };
  return { tabs: [...tabs, tab], activeId: tab.id };
}

/** @param {Array<any>} tabs @param {string} id */
export function removeSftpTab(tabs, id) {
  return tabs.filter((tab) => tab.id !== id);
}

/** @param {Array<any>} tabs @param {string} id @param {string} status */
export function updateSftpTabStatus(tabs, id, status) {
  return tabs.map((tab) => tab.id === id ? { ...tab, status } : tab);
}
