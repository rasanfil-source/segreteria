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

console.log('✅ Test resource cache passati');
