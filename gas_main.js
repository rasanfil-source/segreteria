/** 
 * Ultimo aggiornamento: 2026-05-11 23:57
 *
 * Main.js - Entry point del sistema autoresponder
 * Gestisce trigger, inizializzazione e orchestrazione principale
 * Include logica sospensione oraria e festività italiane
 */

// Inizializzazione della cache globale condivisa tra moduli
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
  replacements: {},
  validationReviewEmail: ''
};

// Configurazione TTL allineata ai vincoli di ScriptCache (21600s).
var RESOURCE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 ore
var RESOURCE_CACHE_TTL_SECONDS = 21600; // 6 ore
var RESOURCE_CACHE_KEY_V2 = 'SPA_KNOWLEDGE_BASE_V2';
var RESOURCE_CACHE_KEY_V1 = 'SPA_KNOWLEDGE_BASE_V1';
var RESOURCE_CACHE_PARTS_KEY = `${RESOURCE_CACHE_KEY_V2}:parts`;
var RESOURCE_CACHE_PART_PREFIX = `${RESOURCE_CACHE_KEY_V2}:part:`;
var RESOURCE_CACHE_MAX_BYTES = (typeof CONFIG !== 'undefined' && Number.isFinite(Number(CONFIG.CACHE_MAX_BYTES)))
  ? Number(CONFIG.CACHE_MAX_BYTES)
  : (90 * 1024);
// CacheService limita per byte, mentre JS ragiona in code unit UTF-16.
// Usiamo un limite caratteri prudente per tenere inline/chunk sotto 100KB anche con testo multibyte.
var RESOURCE_CACHE_MAX_PART_SIZE = Math.max(10000, Math.floor((RESOURCE_CACHE_MAX_BYTES / 2) * 0.45));
var BUSINESS_TIME_ZONE = 'Europe/Rome';

function _normalizeStringArraySafe_(candidate) {
  if (!Array.isArray(candidate)) return [];
  return Array.from(new Set(candidate.map(v => String(v == null ? '' : v).trim().toLowerCase()).filter(Boolean)));
}

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
// Configurazione statica degli orari di sospensione (fallback solo se il foglio
// Controllo non è disponibile). L'oggetto è congelato per evitare mutazioni
// accidentali in runtime/test.
function _deepFreezeObject_(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.keys(value).forEach((key) => _deepFreezeObject_(value[key]));
  return Object.freeze(value);
}

const SUSPENSION_HOURS = _deepFreezeObject_({
  1: [[8, 20]],    // Lunedì: 8–20
  2: [[8, 14]],    // Martedì: 8–14
  3: [[8, 17]],    // Mercoledì: 8–17
  4: [[8, 14]],    // Giovedì: 8–14
  5: [[8, 17]]     // Venerdì: 8–17
});

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
  // Usa mezzogiorno UTC per evitare slittamenti legati al fuso runtime/script.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function getBusinessDateParts(dateObj, timeZone = BUSINESS_TIME_ZONE) {
  const source = dateObj instanceof Date ? dateObj : new Date(dateObj);
  if (!(source instanceof Date) || isNaN(source.getTime())) return null;

  const tz = timeZone || BUSINESS_TIME_ZONE;
  if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
    try {
      const year = parseInt(Utilities.formatDate(source, tz, 'yyyy'), 10);
      const monthIndex = parseInt(Utilities.formatDate(source, tz, 'M'), 10) - 1;
      const day = parseInt(Utilities.formatDate(source, tz, 'd'), 10);
      const hour = parseInt(Utilities.formatDate(source, tz, 'H'), 10);
      const minute = parseInt(Utilities.formatDate(source, tz, 'm'), 10);
      const isoDayRaw = parseInt(Utilities.formatDate(source, tz, 'u'), 10);
      const parts = {
        year,
        monthIndex,
        day,
        date: day,
        hour,
        minute,
        isoDay: (isoDayRaw >= 1 && isoDayRaw <= 7) ? (isoDayRaw % 7) : NaN
      };
      if (
        Number.isFinite(parts.year) &&
        Number.isFinite(parts.monthIndex) &&
        Number.isFinite(parts.day) &&
        Number.isFinite(parts.hour) &&
        Number.isFinite(parts.minute) &&
        Number.isFinite(parts.isoDay)
      ) {
        return parts;
      }
    } catch (e) {
      console.warn(`⚠️ Impossibile applicare timezone business (${tz}): ${e.message}`);
    }
  }

  return {
    year: source.getFullYear(),
    monthIndex: source.getMonth(),
    day: source.getDate(),
    date: source.getDate(),
    hour: source.getHours(),
    minute: source.getMinutes(),
    isoDay: source.getDay()
  };
}

