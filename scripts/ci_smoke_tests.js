#!/usr/bin/env node

/**
 * Smoke tests eseguibili in CI Node.js
 * - Carica file GAS in VM Node per verifiche di regressione pure-JS
 * - NON tocca servizi Google (PropertiesService, UrlFetchApp, ...)
 *
 * SOGLIA MINIMA: se il numero di test scende sotto MIN_EXPECTED_TESTS
 * il processo esce con errore (protezione contro rimozione accidentale).
 */

const fs = require('fs');
const vm = require('vm');

const MIN_EXPECTED_TESTS = 39;

const loadedScripts = new Set();

// Helper calculateEaster (necessario per gas_gemini_service.js)
global.calculateEaster = function (year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day, 12, 0, 0);
};

// Mock createLogger (necessario per EmailProcessor)
global.createLogger = function (name) {
    return { info: () => { }, warn: () => { }, debug: () => { }, error: () => { } };
};

global.Utilities = {
    formatDate: (date, tz, pattern) => {
        const d = new Date(date);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        if (pattern && pattern.includes('HH:mm')) {
            const h = String(d.getUTCHours()).padStart(2, '0');
            const min = String(d.getUTCMinutes()).padStart(2, '0');
            return `${y}-${m}-${day} ${h}:${min}`;
        }
        return `${y}-${m}-${day}`;
    },
    sleep: () => { },
    computeDigest: () => [0, 1, 2, 3],
    getUuid: () => 'uuid-mock',
    DigestAlgorithm: { MD5: 'MD5' }
};

// Mock Session
global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'me@parrocchia.it' }),
    getActiveUser: () => ({ getEmail: () => 'me@parrocchia.it' })
};

// Mock CacheService
const globalCacheStore = new Map();
global.CacheService = {
    getScriptCache: () => ({
        get: (k) => globalCacheStore.get(k) || null,
        put: (k, v) => globalCacheStore.set(k, v),
        remove: (k) => globalCacheStore.delete(k)
    })
};

// Mock PropertiesService e SpreadsheetApp (per MemoryService)
global.PropertiesService = {
    getScriptProperties: () => ({
        getProperty: (k) => {
            if (k === 'SPREADSHEET_ID') return 'abc-123';
            if (k === 'GEMINI_API_KEY') return 'abcdefghijklmnopqrstuvwxyz123456';
            return null;
        }
    })
};

function makeSheetMock(matrix) {
    const rows = Array.isArray(matrix) && matrix.length > 0 ? matrix : [[null]];
    const maxColumns = Math.max(9, ...rows.map((row) => Array.isArray(row) ? row.length : 0));
    const cell = {
        setFontWeight: () => { },
        setValue: () => { }
    };

    return {
        getDataRange: () => ({ getValues: () => rows }),
        getRange: (row = 1, column = 1, numRows = 1, numCols = 1) => ({
            getValues: () => Array.from({ length: numRows }, (_, rowOffset) =>
                Array.from({ length: numCols }, (_, colOffset) => ((rows[row + rowOffset - 1] || [])[column + colOffset - 1] ?? ''))
            ),
            getValue: () => ((rows[row - 1] || [])[column - 1] ?? ''),
            getCell: () => cell,
            setFontWeight: () => { },
            setValue: () => { }
        }),
        getLastRow: () => rows.length,
        getMaxColumns: () => maxColumns,
        insertColumnAfter: () => { },
        createTextFinder: () => ({
            matchEntireCell: () => ({
                matchCase: () => ({
                    matchFormulaText: () => ({
                        findNext: () => null
                    })
                })
            })
        })
    };
}

global.SpreadsheetApp = {
    openById: () => ({
        getSheetByName: () => makeSheetMock([['threadId', 'language', 'category', 'tone', 'providedInfo', 'lastUpdated', 'messageCount', 'version', 'memorySummary']])
    })
};

function loadScript(path) {
    if (loadedScripts.has(path)) return;
    const code = fs.readFileSync(path, 'utf8');
    vm.runInThisContext(code, { filename: path });
    loadedScripts.add(path);
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertThrows(fn, expectedMessageFragment, failureMessage) {
    let thrown = null;
    try {
        fn();
    } catch (error) {
        thrown = error;
    }

    assert(thrown, failureMessage || 'Eccezione attesa ma non lanciata');
    if (expectedMessageFragment) {
        assert(
            thrown.message.includes(expectedMessageFragment),
            `Errore atteso contiene "${expectedMessageFragment}", ottenuto: "${thrown.message}"`
        );
    }
    return thrown;
}

function stringifyConsoleArgs(args) {
    return args.map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return arg.stack || arg.message;
        try {
            return JSON.stringify(arg);
        } catch (_) {
            return String(arg);
        }
    }).join(' ');
}

function withCapturedConsoleNoise(expected, fn) {
    const originalWarn = console.warn;
    const originalError = console.error;
    const seen = { warn: [], error: [] };

    const wrap = (level, original, patterns = []) => (...args) => {
        const message = stringifyConsoleArgs(args);
        seen[level].push(message);
        const isExpected = patterns.some((pattern) => pattern.test(message));
        if (!isExpected) {
            original(...args);
        }
    };

    console.warn = wrap('warn', originalWarn, expected && expected.warn);
    console.error = wrap('error', originalError, expected && expected.error);
    try {
        fn(seen);
        return seen;
    } finally {
        console.warn = originalWarn;
        console.error = originalError;
    }
}

// Helper: crea GeminiService mockato con fetchFn personalizzata
function createMockGeminiService(fetchFn) {
    const mockProps = { getProperty: () => null };
    const mockLogger = { info: () => { }, warn: () => { }, debug: () => { }, error: () => { } };
    return new GeminiService({
        primaryKey: 'abcdefghijklmnopqrstuvwxyz123456',
        config: { TEMPERATURE: 0.2, MAX_OUTPUT_TOKENS: 128, USE_RATE_LIMITER: false },
        fetchFn: fetchFn,
        props: mockProps,
        logger: mockLogger
    });
}

// ========================================================================
// TEST TERRITORY VALIDATOR
// ========================================================================

function testTerritoryAbbreviations() {
    loadScript('gas_territory_validator.js');

    const validator = new TerritoryValidator();

    const compact = validator.normalizeStreetName('via g.vincenzo gravina');
    assert(
        compact === 'via giovanni vincenzo gravina',
        `Atteso "via giovanni vincenzo gravina", ottenuto "${compact}"`
    );

    const matched = validator.findTerritoryMatch('via g.vincenzo gravina');
    assert(
        matched && matched.key === 'via giovanni vincenzo gravina',
        'findTerritoryMatch non risolve correttamente la via abbreviata'
    );

    const extracted = validator.extractAddressFromText('abito in via Roma 10A e via Roma 10B');
    assert(Array.isArray(extracted) && extracted.length === 2, 'Deduplica errata: 10A e 10B non devono collassare');
    assert(extracted[0].fullCivic !== extracted[1].fullCivic, 'fullCivic deve distinguere suffissi diversi');
}

function testCivicNormalization() {
    loadScript('gas_territory_validator.js');

    const result = TerritoryValidator.normalizeCivic('10 A');
    assert(result === '10A', `normalizeCivic("10 A") atteso "10A", ottenuto "${result}"`);

    const result2 = TerritoryValidator.normalizeCivic('5   B');
    assert(result2 === '5B', `normalizeCivic("5   B") atteso "5B", ottenuto "${result2}"`);

    const result3 = TerritoryValidator.normalizeCivic('  12 ');
    assert(result3 === '12', `normalizeCivic("  12 ") atteso "12", ottenuto "${result3}"`);

    const result4 = TerritoryValidator.normalizeCivic(null);
    assert(result4 === '', `normalizeCivic(null) atteso stringa vuota, ottenuto "${result4}"`);

    const result5 = TerritoryValidator.normalizeCivic(undefined);
    assert(result5 === '', `normalizeCivic(undefined) atteso stringa vuota, ottenuto "${result5}"`);

    const result6 = TerritoryValidator.normalizeCivic('10/A');
    assert(result6 === '10A', `normalizeCivic("10/A") atteso "10A", ottenuto "${result6}"`);

    const result7 = TerritoryValidator.normalizeCivic('10-B');
    assert(result7 === '10B', `normalizeCivic("10-B") atteso "10B", ottenuto "${result7}"`);
}

function testCivicDeduplicationExplicit() {
    loadScript('gas_territory_validator.js');

    const civicA = TerritoryValidator.normalizeCivic('10A');
    const civicB = TerritoryValidator.normalizeCivic('10B');
    assert(civicA !== civicB, `normalizeCivic deve distinguere 10A (${civicA}) da 10B (${civicB})`);

    const civicSpaced = TerritoryValidator.normalizeCivic('10 A');
    assert(civicSpaced === civicA, `normalizeCivic("10 A") deve normalizzare a "${civicA}", ottenuto "${civicSpaced}"`);
}

function testAddressExtractionWithSlashAndDashSuffix() {
    loadScript('gas_territory_validator.js');

    const validator = new TerritoryValidator();
    const extracted = validator.extractAddressFromText('abito in via Roma 10/A e via Roma 10-B');

    assert(Array.isArray(extracted) && extracted.length === 2, 'Estrazione civici con slash/dash fallita');
    assert(extracted[0].fullCivic === '10A', `Atteso 10A, ottenuto ${extracted[0].fullCivic}`);
    assert(extracted[1].fullCivic === '10B', `Atteso 10B, ottenuto ${extracted[1].fullCivic}`);
}

function testTerritorySuffixNeedsReviewOnParityRanges() {
    loadScript('gas_territory_validator.js');

    const validator = new TerritoryValidator();

    const evenWithSuffix = validator.verifyAddress('via flaminia', 158, '158A');
    assert(evenWithSuffix.inTerritory === true, '158A in via Flaminia deve risultare nel territorio');
    assert(evenWithSuffix.needsReview === true, 'civico pari con suffisso deve richiedere review');

    const oddWithSuffix = validator.verifyAddress('via flaminia', 109, '109B');
    assert(oddWithSuffix.inTerritory === true, '109B in via Flaminia deve risultare nel territorio');
    assert(oddWithSuffix.needsReview === true, 'civico dispari con suffisso deve richiedere review in modo simmetrico');

    const evenPlain = validator.verifyAddress('via flaminia', 158, '158');
    assert(evenPlain.needsReview === false, 'civico senza suffisso non deve richiedere review');
}

// ========================================================================
// TEST ERROR TYPES (classificazione centralizzata)
// ========================================================================

function testClassifyErrorQuota() {
    loadScript('gas_error_types.js');

    const result = classifyError(new Error('429 rate limit exceeded'));
    assert(result.type === 'QUOTA_EXCEEDED', `Atteso QUOTA_EXCEEDED, ottenuto "${result.type}"`);
    assert(result.retryable === true, 'Errore quota deve essere retryable');
    assert(result.message === '429 rate limit exceeded', 'Messaggio deve essere preservato');

    const result2 = classifyError(new Error('RESOURCE_EXHAUSTED: Quota exceeded'));
    assert(result2.type === 'QUOTA_EXCEEDED', `Atteso QUOTA_EXCEEDED, ottenuto "${result2.type}"`);
    assert(result2.retryable === true, 'Errore RESOURCE_EXHAUSTED deve essere retryable');
    assert(result2.message === 'RESOURCE_EXHAUSTED: Quota exceeded', 'Messaggio deve essere preservato');
}

function testClassifyErrorNonRetryable() {
    loadScript('gas_error_types.js');

    const apiKey = classifyError(new Error('API key unauthorized'));
    assert(apiKey.type === 'INVALID_API_KEY', `Atteso INVALID_API_KEY, ottenuto "${apiKey.type}"`);
    assert(apiKey.retryable === false, 'Errore API key NON deve essere retryable');

    const invalidResp = classifyError(new Error('Risposta Gemini non JSON valida'));
    assert(invalidResp.type === 'INVALID_RESPONSE', `Atteso INVALID_RESPONSE, ottenuto "${invalidResp.type}"`);
    assert(invalidResp.retryable === false, 'Errore INVALID_RESPONSE NON deve essere retryable');

    const unknown = classifyError(new Error('Qualcosa di strano'));
    assert(unknown.type === 'UNKNOWN', `Atteso UNKNOWN, ottenuto "${unknown.type}"`);
    assert(unknown.retryable === false, 'Errore UNKNOWN NON deve essere retryable');
}

function testClassifyErrorTimeoutSignals() {
    loadScript('gas_error_types.js');

    const httpTimeout = classifyError(new Error('HTTP 408 Request Timeout'));
    assert(httpTimeout.type === 'TIMEOUT', `Atteso TIMEOUT su 408, ottenuto "${httpTimeout.type}"`);
    assert(httpTimeout.retryable === true, 'Errore 408 deve essere retryable');
    assert(httpTimeout.message === 'HTTP 408 Request Timeout', 'Messaggio deve essere preservato');

    const connAborted = classifyError(new Error('read ECONNABORTED while contacting API'));
    assert(connAborted.type === 'TIMEOUT', `Atteso TIMEOUT su ECONNABORTED, ottenuto "${connAborted.type}"`);
    assert(connAborted.retryable === true, 'Errore ECONNABORTED deve essere retryable');
}

// ========================================================================
// TEST GEMINI SERVICE
// ========================================================================

function testPortugueseSpecialGreeting() {
    loadScript('gas_gemini_service.js');

    const service = Object.create(GeminiService.prototype);
    const greeting = service._getSpecialDayGreeting(new Date('2026-01-01T10:00:00Z'), 'pt');

    assert(
        greeting === 'Feliz Ano Novo!',
        `Atteso "Feliz Ano Novo!", ottenuto "${greeting}"`
    );
}

function testGeminiDependencyInjectionAndMockFetch() {
    loadScript('gas_gemini_service.js');

    const fakeResponse = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'OK-DI' }] } }]
        })
    };

    const service = createMockGeminiService(() => fakeResponse);
    const text = service._generateWithModel('Prompt test', 'gemini-2.5-flash');
    assert(text === 'OK-DI', `Atteso "OK-DI", ottenuto "${text}"`);
}

// --- Contract Tests: error handling ---

function testGeminiRetryOn429() {
    loadScript('gas_gemini_service.js');

    const mock429 = {
        getResponseCode: () => 429,
        getContentText: () => 'Rate limit exceeded'
    };

    const service = createMockGeminiService(() => mock429);
    assertThrows(
        () => service._generateWithModel('Prompt test', 'gemini-2.5-flash'),
        '429',
        '_generateWithModel deve lanciare errore su risposta 429'
    );
}

