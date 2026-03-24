const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
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

function createFakeSheet() {
  const ranges = {
    'B2': { getValue: () => 'ACCESO' },
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
    }
  };

  return {
    getRange: (...args) => {
      if (args.length === 1) {
        const a1 = args[0];
        return ranges[a1];
      }

      // getRange(row, col, numRows, numCols) per filtri anti-spam
      const [row, col, numRows, numCols] = args;
      if (row === 11 && col === 5 && numRows === 3 && numCols === 2) {
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
    getLastRow: () => 13
  };
}

const fakeSpreadsheet = {
  getSheetByName: (name) => (name === 'Controllo' ? createFakeSheet() : null)
};

console.log('--- Test _loadAdvancedConfig ---');
const adv = _loadAdvancedConfig(fakeSpreadsheet);

assert(adv.systemEnabled === true, 'systemEnabled deve risultare acceso');
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

console.log('✅ Test advanced config parsing passati');
