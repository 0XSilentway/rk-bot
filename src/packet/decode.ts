import type { ActorKind, PacketEvent } from './types';

function u16le(b: Uint8Array, off: number): number {
  return b[off]! | (b[off + 1]! << 8);
}
function i16le(b: Uint8Array, off: number): number {
  const v = u16le(b, off);
  return v > 0x7fff ? v - 0x10000 : v;
}
function u32le(b: Uint8Array, off: number): number {
  return (b[off]! | (b[off + 1]! << 8) | (b[off + 2]! << 16) | (b[off + 3]! << 24)) >>> 0;
}
function f32le(b: Uint8Array, off: number): number {
  const dv = new DataView(b.buffer, b.byteOffset + off, 4);
  return dv.getFloat32(0, true);
}

function scanAscii(b: Uint8Array, minLen = 4): string | undefined {
  let run = '';
  let best = '';
  for (const c of b) {
    if (c >= 0x20 && c <= 0x7e) {
      run += String.fromCharCode(c);
    } else {
      if (run.length >= minLen && run.length > best.length) best = run;
      run = '';
    }
  }
  if (run.length >= minLen && run.length > best.length) best = run;
  return best || undefined;
}

function readCStringUtf8(b: Uint8Array, off: number, maxLen: number): string {
  let end = off;
  while (end < off + maxLen && end < b.length && b[end] !== 0) end++;
  return new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(off, end));
}

function sanitizeMapName(s: string): string {
  const m = s.match(/^[a-zA-Z][a-zA-Z0-9_]{1,15}/);
  return m ? m[0] : s;
}

