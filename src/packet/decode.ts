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
function i32le(b: Uint8Array, off: number): number {
  const v = u32le(b, off);
  return v > 0x7fffffff ? v - 0x100000000 : v;
}
function validCoord(x: number, y: number): boolean {
  return x >= -500 && x <= 1000 && y >= -500 && y <= 1000;
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
      // 0x06 SPAWN — layout mirrored from superogira line 1442-1520:
      //   [06][flag:1][?4][0x0F @6][id:u32 @7][sub:u32 @11][?4]
      //   [z:i32 @19][nameLen:u32 @23][name UTF-8 @27...]
      //   After name: EITHER
      //     - nameLen path: kind = bytes[nameEnd]
      //     - scan path (if UTF-8 truncated): [00 00][kind<=2] → kind = bytes[nameEnd+2]
      //   Then: x:i32 @nameEnd+3, y:i32 @nameEnd+7, hp:u32 @+12, hpMax:u32 @+16
      if (bytes.length < 27) return { ...base, kind: 'unknown' };
      const actorId = u32le(bytes, 7);
      const nameLen = u32le(bytes, 23);

      let nameEnd = -1;
      let kind = -1;
      let scanPath = false;

      // Try nameLen path first
      if (nameLen > 0 && nameLen < 32 && bytes.length >= 27 + nameLen + 3) {
        const lastByte = bytes[27 + nameLen - 1] ?? 0;
        const looksTruncated = lastByte >= 0x80; // UTF-8 continuation
        if (!looksTruncated) {
          nameEnd = 27 + nameLen;
          const k = bytes[nameEnd] ?? 0xff;
          if (k <= 2) kind = k;
          else {
            // nameLen was misleading; fall through to scan
            nameEnd = -1;
          }
        }
      }

      // Fallback: scan for [00 00][kind<=2]
      if (nameEnd < 0) {
        for (let i = 27; i < bytes.length - 2; i++) {
          if (bytes[i] === 0 && bytes[i + 1] === 0 && (bytes[i + 2] ?? 0xff) <= 2) {
            nameEnd = i;
            kind = bytes[i + 2]!;
            scanPath = true;
            break;
          }
        }
      }
      if (nameEnd < 0 || kind < 0) return { ...base, kind: 'unknown' };

      const name = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(27, nameEnd));

      let actorKind: ActorKind = 'unknown';
      if (kind === 0) actorKind = 'player';
      else if (kind === 1) actorKind = 'monster';
      else if (kind === 2) actorKind = 'npc';

      // Coord/HP offsets are relative to nameEnd; scan path uses nameEnd (with kind@+2)
      // but data offset is same: nameLen path data starts at nameEnd+1 (kind is 1 byte)
      // scan path data starts at nameEnd+3 ([00 00][kind])
      // superogira uses nameEnd+3 uniformly: for nameLen path, this means it skips
      // 2 bytes that happen to be 0 padding after kind. Empirically that works.
      const dataOff = scanPath ? nameEnd + 3 : nameEnd + 3;
      let at: { x: number; y: number } | undefined;
      if (bytes.length >= dataOff + 8) {
        const x = i32le(bytes, dataOff);
        const y = i32le(bytes, dataOff + 4);
        if (validCoord(x, y)) at = { x, y };
      }
      return { ...base, kind: 'spawn' as const, actorId, actorKind, name, at };
    }

    case 0x07: {
      // 0x07 MOVE_UPDATE — [07][id:u32][x:i16][y:i16]... (superogira line 940)
      if (bytes.length < 9) return { ...base, kind: 'unknown' };
      const actorId = u32le(bytes, 1);
      const x = i16le(bytes, 5);
      const y = i16le(bytes, 7);
      if (!validCoord(x, y)) return { ...base, kind: 'unknown' };
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
      // 0x14 ENTITY_POS — [14][id:u32][x:i16][y:i16][flag:1] (superogira line 1584)
      if (bytes.length < 10) return { ...base, kind: 'unknown' };
      const actorId = u32le(bytes, 1);
      const x = i16le(bytes, 5);
      const y = i16le(bytes, 7);
      if (!validCoord(x, y)) return { ...base, kind: 'unknown' };
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
      // 0x3c MINIMAP_MARKER — dual mode (superogira line 1257):
      //   sub=1: single entity [3c][01 00][id:u32 @3][x:i16 @7][y:i16 @9][flag @11] (12B)
      //   sub=7/13: multi-entity list; entries start at offset 3, 9B each
      //     [id:u32][x:i16][y:i16][flag:u8]
      // decodeAll() expands multi to N events.
      if (bytes.length < 12) return { ...base, kind: 'unknown' };
      const sub = u16le(bytes, 1);
      if (sub === 1) {
        const id = u32le(bytes, 3);
        const x = i16le(bytes, 7);
        const y = i16le(bytes, 9);
        if (validCoord(x, y)) return { ...base, kind: 'pos', actorId: id, at: { x, y } };
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
      // PICKUP_BCAST: [52][actor:u32][drop_id:u32] — layout confirmed from Session F
      // (52 64 c6 0e 00 9d 59 00 00 → actor=0xEC664, drop=0x599D)
      if (bytes.length < 9) return { ...base, kind: 'unknown' };
      return { ...base, kind: 'pickup_bcast', actorId: u32le(bytes, 1), dropId: u32le(bytes, 5) };
    }

    default:
      return { ...base, kind: 'unknown' };
  }
}

/**
 * decodeAll expands multi-entity packets:
 *   0x3c sub=7 or sub=13 → N pos events (initial map dump after warp)
 * Everything else = single event from decodeFrame.
 */
export function decodeAll(bytes: Uint8Array, ts: number): PacketEvent[] {
  const op = bytes[0] ?? 0;
  if (op === 0x3c && bytes.length >= 5) {
    const sub = u16le(bytes, 1);
    if (sub === 7 || sub === 13 || sub === 4) {
      const out: PacketEvent[] = [];
      let p = 3;
      while (p + 9 <= bytes.length) {
        const id = u32le(bytes, p);
        const x = i16le(bytes, p + 4);
        const y = i16le(bytes, p + 6);
        // const flag = bytes[p + 8]; — could be used to set kind
        p += 9;
        if (id && validCoord(x, y)) {
          out.push({ op, ts, raw: bytes, kind: 'pos', actorId: id, at: { x, y } });
        }
      }
      if (out.length > 0) return out;
    }
  }
  return [decodeFrame(bytes, ts)];
}
