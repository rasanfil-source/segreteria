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
for (const newline of ['\n', '\r\n']) {
  for (const text of ['Referente:' + newline + 'don Marco', 'Contatto: don' + newline + 'Marco',
    'Referente' + newline + ': Marco Rossi', 'Riferimento: il' + newline + 'parroco']) {
    assert.equal(classifier._extractPriorCommunicationContact_(text), null, text);
  }
}
assert.equal(classifier._extractPriorCommunicationContact_('Referente:\tdon Marco'), 'don Marco');
assert.equal(classifier._extractPriorCommunicationContact_('Contatto: il parroco'), 'il parroco');

for (const endMonth of ['ottobre', 'novembre', 'dicembre']) {
  const range = 'dal 1 maggio al 30 ' + endMonth;
  assert.equal(processor._parseItalianDateRange_(range, 2026, {preferSummerMonths: true}), null);
  assert.ok(processor._parseItalianDateRange_(range, 2026), 'il parser generico conserva gli intervalli non estivi');
}
assert.ok(processor._parseItalianDateRange_('dal 1 maggio al 30 settembre', 2026, {preferSummerMonths: true}));
assert.equal(processor._parseItalianDateRange_('dal 1 agosto al 30 giugno', 2026, {preferSummerMonths: true}), null);

const activeCaregiving = processor._reconcilePhysicalPresenceConstraint_(null, '',
  'Non sono guarito e assisto mia madre', {});
assert.equal(activeCaregiving.has_constraint, true, 'la risoluzione negata non deve eliminare un impedimento indipendente');
assert.equal(processor._reconcilePhysicalPresenceConstraint_(null, '',
  'Non sono guarito, sono ancora ricoverato in ospedale', {}).has_constraint, true);
assert.equal(processor._reconcilePhysicalPresenceConstraint_(null, '',
  'Non sono ricoverato in ospedale', {}).has_constraint, false);
const memory = {conversationState: {physicalPresenceState: {constraints: [
  {type: 'health', status: 'active', policy: 'avoid_invitation'}
]}}};
assert.equal(processor._reconcilePhysicalPresenceConstraint_(null, '', 'Sono guarito', memory).has_constraint, false);
assert.equal(processor._reconcilePhysicalPresenceConstraint_(null, '', 'Non sono guarito', memory).has_constraint, true);

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
