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

console.log('--- Test MemoryService _validateAndNormalizeTimestamp: accetta futuro entro 24h ---');
{
  const memory = Object.create(MemoryService.prototype);
  const futureWithinDrift = new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString();
  const normalized = memory._validateAndNormalizeTimestamp(futureWithinDrift);
  assert(
    normalized === futureWithinDrift,
    'un timestamp a +2h deve restare valido per tollerare drift/fusi orari entro 24h'
  );
}

console.log('--- Test MemoryService _normalizeHeaders: riempie solo header attesi non vuoti ---');
{
  let writtenHeaders = null;
  const fakeSheet = {
    getMaxColumns: () => 9,
    insertColumnsAfter: () => {
      assert(false, 'non deve inserire colonne quando il foglio ha gia colonne sufficienti');
    },
    getRange: () => ({
      getValues: () => [[
        '', 'Lingua', 'categoria', 'tone',
        'providedInfo', 'lastUpdated', 'messageCount', '', ''
      ]],
      setValues: (values) => {
        writtenHeaders = values[0];
      },
      setFontWeight: () => {}
    })
  };

  const memory = Object.create(MemoryService.prototype);
  memory._sheet = fakeSheet;
  memory._normalizeHeaders();

  assert(Array.isArray(writtenHeaders), 'headers normalizzati devono essere riscritti');
  assert(writtenHeaders[0] === 'threadId', 'header vuoto con expected non vuoto deve essere impostato');
  assert(writtenHeaders[1] === 'language', 'alias Lingua deve essere normalizzato');
  assert(writtenHeaders[7] === 'version', 'colonna version vuota deve essere impostata');
  assert(writtenHeaders[8] === 'memorySummary', 'colonna memorySummary vuota deve essere impostata');
}

console.log('--- Test MemoryService updateMemory: retry OCC fonde providedInfo concorrente ---');
{
  const originalLockService = global.LockService;
  global.LockService = {
    getScriptLock: () => ({
      waitLock: () => {},
      releaseLock: () => {}
    })
  };

  try {
    const memory = Object.create(MemoryService.prototype);
    memory._initialized = true;
    memory._getLockTuning_ = () => ({ maxRetries: 2, shardedAcquireTimeoutMs: 1 });
    memory._getShardedLockKey = () => 'lock-thread-occ';
    memory._tryAcquireShardedLock = () => true;
    memory._releaseShardedLock = () => {};
    memory._sleepLockBackoff_ = () => {};
    memory._invalidateCache = () => {};
    memory._withSheetWriteLock = (fn) => fn();

    let saved = null;
    memory._updateRow = (rowIndex, data) => {
      saved = { rowIndex, data };
    };
    memory._findRowByThreadId = () => ({
      rowIndex: 2,
      values: [
        'thread-occ',
        'it',
        'info',
        'standard',
        JSON.stringify([{ topic: 'concorrente', userReaction: 'acknowledged', timestamp: '2026-05-01T00:00:00.000Z' }]),
        '2026-05-01T00:00:00.000Z',
        1,
        2,
        ''
      ]
    });

    memory.updateMemory('thread-occ', {
      _expectedVersion: 1,
      providedInfo: [{ topic: 'nuovo', userReaction: 'unknown', timestamp: '2026-05-01T00:00:00.000Z' }]
    });

    const topics = saved && saved.data && Array.isArray(saved.data.providedInfo)
      ? saved.data.providedInfo.map(item => item.topic).sort()
      : [];
    assert(topics.join(',') === 'concorrente,nuovo', 'retry OCC deve preservare topic concorrenti e nuovi');
  } finally {
    global.LockService = originalLockService;
  }
}



