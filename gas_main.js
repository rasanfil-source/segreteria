/**
 * Main.gs - Entry point del sistema autoresponder
 * Gestisce trigger, inizializzazione e orchestrazione principale
 * Include logica sospensione oraria e festività italiane
 */

// ====================================================================
// FESTIVITÀ E SOSPENSIONE
// ====================================================================

// Costanti per mesi (JavaScript usa indici 0-11)
const MONTH = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
};

// Giorni in cui il sistema DEVE rispondere (dipendenti in ferie)
const ALWAYS_OPERATING_DAYS = [
  [MONTH.JAN, 1],    // Capodanno
  [MONTH.JAN, 6],    // Epifania
  [MONTH.APR, 25],   // Liberazione
  [MONTH.MAY, 1],    // Festa del Lavoro
  [MONTH.JUN, 29],   // SS. Pietro e Paolo
  [MONTH.AUG, 15],   // Assunzione (Ferragosto)
  [MONTH.NOV, 1],    // Ognissanti
  [MONTH.DEC, 8],    // Immacolata
  [MONTH.DEC, 25],   // Natale
  [MONTH.DEC, 26]    // Santo Stefano
];

// Orari di sospensione per giorno della settimana
// Sistema SOSPESO durante questi orari (la segreteria è operativa)
const SUSPENSION_HOURS = {
  1: [[8, 20]],    // Lunedì: 8–20
  2: [[8, 14]],    // Martedì: 8–14
  3: [[8, 17]],    // Mercoledì: 8–17
  4: [[8, 14]],    // Giovedì: 8–14
  5: [[8, 17]]     // Venerdì: 8–17
};

/**
 * Calcola la Domenica di Pasqua per un dato anno (calendario occidentale/gregoriano)
 * @param {number} year - Anno
 * @returns {Date} Data della Pasqua
 */
function calculateEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * Verifica se una data ricade in uno dei periodi ferie del segretario
 * I periodi sono letti dal foglio Controllo (righe 6-10)
 * @param {Date} date - Data da verificare
 * @returns {boolean} True se siamo in periodo di ferie
 */
function isInVacationPeriod(date = new Date()) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    console.warn('⚠️ Data non valida passata a isInVacationPeriod');
    return false;
  }

  const periods = GLOBAL_CACHE.vacationPeriods;
  if (!periods || periods.length === 0) {
    return false;
  }

  // Normalizza a mezzanotte per confronto corretto
  const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  for (const vp of periods) {
    const start = new Date(vp.start.getFullYear(), vp.start.getMonth(), vp.start.getDate());
    const end = new Date(vp.end.getFullYear(), vp.end.getMonth(), vp.end.getDate());

    if (checkDate >= start && checkDate <= end) {
      return true;
    }
  }

  return false;
}

/**
 * Verifica se il sistema dovrebbe essere SOSPESO
 * @param {Date} checkDate - Data/ora da verificare (default: ora corrente)
 * @returns {boolean} TRUE = Sospeso (segreteria operativa), FALSE = Attivo (bot risponde)
 */
