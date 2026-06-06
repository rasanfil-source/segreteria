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

console.log('--- Test estimateTokenCount: riconosce payload Gemini inlineData ---');
{
  const originalConfig = global.CONFIG;
  global.CONFIG = {
    ATTACHMENT_TOKEN_ESTIMATE: {
      image: 258,
      pdf: 1032,
      defaultDoc: 1032
    }
  };

  try {
    assertEqual(
      estimateTokenCount('', [{ getContentType: () => 'image/png' }]),
      258,
      'Blob immagine GAS deve usare stima image'
    );
    assertEqual(
      estimateTokenCount('', [{ inlineData: { mimeType: 'image/jpeg', data: 'base64' } }]),
      258,
      'payload Gemini inlineData immagine deve usare stima image'
    );
    assertEqual(
      estimateTokenCount('', [{ fileData: { mimeType: 'application/pdf', fileUri: 'gs://test.pdf' } }]),
      1032,
      'payload Gemini fileData PDF deve usare stima pdf'
    );
    assertEqual(
      estimateTokenCount('', [{ inlineData: { data: 'base64' } }]),
      1032,
      'payload senza mimeType deve cadere sul defaultDoc'
    );
  } finally {
    global.CONFIG = originalConfig;
  }
}

console.log('--- Test _parseStrictHour (frazioni da Sheets) ---');
assertEqual(_parseStrictHour(0), 0, '0 deve essere ora 0');
assertEqual(_parseStrictHour(8 / 24), 8, '08:00 deve essere ora 8');
assertEqual(_parseStrictHour(23 / 24), 23, '23:00 deve essere ora 23');
assertEqual(_parseStrictHour(23.5 / 24), 23.5, '23:30 deve conservare i minuti');
assertEqual(_parseStrictHour(23.99 / 24), 23 + (59 / 60), '23:xx deve restare sotto 24 conservando i minuti');
assertEqual(_parseStrictHour(1), 1, 'intero 1 deve restare ora 1');
assertEqual(_parseStrictHour(24), null, '24 intero deve essere invalido');
assertEqual(_parseStrictHour('00:00'), 0, '00:00 deve essere mezzanotte');
assertEqual(_parseStrictHour('8'), 8, 'stringa ora intera deve restare valida');
assertEqual(_parseStrictHour('8.0'), 8, 'stringa ora decimale .0 deve restare valida');
assertEqual(_parseStrictHour('08:30'), 8.5, '08:30 deve conservare i minuti');
assertEqual(_parseStrictHour('09:30'), 9.5, 'stringa HH:MM deve conservare i minuti');
assertEqual(_parseStrictHour('23:59'), 23 + (59 / 60), 'stringa 23:59 valida');
assertEqual(_parseStrictHour(`8\u202F30`), 8.5, 'spazio stretto non separabile tra ora e minuti deve essere interpretato');
assertEqual(_parseStrictHour(`8\u00A0:\u00A030`), 8.5, 'NBSP intorno ai due punti deve essere normalizzato');
assertEqual(_parseStrictHour('25:00'), null, 'stringa HH:MM non valida');
const testDate = new Date(1899, 11, 30, 14, 0, 0); // 30 Dec 1899, 14:00 local
assertEqual(_parseStrictHour(testDate), 14, 'Date orario nativo Sheets valida');
const testDateWithMinutes = new Date(1899, 11, 30, 14, 30, 0); // 30 Dec 1899, 14:30 local
assertEqual(_parseStrictHour(testDateWithMinutes), 14.5, 'Date orario nativo Sheets deve conservare i minuti');
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

console.log('--- Test isInSuspensionTime rispetta minuti nelle fasce ---');
{
  const originalLoaded = global.GLOBAL_CACHE.loaded;
  const originalSuspensionRules = global.GLOBAL_CACHE.suspensionRules;
  const originalVacationPeriods = global.GLOBAL_CACHE.vacationPeriods;

  global.GLOBAL_CACHE.loaded = true;
  global.GLOBAL_CACHE.vacationPeriods = [];
  global.GLOBAL_CACHE.suspensionRules = {
    1: [[12.75, 15]]
  };

  assertEqual(isInSuspensionTime(new Date(2026, 4, 4, 12, 44, 0)), false, '12:44 deve restare fuori dalla sospensione 12:45-15:00');
  assertEqual(isInSuspensionTime(new Date(2026, 4, 4, 12, 45, 0)), true, '12:45 deve entrare nella sospensione');
  assertEqual(isInSuspensionTime(new Date(2026, 4, 4, 14, 59, 0)), true, '14:59 deve essere ancora sospeso');
  assertEqual(isInSuspensionTime(new Date(2026, 4, 4, 15, 0, 0)), false, '15:00 deve uscire dalla sospensione');

  global.GLOBAL_CACHE.loaded = originalLoaded;
  global.GLOBAL_CACHE.suspensionRules = originalSuspensionRules;
  global.GLOBAL_CACHE.vacationPeriods = originalVacationPeriods;
}