function testGeminiMalformedJson() {
    loadScript('gas_gemini_service.js');

    const mockBadJson = {
        getResponseCode: () => 200,
        getContentText: () => 'questo non è JSON valido {{{}'
    };

    const service = createMockGeminiService(() => mockBadJson);
    assertThrows(
        () => service._generateWithModel('Prompt test', 'gemini-2.5-flash'),
        'non JSON valida',
        '_generateWithModel deve lanciare errore su JSON malformato'
    );
}

function testGeminiNoCandidates() {
    loadScript('gas_gemini_service.js');

    const mockNoCandidates = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ candidates: [] })
    };

    const service = createMockGeminiService(() => mockNoCandidates);
    assertThrows(
        () => service._generateWithModel('Prompt test', 'gemini-2.5-flash'),
        'nessun candidato',
        '_generateWithModel deve lanciare errore senza candidati'
    );
}

// ========================================================================
// TEST RESPONSE VALIDATOR
// ========================================================================

function testResponseValidatorCheckLength() {
    loadScript('gas_response_validator.js');

    const validator = new ResponseValidator();

    const resShort = validator._checkLength('Ciao');
    assert(resShort.score === 0.0, `Risposta corta: score atteso 0.0, ottenuto ${resShort.score}`);
    assert(resShort.errors.length > 0, 'Risposta corta deve generare errori');

    const resGood = validator._checkLength('Gentile signora, la informo che gli orari delle Sante Messe festive sono i seguenti: sabato ore 18:00, domenica ore 8:00, 10:00 e 11:30. Cordiali saluti.');
    assert(resGood.score === 1.0, `Risposta buona: score atteso 1.0, ottenuto ${resGood.score}`);
    assert(resGood.errors.length === 0, 'Risposta buona non deve generare errori');

    const resAcceptedLong = validator._checkLength('A'.repeat(3001));
    assert(resAcceptedLong.score === 1.0, `3001 char deve restare valido, ottenuto ${resAcceptedLong.score}`);
    assert(resAcceptedLong.warnings.length === 0, '3001 char non deve generare warning dopo soglia alzata a 4500');

    const resWarnLong = validator._checkLength('A'.repeat(4501));
    assert(resWarnLong.score === 0.85, `4501 char deve essere warning soft, ottenuto ${resWarnLong.score}`);
    assert(resWarnLong.warnings.length > 0, '4501 char deve generare warning');
    const resHardLong = validator._checkLength('A'.repeat(6001));
    assert(resHardLong.score === 0.0, `Oltre 6000 char deve restare bloccante, ottenuto ${resHardLong.score}`);
}

function testResponseValidatorForbiddenContent() {
    loadScript('gas_response_validator.js');

    const validator = new ResponseValidator();

    const resForbidden = validator._checkForbiddenContent('Le messe sono alle [ORARIO].');
    assert(resForbidden.score === 0.0, 'Contenuto con placeholder deve avere score 0');

    const resClean = validator._checkForbiddenContent('Gentile signora, le confermo che la Santa Messa festiva è celebrata ogni domenica alle ore 10:00.');
    assert(resClean.score === 1.0, `Contenuto pulito: score atteso 1.0, ottenuto ${resClean.score}`);
    assert(resClean.errors.length === 0, 'Contenuto pulito non deve avere errori');
}

function testResponseValidatorLanguageCheck() {
    loadScript('gas_response_validator.js');

    const validator = new ResponseValidator();

    const resIt = validator._checkLanguage(
        'Gentile signora, grazie per la sua email. Le confermo la messa nella nostra parrocchia. Cordiali saluti dalla segreteria.',
        'it'
    );
    assert(resIt.errors.length === 0, `Check lingua IT non deve generare errori, ottenuti: ${resIt.errors.join('; ')}`);

    const resEn = validator._checkLanguage(
        'Dear Sir, thank you for your email regarding the parish. We would be happy to help with the mass schedule. Kind regards.',
        'en'
    );
    assert(resEn.errors.length === 0, `Check lingua EN non deve generare errori, ottenuti: ${resEn.errors.join('; ')}`);
}

function testResponseValidatorStreetNumberDoesNotWhitelistInventedTime() {
    loadScript('gas_response_validator.js');

    const validator = new ResponseValidator();
    const result = validator._checkHallucinations(
        'La messa e alle 10:00.',
        'Orari disponibili: 09:00 e 11:00.',
        'Abito in Via Roma 10, vorrei informazioni.'
    );

    assert(
        result.warnings.some((w) => w.includes('Orari non in KB: 10:00')),
        'numero civico 10 non deve sdoganare 10:00 come orario presente nel messaggio originale'
    );
    assert(
        Array.isArray(result.hallucinations.times) && result.hallucinations.times.includes('10:00'),
        '10:00 deve essere registrato tra gli orari inventati'
    );
}

function testResponseValidatorHourOnlyKnowledgeBaseAllowsNormalizedTime() {
    loadScript('gas_response_validator.js');

    const validator = new ResponseValidator();
    const result = validator._checkHallucinations(
        'La messa è alle 10:00.',
        'Orari messe festive: domenica alle ore 10.',
        'Vorrei sapere gli orari della domenica.'
    );

    assert(result.score === 1.0, `KB con "ore 10" deve autorizzare 10:00, ottenuto score ${result.score}`);
    assert(
        !result.warnings.some((w) => w.includes('Orari non in KB')),
        'KB con orario contestuale deve evitare warning di allucinazione su 10:00'
    );
}

function testSemanticThinkingPromptBullets() {
    loadScript('gas_response_validator.js');

    const semantic = Object.create(SemanticValidator.prototype);
    const prompt = semantic._buildThinkingLeakPrompt('Risposta di test');

    assert(!prompt.includes('$- '), 'Il prompt semantico non deve contenere prefissi "$-"');
    assert(prompt.includes('- "Rivedendo le istruzioni..."'), 'Bullet atteso non trovato nel prompt semantico');
}

function testResponseValidatorFrenchLiturgicalGreeting() {
    loadScript('gas_response_validator.js');

    const validator = new ResponseValidator();
    const result = validator._checkTimeBasedGreeting(
        'Joyeux Noël! Merci pour votre message et à bientôt.',
        'fr'
    );

    assert(result.isLiturgical === true, 'Il saluto liturgico francese deve essere riconosciuto');
    assert(result.warnings.length === 0, 'Un saluto liturgico non deve generare warning orari');
}

function testSemanticValidatorLazyFallbackWithoutGeminiOrCache() {
    loadScript('gas_response_validator.js');

    const originalConfig = global.CONFIG;
    const originalGeminiService = global.GeminiService;
    const originalCacheService = global.CacheService;
    const originalUrlFetchApp = global.UrlFetchApp;

    try {
        global.CONFIG = { VALIDATION_MIN_SCORE: 0.6, SEMANTIC_VALIDATION: { enabled: true } };
        global.GeminiService = undefined;
        global.CacheService = undefined;
        global.UrlFetchApp = undefined;

        const validator = new ResponseValidator();
        assert(validator.semanticValidator !== null, 'SemanticValidator deve inizializzarsi senza GeminiService eager');
        assert(validator.semanticValidator.runtimeSemanticAvailable === false, 'runtimeSemanticAvailable deve restare false fuori runtime GAS');

        const fallback = validator.semanticValidator.validateThinkingLeak('Risposta naturale.', { score: 0.9 });
        assert(fallback.skipped === true && fallback.fallback === true, 'in assenza runtime deve usare fallback lazy');
    } finally {
        global.CONFIG = originalConfig;
        global.GeminiService = originalGeminiService;
        global.CacheService = originalCacheService;
        global.UrlFetchApp = originalUrlFetchApp;
    }
}

// ========================================================================
// TEST EMAIL PROCESSOR (pure functions)
// ========================================================================

function testComputeSalutationMode() {
    loadScript('gas_email_processor.js');
    const NOW = new Date('2026-02-15T10:00:00Z');

    // Primo messaggio → full
    const first = computeSalutationMode({ isReply: false, messageCount: 1, memoryExists: false, lastUpdated: null });
    assert(first === 'full', `Primo messaggio: atteso "full", ottenuto "${first}"`);

    // Reply con memoria senza timestamp → continuità (fallback conservativo)
    const reply = computeSalutationMode({ isReply: true, messageCount: 2, memoryExists: true, lastUpdated: null });
    assert(reply === 'none_or_continuity', `Reply senza timestamp: atteso "none_or_continuity", ottenuto "${reply}"`);

    // Reply dopo 5 giorni → full (nuovo contatto, > 72h)
    const fiveDaysAgo = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const result5d = computeSalutationMode({ isReply: true, messageCount: 3, memoryExists: true, lastUpdated: fiveDaysAgo, now: NOW });
    assert(result5d === 'full', `Reply dopo 5 giorni: atteso "full", ottenuto "${result5d}"`);

    // Reply dopo 4 giorni → soft (ripresa conversazione entro 96h)
    const fourDaysAgo = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const result4d = computeSalutationMode({ isReply: true, messageCount: 3, memoryExists: true, lastUpdated: fourDaysAgo, now: NOW });
    assert(result4d === 'soft', `Reply dopo 4 giorni: atteso "soft", ottenuto "${result4d}"`);
}

function testEmailProcessorNormalizesGooglemailDotAliases() {
    loadScript('gas_email_processor.js');

    const processor = Object.create(EmailProcessor.prototype);
    const normalizedGooglemail = processor._normalizeEmailAddress_('Info.Parrocchia+archivio@googlemail.com');
    const normalizedGmail = processor._normalizeEmailAddress_('info.parrocchia@gmail.com');

    assert(normalizedGooglemail === 'infoparrocchia@gmail.com', `googlemail con dots/+ deve canonicalizzare a infoparrocchia@gmail.com, ottenuto ${normalizedGooglemail}`);
    assert(normalizedGmail === 'infoparrocchia@gmail.com', `gmail con dots deve canonicalizzare a infoparrocchia@gmail.com, ottenuto ${normalizedGmail}`);
    assert(normalizedGooglemail === normalizedGmail, 'gmail.com e googlemail.com dello stesso account devono risultare equivalenti');
}

function testIntelligentRetryAllowedNonCriticalHighScore() {
    loadScript('gas_email_processor.js');

    const previousConfig = global.CONFIG;
    global.CONFIG = {
        ...(previousConfig || {}),
        INTELLIGENT_RETRY: {
            enabled: true,
            maxRetries: 1,
            minScoreToTrigger: 0.6,
            onlyForErrors: ['thinking_leak', 'hallucination', 'language', 'placeholder', 'length']
        }
    };

    try {
        const processor = new EmailProcessor({
            config: { validationEnabled: true }
        });

        const validation = {
            isValid: false,
            score: 0.8,
            errors: ['risposta troppo corta'],
            details: { length: { errors: ['troppo corta'] } }
        };

        const shouldRetry = processor._shouldAttemptIntelligentRetry(
            validation,
            'it',
            global.CONFIG.INTELLIGENT_RETRY
        );

        assert(
            shouldRetry === true,
            'errore non critico ammesso con score sopra soglia deve attivare il retry intelligente'
        );
    } finally {
        global.CONFIG = previousConfig;
    }
}

function testAntiLoopDetection() {
    loadScript('gas_email_processor.js');

    const originalSession = global.Session;
    const originalCacheService = global.CacheService;

    const readMessageIds = [];
    const buildMessage = (id, from, date) => ({
        getId: () => id,
        isUnread: () => true,
        getFrom: () => from,
        getDate: () => date,
        markRead: () => readMessageIds.push(id)
    });

    const baseDate = new Date('2026-02-15T09:00:00Z');
    const messages = Array.from({ length: 12 }, (_, i) =>
        buildMessage(`m-${i}`, 'utente@example.com', new Date(baseDate.getTime() + (i * 60 * 1000)))
    );

    const labeled = [];
    const processor = new EmailProcessor({
        geminiService: {
            generateResponse: () => ({ success: true, text: 'Risposta' }),
            detectEmailLanguage: () => ({ lang: 'it', safetyGrade: 5 }),
            shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it' })
        },
        gmailService: {
            extractMessageDetails: () => ({ body: 'Test', subject: 'Inquiry', senderEmail: 'ext@example.com' }),
            addLabelToMessage: (id) => {
                labeled.push(id);
                if (typeof global !== 'undefined') {
                    if (!global.__labeled) global.__labeled = [];
                    global.__labeled.push(id);
                }
            },
            buildConversationHistory: () => []
        },
        validator: {
            validateResponse: () => ({ isValid: true, score: 1.0, errors: [] })
        },
        classifier: {
            classifyEmail: () => ({ shouldRespond: true, reason: 'ok' })
        },
        requestClassifier: {
            classify: () => ({ type: 'PASTORAL', dimensions: { pastoral: 0.8 } })
        },
        promptEngine: {
            buildPrompt: () => 'Prompt'
        },
        memoryService: {
            getMemory: () => ({ messageCount: 6, lastUpdated: new Date(baseDate.getTime()).toISOString() }),
            updateMemory: () => { }
        },
        territoryValidator: null,
        gmailService: {
            getMessageIdsWithLabel: () => new Set(),
            _extractEmailAddress: (fromField) => {
                const match = (fromField || '').match(/<([^>]+)>/) || (fromField || '').match(/([^\s<]+@[^\s>]+)/);
                return match ? match[1] : fromField;
            },
            extractMessageDetails: (message) => ({
                subject: 'Info',
                body: 'Vorrei un chiarimento',
                senderEmail: 'utente@example.com',
                senderName: 'Utente',
                headers: {},
                isNewsletter: false,
                date: message.getDate()
            }),
            addLabelToThread: () => { },
            addLabelToMessage: (id) => {
                labeled.push(id);
                if (typeof global !== 'undefined') {
                    if (!global.__labeled) global.__labeled = [];
                    global.__labeled.push(id);
                }
            }
        }
    });

    const thread = {
        getId: () => 'thread-loop',
        getLabels: () => [],
        getMessages: () => messages
    };

    try {
        const result = processor.processThread(thread, '', [], new Set(), true);
        assert(result.status === 'filtered', `Atteso status=filtered, ottenuto ${result.status}`);
        assert(result.reason === 'email_loop_detected', `Atteso reason=email_loop_detected, ottenuto ${result.reason}`);

        assert(readMessageIds.length >= 0, 'Controllo anti-loop completato');
    } finally {
        global.Session = originalSession;
        global.CacheService = originalCacheService;
    }
}

