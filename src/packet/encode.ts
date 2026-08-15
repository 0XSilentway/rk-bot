function writeU16LE(b: Uint8Array, off: number, v: number): void {
  b[off] = v & 0xff;
  b[off + 1] = (v >> 8) & 0xff;
}
function writeI16LE(b: Uint8Array, off: number, v: number): void {
  writeU16LE(b, off, v < 0 ? v + 0x10000 : v);
}
function writeU32LE(b: Uint8Array, off: number, v: number): void {
  b[off] = v & 0xff;
  b[off + 1] = (v >> 8) & 0xff;
  b[off + 2] = (v >> 16) & 0xff;
  b[off + 3] = (v >>> 24) & 0xff;
}

export function buildMove(x: number, y: number): Uint8Array {
  const b = new Uint8Array(5);
  b[0] = 0x07;
  writeI16LE(b, 1, x);
  writeI16LE(b, 3, y);
  return b;
}

export function buildAttack(targetId: number): Uint8Array {
  const b = new Uint8Array(5);
  b[0] = 0x0b;
  writeU32LE(b, 1, targetId);
  return b;
}

export function buildSkillTarget(targetId: number, skillId: number, level: number): Uint8Array {
  const b = new Uint8Array(8);
  b[0] = 0x1d;
  b[1] = 0x01;
  writeU32LE(b, 2, targetId);
  b[6] = skillId & 0xff;
  b[7] = level & 0xff;
  return b;
}

export function buildSkillGround(x: number, y: number, skillId: number, level: number): Uint8Array {
  const b = new Uint8Array(8);
  b[0] = 0x1d;
  b[1] = 0x04;
  writeI16LE(b, 2, x);
  writeI16LE(b, 4, y);
  b[6] = skillId & 0xff;
  b[7] = level & 0xff;
  return b;
}

export function buildSkillSelf(skillId: number, level: number): Uint8Array {
  const b = new Uint8Array(5);
  b[0] = 0x1d;
  b[1] = 0x05;
  writeU16LE(b, 2, skillId);
  b[4] = level & 0xff;
  return b;
}

export function buildPickup(dropId: number): Uint8Array {
  const b = new Uint8Array(5);
  b[0] = 0x52;
  writeU32LE(b, 1, dropId);
  return b;
}

export function buildRespawn(): Uint8Array {
  return new Uint8Array([0x29, 0x00]);
}

export function buildSit(): Uint8Array {
  return new Uint8Array([0x0e, 0x01]);
}
export function buildStand(): Uint8Array {
  return new Uint8Array([0x0e, 0x00]);
}

export function buildUseItem(itemId: number, targetId = 0xffffffff): Uint8Array {
  const b = new Uint8Array(9);
  b[0] = 0x2f;
  writeU32LE(b, 1, itemId);
  writeU32LE(b, 5, targetId);
  return b;
}

/**
 * 0x40 map warp — server accepts direct warp without Kafra dialog on RayRag.
 * Layout: [40][mapname_len:u16 LE][mapname UTF-8][x:i16 LE][y:i16 LE][00]
 * Verified from Session A and superogira sendTeleport() line 850.
 */
export function buildWarp(mapName: string, x: number, y: number): Uint8Array {
  const nameBytes = new TextEncoder().encode(mapName);
  const b = new Uint8Array(1 + 2 + nameBytes.length + 2 + 2 + 1);
  let p = 0;
  b[p++] = 0x40;
  writeU16LE(b, p, nameBytes.length); p += 2;
  b.set(nameBytes, p); p += nameBytes.length;
  writeI16LE(b, p, x); p += 2;
  writeI16LE(b, p, y); p += 2;
  b[p] = 0x00;
  return b;
}

/** Random-spot warp within the current map. Server treats (-999,-999) as random. */
export function buildWarpRandom(mapName: string): Uint8Array {
  return buildWarp(mapName, -999, -999);
}
