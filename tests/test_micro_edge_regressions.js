const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({console: {log(){}, warn(){}, error(){}}, CONFIG: {}, GLOBAL_CACHE: {}});
for (const file of ['gas_classifier.js', 'gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx);
}
const classifier = new ctx.Classifier();
const processor = Object.create(ctx.EmailProcessor.prototype);

assert.equal(classifier._extractPriorCommunicationContact_('Ho parlato con Don Marco\nVorrei confermare'), 'Don Marco');
assert.equal(classifier._extractPriorCommunicationContact_('Referente: Marco Rossi\nGrazie mille'), 'Marco Rossi');
assert.equal(classifier._detectPriorOralCommunication('Ho parlato con Don Marco\nVorrei confermare').mentioned_contact, 'Don Marco');

for (const amount of ['€ 10.00', '€15.30', 'EUR 20.00', '$ 12.00', 'usd 9,45']) {
  assert.equal(processor._extractTimes(amount).length, 0, amount);
}
assert.equal(processor._extractTimes('Alle 10:00, € 15.30 e EUR 20.00').join(','), '10:00');

const resolved = processor._reconcilePhysicalPresenceConstraint_(null,
  'Je n’ai plus de difficulté à marcher et je ne dois plus m’occuper de ma mère', '', {});
assert.equal(resolved.has_constraint, false);

const candidate = {};
const own = {getFrom: () => 'user@example.org', getDate: () => new Date(2026, 0, 1)};
processor.gmailService = {_extractEmailAddress: value => value};
const anchor = processor._getOwnConversationAnchor_([candidate, own], candidate, ['user@example.org']);
assert.equal(anchor.exists, false);
console.log('Micro edge regressions: OK');
