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
  aiCoreLite: '',
  aiCore: '',
  doctrineStructured: [],
  systemEnabled: true,
  languageMode: 'all',
  vacationPeriods: [],
  suspensionRules: {},
  ignoreDomains: [],
  ignoreKeywords: [],
  replacements: {}
};

// TTL in-RAM valido nella singola esecuzione: cross-esecuzione la cache reale è CacheService.
// ⚠️ Scelta blindata: questo TTL è allineato ai 21600s della ScriptCache.
// Cambiare solo insieme ai comandi manuali di riallineamento (primeCache/clearKnowledgeCache)
// per evitare disallineamenti "RAM fresca / ScriptCache scaduta" e ricariche imprevedibili.
var RESOURCE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 ore
var RESOURCE_CACHE_TTL_SECONDS = 21600; // 6 ore
var RESOURCE_CACHE_KEY_V2 = 'SPA_KNOWLEDGE_BASE_V2';
var RESOURCE_CACHE_KEY_V1 = 'SPA_KNOWLEDGE_BASE_V1';
var RESOURCE_CACHE_PARTS_KEY = `${RESOURCE_CACHE_KEY_V2}:parts`;
var RESOURCE_CACHE_PART_PREFIX = `${RESOURCE_CACHE_KEY_V2}:part:`;
var RESOURCE_CACHE_MAX_PART_SIZE = 45000; // Limita la dimensione della cache per evitare overflow con caratteri UTF-8 multibyte.

// ====================================================================
// FESTIVITÀ E SOSPENSIONE
// ====================================================================

// Costanti per mesi (JavaScript usa indici 0-11)
var MONTH = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
};

// Giorni in cui il sistema DEVE rispondere (dipendenti in ferie)
var ALWAYS_OPERATING_DAYS = [
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
 * Stima il numero di token per un testo ed eventuali allegati.
 * Algoritmo centralizzato (DRY) per RateLimiter e PromptEngine.
 * Formula: max(parole * 1.25 + 10% overhead, caratteri / 3.5) + 200 per allegato.
 * 
 * @param {string} text - Testo da stimare
 * @param {Array} attachments - Array di allegati (opzionale)
 * @returns {number} Numero stimato di token (min 1)
 */
function estimateTokenCount(text, attachments = []) {
  let tokens = 0;
  if (text && typeof text === 'string') {
    const wordCount = text.split(/\s+/).length;
    const baseTokens = Math.ceil(wordCount * 1.25);
    const overhead = Math.ceil(baseTokens * 0.1);
    const charEstimate = Math.ceil(text.length / 3.5);
    tokens = Math.max(baseTokens + overhead, charEstimate);
  }

  // Aggiungi stima per allegati (es: 200 token fissi per immagine/PDF/OCR)
  if (attachments && Array.isArray(attachments)) {
    tokens += attachments.length * 200;
  }

  return Math.max(tokens, 1);
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

    const start = new Date(vp.start);
    const end = new Date(vp.end);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) continue;

    const startKey = formatDateOnly(start);
    const endKey = formatDateOnly(end);
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
  let currentHour = now.getHours() + (now.getMinutes() / 60);

  // Regola di dominio: la sospensione è ancorata all'orario italiano.
  const businessTimeZone = 'Europe/Rome';

  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    try {
      year = parseInt(Utilities.formatDate(now, businessTimeZone, 'yyyy'), 10);
      monthIndex = parseInt(Utilities.formatDate(now, businessTimeZone, 'M'), 10) - 1;
      date = parseInt(Utilities.formatDate(now, businessTimeZone, 'd'), 10);
      const isoDay = parseInt(Utilities.formatDate(now, businessTimeZone, 'u'), 10);
      day = isNaN(isoDay) ? day : (isoDay % 7);
      const businessHour = parseInt(Utilities.formatDate(now, businessTimeZone, 'H'), 10);
      const businessMinute = parseInt(Utilities.formatDate(now, businessTimeZone, 'm'), 10);
      if (!isNaN(businessHour) && !isNaN(businessMinute)) {
        currentHour = businessHour + (businessMinute / 60);
      }
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

  // Pentecoste (Pasqua + 49 giorni)
  const pentecost = new Date(easter);
  pentecost.setDate(easter.getDate() + 49);
  if (isSameCalendarDay(normalizedNow, pentecost)) return false;

  // Corpus Domini (Pasqua + 63 giorni: domenica successiva alla SS. Trinità, prassi italiana)
  const corpusDomini = new Date(easter);
  corpusDomini.setDate(easter.getDate() + 63);
  if (isSameCalendarDay(normalizedNow, corpusDomini)) return false;

  // Ferie Segretario (Sheet)
  if (isInVacationPeriod(now, businessTimeZone)) return false;

  // 2. ORARI UFFICIO (Sistema SOSPESO)
  // Utilizza i dati caricati dal foglio Controllo in (A10:D16/B10:E16) durante il loadResources
  // Se non presenti, usa il fallback definito via codice in SUSPENSION_HOURS
  // loaded è il discriminante autoritativo: se la cache è caricata, prevalgono le regole da foglio.
  // Semantica payload:
  //   - null: foglio 'Controllo' assente → fallback sicuro su SUSPENSION_HOURS.
  //   - {}: foglio presente ma senza fasce configurate → nessuna sospensione.
  //   - {1:[...], ...}: fasce orarie lette dal foglio.
  const sheetRulesLoaded = (
    typeof GLOBAL_CACHE !== 'undefined'
    && GLOBAL_CACHE.loaded
  );
  const rules = sheetRulesLoaded
    ? (GLOBAL_CACHE.suspensionRules !== null && GLOBAL_CACHE.suspensionRules !== undefined
      ? GLOBAL_CACHE.suspensionRules
      : SUSPENSION_HOURS)
    : SUSPENSION_HOURS;

  if (rules[day]) {
    for (const [startH, endH] of rules[day]) {
      const startHour = Number(startH);
      const endHour = Number(endH);
      if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) {
        continue;
      }

      if (currentHour >= startHour && currentHour < endHour) return true;
    }
  }

  return false;
}

/**
 * Paracadute operativo: se esistono email non lette molto vecchie,
 * permette un ciclo di lavorazione anche durante la sospensione.
 */
