/**
 * Main.js - Entry point del sistema autoresponder
 * Gestisce trigger, inizializzazione e orchestrazione principale
 * Include logica sospensione oraria e festività italiane
 */

// Inizializzazione difensiva cache globale condivisa tra moduli
var GLOBAL_CACHE = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE) ? GLOBAL_CACHE : {
  loaded: false,
  lastLoadedAt: 0,
  knowledgeBase: '',
  doctrineBase: '',
  systemEnabled: true,
  vacationPeriods: [],
  suspensionRules: {},
  ignoreDomains: [],
  ignoreKeywords: [],
  replacements: {}
};

// TTL in-RAM valido nella singola esecuzione: cross-esecuzione la cache reale è CacheService.
const RESOURCE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 ore

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
  [MONTH.JUN, 2],    // Festa della Repubblica
  [MONTH.JUN, 29],   // SS. Pietro e Paolo
  [MONTH.AUG, 15],   // Assunzione (Ferragosto)
  [MONTH.NOV, 1],    // Ognissanti
  [MONTH.DEC, 8],    // Immacolata
  [MONTH.DEC, 25],   // Natale
  [MONTH.DEC, 26]    // Santo Stefano
];

// ====================================================================
// ⚠️ WARNING: NON CANCELLARE QUESTO BLOCCO STATIC (Fallback Sicurezza)
// Orari di sospensione per giorno della settimana
// Sistema SOSPESO durante questi orari. 
// Usato come FALLBACK SICURO se il Foglio "Controllo" è irraggiungibile o formattato male.
// Qualsiasi sviluppatore intenda rimuoverlo causerà malfunzionamenti fuori orario in caso di failure API.
const SUSPENSION_HOURS = {
  1: [[8, 20]],    // Lunedì: 8–20
  2: [[8, 14]],    // Martedì: 8–14
  3: [[8, 17]],    // Mercoledì: 8–17
  4: [[8, 14]],    // Giovedì: 8–14
  5: [[8, 17]]     // Venerdì: 8–17
};

/**
 * Calcola la Domenica di Pasqua per un dato anno (calendario occidentale/gregoriano)
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
  // Usa mezzogiorno locale per evitare slittamenti di data in conversioni timezone/DST
  return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * Verifica se una data ricade in uno dei periodi ferie del segretario
 */
