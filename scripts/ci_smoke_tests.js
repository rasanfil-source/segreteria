#!/usr/bin/env node

/**
 * Smoke tests eseguibili in CI Node.js
 * - Carica file GAS in VM Node per verifiche di regressione pure-JS
 * - NON tocca servizi Google (PropertiesService, UrlFetchApp, ...)
 */

const fs = require('fs');
const vm = require('vm');

// Helper calculateEaster (simulato perché GAS non esporta globali tra file in Node)
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
    const code = fs.readFileSync(path, 'utf8');
    vm.runInThisContext(code, { filename: path });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function testTerritoryAbbreviations() {
    console.log('--- Test Territory Abbreviations ---');
    loadScript('gas_territory_validator.js');

    const validator = new TerritoryValidator();

    const inputStreet = 'via g.vincenzo gravina';
    const expected = 'via giovanni vincenzo gravina';

    const compact = validator.normalizeStreetName(inputStreet);
    assert(
        compact === expected,
        `Atteso "${expected}", ottenuto "${compact}"`
    );

    const matched = validator.findTerritoryMatch(inputStreet);
    assert(
        matched && matched.key === expected,
        `findTerritoryMatch non risolve correttamente la via abbreviata. Ottenuto: ${JSON.stringify(matched)}`
    );
    console.log('✓ OK');
}

function testPortugueseSpecialGreeting() {
    console.log('--- Test Portuguese Special Greeting ---');
    loadScript('gas_gemini_service.js');

    // Bypass costruttore che richiederebbe dipendenze GAS (PropertiesService, ecc.)
    const service = Object.create(GeminiService.prototype);

    // Test data specifica (Capodanno)
    const greeting = service._getSpecialDayGreeting(new Date('2026-01-01T10:00:00Z'), 'pt');

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
        console.error(`\n❌ FALLITO: ${e.message}`);
        process.exit(1);
    }
}

main();
