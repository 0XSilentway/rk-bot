import './monitor/events'; // MUST be first — patches console.log
import { startRelay } from './relay/server';

const PORT = Number(process.env.RK_PORT ?? 9000);

startRelay({ port: PORT });

console.log(`[rk-bot] phase 3+4: decode, state, brain, inject.`);
console.log(`[rk-bot] type "pause" | "resume" | "stat" | "dump" | "verbose"`);
console.log(`[rk-bot] dashboard: http://localhost:9001/`);