function isInVacationPeriod(date = new Date(), scriptTimeZone = "") {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    console.warn('⚠️ Data non valida passata a isInVacationPeriod');
    return false;
  }

  if (typeof GLOBAL_CACHE === 'undefined' || !GLOBAL_CACHE.vacationPeriods) {
    return false;
  }

  const periods = GLOBAL_CACHE.vacationPeriods;
  if (!periods || periods.length === 0) {
    return false;
  }

  // Normalizza input a data-only nel fuso dello script per evitare slittamenti ai confini UTC.
  const formatDateOnly = function (value) {
    const source = (value instanceof Date) ? value : new Date(value);
    if (isNaN(source.getTime())) return '';

    if (scriptTimeZone && typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      try {
        return Utilities.formatDate(source, scriptTimeZone, 'yyyy-MM-dd');
      } catch (e) {
        console.warn(`⚠️ Impossibile applicare timezone script (${scriptTimeZone}) in isInVacationPeriod: ${e.message}`);
      }
    }

    // Fallback locale: mantiene compatibilità anche in test/mocking senza Utilities.
    const y = source.getFullYear();
    const m = String(source.getMonth() + 1).padStart(2, '0');
    const d = String(source.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const checkDateKey = formatDateOnly(date);
  if (!checkDateKey) return false;

  for (const vp of periods) {
    if (!vp || !vp.start || !vp.end) continue;

    const startKey = formatDateOnly(vp.start);
    const endKey = formatDateOnly(vp.end);
    if (!startKey || !endKey) continue;

    if (checkDateKey >= startKey && checkDateKey <= endKey) return true;
  }

  return false;
}

/**
 * Verifica se il sistema dovrebbe essere SOSPESO
 */
function isInSuspensionTime(checkDate = new Date()) {
  const now = checkDate;

  const isSameCalendarDay = (left, right) => {
    if (!(left instanceof Date) || isNaN(left.getTime()) || !(right instanceof Date) || isNaN(right.getTime())) {
      return false;
    }
    return left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate();
  };

  let year = now.getFullYear();
  let monthIndex = now.getMonth();
  let date = now.getDate();
  let day = now.getDay();
  let hour = now.getHours();

  // Regola di dominio: la sospensione è ancorata all'orario italiano.
  const businessTimeZone = 'Europe/Rome';

  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    try {
      year = parseInt(Utilities.formatDate(now, businessTimeZone, 'yyyy'), 10);
      monthIndex = parseInt(Utilities.formatDate(now, businessTimeZone, 'M'), 10) - 1;
      date = parseInt(Utilities.formatDate(now, businessTimeZone, 'd'), 10);
      const isoDay = parseInt(Utilities.formatDate(now, businessTimeZone, 'u'), 10);
      day = isNaN(isoDay) ? day : (isoDay % 7);
      hour = parseInt(Utilities.formatDate(now, businessTimeZone, 'H'), 10);
    } catch (e) {
      console.warn(`⚠️ Impossibile applicare timezone business (${businessTimeZone}): ${e.message}`);
    }
  }

  // 1. GESTIONE FESTIVI (Priorità: Sistema ATTIVO)
  for (const [hMonth, hDay] of ALWAYS_OPERATING_DAYS) {
    if (monthIndex === hMonth && date === hDay) return false;
  }

  // Domenica di Pasqua, Pasquetta, Sabato Santo
  const easter = calculateEaster(year);
  const normalizedNow = new Date(year, monthIndex, date, 12, 0, 0);
  if (isSameCalendarDay(normalizedNow, easter)) return false;

  // Nota manutenzione: base su "easter" è intenzionale per leggibilità semantica.
  const pasquetta = new Date(easter);
  pasquetta.setDate(easter.getDate() + 1);
  if (isSameCalendarDay(normalizedNow, pasquetta)) return false;

  const holySaturday = new Date(easter);
  holySaturday.setDate(easter.getDate() - 1);
  if (isSameCalendarDay(normalizedNow, holySaturday)) return false;

  // Ferie Segretario (Sheet)
  if (isInVacationPeriod(now, businessTimeZone)) return false;

  // 2. ORARI UFFICIO (Sistema SOSPESO)
  // Utilizza i dati caricati dal foglio Controllo in (A10:D16/B10:E16) durante il loadResources
  // Se non presenti, usa il fallback definito via codice in SUSPENSION_HOURS
  const rules = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE.suspensionRules && Object.keys(GLOBAL_CACHE.suspensionRules).length > 0)
    ? GLOBAL_CACHE.suspensionRules
    : SUSPENSION_HOURS;

  if (rules[day]) {
    for (const [startH, endH] of rules[day]) {
      const startHour = parseInt(startH, 10);
      const endHour = parseInt(endH, 10);
      if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) {
        continue;
      }

      if (hour >= startHour && hour < endHour) return true;
    }
  }

  return false;
}

/**
 * Paracadute operativo: se esistono email non lette molto vecchie,
 * permette un ciclo di lavorazione anche durante la sospensione.
 */
function hasStaleUnreadThreads(maxAgeHours = 12, searchLimit = 20) {
  const cutoffMs = Date.now() - (maxAgeHours * 60 * 60 * 1000);

  const labelName = (typeof CONFIG !== 'undefined' && CONFIG.LABEL_NAME) ? CONFIG.LABEL_NAME : 'IA';
  const errorLabel = (typeof CONFIG !== 'undefined' && CONFIG.ERROR_LABEL_NAME) ? CONFIG.ERROR_LABEL_NAME : 'Errore';
  const validationLabel = (typeof CONFIG !== 'undefined' && CONFIG.VALIDATION_ERROR_LABEL) ? CONFIG.VALIDATION_ERROR_LABEL : 'Verifica';
  const quoteLabel = (label) => `"${String(label).replace(/"/g, '\\"')}"`;

  const query = `in:inbox is:unread -label:${quoteLabel(labelName)} -label:${quoteLabel(errorLabel)} -label:${quoteLabel(validationLabel)}`;
  const threads = GmailApp.search(query, 0, searchLimit);

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const message of messages) {
      if (!message.isUnread()) continue;
      const messageDate = message.getDate();
      if (messageDate && messageDate.getTime() <= cutoffMs) {
        return true;
      }
    }
  }

  return false;
}

// ====================================================================
// CARICAMENTO RISORSE
// ====================================================================

function withSheetsRetry(fn, context = 'Operazione Sheets') {
  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (attempt < maxRetries - 1) {
        Utilities.sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      throw error;
    }
  }
}