function isInSuspensionTime(checkDate = new Date()) {
  const now = checkDate;
  const year = now.getFullYear();
  const monthIndex = now.getMonth();       // 0-based (0=Gennaio)
  const month1Based = monthIndex + 1;      // 1-based (1=Gennaio)
  const date = now.getDate();
  const day = now.getDay();                // 0=Domenica
  const hour = now.getHours();

  // ────────────────────────────────────────────────────────────────
  // 1. CONTROLLO GIORNI "SEMPRE OPERATIVI" (priorità)
  // Se è un giorno festivo, il sistema DEVE funzionare
  // ────────────────────────────────────────────────────────────────

  // A. Festività fisse
  for (const [hMonth, hDay] of ALWAYS_OPERATING_DAYS) {
    if (monthIndex === hMonth && date === hDay) {
      console.log('📅 Giorno festivo fisso (sistema attivo)');
      return false;
    }
  }

  // Periodo speciale: 24 e 31 dicembre dalle 14:00
  if (month1Based === 12 && ((date === 24 && hour >= 14) || date === 25 || date === 26 || (date === 31 && hour >= 14))) {
    console.log('📅 Periodo speciale attivo (Natale/Capodanno)');
    return false;
  }

  // B. Date mobili: Pasqua e giorni correlati
  const easter = calculateEaster(year);

  // Pasquetta (Pasqua + 1 giorno)
  const pasquetta = new Date(easter);
  pasquetta.setDate(easter.getDate() + 1);
  if (month1Based === (pasquetta.getMonth() + 1) && date === pasquetta.getDate()) {
    console.log('📅 Pasquetta (sistema attivo)');
    return false;
  }

  // Sabato Santo (Pasqua - 1 giorno)
  const holySaturday = new Date(easter);
  holySaturday.setDate(easter.getDate() - 1);
  if (month1Based === (holySaturday.getMonth() + 1) && date === holySaturday.getDate()) {
    console.log('📅 Sabato Santo (sistema attivo)');
    return false;
  }

  // C. Periodo ferie segretario (dinamico da Sheet)
  if (isInVacationPeriod(now)) {
    console.log('📅 Periodo ferie segretario (sistema attivo)');
    return false;
  }

  // ────────────────────────────────────────────────────────────────
  // 2. CONTROLLO ORARI UFFICIO REGOLARI
  // Se non è festivo, verifica se i dipendenti stanno lavorando
  // ────────────────────────────────────────────────────────────────

  if (SUSPENSION_HOURS[day]) {
    for (const [startH, endH] of SUSPENSION_HOURS[day]) {
      if (hour >= startH && hour < endH) {
        return true; // SOSPESO (segreteria operativa)
      }
    }
  }

  // Default: non in orari di sospensione → sistema attivo
  return false;
}

/**
 * Regole messe speciali per giorni festivi infrasettimanali
 * In questi giorni la Messa è SOLO alle 19:00 (tranne domenica)
 * @param {Date} date - Data da verificare
 * @returns {string|null} Testo regola speciale o null
 */
function getSpecialMassTimeRule(date = new Date()) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return null;
  }
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekDay = date.getDay();

  // Se è domenica, si applicano le regole domenicali standard
  if (weekDay === 0) return null;

  // Giorni festivi fissi con messa alle 19:00
  const giorniFissiSpeciali = [
    [4, 25],  // Anniversario Liberazione
    [5, 1],   // Festa del Lavoro
    [6, 2],   // Festa della Repubblica
    [12, 26]  // Santo Stefano
  ];

  let isSpecial = false;

  for (const [m, d] of giorniFissiSpeciali) {
    if (month === m && day === d) {
      isSpecial = true;
      break;
    }
  }

  // Controlla anche Pasquetta
  if (!isSpecial) {
    const easter = calculateEaster(date.getFullYear());
    const pasquetta = new Date(easter);
    pasquetta.setDate(easter.getDate() + 1);

    if (month === (pasquetta.getMonth() + 1) && day === pasquetta.getDate()) {
      isSpecial = true;
    }
  }

  if (isSpecial) {
    return `
════════════════════════════════════════════════════════════════════════
🚨 REGOLA SPECIALE ORARIO MESSA (OGGI È GIORNO FESTIVO INFRASETTIMANALE)
════════════════════════════════════════════════════════════════════════
ATTENZIONE: Oggi è un giorno festivo speciale.
REGOLA: In questi giorni, la Santa Messa viene celebrata ESCLUSIVAMENTE alle ore 19:00.
NON citare orari feriali standard.
════════════════════════════════════════════════════════════════════════
`;
  }

  return null;
}

// ====================================================================
// CARICAMENTO RISORSE
// ====================================================================

/**
 * Esegue operazione Sheets con retry automatico
 * Gestisce errori transienti (503, timeout) con exponential backoff
 * @param {Function} fn - Funzione che esegue operazione Sheets
 * @param {string} context - Descrizione per logging
 * @returns {*} Risultato della funzione
 */
