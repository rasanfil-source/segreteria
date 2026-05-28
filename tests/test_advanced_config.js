const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

function assertThrows(fn, expectedPattern, message) {
  try {
    fn();
  } catch (error) {
    const text = error && error.message ? error.message : String(error);
    if (!expectedPattern || expectedPattern.test(text)) return;
    console.error(`❌ ${message}. Errore inatteso: ${text}`);
    process.exit(1);
  }
  console.error(`❌ ${message}. Nessun errore lanciato.`);
  process.exit(1);
}

global.CONFIG = {
  IGNORE_DOMAINS: ['Static.com', 'mailchimp.com'],
  IGNORE_KEYWORDS: ['newsletter', 'unsubscribe']
};

global.Utilities = {
  sleep: () => {}
};

const gasMainPath = path.join(__dirname, '..', 'gas_main.js');
const code = fs.readFileSync(gasMainPath, 'utf8');
vm.runInThisContext(code, { filename: gasMainPath });

console.log('--- Test estrazione ferie layout variabili B5:E7 ---');
const compactVacationRow = _extractVacationPeriodFromControlRow_([new Date('2026-07-01'), new Date('2026-07-10'), '', '']);
const extendedVacationRow = _extractVacationPeriodFromControlRow_([new Date('2026-09-01'), '', '', new Date('2026-09-10')]);
const invalidVacationRow = _extractVacationPeriodFromControlRow_(['nota ferie', '', '', '']);
assert(_parseDateValue(compactVacationRow.start).getTime() === new Date(2026, 6, 1).getTime(), 'layout B-C deve mantenere inizio in B');
assert(_parseDateValue(compactVacationRow.end).getTime() === new Date(2026, 6, 10).getTime(), 'layout B-C deve leggere fine in C');
assert(_parseDateValue(extendedVacationRow.end).getTime() === new Date(2026, 8, 10).getTime(), 'layout B-E deve leggere fine in E se C/D sono vuote');
assert(invalidVacationRow.end === null, 'riga ferie senza data fine valida deve restituire end null, non undefined');
console.log('✅ Test estrazione ferie layout variabili passati');

console.log('--- Test orari Sheets 1899 ignorano offset storici LMT ---');
{
  const originalFormatDate = global.Utilities.formatDate;
  const originalSession = global.Session;
  const sheetTime = new Date(1899, 11, 30, 14, 30, 0, 0);

  global.Session = {
    getScriptTimeZone: () => 'Europe/Rome'
  };
  global.Utilities.formatDate = (_date, _tz, pattern) => {
    if (pattern === 'HH:mm') return '14:19';
    if (pattern === 'H') return '13';
    return '1899-12-30';
  };

  assert(_formatDateForKnowledgeText(sheetTime) === '14:30', 'serializzazione KB deve usare getHours/getMinutes su date Sheets 1899');
  assert(_parseStrictHour(sheetTime) === 14.5, 'fasce sospensione devono usare getHours/getMinutes su date Sheets 1899');

  if (typeof originalFormatDate === 'undefined') {
    delete global.Utilities.formatDate;
  } else {
    global.Utilities.formatDate = originalFormatDate;
  }
  global.Session = originalSession;
}

function fakeRange(row, column, lastRow = row, lastColumn = column) {
  return {
    getRow: () => row,
    getColumn: () => column,
    getLastRow: () => lastRow,
    getLastColumn: () => lastColumn
  };
}