function loadResources(acquireLock = true, hasExternalLock = false) {
  if (!acquireLock && !hasExternalLock) {
    throw new Error('loadResources richiede un lock preventivo.');
  }

  if (typeof GLOBAL_CACHE === 'undefined' || !GLOBAL_CACHE) {
    throw new Error('GLOBAL_CACHE non inizializzata: impossibile caricare risorse in sicurezza.');
  }

  const now = Date.now();
  const cacheIsFresh = GLOBAL_CACHE.loaded && GLOBAL_CACHE.lastLoadedAt && ((now - GLOBAL_CACHE.lastLoadedAt) < RESOURCE_CACHE_TTL_MS);
  if (cacheIsFresh) return;

  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    if (acquireLock) {
      lockAcquired = lock.tryLock(10000);
      if (!lockAcquired && !GLOBAL_CACHE.loaded) {
        throw new Error('Impossibile acquisire lock per caricamento risorse.');
      }
    }

    _loadResourcesInternal();
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function _loadResourcesInternal() {
  const cache = (typeof CacheService !== 'undefined') ? CacheService.getScriptCache() : null;
  const CACHE_KEY = 'SPA_KNOWLEDGE_BASE_V1';

  // 1. Prova a leggere dalla vera Cache di Apps Script
  if (cache) {
    const cachedData = cache.get(CACHE_KEY);
    if (cachedData) {
      try {
        const parsedData = JSON.parse(cachedData);
        Object.assign(GLOBAL_CACHE, parsedData);
        GLOBAL_CACHE.loaded = true;
        console.log('✓ Risorse caricate dalla Cache veloce.');
        return;
      } catch (e) {
        console.warn('⚠️ Cache corrotta o obsoleta, ricaricamento dai fogli...');
      }
    }
  }

  const spreadsheetId = (typeof CONFIG !== 'undefined' && CONFIG.SPREADSHEET_ID) ? CONFIG.SPREADSHEET_ID : null;
  if (!spreadsheetId) {
    throw new Error('Impossibile aprire il foglio: CONFIG.SPREADSHEET_ID non configurato.');
  }

  let ss;
  try {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } catch (e) {
    throw new Error('Impossibile aprire il foglio. Verifica CONFIG.SPREADSHEET_ID. Dettaglio: ' + e.message);
  }

  // Hardening: evita crash se CONFIG non è ancora inizializzato (ordine file GAS)
  const cfg = (typeof CONFIG !== 'undefined' && CONFIG) ? CONFIG : {
    KB_SHEET_NAME: 'Istruzioni',
    AI_CORE_LITE_SHEET: 'AI_CORE_LITE',
    AI_CORE_SHEET: 'AI_CORE',
    DOCTRINE_SHEET: 'Dottrina',
    REPLACEMENTS_SHEET_NAME: 'Sostituzioni'
  };

  const newCacheData = {};

  // KB Base
  const kbSheet = ss.getSheetByName(cfg.KB_SHEET_NAME);
  if (kbSheet) {
    withSheetsRetry(() => {
      const kbData = kbSheet.getDataRange().getValues();
      newCacheData.knowledgeBase = _sheetRowsToText(kbData);
    }, 'Lettura KB Base');
  } else {
    newCacheData.knowledgeBase = '';
  }

  // Prompt resources aggiuntive (usate da PromptEngine)
  const aiCoreLiteSheet = ss.getSheetByName(cfg.AI_CORE_LITE_SHEET);
  newCacheData.aiCoreLite = '';
  if (aiCoreLiteSheet) {
    withSheetsRetry(() => {
      newCacheData.aiCoreLite = _sheetRowsToText(aiCoreLiteSheet.getDataRange().getValues());
    }, 'Lettura AI_CORE_LITE');
  }

  const aiCoreSheet = ss.getSheetByName(cfg.AI_CORE_SHEET);
  if (aiCoreSheet) {
    withSheetsRetry(() => {
      const aiCoreData = aiCoreSheet.getDataRange().getValues();
      newCacheData.aiCoreStructured = _parseSheetToStructured(aiCoreData);
      newCacheData.aiCore = _sheetRowsToText(aiCoreData);
    }, 'Lettura AI_CORE');
  } else {
    newCacheData.aiCoreStructured = [];
    newCacheData.aiCore = '';
  }

  const doctrineSheet = ss.getSheetByName(cfg.DOCTRINE_SHEET);
  if (doctrineSheet) {
    withSheetsRetry(() => {
      const doctrineData = doctrineSheet.getDataRange().getValues();
      newCacheData.doctrineStructured = _parseSheetToStructured(doctrineData);
      newCacheData.doctrineBase = _sheetRowsToText(doctrineData);
    }, 'Lettura Dottrina');
  } else {
    newCacheData.doctrineStructured = [];
    newCacheData.doctrineBase = '';
  }

  const replacementsSheetName = cfg.REPLACEMENTS_SHEET_NAME || 'Sostituzioni';
  const replacementsSheet = ss.getSheetByName(replacementsSheetName);
  newCacheData.replacements = {};
  if (replacementsSheet) {
    withSheetsRetry(() => {
      const replacementRows = replacementsSheet.getDataRange().getValues();
      replacementRows.forEach(row => {
        const from = String((row && row[0]) || '').trim();
        const to = String((row && row[1]) || '').trim();
        if (from) {
          newCacheData.replacements[from] = to;
        }
      });
    }, 'Lettura Sostituzioni');
  }

  // Config Avanzata
  const adv = _loadAdvancedConfig(ss);
  newCacheData.systemEnabled = adv.systemEnabled;
  newCacheData.vacationPeriods = adv.vacationPeriods;
  newCacheData.suspensionRules = adv.suspensionRules;
  newCacheData.ignoreDomains = adv.ignoreDomains;
  newCacheData.ignoreKeywords = adv.ignoreKeywords;
  newCacheData.loaded = true;
  newCacheData.lastLoadedAt = Date.now();

  // 3. Salva nella RAM dell'esecuzione corrente
  Object.assign(GLOBAL_CACHE, newCacheData);

  // 4. Salva nel CacheService (6 ore)
  if (cache) {
    try {
      cache.put(CACHE_KEY, JSON.stringify(newCacheData), 21600);
      console.log('✓ Risorse caricate da Fogli e salvate in Cache.');
    } catch (e) {
      console.warn('⚠️ Impossibile salvare in cache (limite 100KB?): ' + e.message);
    }
  }
}

/**
 * Svuota manualmente la cache globale (knowledge/config) per forzare reload.
 * Utile come comando da eseguire a mano dall'editor Apps Script.
 */
function clearKnowledgeCache() {
  GLOBAL_CACHE.loaded = false;
  GLOBAL_CACHE.lastLoadedAt = 0;
  GLOBAL_CACHE.knowledgeBase = '';
  GLOBAL_CACHE.doctrineBase = '';
  GLOBAL_CACHE.systemEnabled = true;
  GLOBAL_CACHE.vacationPeriods = [];
  GLOBAL_CACHE.suspensionRules = {};
  GLOBAL_CACHE.ignoreDomains = [];
  GLOBAL_CACHE.ignoreKeywords = [];
  GLOBAL_CACHE.replacements = {};
  GLOBAL_CACHE.aiCoreLite = '';
  GLOBAL_CACHE.aiCore = '';
  GLOBAL_CACHE.aiCoreStructured = [];
  GLOBAL_CACHE.doctrineStructured = [];

  // Invalida anche la cache di sistema (CacheService)
  try {
    const cache = CacheService.getScriptCache();
    cache.remove('SPA_KNOWLEDGE_BASE_V1');
  } catch (e) {
    // best effort
  }

  console.log('🗑️ Cache conoscenza/config svuotata manualmente (RAM + ScriptCache)');
}

// Compatibilità con nome storico usato manualmente in alcuni ambienti.
function clearCache() {
  clearKnowledgeCache();
}

function _parseSheetToStructured(data) {
  if (!data || data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  const firstEmptyHeaderIndex = headers.findIndex(h => !h || h === 'null' || h === 'undefined');
  const usedHeaders = (firstEmptyHeaderIndex === -1)
    ? headers
    : headers.slice(0, firstEmptyHeaderIndex);

  return data.slice(1).map(row => {
    const obj = {};
    usedHeaders.forEach((h, i) => {
      if (h) obj[h] = row[i];
    });
    return obj;
  });
}

function _loadAdvancedConfig(ss) {
  const config = { systemEnabled: true, vacationPeriods: [], suspensionRules: {}, ignoreDomains: [], ignoreKeywords: [] };
  const sheet = ss.getSheetByName('Controllo');
  if (!sheet) return config;

  withSheetsRetry(() => {
    // Interruttore
    const status = sheet.getRange('B2').getValue();
    if (String(status).toUpperCase().includes('SPENTO')) config.systemEnabled = false;

    // Ferie (B5:E7): B=data inizio, C=separatore, D=data fine, E=riepilogo (ignorato)
    const periods = sheet.getRange('B5:E7').getValues();
    periods.forEach(r => {
      if (r[0] instanceof Date && r[2] instanceof Date) {
        config.vacationPeriods.push({ start: r[0], end: r[2] });
      }
    });

    // Sospensione (B10:E16)
    const susp = sheet.getRange('B10:E16').getValues();
    susp.forEach((r, i) => {
      // Mapping esplicito indice-riga -> getDay JS:
      // B10..B16 = Lun..Dom  => 1..6,0 (dove Domenica in JS è 0, non 7).
      const day = (i + 1) % 7;
      if (!isNaN(parseInt(r[0])) && !isNaN(parseInt(r[2]))) {
        config.suspensionRules[day] = [[parseInt(r[0]), parseInt(r[2])]];
      }
    });

    // Filtri anti-spam (layout single-sheet: E11:F)
    const maxRows = Math.max(sheet.getLastRow(), 11);
    const filterRows = Math.max(maxRows - 10, 1);
    const filters = sheet.getRange(11, 5, filterRows, 2).getValues();
    filters.forEach(row => {
      const domain = String(row[0] || '').trim().toLowerCase();
      const keyword = String(row[1] || '').trim().toLowerCase();
      if (domain) config.ignoreDomains.push(domain);
      if (keyword) config.ignoreKeywords.push(keyword);
    });
  }, 'Lettura configurazione avanzata');

  // Dedup + fallback su config statica
  const staticDomains = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.IGNORE_DOMAINS)) ? CONFIG.IGNORE_DOMAINS : [];
  const staticKeywords = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.IGNORE_KEYWORDS)) ? CONFIG.IGNORE_KEYWORDS : [];
  config.ignoreDomains = Array.from(new Set([...staticDomains, ...config.ignoreDomains].map(v => String(v).trim().toLowerCase()).filter(Boolean)));
  config.ignoreKeywords = Array.from(new Set([...staticKeywords, ...config.ignoreKeywords].map(v => String(v).trim().toLowerCase()).filter(Boolean)));

  return config;
}

