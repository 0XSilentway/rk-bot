import { openRawLog, type RawLog } from '../persist/raw-log';

type FrameKind = 'text' | 'binary' | 'blob-pending' | 'unknown';

interface WireMessage {
  t: 'hello' | 'ws-open' | 'ws-send' | 'ws-recv' | 'ws-close';
  id?: number;
  url?: string;
  code?: number;
  reason?: string;
  ts: number;
  kind?: FrameKind;
  data?: string;
  size?: number;
  type?: string;
  ua?: string;
  href?: string;
}

interface RelayOpts {
  port: number;
}

export function startRelay(opts: RelayOpts) {
  const log = openRawLog();
  let seq = 0;

  Bun.serve({
    port: opts.port,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response('rk-bot relay', { status: 200 });
    },
    websocket: {
      open(ws) {
        console.log('[relay] injector connected');
        ws.send(JSON.stringify({ t: 'welcome', phase: 1 }));
      },
      close() {
        console.log('[relay] injector disconnected');
      },
      message(_ws, raw) {
        let msg: WireMessage;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          console.warn('[relay] bad json', raw);
          return;
        }
        seq++;
        handle(log, seq, msg);
      },
    },
  });
}

function handle(log: RawLog, seq: number, msg: WireMessage) {
  switch (msg.t) {
    case 'hello':
      console.log(`[relay] hello from ${msg.href}`);
      log.event(seq, msg.ts, 'hello', JSON.stringify({ ua: msg.ua, href: msg.href }));
      return;
    case 'ws-open':
      console.log(`[relay] ws#${msg.id} open ${msg.url}`);
      log.event(seq, msg.ts, 'open', JSON.stringify({ id: msg.id, url: msg.url }));
      return;
    case 'ws-close':
      console.log(`[relay] ws#${msg.id} close code=${msg.code}`);
      log.event(seq, msg.ts, 'close', JSON.stringify({ id: msg.id, code: msg.code, reason: msg.reason }));
      return;
    case 'ws-send':
    case 'ws-recv': {
      const dir = msg.t === 'ws-send' ? 'send' : 'recv';
      const kind = msg.kind ?? 'unknown';
      let bytes: Uint8Array | null = null;
      let text: string | null = null;
      if (kind === 'binary' && msg.data) {
        bytes = base64ToBytes(msg.data);
      } else if (kind === 'text' && msg.data) {
        text = msg.data;
      }
      log.frame(seq, msg.ts, msg.id ?? 0, dir, kind, bytes, text);
      const preview = bytes
        ? bytes.slice(0, 32).reduce((s, b) => s + b.toString(16).padStart(2, '0') + ' ', '')
        : (text ?? '').slice(0, 80);
      const len = bytes?.length ?? text?.length ?? 0;
      console.log(`[relay] ws#${msg.id} ${dir} ${kind} len=${len} :: ${preview}`);
      return;
    }
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
