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
class MemoryService {
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
    this._cacheExpiry = 5 * 60 * 1000; // 5 minuti
    this._opCount = 0; // Punto 9: Contatore per Garbage Collection periodica

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
   * Utile per migrazione da versioni precedenti
   */
  _ensureMemorySummaryColumn() {
    try {
      const maxCols = this._sheet.getMaxColumns();
      if (maxCols < 9) {
        this._sheet.insertColumnsAfter(maxCols, 9 - maxCols);
      }

      const headers = this._sheet.getRange('A1:I1').getValues()[0];
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
    if (!threadId) {
      return { providedInfo: [] };
    }

    const cacheKey = `MEM_${threadId}`;
    const cache = CacheService.getScriptCache();

    // PERCORSO RAPIDO: prova prima la cache in memoria
    try {
      const cached = cache.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (!Array.isArray(parsed.providedInfo)) {
          parsed.providedInfo = [];
        }
        return parsed;
      }
    } catch (e) {
      console.warn(`Cache miss per thread ${threadId}: ${e.message}`);
    }

    // ALTERNATIVA: leggi da Sheets
    const fromSheets = this.getMemory(threadId);

    // Riscalda la cache per le prossime letture
    if (fromSheets) {
      try {
        cache.put(cacheKey, JSON.stringify(fromSheets), 1800); // 30 minuti
      } catch (e) {
        // cache write non bloccante
      }
    }

    return fromSheets;
  }

