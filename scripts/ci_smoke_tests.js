#!/usr/bin/env node

/**
 * Smoke tests eseguibili in CI Node.js
 * - Carica file GAS in VM Node per verifiche di regressione pure-JS
 * - NON tocca servizi Google (PropertiesService, UrlFetchApp, ...)
 */

const fs = require('fs');
const vm = require('vm');

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

const loadedScripts = new Set();

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

function testPortugueseSpecialGreeting() {
    loadScript('gas_gemini_service.js');

    const service = Object.create(GeminiService.prototype);
    const greeting = service._getSpecialDayGreeting(new Date('2026-01-01T10:00:00Z'), 'pt');

    assert(
        greeting === 'Feliz Ano Novo!',
        `Atteso "Feliz Ano Novo!", ottenuto "${greeting}"`
    );
}

function main() {
    const tests = [
        ['territory abbreviations', testTerritoryAbbreviations],
        ['portuguese special greeting', testPortugueseSpecialGreeting]
    ];

    for (const [name, fn] of tests) {
        fn();
        console.log(`✅ ${name}`);
    }

    console.log('\nSmoke tests completati con successo.');
}

main();
