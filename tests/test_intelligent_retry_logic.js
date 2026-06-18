const fs = require('fs');
const vm = require('vm');

// Ambiente simulato
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

// 1. Testare _classifyValidationForRetry
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

// 2. Prova _shouldAttemptIntelligentRetry
console.log('Testing _shouldAttemptIntelligentRetry...');
// Gli errori critici bypassano il controllo del punteggio minimo.
const shouldRetry = processor._shouldAttemptIntelligentRetry(mockValidation, 'it', global.CONFIG.INTELLIGENT_RETRY);
assert(shouldRetry === true, 'Should attempt retry for thinking_leak');

const lowScoreButNotAllowed = { isValid: false, score: 0.2, errors: ['length'] };
const shouldNotRetry = processor._shouldAttemptIntelligentRetry(lowScoreButNotAllowed, 'it', global.CONFIG.INTELLIGENT_RETRY);
assert(shouldNotRetry === false, 'Should not attempt retry for length error (not in allowed list)');

const retryConfigWithLength = {
    ...global.CONFIG.INTELLIGENT_RETRY,
    onlyForErrors: [...global.CONFIG.INTELLIGENT_RETRY.onlyForErrors, 'length']
};
const highScoreAllowed = {
    isValid: false,
    score: 0.8,
    errors: ['risposta troppo corta'],
    details: { length: { errors: ['troppo corta'] } }
};
const shouldRetryAllowed = processor._shouldAttemptIntelligentRetry(highScoreAllowed, 'it', retryConfigWithLength);
assert(
    shouldRetryAllowed === true,
    'Should attempt retry for allowed non-critical error when score is above threshold'
);

// 3. Testare _buildCorrectionPrompt
console.log('Testing _buildCorrectionPrompt...');
const prompt = processor._buildCorrectionPrompt('Original Prompt', 'Failed Response', mockValidation, 'it', 'full');
assert(prompt.includes('ERRORE CRITICO: Hai incluso il tuo ragionamento interno'), 'Prompt should contain thinking leak correction');
assert(prompt.includes('Failed Response'), 'Prompt should include previous response snippet');

const shortValidation = {
    isValid: false,
    score: 0.8,
    errors: ['risposta troppo corta'],
    details: { length: { errors: ['troppo corta'] } }
};
const defaultModePrompt = processor._buildCorrectionPrompt('Original Prompt', 'Short Response', shortValidation, 'it');
assert(defaultModePrompt.includes('Includi saluto e firma.'), 'Undefined salutationMode should use explicit full-mode default');

const continuityPrompt = processor._buildCorrectionPrompt('Original Prompt', 'Short Response', shortValidation, 'it', 'none_or_continuity');
assert(
    continuityPrompt.includes('NON includere saluti formali o firme'),
    'Continuity salutationMode should not ask for saluto/firma in retry'
);

const temporalValidation = {
    isValid: false,
    score: 0.4,
    errors: ['Incoerenza temporale'],
    details: { temporalConsistency: { errors: ['Incoerenza temporale'] } }
};
const temporalRuntimePrompt = processor._buildCorrectionPrompt(
    'Original Prompt',
    'Il corso del 10 giugno 2026 si è già svolto.',
    temporalValidation,
    'it',
    'full',
    {
        temporal: {
            currentDate: '2026-06-07',
            currentTime: '20:30',
            messageDate: '2026-06-01',
            messageDateSource: 'gmail_message_date',
            daysAgo: 6,
            isOldMessage: true
        },
        papal: {
            currentName: 'Papa Leone XIV',
            previousName: 'Papa Francesco',
            ministryStart: '2025-05-18'
        }
    }
);
assert(
    temporalRuntimePrompt.includes('Regola 1: usa currentDate (2026-06-07)') &&
      temporalRuntimePrompt.includes('Regola 2: usa messageDate (2026-06-01)') &&
      temporalRuntimePrompt.includes('email vecchia') &&
      temporalRuntimePrompt.includes('Inizio ministero Papa attuale: 2025-05-18'),
    'Temporal retry prompt should include explicit currentDate/messageDate/papal retry rules'
);

const sensitiveValidation = {
    isValid: false,
    score: 0.45,
    errors: ['Continuita sensibile: la risposta riapre il lutto non ripreso'],
    details: {
        sensitiveContinuityQuality: {
            errors: ['Continuita sensibile: la risposta riapre il lutto non ripreso']
        }
    }
};
const sensitiveFlags = processor._classifyValidationForRetry(sensitiveValidation, 'it');
assert(sensitiveFlags.sensitive_quality === true, 'Should classify sensitive quality validation errors');
const shouldRetrySensitive = processor._shouldAttemptIntelligentRetry(
    sensitiveValidation,
    'it',
    { ...global.CONFIG.INTELLIGENT_RETRY, onlyForErrors: ['sensitive_quality'] }
);
assert(shouldRetrySensitive === true, 'Should attempt retry for sensitive_quality errors');
const sensitivePrompt = processor._buildCorrectionPrompt(
    'Original Prompt',
    'Ricordando il lutto, confermo l orario.',
    sensitiveValidation,
    'it',
    'full'
);
assert(
    sensitivePrompt.includes('postura sensibile') &&
      sensitivePrompt.includes('senza nominare memoria, lutto o vissuti non ripresi'),
    'Sensitive retry prompt should include posture correction guidance'
);

console.log('✅ All intelligent retry logic tests passed!');
