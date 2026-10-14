const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const silent = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const ctx = vm.createContext({ console: silent, CONFIG: {}, GLOBAL_CACHE: {}, Date, Set });
for (const file of ['gas_error_types.js', 'gas_classifier.js', 'gas_email_processor.js', 'gas_thread_lifecycle.js', 'gas_thread_policy.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
const classifier = new ctx.Classifier();
const processor = Object.assign(Object.create(ctx.EmailProcessor.prototype), {
  _getPersonalIgnoreSenders_: () => []
});

// Le richieste personali restano lavorabili; le newsletter mantengono il filtro.
ctx.CONFIG.IGNORE_KEYWORDS = ['nuovo arrivo', 'promo', 'offerta (speciale)'];
const personal = { senderEmail: 'genitore@example.org', headers: {},
  subject: 'Nuovo arrivo in famiglia - richiesta Battesimo', body: 'Vorrei informazioni.' };
assert.equal(processor._shouldIgnoreEmail(personal), false);
for (const headers of [{ Precedence: 'bulk' }, { 'List-Unsubscribe': '<mailto:unsubscribe@example.org>' }]) {
  assert.equal(processor._shouldIgnoreEmail({ ...personal, headers }), true);
  assert.equal(processor._shouldIgnoreEmail({ ...personal, headers, subject: 'Informazioni', body: 'Nuovo arrivo!' }), true);
  for (const subject of ['promozione', 'antipromo', 'promozione', 'épromo', 'promoé', 'offerta speciale']) {
    assert.equal(processor._shouldIgnoreEmail({ ...personal, headers, subject }), false, subject);
  }
  for (const subject of ['Promo!', 'offerta (speciale)']) {
    assert.equal(processor._shouldIgnoreEmail({ ...personal, headers, subject }), true, subject);
  }
}

// I separatori grafici conservano il testo; le intestazioni mantengono lo storico escluso.
const request = 'Vorrei informazioni per il battesimo di mio figlio.';
for (const separator of ['___', '__________']) {
  assert.equal(classifier._extractMainContent('Buongiorno\n' + separator + '\n' + request), request);
  assert.equal(classifier.classifyEmail('Re: Informazioni', separator + '\n' + request, true).shouldReply, true);
  for (const header of ['Da: Segreteria', 'From: Office', 'Inviato: ieri']) {
    assert.equal(classifier._extractMainContent('Grazie\n' + separator + '\n\n' + header + '\nVecchia richiesta'), 'Grazie');
  }
}
assert(classifier._extractMainContent('> Testo citato\n' + request).includes(request));

// Il limite di corpo conserva la richiesta anche dopo un confine molto lontano.
let captured;
const originalExtract = classifier._extractMainContent;
classifier._extractMainContent = function(body, options) {
  captured = body;
  return originalExtract.call(this, body, options);
};
classifier.classifyEmail('Re: Informazioni', 'Grazie mille\n' + 'a'.repeat(11000), true);
assert.equal(captured.length, 10000);
classifier.classifyEmail('Informazioni', 'a'.repeat(9900) + ' ' + 'b'.repeat(200));
assert.equal(captured.length, 9900);
classifier._extractMainContent = originalExtract;

const longSubject = 'Re: Richiesta informazioni per il corso prematrimoniale di ottobre';
assert.equal(classifier.classifyEmail(longSubject, '', true).shouldReply, true);
assert.equal(classifier.classifyEmail(longSubject, 'Grazie', true).shouldReply, false);
assert.equal(classifier.classifyEmail('Re: Quando posso passare?', 'Grazie', true).shouldReply, false);
assert.equal(classifier.classifyEmail('Re: Saluti', '', true).shouldReply, false);
for (const hasAttachments of [true, null]) {
  for (const body of ['', 'Grazie', 'Cordiali saluti']) {
    const outcome = ctx.ThreadPolicy.classify({ classifier,
      _evaluatePreAiRules_: value => value,
      _applyPreAiRuleDecision_: value => value.classifierShouldReply === false
    }, { messageDetails: { subject: longSubject, body, hasAttachments }, buildRuleContext: value => value, result: {} });
    assert.equal(outcome.terminal, undefined);
    assert.equal(outcome.classification.shouldReply, true);
  }
}

// Le date anagrafiche non determinano gli orari; una vera data richiesta resta valida anche nel passato.
const anchor = new Date('2026-01-15T12:00:00Z');
for (const biography of [
  'nato a Roma (RM) il 15/07/2018', 'nata a Roma (RM) il giorno 15 luglio 2018',
  'data di nascita del bambino: 15/07/2020', 'nato il giorno 15 luglio 1990',
  'certificato di battesimo celebrato il 15/07/1985', 'battezzata il 15 luglio 1985',
  'matrimonio del 15/07/85', 'born on 15/07/2018'
]) {
  const schedule = processor._resolveScheduleContext(biography + '. Quando posso passare in segreteria?', '', anchor, 'it');
  assert.equal(schedule.targetDate, '2026-01-15', biography);
  assert.equal(schedule.season, 'invernale', biography);
  assert.equal(schedule.isExplicitTarget, false, biography);
  const visit = processor._resolveScheduleContext(biography + '. Posso passare il 20/01/2026?', '', anchor, 'it');
  assert.equal(visit.targetDate, '2026-01-20', biography);
}
for (const [text, expected] of [
  ['Quali erano gli orari il 15/07/1985?', '1985-07-15'],
  ['Battesimo celebrato il 15/07/2027: quali sono gli orari?', '2027-07-15'],
  ['Nato il 15/07/2018. Posso passare domani?', '2026-01-16']
]) assert.equal(processor._resolveScheduleContext(text, '', anchor, 'it').targetDate, expected, text);

const summary = processor._buildMemorySummary({
  responseText: 'Grazie per aver inviato il modulo, confermiamo la ricezione del documento. La Sig.ra Rossi può passare in segreteria.',
  providedTopics: ['documenti'], referenceDate: anchor
});
assert(summary.includes('confermiamo la ricezione'));
assert(summary.includes('La Sig.ra Rossi'));

// L'errore locale attraversa il gestore reale; anche una label fallita non ferma il thread sano.
for (const labelFails of [false, true]) {
  const calls = [], labels = [], checkpoints = [];
  const threads = ['bad', 'healthy'].map(id => ({ getId: () => id }));
  const batch = Object.assign(Object.create(ctx.EmailProcessor.prototype), {
    logger: silent, config: { maxEmailsPerRun: 10, maxExecutionTimeMs: 300000, minRemainingTimeMs: 30000 },
    gmailService: { getUnprocessedUnreadThreads: () => threads },
    _getLanguageProcessingMode_: () => 'all', _getSafetyValveReducedLimit_: () => null,
    _trackEmptyInboxStreak: () => 0, _getRemainingTimeMs: () => 60000, _isNearDeadline: () => false,
    _hasUnreadMessagesToProcess: () => true, _clearBatchCheckpoint_: () => {},
    _storeBatchCheckpointAndScheduleContinuation_: (...args) => checkpoints.push(args),
    processThread(thread) {
      calls.push(thread.getId());
      if (thread.getId() === 'healthy') return { status: 'replied' };
      return ctx.ThreadLifecycle.handleError({ _classifyError: this._classifyError.bind(this) }, {
        threadLogger: silent, error: new Error('INVALID_ARGUMENT: documento non valido'),
        delivery: { confirmed: false }, result: {}, startTime: Date.now(),
        messageState: { markFailureForCurrentBurst() { labels.push('bad'); if (labelFails) throw new Error('label unavailable'); } }
      });
    }
  });
  const result = batch.processUnreadEmails('kb', '', true);
  assert.deepEqual(calls, ['bad', 'healthy']);
  assert.deepEqual(labels, ['bad']);
  assert.equal(result.replied, 1);
  assert.equal(result.errors, 1);
  assert.equal(checkpoints.length, 0);
  for (const error of ['CONFIG_ERROR: proprietà assente', 'SYSTEM_ERROR: servizio', 'Forbidden 403', 'Network error']) {
    calls.length = 0;
    batch.processThread = thread => {
      calls.push(thread.getId());
      return ctx.ThreadLifecycle.handleError({ _classifyError: batch._classifyError.bind(batch) }, {
        threadLogger: silent, error: new Error(error), delivery: { confirmed: false }, result: {}, startTime: Date.now(),
        messageState: { markFailureForCurrentBurst() { assert.fail('Un guasto globale deve restare riprovabile'); } }
      });
    };
    batch.processUnreadEmails('kb', '', true);
    assert.deepEqual(calls, ['bad'], error);
    assert.equal(checkpoints.at(-1)[0][0].getId(), 'bad');
  }
}

// Ogni progetto usa soltanto i propri alias configurati o quelli scoperti tramite Gmail.
for (const file of ['gas_config.js', 'gas_config.example.js']) {
  const configContext = vm.createContext({ console: silent });
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), configContext);
  assert.equal(configContext.CONFIG.KNOWN_ALIASES.length, 0);
  configContext.PropertiesService = { getScriptProperties: () => ({ getProperties: () => ({ KNOWN_ALIASES: '["segreteria@example.org"]' }) }) };
  configContext._clearScriptPropertyCache();
  assert.deepEqual(Array.from(configContext.CONFIG.KNOWN_ALIASES), ['segreteria@example.org']);
}
console.log('Audit confermato: filtri, citazioni, date, troncamento, memoria, coda e alias verificati');
