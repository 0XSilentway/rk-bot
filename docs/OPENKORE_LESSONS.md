# OpenKore architecture lessons

Extracted from https://github.com/OpenKore/openkore. Applied to rk-bot design without copying Perl code. Full comment kept in-file so future contributors don't re-derive.

## Top 5 to steal

1. **Unshift-based action queue** — dual-array `{names[], args[]}`. Current = `[0]`. Interrupt = `unshift`. Dequeue = `shift`. Beats event emitters for behavior composition.
2. **`Task.iterate()` lifecycle** — mutable state inside task objects, called every AI tick. `INACTIVE → RUNNING → INTERRUPTED/STOPPED → DONE`. Scales to 50+ concurrent tasks.
3. **Actor hierarchy** — one base `Actor { id, pos, pos_to, walk_speed, distance() }` + minimal subclasses `Monster`, `Player`, `NPC`, `Item`. Track `pos` AND `pos_to` for interpolation.
4. **Two-tier packet dispatch** — layer 1: `handlers[opcode] → handler()`. Layer 2 inside handler: `subHandlers[field] → subHandler()` (e.g., stat_info sub-dispatches by statType). Scales to 200+ opcodes with no bloat.
5. **Config-driven rules with weights + conditionals** — `MonsterRule { attack, teleport, minLvl, maxWeight, ... }`, `ItemRule { flag: -1|0|1|2 }`. `"all"` sets defaults, specific rules override. Users configure behavior without touching code.

## Sub-patterns worth stealing

### AI queue (`src/AI.pm`)
```ts
type AIQueue = { names: string[]; args: unknown[] };
// pop() → shift both. push() → append. interrupt() → unshift both.
// Main loop: switch on names[0].
```
Subtlety: O(n) unshift is fine for small queues. Profile before optimizing.

### Task base (`src/Task.pm`, `src/Task/Route.pm`)
```ts
abstract class Task {
  status: 'INACTIVE' | 'RUNNING' | 'INTERRUPTED' | 'STOPPED' | 'DONE' = 'INACTIVE';
  priority = 500;
  abstract iterate(): void;
  setDone() { this.status = 'DONE'; }
  setError(code: string, msg: string) { this.status = 'DONE'; this.error = { code, msg }; }
}
```
Route task has `stage: 'CALCULATE' | 'WALK' | 'STUCK'` and a `step_index` throttle — on stuck, decrement step and retry smaller steps before failing. Route recalculates mid-walk if obstacles appear.

### Actor model (`src/Actor.pm`, `src/Actor/Monster.pm`)
```ts
abstract class Actor {
  id!: number;
  pos!: { x: number; y: number };
  pos_to?: { x: number; y: number };
  walk_speed = 1.0;
  time_move?: number;
  distance(other: Actor): number { /* Euclidean */ }
}
class Monster extends Actor { sendTalk() { net.attack(this.id); } }
```
Talking to a monster = attacking it once. Uniform API across entity types.

### Packet dispatch (`src/Network/Receive.pm`, `src/Network/Send.pm`)
```ts
const recv: Record<number, (buf: Uint8Array) => void> = {};
recv[0x25] = handleStat;
function handleStat(buf) {
  const sub = statSubHandlers[buf[5]]; // statType
  sub?.(buf);
}
// Send: reconstruct(packet) → bytes → sendToServer(bytes)
// Separate build from transmit so tests don't need a live server.
```

### Config format (`control/config.txt`)
- Sections marked by comments (`#### Login options ####`).
- Simple settings: `key value`.
- Complex blocks: prefix-namespaced keys (`attackSkillSlot_lvl`, `attackSkillSlot_dist`).
- Every setting has a comment explaining what it does. Provide commented-out examples for complex ones.
- Grouping beats alphabetical for discoverability.

### Monster/item rules (`control/mon_control.txt`, `control/pickupitems.txt`)
```
# mon_control.txt columns: name attack_auto teleport_auto teleport_search skillcancel_auto attack_lvl teleport_lvl attack_weight
all         1 0 0 0 0 0 0
Poring      1 0 0 0 5 0 0
Ghostring  -1 3 0 0 0 0 0
```
- `attack: -1 ignore, 0 iff-attacked-first, 1 auto, 2 aggressive, 3 provoke-once`
- `teleport: -1 to 3+` — weight accumulates when multiple weak mobs trigger
- `all` line sets defaults; named lines override

### Macro DSL (`src/Plugins/macro/`)
Short-code steps: `c` continue, `r0` select opt 0, `w2` wait 2s, `n` stop, `t "text"` type, `s` search, `b` back.
Each step validates game state before executing (menu open? npc in range?). Failure = retry, skip, or timeout error.

## Things NOT to steal

- Perl-specific globals (`$char`, `$net`) — use dependency injection.
- Mutex system (`Task::Chained` uses mutexes to serialize) — use async/await + queues in TS.
- `Log::message` / print-based logging — use structured logger with levels.
- Slow O(n²) inner loops in `AI::action` — profile early, use `Map` where OK's used arrays.