function hasStaleUnreadThreads(maxAgeHours = 12, searchLimit = 100, maxLookbackDays = 7) {
  const safeMaxAgeHours = Number(maxAgeHours) || 12;
  const safeMaxLookbackDays = Number(maxLookbackDays) || 7;
  const safeSearchLimit = Math.max(15, Number(searchLimit) || 100);
  const cutoffMs = Date.now() - (safeMaxAgeHours * 60 * 60 * 1000);
  const oldestRelevantMs = Date.now() - (safeMaxLookbackDays * 24 * 60 * 60 * 1000);

  const labelName = (typeof CONFIG !== 'undefined' && CONFIG.LABEL_NAME) ? CONFIG.LABEL_NAME : 'IA';
  const errorLabel = (typeof CONFIG !== 'undefined' && CONFIG.ERROR_LABEL_NAME) ? CONFIG.ERROR_LABEL_NAME : 'Errore';
  const validationLabel = (typeof CONFIG !== 'undefined' && CONFIG.VALIDATION_ERROR_LABEL) ? CONFIG.VALIDATION_ERROR_LABEL : 'Verifica';
  const quoteLabel = (label) => `"${String(label || '').replace(/"/g, '\\"')}"`;

  const query = `in:inbox is:unread newer_than:${safeMaxLookbackDays}d -label:${quoteLabel(labelName)} -label:${quoteLabel(errorLabel)} -label:${quoteLabel(validationLabel)}`;

  const pageSize = 25;
  for (let offset = 0; offset < safeSearchLimit; offset += pageSize) {
    const threads = GmailApp.search(query, offset, Math.min(pageSize, safeSearchLimit - offset));
    if (!threads || threads.length === 0) break;

    const foundStale = threads.some(thread =>
      thread.getMessages().some(message =>
        message.isUnread() &&
        message.getDate().getTime() <= cutoffMs &&
        message.getDate().getTime() > oldestRelevantMs
      )
    );

    if (foundStale) return true;
  }

  return false;
}

// ====================================================================
// CARICAMENTO RISORSE
// ====================================================================

function withSheetsRetry(fn, context = 'Operazione Sheets') {
  const maxRetries = (typeof CONFIG !== 'undefined' && Number.isFinite(Number(CONFIG.SHEETS_RETRY_MAX)) && CONFIG.SHEETS_RETRY_MAX > 0)
    ? CONFIG.SHEETS_RETRY_MAX
    : 3;
  const backoffMs = (typeof CONFIG !== 'undefined' && Number.isFinite(Number(CONFIG.SHEETS_RETRY_BACKOFF_MS)) && CONFIG.SHEETS_RETRY_BACKOFF_MS > 0)
    ? CONFIG.SHEETS_RETRY_BACKOFF_MS
    : 1000;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return fn();
    } catch (error) {
      if (attempt < maxRetries - 1) {
        const waitMs = backoffMs * Math.pow(2, attempt);
        console.warn(`⚠️ [${context}] Tentativo ${attempt + 1}/${maxRetries} fallito: ${error.message}. Retry in ${waitMs}ms...`);
        Utilities.sleep(waitMs);
        continue;
      }
      console.error(`❌ [${context}] Tutti i ${maxRetries} tentativi esauriti. Ultimo errore: ${error.message}`);
      throw error;
    }
  }
}

function loadResources(acquireLock = true, hasExternalLock = false) {
  // ⚠️ Invariante blindante: niente reload senza lock.
  // Questo evita race condition in cui due trigger sovrascrivono la cache a metà serializzazione.
  if (!acquireLock && !hasExternalLock) {
    throw new Error('loadResources richiede un lock preventivo.');
  }

  if (typeof GLOBAL_CACHE === 'undefined' || !GLOBAL_CACHE) {
    throw new Error('GLOBAL_CACHE non inizializzata: impossibile caricare risorse in sicurezza.');
  }
  // Nota: da qui in avanti GLOBAL_CACHE è garantita; evitiamo fallback silenziosi
  // perché maschererebbero regressioni d'inizializzazione del runtime.

  const now = Date.now();
  const forceReload = typeof CONFIG !== 'undefined' && CONFIG.FORCE_RELOAD === true;
  const cacheIsFreshByTtl = !forceReload && GLOBAL_CACHE.loaded && GLOBAL_CACHE.lastLoadedAt && ((now - GLOBAL_CACHE.lastLoadedAt) < RESOURCE_CACHE_TTL_MS);
  let precomputedSheetModifiedAt = 0;
  if (forceReload) {
    console.log('↻ FORCE_RELOAD attivo: ricarico le risorse ignorando la cache TTL.');
  }
  if (cacheIsFreshByTtl) {
    const spreadsheetId = (typeof CONFIG !== 'undefined' && CONFIG.SPREADSHEET_ID) ? CONFIG.SPREADSHEET_ID : null;
    precomputedSheetModifiedAt = _getSpreadsheetModifiedTimeMs(spreadsheetId);
    if (!precomputedSheetModifiedAt || precomputedSheetModifiedAt <= GLOBAL_CACHE.lastLoadedAt) {
      return;
    }
    console.log(`↻ Cache risorse invalidata: foglio aggiornato (${new Date(precomputedSheetModifiedAt).toISOString()}) dopo ultimo load (${new Date(GLOBAL_CACHE.lastLoadedAt).toISOString()}).`);
  }

  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    if (acquireLock) {
      lockAcquired = lock.tryLock(10000);
      if (!lockAcquired) {
        if (!GLOBAL_CACHE.loaded) {
          throw new Error('Impossibile acquisire lock per caricamento risorse.');
        }
        console.warn('⚠️ Lock non acquisito ma cache già presente: evito reload concorrente non protetto.');
        return;
      }
    }

    _loadResourcesInternal(precomputedSheetModifiedAt);
  } finally {
    if (lockAcquired) {
      const canRelease = (typeof lock.hasLock !== 'function') || lock.hasLock();
      if (canRelease) {
        lock.releaseLock();
      }
    }
  }
}

