/**
 * Main.js - Entry point del sistema autoresponder
 * Gestisce trigger, inizializzazione e orchestrazione principale
 * Include logica sospensione oraria e festività italiane
 */

/**
 * Trigger speciale per creare menu personalizzato all'apertura del foglio
 */
// function onOpen() {
//   SpreadsheetApp.getUi()
//     .createMenu('Parocchia GAS')
//     .addItem('⚙️ Setup Configurazione UI', 'setupConfigurationSheets')
//     .addToUi();
// }

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

  if (typeof GLOBAL_CACHE === 'undefined' || !GLOBAL_CACHE.vacationPeriods) {
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

  // Usa regole dinamiche se caricate, altrimenti fallback (anche se loadResources dovrebbe aver gestito il fallback)
  const rules = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE.suspensionRules)
    ? GLOBAL_CACHE.suspensionRules
    : SUSPENSION_HOURS;

  if (rules[day]) {
    for (const [startH, endH] of rules[day]) {
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
  const HOLIDAYS = [
    '01-01', // 🥳 Capodanno
    '06-01', // 👑 Epifania
    '25-04', // 🇮🇹 Liberazione
    '01-05', // 👷 Lavoro
    '02-06', // 🇮🇹 Repubblica
    '29-06', // ⛪ SS. Pietro e Paolo
    '15-08', // 🏖️ Ferragosto
    '01-11', // 🕯️ Ognissanti
    '08-12', // ⛪ Immacolata
    '25-12', // 🎄 Natale
    '26-12'  // 🎁 Santo Stefano
  ];

  let isSpecial = false;

  for (const holiday of HOLIDAYS) {
    const [hDay, hMonth] = holiday.split('-').map(Number);
    if (month === hMonth && day === hDay) {
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
  const maxRetries = (typeof CONFIG !== 'undefined' && CONFIG.SHEETS_RETRY_MAX) ? CONFIG.SHEETS_RETRY_MAX : 3;
  const baseBackoff = (typeof CONFIG !== 'undefined' && CONFIG.SHEETS_RETRY_BACKOFF_MS) ? CONFIG.SHEETS_RETRY_BACKOFF_MS : 1000;

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
 * Carica risorse complementari alla KB (ferie, AI Core, dottrina, sostituzioni)
 * @param {Spreadsheet} spreadsheet
 */
function _loadSupplementaryResources(spreadsheet) {
  GLOBAL_CACHE.aiCoreLite = '';
  GLOBAL_CACHE.aiCoreLiteStructured = [];
  GLOBAL_CACHE.aiCore = '';
  GLOBAL_CACHE.aiCoreStructured = [];
  GLOBAL_CACHE.doctrineBase = '';
  GLOBAL_CACHE.doctrineStructured = [];
  GLOBAL_CACHE.replacements = {};

  // Carica AI_CORE_LITE (principi pastorali base)
  const liteSheet = spreadsheet.getSheetByName(CONFIG.AI_CORE_LITE_SHEET);
  if (liteSheet) {
    const liteData = liteSheet.getDataRange().getValues();
    GLOBAL_CACHE.aiCoreLite = liteData.map(row => row.join(' | ')).join('\n');
    GLOBAL_CACHE.aiCoreLiteStructured = _parseSheetToStructured(liteData);
    console.log(`\u2713 AI_CORE_LITE caricato: ${GLOBAL_CACHE.aiCoreLite.length} caratteri`);
  }

  // Carica AI_CORE (principi pastorali estesi)
  const coreSheet = spreadsheet.getSheetByName(CONFIG.AI_CORE_SHEET);
  if (coreSheet) {
    const coreData = coreSheet.getDataRange().getValues();
    GLOBAL_CACHE.aiCore = coreData.map(row => row.join(' | ')).join('\n');
    GLOBAL_CACHE.aiCoreStructured = _parseSheetToStructured(coreData);
    console.log(`\u2713 AI_CORE caricato: ${GLOBAL_CACHE.aiCore.length} caratteri`);
  }

  // Carica Dottrina (base dottrinale completa)
  const doctrineSheet = spreadsheet.getSheetByName(CONFIG.DOCTRINE_SHEET);
  if (doctrineSheet) {
    const doctrineData = doctrineSheet.getDataRange().getValues();
    GLOBAL_CACHE.doctrineBase = doctrineData.map(row => row.join(' | ')).join('\n');
    GLOBAL_CACHE.doctrineStructured = _parseSheetToStructured(doctrineData);
    console.log(`\u2713 Dottrina caricata: ${GLOBAL_CACHE.doctrineBase.length} caratteri`);
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
      console.log(`\u2713 Sostituzioni caricate: ${Object.keys(GLOBAL_CACHE.replacements).length}`);
    }
  } catch (replError) {
    console.warn(`⚠️ Impossibile caricare sostituzioni: ${replError.message}`);
  }
}




/**
 * Legge le configurazioni avanzate dal foglio Controllo (Interruttori e Orari Sospensione)
 * @param {Spreadsheet} spreadsheet
 * @returns {Object} Configurazione letta
 */
function _loadAdvancedConfig(spreadsheet) {
  const config = {
    systemEnabled: true,          // Default: ACCESO
    vacationPeriods: [],           // Default: Nessun periodo ferie extra
    suspensionRules: {},           // Default: Nessuna regola sospensione (usa hardcoded)
    ignoreDomains: [],             // Default: Nessun dominio extra
    ignoreKeywords: []             // Default: Nessuna keyword extra
  };

  try {
    const sheet = spreadsheet.getSheetByName('Controllo');

    // Se il foglio non esiste, ritorna config vuota (userà i fallback hardcoded)
    if (!sheet) {
      console.warn("⚠️ Foglio 'Controllo' non trovato. Uso configurazione di riserva (codice).");
      return config;
    }

    // 1. INTERRUTTORE GENERALE (Cella unita B2-D2 -> leggiamo B2)
    // Valori attesi: "ACCESO" / "SPENTO" (o simili)
    const systemStatus = sheet.getRange("B2").getValue();
    if (String(systemStatus).toUpperCase().includes("SPENTO") ||
      String(systemStatus).toUpperCase().includes("OFF")) {
      config.systemEnabled = false;
      console.log("🛑 SISTEMA SPENTO da Foglio Controllo (Cella B2)");
    } else {
      console.log("✅ SISTEMA ACCESO da Foglio Controllo");
    }

    // 2. PERIODI ATTIVI H24 (Ferie Segretario) - B5:D7
    // Celle B5, B6, B7 (Inizio) e D5, D6, D7 (Fine)
    // range B5:E7 -> B=0, C=1, D=2, E=3.
    const activePeriodsRange = sheet.getRange("B5:E7").getValues();

    activePeriodsRange.forEach((row, index) => {
      const start = row[0]; // Colonna B
      const end = row[2];   // Colonna D

      if (start && end && start instanceof Date && end instanceof Date) {
        // Validazione date
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          config.vacationPeriods.push({ start: start, end: end });
          console.log(`📅 Periodo H24 rilevato: ${start.toLocaleDateString()} - ${end.toLocaleDateString()}`);
        }
      }
    });

    // 3. ORARI SOSPENSIONE (Righe 10-16)
    // Caselle B (Inizio) e D (Fine)
    // range B10:E16 -> B=0, C=1, D=2, E=3.

    const suspensionRange = sheet.getRange("B10:E16").getValues();

    suspensionRange.forEach((row, index) => {
      const startHour = parseInt(row[0]); // Colonna B (indice 0)
      const endHour = parseInt(row[2]);   // Colonna D (indice 2)

      // Mappatura giorno corretta
      let dayOfWeek = index + 1;
      if (dayOfWeek === 7) dayOfWeek = 0; // Domenica

      if (!isNaN(startHour) && !isNaN(endHour)) {
        // Se c'è un orario valido (es. 8 e 20)
        // Sovrascriviamo la regola per quel giorno
        if (!config.suspensionRules[dayOfWeek]) {
          config.suspensionRules[dayOfWeek] = [];
        }
        config.suspensionRules[dayOfWeek].push([startHour, endHour]);
        console.log(`zzz Sospensione caricata per Giorno ${dayOfWeek}: ${startHour}:00 - ${endHour}:00`);
      }
    });

    // 4. BLACKLIST DOMINI e KEYWORD (da riga 17 per evitare overlap con orari)
    // E17:E120 -> Domini
    // F17:F120 -> Keyword
    const blacklistRange = sheet.getRange("E17:F120").getValues();

    blacklistRange.forEach(row => {
      const domain = String(row[0]).trim();
      const keyword = String(row[1]).trim();

      // Normalizzazione apostrofi: converte ’ e ‘ in ' standard
      if (domain && domain.length > 3) {
        config.ignoreDomains.push(domain.toLowerCase()); // I domini non hanno apostrofi di solito, ma ok per sicurezza
      }

      if (keyword && keyword.length > 3) {
        // Normalizza keyword: toglie apostrofi curvi
        const normalizedKeyword = keyword.replace(/[\u2018\u2019]/g, "'").toLowerCase();
        config.ignoreKeywords.push(normalizedKeyword);
      }
    });

    if (config.ignoreDomains.length > 0) console.log(`🚫 Caricati ${config.ignoreDomains.length} domini extra da blacklist`);
    if (config.ignoreKeywords.length > 0) console.log(`🚫 Caricate ${config.ignoreKeywords.length} keyword extra da blacklist`);

    return config;

  } catch (error) {
    console.error(`❌ Errore caricamento Configurazione Avanzata: ${error.message}`);
    return config; // Ritorna quello che ha trovato finora (o default)
  }
}

/**
 * Applica la configurazione avanzata letta dal foglio Controllo alla cache globale.
 * @param {Object} advancedConfig
 */
function _applyAdvancedConfigToCache(advancedConfig) {
  GLOBAL_CACHE.systemEnabled = advancedConfig.systemEnabled;
  GLOBAL_CACHE.vacationPeriods = advancedConfig.vacationPeriods;

  if (Object.keys(advancedConfig.suspensionRules).length > 0) {
    GLOBAL_CACHE.suspensionRules = advancedConfig.suspensionRules;
    console.log('🗓️ Usate regole sospensione da Foglio Controllo');
  } else {
    GLOBAL_CACHE.suspensionRules = SUSPENSION_HOURS;
    console.log('🗓️ Usate regole sospensione di default (Codice)');
  }

  const uniqueDomains = new Set([...CONFIG.IGNORE_DOMAINS, ...advancedConfig.ignoreDomains]);
  GLOBAL_CACHE.ignoreDomains = Array.from(uniqueDomains);

  const uniqueKeywords = new Set([...CONFIG.IGNORE_KEYWORDS, ...advancedConfig.ignoreKeywords]);
  GLOBAL_CACHE.ignoreKeywords = Array.from(uniqueKeywords);
}

/**
 * Carica tutte le risorse necessarie (Knowledge Base, sostituzioni, ferie, blacklist, config)
 * Usa lock per prevenire race condition tra esecuzioni parallele
 * @param {boolean} acquireLock - Se true, acquisisce il lock in autonomia.
 */
function loadResources(acquireLock = true, hasExternalLock = false) {
  if (!acquireLock) {
    // NOTA: chi invoca con acquireLock=false DEVE detenere già un lock esterno
    // (es. executionLock in main()). Verifica runtime per evitare refactor pericolosi.
    if (!hasExternalLock) {
      throw new Error('loadResources(false) richiede hasExternalLock=true');
    }
    if (GLOBAL_CACHE.loaded) {
      console.log('ℹ️ Risorse già caricate, salto reload (fast-path senza lock)');
      return;
    }
    _loadResourcesInternal();
    return;
  }

  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  try {
    // Tenta di acquisire lock per 10 secondi
    // Gestione concorrenza: Se il lock fallisce, prosegue se la cache è vuota.
    // L'istanza corrente necessita dei dati per procedere.
    lockAcquired = lock.tryLock(10000);
    if (!lockAcquired) {
      console.warn('⚠️ Impossibile acquisire lock per loadResources (timeout 10s)');
      if (!GLOBAL_CACHE.loaded) {
        console.error('🚨 Cache locale vuota ma lock non acquisito: skip caricamento per evitare race condition');
        return;
      } else {
        console.log('ℹ️ Cache già carica, salto reload');
        return;
      }
    }

    _loadResourcesInternal();
  } catch (error) {
    console.error(`❌ Errore caricamento risorse: ${error.message}`);
  } finally {
    if (lockAcquired) {
      try {
        lock.releaseLock();
      } catch (e) {
        console.warn(`⚠️ Errore rilascio ScriptLock: ${e.message}`);
      }
    }
  }
}

/**
 * Logica interna di caricamento risorse (senza gestione lock).
 */
function _loadResourcesInternal() {
  // Il lock esterno in loadResources garantisce la sicurezza durante il caricamento fisico.
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

    // Carichiamo tutte le risorse restanti (dottrina, AI core, sostituzioni, ferie, blacklist, config)
    withSheetsRetry(() => {
      const props = PropertiesService.getScriptProperties();
      const sheetId = props.getProperty('SPREADSHEET_ID') || CONFIG.SPREADSHEET_ID;
      const spreadsheet = SpreadsheetApp.openById(sheetId);

      _loadSupplementaryResources(spreadsheet);

      const advancedConfig = _loadAdvancedConfig(spreadsheet);
      _applyAdvancedConfigToCache(advancedConfig);

    }, 'Caricamento risorse (Cache)');

    GLOBAL_CACHE.loaded = true;
    return;
  }

  // CACHE MISS - FULL LOAD
  withSheetsRetry(() => {
    // Risoluzione ID foglio: priorità a Script Properties
    const props = PropertiesService.getScriptProperties();
    const sheetId = props.getProperty('SPREADSHEET_ID') || CONFIG.SPREADSHEET_ID;

    if (!sheetId || sheetId.includes('PLACEHOLDER')) {
      throw new Error('SPREADSHEET_ID non valido (controllare Script Properties)');
    }

    const spreadsheet = SpreadsheetApp.openById(sheetId);

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

    _loadSupplementaryResources(spreadsheet);

    // --- Caricamento Configurazione Avanzata (Controllo) ---
    const advancedConfig = _loadAdvancedConfig(spreadsheet);
    _applyAdvancedConfigToCache(advancedConfig);

  }, 'loadResources');

  GLOBAL_CACHE.loaded = true;
  console.log('✓ Tutte le risorse caricate con successo');
}



// ====================================================================
// ENTRY POINT PRINCIPALE
// ====================================================================

/**
 * Funzione principale da collegare al trigger temporizzato
 * Eseguire ogni 5-15 minuti
 */
function main() {
  const logger = createLogger('Main');
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

    // Carica risorse PRIMA di controllare sospensione
    loadResources(false, true);

    // 0. SAFETY CHECK: Sistema Abilitato?
    if (GLOBAL_CACHE.systemEnabled === false) {
      console.warn('⛔ SISTEMA DISABILITATO DA FOGLIO CONTROLLO (Cella B2)');
      return;
    }

    // Controlla sospensione (ORA le ferie e orari sono caricati)
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
          logger.warn(`Safety Valve attiva: quota ${maxPercent}%`);
        }
      } catch (e) {
        console.warn(`⚠️ Errore calcolo Safety Valve: ${e.message}`);
      }
    }

    if (!GLOBAL_CACHE.knowledgeBase) {
      const error = new Error('Knowledge Base non caricata');
      console.error(`❌ ${error.message}`);
      throw error;
    }

    // Crea ed esegui processore email
    try {
      const processor = new EmailProcessor();
      const stats = processor.processUnreadEmails(
        GLOBAL_CACHE.knowledgeBase,
        GLOBAL_CACHE.doctrineBase,
        true
      );

      console.log('\n✓ Elaborazione completata');
      console.log(`   Processate: ${stats.total}, Risposte: ${stats.replied}, Filtrate: ${stats.filtered}`);

    } catch (error) {
      console.error(`❌ Errore fatale: ${error.message}`);
      throw error;
    }
  } catch (fatalError) {
    // CATTURA ERRORI CRITICI E INVIA NOTIFICA
    logger.error(`Errore Critico Sistema: ${fatalError.message}`, {
      stack: fatalError.stack
    });
    console.error('🔥 CRASH SISTEMA GESTITO DALLA CATCH GLOBALE 🔥');
    throw fatalError; // Rilancia per far fallire l'esecuzione in GAS Console
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

  // Crea nuovo trigger ogni 5 minuti
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
 * Pulisce manualmente la cache di sistema (utile per forzare aggiornamento KB)
 * Eseguire MANUALMENTE questa funzione se si modificano i Fogli Google e si vuole effetto immediato.
 * Questa è l'UNICA funzione da utilizzare per la pulizia della cache.
 */
function clearSystemCache() {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove('KB_CONTENT');
    // NOTA: I lock dei thread (thread_lock_ID) scadono automaticamente tramite TTL.

    // Resetta variabile globale
    if (typeof GLOBAL_CACHE !== 'undefined') {
      GLOBAL_CACHE.loaded = false;
      GLOBAL_CACHE.knowledgeBase = '';
      GLOBAL_CACHE.knowledgeStructured = [];
      GLOBAL_CACHE.aiCoreLite = '';
      GLOBAL_CACHE.aiCoreLiteStructured = [];
      GLOBAL_CACHE.aiCore = '';
      GLOBAL_CACHE.aiCoreStructured = [];
      GLOBAL_CACHE.doctrineBase = '';
      GLOBAL_CACHE.doctrineStructured = [];
      GLOBAL_CACHE.replacements = {};
      GLOBAL_CACHE.vacationPeriods = [];
    }

    console.log('🧹 Cache di sistema svuotata con successo.');
    console.log('   Al prossimo avvio le risorse verranno ricaricate fresche dai Fogli Google.');
  } catch (error) {
    console.error(`❌ Errore durante svuotamento cache: ${error.message}`);
  }
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