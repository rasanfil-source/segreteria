const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function setup(files, extra = {}) {
  const warnings = [];
  const ctx = vm.createContext({ console: { log() {}, error() {}, warn: text => warnings.push(text) }, ...extra });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
  return { ctx, warnings };
}

// Public validator: deterministic blockers survive; semantic calls cannot rescue them.
const { ctx } = setup(['gas_response_validator.js'], { CONFIG: { SEMANTIC_VALIDATION: { enabled: false } } });
const clean = "Gentile signora, grazie per il suo messaggio. Restiamo a disposizione per rispondere alle sue domande. Cordiali saluti, Segreteria Parrocchia Sant'Eugenio";
for (const suffix of [' XXX', ' Nota interna: verificare il contesto prima di rispondere.']) {
  for (const refined of [false, true]) {
    const v = new ctx.ResponseValidator();
    let calls = 0;
    v.semanticValidator = {
      shouldRun: () => true,
      validateHallucinations: () => { calls++; return { isValid: true }; },
      validateThinkingLeak: () => { calls++; return { isValid: true }; }
    };
    v._perfezionamentoAutomatico = () => ({ fixed: refined, text: clean });
    const result = v.validateResponse(clean + suffix, 'it', '', '', '', 'full', true);
    assert.equal(result.isValid, refined);
    assert.equal(calls, refined ? 2 : 0);
    if (!refined) assert(result.errors.length > 0);
  }
}
const soft = new ctx.ResponseValidator();
let softCalls = 0;
soft._runValidationChecks = () => ({ isValid: true, score: 0.7, errors: [], warnings: ['meta'], details: {
  exposedReasoning: { errors: [], warnings: ['meta'], score: 0.75 }
} });
soft.semanticValidator = { shouldRun: () => true,
  validateHallucinations: () => { softCalls++; return { isValid: true }; },
  validateThinkingLeak: () => ({ isValid: true }) };
soft.validateResponse(clean, 'it', '', '', '', 'full', false);
assert.equal(softCalls, 1);

for (const Gmail of [undefined, null, {}, { Users: { Messages: {} } }]) {
  const { ctx: c, warnings } = setup(['gas_gmail_service.js'], { Gmail });
  const service = new c.GmailService();
  service._getOptionalLabelIdByName = () => { throw Error('must not contact Gmail'); };
  const result = service._discoverByMetadata('IA', 'Errore', 'Verifica', 10, 10, 1);
  assert.equal(result.threads.length, 0);
  assert.equal(result.threadIds.size, 0);
  assert.equal(result.messageIds.size, 0);
  assert(warnings.some(text => text.includes('Servizio avanzato Gmail non disponibile')));
}

for (const centralized of [false, true]) {
  const files = centralized ? ['gas_error_types.js', 'gas_email_processor.js'] : ['gas_email_processor.js'];
  const { ctx: c } = setup(files);
  const processor = Object.create(c.EmailProcessor.prototype);
  for (const error of [Error('forced-INVALID_RESPONSE'), Error('invalid response'), Error('empty-response'),
    Error('no_candidates'), { type: 'INVALID_RESPONSE', message: 'bad result' }, { code: 'INVALID_RESPONSE', message: 'bad result' }]) {
    const result = processor._classifyError(error);
    assert.equal(result.type, 'INVALID_RESPONSE');
    assert.equal(result.retryable, false);
    if (centralized) assert.equal(c.classifyError(error).type, 'INVALID_RESPONSE');
  }
  assert.equal(processor._classifyError({ code: 'GENERATION_INVALID_RESPONSE' }).retryable, true);
  assert.equal(processor._classifyError(Error('429 quota INVALID_RESPONSE')).type, 'QUOTA_EXCEEDED');
  assert.equal(processor._classifyError(Error('unrelated')).type, 'UNKNOWN');
}

for (const file of ['gas_config.js', 'gas_config.example.js']) {
  const { ctx: c, warnings } = setup([file]);
  const config = c.getConfig();
  config.MEMORY_RETENTION_DAYS = 30;
  config.SENSITIVE_FLAGS_TTL_DAYS = 180;
  const before = warnings.length;
  for (let i = 0; i < 3; i++) assert.equal(c.validateConfig().warnings.length, 1);
  assert.equal(warnings.length - before, 1);
  config.MEMORY_RETENTION_DAYS = 40;
  c.validateConfig();
  assert.equal(warnings.length - before, 2);
  config.MEMORY_RETENTION_DAYS = 180;
  assert.equal(c.validateConfig().warnings.length, 0);
  config.MEMORY_RETENTION_DAYS = 40;
  c.validateConfig();
  assert.equal(warnings.length - before, 3);
}
console.log('Validated report regressions passed');
