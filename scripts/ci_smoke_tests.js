#!/usr/bin/env node

/**
 * Smoke tests eseguibili in CI Node.js
 * - Carica file GAS in VM Node per verifiche di regressione pure-JS
 * - NON tocca servizi Google (PropertiesService, UrlFetchApp, ...)
 */

const fs = require('fs');
const vm = require('vm');

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