function _loadResourcesInternal(knownSheetModifiedAt) {
  const spreadsheetId = (typeof CONFIG !== 'undefined' && CONFIG.SPREADSHEET_ID) ? CONFIG.SPREADSHEET_ID : null;
  if (!spreadsheetId) {
    throw new Error('Impossibile aprire il foglio: CONFIG.SPREADSHEET_ID non configurato.');
  }

  const latestSheetModifiedAt = knownSheetModifiedAt || _getSpreadsheetModifiedTimeMs(spreadsheetId);
  const cache = (typeof CacheService !== 'undefined') ? CacheService.getScriptCache() : null;

  // ⚠️ Scelta blindata: la cache persiste SEMPRE il payload completo delle risorse.
  // Eventuali riduzioni/riassunti vanno fatte solo a runtime nel PromptEngine,
  // mai qui, altrimenti si degrada sistematicamente il caso normale.

  // 1. Prova a leggere dalla vera Cache di Apps Script
  if (cache) {
    const cachedData = _readResourceCachePayload(cache);
    if (cachedData) {
      try {
        const parsedData = _deserializeResourceCache(cachedData);
        const cachedLastLoadedAt = Number(parsedData && parsedData.lastLoadedAt) || 0;
        const cacheStaleBySheetUpdate = !!(latestSheetModifiedAt && cachedLastLoadedAt && latestSheetModifiedAt > cachedLastLoadedAt);
        if (cacheStaleBySheetUpdate) {
          console.log(`↻ Cache persistente invalidata: spreadsheet modifiedTime (${new Date(latestSheetModifiedAt).toISOString()}) > cached lastLoadedAt (${new Date(cachedLastLoadedAt).toISOString()}).`);
          _invalidateResourceCacheStorage(cache);
        } else {
          Object.assign(GLOBAL_CACHE, parsedData);
          GLOBAL_CACHE.loaded = true;
          console.log('✓ Risorse caricate dalla Cache veloce.');
          return;
        }
      } catch (e) {
        console.warn('⚠️ Cache corrotta o obsoleta, ricaricamento dai fogli...');
      }
    }
  }


  let ss;
  try {
    ss = withSheetsRetry(
      () => SpreadsheetApp.openById(spreadsheetId),
      'Apertura Spreadsheet da CONFIG.SPREADSHEET_ID'
    );
  } catch (e) {
    throw new Error('Impossibile aprire il foglio. Verifica CONFIG.SPREADSHEET_ID. Dettaglio: ' + e.message);
  }

  // Hardening: evita crash se CONFIG non è ancora inizializzato (ordine file GAS)
  // Nota manutenzione: questo caricamento risorse deve avere priorità su processUnreadEmails
  // per assicurare che KB e Dottrina siano disponibili.
  const cfg = (typeof CONFIG !== 'undefined' && CONFIG) ? CONFIG : {
    KB_SHEET_NAME: 'Istruzioni',
    AI_CORE_LITE_SHEET: 'AI_CORE_LITE',
    AI_CORE_SHEET: 'AI_CORE',
    DOCTRINE_SHEET: 'Dottrina',
    REPLACEMENTS_SHEET_NAME: 'Sostituzioni'
  };

  const newCacheData = {};

  // KB Base
  const kbSheet = withSheetsRetry(() => ss.getSheetByName(cfg.KB_SHEET_NAME), 'Recupero foglio KB Base');
  if (kbSheet) {
    withSheetsRetry(() => {
      const kbData = kbSheet.getDataRange().getValues();
      const kbHealthReport = _logKnowledgeBaseHealthReport(kbData, cfg.KB_SHEET_NAME || 'Istruzioni');
      const kbRowsForText = kbHealthReport.skippedHeader ? kbData.slice(1) : kbData;
      newCacheData.knowledgeBase = _sheetRowsToText(kbRowsForText);
    }, 'Lettura KB Base');
  } else {
    newCacheData.knowledgeBase = '';
  }

  // Prompt resources aggiuntive (usate da PromptEngine)
  const aiCoreLiteSheet = withSheetsRetry(() => ss.getSheetByName(cfg.AI_CORE_LITE_SHEET), 'Recupero foglio AI_CORE_LITE');
  newCacheData.aiCoreLite = '';
  if (aiCoreLiteSheet) {
    withSheetsRetry(() => {
      newCacheData.aiCoreLite = _sheetRowsToText(aiCoreLiteSheet.getDataRange().getValues());
    }, 'Lettura AI_CORE_LITE');
  }

  const aiCoreSheet = withSheetsRetry(() => ss.getSheetByName(cfg.AI_CORE_SHEET), 'Recupero foglio AI_CORE');
  if (aiCoreSheet) {
    withSheetsRetry(() => {
      const aiCoreData = aiCoreSheet.getDataRange().getValues();
      newCacheData.aiCore = _sheetRowsToText(aiCoreData);
    }, 'Lettura AI_CORE');
  } else {
    newCacheData.aiCore = '';
  }

  const doctrineSheet = withSheetsRetry(() => ss.getSheetByName(cfg.DOCTRINE_SHEET), 'Recupero foglio Dottrina');
  if (doctrineSheet) {
    withSheetsRetry(() => {
      const doctrineData = doctrineSheet.getDataRange().getValues();
      newCacheData.doctrineStructured = _parseSheetToStructured(doctrineData);
      // Coerenza con _parseSheetToStructured: la prima riga è intestazione e non contenuto.
      newCacheData.doctrineBase = _sheetRowsToText(doctrineData.slice(1));
    }, 'Lettura Dottrina');
  } else {
    newCacheData.doctrineStructured = [];
    newCacheData.doctrineBase = '';
  }

  const replacementsSheetName = cfg.REPLACEMENTS_SHEET_NAME || 'Sostituzioni';
  const replacementsSheet = withSheetsRetry(() => ss.getSheetByName(replacementsSheetName), 'Recupero foglio Sostituzioni');
  newCacheData.replacements = {};
  if (replacementsSheet) {
    withSheetsRetry(() => {
      const replacementRows = replacementsSheet.getDataRange().getValues();
      // Salta la prima riga (header convenzionale: Originale | Sostituzione)
      replacementRows.slice(1).forEach(row => {
        const from = String((row && row[0]) || '').trim();
        const to = String((row && row[1]) || '').trim();
        if (from) {
          newCacheData.replacements[from] = to;
        }
      });
    }, 'Lettura Sostituzioni');
  }

  // Config Avanzata
  const adv = withSheetsRetry(() => _loadAdvancedConfig(ss), 'Lettura Configurazione Avanzata');
  newCacheData.systemEnabled = adv.systemEnabled;
  newCacheData.languageMode = adv.languageMode || 'all';
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
      const serialized = _serializeResourceCache(newCacheData, false);
      _writeResourceCachePayload(cache, serialized);
      console.log('✓ Risorse caricate da Fogli e salvate in Cache.');
    } catch (e) {
      console.warn('⚠️ Salvataggio cache standard fallito: ' + e.message);
      try {
        const compressedPayload = _serializeResourceCache(newCacheData, true);
        _writeResourceCachePayload(cache, compressedPayload);
        console.warn('⚠️ Cache risorse salvata in formato compresso (payload vicino limite 100KB).');
      } catch (compressionError) {
        console.warn('⚠️ Impossibile salvare in cache anche in formato compresso: ' + compressionError.message);
      }
    }
  }
}