function _formatBusinessDateKey_(parts) {
  if (!parts) return '';
  const y = Number(parts.year);
  const m = Number(parts.monthIndex) + 1;
  const d = Number(parts.day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Stima il numero di token per un testo ed eventuali allegati.
 * Algoritmo centralizzato (DRY): unica sorgente di verità per tutte le stime token.
 * Formula testo: max(parole * 1.25 + 10% overhead, caratteri / 3.2)
 * Allegati: stima MIME-aware (image=258, pdf=1032, default=1032) configurabile via CONFIG.
 * 
 * @param {string} text - Testo da stimare
 * @param {Array} attachments - Array di allegati (Blob GAS o parti Gemini inlineData/fileData)
 * @returns {number} Numero stimato di token (min 1)
 */
function estimateTokenCount(text, attachments = []) {
  if (!text && (!attachments || attachments.length === 0)) return 1;

  let tokens = 0;
  if (text && typeof text === 'string') {
    const cleanText = text.trim();
    const wordCount = cleanText ? cleanText.split(/\s+/).length : 0;
    const baseTokens = Math.ceil(wordCount * 1.25);
    const overhead = Math.ceil(baseTokens * 0.1);
    const charEstimate = Math.ceil(text.length / 3.2);
    tokens += Math.max(baseTokens + overhead, charEstimate, 1);
  }

  if (attachments && Array.isArray(attachments) && attachments.length > 0) {
    const tokenEstimates = (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_TOKEN_ESTIMATE)
      ? CONFIG.ATTACHMENT_TOKEN_ESTIMATE
      : {};
    const tokenImage = tokenEstimates.image || 258;
    const tokenPdf = tokenEstimates.pdf || 1032;
    const tokenDefault = tokenEstimates.defaultDoc || 1032;

    attachments.forEach((blob) => {
      try {
        // Supporta sia Blob nativi GAS sia payload gia' normalizzati per Gemini.
        const mimeType = (blob && typeof blob.getContentType === 'function')
          ? String(blob.getContentType() || '').toLowerCase()
          : (blob && blob.inlineData && blob.inlineData.mimeType)
            ? String(blob.inlineData.mimeType || '').toLowerCase()
            : (blob && blob.fileData && blob.fileData.mimeType)
              ? String(blob.fileData.mimeType || '').toLowerCase()
              : (blob && blob.mimeType)
                ? String(blob.mimeType || '').toLowerCase()
                : '';
        if (mimeType.includes('image/')) {
          tokens += tokenImage;
        } else if (mimeType.includes('pdf')) {
          tokens += tokenPdf;
        } else {
          tokens += tokenDefault;
        }
      } catch (e) {
        tokens += tokenDefault;
      }
    });
  }

  return Math.max(tokens, 1);
}
/**
 * Verifica se una data ricade in uno dei periodi ferie del segretario
 */
function isInVacationPeriod(date = new Date(), scriptTimeZone = "") {
  const effectiveTimeZone = scriptTimeZone || BUSINESS_TIME_ZONE;
  const coerceCalendarDate = function (value) {
    if (!value && value !== 0) return null;
    const isDate = Object.prototype.toString.call(value) === '[object Date]';
    if (isDate && !isNaN(value.getTime())) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const parsedDateValue = _parseDateValue(value);
      if (parsedDateValue) return parsedDateValue;
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  };

  const dateSource = coerceCalendarDate(date);
  if (!dateSource) {
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

  const formatDateOnly = function (value) {
    const source = coerceCalendarDate(value);
    if (!source) return '';
    return _formatBusinessDateKey_(getBusinessDateParts(source, effectiveTimeZone));
  };

  const checkDateKey = formatDateOnly(dateSource);
  if (!checkDateKey) return false;

  for (const vp of periods) {
    if (!vp) {
      console.warn('⚠️ Periodo ferie non valido ignorato');
      continue;
    }

    const startKey = formatDateOnly(vp.start);
    const endKey = formatDateOnly(vp.end);
    if (!startKey || !endKey) {
      console.warn('⚠️ Periodo ferie non valido ignorato');
      continue;
    }
    if (startKey > endKey) continue;

    if (checkDateKey >= startKey && checkDateKey <= endKey) return true;
  }

  return false;
}

/**
 * Confronta due Date sul solo calendario locale.
 * Resta deliberatamente difensiva perché viene usata nella logica di sospensione.
 */
function _isSameCalendarDay(left, right) {
  if (!(left instanceof Date) || isNaN(left.getTime()) || !(right instanceof Date) || isNaN(right.getTime())) {
    return false;
  }
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

/**
 * Verifica se il sistema dovrebbe essere SOSPESO
 */
function isInSuspensionTime(checkDate = new Date()) {
  const now = checkDate;

  // Regola di dominio: la sospensione è ancorata all'orario italiano.
  const businessTimeZone = BUSINESS_TIME_ZONE;
  const businessParts = getBusinessDateParts(now, businessTimeZone);
  if (!businessParts) return false;
  const year = businessParts.year;
  const monthIndex = businessParts.monthIndex;
  const date = businessParts.day;
  const day = businessParts.isoDay;
  const currentHour = businessParts.hour + (businessParts.minute / 60);

  // 1. GESTIONE FESTIVI (Priorità: Sistema ATTIVO)
  for (const [hMonth, hDay] of ALWAYS_OPERATING_DAYS) {
    if (monthIndex === hMonth && date === hDay) return false;
  }

  // Domenica di Pasqua, Pasquetta, Sabato Santo
  const easter = calculateEaster(year);
  const normalizedNow = new Date(year, monthIndex, date, 12, 0, 0);
  if (_isSameCalendarDay(normalizedNow, easter)) return false;

  // Nota manutenzione: base su "easter" è intenzionale per leggibilità semantica.
  const pasquetta = new Date(easter);
  pasquetta.setDate(easter.getDate() + 1);
  if (_isSameCalendarDay(normalizedNow, pasquetta)) return false;

  const holySaturday = new Date(easter);
  holySaturday.setDate(easter.getDate() - 1);
  if (_isSameCalendarDay(normalizedNow, holySaturday)) return false;

  // Pentecoste (Pasqua + 49 giorni)
  const pentecost = new Date(easter);
  pentecost.setDate(easter.getDate() + 49);
  if (_isSameCalendarDay(normalizedNow, pentecost)) return false;

  // Corpus Domini (Pasqua + 63 giorni: domenica successiva alla SS. Trinità, prassi italiana)
  const corpusDomini = new Date(easter);
  corpusDomini.setDate(easter.getDate() + 63);
  if (_isSameCalendarDay(normalizedNow, corpusDomini)) return false;

  // Ferie Segretario (Sheet)
  if (isInVacationPeriod(now, businessTimeZone)) return false;

  // 2. ORARI UFFICIO (Sistema SOSPESO)
  // Utilizza i dati caricati dal foglio Controllo in (A10:D16/B10:E16) durante il loadResources
  // Se il foglio Controllo è assente, usa il fallback definito via codice in SUSPENSION_HOURS.
  // Se il foglio è presente ma invalido, _loadAdvancedConfig fallisce: niente default silenziosi.
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

      if (startHour <= endHour) {
        if (currentHour >= startHour && currentHour < endHour) return true;
      } else {
        if (currentHour >= startHour || currentHour < endHour) return true;
      }
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
  const skipLabel = (typeof CONFIG !== 'undefined' && Object.prototype.hasOwnProperty.call(CONFIG, 'SKIP_LABEL_NAME')) ? CONFIG.SKIP_LABEL_NAME : '·';
  const languageMode = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE.languageMode) || 'all';

  // Non usiamo -label nella query: Gmail può applicarlo a livello thread e
  // nascondere follow-up non letti dentro conversazioni già etichettate.
  const terminalLabelNames = [labelName, errorLabel, validationLabel]
    .concat(languageMode === 'foreign_only' ? [skipLabel] : [])
    .filter(Boolean);
  let staleMetadataService = null;
  let terminalLabelIds = null;
  const getTerminalLabelIds = () => {
    if (terminalLabelIds) return terminalLabelIds;
    terminalLabelIds = [];
    try {
      if (typeof GmailService !== 'undefined' && GmailService) {
        staleMetadataService = staleMetadataService || new GmailService();
      }
      if (staleMetadataService && typeof staleMetadataService._getOptionalLabelIdByName === 'function') {
        const resolvedTerminalLabelIds = terminalLabelNames
          .map(label => staleMetadataService._getOptionalLabelIdByName(label))
          .filter(Boolean);
        terminalLabelIds = (typeof staleMetadataService._filterUserLabelIds_ === 'function')
          ? staleMetadataService._filterUserLabelIds_(resolvedTerminalLabelIds)
          : resolvedTerminalLabelIds.filter(labelId => (
            typeof labelId === 'string' &&
            !/^(INBOX|UNREAD|STARRED|SENT|DRAFT|SPAM|TRASH|IMPORTANT|CHAT|CATEGORY_.+)$/i.test(labelId.trim())
          ));
      }
    } catch (labelError) {
      console.warn(`⚠️ hasStaleUnreadThreads: impossibile risolvere label terminali (${labelError.message})`);
      terminalLabelIds = [];
    }
    return terminalLabelIds;
  };

  const hasTerminalLabel = (message) => {
    try {
      const messageId = (message && typeof message.getId === 'function') ? message.getId() : '';
      if (!messageId) return false;
      const ids = getTerminalLabelIds();
      if (ids.length === 0 && terminalLabelNames.length > 0) return false; // fail-open: detector backlog, non path di invio
      if (!staleMetadataService || typeof staleMetadataService._getMessageMetadataWithResilience !== 'function') {
        return false;
      }
      const metadata = staleMetadataService._getMessageMetadataWithResilience(messageId, { format: 'minimal' }, 1);
      const msgLabelIds = metadata && Array.isArray(metadata.labelIds) ? metadata.labelIds : [];
      return ids.some(id => msgLabelIds.includes(id));
    } catch (metadataError) {
      console.warn(`⚠️ hasStaleUnreadThreads: controllo label messaggio fallito (${metadataError.message})`);
      return false;
    }
  };

  const isProcessableStaleUnread = (message) => {
    try {
      const date = (message && typeof message.getDate === 'function') ? message.getDate() : null;
      const timeMs = date instanceof Date ? date.getTime() : NaN;
      const unread = Boolean(message && typeof message.isUnread === 'function' && message.isUnread());
      return unread &&
        Number.isFinite(timeMs) &&
        timeMs <= cutoffMs &&
        timeMs > oldestRelevantMs &&
        !hasTerminalLabel(message);
    } catch (msgError) {
      console.warn(`⚠️ hasStaleUnreadThreads: messaggio ignorato per errore metadata (${msgError.message})`);
      return false;
    }
  };

  const query = `in:inbox is:unread newer_than:${safeMaxLookbackDays}d`;

  const pageSize = 25;
  try {
    for (let offset = 0; offset < safeSearchLimit; offset += pageSize) {
      let threads = [];
      try {
        threads = GmailApp.search(query, offset, Math.min(pageSize, safeSearchLimit - offset));
      } catch (searchError) {
        console.warn(`⚠️ hasStaleUnreadThreads: GmailApp.search fallita (offset=${offset}): ${searchError.message}`);
        return false;
      }

      if (!Array.isArray(threads) || threads.length === 0) break;

      // Fix architetturale: filtra i falsi positivi della query `newer_than`
      // prima di passare al controllo dettagliato per-messaggio.
      for (const thread of threads) {
        try {
          // Verifichiamo a livello messaggio: un thread può contenere vecchie
          // risposte già terminali e nuovi follow-up ancora elaborabili.
          const messages = thread && typeof thread.getMessages === 'function' ? thread.getMessages() : [];
          const hasInternalStale = Array.isArray(messages) && messages.some(isProcessableStaleUnread);

          if (hasInternalStale) return true;

        } catch (threadError) {
          console.warn(`⚠️ hasStaleUnreadThreads: thread ignorato per errore (${threadError.message})`);
        }
      }
    }
  } catch (e) {
    console.warn(`⚠️ hasStaleUnreadThreads: fallback conservativo per errore inatteso (${e.message})`);
    return false;
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
  if (forceReload && typeof _clearScriptPropertyCache === 'function') {
    _clearScriptPropertyCache();
  }
  const spreadsheetId = (typeof CONFIG !== 'undefined' && CONFIG.SPREADSHEET_ID) ? CONFIG.SPREADSHEET_ID : null;
  const cacheIsFreshByTtl = !forceReload && GLOBAL_CACHE.loaded && GLOBAL_CACHE.lastLoadedAt && ((now - GLOBAL_CACHE.lastLoadedAt) < RESOURCE_CACHE_TTL_MS);
  let precomputedSheetModifiedAt = 0;
  if (forceReload) {
    console.log('↻ FORCE_RELOAD attivo: ricarico le risorse ignorando la cache TTL.');
  }
  if (cacheIsFreshByTtl) {
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
      const lockWaitMs = (typeof CONFIG !== 'undefined' && Number.isFinite(Number(CONFIG.EXECUTION_LOCK_WAIT_MS)))
        ? Number(CONFIG.EXECUTION_LOCK_WAIT_MS)
        : 10000;
      lockAcquired = lock.tryLock(lockWaitMs);
      if (!lockAcquired) {
        if (!GLOBAL_CACHE.loaded) {
          throw new Error('Impossibile acquisire lock per caricamento risorse.');
        }
        console.warn('⚠️ Lock non acquisito ma cache già presente: evito reload concorrente non protetto.');
        return;
      }
    }

    if (lockAcquired && cacheIsFreshByTtl) {
      const freshSheetModifiedAt = _getSpreadsheetModifiedTimeMs(spreadsheetId);
      if (freshSheetModifiedAt) {
        precomputedSheetModifiedAt = Math.max(precomputedSheetModifiedAt || 0, freshSheetModifiedAt);
      }
    }

    const lockedNow = Date.now();
    const lockedCacheIsFreshByTtl = !forceReload
      && GLOBAL_CACHE.loaded
      && GLOBAL_CACHE.lastLoadedAt
      && ((lockedNow - GLOBAL_CACHE.lastLoadedAt) < RESOURCE_CACHE_TTL_MS);
    if (lockedCacheIsFreshByTtl && (!precomputedSheetModifiedAt || precomputedSheetModifiedAt <= GLOBAL_CACHE.lastLoadedAt)) {
      return;
    }

    _loadResourcesInternal(precomputedSheetModifiedAt);
  } finally {
    if (lockAcquired) {
      try {
        lock.releaseLock();
      } catch (e) {
        console.warn(`⚠️ releaseLock loadResources fallito: ${e.message}`);
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
  const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
    ? CacheService.getScriptCache()
    : null;

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

  const newCacheData = {
    knowledgeBase: '',
    doctrineBase: '',
    doctrineStructured: [],
    aiCoreLite: '',
    aiCore: '',
    replacements: {},
    validationReviewEmail: ''
  };

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
      const aiCoreLiteData = aiCoreLiteSheet.getDataRange().getValues();
      const aiCoreLiteHealthReport = _logKnowledgeBaseHealthReport(aiCoreLiteData, cfg.AI_CORE_LITE_SHEET);
      const aiCoreLiteRowsForText = aiCoreLiteHealthReport.skippedHeader ? aiCoreLiteData.slice(1) : aiCoreLiteData;
      newCacheData.aiCoreLite = _sheetRowsToText(aiCoreLiteRowsForText);
    }, 'Lettura AI_CORE_LITE');
  }

  const aiCoreSheet = withSheetsRetry(() => ss.getSheetByName(cfg.AI_CORE_SHEET), 'Recupero foglio AI_CORE');
  if (aiCoreSheet) {
    withSheetsRetry(() => {
      const aiCoreData = aiCoreSheet.getDataRange().getValues();
      const aiCoreHealthReport = _logKnowledgeBaseHealthReport(aiCoreData, cfg.AI_CORE_SHEET);
      const aiCoreRowsForText = aiCoreHealthReport.skippedHeader ? aiCoreData.slice(1) : aiCoreData;
      newCacheData.aiCore = _sheetRowsToText(aiCoreRowsForText);
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
  newCacheData.validationReviewEmail = adv.validationReviewEmail || '';
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
  const props = (typeof PropertiesService !== 'undefined' && PropertiesService)
    ? PropertiesService.getScriptProperties()
    : null;

  let customTs = 0;
  if (props) {
    try {
      const customRaw = typeof props.getProperty === 'function'
        ? props.getProperty('KB_CUSTOM_MODIFIED_TIME')
        : null;
      const parsedCustomTs = customRaw ? parseInt(customRaw, 10) : NaN;
      if (!isNaN(parsedCustomTs) && parsedCustomTs > 0) {
        customTs = parsedCustomTs;
      }
    } catch (e) {
      console.warn('⚠️ Impossibile leggere KB_CUSTOM_MODIFIED_TIME: ' + e.message);
    }
  }

  // SCELTA TECNICA INTENZIONALE: non usare Drive.Files.get(...modifiedTime...).
  //
  // Motivo:
  //   Il modifiedTime Drive dello spreadsheet cambia a ogni scrittura sul file,
  //   non solo quando cambiano le risorse di prompt/KB. In questo progetto lo
  //   stesso spreadsheet può contenere anche dati operativi o memoria conversazionale:
  //   quelle scritture non devono invalidare la cache della knowledge base.
  //
  // Semantica desiderata:
  //   - reload immediato solo quando onEdit tocca fogli/range di risorsa e aggiorna
  //     KB_CUSTOM_MODIFIED_TIME;
  //   - altrimenti reload naturale tramite TTL CacheService (6 ore).
  //
  // Nota manutenzione:
  //   Reintrodurre Drive modifiedTime qui farebbe ricaricare la KB dopo modifiche
  //   non pertinenti, aumentando latenza/quote e annullando il beneficio della cache.
  return customTs || 0;
}

function _isKnowledgeBaseSheetName(sheetName, cfg) {
  if (!sheetName) return false;
  const safeCfg = cfg || {};
  const kbSheets = [
    safeCfg.KB_SHEET_NAME || 'Istruzioni',
    safeCfg.AI_CORE_LITE_SHEET || 'AI_CORE_LITE',
    safeCfg.AI_CORE_SHEET || 'AI_CORE',
    safeCfg.DOCTRINE_SHEET || 'Dottrina',
    safeCfg.REPLACEMENTS_SHEET_NAME || 'Sostituzioni'
  ];
  return kbSheets.includes(sheetName);
}

function _rangesIntersect_(range, startRow, startColumn, numRows, numColumns) {
  if (!range || typeof range.getRow !== 'function' || typeof range.getColumn !== 'function') {
    return false;
  }

  const rangeStartRow = Number(range.getRow());
  const rangeStartColumn = Number(range.getColumn());
  const rangeEndRow = (typeof range.getLastRow === 'function')
    ? Number(range.getLastRow())
    : rangeStartRow;
  const rangeEndColumn = (typeof range.getLastColumn === 'function')
    ? Number(range.getLastColumn())
    : rangeStartColumn;

  const targetStartRow = Number(startRow);
  const targetStartColumn = Number(startColumn);
  const targetEndRow = targetStartRow + Number(numRows) - 1;
  const targetEndColumn = targetStartColumn + Number(numColumns) - 1;

  if ([rangeStartRow, rangeStartColumn, rangeEndRow, rangeEndColumn, targetStartRow, targetStartColumn, targetEndRow, targetEndColumn].some(value => !Number.isFinite(value))) {
    return false;
  }

  return rangeStartRow <= targetEndRow
    && rangeEndRow >= targetStartRow
    && rangeStartColumn <= targetEndColumn
    && rangeEndColumn >= targetStartColumn;
}

function _isControlConfigEditRange_(sheetName, range) {
  if (sheetName !== 'Controllo') return false;

  return _rangesIntersect_(range, 2, 2, 1, 1)       // B2: interruttore
    || _rangesIntersect_(range, 2, 6, 1, 1)        // F2: modalità lingua
    || _rangesIntersect_(range, 5, 2, 3, 4)        // B5:E7: ferie/assenze
    || _rangesIntersect_(range, 6, 1, 5, 3)        // A6:C10: layout eredità ferie
    || _rangesIntersect_(range, 10, 1, 7, 4)       // A10:D16: fasce sospensione
    || _rangesIntersect_(range, 13, 5, 5000, 2)    // E13:F: filtri anti-spam
    || _rangesIntersect_(range, 19, 1, 1, 1);      // A19: validazioneReviewEmail
}

function _isResourceInvalidationEdit_(sheetName, range, cfg) {
  // Nota operativa: onEdit viene valutato solo su modifiche utente al foglio.
  // Inoltre limitiamo l'invalidazione ai fogli/range letti da loadResources,
  // escludendo ConversationMemory e fogli di log/rate-limit scritti durante l'elaborazione email.
  return _isKnowledgeBaseSheetName(sheetName, cfg) || _isControlConfigEditRange_(sheetName, range);
}

function _touchResourceConfigModifiedTime_() {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props && typeof props.setProperty === 'function') {
      props.setProperty('KB_CUSTOM_MODIFIED_TIME', String(Date.now()));
      return true;
    }
  } catch (propError) {
    console.warn('⚠️ Impossibile aggiornare KB_CUSTOM_MODIFIED_TIME: ' + propError.message);
  }
  return false;
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
    return _formatCellForKnowledgeText(value)
      .replace(/\uFEFF/g, '')
      .replace(/[\u200B-\u200D\u2060]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  const firstRow = Array.isArray(safeRows[0]) ? safeRows[0] : [safeRows[0]];
  const firstCol = normalize(firstRow[0]);
  const secondCol = normalize(firstRow[1]);
  const headerFirstColumns = ['categoria', 'category', 'principio', 'principle', 'tema', 'topic'];
  const headerSecondColumns = [
    'informazione', 'informazioni', 'info', 'information',
    'istruzione', 'instruction', 'spiegazione', 'explanation',
    'dettaglio', 'dettagli', 'detail', 'details'
  ];
  const looksLikeHeader = headerFirstColumns.includes(firstCol) && headerSecondColumns.includes(secondCol);

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

  // Utilizzo dell'enum Utilities.Charset.UTF_8.
  // Per Utilities.newBlob(data, contentType, name), il terzo parametro deve essere una stringa.
  // Utilities.newBlob() converte automaticamente le stringhe in byte UTF-8.
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

function _splitCachePayload(payload, maxChars) {
  // Nota: maxChars è una stima iniziale conservativa passata come RESOURCE_CACHE_MAX_PART_SIZE.
  // CacheService ha un limite fisico di 100KB (102400 byte) per entry.
  const ABSOLUTE_BYTE_LIMIT = 100000; // Un po' meno di 100KB per sicurezza overhead chiave.
  const parts = [];
  let start = 0;

  while (start < payload.length) {
    // Cerchiamo il chunk più grande possibile che stia nel limite di byte
    let length = Math.min(maxChars, payload.length - start);
    let chunk = payload.substring(start, start + length);

    // Verifica byte reali (possono superare maxChars se ci sono molti multibyte)
    let byteLength = Utilities.newBlob(chunk, 'text/plain; charset=UTF-8').getBytes().length;

    // Se sforiamo il limite assoluto di Apps Script, riduciamo il chunk finché non rientra.
    while (byteLength > ABSOLUTE_BYTE_LIMIT && length > 1000) {
      length = Math.floor(length * 0.9);
      chunk = payload.substring(start, start + length);
      byteLength = Utilities.newBlob(chunk, 'text/plain; charset=UTF-8').getBytes().length;
    }

    // Se payload estremamente densi di caratteri multibyte restano oltre limite anche
    // sotto 1000 code unit, trova rapidamente il chunk massimo valido invece di
    // avanzare un solo carattere per iterazione.
    if (byteLength > ABSOLUTE_BYTE_LIMIT) {
      let low = 1;
      let high = length;
      let bestLength = 0;
      let bestChunk = '';

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = payload.substring(start, start + mid);
        const candidateByteLength = Utilities.newBlob(candidate, 'text/plain; charset=UTF-8').getBytes().length;

        if (candidateByteLength <= ABSOLUTE_BYTE_LIMIT) {
          bestLength = mid;
          bestChunk = candidate;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      length = bestLength;
      chunk = bestChunk;
    }

    if (length <= 0) {
      throw new Error('Impossibile spezzare il payload in chunk validi.');
    }

    // Evita split nel mezzo di surrogate pair UTF-16
    if (start + length < payload.length) {
      const lastCode = payload.charCodeAt(start + length - 1);
      if (lastCode >= 0xD800 && lastCode <= 0xDBFF && length > 1) {
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
    console.warn(`⚠️ Cache multipart incompleta (${missing}), forzo reload senza invalidare chiavi concorrenti.`);
    return null;
  }

  return keys.map(k => chunks[k]).join('');
}

function _writeResourceCachePayload(cache, payload) {
  if (!cache) return;

  if (payload.length <= RESOURCE_CACHE_MAX_PART_SIZE) {
    // Scrittura inline: prevale sempre sul multipart perché il reader consulta
    // RESOURCE_CACHE_KEY_V2 prima dell'indice chunk. Non rimuoviamo qui i chunk
    // stale: in un ambiente multi-trigger una rimozione pre/post write potrebbe
    // cancellare un multipart appena scritto da un'altra esecuzione.
    try {
      if (typeof cache.remove === 'function') {
        cache.remove(RESOURCE_CACHE_KEY_V1);
      }
    } catch (_) {}

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

  // Il reader consulta prima le chiavi inline: rimuoverle prima della scrittura
  // multipart evita una finestra in cui una lettura concorrente preferisce il
  // payload inline stale rispetto ai chunk appena pubblicati.
  try {
    if (typeof cache.remove === 'function') {
      cache.remove(RESOURCE_CACHE_KEY_V2);
      cache.remove(RESOURCE_CACHE_KEY_V1);
    }
  } catch (_) {}

  cache.putAll(values, RESOURCE_CACHE_TTL_SECONDS);
  console.warn(`⚠️ Cache risorse salvata in modalità multipart (${parts.length} chunk).`);
}

function _invalidateResourceCacheStorage(cache) {
  if (!cache) return;

  const toRemove = [RESOURCE_CACHE_KEY_V1, RESOURCE_CACHE_KEY_V2, RESOURCE_CACHE_PARTS_KEY];
  try {
    const partsCountRaw = (typeof cache.get === 'function')
      ? cache.get(RESOURCE_CACHE_PARTS_KEY)
      : null;
    const partsCount = parseInt(partsCountRaw || '0', 10);
    if (Number.isFinite(partsCount) && partsCount > 0) {
      for (let i = 0; i < partsCount; i++) {
        toRemove.push(`${RESOURCE_CACHE_PART_PREFIX}${i}`);
      }
    }
  } catch (e) {
    console.warn('⚠️ invalidateResourceCacheStorage: impossibile leggere indice multipart, rimuovo le chiavi base: ' + (e && e.message ? e.message : String(e)));
  }

  let removeAllSucceeded = false;
  if (typeof cache.removeAll === 'function') {
    try {
      cache.removeAll(toRemove);
      removeAllSucceeded = true;
    } catch (e) {
      console.warn('⚠️ invalidateResourceCacheStorage: removeAll fallita, fallback su remove singoli: ' + (e && e.message ? e.message : String(e)));
    }
  }

  if (!removeAllSucceeded && typeof cache.remove === 'function') {
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
  // Evitare reset "parziali" altrove: causano stati fantasma e ricarica intermittenti.
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
  GLOBAL_CACHE.validationReviewEmail = '';
  GLOBAL_CACHE.aiCoreLite = '';
  GLOBAL_CACHE.aiCore = '';
  GLOBAL_CACHE.doctrineStructured = [];

  if (typeof _clearScriptPropertyCache === 'function') {
    _clearScriptPropertyCache();
  }

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
  const firstEmptyHeaderIndex = headers.findIndex(h => !h || String(h).trim() === '' || h === 'null' || h === 'undefined');
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
  // Usa i componenti nativi: Utilities.formatDate su date 1899 può applicare offset storici LMT.
  if (value instanceof Date && !isNaN(value.getTime())) {
    const hourFromDate = value.getHours();
    const minuteFromDate = value.getMinutes();
    if (
      Number.isInteger(hourFromDate) && hourFromDate >= 0 && hourFromDate <= 23
      && Number.isInteger(minuteFromDate) && minuteFromDate >= 0 && minuteFromDate <= 59
    ) {
      return hourFromDate + (minuteFromDate / 60);
    }
    return null;
  }

  if (typeof value === 'number') {
    if (value >= 0 && value < 1) {
      const totalMinutes = Math.floor((value * 24 * 60) + 0.0001);
      const hourFromFraction = Math.floor(totalMinutes / 60);
      const minuteFromFraction = totalMinutes % 60;
      if (hourFromFraction < 0 || hourFromFraction > 23 || minuteFromFraction < 0 || minuteFromFraction > 59) return null;
      return hourFromFraction + (minuteFromFraction / 60);
    }

    if (Number.isInteger(value) && value >= 0 && value <= 23) {
      return value;
    }

    return null;
  }

  const normalized = String(value == null ? '' : value)
    .replace(/[\u00A0\u202F]/g, ' ')
    .trim();

  const decimalHour = normalized.match(/^(\d{1,2})[,.](\d)$/);
  if (decimalHour) {
    const hourFromDecimal = Number(decimalHour[1]);
    const decimalPart = Number(`0.${decimalHour[2]}`);
    if (!Number.isInteger(hourFromDecimal) || hourFromDecimal < 0 || hourFromDecimal > 23) return null;
    return hourFromDecimal + decimalPart;
  }

  const hhmm = normalized.match(/^(\d{1,2})\s*(?::|h|H|\.|\s)\s*(\d{2})$/u);
  if (hhmm) {
    const hourFromTime = Number(hhmm[1]);
    const minuteFromTime = Number(hhmm[2]);
    if (!Number.isInteger(hourFromTime) || !Number.isInteger(minuteFromTime)) return null;
    if (hourFromTime < 0 || hourFromTime > 23 || minuteFromTime < 0 || minuteFromTime > 59) return null;
    return hourFromTime + (minuteFromTime / 60);
  }

  if (!/^\d{1,2}$/.test(normalized.replace(/\s+/g, ''))) return null;

  const hour = Number(normalized.replace(/\s+/g, ''));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

  return hour;
}

function _weekdayIndexFromLabel(value) {
  const normalized = String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .slice(0, 3);

  const dayMap = {
    lun: 1,
    mar: 2,
    mer: 3,
    gio: 4,
    ven: 5,
    sab: 6,
    dom: 0
  };

  return Object.prototype.hasOwnProperty.call(dayMap, normalized) ? dayMap[normalized] : null;
}

function _isWeekdayCellLabel(value) {
  return _weekdayIndexFromLabel(value) !== null;
}

function _isBlankSuspensionCell_(value) {
  if (value == null) return true;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '' || normalized === '-' || normalized === '—' || normalized === 'null' || normalized === 'undefined';
}

function _getSuspensionHourInputCells_(row) {
  const cells = Array.isArray(row) ? row : [];
  if (_isWeekdayCellLabel(cells[0])) return [cells[1], cells[3]];
  if (_isWeekdayCellLabel(cells[1])) return [cells[2], cells[3]];
  return cells.filter((cell) => !_isWeekdayCellLabel(cell));
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
    // isInSuspensionTime utilizzerà SUSPENSION_HOURS come fallback sicuro.
    config.suspensionRules = null;
    const staticDomains = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.IGNORE_DOMAINS))
      ? CONFIG.IGNORE_DOMAINS
      : [];
    const staticKeywords = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.IGNORE_KEYWORDS))
      ? CONFIG.IGNORE_KEYWORDS
      : [];
    config.ignoreDomains = _normalizeStringArraySafe_(staticDomains);
    config.ignoreKeywords = _normalizeStringArraySafe_(staticKeywords);
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

    // Ferie/assenze (layout corrente B5:E7): B=data inizio, D=data fine.
    // Supporta anche layout compatti/varianti in cui la data fine è in C o E.
    // Fallback legacy A6:C10: A=riepilogo, B=data inizio, C=data fine.
    let ferieRows = [];
    try {
      ferieRows = sheet.getRange('B5:E7').getValues().map(row => _extractVacationPeriodFromControlRow_(row));
    } catch (e) {
      ferieRows = [];
    }

    if (ferieRows.length === 0 || ferieRows.every(row => !row.start && !row.end)) {
      try {
        // Fallback su layout legacy A6:C9 (evita riga 10 che è l'inizio della sospensione)
        ferieRows = sheet.getRange('A6:C9').getValues().map(row => ({
          start: row[1],
          end: row[2]
        }));
      } catch (e) {
        ferieRows = [];
      }
    }

    ferieRows.forEach(row => {
      // Ignora righe palesemente vuote o con placeholder comuni
      const sRaw = String(row.start || '').trim();
      const eRaw = String(row.end || '').trim();
      if (!sRaw || !eRaw || sRaw === '-' || eRaw === 'null' || eRaw === 'undefined') return;

      const startDate = _parseDateValue(row.start);
      const endDate = _parseDateValue(row.end);

      if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime()) ||
          !(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
        console.warn(`⚠️ Formato data non valido: ${row.start} - ${row.end}`);
        return;
      }

      startDate.setHours(12, 0, 0, 0);
      endDate.setHours(12, 0, 0, 0);

      if (endDate < startDate) {
        console.warn(`⚠️ Data fine precedente a data inizio dopo normalizzazione: ${startDate.toLocaleDateString()} > ${endDate.toLocaleDateString()}`);
        return;
      }

      config.vacationPeriods.push({ start: new Date(startDate), end: new Date(endDate) });
    });

    // Sospensione: supporta sia il layout single-sheet corrente
    // (A=giorno, B=inizio, D=fine) sia il legacy
    // (B=giorno, C=inizio, D=fine).
    const susp = sheet.getRange('A10:D16').getValues();
    susp.forEach((r, i) => {
      const extracted = _extractSuspensionHoursFromRow(r);
      // Preferisce l'etichetta del giorno presente nel foglio (layout corrente A o legacy B).
      // Fallback retrocompatibile: A10:D16 ordinato Lun..Dom => getDay JS 1..6,0.
      const labeledDay = _weekdayIndexFromLabel(r[0]);
      const legacyLabeledDay = _weekdayIndexFromLabel(r[1]);
      const fallbackDay = i < 6 ? (i + 1) : 0; // i=0→Lun=1 ... i=6→Dom=0
      const day = (labeledDay !== null) ? labeledDay : ((legacyLabeledDay !== null) ? legacyLabeledDay : fallbackDay);
      const startHour = extracted.startHour;
      const endHour = extracted.endHour;
      const hourInputCells = _getSuspensionHourInputCells_(r);
      const hasAnyHourInput = hourInputCells.some((cell) => !_isBlankSuspensionCell_(cell));
      if (startHour == null && endHour == null && !hasAnyHourInput) return;
      if (startHour == null || endHour == null) {
        throw new Error(`Configurazione oraria non valida nel foglio Controllo alla riga ${i + 10}: servono ora inizio e fine valide.`);
      }
      if (startHour === endHour) {
        throw new Error(`Configurazione oraria non valida nel foglio Controllo alla riga ${i + 10}: ora inizio e fine coincidono (${startHour}).`);
      }

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

    // Recipient email per revisione validazione (A19)
    try {
      const reviewEmail = String(sheet.getRange('A19').getValue() || '').trim();
      if (reviewEmail && reviewEmail.includes('@')) {
        config.validationReviewEmail = reviewEmail;
      }
    } catch (e) {
      // Ignora errori su A19
    }

    if (Object.keys(config.suspensionRules).length === 0) {
      const strictSuspensionConfig = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.STRICT_SUSPENSION_CONFIG === true);
      if (strictSuspensionConfig) {
        throw new Error("Foglio 'Controllo' presente ma senza fasce sospensione valide: STRICT_SUSPENSION_CONFIG=true impedisce il fallback statico silenzioso.");
      } else {
        console.warn("⚠️ Foglio 'Controllo' presente ma senza fasce sospensione valide: sistema operativo 24/7 finché non vengono configurate regole.");
      }
    }

    // Filtri anti-spam (layout single-sheet: E13:F)
    const lastDataRow = sheet.getLastRow();
    const filterStartRow = 13;
    const filterRows = Math.max(0, lastDataRow - filterStartRow + 1);
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
  config.ignoreDomains = _normalizeStringArraySafe_([...(Array.isArray(staticDomains) ? staticDomains : []), ...(Array.isArray(config.ignoreDomains) ? config.ignoreDomains : [])]);
  config.ignoreKeywords = _normalizeStringArraySafe_([...(Array.isArray(staticKeywords) ? staticKeywords : []), ...(Array.isArray(config.ignoreKeywords) ? config.ignoreKeywords : [])]);

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
    const metricModelKeys = Object.keys(stats.models || {});

    // Header automatico se il foglio è vuoto
    if (sheet.getLastRow() === 0) {
      const headers = ['Timestamp', 'Data', 'Ora IT'];
      for (const modelKey of metricModelKeys) {
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
    for (const modelKey of metricModelKeys) {
      const m = stats.models[modelKey];
      row.push(m.rpd.used, m.rpd.limit, m.rpd.percent);
      row.push(m.rpm.used, m.rpm.limit);
      row.push(m.tokensToday);
    }
    row.push(JSON.stringify(stats)); // Archivio dati granulari per analisi statistica.
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
  deleteTriggersByHandler_('cleanupOldMemory');
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

  if (typeof validateConfigOrThrow === 'function') {
    validateConfigOrThrow();
  }

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
  const scriptCache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
    ? CacheService.getScriptCache()
    : null;
  const batchLockKey = _getExecutionBatchLockKey_();
  let hasExecutionLock = false;
  let hasBatchLock = false;
  let batchLockOwner = null;
  const releaseExecutionLock = () => {
    if (hasExecutionLock && executionLock) {
      try {
        executionLock.releaseLock();
      } catch (lockError) {
        console.warn(`⚠️ Impossibile rilasciare execution lock: ${lockError.message}`);
      } finally {
        hasExecutionLock = false;
      }
    }
  };

  try {
    // 1. Sincronizzazione Esecuzione (Prevenzione concurrency)
    const mainLockWaitMs = (typeof CONFIG !== 'undefined' && CONFIG.EXECUTION_LOCK_WAIT_MS)
      ? CONFIG.EXECUTION_LOCK_WAIT_MS : 1000;
    hasExecutionLock = executionLock.tryLock(mainLockWaitMs);
    if (!hasExecutionLock) {
      // Nota progettuale: evitiamo di accodare trigger aggiuntivi qui per non creare
      // una tempesta di trigger concorrenti; il trigger periodico successivo riproverà.
      console.warn('⚠️ Esecuzione già in corso o lock bloccato. Salto turno.');
      return;
    }
    if (scriptCache) {
      const lockOwner = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const existing = scriptCache.get(batchLockKey);
      if (existing) {
        console.warn(`⚠️ Batch lock già presente (${batchLockKey}), salto turno.`);
        return;
      }
      // TTL allineato al budget esecuzione (280 s) + margine sicurezza
      scriptCache.put(batchLockKey, lockOwner, 300);
      batchLockOwner = lockOwner;
      hasBatchLock = true;
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

    let staleOnlyMs = null;
    if (isInSuspensionTime()) {
      const staleHours = (typeof CONFIG !== 'undefined' && typeof CONFIG.SUSPENSION_STALE_UNREAD_HOURS === 'number')
        ? CONFIG.SUSPENSION_STALE_UNREAD_HOURS
        : 12;

      if (!hasStaleUnreadThreads(staleHours)) {
        console.log('💤 Sistema in sospensione (orario ufficio/festività).');
        return;
      }

      staleOnlyMs = Date.now() - (staleHours * 60 * 60 * 1000);
      console.warn(`⏰ Sospensione bypassata: trovate email non lette più vecchie di ${staleHours}h.`);
    }

    // 4. Orchestrazione Pipeline (Delegato alle classi di servizio)
    // Rilascia il gate globale prima di costruire/avviare servizi che usano ScriptLock
    // internamente (RateLimiter, MemoryService, lock thread). La deduplica operativa
    // resta protetta dai lock granulari e dall'idempotenza su singolo messaggio.
    releaseExecutionLock();

    const processor = new EmailProcessor();
    const knowledgeBase = GLOBAL_CACHE.knowledgeBase || '';
    const doctrineBase = GLOBAL_CACHE.doctrineBase || '';
    const checkpointData = _readBatchCheckpoint_();
    const runOptions = (checkpointData && Array.isArray(checkpointData.pendingThreadIds) && checkpointData.pendingThreadIds.length > 0)
      ? { threadIds: checkpointData.pendingThreadIds }
      : {};

    if (Number.isFinite(staleOnlyMs)) {
      runOptions.staleOnlyMs = staleOnlyMs;
    }

    // Passaggio della dottrina strutturata e testo piatto per compatibilità con i formati di input
    const results = processor.processUnreadEmails(knowledgeBase, doctrineBase, true, false, runOptions);
    // Il ciclo di vita del checkpoint è gestito dalla pipeline batch:
    // - batch completato: processUnreadEmails chiama _clearBatchCheckpoint_('batch completato')
    // - batch differito: il finally di processUnreadEmails salva il nuovo checkpoint pendente
    // Evitiamo quindi di cancellare qui un checkpoint appena riscritto durante una ripresa.

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
        // Ripiego silenzioso
      }
    }
  } finally {
    if (scriptCache && hasBatchLock) {
      try {
        const currentOwner = scriptCache.get(batchLockKey);
        if (currentOwner && currentOwner === batchLockOwner) {
          scriptCache.remove(batchLockKey);
          console.log(`✓ Batch lock rimosso (${batchLockKey})`);
        } else {
          console.warn(`⚠️ Batch lock non rimosso (${batchLockKey}): ownership cambiata o lock scaduto.`);
        }
      } catch (_) { }
    }
    releaseExecutionLock();
  }
}

function _getExecutionBatchLockKey_() {
  // Chiave stabile: il TTL della CacheService rappresenta la finestra di lock.
  // Usare bucket per minuto permetteva sovrapposizioni tra trigger consecutivi
  // mentre il batch precedente era ancora in esecuzione.
  return 'main_batch_lock_global_v1';
}

function resumeEmailBatchFromCheckpoint() {
  const checkpoint = _readBatchCheckpoint_();
  const raw = checkpoint ? JSON.stringify(checkpoint) : '';
  if (!raw) {
    console.log('ℹ️ Nessun checkpoint batch presente: resume skip.');
    return;
  }
  console.log('⏭️ Ripresa batch da checkpoint richiesta.');
  if (!_acquireCheckpointResumeLock_(checkpoint.runId || 'legacy')) {
    console.warn('⚠️ Resume checkpoint già in corso: skip trigger duplicato.');
    return;
  }
  main();
}

function _readBatchCheckpoint_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('EMAIL_BATCH_CHECKPOINT');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      _clearBatchCheckpoint_();
      return null;
    }
    if (!Array.isArray(parsed.pendingThreadIds) || parsed.pendingThreadIds.length === 0) {
      _clearBatchCheckpoint_();
      return null;
    }
    const ttlMs = (typeof CONFIG !== 'undefined' && Number.isFinite(Number(CONFIG.BATCH_CHECKPOINT_TTL_MS)))
      ? Number(CONFIG.BATCH_CHECKPOINT_TTL_MS)
      : (10 * 60 * 1000);
    const createdAtMs = Date.parse(parsed.createdAt || '');
    const isFresh = Number.isFinite(createdAtMs) && ((Date.now() - createdAtMs) <= ttlMs);
    if (!isFresh) {
      _clearBatchCheckpoint_();
      return null;
    }

    const maxCheckpointRetries = (typeof CONFIG !== 'undefined' && Number(CONFIG.BATCH_CHECKPOINT_MAX_RETRIES) > 0)
      ? Math.max(1, Math.floor(Number(CONFIG.BATCH_CHECKPOINT_MAX_RETRIES)))
      : 3;
    const retryCount = Number(parsed.retryCount || 0);
    if (Number.isFinite(retryCount) && retryCount >= maxCheckpointRetries) {
      console.warn(`Checkpoint abbandonato dopo ${retryCount} tentativi falliti.`);
      _labelBatchCheckpointThreadsAsError_(parsed);
      _clearBatchCheckpoint_();
      return null;
    }

    return parsed;
  } catch (_) {
    _clearBatchCheckpoint_();
    return null;
  }
}

function _labelBatchCheckpointThreadsAsError_(checkpoint) {
  const pendingThreadIds = checkpoint && Array.isArray(checkpoint.pendingThreadIds)
    ? checkpoint.pendingThreadIds
    : [];
  if (pendingThreadIds.length === 0) return;

  const errorLabelName = (typeof CONFIG !== 'undefined' && CONFIG.ERROR_LABEL_NAME)
    ? CONFIG.ERROR_LABEL_NAME
    : 'Errore';

  let gmailService = null;
  try {
    gmailService = (typeof GmailService !== 'undefined' && GmailService) ? new GmailService() : null;
  } catch (_) {
    gmailService = null;
  }

  let fallbackLabel = null;
  pendingThreadIds.forEach((threadId) => {
    try {
      const thread = GmailApp.getThreadById(threadId);
      if (!thread) return;

      if (gmailService && typeof gmailService.addLabelToThread === 'function') {
        gmailService.addLabelToThread(thread, errorLabelName);
        return;
      }

      if (!fallbackLabel && typeof GmailApp.getUserLabelByName === 'function') {
        fallbackLabel = GmailApp.getUserLabelByName(errorLabelName);
      }
      if (!fallbackLabel && typeof GmailApp.createLabel === 'function') {
        fallbackLabel = GmailApp.createLabel(errorLabelName);
      }
      if (fallbackLabel && typeof thread.addLabel === 'function') {
        thread.addLabel(fallbackLabel);
      }
    } catch (labelError) {
      console.warn(`⚠️ Impossibile applicare label Errore al thread checkpoint ${threadId}: ${labelError.message}`);
    }
  });
}

function _clearBatchCheckpoint_() {
  try {
    PropertiesService.getScriptProperties().deleteProperty('EMAIL_BATCH_CHECKPOINT');
  } catch (_) { }

  try {
    if (
      typeof ScriptApp === 'undefined' ||
      !ScriptApp ||
      typeof ScriptApp.getProjectTriggers !== 'function' ||
      typeof ScriptApp.deleteTrigger !== 'function'
    ) {
      return;
    }

    const triggers = ScriptApp.getProjectTriggers() || [];
    triggers.forEach(trigger => {
      try {
        if (
          trigger &&
          typeof trigger.getHandlerFunction === 'function' &&
          trigger.getHandlerFunction() === 'resumeEmailBatchFromCheckpoint'
        ) {
          ScriptApp.deleteTrigger(trigger);
        }
      } catch (_) { }
    });
  } catch (_) { }
}

function _acquireCheckpointResumeLock_(runId) {
  try {
    const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
      ? CacheService.getScriptCache()
      : null;
    if (!cache) return true;
    const key = `checkpoint_resume_lock_${String(runId || 'unknown')}`;
    const lock = (typeof LockService !== 'undefined' && LockService && typeof LockService.getScriptLock === 'function')
      ? LockService.getScriptLock()
      : null;
    let lockAcquired = false;
    try {
      if (lock && typeof lock.tryLock === 'function') {
        lockAcquired = lock.tryLock(2000);
        if (!lockAcquired) return false;
      }
      if (cache.get(key)) return false;
      cache.put(key, '1', 120);
      return true;
    } finally {
      if (lockAcquired && lock && typeof lock.releaseLock === 'function') {
        try {
          lock.releaseLock();
        } catch (_) { }
      }
    }
  } catch (_) {
    return true;
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
      const lastNonEmptyIdx = (() => {
        for (let i = formattedCells.length - 1; i >= 0; i--) {
          if (formattedCells[i]) return i;
        }
        return -1;
      })();
      if (lastNonEmptyIdx < 0) return '';

      return formattedCells
        .slice(0, lastNonEmptyIdx + 1)
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
    // Evita Utilities.formatDate: sulle date 1899 può applicare offset storici
    // LMT (Local Mean Time) e spostare l'orario di alcuni minuti.
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
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

function parseDateSafe(input, fallback = null, explicitTimeZone = null) {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? fallback : new Date(input.getTime());
  }
  if (input === null || input === undefined || input === '') return fallback;

  if (typeof input === 'string') {
    const trimmed = String(input).trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const tz = explicitTimeZone ||
        (typeof Session !== 'undefined' && Session &&
          typeof Session.getScriptTimeZone === 'function'
          ? Session.getScriptTimeZone()
          : 'Europe/Rome');
      const noonUtcGuess = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00Z`);
      try {
        const y = Utilities.formatDate(noonUtcGuess, tz, 'yyyy');
        const m = Utilities.formatDate(noonUtcGuess, tz, 'MM');
        const d = Utilities.formatDate(noonUtcGuess, tz, 'dd');
        return new Date(`${y}-${m}-${d}T12:00:00`);
      } catch (_) {
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
      }
    }
  }

  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  return fallback;
}

/**
 * Estrae un periodo ferie da una riga del layout Controllo B5:E7.
 * Il layout documentato usa B=inizio e D=fine, ma alcuni fogli reali
 * possono avere la fine in C (layout compatto), l'inizio in C o la fine in E.
 * Per evitare falsi periodi invalidi, usa la prima coppia di date valide trovata sulla riga.
 * @param {Array<*>} row - Riga letta da B:E.
 * @returns {{start: *, end: *}} Valori originali di inizio/fine da convertire a valle.
 */
function _extractVacationPeriodFromControlRow_(row) {
  if (!Array.isArray(row) || row.length === 0) {
    return { start: null, end: null };
  }

  const row0IsStart = _parseDateValue(row[0]) !== null;
  const shiftedStartHasEnd = _parseDateValue(row[1]) !== null
    && (_parseDateValue(row[2]) !== null || _parseDateValue(row[3]) !== null);
  const start = row0IsStart ? row[0] : (shiftedStartHasEnd ? row[1] : null);
  const endCandidates = row0IsStart
    ? [row[2], row[1], row[3]]
    : [row[2], row[3]];
  const end = endCandidates.find(value => _parseDateValue(value) !== null) ?? null;

  // Preferenza esplicita fine: D (documentato), poi C (compatto), poi E (variante estesa).
  return { start, end };
}

/**
 * Converte valori data provenienti da Google Sheets in Date valide.
 * Supporta Date native, seriali Sheets e stringhe italiane gg/mm/aaaa.
 * @param {*} value - Valore cella da convertire
 * @returns {Date|null} Date valida o null se non interpretabile
 */
function _parseDateValue(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value === 'number' && isFinite(value)) {
    // Google Sheets usa 1899-12-30 come origine dei seriali data.
    // I seriali data odierni sono > 40000. Sotto 36526 (anno 2000) o per numeri 
    // molto piccoli (es. ore 8, 12) restituiamo null per evitare falsi positivi.
    if (value < 36526) return null;

    const millis = Math.round((value - 25569) * 86400 * 1000);
    const parsed = new Date(millis);
    if (!isNaN(parsed.getTime())) {
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // Formato italiano più comune nei fogli: gg/mm/aaaa o gg-mm-aaaa.
  const italianMatch = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+.*)?$/);
  if (italianMatch) {
    const day = parseInt(italianMatch[1], 10);
    const month = parseInt(italianMatch[2], 10);
    const year = parseInt(italianMatch[3], 10);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      return parsed;
    }

    return null;
  }

  // Evita la "UTC midnight trap": in JS/GAS le stringhe ISO date-only
  // (es. 2026-12-25) vengono interpretate a mezzanotte UTC e, con fusi
  // negativi, possono retrocedere al giorno precedente via getDate().
  const isoDateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnlyMatch) {
    const year = parseInt(isoDateOnlyMatch[1], 10);
    const month = parseInt(isoDateOnlyMatch[2], 10);
    const day = parseInt(isoDateOnlyMatch[3], 10);
    const parsed = new Date(year, month - 1, day);
    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
    ) {
      return parsed;
    }
    return null;
  }


  return null;
}

/**
 * Trigger automatico che si attiva ad ogni modifica del foglio.
 */
function onEdit(e) {
  if (!e || !e.range) {
    console.log('ℹ️ onEdit chiamato senza range: nessuna azione.');
    return;
  }

  const range = e.range;
  const sheet = range.getSheet();
  const sheetName = sheet.getName();
  const cfg = (typeof CONFIG !== 'undefined' && CONFIG) ? CONFIG : null;

  // Ogni modifica alle risorse usate da loadResources aggiorna il timestamp virtuale
  // e svuota ScriptCache: il reload avviene poi nel ciclo main con lock.
  if (_isResourceInvalidationEdit_(sheetName, range, cfg)) {
    const touched = _touchResourceConfigModifiedTime_();
    console.log(`↻ Timestamp risorse aggiornato da onEdit su foglio: ${sheetName}${touched ? '' : ' (best effort)'}`);

    try {
      clearKnowledgeCache();
      (e.source || SpreadsheetApp.getActiveSpreadsheet())
        .toast("Cache invalidata. Ricarica al prossimo ciclo.", "Sistema IA", 5);
    } catch (err) {
      console.error("Errore invalidazione cache in onEdit: " + err.message);
    }
  }
}
