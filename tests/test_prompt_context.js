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
  KB_HALLUCINATION_RISK_THRESHOLD: 8000
};

const promptContextPath = path.join(__dirname, '..', 'gas_prompt_context.js');
const code = fs.readFileSync(promptContextPath, 'utf8');
vm.runInThisContext(code, { filename: promptContextPath });

console.log('--- Test PromptContext: identity_consistency solo per nuove richieste non tecniche ---');
const technicalNew = createPromptContext({
  email: { isReply: false, detectedLanguage: 'it' },
  requestType: { type: 'technical' },
  classification: { confidence: 1, category: 'technical' }
});
assert(
  technicalNew.concerns.identity_consistency === false,
  'una nuova richiesta tecnica non deve attivare identity_consistency'
);

const nonTechnicalReply = createPromptContext({
  email: { isReply: true, detectedLanguage: 'it' },
  requestType: { type: 'information' },
  classification: { confidence: 1, category: 'other' }
});
assert(
  nonTechnicalReply.concerns.identity_consistency === false,
  'una risposta in thread non tecnico non deve attivare identity_consistency'
);

const nonTechnicalNew = createPromptContext({
  email: { isReply: false, detectedLanguage: 'it' },
  requestType: { type: 'information' },
  classification: { confidence: 1, category: 'other' }
});
assert(
  nonTechnicalNew.concerns.identity_consistency === true,
  'una nuova richiesta non tecnica deve attivare identity_consistency'
);

console.log('--- Test PromptContext: multi_question per email con più dubbi operativi ---');
const multiQuestion = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Battesimo',
    body: 'Vorrei sapere quali documenti servono? Ci sono costi e date disponibili?'
  },
  requestType: { type: 'technical' },
  classification: { confidence: 1, category: 'information' }
});
assert(
  multiQuestion.concerns.multi_question === true,
  'due domande operative devono attivare multi_question'
);

console.log('✅ Test PromptContext OK');
