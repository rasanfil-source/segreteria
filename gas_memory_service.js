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
 * H: version (per optimistic locking)
 * 
 * FUNZIONALITÀ:
 * - Cache locale per performance
 * - Lock granulare (per thread) con CacheService
 * - Optimistic locking con versione
 * - Topic tracking (anti-ripetizione)
 * - Operazioni atomiche
 */
class MemoryService {
  constructor() {
    console.log('🧠 Inizializzazione MemoryService (basato su Sheet)...');

    // Configurazione
    this.spreadsheetId = typeof CONFIG !== 'undefined' ? CONFIG.SPREADSHEET_ID : null;
    this.sheetName = typeof CONFIG !== 'undefined' ?
      (CONFIG.MEMORY_SHEET_NAME || 'ConversationMemory') :
      'ConversationMemory';

    // Cache per performance (evita lookup ripetuti)
    this._cache = {};
    this._cacheExpiry = 5 * 60 * 1000; // 5 minuti

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
        this._sheet.getRange('A1:H1').setValues([[
          'threadId', 'language', 'category', 'tone',
          'providedInfo', 'lastUpdated', 'messageCount', 'version'
        ]]);
        this._sheet.getRange('A1:H1').setFontWeight('bold');
        this._sheet.setFrozenRows(1);
        console.log(`✓ Creato nuovo foglio: ${this.sheetName}`);
      }

