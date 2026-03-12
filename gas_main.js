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
// ⚠️ Scelta blindata: questo TTL è allineato ai 21600s della ScriptCache.
// Cambiare solo insieme ai comandi manuali di riallineamento (primeCache/clearKnowledgeCache)
// per evitare disallineamenti "RAM fresca / ScriptCache scaduta" e ricariche imprevedibili.
const RESOURCE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 ore
const RESOURCE_CACHE_TTL_SECONDS = 21600; // 6 ore
const RESOURCE_CACHE_KEY_V2 = 'SPA_KNOWLEDGE_BASE_V2';
const RESOURCE_CACHE_KEY_V1 = 'SPA_KNOWLEDGE_BASE_V1';
const RESOURCE_CACHE_PARTS_KEY = `${RESOURCE_CACHE_KEY_V2}:parts`;
const RESOURCE_CACHE_PART_PREFIX = `${RESOURCE_CACHE_KEY_V2}:part:`;
const RESOURCE_CACHE_MAX_PART_SIZE = 95000;

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

  // Pentecoste (Pasqua + 49 giorni)
  const pentecost = new Date(easter);
  pentecost.setDate(easter.getDate() + 49);
  if (isSameCalendarDay(normalizedNow, pentecost)) return false;

  // Corpus Domini (Pasqua + 60 giorni)
  const corpusDomini = new Date(easter);
  corpusDomini.setDate(easter.getDate() + 60);
  if (isSameCalendarDay(normalizedNow, corpusDomini)) return false;

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
  const cacheIsFresh = GLOBAL_CACHE.loaded && GLOBAL_CACHE.lastLoadedAt && ((now - GLOBAL_CACHE.lastLoadedAt) < RESOURCE_CACHE_TTL_MS);
  if (cacheIsFresh) return;

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

    _loadResourcesInternal();
  } finally {
    if (lockAcquired) lock.releaseLock();
  }
}

function _loadResourcesInternal() {
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
      newCacheData.knowledgeBase = _sheetRowsToText(kbData);
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
      newCacheData.aiCoreStructured = _parseSheetToStructured(aiCoreData);
      newCacheData.aiCore = _sheetRowsToText(aiCoreData);
    }, 'Lettura AI_CORE');
  } else {
    newCacheData.aiCoreStructured = [];
    newCacheData.aiCore = '';
  }

  const doctrineSheet = withSheetsRetry(() => ss.getSheetByName(cfg.DOCTRINE_SHEET), 'Recupero foglio Dottrina');
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
  const replacementsSheet = withSheetsRetry(() => ss.getSheetByName(replacementsSheetName), 'Recupero foglio Sostituzioni');
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
  const adv = withSheetsRetry(() => _loadAdvancedConfig(ss), 'Lettura Configurazione Avanzata');
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

  const gzipped = Utilities.gzip(Utilities.newBlob(json, 'application/json'));
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

function _splitCachePayload(payload, maxSize) {
  const parts = [];
  for (let i = 0; i < payload.length; i += maxSize) {
    parts.push(payload.substring(i, i + maxSize));
  }
  return parts;
}

function _readResourceCachePayload(cache) {
  if (!cache) return null;

  // Lettura cache con supporto chiave precedente per continuità operativa.
  // Manteniamo questo ramo per non perdere warm-cache durante deploy graduali.
  const v1Payload = cache.get(RESOURCE_CACHE_KEY_V1);
  if (v1Payload) {
    return v1Payload;
  }

  const v2Inline = cache.get(RESOURCE_CACHE_KEY_V2);
  if (v2Inline) {
    return v2Inline;
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

  cache.removeAll(toRemove);
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
  if (typeof value === 'number') {
    // Orario nativo di Sheets: frazione di giorno (es. 08:00 => 0.3333...)
    if (value >= 0 && value < 1) {
      return Math.floor(value * 24);
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
    return hourFromTime;
  }

  if (!/^\d{1,2}$/.test(normalized)) return null;

  const hour = Number(normalized);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

  return hour;
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
        // Nota: NON estendiamo la fine giornata con setHours(23:59:59).
        // isInVacationPeriod confronta già date normalizzate a "yyyy-MM-dd"
        // nel timezone business, quindi il giorno finale è incluso senza manipolazioni aggiuntive.
        config.vacationPeriods.push({ start: r[0], end: r[2] });
      }
    });

    // Sospensione (B10:E16)
    const susp = sheet.getRange('B10:E16').getValues();
    susp.forEach((r, i) => {
      // Mapping esplicito indice-riga -> getDay JS:
      // B10..B16 = Lun..Dom  => 1..6,0 (dove Domenica in JS è 0, non 7).
      const day = (i + 1) % 7;
      // B contiene il nome del giorno; gli orari reali sono in C (r[1]) e D (r[2]).
      // Manteniamo questo mapping: usare r[0]/r[2] sarebbe errato per questo layout.
      const startHour = _parseStrictHour(r[1]);
      const endHour = _parseStrictHour(r[2]);
      if (startHour == null || endHour == null) return;
      if (startHour >= endHour) return;

      config.suspensionRules[day] = [[startHour, endHour]];
    });

    // Filtri anti-spam (layout single-sheet: E11:F)
    const lastDataRow = sheet.getLastRow();
    const filterStartRow = 11;
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

  // 0. Controllo Preventivo Gmail Advanced Service
  try {
    Gmail.Users.getProfile('me'); // Probe reale: verifica disponibilità Gmail Advanced Service
  } catch (apiError) {
    console.error('CRITICO: Gmail Advanced Service non disponibile o non autorizzato. Impossibile procedere.');
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
    return 'UTC';
  };

  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    const tz = resolveScriptTz();

    // Rileviamo se ha una parte oraria in base al fuso orario target
    const hasTime = (tz === 'UTC')
      ? (date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0)
      : (date.getHours() !== 0 || date.getMinutes() !== 0 || date.getSeconds() !== 0);

    const pattern = hasTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd';

    return Utilities.formatDate(date, tz, pattern);
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
          resolved[part.type] = part.value;
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
