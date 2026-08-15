import { startRelay } from './relay/server';

const PORT = Number(process.env.RK_PORT ?? 9000);

startRelay({ port: PORT });

console.log(`[rk-bot] relay listening on ws://localhost:${PORT}`);
console.log(`[rk-bot] phase 3+4: decode, state, brain, inject.`);
console.log(`[rk-bot] type "pause" to stop bot, "resume" to start, "stat" to dump state.`);
