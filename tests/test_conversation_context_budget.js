const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} },
  CONFIG: { SEMANTIC_VALIDATION: { enabled: false } }, UrlFetchApp: {} });
for (const file of ['gas_email_processor.js', 'gas_gemini_service.js', 'gas_response_validator.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
}
const processor = Object.create(ctx.EmailProcessor.prototype);
let cases = 0;
function check(label, fn) {
  try { fn(); cases++; } catch (error) { throw new Error(label, { cause: error }); }
}
check('QuickCheck receives the latest correction, not an older summary prefix', () => {
  const correction = '• [2026-10-11] La data richiesta è il 21 ottobre, non il 12.';
  const source = { memorySummary: ('• [2026-10-01] Procedura già spiegata.\n').repeat(25) + correction };
  const before = JSON.stringify(source);
  const memory = processor._buildQuickCheckMemoryContext_(source);
  assert(memory.summary.length <= 500);
  assert(memory.summary.endsWith(correction));
  const prompt = ctx.EmailQuickCheckPolicy.buildPrompt('Confermate quella data?', 'Re: Certificato',
    { hasConversationContext: true, quickMemoryContext: memory });
  assert(prompt.prompt.includes(correction));
  assert.equal(JSON.stringify(source), before);
});
check('short and absent summaries remain compatible', () => {
  for (const text of ['', '• Dati completi.', 'x'.repeat(500)]) {
    assert.equal(processor._buildQuickCheckMemoryContext_({ memorySummary: text }).summary, text);
  }
  assert.equal(processor._buildQuickCheckMemoryContext_({}).summary, '');
});
check('an oversized latest entry retains its qualification and final correction', () => {
  const latest = 'Non è un appuntamento confermato. ' + 'Dettaglio già comunicato. '.repeat(60) + 'La preferenza corretta è il 21 ottobre.';
  const summary = processor._buildQuickCheckMemoryContext_({ memorySummary: 'Vecchio punto.\n' + latest }).summary;
  assert(summary.length <= 500);
  assert(summary.includes('Non è un appuntamento confermato.'));
  assert(summary.endsWith('La preferenza corretta è il 21 ottobre.'));
  assert(summary.includes('parte centrale omessa'));
});
check('the real validation pipeline retains historical evidence with a long current message', () => {
  const validator = new ctx.ResponseValidator();
  // Isolate the deterministic score; exercise actual semantic forwarding and rendering.
  validator._runValidationChecks = () => ({ isValid: true, score: 0.7, errors: [], warnings: [],
    details: { hallucinations: { score: 0.7, errors: [] } } });
  const semantic = ctx.createSemanticValidator();
  semantic.runtimeSemanticAvailable = true;
  semantic.shouldRun = () => true;
  semantic.validateThinkingLeak = () => ({ isValid: true, confidence: 1 });
  semantic._readCache = () => null;
  semantic._writeCache = () => {};
  let captured = '';
  semantic._generateSemantic = prompt => {
    captured = prompt;
    return '{"isValid":true,"confidence":1}';
  };
  validator.semanticValidator = semantic;
  const body = 'Richiesta iniziale. ' + 'Dettagli del caso. '.repeat(200) + 'Domanda finale: avete ricevuto la correzione?';
  const history = 'Utente: La data corretta è il 21 ottobre, non il 12.';
  validator.validateResponse('Abbiamo ricevuto la correzione.', 'it', 'Fonte istituzionale.', body,
    'Certificato', 'full', false, { validationContext: { explicitThreadContext: history } });
  assert(captured.includes(history));
  assert(captured.includes('Richiesta iniziale.'));
  assert(captured.includes('Domanda finale: avete ricevuto la correzione?'));
  assert(captured.includes('parte centrale omessa'));
  assert(captured.includes('Una precedente risposta della segreteria non è invece una fonte autonoma'));
});
check('separate sections have bounded budgets and no invented history', () => {
  const semantic = ctx.createSemanticValidator();
  const prompt = semantic._buildHallucinationPrompt('Risposta', 'Fonte', '', '',
    { subject: 'S'.repeat(2000), body: 'B'.repeat(9000), history: 'Utente: ' + 'H'.repeat(9000) + ' CORREZIONE_RECENTE' });
  const email = prompt.split('EMAIL ORIGINALE:\n"""\n')[1].split('\n"""')[0];
  assert(email.length < 7200);
  assert(email.includes('CORREZIONE_RECENTE'));
  assert(!email.includes('B'.repeat(2001)));
  const noHistory = semantic._buildHallucinationPrompt('Risposta', 'Fonte', '', '', { subject: 'S', body: 'B' });
  assert(!noHistory.includes('STORICO ESPLICITO DEL THREAD:'));
});
check('cache identity includes the separately rendered evidence', () => {
  const semantic = ctx.createSemanticValidator();
  semantic.runtimeSemanticAvailable = true;
  semantic.shouldRun = () => true;
  semantic._cacheKey = (kind, material) => material;
  const entries = new Map();
  semantic._readCache = key => entries.get(key);
  semantic._writeCache = (key, value) => entries.set(key, value);
  let calls = 0;
  semantic._generateSemantic = () => { calls++; return '{"isValid":true,"confidence":1}'; };
  for (const history of ['data 12', 'data 12', 'data 21']) {
    semantic.validateHallucinations('Risposta', 'Fonte', { score: 0.7, errors: [] }, 'legacy',
      { groundingParts: { subject: 'S', body: 'B', history } });
  }
  assert.equal(calls, 2);
});
console.log(`Conversation context budgets: ${cases} cases passed`);
