const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const day = 86400000;
let now = Date.parse('2026-10-20T12:00:00Z');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const sandbox = {
  Date: Clock,
  CONFIG: { SENSITIVE_FLAGS_TTL_DAYS: 180 },
  SpreadsheetApp: { flush() {} },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  console: { log() {}, warn() {}, error() {} }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas_memory_service.js'), 'utf8'), sandbox);
const MemoryService = vm.runInContext('MemoryService', sandbox);

function makeSheet(rows) {
  const data = rows.map(row => row.slice());
  return {
    data,
    getLastRow: () => data.length,
    getDataRange: () => ({ getValues: () => data.map(row => row.slice()) }),
    getRange: (r, c, n = 1, w = 1) => ({
      getValues: () => data.slice(r - 1, r - 1 + n).map(row => row.slice(c - 1, c - 1 + w)),
      setValues: values => values.forEach((row, offset) => {
        for (let col = 0; col < row.length; col++) data[r - 1 + offset][c - 1 + col] = row[col];
      }),
      clearContent: () => {
        for (let row = r - 1; row < r - 1 + n; row++) {
          for (let col = c - 1; col < c - 1 + w; col++) data[row][col] = '';
        }
      },
      createTextFinder: value => {
        let exact = false;
        const finder = {
          matchEntireCell: () => { exact = true; return finder; },
          matchCase: () => finder,
          matchFormulaText: () => finder,
          findNext: () => {
            const index = data.findIndex((row, rowIndex) => rowIndex >= r - 1 &&
              (exact ? String(row[c - 1]) === String(value) : String(row[c - 1]).includes(String(value))));
            return index < 0 ? null : { getRow: () => index + 1, getColumn: () => c };
          }
        };
        return finder;
      }
    }),
    appendRow: row => data.push(row.slice())
  };
}

function service(archivedFlags, activeRow = null) {
  const sensitive = makeSheet([['threadId', 'contextualFlags'], ...archivedFlags]);
  const memory = Object.create(MemoryService.prototype);
  memory._initialized = true;
  memory._sensitiveSheet = sensitive;
  memory._sheet = makeSheet([['threadId', 'language', 'category', 'tone', 'providedInfo', 'lastUpdated', 'messageCount', 'version', 'memorySummary', 'contextualFlags'], ...(activeRow ? [activeRow] : [])]);
  memory._findRowByThreadId = id => {
    if (!activeRow || String(activeRow[0]) !== String(id)) return null;
    return { rowIndex: 2, values: activeRow.slice() };
  };
  memory._cache = {};
  memory._getFromCache = () => null;
  memory._setCache = () => {};
  memory._writeThroughMemoryCache_ = () => {};
  memory._invalidateCache = () => {};
  memory._withSheetWriteLock = fn => fn();
  return { memory, sensitive };
}

const evidence = new Date(now - 100 * day).toISOString();
const storedFlags = JSON.stringify({ bereaved: true, _evidence: { bereaved: evidence } });
const archived = service([['thread-long', storedFlags]]);
const restored = archived.memory.getMemory('thread-long');
assert.equal(restored.exists, false, 'l’archivio dei flag non ricrea una memoria conversazionale');
assert.equal(restored.contextualFlags.bereaved, true, 'i flag restano disponibili dopo la rimozione della riga ordinaria');

archived.memory._persistSensitiveContextFlags_('thread-long', restored.contextualFlags, new Date(now).toISOString());
assert.equal(JSON.parse(archived.sensitive.data[1][1])._evidence.bereaved, evidence,
  'un aggiornamento estraneo conserva la data originale e non rinnova il TTL');
assert.equal(archived.memory._mergeContextualFlags_(
  { remote_user: true, _evidence: { remote_user: evidence } }, { remote_user: true }
)._evidence.remote_user, evidence, 'un flag positivo ripetuto senza nuova evidenza mantiene la data originale');

const written = service([]);
let writtenRow = null;
written.memory._getLockTuning_ = () => ({ maxRetries: 1, shardedAcquireTimeoutMs: 1 });
written.memory._getShardedLockKey = () => 'sensitive-memory-test';
written.memory._tryAcquireShardedLock = () => true;
written.memory._releaseShardedLock = () => {};
written.memory._sleepLockBackoff_ = () => {};
written.memory._appendRow = data => { writtenRow = data; };
const updateOk = written.memory.updateMemory('thread-created', { contextualFlags: { bereaved: true } });
assert.equal(updateOk, true);
assert.equal(writtenRow.contextualFlags.bereaved, true, 'la memoria ordinaria mantiene il flag');
assert.equal(written.sensitive.data[1][0], 'thread-created', 'updateMemory duplica i soli flag nell’archivio dedicato');
assert.equal(JSON.parse(written.sensitive.data[1][1]).bereaved, true);
assert.equal(JSON.parse(written.sensitive.data[1][1])._evidence.bereaved, new Date(now).toISOString());

const negative = service([['thread-cleared', storedFlags]]);
negative.memory._writeSensitiveContextFlags_('thread-cleared', { bereaved: false });
assert.equal(negative.sensitive.data[1][0], '', 'una smentita esplicita rimuove la vecchia evidenza archiviata');

const activeRow = ['thread-merged', 'it', 'information', 'standard', '[]', new Date(now).toISOString(), 1, 1, '', '{"bereaved":false}'];
const clearedByCurrentRow = service([['thread-merged', storedFlags]], activeRow);
const merged = clearedByCurrentRow.memory.getMemory('thread-merged');
assert.equal(merged.contextualFlags.bereaved, undefined, 'un flag corrente negativo prevale sull’archivio precedente');

now += 81 * day;
const expired = archived.memory.getMemory('thread-long');
assert.equal(expired.contextualFlags.bereaved, undefined, 'l’evidenza scade dopo 180 giorni dalla data originaria');
assert.equal(archived.memory._cleanExpiredSensitiveContextFlags_(), 1);
assert.equal(archived.sensitive.data[1][0], '', 'la pulizia elimina anche i dati sensibili scaduti');

console.log('Sensitive memory retention regression tests passed.');