function _getSpreadsheetModifiedTimeMs(spreadsheetId) {
  if (!spreadsheetId) return 0;

  try {
    if (typeof Drive !== 'undefined' && Drive && Drive.Files && typeof Drive.Files.get === 'function') {
      let file = null;

      try {
        // Drive API v3
        file = Drive.Files.get(spreadsheetId, { fields: 'modifiedTime' });
      } catch (v3Error) {
        // Alcuni ambienti Apps Script usano ancora semantica v2.
        try {
          file = Drive.Files.get(spreadsheetId, { fields: 'modifiedDate' });
        } catch (v2FieldError) {
          // Fallback finale per ambienti senza parametro "fields".
          file = Drive.Files.get(spreadsheetId);
        }
      }

      const modifiedRaw = file && (file.modifiedTime || file.modifiedDate);
      const modifiedMs = modifiedRaw ? Date.parse(modifiedRaw) : NaN;
      if (!isNaN(modifiedMs)) return modifiedMs;
    }
  } catch (e) {
    console.warn('⚠️ Drive API non disponibile per modifiedTime: ' + e.message);
  }

  return 0;
}

function _logKnowledgeBaseHealthReport(rows, sheetName) {
  const report = _analyzeKnowledgeBaseRows(rows, sheetName);
  console.log('KB_HEALTH_REPORT ' + JSON.stringify(report));
  return report;
}

function _analyzeKnowledgeBaseRows(rows, sheetName) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const report = {
    sheet: sheetName || 'unknown',
    scannedRows: safeRows.length,
    skippedHeader: false,
    rowsWithLessThanTwoCells: 0,
    rowsWithRequiredFieldsMissing: 0,
    duplicateCategoryInfoRows: 0,
    issues: []
  };

  if (safeRows.length === 0) return report;

  const normalize = function (value) {
    return _formatCellForKnowledgeText(value).toLowerCase();
  };

  const firstRow = Array.isArray(safeRows[0]) ? safeRows[0] : [safeRows[0]];
  const firstCol = normalize(firstRow[0]);
  const secondCol = normalize(firstRow[1]);
  const looksLikeHeader = (firstCol === 'categoria' || firstCol === 'category') && (secondCol === 'informazione' || secondCol === 'informazioni' || secondCol === 'info' || secondCol === 'information');

  const seenCategoryInfo = {};
  const startIndex = looksLikeHeader ? 1 : 0;
  report.skippedHeader = looksLikeHeader;

  for (let i = startIndex; i < safeRows.length; i++) {
    const row = Array.isArray(safeRows[i]) ? safeRows[i] : [safeRows[i]];
    const normalizedRow = row.map(normalize);
    const nonEmptyCount = normalizedRow.filter(Boolean).length;
    const line = i + 1;

    if (nonEmptyCount === 0) {
      continue;
    }

    if (nonEmptyCount < 2) {
      report.rowsWithLessThanTwoCells++;
      report.issues.push({ type: 'LESS_THAN_TWO_CELLS', row: line });
    }

    const category = normalizedRow[0] || '';
    const info = normalizedRow[1] || '';
    if (!category || !info) {
      report.rowsWithRequiredFieldsMissing++;
      report.issues.push({ type: 'MISSING_REQUIRED_COLUMNS', row: line, missing: { category: !category, information: !info } });
      continue;
    }

    const key = `${category}||${info}`;
    if (Object.prototype.hasOwnProperty.call(seenCategoryInfo, key)) {
      report.duplicateCategoryInfoRows++;
      report.issues.push({ type: 'DUPLICATE_CATEGORY_INFORMATION', row: line, duplicateOf: seenCategoryInfo[key] });
      continue;
    }
    seenCategoryInfo[key] = line;
  }

  return report;
}


/**
 * Serializza payload risorse per CacheService.
 * Usa JSON diretto; opzionalmente comprime con gzip+base64 quando disponibile.
 */
function _serializeResourceCache(data, forceCompression) {
  const json = JSON.stringify(data);
  if (!forceCompression) {
    return json;
  }

  if (typeof Utilities === 'undefined' || !Utilities || typeof Utilities.newBlob !== 'function' || typeof Utilities.gzip !== 'function' || typeof Utilities.base64Encode !== 'function') {
    throw new Error('Utilities gzip/base64 non disponibili');
  }

  // Forza UTF-8 nella creazione del blob per consistenza cross-platform
  const gzipped = Utilities.gzip(Utilities.newBlob(json, 'application/json', Utilities.Charset.UTF_8));
  const base64 = Utilities.base64Encode(gzipped.getBytes());
  return JSON.stringify({
    encoding: 'gzip_base64_json_v1',
    payload: base64
  });
}

/**
 * Deserializza payload risorse da CacheService (plain JSON o gzip+base64).
 */
function _deserializeResourceCache(serializedPayload) {
  const parsed = JSON.parse(serializedPayload);
  if (!parsed || typeof parsed !== 'object' || parsed.encoding !== 'gzip_base64_json_v1') {
    return parsed;
  }

  if (typeof Utilities === 'undefined' || !Utilities || typeof Utilities.ungzip !== 'function' || typeof Utilities.base64Decode !== 'function' || typeof Utilities.newBlob !== 'function') {
    throw new Error('Utilities ungzip/base64 non disponibili per cache compressa');
  }

  const bytes = Utilities.base64Decode(parsed.payload || '');
  const uncompressedBlob = Utilities.ungzip(Utilities.newBlob(bytes));
  const json = uncompressedBlob.getDataAsString('UTF-8');
  return JSON.parse(json);
}

function _splitCachePayload(payload, maxChars) {
  // Nota: maxChars è una stima iniziale conservativa passata come RESOURCE_CACHE_MAX_PART_SIZE (45000).
  // CacheService ha un limite fisico di 100KB (102400 byte) per entry.
  const ABSOLUTE_BYTE_LIMIT = 100000; // Un po' meno di 100KB per sicurezza overhead chiave.
  const parts = [];
  let start = 0;

  while (start < payload.length) {
    // Cerchiamo il chunk più grande possibile che stia nel limite di byte
    let length = Math.min(maxChars, payload.length - start);
    let chunk = payload.substring(start, start + length);
    
    // Verifica byte reali (possono superare maxChars se ci sono molti multibyte)
    let byteLength = Utilities.newBlob(chunk).getBytes().length;
    
    // Se sforiamo il limite assoluto di Apps Script, riduciamo il chunk finché non rientra.
    while (byteLength > ABSOLUTE_BYTE_LIMIT && length > 1000) {
      length = Math.floor(length * 0.9);
      chunk = payload.substring(start, start + length);
      byteLength = Utilities.newBlob(chunk).getBytes().length;
    }

    // Evita split nel mezzo di surrogate pair UTF-16
    if (start + length < payload.length) {
      const lastCode = payload.charCodeAt(start + length - 1);
      if (lastCode >= 0xD800 && lastCode <= 0xDBFF) {
        length -= 1;
        chunk = payload.substring(start, start + length);
      }
    }

    parts.push(chunk);
    start += length;
  }
  return parts;
}