function withSheetsRetry(fn, context = 'Operazione Sheets') {
  const maxRetries = CONFIG.SHEETS_RETRY_MAX || 3;
  const baseBackoff = CONFIG.SHEETS_RETRY_BACKOFF_MS || 1000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return fn();
    } catch (error) {
      // Normalizzazione messaggio errore per sicurezza
      const message = String(error.message || '');

      const isRetryable = message.includes('503') ||
        message.includes('500') ||
        message.includes('timeout') ||
        message.includes('Timeout') ||
        message.includes('Service invoked too many times');

      if (isRetryable && attempt < maxRetries - 1) {
        const waitMs = baseBackoff * Math.pow(2, attempt);
        console.warn(`⚠️ ${context} fallito (tentativo ${attempt + 1}/${maxRetries}): ${error.message}. Retry tra ${waitMs}ms...`);
        Utilities.sleep(waitMs);
        continue;
      }

      throw error;
    }
  }
}

/**
 * Converte dati foglio in formato strutturato (array di oggetti)
 * @param {Array[]} data - Dati grezzi dal foglio
 * @returns {Object[]} Array di oggetti con header come chiavi
 */
function _parseSheetToStructured(data) {
  if (!data || data.length < 2) return [];

  const headers = data[0].map(h => String(h).trim());
  const result = [];

  for (let i = 1; i < data.length; i++) {
    const row = {};
    headers.forEach((header, j) => {
      row[header] = data[i][j] !== undefined ? data[i][j] : '';
    });
    result.push(row);
  }

  return result;
}

/**
 * Carica tutte le risorse necessarie (Knowledge Base, sostituzioni, ferie)
 * Usa lock per prevenire race condition tra esecuzioni parallele
 */
/**
 * Carica periodi ferie dal foglio Controllo
 * @param {Spreadsheet} spreadsheet
 */
function _loadVacationPeriodsFromSheet(spreadsheet) {
  try {
    const controlSheet = spreadsheet.getSheetByName('Controllo');
    if (controlSheet) {
      const ferieRows = controlSheet.getRange('A6:C10').getValues();
      const validPeriods = [];

      for (const row of ferieRows) {
        if (!row[1] || !row[2]) continue;

        let startDate, endDate;
        try {
          startDate = new Date(row[1]);
          endDate = new Date(row[2]);

          if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            console.warn(`⚠️ Formato data non valido: ${row[1]} - ${row[2]}`);
            continue;
          }

          if (endDate < startDate) {
            console.warn(`⚠️ Data fine precedente a data inizio: ${startDate.toLocaleDateString()} > ${endDate.toLocaleDateString()}`);
            continue;
          }

          validPeriods.push({ start: startDate, end: endDate });
        } catch (parsingErr) {
          console.warn(`⚠️ Errore parsing date ferie: ${parsingErr.message}`);
          continue;
        }
      }

      if (validPeriods.length > 0) {
        console.log(`✓ Periodi ferie caricati: ${validPeriods.length} periodo/i`);
        return validPeriods;
      }
    } else {
      console.warn('⚠️ Foglio "Controllo" non trovato - periodi ferie non caricati');
    }
  } catch (ferieErr) {
    console.warn(`⚠️ Impossibile caricare periodi ferie: ${ferieErr.message}`);
  }
  return [];
}

/**
 * Carica tutte le risorse necessarie (Knowledge Base, sostituzioni, ferie)
 * Usa lock per prevenire race condition tra esecuzioni parallele
 */
