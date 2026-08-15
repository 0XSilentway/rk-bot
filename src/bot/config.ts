// User-editable bot config. Restart bun to reload.
// TODO Phase 7: move to YAML with hot-reload.

export interface MonsterRule {
  /** case-insensitive substring match against mob name (from 0x06 SPAWN) */
  namePattern: string;
  /** what skill to cast; server rejects if bogus */
  skill: { id: number; level: number };
}

export const botConfig = {
  enabled: true, // master switch; bot.enable()/bot.disable() also toggle

  /** If true, ignore monster name rules and attack ANY actor near self.
   *  Useful when pre-existing map mobs never sent 0x06 SPAWN (so name is unknown). */
  attackAll: true,
  /** Skill to cast in attackAll mode */
  attackAllSkill: { id: 12, level: 6 },

  /** How often the brain wakes up to decide next action */
  tickMs: 500,

  /** Skill cast range in game cells (Bolt spells = 9 in classic RO) */
  castRangeCells: 9,

  /** min ms between move sends */
  moveDebounceMs: 400,

  /** min ms between skill cast sends (single-bolt cast time ~1s + safety) */
  castDebounceMs: 2500,

  /** if drop within N tiles of self and older than 500ms, loot it */
  lootRangeCells: 12,

  /** if drop older than N ms, forget (probably despawned) */
  lootMaxAgeMs: 30_000,

  /** how many tiles to stop short of mob when approaching (avoid overshoot) */
  approachStopShortCells: 2,

  /** if own HP percentage drops below this, disengage (do NOT continue attacking) */
  disengageHpPct: 30,

  /** monster targeting rules — first match wins */
  monsters: [
    { namePattern: 'peco', skill: { id: 15, level: 8 } },      // Cold/Frost Bolt lv 8
    { namePattern: 'egg',  skill: { id: 15, level: 8 } },      // Peco Peco Egg fallback
    { namePattern: 'muka', skill: { id: 12, level: 6 } },      // Fire Bolt-ish lv 6
    { namePattern: 'ant',  skill: { id: 12, level: 6 } },      // Ant family
  ] as MonsterRule[],
};

export function matchRule(name: string | undefined): MonsterRule | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  return botConfig.monsters.find(r => lower.includes(r.namePattern.toLowerCase()));
}