function _readResourceCachePayload(cache) {
  if (!cache) return null;

  const v2Inline = cache.get(RESOURCE_CACHE_KEY_V2);
  if (v2Inline) {
    return v2Inline;
  }

  // Lettura cache con supporto chiave precedente per continuità operativa.
  // Manteniamo questo ramo solo come fallback, così V2 prevale se presente.
  const v1Payload = cache.get(RESOURCE_CACHE_KEY_V1);
  if (v1Payload) {
    return v1Payload;
  }

  const partsCountRaw = cache.get(RESOURCE_CACHE_PARTS_KEY);
  const partsCount = parseInt(partsCountRaw || '0', 10);
  if (!Number.isFinite(partsCount) || partsCount <= 0) {
    return null;
  }

  const keys = [];
  for (let i = 0; i < partsCount; i++) {
    keys.push(`${RESOURCE_CACHE_PART_PREFIX}${i}`);
  }

  const chunks = cache.getAll(keys);
  const missing = keys.find(k => !chunks[k]);
  if (missing) {
    console.warn(`⚠️ Cache multipart incompleta (${missing}), invalido payload e forzo reload.`);
    _invalidateResourceCacheStorage(cache);
    return null;
  }

  return keys.map(k => chunks[k]).join('');
}

function _writeResourceCachePayload(cache, payload) {
  if (!cache) return;

  // ⚠️ Prima invalidiamo sempre: evita mix V2-inline + multipart stale dopo downgrade/upgrade.
  _invalidateResourceCacheStorage(cache);

  if (payload.length <= RESOURCE_CACHE_MAX_PART_SIZE) {
    cache.put(RESOURCE_CACHE_KEY_V2, payload, RESOURCE_CACHE_TTL_SECONDS);
    try {
      cache.remove(RESOURCE_CACHE_KEY_V1);
    } catch (e) {
      // best effort: evita stale V1 se removeAll precedente è fallita
    }
    return;
  }

  // ⚠️ Multipart è una protezione tecnica contro il limite CacheService (~100KB/entry),
  // non una riduzione funzionale della KB.
  const parts = _splitCachePayload(payload, RESOURCE_CACHE_MAX_PART_SIZE);
  if (!parts.length) {
    throw new Error('Payload cache vuoto: impossibile salvare');
  }

  const values = {};
  parts.forEach((part, idx) => {
    values[`${RESOURCE_CACHE_PART_PREFIX}${idx}`] = part;
  });
  values[RESOURCE_CACHE_PARTS_KEY] = String(parts.length);

  cache.putAll(values, RESOURCE_CACHE_TTL_SECONDS);
  try {
    cache.remove(RESOURCE_CACHE_KEY_V1);
  } catch (e) {
    // best effort: evita stale V1 se removeAll precedente è fallita
  }
  console.warn(`⚠️ Cache risorse salvata in modalità multipart (${parts.length} chunk).`);
}

function _invalidateResourceCacheStorage(cache) {
  if (!cache) return;

  const toRemove = [RESOURCE_CACHE_KEY_V1, RESOURCE_CACHE_KEY_V2, RESOURCE_CACHE_PARTS_KEY];
  const partsCountRaw = cache.get(RESOURCE_CACHE_PARTS_KEY);
  const partsCount = parseInt(partsCountRaw || '0', 10);
  if (Number.isFinite(partsCount) && partsCount > 0) {
    for (let i = 0; i < partsCount; i++) {
      toRemove.push(`${RESOURCE_CACHE_PART_PREFIX}${i}`);
    }
  }

  if (typeof cache.removeAll === 'function') {
    cache.removeAll(toRemove);
  } else if (typeof cache.remove === 'function') {
    toRemove.forEach(key => {
      try { cache.remove(key); } catch (e) { }
    });
  }
}

/**
 * Svuota manualmente la cache globale (knowledge/config) per forzare reload.
 * Utile come comando da eseguire a mano dall'editor Apps Script.
 */
function clearKnowledgeCache() {
  // ⚠️ Comando operativo ufficiale: resetta RAM + ScriptCache in modo coerente.
  // Evitare reset "parziali" altrove: causano stati fantasma e reload intermittenti.
  GLOBAL_CACHE.loaded = false;
  GLOBAL_CACHE.lastLoadedAt = 0;
  GLOBAL_CACHE.knowledgeBase = '';
  GLOBAL_CACHE.doctrineBase = '';
  GLOBAL_CACHE.systemEnabled = true;
  GLOBAL_CACHE.languageMode = 'all';
  GLOBAL_CACHE.vacationPeriods = [];
  GLOBAL_CACHE.suspensionRules = {};
  GLOBAL_CACHE.ignoreDomains = [];
  GLOBAL_CACHE.ignoreKeywords = [];
  GLOBAL_CACHE.replacements = {};
  GLOBAL_CACHE.aiCoreLite = '';
  GLOBAL_CACHE.aiCore = '';
  GLOBAL_CACHE.doctrineStructured = [];

  // Invalida anche la cache di sistema (CacheService)
  try {
    const cache = CacheService.getScriptCache();
    _invalidateResourceCacheStorage(cache);
  } catch (e) {
    // best effort
  }

  console.log('🗑️ Cache conoscenza/config svuotata manualmente (RAM + ScriptCache)');
}

// Alias per invocazione manuale o da trigger precedenti.
function clearCache() {
  clearKnowledgeCache();
}

/**
 * Forza invalidazione + ricarica immediata usando le funzioni operative già esistenti
 * (`clearKnowledgeCache`/`clearCache` + `loadResources`).
 * Da usare quando cambia il contenuto dei fogli e non si vuole attendere il TTL.
 */
