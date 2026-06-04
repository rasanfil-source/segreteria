const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.console = console;
global.CONFIG = {};
global.Utilities = {
  newBlob: (value) => ({
    getBytes: () => Buffer.from(String(value), 'utf8')
  })
};

const gasMainPath = path.join(__dirname, '..', 'gas_main.js');
const code = fs.readFileSync(gasMainPath, 'utf8');
vm.runInThisContext(code, { filename: gasMainPath });

console.log('--- Test calculateEaster: usa mezzogiorno UTC stabile ---');
{
  const easter2026 = calculateEaster(2026);
  assert(easter2026.toISOString() === '2026-04-05T12:00:00.000Z', 'Pasqua 2026 deve restare stabile a mezzogiorno UTC');
}

function createCache() {
  const store = new Map();
  return {
    store,
    get: (key) => (store.has(key) ? store.get(key) : null),
    put: (key, value) => store.set(key, String(value)),
    putAll: (values) => {
      Object.entries(values || {}).forEach(([key, value]) => store.set(key, String(value)));
    },
    getAll: (keys) => {
      const out = {};
      (keys || []).forEach((key) => {
        if (store.has(key)) out[key] = store.get(key);
      });
      return out;
    },
    remove: (key) => store.delete(key),
    removeAll: (keys) => {
      (keys || []).forEach((key) => store.delete(key));
    }
  };
}

console.log('--- Test resource cache: scrittura inline prevale senza invalidare chunk multipart stale ---');
{
  const cache = createCache();
  const largePayload = 'x'.repeat(RESOURCE_CACHE_MAX_PART_SIZE + 128);
  _writeResourceCachePayload(cache, largePayload);

  assert(cache.get(RESOURCE_CACHE_PARTS_KEY) === '2', 'payload grande deve creare indice multipart');
  assert(cache.get(`${RESOURCE_CACHE_PART_PREFIX}0`), 'payload grande deve creare primo chunk');
  assert(cache.get(`${RESOURCE_CACHE_PART_PREFIX}1`), 'payload grande deve creare secondo chunk');

  _writeResourceCachePayload(cache, 'payload inline');

  assert(cache.get(RESOURCE_CACHE_KEY_V2) === 'payload inline', 'payload piccolo deve essere scritto inline');
  assert(_readResourceCachePayload(cache) === 'payload inline', 'il reader deve preferire inline anche se esistono chunk stale');
  assert(cache.get(RESOURCE_CACHE_PARTS_KEY) === '2', 'scrittura inline non deve invalidare indice multipart potenzialmente concorrente');
  assert(cache.get(`${RESOURCE_CACHE_PART_PREFIX}0`) !== null, 'scrittura inline non deve cancellare chunk 0 potenzialmente concorrente');
  assert(cache.get(`${RESOURCE_CACHE_PART_PREFIX}1`) !== null, 'scrittura inline non deve cancellare chunk 1 potenzialmente concorrente');
}

console.log('--- Test resource cache: multipart incompleto non invalida cache concorrente ---');
{
  const cache = createCache();
  const removed = [];
  cache.store.set(RESOURCE_CACHE_PARTS_KEY, '2');
  cache.store.set(`${RESOURCE_CACHE_PART_PREFIX}0`, 'chunk-0');
  cache.remove = (key) => {
    removed.push(key);
    cache.store.delete(key);
  };
  cache.removeAll = (keys) => {
    (keys || []).forEach((key) => cache.remove(key));
  };

  assert(_readResourceCachePayload(cache) === null, 'multipart incompleto deve forzare reload');
  assert(removed.length === 0, 'reader non deve invalidare chiavi multipart durante una possibile write concorrente');
}

console.log('--- Test resource cache: payload multibyte non viene scritto inline oltre 100KB ---');
{
  const cache = createCache();
  cache.put = (key, value) => {
    const bytes = Buffer.from(String(value), 'utf8').length;
    assert(bytes <= 100000, `cache.put non deve ricevere payload oltre limite byte, ottenuto ${bytes}`);
    cache.store.set(key, String(value));
  };
  cache.putAll = (values) => {
    Object.entries(values || {}).forEach(([key, value]) => {
      const bytes = Buffer.from(String(value), 'utf8').length;
      assert(bytes <= 100000, `cache.putAll non deve ricevere chunk oltre limite byte, ottenuto ${bytes}`);
      cache.store.set(key, String(value));
    });
  };

  const multibytePayload = '€'.repeat(40000);
  _writeResourceCachePayload(cache, multibytePayload);

  assert(cache.get(RESOURCE_CACHE_KEY_V2) === null, 'payload multibyte grande deve usare multipart, non inline');
  assert(parseInt(cache.get(RESOURCE_CACHE_PARTS_KEY) || '0', 10) >= 2, 'payload multibyte deve essere diviso in chunk sicuri');
  assert(_readResourceCachePayload(cache) === multibytePayload, 'multipart multibyte deve ricostruire il payload originale');
}

console.log('--- Test loadResources: tryLock usa EXECUTION_LOCK_WAIT_MS configurato ---');
{
  const previousLockService = global.LockService;
  const previousConfig = global.CONFIG;
  const originalGetSpreadsheetModifiedTimeMs = _getSpreadsheetModifiedTimeMs;
  const originalLoadResourcesInternal = _loadResourcesInternal;
  let observedWaitMs = null;

  global.CONFIG = { EXECUTION_LOCK_WAIT_MS: 1234, SPREADSHEET_ID: 'sheet-test' };
  GLOBAL_CACHE.loaded = true;
  GLOBAL_CACHE.lastLoadedAt = 1000;
  global.LockService = {
    getScriptLock: () => ({
      tryLock: (waitMs) => {
        observedWaitMs = waitMs;
        return false;
      },
      releaseLock: () => {}
    })
  };
  _getSpreadsheetModifiedTimeMs = () => 2000;
  _loadResourcesInternal = () => {
    assert(false, 'loadResources non deve ricaricare se il lock non viene acquisito');
  };

  try {
    let threw = false;
    try {
      loadResources(true, false);
    } catch (e) {
      threw = true;
      assert(String(e.message).includes('Impossibile acquisire lock'), `Errore inatteso: ${e.message}`);
    }
    assert(threw, 'loadResources avrebbe dovuto lanciare un errore per lock non acquisito');
    assert(observedWaitMs === 1234, 'loadResources deve passare al lock il timeout configurato');
  } finally {
    global.LockService = previousLockService;
    global.CONFIG = previousConfig;
    _getSpreadsheetModifiedTimeMs = originalGetSpreadsheetModifiedTimeMs;
    _loadResourcesInternal = originalLoadResourcesInternal;
    GLOBAL_CACHE.loaded = false;
    GLOBAL_CACHE.lastLoadedAt = 0;
  }
}

console.log('✅ Test resource cache passati');