// ====================================================================
// ENTRY POINT PRINCIPALE (TRIGGER)
// ====================================================================

/**
 * Compatibilità: Entry point storico per i trigger GAS
 */
function main() {
  processEmailsMain();
}

/**
 * Configura tutti i trigger necessari al sistema.
 * Eseguire manualmente una volta per ripristinare i trigger principali.
 */
function setupAllTriggers() {
  // 1. Trigger Principale (Autoresponder)
  setupMainTrigger(5);

  // 2. Trigger Pulizia Memoria (Settimanale)
  setupWeeklyCleanupTrigger();

  // 3. Trigger Metriche/Statistiche (Giornaliero)
  setupMetricsTrigger();

  SpreadsheetApp.getUi().alert('✅ Tutti i trigger sono stati riattivati correttamente.');
}

/**
 * Configura il trigger di elaborazione email.
 */
function setupMainTrigger(minutes) {
  const intervalMinutes = parseInt(minutes, 10) || 5;
  deleteTriggersByHandler_('main');
  deleteTriggersByHandler_('processEmailsMain');

  ScriptApp.newTrigger('main')
    .timeBased()
    .everyMinutes(intervalMinutes)
    .create();
}

/**
 * Configura il trigger per l'export delle metriche (ore 23:00).
 */
function setupMetricsTrigger() {
  deleteTriggersByHandler_('exportMetricsToSheet');

  ScriptApp.newTrigger('exportMetricsToSheet')
    .timeBased()
    .atHour(23)
    .everyDays(1)
    .create();
}

