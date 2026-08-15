# rk-bot roadmap

North Star: **OpenKore architecture, but for Unity WebGL RO in a browser**. Config-driven, task-queue AI, packet-level control. Bot brain runs on Bun; browser userscript is a dumb WebSocket wire.

## Phase 1 — Observe (current)
- Injector hooks `WebSocket` in the page, pipes every frame to `ws://localhost:9000`.
- Relay persists frames to SQLite (`captures/session-*.db`).
- No injection back into the game yet.
- **Exit criteria**: 1 full session logged (login → walk → attack → loot → warp → logout) with clean binary/text frames stored.

## Phase 2 — Decode
- Sort frames by opcode (assume first 1–2 bytes = op).
- Correlate frames to observed in-game actions (walk-north, attack-mob-X, receive-damage).
- Build first packet table: handshake, ping/pong, player position, mob spawn, HP/SP update, attack request/damage.
- **Exit criteria**: `src/packet/table.ts` handles 20+ opcodes both directions.

## Phase 3 — World state
- On every parsed frame, update in-memory `WorldState` (self, mobs[], npcs[], items[], players[], map).
- Verify with a live console dashboard.
- **Exit criteria**: `state/dashboard` shows correct mob list matching the client.

## Phase 4 — Send back (first injection)
- Extend injector to accept `ws-inject` commands from relay and call the real `send()` on the game WebSocket.
- Relay exposes `bot.send(frame)`.
- Sanity test: bot echoes a benign action (chat message) triggered from CLI.

## Phase 5 — Task manager + AI queue
- Ports OpenKore's hierarchical AI: `route > attack > loot > heal > sit`.
- Tasks are objects with `run/step/interrupt/done`.
- First task: `AttackNearestMob` (no route yet — assume adjacent mob).

## Phase 6 — Route / A*
- Extract `walkmask.png` from Unity asset bundles (observed in Network tab as `_minimap_prt_fild08_walkmask.png.bundle`).
- Parse to walkable grid.
- Implement A* pathfinder. New task: `MoveTo(x, y)`.

## Phase 7 — Loot + heal
- Add `mon_control.yaml`, `items_control.yaml` (OpenKore-style).
- Tasks: `Loot(itemId)`, `UseSelf(itemId when hp<threshold)`.

## Phase 8 — Skill combo + macro DSL
- Macro parser (OpenKore syntax subset).
- Example:
  ```
  macro combo {
    call skill Bash target 5
    if $hp < 40 { call useItem WhitePotion }
  }
  ```

## Phase 9 — Vending / storage / warp / NPC
- NPC dialog packet flow.
- Kafra warp, storage in/out.
- Vending list/buy/sell.

## Phase 10 — Humanization + monitoring
- Randomized delays, path noise, AFK cycles, chat auto-reply.
- Small web dashboard at `http://localhost:9001` for stats.
- SQLite loot log + price memory.

## Non-goals
- No public distribution. Private repo, personal use on user-owned server.
- No anti-detection evasion tricks beyond humanization — server has no anti-cheat.
- No inheritance from the abandoned `ray-ro` fork.
