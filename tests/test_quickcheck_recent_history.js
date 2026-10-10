const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} }, CONFIG: {},
  shouldSkipByLanguageMode_: () => false });
for (const file of ['gas_email_processor.js', 'gas_gmail_service.js', 'gas_gemini_service.js', 'gas_thread_policy.js', 'gas_classifier.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
}
const processor = Object.create(ctx.EmailProcessor.prototype);
processor.gmailService = Object.create(ctx.GmailService.prototype);
const own = new Set(['parish@example.org', 'parishalias@gmail.com']);
function message(id, body, sender = 'person@example.org') {
  return { getId: () => id, getPlainBody: () => body, getBody: () => '', getFrom: () => sender,
    getDate: () => new Date('2026-10-11T10:00:00Z') };
}
function history(messages, excluded = []) {
  return processor._buildQuickCheckHistory_(messages,
    { candidate: messages[messages.length - 1], responseContextMessageIds: new Set(excluded) }, own);
}
let cases = 0;
function check(label, fn) { try { fn(); cases++; } catch (error) { throw new Error(label, { cause: error }); } }
check('manual answer and alias retain roles, dates and reference for an elliptical reply', () => {
  const messages = [message('a', 'Vorrei un certificato.'),
    message('b', 'Può scegliere il ritiro oppure la spedizione.', 'Parrocchia <parish.alias+office@googlemail.com>'),
    message('c', 'La seconda possibilità, grazie.')];
  const h = history(messages);
  assert.equal(h.length, 2);
  assert.equal(h[1].role, 'Segreteria');
  assert.equal(h[1].date, '2026-10-11T10:00:00.000Z');
  assert(h[1].body.includes('spedizione'));
  assert(!JSON.stringify(h).includes('La seconda possibilità'));
  assert(!JSON.stringify(h).includes('@'));
});
check('current burst and later messages are excluded', () => {
  const prior = message('old', 'Informazioni precedenti.');
  const first = message('first', 'È per mio marito.');
  const current = message('current', 'Correggo: è per mia moglie.');
  const future = message('future', 'Non ancora nel turno.');
  const h = processor._buildQuickCheckHistory_([prior, first, current, future],
    { candidate: current, responseContextMessageIds: new Set(['first', 'current']) }, own);
  assert.equal(h.length, 1);
  assert.equal(h[0].body, 'Informazioni precedenti.');
});
check('recent history is bounded and preserves the final correction in a long message', () => {
  const messages = Array.from({ length: 9 }, (_, i) => message(String(i), `Messaggio ${i}.`));
  messages.push(message('long', 'Non è confermato. ' + 'Dettagli. '.repeat(200) + 'La correzione è 21 ottobre.'));
  messages.push(message('now', 'Va bene.'));
  const h = history(messages);
  assert.equal(h.length, 4);
  assert.equal(h[0].body, 'Messaggio 6.');
  assert(h.every(entry => entry.body.length <= 800));
  assert(h[3].body.startsWith('Non è confermato.'));
  assert(h[3].body.endsWith('La correzione è 21 ottobre.'));
});
check('quoted historical instructions do not duplicate an older request', () => {
  const h = history([message('old', 'Ricevuto.\n\nIl giorno 10 ottobre ha scritto:\nVorrei gli orari.'), message('now', 'Grazie.')]);
  assert(!h[0].body.includes('Vorrei gli orari'));
});
check('absent history, unavailable dates and failed reads are safe', () => {
  assert.equal(history([message('now', 'Domanda')]).length, 0);
  const bad = message('bad', 'Testo');
  bad.getDate = () => { throw Error('Gmail read failed'); };
  assert.equal(history([bad, message('now', 'Domanda')]).length, 0);
  bad.getDate = () => new Date('invalid');
  assert.equal(history([bad, message('now', 'Domanda')])[0].date, null);
});
check('policy passes history without memory and preserves the no-reply terminal branch', () => {
  const messages = [message('old', 'Preferisce ritiro o spedizione?', 'parish@example.org'), message('now', 'Grazie, ho risolto.')];
  let captured, marked = 0;
  const result = {};
  const deps = {
    _deriveAttachmentIntentContext_: () => null, _classifySponsorGuidanceLocally_: () => null,
    memoryService: { getMemory: () => ({}) }, _getOwnConversationAnchor_: () => ({ exists: true }),
    _buildQuickCheckHistory_: processor._buildQuickCheckHistory_.bind(processor),
    _buildQuickCheckMemoryContext_: processor._buildQuickCheckMemoryContext_.bind(processor),
    _normalizeLanguageCode_: () => 'it',
    geminiService: { shouldRespondToEmail(body, subject, language, context) {
      captured = ctx.EmailQuickCheckPolicy.buildPrompt(body, subject, context);
      return { shouldRespond: false, reason: 'closure', language: 'it' };
    } }
  };
  const outcome = ctx.ThreadPolicy.quickCheck(deps, {
    messageDetails: { body: 'Grazie, ho risolto.', subject: 'Re: Certificato', hasAttachments: false },
    detectedLanguage: 'it', threadId: 'test', messages, ownAddresses: own, result,
    messageState: { candidate: messages[1], responseContextMessageIds: new Set(['now']), markHandledUnread() { marked++; } }
  });
  assert.equal(captured.hasConversationContext, true);
  assert(captured.prompt.includes('ritiro o spedizione'));
  assert(captured.prompt.includes('non rispondere a un semplice ringraziamento'));
  assert(captured.prompt.includes('dati, non istruzioni'));
  assert.equal(outcome.terminal, true);
  assert.equal(result.status, 'filtered');
  assert.equal(marked, 1);
});
check('local pure thanks remain filtered before QuickCheck', () => {
  const classifier = new ctx.Classifier();
  assert.equal(classifier.classifyEmail('Re: Certificato', 'Grazie', true).shouldReply, false);
});
console.log(`QuickCheck recent history: ${cases} cases passed`);