console.log('--- Test isInSuspensionTime normalizza componenti orarie numeriche ---');
{
  const originalGetBusinessDateParts = getBusinessDateParts;
  const originalLoaded = global.GLOBAL_CACHE.loaded;
  const originalSuspensionRules = global.GLOBAL_CACHE.suspensionRules;
  const originalVacationPeriods = global.GLOBAL_CACHE.vacationPeriods;

  try {
    global.GLOBAL_CACHE.loaded = true;
    global.GLOBAL_CACHE.vacationPeriods = [];
    global.GLOBAL_CACHE.suspensionRules = {
      1: [[12.75, 13]]
    };

    getBusinessDateParts = () => ({
      year: 2026,
      monthIndex: 4,
      day: 4,
      date: 4,
      hour: '12',
      minute: '45',
      isoDay: 1
    });
    assertEqual(isInSuspensionTime(new Date(2026, 4, 4, 12, 45, 0)), true, 'componenti orarie stringa 12:45 devono entrare nella sospensione');

    getBusinessDateParts = () => ({
      year: 2026,
      monthIndex: 4,
      day: 4,
      date: 4,
      hour: '12',
      minute: '44',
      isoDay: 1
    });
    assertEqual(isInSuspensionTime(new Date(2026, 4, 4, 12, 44, 0)), false, 'componenti orarie stringa 12:44 devono restare fuori dalla sospensione');
  } finally {
    getBusinessDateParts = originalGetBusinessDateParts;
    global.GLOBAL_CACHE.loaded = originalLoaded;
    global.GLOBAL_CACHE.suspensionRules = originalSuspensionRules;
    global.GLOBAL_CACHE.vacationPeriods = originalVacationPeriods;
  }
}

console.log('--- Test isInSuspensionTime valida payload suspensionRules della cache caricata ---');
{
  const originalLoaded = global.GLOBAL_CACHE.loaded;
  const originalSuspensionRules = global.GLOBAL_CACHE.suspensionRules;
  const originalVacationPeriods = global.GLOBAL_CACHE.vacationPeriods;

  try {
    global.GLOBAL_CACHE.loaded = true;
    global.GLOBAL_CACHE.vacationPeriods = [];
    global.GLOBAL_CACHE.suspensionRules = null;
    assertEqual(
      isInSuspensionTime(new Date(2026, 4, 4, 9, 0, 0)),
      true,
      'null deve indicare foglio Controllo assente e usare SUSPENSION_HOURS'
    );

    global.GLOBAL_CACHE.suspensionRules = undefined;
    let thrown = null;
    try {
      isInSuspensionTime(new Date(2026, 4, 4, 9, 0, 0));
    } catch (e) {
      thrown = e;
    }
    assertEqual(
      Boolean(thrown && String(thrown.message || thrown).includes('suspensionRules non valido')),
      true,
      'cache caricata con suspensionRules indefinito deve fallire invece di usare fallback silenzioso'
    );
  } finally {
    global.GLOBAL_CACHE.loaded = originalLoaded;
    global.GLOBAL_CACHE.suspensionRules = originalSuspensionRules;
    global.GLOBAL_CACHE.vacationPeriods = originalVacationPeriods;
  }
}

console.log('--- Test _parseDateValue: rifiuta fallback Date.parse ambiguo ---');
{
  assertEqual(_parseDateValue('2026/05/15'), null, 'formato non esplicitamente supportato deve essere rifiutato');
  assertEqual(_parseDateValue('May 15 2026'), null, 'Date.parse testuale engine-dependent deve essere rifiutato');
  assertEqual(_parseDateValue('2026-02-30T10:00:00Z'), null, 'ISO datetime con data impossibile deve essere rifiutato');
  assertEqual(_parseDateValue('2026-06-06T10:15:00Z') instanceof Date, true, 'ISO datetime esplicito con timezone deve restare supportato');
  const parsedItalian = _parseDateValue('15/05/2026');
  assertEqual(parsedItalian && parsedItalian.getFullYear(), 2026, 'formato italiano deve restare supportato');
  assertEqual(parsedItalian && parsedItalian.getMonth(), 4, 'formato italiano deve leggere correttamente il mese');
  assertEqual(parsedItalian && parsedItalian.getDate(), 15, 'formato italiano deve leggere correttamente il giorno');
}

console.log('--- Test parseDateSafe: blank string usa fallback senza perdere 0 esplicito ---');
{
  const fallback = new Date(2026, 0, 1, 12, 0, 0);
  assertEqual(parseDateSafe('   ', fallback), fallback, 'stringa vuota o whitespace deve usare fallback');
  assertEqual(parseDateSafe(0, fallback).getTime(), 0, 'input numerico 0 deve restare una data esplicita valida');
}

