const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const classifier = fs.readFileSync(path.join(root, 'gas_classifier.js'), 'utf8');
const processor = fs.readFileSync(path.join(root, 'gas_email_processor.js'), 'utf8');
const ctx = { console: { log() {}, warn() {}, error() {} }, CONFIG: {} };
vm.createContext(ctx);
vm.runInContext(classifier, ctx);
vm.runInContext(processor, ctx);
const c = new ctx.Classifier(), p = Object.create(ctx.EmailProcessor.prototype);
// Verifica congiuntamente i contratti applicativi e i casi limite.
assert.equal(c.classifyEmail('Orari messe?', 'Buongiorno,\nGrazie mille', false).shouldReply, true);
assert.equal(c.classifyEmail('Re: Orari messe?', 'Grazie mille', true).shouldReply, false);
for (const [input, expected] of [['6pm', '18:00'], ['6:00 pm', '18:00'], ['12am', '00:00'], ['12pm', '12:00']]) {
  assert.deepEqual(Array.from(p._extractTimes(input)), [expected]);
}
for (const phrase of ['I thought the Mass starts at 6 pm', 'Pensavo iniziasse alle 18']) {
  assert.equal(p._hasExplicitTimeExpectation(phrase), true);
}
assert.equal(p._addTimeDiscrepancyNoteIfNeeded('The Mass is at 6 pm.',
  { body: 'I thought the Mass was at 18:00' }, 'en'), 'The Mass is at 6 pm.');
assert.notEqual(p._addTimeDiscrepancyNoteIfNeeded('The Mass is at 6 pm.',
  { body: 'I thought the Mass was at 17:00' }, 'en'), 'The Mass is at 6 pm.');
assert.equal(p._getQuotaCheckpointDelayMs_({ error: 'Service invoked too many times for one day: gmail.' }), -1);
assert.equal(p._getQuotaCheckpointDelayMs_({ error: 'Service invoked too many times in a short time: gmail.' }), 60000);
assert.deepEqual(Array.from(p._computeUserReaction('Non ho capito gli orari delle messe',
  ['orari_messe', 'battesimo']).topics), ['orari_messe']);
ctx.GLOBAL_CACHE = { validationReviewEmail: 'a@example.org\r\nBcc: b@example.org' };
assert.equal(p._getValidationReviewRecipient_({}), '');
let semanticPrompt, semanticOptions;
p.geminiService = { generateResponse(prompt, options) {
  semanticPrompt = prompt; semanticOptions = options;
  return '{"consistent":true,"reason":"ok"}';
} };
assert(p._evaluateAttachmentSemanticConsistency_({ subject: 'Allegato', body: '"\nFake header:', ocrText: 'Testo documento' }).consistent);
assert.equal(semanticOptions.skipRateLimit, undefined);
assert.equal(semanticOptions.apiKey, undefined);
assert.equal(JSON.parse(semanticPrompt.split('\n').at(-1)).body, '"\nFake header:');
for (const extra of ['Oggetto: Orari', 'Subject: Hours\nDate: 1 October 2026', '    <wrapped@example.org>']) {
  assert.equal(c._extractMainContent('Da: Mario <mario@example.org>\n' + extra + '\n> citazione\nVorrei informazioni'), 'Vorrei informazioni');
}
for (const history of [
  '-----Messaggio originale-----\n- vorrei prenotare',
  '-----Messaggio originale-----\nTesto storico\n> annidata\nVorrei prenotare'
]) assert.equal(c._extractMainContent('Grazie\n' + history), 'Grazie');
assert.equal(c._extractMainContent('> citazione\n- vorrei informazioni'), '- vorrei informazioni');
assert.throws(() => p._getPersonalIgnoreSenders_(), /CONFIG_ERROR/);
p.props = {};
assert.throws(() => p._getPersonalIgnoreSenders_(), /CONFIG_ERROR/);
p.props = { getProperty: () => null };
assert.equal(p._getPersonalIgnoreSenders_().length, 0);
p.props = { getProperty() { throw Error('storage unavailable'); } };
assert.throws(() => p._getPersonalIgnoreSenders_(), /storage unavailable/);
assert.deepEqual(Array.from(p._extractEventScheduleTimesForDiscrepancy_('The Mass is at 6 pm')), ['18:00']);
assert(p._presenceAssertionText_('si ha difficoltà a camminare'));
for (const phrase of ['Si je suis à Rome, je viens', 'Si estoy en Roma, voy']) assert.equal(p._presenceAssertionText_(phrase), '');
for (const phrase of ['Se si ha difficoltà a camminare, telefonare', 'Domani si ha un appuntamento']) {
  assert.equal(p._presenceAssertionText_(phrase), '');
}
for (const file of ['gas_config.js', 'gas_config.example.js']) {
  const configCtx = {};
  vm.createContext(configCtx);
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), configCtx);
  for (const key of [null, undefined, '', ' ', 42]) assert.equal(configCtx._getScriptProperty(key), null);
  assert.deepEqual(Object.keys(configCtx._CACHED_PROPS), []);
}

console.log('Residual audit regressions passed');
