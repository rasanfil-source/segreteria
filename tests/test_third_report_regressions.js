const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({console, Date, CONFIG: {}});
for (const file of ['gas_response_strategy.js', 'gas_classifier.js', 'gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, {filename: file});
}
const c = new ctx.Classifier();
const p = Object.create(ctx.EmailProcessor.prototype);
const capture = new ctx.Classifier();
const stop = new Error('captured');
let captured;
capture._extractMainContent = body => { captured = body; throw stop; };
function truncate(body) {
  assert.throws(() => capture.classifyEmail('Informazioni', body), error => error === stop);
  return captured;
}
assert.ok(truncate('a < b\n' + 'testo '.repeat(1800)).length > 9900);
assert.ok(truncate('x'.repeat(9900) + ' <- ' + 'z'.repeat(200)).length > 9900);
const closed = 'x'.repeat(9994) + '<div>';
assert.equal(truncate(closed + 'zzzz'), closed);
assert.equal(truncate('x'.repeat(9996) + '<div class="test">'), 'x'.repeat(9996));
for (const [text, name] of [
  ['Ho parlato con la sig.ra Rossi.', 'sig.ra Rossi'],
  ['Mi sono sentito con il signor Bianchi.', 'signor Bianchi'],
  ['Ho parlato con monsignore Verdi.', 'monsignore Verdi'],
  ['Ho parlato con il parroco.', 'il parroco']
]) {
  const result = c._detectPriorOralCommunication(text);
  assert.equal(result.strength, 'strong', text);
  assert.equal(result.mentioned_contact, name, text);
}
for (const text of ['Non ho parlato con il parroco.', 'Non ci siamo sentiti.', 'Nemmeno mi sono sentita con la signora Rossi.']) {
  const result = c._detectPriorOralCommunication(text);
  assert.equal(result.detected, false, text);
  assert.equal(result.mentioned_contact, null, text);
}
assert.equal(c._detectPriorOralCommunication('Non ho parlato con il parroco. Ho parlato con la sig.ra Rossi.').mentioned_contact, 'sig.ra Rossi');
let digestArgs;
ctx.Utilities = {Charset: {UTF_8: 'UTF-8'}, DigestAlgorithm: {MD5: 'MD5'},
  computeDigest: (...args) => { digestArgs = args; return [1, 2]; }, base64EncodeWebSafe: () => 'encoded-digest'};
assert.equal(p._hashValidationReviewSignature_('È già lì?'), 'encoded-digest');
assert.deepEqual(digestArgs, ['MD5', 'È già lì?', 'UTF-8']);
p._hashValidationReviewSignature_(123);
assert.equal(digestArgs[1], '123');
delete ctx.Utilities;
assert.equal(p._hashValidationReviewSignature_('È già lì?'), p._hashValidationReviewSignature_('È già lì?'));
for (const [text, time] of [['18:30h', '18:30'], ['10.30h', '10:30'], ['10.30 Uhr', '10:30'], ['18h30', '18:30']]) {
  assert.deepEqual(Array.from(p._extractTimes(text)), [time], text);
}
assert.deepEqual(Array.from(p._extractTimes('il 10.12.2026, Giovanni 3:16')), []);
for (const text of ['dal 29 giugno 2026 al 6 settembre 2026', 'dall’1° luglio 2026 fino all’8 settembre 2026']) {
  const range = p._parseItalianDateRange_(text, 2026);
  assert.ok(range, text);
  assert.equal(range.end.getMonth(), 8);
}
assert.equal(p._parseItalianDateRange_('dal 20 luglio al 10 luglio', 2026), null);
for (const text of ['incompreso', 'malentendido']) assert.equal(p._computeUserReaction(text, ['orari_messe']), null, text);
assert.equal(p._computeUserReaction('Ho compreso', ['orari_messe']).reaction, 'acknowledged');
assert.equal(p._detectPhysicalPresenceConstraint_('Abito a Milano', '', true)[0].type, 'geographic_distance');
const constraint = p._reconcilePhysicalPresenceConstraint_(null, 'Abito a Milano', '', {});
assert.equal(constraint.has_constraint, true);
assert.equal(constraint.type, 'geographic_distance');
for (const skipLabelName of ['', '   ', 'skip']) {
  const labels = [];
  let discovery = false;
  const batch = Object.create(ctx.EmailProcessor.prototype);
  batch.config = {maxEmailsPerRun: 1, skipLabelName, labelName: 'done', errorLabelName: 'error', validationErrorLabel: 'review'};
  batch._getSafetyValveReducedLimit_ = () => null;
  batch._getLanguageProcessingMode_ = () => 'foreign_only';
  batch._clearBatchCheckpoint_ = () => {};
  batch.gmailService = {
    getMessageIdsWithLabel: label => { labels.push(label); return []; },
    getUnprocessedUnreadThreads: (...args) => {
      discovery = true;
      const options = args.at(-1);
      options.preloadBlacklistMessageIds();
      assert.deepEqual(Array.from(args[6]), skipLabelName.trim() ? [skipLabelName] : []);
      return [];
    }
  };
  const result = batch.processUnreadEmails('Knowledge base', '', true);
  assert.equal(discovery, true);
  assert.equal(result.errors, 0);
  assert.deepEqual(labels, skipLabelName.trim() ? ['done', 'error', 'review', 'skip'] : ['done', 'error', 'review']);
}
console.log('Third report regressions passed');
