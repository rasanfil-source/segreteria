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

console.log('--- Test MemoryService _validateAndNormalizeTimestamp: resetta futuro oltre 24h ---');
{
  const memory = Object.create(MemoryService.prototype);
  const futureBeyondDrift = new Date(Date.now() + (25 * 60 * 60 * 1000)).toISOString();
  const normalized = memory._validateAndNormalizeTimestamp(futureBeyondDrift);
  assert(
    normalized !== futureBeyondDrift,
    'un timestamp a +25h deve essere considerato fuori range e normalizzato'
  );
}

console.log('--- Test MemoryService conversationState: preserva legacySummaryText e salva solo enum validi ---');
{
  const memory = Object.create(MemoryService.prototype);
  const now = '2026-06-15T10:00:00.000Z';
  memory._validateAndNormalizeTimestamp = (value) => value || now;

  const serialized = memory._serializeMemorySummaryState(
    'Sintesi precedente',
    'Sintesi aggiornata',
    {
      lastRelationalPosture: 'open',
      currentRelationalPosture: 'open',
      responseFocusHint: 'answer_only_residual_question',
      responseFocusHintConfidence: 0.82,
      appliesToTopic: 'passaggio in segreteria',
      updatedAt: now,
      source: 'quick_check'
    }
  );
  const parsed = JSON.parse(serialized);
  assert(parsed.legacySummaryText === 'Sintesi aggiornata', 'legacySummaryText deve preservare la sintesi testuale aggiornata');
  assert(parsed.conversationState.currentRelationalPosture === 'open', 'currentRelationalPosture deve essere salvata come stato del thread');
  assert(parsed.conversationState.responseFocusHint === 'answer_only_residual_question', 'responseFocusHint enum valido deve essere salvato');
  assert(Object.keys(parsed.conversationState).length === 7, 'conversationState deve restare nello schema minimo previsto');

  const preserved = memory._serializeMemorySummaryState(
    '{"unknownShape":true}',
    'Nuova sintesi',
    {
      responseFocusHint: 'provide_next_operational_step',
      responseFocusHintConfidence: 0.9,
      updatedAt: now,
      source: 'quick_check'
    }
  );
  assert(preserved === '{"unknownShape":true}', 'JSON non riconosciuto non deve essere modificato distruttivamente');

  const unsafe = memory._serializeMemorySummaryState(
    '',
    'Sintesi',
    {
      responseFocusHint: 'utente ansioso',
      responseFocusHintConfidence: 0.95,
      updatedAt: now,
      source: 'quick_check'
    }
  );
  assert(JSON.parse(unsafe).conversationState.responseFocusHint === null, 'hint fuori enum non deve essere salvato');

  const existingWrapped = JSON.stringify({
    legacySummaryText: 'Sintesi vecchia',
    conversationState: {
      lastRelationalPosture: 'direct',
      currentRelationalPosture: 'direct',
      responseFocusHint: 'answer_only_residual_question',
      responseFocusHintConfidence: 0.82,
      appliesToTopic: 'passaggio in segreteria',
      updatedAt: now,
      source: 'quick_check'
    }
  });
  const textOnlyUpdate = JSON.parse(memory._serializeMemorySummaryState(
    existingWrapped,
    'Sintesi solo testuale nuova',
    null
  ));
  assert(textOnlyUpdate.legacySummaryText === 'Sintesi solo testuale nuova', 'memorySummary testuale deve aggiornare solo legacySummaryText');
  assert(textOnlyUpdate.conversationState.responseFocusHint === 'answer_only_residual_question', 'memorySummary testuale non deve sovrascrivere conversationState');
}

