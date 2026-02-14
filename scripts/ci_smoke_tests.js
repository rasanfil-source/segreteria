#!/usr/bin/env node

/**
 * Smoke tests eseguibili in CI Node.js
 * - Carica file GAS in VM Node per verifiche di regressione pure-JS
 * - NON tocca servizi Google (PropertiesService, UrlFetchApp, ...)
 */

const fs = require('fs');
const vm = require('vm');

// Helper necessario per gas_gemini_service.js (normalmente in gas_main.js)
function calculateEaster(year) {
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
}

function loadScript(path, existingContext = null) {
    const code = fs.readFileSync(path, 'utf8');

    let context;
    if (existingContext) {
        context = existingContext;
    } else {
        context = {
            console: console,
            calculateEaster: calculateEaster,
            // Mock minimi per prevenire errori ReferenceError durante caricamento
            GeminiService: null,
            TerritoryValidator: null,
            PropertiesService: {
                getScriptProperties: () => ({
                    getProperty: () => 'MOCK_KEY_LONGER_THAN_20_CHARS_FOR_VALIDATION'
                })
            },
            UrlFetchApp: {
                fetch: () => ({})
            },
            Utilities: {
                sleep: () => { }
            },
            CacheService: {
                getScriptCache: () => ({ get: () => null, put: () => { } })
            },
            // Mock del logger globale usato in GeminiService
            createLogger: () => ({
                info: () => { },
                warn: () => { },
                error: () => { },
                debug: () => { }
            }),
            BaseLogger: class { }, // Disponibile nel contesto globale per 'class GeminiService extends BaseLogger'
        };
        vm.createContext(context);
    }

    vm.runInContext(code, context, { filename: path });

    return context;
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function testTerritoryAbbreviations() {
    console.log('--- Test Territory Abbreviations ---');
    // Carica script nel contesto
    const context = loadScript('gas_territory_validator.js');

    // In VM Node, le classi definite con 'class X {}' non vengono automaticamente messe su 'global' o 'context' 
    // se non sono esplicitamente assegnate.
    // Tuttavia, 'runInContext' dovrebbe definire la classe nello scope del contesto.
    // Verifichiamo se possiamo istanziarla valutando codice nel contesto.

    const validator = vm.runInContext('new TerritoryValidator()', context);

    const inputStreet = 'via g.vincenzo gravina';
    const expectedNormalized = 'via giovanni vincenzo gravina';

    const compact = validator.normalizeStreetName(inputStreet);
    assert(
        compact === expectedNormalized,
        `Atteso "${expectedNormalized}", ottenuto "${compact}"`
    );

    const matched = validator.findTerritoryMatch(inputStreet);
    assert(
        matched && matched.key === expectedNormalized,
        'findTerritoryMatch non risolve correttamente la via abbreviata'
    );
    console.log('✓ OK');
}

function testPortugueseSpecialGreeting() {
    console.log('--- Test Portuguese Special Greeting ---');
    // Riutilizza o crea contesto con mock
    const context = loadScript('gas_gemini_service.js');

    const greeting = vm.runInContext(`
    const service = new GeminiService();
    service._getSpecialDayGreeting(new Date('2026-01-01T10:00:00Z'), 'pt');
  `, context);

    assert(
        greeting === 'Feliz Ano Novo!',
        `Atteso "Feliz Ano Novo!", ottenuto "${greeting}"`
    );
    console.log('✓ OK');
}

function main() {
    try {
        const tests = [
            ['territory abbreviations', testTerritoryAbbreviations],
            ['portuguese special greeting', testPortugueseSpecialGreeting]
        ];

        for (const [name, fn] of tests) {
            fn();
        }

        console.log('\nSmoke tests completati con successo.');
    } catch (e) {
        console.error(`\n❌ Errore nei smoke tests: ${e.message}`);
        process.exit(1);
    }
}

main();
