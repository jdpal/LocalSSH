export type HostKeyInfo = { keyType: string; fingerprint: string };
export type HostKeyCheck = {
  state: 'trusted' | 'unknown' | 'mismatch';
  host: string;
  port: number;
  fingerprints: HostKeyInfo[];
  knownFingerprints: HostKeyInfo[];
};

function fingerprintText(items: HostKeyInfo[]): string {
  return items.length
    ? items.map((item) => `${item.keyType}: ${item.fingerprint}`).join('\n')
    : 'Unavailable';
}

function makeDialog(check: HostKeyCheck, mismatch: boolean): { backdrop: HTMLDivElement; panel: HTMLElement } {
  const backdrop = document.createElement('div');
  backdrop.className = 'host-key-backdrop';

  const panel = document.createElement('section');
  panel.className = `host-key-dialog${mismatch ? ' mismatch' : ''}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'host-key-dialog-title');

  const title = document.createElement('h2');
  title.id = 'host-key-dialog-title';
  title.textContent = mismatch ? 'Host key mismatch' : 'Unknown SSH host key';

  const host = document.createElement('p');
  host.className = 'host-key-host';
  host.textContent = `${check.host}:${check.port}`;

  const intro = document.createElement('p');
  intro.textContent = mismatch
    ? 'The saved host key does not match the key currently presented by this server. LocalSSH has blocked the connection.'
    : 'This server is not yet trusted on this Mac. Verify the fingerprint with your server provider or another trusted source before continuing.';

  panel.append(title, host, intro);

  if (mismatch) {
    const savedLabel = document.createElement('strong');
    savedLabel.textContent = 'Saved fingerprint(s)';
    const saved = document.createElement('pre');
    saved.textContent = fingerprintText(check.knownFingerprints);
    panel.append(savedLabel, saved);
  }

  const presentedLabel = document.createElement('strong');
  presentedLabel.textContent = 'Presented fingerprint(s)';
  const presented = document.createElement('pre');
  presented.textContent = fingerprintText(check.fingerprints);
  panel.append(presentedLabel, presented);

  const actions = document.createElement('div');
  actions.className = 'host-key-actions';
  panel.append(actions);
  backdrop.append(panel);
  return { backdrop, panel };
}

export function promptHostKeyTrust(check: HostKeyCheck): Promise<boolean> {
  return new Promise((resolve) => {
    const { backdrop, panel } = makeDialog(check, false);
    const actions = panel.querySelector<HTMLDivElement>('.host-key-actions')!;

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'subtle';
    cancel.textContent = 'Cancel';

    const trust = document.createElement('button');
    trust.type = 'button';
    trust.className = 'primary';
    trust.textContent = 'Trust & Connect';

    const finish = (accepted: boolean) => {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      resolve(accepted);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish(false);
    };

    cancel.addEventListener('click', () => finish(false), { once: true });
    trust.addEventListener('click', () => finish(true), { once: true });
    document.addEventListener('keydown', onKeyDown);
    actions.append(cancel, trust);
    document.body.append(backdrop);
    trust.focus();
  });
}

export function showHostKeyMismatch(check: HostKeyCheck): Promise<void> {
  return new Promise((resolve) => {
    const { backdrop, panel } = makeDialog(check, true);
    const actions = panel.querySelector<HTMLDivElement>('.host-key-actions')!;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'primary';
    close.textContent = 'Close';
    const finish = () => {
      document.removeEventListener('keydown', onKeyDown);
      backdrop.remove();
      resolve();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
    close.addEventListener('click', finish, { once: true });
    document.addEventListener('keydown', onKeyDown);
    actions.append(close);
    document.body.append(backdrop);
    close.focus();
  });
}