console.log('--- Test MemoryService _normalizeHeaders: riempie solo header attesi non vuoti ---');
{
  let writtenHeaders = null;
  let insertedColumns = null;
  const fakeSheet = {
    getMaxColumns: () => 9,
    insertColumnsAfter: (afterColumn, howMany) => {
      insertedColumns = { afterColumn, howMany };
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
  assert(writtenHeaders[9] === 'contextualFlags', 'colonna contextualFlags deve essere impostata');
  assert(insertedColumns && insertedColumns.afterColumn === 9 && insertedColumns.howMany === 1, 'foglio legacy a 9 colonne deve essere esteso a 10');
}

console.log('--- Test MemoryService contextualFlags: parsing, merge e scrittura ---');
{
  const memory = Object.create(MemoryService.prototype);
  memory._validateAndNormalizeTimestamp = (value) => value;
  memory._shrinkProvidedInfoToCaps = (topics) => topics;

  const parsed = memory._rowToObject([
    'thread-flags',
    'it',
    'information',
    'standard',
    '[]',
    '2026-06-01T10:00:00.000Z',
    1,
    2,
    '',
    JSON.stringify({ remote_user: true, bereaved: true, unsafe: true })
  ]);
  assert(parsed.contextualFlags.remote_user === true, 'remote_user deve essere letto dai contextualFlags');
  assert(parsed.contextualFlags.bereaved === true, 'bereaved deve essere letto dai contextualFlags');
  assert(!parsed.contextualFlags.unsafe, 'flag fuori schema non deve essere preservato');

  const merged = memory._mergeContextualFlags_(
    { remote_user: true, bereaved: true },
    { remote_user: false, canonical_complexity: true }
  );
  assert(!merged.remote_user, 'false esplicito deve rimuovere un flag contestuale');
  assert(merged.bereaved === true, 'merge deve preservare i flag esistenti non toccati');
  assert(merged.canonical_complexity === true, 'merge deve aggiungere nuovi flag ammessi');

  let rangeArgs = null;
  let writtenValues = null;
  memory._sheet = {
    getRange: (row, column, rows, columns) => {
      rangeArgs = { row, column, rows, columns };
      return {
        setValues: (values) => {
          writtenValues = values[0];
        }
      };
    }
  };
  memory._updateRow(2, {
    threadId: 'thread-flags',
    language: 'it',
    category: 'information',
    tone: 'standard',
    providedInfo: [],
    lastUpdated: '2026-06-01T10:00:00.000Z',
    messageCount: 1,
    version: 2,
    memorySummary: '',
    contextualFlags: { remote_user: true }
  });
  assert(rangeArgs.columns === 10, 'scrittura riga memoria deve usare 10 colonne');
  assert(writtenValues[9] === JSON.stringify({ remote_user: true }), 'contextualFlags deve essere serializzato nella decima colonna');
}

console.log('--- Test MemoryService updateMemory: VERSION_MISMATCH abortisce senza merge obsoleto ---');
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

    let thrown = null;
    try {
      memory.updateMemory('thread-occ', {
        _expectedVersion: 1,
        providedInfo: [{ topic: 'nuovo', userReaction: 'unknown', timestamp: '2026-05-01T00:00:00.000Z' }]
      });
    } catch (error) {
      thrown = error;
    }

    assert(thrown && thrown.message === 'VERSION_MISMATCH', 'OCC esplicito deve propagare VERSION_MISMATCH');
    assert(saved === null, 'OCC mismatch non deve scrivere un merge su dati obsoleti');
  } finally {
    global.LockService = originalLockService;
  }
}

