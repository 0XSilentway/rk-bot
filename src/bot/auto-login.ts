import { parse } from 'yaml';
import { readFileSync, existsSync, watch } from 'node:fs';
import { join } from 'node:path';

const FILE = join(import.meta.dir, '..', '..', 'config', 'login.yaml');

export interface LoginConfig {
  enabled: boolean;
  delay_ms: number;
  gap_ms: number;
  url_match: string;
  packets: string[];
}

let current: LoginConfig | undefined;

function loadOnce(): LoginConfig | undefined {
  if (!existsSync(FILE)) return undefined;
  try {
    return parse(readFileSync(FILE, 'utf-8')) as LoginConfig;
  } catch (e) {
    console.warn('[login] parse error:', (e as Error).message);
    return undefined;
  }
}

export function loadLogin(): LoginConfig | undefined {
  if (!current) current = loadOnce();
  return current;
}

export function watchLogin(): void {
  if (!existsSync(FILE)) return;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  watch(FILE, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      current = loadOnce();
      console.log('[login] reloaded');
    }, 200);
  });
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Called when a fresh WS to the game opens. Fires the login sequence
 * unless disabled or url doesn't match.
 */
export async function tryAutoLogin(url: string | undefined, send: (bytes: Uint8Array) => void): Promise<void> {
  const cfg = loadLogin();
  if (!cfg || !cfg.enabled) return;
  if (cfg.url_match && !url?.includes(cfg.url_match)) return;
  console.log(`[login] queued ${cfg.packets.length} packets in ${cfg.delay_ms}ms`);
  await new Promise((r) => setTimeout(r, cfg.delay_ms));
  for (let i = 0; i < cfg.packets.length; i++) {
    const bytes = hexToBytes(cfg.packets[i]!);
    console.log(`[login] send #${i + 1} op=0x${bytes[0]!.toString(16).padStart(2, '0')} len=${bytes.length}`);
    send(bytes);
    if (i < cfg.packets.length - 1) await new Promise((r) => setTimeout(r, cfg.gap_ms));
  }
}
