# RayRag WS protocol

Server: `websea01.rayrag.com` (Rebuild-Ragnarok Unity WebGL).
Fully in the clear — no encryption, no obfuscation.

## Framing

- **Opcode = 1 byte** at frame offset 0. (Earlier we incorrectly treated first 2 bytes as opcode; that was op + first-arg byte.)
- No length prefix; message boundary = WebSocket frame boundary.
- Multi-byte integers = **little-endian**.
- Coord encoding varies by context:
  - Move commands (send): `int16 LE`
  - Item drop broadcasts (recv): `float32 LE`
  - Entity position ticks: mixed, needs case-by-case decode

## Send opcodes (client → server)

| Op | Name | Layout | Notes |
|----|------|--------|-------|
| `0x02` | ACK | `[02]` | 1B. Sent after login-blob and after warp handshake. |
| `0x03` | AUTH | `[03] 96 00 ...` | 79B. Auth key blob following login. |
| `0x04` | HEARTBEAT | `[04]` | 1B. Every ~3s. |
| `0x07` | MOVE | `[07][x:i16 LE][y:i16 LE]` | 5B. Confirmed in Session B. |
| `0x08` | LOGIN | `[08] 00 00 00 00 [ulen:1] user [clen:1] char` | 30B. **Plain ASCII creds.** |
| `0x0B` | ATTACK | `[0B][target:u32 LE]` | 5B. Confirmed in Session F. |
| `0x0E` | SIT/STAND | `[0E][state:1]` | `1`=sit, `0`=stand. |
| `0x1D 01` | SKILL_TARGET | `[1D][01][target:u32][skill:u8][lvl:u8]` | 8B. Target skill. Confirmed. |
| `0x1D 04` | SKILL_GROUND | `[1D][04][x:i16][y:i16][skill:u8][lvl:u8]` | 8B. AoE placed on ground. |
| `0x1D 05` | SKILL_SELF | `[1D][05][skill:u16 LE][lvl:u8]` | 5B. Buff on self. |
| `0x29` | RESPAWN | `[29][00]` | 2B. After death. |
| `0x2C` | CHAT | `[2C][msg_len:u16 LE][utf8 msg][chat_type:1]` | chat_type: 0 nearby, 1 shout, 2 whisper. Cap 200B. |
| `0x2F` | USE_ITEM | `[2F][item_id:u32 LE][target:u32 LE]` | target `FFFFFFFF` = self. |
| `0x40 08` | WARP | `[40][map_len:u16 LE][utf8 mapname][x:i16 LE][y:i16 LE][00]` | 16B for `iz_dun00`. Random warp = `x=y=-999`. |
| `0x4C` | NPC_TALK | `[4C][npc_id:u32 LE]` | Open dialog. |
| `0x4E` | NPC_NEXT | `[4E]` | Advance dialog. |
| `0x4F` | NPC_SELECT | `[4F][option_idx:u32 LE]` | Pick menu option. |
| `0x52` | PICKUP | `[52][drop_id:u32 LE]` | 5B. |
| `0x56 01` | STORAGE_MOVE | `[56][01][inv_id:u32][amount:u32]` | 10B. Deposit item. `inv_id` = itemId (stackable) or slotId (equip). |
| `0x56 00` | STORAGE_CLOSE | `[56][00]` | 2B. |
| `0x57` | SELL_ITEMS | `[57][count:u32 LE]([item_id:u32][count:u32])×N` | `count=0` → cancel sell. |

### Chained flows

- **NPC sell**: `0x4C talk → 0x4E next (maybe multiple) → 0x53 recv sell_open → 0x57 sell_items → 0x5B recv sell_result`
- **NPC storage**: `0x4C talk → 0x4D recv dialog → 0x4F select storage → 0x56 01 per item → 0x56 00 close`
- **Warp retry**: on `0x2A recv warp_fail`, try next offset coord (e.g., ±1 tile).

## Recv opcodes (server → client)