function primeCache() {
  // ⚠️ Orchestrazione voluta: 1) invalidate totale, 2) reload immediato.
  // Non invertire l'ordine (reload->clear) o si ottiene una cache svuotata subito dopo il warm-up.
  clearKnowledgeCache();
  loadResources(true, false);
  const kbSize = (GLOBAL_CACHE.knowledgeBase || '').length;
  const doctrineSize = (GLOBAL_CACHE.doctrineBase || '').length;
  console.log(`🔄 Cache primed manualmente (KB=${kbSize} chars, Dottrina=${doctrineSize} chars).`);
  return {
    loaded: GLOBAL_CACHE.loaded,
    lastLoadedAt: GLOBAL_CACHE.lastLoadedAt,
    knowledgeBaseChars: kbSize,
    doctrineChars: doctrineSize
  };
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

function _parseStrictHour(value) {
  // Google Sheets può restituire gli orari nativi come Date (es. 30 Dec 1899 14:00:00)
  // Coerenza timezone con _formatDateForKnowledgeText: usare script TZ quando possibile.
  if (value instanceof Date && !isNaN(value.getTime())) {
    if (
      typeof Utilities !== 'undefined' &&
      Utilities &&
      typeof Utilities.formatDate === 'function'
    ) {
      const scriptTz =
        typeof Session !== 'undefined' &&
        Session &&
        typeof Session.getScriptTimeZone === 'function'
          ? Session.getScriptTimeZone()
          : 'Europe/Rome';
      const hourStr = Utilities.formatDate(value, scriptTz, 'H');
      const hourFromDate = parseInt(hourStr, 10);
      if (Number.isInteger(hourFromDate) && hourFromDate >= 0 && hourFromDate <= 23) {
        return hourFromDate;
      }
      return null;
    }
    // Fallback per ambienti non-GAS (es. test Node.js)
    const hourFromDate = value.getHours();
    if (
      Number.isInteger(hourFromDate) && hourFromDate >= 0 && hourFromDate <= 23
    ) {
      return hourFromDate;
    }
    return null;
  }

  if (typeof value === 'number') {
    // Contratto runtime/UI: fasce a ore intere (i minuti vengono troncati).
    if (value >= 0 && value < 1) {
      const totalMinutes = Math.floor((value * 24 * 60) + 0.0001);
      const hourFromFraction = Math.floor(totalMinutes / 60);
      return Math.min(Math.max(hourFromFraction, 0), 23);
    }

    if (Number.isInteger(value) && value >= 0 && value <= 23) {
      return value;
    }

    return null;
  }

  const normalized = String(value == null ? '' : value).trim();

  const hhmm = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hourFromTime = Number(hhmm[1]);
    const minuteFromTime = Number(hhmm[2]);
    if (!Number.isInteger(hourFromTime) || !Number.isInteger(minuteFromTime)) return null;
    if (hourFromTime < 0 || hourFromTime > 23 || minuteFromTime < 0 || minuteFromTime > 59) return null;
    // NOTA: Il sistema attualmente supporta solo blocchi orari interi. I minuti vengono deliberatamente scartati.
    return hourFromTime;
  }

  if (!/^\d{1,2}$/.test(normalized.replace(/\s+/g, ''))) return null;

  const hour = Number(normalized.replace(/\s+/g, ''));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

  return hour;
}

function _isWeekdayCellLabel(value) {
  const normalized = String(value == null ? '' : value)
    .trim()
    .toLowerCase();

  if (!normalized) return false;

  return /^(lun|luned[iì]|mar|marted[iì]|mer|mercoled[iì]|gio|gioved[iì]|ven|venerd[iì]|sab|sabato|dom|domenica)$/.test(normalized);
}

function _extractSuspensionHoursFromRow(row) {
  const cells = Array.isArray(row) ? row : [];

  // Layout UI corrente (single-sheet):
  // A=giorno, B=ora inizio, C=vuoto/separatore, D=ora fine
  if (_isWeekdayCellLabel(cells[0])) {
    return {
      startHour: _parseStrictHour(cells[1]),
      endHour: _parseStrictHour(cells[3])
    };
  }

  // Layout legacy:
  // A=vuoto, B=giorno, C=ora inizio, D=ora fine
  if (_isWeekdayCellLabel(cells[1])) {
    return {
      startHour: _parseStrictHour(cells[2]),
      endHour: _parseStrictHour(cells[3])
    };
  }

  // Fallback difensivo per sheet manipolati manualmente:
  // sceglie le prime due celle orarie valide da sinistra a destra.
  const parsedHours = cells
    .map((cell) => _parseStrictHour(cell))
    .filter((hour) => hour != null);

  return {
    startHour: parsedHours[0] != null ? parsedHours[0] : null,
    endHour: parsedHours[1] != null ? parsedHours[1] : null
  };
}