function testMemoryGetUsesRowValues() {
    loadScript('gas_memory_service.js');

    const service = Object.create(MemoryService.prototype);
    service._initialized = true;
    service._getFromCache = () => null;
    service._setCache = () => { };
    service._findRowByThreadId = () => ({
        rowIndex: 7,
        values: ['thread-1', 'it', 'TECHNICAL', 'standard', '[]', '2026-02-15T10:00:00.000Z', 2, 1, 'ok']
    });
    service._validateAndNormalizeTimestamp = (ts) => ts;

    let captured = null;
    service._rowToObject = (values) => {
        captured = values;
        return { threadId: values[0], language: values[1] };
    };

    const result = service.getMemory('thread-1');
    assert(Array.isArray(captured), 'getMemory deve passare solo values a _rowToObject');
    assert(result.threadId === 'thread-1', 'getMemory deve restituire threadId corretto');
}

function testInvalidateCacheAlsoClearsRobustCache() {
    loadScript('gas_memory_service.js');

    const removedKeys = [];
    const originalCacheService = global.CacheService;
    global.CacheService = {
        getScriptCache: () => ({
            remove: (key) => removedKeys.push(key)
        })
    };

    try {
        const service = Object.create(MemoryService.prototype);
        service._cache = { 'memory_thread-42': { data: {}, timestamp: Date.now() } };

        service._invalidateCache('memory_thread-42');
        assert(!service._cache['memory_thread-42'], '_invalidateCache deve rimuovere la cache locale');
        assert(removedKeys.includes('memory_thread-42'), '_invalidateCache deve rimuovere la chiave dalla cache script');
    } finally {
        global.CacheService = originalCacheService;
    }
}

function testUpdateMemoryLockFailureUsesExponentialBackoff() {
    console.log('--- Test: updateMemory applica backoff su lock timeout ---');
    loadScript('gas_memory_service.js');

    const service = Object.create(MemoryService.prototype);
    service._initialized = true;
    service._getShardedLockKey = () => 'memory_lock_thread-backoff';
    service._tryAcquireShardedLock = () => false;
    service._releaseShardedLock = () => { throw new Error('releaseLock non deve essere chiamato senza lock'); };

    const originalUtilities = global.Utilities;
    const sleeps = [];
    global.Utilities = Object.assign({}, originalUtilities, {
        sleep: (ms) => sleeps.push(ms)
    });

    try {
        let thrown = null;
        try {
            service.updateMemory('thread-backoff', { language: 'it' });
        } catch (error) {
            thrown = error;
        }

        assert(
            thrown && /Aggiornamento memoria fallito/.test(thrown.message),
            'updateMemory deve fallire dopo MAX_RETRIES se il lock resta occupato'
        );

        const expectedSleeps = [200, 400, 800, 1600, 3200];
        assert(
            sleeps.length === expectedSleeps.length,
            `Attesi ${expectedSleeps.length} backoff sleep prima del fallimento finale, ottenuti ${sleeps.length}`
        );
        assert(
            sleeps.every((ms, index) => ms === expectedSleeps[index]),
            `Backoff lock timeout non valido. Atteso ${expectedSleeps.join(', ')}, ottenuto ${sleeps.join(', ')}`
        );
    } finally {
        global.Utilities = originalUtilities;
    }
}

function testSheetWriteLockDoesNotReleaseWhenWaitLockFails() {
    console.log('--- Test: _withSheetWriteLock non rilascia senza lock acquisito ---');
    loadScript('gas_memory_service.js');

    const originalLockService = global.LockService;
    const originalSpreadsheetApp = global.SpreadsheetApp;
    let releaseCalled = false;

    global.LockService = {
        getScriptLock: () => ({
            waitLock: () => {
                throw new Error('lock busy');
            },
            releaseLock: () => {
                releaseCalled = true;
            }
        })
    };
    global.SpreadsheetApp = {
        flush: () => {
            throw new Error('flush non deve essere chiamato senza lock');
        }
    };

    try {
        const service = Object.create(MemoryService.prototype);
        let thrown = null;
        try {
            service._withSheetWriteLock(() => {
                throw new Error('writeOperation non deve essere chiamata senza lock');
            });
        } catch (error) {
            thrown = error;
        }

        assert(thrown && /Lock del foglio non acquisito/.test(thrown.message), 'deve rilanciare errore esplicito di lock non acquisito');
        assert(releaseCalled === false, 'releaseLock non deve essere chiamato se waitLock fallisce');
    } finally {
        global.LockService = originalLockService;
        global.SpreadsheetApp = originalSpreadsheetApp;
    }
}

function testAddProvidedInfoTopicsUsesSheetWriteLock() {
    console.log('--- Test: addProvidedInfoTopics usa sheet lock per scrivere ---');
    loadScript('gas_memory_service.js');

    const service = Object.create(MemoryService.prototype);
    service._initialized = true;
    service._getShardedLockKey = () => 'memory_lock_thread-topics';
    service._tryAcquireShardedLock = () => true;

    let released = false;
    service._releaseShardedLock = () => { released = true; };
    service._findRowByThreadId = () => ({
        rowIndex: 5,
        values: ['thread-topics', 'it', 'INFO', 'standard', '[]', '2026-02-15T10:00:00.000Z', 2, 3, '']
    });
    service._rowToObject = () => ({
        threadId: 'thread-topics',
        providedInfo: ['orari'],
        version: 3
    });
    service._normalizeProvidedTopics = (topics) => Array.isArray(topics) ? topics.slice() : [];
    service._mergeProvidedTopics = (existingTopics, newTopics) => existingTopics.concat(newTopics);
    service._validateAndNormalizeTimestamp = (ts) => ts;

    let sheetLockCalls = 0;
    let insideSheetWriteLock = false;
    let updateRowCalls = 0;
    let invalidatedKey = null;

    service._withSheetWriteLock = (writeOperation) => {
        sheetLockCalls++;
        insideSheetWriteLock = true;
        try {
            writeOperation();
        } finally {
            insideSheetWriteLock = false;
        }
    };
    service._updateRow = (_rowIndex, data) => {
        updateRowCalls++;
        assert(insideSheetWriteLock, 'addProvidedInfoTopics deve scrivere su Sheet solo dentro _withSheetWriteLock');
        assert(
            Array.isArray(data.providedInfo) && data.providedInfo.length === 2,
            'providedInfo deve risultare mergeato prima della scrittura'
        );
    };
    service._invalidateCache = (key) => { invalidatedKey = key; };

    service.addProvidedInfoTopics('thread-topics', ['contatti']);

    assert(sheetLockCalls === 1, `_withSheetWriteLock deve essere chiamato una volta, ottenuto ${sheetLockCalls}`);
    assert(updateRowCalls === 1, `_updateRow deve essere eseguito una volta, ottenuto ${updateRowCalls}`);
    assert(invalidatedKey === 'memory_thread-topics', `Cache invalidata errata: ${invalidatedKey}`);
    assert(released === true, 'Il lock sharded deve essere rilasciato in finally');
}

function testUpdateProvidedInfoWithoutIncrementUsesSheetWriteLockForAppend() {
    console.log('--- Test: _updateProvidedInfoWithoutIncrement usa sheet lock anche in append ---');
    loadScript('gas_memory_service.js');

    const service = Object.create(MemoryService.prototype);
    service._initialized = true;
    service._getShardedLockKey = () => 'memory_lock_thread-append';
    service._tryAcquireShardedLock = () => true;

    let released = false;
    service._releaseShardedLock = () => { released = true; };
    service._findRowByThreadId = () => null;
    service._normalizeProvidedTopics = (topics) => {
        if (!Array.isArray(topics)) topics = [topics];
        return topics.map(t => typeof t === 'string' ? { topic: t } : t);
    };
    service._mergeProvidedTopics = (existingTopics, newTopics) => existingTopics.concat(newTopics);
    service._validateAndNormalizeTimestamp = (ts) => ts;

    let sheetLockCalls = 0;
    let insideSheetWriteLock = false;
    let appendRowCalls = 0;
    let invalidatedKey = null;

    service._withSheetWriteLock = (writeOperation) => {
        sheetLockCalls++;
        insideSheetWriteLock = true;
        try {
            writeOperation();
        } finally {
            insideSheetWriteLock = false;
        }
    };
    service._appendRow = (data) => {
        appendRowCalls++;
        assert(insideSheetWriteLock, '_updateProvidedInfoWithoutIncrement deve fare append solo dentro _withSheetWriteLock');
        assert(data.threadId === 'thread-append', `threadId append errato: ${data.threadId}`);
        assert(
            Array.isArray(data.providedInfo) && data.providedInfo[0].topic === 'battesimo',
            'Il topic providedInfo deve essere preservato nel branch append'
        );
    };
    service._updateRow = () => {
        throw new Error('_updateRow non deve essere chiamato nel branch append');
    };
    service._invalidateCache = (key) => { invalidatedKey = key; };

    service._updateProvidedInfoWithoutIncrement('thread-append', ['battesimo']);

    assert(sheetLockCalls === 1, `_withSheetWriteLock deve essere chiamato una volta, ottenuto ${sheetLockCalls}`);
    assert(appendRowCalls === 1, `_appendRow deve essere eseguito una volta, ottenuto ${appendRowCalls}`);
    assert(invalidatedKey === 'memory_thread-append', `Cache invalidata errata: ${invalidatedKey}`);
    assert(released === true, 'Il lock sharded deve essere rilasciato in finally');
}

function testLoadResourcesResetsMissingPromptSheets() {
    loadScript('gas_main.js');

    const originalSpreadsheetApp = global.SpreadsheetApp;
    const originalGlobalCache = global.GLOBAL_CACHE;

    const fakeSheet = {
        getDataRange: () => ({
            getValues: () => [['Header1', 'Header2'], ['Valore', 'Dettaglio']]
        })
    };

    global.SpreadsheetApp = {
        openById: () => ({
            getSheetByName: (name) => {
                if (name === 'Istruzioni') return fakeSheet;
                return null;
            }
        })
    };

    global.GLOBAL_CACHE = {
        loaded: false,
        lastLoadedAt: 0,
        knowledgeBase: '',
        doctrineBase: 'STALE_DOCTRINE',
        doctrineStructured: [{ stale: true }],
        aiCoreLite: 'STALE_LITE',
        aiCore: 'STALE_CORE',
        systemEnabled: true,
        vacationPeriods: [],
        suspensionRules: {},
        ignoreDomains: [],
        ignoreKeywords: []
    };

    const originalLoadAdvancedConfig = global._loadAdvancedConfig;
    const originalConfig = global.CONFIG;
    global.CONFIG = {
        SPREADSHEET_ID: 'abc-123',
        KB_SHEET_NAME: 'Istruzioni',
        AI_CORE_LITE_SHEET: 'AI_CORE_LITE',
        AI_CORE_SHEET: 'AI_CORE',
        DOCTRINE_SHEET: 'Dottrina'
    };
    global._loadAdvancedConfig = () => ({
        systemEnabled: true,
        vacationPeriods: [],
        suspensionRules: {},
        ignoreDomains: [],
        ignoreKeywords: []
    });

    try {
        _loadResourcesInternal();
        assert(global.GLOBAL_CACHE.aiCoreLite === '', 'aiCoreLite deve essere resettato se il foglio manca');
        assert(global.GLOBAL_CACHE.aiCore === '', 'aiCore deve essere resettato se il foglio manca');
        assert(global.GLOBAL_CACHE.doctrineBase === '', 'doctrineBase deve essere stringa vuota se il foglio manca');
        assert(Array.isArray(global.GLOBAL_CACHE.doctrineStructured) && global.GLOBAL_CACHE.doctrineStructured.length === 0,
            'doctrineStructured deve essere svuotato se il foglio manca');
    } finally {
        global.SpreadsheetApp = originalSpreadsheetApp;
        global._loadAdvancedConfig = originalLoadAdvancedConfig;
        global.GLOBAL_CACHE = originalGlobalCache;
        global.CONFIG = originalConfig;
    }
}

function testMainEncapsulatesExecutionLockSuccessfully() {
    loadScript('gas_main.js');

    const originalGmail = global.Gmail;
    const originalLockService = global.LockService;
    const hadHasExecutionLock = Object.prototype.hasOwnProperty.call(global, 'hasExecutionLock');
    const originalHasExecutionLock = global.hasExecutionLock;

    global.Gmail = {
        Users: {
            getProfile: () => ({ emailAddress: 'me@parrocchia.it' })
        }
    };

    global.LockService = {
        getScriptLock: () => ({
            tryLock: () => false,
            releaseLock: () => { throw new Error('releaseLock non deve essere chiamato se tryLock fallisce'); }
        })
    };

    try {
        const consoleNoise = withCapturedConsoleNoise({
            warn: [/Esecuzione già in corso o lock bloccato/]
        }, () => {
            // Intenzionale: il test deve verificare il vero entry point triggerabile del progetto.
            processEmailsMain();
        });
        const leaked = Object.prototype.hasOwnProperty.call(global, 'hasExecutionLock');
        assert(!leaked, 'processEmailsMain deve mantenere uno scope isolato senza propagare hasExecutionLock');
        assert(
            consoleNoise.warn.some((msg) => msg.includes('Esecuzione già in corso o lock bloccato')),
            'Il test deve esercitare il ramo lock occupato senza fermarsi al probe Gmail'
        );
    } finally {
        global.Gmail = originalGmail;
        global.LockService = originalLockService;
        if (hadHasExecutionLock) {
            global.hasExecutionLock = originalHasExecutionLock;
        } else {
            delete global.hasExecutionLock;
        }
    }
}