function loadResources() {
  const lock = LockService.getScriptLock();

  try {
    // Tenta di acquisire lock per 10 secondi
    // Gestione concorrenza: Se il lock fallisce, prosegue se la cache è vuota.
    // L'istanza corrente necessita dei dati per procedere.
    if (!lock.tryLock(10000)) {
      console.warn('⚠️ Impossibile acquisire lock per loadResources (timeout 10s)');
      if (!GLOBAL_CACHE.loaded) {
        console.warn('⚠️ Cache locale vuota: procedo comunque al caricamento (ignoro lock fallito)');
      } else {
        console.log('ℹ️ Cache già carica, salto reload');
        return;
      }
    }

    // Verifica se risorse già caricate (double-checked locking)
    if (GLOBAL_CACHE.loaded) {
      return;
    }

    GLOBAL_CACHE.vacationPeriods = [];
    console.log('📦 Caricamento risorse...');

    const cache = CacheService.getScriptCache();
    const cachedKB = cache.get('KB_CONTENT');

    // CACHE HIT - FAST PATH
    if (cachedKB && !CONFIG.FORCE_RELOAD) {
      GLOBAL_CACHE.knowledgeBase = cachedKB;
      console.log('📦 KB caricata da ScriptCache (Fast)');

      // Carichiamo solo le ferie (leggero)
      withSheetsRetry(() => {
        const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
        GLOBAL_CACHE.vacationPeriods = _loadVacationPeriodsFromSheet(spreadsheet);
      }, 'Caricamento Ferie (Cache)');

      GLOBAL_CACHE.loaded = true;
      return;
    }

    // CACHE MISS - FULL LOAD
    withSheetsRetry(() => {
      const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

      // Carica Knowledge Base (Istruzioni)
      const kbSheet = spreadsheet.getSheetByName(CONFIG.KB_SHEET_NAME);
      if (kbSheet) {
        const kbData = kbSheet.getDataRange().getValues();
        GLOBAL_CACHE.knowledgeBase = kbData.map(row => row.join(' | ')).join('\n');
        GLOBAL_CACHE.knowledgeStructured = _parseSheetToStructured(kbData);
        console.log(`✓ Knowledge Base caricata: ${GLOBAL_CACHE.knowledgeBase.length} caratteri`);

        // SALVATAGGIO IN CACHE DOPO IL CARICAMENTO
        if (GLOBAL_CACHE.knowledgeBase) {
          // CacheService ha limite 100KB per valore
          if (GLOBAL_CACHE.knowledgeBase.length < 100000) {
            cache.put('KB_CONTENT', GLOBAL_CACHE.knowledgeBase, 21600); // 6 ore
          }
        }
      } else {
        console.warn(`⚠️ Foglio '${CONFIG.KB_SHEET_NAME}' non trovato`);
      }

      // Carica periodi ferie
      GLOBAL_CACHE.vacationPeriods = _loadVacationPeriodsFromSheet(spreadsheet);

      // Carica AI_CORE_LITE (principi pastorali base)
      const liteSheet = spreadsheet.getSheetByName(CONFIG.AI_CORE_LITE_SHEET);
      if (liteSheet) {
        const liteData = liteSheet.getDataRange().getValues();
        GLOBAL_CACHE.aiCoreLite = liteData.map(row => row.join(' | ')).join('\n');
        GLOBAL_CACHE.aiCoreLiteStructured = _parseSheetToStructured(liteData);
        console.log(`✓ AI_CORE_LITE caricato: ${GLOBAL_CACHE.aiCoreLite.length} caratteri`);
      }

      // Carica AI_CORE (principi pastorali estesi)
      const coreSheet = spreadsheet.getSheetByName(CONFIG.AI_CORE_SHEET);
      if (coreSheet) {
        const coreData = coreSheet.getDataRange().getValues();
        GLOBAL_CACHE.aiCore = coreData.map(row => row.join(' | ')).join('\n');
        GLOBAL_CACHE.aiCoreStructured = _parseSheetToStructured(coreData);
        console.log(`✓ AI_CORE caricato: ${GLOBAL_CACHE.aiCore.length} caratteri`);
      }

      // Carica Dottrina (base dottrinale completa)
      const doctrineSheet = spreadsheet.getSheetByName(CONFIG.DOCTRINE_SHEET);
      if (doctrineSheet) {
        const doctrineData = doctrineSheet.getDataRange().getValues();
        GLOBAL_CACHE.doctrineBase = doctrineData.map(row => row.join(' | ')).join('\n');
        GLOBAL_CACHE.doctrineStructured = _parseSheetToStructured(doctrineData);
        console.log(`✓ Dottrina caricata: ${GLOBAL_CACHE.doctrineBase.length} caratteri`);
      }

      // Carica Sostituzioni (correzioni automatiche testo)
      try {
        const replSheet = spreadsheet.getSheetByName(CONFIG.REPLACEMENTS_SHEET_NAME);
        if (replSheet) {
          const replData = replSheet.getDataRange().getValues();
          for (let i = 1; i < replData.length; i++) {
            const [badText, goodText] = replData[i];
            if (badText && goodText) {
              GLOBAL_CACHE.replacements[String(badText).trim()] = String(goodText).trim();
            }
          }
          console.log(`✓ Sostituzioni caricate: ${Object.keys(GLOBAL_CACHE.replacements).length}`);
        }
      } catch (replError) {
        console.warn(`⚠️ Impossibile caricare sostituzioni: ${replError.message}`);
      }
    }, 'loadResources');

    GLOBAL_CACHE.loaded = true;
    console.log('✓ Tutte le risorse caricate con successo');

  } catch (error) {
    console.error(`❌ Errore caricamento risorse: ${error.message}`);
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {
      console.warn(`⚠️ Errore rilascio ScriptLock: ${e.message}`);
    }
  }
}