console.log('--- Test invalidazione cache per range Controllo ---');
assert(_isControlConfigEditRange_('Controllo', fakeRange(5, 2)), 'B5 ferie deve invalidare cache');
assert(_isControlConfigEditRange_('Controllo', fakeRange(7, 5)), 'E7 ferie variante estesa deve invalidare cache');
assert(_isControlConfigEditRange_('Controllo', fakeRange(10, 1, 16, 4)), 'A10:D16 sospensione deve invalidare cache');
assert(_isControlConfigEditRange_('Controllo', fakeRange(13, 5)), 'E13 filtri deve invalidare cache');
assert(_isControlConfigEditRange_('Controllo', fakeRange(19, 1)), 'A19 validation email deve invalidare cache');
assert(!_isControlConfigEditRange_('Controllo', fakeRange(20, 1)), 'A20 fuori configurazione non deve invalidare cache');
assert(!_isControlConfigEditRange_('Controllo', fakeRange(6000, 5)), 'E6000 fuori area filtri non deve invalidare cache');
assert(!_isControlConfigEditRange_('ConversationMemory', fakeRange(5, 2)), 'ConversationMemory non deve invalidare cache risorse via onEdit');
assert(!_isResourceInvalidationEdit_('ConversationMemory', fakeRange(5, 2), global.CONFIG), 'scritture memoria conversazioni non devono invalidare risorse');
assert(!_isResourceInvalidationEdit_('Log', fakeRange(2, 1), global.CONFIG), 'fogli di log non devono invalidare risorse');
assert(!_isResourceInvalidationEdit_('GeminiRateLimiter', fakeRange(2, 1), global.CONFIG), 'scritture rate limiter non devono invalidare risorse');
assert(_isResourceInvalidationEdit_('Istruzioni', fakeRange(10, 1), global.CONFIG), 'modifiche KB devono invalidare risorse');
console.log('✅ Test invalidazione cache Controllo passati');

function createFakeSheet() {
  const ranges = {
    'B2': { getValue: () => 'ACCESO' },
    'F2': {
      getDisplayValue: () => 'Solo straniere',
      getValue: () => 'Solo straniere'
    },
    'B5:E7': {
      getValues: () => [
        [new Date('2026-08-01'), '', new Date('2026-08-15'), 'ok'],
        [new Date('2026-12-24'), '', new Date('2026-12-31'), 'ok'],
        ['n/a', '', new Date('2026-01-01'), 'invalid']
      ]
    },
    'A10:D16': {
      getValues: () => [
        ['Lunedì', 8 / 24, '', 20 / 24],   // layout corrente
        ['', 'Martedì', 8, 14],            // layout legacy
        ['Mercoledì', '09:00', '', '17:00'],
        ['Giovedì', 8 / 24, '', 14 / 24],
        ['Venerdì', 8, '', 17],
        ['Sabato', '', '', ''],            // invalido -> ignorato
        ['Domenica', '', '', '']           // invalido -> ignorato
      ]
    },
    'A19': { getValue: () => 'review@parrocchia.it' }
  };

  return {
    getRange: (...args) => {
      if (args.length === 1) {
        const a1 = args[0];
        return ranges[a1];
      }

      // getRange(row, col, numRows, numCols) per filtri anti-spam
      const [row, col, numRows, numCols] = args;
      if (row === 13 && col === 5 && numRows === 3 && numCols === 2) {
        return {
          getValues: () => [
            ['Notify.com', 'Promozione'],
            ['', ''],
            ['MAILCHIMP.COM', 'Newsletter']
          ]
        };
      }

      throw new Error(`Range non gestito nel fake sheet: ${JSON.stringify(args)}`);
    },
    getLastRow: () => 15
  };
}

const fakeSpreadsheet = {
  getSheetByName: (name) => (name === 'Controllo' ? createFakeSheet() : null)
};

console.log('--- Test _loadAdvancedConfig ---');
const adv = _loadAdvancedConfig(fakeSpreadsheet);

assert(adv.systemEnabled === true, 'systemEnabled deve risultare acceso');
assert(adv.languageMode === 'foreign_only', 'languageMode deve risultare foreign_only');
assert(Array.isArray(adv.vacationPeriods) && adv.vacationPeriods.length === 2, 'devono coverci 2 periodi ferie validi');
assert(adv.suspensionRules[1][0][0] === 8 && adv.suspensionRules[1][0][1] === 20, 'Lunedì deve essere 8-20');
assert(adv.suspensionRules[2][0][0] === 8 && adv.suspensionRules[2][0][1] === 14, 'Martedì deve essere 8-14');

// Merge con static + sheet, dedup e lowercase
assert(adv.ignoreDomains.includes('static.com'), 'deve includere dominio statico da CONFIG');
assert(adv.ignoreDomains.includes('notify.com'), 'deve includere dominio da sheet');
assert(adv.ignoreDomains.includes('mailchimp.com'), 'deve includere mailchimp deduplicato/lowercase');

assert(adv.ignoreKeywords.includes('newsletter'), 'deve includere keyword newsletter');
assert(adv.ignoreKeywords.includes('promozione'), 'deve includere keyword da sheet in lowercase');
assert(adv.ignoreKeywords.includes('unsubscribe'), 'deve includere keyword statica unsubscribe');
assert(adv.validationReviewEmail === 'review@parrocchia.it', 'deve leggere validationReviewEmail da A19');

