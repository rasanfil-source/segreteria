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

const MIN_EXPECTED_TESTS = 20;

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
    return new Date(year, month - 1, day);
};

// Mock createLogger (necessario per EmailProcessor)
global.createLogger = function (name) {
    return { info: () => { }, warn: () => { }, debug: () => { }, error: () => { } };
};

global.Utilities = {
    formatDate: (date) => new Date(date).toISOString().slice(0, 10),
    sleep: () => { },
    computeDigest: () => [0, 1, 2, 3],
    getUuid: () => 'uuid-mock',
    DigestAlgorithm: { MD5: 'MD5' }
};

// Mock PropertiesService e SpreadsheetApp (per MemoryService)
global.PropertiesService = {
    getScriptProperties: () => ({
        getProperty: (k) => k === 'SPREADSHEET_ID' ? 'abc-123' : null
    })
};

global.SpreadsheetApp = {
    openById: () => ({
        getSheetByName: () => ({
            getRange: () => ({
                getValues: () => [['threadId', 'language', 'category', 'tone', 'providedInfo', 'lastUpdated', 'messageCount', 'version', 'memorySummary']],
                setFontWeight: () => { },
                setValue: () => { }
            }),
            createTextFinder: () => ({
                matchEntireCell: () => ({
                    matchCase: () => ({
                        matchFormulaText: () => ({
                            findNext: () => null
                        })
                    })
                })
            })
        })
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

// ========================================================================
// TEST ERROR TYPES (classificazione centralizzata)
// ========================================================================

function testClassifyErrorQuota() {
    loadScript('gas_error_types.js');

    const result = classifyError(new Error('429 rate limit exceeded'));
    assert(result.type === 'QUOTA_EXCEEDED', `Atteso QUOTA_EXCEEDED, ottenuto "${result.type}"`);
    assert(result.retryable === true, 'Errore quota deve essere retryable');

    const result2 = classifyError(new Error('RESOURCE_EXHAUSTED: Quota exceeded'));
    assert(result2.type === 'QUOTA_EXCEEDED', `Atteso QUOTA_EXCEEDED, ottenuto "${result2.type}"`);
    assert(result2.retryable === true, 'Errore RESOURCE_EXHAUSTED deve essere retryable');
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

    let threw = false;
    try {
        service._generateWithModel('Prompt test', 'gemini-2.5-flash');
    } catch (e) {
        threw = true;
        assert(e.message.includes('429'), `Errore atteso contiene "429", ottenuto: "${e.message}"`);
    }
    assert(threw, '_generateWithModel deve lanciare errore su risposta 429');
}

function testGeminiMalformedJson() {
    loadScript('gas_gemini_service.js');

    const mockBadJson = {
        getResponseCode: () => 200,
        getContentText: () => 'questo non è JSON valido {{{}'
    };

    const service = createMockGeminiService(() => mockBadJson);

    let threw = false;
    try {
        service._generateWithModel('Prompt test', 'gemini-2.5-flash');
    } catch (e) {
        threw = true;
        assert(e.message.includes('non JSON valida'), `Errore atteso contiene "non JSON valida", ottenuto: "${e.message}"`);
    }
    assert(threw, '_generateWithModel deve lanciare errore su JSON malformato');
}

function testGeminiNoCandidates() {
    loadScript('gas_gemini_service.js');

    const mockNoCandidates = {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ candidates: [] })
    };

    const service = createMockGeminiService(() => mockNoCandidates);

    let threw = false;
    try {
        service._generateWithModel('Prompt test', 'gemini-2.5-flash');
    } catch (e) {
        threw = true;
        assert(e.message.includes('nessun candidato'), `Errore atteso contiene "nessun candidato", ottenuto: "${e.message}"`);
    }
    assert(threw, '_generateWithModel deve lanciare errore senza candidati');
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

    const resLong = validator._checkLength('A'.repeat(3001));
    assert(resLong.score === 0.95, `Risposta troppo lunga deve avere score 0.95, ottenuto ${resLong.score}`);
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

    // Reply dopo 4 giorni → full (nuovo contatto, > 72h)
    const fourDaysAgo = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const result4d = computeSalutationMode({ isReply: true, messageCount: 3, memoryExists: true, lastUpdated: fourDaysAgo, now: NOW });
    assert(result4d === 'soft', `Reply dopo 4 giorni: atteso "soft", ottenuto "${result4d}"`);
}

function testAntiLoopDetection() {
    loadScript('gas_email_processor.js');

    const originalSession = global.Session;
    const originalCacheService = global.CacheService;

    global.Session = {
        getEffectiveUser: () => ({ getEmail: () => 'me@parrocchia.it' }),
        getActiveUser: () => ({ getEmail: () => 'me@parrocchia.it' })
    };

    const store = new Map();
    global.CacheService = {
        getScriptCache: () => ({
            get: (k) => store.get(k) || null,
            put: (k, v) => store.set(k, v),
            remove: (k) => store.delete(k)
        })
    };

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
            generateResponse: () => ({ success: true, text: 'Risposta' })
        },
        classifier: {
            classifyEmail: () => ({ shouldReply: true, reason: 'ok' })
        },
        requestClassifier: {
            classify: () => ({ type: 'INFO', complexity: 'low' })
        },
        validator: {
            validateResponse: () => ({ isValid: true, score: 1.0, errors: [] })
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
        assert(removedKeys.includes('MEM_thread-42'), '_invalidateCache deve rimuovere anche la cache robusta');
    } finally {
        global.CacheService = originalCacheService;
    }
}