// ====================================================================
// ASSERZIONE CONFIGURAZIONE CRITICA
// ====================================================================

/**
 * Verifica presenza configurazione critica (fail-fast)
 * @throws {Error} Se manca configurazione essenziale
 */
function assertCriticalConfig() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GEMINI_API_KEY')) {
    throw new Error('❌ GEMINI_API_KEY mancante in Script Properties');
  }
  if (!props.getProperty('SPREADSHEET_ID')) {
    throw new Error('❌ SPREADSHEET_ID mancante in Script Properties');
  }
}

// ====================================================================
// ENTRY POINT PRINCIPALE
// ====================================================================

/**
 * Funzione principale da collegare al trigger temporizzato
 * Eseguire ogni 5-15 minuti
 */
function main() {
  console.log('\n' + '═'.repeat(70));
  console.log('🚀 AVVIO ELABORAZIONE EMAIL');
  console.log('═'.repeat(70));
  console.log(`⏰ ${new Date().toLocaleString('it-IT')}`);

  // Lock globale per prevenire esecuzioni parallele (sovrapposizione trigger)
  const executionLock = LockService.getScriptLock();
  try {
    if (!executionLock.tryLock(5000)) {
      console.warn('⚠️ Un\'altra istanza del bot è già in esecuzione. Salto questo turno.');
      return;
    }

    // Fail-fast su configurazione mancante
    assertCriticalConfig();

    // Carica risorse PRIMA di controllare sospensione
    // (Altrimenti i periodi ferie non sono ancora in cache)
    loadResources();

    // Controlla sospensione (ORA le ferie sono caricate)
    if (isInSuspensionTime()) {
      console.log('⏸️ Servizio sospeso: orario di lavoro segreteria');
      return;
    }

    // Safety Valve: graceful degradation se quota > 80%
    if (CONFIG.USE_RATE_LIMITER) {
      try {
        const limiter = new GeminiRateLimiter();
        const stats = limiter.getUsageStats();
        let maxPercent = 0;

        for (const modelKey in stats.models) {
          const percent = parseFloat(stats.models[modelKey].rpd.percent);
          if (percent > maxPercent) maxPercent = percent;
        }

        if (maxPercent > 80) {
          const originalLimit = CONFIG.MAX_EMAILS_PER_RUN;
          CONFIG.MAX_EMAILS_PER_RUN = Math.max(1, Math.floor(originalLimit / 2));
          console.warn(`🚨 SAFETY VALVE ATTIVA (quota RPD max: ${maxPercent}%): ridotto MAX_EMAILS_PER_RUN a ${CONFIG.MAX_EMAILS_PER_RUN}`);
        }
      } catch (e) {
        console.warn(`⚠️ Errore calcolo Safety Valve: ${e.message}`);
      }
    }

    if (!GLOBAL_CACHE.knowledgeBase) {
      console.error('❌ Knowledge Base non caricata, esco');
      return;
    }

    // Crea ed esegui processore email
    try {
      const processor = new EmailProcessor();
      const stats = processor.processUnreadEmails(
        GLOBAL_CACHE.knowledgeBase,
        GLOBAL_CACHE.doctrineBase
      );

      console.log('\n✓ Elaborazione completata');
      console.log(`   Processate: ${stats.total}, Risposte: ${stats.replied}, Filtrate: ${stats.filtered}`);

    } catch (error) {
      console.error(`❌ Errore fatale: ${error.message}`);
    }
  } finally {
    // Rilascia sempre il lock globale
    try {
      executionLock.releaseLock();
    } catch (e) { }
  }
}

