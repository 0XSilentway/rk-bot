import { parse } from 'yaml';
import { readFileSync, watch } from 'node:fs';
import { join } from 'node:path';

export interface SkillRule {
  match: string[];
  skill: { id: number; level: number };
}

export interface BotConfig {
  enabled: boolean;
  tick_ms: number;
  skills: SkillRule[];
  mon_control: { default: 'auto' | 'skip' | 'if_attacked' } & Record<string, 'auto' | 'skip' | 'if_attacked'>;
  combat: {
    cast_range_cells: number;
    approach_stop_short: number;
    move_debounce_ms: number;
    cast_debounce_ms: number;
  };
  emergency: {
    fly_wing_item_id: number;
    hp_pct_threshold: number;
    wing_on_hit: boolean;
    wing_cooldown_ms: number;
  };
  loot: {
    default: 'pickup' | 'skip';
    range_cells: number;
    max_age_ms: number;
  };
  roam: {
    enabled: boolean;
    idle_ms: number;
    radius_tiles: number;
  };
}

const CONFIG_PATH = join(import.meta.dir, '..', '..', 'config', 'bot.yaml');

let current: BotConfig;
const listeners: Array<(c: BotConfig) => void> = [];

function loadOnce(): BotConfig {
  const text = readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = parse(text) as BotConfig;
  return parsed;
}

export function loadConfig(): BotConfig {
  if (!current) current = loadOnce();
  return current;
}

export function onConfigChange(cb: (c: BotConfig) => void): void {
  listeners.push(cb);
}

export function watchConfig(): void {
  let debounce: ReturnType<typeof setTimeout> | undefined;
  watch(CONFIG_PATH, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        const fresh = loadOnce();
        current = fresh;
        console.log('[config] reloaded ' + CONFIG_PATH);
        for (const cb of listeners) cb(fresh);
      } catch (e) {
        console.warn('[config] reload failed:', (e as Error).message);
      }
    }, 200);
  });
}
