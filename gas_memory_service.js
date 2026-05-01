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
        this._sheet.getRange('A1:I1').setValues([[
          'threadId', 'language', 'category', 'tone',
          'providedInfo', 'lastUpdated', 'messageCount', 'version', 'memorySummary'
        ]]);
        this._sheet.getRange('A1:I1').setFontWeight('bold');
        this._sheet.setFrozenRows(1);
        console.log(`✓ Creato nuovo foglio: ${this.sheetName}`);
      } else {
        this._ensureMemorySummaryColumn();
      }

      this._initialized = true;
      console.log(`✓ MemoryService inizializzato (Foglio: ${this.sheetName})`);

    } catch (error) {
      console.error(`❌ Inizializzazione MemoryService fallita: ${error.message}`);
      this._initialized = false;
    }
  }

  /**
   * Verifica ed eventualmente aggiunge la colonna 'memorySummary'
   * Garantisce la presenza di tutte le colonne nella struttura del foglio.
   */
  _ensureMemorySummaryColumn() {
    try {
      const maxCols = this._sheet.getMaxColumns();
      if (maxCols < 9) {
        this._sheet.insertColumnsAfter(maxCols, 9 - maxCols);
      }

      const headers = this._sheet.getRange('A1:I1').getValues()[0];
      if (headers.length < 8 || !headers[7]) {
        console.log('🔄 Aggiunta colonna mancante: version');
        const versionCell = this._sheet.getRange('H1');
        versionCell.setValue('version');
        versionCell.setFontWeight('bold');
      }

      // La colonna I è la nona colonna (indice 8)
      if (headers[8] !== 'memorySummary') {
        console.log('🔄 Aggiunta colonna mancante: memorySummary');
        const cell = this._sheet.getRange('I1');
        cell.setValue('memorySummary');
        cell.setFontWeight('bold');
      }
    } catch (e) {
      console.warn('⚠️ Errore verifica colonna memorySummary:', e.message);
    }
  }

  /**
   * Ottiene memoria per un thread
   */
  getMemory(threadId) {
    if (!this._initialized || !threadId) {
      return { providedInfo: [] };
    }

    // Verifica cache
    const cacheKey = `memory_${threadId}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) {
      console.log(`🧠 Memory hit (cache) per thread ${threadId}`);
      return cached;
    }

    try {
      // Trova riga per threadId
      const row = this._findRowByThreadId(threadId);

      if (row) {
        const data = this._rowToObject(row.values);
        if (!Array.isArray(data.providedInfo)) {
          data.providedInfo = [];
        }
        console.log(`🧠 Memory hit per thread ${threadId} (Lingua: ${data.language})`);

        // Memorizza in cache
        this._setCache(cacheKey, data);
        return data;
      } else {
        console.log(`🧠 Memory miss per thread ${threadId} (Nuova conversazione)`);
        return { providedInfo: [] };
      }

    } catch (error) {
      console.error(`❌ Errore recupero memoria: ${error.message}`);
      return { providedInfo: [] };
    }
  }

  /**
   * Legge la memoria con doppio livello: Cache veloce → Sheets come fallback.
   * Riduce la dipendenza dalla latenza di Sheets e previene la perdita di contesto.
   */
  getMemoryRobust(threadId) {
    // getMemory implementa già il multi-livello (RAM locale + CacheService).
    // Duplicare qui la cache con prefisso alternativo introdurrebbe stato incoerente.
    return this.getMemory(threadId);
  }

  /**
   * Aggiorna memoria per un thread (merge con esistente)
   * Usa lock granulare + retry + optimistic locking
   */
  updateMemory(threadId, newData, options = {}) {
    if (!this._initialized || !threadId || !newData || typeof newData !== 'object') {
      return;
    }

    // Filtra campi interni
    const dataToUpdate = {};
    for (const key in newData) {
      if (!key.startsWith('_')) {
        dataToUpdate[key] = newData[key];
      }
    }

    const MAX_RETRIES = this._getLockTuning_().maxRetries;
    // Sharding basato su hash del threadId per ridurre la contention
    const lockKey = this._getShardedLockKey(threadId);

    // Stato locale OCC: aggiorniamo la expectedVersion ad ogni conflitto
    // per evitare retry inutili con versione ormai obsoleta.
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
        const existingRow = this._findRowByThreadId(threadId);
        const now = this._validateAndNormalizeTimestamp(new Date().toISOString());

        if (existingRow) {
          const existingData = this._rowToObject(existingRow.values);
          const currentVersion = existingData.version || 0;

          // Verifica controllo concorrenza ottimistico
          if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
            this._invalidateCache(`memory_${threadId}`);
            console.warn(`🔒 Version mismatch thread ${threadId}: atteso ${expectedVersion}, ottenuto ${currentVersion}`);
            expectedVersion = currentVersion;
            throw new Error('VERSION_MISMATCH');
          }

          // Merge: esistente + nuovi dati
          const mergedData = Object.assign({}, existingData, dataToUpdate);
          mergedData.lastUpdated = now;
          const shouldIncrementMessageCount = options.incrementMessageCount !== false;
          mergedData.messageCount = shouldIncrementMessageCount
            ? (existingData.messageCount || 0) + 1
            : (existingData.messageCount || 0);
          mergedData.version = currentVersion + 1;

          // Cap preventivo lunghezza JSON providedInfo (B5)
          if (mergedData.providedInfo && Array.isArray(mergedData.providedInfo)) {
            const serialized = JSON.stringify(mergedData.providedInfo);
            if (serialized.length > 40000) {
              console.warn(`🧠 Memoria: providedInfo troppo grande (${serialized.length} chars), riduco ulteriormente`);
              mergedData.providedInfo = mergedData.providedInfo.slice(-25);
            }
          }

          this._withSheetWriteLock(() => {
            this._updateRow(existingRow.rowIndex, mergedData);
          }, true);
          console.log(`🧠 Memoria aggiornata per thread ${threadId} (v${mergedData.version}, Tentativo ${attempt + 1})`);
        } else {
          // Nuova riga
          const insertData = Object.assign({}, dataToUpdate);
          insertData.threadId = threadId;
          insertData.lastUpdated = now;
          insertData.messageCount = options.incrementMessageCount === false ? 0 : 1;
          insertData.version = 1;

          this._withSheetWriteLock(() => {
            this._appendRow(insertData);
          }, true);
          console.log(`🧠 Memoria creata per thread ${threadId} (v1)`);
        }

        // Invalida cache locale
        this._invalidateCache(`memory_${threadId}`);
        return; // Successo

      } catch (error) {
        if (error.message === 'VERSION_MISMATCH') {
          console.warn(`⚠️ Conflitto concorrenza, retry... (Tentativo ${attempt + 1})`);
          this._invalidateCache(`memory_${threadId}`);
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
      return;
    }

    // Invalidazione preventiva cache prima della lettura di allineamento
    console.log(`🧹 Invalidazione preventiva cache per thread ${threadId} pre-lettura di allineamento`);
    this._invalidateCache(`memory_${threadId}`);

    // Scelta intenzionale: qui NON usiamo updateMemoryAtomic.
    // Motivo: updateMemoryRobust persiste solo campi memoria (senza topic),
    // e updateMemory garantisce già lock + retry + coerenza cache con costo minore.
    // Se servono topic o coerenza multi-entità, usare updateMemoryAtomic nei callsite dedicati.
    // Se fallisce anche dopo i retry, qui non rilanciamo: la memoria è best-effort.
    try {
      this.updateMemory(threadId, data);
    } catch (e) {
      console.error(`❌ updateMemoryRobust: persistenza memoria fallita per thread ${threadId}: ${e.message}`);
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
  updateMemoryAtomic(threadId, newData, providedTopics = null) {
    if (!this._initialized || !threadId) {
      return false;
    }
    const rawData = (newData && typeof newData === 'object') ? newData : {};

    // Filtra campi interni (_*) per evitare persistenza accidentale su Sheets
    const dataToUpdate = {};
    for (const key in rawData) {
      if (!key.startsWith('_')) {
        dataToUpdate[key] = rawData[key];
      }
    }

    // Accetta anche solo topic (se newData è nullo o vuoto ma providedTopics è presente)
    const hasData = Object.keys(dataToUpdate).length > 0;
    const hasTopics = !!(providedTopics && (
      (Array.isArray(providedTopics) && providedTopics.length > 0) ||
      (typeof providedTopics === 'string' && providedTopics.length > 0)
    ));

    if (!hasData && !hasTopics) {
      console.warn(`⚠️ updateMemoryAtomic chiamato senza dati né topic validi per thread ${threadId}`);
      return false;
    }

    const lockKey = this._getShardedLockKey(threadId);

    // Prova max 3 volte
    let expectedVersion = rawData._expectedVersion;

    for (let i = 0; i < 3; i++) {
        const globalLock = LockService.getScriptLock();
        let globalLockAcquired = false;
        let lockAcquired = false;

        try {
          // 1. Acquisisci Lock Sharded (CacheService)
          lockAcquired = this._tryAcquireShardedLock(lockKey, this._getLockTuning_().shardedAcquireTimeoutMs);
          if (!lockAcquired) {
            if (i === 2) {
              console.warn(`⚠️ Lock non acquisito dopo 3 tentativi, annullo aggiornamento atomico per thread ${threadId}`);
              return false;
            }
            if (i < 2) {
              this._sleepLockBackoff_(i);
            }
            continue;
          }

          // 1.5 Acquisisci Lock Globale per scrittura (B4)
          const sheetTimeout = (typeof CONFIG !== 'undefined' && CONFIG.SHEET_WRITE_LOCK_TIMEOUT_MS) || 10000;
          globalLock.waitLock(sheetTimeout);
          globalLockAcquired = true;

        // --- SEZIONE CRITICA ---
        const existingRow = this._findRowByThreadId(threadId);
        const now = this._validateAndNormalizeTimestamp(new Date().toISOString());

        if (existingRow) {
          const existingData = this._rowToObject(existingRow.values);
          const currentVersion = existingData.version || 0;

          // Controllo concorrenza ottimistico opzionale
          if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
            console.warn(`🔒 Version mismatch atomico thread ${threadId}: atteso ${expectedVersion}, ottenuto ${currentVersion}`);
            expectedVersion = currentVersion;
            throw new Error('VERSION_MISMATCH');
          }

          const mergedData = Object.assign({}, existingData, dataToUpdate);
          mergedData.lastUpdated = now;
          mergedData.messageCount = (existingData.messageCount || 0) + 1;
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

            // Cap preventivo lunghezza JSON providedInfo (B5)
            if (mergedData.providedInfo && Array.isArray(mergedData.providedInfo)) {
              const serialized = JSON.stringify(mergedData.providedInfo);
              if (serialized.length > 40000) {
                console.warn(`🧠 Memoria: providedInfo troppo grande (${serialized.length} chars), riduco ulteriormente`);
                mergedData.providedInfo = mergedData.providedInfo.slice(-25);
              }
            }

            this._withSheetWriteLock(() => {
              this._updateRow(existingRow.rowIndex, mergedData);
            }, true);
            console.log(`🧠 Memoria aggiornata atomicamente per thread ${threadId} (v${mergedData.version})`);
        } else {
          const insertData = Object.assign({}, dataToUpdate);
          insertData.threadId = threadId;
          insertData.lastUpdated = now;
          insertData.messageCount = 1;
          insertData.version = 1;

          if (providedTopics && providedTopics.length > 0) {
            insertData.providedInfo = this._normalizeProvidedTopics(providedTopics);
          }

          this._withSheetWriteLock(() => {
            this._appendRow(insertData);
          }, true);
          console.log(`🧠 Memoria creata atomicamente per thread ${threadId} (v1)`);
        }

        this._invalidateCache(`memory_${threadId}`);
        return true;
        // --- FINE SEZIONE CRITICA ---

        } catch (error) {
          console.warn(`⚠️ Errore aggiornamento atomico (tentativo ${i + 1}): ${error.message}`);
          this._invalidateCache(`memory_${threadId}`);
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
    // Protezione best-effort: non distruggere il batch fallendo.
    // Invece di throw, logghiamo l'errore e ritorniamo false per permettere all'email_processor di finire il job (labeling).
    console.error(`❌ CRITICO: Lock Memory Service irrisolvibile per thread ${threadId} (Loop Timeout dopo 3 retry). Fallback best-effort a batch bypass.`);
    return false;
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

          const maxTopics = (typeof CONFIG !== 'undefined' && CONFIG.MAX_PROVIDED_TOPICS) || 50;
          if (mergedTopics.length > maxTopics) {
            console.log(`🧠 Memoria: Trim providedInfo da ${mergedTopics.length} a ${maxTopics} topic`);
            mergedTopics = mergedTopics.slice(-maxTopics);
          }

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

    // Recupera memoria attuale
    const memory = this.getMemory(threadId);
    if (!memory || !memory.providedInfo) return;

    const infos = memory.providedInfo;
    let modified = false;
    const normalizedTargetTopic = this._normalizeTopicKey(topic);

    // Trova e aggiorna il topic
    const newInfos = infos.map(info => {
      if (this._normalizeTopicKey(info.topic) === normalizedTargetTopic) {
        modified = true;
        // Aggiorna userReaction e context se fornito
        return {
          ...info,
          userReaction: reaction,
          context: context || info.context || null,
          lastInteraction: new Date().toISOString()
        };
      }
      return info;
    });

    if (modified) {
      this._updateProvidedInfoWithoutIncrement(threadId, newInfos);
      console.log(`🧠 Reazione aggiornata per topic '${topic}': ${reaction}`);
    }
  }

  // ========================================================================
  // METODI HELPER PRIVATI
  // ========================================================================

  /**
   * Restituisce il numero di colonne da leggere
   */
  _getColumnCount() {
    return 9; // A:threadId ... I:memorySummary
  }

  /**
   * Trova riga per threadId usando TextFinder
   * Ritorna { rowIndex, values } o null
   */
  _findRowByThreadId(threadId) {
    if (!this._sheet) return null;
    const normalizedThreadId = String(threadId);
    // getLastRow() restituisce l'ultima riga effettiva con dati.
    // getMaxRows() includerebbe migliaia di righe vuote, rallentando la ricerca TextFinder.
    const maxRows = this._sheet.getLastRow();

    // Evita errore out-of-bounds se il foglio contiene solo l'intestazione.
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
        if (String(rowValues[0]) === normalizedThreadId) {
          return {
            rowIndex: rowIndex,
            values: rowValues
          };
        }
      }
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
      writeOperation();
      SpreadsheetApp.flush();
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
      throw new Error(`Errore durante scrittura foglio (lock acquisito): ${e.message}`);
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
          // Preserva eventuali metadati aggiuntivi (es. lastInteraction)
          // per evitare perdite durante cicli di normalizzazione + merge.
          Object.keys(topic).forEach((key) => {
            if (['topic', 'userReaction', 'reaction', 'context', 'timestamp'].includes(key)) return;
            normalized[key] = topic[key];
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
    let lockAcquired = false;
    let globalLockAcquired = false;
    const globalLock = LockService.getScriptLock();

    try {
      lockAcquired = this._tryAcquireShardedLock(lockKey, this._getLockTuning_().shardedAcquireTimeoutMs);
      if (!lockAcquired) return;

      // Lock globale per scrittura (B4)
      globalLock.waitLock(10000);
      globalLockAcquired = true;

      const existingRow = this._findRowByThreadId(threadId);
      const existingData = existingRow
        ? this._rowToObject(existingRow.values)
        : {
          threadId: threadId,
          language: 'it',
          category: null,
          tone: 'standard',
          providedInfo: [],
          lastUpdated: this._validateAndNormalizeTimestamp(new Date().toISOString()),
          messageCount: 1,
          version: 1,
          memorySummary: ''
        };
      const existingTopics = this._normalizeProvidedTopics(Array.isArray(existingData.providedInfo) ? existingData.providedInfo : []);
      const normalizedTopics = this._normalizeProvidedTopics(providedInfo);
      const maxTopics = typeof CONFIG !== 'undefined' ? (CONFIG.MAX_PROVIDED_TOPICS || 50) : 50;

      let mergedTopics = this._mergeProvidedTopics(existingTopics, normalizedTopics);
      if (mergedTopics.length > maxTopics) {
        mergedTopics = mergedTopics.slice(-maxTopics);
      }

      existingData.providedInfo = mergedTopics;
      existingData.lastUpdated = this._validateAndNormalizeTimestamp(new Date().toISOString());
      existingData.version = (existingData.version || 0) + 1;

      // Cap preventivo lunghezza JSON (B5)
      const serialized = JSON.stringify(existingData.providedInfo);
      if (serialized.length > 40000) {
        console.warn(`🧠 Memoria: providedInfo in reazione troppo grande (${serialized.length} chars), riduco`);
        existingData.providedInfo = existingData.providedInfo.slice(-25);
      }

      this._withSheetWriteLock(() => {
        if (existingRow) {
          this._updateRow(existingRow.rowIndex, existingData);
        } else {
          this._appendRow(existingData);
        }
      }, true);
      this._invalidateCache(`memory_${threadId}`);
    } catch (error) {
      console.warn(`⚠️ Aggiornamento reazione fallito: ${error.message}`);
    } finally {
      if (globalLockAcquired) {
        try { globalLock.releaseLock(); } catch (e) {}
      }
      if (lockAcquired) {
        this._releaseShardedLock(lockKey);
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
   * Tenta acquisizione lock sharded (single-key su CacheService, senza lock globale).
   */
  _tryAcquireShardedLock(key, timeoutMs = 500) {
    const cache = CacheService.getScriptCache();
    const configuredLockTtlSeconds = (typeof CONFIG !== 'undefined' && Number(CONFIG.MEMORY_LOCK_TTL) > 0)
      ? Number(CONFIG.MEMORY_LOCK_TTL)
      : 30;
    const sheetWriteTimeoutMs = (typeof CONFIG !== 'undefined' && Number(CONFIG.SHEET_WRITE_LOCK_TIMEOUT_MS) > 0)
      ? Number(CONFIG.SHEET_WRITE_LOCK_TIMEOUT_MS)
      : 10000;
    // TTL >= attesa lock sheet + margine: riduce la finestra in cui due worker credono di essere soli.
    const lockTtlSeconds = Math.max(configuredLockTtlSeconds, Math.ceil((sheetWriteTimeoutMs + 5000) / 1000));

    try {
      const startedAt = Date.now();
      const acquireBudgetMs = Math.max(0, Number(timeoutMs) || 0);
      const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      while ((Date.now() - startedAt) <= acquireBudgetMs) {
        if (cache.get(key) == null) {
          cache.put(key, token, lockTtlSeconds);
          if (cache.get(key) === token) {
            this._heldShardLocks[key] = token;
            return true;
          }
        }

        Utilities.sleep(50);
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
      maxRetries: Number(cfg.MEMORY_LOCK_MAX_RETRIES) > 0 ? Number(cfg.MEMORY_LOCK_MAX_RETRIES) : 5,
      shardedAcquireTimeoutMs: Number(cfg.MEMORY_SHARDED_LOCK_ACQUIRE_TIMEOUT_MS) > 0 ? Number(cfg.MEMORY_SHARDED_LOCK_ACQUIRE_TIMEOUT_MS) : 15000,
      globalGuardTimeoutMs: Number(cfg.MEMORY_LOCK_GLOBAL_GUARD_TIMEOUT_MS) > 0 ? Number(cfg.MEMORY_LOCK_GLOBAL_GUARD_TIMEOUT_MS) : 500,
      backoffBaseMs: Number(cfg.MEMORY_LOCK_BACKOFF_BASE_MS) > 0 ? Number(cfg.MEMORY_LOCK_BACKOFF_BASE_MS) : 200,
      backoffCapMs: Number(cfg.MEMORY_LOCK_BACKOFF_CAP_MS) > 0 ? Number(cfg.MEMORY_LOCK_BACKOFF_CAP_MS) : 10000,
      backoffJitterMs: Number(cfg.MEMORY_LOCK_BACKOFF_JITTER_MS) >= 0 ? Number(cfg.MEMORY_LOCK_BACKOFF_JITTER_MS) : 0,
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
      if (token && cache.get(key) === token) {
        cache.remove(key);
      }
      if (this._heldShardLocks) delete this._heldShardLocks[key];
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
    const maxAllowed = now + 86400000;

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
      // Fallback per vecchi formati non JSON (se esistenti) o errori
      providedInfo = values[4] ? [{
        topic: String(values[4]),
        userReaction: 'unknown',
        context: null,
        timestamp: new Date().toISOString()
      }] : [];
    }

    const lastUpdated = this._validateAndNormalizeTimestamp(values[5]);

    return {
      threadId: values[0],
      language: values[1] || 'it',
      category: values[2] || null,
      tone: values[3] || 'standard',
      providedInfo: providedInfo,
      lastUpdated: lastUpdated,
      messageCount: parseInt(values[6]) || 0,
      version: parseInt(values[7]) || 0,
      memorySummary: values[8] || ''
    };
  }

  /**
   * Aggiorna riga esistente
   */
  _updateRow(rowIndex, data) {
    const providedInfoJson = this._serializeProvidedInfoForSheet(data.providedInfo || []);

    this._sheet.getRange(rowIndex, 1, 1, 9).setValues([[
      data.threadId,
      data.language || 'it',
      data.category || '',
      data.tone || 'standard',
      providedInfoJson,
      data.lastUpdated,
      data.messageCount !== undefined ? data.messageCount : 1,
      data.version !== undefined ? data.version : 1,
      data.memorySummary || ''
    ]]);
  }

  /**
   * Aggiunge nuova riga
   */
  _appendRow(data) {
    const providedInfoJson = this._serializeProvidedInfoForSheet(data.providedInfo || []);

    this._sheet.appendRow([
      data.threadId,
      data.language || 'it',
      data.category || '',
      data.tone || 'standard',
      providedInfoJson,
      data.lastUpdated,
      data.messageCount !== undefined ? data.messageCount : 1,
      data.version !== undefined ? data.version : 1,
      data.memorySummary || ''
    ]);
  }

  _serializeProvidedInfoForSheet(providedInfo) {
    const maxChars = (typeof CONFIG !== 'undefined' && Number(CONFIG.MAX_PROVIDED_INFO_JSON_CHARS) > 0)
      ? Number(CONFIG.MAX_PROVIDED_INFO_JSON_CHARS)
      : 45000;
    let topics = Array.isArray(providedInfo) ? providedInfo.slice() : [];
    let serialized = JSON.stringify(topics);

    // Troncamento rapido per evitare loop O(n²) su storici lunghi.
    if (serialized.length > maxChars && topics.length > 25) {
      topics = topics.slice(-25);
      serialized = JSON.stringify(topics);
    }

    while (topics.length > 0 && serialized.length > maxChars) {
      topics.shift();
      serialized = JSON.stringify(topics);
    }

    if (serialized.length > maxChars) {
      console.warn(`⚠️ providedInfo eccede ${maxChars} caratteri: salvo array vuoto`);
      return '[]';
    }

    return serialized;
  }

  // ========================================================================
  // METODI CACHE
  // ========================================================================

  _getFromCache(key) {
    const cached = this._cache[key];
    if (cached && (Date.now() - cached.timestamp) < this._cacheExpiry) {
      return cached.data;
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
        return parsed;
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
      const MAX_CHUNK_SIZE = 90000;

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
      data: data,
      timestamp: now
    };
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
          range.clearContent();
          this._sheet.getRange(1, 1, validRows.length, headers.length).setValues(validRows);
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

    const data = this._sheet.getDataRange().getValues();
    return {
      initialized: true,
      sheetName: this.sheetName,
      totalEntries: data.length - 1,
      cacheSize: Object.keys(this._cache).length
    };
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
    // Estrai richieste informative
    const requests = [];
    if (/\bquando\b/i.test(userQuestion)) requests.push('timing');
    if (/\bdove\b/i.test(userQuestion)) requests.push('location');
    if (/\bcome\b/i.test(userQuestion)) requests.push('procedure');
    if (/\bquanto|costo|prezzo/i.test(userQuestion)) requests.push('cost');
    if (/\bdocument|certificat/i.test(userQuestion)) requests.push('documents');

    if (requests.length === 0) return 1.0; // Nessuna richiesta esplicita rilevabile

    // Verifica copertura (euristica semplice)
    let covered = 0;
    const respLower = botResponse.toLowerCase();

    requests.forEach(req => {
      let hit = false;
      if (req === 'timing' && /\d{1,2}[:.]\d{2}|mattina|pomeriggio|ore/i.test(respLower)) hit = true;
      if (req === 'location' && /via|piazza|chiesa|ufficio|sacrestia/i.test(respLower)) hit = true;
      if (req === 'procedure' && /iscri|porta|invia|compila/i.test(respLower)) hit = true;
      if (req === 'cost' && /euro|€|gratuit|offert/i.test(respLower)) hit = true;
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
  console.warn('⚠️ [DEPRECATED] setupWeeklyMemoryCleanupTrigger(): usa setupWeeklyCleanupTrigger() in gas_main.js per evitare trigger duplicati.');
  // Rimuovi trigger esistenti per evitare duplicati
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'cleanupOldMemory') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`🗑️ Rimossi ${removed} trigger cleanup esistenti`);
  }
 
  console.log('ℹ️ setupWeeklyMemoryCleanupTrigger deprecata: nessun nuovo trigger creato qui. Usa setupWeeklyCleanupTrigger() in gas_main.js.');
}

/**
 * Alias per compatibilità: alcuni trigger storici puntano a weeklyMemoryCleanup.
 * Wrapper mantenuto per retrocompatibilità con chiamate legacy.
 */
function weeklyMemoryCleanup() {
  return cleanupOldMemory();
}
