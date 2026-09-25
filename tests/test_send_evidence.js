const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const cache = new Map(), props = new Map();
let acquired = 0, released = 0;
const context = vm.createContext({ console: { log() {}, warn() {}, error() {} },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k), put: (k,v) => cache.set(k,v) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k),
    setProperty: (k,v) => props.set(k,v), deleteProperty: k => props.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => { acquired++; return true; }, releaseLock: () => { released++; } }) }
});
const file = path.resolve(__dirname, '../gas_email_processor.js');
vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
const processor = Object.create(context.EmailProcessor.prototype);
processor._persistSendIdempotencyBackup_ = () => false; // actual commit with failed durable write
props.set('send_uncertain_m', '1');
processor._commitSendTransaction('m');
assert(props.has('send_uncertain_m'), 'retain uncertain marker when backup persistence fails');
assert.equal(processor._beginSendTransaction('m').reason, 'already_sent', 'confirmed cache evidence overrides stale uncertain marker');
cache.clear(); props.set('sent_backup_m', JSON.stringify({ ts: Date.now(), expiresAt: Date.now() + 60000 }));
assert.equal(processor._beginSendTransaction('m').reason, 'already_sent', 'confirmed durable evidence overrides uncertain marker');
assert(cache.has('sent_m'), 'rehydrate confirmed cache marker');
cache.clear(); props.set('sent_backup_m', JSON.stringify({ ts: Date.now() - 10000, expiresAt: Date.now() - 1000 }));
assert.equal(processor._beginSendTransaction('m').reason, 'gmail_send_uncertain', 'no evidence means review, never resend');
assert.equal(acquired, released, 'release every acquired lock');
assert(props.has('send_uncertain_m'), 'do not erase uncertainty as a side effect of checking');
console.log('Send evidence: confirmed cache/backup precedence and uncertain-only safety pass');
// Audit 3.3: timeout is intentionally normalized to NETWORK, both with and
// without the shared classifier. Keep compatibility aliases in consumers.
for (const message of ['timeout', 'request timed out', 'ECONNRESET', 'HTTP 503']) {
  const classified = processor._classifyError(new Error(message));
  assert.equal(classified.type, 'NETWORK');
  assert.equal(classified.retryable, true);
}
context.ErrorTypes = { TIMEOUT: 'TIMEOUT', NETWORK: 'NETWORK', CACHE_EXPIRED: 'CACHE_EXPIRED' };
for (const type of Object.values(context.ErrorTypes)) {
  context.classifyError = () => ({ type, message: 'simulated transient' });
  assert.equal(processor._classifyError(new Error('simulated')).type, 'NETWORK');
}
