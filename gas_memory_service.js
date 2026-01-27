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

    const MAX_RETRIES = 3;
    // Implementazione: Uso ScriptLock atomico invece di CacheService non-atomico
    const lock = LockService.getScriptLock();
    // Nota: ScriptLock è globale per lo script, garantisce sequenzialità assoluta per le scritture

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let lockAcquired = false;
      // 1. Acquisisci Lock (Wait max 5s)
      try {
        lockAcquired = lock.tryLock(5000);
        if (!lockAcquired) {
          console.warn(`🔒 Timeout lock memoria (Tentativo ${attempt + 1})`);
          Utilities.sleep(Math.pow(2, attempt) * 200);
          continue;
        }

        // 2. Rileggi dati freschi dallo Sheet
        const existingRow = this._findRowByThreadId(threadId);
        const now = new Date().toISOString();

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
          // Forziamo invalidazione cache anche qui per sicurezza
          this._invalidateCache(`memory_${threadId}`);
        } else {
          console.warn(`Aggiornamento memoria fallito (Tentativo ${attempt + 1}): ${error.message}`);
        }

        if (attempt === MAX_RETRIES - 1) {
          console.error(`❌ Aggiornamento memoria finale fallito: ${error.message}`);
        }
        Utilities.sleep(Math.pow(2, attempt) * 200);
      } finally {
        if (lockAcquired) {
          lock.releaseLock();
        }
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

    // MODIFICATO: Uso ScriptLock atomico invece di CacheService non-atomico
    const lock = LockService.getScriptLock();

    // Prova max 3 volte (retry interni al lock acquisition)
    for (let i = 0; i < 3; i++) {
      let lockAcquired = false;
      try {
        lockAcquired = lock.tryLock(5000); // 5s timeout
        if (!lockAcquired) {
          if (i < 2) Utilities.sleep(500);
          continue;
        }

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
        // Invalida cache per sicurezza se c'è stato un fallimento parziale
        this._invalidateCache(`memory_${threadId}`);
        Utilities.sleep(Math.pow(2, i) * 200);
      } finally {
        if (lockAcquired) {
          lock.releaseLock();
        }
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

    const lock = LockService.getScriptLock();

    let lockAcquired = false;
    try {
      lockAcquired = lock.tryLock(3000);
      if (!lockAcquired) return; // Rinuncia se lockato

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
      if (lockAcquired) {
        lock.releaseLock();
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
      this.updateMemoryAtomic(threadId, {}, newInfos);
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

    // Usa TextFinder per cercare l'ID direttamente (Operazione O(1) lato script)
    const finder = this._sheet.createTextFinder(threadId)
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
   * Converte array riga in oggetto
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