| Op | Name | Layout | Notes |
|----|------|--------|-------|
| `0x03` | SELECT_CHAR | `[03] ... map ...` | Reply to char select. **Embeds initial mapName** — otherwise `0x12` MAP_NAME does not fire on first login. |
| `0x06` | SPAWN | `[06] kind ... 0x0F @ off6 [id:u32 @ off7] ... name` | `kind`: 0=player, 1=monster, 2=NPC. Name is UTF-8, truncated if last byte ≥ 0x80. |
| `0x07` | MOVE_UPDATE | `[07][id:u32][x:i16][y:i16]...` | Position update for any entity (self + others). |
| `0x0B` | ATTACK_RESULT | `[0B][attacker:u32][victim:u32] ... [dmg:u32 @ off17 optional]` | 34B. Combat broadcast. See gotcha below. |
| `0x0E` | SIT_STATE | `[0E]...` | Entity sat/stood. |
| `0x0F` | ENTITY_ACTION | `[0F][id:u32][action:1]` | **`action=3` = monster died (authoritative kill count).** |
| `0x12` | MAP_NAME | `[12][name...]` | Fires on subsequent map changes. |
| `0x14` | ENTITY_POS | `[14][id:u32][x:i16][y:i16][flag:1]` | 9B. Snapshot pos. |
| `0x17` | DAMAGE_V2 | `[17][victim:u32][dmg:u32][x:i16][y:i16][flag:1]` | 14B. **This server sends attack damage HERE, not via 0x0B.** No attacker field. |
| `0x18` | MONSTER_SKILL | `[18][src:u32][dst:u32][skill:u16]...` | Aggro-tracking source. |
| `0x1B` | DESPAWN | `[1B][id:u32]` | Entity gone. Guard against false despawns. |
| `0x1D` | SKILL_RESULT | `[1D][sub:1][src:u32][???][dst:u32][skill:u16] ... [dmg:u32]` | 36B for target skills. |
| `0x20` | SYS_MESSAGE | `[20][text...]` | Detect substring `"too full"` → inventory full. |
| `0x22` | EXP_GAIN | `[22][base_total:u32][base_gained:u32][job_total:u32][job_gained:u32]` | 17B. Fires for solo + party + event alike — **do not count kills here.** |
| `0x24` | DEATH | `[24][id:u32]` | If id === self → player died. |
| `0x25` | STAT | `[25][id:u32][stat_type:u32][cur:u32][max:u32][flag:1]` | 18B. HP for players. **Only HP; SP is separate (0x27).** |
| `0x26` | HP_REGEN | `[26][id:u32]...` | ⚠️ **NOT attack. NOT HP update.** Passive regen tick every ~6s with repeated value. |
| `0x27` | SP_UPDATE | `[27][cur:u32 LE][max:u32 LE]` | 9B. SP only. Session F confirmed 195/195 match. |
| `0x29` | RESPAWN_ACK | — | Reply to respawn. |
| `0x2A` | WARP_FAIL | `[2A][reason:1?]` | Invalid warp coord (wall/water). Bot should retry with offset. |
| `0x2C` | CHAT_IN | `[2C][sender:u32][msg_len:u16][msg][name_len:u16][name][chat_type:1]` | |
| `0x32` | INVENTORY | `[32][sub:1]...` | Sub-dispatched. Authoritative inventory delta. |
| `0x36` | DESPAWN_REASON | `[36][id:u32][reason:u32]` | `reason=2` = entity looted. |
| `0x38` | MAP_DATA | `[38] ... [zeny:u32 @ off9]` | Zone-enter data. |
| `0x3C` | MINIMAP / ENTITY_LIST | 2 modes: minimap markers OR batched entity list `[3C][count:u16]([id:u32][x:i16][y:i16][flag:1])×N` | Post-warp bulk position dump. |
| `0x4D` | NPC_DIALOG | `[4D][sub:1]...` | `sub=2` = menu shown; `sub=3` = closed. |
| `0x51` | ITEM_DROP | `[51][drop_id:u32][x:f32][y:f32][item_id:u16][amount:u16][???]` | 21B. **Coords are float32 here.** |
| `0x52` | PICKUP_BCAST | `[52][drop_id:u32][actor:u32]` | 9B. Everyone hears this. |
| `0x53` | SELL_OPEN | — | Sell menu opened. |
| `0x5B` | SELL_RESULT | `[5B][flag:1]` | `flag > 0` = success. |

## Gotchas (from source code cross-check)

1. **`0x26` is NOT HP update.** It's a passive regen tick that fires every ~6s with the same value. Real HP is in `0x25` STAT (see column `stat_type` for HP/SP/etc.).
2. **`0x0B` ATTACK_RESULT vs `0x17` DAMAGE_V2 duplication risk.** Some servers only send `0x17`. RayRag sends both — must not double-count damage. Track by attacker+victim+timestamp window.
3. **`0x22` EXP is not a kill counter.** Party kills, event bonuses, quest rewards all fire it. Count kills via `0x0F action=3` only.
4. **`0x25` STAT does NOT carry SP for players.** Read SP exclusively from `0x27`.
5. **playerId discovery**: parse `0x03 SELECT_CHAR` reply on login, OR fallback: if the same victim id appears in ≥3 `0x0B` attack packets against self → assume that's us.
6. **`0x3C` is dual-purpose**: minimap marker AND post-warp entity list bulk dump. Sub-dispatch on second byte.
7. **`0x1B` DESPAWN false positives.** Guard: entity may reappear within 500ms. Wait before removing from world state.
8. **Move packet reflect**: server does NOT echo `0x07 MOVE` sent by client. To confirm your own move applied, wait for a subsequent `0x07 MOVE_UPDATE` with your id, or fall back to `0x14 ENTITY_POS`.

## Self actor id

Observed in Session F: `0x000EC664` — appears as `src` in 0x1D skill result, as actor in 0x26 HP_REGEN. On new login this will change, so must be discovered fresh each session (see gotcha #5).

## Skill IDs

Rebuild-Ragnarok reindexes skill IDs vs classic RO. Session F cast used `0x080C = 2060` (likely Fire Bolt). Build the skill DB from the client's asset bundles (or the `skills.csv`-style file in superogira repo).

## Session archive

- `session-A-initial-recon.db` — initial dump, 370 frames
- `session-B-move-plain.db` — move obfuscation test → NO obfuscation
- `session-F-skill-attack.db` — attack + skill + drop + pickup

Query any with:
```
bun run inspect captures/session-X.db
```

## Verified externally via superogira/ro-rebuild-web-assist

Every opcode above marked with a layout was cross-referenced against `github.com/superogira/ro-rebuild-web-assist/ro-rebuild-web-assist.user.js` (v4.47, ~6800 lines). Findings match Session A/B/F recon. The 1-byte opcode framing is confirmed by the source; earlier 2-byte reading was our error.
