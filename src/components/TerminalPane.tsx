import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { isTauri, resizeSsh, startSsh, stopSsh, writeSsh } from '../api';
import type { ServerProfile } from '../types';

type Props = { server: ServerProfile; active: boolean; onStatus: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void };
type SessionEvent = { sessionId: string };
type OutputEvent = SessionEvent & { data: string };

const DEFAULT_FONT_SIZE = 12;
const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 24;

export default function TerminalPane({ server, active, onStatus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const pendingConnectedRef = useRef<string | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    if (!hostRef.current) return;
    let disposed = false;
    let unlistenOutput: (() => void) | undefined;
    let unlistenConnected: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: DEFAULT_FONT_SIZE,
      lineHeight: 1.2,
      scrollback: 10000,
      minimumContrastRatio: 4.5,
      theme: {
        background: '#080a0d',
        foreground: '#d8dee8',
        cursor: '#f2f4f8',
        cursorAccent: '#080a0d',
        selectionBackground: '#334155',
        black: '#1b1f27',
        red: '#ff6b6b',
        green: '#69db7c',
        yellow: '#ffd43b',
        blue: '#74c0fc',
        magenta: '#da77f2',
        cyan: '#66d9e8',
        white: '#dee2e6',
        brightBlack: '#868e96',
        brightRed: '#ff8787',
        brightGreen: '#8ce99a',
        brightYellow: '#ffe066',
        brightBlue: '#a5d8ff',
        brightMagenta: '#e599f7',
        brightCyan: '#99e9f2',
        brightWhite: '#f8f9fa',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit); terminal.open(hostRef.current); fit.fit(); fitRef.current = fit;

    const refit = () => requestAnimationFrame(() => { try { fit.fit(); } catch { /* layout transition */ } });
    const setFontSize = (next: number) => {
      terminal.options.fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next));
      refit();
    };

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const key = event.key.toLowerCase();

      if (event.metaKey && !event.ctrlKey && !event.altKey) {
        if (key === 'k') {
          event.preventDefault();
          terminal.clear();
          terminal.scrollToBottom();
          return false;
        }
        if (key === 'c') {
          event.preventDefault();
          if (terminal.hasSelection()) {
            const selected = terminal.getSelection();
            if (selected && navigator.clipboard?.writeText) void navigator.clipboard.writeText(selected).catch(() => undefined);
          }
          return false;
        }
        if (key === 'v') {
          event.preventDefault();
          if (navigator.clipboard?.readText) {
            void navigator.clipboard.readText().then((text) => { if (text) terminal.paste(text); }).catch(() => undefined);
          }
          return false;
        }
        if (key === 'a') {
          event.preventDefault();
          terminal.selectAll();
          return false;
        }
        if (key === '+' || key === '=') {
          event.preventDefault();
          setFontSize(Number(terminal.options.fontSize ?? DEFAULT_FONT_SIZE) + 1);
          return false;
        }
        if (key === '-') {
          event.preventDefault();
          setFontSize(Number(terminal.options.fontSize ?? DEFAULT_FONT_SIZE) - 1);
          return false;
        }
        if (key === '0') {
          event.preventDefault();
          setFontSize(DEFAULT_FONT_SIZE);
          return false;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          terminal.scrollToTop();
          return false;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          terminal.scrollToBottom();
          return false;
        }
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === 'PageUp') {
        event.preventDefault();
        terminal.scrollPages(-1);
        return false;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === 'PageDown') {
        event.preventDefault();
        terminal.scrollPages(1);
        return false;
      }

      return true;
    });

    onStatus('connecting');

    const dataSubscription = terminal.onData((data) => { const session = sessionRef.current; if (session) void writeSsh(session, data); });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => { const session = sessionRef.current; if (session) void resizeSsh(session, cols, rows); });
    const observer = new ResizeObserver(() => { if (!disposed && activeRef.current) { try { fit.fit(); } catch { /* layout transition */ } } });
    observer.observe(hostRef.current);

    async function connect() {
      try {
        if (isTauri()) {
          unlistenOutput = await listen<OutputEvent>('terminal-output', (event) => { if (event.payload.sessionId === sessionRef.current) terminal.write(event.payload.data); });
          unlistenConnected = await listen<SessionEvent>('terminal-connected', (event) => {
            if (sessionRef.current === event.payload.sessionId) onStatus('connected');
            else pendingConnectedRef.current = event.payload.sessionId;
          });
          unlistenExit = await listen<SessionEvent>('terminal-exit', (event) => {
            if (event.payload.sessionId === sessionRef.current) {
              onStatus('disconnected');
              terminal.writeln('\r\n\x1b[90m[connection closed]\x1b[0m');
            }
          });
        }
        const sessionId = await startSsh(server.id, terminal.cols, terminal.rows);
        if (disposed) { await stopSsh(sessionId); return; }
        sessionRef.current = sessionId;
        if (pendingConnectedRef.current === sessionId) { pendingConnectedRef.current = null; onStatus('connected'); }
        if (!isTauri()) { onStatus('connected'); terminal.write(`\r\n\x1b[32m${server.username}@${server.name}\x1b[0m:\x1b[34m~\x1b[0m$ `); }
      } catch (error) { onStatus('error'); terminal.writeln(`\r\n\x1b[31m${String(error)}\x1b[0m`); }
    }
    void connect();

    return () => {
      disposed = true; observer.disconnect(); dataSubscription.dispose(); resizeSubscription.dispose(); unlistenOutput?.(); unlistenConnected?.(); unlistenExit?.();
      const session = sessionRef.current; sessionRef.current = null; if (session) void stopSsh(session); terminal.dispose(); fitRef.current = null;
    };
  }, [server.id]);

  useEffect(() => { activeRef.current = active; if (active) requestAnimationFrame(() => fitRef.current?.fit()); }, [active]);
  return <div className={`terminal-pane ${active ? 'active' : ''}`}><div ref={hostRef} className="xterm-host" /></div>;
}