console.log('--- Test MemoryService updateMemory: fonde providedInfo senza perdere storico ---');
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
    memory._getLockTuning_ = () => ({ maxRetries: 1, shardedAcquireTimeoutMs: 1 });
    memory._getShardedLockKey = () => 'lock-thread-merge';
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
        'thread-merge',
        'it',
        'info',
        'standard',
        JSON.stringify([
          { topic: 'Catechismo', userReaction: 'acknowledged', timestamp: '2026-05-01T00:00:00.000Z' },
          { topic: 'Orari segreteria', userReaction: 'unknown', timestamp: '2026-05-02T00:00:00.000Z' }
        ]),
        '2026-05-02T00:00:00.000Z',
        2,
        3,
        ''
      ]
    });

    memory.updateMemory('thread-merge', {
      providedInfo: [
        { topic: ' catechismo ', userReaction: 'unknown', timestamp: '2026-05-03T00:00:00.000Z' },
        { topic: 'Battesimo', userReaction: 'unknown', timestamp: '2026-05-03T00:00:00.000Z' }
      ]
    });

    const topics = saved && saved.data && saved.data.providedInfo;
    assert(Array.isArray(topics), 'providedInfo salvato deve restare un array');
    assert(topics.length === 3, `providedInfo deve conservare storico e nuovo topic, ottenuti ${topics.length}`);
    assert(topics.some(item => item.topic === 'Orari segreteria'), 'topic storico non duplicato deve restare presente');
    const catechismo = topics.find(item => String(item.topic || '').trim().toLowerCase() === 'catechismo');
    assert(catechismo && catechismo.userReaction === 'acknowledged', 'dedup topic deve preservare reazione storica se incoming e unknown');
    assert(topics.some(item => item.topic === 'Battesimo'), 'nuovo topic deve essere aggiunto');
  } finally {
    global.LockService = originalLockService;
  }
}

console.log('--- Test MemoryService updateMemoryAtomic: VERSION_MISMATCH non ritenta con versione aggiornata ---');
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
    memory._getLockTuning_ = () => ({ shardedAcquireTimeoutMs: 1 });
    memory._getShardedLockKey = () => 'lock-thread-atomic-occ';
    memory._tryAcquireShardedLock = () => true;
    memory._releaseShardedLock = () => {};
    memory._sleepLockBackoff_ = () => {};
    memory._invalidateCache = () => {};
    memory._withSheetWriteLock = (fn) => fn();
    memory._updateRow = () => {
      throw new Error('non deve scrivere su VERSION_MISMATCH');
    };
    memory._findRowByThreadId = () => ({
      rowIndex: 2,
      values: ['thread-atomic-occ', 'it', 'info', 'standard', '[]', '2026-05-01T00:00:00.000Z', 1, 3, '']
    });

    let lockAttempts = 0;
    memory._tryAcquireShardedLock = () => {
      lockAttempts += 1;
      return true;
    };

    const ok = memory.updateMemoryAtomic('thread-atomic-occ', { _expectedVersion: 2, language: 'en' }, ['nuovo']);

    assert(ok === false, 'updateMemoryAtomic deve fallire in modo controllato su VERSION_MISMATCH');
    assert(lockAttempts === 1, 'VERSION_MISMATCH non deve ritentare con una versione aggiornata internamente');
    assert(memory._lastUpdateMemoryAtomicFailure && memory._lastUpdateMemoryAtomicFailure.cause === 'VERSION_MISMATCH', 'deve registrare causa VERSION_MISMATCH');
  } finally {
    global.LockService = originalLockService;
  }
}

console.log('--- Test MemoryService updateMemoryAtomic: incrementa messageCount anche con solo flag interno ---');
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
    const now = '2026-05-10T10:00:00.000Z';
    memory._initialized = true;
    memory._getLockTuning_ = () => ({ shardedAcquireTimeoutMs: 1 });
    memory._getShardedLockKey = () => 'lock-thread-only-increment';
    memory._tryAcquireShardedLock = () => true;
    memory._releaseShardedLock = () => {};
    memory._sleepLockBackoff_ = () => {};
    memory._invalidateCache = () => {};
    memory._writeThroughMemoryCache_ = () => {};
    memory._withSheetWriteLock = (fn) => fn();
    memory._validateAndNormalizeTimestamp = () => now;

    let saved = null;
    memory._updateRow = (rowIndex, data) => {
      saved = { rowIndex, data };
    };
    memory._findRowByThreadId = () => ({
      rowIndex: 2,
      values: ['thread-only-increment', 'it', 'info', 'standard', '[]', '2026-05-01T00:00:00.000Z', 2, 7, '']
    });

    const ok = memory.updateMemoryAtomic('thread-only-increment', { _incrementMessageCount: true });

    assert(ok === true, 'updateMemoryAtomic deve accettare un update composto solo dal flag interno');
    assert(saved && saved.data.messageCount === 3, `messageCount atteso 3, ottenuto ${saved && saved.data.messageCount}`);
    assert(saved.data.version === 8, `version attesa 8, ottenuta ${saved.data.version}`);
    assert(!Object.prototype.hasOwnProperty.call(saved.data, '_incrementMessageCount'), 'il flag interno non deve essere persistito');

    let inserted = null;
    memory._findRowByThreadId = () => null;
    memory._appendRow = (data) => {
      inserted = data;
    };

    const created = memory.updateMemoryAtomic('thread-only-increment-new', { _incrementMessageCount: true });

    assert(created === true, 'updateMemoryAtomic deve creare una riga anche con solo incremento');
    assert(inserted && inserted.messageCount === 1, `messageCount iniziale atteso 1, ottenuto ${inserted && inserted.messageCount}`);
    assert(!Object.prototype.hasOwnProperty.call(inserted, '_incrementMessageCount'), 'il flag interno non deve essere persistito sulla insert');
  } finally {
    global.LockService = originalLockService;
  }
}

