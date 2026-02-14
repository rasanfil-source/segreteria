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

const MIN_EXPECTED_TESTS = 19;

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
}

function testCivicDeduplicationExplicit() {
    loadScript('gas_territory_validator.js');

    const civicA = TerritoryValidator.normalizeCivic('10A');
    const civicB = TerritoryValidator.normalizeCivic('10B');
    assert(civicA !== civicB, `normalizeCivic deve distinguere 10A (${civicA}) da 10B (${civicB})`);

    const civicSpaced = TerritoryValidator.normalizeCivic('10 A');
    assert(civicSpaced === civicA, `normalizeCivic("10 A") deve normalizzare a "${civicA}", ottenuto "${civicSpaced}"`);
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

    // Troppo corta → errore
    const short = validator._checkLength('Ciao');
    assert(short.score === 0.0, `Risposta corta: score atteso 0.0, ottenuto ${short.score}`);
    assert(short.errors.length > 0, 'Risposta corta deve generare errori');

    // Lunghezza ottimale → score pieno
    const good = validator._checkLength('Gentile signora, la informo che gli orari delle Sante Messe festive sono i seguenti: sabato ore 18:00, domenica ore 8:00, 10:00 e 11:30. Cordiali saluti.');
    assert(good.score === 1.0, `Risposta buona: score atteso 1.0, ottenuto ${good.score}`);
    assert(good.errors.length === 0, 'Risposta buona non deve generare errori');

    // Sotto soglia ottimale → warning
    const medium = validator._checkLength('Buongiorno, le messe sono alle 10 e alle 18.');
    assert(medium.score < 1.0, 'Risposta media deve avere score ridotto');
}

function testResponseValidatorForbiddenContent() {
    loadScript('gas_response_validator.js');

    const validator = new ResponseValidator();

    // Frase vietata presente
    const forbidden = validator._checkForbiddenContent('Non sono sicuro degli orari, forse è alle 10.');
    assert(forbidden.score < 1.0, 'Contenuto con frasi vietate deve avere score ridotto');
    assert(forbidden.foundForbidden.length > 0, 'Deve rilevare frasi vietate');

    // Placeholder presente
    const placeholder = validator._checkForbiddenContent('Gentile signore, la sua richiesta è TBD.');
    assert(placeholder.score === 0.0, 'Contenuto con placeholder deve avere score 0');

    // Contenuto pulito
    const clean = validator._checkForbiddenContent('Gentile signora, le confermo che la Santa Messa festiva è celebrata ogni domenica alle ore 10:00.');
    assert(clean.score === 1.0, `Contenuto pulito: score atteso 1.0, ottenuto ${clean.score}`);
    assert(clean.foundForbidden.length === 0, 'Contenuto pulito non deve avere frasi vietate');
}

function testResponseValidatorLanguageCheck() {
    loadScript('gas_response_validator.js');

    const validator = new ResponseValidator();

    // Italiano corretto
    const it = validator._checkLanguage(
        'Gentile signora, grazie per la sua email. Le confermo la messa nella nostra parrocchia. Cordiali saluti dalla segreteria.',
        'it'
    );
    assert(it.errors.length === 0, `Check lingua IT non deve generare errori, ottenuti: ${it.errors.join('; ')}`);

    // Inglese corretto
    const en = validator._checkLanguage(
        'Dear Sir, thank you for your email regarding the parish. We would be happy to help with the mass schedule. Kind regards.',
        'en'
    );
    assert(en.errors.length === 0, `Check lingua EN non deve generare errori, ottenuti: ${en.errors.join('; ')}`);
}

// ========================================================================
// TEST EMAIL PROCESSOR (pure functions)
// ========================================================================

