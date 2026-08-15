# rk-bot

OpenKore-inspired bot for `websea01.rayrag.com` (Unity WebGL Ragnarok Online).

- **Browser side**: `injector/rk-bot.user.js` — Tampermonkey script that hooks `WebSocket` and pipes every frame to a local relay. Nothing more.
- **Bot side**: Bun + TypeScript. Task-queue AI, config-driven behaviors, packet-level control.

See `docs/ROADMAP.md` for the 10-phase plan. Currently: **Phase 1 (observe only)**.

## Quick start (Phase 1 recon)

```bash
cd ~/Documents/rk-bot
bun install
bun run start
```

Then in Tampermonkey → Create new script → paste `injector/rk-bot.user.js` → save → refresh the game page.

Console should show:
```
[rk-bot] injector loaded — Phase 1 (observe only)
[rk-bot] relay connected
```

Relay terminal will start printing:
```
[relay] injector connected
[relay] ws#1 open wss://.../...
[relay] ws#1 send binary len=42 :: 0a 01 ...
[relay] ws#1 recv binary len=88 :: 0b 02 ...
```

Sessions land in `captures/session-<timestamp>.db` (SQLite, ignored by git).

## Layout

```
injector/    Tampermonkey userscript
src/
  index.ts       Bun entry
  relay/         WS server (Phase 1)
  packet/        opcode parse/build tables (Phase 2+)
  state/         world model (Phase 3+)
  ai/            priority queue + task manager (Phase 5+)
  tasks/         atomic behaviors (Phase 5+)
  route/         A* pathfinder (Phase 6+)
  config/        YAML loader (Phase 7+)
  persist/       SQLite (raw log + loot log)
  monitor/       dashboard (Phase 10)
config/      user-editable YAML (mon_control, items_control, macros)
docs/        ROADMAP + protocol notes
captures/    session dumps (git-ignored)
```
