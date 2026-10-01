const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const warnings = [];
const label = { getName: () => 'IA' };
let creations = 0;
const ctx = vm.createContext({
  console: { log(){}, warn(message){ warnings.push(message); }, error(){} },
  GmailApp: {
    getUserLabels: () => [label],
    getUserLabelByName: () => label,
    createLabel(){ creations++; return label; }
  }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas_gmail_service.js'), 'utf8'), ctx);
for (const invalidCache of [undefined, null, {}, { get(){ return null; } }]) {
  const service = Object.create(ctx.GmailService.prototype);
  service._labelCache = invalidCache;
  service._cacheTTL = 3600000;
  service._ensureLabelExistsForMessageRetry_('IA');
  assert.equal(service._labelCache.get('IA').label, label);
  assert.equal(service.getOrCreateLabel('IA'), label);
  service.clearLabelCache();
  assert.equal(service._labelCache.size, 0);
  service._labelCache = invalidCache;
  assert.doesNotThrow(() => service.clearLabelCache());
  assert.equal(service._labelCache.size, 0);
}
const service = Object.create(ctx.GmailService.prototype);
const validCache = new Map([['IA', { label, ts: Date.now() }]]);
service._labelCache = validCache;
service._cacheTTL = 3600000;
assert.equal(service.getOrCreateLabel('IA'), label);
assert.equal(service._labelCache, validCache, 'preserve valid cache and its entries');
service.clearLabelCache();
assert.equal(service._labelCache, validCache);
assert.equal(validCache.size, 0);
assert.equal(creations, 0);
assert.deepEqual(warnings, []);
console.log('Label cache initialization and retry guards passed');
