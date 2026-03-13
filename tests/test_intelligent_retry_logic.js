const fs = require('fs');
const vm = require('vm');

// Mock environment
global.CONFIG = {
  INTELLIGENT_RETRY: {
    enabled: true,
    maxRetries: 1,
    minScoreToTrigger: 0.6,
    onlyForErrors: ['thinking_leak', 'hallucination']
  }
};

global.createLogger = () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} });
global.Utilities = { sleep: () => {} };
global.GeminiService = class {};
global.MemoryService = class {};
global.ResponseValidator = class {};
global.PromptEngine = class {};
global.GmailService = class {};
global.TerritoryValidator = class {};
global.RequestClassifier = class {};
global.EmailClassifier = class {};
global.Classifier = class {};

function loadScript(path) {
    const code = fs.readFileSync(path, 'utf8');
    vm.runInThisContext(code, { filename: path });
}

loadScript('gas_email_processor.js');

function assert(condition, message) {
    if (!condition) {
        console.error('❌ FAILED:', message);
        process.exit(1);
    }
}

console.log('--- Test Intelligent Retry Logic ---');

const processor = new EmailProcessor({
  config: { validationEnabled: true }
});

// 1. Test _classifyValidationForRetry
console.log('Testing _classifyValidationForRetry...');
const mockValidation = {
  isValid: false,
  score: 0.5,
  errors: ['ragionamento esposto detected'],
  details: {
    exposedReasoning: { errors: ['leak'] }
  }
};

const flags = processor._classifyValidationForRetry(mockValidation, 'it');
assert(flags.thinking_leak === true, 'Should detect thinking_leak');
assert(flags.hallucination === false, 'Should not detect hallucination');

// 2. Test _shouldAttemptIntelligentRetry
console.log('Testing _shouldAttemptIntelligentRetry...');
// Critical error (thinking_leak) should trigger even if score > minScore (if we consider criticals special)
// Actually the code says: if (!critical && score >= minScore) return false;
// So critical ALWAYS triggers if allowed.
const shouldRetry = processor._shouldAttemptIntelligentRetry(mockValidation, 'it', global.CONFIG.INTELLIGENT_RETRY);
assert(shouldRetry === true, 'Should attempt retry for thinking_leak');

const lowScoreButNotAllowed = {
    isValid: false,
    score: 0.4,
    errors: ['risposta troppo corta'],
    details: { length: { errors: ['troppo corta'] } }
};
const shouldNotRetry = processor._shouldAttemptIntelligentRetry(lowScoreButNotAllowed, 'it', global.CONFIG.INTELLIGENT_RETRY);
assert(shouldNotRetry === false, 'Should not attempt retry for length error (not in allowed list)');

// 3. Test _buildCorrectionPrompt
console.log('Testing _buildCorrectionPrompt...');
const prompt = processor._buildCorrectionPrompt('Original Prompt', 'Failed Response', mockValidation, 'it', 'full');
assert(prompt.includes('ERRORE CRITICO: Hai incluso il tuo ragionamento interno'), 'Prompt should contain thinking leak correction');
assert(prompt.includes('Failed Response'), 'Prompt should include previous response snippet');

console.log('✅ All intelligent retry logic tests passed!');
