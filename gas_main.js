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
  doctrineBase: [],
  systemEnabled: true,
  vacationPeriods: [],
  suspensionRules: {},
  ignoreDomains: [],
  ignoreKeywords: []
};

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
 */
function isInVacationPeriod(date = new Date()) {
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

  // Normalizza input a inizio giornata per confronto date-only
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);

  for (const vp of periods) {
    const start = new Date(vp.start);
    const end = new Date(vp.end);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    if (checkDate >= start && checkDate <= end) return true;
  }

  return false;
}

/**
 * Verifica se il sistema dovrebbe essere SOSPESO
 */
function isInSuspensionTime(checkDate = new Date()) {
  const now = checkDate;
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const date = now.getDate();
  const day = now.getDay();
  const hour = now.getHours();

  // 1. GESTIONE FESTIVI (Priorità: Sistema ATTIVO)
  for (const [hMonth, hDay] of ALWAYS_OPERATING_DAYS) {
    if (monthIndex === hMonth && date === hDay) return false;
  }

  // Pasquetta, Sabato Santo
  const easter = calculateEaster(year);
  const pasquetta = new Date(easter); pasquetta.setDate(easter.getDate() + 1);
  if (now.getMonth() === pasquetta.getMonth() && date === pasquetta.getDate()) return false;

  const holySaturday = new Date(easter); holySaturday.setDate(easter.getDate() - 1);
  if (now.getMonth() === holySaturday.getMonth() && date === holySaturday.getDate()) return false;

  // Ferie Segretario (Sheet)
  if (isInVacationPeriod(now)) return false;

  // 2. ORARI UFFICIO (Sistema SOSPESO)
  const rules = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE.suspensionRules)
    ? GLOBAL_CACHE.suspensionRules
    : SUSPENSION_HOURS;

  if (rules[day]) {
    for (const [startH, endH] of rules[day]) {
      if (hour >= startH && hour < endH) return true;
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Hardening: evita crash se CONFIG non è ancora inizializzato (ordine file GAS)
  const cfg = (typeof CONFIG !== 'undefined' && CONFIG) ? CONFIG : {
    KB_SHEET_NAME: 'Istruzioni',
    AI_CORE_LITE_SHEET: 'AI_CORE_LITE',
    AI_CORE_SHEET: 'AI_CORE',
    DOCTRINE_SHEET: 'Dottrina'
  };

  if (typeof CONFIG === 'undefined') {
    console.warn('⚠️ CONFIG non disponibile in _loadResourcesInternal: uso nomi sheet di fallback.');
  }

  // KB Base
  const kbSheet = ss.getSheetByName(cfg.KB_SHEET_NAME);
  if (kbSheet) {
    const data = kbSheet.getDataRange().getValues();
    GLOBAL_CACHE.knowledgeBase = data.map(r => r.join(' | ')).join('\n');
    GLOBAL_CACHE.doctrineBase = _parseSheetToStructured(data);
  }

  // Prompt resources aggiuntive (usate da PromptEngine)
  const aiCoreLiteSheet = ss.getSheetByName(cfg.AI_CORE_LITE_SHEET);
  if (aiCoreLiteSheet) {
    GLOBAL_CACHE.aiCoreLite = aiCoreLiteSheet
      .getDataRange()
      .getValues()
      .map(r => r.filter(Boolean).join(' | ').trim())
      .filter(Boolean)
      .join('\n');
  }

  const aiCoreSheet = ss.getSheetByName(cfg.AI_CORE_SHEET);
  if (aiCoreSheet) {
    GLOBAL_CACHE.aiCore = aiCoreSheet
      .getDataRange()
      .getValues()
      .map(r => r.filter(Boolean).join(' | ').trim())
      .filter(Boolean)
      .join('\n');
  }

  const doctrineSheet = ss.getSheetByName(cfg.DOCTRINE_SHEET);
  if (doctrineSheet) {
    const doctrineData = doctrineSheet.getDataRange().getValues();
    GLOBAL_CACHE.doctrineStructured = _parseSheetToStructured(doctrineData);

    // Compatibilità con codice legacy che usa doctrineBase testuale
    if (!GLOBAL_CACHE.doctrineBase || GLOBAL_CACHE.doctrineBase.length === 0) {
      GLOBAL_CACHE.doctrineBase = doctrineData.map(r => r.join(' | ')).join('\n');
    }
  }

  // Config Avanzata
  const adv = _loadAdvancedConfig(ss);
  GLOBAL_CACHE.systemEnabled = adv.systemEnabled;
  GLOBAL_CACHE.vacationPeriods = adv.vacationPeriods;
  GLOBAL_CACHE.suspensionRules = adv.suspensionRules;
  GLOBAL_CACHE.ignoreDomains = adv.ignoreDomains;
  GLOBAL_CACHE.ignoreKeywords = adv.ignoreKeywords;

  GLOBAL_CACHE.loaded = true;
  GLOBAL_CACHE.lastLoadedAt = Date.now();
  console.log('✓ Risorse caricate correttamente.');
}

/**
 * Svuota manualmente la cache globale (knowledge/config) per forzare reload.
 * Utile come comando da eseguire a mano dall'editor Apps Script.
 */
function clearKnowledgeCache() {
  GLOBAL_CACHE.loaded = false;
  GLOBAL_CACHE.lastLoadedAt = 0;
  GLOBAL_CACHE.knowledgeBase = '';
  GLOBAL_CACHE.doctrineBase = [];
  GLOBAL_CACHE.systemEnabled = true;
  GLOBAL_CACHE.vacationPeriods = [];
  GLOBAL_CACHE.suspensionRules = {};
  GLOBAL_CACHE.ignoreDomains = [];
  GLOBAL_CACHE.ignoreKeywords = [];
  GLOBAL_CACHE.aiCoreLite = '';
  GLOBAL_CACHE.aiCore = '';
  GLOBAL_CACHE.doctrineStructured = [];
  console.log('🗑️ Cache conoscenza/config svuotata manualmente');
}

// Compatibilità con nome storico usato manualmente in alcuni ambienti.
function clearCache() {
  clearKnowledgeCache();
}

function _parseSheetToStructured(data) {
  if (!data || data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function _loadAdvancedConfig(ss) {
  const config = { systemEnabled: true, vacationPeriods: [], suspensionRules: {}, ignoreDomains: [], ignoreKeywords: [] };
  const sheet = ss.getSheetByName('Controllo');
  if (!sheet) return config;

  // Interruttore
  const status = sheet.getRange("B2").getValue();
  if (String(status).toUpperCase().includes("SPENTO")) config.systemEnabled = false;

  // Ferie (B5:E7): data inizio in B, data fine in C
  const periods = sheet.getRange("B5:E7").getValues();
  periods.forEach(r => {
    if (r[0] instanceof Date && r[1] instanceof Date) {
      config.vacationPeriods.push({ start: r[0], end: r[1] });
    }
  });

  // Sospensione (B10:E16)
  const susp = sheet.getRange("B10:E16").getValues();
  susp.forEach((r, i) => {
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

  ScriptApp.newTrigger('processEmailsMain')
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
function processEmailsMain() {
  console.log('🚀 Avvio processEmailsMain - v2.8.6.1');
  const executionLock = LockService.getScriptLock();

  try {
    // 1. Sincronizzazione Esecuzione (Prevenzione concurrency selvaggia)
    if (!executionLock.tryLock(5000)) {
      console.warn('⚠️ Esecuzione già in corso o lock bloccato. Salto turno.');
      return;
    }

    // 2. Caricamento Risorse (Config, KB, Blacklist)
    loadResources(false, true);

    // 3. Controllo Stato Sistema
    if (!GLOBAL_CACHE.systemEnabled) {
      console.log('🛑 Sistema disattivato da foglio Controllo.');
      return;
    }

    if (isInSuspensionTime()) {
      console.log('💤 Sistema in sospensione (orario ufficio/festività).');
      return;
    }

    // 4. Orchestrazione Pipeline
    const processor = new EmailProcessor();
    const knowledgeBase = GLOBAL_CACHE.knowledgeBase || '';
    const doctrineBase = GLOBAL_CACHE.doctrineBase || '';
    const results = processor.processUnreadEmails(knowledgeBase, doctrineBase);

    if (results) {
      console.log(`📊 Batch completato: ${results.total || 0} analizzati, ${results.replied || 0} risposte, ${results.errors || 0} errori.`);
    }

  } catch (error) {
    console.error(`💥 Errore fatale in processEmailsMain: ${error.message}`);
    // Qui potremmo inviare un alert email all'admin
  } finally {
    executionLock.releaseLock();
  }
}