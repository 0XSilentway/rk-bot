import { openRawLog, type RawLog } from '../persist/raw-log';
import { decodeAll } from '../packet/decode';
import { applyEvent } from '../state/apply';
import { WorldState } from '../state/world';
import { startDashboard } from '../state/dashboard';
import { startBrain, pauseBrain, resumeBrain } from '../bot/brain';
import { startMonitor } from '../monitor/server';
import { tryAutoLogin, watchLogin } from '../bot/auto-login';
import type { ServerWebSocket } from 'bun';

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

interface InjectorSocket extends ServerWebSocket<unknown> {}

interface RelayOpts {
  port: number;
}

export function startRelay(opts: RelayOpts) {
  const log = openRawLog();
  const world = new WorldState();
  let seq = 0;
  let injector: InjectorSocket | undefined;
  let activeWsId: number | undefined;

  const send = (bytes: Uint8Array) => {
    if (!injector || !activeWsId) {
      console.warn('[relay] send skipped: no injector or ws not open');
      return;
    }
    const b64 = Buffer.from(bytes).toString('base64');
    injector.send(JSON.stringify({ t: 'inject', wsId: activeWsId, data: b64 }));
  };

  startDashboard(world);
  watchLogin();
  const brain = startBrain(world, send);

  // Web dashboard on port +1
  startMonitor(opts.port + 1, world, {
    pause: () => pauseBrain(brain),
    resume: () => resumeBrain(brain, world, send),
    isPaused: () => (brain as unknown as { paused: boolean }).paused,
  });

  Bun.serve({
    port: opts.port,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response('rk-bot relay', { status: 200 });
    },
    websocket: {
      open(ws) {
        injector = ws as InjectorSocket;
        console.log('[relay] injector connected');
        ws.send(JSON.stringify({ t: 'welcome', phase: 3 }));
      },
      close(ws) {
        if (injector === ws) injector = undefined;
        console.log('[relay] injector disconnected');
      },
      message(ws, raw) {
        let msg: WireMessage;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          console.warn('[relay] bad json');
          return;
        }
        seq++;
        handle(log, world, seq, msg, (id) => { activeWsId = id; }, send);
      },
    },
  });

  // simple CLI over stdin
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (buf) => {
    const line = buf.toString().trim().toLowerCase();
    if (line === 'pause') pauseBrain(brain);
    else if (line === 'resume') resumeBrain(brain, world, send);
    else if (line === 'stat') dumpStat(world);
    else if (line === 'dump') dumpActors(world);
    else if (line === 'verbose') { verbose = !verbose; console.log('[relay] verbose =', verbose); }
  });
  console.log('[relay] cli: pause | resume | stat | dump | verbose');
}

let verbose = false;

function dumpActors(world: WorldState) {
  console.log(`\n=== ACTORS (${world.actors.size}) ===`);
  for (const a of world.actors.values()) {
    const pos = a.pos ? `(${a.pos.x},${a.pos.y})` : '?';
    const posTo = a.posTo ? ` →(${a.posTo.x},${a.posTo.y})` : '';
    console.log(
      `  id=0x${a.id.toString(16).padStart(8, '0')} kind=${a.kind} name=${a.name ?? '?'} pos=${pos}${posTo} alive=${a.alive}`,
    );
  }
  console.log(`=== DROPS (${world.drops.size}) ===`);
  for (const d of world.drops.values()) {
    console.log(`  id=0x${d.dropId.toString(16)} item=${d.itemId} amt=${d.amount} at=(${d.at.x.toFixed(1)},${d.at.y.toFixed(1)})`);
  }
  console.log('');
}

function dumpStat(world: WorldState) {
  console.log('[stat]', {
    self: world.self,
    actors: world.actors.size,
    drops: world.drops.size,
    kills: world.killsSession,
    loot: world.lootedSession,
    exp: world.expGainedSession,
  });
}

function handle(
  log: RawLog,
  world: WorldState,
  seq: number,
  msg: WireMessage,
  setActiveWs: (id: number) => void,
  send: (bytes: Uint8Array) => void,
): void {
  switch (msg.t) {
    case 'hello':
      log.event(seq, msg.ts, 'hello', JSON.stringify({ ua: msg.ua, href: msg.href }));
      console.log(`[relay] hello from ${msg.href}`);
      return;
    case 'ws-open':
      console.log(`[relay] ws#${msg.id} open ${msg.url}`);
      log.event(seq, msg.ts, 'open', JSON.stringify({ id: msg.id, url: msg.url }));
      if (typeof msg.id === 'number') setActiveWs(msg.id);
      // fire auto-login (async — doesn't block relay). ws must be set as active first.
      if (typeof msg.id === 'number') setActiveWs(msg.id);
      tryAutoLogin(msg.url, send).catch(e => console.warn('[login] failed', e));
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
      if (kind === 'binary' && msg.data) bytes = base64ToBytes(msg.data);
      else if (kind === 'text' && msg.data) text = msg.data;
      log.frame(seq, msg.ts, msg.id ?? 0, dir, kind, bytes, text);
      if (verbose && bytes && bytes.length > 1) {
        const hex = Array.from(bytes.slice(0, 20)).map(b => b.toString(16).padStart(2,'0')).join('');
        console.log(`[${dir}] op=0x${bytes[0]!.toString(16).padStart(2,'0')} len=${bytes.length} ${hex}${bytes.length > 20 ? '...' : ''}`);
      }
      if (dir === 'recv' && bytes) {
        if (typeof msg.id === 'number') setActiveWs(msg.id);
        try {
          for (const ev of decodeAll(bytes, msg.ts)) applyEvent(world, ev);
        } catch (e) {
          console.warn('[relay] decode error', e);
        }
      }
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
