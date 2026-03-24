const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.CONFIG = {
  MAX_SAFE_TOKENS: 100000,
  KB_TOKEN_BUDGET_RATIO: 0.5,
  SEMANTIC_VALIDATION: { enabled: false },
  VALIDATION_MIN_SCORE: 0.6
};

global.LANGUAGE_MARKERS = {
  it: ['grazie', 'cordiali', 'saluti', 'gentile', 'parrocchia', 'messa'],
  en: ['thank', 'regards', 'dear', 'parish', 'mass']
};

global.createLogger = () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} });
global.calculateEaster = (year) => new Date(year, 3, 1);
global.Utilities = {
  formatDate: () => '2026-03-24',
  sleep: () => {}
};

['gas_prompt_engine.js', 'gas_response_validator.js'].forEach((file) => {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  vm.runInThisContext(code, { filename: path.join(__dirname, '..', file) });
});

const snapshotsPath = path.join(__dirname, 'prompt_validator_snapshots.json');
const snapshots = JSON.parse(fs.readFileSync(snapshotsPath, 'utf8'));
assert(Array.isArray(snapshots) && snapshots.length >= 3, 'Servono almeno 3 snapshot golden');

const promptEngine = new PromptEngine();
const validator = new ResponseValidator();

for (const testCase of snapshots) {
  console.log(`--- Golden ${testCase.id} ---`);

  const prompt = promptEngine.buildPrompt({
    emailSubject: testCase.input.emailSubject,
    emailContent: testCase.input.emailContent,
    knowledgeBase: testCase.input.knowledgeBase,
    detectedLanguage: testCase.input.detectedLanguage,
    promptProfile: testCase.input.promptProfile,
    salutationMode: testCase.input.salutationMode,
    senderName: 'Utente Test',
    salutation: testCase.input.detectedLanguage === 'en' ? 'Good morning,' : 'Buongiorno,',
    closing: testCase.input.detectedLanguage === 'en' ? 'Regards,' : 'Cordiali saluti,'
  });

  assert(
    prompt.length <= testCase.expected.maxPromptChars,
    `[${testCase.id}] prompt troppo lungo: ${prompt.length}`
  );

  for (const required of (testCase.expected.promptMustInclude || [])) {
    assert(prompt.includes(required), `[${testCase.id}] prompt non contiene: ${required}`);
  }

  for (const forbidden of (testCase.expected.promptMustNotInclude || [])) {
    assert(!prompt.includes(forbidden), `[${testCase.id}] prompt contiene stringa vietata: ${forbidden}`);
  }

  const validation = validator.validateResponse(
    testCase.candidateResponse,
    testCase.input.detectedLanguage,
    testCase.input.knowledgeBase,
    testCase.input.emailContent,
    testCase.input.emailSubject,
    testCase.input.salutationMode,
    false
  );

  assert(
    validation.isValid === testCase.expected.validator.isValid,
    `[${testCase.id}] isValid atteso ${testCase.expected.validator.isValid}, ottenuto ${validation.isValid}`
  );

  if (typeof testCase.expected.validator.minScore === 'number') {
    assert(
      validation.score >= testCase.expected.validator.minScore,
      `[${testCase.id}] score ${validation.score} < minScore ${testCase.expected.validator.minScore}`
    );
  }

  if (typeof testCase.expected.validator.maxScore === 'number') {
    assert(
      validation.score <= testCase.expected.validator.maxScore,
      `[${testCase.id}] score ${validation.score} > maxScore ${testCase.expected.validator.maxScore}`
    );
  }

  for (const needle of (testCase.expected.validator.errorsMustInclude || [])) {
    assert(
      validation.errors.some((e) => e.includes(needle)),
      `[${testCase.id}] errore atteso non trovato: ${needle}`
    );
  }
}

console.log(`✅ Golden prompt+validator passati (${snapshots.length} casi)`);
