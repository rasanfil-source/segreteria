const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`❌ ${message}. Atteso: ${expected}, ottenuto: ${actual}`);
    process.exit(1);
  }
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    console.error(`❌ ${message}. Atteso: ${b}, ottenuto: ${a}`);
    process.exit(1);
  }
}

// Mocks minimi necessari al parsing del file
global.console = console;

const gasMainPath = path.join(__dirname, '..', 'gas_main.js');
const code = fs.readFileSync(gasMainPath, 'utf8');
vm.runInThisContext(code, { filename: gasMainPath });

console.log('--- Test _parseStrictHour (frazioni da Sheets) ---');
assertEqual(_parseStrictHour(0), 0, '0 deve essere ora 0');
assertEqual(_parseStrictHour(8 / 24), 8, '08:00 deve essere ora 8');
assertEqual(_parseStrictHour(23 / 24), 23, '23:00 deve essere ora 23');
assertEqual(_parseStrictHour(23.5 / 24), 23, '23:30 non deve mai diventare 24');
assertEqual(_parseStrictHour(23.99 / 24), 23, '23:xx deve restare ora 23');
assertEqual(_parseStrictHour(1), 1, 'intero 1 deve restare ora 1');
assertEqual(_parseStrictHour(24), null, '24 intero deve essere invalido');
assertEqual(_parseStrictHour('09:30'), 9, 'stringa HH:MM valida');
assertEqual(_parseStrictHour('23:59'), 23, 'stringa 23:59 valida');
assertEqual(_parseStrictHour('25:00'), null, 'stringa HH:MM non valida');
const testDate = new Date(1899, 11, 30, 14, 0, 0); // 30 Dec 1899, 14:00 local
assertEqual(_parseStrictHour(testDate), 14, 'Date orario nativo Sheets valida');
assertEqual(_parseStrictHour(new Date('invalid')), null, 'Date invalida deve essere null');

console.log('--- Test _extractSuspensionHoursFromRow (layout corrente/legacy) ---');
assertDeepEqual(
  _extractSuspensionHoursFromRow(['Lunedì', 8 / 24, '', 14 / 24]),
  { startHour: 8, endHour: 14 },
  'layout corrente deve leggere A=giorno, B=inizio, D=fine'
);

assertDeepEqual(
  _extractSuspensionHoursFromRow(['', 'Martedì', 9, 13]),
  { startHour: 9, endHour: 13 },
  'layout legacy deve leggere B=giorno, C=inizio, D=fine'
);

assertDeepEqual(
  _extractSuspensionHoursFromRow(['x', 'y', 10 / 24, 18 / 24]),
  { startHour: 10, endHour: 18 },
  'fallback deve prendere le prime due ore valide'
);

console.log('--- Test hasStaleUnreadThreads (label terminali a livello messaggio) ---');
{
  const originalConfig = global.CONFIG;
  const originalGmailApp = global.GmailApp;
  const originalGmailService = global.GmailService;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  const oldDate = new Date(Date.now() - (13 * 60 * 60 * 1000));
  let capturedQuery = '';

  global.CONFIG = {
    LABEL_NAME: 'IA',
    ERROR_LABEL_NAME: 'Errore',
    VALIDATION_ERROR_LABEL: 'Verifica',
    SKIP_LABEL_NAME: '·'
  };
  global.GLOBAL_CACHE.languageMode = 'all';

  const makeMessage = (id, labelIds) => ({
    getId: () => id,
    getDate: () => oldDate,
    isUnread: () => true,
    labelIds
  });
  const makeThread = (messages) => ({
    getMessages: () => messages
  });
  const labelMap = {
    IA: 'label-ia',
    Errore: 'label-error',
    Verifica: 'label-review',
    '·': 'label-skip'
  };

  global.GmailService = class GmailService {
    _getOptionalLabelIdByName(labelName) {
      return labelMap[labelName] || null;
    }

    _getMessageMetadataWithResilience(messageId) {
      return this.messagesById[messageId] || { labelIds: [] };
    }
  };

  const terminalMessage = makeMessage('m-terminal', ['label-ia']);
  global.GmailService.prototype.messagesById = {
    'm-terminal': { labelIds: terminalMessage.labelIds }
  };
  global.GmailApp = {
    search: (query) => {
      capturedQuery = query;
      return [makeThread([terminalMessage])];
    }
  };

  assertEqual(
    hasStaleUnreadThreads(12, 25, 7),
    false,
    'messaggi già terminali non devono bypassare la sospensione'
  );
  assertEqual(
    capturedQuery.includes('-label:'),
    false,
    'query stale non deve filtrare label a livello thread'
  );

  const processableMessage = makeMessage('m-processable', []);
  global.GmailService.prototype.messagesById = {
    'm-processable': { labelIds: processableMessage.labelIds }
  };
  global.GmailApp = {
    search: () => [makeThread([processableMessage])]
  };

  assertEqual(
    hasStaleUnreadThreads(12, 25, 7),
    true,
    'messaggio stale senza label terminali deve bypassare la sospensione'
  );

  global.CONFIG = originalConfig;
  global.GmailApp = originalGmailApp;
  global.GmailService = originalGmailService;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('✅ Test gas_main time parsing passati');