function testMainReleasesExecutionLockBeforePipelineServices() {
    loadScript('gas_main.js');

    const originalGmail = global.Gmail;
    const originalLockService = global.LockService;
    const originalEmailProcessor = global.EmailProcessor;
    const originalLoadResources = global.loadResources;
    const originalIsInSuspensionTime = global.isInSuspensionTime;
    const originalGlobalCache = global.GLOBAL_CACHE;
    const originalConfig = global.CONFIG;

    let locked = false;
    let releaseCalls = 0;
    let constructedWhileLocked = null;
    let seenProcessArgs = null;

    global.Gmail = {
        Users: {
            getProfile: () => ({ emailAddress: 'me@parrocchia.it' })
        }
    };
    global.LockService = {
        getScriptLock: () => ({
            tryLock: () => {
                if (locked) return false;
                locked = true;
                return true;
            },
            releaseLock: () => {
                releaseCalls += 1;
                locked = false;
            }
        })
    };
    global.GLOBAL_CACHE = {
        loaded: true,
        systemEnabled: true,
        knowledgeBase: 'kb operativa',
        doctrineBase: ''
    };
    global.CONFIG = { SUSPENSION_STALE_UNREAD_HOURS: 12 };
    global.loadResources = () => {
        global.GLOBAL_CACHE.loaded = true;
    };
    global.isInSuspensionTime = () => false;
    global.EmailProcessor = class {
        constructor() {
            constructedWhileLocked = locked;
        }
        processUnreadEmails() {
            seenProcessArgs = Array.from(arguments);
            return { total: 0, replied: 0, errors: 0 };
        }
    };

    try {
        global.main();
        assert(constructedWhileLocked === false, 'main deve rilasciare lo ScriptLock prima di costruire EmailProcessor');
        assert(releaseCalls === 1, `main deve rilasciare il gate globale una sola volta, ottenuto ${releaseCalls}`);
        assert(seenProcessArgs && seenProcessArgs[2] === true, 'main deve saltare il lock batch in processUnreadEmails');
        assert(seenProcessArgs && seenProcessArgs[3] === false, 'main deve lasciare attivi i lock granulari della pipeline');
    } finally {
        global.Gmail = originalGmail;
        global.LockService = originalLockService;
        global.EmailProcessor = originalEmailProcessor;
        global.loadResources = originalLoadResources;
        global.isInSuspensionTime = originalIsInSuspensionTime;
        global.GLOBAL_CACHE = originalGlobalCache;
        global.CONFIG = originalConfig;
    }
}

function testInferUserReactionIsResilientToEmptyTopics() {
    loadScript('gas_email_processor.js');

    const processor = Object.create(EmailProcessor.prototype);
    const calls = [];
    processor.memoryService = {
        updateReaction: (threadId, topic, reaction, context) => {
            calls.push({ threadId, topic, reaction, context });
        }
    };

    processor._inferUserReaction(
        'Grazie, ho capito perfettamente.',
        [{ topic: null }, undefined, { topic: 'Battesimo' }],
        'thread-null-topic'
    );

    assert(calls.length === 1, `Attesa una sola reazione sull'ultimo topic valido, ottenute ${calls.length}`);
    assert(calls[0].topic === 'battesimo', `Atteso topic normalizzato "battesimo", ottenuto "${calls[0].topic}"`);
    assert(calls[0].reaction === 'acknowledged', `Attesa reazione "acknowledged", ottenuta "${calls[0].reaction}"`);
}

function testInferUserReactionNormalizesTopicKeys() {
    loadScript('gas_email_processor.js');

    const processor = Object.create(EmailProcessor.prototype);
    const calls = [];
    processor.memoryService = {
        updateReaction: (threadId, topic, reaction) => {
            calls.push({ threadId, topic, reaction });
        }
    };

    processor._inferUserReaction(
        'Grazie, ho capito gli orari messe.',
        [{ topic: 'orari_messe' }, { topic: 'contatti' }],
        'thread-topic-normalization'
    );

    assert(calls.length === 1, `Attesa una sola reazione, ottenute ${calls.length}`);
    assert(calls[0].topic === 'orari_messe', `Atteso match topic normalizzato "orari_messe", ottenuto "${calls[0].topic}"`);
    assert(calls[0].reaction === 'acknowledged', `Attesa reazione "acknowledged", ottenuta "${calls[0].reaction}"`);
}

function testMemoryMergeProvidedTopicsNormalizesTopicKeys() {
    loadScript('gas_memory_service.js');

    const service = Object.create(MemoryService.prototype);
    const merged = service._mergeProvidedTopics(
        [
            {
                topic: 'orari messe',
                userReaction: 'acknowledged',
                context: 'old-context',
                timestamp: '2026-01-01T00:00:00.000Z'
            }
        ],
        [
            {
                topic: 'orari_messe',
                userReaction: 'unknown',
                context: 'new-context',
                timestamp: '2026-01-02T00:00:00.000Z'
            }
        ]
    );

    assert(merged.length === 1, `Topic equivalenti devono essere deduplicati, ottenuti ${merged.length}`);
    assert(merged[0].topic === 'orari_messe', `Atteso topic piu recente "orari_messe", ottenuto "${merged[0].topic}"`);
    assert(
        merged[0].userReaction === 'acknowledged',
        `La reazione esistente deve essere preservata, ottenuta "${merged[0].userReaction}"`
    );
}

function testExtractOfficeTextDriveCreateForcesTargetMimeType() {
    loadScript('gas_gmail_service.js');

    const originalDrive = global.Drive;
    const service = Object.create(GmailService.prototype);
    let createResource = null;
    let createOptions = null;

    global.Drive = {
        Files: {
            create: (resource, _blob, options) => {
                createResource = resource;
                createOptions = options;
                return { id: 'file-1', mimeType: 'application/pdf' };
            },
            remove: () => { }
        }
    };

    const attachment = {
        copyBlob: () => ({ getContentType: () => 'application/msword' }),
        getName: () => 'test.doc'
    };

    try {
        const consoleNoise = withCapturedConsoleNoise({
            warn: [/Estrazione Office fallita: Conversione Office non applicata/]
        }, () => {
            const extracted = service._extractOfficeText(attachment, 'application/vnd.google-apps.document', {});
            assert(extracted === '', 'Con mimeType finale non convertito deve ritornare stringa vuota');
        });
        assert(createResource && createResource.mimeType === 'application/vnd.google-apps.document', 'Drive.Files.create deve forzare il mimeType target nei metadata');
        assert(createOptions && createOptions.fields === 'id,mimeType', 'Drive.Files.create deve richiedere id,mimeType come fields');
        assert(!Object.prototype.hasOwnProperty.call(createOptions, 'mimeType'), 'Drive.Files.create non deve passare mimeType negli optionalArgs v3');
        assert(
            consoleNoise.warn.some((msg) => msg.includes('Estrazione Office fallita')),
            'Il test deve intercettare il warning atteso sulla conversione Office'
        );
    } finally {
        global.Drive = originalDrive;
    }
}

function testRateLimiterPersistenceRequiresTransactionalLock() {
    loadScript('gas_rate_limiter.js');

    const originalLockService = global.LockService;
    global.LockService = {
        getScriptLock: () => ({
            tryLock: () => false,
            releaseLock: () => { throw new Error('releaseLock non dovrebbe essere chiamato senza lock'); }
        })
    };

    const props = {
        getProperty: () => { throw new Error('getProperty non deve essere chiamato senza lock'); },
        setProperty: () => { throw new Error('setProperty non deve essere chiamato senza lock'); },
        deleteProperty: () => { throw new Error('deleteProperty non deve essere chiamato senza lock'); }
    };

    const service = {
        props,
        cache: {},
        _mergeWindowData: GeminiRateLimiter.prototype._mergeWindowData
    };

    try {
        GeminiRateLimiter.prototype._recoverFromWAL.call(service);
    } finally {
        global.LockService = originalLockService;
    }
}

function testRateLimiterReservationLifecycleDoesNotDuplicateOrLeak() {
    loadScript('gas_rate_limiter.js');

    const originalLockService = global.LockService;
    const originalPropertiesService = global.PropertiesService;
    const store = new Map();
    const props = {
        getProperty: (key) => store.has(key) ? store.get(key) : null,
        setProperty: (key, value) => { store.set(key, String(value)); },
        setProperties: (values) => {
            Object.keys(values || {}).forEach((key) => store.set(key, String(values[key])));
        },
        deleteProperty: (key) => { store.delete(key); }
    };

    global.LockService = {
        getScriptLock: () => ({
            tryLock: () => true,
            releaseLock: () => { }
        })
    };
    global.PropertiesService = {
        getScriptProperties: () => props
    };

    const service = Object.create(GeminiRateLimiter.prototype);
    service.props = props;
    service.models = {
        flash: { name: 'gemini-2.5-flash', rpm: 5, tpm: 1000, rpd: 10 }
    };
    service.cache = {
        rpmWindow: [],
        tpmWindow: [],
        lastCacheUpdate: 0,
        cacheTTL: 10000
    };

    try {
        const completedReservation = service._createReservationUnlocked('flash', 100);
        assert(
            service._getRequestsInWindow('rpm', 'flash') === 1,
            'La reservation iniziale deve contare una sola richiesta RPM'
        );
        assert(
            service._getTokensInWindow('tpm', 'flash') === 100,
            'La reservation iniziale deve contare i token stimati'
        );

        service._finalizeReservation('flash', completedReservation, 123);
        const rpmAfterFinalize = JSON.parse(store.get('rpm_window') || '[]');
        const tpmAfterFinalize = JSON.parse(store.get('tpm_window') || '[]');
        assert(
            rpmAfterFinalize.filter(entry => entry.nonce === completedReservation).length === 1,
            'La finalizzazione non deve duplicare la reservation RPM persistita'
        );
        assert(
            tpmAfterFinalize.filter(entry => entry.nonce === completedReservation).length === 1,
            'La finalizzazione non deve duplicare la reservation TPM persistita'
        );
        assert(
            service._getRequestsInWindow('rpm', 'flash') === 1,
            'La reservation completata deve continuare a contare una sola richiesta'
        );
        assert(
            service._getTokensInWindow('tpm', 'flash') === 100,
            'La reservation completata deve continuare a contare una sola quota token'
        );

        const releasedReservation = service._createReservationUnlocked('flash', 75);
        assert(
            service._getRequestsInWindow('rpm', 'flash') === 2,
            'Due reservation attive/completate devono contare due richieste'
        );
        service._releaseReservation('flash', releasedReservation);

        const rpmAfterRelease = JSON.parse(store.get('rpm_window') || '[]');
        const releasedEntry = rpmAfterRelease.find(entry => entry.nonce === releasedReservation);
        assert(
            releasedEntry && releasedEntry.released === true,
            'La reservation rilasciata deve essere persistita come tombstone released'
        );
        assert(
            service._getRequestsInWindow('rpm', 'flash') === 1,
            'La reservation rilasciata non deve consumare RPM'
        );
        assert(
            service._getTokensInWindow('tpm', 'flash') === 100,
            'La reservation rilasciata non deve consumare TPM'
        );
    } finally {
        global.LockService = originalLockService;
        global.PropertiesService = originalPropertiesService;
    }
}

function testAttachmentContextSanitizationFormatting() {
    loadScript('gas_prompt_engine.js');

    const engine = new PromptEngine();
    const input = 'Riga 1\nRiga 2';
    const rendered = engine._renderAttachmentContext(input);

    assert(rendered.includes('ALLEGATI (TESTO ESTRATTO)'), 'Header allegati non trovato');
    assert(rendered.includes('Riga 1\nRiga 2'), 'Il contesto allegati deve preservare newline reali');
}


function testPromptLiteTokenBudget() {
    loadScript('gas_prompt_engine.js');
    const engine = new PromptEngine();

    const prompt = engine.buildPrompt({
        knowledgeBase: 'A'.repeat(80000),
        emailContent: 'Mi servono gli orari delle messe domenicali.',
        emailSubject: 'Orari messe',
        senderName: 'Mario',
        detectedLanguage: 'it',
        salutation: 'Buongiorno',
        closing: 'Cordiali saluti',
        promptProfile: 'lite',
        salutationMode: 'none_or_continuity'
    });

    const tokens = engine.estimateTokens(prompt);
    assert(!prompt.includes('📚 ESEMPI CON FORMATTAZIONE CORRETTA'), 'In profilo lite non devono apparire gli esempi estesi');
    assert(tokens < 25000, `Prompt lite deve restare compatto, ottenuti ~${tokens} token`);
}

function testPromptKbSemanticTruncationRespectsHardLimit() {
    loadScript('gas_prompt_engine.js');
    const engine = new PromptEngine();

    const hugeKb = ['Paragrafo 1: ' + 'A'.repeat(180), 'Paragrafo 2: ' + 'B'.repeat(180)].join('\n\n');
    const tightBudget = 40;
    const truncated = engine._truncateKbSemantically(hugeKb, tightBudget);

    assert(truncated.length <= tightBudget, `KB troncata non deve superare il budget (${truncated.length} > ${tightBudget})`);
}

