const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ console: { log(){}, warn(){}, error(){} },
  CONFIG: { SEMANTIC_VALIDATION: { enabled: false } },
  createLogger: () => ({ info(){}, warn(){}, debug(){}, error(){} }),
  Utilities: { formatDate: () => '2026-10-04' } });
for (const file of ['gas_response_strategy.js', 'gas_response_validator.js', 'gas_territory_validator.js',
  'gas_email_processor.js', 'gas_gmail_service.js', 'gas_classifier.js', 'gas_prompt_engine.js',
  'gas_thread_generation.js', 'gas_thread_policy.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
}
const validator = new ctx.ResponseValidator();
for (const text of ['in base alle linee guida diocesane', 'secondo le direttive del Vicariato',
  'secondo le istruzioni del modulo', 'secondo le istruzioni ricevute']) {
  assert.equal(validator._checkExposedReasoning(text).errors.length, 0, text);
}
for (const text of ['secondo le istruzioni di sistema', 'in base alle direttive interne',
  'responseMode: brief', '[AI_CORE_LITE]', 'consultando la knowledge base']) {
  assert.equal(validator._checkExposedReasoning(text).score, 0, text);
}
for (const kb of ['Orario 9.00-12.00', 'Orario 09:00-12:00', 'Orario 9.00 - 12.00']) {
  assert.equal(validator._checkHallucinations('Aperto dalle 9.00 alle 12.00', kb).errors.length, 0, kb);
}
assert.ok(validator._checkHallucinations('Aperto alle 10.00', 'Orario 9.00-12.00').errors.length);
assert.equal(validator._checkHallucinations('Il 09.10.2026', 'Il 09.10.2026').hallucinations.times, undefined);
for (const phone of ['+390612345678', '00390612345678', '+39 06 1234 5678', '0039 06 12345678', '06 12345678']) {
  for (const [response, kb] of [[phone, '0612345678'], ['0612345678', phone]]) {
    assert.equal(validator._checkHallucinations(response, kb).errors.length, 0, response + '/' + kb);
    assert.equal(validator._checkHallucinations(response, '', kb).errors.length, 0, 'original: ' + kb);
  }
}
assert.ok(validator._checkHallucinations('+390612345679', '0612345678').errors.length);
assert.equal(validator._checkHallucinations('+393906123456', '3906123456').errors.length, 0);
assert.ok(validator._checkHallucinations('3906123456', '06123456').errors.length);
const territory = new ctx.TerritoryValidator();
for (const ending of ['con mia moglie', 'a Roma', 'ho bisogno', 'il giorno', 'e mia moglie']) {
  const result = territory.analyzeEmailForAddress('via Flaminia 160 ' + ending, '');
  assert.equal(result.addresses[0].fullCivic, '160', ending);
  assert.equal(result.addresses[0].verification.needsReview, false, ending);
}
for (const [input, expected] of [['160A', '160A'], ['160/A', '160A'], ['160 B', '160B'],
  ['160 A', '160A'], ['160 bis', '160BIS']]) {
  assert.equal(territory.analyzeEmailForAddress('via Flaminia ' + input, '').addresses[0].fullCivic, expected);
}
const processor = Object.create(ctx.EmailProcessor.prototype);
for (const text of ['mio figlio fa parte del coro della parrocchia', 'appartenenza al gruppo',
  'quale parrocchia organizza il concerto?']) {
  assert.equal(processor._isTerritoryRequest('', text), false, text);
}
for (const text of ['A quale parrocchia appartengo?', 'Quale parrocchia è competente?',
  'via Flaminia fa parte della parrocchia?', 'Verifica del territorio parrocchiale']) {
  assert.equal(processor._isTerritoryRequest('', text), true, text);
}
assert.equal(processor._isTerritoryRequest('', '', { isTerritoryRequest: true }), true);
const plain = html => ctx.GmailService.prototype._htmlToPlainText(html);
assert.equal(plain('<style>' + 'x'.repeat(100000) + '</style><p>Richiesta importante</p>'), 'Richiesta importante');
assert.equal(plain('<p>Prima</p><script>' + 'x'.repeat(100000) + '</script><p>Dopo</p>'), 'Prima\n\n Dopo');
assert.equal(plain('x'.repeat(60000)).length, 50000);
assert.equal(plain('Prima<style>non chiuso'), 'Prima');
const state = { responseFocusHint: 'answer_only_residual_question', responseFocusHintConfidence: 0.9,
  responseFocusHintUpdatedAt: '2026-10-04T08:00:00Z' };
const engine = new ctx.PromptEngine();
const prompt = engine.buildPrompt({ emailSubject: 'Un chiarimento', emailContent: 'Quale documento manca?',
  knowledgeBase: 'La segreteria riceve documenti.', detectedLanguage: 'it',
  memoryContext: { conversationState: state }, salutationMode: 'none_or_continuity',
  runtimeContext: { temporal: { currentDate: '2026-10-04', processingTimestampIso: '2026-10-04T09:00:00Z' } } });
assert.ok(prompt.includes('CONTINUITÀ DEL THREAD'));
assert.equal(ctx.isResponseFocusApplicable_(state, '', '2026-10-20T09:00:00Z'), false);
assert.equal(ctx.isResponseFocusApplicable_(state, '', '2026-10-04T07:00:00Z'), false);
// Isola l'orchestrazione: anche una risposta già valida deve ricevere le correzioni sicure.
const cosmetic = new ctx.ResponseValidator();
cosmetic._runValidationChecks = () => ({ isValid: true, score: 1, errors: [], warnings: [], details: {} });
const fixed = cosmetic.validateResponse('Consulta [https://example.com](https://example.com).', 'it', '', '', '');
assert.ok(fixed.fixedResponse && !fixed.fixedResponse.includes(']('));
const deps = { _parseEmailResponse_: text => ({ text }), _isNoReplyToken_: () => false,
  _addTimeDiscrepancyNoteIfNeeded: text => text, _sanitizeUnrequestedSponsorGuidance_: text => text };
for (const salutation of ['Caro', 'Cara', 'Carissimo', 'Carissima']) {
  assert.equal(ctx.ThreadGeneration.prepareResponse(deps, { response: salutation + ' Mario,',
    messageDetails: {}, detectedLanguage: 'it', effectiveSalutationModeKey: 'full_warm' }).response, 'Gentile Mario,');
}
for (const [subject, expected] of [['Re-iscrizione catechismo', false], ['Re: catechismo', true], ['Re - catechismo', true]]) {
  let received;
  ctx.ThreadPolicy.classify({ classifier: { classifyEmail(s, b, isReply) { received = isReply; return {}; } },
    _evaluatePreAiRules_: () => ({}), _applyPreAiRuleDecision_: () => false },
  { messageDetails: { subject, body: 'Vorrei informazioni' }, buildRuleContext: x => x, result: {} });
  assert.equal(received, expected, subject);
}
console.log('Audit follow-up: focus, validator, phone, territory, HTML, greetings and reply prefixes passed');
