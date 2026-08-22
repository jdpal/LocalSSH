/** @param {Array<any>} tabs @param {any} server @param {string} id */
export function addSessionTab(tabs, server, id = crypto.randomUUID()) {
  return [...tabs, {
    id,
    serverId: server.id,
    server: { ...server },
    label: server.name,
    backendSessionId: null,
    status: 'idle'
  }];
}

/** @param {Array<any>} tabs @param {string} id */
export function removeSessionTab(tabs, id) {
  return tabs.filter((tab) => tab.id !== id);
}

/** @param {Array<any>} tabs @param {'terminal'|'files'} view */
export function terminalStackState(tabs, view) {
  return {
    mounted: tabs.length > 0,
    visible: view === 'terminal'
  };
}
