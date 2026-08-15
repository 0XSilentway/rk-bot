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

## Session F (Test F — attack + skill combo) — 2026-08-15

Char: Mage lvl 21 SP 195/195, target Peco Peco Egg lvl 10. Actions: attack Peco Egg (physical, 2 dmg each), then Fire Bolt (skill 0x080C = 2060), pickup dropped items.

**RESULT — 10+ opcodes decoded. Full damage/exp/drop pipeline mapped.**

### Send opcodes confirmed

| Opcode | Layout | Meaning | Sample |
|--------|--------|---------|--------|
| `0B` | `0B <target:u32 LE>` = 5B | **ATTACK** | `0B 8F 1A 00 00` → attack entity 0x1A8F |
| `1D` | `1D 01 <target:u32> <skill:u16 LE>` = 8B | **SKILL CAST** | `1D 01 8F1A0000 0C08` → skill 2060 on 0x1A8F |
| `52` | `52 <drop_id:u32 LE>` = 5B | **PICKUP** | `52 9D 59 00 00` → pickup drop 0x599D |

### Recv opcodes confirmed

| Opcode | Layout | Meaning | Notes |
|--------|--------|---------|-------|
| `17` | `17 <target:u32> <damage:u32> 2F 00 91 00 <flag:u8>` = 14B | **DAMAGE** | dmg=2 matches "2" hitmark on screen. `2F 00 91 00` seems fixed (maybe attacker id or hit-type). |
| `22` | `22 <base_total:u32> <base_gained:u32> <job_total:u32> <job_gained:u32>` = 17B | **EXP GAIN** | base 649→681 (+32), job 954→982 (+28) exactly matches char screen |
| `26` | `26 <actor:u32> ...` = 9B | Actor tick (HP-related?) | all 3 samples identical, needs isolation |
| `27` | `27 <sp_cur:u32 LE> <sp_max:u32 LE>` = 9B | **SP UPDATE** | Values A9/B9/C3 = 169/185/195, max C3 = 195 matches char screen |
| `06` len=90 | `06 ...` includes ASCII mob name | **MOB SPAWN** | Contains `Picky` in plain text |
| `1D` len=36 | `1D 01 <src> FFFFFFFF <target> <skill:u16> <?> <dmg:u32> ...` | **SKILL RESULT** | dmg=77 (0x4D) at offset ~21 |
| `18` len=21 | ? | Pre-skill echo? | Fired just before 1D result |
| `51` len=21 | `51 <drop_id:u32> <x:f32> <y:f32> <item:u16> <amt:u16> ...` | **ITEM DROP** | Coords are **float32 LE** here, unlike int16 in move packet |
| `52` len=9 | `52 <drop_id:u32> <actor:u32>` | **PICKUP CONFIRM** | Broadcast to all players in range |
| `0B` len=34 x77 | ? | Combat/mob-state broadcast | Dominates during fight — every hit generates one |
| `0F` len=10 | `0F <actor:u32> <?:u16> 80 BF` | Actor tick | `80 BF` = float -1.0 (0xBF800000) — direction? |
| `3C` | as before | Position tick | Confirmed generic entity tick |

### Big picture

Combat loop for the bot will be:
```
1. Parse 0x06 spawn packets → build mob list (name, id, pos)
2. Send 0x0B <target_id> to auto-attack (or 0x1D for skill)
3. Watch 0x17 damage packets to track kill progress
4. On 0x22 exp gain → mob dead; scan for 0x51 drop packets
5. Send 0x52 <drop_id> to loot
```

### Character self-id

- Own actor id observed: `64 C6 0E 00` = **0x000EC664** (appears as `src` in 1D skill, as actor in 26/0F ticks)

### Skill ID mapping

- `0x080C` = 2060 = **Fire Bolt** (or whichever bolt user cast). Vanilla RO Fire Bolt = 14 (0x0E). Rebuild-Ragnarok reindexes skill IDs.

### Coord encoding inconsistency

- Move (client → server): `int16 LE x,y`
- Drop packet (server → client): `float32 LE x,y`
- Position tick 0x3C: unclear yet

Bot needs both codecs.

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
