const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const day = 86400000;
let now = Date.parse('2026-09-16T12:00:00Z');
class Clock extends Date { static now() { return now; } }
const sandbox = { Date: Clock, console: { log() {}, warn() {}, error() {} } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas_memory_service.js'), 'utf8'), sandbox);
const Service = vm.runInContext('MemoryService', sandbox);
function fixture(rows, noteMap = {}) {
  const headers = ['threadId', 'senderEmail', 'language', 'lastCategory', 'providedInfo', 'lastUpdated', 'messageCount', 'version', 'memorySummary', 'contextualFlags', 'external'];
  const data = [headers, ...rows.map(([id, date]) => [id, 'test@example.invalid', 'it', 'technical', '[{"topic":"documenti"}]', date, 3, 2, 'summary', '{"remote_user":true,"bereaved":true}', '=EXTERNAL()'])];
  const notes = data.map((_, i) => [noteMap[i] || '']);
  const cleared = [], invalidated = [];
  const memory = Object.create(Service.prototype);
  memory._initialized = true;
  memory._cache = {};
  memory._withSheetWriteLock = fn => fn();
  memory._invalidateCache = key => invalidated.push(key);
  let fail = false;
  memory._sheet = {
    getDataRange: () => ({ getValues: () => data.map(row => row.slice()) }),
    getRange: (r, c, n = 1, w = 1) => ({
      getNotes: () => notes.slice(r - 1, r - 1 + n).map(row => row.slice()),
      setNote: value => { assert.equal(c, 6); notes[r - 1][0] = value || ''; },
      clearContent: () => {
        if (fail) throw new Error('simulated write failure');
        cleared.push([r, c, n, w]);
        for (let i = r - 1; i < r - 1 + n; i++) for (let j = c - 1; j < c - 1 + w; j++) data[i][j] = '';
      }
    })
  };
  return { memory, data, notes, cleared, invalidated, fail: () => { fail = true; } };
}
const iso = offset => new Date(now + offset * day).toISOString();
const f = fixture([['old', iso(-31)], ['edge', iso(-30)], ['recent', iso(-2)], ['missing', ''], ['bad', 'invalid'], ['future', iso(365)]], { 4: 'Nota operatore' });
const recent = JSON.stringify(f.data[3]);
assert.equal(f.memory.cleanOldEntries(), 1);
assert.deepEqual(f.invalidated, ['memory_old']);
assert.equal(JSON.stringify(f.data[3]), recent, 'valid row completely unchanged');
assert.equal(f.data[1][10], '=EXTERNAL()', 'outside table remains untouched');
assert.equal(f.data[4][5], '', 'observation must not fabricate lastUpdated');
assert(f.notes[4][0].startsWith('Nota operatore\nAG_MEMORY_RETENTION_V1:'));
const firstNote = f.notes[4][0];
assert.equal(f.memory.cleanOldEntries(), 0, 'repeat is idempotent');
assert.equal(f.notes[4][0], firstNote, 'observation is not renewed by cleanup');
now += 20 * day;
f.data[5][5] = new Date(now).toISOString();
f.memory.cleanOldEntries();
assert.equal(f.notes[5][0], '', 'real update removes technical marker');
now += 11 * day;
assert.equal(f.memory.cleanOldEntries(), 3, 'recent original plus two unrepaired anomalies expire');
assert.equal(f.data[5][0], 'bad', 'repaired active conversation survives');
assert.equal(f.notes[4][0], 'Nota operatore', 'human note preserved');
assert.equal(f.memory.cleanupOldEntries().remaining, 1, 'blank rows do not inflate statistics');
assert.equal(f.memory.getStats().totalEntries, 1);
const broken = fixture([['expired', iso(-31)], ['kept', iso(-1)]]);
broken.fail();
assert.equal(broken.memory.cleanOldEntries(), 0, 'failed write is not reported as deleted');
assert.equal(broken.data[1][0], 'expired');
assert.deepEqual(broken.invalidated, ['memory_expired'], 'uncertain write invalidates cache');
const corrupt = fixture([['bad', 'nonsense']], { 1: 'AG_MEMORY_RETENTION_V1:NaN' });
assert.equal(corrupt.memory.cleanOldEntries(), 0, 'corrupt marker cannot force immediate deletion');
assert.equal(corrupt.notes[1][0], 'AG_MEMORY_RETENTION_V1:' + now);
console.log('Memory retention regression tests passed.');
