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

loadScript('gas_response_strategy.js');
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

const mixedLanguageValidation = {
    isValid: false,
    score: 0.2,
    errors: ['Lingua mista: rilevato almeno un segmento IT in una risposta FR.'],
    details: {
        language: { errors: ['Lingua mista: rilevato almeno un segmento IT in una risposta FR.'] }
    }
};
assert(
    processor._shouldAttemptIntelligentRetry(
        mixedLanguageValidation,
        'fr',
        { ...global.CONFIG.INTELLIGENT_RETRY, onlyForErrors: ['language'] }
    ) === true,
    'Strong mixed-language errors should retry even when their score is below the ordinary threshold'
);
const mixedLanguagePrompt = processor._buildCorrectionPrompt(
    'Original Prompt',
    'Bonsoir. Qualora le fosse possibile passare da Roma.',
    mixedLanguageValidation,
    'fr',
    'full'
);
assert(
    mixedLanguagePrompt.includes('formule di cortesia ed eventuali blocchi standard') &&
      mixedLanguagePrompt.includes('traduci o elimina ogni frase rimasta in un\'altra lingua'),
    'Language retry must correct every standard block, not only greeting and signature'
);

const structuredRetrySource = [
    '### ISTRUZIONI DI SISTEMA ###',
    'Regole stabili da conservare per il retry.',
    '### DATI E CONTESTO UTENTE ###',
    '**INFORMAZIONI DI RIFERIMENTO:**',
    '<knowledge_base>',
    'KB_HEAD_SENTINEL ' + 'dettaglio kb '.repeat(500) + ' KB_TAIL_SENTINEL',
    '</knowledge_base>',
    '**CRONOLOGIA CONVERSAZIONE:**',
    '<conversation_history>',
    'HISTORY_REMOTE_SENTINEL ' + 'messaggio remoto '.repeat(500) + ' HISTORY_RECENT_SENTINEL',
    '</conversation_history>',
    '**ALLEGATI (TESTO ESTRATTO):**',
    'OCR_REMOTE_SENTINEL ' + 'testo allegato '.repeat(300) + ' OCR_TAIL_SENTINEL',
    '**EMAIL DA RISPONDERE:**',
    '<user_email>',
    'EMAIL_RETRY_SENTINEL: vorrei sapere come procedere. ' + 'dettaglio email '.repeat(80),
    '</user_email>'
].join('\n');
const trimmedRetrySource = processor._trimPromptForRetry_(structuredRetrySource, 1800);
assert(trimmedRetrySource.length <= 1800, 'Retry trim should respect maxChars');
assert(
    trimmedRetrySource.includes('<user_email>') &&
      trimmedRetrySource.includes('</user_email>') &&
      trimmedRetrySource.includes('EMAIL_RETRY_SENTINEL'),
    'Retry trim should preserve the current email XML block'
);
if (trimmedRetrySource.includes('<knowledge_base>')) {
    const kbCloseIndex = trimmedRetrySource.indexOf('</knowledge_base>');
    const emailOpenIndex = trimmedRetrySource.indexOf('<user_email>');
    assert(kbCloseIndex > trimmedRetrySource.indexOf('<knowledge_base>'), 'Retry trim should close knowledge_base if it is kept');
    assert(emailOpenIndex < 0 || kbCloseIndex < emailOpenIndex, 'Retry trim should not leave user_email inside knowledge_base');
}
if (trimmedRetrySource.includes('<conversation_history>')) {
    assert(trimmedRetrySource.includes('</conversation_history>'), 'Retry trim should close conversation_history if it is kept');
}
assert(!trimmedRetrySource.includes('HISTORY_REMOTE_SENTINEL'), 'Retry trim should sacrifice remote history before current email');