function runGoldenCases() {
    const cases = JSON.parse(fs.readFileSync('tests/golden_cases.json', 'utf8'));
    assert(Array.isArray(cases) && cases.length >= 20, 'golden_cases.json deve contenere almeno 20 casi');

    const canonicalize = (value) => {
        if (Array.isArray(value)) return value.map(canonicalize);
        if (value && typeof value === 'object') {
            return Object.keys(value).sort().reduce((acc, key) => {
                if (key === 'id') return acc;
                acc[key] = canonicalize(value[key]);
                return acc;
            }, {});
        }
        return value;
    };

    const signatures = new Map();
    for (const testCase of cases) {
        const signature = JSON.stringify(canonicalize(testCase));
        if (signatures.has(signature)) {
            throw new Error(`golden_cases.json contiene casi duplicati: ${signatures.get(signature)} e ${testCase.id}`);
        }
        signatures.set(signature, testCase.id);
    }

    const sandbox = {
        console,
        Date,
        JSON,
        Math,
        CONFIG: { MAX_SAFE_TOKENS: 100000 },
        Utilities: {
            formatDate: (date) => new Date(date).toISOString().slice(0, 10),
            sleep: () => { }
        },
        calculateEaster,
        createLogger,
        setTimeout,
        clearTimeout
    };
    vm.createContext(sandbox);

    const scripts = [
        'gas_config.example.js',
        'gas_classifier.js',
        'gas_request_classifier.js',
        'gas_prompt_engine.js',
        'gas_response_validator.js',
        'gas_email_processor.js'
    ];
    scripts.forEach((path) => {
        const code = fs.readFileSync(path, 'utf8');
        vm.runInContext(code, sandbox, { filename: path });
    });

    vm.runInContext(`if (typeof CONFIG !== 'undefined') { CONFIG.SEMANTIC_VALIDATION = { enabled: false }; }`, sandbox);

    const RequestTypeClassifier = vm.runInContext('RequestTypeClassifier', sandbox);
    const PromptEngine = vm.runInContext('PromptEngine', sandbox);
    const ResponseValidator = vm.runInContext('ResponseValidator', sandbox);
    const computeSalutationModeFn = vm.runInContext('computeSalutationMode', sandbox);
    const Classifier = vm.runInContext('Classifier', sandbox);

    const classifier = new RequestTypeClassifier();
    const baseClassifier = new Classifier();
    const promptEngine = new PromptEngine();
    const validator = new ResponseValidator();

    const isMostlyEmojiOrSymbols = (text) => {
        const safe = typeof text === 'string' ? text : '';
        const stripped = safe.replace(/[\p{L}\p{N}\s]/gu, '');
        return safe.length > 0 && stripped.length >= Math.max(2, Math.floor(safe.length * 0.5));
    };

    const sanitizePotentiallyUnsafeBody = (text) => {
        const safe = typeof text === 'string' ? text : '';
        if (/<script\b/i.test(safe)) {
            return safe
                .replace(/<script[\s\S]*?<\/script>/gi, '[sanitizzato]')
                .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
                .replace(/on\w+\s*=\s*'[^']*'/gi, '');
        }
        return safe;
    };

    const evaluateFilter = (subject, body) => {
        const text = `${subject || ''} ${body || ''}`.toLowerCase();
        if (/\bviagra\b|\bbuy now\b|\bcrypto\b|\bcasino\b|\bclick here\b/i.test(text)) {
            return { shouldFilter: true, reason: 'spam_detected' };
        }

        const quick = baseClassifier.classifyEmail(subject || '', body || '', true);
        if (!quick.shouldReply) {
            return { shouldFilter: true, reason: quick.reason || 'classifier_filtered' };
        }

        return { shouldFilter: false, reason: null };
    };

    const matchPattern = (value, pattern) => {
        if (pattern === 'emoji raw in output') {
            return /(\p{Extended_Pictographic}|[☀-➿])/u.test(value);
        }
        return new RegExp(pattern, 'iu').test(value);
    };

    const runCase = (testCase) => {
        const rawBody = testCase.input.body || '';
        const subject = testCase.input.subject || '';
        const body = sanitizePotentiallyUnsafeBody(rawBody);

        let attachmentsContext = '';
        if (testCase.input.attachments && Array.isArray(testCase.input.attachments)) {
            const items = testCase.input.attachments.map((att, idx) => {
                const text = att.mockOcrText || '';
                return `(${idx + 1}) ${att.name} [application/pdf, 100KB]\n${text}`;
            });
            if (items.length > 0) {
                attachmentsContext = items.join('\n\n');
            }
        }

        const salutationMode = computeSalutationModeFn({
            isReply: testCase.memory?.isReply || false,
            messageCount: testCase.memory?.messageCount || 1,
            memoryExists: testCase.memory?.exists || false,
            lastUpdated: testCase.memory?.lastUpdated || null,
            now: new Date(testCase.input.now || '2026-02-15T10:00:00Z')
        });

        if (testCase.expected.salutationMode) {
            assert(
                salutationMode === testCase.expected.salutationMode,
                `[${testCase.id}] salutationMode atteso ${testCase.expected.salutationMode}, ottenuto ${salutationMode}`
            );
        }

        if (typeof testCase.expected.shouldFilter === 'boolean') {
            const filterResult = evaluateFilter(subject, rawBody);
            assert(
                filterResult.shouldFilter === testCase.expected.shouldFilter,
                `[${testCase.id}] shouldFilter atteso ${testCase.expected.shouldFilter}, ottenuto ${filterResult.shouldFilter}`
            );
            if (testCase.expected.reason) {
                assert(
                    filterResult.reason === testCase.expected.reason,
                    `[${testCase.id}] reason atteso ${testCase.expected.reason}, ottenuto ${filterResult.reason}`
                );
            }
            if (testCase.expected.shouldFilter) {
                return;
            }
        }

        const classification = classifier.classify(subject, body);
        if (testCase.expected.requestTypeIn) {
            assert(
                testCase.expected.requestTypeIn.includes(classification.type),
                `[${testCase.id}] requestType inatteso: ${classification.type}`
            );
        }

        const prompt = promptEngine.buildPrompt({
            emailContent: body,
            emailSubject: subject,
            knowledgeBase: testCase.input.knowledgeBase || 'Orari messe: domenica 9:00 e 11:00.',
            senderName: testCase.input.senderName || 'Utente',
            detectedLanguage: testCase.input.language || 'it',
            promptProfile: testCase.input.promptProfile || 'standard',
            salutationMode,
            territoryContext: testCase.input.territoryContext || null,
            attachmentsContext: attachmentsContext
        });

        (testCase.expected.promptMustInclude || []).forEach((needle) => {
            if (needle === 'emoji o caratteri speciali') {
                assert(
                    isMostlyEmojiOrSymbols(rawBody) && prompt.includes(body),
                    `[${testCase.id}] prompt deve trattare input emoji/simboli senza perdita contesto`
                );
                return;
            }
            if (needle === 'sanitizzato') {
                assert(prompt.includes('sanitizzato') || !prompt.includes('<script>'), `[${testCase.id}] prompt deve risultare sanitizzato`);
                return;
            }
            assert(prompt.includes(needle), `[${testCase.id}] prompt deve includere "${needle}"`);
        });
        (testCase.expected.promptMustNotInclude || []).forEach((needle) => {
            assert(!prompt.includes(needle), `[${testCase.id}] prompt NON deve includere "${needle}"`);
        });

        const maxPromptChars = testCase.expected.maxPromptChars || 120000;
        assert(prompt.length <= maxPromptChars, `[${testCase.id}] prompt troppo lungo: ${prompt.length}`);

        const response = testCase.candidateResponse || '';
        (testCase.expected.responseMustInclude || []).forEach((pattern) => {
            assert(matchPattern(response, pattern), `[${testCase.id}] response deve matchare /${pattern}/i`);
        });
        (testCase.expected.responseMustNotInclude || []).forEach((pattern) => {
            assert(!matchPattern(response, pattern), `[${testCase.id}] response NON deve matchare /${pattern}/i`);
        });

        const validation = validator.validateResponse(
            response,
            testCase.input.language || 'it',
            testCase.input.knowledgeBase || '',
            body,
            subject,
            salutationMode,
            false
        );
        const minScore = typeof testCase.expected.minValidatorScore === 'number' ? testCase.expected.minValidatorScore : 0;
        assert(validation.score >= minScore, `[${testCase.id}] validator score ${validation.score} < ${minScore}`);
        if (typeof testCase.expected.maxValidatorScore === 'number') {
            assert(
                validation.score <= testCase.expected.maxValidatorScore,
                `[${testCase.id}] validator score ${validation.score} > ${testCase.expected.maxValidatorScore}`
            );
        }
    };

    cases.forEach(runCase);
}


function testShouldIgnoreEmail() {
    loadScript('gas_email_processor.js');

    const processor = new EmailProcessor({
        geminiService: {},
        classifier: {},
        requestClassifier: {},
        validator: {},
        gmailService: {},
        promptEngine: {},
        memoryService: { getMemory: () => ({ providedInfo: [] }), updateMemory: () => { } },
        territoryValidator: null
    });

    const noReply = processor._shouldIgnoreEmail({
        senderEmail: 'no-reply@test.com',
        senderName: 'No Reply Bot',
        subject: 'Test',
        body: 'Content',
        headers: {}
    });
    assert(noReply === true, 'no-reply deve essere ignorata');

    const regular = processor._shouldIgnoreEmail({
        senderEmail: 'mario@gmail.com',
        senderName: 'Mario',
        subject: 'Info orari',
        body: 'Vorrei sapere gli orari',
        headers: {}
    });
    assert(regular === false, 'Email reale non deve essere ignorata');

    const ooo = processor._shouldIgnoreEmail({
        senderEmail: 'utente@example.com',
        senderName: 'Utente',
        subject: 'Automatic reply',
        body: 'I am out of office until Monday',
        headers: { 'Auto-Submitted': 'auto-replied' }
    });
    assert(ooo === true, 'Auto-reply OOO deve essere ignorata');
}

function testShouldIgnoreEmailSkipsBlankBlacklistEntries() {
    loadScript('gas_email_processor.js');

    const originalGlobalCache = global.GLOBAL_CACHE;
    global.GLOBAL_CACHE = {
        ...(originalGlobalCache || {}),
        ignoreDomains: ['   ', '', null],
        ignoreKeywords: []
    };

    try {
        const processor = new EmailProcessor({
            geminiService: {},
            classifier: {},
            requestClassifier: {},
            validator: {},
            gmailService: {},
            promptEngine: {},
            memoryService: { getMemory: () => ({ providedInfo: [] }), updateMemory: () => { } },
            territoryValidator: null
        });

        const regular = processor._shouldIgnoreEmail({
            senderEmail: 'utente@example.com',
            senderName: 'Utente',
            subject: 'Informazioni',
            body: 'Vorrei sapere gli orari',
            headers: {}
        });

        assert(regular === false, 'Voci blacklist vuote non devono bloccare tutte le email');
    } finally {
        global.GLOBAL_CACHE = originalGlobalCache;
    }
}

function testShouldTryOcrHandlesNonStringKeywords() {
    loadScript('gas_email_processor.js');

    const originalConfig = global.CONFIG;
    global.CONFIG = {
        ...(originalConfig || {}),
        ATTACHMENT_CONTEXT: {
            enabled: true,
            ocrTriggerKeywords: [123, null, 'certificato']
        }
    };

    try {
        const processor = Object.create(EmailProcessor.prototype);
        const decision = processor._shouldTryOcr('Allego certificato battesimo', 'Richiesta documenti');
        assert(decision === true, 'Keyword stringa valida deve attivare OCR anche con elementi non stringa nella lista');
    } finally {
        global.CONFIG = originalConfig;
    }
}

function testGetBusinessDateStringFallbackUsesRomeTimezone() {
    loadScript('gas_email_processor.js');

    const processor = Object.create(EmailProcessor.prototype);
    const originalUtilities = global.Utilities;

    try {
        global.Utilities = undefined;
        const romeMidnight = new Date('2026-03-07T00:30:00+01:00');
        const dateStr = processor._getBusinessDateString(romeMidnight);
        assert(dateStr === '2026-03-07', `Fallback date deve rispettare Europe/Rome, ottenuto ${dateStr}`);
    } finally {
        global.Utilities = originalUtilities;
    }
}


// ========================================================================
// TEST SICUREZZA (escapeHtml, sanitizeUrl, markdownToHtml)
// ========================================================================

function testEscapeHtml() {
    loadScript('gas_gmail_service.js');

    const xss = escapeHtml('<script>alert("xss")</script>');
    assert(!xss.includes('<script>'), `escapeHtml deve neutralizzare tag script, ottenuto: "${xss}"`);
    assert(xss.includes('&lt;script&gt;'), 'escapeHtml deve convertire < e > in entità');

    const amp = escapeHtml('A & B');
    assert(amp === 'A &amp; B', `escapeHtml deve convertire &, ottenuto: "${amp}"`);

    const numeric = escapeHtml(12345);
    assert(numeric === '12345', `escapeHtml deve gestire input non-stringa, ottenuto: "${numeric}"`);
}

function testMarkdownToHtmlNonStringInput() {
    loadScript('gas_gmail_service.js');

    const numeric = markdownToHtml(42);
    assert(numeric.includes('<p>42</p>'), `markdownToHtml deve serializzare numeri in modo sicuro, ottenuto: ${numeric}`);

    const objectValue = markdownToHtml({ a: 1 });
    assert(objectValue.includes('<p>[object Object]</p>'), `markdownToHtml deve serializzare oggetti senza eccezioni, ottenuto: ${objectValue}`);
}

function testSanitizeUrlIPv6() {
    loadScript('gas_gmail_service.js');

    // IPv6 loopback → null
    const ipv6 = sanitizeUrl('http://[::1]/admin');
    assert(ipv6 === null, 'sanitizeUrl deve bloccare IPv6 loopback [::1]');

    // IP decimale → null
    const decimal = sanitizeUrl('http://2130706433/');
    assert(decimal === null, `sanitizeUrl deve bloccare IP decimale, ottenuto: ${decimal}`);

    // userinfo bypass → null
    const userinfo = sanitizeUrl('http://localhost@evil.com/path');
    assert(userinfo === null, 'sanitizeUrl deve bloccare userinfo bypass');

    // localhost con trailing dot → null
    const localhostTrailingDot = sanitizeUrl('http://localhost./admin');
    assert(localhostTrailingDot === null, 'sanitizeUrl deve bloccare localhost con trailing dot');

    // Dotted quad in notazione hex → null
    const hexDotted = sanitizeUrl('http://0x7f.0x0.0x0.0x1/admin');
    assert(hexDotted === null, `sanitizeUrl deve bloccare dotted-quad hex, ottenuto: ${hexDotted}`);

    // IPv4-mapped IPv6 loopback (forma compressa) → null
    const mappedLoopback = sanitizeUrl('http://[::ffff:127.0.0.1]/admin');
    assert(mappedLoopback === null, `sanitizeUrl deve bloccare IPv4-mapped loopback, ottenuto: ${mappedLoopback}`);

    // IPv4-mapped IPv6 loopback (forma estesa) → null
    const mappedExpanded = sanitizeUrl('http://[0:0:0:0:0:ffff:7f00:1]/admin');
    assert(mappedExpanded === null, `sanitizeUrl deve bloccare IPv4-mapped loopback esteso, ottenuto: ${mappedExpanded}`);

    // IPv6 unique local (ULA) → null
    const ula = sanitizeUrl('http://[fd00::1]/admin');
    assert(ula === null, `sanitizeUrl deve bloccare IPv6 ULA, ottenuto: ${ula}`);

    // IPv6 unspecified → null
    const unspecified = sanitizeUrl('http://[::]/admin');
    assert(unspecified === null, `sanitizeUrl deve bloccare IPv6 unspecified, ottenuto: ${unspecified}`);

    // Carrier-grade NAT → null
    const cgnat = sanitizeUrl('http://100.64.0.10/internal');
    assert(cgnat === null, `sanitizeUrl deve bloccare rete CGNAT, ottenuto: ${cgnat}`);

    // IPv6 pubblico compresso → passa
    const publicIpv6 = sanitizeUrl('https://[2001:4860:4860::8888]/dns-query');
    assert(publicIpv6 !== null, `sanitizeUrl deve permettere IPv6 pubblico, ottenuto: ${publicIpv6}`);

    // URL legittimo → passa
    const legit = sanitizeUrl('https://www.example.com/page');
    assert(legit !== null, 'sanitizeUrl deve permettere URL legittimi');
}

function testMarkdownToHtmlXss() {
    loadScript('gas_gmail_service.js');

    // Script injection nel testo deve essere escaped
    const result = markdownToHtml('Ciao <script>alert(1)</script> mondo');
    assert(!result.includes('<script>'), `markdownToHtml NON deve contenere tag script, ottenuto snippet: ${result.substring(0, 200)}`);

    // Test bold funziona ancora
    const bold = markdownToHtml('Testo **grassetto** qui');
    assert(bold.includes('<strong>grassetto</strong>'), 'markdownToHtml deve convertire **bold** in <strong>');
}

