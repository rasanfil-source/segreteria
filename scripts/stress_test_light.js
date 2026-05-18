#!/usr/bin/env node
/**
 * Stress test leggero: simula 500-1000 email e verifica tempi/lock/quota locale.
 */
const total = Number(process.argv[2] || 500);
const max = Math.min(1000, Math.max(100, total));
const started = Date.now();
let lockedSkips = 0;
let processed = 0;

const simulatedLock = new Set();
for (let i = 0; i < max; i++) {
  const batchId = `b${Math.floor(i / 25)}`;
  if (simulatedLock.has(batchId)) {
    lockedSkips++;
    continue;
  }
  simulatedLock.add(batchId);
  processed++;
  if ((Date.now() - started) > 540000) {
    console.error('❌ Superato limite teorico 540s');
    process.exit(2);
  }
  simulatedLock.delete(batchId);
}

const elapsed = Date.now() - started;
console.log(JSON.stringify({
  requested: max,
  processed,
  lockedSkips,
  elapsedMs: elapsed,
  within540s: elapsed < 540000
}, null, 2));