console.log('--- Test MemoryService updateMemoryAtomic: applica inferredReactionData su riga esistente ---');
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
    const now = '2026-05-10T10:00:00.000Z';
    memory._initialized = true;
    memory._getLockTuning_ = () => ({ shardedAcquireTimeoutMs: 1 });
    memory._getShardedLockKey = () => 'lock-thread-reaction-existing';
    memory._tryAcquireShardedLock = () => true;
    memory._releaseShardedLock = () => {};
    memory._sleepLockBackoff_ = () => {};
    memory._invalidateCache = () => {};
    memory._withSheetWriteLock = (fn) => fn();
    memory._validateAndNormalizeTimestamp = () => now;

    let saved = null;
    memory._updateRow = (rowIndex, data) => {
      saved = { rowIndex, data };
    };
    memory._findRowByThreadId = () => ({
      rowIndex: 2,
      values: [
        'thread-reaction-existing',
        'it',
        'info',
        'standard',
        JSON.stringify([{ topic: 'Orari messe', userReaction: 'unknown', timestamp: '2026-05-01T00:00:00.000Z' }]),
        '2026-05-01T00:00:00.000Z',
        1,
        1,
        ''
      ]
    });

    const ok = memory.updateMemoryAtomic(
      'thread-reaction-existing',
      { language: 'it' },
      ['orari_messe'],
      {
        reaction: 'acknowledged',
        topics: ['orari messe'],
        source: 'user_reply',
        matchedPhrase: 'ho capito',
        excerpt: 'Grazie, ho capito'
      }
    );

    const topic = saved && saved.data.providedInfo.find(item => memory._normalizeTopicKey(item.topic) === 'orari_messe');
    assert(ok === true, 'updateMemoryAtomic deve riuscire');
    assert(topic && topic.userReaction === 'acknowledged', 'reaction dedotta deve essere salvata sul topic esistente');
    assert(topic.lastInteraction === now, 'lastInteraction deve usare il timestamp della transazione atomica');
    assert(topic.context && topic.context.matchedPhrase === 'ho capito', 'context della reaction deve essere preservato');
  } finally {
    global.LockService = originalLockService;
  }
}