  /**
   * Aggiorna memoria per un thread (merge con esistente)
   * Usa lock granulare + retry + optimistic locking
   */
  updateMemory(threadId, newData) {
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

    const MAX_RETRIES = 5;
    // Workaround: Hash del threadId per sharding (riduce contention)
    const lockKey = this._getShardedLockKey(threadId);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let lockOwned = false;
      let shouldRetry = false;

      try {
        // 1. Acquisisci Lock Sharded (CacheService)
        lockOwned = this._tryAcquireShardedLock(lockKey);
        if (!lockOwned) {
          console.warn(`🔒 Timeout lock memoria sharded (Tentativo ${attempt + 1})`);
          shouldRetry = true;
          continue;
        }

        // 2. Rileggi dati freschi dallo Sheet
        const existingRow = this._findRowByThreadId(threadId);
        const now = this._validateAndNormalizeTimestamp(new Date().toISOString());

        if (existingRow) {
          const existingData = this._rowToObject(existingRow.values);
          const currentVersion = existingData.version || 0;

          // Verifica controllo concorrenza ottimistico
          if (newData._expectedVersion !== undefined && newData._expectedVersion !== currentVersion) {
            // INVALIDAZIONE CACHE CRITICA
            this._invalidateCache(`memory_${threadId}`);
            console.warn(`🔒 Version mismatch thread ${threadId}: atteso ${newData._expectedVersion}, ottenuto ${currentVersion}`);
            newData._expectedVersion = currentVersion;
            throw new Error('VERSION_MISMATCH');
          }

          // Merge: esistente + nuovi dati
          const mergedData = Object.assign({}, existingData, dataToUpdate);
          mergedData.lastUpdated = now;
          mergedData.messageCount = (existingData.messageCount || 0) + 1;
          mergedData.version = currentVersion + 1;

          this._withSheetWriteLock(() => {
            this._updateRow(existingRow.rowIndex, mergedData);
          });
          console.log(`🧠 Memoria aggiornata per thread ${threadId} (v${mergedData.version}, Tentativo ${attempt + 1})`);
        } else {
          // Nuova riga
          const insertData = Object.assign({}, dataToUpdate);
          insertData.threadId = threadId;
          insertData.lastUpdated = now;
          insertData.messageCount = 1;
          insertData.version = 1;

          this._withSheetWriteLock(() => {
            this._appendRow(insertData);
          });
          console.log(`🧠 Memoria creata per thread ${threadId} (v1)`);
        }

        // Invalida cache locale
        this._invalidateCache(`memory_${threadId}`);
        return; // Successo

      } catch (error) {
        if (error.message === 'VERSION_MISMATCH') {
          console.warn(`⚠️ Conflitto concorrenza, retry... (Tentativo ${attempt + 1})`);
          // Forziamo invalidazione cache anche qui per sicurezza
          this._invalidateCache(`memory_${threadId}`);
        } else {
          console.warn(`Aggiornamento memoria fallito (Tentativo ${attempt + 1}): ${error.message}`);
        }

        shouldRetry = true;

        if (attempt === MAX_RETRIES - 1) {
          console.error(`❌ Aggiornamento memoria finale fallito: ${error.message}`);
        }
      } finally {
        if (lockOwned) {
          this._releaseShardedLock(lockKey);
        }
      }

      if (shouldRetry) {
        if (!lockOwned) {
          // Backoff più morbido su lock non acquisito: 100ms base con crescita 1.5x + jitter
          const delay = Math.pow(1.5, attempt) * 100 + Math.random() * 50;
          Utilities.sleep(delay);
        } else {
          Utilities.sleep(Math.pow(2, attempt) * 200);
        }
      }
    }
    throw new Error(`Aggiornamento memoria fallito per thread ${threadId} dopo ${MAX_RETRIES} tentativi`);
  }

  /**
   * Scrive su entrambi i livelli in modo non bloccante.
   */
  updateMemoryRobust(threadId, data) {
    if (!threadId || !data || typeof data !== 'object') {
      return;
    }

    // Scrivi su Sheets (fonte di verità)
    this.updateMemory(threadId, data);

    // Aggiorna anche la cache veloce
    const cacheKey = `MEM_${threadId}`;
    try {
      const cache = CacheService.getScriptCache();
      const existing = this.getMemory(threadId) || { providedInfo: [] };
      const merged = Object.assign({}, existing, data);
      if (!Array.isArray(merged.providedInfo)) {
        merged.providedInfo = [];
      }
      cache.put(cacheKey, JSON.stringify(merged), 1800);
    } catch (e) {
      // non bloccante
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
    // Accetta anche solo topic (se newData è nullo o vuoto ma providedTopics è presente)
    const hasData = newData && typeof newData === 'object' && Object.keys(newData).length > 0;
    const hasTopics = providedTopics && (Array.isArray(providedTopics) || (typeof providedTopics === 'string' && providedTopics.length > 0));

    if (!hasData && !hasTopics) {
      console.warn(`⚠️ updateMemoryAtomic chiamato senza dati né topic validi per thread ${threadId}`);
      return false;
    }

    const lockKey = this._getShardedLockKey(threadId);

    // Prova max 3 volte
    for (let i = 0; i < 3; i++) {
      let lockAcquired = false;
      try {
        lockAcquired = this._tryAcquireShardedLock(lockKey);
        if (!lockAcquired) {
          if (i === 2) {
            console.warn(`⚠️ Lock non acquisito dopo 3 tentativi, annullo aggiornamento atomico per thread ${threadId}`);
            return false;
          }
          if (i < 2) {
            const baseSleepMs = (typeof CONFIG !== 'undefined' && CONFIG.CACHE_RACE_SLEEP_MS) || 200;
            Utilities.sleep(baseSleepMs + Math.random() * 100);
          }
          continue;
        }

        // --- SEZIONE CRITICA ---
        const existingRow = this._findRowByThreadId(threadId);
        const now = this._validateAndNormalizeTimestamp(new Date().toISOString());

        if (existingRow) {
          const existingData = this._rowToObject(existingRow.values);
          const currentVersion = existingData.version || 0;

          const mergedData = Object.assign({}, existingData, newData);
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

          this._withSheetWriteLock(() => {
            this._updateRow(existingRow.rowIndex, mergedData);
          });
          console.log(`🧠 Memoria aggiornata atomicamente per thread ${threadId} (v${mergedData.version})`);
        } else {
          newData.threadId = threadId;
          newData.lastUpdated = now;
          newData.messageCount = 1;
          newData.version = 1;

          if (providedTopics && providedTopics.length > 0) {
            newData.providedInfo = this._normalizeProvidedTopics(providedTopics);
          }

          this._withSheetWriteLock(() => {
            this._appendRow(newData);
          });
          console.log(`🧠 Memoria creata atomicamente per thread ${threadId} (v1)`);
        }

        this._invalidateCache(`memory_${threadId}`);
        return true;
        // --- FINE SEZIONE CRITICA ---

      } catch (error) {
        console.warn(`⚠️ Errore aggiornamento atomico (tentativo ${i + 1}): ${error.message}`);
        // Invalida cache per sicurezza se c'è stato un fallimento parziale
        this._invalidateCache(`memory_${threadId}`);
        Utilities.sleep(Math.pow(2, i) * 200);
      } finally {
        if (lockAcquired) {
          this._releaseShardedLock(lockKey);
        }
      }
    }
    // Punto 2: Protezione di sicurezza se il fallback non ha potuto completare
    throw new Error(`Impossibile aggiornare la memoria per il thread ${threadId} dopo 3 tentativi (Lock Timeout)`);
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

    let lockAcquired = false;
    try {
      lockAcquired = this._tryAcquireShardedLock(lockKey);
      if (!lockAcquired) return; // Rinuncia se lockato

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

        this._updateRow(existingRow.rowIndex, existingData);
        this._invalidateCache(`memory_${threadId}`);
        console.log(`🧠 Memoria: Topic aggiunti atomicamente ${JSON.stringify(topics)}`);
      }
    } catch (error) {
      console.error(`❌ Errore aggiunta provided info: ${error.message}`);
    } finally {
      if (lockAcquired) {
        this._releaseShardedLock(lockKey);
      }
    }
  }

  /**
   * Imposta lingua per un thread
   */
  setLanguage(threadId, language) {
    this.updateMemory(threadId, { language: language });
  }

  /**
   * Imposta categoria per un thread
   */
  setCategory(threadId, category) {
    this.updateMemory(threadId, { category: category });
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

    // Trova e aggiorna il topic
    const newInfos = infos.map(info => {
      if (info.topic === topic) {
        modified = true;
        // Aggiorna userReaction e context se fornito
        return {
          ...info,
          userReaction: reaction,
          context: context || info.context || null,
          lastInteraction: Date.now()
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
   * Trova riga per threadId (OTTIMIZZATO con TextFinder)
   * Ritorna { rowIndex, values } o null
   */
  _findRowByThreadId(threadId) {
    if (!this._sheet) return null;
    const normalizedThreadId = String(threadId);

    // Punto 5: Ottimizzazione TextFinder limitando il range alla colonna A (Thread ID)
    const finder = this._sheet.getRange('A2:A').createTextFinder(normalizedThreadId)
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
        const rowValues = this._sheet.getRange(rowIndex, 1, 1, this._getColumnCount()).getValues()[0];

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
   * Riduce race condition tra thread diversi durante update/append riga.
   * @param {Function} writeOperation callback con la scrittura effettiva
   */
  _withSheetWriteLock(writeOperation) {
    const sheetLock = LockService.getScriptLock();
    const timeoutMs = (typeof CONFIG !== 'undefined' && CONFIG.SHEET_WRITE_LOCK_TIMEOUT_MS) || 10000;

    try {
      sheetLock.waitLock(timeoutMs);
      writeOperation();
    } catch (e) {
      throw new Error(`Lock del foglio non acquisito: ${e.message}`);
    } finally {
      try {
        sheetLock.releaseLock();
      } catch (releaseError) {
        // Lock già rilasciato o non acquisito: ignora
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
          return {
            topic: trimmed,
            userReaction: topic.userReaction || topic.reaction || 'unknown',
            context: topic.context || null,
            timestamp: this._validateAndNormalizeTimestamp(topic.timestamp || new Date().toISOString())
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  /**
   * Merge topic evitando duplicati per chiave "topic".
   */
  _mergeProvidedTopics(existingTopics, newTopics) {
    const mergedMap = new Map();

    existingTopics.forEach(item => {
      if (item && item.topic) {
        mergedMap.set(item.topic, item);
      }
    });

    newTopics.forEach(item => {
      if (item && item.topic) {
        mergedMap.set(item.topic, item);
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

    try {
      lockAcquired = this._tryAcquireShardedLock(lockKey);
      if (!lockAcquired) return;

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

      if (existingRow) {
        this._updateRow(existingRow.rowIndex, existingData);
      } else {
        this._appendRow(existingData);
      }
      this._invalidateCache(`memory_${threadId}`);
    } catch (error) {
      console.warn(`⚠️ Aggiornamento reazione fallito: ${error.message}`);
    } finally {
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
    // Workaround: sharding per ridurre contention globale
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, threadId);
    // Usa più caratteri dell'array digest (8 invece di 4) per minimizzare collisioni
    const hex = Array.prototype.map.call(digest, (byte) => {
      const unsigned = byte < 0 ? byte + 256 : byte;
      return unsigned.toString(16).padStart(2, '0');
    }).join('');
    const shard = hex.substring(0, 8);
    return `mem_lock_${shard}`;
  }

  /**
   * Tenta acquisizione lock sharded (simulato con CacheService + Global Guard breve)
   */
  _tryAcquireShardedLock(key) {
    const cache = CacheService.getScriptCache();
    const globalLock = LockService.getScriptLock();
    const lockTtlSeconds = (typeof CONFIG !== 'undefined' && Number(CONFIG.MEMORY_LOCK_TTL) > 0)
      ? Number(CONFIG.MEMORY_LOCK_TTL)
      : 30;

    // Pattern: Global Guard per operazione Cache Atomica
    // Prendi lock globale per pochissimo tempo, solo per check-and-set su Cache
    // Punto 14: Aumentato timeout acquisizione lock a 5 secondi per gestire carichi elevati
    if (globalLock.tryLock(5000)) {
      try {
        try {
          if (cache.get(key) != null) {
            return false; // Già lockato
          }
          cache.put(key, '1', lockTtlSeconds);
          return true;
        } catch (cacheError) {
          console.warn(`⚠️ Errore CacheService durante lock: ${cacheError.message}`);
          return false;
        }
      } finally {
        globalLock.releaseLock();
      }
    } else {
      console.warn(`⚠️ Timeout acquisizione GlobalLock per sharded key: ${key}`);
      return false; // Fallito acquisizione guard
    }
  }

  /**
   * Rilascia lock sharded
   */
  _releaseShardedLock(key) {
    try {
      CacheService.getScriptCache().remove(key);
    } catch (e) {
      console.warn('Errore release lock:', e);
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

    if (typeof timestamp !== 'string') {
      console.warn(`⚠️ Timestamp non-string: ${typeof timestamp}, reset`);
      return fallback;
    }

    const parsed = new Date(timestamp);
    if (!parsed || isNaN(parsed.getTime())) {
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

    return timestamp;
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
          if (typeof item === 'string') return { topic: item, userReaction: 'unknown', context: null, timestamp: Date.now() };
          // Standardizzazione: allinea la nomenclatura dei campi
          if (item.reaction && !item.userReaction) item.userReaction = item.reaction;
          return item;
        }) : [];
      }
    } catch (e) {
      // Fallback per vecchi formati non JSON (se esistenti) o errori
      providedInfo = values[4] ? [{ topic: String(values[4]), reaction: 'unknown' }] : [];
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
    const providedInfoJson = JSON.stringify(data.providedInfo || []);

    this._sheet.getRange(rowIndex, 1, 1, 9).setValues([[
      data.threadId,
      data.language || 'it',
      data.category || '',
      data.tone || 'standard',
      providedInfoJson,
      data.lastUpdated,
      data.messageCount || 1,
      data.version || 1,
      data.memorySummary || ''
    ]]);
  }

  /**
   * Aggiunge nuova riga
   */
  _appendRow(data) {
    const providedInfoJson = JSON.stringify(data.providedInfo || []);

    this._sheet.appendRow([
      data.threadId,
      data.language || 'it',
      data.category || '',
      data.tone || 'standard',
      providedInfoJson,
      data.lastUpdated,
      data.messageCount || 1,
      data.version || 1,
      data.memorySummary || ''
    ]);
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
        const parsed = JSON.parse(serialized);
        this._setLocalCache(key, parsed);
        return parsed;
      }
    } catch (e) {
      // best effort
    }

    return null;
  }

  _setCache(key, data) {
    // Punto 9: Implementazione Garbage Collection periodica della cache in-memory
    this._opCount++;
    if (this._opCount >= 100) {
      this._gcCache();
      this._opCount = 0;
    }

    this._setLocalCache(key, data);

    // CacheService per riuso tra esecuzioni del trigger
    try {
      const cache = CacheService.getScriptCache();
      cache.put(key, JSON.stringify(data), Math.floor(this._cacheExpiry / 1000));
    } catch (e) {
      // best effort
    }
  }

  _setLocalCache(key, data) {
    this._cache[key] = {
      data: data,
      timestamp: Date.now()
    };
  }

  /**
   * Unisce dati di finestra (WAL) con esistenti, de-duplica per timestamp
   */
  _mergeWindowData(existing, walData) {
    const existingTimestamps = new Set(existing.map(e => e.timestamp));

    // Deep copy via JSON (sicuro per dati serializzabili)
    const merged = JSON.parse(JSON.stringify(existing));

    for (const entry of walData) {
      if (!existingTimestamps.has(entry.timestamp)) {
        merged.push({ ...entry }); // Spread per sicurezza
        existingTimestamps.add(entry.timestamp);
      }
    }

    return merged.sort((a, b) => a.timestamp - b.timestamp).slice(-100);
  }

  /**
   * Pulisce la cache dagli elementi scaduti
   */
  _gcCache() {
    const now = Date.now();
    let deletedCount = 0;

    for (const key in this._cache) {
      if (!this._cache[key]) continue;
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

    // Mantieni coerenza tra i due namespace cache locali: memory_ <-> MEM_
    if (typeof key === 'string' && key.startsWith('memory_')) {
      const threadId = key.substring('memory_'.length);
      if (threadId) {
        delete this._cache[`MEM_${threadId}`];
      }
    } else if (typeof key === 'string' && key.startsWith('MEM_')) {
      const threadId = key.substring('MEM_'.length);
      if (threadId) {
        delete this._cache[`memory_${threadId}`];
      }
    }

    try {
      const cache = CacheService.getScriptCache();
      cache.remove(key);

      // Compatibilità con getMemoryRobust/updateMemoryRobust: rimuovi anche prefisso correlato
      if (typeof key === 'string' && key.startsWith('memory_')) {
        const threadId = key.substring('memory_'.length);
        if (threadId) {
          cache.remove(`MEM_${threadId}`);
        }
      } else if (typeof key === 'string' && key.startsWith('MEM_')) {
        const threadId = key.substring('MEM_'.length);
        if (threadId) {
          cache.remove(`memory_${threadId}`);
        }
      }
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
      if (keys.length > 0) {
        CacheService.getScriptCache().removeAll(keys);
      }
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

    try {
      const data = this._sheet.getDataRange().getValues();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      let deletedCount = 0;

      // Vai all'indietro per evitare problemi di shifting indici
      for (let i = data.length - 1; i >= 1; i--) {
        const lastUpdated = new Date(data[i][5]);
        if (!(lastUpdated instanceof Date) || isNaN(lastUpdated.getTime()) || lastUpdated < cutoffDate) {
          this._sheet.deleteRow(i + 1);
          deletedCount++;
        }
      }

      console.log(`🧹 Pulite ${deletedCount} voci memoria vecchie`);
      return deletedCount;

    } catch (error) {
      console.error(`❌ Errore pulizia voci vecchie: ${error.message}`);
      return 0;
    }
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
   * Tenta di acquisire un lock distribuito (simulato)
   */
  _tryAcquireShardedLockExperimental(lockKey, waitMs = 2000, lockTTL = 10000) {
    try {
      const lock = LockService.getScriptLock();
      // ... logica simulata per sharded lock (useremo lock globale per semplicità in GAS standard)
      // In ambiente reale ad alto volume, qui useremmo un lease su PropertiesService o CacheService

      // Acquisizione lock
      const acquired = lock.tryLock(waitMs);
      if (acquired) {
        // Imposta un TTL implicito rilasciando il lock dopo un timeout se non fatto manualmente
        // Nota: LockService rilascia automaticamente al termine dell'esecuzione,
        // ma per sicurezza possiamo usare un timestamp in CacheService se volessimo persistenza cross-execution.
        return lock;
      }
      return null;
    } catch (e) {
      console.warn(`⚠️ Errore acquisizione lock: ${e.message}`);
      return null;
    }
  }

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
 * Configura trigger settimanale per pulizia automatica memoria
 * ESEGUI UNA SOLA VOLTA manualmente per attivare il cleanup automatico
 */
function setupWeeklyCleanupTrigger() {
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

  // Crea trigger settimanale (domenica alle 3:00)
  ScriptApp.newTrigger('cleanupOldMemory')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .create();

  console.log('✓ Trigger cleanup settimanale creato (Domenica 3:00 AM)');
}