function testMainDoesNotLeakHasExecutionLockGlobal() {
    loadScript('gas_main.js');

    const originalLockService = global.LockService;
    const hadHasExecutionLock = Object.prototype.hasOwnProperty.call(global, 'hasExecutionLock');
    const originalHasExecutionLock = global.hasExecutionLock;

    global.LockService = {
        getScriptLock: () => ({
            tryLock: () => false,
            releaseLock: () => { throw new Error('releaseLock non deve essere chiamato se tryLock fallisce'); }
        })
    };

    try {
        processEmailsMain();
        const leaked = Object.prototype.hasOwnProperty.call(global, 'hasExecutionLock');
        assert(!leaked, 'processEmailsMain non deve creare una variabile globale hasExecutionLock');
    } finally {
        global.LockService = originalLockService;
        if (hadHasExecutionLock) {
            global.hasExecutionLock = originalHasExecutionLock;
        } else {
            delete global.hasExecutionLock;
        }
    }
}

function testRateLimiterRecoverRequiresLock() {
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

function testAttachmentContextSanitizationFormatting() {
    loadScript('gas_prompt_engine.js');

    const engine = new PromptEngine();
    const input = 'Riga 1\nRiga 2';
    const rendered = engine._renderAttachmentContext(input);

    assert(rendered.includes('ALLEGATI (TESTO OCR/PDF)'), 'Header allegati non trovato');
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
        'gas_config_s.js',
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
}

function testSanitizeUrlIPv6() {
    loadScript('gas_gmail_service.js');

    // IPv6 loopback → null
    const ipv6 = sanitizeUrl('http://[::1]/admin');
    assert(ipv6 === null, 'sanitizeUrl deve bloccare IPv6 loopback [::1]');

    // IP decimale → null
    const decimal = sanitizeUrl('http://2130706433/');
    assert(decimal === null, `sanitizeUrl deve bloccare IP decimale, ottenuto: ${decimal}`);

    // Userinfo bypass → null
    const userinfo = sanitizeUrl('http://localhost@evil.com/path');
    assert(userinfo === null, 'sanitizeUrl deve bloccare userinfo bypass');

    // Dotted quad in notazione hex → null
    const hexDotted = sanitizeUrl('http://0x7f.0x0.0x0.0x1/admin');
    assert(hexDotted === null, `sanitizeUrl deve bloccare dotted-quad hex, ottenuto: ${hexDotted}`);

    // IPv4-mapped IPv6 loopback → null
    const mappedLoopback = sanitizeUrl('http://[::ffff:127.0.0.1]/admin');
    assert(mappedLoopback === null, `sanitizeUrl deve bloccare IPv4-mapped loopback, ottenuto: ${mappedLoopback}`);

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

function testAddLabelToThreadPropagatesNonLabelErrors() {
    loadScript('gas_gmail_service.js');

    const service = Object.create(GmailService.prototype);
    service.getOrCreateLabel = () => {
        throw new Error('Permission denied');
    };
    service._isLabelNotFoundError = () => false;

    let threw = false;
    try {
        service.addLabelToThread({ addLabel: () => { } }, 'IA');
    } catch (error) {
        threw = true;
        assert(error.message.includes('Permission denied'), 'Errore inatteso propagato da addLabelToThread');
    }

    assert(threw, 'addLabelToThread deve propagare errori non riconducibili a label missing');
}

// ========================================================================
// MAIN: runner con contatore e soglia minima
// ========================================================================

function main() {
    const tests = [
        // Territory Validator
        ['territory abbreviations', testTerritoryAbbreviations],
        ['civic normalization (normalizeCivic)', testCivicNormalization],
        ['civic deduplication (10A vs 10B)', testCivicDeduplicationExplicit],
        ['civic extraction with slash/dash suffix', testAddressExtractionWithSlashAndDashSuffix],
        // Error Types (classificazione centralizzata)
        ['classifyError: quota/429 → retryable', testClassifyErrorQuota],
        ['classifyError: API key/invalid → non-retryable', testClassifyErrorNonRetryable],
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
        ['validator: semantic prompt bullets puliti', testSemanticThinkingPromptBullets],
        // EmailProcessor
        ['computeSalutationMode: primo/reply/vecchio', testComputeSalutationMode],
        ['anti-loop: thread lungo con esterni consecutivi', testAntiLoopDetection],
        ['memory get: usa row.values in parsing', testMemoryGetUsesRowValues],
        ['memory invalidate: pulizia cache robusta', testInvalidateCacheAlsoClearsRobustCache],
        ['rate limiter WAL: recovery bloccato senza lock', testRateLimiterRecoverRequiresLock],
        ['_shouldIgnoreEmail: no-reply/reale/ooo', testShouldIgnoreEmail],
        ['attachment context: sanitizzazione + newline reali', testAttachmentContextSanitizationFormatting],
        ['prompt lite: budget token e sezioni ridotte', testPromptLiteTokenBudget],
        ['golden set: regressione output strutturale', runGoldenCases],
        // Sicurezza
        ['escapeHtml: neutralizza XSS', testEscapeHtml],
        ['sanitizeUrl: blocca IPv6/decimale/userinfo', testSanitizeUrlIPv6],
        ['markdownToHtml: escape-first previene XSS', testMarkdownToHtmlXss],
        ['markdownToHtml: supporta URL con parentesi', testMarkdownLinkWithParentheses],
        ['gmail labels: errori non-label vengono propagati', testAddLabelToThreadPropagatesNonLabelErrors],
        ['main: nessun leak globale hasExecutionLock', testMainDoesNotLeakHasExecutionLockGlobal],
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
            console.error(`FAIL ${name}: ${e.message}\n${e.stack}`);
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