console.log('--- Test MemoryService updateMemoryAtomic: applica inferredReactionData su nuova riga ---');
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
    const now = '2026-05-10T10:00:00.000Z';
    memory._initialized = true;
    memory._getLockTuning_ = () => ({ shardedAcquireTimeoutMs: 1 });
    memory._getShardedLockKey = () => 'lock-thread-reaction-new';
    memory._tryAcquireShardedLock = () => true;
    memory._releaseShardedLock = () => {};
    memory._sleepLockBackoff_ = () => {};
    memory._invalidateCache = () => {};
    memory._withSheetWriteLock = (fn) => fn();
    memory._validateAndNormalizeTimestamp = () => now;
    memory._findRowByThreadId = () => null;

    let inserted = null;
    memory._appendRow = (data) => {
      inserted = data;
    };

    const ok = memory.updateMemoryAtomic(
      'thread-reaction-new',
      { language: 'it' },
      ['orari messe'],
      {
        reaction: 'acknowledged',
        topics: ['orari_messe'],
        source: 'user_reply',
        matchedPhrase: 'tutto chiaro',
        excerpt: 'Grazie, tutto chiaro'
      }
    );

    const topic = inserted && inserted.providedInfo.find(item => memory._normalizeTopicKey(item.topic) === 'orari_messe');
    assert(ok === true, 'updateMemoryAtomic deve riuscire su nuova riga');
    assert(topic && topic.userReaction === 'acknowledged', 'reaction dedotta non deve perdersi nella prima insert atomica');
    assert(topic.lastInteraction === now, 'lastInteraction deve essere salvato anche sulla prima insert');
    assert(topic.context && topic.context.excerpt === 'Grazie, tutto chiaro', 'context della reaction deve essere salvato sulla prima insert');
  } finally {
    global.LockService = originalLockService;
  }
}



console.log('--- Test MemoryService updateMemory: invalida cache e aggiorna write-through dopo write ---');
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
    memory._writeThroughMemoryCache_ = (key, data) => events.push(`cache:${key}:${data.language}`);
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
    assert(events[3] === 'cache:memory_thread-cache:en', 'cache deve essere ripopolata con il dato appena scritto');
  } finally {
    global.LockService = originalLockService;
  }
}

console.log('--- Test MemoryService updateMemoryRobust: providedTopics usa percorso atomico ---');
{
  const memory = Object.create(MemoryService.prototype);
  const events = [];
  let atomicArgs = null;
  let updateMemoryCalled = false;
  memory._invalidateCache = (key) => events.push(`invalidate:${key}`);
  memory.updateMemory = () => {
    updateMemoryCalled = true;
  };
  memory.updateMemoryAtomic = (threadId, data, providedTopics, inferredReactionData) => {
    atomicArgs = { threadId, data, providedTopics, inferredReactionData };
    return true;
  };

  const result = memory.updateMemoryRobust('thread-robust', {
    language: 'it',
    providedTopics: ['orari messe'],
    inferredReactionData: { reaction: 'positive' }
  });

  assert(result === true, 'updateMemoryRobust deve restituire l esito del percorso atomico');
  assert(updateMemoryCalled === false, 'con providedTopics non deve usare updateMemory semplice');
  assert(events[0] === 'invalidate:memory_thread-robust', 'deve comunque invalidare preventivamente la cache');
  assert(atomicArgs.threadId === 'thread-robust', 'threadId deve essere propagato');
  assert(atomicArgs.data.language === 'it', 'dati memoria ordinari devono essere propagati');
  assert(!Object.prototype.hasOwnProperty.call(atomicArgs.data, 'providedTopics'), 'providedTopics non deve essere persistito come campo dati');
  assert(!Object.prototype.hasOwnProperty.call(atomicArgs.data, 'inferredReactionData'), 'inferredReactionData non deve essere persistito come campo dati');
  assert(atomicArgs.providedTopics[0] === 'orari messe', 'topic deve essere passato a updateMemoryAtomic');
  assert(atomicArgs.inferredReactionData.reaction === 'positive', 'reaction data deve essere passato a updateMemoryAtomic');
}

console.log('--- Test MemoryService _withSheetWriteLock: flush anche se write fallisce con lock gia acquisito ---');
{
  const originalSpreadsheetApp = global.SpreadsheetApp;
  let flushCalled = false;
  global.SpreadsheetApp = {
    flush: () => {
      flushCalled = true;
    }
  };

  try {
    const memory = Object.create(MemoryService.prototype);
    let thrown = null;
    try {
      memory._withSheetWriteLock(() => {
        throw new Error('write boom');
      }, true);
    } catch (error) {
      thrown = error;
    }

    assert(thrown && thrown.message === 'write boom', 'errore della write deve propagarsi');
    assert(flushCalled === true, 'SpreadsheetApp.flush deve essere eseguito anche se la write fallisce');
  } finally {
    global.SpreadsheetApp = originalSpreadsheetApp;
  }
}