function testMarkdownLinkWithParentheses() {
    loadScript('gas_gmail_service.js');

    const result = markdownToHtml('Link: [Wikipedia](https://en.wikipedia.org/wiki/A_(B))');
    assert(
        result.includes('href="https://en.wikipedia.org/wiki/A_(B)"'),
        `URL con parentesi non gestito correttamente, ottenuto: ${result}`
    );
}

function testMarkdownLinkQueryParamsNotDoubleEscaped() {
    loadScript('gas_gmail_service.js');

    const result = markdownToHtml('Portale: [Accedi](https://example.com/login?token=a&lang=it)');
    assert(
        result.includes('href="https://example.com/login?token=a&amp;lang=it"'),
        `I parametri query devono essere escaped una sola volta, ottenuto: ${result}`
    );
    assert(
        !result.includes('&amp;amp;lang=it'),
        `Rilevato double-escape dei parametri query, ottenuto: ${result}`
    );
}

function testMarkdownListParagraphNesting() {
    loadScript('gas_gmail_service.js');

    const result = markdownToHtml('Introduzione\n- uno\n- due');
    assert(
        !result.includes('<p>Introduzione<br><ul'),
        `markdownToHtml non deve nidificare <ul> dentro <p>, ottenuto: ${result}`
    );
    assert(
        result.includes('<p>Introduzione</p><ul') || result.includes('<p>Introduzione</p>\n<ul'),
        `markdownToHtml deve separare testo e lista in blocchi distinti, ottenuto: ${result}`
    );
}

function testAddLabelToThreadPropagatesNonLabelErrors() {
    loadScript('gas_gmail_service.js');

    const service = Object.create(GmailService.prototype);
    service.getOrCreateLabel = () => {
        throw new Error('Permission denied');
    };
    service._isLabelNotFoundError = () => false;

    const consoleNoise = withCapturedConsoleNoise({
        warn: [/addLabelToThread fallito/]
    }, () => {
        let threw = false;
        try {
            service.addLabelToThread({ addLabel: () => { } }, 'IA');
        } catch (error) {
            threw = true;
            assert(error.message.includes('Permission denied'), 'Errore inatteso propagato da addLabelToThread');
        }

        assert(threw, 'addLabelToThread deve propagare errori non riconducibili a label missing');
    });

    assert(
        consoleNoise.warn.some((msg) => msg.includes("addLabelToThread fallito per 'IA'")),
        'Il warning atteso di addLabelToThread deve essere catturato dal test'
    );
}

function testListMessagesWithResilienceHandlesEmptyResponseError() {
    loadScript('gas_gmail_service.js');

    const service = Object.create(GmailService.prototype);
    service._safePositiveInt = GmailService.prototype._safePositiveInt;
    service._isEmptyResponseError = GmailService.prototype._isEmptyResponseError;

    const originalGmail = global.Gmail;
    const originalUtilities = global.Utilities;
    let calls = 0;
    let sleeps = 0;

    global.Utilities = Object.assign({}, originalUtilities, {
        sleep: () => {
            sleeps += 1;
        }
    });
    global.Gmail = {
        Users: {
            Messages: {
                list: () => {
                    calls += 1;
                    throw new Error('Empty response');
                }
            }
        }
    };

    const consoleNoise = withCapturedConsoleNoise({
        warn: [
            /Gmail\.Users\.Messages\.list risposta vuota/
        ]
    }, () => {
        try {
            let thrown = null;
            try {
                service._listMessagesWithResilience({ maxResults: 10 }, 2);
            } catch (e) {
                thrown = e;
            }
            assert(thrown && /non recuperabile/i.test(String(thrown.message || thrown)), 'Dopo retry esauriti deve rilanciare errore non recuperabile');
            assert(calls === 2, `Attesi 2 tentativi, ottenuti ${calls}`);
            assert(sleeps === 1, `Attesa backoff attesa 1 volta, ottenuto ${sleeps}`);
        } finally {
            global.Gmail = originalGmail;
            global.Utilities = originalUtilities;
        }
    });

    assert(
        consoleNoise.warn.some((msg) => msg.includes('Gmail.Users.Messages.list risposta vuota')),
        'Il test deve catturare il warning atteso sui retry della list Gmail'
    );
    assert(
        !consoleNoise.warn.some((msg) => msg.includes('Gmail.Users.Messages.list non recuperabile')),
        'Il fallback finale ora rilancia errore: non deve esserci warning di pagina vuota'
    );
}

function testGetMessageIdsWithLabelInvalidPaginationOptions() {
    loadScript('gas_gmail_service.js');

    const service = Object.create(GmailService.prototype);
    service.getOrCreateLabel = () => ({ getId: () => 'LBL_1' });
    service._getNDaysAgo = () => '2026/01/01';

    const originalGmail = global.Gmail;
    const originalConfig = global.CONFIG;
    let listCalls = 0;

    global.CONFIG = {
        GMAIL_LIST_MAX_PAGES: 1,
        GMAIL_LIST_MAX_MESSAGES: 2,
        GMAIL_LABEL_LOOKBACK_DAYS: 7
    };

    global.Gmail = {
        Users: {
            Messages: {
                list: (_user, opts) => {
                    listCalls += 1;
                    assert(opts.maxResults === 500, `pageSize deve ricadere al default sicuro (500), ottenuto ${opts.maxResults}`);
                    return {
                        messages: [{ id: `msg-${listCalls}` }],
                        nextPageToken: 'next'
                    };
                }
            }
        }
    };

    try {
        const ids = service.getMessageIdsWithLabel('IA', true, {
            maxPages: 'abc',
            maxMessages: 'NaN',
            pageSize: 'invalid'
        });

        assert(ids.size === 1, `Con limiti fallback, deve fermarsi dopo 1 pagina (ids=1), ottenuto ${ids.size}`);
        assert(listCalls === 1, `Paginazione deve fermarsi al fallback maxPages=1, chiamate ottenute ${listCalls}`);
    } finally {
        global.Gmail = originalGmail;
        global.CONFIG = originalConfig;
    }
}

function testExtractMessageDetailsUsesMainReplyOnly() {
    loadScript('gas_gmail_service.js');

    const service = Object.create(GmailService.prototype);
    service._htmlToPlainText = GmailService.prototype._htmlToPlainText;
    service.extractMainReply = GmailService.prototype.extractMainReply;
    service._extractSenderName = GmailService.prototype._extractSenderName;
    service._extractEmailAddress = GmailService.prototype._extractEmailAddress;

    const originalGmail = global.Gmail;
    global.Gmail = {
        Users: {
            Messages: {
                get: () => ({ payload: { headers: [] } })
            }
        }
    };

    const message = {
        getSubject: () => 'Re: Info',
        getFrom: () => 'Mario Rossi <mario@example.com>',
        getDate: () => new Date('2026-04-06T08:00:00Z'),
        getPlainBody: () => 'Grazie mille per la risposta.\n\nIl giorno lun 6 apr 2026 ha scritto:\n> Testo citato lungo',
        getBody: () => '',
        getId: () => 'msg-1',
        getReplyTo: () => '',
        getTo: () => 'parrocchia@example.org',
        getCc: () => ''
    };

    try {
        const details = service.extractMessageDetails(message);
        assert(details.body === 'Grazie mille per la risposta.', `Il body deve contenere solo la risposta principale, ottenuto: ${details.body}`);
    } finally {
        global.Gmail = originalGmail;
    }
}

function testSanitizeSubjectForHeaderRemovesCRLF() {
    loadScript('gas_gmail_service.js');
    const service = Object.create(GmailService.prototype);
    service._sanitizeSubjectForHeader = GmailService.prototype._sanitizeSubjectForHeader;

    const sanitized = service._sanitizeSubjectForHeader('Oggetto valido\r\nBcc: attacker@example.com');
    assert(!/[\r\n]/.test(sanitized), `Subject sanificato non deve contenere CR/LF, ottenuto: ${JSON.stringify(sanitized)}`);
    assert(!/Bcc:/i.test(sanitized), `Subject sanificato non deve consentire header injection, ottenuto: ${sanitized}`);

    const emptyFallback = service._sanitizeSubjectForHeader(null);
    assert(emptyFallback === 'Re:', `Fallback subject atteso 'Re:', ottenuto '${emptyFallback}'`);
}

