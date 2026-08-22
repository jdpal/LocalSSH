import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { isTauri, resizeSsh, startSsh, stopSsh, writeSsh } from '../api';
import type { ServerProfile } from '../types';

type Props = {
  server: ServerProfile;
  active: boolean;
  onStatus: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
};

type OutputEvent = { sessionId: string; data: string };
type ExitEvent = { sessionId: string };

export default function TerminalPane({ server, active, onStatus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    if (!hostRef.current) return;
    let disposed = false;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 10000,
      theme: { background: '#080a0d', foreground: '#d8dee8', cursor: '#e5e9f0' }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fit.fit();
    terminalRef.current = terminal;
    fitRef.current = fit;
    terminal.writeln(`\x1b[90mLocalSSH · ${server.username}@${server.host}:${server.port}\x1b[0m`);
    onStatus('connecting');

    const dataSubscription = terminal.onData((data) => {
      const session = sessionRef.current;
      if (session) void writeSsh(session, data);
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      const session = sessionRef.current;
      if (session) void resizeSsh(session, cols, rows);
    });

    const observer = new ResizeObserver(() => {
      if (!disposed && activeRef.current) {
        try { fit.fit(); } catch { /* xterm may be between layout frames */ }
      }
    });
    observer.observe(hostRef.current);

    async function connect() {
      try {
        if (isTauri()) {
          unlistenOutput = await listen<OutputEvent>('terminal-output', (event) => {
            if (event.payload.sessionId === sessionRef.current) terminal.write(event.payload.data);
          });
          unlistenExit = await listen<ExitEvent>('terminal-exit', (event) => {
            if (event.payload.sessionId === sessionRef.current) {
              onStatus('disconnected');
              terminal.writeln('\r\n\x1b[90m[connection closed]\x1b[0m');
            }
          });
        }
        const sessionId = await startSsh(server.id, terminal.cols, terminal.rows);
        if (disposed) {
          await stopSsh(sessionId);
          return;
        }
        sessionRef.current = sessionId;
        onStatus('connected');
        if (!isTauri()) {
          terminal.writeln('\x1b[33mBrowser preview mode. Native SSH starts inside the installed Tauri app.\x1b[0m');
          terminal.write(`\r\n\x1b[32m${server.username}@${server.name}\x1b[0m:\x1b[34m~\x1b[0m$ `);
        }
      } catch (error) {
        onStatus('error');
        terminal.writeln(`\r\n\x1b[31m${String(error)}\x1b[0m`);
      }
    }
    void connect();

    return () => {
      disposed = true;
      observer.disconnect();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void stopSsh(session);
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [server.id]);

  useEffect(() => {
    activeRef.current = active;
    if (active) requestAnimationFrame(() => fitRef.current?.fit());
  }, [active]);

  return <div className={`terminal-pane ${active ? 'active' : ''}`}><div ref={hostRef} className="xterm-host" /></div>;
}