console.log('--- Test business date parts centralizzati su Europe/Rome ---');
{
  const originalUtilities = global.Utilities;
  global.Utilities = {
    formatDate: (_date, tz, pattern) => {
      assertEqual(tz, 'Europe/Rome', 'getBusinessDateParts deve usare il fuso business');
      const values = {
        yyyy: '2026',
        M: '3',
        d: '29',
        H: '0',
        m: '30',
        u: '7'
      };
      return values[pattern] || '';
    }
  };

  const parts = getBusinessDateParts(new Date('2026-03-28T23:30:00Z'));
  assertDeepEqual(
    parts,
    { year: 2026, monthIndex: 2, day: 29, date: 29, hour: 0, minute: 30, isoDay: 0 },
    'i componenti business devono provenire da Utilities.formatDate in Europe/Rome'
  );

  global.Utilities = originalUtilities;
}

console.log('--- Test guard Date: input non-Date non validi sono respinti ---');
{
  assertEqual(getBusinessDateParts('non una data'), null, 'getBusinessDateParts deve respingere stringhe non convertibili in Date');
  assertEqual(getBusinessDateParts(null), null, 'getBusinessDateParts deve respingere input null senza convertirlo in epoch 1970');
  assertEqual(getBusinessDateParts(undefined), null, 'getBusinessDateParts deve respingere input undefined senza convertirlo in oggi');
  assertEqual(getBusinessDateParts(''), null, 'getBusinessDateParts deve respingere stringhe vuote senza convertirle in epoch 1970');
  assertEqual(getBusinessDateParts('May 15 2026'), null, 'getBusinessDateParts deve respingere stringhe testuali parseabili dal runtime');
  assertEqual(getBusinessDateParts('2026/05/15'), null, 'getBusinessDateParts deve respingere formati non supportati esplicitamente');
  assertEqual(getBusinessDateParts('2026-06-06T10:00:00Z') !== null, true, 'getBusinessDateParts deve accettare stringhe data ISO valide');
  assertEqual(_isSameCalendarDay('2026-05-04', new Date(2026, 4, 4)), false, '_isSameCalendarDay deve respingere input sinistro non-Date');
  assertEqual(_isSameCalendarDay(new Date(2026, 4, 4), '2026-05-04'), false, '_isSameCalendarDay deve respingere input destro non-Date');
  assertEqual(_isSameCalendarDay(new Date('invalid'), new Date(2026, 4, 4)), false, '_isSameCalendarDay deve respingere Date invalide');
}

console.log('--- Test ferie con date-only e confine UTC/Roma ---');
{
  const originalUtilities = global.Utilities;
  const originalVacationPeriods = global.GLOBAL_CACHE.vacationPeriods;
  global.GLOBAL_CACHE.vacationPeriods = [
    { start: '2026-07-01', end: '2026-07-01' }
  ];
  global.Utilities = {
    formatDate: (date, _tz, pattern) => {
      const time = date.getTime();
      const boundary = new Date('2026-06-30T22:30:00.000Z').getTime();
      const values = time === boundary
        ? { yyyy: '2026', M: '7', d: '1', H: '0', m: '30', u: '3' }
        : { yyyy: '2026', M: '7', d: '1', H: '12', m: '0', u: '3' };
      return values[pattern] || '';
    }
  };

  assertEqual(
    isInVacationPeriod(new Date('2026-06-30T22:30:00.000Z'), 'Europe/Rome'),
    true,
    'una data UTC che in Europe/Rome è 01/07 deve ricadere nelle ferie date-only 2026-07-01'
  );

  global.Utilities = originalUtilities;
  global.GLOBAL_CACHE.vacationPeriods = originalVacationPeriods;
}

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

console.log('--- Test hasStaleUnreadThreads fail-open se lookup label non disponibile ---');
{
  const originalConfig = global.CONFIG;
  const originalGmailApp = global.GmailApp;
  const originalGmailService = global.GmailService;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  const oldDate = new Date(Date.now() - (13 * 60 * 60 * 1000));

  global.CONFIG = {
    LABEL_NAME: 'IA',
    ERROR_LABEL_NAME: 'Errore',
    VALIDATION_ERROR_LABEL: 'Verifica',
    SKIP_LABEL_NAME: '·'
  };
  global.GLOBAL_CACHE.languageMode = 'all';

  global.GmailService = class GmailService {
    _getOptionalLabelIdByName() {
      throw new Error('label lookup unavailable');
    }
  };

  const staleMessage = {
    getId: () => 'm-stale-label-lookup-fail',
    getDate: () => oldDate,
    isUnread: () => true
  };
  global.GmailApp = {
    search: () => [{ getMessages: () => [staleMessage] }]
  };

  assertEqual(
    hasStaleUnreadThreads(12, 25, 7),
    true,
    'il detector stale deve restare fail-open quando le label terminali non sono risolvibili'
  );

  global.CONFIG = originalConfig;
  global.GmailApp = originalGmailApp;
  global.GmailService = originalGmailService;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('✅ Test gas_main time parsing passati');