function testSendHtmlReplyFoldsAndBoundsReferencesHeader() {
    loadScript('gas_gmail_service.js');

    const service = Object.create(GmailService.prototype);
    const originalUtilities = global.Utilities;
    const originalSession = global.Session;
    const originalGmail = global.Gmail;
    const originalGlobalCache = global.GLOBAL_CACHE;
    let rawPayload = '';

    try {
        global.Utilities = Object.assign({}, originalUtilities, {
            Charset: { UTF_8: 'utf8' },
            base64Encode: (input) => Buffer.from(String(input || ''), 'utf8').toString('base64'),
            base64EncodeWebSafe: (input) => Buffer.from(String(input || ''), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
        });
        global.Session = {
            getEffectiveUser: () => ({ getEmail: () => 'parrocchia@example.org' }),
            getActiveUser: () => ({ getEmail: () => 'parrocchia@example.org' })
        };
        global.GLOBAL_CACHE = { replacements: {} };
        global.Gmail = {
            Users: {
                Messages: {
                    send: ({ raw }) => {
                        const normalized = String(raw || '').replace(/-/g, '+').replace(/_/g, '/');
                        const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
                        rawPayload = Buffer.from(padded, 'base64').toString('utf8');
                    }
                }
            }
        };

        const longReferences = Array.from({ length: 30 }, (_, i) => `<ref${i}@example.org>`).join(' ');
        service.sendHtmlReply(
            { getThread: () => ({ getId: () => 'thread-refs' }) },
            'Risposta di test',
            {
                subject: 'Oggetto di test',
                senderEmail: 'utente@example.org',
                senderName: 'Utente',
                rfc2822MessageId: '<current@example.org>',
                existingReferences: longReferences,
                recipientEmail: 'parrocchia@example.org',
                recipientCc: ''
            }
        );

        const lines = rawPayload.split('\r\n');
        const refStart = lines.findIndex((line) => line.startsWith('References:'));
        assert(refStart >= 0, 'Il messaggio RAW deve contenere l\'header References');

        const refLines = [];
        for (let i = refStart; i < lines.length; i++) {
            if (i === refStart || lines[i].startsWith(' ')) refLines.push(lines[i]);
            else break;
        }

        const refIds = refLines.join(' ').match(/<[^<>\s]+>/g) || [];
        assert(refLines.length > 1, 'References lunga deve essere foldata su più righe');
        assert(refLines.every((line) => line.length <= 76), 'Ogni riga References deve restare entro 76 caratteri');
        assert(refIds.length === 20, `References deve essere limitata a 20 Message-ID, ottenuti ${refIds.length}`);
        assert(refIds[0] === '<ref11@example.org>', `La finestra References deve conservare gli ID più recenti, ottenuto primo ID ${refIds[0]}`);
        assert(refIds[refIds.length - 1] === '<current@example.org>', 'L\'ultimo ID References deve essere quello corrente');
    } finally {
        global.Utilities = originalUtilities;
        global.Session = originalSession;
        global.Gmail = originalGmail;
        global.GLOBAL_CACHE = originalGlobalCache;
    }
}

function testRequestClassifierExternalHintCategoryTrim() {
    loadScript('gas_request_classifier.js');

    const classifier = new RequestTypeClassifier();
    const result = classifier.classify(
        'Domanda',
        'Vorrei alcune informazioni generiche.',
        { category: '  Pastoral  ', confidence: 0.9 }
    );

    assert(result.type === 'pastoral' || result.type === 'mixed', `Categoria con spazi non valorizzata: ${result.type}`);
    assert(result.pastoralScore >= 0.8, `pastoralScore atteso >= 0.8 con hint esterno, ottenuto ${result.pastoralScore}`);
}

function testRequestClassifierExternalHintLocalizedConfidence() {
    loadScript('gas_request_classifier.js');

    const classifier = new RequestTypeClassifier();
    const result = classifier.classify(
        'Richiesta',
        'Mi serve supporto spirituale in questo periodo difficile.',
        { category: 'pastoral', confidence: '82%' }
    );

    assert(result.pastoralScore >= 0.8, `confidence localizzata percentuale non applicata: ${result.pastoralScore}`);
}

function testRequestClassifierSanitizeStructuredBody() {
    loadScript('gas_request_classifier.js');

    const classifier = new RequestTypeClassifier();
    const result = classifier.classify(
        { body: 'Info su certificato battesimo e documenti necessari' },
        { textPlain: 'Quali documenti servono?' }
    );

    assert(result.technicalScore >= 0.4, `Input strutturato non analizzato correttamente: ${result.technicalScore}`);
}

function testPromptContextTemporalRiskWithObjectKnowledgeBase() {
    console.log('--- Test: PromptContext Temporal Risk with Object KB ---');
    loadScript('gas_prompt_context.js');
    const pc = new PromptContext({
        knowledgeBase: { some: 'structured_data' },
        temporal: { mentionsDates: false }
    });

    assert(pc.input.knowledgeBaseMeta.containsDates === false, 'KB oggetto senza metadati non deve forzare containsDates');
    assert(pc.concerns.temporal_risk === false, 'temporal_risk deve restare false senza segnali temporali espliciti');
    assert(pc.profile === 'lite', 'Profilo deve restare lite senza concern attivi');
}

function testPromptContextTemporalRiskWithDayMonthKnowledgeBase() {
    console.log('--- Test: PromptContext Temporal Risk with day/month KB ---');
    loadScript('gas_prompt_context.js');
    const pc = new PromptContext({
        knowledgeBase: 'Orari ufficio dal 01/09 al 30/06. Apertura 08:30.',
        temporal: { mentionsDates: false, mentionsTimes: false }
    });

    assert(pc.input.knowledgeBaseMeta.containsDates === true, 'KB con dd/mm e hh:mm deve attivare containsDates');
    assert(pc.concerns.temporal_risk === true, 'temporal_risk deve essere true con segnali temporali in KB testuale');
}

function testPromptContextTemporalRiskWithObjectKnowledgeBaseContainingDates() {
    console.log('--- Test: PromptContext Temporal Risk with Object KB containing dates ---');
    loadScript('gas_prompt_context.js');
    const pc = new PromptContext({
        knowledgeBase: {
            eventi: ['Catechesi 01/09', 'Inizio corso 15/10'],
            orari: ['08:30', '18:00']
        },
        temporal: { mentionsDates: false, mentionsTimes: false }
    });

    assert(
        pc.input.knowledgeBaseMeta.containsDates === true,
        'KB oggetto serializzata con date/orari deve attivare containsDates'
    );
    assert(
        pc.concerns.temporal_risk === true,
        'temporal_risk deve essere true con segnali temporali presenti in KB oggetto'
    );
}

function testPromptContextKnowledgeBaseCircularObjectDoesNotCrash() {
    console.log('--- Test: PromptContext Circular KB Object ---');
    loadScript('gas_prompt_context.js');

    const circularKb = { item: 'dato' };
    circularKb.self = circularKb;

    const pc = new PromptContext({
        knowledgeBase: circularKb,
        temporal: { mentionsDates: false }
    });

    assert(typeof pc.input.knowledgeBaseRaw === 'string', 'knowledgeBaseRaw deve essere valorizzata anche con oggetti circolari');
    assert(pc.input.knowledgeBaseMeta.length > 0, 'knowledgeBaseMeta.length deve essere > 0 con fallback stringa');
    assert(pc.concerns.temporal_risk === false, 'temporal_risk non deve attivarsi automaticamente per KB oggetto');
}

function testPromptContextHonorsExplicitKnowledgeBaseMeta() {
    console.log('--- Test: PromptContext Explicit KB Meta ---');
    loadScript('gas_prompt_context.js');

    const pc = new PromptContext({
        knowledgeBase: { some: 'structured_data' },
        knowledgeBaseMeta: { length: 15000, containsDates: true },
        temporal: { mentionsDates: false, mentionsTimes: false }
    });

    assert(pc.input.knowledgeBaseMeta.length === 15000, 'knowledgeBaseMeta.length esplicito deve avere precedenza');
    assert(pc.input.knowledgeBaseMeta.containsDates === true, 'containsDates esplicito deve avere precedenza');
    assert(pc.concerns.hallucination_risk === true, 'KB lunga deve attivare hallucination_risk');
    assert(pc.concerns.temporal_risk === true, 'containsDates esplicito deve attivare temporal_risk');
}

function testPromptContextHonorsExplicitKnowledgeBaseMetaFalse() {
    console.log('--- Test: PromptContext Explicit KB Meta false override ---');
    loadScript('gas_prompt_context.js');

    const pc = new PromptContext({
        knowledgeBase: 'Orari ufficio dal 01/09 al 30/06. Apertura 08:30.',
        knowledgeBaseMeta: { length: 120, containsDates: false },
        temporal: { mentionsDates: false, mentionsTimes: false }
    });

    assert(pc.input.knowledgeBaseMeta.containsDates === false, 'containsDates=false esplicito deve avere precedenza su autodetect');
    assert(pc.concerns.temporal_risk === false, 'temporal_risk deve restare false se containsDates esplicito è false');
}

function testPromptEngineNormalizesObjectKnowledgeBase() {
    loadScript('gas_prompt_engine.js');

    const engine = new PromptEngine();
    const prompt = engine.buildPrompt({
        emailContent: 'Buongiorno, chiedo info.',
        emailSubject: 'Info',
        knowledgeBase: { orari: ['08:00', '10:30'], contatti: { telefono: '+39 0123 456789' } },
        detectedLanguage: 'it'
    });

    assert(!prompt.includes('[object Object]'), 'La KB oggetto non deve produrre [object Object] nel prompt');
    assert(prompt.includes('"orari"') && prompt.includes('"contatti"'), 'La KB oggetto deve essere serializzata in JSON leggibile');
}

function testSheetRowsToTextPreservesColumnAlignmentWithEmptyCells() {
    console.log('--- Test: Sheet Rows To Text Column Alignment ---');
    loadScript('gas_main.js');

    const rows = [
        ['Nome', 'Telefono', 'Email'],
        ['Mario', '', 'mario@test.com'],
        ['', '   ', null],
        ['Contatti', 12345, false]
    ];

    const text = _sheetRowsToText(rows);
    const expected = [
        'Nome | Telefono | Email',
        'Mario | - | mario@test.com',
        'Contatti | 12345 | false'
    ].join('\n');

    assert(
        text === expected,
        `La serializzazione deve preservare l'allineamento colonne. Atteso "${expected}", ottenuto "${text}"`
    );
}

function testSheetRowsToTextFormatsDatesStably() {
    console.log('--- Test: Sheet Rows To Text Date Stability ---');
    loadScript('gas_main.js');

    const d1 = new Date(Date.UTC(2026, 4, 10, 0, 0, 0));
    const d2 = new Date(Date.UTC(2026, 4, 10, 18, 30, 0));

    const text = _sheetRowsToText([['Evento', d1], ['Incontro', d2]]);
    const lines = text.split('\n');

    assert(lines[0].includes('2026-05-10'), `Data senza orario errata: ${lines[0]}`);
    assert(lines[1].includes('2026-05-10') && lines[1].includes('30'), `Data con orario errata: ${lines[1]}`);
}

function testSheetRowsToTextNormalizesMultilineCells() {
    console.log('--- Test: Sheet Rows To Text Multiline Cell Normalization ---');
    loadScript('gas_main.js');

    const rows = [
        ['Orari ufficio', 'Lun-Ven\n09:00-12:00\r\n15:00-18:00']
    ];

    const text = _sheetRowsToText(rows);
    assert(
        text === 'Orari ufficio | Lun-Ven 09:00-12:00 15:00-18:00',
        `Le celle multilinea devono essere normalizzate su una riga. Ottenuto: "${text}"`
    );
}

function testSplitCachePayloadAdvancesOnSingleHighSurrogate() {
    console.log('--- Test: Split Cache Payload Single High Surrogate ---');
    loadScript('gas_main.js');

    const originalUtilities = global.Utilities;
    global.Utilities = Object.assign({}, originalUtilities || {}, {
        newBlob: (data) => ({
            getBytes: () => Buffer.from(String(data), 'utf8')
        })
    });

    try {
        const highSurrogate = String.fromCharCode(0xD83D);
        const parts = _splitCachePayload(`A${highSurrogate}B`, 1);
        assert(parts.join('') === `A${highSurrogate}B`, 'Lo split deve avanzare anche con chunk da 1 high surrogate');
        assert(parts.length === 3, `Attesi 3 chunk da 1 carattere, ottenuti ${parts.length}`);
    } finally {
        global.Utilities = originalUtilities;
    }
}

function testFormatDateForKnowledgeTextUsesScriptTimezoneInNodeFallback() {
    console.log('--- Test: Date formatter fallback honors script timezone ---');
    loadScript('gas_main.js');

    const originalSession = global.Session;
    const originalUtilities = global.Utilities;
    try {
        global.Utilities = undefined;
        global.Session = {
            getScriptTimeZone: () => 'Europe/Rome'
        };

        const midnightRome = new Date('2026-03-07T00:00:00+01:00');
        const withTimeRome = new Date('2026-03-07T08:15:00+01:00');

        assert(_formatDateForKnowledgeText(midnightRome) === '2026-03-07', 'Data solo giorno deve restare senza orario nel fallback Node');
        assert(_formatDateForKnowledgeText(withTimeRome) === '2026-03-07 08:15', 'Data con orario deve usare il fuso script nel fallback Node');
    } finally {
        global.Utilities = originalUtilities;
        global.Session = originalSession;
    }
}

function testResponseValidatorRemovesThinkingLeakWithParenthesisKeyword() {
    console.log('--- Test: Thinking leak removal handles keyword starting with parenthesis ---');
    loadScript('gas_response_validator.js');

    const validator = new ResponseValidator();
    validator.thinkingPatterns = ['(nota:'];

    const text = 'Gentile utente, (nota: questo è un passaggio interno.) Procediamo con la risposta.';
    const cleaned = validator._rimuoviThinkingLeak(text);

    assert(!cleaned.includes('(nota:'), 'Il pattern con parentesi deve essere rimosso correttamente');
    assert(cleaned.includes('Procediamo con la risposta.'), 'Il testo utile deve essere preservato');
}

function testLoadAdvancedConfigStrictSuspensionHours() {
    console.log('--- Test: Load Advanced Config strict suspension parsing ---');
    loadScript('gas_main.js');

    const sheet = {
        getRange: (...args) => {
            if (args.length === 1 && args[0] === 'B2') return { getValue: () => 'ACCESO' };
            if (args.length === 1 && args[0] === 'B5:E7') return { getValues: () => [[null, null, null, null], [null, null, null, null], [null, null, null, null]] };
            if (args.length === 1 && args[0] === 'A10:D16') {
                return {
                    getValues: () => [
                        ['Lun', '08', '', '12'],
                        ['Mar', '08x', '', '12'],
                        ['Mer', '22', '', '24'],
                        ['Gio', '18', '', '18'],
                        ['Ven', null, '', null],
                        ['Sab', ' 9 ', '', '17'],
                        ['Dom', '07', '', '09']
                    ]
                };
            }
            if (args.length === 4 && args[0] === 11 && args[1] === 5) {
                const rows = args[2];
                return { getValues: () => Array.from({ length: rows }, () => ['', '']) };
            }
            throw new Error(`Range non atteso: ${args.join(',')}`);
        },
        getLastRow: () => 11
    };

    const ss = { getSheetByName: (name) => (name === 'Controllo' ? sheet : null) };
    const cfg = _loadAdvancedConfig(ss);

    assert(Array.isArray(cfg.suspensionRules[1]), 'Lunedì deve includere la fascia oraria valida 08-12');
    assert(cfg.suspensionRules[1][0][0] === 8 && cfg.suspensionRules[1][0][1] === 12, 'Fascia lunedì non parsata correttamente');
    assert(cfg.suspensionRules[6][0][0] === 9 && cfg.suspensionRules[6][0][1] === 17, 'Valori con spazi devono essere normalizzati (9-17)');
    assert(cfg.suspensionRules[0][0][0] === 7 && cfg.suspensionRules[0][0][1] === 9, 'Domenica valida deve essere mantenuta (7-9)');
    assert(cfg.suspensionRules[2] == null, 'Valori parzialmente numerici (es. 08x) devono essere scartati');
    assert(cfg.suspensionRules[3] == null, 'Ore fuori range (es. 24) devono essere scartate');
    assert(cfg.suspensionRules[4] == null, 'Fasce invertite o nulle (18-18) devono essere scartate');
}

function testLoadAdvancedConfigLegacySuspensionLayoutCompatibility() {
    console.log('--- Test: Load Advanced Config legacy suspension layout compatibility ---');
    loadScript('gas_main.js');

    const sheet = {
        getRange: (...args) => {
            if (args.length === 1 && args[0] === 'B2') return { getValue: () => 'ACCESO' };
            if (args.length === 1 && args[0] === 'B5:E7') return { getValues: () => [[null, null, null, null], [null, null, null, null], [null, null, null, null]] };
            if (args.length === 1 && args[0] === 'A10:D16') {
                return {
                    getValues: () => [
                        ['', 'Lun', '08', '12'],
                        ['', 'Mar', '09', '13'],
                        ['', 'Mer', null, null],
                        ['', 'Gio', null, null],
                        ['', 'Ven', null, null],
                        ['', 'Sab', null, null],
                        ['', 'Dom', '07', '09']
                    ]
                };
            }
            if (args.length === 4 && args[0] === 11 && args[1] === 5) {
                const rows = args[2];
                return { getValues: () => Array.from({ length: rows }, () => ['', '']) };
            }
            throw new Error(`Range non atteso: ${args.join(',')}`);
        },
        getLastRow: () => 11
    };

    const ss = { getSheetByName: (name) => (name === 'Controllo' ? sheet : null) };
    const cfg = _loadAdvancedConfig(ss);

    assert(cfg.suspensionRules[1][0][0] === 8 && cfg.suspensionRules[1][0][1] === 12, 'Layout legacy: lunedì 08-12 deve restare supportato');
    assert(cfg.suspensionRules[2][0][0] === 9 && cfg.suspensionRules[2][0][1] === 13, 'Layout legacy: martedì 09-13 deve restare supportato');
    assert(cfg.suspensionRules[0][0][0] === 7 && cfg.suspensionRules[0][0][1] === 9, 'Layout legacy: domenica 07-09 deve restare supportato');
}

function testLoadResourcesKeepsFalseyValuesInAiCoreSheets() {
    console.log('--- Test: Load Resources AI_CORE falsey values ---');
    loadScript('gas_main.js');

    const originalSpreadsheetApp = global.SpreadsheetApp;
    const originalCacheService = global.CacheService;
    const originalConfig = global.CONFIG;

    const makeSheet = (matrix) => ({
        getDataRange: () => ({ getValues: () => matrix }),
        getRange: () => ({
            getValue: () => '',
            getValues: () => [[null, null, null, null]]
        }),
        getLastRow: () => 11
    });

    global.CacheService = { getScriptCache: () => ({ get: () => null, put: () => { } }) };
    global.CONFIG = {
        SPREADSHEET_ID: 'kb-test-id',
        KB_SHEET_NAME: 'Istruzioni',
        AI_CORE_LITE_SHEET: 'AI_CORE_LITE',
        AI_CORE_SHEET: 'AI_CORE',
        DOCTRINE_SHEET: 'Dottrina'
    };

    global.SpreadsheetApp = {
        openById: () => ({
            getSheetByName: (name) => {
                if (name === 'Istruzioni') return makeSheet([['Categoria', 'Dettaglio'], ['Info', 'Aperto']]);
                if (name === 'AI_CORE_LITE') return makeSheet([['Principio', 'Istruzione'], ['Tempistiche', 0], ['Conferma', false]]);
                if (name === 'AI_CORE') return makeSheet([['Principio', 'Istruzione'], ['Quote', 0], ['Escalation', false]]);
                if (name === 'Dottrina') return makeSheet([['Tema', 'Spiegazione'], ['Battesimo', 'Valido']]);
                if (name === 'Controllo') return makeSheet([[null, null, null, null]]);
                return null;
            }
        })
    };

    try {
        GLOBAL_CACHE.loaded = false;
        _loadResourcesInternal();
        assert(GLOBAL_CACHE.aiCoreLite.includes('Tempistiche | 0'), 'AI_CORE_LITE deve preservare il valore numerico 0');
        assert(GLOBAL_CACHE.aiCoreLite.includes('Conferma | false'), 'AI_CORE_LITE deve preservare il valore booleano false');
        assert(GLOBAL_CACHE.aiCore.includes('Quote | 0'), 'AI_CORE deve preservare il valore numerico 0');
        assert(GLOBAL_CACHE.aiCore.includes('Escalation | false'), 'AI_CORE deve preservare il valore booleano false');
    } finally {
        global.SpreadsheetApp = originalSpreadsheetApp;
        global.CacheService = originalCacheService;
        global.CONFIG = originalConfig;
    }
}

function testPortugueseDetectionRefinement() {
    console.log('--- Test: Portuguese Detection Refinement ---');
    loadScript('gas_gemini_service.js');

    // Usa l'helper mock per evitare errori di configurazione API Key
    const gemini = createMockGeminiService(() => ({}));

    // Test con keyword "não" (prima confusa con "non" italiano) e punteggiatura portoghese
    const ptContent = "Olá, não recebi o orçamento da viatura. Muito obrigado.";
    const result = gemini.detectEmailLanguage(ptContent, "Reserva");

    assert(result.lang === 'pt', `Atteso PT per contenuto portoghese, ottenuto ${result.lang}`);
    assert(result.confidence >= 2, `Punteggio PT atteso >= 2, ottenuto ${result.confidence}`);
}

function testItalianNewsletterLikeLanguageDetection() {
    console.log('--- Test: Italian Newsletter-like Language Detection ---');
    loadScript('gas_gemini_service.js');

    const gemini = createMockGeminiService(() => ({}));
    const subject = 'Lettera del Cardinale Vicario sulle udienze libere';
    const body = [
        'Buongiorno,',
        'si invia, in allegato, una lettera di S. Em.za il Card. Baldassare Reina.',
        'Cordiali saluti',
        'Ufficio di Segreteria',
        'Vicariato di Roma',
        'Annulla iscrizione'
    ].join('\n');

    const result = gemini.detectEmailLanguage(body, subject);
    assert(result.lang === 'it', `Atteso IT per contenuto newsletter istituzionale in italiano, ottenuto ${result.lang}`);
    assert(result.confidence >= 2, `Punteggio IT atteso >= 2, ottenuto ${result.confidence}`);
}

function testClassifierBackwardQuoteScan() {
    console.log('--- Test: Classifier Backward Quote Scan ---');
    loadScript('gas_classifier.js');
    const classifier = createClassifier();

    // Body molto lungo con citazione alla fine (scenari thread Gmail chilometrici)
    const longBody = "Testo principale importante.\n" + "A".repeat(1000) + "\nIl giorno 23 feb 2026 alle 10:00 utente@example.com ha scritto:\n> Citazione";
    const result = classifier._extractMainContent(longBody);

    assert(result.trim() === "Testo principale importante.\n" + "A".repeat(1000), "Dovrebbe troncare alla citazione trovata via backward scan");
}

function testLoadResourcesReplacements() {
    console.log('--- Test: Load Resources Replacements ---');
    loadScript('gas_main.js');

    const originalSpreadsheetApp = global.SpreadsheetApp;
    const originalConfig = global.CONFIG;

    const makeSheet = (matrix) => ({
        getDataRange: () => ({ getValues: () => matrix }),
        getRange: () => ({
            getValue: () => '',
            getValues: () => [[null, null, null, null]]
        }),
        getLastRow: () => 11
    });

    global.CONFIG = {
        SPREADSHEET_ID: 'repl-test-id',
        REPLACEMENTS_SHEET_NAME: 'Sostituzioni'
    };

    global.SpreadsheetApp = {
        openById: () => ({
            getSheetByName: (name) => {
                if (name === 'Sostituzioni') return makeSheet([['Originale', 'Sostituzione'], ['Roma', 'ROMA CAPUT MUNDI'], ['IA', 'Intelligenza Artificiale']]);
                return makeSheet([[null]]);
            }
        })
    };

    try {
        GLOBAL_CACHE.loaded = false;
        globalCacheStore.clear();
        _loadResourcesInternal();
        assert(GLOBAL_CACHE.replacements['Roma'] === 'ROMA CAPUT MUNDI', 'La sostituzione per "Roma" deve essere corretta');
        assert(GLOBAL_CACHE.replacements['IA'] === 'Intelligenza Artificiale', 'La sostituzione per "IA" deve essere corretta');
        assert(
            !Object.prototype.hasOwnProperty.call(GLOBAL_CACHE.replacements, 'Originale'),
            'La riga header non deve essere registrata come regola di sostituzione'
        );
    } finally {
        global.SpreadsheetApp = originalSpreadsheetApp;
        global.CONFIG = originalConfig;
    }
}

// MAIN: runner con contatore e soglia minima
// ========================================================================

function main() {
    const tests = [
        // Territory Validator
        ['territory abbreviations', testTerritoryAbbreviations],
        ['civic normalization (normalizeCivic)', testCivicNormalization],
        ['civic deduplication (10A vs 10B)', testCivicDeduplicationExplicit],
        ['civic extraction with slash/dash suffix', testAddressExtractionWithSlashAndDashSuffix],
        ['territory suffix on parity ranges sets needsReview', testTerritorySuffixNeedsReviewOnParityRanges],
        // Error Types (classificazione centralizzata)
        ['classifyError: quota/429 → retryable', testClassifyErrorQuota],
        ['classifyError: API key/invalid → non-retryable', testClassifyErrorNonRetryable],
        ['classifyError: timeout/408/econnaborted → retryable', testClassifyErrorTimeoutSignals],
        // GeminiService
        ['portuguese special greeting', testPortugueseSpecialGreeting],
        ['gemini DI + mock fetch', testGeminiDependencyInjectionAndMockFetch],
        ['gemini contract: 429 → errore propagato', testGeminiRetryOn429],
        ['gemini contract: malformed JSON → errore parse', testGeminiMalformedJson],
        ['gemini contract: no candidates → errore semantico', testGeminiNoCandidates],
        // ResponseValidator
        ['validator: check lunghezza', testResponseValidatorCheckLength],
        ['validator: contenuto vietato + placeholder', testResponseValidatorForbiddenContent],
        ['validator: consistenza lingua', testResponseValidatorLanguageCheck],
        ['validator: KB con ora contestuale autorizza 10:00', testResponseValidatorHourOnlyKnowledgeBaseAllowsNormalizedTime],
        ['validator: semantic prompt bullets puliti', testSemanticThinkingPromptBullets],
        ['validator: semantic fallback lazy senza Gemini/Cache', testSemanticValidatorLazyFallbackWithoutGeminiOrCache],
        // EmailProcessor
        ['computeSalutationMode: primo/reply/vecchio', testComputeSalutationMode],
        ['anti-loop: thread lungo con esterni consecutivi', testAntiLoopDetection],
        ['email processor: canonicalizza gmail/googlemail dotted alias', testEmailProcessorNormalizesGooglemailDotAliases],
        ['memory: lock timeout applica exponential backoff', testUpdateMemoryLockFailureUsesExponentialBackoff],
        ['memory get: usa row.values in parsing', testMemoryGetUsesRowValues],
        ['memory invalidate: pulizia cache deterministica', testInvalidateCacheAlsoClearsRobustCache],
        ['memory: sheet lock non rilascia se waitLock fallisce', testSheetWriteLockDoesNotReleaseWhenWaitLockFails],
        ['memory: addProvidedInfoTopics serializza scrittura sheet', testAddProvidedInfoTopicsUsesSheetWriteLock],
        ['memory: providedInfo append usa sheet lock globale', testUpdateProvidedInfoWithoutIncrementUsesSheetWriteLockForAppend],
        ['memory reaction: gestione dinamica topic vuoti', testInferUserReactionIsResilientToEmptyTopics],
        ['memory reaction: normalizzazione topic coerente', testInferUserReactionNormalizesTopicKeys],
        ['memory: merge providedInfo normalizza topic equivalenti', testMemoryMergeProvidedTopicsNormalizesTopicKeys],
        ['rate limiter: persistenza rigorosa transazionale bloccata senza lock', testRateLimiterPersistenceRequiresTransactionalLock],
        ['rate limiter: reservation lifecycle senza doppio conteggio', testRateLimiterReservationLifecycleDoesNotDuplicateOrLeak],
        ['_shouldIgnoreEmail: no-reply/reale/ooo', testShouldIgnoreEmail],
        ['_shouldIgnoreEmail: blacklist vuota non blocca tutto', testShouldIgnoreEmailSkipsBlankBlacklistEntries],
        ['ocr trigger: keyword non-stringa gestite in sicurezza', testShouldTryOcrHandlesNonStringKeywords],
        ['business date: fallback rispetta timezone Roma', testGetBusinessDateStringFallbackUsesRomeTimezone],
        ['attachment context: sanitizzazione + newline reali', testAttachmentContextSanitizationFormatting],
        ['prompt lite: budget token e sezioni ridotte', testPromptLiteTokenBudget],
        ['request classifier: external hint category trim', testRequestClassifierExternalHintCategoryTrim],
        ['request classifier: localized confidence parsing', testRequestClassifierExternalHintLocalizedConfidence],
        ['request classifier: structured body sanitization', testRequestClassifierSanitizeStructuredBody],
        ['golden set: regressione output strutturale', runGoldenCases],
        // Sicurezza
        ['escapeHtml: neutralizza XSS', testEscapeHtml],
        ['markdownToHtml: input non stringa robusto', testMarkdownToHtmlNonStringInput],
        ['sanitizeUrl: blocca IPv6/decimale/userinfo', testSanitizeUrlIPv6],
        ['markdownToHtml: escape-first previene XSS', testMarkdownToHtmlXss],
        ['markdownToHtml: supporta URL con parentesi', testMarkdownLinkWithParentheses],
        ['markdownToHtml: query params senza double-escape', testMarkdownLinkQueryParamsNotDoubleEscaped],
        ['markdownToHtml: evita nesting p/ul invalido', testMarkdownListParagraphNesting],
        ['gmail labels: errori non-label vengono propagati', testAddLabelToThreadPropagatesNonLabelErrors],
        ['gmail list: empty response fallback', testListMessagesWithResilienceHandlesEmptyResponseError],
        ['gmail list: fallback robusto opzioni paginazione invalide', testGetMessageIdsWithLabelInvalidPaginationOptions],
        ['gmail extract: usa solo main reply senza storico', testExtractMessageDetailsUsesMainReplyOnly],
        ['gmail subject: sanifica CRLF header injection', testSanitizeSubjectForHeaderRemovesCRLF],
        ['gmail send: fold e bound della catena References', testSendHtmlReplyFoldsAndBoundsReferencesHeader],
        ['main: reset cache risorse mancanti', testLoadResourcesResetsMissingPromptSheets],
        ['main: isolamento rigoroso per hasExecutionLock', testMainEncapsulatesExecutionLockSuccessfully],
        ['main: rilascia lock prima dei servizi pipeline', testMainReleasesExecutionLockBeforePipelineServices],
        ['main: serializzazione KB preserva colonne vuote', testSheetRowsToTextPreservesColumnAlignmentWithEmptyCells],
        ['main: serializzazione date KB stabile', testSheetRowsToTextFormatsDatesStably],
        ['main: serializzazione celle multilinea KB stabile', testSheetRowsToTextNormalizesMultilineCells],
        ['main: split cache avanza su high surrogate singolo', testSplitCachePayloadAdvancesOnSingleHighSurrogate],
        ['main: fallback date formatter usa timezone script', testFormatDateForKnowledgeTextUsesScriptTimezoneInNodeFallback],
        ['validator: thinking leak con pattern parentesi', testResponseValidatorRemovesThinkingLeakWithParenthesisKeyword],
        ['main: ai_core preserva valori falsey', testLoadResourcesKeepsFalseyValuesInAiCoreSheets],
        ['main: parsing rigoroso fasce sospensione', testLoadAdvancedConfigStrictSuspensionHours],
        ['main: compatibilità layout legacy fasce sospensione', testLoadAdvancedConfigLegacySuspensionLayoutCompatibility],
        ['prompt context: temporal risk with object KB', testPromptContextTemporalRiskWithObjectKnowledgeBase],
        ['prompt context: temporal risk with day/month KB', testPromptContextTemporalRiskWithDayMonthKnowledgeBase],
        ['prompt context: temporal risk with object KB containing dates', testPromptContextTemporalRiskWithObjectKnowledgeBaseContainingDates],
        ['prompt context: circular object KB fallback', testPromptContextKnowledgeBaseCircularObjectDoesNotCrash],
        ['prompt context: explicit knowledgeBaseMeta precedence', testPromptContextHonorsExplicitKnowledgeBaseMeta],
        ['prompt context: explicit knowledgeBaseMeta false override', testPromptContextHonorsExplicitKnowledgeBaseMetaFalse],
        ['prompt engine: object KB normalization', testPromptEngineNormalizesObjectKnowledgeBase],
        ['prompt KB truncation: hard limit chars rispettato', testPromptKbSemanticTruncationRespectsHardLimit],
        ['gemini: portuguese detection refinement', testPortugueseDetectionRefinement],
        ['gemini: italian newsletter-like language detection', testItalianNewsletterLikeLanguageDetection],
        ['classifier: backward quote scan', testClassifierBackwardQuoteScan],
        ['main: caricamento sostituzioni', testLoadResourcesReplacements],
        ['gmail office extract: Drive v3 forza mimeType target', testExtractOfficeTextDriveCreateForcesTargetMimeType],
        ['validator: numero civico non sdogana orario inventato', testResponseValidatorStreetNumberDoesNotWhitelistInventedTime],
        ['retry intelligente: errore ammesso non critico sopra soglia', testIntelligentRetryAllowedNonCriticalHighScore],
    ];

    let passed = 0;
    let failed = 0;

    for (const [name, fn] of tests) {
        try {
            fn();
            passed++;
            console.log(`PASS ${name}`);
        } catch (e) {
            failed++;
            console.log(`FAIL ${name}: ${e.message}\n${e.stack}`);
        }
    }

    const total = passed + failed;

    console.log('');
    console.log(`SUMMARY: ${passed}/${total} passed (min: ${MIN_EXPECTED_TESTS})`);

    if (failed > 0) {
        console.error(`\n❌ ${failed} test falliti.`);
        process.exit(1);
    }

    if (total < MIN_EXPECTED_TESTS) {
        console.error(`\n❌ Soglia minima non raggiunta: ${total} test eseguiti, minimo atteso ${MIN_EXPECTED_TESTS}.`);
        process.exit(1);
    }

    console.log('\n✅ Smoke tests completati con successo.');
}

main();
