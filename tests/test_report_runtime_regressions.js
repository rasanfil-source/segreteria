const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
for (const file of ['gas_config.js', 'gas_config.example.js']) {
  if (!fs.existsSync(path.join(__dirname, '..', file))) continue;
  let reads = 0;
  let now = 1000;
  let values = {};
  const ctx = vm.createContext({ console, Date: { now: () => now }, PropertiesService: {
    getScriptProperties: () => ({ getProperties: () => { reads++; return {...values}; } })
  }});
  vm.runInContext(read(file), ctx);
  ctx._clearScriptPropertyCache();
  reads = 0;
  for (let i = 0; i < 20; i++) {
    assert.equal(ctx._getScriptProperty('MISSING_A'), null);
    assert.equal(ctx._getScriptProperty('MISSING_B'), null);
  }
  assert.equal(reads, 1, file);
  values.MISSING_A = 'new';
  now += 60001;
  assert.equal(ctx._getScriptProperty('MISSING_A'), 'new');
  assert.equal(reads, 2);
  values.MISSING_B = 'forced';
  assert.equal(ctx._getScriptProperty('MISSING_B', true), 'forced');
  values.MISSING_B = 'cleared';
  ctx._clearScriptPropertyCache('MISSING_B');
  assert.equal(ctx._getScriptProperty('MISSING_B'), 'cleared');
}
const ctx = vm.createContext({ console, Date, CONFIG: {} });
for (const file of ['gas_classifier.js', 'gas_email_processor.js']) vm.runInContext(read(file), ctx);
const classifier = new ctx.Classifier();
for (const header of ['Il giorno 1 ottobre Mario ha scritto:', 'Da: Mario <mario@example.org>\nOggetto: Orari']) {
  assert.match(classifier._extractMainContent(`${header}\n\n> vecchia richiesta\n\nVorrei sapere quando aprite?`), /Vorrei sapere/);
  assert.equal(classifier._extractMainContent(`${header}\n\nvecchia richiesta\n> citazione\nTesto storico`), '');
}
assert.equal(classifier._extractMainContent('Buongiorno\n--\nMario Rossi', {preserveGreetings: true}), 'Buongiorno');
assert.equal(classifier.classifyEmail('', 'Buongiorno\n--\nMario Rossi').shouldReply, false);
const processor = Object.create(ctx.EmailProcessor.prototype);
for (const year of [2026, 2099, 2100]) {
  for (const text of ['29 febbraio', '29/02']) {
    const parsed = processor._extractExplicitDateFromText_(text, year);
    assert.ok(parsed);
    assert.equal(parsed.date.getMonth(), 1);
    assert.equal(parsed.date.getDate(), 29);
    const future = processor._normalizeExplicitDateForTemporalIntent_(parsed, `Vorrei prenotare per il prossimo ${text}`, new Date(year, 9, 2));
    assert.equal(future.date.getFullYear(), year === 2026 ? 2028 : 2104);
    const past = processor._normalizeExplicitDateForTemporalIntent_(parsed, `Lo scorso ${text}`, new Date(year, 9, 2));
    assert.equal(past.date.getFullYear(), year === 2026 ? 2024 : 2096);
  }
}
assert.equal(processor._extractExplicitDateFromText_('29 febbraio 2026', 2026), null);
assert.equal(processor._extractExplicitDateFromText_('29/02/2026', 2026), null);
assert.equal(processor._extractExplicitDateFromText_('31 aprile', 2026), null);
for (const reason of ['greeting_only', '']) {
  const context = {phase: 'post_extract_pre_ai', classifierShouldReply: false, classifierReason: reason};
  const decision = processor._evaluateEmailPolicyRules_(context);
  const result = {};
  processor._applyPreAiRuleDecision_(decision, context, result);
  assert.equal(result.status, 'filtered');
  assert.equal(result.reason, reason || 'classifier_filtered');
}
processor._getProperties_ = () => null;
assert.equal(processor._isValidationReviewAlertThrottled_('test'), false);
for (const next of ['**Next**', '### Next']) {
  const prompt = `**Empty**\n${next}\n${'keep this '.repeat(30)}`;
  assert.equal(processor._shrinkRetryPromptTextSection_(prompt, '**Empty**', 10), prompt);
}
console.log('Report runtime regressions passed');