const xmlOnlyRetrySource = [
    '### DATI E CONTESTO UTENTE ###',
    '**INFORMAZIONI DI RIFERIMENTO:**',
    '<knowledge_base>',
    'XML_ONLY_SENTINEL ' + 'contenuto '.repeat(700),
    '</knowledge_base>'
].join('\n');
const xmlOnlyTrimmed = processor._trimPromptForRetry_(xmlOnlyRetrySource, 500);
assert(xmlOnlyTrimmed.length <= 500, 'XML-only retry trim should respect maxChars');
assert(
    !xmlOnlyTrimmed.includes('<knowledge_base>') ||
      xmlOnlyTrimmed.indexOf('</knowledge_base>') > xmlOnlyTrimmed.indexOf('<knowledge_base>'),
    'XML-only retry trim should not leave knowledge_base open'
);

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

const softPrompt = processor._buildCorrectionPrompt('Original Prompt', 'Short Response', shortValidation, 'it', 'soft');
assert(
    softPrompt.includes('Mantieni una ripresa leggera') &&
      softPrompt.includes('chiusura/firma essenziale') &&
      !softPrompt.includes('Includi saluto e firma.'),
    'Soft salutationMode should keep light continuation instead of asking for a full greeting'
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

let temporalAwarenessArgs = null;
processor.promptEngine = {
    _renderTemporalAwareness: function () {
        temporalAwarenessArgs = Array.from(arguments);
        return 'TEMPORAL_AWARENESS_SENTINEL';
    }
};
const renderedRuntimeContext = processor._renderRuntimeContextForCorrection_(
    {
        temporal: {
            currentDate: '2026-06-07',
            currentTime: '20:30',
            messageDate: '2026-06-01'
        },
        papal: {
            currentName: 'Papa Leone XIV',
            previousName: 'Papa Francesco',
            currentSince: '2025-05-08',
            ministryStart: '2025-05-18'
        }
    },
    'it',
    'soft'
);
assert(
    Array.isArray(temporalAwarenessArgs) &&
      temporalAwarenessArgs.length === 4 &&
      temporalAwarenessArgs[0].currentDate === '2026-06-07' &&
      temporalAwarenessArgs[1] === 'it' &&
      temporalAwarenessArgs[2].includes('Papa Leone XIV') &&
      temporalAwarenessArgs[2].includes('2025-05-08') &&
      temporalAwarenessArgs[3].currentName === 'Papa Leone XIV',
    'Runtime context retry should call _renderTemporalAwareness with temporal, language, papal source text and papal object only'
);
assert(
    renderedRuntimeContext.includes('TEMPORAL_AWARENESS_SENTINEL'),
    'Runtime context retry should include rendered temporal awareness'
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

const kbRelevanceValidation = {
    isValid: false,
    score: 0.35,
    errors: ['Semantica: Pertinenza KB: alternativa accessoria non richiesta'],
    details: {
        semantic: {
            hallucinations: {
                isValid: false,
                confidence: 0.35,
                reason: 'Pertinenza KB insufficiente',
                details: {
                    irrelevantDetails: [
                        { text: 'anticipare alcuni incontri', reason: 'non risponde al vincolo espresso' }
                    ]
                }
            }
        }
    }
};
const kbRelevanceFlags = processor._classifyValidationForRetry(kbRelevanceValidation, 'it');
assert(kbRelevanceFlags.kb_relevance === true, 'Should classify contextual KB relevance errors separately');
assert(kbRelevanceFlags.hallucination === false, 'A true but irrelevant KB detail should not be mislabeled as hallucination');
assert(
    processor._shouldAttemptIntelligentRetry(
        kbRelevanceValidation,
        'it',
        { ...global.CONFIG.INTELLIGENT_RETRY, onlyForErrors: ['kb_relevance'] }
    ) === true,
    'Should retry critical KB relevance errors even with a low score'
);
const kbRelevancePrompt = processor._buildCorrectionPrompt(
    'Original Prompt',
    'È possibile concordare un programma personalizzato o anticipare alcuni incontri.',
    kbRelevanceValidation,
    'it',
    'full'
);
assert(
    kbRelevancePrompt.includes('dettagli veri ma non pertinenti') &&
      kbRelevancePrompt.includes('unità informative indipendenti') &&
      kbRelevancePrompt.includes('alternative non richieste') &&
      kbRelevancePrompt.includes('anticipare alcuni incontri'),
    'KB relevance retry should remove irrelevant branches while preserving grounded facts'
);

console.log('✅ All intelligent retry logic tests passed!');