function _loadAdvancedConfig(ss) {
  const config = { systemEnabled: true, languageMode: 'all', vacationPeriods: [], suspensionRules: {}, ignoreDomains: [], ignoreKeywords: [] };
  const sheet = ss.getSheetByName('Controllo');
  if (!sheet) {
    // null = sheet assente (distinto da {}: sheet presente ma nessuna regola impostata)
    // isInSuspensionTime userà SUSPENSION_HOURS como fallback sicuro.
    config.suspensionRules = null;
    return config;
  }

  withSheetsRetry(() => {
    // Interruttore
    const status = sheet.getRange('B2').getValue();
    if (String(status).toUpperCase().includes('SPENTO')) config.systemEnabled = false;

    // Modalità lingua (F2): "Tutte le lingue" | "Solo straniere"
    // Fallback difensivo su "all" per retrocompatibilità.
    let languageModeRaw = '';
    try {
      const languageModeCell = sheet.getRange('F2');
      const languageModeDisplay = (languageModeCell && typeof languageModeCell.getDisplayValue === 'function')
        ? languageModeCell.getDisplayValue()
        : '';
      const languageModeValue = (languageModeCell && typeof languageModeCell.getValue === 'function')
        ? languageModeCell.getValue()
        : '';
      languageModeRaw = String(languageModeDisplay || languageModeValue || '').trim().toLowerCase();
    } catch (e) {
      // Retrocompatibilità: alcuni test/fogli legacy non espongono F2.
      languageModeRaw = '';
    }
    if (languageModeRaw.includes('solo') && languageModeRaw.includes('straniere')) {
      config.languageMode = 'foreign_only';
    } else {
      config.languageMode = 'all';
    }

    // Ferie (B5:E7): B=data inizio, C=separatore, D=data fine, E=riepilogo (ignorato)
    const periods = sheet.getRange('B5:E7').getValues();
    periods.forEach(r => {
      if (r[0] instanceof Date && r[2] instanceof Date) {
        // Nota: NON estendiamo la fine giornata con setHours(23:59:59).
        // isInVacationPeriod confronta già date normalizzate a "yyyy-MM-dd"
        // nel timezone business, quindi il giorno finale è incluso senza manipolazioni aggiuntive.
        const start = new Date(r[0]);
        const end = new Date(r[2]);
        start.setHours(12, 0, 0, 0);
        end.setHours(12, 0, 0, 0);
        config.vacationPeriods.push({ start: start, end: end });
      }
    });

    // Sospensione: supporta sia il layout single-sheet corrente
    // (A=giorno, B=inizio, D=fine) sia il legacy
    // (B=giorno, C=inizio, D=fine).
    const susp = sheet.getRange('A10:D16').getValues();
    susp.forEach((r, i) => {
      // Mapping esplicito indice-riga -> getDay JS:
      // B10..B16 = Lun..Dom  => 1..6,0 (dove Domenica in JS è 0, non 7).
      const day = (i + 1) % 7;
      const extracted = _extractSuspensionHoursFromRow(r);
      const startHour = extracted.startHour;
      const endHour = extracted.endHour;
      if (startHour == null || endHour == null || startHour === endHour) return;

      if (!config.suspensionRules[day]) {
        config.suspensionRules[day] = [];
      }

      if (startHour > endHour) {
        // Cross-midnight: splitta in [start, 24] sul giorno corrente
        // e [0, end] sul giorno successivo.
        const nextDay = (day + 1) % 7;
        config.suspensionRules[day].push([startHour, 24]);
        if (!config.suspensionRules[nextDay]) {
          config.suspensionRules[nextDay] = [];
        }
        config.suspensionRules[nextDay].push([0, endHour]);
        console.log(`ℹ️ Sospensione cross-midnight rilevata per giorno ${day}: ${startHour}..${endHour} (split su giorno ${day} e ${nextDay})`);
      } else {
        config.suspensionRules[day].push([startHour, endHour]);
      }
    });

    // Filtri anti-spam (layout single-sheet: E13:F)
    const lastDataRow = sheet.getLastRow();
    const filterStartRow = 13;
    const filterRows = lastDataRow >= filterStartRow ? (lastDataRow - filterStartRow + 1) : 0;
    if (filterRows > 0) {
      const filters = sheet.getRange(filterStartRow, 5, filterRows, 2).getValues();
      filters.forEach(row => {
        const domain = String(row[0] || '').trim().toLowerCase();
        const keyword = String(row[1] || '').trim().toLowerCase();
        if (domain) config.ignoreDomains.push(domain);
        if (keyword) config.ignoreKeywords.push(keyword);
      });
    }
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

  try {
    SpreadsheetApp.getUi().alert('✅ Tutti i trigger sono stati riattivati correttamente.');
  } catch (e) {
    console.log('✅ Tutti i trigger sono stati riattivati correttamente (Esecuzione non-UI).');
  }
}

/**
 * Alias retrocompatibile documentato nei runbook legacy.
 * Configura trigger principali + manutenzione.
 */
function setupTrigger() {
  return setupAllTriggers();
}

/**
 * Alias retrocompatibile per deployment produzione (ogni 5 minuti).
 */
function setupProductionTrigger() {
  return setupMainTrigger(5);
}

/**
 * Configura il trigger di elaborazione email.
 */
function setupMainTrigger(minutes) {
  const intervalMinutes = parseInt(minutes, 10) || 5;
  // GAS supporta solo alcuni intervalli per everyMinutes().
  const validIntervals = [1, 5, 10, 15, 30];
  const safeInterval = validIntervals.reduce((prev, curr) =>
    Math.abs(curr - intervalMinutes) < Math.abs(prev - intervalMinutes) ? curr : prev
  );
  deleteTriggersByHandler_('main');
  deleteTriggersByHandler_('processEmailsMain');

  ScriptApp.newTrigger('main')
    .timeBased()
    .everyMinutes(safeInterval)
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
 * Export giornaliero metriche su Google Sheet (best effort).
 */
function exportMetricsToSheet() {
  if (typeof CONFIG === 'undefined') {
    console.log('ℹ️ exportMetricsToSheet: CONFIG non disponibile, skip.');
    return;
  }

  const metricsSheetId = CONFIG.METRICS_SHEET_ID;
  if (!metricsSheetId || metricsSheetId.indexOf('YOUR_') !== -1) {
    console.log('ℹ️ exportMetricsToSheet: METRICS_SHEET_ID non configurato, skip.');
    return;
  }

  try {
    const limiter = new GeminiRateLimiter();
    const stats = limiter.getUsageStats();
    const sheetName = CONFIG.METRICS_SHEET_NAME || 'DailyMetrics';
    const ss = SpreadsheetApp.openById(metricsSheetId);
    const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

    // Header automatico se il foglio è vuoto
    if (sheet.getLastRow() === 0) {
      const headers = ['Timestamp', 'Data', 'Ora IT'];
      for (var modelKey in stats.models) {
        headers.push(modelKey + ' RPD used', modelKey + ' RPD limit', modelKey + ' RPD %');
        headers.push(modelKey + ' RPM used', modelKey + ' RPM limit');
        headers.push(modelKey + ' tokensTotali');
      }
      headers.push('JSON Debug');
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }

    // Riga strutturata per modello
    const row = [new Date(), stats.date, stats.italianTime];
    for (var modelKey in stats.models) {
      const m = stats.models[modelKey];
      row.push(m.rpd.used, m.rpd.limit, m.rpd.percent);
      row.push(m.rpm.used, m.rpm.limit);
      row.push(m.tokensToday);
    }
    row.push(JSON.stringify(stats)); // Colonna debug retrocompatibile
    sheet.appendRow(row);
    console.log('✓ Metriche esportate su sheet');
  } catch (e) {
    console.error(`❌ exportMetricsToSheet fallita: ${e.message}`);
  }
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
 * Configura il trigger per la pulizia settimanale della memoria.
 * La funzione associata (weeklyMemoryCleanup) deve esistere nel progetto.
 */
function setupWeeklyCleanupTrigger() {
  deleteTriggersByHandler_('weeklyMemoryCleanup');
  ScriptApp.newTrigger('weeklyMemoryCleanup')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .create();
}

/**
 * Entrypoint alternativo per trigger e script preesistenti.
 * Delega direttamente a main().
 */
function processEmailsMain() {
  return main();
}

/**
 * Funzione principale invocata dal trigger temporale (es. ogni 5 min)
 */
function main() {
  console.log('🚀 Avvio pipeline principale');

  // Jitter: previene collisioni esatte al millisecondo in caso di trigger sovrapposti
  Utilities.sleep(Math.floor(Math.random() * 1000));

  // 0. Controllo Preventivo Gmail Advanced Service
  try {
    Gmail.Users.getProfile('me'); // Probe reale: verifica disponibilità Gmail Advanced Service
  } catch (apiError) {
    const apiErrorMessage = apiError && apiError.message ? apiError.message : String(apiError);
    console.error(`CRITICO: Gmail Advanced Service non disponibile o non autorizzato. Impossibile procedere. Dettaglio: ${apiErrorMessage}`);
    return;
  }

  const executionLock = LockService.getScriptLock();
  let hasExecutionLock = false;

  try {
    // 1. Sincronizzazione Esecuzione (Prevenzione concurrency)
    hasExecutionLock = executionLock.tryLock(10000);
    if (!hasExecutionLock) {
      // Nota progettuale: evitiamo di accodare trigger aggiuntivi qui per non creare
      // una tempesta di trigger concorrenti; il trigger periodico successivo riproverà.
      console.warn('⚠️ Esecuzione già in corso o lock bloccato. Salto turno.');
      return;
    }

    // 2. Caricamento Risorse (Config, KB, Blacklist)
    withSheetsRetry(() => loadResources(false, true), 'loadResources(main)');

    // Self-healing: se la cache risulta ancora non caricata dopo un reset manuale
    // o uno stato transitorio, forziamo una seconda inizializzazione.
    if (!GLOBAL_CACHE.loaded) {
      console.warn('⚠️ GLOBAL_CACHE.loaded=false dopo loadResources(main). Tento auto-ripristino cache.');
      clearKnowledgeCache();
      withSheetsRetry(() => loadResources(false, true), 'loadResources(main,retry)');
    }

    if (!GLOBAL_CACHE.loaded) {
      console.error('💥 Risorse non caricate correttamente anche dopo auto-ripristino cache. Interruzione preventiva.');
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

    // Passaggio della dottrina strutturata e testo piatto per compatibilità con i formati di input
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
    if (hasExecutionLock && executionLock) {
      try {
        executionLock.releaseLock();
      } catch (lockError) {
        console.warn(`⚠️ Impossibile rilasciare execution lock: ${lockError.message}`);
      }
    }
  }
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
      const formattedCells = safeRow.map(cell => _formatCellForKnowledgeText(cell));
      if (!formattedCells.some(Boolean)) {
        return '';
      }
      return formattedCells
        .map(cell => cell || '-')
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

  // Evita che ritorni a capo dentro una singola cella spezzino la struttura
  // del testo KB (una riga Sheet deve restare una riga logica nel prompt).
  return String(cell)
    .replace(/\r\n?|\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function _formatDateForKnowledgeText(date) {
  const resolveScriptTz = () => {
    if (typeof Session !== 'undefined' && Session && typeof Session.getScriptTimeZone === 'function') {
      return Session.getScriptTimeZone();
    }
    // Fallback al timezone di riferimento per evitare spostamenti di giorni imprevisti.
    return 'Europe/Rome';
  };

  // Google Sheets archivia i valori "solo orario" come Date con anno 1899.
  // In KB preferiamo serializzare solo l'orario (HH:mm), non una data fittizia.
  if (date.getFullYear() < 1901) {
    const tz = resolveScriptTz();
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      return Utilities.formatDate(date, tz, 'HH:mm');
    }
    const parts = _extractDatePartsForTimeZone(date, tz);
    return `${parts.hour}:${parts.minute}`;
  }


  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    const tz = resolveScriptTz();

    // Rileviamo se Utilities supporta davvero i token orari richiesti.
    // Nei test Node il mock può restituire stringhe complete (es. "2026-05-10")
    // anche per pattern come 'H'/'m'/'s': in quel caso facciamo fallback ai parts
    // per evitare di classificare erroneamente una data-only come data+ora.
    const hStr = Utilities.formatDate(date, tz, 'H');
    const mStr = Utilities.formatDate(date, tz, 'm');
    const sStr = Utilities.formatDate(date, tz, 's');
    const utilitySupportsTimeTokens = /^\d{1,2}$/.test(hStr) && /^\d{1,2}$/.test(mStr) && /^\d{1,2}$/.test(sStr);

    if (utilitySupportsTimeTokens) {
      // Nota edge-case: in Google Sheets una data/ora esattamente alle 00:00
      // è indistinguibile da una "data-only" guardando solo i componenti temporali.
      // In quel caso questa serializzazione produrrà yyyy-MM-dd.
      const hasTime = parseInt(hStr, 10) !== 0 || parseInt(mStr, 10) !== 0 || parseInt(sStr, 10) !== 0;
      const pattern = hasTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd';
      return Utilities.formatDate(date, tz, pattern);
    }
  }

  // Fallback Node/tests: prova a rispettare lo stesso fuso orario dello script.
  const tz = resolveScriptTz();
  const parts = _extractDatePartsForTimeZone(date, tz);
  const hasTime = parts.hour !== '00' || parts.minute !== '00' || parts.second !== '00';

  if (!hasTime) {
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function _extractDatePartsForTimeZone(date, timeZone) {
  try {
    if (typeof Intl !== 'undefined' && Intl && typeof Intl.DateTimeFormat === 'function') {
      const dtf = new Intl.DateTimeFormat('en-CA', {
        timeZone: timeZone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });

      const resolved = { year: '0000', month: '00', day: '00', hour: '00', minute: '00', second: '00' };
      dtf.formatToParts(date).forEach((part) => {
        if (Object.prototype.hasOwnProperty.call(resolved, part.type)) {
          resolved[part.type] = (part.type === 'hour' && part.value === '24') ? '00' : part.value;
        }
      });
      return resolved;
    }
  } catch (e) {
    // Ignora e usa fallback UTC sotto.
  }

  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    day: String(date.getUTCDate()).padStart(2, '0'),
    hour: String(date.getUTCHours()).padStart(2, '0'),
    minute: String(date.getUTCMinutes()).padStart(2, '0'),
    second: String(date.getUTCSeconds()).padStart(2, '0')
  };
}

/**
 * Trigger automatico che si attiva ad ogni modifica del foglio.
 */
function onEdit(e) {
  const range = e.range;
  const sheet = range.getSheet();
  const sheetName = sheet.getName();
  const cellAddress = range.getA1Notation();

  // 1. Definisci qui le coordinate del tuo selettore
  // Esempio: Foglio "Controllo", cella "B2" (dove solitamente risiede lo stato o la config)
  const TARGET_SHEET = "Controllo"; 
  const TARGET_CELLS = ["B2", "F2"]; // B2 = on/off sistema, F2 = modalità lingua

  if (sheetName === TARGET_SHEET && TARGET_CELLS.includes(cellAddress)) {
    // NOTA: onEdit è un trigger semplice (max 30s, lock non affidabile).
    // Invalida solo la cache; il reload avviene nel ciclo principale con lock.
    console.log("🔄 Rilevata modifica al selettore. Invalidazione cache...");
    try {
      clearKnowledgeCache();
      (e.source || SpreadsheetApp.getActiveSpreadsheet())
        .toast("Cache invalidata. Ricarica al prossimo ciclo.", "Sistema IA", 5);
    } catch (err) {
      console.error("Errore invalidazione cache in onEdit: " + err.message);
    }
  }
}
