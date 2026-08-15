# OpenKore control/ — full audit + rk-bot roadmap

Sourced from `github.com/OpenKore/openkore/tree/master/control` on 2026-08-15.
Every file reviewed. Grouped by priority for the web-Unity RayRag target.

## HIGH — implement next

### `items_control.txt` — inventory keep / sell / store
Format: `<name>  <min-keep>  <auto-store>  <auto-sell>  [put-cart]  [get-cart]`
```
all 0 1 0
501 25 1 0                # Red Potion: keep 25, store extras
Jellopy 0 0 1             # sell all
"Wooden Mail [1]" 0 0 1
```
Unlocks the sell-and-store-when-full loop. Pairs with Kafra NPC dialog.

### `pickupitems.txt` — per-item loot policy
Flags: `-1` drop-on-inv, `0` never, `1` pick, `2` rush.
```
all 1
jellopy 0
"Old Blue Box" 2
```
Replaces our current `lootAll` toggle with tier filtering. Small parser, big behavior change.

### `avoid.txt` — GM / PK escape
Three sections: `[Players]`, `[ID]`, `[Jobs]`. Row: `<key> <disconnect> <teleport> <disconnect_on_chat>`.
```
[Players]
[GM]Example    1 0 1
[Jobs]
Priest         0 1
```
Auto-tp on Priest sighted = bot-hunter defense. Named user requirement.

### `chat_resp.txt` — random chat responder
Format: `<triggers,csv> TAB <replies,csv>` — random pick avoids parrot-tell.
```
bot,botter    no,I'm not a bot,huh?
hi,hello      hey,sup,hi there
```

### `shop.txt` — vending stall
Line 1: `Title1;;Title2;;Title3` (random each open). Rest: `<name> TAB <price[..maxPrice]> TAB [amount]`.
```
My Shop;;Cheap Stuff
Jellopy       3
Andre Card    200,000       5
Coconut       1,000..2,000  2
```
Loot → zeny while AFK. Random title + price range = anti-detect.

### `routeweights.txt` — pathfinder cost bias
```
PORTAL 20
WARPTOSAVEMAP 200
prt_fild08a 10000
bat_room 10000
```
Blocks bad maps / weights transitions. Ship the day we add multi-map route.

## MED — quality-of-life

### `priority.txt` — kill order when mobbed
```
Hydra
Obeaune
all
Poring
```
One comparator in target selection. Cheap safety win.

### `timeouts.txt` — every AI interval + backoff
```
reconnect_backoff 30,60,120,180,300,600,600,900,900,1800
reconnect_random 20
ai_attack 1
ai_attack_giveup 6
ai_attack_waitAfterKill 0.3
```
Steal the schema+defaults wholesale. Reconnect backoff+jitter is anti-ban gold.

### `responses.txt` — admin whisper templates
`<key> <text with %$var>` with random reply pools. Only if we build a whisper admin surface.

## LOW / SKIP

- **buyer_shop.txt** — bulk auto-buy. Advanced meta.
- **arrowcraft.txt** — Hunter-only.
- **consolecolors.txt** — irrelevant, we have web log viewer.
- **poseidon.txt** — GameGuard bypass, not applicable to Unity WebGL.
- **sys.txt** — the `loadPlugins_list` line is a feature backlog: `macro, eventMacro, reconnect, map, raiseStat, raiseSkill, breakTime, item_weight_recorder`.

## Top 5 order

1. **items_control.txt + Kafra state machine** — highest ROI (unblocks sell loop)
2. **pickupitems.txt** — replace `lootAll` with tiered flags
3. **avoid.txt** — Player + Job tiers, tp-on-sight for Priest/GM
4. **shop.txt + vending** — turn loot to zeny while AFK
5. **chat_resp.txt + macro seed** — 40 lines each, huge feel-improvement; then extend into `eventMacro`

## OpenKore plugins we should crib later (from sys.txt)

- `macro` / `eventMacro` — if-then-else DSL for buffs/heal/skill combos
- `reconnect` — auto reconnect with exponential backoff
- `map` — mini-map data cache
- `raiseStat` / `raiseSkill` — auto stat/skill points spend
- `breakTime` — rest hours (login/logout on schedule)
- `item_weight_recorder` — data collection for sell price tuning
