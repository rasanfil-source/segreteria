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

console.log('--- Test resource cache: scrittura inline rimuove chunk multipart stale ---');
{
  const cache = createCache();
  const largePayload = 'x'.repeat(RESOURCE_CACHE_MAX_PART_SIZE + 128);
  _writeResourceCachePayload(cache, largePayload);

  assert(cache.get(RESOURCE_CACHE_PARTS_KEY) === '2', 'payload grande deve creare indice multipart');
  assert(cache.get(`${RESOURCE_CACHE_PART_PREFIX}0`), 'payload grande deve creare primo chunk');
  assert(cache.get(`${RESOURCE_CACHE_PART_PREFIX}1`), 'payload grande deve creare secondo chunk');

  _writeResourceCachePayload(cache, 'payload inline');

  assert(cache.get(RESOURCE_CACHE_KEY_V2) === 'payload inline', 'payload piccolo deve essere scritto inline');
  assert(cache.get(RESOURCE_CACHE_PARTS_KEY) === null, 'scrittura inline deve rimuovere indice multipart');
  assert(cache.get(`${RESOURCE_CACHE_PART_PREFIX}0`) === null, 'scrittura inline deve rimuovere chunk 0 stale');
  assert(cache.get(`${RESOURCE_CACHE_PART_PREFIX}1`) === null, 'scrittura inline deve rimuovere chunk 1 stale');
}

console.log('✅ Test resource cache passati');