function testComputeSalutationMode() {
    loadScript('gas_email_processor.js');

    // Primo messaggio → full
    const first = computeSalutationMode({ isReply: false, messageCount: 1, memoryExists: false, lastUpdated: null });
    assert(first === 'full', `Primo messaggio: atteso "full", ottenuto "${first}"`);

    // Reply con memoria senza timestamp → none_or_continuity
    const reply = computeSalutationMode({ isReply: true, messageCount: 2, memoryExists: true, lastUpdated: null });
    assert(reply === 'none_or_continuity', `Reply senza timestamp: atteso "none_or_continuity", ottenuto "${reply}"`);

    // Reply dopo 5 giorni → full (nuovo contatto)
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const old = computeSalutationMode({ isReply: true, messageCount: 3, memoryExists: true, lastUpdated: fiveDaysAgo });
    assert(old === 'full', `Reply dopo 5 giorni: atteso "full", ottenuto "${old}"`);
}

function testComputeResponseDelay() {
    loadScript('gas_email_processor.js');

    // Messaggio recente → no scuse
    const now = new Date();
    const recent = computeResponseDelay({ messageDate: now, now: now });
    assert(recent.shouldApologize === false, 'Messaggio recente non deve generare scuse');
    assert(recent.hours === 0, `Ore attese 0, ottenute ${recent.hours}`);

    // Messaggio di 4 giorni fa → scuse
    const fourDaysAgo = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000);
    const delayed = computeResponseDelay({ messageDate: fourDaysAgo, now: now });
    assert(delayed.shouldApologize === true, 'Messaggio di 4 giorni fa deve generare scuse');
    assert(delayed.days >= 3, `Giorni attesi >= 3, ottenuti ${delayed.days}`);

    // Messaggio nullo → nessuna scusa
    const noDate = computeResponseDelay({ messageDate: null });
    assert(noDate.shouldApologize === false, 'Messaggio senza data non deve generare scuse');
}

function testShouldIgnoreEmail() {
    loadScript('gas_email_processor.js');

    // Mock minimo per EmailProcessor
    const processor = new EmailProcessor({
        geminiService: {},
        classifier: {},
        requestClassifier: {},
        validator: {},
        gmailService: {},
        promptEngine: {},
        memoryService: {},
        territoryValidator: null
    });

    // Auto-reply → ignora
    const autoReply = processor._shouldIgnoreEmail({
        senderEmail: 'no-reply@example.com',
        subject: 'Test',
        body: 'Content'
    });
    assert(autoReply === true, 'Email da no-reply deve essere ignorata');

    // Email reale → non ignorare
    const realEmail = processor._shouldIgnoreEmail({
        senderEmail: 'mario.rossi@gmail.com',
        subject: 'Informazioni messe',
        body: 'Buongiorno, vorrei sapere gli orari.'
    });
    assert(realEmail === false, 'Email reale non deve essere ignorata');

    // Out of office → ignora
    const ooo = processor._shouldIgnoreEmail({
        senderEmail: 'user@example.com',
        subject: 'Out of office: Re: Info',
        body: 'Sono fuori sede.'
    });
    assert(ooo === true, 'Out of office deve essere ignorata');
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

// ========================================================================
// MAIN: runner con contatore e soglia minima
// ========================================================================

function main() {
    const tests = [
        // Territory Validator
        ['territory abbreviations', testTerritoryAbbreviations],
        ['civic normalization (normalizeCivic)', testCivicNormalization],
        ['civic deduplication (10A vs 10B)', testCivicDeduplicationExplicit],
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
        // EmailProcessor
        ['computeSalutationMode: primo/reply/vecchio', testComputeSalutationMode],
        ['computeResponseDelay: recente/vecchio/nullo', testComputeResponseDelay],
        ['_shouldIgnoreEmail: no-reply/reale/ooo', testShouldIgnoreEmail],
        // Sicurezza
        ['escapeHtml: neutralizza XSS', testEscapeHtml],
        ['sanitizeUrl: blocca IPv6/decimale/userinfo', testSanitizeUrlIPv6],
        ['markdownToHtml: escape-first previene XSS', testMarkdownToHtmlXss],
    ];

    let passed = 0;
    let failed = 0;

    for (const [name, fn] of tests) {
        try {
            fn();
            passed++;
            console.log(`✅ ${name}`);
        } catch (e) {
            failed++;
            console.error(`❌ ${name}: ${e.message}`);
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
