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

const MIN_EXPECTED_TESTS = 8;

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
        assert(
            e.message.includes('429'),
            `Errore atteso contiene "429", ottenuto: "${e.message}"`
        );
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
        assert(
            e.message.includes('non JSON valida'),
            `Errore atteso contiene "non JSON valida", ottenuto: "${e.message}"`
        );
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
        assert(
            e.message.includes('nessun candidato'),
            `Errore atteso contiene "nessun candidato", ottenuto: "${e.message}"`
        );
    }
    assert(threw, '_generateWithModel deve lanciare errore senza candidati');
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
        // GeminiService
        ['portuguese special greeting', testPortugueseSpecialGreeting],
        ['gemini DI + mock fetch', testGeminiDependencyInjectionAndMockFetch],
        ['gemini contract: 429 → errore propagato', testGeminiRetryOn429],
        ['gemini contract: malformed JSON → errore parse', testGeminiMalformedJson],
        ['gemini contract: no candidates → errore semantico', testGeminiNoCandidates],
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