      this._initialized = true;
      console.log(`✓ MemoryService inizializzato (Foglio: ${this.sheetName})`);

    } catch (error) {
      console.error(`❌ Inizializzazione MemoryService fallita: ${error.message}`);
      this._initialized = false;
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

    const MAX_RETRIES = 3;
    const cache = CacheService.getScriptCache();
    const lockKey = `memory_lock_${threadId}`;
    const lockTTL = (typeof CONFIG !== 'undefined' && CONFIG.MEMORY_LOCK_TTL) ? CONFIG.MEMORY_LOCK_TTL : 10;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // 1. Check lock esistente
      if (cache.get(lockKey)) {
        console.warn(`🔒 Memoria bloccata per thread ${threadId}, attesa (Tentativo ${attempt + 1})`);
        Utilities.sleep(Math.pow(2, attempt) * 200);
        continue;
      }

      try {
        // 2. Acquisisci lock
        cache.put(lockKey, 'LOCKED', lockTTL);

        // 3. Rileggi dati freschi dallo Sheet
        const existingRow = this._findRowByThreadId(threadId);
        const now = new Date().toISOString();

        if (existingRow) {
          const existingData = this._rowToObject(existingRow.values);
          const currentVersion = existingData.version || 0;

          // Optimistic locking check
          if (newData._expectedVersion !== undefined && newData._expectedVersion !== currentVersion) {
            console.warn(`🔒 Version mismatch thread ${threadId}: atteso ${newData._expectedVersion}, ottenuto ${currentVersion}`);
            newData._expectedVersion = currentVersion;
            throw new Error('VERSION_MISMATCH');
          }

          // Merge: esistente + nuovi dati
          const mergedData = Object.assign({}, existingData, dataToUpdate);
          mergedData.lastUpdated = now;
          mergedData.messageCount = (existingData.messageCount || 0) + 1;
          mergedData.version = currentVersion + 1;

          if (isNaN(new Date(mergedData.lastUpdated).getTime())) {
            console.error(`🚨 CRITICO: lastUpdated INVALIDO! Reset a NOW.`);
            mergedData.lastUpdated = now;
          }

          this._updateRow(existingRow.rowIndex, mergedData);
          console.log(`🧠 Memoria aggiornata per thread ${threadId} (v${mergedData.version}, Tentativo ${attempt + 1})`);
        } else {
          // Nuova riga
          const insertData = Object.assign({}, dataToUpdate);
          insertData.threadId = threadId;
          insertData.lastUpdated = now;
          insertData.messageCount = 1;
          insertData.version = 1;

          if (isNaN(new Date(insertData.lastUpdated).getTime())) {
            console.error(`🚨 CRITICO: lastUpdated invalido su INSERT. Reset.`);
            insertData.lastUpdated = now;
          }

          this._appendRow(insertData);
          console.log(`🧠 Memoria creata per thread ${threadId} (v1)`);
        }

        // Invalida cache locale
        this._invalidateCache(`memory_${threadId}`);

        return; // Successo

      } catch (error) {
        if (error.message === 'VERSION_MISMATCH') {
          console.warn(`⚠️ Conflitto concorrenza, retry... (Tentativo ${attempt + 1})`);
        } else {
          console.warn(`Aggiornamento memoria fallito (Tentativo ${attempt + 1}): ${error.message}`);
        }

        if (attempt === MAX_RETRIES - 1) {
          console.error(`❌ Aggiornamento memoria finale fallito: ${error.message}`);
        }
        Utilities.sleep(Math.pow(2, attempt) * 200);
      } finally {
        try { cache.remove(lockKey); } catch (e) { }
      }
    }
    throw new Error(`Aggiornamento memoria fallito per thread ${threadId} dopo ${MAX_RETRIES} tentativi`);
  }

  /**
   * Aggiorna memoria E topic in un'unica operazione atomica
   * Previene inconsistenze: tutto o niente in un singolo lock
   * 
   * @param {string} threadId - ID del thread
   * @param {Object} newData - Dati da aggiornare (language, category, tone, etc.)
   * @param {string[]} providedTopics - Topic da aggiungere (opzionale)
   * @returns {boolean} - true se l'operazione è riuscita
   */
  updateMemoryAtomic(threadId, newData, providedTopics = null) {
    if (!this._initialized || !threadId) {
      return false;
    }

    const cache = CacheService.getScriptCache();
    const lockKey = `memory_lock_${threadId}`;
    const lockTTL = (typeof CONFIG !== 'undefined' && CONFIG.MEMORY_LOCK_TTL) ? CONFIG.MEMORY_LOCK_TTL : 10;

    // Prova max 3 volte
    for (let i = 0; i < 3; i++) {
      if (cache.get(lockKey)) {
        Utilities.sleep(200);
        continue;
      }
      try {
        cache.put(lockKey, 'LOCKED', lockTTL);

        // --- SEZIONE CRITICA ---
        const existingRow = this._findRowByThreadId(threadId);
        const now = new Date().toISOString();

        if (existingRow) {
          const existingData = this._rowToObject(existingRow.values);
          const currentVersion = existingData.version || 0;

          const mergedData = Object.assign({}, existingData, newData);
          mergedData.lastUpdated = now;
          mergedData.messageCount = (existingData.messageCount || 0) + 1;
          mergedData.version = currentVersion + 1;

          if (providedTopics && providedTopics.length > 0) {
            const existingTopics = existingData.providedInfo || [];
            let mergedTopics = [...new Set([...existingTopics, ...providedTopics])];

            // Limita providedInfo per evitare memory bloat
            const maxTopics = (typeof CONFIG !== 'undefined' && CONFIG.MAX_PROVIDED_TOPICS) || 50;
            if (mergedTopics.length > maxTopics) {
              console.log(`🧠 Memoria: Trim providedInfo da ${mergedTopics.length} a ${maxTopics} topic`);
              mergedTopics = mergedTopics.slice(-maxTopics);
            }

            mergedData.providedInfo = mergedTopics;
            console.log(`🧠 Memoria: Aggiunti atomicamente topic ${JSON.stringify(providedTopics)}`);
          }

          this._updateRow(existingRow.rowIndex, mergedData);
          console.log(`🧠 Memoria aggiornata atomicamente per thread ${threadId} (v${mergedData.version})`);
        } else {
          newData.threadId = threadId;
          newData.lastUpdated = now;
          newData.messageCount = 1;
          newData.version = 1;

          if (providedTopics && providedTopics.length > 0) {
            newData.providedInfo = providedTopics;
          }

          this._appendRow(newData);
          console.log(`🧠 Memoria creata atomicamente per thread ${threadId} (v1)`);
        }

        this._invalidateCache(`memory_${threadId}`);
        return true;
        // --- FINE SEZIONE CRITICA ---

      } catch (error) {
        console.warn(`⚠️ Errore aggiornamento atomico (tentativo ${i + 1}): ${error.message}`);
        Utilities.sleep(Math.pow(2, i) * 200);
      } finally {
        try { cache.remove(lockKey); } catch (e) { console.warn(`⚠️ Errore rimozione lock (Atomic): ${e.message}`); }
      }
    }
    return false; // Timeout
  }

  /**
   * Aggiunge topic alla lista info fornite
   * NON incrementa messageCount
   */
  addProvidedInfoTopics(threadId, topics) {
    if (!this._initialized || !threadId || !topics || topics.length === 0) {
      return;
    }

    const cache = CacheService.getScriptCache();
    const lockKey = `memory_lock_${threadId}`;
    const lockTTL = (typeof CONFIG !== 'undefined' && CONFIG.MEMORY_LOCK_TTL) ? CONFIG.MEMORY_LOCK_TTL : 10;

    try {
      if (cache.get(lockKey)) {
        Utilities.sleep(500);
        if (cache.get(lockKey)) return;
      }
      cache.put(lockKey, 'LOCKED', lockTTL);

      const existingRow = this._findRowByThreadId(threadId);
      if (existingRow) {
        const existingData = this._rowToObject(existingRow.values);
        const existingTopics = existingData.providedInfo || [];
        let mergedTopics = [...new Set([...existingTopics, ...topics])];

        const maxTopics = (typeof CONFIG !== 'undefined' && CONFIG.MAX_PROVIDED_TOPICS) || 50;
        if (mergedTopics.length > maxTopics) {
          console.log(`🧠 Memoria: Trim providedInfo da ${mergedTopics.length} a ${maxTopics} topic`);
          mergedTopics = mergedTopics.slice(-maxTopics);
        }

        const currentVersion = existingData.version || 0;
        existingData.providedInfo = mergedTopics;
        existingData.lastUpdated = new Date().toISOString();
        existingData.version = currentVersion + 1;

        this._updateRow(existingRow.rowIndex, existingData);
        this._invalidateCache(`memory_${threadId}`);
        console.log(`🧠 Memoria: Topic aggiunti atomicamente ${JSON.stringify(topics)}`);
      }
    } catch (error) {
      console.error(`❌ Errore aggiunta provided info: ${error.message}`);
    } finally {
      try { cache.remove(lockKey); } catch (e) { console.warn(`⚠️ Errore rimozione lock (Topics): ${e.message}`); }
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

  // ========================================================================
  // METODI HELPER PRIVATI
  // ========================================================================

  /**
   * Trova riga per threadId
   * Ritorna { rowIndex, values } o null
   */
  /**
   * Trova riga per threadId usando TextFinder
   * Ritorna { rowIndex, values } o null
   */
  _findRowByThreadId(threadId) {
    if (!this._sheet) return null;

    // Usa TextFinder per cercare l'ID direttamente
    const finder = this._sheet.createTextFinder(threadId)
      .matchEntireCell(true)      // Corrispondenza esatta
      .matchCase(true)            // Case sensitive (ID Gmail lo sono)
      .matchFormulaText(false)    // Cerca solo nei valori
      .ignoreDiacritics(false);

    const result = finder.findNext();

    if (result) {
      const rowIndex = result.getRow();
      const colIndex = result.getColumn();

      // Verifica di sicurezza: l'ID deve essere nella colonna A (indice 1)
      if (colIndex === 1 && rowIndex > 1) {
        // Leggi solo la riga trovata
        // Leggiamo 8 colonne (A:H) come definito in _initializeSheet
        const rowValues = this._sheet.getRange(rowIndex, 1, 1, 8).getValues()[0];

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
   * Converte array riga in oggetto
   */
  _rowToObject(row) {
    const values = Array.isArray(row) ? row : row.values || row;

    let providedInfo = [];
    try {
      if (values[4]) {
        providedInfo = JSON.parse(values[4]);
      }
    } catch (e) {
      providedInfo = values[4] ? [values[4]] : [];
    }

    // Valida timestamp PRIMA della costruzione oggetto
    let lastUpdated = values[5] || null;
    if (lastUpdated) {
      const testDate = new Date(lastUpdated);
      if (isNaN(testDate.getTime())) {
        console.warn(`⚠️ Data invalida in memoria per thread ${values[0]}: ${lastUpdated}`);
        lastUpdated = null;
      }
    }

    return {
      threadId: values[0],
      language: values[1] || 'it',
      category: values[2] || null,
      tone: values[3] || 'standard',
      providedInfo: providedInfo,
      lastUpdated: lastUpdated,
      messageCount: parseInt(values[6]) || 0,
      version: parseInt(values[7]) || 0
    };
  }

  /**
   * Aggiorna riga esistente
   */
  _updateRow(rowIndex, data) {
    const providedInfoJson = JSON.stringify(data.providedInfo || []);

    this._sheet.getRange(rowIndex, 1, 1, 8).setValues([[
      data.threadId,
      data.language || 'it',
      data.category || '',
      data.tone || 'standard',
      providedInfoJson,
      data.lastUpdated,
      data.messageCount || 1,
      data.version || 1
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
      data.version || 1
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
    this._cache[key] = {
      data: data,
      timestamp: Date.now()
    };
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