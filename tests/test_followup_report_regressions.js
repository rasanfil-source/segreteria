const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ctx = vm.createContext({console, Date, CONFIG: {}});
for (const file of ['gas_response_strategy.js', 'gas_classifier.js', 'gas_email_processor.js']) {
  vm.runInContext(read(file), ctx, {filename: file});
}
const p = Object.create(ctx.EmailProcessor.prototype);
const c = new ctx.Classifier();
const now = new Date();
const negative = {has_constraint: false, type: 'none', confidence: 0.95, visit_policy: 'unknown'};
const memory = (...types) => ({conversationState: {physicalPresenceState: {version: 1,
  constraints: types.map(type => ({type, status: 'active', source: 'current_message',
    policy: type === 'health' ? 'avoid_invitation' : 'conditional_only', updatedAt: now.toISOString()}))}}});
for (const body of ['Sono a Roma.', 'Ora posso venire.', 'Preferisco venire di persona.']) {
  const result = p._reconcilePhysicalPresenceConstraint_(negative, '', body, {contextualFlags: {remote_user: true}}, now);
  assert.equal(result.has_constraint, false, body);
  assert.equal(result.visit_policy, 'visit_ok');
}
for (const body of ['Ora posso venire.', 'Preferisco venire di persona.']) {
  assert.equal(p._reconcilePhysicalPresenceConstraint_(negative, '', body, memory('other'), now).has_constraint, false);
  assert.equal(p._reconcilePhysicalPresenceConstraint_(negative, '', body, memory('other', 'health'), now).type, 'health');
}
assert.equal(p._reconcilePhysicalPresenceConstraint_(negative, 'Sono a Roma in questi giorni', '', memory('geographic_distance'), now).has_constraint, false);
assert.equal(p._reconcilePhysicalPresenceConstraint_(negative, 'Non sono a Roma', '', memory('geographic_distance'), now).has_constraint, true);
assert.equal(p._resolvePhysicalPresenceConstraint_(null, '', 'Abito a Milano, ma oggi sono a Roma').visit_policy, 'visit_ok');
const newOther = {has_constraint: true, type: 'other', confidence: 0.99, visit_policy: 'avoid_invitation'};
assert.equal(p._reconcilePhysicalPresenceConstraint_(newOther, '', 'Ora posso venire.', memory('other'), now).has_constraint, true);

for (const title of ['### Periodo estivo', 'Orario estivo', 'Orari estivi', 'Messe estive']) {
  const range = p._extractSummerScheduleRange_(`Iscrizioni: dal 1 settembre al 15 ottobre\n${title}\nDal 1° luglio al 31 agosto`, 2026);
  assert.equal(range.start.getMonth(), 6, title);
  assert.equal(range.end.getMonth(), 7);
}
assert.equal(p._extractSummerScheduleRange_('Iscrizioni catechismo: dal 1 settembre al 15 ottobre', 2026), null);
for (const text of ["dall'1 luglio all'8 settembre", 'dall’1 luglio fino all’8 settembre', 'dal 1º luglio al 8 settembre']) {
  const range = p._parseItalianDateRange_(text, 2026);
  assert.equal(range.start.getDate(), 1);
  assert.equal(range.end.getDate(), 8);
}
assert.equal(p._parseItalianDateRange_('dal 32 luglio al 8 settembre', 2026), null);

