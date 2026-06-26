/**
 * MemoryService.gs - Memoria conversazionale per GAS
 * Usa Google Sheet come storage
 * 
 * STORAGE: Google Sheet "ConversationMemory" con colonne:
 * A: threadId
 * B: language
 * C: category
 * D: tone
 * E: providedInfo (JSON array)
 * F: lastUpdated (timestamp)
 * G: messageCount
 * H: version (per controllo concorrenza ottimistico)
 * I: memorySummary
 * J: contextualFlags (JSON object)
 * 
 * FUNZIONALITÀ:
 * - Cache locale per performance
 * - Lock granulare (per thread) con CacheService
 * - Controllo concorrenza ottimistico con versione
 * - Topic tracking (anti-ripetizione)
 * - Operazioni atomiche
 */
var MemoryService = class MemoryService {
  constructor() {
    console.log('🧠 Inizializzazione MemoryService (basato su Sheet)...');

    // Configurazione
    const props = PropertiesService.getScriptProperties();
    const propId = props.getProperty('SPREADSHEET_ID');

    this.spreadsheetId = (propId && !propId.includes('PLACEHOLDER')) ? propId :
      (typeof CONFIG !== 'undefined' ? CONFIG.SPREADSHEET_ID : null);
    this.sheetName = typeof CONFIG !== 'undefined' ?
      (CONFIG.MEMORY_SHEET_NAME || 'ConversationMemory') :
      'ConversationMemory';

    // Cache per performance (evita lookup ripetuti)
    this._cache = {};
    this._heldShardLocks = {};
    this._cacheExpiry = 5 * 60 * 1000; // 5 minuti
    this._maxCacheSize = 200; // Limite hard per evitare crescita RAM incontrollata
    this._opCount = 0; // Contatore per Garbage Collection periodica

    // Inizializza foglio
    this._sheet = null;
    this._initialized = false;

    if (this.spreadsheetId) {
      this._initializeSheet();
    } else {
      console.warn('⚠️ SPREADSHEET_ID non configurato, MemoryService disabilitato');
    }
  }

  /**
   * Inizializza o crea il foglio memoria
   */
  _initializeSheet() {
    try {
      const spreadsheet = SpreadsheetApp.openById(this.spreadsheetId);
      this._sheet = spreadsheet.getSheetByName(this.sheetName);

      if (!this._sheet) {
        // Crea nuovo foglio con intestazioni
        this._sheet = spreadsheet.insertSheet(this.sheetName);
        this._sheet.getRange('A1:J1').setValues([[
          'threadId', 'language', 'category', 'tone',
          'providedInfo', 'lastUpdated', 'messageCount', 'version', 'memorySummary', 'contextualFlags'
        ]]);
        this._sheet.getRange('A1:J1').setFontWeight('bold');
        this._sheet.setFrozenRows(1);
        console.log(`✓ Creato nuovo foglio: ${this.sheetName}`);
      } else {
        this._normalizeHeaders();
      }

      this._initialized = true;
      console.log(`✓ MemoryService inizializzato (Foglio: ${this.sheetName})`);

    } catch (error) {
      console.error(`❌ Inizializzazione MemoryService fallita: ${error.message}`);
      this._initialized = false;
    }
  }

  _normalizeHeaders() {
    try {
      const expectedHeaders = [
        'threadId', 'language', 'category', 'tone',
        'providedInfo', 'lastUpdated', 'messageCount', 'version', 'memorySummary', 'contextualFlags'
      ];
      
      const maxCols = this._sheet.getMaxColumns();
      if (maxCols < expectedHeaders.length) {
        this._sheet.insertColumnsAfter(maxCols, expectedHeaders.length - maxCols);
      }

      const range = this._sheet.getRange(1, 1, 1, expectedHeaders.length);
      const actualHeaders = range.getValues()[0];
      const newHeaders = [...actualHeaders];
      let modified = false;

      // Mappatura alias comuni (IT <-> EN)
      const headerMap = {
        'ultima risposta': 'lastUpdated',
        'ultimo aggiornamento': 'lastUpdated',
        'messaggi': 'messageCount',
        'versione': 'version',
        'lingua': 'language',
        'categoria': 'category'
      };

      for (let i = 0; i < expectedHeaders.length; i++) {
        const current = String(actualHeaders[i] || '').trim();
        const expected = expectedHeaders[i];

        if (current.toLowerCase() !== expected.toLowerCase()) {
          // Se è un alias noto, lo normalizziamo
          if (headerMap[current.toLowerCase()] === expected) {
            console.log(`🔄 Normalizzazione header: '${current}' -> '${expected}'`);
            newHeaders[i] = expected;
            modified = true;
          } else if (!current) {
            // Se la colonna è vuota, impostiamo il default
            if (expected) {
              console.log(`🔄 Impostazione header mancante colonna ${i + 1}: '${expected}'`);
              newHeaders[i] = expected;
              modified = true;
            }
          }
        }
      }

      if (modified) {
        range.setValues([newHeaders]);
        range.setFontWeight('bold');
      }
    } catch (e) {
      console.warn('⚠️ Errore normalizzazione intestazioni:', e.message);
    }
  }

  /**
   * Ottiene memoria per un thread
   */
  getMemory(threadId) {
    if (!this._initialized || !threadId) {
      return { exists: false, providedInfo: [] };
    }
    const normalizedThreadId = String(threadId).trim();
    if (!normalizedThreadId) {
      return { exists: false, providedInfo: [] };
    }

    // Verifica cache
    const cacheKey = `memory_${normalizedThreadId}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) {
      console.log(`🧠 Memory hit (cache) per thread ${normalizedThreadId}`);
      const cachedCopy = this._cloneMemoryCacheValue_(cached);
      if (!Object.prototype.hasOwnProperty.call(cachedCopy, 'exists')) {
        cachedCopy.exists = true;
      }
      return cachedCopy;
    }

    try {
      // Trova riga per threadId
      const row = this._findRowByThreadId(normalizedThreadId);

      if (row) {
        const data = this._rowToObject(row.values);
        if (!Array.isArray(data.providedInfo)) {
          data.providedInfo = [];
        }
        data.exists = true;
        console.log(`🧠 Memory hit per thread ${normalizedThreadId} (Lingua: ${data.language})`);

        // Memorizza in cache
        this._setCache(cacheKey, data);
        return data;
      } else {
        console.log(`🧠 Memory miss per thread ${threadId} (Nuova conversazione)`);
        return { exists: false, providedInfo: [] };
      }

    } catch (error) {
      console.error(`❌ Errore recupero memoria: ${error.message}`);
      return { exists: false, providedInfo: [] };
    }
  }

  /**
   * Alias storico per getMemory.
   * getMemory gestisce gia cache locale/CacheService e fallback su Sheets.
   */
  getMemoryRobust(threadId) {
    // getMemory implementa già il multi-livello (RAM locale + CacheService).
    // Duplicare qui la cache con prefisso alternativo introdurrebbe stato incoerente.
    return this.getMemory(threadId);
  }
 
  /**
   * Restituisce i topic recenti salvati in providedInfo.
   *
   * @param {string} threadId
   * @param {number} [limit=10] numero massimo di entry da restituire
   * @returns {Array<{topic: string, userReaction: string}>}
   */
  getRecentProvidedInfo(threadId, limit = 10) {
    if (!this._initialized || !threadId) return [];
    try {
      const memory = this.getMemory(threadId);
      const providedInfo = Array.isArray(memory.providedInfo) ? memory.providedInfo : [];
      return limit > 0 ? providedInfo.slice(-limit) : [];
    } catch (e) {
      console.warn(`⚠️ getRecentProvidedInfo fallito per thread ${threadId}: ${e.message}`);
      return [];
    }
  }

  /**
   * Restituisce SOLO i topic recenti di memoria, non la cronologia messaggi Gmail.
   */
  getRecentMemoryTopics(threadId, limit = 10) {
    return this.getRecentProvidedInfo(threadId, limit);
  }

  /**
   * @deprecated MemoryService non possiede la cronologia Gmail reale.
   * Usa getRecentMemoryTopics/getRecentProvidedInfo per i topic di memoria, oppure
   * GmailService.getThreadHistory per i messaggi conversazionali precedenti.
   */
  getRecentHistory(threadId, limit = 10) {
    console.warn('⚠️ MemoryService.getRecentHistory è deprecato: usa getRecentMemoryTopics() per la memoria o GmailService.getThreadHistory() per Gmail.');
    return [];
  }

  /**
   * Aggiorna memoria per un thread (merge con esistente)
   * Usa lock granulare + retry + optimistic locking
   */
  updateMemory(threadId, newData, options = {}) {
    if (!this._initialized || !threadId || !newData || typeof newData !== 'object') {
      return false;
    }
    const normalizedThreadId = String(threadId).trim();
    if (!normalizedThreadId) return false;

    const conversationStateUpdate = newData.conversationStateUpdate || null;
    const baseMemorySummary = newData._baseMemorySummary;

    // Filtra campi interni
    const dataToUpdate = {};
    for (const key in newData) {
      if (!key.startsWith('_') && key !== 'conversationStateUpdate') {
        dataToUpdate[key] = newData[key];
      }
    }

    const MAX_RETRIES = this._getLockTuning_().maxRetries;
    // Sharding basato su hash del threadId per ridurre la contention
    const lockKey = this._getShardedLockKey(normalizedThreadId);

    // OCC con retry: se la versione attesa è stale, rilegge la memoria fresca
    // e tenta un nuovo merge prima di arrendersi.
    let expectedVersion = newData._expectedVersion;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let shardedLockOwned = false;
      let globalLockAcquired = false;
      const globalLock = LockService.getScriptLock();

      try {
        // 1. Acquisisci Lock Sharded (CacheService)
        shardedLockOwned = this._tryAcquireShardedLock(lockKey, this._getLockTuning_().shardedAcquireTimeoutMs);
        if (!shardedLockOwned) {
          console.warn(`🔒 Timeout lock memoria sharded (Tentativo ${attempt + 1})`);
          this._sleepLockBackoff_(attempt);
          continue;
        }

        // 2. Acquisisci Lock Globale per scrittura fisica (B4)
        const sheetTimeout = (typeof CONFIG !== 'undefined' && CONFIG.SHEET_WRITE_LOCK_TIMEOUT_MS) || 10000;
        globalLock.waitLock(sheetTimeout);
        globalLockAcquired = true;

        // 3. Rileggi dati freschi dallo Sheet
        const existingRow = this._findRowByThreadId(normalizedThreadId);
        const now = this._validateAndNormalizeTimestamp(new Date().toISOString());
        const shouldIncrementMessageCount = options.incrementMessageCount === true || newData._incrementMessageCount === true;

        let cacheValueToStore = null;

        if (existingRow) {
          const existingData = this._rowToObject(existingRow.values);
          const currentVersion = existingData.version || 0;

          // Verifica controllo concorrenza ottimistico
          if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
            this._invalidateCache(`memory_${normalizedThreadId}`);
            console.warn(`🔒 Version mismatch thread ${normalizedThreadId}: atteso ${expectedVersion}, ottenuto ${currentVersion} - rileggo e ritento`);
            const mismatchError = new Error('VERSION_MISMATCH');
            mismatchError.currentVersion = currentVersion;
            throw mismatchError;
          }

          const hasIncomingMemorySummary = Object.prototype.hasOwnProperty.call(dataToUpdate, 'memorySummary');
          const mergedMemorySummary = (conversationStateUpdate || hasIncomingMemorySummary)
            ? this._serializeMemorySummaryState(
              existingData._rawMemorySummary || existingData.memorySummary || '',
              hasIncomingMemorySummary ? dataToUpdate.memorySummary : null,
              conversationStateUpdate,
              baseMemorySummary
            )
            : null;

          // Merge: esistente + nuovi dati
          const mergedData = Object.assign({}, existingData, dataToUpdate);
          if (conversationStateUpdate || hasIncomingMemorySummary) {
            mergedData.memorySummary = mergedMemorySummary;
          } else if (!hasIncomingMemorySummary && existingData._rawMemorySummary) {
            mergedData.memorySummary = existingData._rawMemorySummary;
          }
          if (Object.prototype.hasOwnProperty.call(dataToUpdate, 'providedInfo')) {
            const existingTopics = this._normalizeProvidedTopics(
              Array.isArray(existingData.providedInfo) ? existingData.providedInfo : []
            );
            const incomingTopics = this._normalizeProvidedTopics(dataToUpdate.providedInfo);
            mergedData.providedInfo = this._mergeProvidedTopics(existingTopics, incomingTopics);
          }
          if (Object.prototype.hasOwnProperty.call(dataToUpdate, 'contextualFlags')) {
            mergedData.contextualFlags = this._mergeContextualFlags_(
              existingData.contextualFlags,
              dataToUpdate.contextualFlags
            );
          }
          mergedData.lastUpdated = now;
          mergedData.messageCount = shouldIncrementMessageCount
            ? (existingData.messageCount || 0) + 1
            : (existingData.messageCount || 0);
          mergedData.version = currentVersion + 1;

          // Cap preventivo lunghezza JSON providedInfo (B5)
          if (mergedData.providedInfo && Array.isArray(mergedData.providedInfo)) {
            mergedData.providedInfo = this._shrinkProvidedInfoToCaps(
              mergedData.providedInfo,
              'updateMemory'
            );
          }

          this._invalidateCache(`memory_${normalizedThreadId}`);
          this._withSheetWriteLock(() => {
            this._updateRow(existingRow.rowIndex, mergedData);
          }, true);
          cacheValueToStore = mergedData;
          console.log(`🧠 Memoria aggiornata per thread ${threadId} (v${mergedData.version}, Tentativo ${attempt + 1})`);
        } else {
          if (conversationStateUpdate) {
            dataToUpdate.memorySummary = this._serializeMemorySummaryState(
              '',
              Object.prototype.hasOwnProperty.call(dataToUpdate, 'memorySummary') ? dataToUpdate.memorySummary : null,
              conversationStateUpdate,
              null
            );
          }

          // Nuova riga
          const insertData = Object.assign({}, dataToUpdate);
          if (Object.prototype.hasOwnProperty.call(insertData, 'contextualFlags')) {
            insertData.contextualFlags = this._normalizeContextualFlags_(insertData.contextualFlags);
          }
          insertData.threadId = normalizedThreadId;
          insertData.lastUpdated = now;
          insertData.messageCount = shouldIncrementMessageCount ? 1 : 0;
          insertData.version = 1;

          this._invalidateCache(`memory_${normalizedThreadId}`);
          this._withSheetWriteLock(() => {
            this._appendRow(insertData);
          }, true);
          cacheValueToStore = insertData;
          console.log(`🧠 Memoria creata per thread ${threadId} (v1)`);
        }

        // Invalida cache locale
        this._invalidateCache(`memory_${normalizedThreadId}`);
        this._writeThroughMemoryCache_(`memory_${normalizedThreadId}`, cacheValueToStore);
        return true; // Successo

      } catch (error) {
        if (error.message === 'VERSION_MISMATCH') {
          console.warn(`⚠️ Conflitto concorrenza OCC, rileggo memoria fresca (Tentativo ${attempt + 1})`);
          this._invalidateCache(`memory_${normalizedThreadId}`);
          if (attempt === MAX_RETRIES - 1) {
            console.error(`❌ Aggiornamento memoria finale fallito: ${error.message}`);
            throw error;
          }
          const freshVersion = Number(error.currentVersion);
          if (Number.isFinite(freshVersion)) {
            expectedVersion = freshVersion;
            console.warn(`🔒 Retry OCC thread ${normalizedThreadId} con versione osservata ${expectedVersion}`);
          } else {
            console.warn(`🔒 Retry OCC thread ${normalizedThreadId} senza versione osservata: mantengo expectedVersion per evitare overwrite cieco`);
          }
          this._sleepLockBackoff_(attempt);
          continue;
        } else {
          console.warn(`Aggiornamento memoria fallito (Tentativo ${attempt + 1}): ${error.message}`);
        }

        if (attempt === MAX_RETRIES - 1) {
          console.error(`❌ Aggiornamento memoria finale fallito: ${error.message}`);
          throw error;
        }

        // Backoff
        this._sleepLockBackoff_(attempt);

      } finally {
        if (globalLockAcquired) {
          try { globalLock.releaseLock(); } catch (e) {}
        }
        if (shardedLockOwned) {
          this._releaseShardedLock(lockKey);
        }
      }
    }
    console.error(`❌ Aggiornamento memoria fallito per thread ${threadId} dopo ${MAX_RETRIES} tentativi`);
    return false;
  }

  /**
   * Scrive su entrambi i livelli (Sheets e Cache).
   * Aggiornato per utilizzare updateMemory che è transazionale e gestisce già inv. cache e lock.
   */
  updateMemoryRobust(threadId, data) {
    if (!threadId || !data || typeof data !== 'object') {
      return false;
    }

    // Invalidazione preventiva cache prima della lettura di allineamento
    console.log(`🧹 Invalidazione preventiva cache per thread ${threadId} pre-lettura di allineamento`);
    this._invalidateCache(`memory_${threadId}`);

    // Se un chiamante passa topic insieme ai dati robusti, non scartarli:
    // l'operazione atomica è il solo percorso che fonde correttamente providedInfo.
    const robustProvidedTopics = data.providedTopics;
    const hasRobustTopics = !!(robustProvidedTopics && (
      (Array.isArray(robustProvidedTopics) && robustProvidedTopics.length > 0) ||
      (typeof robustProvidedTopics === 'string' && robustProvidedTopics.trim().length > 0)
    ));

    // Se fallisce anche dopo i retry, qui non rilanciamo: la memoria è best-effort.
    try {
      if (hasRobustTopics) {
        const dataToUpdate = Object.assign({}, data);
        const inferredReactionData = dataToUpdate.inferredReactionData || null;
        delete dataToUpdate.providedTopics;
        delete dataToUpdate.inferredReactionData;
        return this.updateMemoryAtomic(threadId, dataToUpdate, robustProvidedTopics, inferredReactionData);
      }

      return this.updateMemory(threadId, data);
    } catch (e) {
      console.error(`❌ updateMemoryRobust: persistenza memoria fallita per thread ${threadId}: ${e.message}`);
      return false;
    }
  }

  /**
   * Aggiorna memoria E topic in un'unica operazione atomica
   * Previene inconsistenze: tutto o niente in un singolo lock
   * 
   * @param {string} threadId - ID del thread
   * @param {Object} newData - Dati da aggiornare (language, category, tone, etc.)
   * @param {(string|Object)[]} providedTopics - Topic da aggiungere (opzionale)
   * @returns {boolean} - true se l'operazione è riuscita
   */
  updateMemoryAtomic(threadId, newData, providedTopics = null, inferredReactionData = null) {
    if (!this._initialized || !threadId) {
      return false;
    }
    const normalizedThreadId = String(threadId).trim();
    if (!normalizedThreadId) return false;
    const rawData = (newData && typeof newData === 'object') ? newData : {};
    const conversationStateUpdate = rawData.conversationStateUpdate || null;
    const baseMemorySummary = rawData._baseMemorySummary;

    // Filtra campi interni (_*) per evitare persistenza accidentale su Sheets
    const dataToUpdate = {};
    for (const key in rawData) {
      if (!key.startsWith('_') && key !== 'conversationStateUpdate') {
        dataToUpdate[key] = rawData[key];
      }
    }
    const shouldIncrementMessageCount = rawData._incrementMessageCount === true;
    const hasConversationStateUpdate = !!conversationStateUpdate;

    // Accetta anche operazioni atomiche composte solo da topic, incremento contatore o stato conversazionale.
    const hasData = Object.keys(dataToUpdate).length > 0;
    const hasTopics = !!(providedTopics && (
      (Array.isArray(providedTopics) && providedTopics.length > 0) ||
      (typeof providedTopics === 'string' && providedTopics.length > 0)
    ));

    if (!hasData && !hasTopics && !shouldIncrementMessageCount && !hasConversationStateUpdate) {
      console.warn(`⚠️ updateMemoryAtomic chiamato senza dati né topic validi per thread ${threadId}`);
      return false;
    }

    const lockTuning = this._getLockTuning_();
    const maxRetries = Number(lockTuning.maxRetries);
    const MAX_RETRIES = Number.isFinite(maxRetries) && maxRetries > 0
      ? Math.max(1, Math.floor(maxRetries))
      : 3;
    const lockKey = this._getShardedLockKey(normalizedThreadId);

    let expectedVersion = rawData._expectedVersion;

    let lastAtomicError = null;

    for (let i = 0; i < MAX_RETRIES; i++) {
        const globalLock = LockService.getScriptLock();
        let globalLockAcquired = false;
        let lockAcquired = false;

        try {
          // 1. Acquisisci Lock Sharded (CacheService)
          lockAcquired = this._tryAcquireShardedLock(lockKey, lockTuning.shardedAcquireTimeoutMs);
          if (!lockAcquired) {
            if (i === MAX_RETRIES - 1) {
              const failure = {
                threadId: normalizedThreadId,
                cause: 'LOCK_TIMEOUT',
                message: `Lock sharded non acquisito dopo ${MAX_RETRIES} tentativi (${lockKey})`,
                at: new Date().toISOString()
              };
              this._lastUpdateMemoryAtomicFailure = failure;
              console.error(`❌ CRITICO: updateMemoryAtomic lock timeout per thread ${normalizedThreadId}: ${failure.message}`);
              return false;
            }
            if (i < MAX_RETRIES - 1) {
              this._sleepLockBackoff_(i);
            }
            continue;
          }

          // 1.5 Acquisisci Lock Globale per scrittura (B4)
          const sheetTimeout = (typeof CONFIG !== 'undefined' && CONFIG.SHEET_WRITE_LOCK_TIMEOUT_MS) || 10000;
          globalLock.waitLock(sheetTimeout);
          globalLockAcquired = true;

        // --- SEZIONE CRITICA ---
        const existingRow = this._findRowByThreadId(normalizedThreadId);
        const now = this._validateAndNormalizeTimestamp(new Date().toISOString());

        let cacheValueToStore = null;

        if (existingRow) {
          const existingData = this._rowToObject(existingRow.values);
          const currentVersion = existingData.version || 0;

          // Controllo concorrenza ottimistico opzionale
          if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
            console.warn(`🔒 Version mismatch atomico thread ${threadId}: atteso ${expectedVersion}, ottenuto ${currentVersion} - rileggo e ritento`);
            const mismatchError = new Error('VERSION_MISMATCH');
            mismatchError.currentVersion = currentVersion;
            throw mismatchError;
          }

          const hasIncomingMemorySummary = Object.prototype.hasOwnProperty.call(dataToUpdate, 'memorySummary');
          const mergedMemorySummary = (conversationStateUpdate || hasIncomingMemorySummary)
            ? this._serializeMemorySummaryState(
                existingData._rawMemorySummary || existingData.memorySummary || '',
                hasIncomingMemorySummary ? dataToUpdate.memorySummary : null,
                conversationStateUpdate,
                baseMemorySummary
              )
            : null;
          const mergedData = Object.assign({}, existingData, dataToUpdate);
          if (conversationStateUpdate || hasIncomingMemorySummary) {
            mergedData.memorySummary = mergedMemorySummary;
          } else if (!hasIncomingMemorySummary && existingData._rawMemorySummary) {
            mergedData.memorySummary = existingData._rawMemorySummary;
          }
          if (Object.prototype.hasOwnProperty.call(dataToUpdate, 'contextualFlags')) {
            mergedData.contextualFlags = this._mergeContextualFlags_(
              existingData.contextualFlags,
              dataToUpdate.contextualFlags
            );
          }
          mergedData.lastUpdated = now;
          mergedData.messageCount = shouldIncrementMessageCount
            ? (existingData.messageCount || 0) + 1
            : (existingData.messageCount || 0);
          mergedData.version = currentVersion + 1;

          if (providedTopics && providedTopics.length > 0) {
            const normalizedTopics = this._normalizeProvidedTopics(providedTopics);
            const existingTopics = this._normalizeProvidedTopics(existingData.providedInfo || []);
            const mergedTopics = this._mergeProvidedTopics(existingTopics, normalizedTopics);

            // Limita providedInfo per evitare memory bloat
            const maxTopics = (typeof CONFIG !== 'undefined' && CONFIG.MAX_PROVIDED_TOPICS) || 50;
            let trimmedTopics = mergedTopics;
            if (trimmedTopics.length > maxTopics) {
              console.log(`🧠 Memoria: Trim providedInfo da ${trimmedTopics.length} a ${maxTopics} topic`);
              trimmedTopics = trimmedTopics.slice(-maxTopics);
            }

            mergedData.providedInfo = trimmedTopics;
            console.log(`🧠 Memoria: Aggiunti atomicamente topic ${JSON.stringify(normalizedTopics)}`);
          }
          mergedData.providedInfo = this._applyInferredReactionToProvidedInfo(
            mergedData.providedInfo,
            inferredReactionData,
            now
          );

            // Cap preventivo lunghezza JSON providedInfo (B5)
            if (mergedData.providedInfo && Array.isArray(mergedData.providedInfo)) {
              mergedData.providedInfo = this._shrinkProvidedInfoToCaps(
                mergedData.providedInfo,
                'updateMemoryAtomic'
              );
            }

            this._invalidateCache(`memory_${normalizedThreadId}`);
            this._withSheetWriteLock(() => {
              this._updateRow(existingRow.rowIndex, mergedData);
            }, true);
            cacheValueToStore = mergedData;
            console.log(`🧠 Memoria aggiornata atomicamente per thread ${threadId} (v${mergedData.version})`);
        } else {
          if (conversationStateUpdate) {
            dataToUpdate.memorySummary = this._serializeMemorySummaryState(
              '',
              Object.prototype.hasOwnProperty.call(dataToUpdate, 'memorySummary') ? dataToUpdate.memorySummary : null,
              conversationStateUpdate,
              null
            );
          }
          const insertData = Object.assign({}, dataToUpdate);
          if (Object.prototype.hasOwnProperty.call(insertData, 'contextualFlags')) {
            insertData.contextualFlags = this._normalizeContextualFlags_(insertData.contextualFlags);
          }
          insertData.threadId = normalizedThreadId;
          insertData.lastUpdated = now;
          insertData.messageCount = shouldIncrementMessageCount ? 1 : 0;
          insertData.version = 1;

          if (providedTopics && providedTopics.length > 0) {
            insertData.providedInfo = this._normalizeProvidedTopics(providedTopics);
            insertData.providedInfo = this._applyInferredReactionToProvidedInfo(
              insertData.providedInfo,
              inferredReactionData,
              now
            );
          }

          this._invalidateCache(`memory_${normalizedThreadId}`);
          this._withSheetWriteLock(() => {
            this._appendRow(insertData);
          }, true);
          cacheValueToStore = insertData;
          console.log(`🧠 Memoria creata atomicamente per thread ${threadId} (v1)`);
        }

        this._invalidateCache(`memory_${normalizedThreadId}`);
        this._writeThroughMemoryCache_(`memory_${normalizedThreadId}`, cacheValueToStore);
        this._lastUpdateMemoryAtomicFailure = null;
        return true;
        // --- FINE SEZIONE CRITICA ---

        } catch (error) {
          lastAtomicError = error;
          console.warn(`⚠️ Errore aggiornamento atomico (tentativo ${i + 1}): ${error.message}`);
          this._invalidateCache(`memory_${normalizedThreadId}`);
          if (error.message === 'VERSION_MISMATCH') {
            if (i < MAX_RETRIES - 1) {
              const freshVersion = Number(error.currentVersion);
              if (Number.isFinite(freshVersion)) {
                expectedVersion = freshVersion;
                console.warn(`🔒 Retry OCC atomico thread ${normalizedThreadId} con versione osservata ${expectedVersion}`);
              } else {
                console.warn(`🔒 Retry OCC atomico thread ${normalizedThreadId} senza versione osservata: mantengo expectedVersion per evitare overwrite cieco`);
              }
              this._sleepLockBackoff_(i);
              continue;
            }
            break;
          }
          if (i < MAX_RETRIES - 1) {
            this._sleepLockBackoff_(i);
          }
        } finally {
          if (globalLockAcquired) {
            try { globalLock.releaseLock(); } catch (e) {}
          }
          if (lockAcquired) {
            this._releaseShardedLock(lockKey);
          }
        }
    }
    // Protezione best-effort: non distruggere il batch fallendo.
    // Invece di throw, logghiamo l'errore e ritorniamo false per permettere all'email_processor di finire il job (labeling).
    const failureCause = (lastAtomicError && lastAtomicError.message === 'VERSION_MISMATCH')
      ? 'VERSION_MISMATCH'
      : 'WRITE_ERROR';
    const failureMessage = lastAtomicError ? lastAtomicError.message : 'Loop Timeout dopo 3 retry';
    this._lastUpdateMemoryAtomicFailure = {
      threadId: normalizedThreadId,
      cause: failureCause,
      message: failureMessage,
      at: new Date().toISOString()
    };
    console.error(`❌ CRITICO: updateMemoryAtomic fallito per thread ${threadId} - causa: ${failureCause} (${failureMessage}). Fallback best-effort a batch bypass.`);
    if (failureCause === 'VERSION_MISMATCH') {
      console.error(`🔒 VERSION_MISMATCH persistente dopo ${MAX_RETRIES} retry: possibile contesa alta su thread ${threadId}`);
    }
    return false;
  }

  /**
   * Restituisce l'ultima causa diagnostica di fallimento updateMemoryAtomic.
   */
  getLastUpdateMemoryAtomicFailure() {
    return this._lastUpdateMemoryAtomicFailure || null;
  }

  _normalizeContextualFlags_(value) {
    if (!value) return {};

    let source = value;
    if (typeof source === 'string') {
      const trimmed = source.trim();
      if (!trimmed) return {};
      try {
        source = JSON.parse(trimmed);
      } catch (e) {
        console.warn('⚠️ contextualFlags JSON non parsabile: ignorato');
        return {};
      }
    }

    if (!source || typeof source !== 'object' || Array.isArray(source)) return {};

    const allowed = {
      remote_user: true,
      bereaved: true,
      canonical_complexity: true,
      ongoing_pastoral_process: true
    };
    const normalized = {};

    Object.keys(allowed).forEach((key) => {
      const raw = source[key];
      if (raw === true || String(raw).toLowerCase() === 'true') {
        normalized[key] = true;
      }
    });

    return normalized;
  }

  _mergeContextualFlags_(existing, incoming) {
    const merged = this._normalizeContextualFlags_(existing);
    if (!incoming) return merged;

    let source = incoming;
    if (typeof source === 'string') {
      const trimmed = source.trim();
      if (!trimmed) return merged;
      try {
        source = JSON.parse(trimmed);
      } catch (e) {
        console.warn('⚠️ contextualFlags in ingresso non parsabile: merge saltato');
        return merged;
      }
    }

    if (!source || typeof source !== 'object' || Array.isArray(source)) return merged;

    const allowed = {
      remote_user: true,
      bereaved: true,
      canonical_complexity: true,
      ongoing_pastoral_process: true
    };

    Object.keys(source).forEach((key) => {
      if (!allowed[key]) return;
      const raw = source[key];
      if (raw === false || raw === null || String(raw).toLowerCase() === 'false') {
        delete merged[key];
      } else if (raw === true || String(raw).toLowerCase() === 'true') {
        merged[key] = true;
      }
    });

    return merged;
  }

  _serializeContextualFlagsForSheet(flags) {
    const normalized = this._normalizeContextualFlags_(flags);
    return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : '';
  }

  _parseMemorySummaryState(memorySummary) {
    const raw = memorySummary == null ? '' : String(memorySummary);
    const trimmed = raw.trim();
    if (!trimmed) {
      return {
        recognized: true,
        raw: raw,
        legacySummaryText: '',
        conversationState: null
      };
    }

    if (trimmed.charAt(0) !== '{') {
      return {
        recognized: true,
        raw: raw,
        legacySummaryText: raw,
        conversationState: null
      };
    }

    try {
      const parsed = JSON.parse(trimmed);
      const hasConversationState = !!(parsed && typeof parsed === 'object' && parsed.conversationState && typeof parsed.conversationState === 'object');
      const hasLegacySummaryText = !!(parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'legacySummaryText'));
      if (!hasConversationState && !hasLegacySummaryText) {
        console.warn('⚠️ memorySummary JSON non riconosciuto: conservazione senza merge conversationState');
        return {
          recognized: false,
          raw: raw,
          legacySummaryText: raw,
          conversationState: null
        };
      }
      return {
        recognized: true,
        raw: raw,
        legacySummaryText: parsed.legacySummaryText ? String(parsed.legacySummaryText) : '',
        conversationState: hasConversationState ? parsed.conversationState : null
      };
    } catch (e) {
      console.warn('⚠️ memorySummary JSON non parsabile: conservazione senza merge conversationState');
      return {
        recognized: false,
        raw: raw,
        legacySummaryText: raw,
        conversationState: null
      };
    }
  }

  _serializeMemorySummaryState(existingSummary, incomingLegacySummary, conversationStateUpdate, baseLegacySummary = null) {
    const parsed = this._parseMemorySummaryState(existingSummary);
    if (!parsed.recognized) {
      return parsed.raw;
    }

    const legacySummaryText = this._mergeMemorySummaryText_(
      parsed.legacySummaryText || '',
      incomingLegacySummary,
      baseLegacySummary
    );
    const existingState = parsed.conversationState && typeof parsed.conversationState === 'object'
      ? parsed.conversationState
      : {};
    if (!conversationStateUpdate && !parsed.conversationState) {
      return legacySummaryText;
    }
    const nextState = conversationStateUpdate
      ? this._mergeConversationState(existingState, conversationStateUpdate)
      : existingState;

    return JSON.stringify({
      legacySummaryText: legacySummaryText,
      conversationState: nextState
    });
  }

  _mergeMemorySummaryText_(existingLegacySummary, incomingLegacySummary, baseLegacySummary = null) {
    const existingText = existingLegacySummary == null ? '' : String(existingLegacySummary).trim();
    if (incomingLegacySummary == null) return existingText;

    const incomingText = String(incomingLegacySummary || '').trim();
    const hasBase = baseLegacySummary != null;
    if (!hasBase) return incomingText;

    const baseText = String(baseLegacySummary || '').trim();
    if (this._normalizeMemorySummaryForCompare_(existingText) === this._normalizeMemorySummaryForCompare_(baseText)) {
      return incomingText;
    }

    const deltaText = this._extractMemorySummaryDelta_(incomingText, baseText);
    if (!deltaText) return existingText;

    return this._combineMemorySummaryLines_(existingText, deltaText);
  }

  _extractMemorySummaryDelta_(incomingText, baseText) {
    if (!incomingText) return '';
    if (!baseText) return incomingText;

    if (incomingText.indexOf(baseText) === 0) {
      return incomingText.slice(baseText.length).trim();
    }

    const baseLines = new Set(
      String(baseText || '')
        .split('\n')
        .map(line => this._normalizeMemorySummaryForCompare_(line))
        .filter(Boolean)
    );
    const deltaLines = String(incomingText || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !baseLines.has(this._normalizeMemorySummaryForCompare_(line)));

    return deltaLines.join('\n').trim();
  }

  _combineMemorySummaryLines_(existingText, deltaText) {
    const maxChars = 2000;
    const configuredMaxBullets = (typeof CONFIG !== 'undefined' && Number(CONFIG.MEMORY_MAX_SUMMARY_BULLETS) > 0)
      ? Number(CONFIG.MEMORY_MAX_SUMMARY_BULLETS)
      : 5;
    const maxBullets = Math.max(1, Math.floor(configuredMaxBullets));
    const seen = new Set();
    const mergedLines = [];

    [existingText, deltaText].forEach(block => {
      String(block || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .forEach(line => {
          const key = this._normalizeMemorySummaryForCompare_(line);
          if (!key || seen.has(key)) return;
          seen.add(key);
          mergedLines.push(line);
        });
    });

    let summary = mergedLines.slice(-maxBullets).join('\n').trim();
    if (summary.length > maxChars) {
      const truncated = summary.slice(-maxChars);
      const firstBreak = truncated.indexOf('\n');
      const firstSpace = truncated.indexOf(' ');
      const cutIndex = firstBreak > 0 ? firstBreak : (firstSpace > 0 ? firstSpace : 0);
      summary = '...' + truncated.slice(cutIndex).trim();
    }
    return summary;
  }

  _normalizeMemorySummaryForCompare_(value) {
    return String(value || '')
      .replace(/^•?\s*\[\d{4}-\d{2}-\d{2}\]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  _mergeConversationState(existingState, update) {
    const next = Object.assign({}, existingState || {});
    const normalizedPosture = this._normalizeConversationPosture_(update && update.currentRelationalPosture);
    const normalizedLastPosture = this._normalizeConversationPosture_(update && update.lastRelationalPosture);
    if (normalizedLastPosture) {
      next.lastRelationalPosture = normalizedLastPosture;
    }
    if (normalizedPosture) {
      const previousCurrentPosture = this._normalizeConversationPosture_(next.currentRelationalPosture);
      if (!normalizedLastPosture && previousCurrentPosture) {
        next.lastRelationalPosture = previousCurrentPosture;
      }
      next.currentRelationalPosture = normalizedPosture;
    }

    const confidence = this._normalizeConversationConfidence_(update && update.responseFocusHintConfidence);
    const hint = this._normalizeConversationResponseFocusHint_(update && update.responseFocusHint);
    const normalizedUpdatedAt = this._validateAndNormalizeTimestamp(
      update && update.updatedAt ? update.updatedAt : new Date().toISOString()
    );
    const hasIncomingHintField = !!(update && Object.prototype.hasOwnProperty.call(update, 'responseFocusHint'));

    if (hint && confidence >= 0.65) {
      next.responseFocusHint = hint;
      next.responseFocusHintConfidence = confidence;
      next.appliesToTopic = update && update.appliesToTopic ? String(update.appliesToTopic).trim().substring(0, 120) : null;
      next.responseFocusHintUpdatedAt = normalizedUpdatedAt;
    } else if (hasIncomingHintField) {
      next.responseFocusHint = null;
      next.responseFocusHintConfidence = 0;
      next.appliesToTopic = null;
      next.responseFocusHintUpdatedAt = null;
    } else if (!Object.prototype.hasOwnProperty.call(next, 'responseFocusHint')) {
      next.responseFocusHint = null;
      next.responseFocusHintConfidence = 0;
      next.appliesToTopic = null;
      next.responseFocusHintUpdatedAt = null;
    }

    next.updatedAt = normalizedUpdatedAt;
    const source = update && Object.prototype.hasOwnProperty.call(update, 'source')
      ? String(update.source || '').trim()
      : '';
    next.source = source ? source.substring(0, 80) : 'unknown';

    return {
      lastRelationalPosture: next.lastRelationalPosture || 'direct',
      currentRelationalPosture: next.currentRelationalPosture || next.lastRelationalPosture || 'direct',
      responseFocusHint: next.responseFocusHint || null,
      responseFocusHintConfidence: this._normalizeConversationConfidence_(next.responseFocusHintConfidence),
      appliesToTopic: next.appliesToTopic || null,
      responseFocusHintUpdatedAt: next.responseFocusHintUpdatedAt || null,
      updatedAt: next.updatedAt,
      source: next.source
    };
  }

  _normalizeConversationPosture_(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const allowed = {
      urgent: true,
      hesitant: true,
      complaint: true,
      personal: true,
      open: true,
      direct: true
    };
    return allowed[normalized] ? normalized : null;
  }

  _normalizeConversationResponseFocusHint_(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const allowed = {
      avoid_repeating_known_requirements: true,
      answer_only_residual_question: true,
      provide_next_operational_step: true,
      acknowledge_document_without_reopening_procedure: true
    };
    if (normalized && !allowed[normalized]) {
      console.warn(`⚠️ responseFocusHint non riconosciuto ignorato: ${normalized}`);
    }
    return allowed[normalized] ? normalized : null;
  }

  _normalizeConversationConfidence_(value) {
    const confidence = Number(value);
    return Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0;
  }

  /**
   * Aggiunge topic alla lista info fornite
   * NON incrementa messageCount
   */
  addProvidedInfoTopics(threadId, topics) {
    if (!this._initialized || !threadId || !topics || topics.length === 0) {
      return;
    }

    const lockKey = this._getShardedLockKey(threadId);

    for (let i = 0; i < 3; i++) {
      let lockAcquired = false;
      let globalLockAcquired = false;
      const globalLock = LockService.getScriptLock();

      try {
        lockAcquired = this._tryAcquireShardedLock(lockKey, this._getLockTuning_().shardedAcquireTimeoutMs);
        if (!lockAcquired) {
          if (i < 2) {
            this._sleepLockBackoff_(i);
            continue;
          }
          console.warn(`⚠️ Lock non acquisito dopo 3 tentativi in addProvidedInfoTopics per thread ${threadId}`);
          return;
        }

        // Lock globale (B4)
        globalLock.waitLock(10000);
        globalLockAcquired = true;

        const existingRow = this._findRowByThreadId(threadId);
        if (existingRow) {
          const existingData = this._rowToObject(existingRow.values);
          const existingTopics = this._normalizeProvidedTopics(existingData.providedInfo || []);
          const normalizedTopics = this._normalizeProvidedTopics(topics);
          let mergedTopics = this._mergeProvidedTopics(existingTopics, normalizedTopics);

          const caps = this._getProvidedInfoCaps();
          if (mergedTopics.length > caps.maxTopics) {
            console.log(`🧠 Memoria: Trim providedInfo da ${mergedTopics.length} a ${caps.maxTopics} topic`);
          }
          mergedTopics = this._shrinkProvidedInfoToCaps(mergedTopics, 'addProvidedInfoTopics');

          const currentVersion = existingData.version || 0;
          existingData.providedInfo = mergedTopics;
          existingData.lastUpdated = this._validateAndNormalizeTimestamp(new Date().toISOString());
          existingData.version = currentVersion + 1;

          this._withSheetWriteLock(() => {
            this._updateRow(existingRow.rowIndex, existingData);
          }, true);
          this._invalidateCache(`memory_${threadId}`);
          console.log(`🧠 Memoria: Topic aggiunti atomicamente ${JSON.stringify(topics)}`);
        }
        return;
      } catch (e) {
        console.warn(`⚠️ addProvidedInfoTopics fallito (tentativo ${i + 1}): ${e.message}`);
        this._sleepLockBackoff_(i);
      } finally {
        if (globalLockAcquired) {
          try { globalLock.releaseLock(); } catch (e) {}
        }
        if (lockAcquired) {
          this._releaseShardedLock(lockKey);
        }
      }
    }
  }

  /**
   * Imposta lingua per un thread
   */
  setLanguage(threadId, language) {
    try {
      this.updateMemory(threadId, { language: language }, { incrementMessageCount: false });
    } catch (e) {
      console.error(`❌ setLanguage fallito per thread ${threadId}: ${e.message}`);
      return false;
    }
    return true;
  }

  /**
   * Imposta categoria per un thread
   */
  setCategory(threadId, category) {
    try {
      this.updateMemory(threadId, { category: category }, { incrementMessageCount: false });
    } catch (e) {
      console.error(`❌ setCategory fallito per thread ${threadId}: ${e.message}`);
      return false;
    }
    return true;
  }

  /**
   * Aggiorna la reazione dell'utente a un topic specifico
   * @param {string} threadId 
   * @param {string} topic 
   * @param {string} reaction 'acknowledged' | 'questioned' | 'needs_expansion'
   * @param {object} context (Optional) info extra su scippet/match
   */
  updateReaction(threadId, topic, reaction, context = null) {
    if (!this._initialized || !threadId || !topic) return;

    const normalizedTargetTopic = this._normalizeTopicKey(topic);
    if (!normalizedTargetTopic) return;

    const modified = this._updateProvidedTopicReactionWithoutIncrement(
      threadId,
      normalizedTargetTopic,
      reaction,
      context
    );

    if (modified) {
      console.log(`🧠 Reazione aggiornata per topic '${topic}': ${reaction}`);
    }
  }

  _updateProvidedTopicReactionWithoutIncrement(threadId, normalizedTopic, reaction, context = null) {
    if (!this._initialized || !threadId || !normalizedTopic) return false;

    const normalizedThreadId = String(threadId).trim();
    if (!normalizedThreadId) return false;

    const lockTuning = this._getLockTuning_();
    const maxRetries = Math.max(1, Math.min(10, Math.floor(Number(lockTuning.maxRetries) || 3)));
    const lockKey = this._getShardedLockKey(normalizedThreadId);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let lockAcquired = false;
      let globalLockAcquired = false;
      const globalLock = LockService.getScriptLock();

      try {
        lockAcquired = this._tryAcquireShardedLock(lockKey, lockTuning.shardedAcquireTimeoutMs);
        if (!lockAcquired) {
          console.warn(`🔒 updateReaction: lock sharded non acquisito (tentativo ${attempt + 1})`);
          if (attempt < maxRetries - 1) this._sleepLockBackoff_(attempt);
          continue;
        }

        const sheetTimeout = (typeof CONFIG !== 'undefined' && CONFIG.SHEET_WRITE_LOCK_TIMEOUT_MS) || 10000;
        globalLock.waitLock(sheetTimeout);
        globalLockAcquired = true;

        const existingRow = this._findRowByThreadId(normalizedThreadId);
        if (!existingRow) {
          console.warn(`⚠️ updateReaction: thread ${normalizedThreadId} non trovato, skip`);
          return false;
        }

        const existingData = this._rowToObject(existingRow.values);
        const existingTopics = this._normalizeProvidedTopics(
          Array.isArray(existingData.providedInfo) ? existingData.providedInfo : []
        );
        let modified = false;
        const now = this._validateAndNormalizeTimestamp(new Date().toISOString());
        const updatedTopics = existingTopics.map((info) => {
          const infoTopic = info && info.topic ? this._normalizeTopicKey(info.topic) : '';
          if (infoTopic !== normalizedTopic) {
            return info;
          }
          modified = true;
          return Object.assign({}, info, {
            userReaction: reaction,
            context: context || info.context || null,
            lastInteraction: now
          });
        });

        if (!modified) {
          return false;
        }

        existingData.providedInfo = this._shrinkProvidedInfoToCaps(
          updatedTopics,
          '_updateProvidedTopicReactionWithoutIncrement'
        );
        existingData.lastUpdated = now;
        existingData.version = (existingData.version || 0) + 1;

        this._invalidateCache(`memory_${normalizedThreadId}`);
        this._withSheetWriteLock(() => {
          this._updateRow(existingRow.rowIndex, existingData);
        }, true);
        this._writeThroughMemoryCache_(`memory_${normalizedThreadId}`, existingData);
        return true;
      } catch (e) {
        console.warn(`⚠️ updateReaction fallito (tentativo ${attempt + 1}): ${e.message}`);
        this._invalidateCache(`memory_${normalizedThreadId}`);
        if (attempt < maxRetries - 1) {
          this._sleepLockBackoff_(attempt);
        }
      } finally {
        if (globalLockAcquired) {
          try { globalLock.releaseLock(); } catch (e) {}
        }
        if (lockAcquired) {
          this._releaseShardedLock(lockKey);
        }
      }
    }

    return false;
  }

  // ========================================================================
  // METODI HELPER PRIVATI
  // ========================================================================

  /**
   * Restituisce il numero di colonne da leggere
   */
  _getColumnCount() {
    return 10; // A:threadId ... J:contextualFlags
  }

  /**
   * Trova riga per threadId usando TextFinder
   * Ritorna { rowIndex, values } o null
   */
  _findRowByThreadId(threadId) {
    if (!this._sheet) return null;
    const normalizedThreadId = String(threadId).trim();
    if (!normalizedThreadId) return null;
    // getLastRow() restituisce l'ultima riga effettiva con dati.
    // getMaxRows() includerebbe migliaia di righe vuote, rallentando la ricerca TextFinder.
    const maxRows = this._sheet.getLastRow();

    // Evita errore fuori limite se il foglio contiene solo l'intestazione.
    if (maxRows < 2) return null;

    // Limita il range alla colonna A per la ricerca del Thread ID
    const finder = this._sheet.getRange(2, 1, maxRows - 1, 1).createTextFinder(normalizedThreadId)
      .matchEntireCell(true)      // Corrispondenza esatta
      .matchCase(true)            // Case sensitive
      .matchFormulaText(false);   // Cerca solo nei valori

    const result = finder.findNext();

    if (result) {
      const rowIndex = result.getRow();
      const colIndex = result.getColumn();

      // Verifica sicurezza: l'ID deve essere nella colonna A (indice 1)
      if (colIndex === 1 && rowIndex > 1) {
        // Leggi SOLO la riga trovata (molto efficiente)
        const expectedCols = this._getColumnCount();
        const availableCols = Math.max(1, Math.min(expectedCols, this._sheet.getLastColumn()));
        const rowValues = this._sheet.getRange(rowIndex, 1, 1, availableCols).getValues()[0];

        while (rowValues.length < expectedCols) {
          rowValues.push('');
        }

        // Doppio controllo per sicurezza
        if (String(rowValues[0]).trim() === normalizedThreadId) {
          return {
            rowIndex: rowIndex,
            values: rowValues
          };
        }
      }
    }

    try {
      const idValues = this._sheet.getRange(2, 1, maxRows - 1, 1).getValues();
      for (let i = 0; i < idValues.length; i++) {
        if (String(idValues[i] && idValues[i][0]).trim() !== normalizedThreadId) continue;
        const rowIndex = i + 2;
        const expectedCols = this._getColumnCount();
        const availableCols = Math.max(1, Math.min(expectedCols, this._sheet.getLastColumn()));
        const rowValues = this._sheet.getRange(rowIndex, 1, 1, availableCols).getValues()[0];
        while (rowValues.length < expectedCols) {
          rowValues.push('');
        }
        return {
          rowIndex: rowIndex,
          values: rowValues
        };
      }
    } catch (scanError) {
      console.warn(`⚠️ Fallback lookup memoria fallito per thread ${normalizedThreadId}: ${scanError.message}`);
    }

    return null;
  }

  /**
   * Serializza le scritture su Spreadsheet con ScriptLock globale.
   * Riduce conflitti tra thread diversi durante inserimenti o aggiornamenti della riga.
   * @param {Function} writeOperation callback con la scrittura effettiva
   * @param {boolean} alreadyLocked se true, assume che il lock sia già acquisito
   */
  _withSheetWriteLock(writeOperation, alreadyLocked = false) {
    if (alreadyLocked) {
      try {
        writeOperation();
      } finally {
        SpreadsheetApp.flush();
      }
      return;
    }

    const sheetLock = LockService.getScriptLock();
    const timeoutMs = (typeof CONFIG !== 'undefined' && CONFIG.SHEET_WRITE_LOCK_TIMEOUT_MS) || 10000;
    let lockAcquired = false;

    try {
      sheetLock.waitLock(timeoutMs);
      lockAcquired = true;
      writeOperation();
      SpreadsheetApp.flush();
    } catch (e) {
      if (!lockAcquired) {
        throw new Error(`Lock del foglio non acquisito (timeout ${timeoutMs}ms): ${e.message}`);
      }
      throw e;
    } finally {
      if (lockAcquired) {
        try {
          sheetLock.releaseLock();
        } catch (releaseError) {
          // Lock già rilasciato o non acquisito: ignora
        }
      }
    }
  }

  _getProvidedInfoCaps() {
    const configuredMaxChars = (typeof CONFIG !== 'undefined' && Number(CONFIG.MAX_PROVIDED_INFO_JSON_CHARS) > 0)
      ? Number(CONFIG.MAX_PROVIDED_INFO_JSON_CHARS)
      : 45000;
    const configuredMaxTopics = (typeof CONFIG !== 'undefined' && Number(CONFIG.MAX_PROVIDED_TOPICS) > 0)
      ? Number(CONFIG.MAX_PROVIDED_TOPICS)
      : 50;

    return {
      maxChars: configuredMaxChars,
      maxTopics: configuredMaxTopics
    };
  }

  _truncateProvidedTopicMetadataValue(key, value) {
    if (value === undefined || value === null) return value;

    const limitByKey = {
      excerpt: 500,
      matchedPhrase: 200
    };
    const defaultStringLimit = 1000;

    if (typeof value === 'string') {
      const limit = limitByKey[key] || defaultStringLimit;
      return value.slice(0, limit);
    }
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return this._validateAndNormalizeTimestamp(value.toISOString());
    }
    if (Array.isArray(value)) {
      return value.slice(0, 10).map((item) => this._truncateProvidedTopicMetadataValue(key, item));
    }
    if (typeof value === 'object') {
      const normalized = {};
      Object.keys(value).slice(0, 20).forEach((childKey) => {
        const childValue = this._truncateProvidedTopicMetadataValue(childKey, value[childKey]);
        if (childValue !== undefined) normalized[childKey] = childValue;
      });
      return normalized;
    }

    return String(value).slice(0, defaultStringLimit);
  }

  _normalizeProvidedTopicContext(context) {
    if (!context) return null;
    return this._truncateProvidedTopicMetadataValue('context', context);
  }

  _minimalProvidedInfoTopic(topic) {
    return {
      topic: String(topic && topic.topic ? topic.topic : '').slice(0, 120),
      userReaction: (topic && topic.userReaction) || 'unknown',
      timestamp: (topic && topic.timestamp) || this._validateAndNormalizeTimestamp(new Date().toISOString())
    };
  }

  _shrinkProvidedInfoToCaps(providedInfo, sourceLabel) {
    const caps = this._getProvidedInfoCaps();
    let topics = Array.isArray(providedInfo) ? this._normalizeProvidedTopics(providedInfo) : [];

    if (topics.length > caps.maxTopics) {
      console.warn(`🧠 ${sourceLabel}: providedInfo ha ${topics.length} topic; trim a ${caps.maxTopics}`);
      topics = topics.slice(-caps.maxTopics);
    }

    let serialized = JSON.stringify(topics);

    // Stima lineare: taglio proporzionale per ridurre serializzazioni iterative.
    if (topics.length > 0 && serialized.length > caps.maxChars) {
      const avgBytesPerEntry = Math.ceil(serialized.length / topics.length);
      const targetCount = Math.max(1, Math.floor(caps.maxChars / Math.max(1, avgBytesPerEntry)));
      topics = topics.slice(-targetCount);
      serialized = JSON.stringify(topics);

      while (topics.length > 1 && serialized.length > caps.maxChars) {
        topics.shift();
        serialized = JSON.stringify(topics);
      }
    }

    if (topics.length === 1 && serialized.length > caps.maxChars) {
      topics = [this._minimalProvidedInfoTopic(topics[0])];
      serialized = JSON.stringify(topics);
    }

    if (serialized.length > caps.maxChars) {
      console.warn(`⚠️ ${sourceLabel}: providedInfo eccede ${caps.maxChars} caratteri anche dopo il trim; salvo array vuoto`);
      return [];
    }

    return topics;
  }

  /**
   * Normalizza i topic forniti in formato oggetto.
   */
  _normalizeProvidedTopics(topics) {
    if (!topics) return [];
    if (!Array.isArray(topics)) topics = [topics];

    return topics
      .map(topic => {
        if (typeof topic === 'string') {
          const trimmed = topic.trim();
          if (!trimmed) return null;
          return {
            topic: trimmed,
            userReaction: 'unknown',
            context: null,
            timestamp: this._validateAndNormalizeTimestamp(new Date().toISOString())
          };
        }
        if (topic && typeof topic === 'object' && typeof topic.topic === 'string') {
          const trimmed = topic.topic.trim();
          if (!trimmed) return null;
          const normalized = {
            topic: trimmed,
            userReaction: topic.userReaction || topic.reaction || 'unknown',
            context: topic.context || null,
            timestamp: this._validateAndNormalizeTimestamp(topic.timestamp || new Date().toISOString())
          };
          // Preserva eventuali metadati aggiuntivi (es. lastInteraction), ma
          // limita campi potenzialmente molto grandi per non saturare la cella Sheet.
          normalized.context = this._normalizeProvidedTopicContext(topic.context || null);
          Object.keys(topic).forEach((key) => {
            if (['topic', 'userReaction', 'reaction', 'context', 'timestamp'].includes(key)) return;
            const value = this._truncateProvidedTopicMetadataValue(key, topic[key]);
            if (value !== undefined) normalized[key] = value;
          });
          return normalized;
        }
        return null;
      })
      .filter(Boolean);
  }

  _normalizeTopicKey(topic) {
    if (topic == null) return '';
    return String(topic)
      .toLowerCase()
      .trim()
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/ /g, '_');
  }

  _applyInferredReactionToProvidedInfo(providedInfo, inferredReactionData, now) {
    if (!inferredReactionData || !Array.isArray(providedInfo) || providedInfo.length === 0) {
      return providedInfo;
    }

    const reaction = inferredReactionData.reaction ? String(inferredReactionData.reaction).trim() : '';
    const topics = Array.isArray(inferredReactionData.topics) ? inferredReactionData.topics : [];
    if (!reaction || topics.length === 0) {
      return providedInfo;
    }

    const targetTopics = new Set(
      topics
        .map(topic => this._normalizeTopicKey(topic))
        .filter(Boolean)
    );
    if (targetTopics.size === 0) {
      return providedInfo;
    }

    return providedInfo.map(info => {
      const normalizedInfoTopic = this._normalizeTopicKey(info && info.topic);
      if (!normalizedInfoTopic || !targetTopics.has(normalizedInfoTopic)) {
        return info;
      }

      return Object.assign({}, info, {
        userReaction: reaction,
        context: {
          source: inferredReactionData.source || 'user_reply',
          matchedPhrase: inferredReactionData.matchedPhrase || null,
          excerpt: inferredReactionData.excerpt || null
        },
        lastInteraction: now
      });
    });
  }

  /**
   * Merge topic evitando duplicati per chiave "topic".
   */
  _mergeProvidedTopics(existingTopics, newTopics) {
    const mergedMap = new Map();

    existingTopics.forEach(item => {
      const key = item && item.topic ? this._normalizeTopicKey(item.topic) : '';
      if (key) {
        mergedMap.set(key, item);
      }
    });

    newTopics.forEach(item => {
      const key = item && item.topic ? this._normalizeTopicKey(item.topic) : '';
      if (key) {
        const previous = mergedMap.get(key);
        if (!previous) {
          mergedMap.set(key, item);
          return;
        }

        // Manteniamo la reazione utente pregressa se il nuovo topic arriva senza segnale esplicito.
        // Questo evita di perdere metadati storici durante deduplica per chiave "topic".
        const incomingReaction = item.userReaction || item.reaction;
        const shouldPreserveReaction = !incomingReaction || incomingReaction === 'unknown';

        mergedMap.set(key, {
          ...previous,
          ...item,
          userReaction: shouldPreserveReaction
            ? (previous.userReaction || incomingReaction || 'unknown')
            : incomingReaction
        });
      }
    });

    return Array.from(mergedMap.values());
  }

  /**
   * Aggiorna providedInfo senza incrementare messageCount.
   */
  _updateProvidedInfoWithoutIncrement(threadId, providedInfo) {
    if (!this._initialized || !threadId) return;

    const lockKey = this._getShardedLockKey(threadId);
    const maxRetries = Math.max(1, Math.min(3, this._getLockTuning_().maxRetries || 3));

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      let lockAcquired = false;
      let globalLockAcquired = false;
      let sleepAfterRelease = false;
      const globalLock = LockService.getScriptLock();

      try {
        lockAcquired = this._tryAcquireShardedLock(lockKey, this._getLockTuning_().shardedAcquireTimeoutMs);
        if (!lockAcquired) {
          if (attempt === maxRetries - 1) {
            console.warn(`⚠️ Lock reazione non acquisito dopo ${maxRetries} tentativi per thread ${threadId}`);
            return;
          }
          this._sleepLockBackoff_(attempt);
          continue;
        }

        // Lock globale per scrittura (B4)
        globalLock.waitLock(10000);
        globalLockAcquired = true;

        const existingRow = this._findRowByThreadId(threadId);
        if (!existingRow) {
          console.warn(`⚠️ _updateProvidedInfoWithoutIncrement: thread ${threadId} non trovato, skip creazione riga`);
          return;
        }

        const existingData = this._rowToObject(existingRow.values);
        const existingTopics = this._normalizeProvidedTopics(Array.isArray(existingData.providedInfo) ? existingData.providedInfo : []);
        const normalizedTopics = this._normalizeProvidedTopics(providedInfo);
        let mergedTopics = this._mergeProvidedTopics(existingTopics, normalizedTopics);
        mergedTopics = this._shrinkProvidedInfoToCaps(
          mergedTopics,
          '_updateProvidedInfoWithoutIncrement'
        );

        existingData.providedInfo = mergedTopics;
        existingData.lastUpdated = this._validateAndNormalizeTimestamp(new Date().toISOString());
        existingData.version = (existingData.version || 0) + 1;

        this._withSheetWriteLock(() => {
          this._updateRow(existingRow.rowIndex, existingData);
        }, true);
        this._invalidateCache(`memory_${threadId}`);
        return;
      } catch (error) {
        console.warn(`⚠️ Aggiornamento reazione fallito (tentativo ${attempt + 1}/${maxRetries}): ${error.message}`);
        sleepAfterRelease = attempt < maxRetries - 1;
      } finally {
        if (globalLockAcquired) {
          try { globalLock.releaseLock(); } catch (e) {}
        }
        if (lockAcquired) {
          this._releaseShardedLock(lockKey);
        }
      }
      if (sleepAfterRelease) {
        this._sleepLockBackoff_(attempt);
      }
    }
  }

  // ========================================================================
  // METODI HELPER PRIVATI
  // ========================================================================

  /**
   * Genera chiave lock sharded basata su hash threadId
   */
  _getShardedLockKey(threadId) {
    const bucketCount = this._getLockTuning_().shardBuckets;
    if (bucketCount <= 1) return `mem_lock_${threadId}`;
    const bucket = this._stableHash_(threadId) % bucketCount;
    return `mem_lock_b${bucket}_${threadId}`;
  }

  /**
   * Tenta acquisizione lock sharded (single-key su CacheService, con guard globale breve).
   */
  _tryAcquireShardedLock(key, timeoutMs = 500) {
    const cache = CacheService.getScriptCache();
    const configuredLockTtlSeconds = (typeof CONFIG !== 'undefined' && Number(CONFIG.MEMORY_LOCK_TTL) > 0)
      ? Number(CONFIG.MEMORY_LOCK_TTL)
      : 30;
    const sheetWriteTimeoutMs = (typeof CONFIG !== 'undefined' && Number(CONFIG.SHEET_WRITE_LOCK_TIMEOUT_MS) > 0)
      ? Number(CONFIG.SHEET_WRITE_LOCK_TIMEOUT_MS)
      : 10000;

    try {
      const startedAt = Date.now();
      const requestedBudgetMs = Number(timeoutMs);
      const acquireBudgetMs = Number.isFinite(requestedBudgetMs) && requestedBudgetMs > 0
        ? Math.max(150, requestedBudgetMs)
        : 500;
      if (!Number.isFinite(requestedBudgetMs) || requestedBudgetMs <= 0) {
        console.warn(`⚠️ Timeout lock sharded non valido (${timeoutMs}); uso fallback ${acquireBudgetMs}ms`);
      }
      // TTL >= tempo massimo di acquisizione + attesa lock sheet + margine: evita scadenze durante retry lenti.
      const lockTtlSeconds = Math.max(
        configuredLockTtlSeconds,
        Math.ceil((acquireBudgetMs + sheetWriteTimeoutMs + 5000) / 1000)
      );
      const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const lockTuning = this._getLockTuning_();
      const guardTimeoutMs = Math.max(1, Math.min(1000, lockTuning.globalGuardTimeoutMs || 500));
      const configuredVerifyDelayMs = Number(lockTuning.cacheVerifyDelayMs);
      const cacheVerifyDelayMs = Number.isFinite(configuredVerifyDelayMs) && configuredVerifyDelayMs > 0
        ? Math.min(1000, configuredVerifyDelayMs)
        : 0;

      while ((Date.now() - startedAt) < acquireBudgetMs) {
        const guardLock = LockService.getScriptLock();
        let guardAcquired = false;

        try {
          // CacheService non offre put-if-absent: serializziamo solo il breve check+put.
          guardAcquired = guardLock.tryLock(guardTimeoutMs);
          if (!guardAcquired) {
            if (!this._sleepWithinBudget_(startedAt, acquireBudgetMs, 50 + Math.floor(Math.random() * 80))) break;
            continue;
          }

          if (cache.get(key) == null) {
            cache.put(key, token, lockTtlSeconds);
            if (cacheVerifyDelayMs > 0) {
              Utilities.sleep(cacheVerifyDelayMs);
              if (cache.get(key) !== token) {
                if (!this._sleepWithinBudget_(startedAt, acquireBudgetMs, 50 + Math.floor(Math.random() * 80))) break;
                continue;
              }
            }
            this._heldShardLocks[key] = token;
            return true;
          }
        } finally {
          if (guardAcquired) {
            try {
              guardLock.releaseLock();
            } catch (releaseError) {
              console.warn(`⚠️ Errore rilascio guard lock sharded: ${releaseError.message}`);
            }
          }
        }

        if (!this._sleepWithinBudget_(startedAt, acquireBudgetMs, 50 + Math.floor(Math.random() * 80))) break;
      }

      console.warn(`⚠️ Timeout acquisizione lock sharded key: ${key}`);
      return false;
    } catch (cacheError) {
      console.warn(`⚠️ Errore CacheService durante lock: ${cacheError.message}`);
      return false;
    }
  }

  _getLockTuning_() {
    const cfg = (typeof CONFIG !== 'undefined' && CONFIG) ? CONFIG : {};
    return {
      maxRetries: Number(cfg.MEMORY_LOCK_MAX_RETRIES) > 0 ? Number(cfg.MEMORY_LOCK_MAX_RETRIES) : 3,
      shardedAcquireTimeoutMs: Number(cfg.MEMORY_SHARDED_LOCK_ACQUIRE_TIMEOUT_MS) > 0 ? Number(cfg.MEMORY_SHARDED_LOCK_ACQUIRE_TIMEOUT_MS) : 800,
      globalGuardTimeoutMs: Number(cfg.MEMORY_LOCK_GLOBAL_GUARD_TIMEOUT_MS) > 0 ? Number(cfg.MEMORY_LOCK_GLOBAL_GUARD_TIMEOUT_MS) : 150,
      backoffBaseMs: Number(cfg.MEMORY_LOCK_BACKOFF_BASE_MS) > 0 ? Number(cfg.MEMORY_LOCK_BACKOFF_BASE_MS) : 200,
      backoffCapMs: Number(cfg.MEMORY_LOCK_BACKOFF_CAP_MS) > 0 ? Number(cfg.MEMORY_LOCK_BACKOFF_CAP_MS) : 1500,
      backoffJitterMs: Number(cfg.MEMORY_LOCK_BACKOFF_JITTER_MS) >= 0 ? Number(cfg.MEMORY_LOCK_BACKOFF_JITTER_MS) : 0,
      cacheVerifyDelayMs: Number(cfg.MEMORY_LOCK_CACHE_VERIFY_DELAY_MS) > 0 ? Number(cfg.MEMORY_LOCK_CACHE_VERIFY_DELAY_MS) : 0,
      shardBuckets: Number(cfg.MEMORY_LOCK_SHARD_BUCKETS) > 1 ? Number(cfg.MEMORY_LOCK_SHARD_BUCKETS) : 1
    };
  }

  _sleepLockBackoff_(attempt) {
    const lockCfg = this._getLockTuning_();
    const exp = Math.min(6, Math.max(0, attempt));
    const baseDelay = Math.min(lockCfg.backoffCapMs, lockCfg.backoffBaseMs * Math.pow(2, exp));
    const jitterBudget = lockCfg.backoffJitterMs;
    const jitter = jitterBudget > 0 ? Math.floor(Math.random() * jitterBudget) : 0;
    Utilities.sleep(baseDelay + jitter);
  }

  _sleepWithinBudget_(startedAt, budgetMs, desiredMs) {
    const remainingMs = Math.floor(Number(budgetMs) - (Date.now() - Number(startedAt)));
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return false;
    const sleepMs = Math.max(1, Math.min(Math.floor(Number(desiredMs) || 1), remainingMs));
    Utilities.sleep(sleepMs);
    return (Date.now() - Number(startedAt)) < Number(budgetMs);
  }

  _stableHash_(value) {
    const input = String(value || '');
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  /**
   * Rilascia lock sharded
   */
  _releaseShardedLock(key) {
    try {
      const cache = CacheService.getScriptCache();
      const token = this._heldShardLocks ? this._heldShardLocks[key] : null;
      if (!token) return;

      const guardTimeoutMs = Math.max(1, Math.min(1000, this._getLockTuning_().globalGuardTimeoutMs || 500));
      const guardLock = LockService.getScriptLock();
      let guardAcquired = false;
      try {
        guardAcquired = guardLock.tryLock(guardTimeoutMs);
        if (!guardAcquired) {
          console.warn(`⚠️ Timeout guard lock durante rilascio lock sharded '${key}': rilascio demandato al TTL cache`);
          return;
        }

        if (cache.get(key) === token) {
          cache.remove(key);
        }
        if (this._heldShardLocks) delete this._heldShardLocks[key];
      } finally {
        if (guardAcquired) {
          try {
            guardLock.releaseLock();
          } catch (releaseError) {
            console.warn(`⚠️ Errore rilascio guard lock sharded: ${releaseError.message}`);
          }
        }
      }
    } catch (e) {
      console.warn(`⚠️ Errore rilascio lock sharded '${key}': ${e.message}`);
    }
  }

  /**
   * Valida e normalizza timestamp ISO
   * @param {string} timestamp
   * @returns {string} timestamp valido
   */
  _validateAndNormalizeTimestamp(timestamp) {
    const fallback = new Date().toISOString();
    if (!timestamp) {
      return fallback;
    }

    if (timestamp instanceof Date) {
      if (!isNaN(timestamp.getTime())) {
        return timestamp.toISOString();
      }
      console.warn('⚠️ Timestamp Date non valido, reset');
      return fallback;
    }

    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      const numericDate = new Date(timestamp);
      if (!isNaN(numericDate.getTime())) {
        return numericDate.toISOString();
      }
      console.warn('⚠️ Timestamp numerico non valido, reset');
      return fallback;
    }

    if (typeof timestamp !== 'string') {
      console.warn(`⚠️ Timestamp non-string: ${typeof timestamp}, reset`);
      return fallback;
    }

    const parsed = new Date(timestamp);
    if (isNaN(parsed.getTime())) {
      console.warn(`⚠️ Timestamp parsing failed: "${timestamp}", reset`);
      return fallback;
    }

    const now = Date.now();
    const minAllowed = new Date('2020-01-01T00:00:00Z').getTime();
    // Intervallo di validità futuro: consenti fino a 24h per compensare drift/fusi orari
    const maxAllowed = now + (24 * 60 * 60 * 1000);

    if (parsed.getTime() < minAllowed || parsed.getTime() > maxAllowed) {
      console.warn(`⚠️ Timestamp fuori range: ${timestamp}, reset`);
      return fallback;
    }

    // Canonicalizza sempre in ISO-8601 UTC per evitare formati locali non stabili
    // (es. "2/25/2026, 17:00:00") che possono degradare confronti/sort cronologici.
    return parsed.toISOString();
  }

  /**
   * Restituisce il numero di colonne da leggere
   */
  _rowToObject(row) {
    const values = Array.isArray(row) ? row : row.values || row;
    let providedInfo = [];

    try {
      if (values[4]) {
        const raw = JSON.parse(values[4]);
        // Normalizzazione dati: converte stringhe semplici in oggetti strutturati
        providedInfo = Array.isArray(raw) ? raw.map(item => {
          if (typeof item === 'string') return { topic: item, userReaction: 'unknown', context: null, timestamp: new Date().toISOString() };
          // Standardizzazione: allinea la nomenclatura senza mutare l'input originale
          const normalized = Object.assign({}, item);
          if (normalized.reaction && !normalized.userReaction) {
            normalized.userReaction = normalized.reaction;
            delete normalized.reaction;
          }
          return normalized;
        }) : [];
      }
    } catch (e) {
      console.warn(`⚠️ providedInfo JSON non valido per thread ${values[0] || '(sconosciuto)'}: ignoro la cella per sicurezza`);
      providedInfo = [];
    }

    const lastUpdated = this._validateAndNormalizeTimestamp(values[5]);

    const rawMemorySummary = values[8] || '';
    const parsedMemorySummary = this._parseMemorySummaryState(rawMemorySummary);
    const contextualFlags = this._normalizeContextualFlags_(values[9]);

    return {
      exists: true,
      threadId: values[0],
      language: values[1] || 'it',
      category: values[2] || null,
      tone: values[3] || 'standard',
      providedInfo: providedInfo,
      lastUpdated: lastUpdated,
      messageCount: parseInt(values[6], 10) || 0,
      version: parseInt(values[7], 10) || 0,
      memorySummary: parsedMemorySummary.recognized ? (parsedMemorySummary.legacySummaryText || '') : rawMemorySummary,
      conversationState: parsedMemorySummary.recognized ? parsedMemorySummary.conversationState : null,
      contextualFlags: contextualFlags,
      _rawMemorySummary: rawMemorySummary
    };
  }

  /**
   * Aggiorna riga esistente
   */
  _updateRow(rowIndex, data) {
    const providedInfoJson = this._serializeProvidedInfoForSheet(data.providedInfo || []);
    const contextualFlagsJson = this._serializeContextualFlagsForSheet(data.contextualFlags || {});

    this._sheet.getRange(rowIndex, 1, 1, 10).setValues([[
      data.threadId,
      data.language || 'it',
      data.category || '',
      data.tone || 'standard',
      providedInfoJson,
      data.lastUpdated,
      data.messageCount !== undefined ? data.messageCount : 1,
      data.version !== undefined ? data.version : 1,
      data.memorySummary || '',
      contextualFlagsJson
    ]]);
  }

  /**
   * Aggiunge nuova riga
   */
  _appendRow(data) {
    const providedInfoJson = this._serializeProvidedInfoForSheet(data.providedInfo || []);
    const contextualFlagsJson = this._serializeContextualFlagsForSheet(data.contextualFlags || {});

    this._sheet.appendRow([
      data.threadId,
      data.language || 'it',
      data.category || '',
      data.tone || 'standard',
      providedInfoJson,
      data.lastUpdated,
      data.messageCount !== undefined ? data.messageCount : 1,
      data.version !== undefined ? data.version : 1,
      data.memorySummary || '',
      contextualFlagsJson
    ]);
  }

  _serializeProvidedInfoForSheet(providedInfo) {
    const topics = this._shrinkProvidedInfoToCaps(
      Array.isArray(providedInfo) ? providedInfo.slice() : [],
      '_serializeProvidedInfoForSheet'
    );
    return JSON.stringify(topics);
  }

  // ========================================================================
  // METODI CACHE
  // ========================================================================

  _getFromCache(key) {
    const cached = this._cache[key];
    if (cached && (Date.now() - cached.timestamp) < this._cacheExpiry) {
      return this._cloneMemoryCacheValue_(cached.data);
    }

    // Fast-path persistente cross-execution (CacheService)
    try {
      const cache = CacheService.getScriptCache();
      const serialized = cache.get(key);
      if (serialized) {
        let parsed;
        if (serialized.startsWith('{"_isChunked":true')) {
          const meta = JSON.parse(serialized);
          let fullString = '';
          for (let i = 0; i < meta.chunks; i++) {
            const chunk = cache.get(`${key}_chunk_${i}`);
            if (!chunk) throw new Error('Chunk mancante');
            fullString += chunk;
          }
          parsed = JSON.parse(fullString);
        } else {
          parsed = JSON.parse(serialized);
        }
        this._setLocalCache(key, parsed);
        return this._cloneMemoryCacheValue_(parsed);
      }
    } catch (e) {
      // best effort, oppure chunk parziale/scaduto
    }

    return null;
  }

  _setCache(key, data) {
    // Implementazione Garbage Collection periodica della cache in-memory
    this._opCount++;
    if (this._opCount >= 100) {
      this._gcCache();
      this._opCount = 0;
    }

    this._setLocalCache(key, data);

    // CacheService per riuso tra esecuzioni del trigger
    try {
      const cache = CacheService.getScriptCache();
      const serialized = JSON.stringify(data);
      const ttl = Math.floor(this._cacheExpiry / 1000);
      // CacheService accetta valori fino a circa 100KB. String.length conta code unit UTF-16,
      // quindi teniamo i chunk a ~90KB nominali per restare sotto il limite reale.
      const MAX_CHUNK_SIZE = 45000;

      if (serialized.length > MAX_CHUNK_SIZE) {
        const chunks = Math.ceil(serialized.length / MAX_CHUNK_SIZE);
        const meta = { _isChunked: true, chunks: chunks };
        const payload = {};
        payload[key] = JSON.stringify(meta);
        for (let i = 0; i < chunks; i++) {
          payload[`${key}_chunk_${i}`] = serialized.substring(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE);
        }
        cache.putAll(payload, ttl);
      } else {
        cache.put(key, serialized, ttl);
      }
    } catch (e) {
      // best effort
    }
  }

  _setLocalCache(key, data) {
    const now = Date.now();
    const keys = Object.keys(this._cache);

    if (keys.length >= this._maxCacheSize && !this._cache[key]) {
      // Eviction FIFO temporale: rimuove la entry più vecchia in RAM.
      // È una scelta intenzionale perché in GAS la memoria disponibile è limitata.
      let oldestKey = null;
      let oldestTimestamp = Infinity;

      keys.forEach(existingKey => {
        const ts = this._cache[existingKey] && this._cache[existingKey].timestamp;
        if (Number.isFinite(ts) && ts < oldestTimestamp) {
          oldestTimestamp = ts;
          oldestKey = existingKey;
        }
      });

      if (oldestKey) {
        delete this._cache[oldestKey];
      }
    }

    this._cache[key] = {
      data: this._cloneMemoryCacheValue_(data),
      timestamp: now
    };
  }

  _cloneMemoryCacheValue_(value) {
    if (value == null || typeof value !== 'object') return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (e) {
      if (Array.isArray(value)) return value.slice();
      return Object.assign({}, value);
    }
  }

  _writeThroughMemoryCache_(key, data) {
    if (!key || !data || typeof this._setCache !== 'function') return;
    try {
      if (!this._cache || typeof this._cache !== 'object') this._cache = {};
      if (!Number.isFinite(this._opCount)) this._opCount = 0;
      if (!Number.isFinite(this._cacheExpiry) || this._cacheExpiry <= 0) this._cacheExpiry = 5 * 60 * 1000;
      if (!Number.isFinite(this._maxCacheSize) || this._maxCacheSize <= 0) this._maxCacheSize = 200;

      const cacheData = Object.assign({}, data);
      if (!Array.isArray(cacheData.providedInfo)) cacheData.providedInfo = [];
      if (!cacheData.contextualFlags || typeof cacheData.contextualFlags !== 'object') cacheData.contextualFlags = {};
      this._setCache(key, cacheData);
    } catch (e) {
      console.warn(`⚠️ Write-through cache memoria fallita: ${e.message}`);
    }
  }

  /**
   * Pulisce la cache dagli elementi scaduti
   */
  _gcCache() {
    const now = Date.now();
    let deletedCount = 0;

    for (const key in this._cache) {
      if (!Object.prototype.hasOwnProperty.call(this._cache, key)) {
        continue;
      }

      // Rimuove entry nulle o scadute dalla cache
      if (!this._cache[key] || !this._cache[key].timestamp) {
        delete this._cache[key];
        deletedCount++;
        continue;
      }
      if (now - this._cache[key].timestamp > this._cacheExpiry) {
        delete this._cache[key];
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      console.log(`🧹 Cache GC: rimossi ${deletedCount} elementi scaduti`);
    }
  }

  _invalidateCache(key) {
    delete this._cache[key];

    try {
      const cache = CacheService.getScriptCache();
      const serialized = cache.get(key);
      if (serialized && serialized.startsWith('{"_isChunked":true')) {
        try {
          const meta = JSON.parse(serialized);
          const keysToRemove = [key];
          for (let i = 0; i < meta.chunks; i++) {
            keysToRemove.push(`${key}_chunk_${i}`);
          }
          cache.removeAll(keysToRemove);
          return;
        } catch (e) { }
      }
      cache.remove(key);
    } catch (e) {
      // best effort
    }
  }

  /**
   * Svuota tutta la cache
   */
  clearCache() {
    const keys = Object.keys(this._cache);
    this._cache = {};
    try {
      const cache = CacheService.getScriptCache();
      if (keys.length > 0) {
        cache.removeAll(keys);
      }
      // Nota: CacheService non espone listKeys, quindi possiamo pulire solo chiavi note/tracciate.
    } catch (e) {
      // best effort
    }
    console.log('🗑️ Cache memoria svuotata');
  }

  // ========================================================================
  // METODI UTILITÀ
  // ========================================================================

  /**
   * Pulisce voci vecchie (più vecchie di N giorni)
   */
  cleanOldEntries(daysOld = 30) {
    if (!this._initialized) return 0;

    let deletedCount = 0;

    this._withSheetWriteLock(() => {
      try {
        const range = this._sheet.getDataRange();
        const data = range.getValues();
        if (data.length <= 1) return;

        const headers = data[0];
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        const validRows = [headers];

        for (let i = 1; i < data.length; i++) {
          const rawLastUpdated = data[i][5];
          if (!rawLastUpdated) {
            console.warn(`⚠️ Riga memoria senza lastUpdated: preservo riga ${i + 1}`);
            validRows.push(data[i]);
            continue;
          }

          const parsedLastUpdated = new Date(rawLastUpdated);
          if (isNaN(parsedLastUpdated.getTime())) {
            console.warn(`⚠️ Riga memoria con lastUpdated non valido: preservo riga ${i + 1} (${rawLastUpdated})`);
            validRows.push(data[i]);
            continue;
          }

          if (parsedLastUpdated >= cutoffDate) {
            validRows.push(data[i]);
          } else {
            deletedCount++;
          }
        }

        if (deletedCount > 0) {
          const originalLastRow = this._sheet.getLastRow();
          this._sheet.getRange(1, 1, validRows.length, headers.length).setValues(validRows);
          const staleRows = originalLastRow - validRows.length;
          const staleStartRow = validRows.length + 1;
          if (staleRows > 0 && staleStartRow + staleRows - 1 <= originalLastRow) {
            // Non eliminiamo fisicamente righe del foglio: con righe vuote intermedie,
            // formattazioni o formule fuori tabella è più sicuro svuotare l'area stale.
            this._sheet.getRange(staleStartRow, 1, staleRows, headers.length).clearContent();
          }
        }

        console.log(`🧹 Pulite ${deletedCount} voci memoria vecchie (Bulk Update)`);
      } catch (error) {
        console.error(`❌ Errore pulizia voci vecchie: ${error.message}`);
      }
    });

    return deletedCount;
  }

  /**
   * Alias retrocompatibile usato in alcuni runbook legacy.
   * @returns {{removed:number, remaining:number}}
   */
  cleanupOldEntries(daysOld = 30) {
    const removed = this.cleanOldEntries(daysOld);
    const remaining = (this._initialized && this._sheet) ? Math.max(0, this._sheet.getLastRow() - 1) : 0;
    return { removed, remaining };
  }

  /**
   * Ottieni statistiche sull'uso della memoria
   */
  getStats() {
    if (!this._initialized) {
      return { initialized: false };
    }

    const baseStats = {
      initialized: true,
      sheetName: this.sheetName,
      cacheSize: Object.keys(this._cache || {}).length
    };

    if (!this._sheet) {
      return {
        ...baseStats,
        totalEntries: 0,
        warning: 'Sheet memoria non inizializzato'
      };
    }

    const readLock = (typeof LockService !== 'undefined' && LockService.getScriptLock)
      ? LockService.getScriptLock()
      : null;
    let lockAcquired = false;

    try {
      if (readLock) {
        const timeoutMs = (typeof CONFIG !== 'undefined' && CONFIG.SHEET_WRITE_LOCK_TIMEOUT_MS) || 10000;
        readLock.waitLock(timeoutMs);
        lockAcquired = true;
      }

      const data = this._sheet.getDataRange().getValues();
      return {
        ...baseStats,
        totalEntries: Math.max(0, data.length - 1)
      };
    } catch (error) {
      console.warn(`⚠️ getStats memoria non disponibile: ${error.message}`);
      return {
        ...baseStats,
        totalEntries: 0,
        error: error.message
      };
    } finally {
      if (lockAcquired) {
        try { readLock.releaseLock(); } catch (e) {}
      }
    }
  }

  /**
   * Verifica se il servizio è sano
   */
  isHealthy() {
    return this._initialized;
  }

  // ========================================================================
  // EVOLUZIONE 2: VALUTAZIONE COMPLETEZZA (Metodi Sperimentali)
  // ========================================================================

  /**
   * (Rimossa definizione sperimentale di lock per evitare conflitti e lock scorretti)
   */

  /**
   * Calcola quanto della domanda originale è stato coperto
   * (Funzionalità avanzata per future implementazioni di auto-valutazione)
   */
  _calculateCompleteness(userQuestion, botResponse) {
    const question = String(userQuestion || '');
    const response = String(botResponse || '');

    // Estrai richieste informative
    const requests = [];
    if (/\b(quando|when|what time)\b/i.test(question)) requests.push('timing');
    if (/\b(dove|where)\b/i.test(question)) requests.push('location');
    if (/\b(come|how)\b/i.test(question)) requests.push('procedure');
    if (/\b(quanto|costo|prezzo|how much|cost|price|fee)\b/i.test(question)) requests.push('cost');
    if (/\b(documenti?|documents?|certificat[oi]?|certificates?)\b/i.test(question)) requests.push('documents');

    if (requests.length === 0) return 1.0; // Nessuna richiesta esplicita rilevabile

    // Verifica copertura (euristica semplice)
    let covered = 0;
    const respLower = response.toLowerCase();

    requests.forEach(req => {
      let hit = false;
      if (req === 'timing' && /\d{1,2}[:.]\d{2}|\b\d{1,2}\s*(am|pm)\b|mattina|pomeriggio|sera|ore|morning|afternoon|evening|hours?|schedule|appointment/i.test(respLower)) hit = true;
      if (req === 'location' && /via|piazza|chiesa|ufficio|sacrestia|address|street|church|office|sacristy/i.test(respLower)) hit = true;
      if (req === 'procedure' && /iscri|porta|invia|compila|send|submit|fill|bring|complete|register|apply/i.test(respLower)) hit = true;
      if (req === 'cost' && /euro|€|gratuit|offert|free|donation|fee|price|cost/i.test(respLower)) hit = true;
      if (req === 'documents' && /document|certificat|nulla osta/i.test(respLower)) hit = true;

      if (hit) covered++;
    });

    return covered / requests.length;
  }
}


// Funzione factory
function createMemoryService() {
  return new MemoryService();
}

// ====================================================================
// FUNZIONE TRIGGER PULIZIA
// ====================================================================

function cleanupOldMemory() {
  const memoryService = new MemoryService();
  const deleted = memoryService.cleanOldEntries(30);
  console.log(`Pulizia memoria completata: ${deleted} voci rimosse`);
}

/**
 * @deprecated Usa setupWeeklyCleanupTrigger() in gas_main.js.
 * Questa funzione è mantenuta per retrocompatibilità ma NON deve essere
 * richiamata insieme a setupWeeklyCleanupTrigger() per evitare trigger duplicati.
 * Configura trigger settimanale per pulizia automatica memoria.
 */
function setupWeeklyMemoryCleanupTrigger() {
  console.warn('⚠️ [DEPRECATED] setupWeeklyMemoryCleanupTrigger(): usa setupWeeklyCleanupTrigger() in gas_main.js. Funzione legacy no-op.');
  console.log('ℹ️ setupWeeklyMemoryCleanupTrigger deprecata: non crea né rimuove trigger. Usa setupWeeklyCleanupTrigger() in gas_main.js.');
}

/**
 * Alias per compatibilità: alcuni trigger storici puntano a weeklyMemoryCleanup.
 * Wrapper mantenuto per retrocompatibilità con chiamate legacy.
 */
function weeklyMemoryCleanup() {
  return cleanupOldMemory();
}