// ====================================================================
// FUNZIONI UTILITÀ E TEST
// ====================================================================

/**
 * Crea o aggiorna il trigger temporizzato
 * Eseguire questa funzione manualmente una volta per setup iniziale
 */
function setupTrigger() {
  // Elimina trigger esistenti per main
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Crea nuovo trigger ogni 10 minuti
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyMinutes(5)
    .create();

  console.log('✓ Trigger configurato (ogni 5 minuti)');
}

/**
 * Rimuove tutti i trigger per main
 * Utile per manutenzione o risoluzione problemi
 */
function removeTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  console.log('✓ Tutti i trigger rimossi');
}

/**
 * Test connessione API Gemini
 */
function testGeminiConnection() {
  console.log('🧪 Test connessione Gemini...');
  const gemini = new GeminiService();
  const result = gemini.testConnection();
  console.log('Risultato:', JSON.stringify(result, null, 2));
  return result;
}

/**
 * Test pipeline senza inviare email
 */
function testDryRun() {
  console.log('🧪 Avvio DRY RUN...');
  CONFIG.DRY_RUN = true;
  main();
}

/**
 * Test logica festività e sospensione
 */
function testHolidayLogic() {
  console.log('🧪 TEST LOGICA FESTIVITÀ...');

  const testCases = [
    // Festività (devono essere ATTIVO = sistema risponde)
    { label: 'Natale (giovedì)', d: new Date(2025, 11, 25, 10, 0), expectSuspended: false },
    { label: 'Santo Stefano', d: new Date(2025, 11, 26, 10, 0), expectSuspended: false },
    { label: 'Capodanno', d: new Date(2025, 0, 1, 10, 0), expectSuspended: false },
    { label: 'Epifania', d: new Date(2025, 0, 6, 10, 0), expectSuspended: false },
    { label: 'Liberazione', d: new Date(2025, 3, 25, 10, 0), expectSuspended: false },
    { label: '1 Maggio', d: new Date(2025, 4, 1, 10, 0), expectSuspended: false },
    { label: 'SS Pietro Paolo', d: new Date(2025, 5, 29, 10, 0), expectSuspended: false },
    { label: 'Ferragosto', d: new Date(2025, 7, 15, 10, 0), expectSuspended: false },

    // Orari lavorativi (devono essere SOSPESO)
    { label: 'Giovedì lavorativo ore 10', d: new Date(2025, 9, 16, 10, 0), expectSuspended: true },
    { label: 'Giovedì sera ore 20', d: new Date(2025, 9, 16, 20, 0), expectSuspended: false },

    // Weekend (dovrebbe essere ATTIVO)
    { label: 'Domenica ore 10', d: new Date(2025, 9, 12, 10, 0), expectSuspended: false }
  ];

  let passed = 0;
  console.log('───────────────────────────────────────────────────');
  testCases.forEach(tc => {
    const isSuspended = isInSuspensionTime(tc.d);
    const ok = isSuspended === tc.expectSuspended;
    if (ok) passed++;

    const statusIcon = ok ? '✅' : '❌';
    const resultStr = isSuspended ? 'SOSPESO' : 'ATTIVO';
    console.log(`${statusIcon} ${tc.label} → ${resultStr}`);

    if (!ok) {
      console.log(`   Atteso: ${tc.expectSuspended ? 'SOSPESO' : 'ATTIVO'} | Data: ${tc.d.toLocaleString()}`);
    }
  });
  console.log('───────────────────────────────────────────────────');
  console.log(`Risultato: ${passed}/${testCases.length} test superati.`);
}