const old = {getId: () => 'old', isUnread: () => false};
const recent = {getId: () => 'recent', isUnread: () => true};
const readMessage = {getId: () => 'read', isUnread: () => false};
p.gmailService = {_getMessageMetadataWithResilience: id => ({labelIds: id === 'old' ? ['UNREAD'] : []})};
const unread = p._getUnreadMessagesForProcessing_([old, readMessage, recent]);
assert.deepEqual(Array.from(unread), [old, recent]);
assert.equal(unread.at(-1), recent);
for (const fragment of ['<', '</', '<user_', '</user_email']) {
  assert.equal(p._stripDanglingRetryPromptTagFragment_('testo ' + fragment), 'testo');
}
assert.equal(p._stripDanglingRetryPromptTagFragment_('testo <user_email>'), 'testo <user_email>');
const constraint = {type: 'health', visit_policy: 'avoid_invitation'};
const correction = p._buildCorrectionPrompt('Originale', 'Venga in ufficio.', {
  errors: ['vincolo presenza fisica'], details: {physicalPresenceConstraint: {constraint, errors: ['invito incompatibile']}}
}, 'it', 'full', Object.freeze({temporal: null, papal: null}));
assert.match(correction, /type=health, visit_policy=avoid_invitation/);
assert.match(p._addTimeDiscrepancyNoteIfNeeded('The Mass is at 6 pm.', {body: 'I thought it was at 5 pm'}, 'en_US'), /Note:/);
assert.match(p._addTimeDiscrepancyNoteIfNeeded('A reunião tem lugar às 18.', {body: 'Pensava às 17'}, 'pt_BR'), /indicado por si/);
assert.deepEqual(Array.from(p._computeUserReaction('Grazie', ['orari_messe', '', null]).topics), ['orari_messe']);
p._getBusinessDateString = () => '2026-10-02';
const response = 'Informazioni operative: ' + 'x'.repeat(1900);
const bullet = `• [2026-10-02] ${response}`;
const previousPrefix = '• [2026-10-01] ';
const previousBullet = previousPrefix + 'y'.repeat(1999 - bullet.length - previousPrefix.length - 1);
assert.equal(`${previousBullet}\n${bullet}`.length, 1999);
const summary = p._buildMemorySummary({existingSummary: 'vecchio ricordo molto lungo\n' + previousBullet, responseText: response});
assert.ok(summary.startsWith('...' + previousBullet), 'a newline at the truncation boundary must preserve the full bullet');
for (const reset of [Date.now() + 3600000, new Date(Date.now() + 3600000), new Date(Date.now() + 3600000).toISOString()]) {
  p.geminiService = {rateLimiter: {_getNextResetTime: () => reset}};
  const delay = p._getQuotaCheckpointDelayMs_({reason: 'rpd_exhausted'});
  assert.ok(delay > 3500000 && delay <= 3660000);
}
for (const subject of ['Out of Office: Re: Richiesta appuntamento?', 'Re: Possiamo fissare un appuntamento?']) {
  assert.equal(c._isOutOfOfficeAutoReply(subject, 'Out of office. Mailbox monitored periodically.'), true);
}
assert.equal(c._isOutOfOfficeAutoReply('Re: Informazioni', 'Vorrei un appuntamento? La casella è consultata periodicamente.'), false);
assert.equal(c._matchesCategoryKeyword_('chiedo lo sbattezzo', 'uscire dalla chiesa', 'sbattezzo'), false);
assert.equal(c._matchesCategoryKeyword_('voglio uscire dalla chiesa cattolica', 'uscire dalla chiesa', 'sbattezzo'), true);
assert.equal(c._detectPriorOralCommunication('Contatto: Mario Rossi').mentioned_contact, null);
for (const file of ['gas_config.js', 'gas_config.example.js']) {
  if (!fs.existsSync(path.join(__dirname, '..', file))) continue;
  let raw;
  const config = vm.createContext({console, PropertiesService: {getScriptProperties: () => ({getProperty: () => raw})}});
  vm.runInContext(read(file), config);
  for (raw of ['   ', '[]', '["", " ", null]', ', ,', '; ;\n']) {
    config._clearScriptPropertyCache();
    const fallback = ['alias@example.org'];
    const result = config._getScriptPropertyStringArray('KNOWN_ALIASES', fallback);
    assert.deepEqual(Array.from(result), fallback);
    assert.notEqual(result, fallback);
  }
}
console.log('Follow-up report regressions passed');