console.log('✅ Test advanced config parsing passati');

console.log('--- Test _loadAdvancedConfig usa etichetta giorno, non solo posizione riga ---');
function createReorderedSuspensionSheet() {
  const ranges = {
    'B2': { getValue: () => 'ACCESO' },
    'F2': { getDisplayValue: () => '', getValue: () => '' },
    'B5:E7': { getValues: () => [] },
    'A10:D16': {
      getValues: () => [
        ['Domenica', 9, '', 12],
        ['Lunedì', 8, '', 10],
        ['Martedì', '', '', ''],
        ['Mercoledì', '', '', ''],
        ['Giovedì', '', '', ''],
        ['Venerdì', '', '', ''],
        ['Sabato', '', '', '']
      ]
    }
  };

  return {
    getRange: (...args) => {
      if (args.length === 1) return ranges[args[0]];
      return { getValues: () => [] };
    },
    getLastRow: () => 16
  };
}

const reorderedAdv = _loadAdvancedConfig({
  getSheetByName: (name) => (name === 'Controllo' ? createReorderedSuspensionSheet() : null)
});
assert(reorderedAdv.suspensionRules[0][0][0] === 9 && reorderedAdv.suspensionRules[0][0][1] === 12, 'Domenica in prima riga deve restare day=0');
assert(reorderedAdv.suspensionRules[1][0][0] === 8 && reorderedAdv.suspensionRules[1][0][1] === 10, 'Lunedì in seconda riga deve restare day=1');
console.log('✅ Test mapping etichette sospensione passato');

console.log('--- Test _loadAdvancedConfig rifiuta riga sospensione parziale ---');
global.CONFIG.STRICT_SUSPENSION_CONFIG = false;
const partialInvalidSpreadsheet = {
  getSheetByName: (name) => {
    if (name !== 'Controllo') return null;
    return {
      getRange: (a1) => {
        if (a1 === 'B2') return { getValue: () => 'ACCESO' };
        if (a1 === 'F2') return { getDisplayValue: () => 'Tutte le lingue', getValue: () => 'Tutte le lingue' };
        if (a1 === 'B5:E7') return { getValues: () => [[], [], []] };
        if (a1 === 'A10:D16') {
          return {
            getValues: () => [
              ['Lunedì', 8, '', ''],
              ['Martedì', '', '', ''],
              ['Mercoledì', '', '', ''],
              ['Giovedì', '', '', ''],
              ['Venerdì', '', '', ''],
              ['Sabato', '', '', ''],
              ['Domenica', '', '', '']
            ]
          };
        }
        throw new Error(`Range non gestito nel fake partial sheet: ${a1}`);
      },
      getLastRow: () => 12
    };
  }
};
assertThrows(
  () => _loadAdvancedConfig(partialInvalidSpreadsheet),
  /Configurazione oraria non valida.*riga 10/,
  'una fascia oraria parziale deve bloccare il parsing invece di creare fallback/zombie'
);
console.log('✅ Test riga sospensione parziale passato');

console.log('--- Test _loadAdvancedConfig strict suspension no silent fallback ---');
global.CONFIG.STRICT_SUSPENSION_CONFIG = true;
const strictSpreadsheet = {
  getSheetByName: (name) => {
    if (name !== 'Controllo') return null;
    return {
      getRange: (a1) => {
        if (a1 === 'B2') return { getValue: () => 'ACCESO' };
        if (a1 === 'F2') return { getDisplayValue: () => 'Tutte le lingue', getValue: () => 'Tutte le lingue' };
        if (a1 === 'B5:E7') return { getValues: () => [[], [], []] };
        if (a1 === 'A10:D16') return { getValues: () => [[], [], [], [], [], [], []] };
        throw new Error(`Range non gestito nel fake strict sheet: ${a1}`);
      },
      getLastRow: () => 12
    };
  }
};
assertThrows(
  () => _loadAdvancedConfig(strictSpreadsheet),
  /senza fasce sospensione valide/,
  'con STRICT_SUSPENSION_CONFIG=true e nessuna fascia valida deve fallire senza fallback statico'
);
console.log('✅ Test strict suspension no silent fallback passato');