/**
 * Elimina trigger esistenti per uno specifico handler, evitando duplicati.
 */
function deleteTriggersByHandler_(handlerName) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/**
 * Funzione principale invocata dal trigger temporale (es. ogni 5 min)
 */
function main() {
  console.log('🚀 Avvio main pipeline - v3.0');

  // 0. Controllo Preventivo API Avanzate
  try {
    const probe = GmailApp.getAliases(); // Chiamata leggera per testare abilitazione servizio
  } catch (apiError) {
    console.error(`💥 CRITICO: Servizi Avanzati (Gmail API) non abilitati nel progetto GAS. Impossibile procedere.`);
    return;
  }

  const executionLock = LockService.getScriptLock();
  let hasExecutionLock = false;

  try {
    // 1. Sincronizzazione Esecuzione (Prevenzione concurrency)
    hasExecutionLock = executionLock.tryLock(5000);
    if (!hasExecutionLock) {
      console.warn('⚠️ Esecuzione già in corso o lock bloccato. Salto turno.');
      return;
    }

    // 2. Caricamento Risorse (Config, KB, Blacklist)
    withSheetsRetry(() => loadResources(false, true), 'loadResources(main)');

    if (!GLOBAL_CACHE.loaded) {
      console.error('💥 Risorse non caricate correttamente (GLOBAL_CACHE.loaded=false). Interruzione preventiva.');
      return;
    }

    // 3. Controllo Stato Sistema
    if (!GLOBAL_CACHE.systemEnabled) {
      console.log('🛑 Sistema disattivato da foglio Controllo.');
      return;
    }

    if (isInSuspensionTime()) {
      const staleHours = (typeof CONFIG !== 'undefined' && typeof CONFIG.SUSPENSION_STALE_UNREAD_HOURS === 'number')
        ? CONFIG.SUSPENSION_STALE_UNREAD_HOURS
        : 12;

      if (!hasStaleUnreadThreads(staleHours)) {
        console.log('💤 Sistema in sospensione (orario ufficio/festività).');
        return;
      }
      console.warn(`⏰ Sospensione bypassata: trovate email non lette più vecchie di ${staleHours}h.`);
    }

    // 4. Orchestrazione Pipeline (Delegato alle classi di servizio)
    const processor = new EmailProcessor();
    const knowledgeBase = GLOBAL_CACHE.knowledgeBase || '';
    const doctrineBase = GLOBAL_CACHE.doctrineBase || '';

    // Passaggio della dottrina strutturata e testo piatto per retrocompatibilita
    const results = processor.processUnreadEmails(knowledgeBase, doctrineBase, true); // true = skip double lock

    if (results) {
      console.log(`📊 Batch completato: ${results.total || 0} analizzati, ${results.replied || 0} risposte, ${results.errors || 0} errori.`);
    }

  } catch (error) {
    console.error(`💥 Errore fatale in main: ${error.message}`);
    if (typeof createLogger === 'function') {
      try {
        const logger = createLogger('Main');
        logger.error(`Errore fatale in main: ${error.message}`, {
          stack: error && error.stack ? error.stack : null
        });
      } catch (logError) {
        // Fallback silente
      }
    }
  } finally {
    if (typeof hasExecutionLock !== 'undefined' && hasExecutionLock && executionLock) {
      executionLock.releaseLock();
    }
  }
}