export function decodeFrame(bytes: Uint8Array, ts: number): PacketEvent {
  const op = bytes[0] ?? 0;
  const base = { op, ts, raw: bytes };

  switch (op) {
    case 0x03: {
      // SELECT_CHAR: [03][...][playerId:u32 @ off?][mapName?...]
      if (bytes.length < 7) return { ...base, kind: 'unknown' };
      const playerId = u32le(bytes, 1);
      const raw = scanAscii(bytes.subarray(5), 3);
      const mapName = raw ? sanitizeMapName(raw) : undefined;
      return { ...base, kind: 'select_char', playerId, mapName };
    }

    case 0x06: {
      // SPAWN: [06][kind:1][pad][0x0F marker @6][id:u32 @7]...ASCII name later
      if (bytes.length < 27) return { ...base, kind: 'unknown' };
      const kindByte = bytes[1] ?? 0xff;
      let actorKind: ActorKind = 'unknown';
      if (kindByte === 0) actorKind = 'player';
      else if (kindByte === 1) actorKind = 'monster';
      else if (kindByte === 2) actorKind = 'npc';
      const actorId = u32le(bytes, 7);
      const name = scanAscii(bytes.subarray(26));
      return { ...base, kind: 'spawn', actorId, actorKind, name };
    }

    case 0x07: {
      // MOVE_UPDATE: [07][id:u32][x:i16][y:i16]...
      if (bytes.length < 9) return { ...base, kind: 'unknown' };
      const actorId = u32le(bytes, 1);
      const x = i16le(bytes, 5);
      const y = i16le(bytes, 7);
      return { ...base, kind: 'move', actorId, to: { x, y } };
    }

    case 0x0b: {
      // ATTACK_RESULT: [0b][attacker:u32][victim:u32]... dmg at off 17 optional
      if (bytes.length < 9) return { ...base, kind: 'unknown' };
      const attackerId = u32le(bytes, 1);
      const victimId = u32le(bytes, 5);
      const damage = bytes.length >= 21 ? u32le(bytes, 17) : undefined;
      return { ...base, kind: 'attack_result', attackerId, victimId, damage };
    }

    case 0x0f: {
      // ENTITY_ACTION: [0f][id:u32][action:1] action=3 = mob died
      if (bytes.length < 6) return { ...base, kind: 'unknown' };
      const actorId = u32le(bytes, 1);
      const action = bytes[5] ?? 0;
      return { ...base, kind: 'action', actorId, action };
    }

    case 0x12: {
      // MAP_NAME: [12][name...]
      if (bytes.length < 3) return { ...base, kind: 'unknown' };
      const raw = readCStringUtf8(bytes, 1, bytes.length - 1);
      return { ...base, kind: 'map_name', name: sanitizeMapName(raw) };
    }

    case 0x14: {
      // ENTITY_POS: [14][id:u32][x:i16][y:i16][flag:1]
      if (bytes.length < 10) return { ...base, kind: 'unknown' };
      const actorId = u32le(bytes, 1);
      const x = i16le(bytes, 5);
      const y = i16le(bytes, 7);
      return { ...base, kind: 'pos', actorId, at: { x, y } };
    }

    case 0x17: {
      // DAMAGE_V2: [17][victim:u32][dmg:u32][x:i16][y:i16][flag:1]
      if (bytes.length < 14) return { ...base, kind: 'unknown' };
      const victimId = u32le(bytes, 1);
      const damage = u32le(bytes, 5);
      return { ...base, kind: 'damage', victimId, damage };
    }

    case 0x1b: {
      // DESPAWN: [1b][id:u32]
      if (bytes.length < 5) return { ...base, kind: 'unknown' };
      const actorId = u32le(bytes, 1);
      return { ...base, kind: 'despawn', actorId };
    }

    case 0x1d: {
      // SKILL_RESULT: [1d][sub:1][src:u32]... [dst:u32]... [skill:u16]... [dmg:u32]?
      if (bytes.length < 20) return { ...base, kind: 'unknown' };
      const srcId = u32le(bytes, 2);
      const dstId = u32le(bytes, 10);
      const skillId = u16le(bytes, 14);
      const damage = bytes.length >= 25 ? u32le(bytes, 21) : undefined;
      return { ...base, kind: 'skill_result', srcId, dstId, skillId, damage };
    }

    case 0x22: {
      // EXP: [22][base_tot:u32][base_gain:u32][job_tot:u32][job_gain:u32]
      if (bytes.length < 17) return { ...base, kind: 'unknown' };
      return {
        ...base,
        kind: 'exp',
        baseTotal: u32le(bytes, 1),
        baseGained: u32le(bytes, 5),
        jobTotal: u32le(bytes, 9),
        jobGained: u32le(bytes, 13),
      };
    }

    case 0x24: {
      // DEATH: [24][id:u32]
      if (bytes.length < 5) return { ...base, kind: 'unknown' };
      const actorId = u32le(bytes, 1);
      return { ...base, kind: 'death', actorId };
    }

    case 0x25: {
      // STAT: [25][id:u32][statType:u32][cur:u32][max:u32][flag:1] = 18B
      if (bytes.length < 18) return { ...base, kind: 'unknown' };
      const actorId = u32le(bytes, 1);
      const statType = u32le(bytes, 5);
      const cur = u32le(bytes, 9);
      const max = u32le(bytes, 13);
      return { ...base, kind: 'stat', actorId, statType, cur, max };
    }

    case 0x27: {
      // SP_UPDATE: [27][cur:u32][max:u32] = 9B
      if (bytes.length < 9) return { ...base, kind: 'unknown' };
      return { ...base, kind: 'sp', cur: u32le(bytes, 1), max: u32le(bytes, 5) };
    }

    case 0x38: {
      // MAP_DATA (zone-enter): [38][?...][zeny:u32 @9]... possibly incl self pos
      // superogira notes offset 9 for zeny, but pos may be earlier — try (u16le@1, u16le@3)
      if (bytes.length < 13) return { ...base, kind: 'unknown' };
      return { ...base, kind: 'unknown' }; // TODO: locate self pos offset
    }

    case 0x3c: {
      // ENTITY_LIST or MINIMAP; batch layout guess: [3c][sub:1][count:u16][entry:9]*
      // Only emit first entry (best-effort). Full batch handled via decodeAll().
      if (bytes.length < 4) return { ...base, kind: 'unknown' };
      const count = u16le(bytes, 2);
      const entrySize = 9;
      const headerSize = 4;
      if (count > 0 && count < 200 && bytes.length >= headerSize + entrySize) {
        const id = u32le(bytes, headerSize);
        const x = i16le(bytes, headerSize + 4);
        const y = i16le(bytes, headerSize + 6);
        return { ...base, kind: 'pos', actorId: id, at: { x, y } };
      }
      return { ...base, kind: 'unknown' };
    }

    case 0x36: {
      // DESPAWN_REASON: [36][id:u32][reason:u32]
      if (bytes.length < 9) return { ...base, kind: 'unknown' };
      return { ...base, kind: 'despawn', actorId: u32le(bytes, 1), reason: u32le(bytes, 5) };
    }

    case 0x51: {
      // ITEM_DROP: [51][drop_id:u32][x:f32][y:f32][item:u16][amount:u16]...
      if (bytes.length < 17) return { ...base, kind: 'unknown' };
      const dropId = u32le(bytes, 1);
      const x = f32le(bytes, 5);
      const y = f32le(bytes, 9);
      const itemId = u16le(bytes, 13);
      const amount = u16le(bytes, 15);
      return { ...base, kind: 'drop', dropId, at: { x, y }, itemId, amount };
    }

    case 0x52: {
      // PICKUP_BCAST: [52][drop_id:u32][actor:u32]
      if (bytes.length < 9) return { ...base, kind: 'unknown' };
      return { ...base, kind: 'pickup_bcast', dropId: u32le(bytes, 1), actorId: u32le(bytes, 5) };
    }

    default:
      return { ...base, kind: 'unknown' };
  }
}

/**
 * Like decodeFrame but expands batch packets (0x3c entity list) into
 * multiple events, one per entity entry.
 */
export function decodeAll(bytes: Uint8Array, ts: number): PacketEvent[] {
  const op = bytes[0] ?? 0;
  if (op === 0x3c && bytes.length >= 4) {
    const count = u16le(bytes, 2);
    const entrySize = 9;
    const headerSize = 4;
    if (count > 0 && count < 200 && bytes.length >= headerSize + count * entrySize) {
      const out: PacketEvent[] = [];
      for (let i = 0; i < count; i++) {
        const off = headerSize + i * entrySize;
        const id = u32le(bytes, off);
        const x = i16le(bytes, off + 4);
        const y = i16le(bytes, off + 6);
        out.push({ op, ts, raw: bytes, kind: 'pos', actorId: id, at: { x, y } });
      }
      return out;
    }
  }
  return [decodeFrame(bytes, ts)];
}
