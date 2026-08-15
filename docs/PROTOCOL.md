# RayRag WS protocol — reverse-engineering notes

Session dumps live in `captures/session-*.db`. Query with:
```sql
SELECT dir, len, substr(hex(bytes),1,4) as op, hex(bytes) FROM frames
WHERE dir='send' AND hex(bytes) != '04' ORDER BY seq;
```

## Session 2026-08-15T02-11-25 (initial recon)

Char: `Silentway_28` (Thief lvl 18) on map `iz_dun00`. Actions: stand → walk → walk → attack → loot → open inv → open skills → warp → open inv again.

### Send opcodes

| Op (hex, LE first byte first) | Len | Count | Meaning (hypothesis) |
|-------------------------------|-----|-------|----------------------|
| `04` | 1 | 24 | Heartbeat / keepalive ping |
| `02` | 1 | 2 | Ack (after login blob, after warp handshake) |
| `0800` | 30 | 1 | **Login / char-select**. Payload = ASCII `silentway28\x0cSilentway_28` (username + char name plain text) |
| `0396` | 79 | 1 | Auth key blob (follows 0800) |
| `07XX 00 YY 00` | 5 | ~10 | **Move click** — 5-byte packet. Second byte varies (76/78/79/7A/7B/7D) even for the same-looking actions. Two theories: (a) client-side XOR/rolling key obfuscation on the opcode, (b) sequence counter (unlikely, not monotonic). Third byte = 0. Bytes 4-5 = coord? Needs isolation test. |
| `4008 ...ascii...` | 16 | 1 | **Warp / map change**. Payload starts with ASCII map name (e.g. `iz_dun00`) + 2-byte src coord + 2-byte dst coord + trailer `00`. |
| `711E ...` | 392 | 2 | Post-warp big handshake blob. Fired twice back-to-back. Probably map assets ready ack or client-state resync. |
| `0B5F 53 00 00` | 5 | 2 | Skill/attack candidate — 2-byte payload after opcode. `53 00` = little-endian id 0x0053 = **target entity id**? |
| `52A9 37 00 00` | 5 | 1 | Same shape as above but rare. Could be pickup/interact. |

### Recv opcodes

| Op | Len | Count | Meaning (hypothesis) |
|----|-----|-------|----------------------|
| `3C01` | 12 | 191 | **Periodic entity tick** (>50% of all recv). Layout: `3c 01 00 [id:4] [x:2] [y:2] 01 01` — likely mob wander broadcast or self-position echo. |
| `0B20` | 34 | 14 | Spawn / entity intro (34 bytes = enough for id + name + level + pos). |
| `175F` | 14 | 14 | ? |
| `0600` | 67 | 13 | List packet (inventory row / skill row?). |
| `0720` | 30 | 13 | ? |
| `074A` | 30 | 7 | ? |
| `0B5F` | 34 | 6 | Server echo of client 0B5F? |
| `07E3` `07EB` `07D2` `0760` `075F` `07A1` | 30-31 | ~5 each | Related family (0x07XX) — likely stat/skill/item update. |
| `2520` | 18 | 5 | ? |
| `2CD7` | 30 | 3 | ? |
| `0F60` | 6 | 3 | Small status flip. |

### Big unknowns for Phase 2

1. **Are send opcodes obfuscated?** Isolate: log out, log back in, do **exactly one** move click. Compare byte 2. If it differs across sessions with the same coord target, obfuscation is confirmed. If it matches, byte 2 is a coord.
2. **Coord encoding.** RO packs (x,y) into 3 bytes with direction nibble. Isolate: click move to grid (100,100), (101,100), (100,101) — compare bytes 3-5.
3. **Entity id layout.** `0B20` len=34 spawn packet — bytes 3-6 are almost certainly a uint32 entity id. Correlate with `3C01` middle bytes.
4. **Opcode endianness convention.** Recv opcodes look like `LSB first` (0x3C01 → 0x013C). Send opcodes `0800` → 0x0008. Need to confirm consistency.

### Next recon plan (isolated tests)

Each test = fresh login, single controlled action, no walking around:

| Test | Action | What to isolate |
|------|--------|-----------------|
| A | Login, stand still 30s, logout | Ping cadence, initial state dump |
| B | Login, single click at fixed pixel | Move opcode, coord encoding |
| C | Login, /w someone with a known text | Chat opcode + payload alignment |
| D | Login, open Inventory, close | UI-only opcodes vs game opcodes |
| E | Login, use one skill on self (heal/buff) | Skill opcode + target-self flag |
| F | Login, attack single mob to death | Attack loop, damage packet, mob-death packet |

Each test's DB → own row in this table.
