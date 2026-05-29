const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

const gasMemoryServicePath = path.join(__dirname, '..', 'gas_memory_service.js');
const code = fs.readFileSync(gasMemoryServicePath, 'utf8');
vm.runInThisContext(code, { filename: gasMemoryServicePath });

console.log('--- Test MemoryService _setCache: chunk sotto limite CacheService ---');
{
  const originalCacheService = global.CacheService;
  const putAllPayloads = [];
  let putCalled = false;

  global.CacheService = {
    getScriptCache: () => ({
      put: () => {
        putCalled = true;
      },
      putAll: (payload) => {
        putAllPayloads.push(payload);
      }
    })
  };

  try {
    const memory = Object.create(MemoryService.prototype);
    memory._cache = {};
    memory._opCount = 0;
    memory._cacheExpiry = 5 * 60 * 1000;
    memory._maxCacheSize = 200;

    const data = {
      providedInfo: [{
        topic: 'long',
        value: 'x'.repeat(60000)
      }]
    };
    const expectedSerialized = JSON.stringify(data);

    memory._setCache('memory_big', data);

    assert(putCalled === false, 'large payload must use putAll chunking');
    assert(putAllPayloads.length === 1, 'large payload must be written in one putAll call');

    const payload = putAllPayloads[0];
    const meta = JSON.parse(payload.memory_big);
    assert(meta._isChunked === true, 'metadata must mark chunked cache payload');
    assert(meta.chunks >= 2, 'large payload must be split into multiple chunks');

    let reconstructed = '';
    for (let i = 0; i < meta.chunks; i++) {
      const chunk = payload[`memory_big_chunk_${i}`];
      assert(typeof chunk === 'string', `chunk ${i} must exist`);
      assert(chunk.length <= 45000, `chunk ${i} must stay within the conservative 45000 char limit`);
      reconstructed += chunk;
    }

    assert(reconstructed === expectedSerialized, 'chunks must reconstruct the original serialized payload');
  } finally {
    global.CacheService = originalCacheService;
  }
}

console.log('OK MemoryService cache chunk tests passed');
