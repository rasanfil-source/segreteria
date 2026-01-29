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
      const headers = this._sheet.getRange('A1:I1').getValues()[0];
      // La colonna I è la nona colonna (indice 8)
      if (headers.length < 9 || headers[8] !== 'memorySummary') {
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
      return {};
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
        const data = this._rowToObject(row);
        console.log(`🧠 Memory hit per thread ${threadId} (Lingua: ${data.language})`);

        // Memorizza in cache
        this._setCache(cacheKey, data);
        return data;
      } else {
        console.log(`🧠 Memory miss per thread ${threadId} (Nuova conversazione)`);
        return {};
      }

    } catch (error) {
      console.error(`❌ Errore recupero memoria: ${error.message}`);
      return {};
    }
  }

  /**
   * Aggiorna memoria per un thread (merge con esistente)
   * Usa lock granulare + retry + optimistic locking
   */
  updateMemory(threadId, newData) {
    if (!this._initialized || !threadId) {
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
    let lockOwned = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // 1. Acquisisci Lock Sharded (CacheService)
        if (!lockOwned) {
          lockOwned = this._tryAcquireShardedLock(lockKey);
          if (!lockOwned) {
            console.warn(`🔒 Timeout lock memoria sharded (Tentativo ${attempt + 1})`);
            // Backoff più morbido: 100ms base con crescita 1.5x + jitter
            const delay = Math.pow(1.5, attempt) * 100 + Math.random() * 50;
            Utilities.sleep(delay);
            continue;
          }
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

          this._updateRow(existingRow.rowIndex, mergedData);
          console.log(`🧠 Memoria aggiornata per thread ${threadId} (v${mergedData.version}, Tentativo ${attempt + 1})`);
        } else {
          // Nuova riga
          const insertData = Object.assign({}, dataToUpdate);
          insertData.threadId = threadId;
          insertData.lastUpdated = now;
          insertData.messageCount = 1;
          insertData.version = 1;

          this._appendRow(insertData);
          console.log(`🧠 Memoria creata per thread ${threadId} (v1)`);
        }

        // Invalida cache locale
        this._invalidateCache(`memory_${threadId}`);

        if (lockOwned) {
          this._releaseShardedLock(lockKey);
          lockOwned = false;
        }
        return; // Successo

      } catch (error) {
        if (error.message === 'VERSION_MISMATCH') {
          console.warn(`⚠️ Conflitto concorrenza, retry... (Tentativo ${attempt + 1})`);
          // Forziamo invalidazione cache anche qui per sicurezza
          this._invalidateCache(`memory_${threadId}`);
          if (lockOwned) {
            this._releaseShardedLock(lockKey);
            lockOwned = false;
          }
        } else {
          console.warn(`Aggiornamento memoria fallito (Tentativo ${attempt + 1}): ${error.message}`);
          if (lockOwned) {
            this._releaseShardedLock(lockKey);
            lockOwned = false;
          }
        }

        if (attempt === MAX_RETRIES - 1) {
          console.error(`❌ Aggiornamento memoria finale fallito: ${error.message}`);
        }
        Utilities.sleep(Math.pow(2, attempt) * 200);
      }
    }
    if (lockOwned) {
      this._releaseShardedLock(lockKey);
    }
    throw new Error(`Aggiornamento memoria fallito per thread ${threadId} dopo ${MAX_RETRIES} tentativi`);
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

    const lockKey = this._getShardedLockKey(threadId);

    // Prova max 3 volte
    for (let i = 0; i < 3; i++) {
      let lockAcquired = false;
      try {
        lockAcquired = this._tryAcquireShardedLock(lockKey);
        if (!lockAcquired) {
          if (i < 2) Utilities.sleep(500 + Math.random() * 100);
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

          this._updateRow(existingRow.rowIndex, mergedData);
          console.log(`🧠 Memoria aggiornata atomicamente per thread ${threadId} (v${mergedData.version})`);
        } else {
          newData.threadId = threadId;
          newData.lastUpdated = now;
          newData.messageCount = 1;
          newData.version = 1;

          if (providedTopics && providedTopics.length > 0) {
            newData.providedInfo = this._normalizeProvidedTopics(providedTopics);
          }

          this._appendRow(newData);
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
    // Punto 2: Lancio eccezione se tutti i tentativi falliscono per evitare Lost Update silenziosi
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

    // Punto 5: Ottimizzazione TextFinder limitando il range alla colonna A (Thread ID)
    const finder = this._sheet.getRange('A:A').createTextFinder(threadId)
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
        if (rowValues[0] === threadId) {
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
   * Normalizza i topic forniti in formato oggetto.
   */
  _normalizeProvidedTopics(topics) {
    if (!Array.isArray(topics)) return [];

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
      if (!existingRow) return;

      const existingData = this._rowToObject(existingRow.values);
      const maxTopics = typeof CONFIG !== 'undefined' ? (CONFIG.MAX_PROVIDED_TOPICS || 50) : 50;
      const limitedTopics = normalizedTopics.slice(-maxTopics);

      existingData.providedInfo = limitedTopics;
      existingData.lastUpdated = this._validateAndNormalizeTimestamp(new Date().toISOString());
      existingData.version = (existingData.version || 0) + 1;

      this._updateRow(existingRow.rowIndex, existingData);
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
    const shard = digest.toString().substr(0, 8);
    return `mem_lock_${shard}`;
  }

  /**
   * Tenta acquisizione lock sharded (simulato con CacheService + Global Guard breve)
   */
  _tryAcquireShardedLock(key) {
    const cache = CacheService.getScriptCache();
    const globalLock = LockService.getScriptLock();

    // Pattern: Global Guard per operazione Cache Atomica
    // Prendi lock globale per pochissimo tempo, solo per check-and-set su Cache
    // Punto 14: Aumentato timeout acquisizione lock a 5 secondi per gestire carichi elevati
    if (globalLock.tryLock(5000)) {
      try {
        if (cache.get(key) != null) {
          return false; // Già lockato
        }
        cache.put(key, '1', 30); // Lock 30 sec
        return true;
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
    // Punto 7: Intervallo di validità futuro esteso a 7 giorni per compensare drift dell'orologio
    const maxAllowed = now + (7 * 24 * 60 * 60 * 1000);

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
    return null;
  }

  _setCache(key, data) {
    // Punto 9: Implementazione Garbage Collection periodica della cache in-memory
    this._opCount++;
    if (this._opCount >= 100) {
      this._gcCache();
      this._opCount = 0;
    }

    this._cache[key] = {
      data: data,
      timestamp: Date.now()
    };
  }

  /**
   * Pulisce la cache dagli elementi scaduti
   */
  _gcCache() {
    const now = Date.now();
    const keysToDelete = [];

    for (const key in this._cache) {
      if (now - this._cache[key].timestamp > this._cacheExpiry) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => delete this._cache[key]);

    if (keysToDelete.length > 0) {
      console.log(`🧹 Cache GC: rimossi ${keysToDelete.length} elementi scaduti`);
    }
  }

  _invalidateCache(key) {
    delete this._cache[key];
  }

  /**
   * Svuota tutta la cache
   */
  clearCache() {
    this._cache = {};
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