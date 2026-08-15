import { startRelay } from './relay/server';

const PORT = Number(process.env.RK_PORT ?? 9000);

startRelay({ port: PORT });

console.log(`[rk-bot] relay listening on ws://localhost:${PORT}`);
console.log(`[rk-bot] phase 1: observe-only. Frames logged to captures/.`);