console.log('--- Test MemoryService updateMemory: invalida cache prima e dopo write ---');
{
  const originalLockService = global.LockService;
  global.LockService = {
    getScriptLock: () => ({
      waitLock: () => {},
      releaseLock: () => {}
    })
  };

  try {
    const events = [];
    const memory = Object.create(MemoryService.prototype);
    memory._initialized = true;
    memory._getLockTuning_ = () => ({ maxRetries: 1, shardedAcquireTimeoutMs: 1 });
    memory._getShardedLockKey = () => 'lock-thread-cache';
    memory._tryAcquireShardedLock = () => true;
    memory._releaseShardedLock = () => {};
    memory._sleepLockBackoff_ = () => {};
    memory._validateAndNormalizeTimestamp = (value) => value;
    memory._invalidateCache = (key) => events.push(`invalidate:${key}`);
    memory._withSheetWriteLock = (fn) => fn();
    memory._findRowByThreadId = () => ({
      rowIndex: 2,
      values: ['thread-cache', 'it', '', '', '[]', '2026-05-01T00:00:00.000Z', 0, 1, '']
    });
    memory._updateRow = () => events.push('write');

    memory.updateMemory('thread-cache', { language: 'en' });

    assert(events[0] === 'invalidate:memory_thread-cache', 'cache deve essere invalidata prima della write su sheet');
    assert(events[1] === 'write', 'write deve avvenire dopo invalidazione preventiva');
    assert(events[2] === 'invalidate:memory_thread-cache', 'cache deve essere invalidata anche dopo write riuscita');
  } finally {
    global.LockService = originalLockService;
  }
}


console.log('--- Test MemoryService providedInfo caps: usa config e non svuota topic singolo enorme ---');
{
  const originalConfig = global.CONFIG;
  global.CONFIG = {
    MAX_PROVIDED_INFO_JSON_CHARS: 220,
    MAX_PROVIDED_TOPICS: 3
  };

  try {
    const memory = Object.create(MemoryService.prototype);
    const oversized = [{
      topic: 'topic da conservare anche se i metadati sono enormi',
      userReaction: 'positive',
      timestamp: '2025-01-01T00:00:00.000Z',
      excerpt: 'x'.repeat(5000),
      context: {
        matchedPhrase: 'y'.repeat(1000),
        excerpt: 'z'.repeat(5000)
      }
    }];

    const serialized = memory._serializeProvidedInfoForSheet(oversized);
    const parsed = JSON.parse(serialized);

    assert(serialized.length <= global.CONFIG.MAX_PROVIDED_INFO_JSON_CHARS, 'serialized providedInfo deve rispettare MAX_PROVIDED_INFO_JSON_CHARS');
    assert(parsed.length === 1, 'un topic singolo enorme deve essere ridotto, non sostituito con array vuoto');
    assert(parsed[0].topic.startsWith('topic da conservare'), 'il topic minimo deve conservare il nome topic');
    assert(parsed[0].userReaction === 'positive', 'il topic minimo deve conservare userReaction');
  } finally {
    global.CONFIG = originalConfig;
  }
}

console.log('--- Test MemoryService providedInfo caps: taglia a MAX_PROVIDED_TOPICS configurato ---');
{
  const originalConfig = global.CONFIG;
  global.CONFIG = {
    MAX_PROVIDED_INFO_JSON_CHARS: 45000,
    MAX_PROVIDED_TOPICS: 2
  };

  try {
    const memory = Object.create(MemoryService.prototype);
    const serialized = memory._serializeProvidedInfoForSheet([
      { topic: 'uno', timestamp: '2025-01-01T00:00:00.000Z' },
      { topic: 'due', timestamp: '2025-01-01T00:00:00.000Z' },
      { topic: 'tre', timestamp: '2025-01-01T00:00:00.000Z' }
    ]);
    const parsed = JSON.parse(serialized);

    assert(parsed.length === 2, 'providedInfo deve usare MAX_PROVIDED_TOPICS configurato');
    assert(parsed[0].topic === 'due' && parsed[1].topic === 'tre', 'il trim deve conservare i topic più recenti');
  } finally {
    global.CONFIG = originalConfig;
  }
}

console.log('OK MemoryService cache chunk tests passed');