console.log('--- Test MemoryService _tryAcquireShardedLock: default senza sleep di verifica cache ---');
{
  const originalCacheService = global.CacheService;
  const originalLockService = global.LockService;
  const originalUtilities = global.Utilities;
  const store = new Map();
  const sleeps = [];

  global.CacheService = {
    getScriptCache: () => ({
      get: (key) => store.has(key) ? store.get(key) : null,
      put: (key, value) => store.set(key, value),
      remove: (key) => store.delete(key)
    })
  };
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {}
    })
  };
  global.Utilities = {
    sleep: (ms) => sleeps.push(ms)
  };

  try {
    const memory = Object.create(MemoryService.prototype);
    memory._heldShardLocks = {};
    memory._getLockTuning_ = () => ({
      globalGuardTimeoutMs: 1,
      cacheVerifyDelayMs: 0
    });

    const ok = memory._tryAcquireShardedLock('memory_lock_no_verify_sleep', 500);

    assert(ok === true, 'lock sharded deve essere acquisito nel percorso libero');
    assert(sleeps.length === 0, `il percorso default non deve dormire nel guard lock, sleeps: ${sleeps.join(', ')}`);
    memory._releaseShardedLock('memory_lock_no_verify_sleep');
  } finally {
    global.CacheService = originalCacheService;
    global.LockService = originalLockService;
    global.Utilities = originalUtilities;
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

console.log('--- Test MemoryService _releaseShardedLock: usa guard lock per check+remove ---');
{
  const originalCacheService = global.CacheService;
  const originalLockService = global.LockService;
  const events = [];
  const cacheStore = new Map([['lock-thread', 'token-owned']]);

  global.CacheService = {
    getScriptCache: () => ({
      get: (key) => {
        events.push(`get:${key}`);
        return cacheStore.get(key) || null;
      },
      remove: (key) => {
        events.push(`remove:${key}`);
        cacheStore.delete(key);
      }
    })
  };
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        events.push('tryLock');
        return true;
      },
      releaseLock: () => events.push('releaseLock')
    })
  };

  try {
    const memory = Object.create(MemoryService.prototype);
    memory._heldShardLocks = { 'lock-thread': 'token-owned' };
    memory._getLockTuning_ = () => ({ globalGuardTimeoutMs: 10 });

    memory._releaseShardedLock('lock-thread');

    assert(!cacheStore.has('lock-thread'), 'lock cache posseduto deve essere rimosso');
    assert(!memory._heldShardLocks['lock-thread'], 'token locale deve essere dimenticato dopo release riuscita');
    assert(events.join(',') === 'tryLock,get:lock-thread,remove:lock-thread,releaseLock', `ordine guard lock inatteso: ${events.join(',')}`);
  } finally {
    global.CacheService = originalCacheService;
    global.LockService = originalLockService;
  }
}

console.log('--- Test MemoryService _releaseShardedLock: non rimuove lock altrui ---');
{
  const originalCacheService = global.CacheService;
  const originalLockService = global.LockService;
  const cacheStore = new Map([['lock-thread', 'token-other']]);

  global.CacheService = {
    getScriptCache: () => ({
      get: (key) => cacheStore.get(key) || null,
      remove: () => {
        assert(false, 'non deve rimuovere un token diverso dal proprio');
      }
    })
  };
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {}
    })
  };

  try {
    const memory = Object.create(MemoryService.prototype);
    memory._heldShardLocks = { 'lock-thread': 'token-owned' };
    memory._getLockTuning_ = () => ({ globalGuardTimeoutMs: 10 });

    memory._releaseShardedLock('lock-thread');

    assert(cacheStore.get('lock-thread') === 'token-other', 'token altrui deve restare in cache');
    assert(!memory._heldShardLocks['lock-thread'], 'token locale stale deve essere dimenticato');
  } finally {
    global.CacheService = originalCacheService;
    global.LockService = originalLockService;
  }
}

console.log('OK MemoryService cache chunk tests passed');
