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

1. ~~**Are send opcodes obfuscated?**~~ **RESOLVED in Session B.** No obfuscation. See below.
2. ~~**Coord encoding.**~~ **RESOLVED in Session B.** Plain int16 LE for x and y.
3. **Entity id layout.** `0B20` len=34 spawn packet — bytes 3-6 are almost certainly a uint32 entity id. Correlate with `3C01` middle bytes.
4. **Opcode endianness / length convention.** Move opcode looks like a **1-byte** op (`0x07`), while login is `08 00` (looks like 2-byte). May actually be: all packets have 1-byte op, and multi-byte op is really `op + subcmd`.

## Session 2026-08-15T03-46-49 (Test B — move obfuscation)

Char: same. Action: stand 15s → click A x3 → click B x2 → refresh + login → click A' x1 → close.

**RESULT — no obfuscation. Plain int16 LE coord.**

### Evidence

| seq | rel t | hex | decode |
|-----|-------|-----|--------|
| 24 | +21s | `07 3A 00 89 00` | move to (x=58, y=137) — click A #1 |
| 28 | +27s | `07 3A 00 89 00` | move to (58, 137) — click A #2 (identical) |
| 30 | +34s | `07 3A 00 89 00` | move to (58, 137) — click A #3 (identical) |
| 32 | +39s | `07 35 00 89 00` | move to (53, 137) — click B #1 |
| 37 | +47s | `07 35 00 89 00` | move to (53, 137) — click B #2 (identical) |
| 65 | +64s (after reconnect) | `07 31 00 89 00` | move to (49, 137) — plain again, no key reset |

### Decoded packet: CZ_REQUEST_MOVE

```
byte 0        1        2        3        4
     +--------+-----------------+-----------------+
     |  0x07  |  x  (int16 LE)  |  y  (int16 LE)  |
     +--------+-----------------+-----------------+
```

Total length = 5 bytes. Confirmed by session A (all `07XX 00YY 00` frames) and session B.

### Reverse-engineering implications

- **Zero cryptography.** No XOR key exchange, no rolling counter, no packet obfuscation of any kind.
- **Plain-text leaks:**
  - Login opcode `08 00` payload contains raw ASCII `username\x0cCharname`
  - Warp opcode `40 08` payload starts with ASCII map name
- **Phase 4 (bot → server) will be trivial.** Compose bytes and forward via injector.

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