/**
 * Esegue healthcheck e mostra risultati
 */
function runHealthCheck() {
  const health = healthCheck();
  console.log('📋 Risultati Health Check:', JSON.stringify(health, null, 2));
  return health;
}

// ====================================================================
// METRICHE GIORNALIERE
// ====================================================================

/**
 * Esporta metriche giornaliere su foglio Google Sheets
 * Configurare METRICS_SHEET_ID in Script Properties per abilitare
 */
function exportMetricsToSheet() {
  console.log('📊 Esportazione metriche giornaliere...');

  if (!CONFIG.METRICS_SHEET_ID) {
    console.warn('⚠️ METRICS_SHEET_ID non configurato in Script Properties, salto export');
    return;
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.METRICS_SHEET_ID);
    let metricsSheet = spreadsheet.getSheetByName(CONFIG.METRICS_SHEET_NAME || 'DailyMetrics');

    // Crea foglio se non esiste con intestazioni
    if (!metricsSheet) {
      metricsSheet = spreadsheet.insertSheet(CONFIG.METRICS_SHEET_NAME || 'DailyMetrics');
      metricsSheet.appendRow(['Data', 'OraExport', 'QuotaRPD_Max%', 'Modello', 'TokenTotali']);
      metricsSheet.getRange(1, 1, 1, 5).setFontWeight('bold');
      console.log('✓ Foglio DailyMetrics creato');
    }

    // Raccogli statistiche quota
    const limiter = new GeminiRateLimiter();
    const quotaStats = limiter.getUsageStats();

    // Trova modello con max RPD%
    let maxRpdPercent = 0;
    let maxModel = '';
    let totalTokens = 0;

    for (const modelKey in quotaStats.models) {
      const model = quotaStats.models[modelKey];
      const percent = parseFloat(model.rpd.percent);
      if (percent > maxRpdPercent) {
        maxRpdPercent = percent;
        maxModel = modelKey;
      }
      totalTokens += model.tokensToday || 0;
    }

    // Prepara riga metriche
    const stats = {
      date: new Date().toISOString().split('T')[0],
      time: Utilities.formatDate(new Date(), 'Europe/Rome', 'HH:mm'),
      quotaRpd: maxRpdPercent.toFixed(1) + '%',
      model: maxModel,
      tokens: totalTokens
    };

    metricsSheet.appendRow(Object.values(stats));
    console.log(`✓ Metriche esportate: ${stats.date} - RPD max ${stats.quotaRpd} (${stats.model})`);

  } catch (error) {
    console.error(`❌ Errore export metriche: ${error.message}`);
  }
}

/**
 * Configura trigger giornaliero per export metriche alle 23:00
 * Eseguire manualmente una volta per attivare
 */
function setupMetricsTrigger() {
  // Rimuovi trigger esistenti per questa funzione
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'exportMetricsToSheet') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Crea trigger giornaliero alle 23:00
  ScriptApp.newTrigger('exportMetricsToSheet')
    .timeBased()
    .atHour(23)
    .everyDays(1)
    .create();

  console.log('✓ Trigger metriche configurato (ogni giorno alle 23:00)');
}