/**
 * Hook retrocompatibile rimosso o allineato
 */
function processEmailsMain() {
  main();
}

/**
 * Serializza righe foglio in testo robusto per prompt/validator.
 * - converte in stringa e trimma ogni cella
 * - rimuove celle vuote
 * - rimuove righe completamente vuote
 */
function _sheetRowsToText(rows) {
  if (!Array.isArray(rows)) return '';

  return rows
    .map(row => {
      const safeRow = Array.isArray(row) ? row : [row];
      return safeRow
        .map(cell => _formatCellForKnowledgeText(cell))
        .filter(Boolean)
        .join(' | ');
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Normalizza la serializzazione celle per evitare output locale-dipendente.
 * In particolare, le Date di Google Sheets vengono convertite in formato stabile
 * (YYYY-MM-DD oppure YYYY-MM-DD HH:mm) invece di "Tue May 12 2026 ...".
 */
function _formatCellForKnowledgeText(cell) {
  if (cell == null) return '';

  if (cell instanceof Date && !isNaN(cell.getTime())) {
    return _formatDateForKnowledgeText(cell);
  }

  return String(cell).trim();
}

function _formatDateForKnowledgeText(date) {
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    const tz = (typeof Session !== 'undefined' && Session && typeof Session.getScriptTimeZone === 'function')
      ? Session.getScriptTimeZone()
      : 'UTC';

    // Rileviamo se ha una parte oraria in base al fuso orario target
    const hasTime = (tz === 'UTC')
      ? (date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0)
      : (date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0);

    const pattern = hasTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd';

    return Utilities.formatDate(date, tz, pattern);
  }

  // Fallback Node/tests: serializzazione stabile UTC
  const hasUtcTime = date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0;
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');

  if (!hasUtcTime) {
    return `${yyyy}-${mm}-${dd}`;
  }

  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}