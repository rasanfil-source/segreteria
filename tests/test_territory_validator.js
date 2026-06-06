const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

const territoryPath = path.join(__dirname, '..', 'gas_territory_validator.js');
const code = fs.readFileSync(territoryPath, 'utf8');
vm.runInThisContext(code, { filename: territoryPath });

const validator = new TerritoryValidator();
assert(
  Array.isArray(validator._abbreviationRegexes) && validator._abbreviationRegexes.length > 0,
  'le abbreviazioni devono essere precompilate nel costruttore'
);

console.log('--- Test TerritoryValidator: Piazza della Marina accetta solo il range 24-35 ---');
const withinMin = validator.verifyAddress('Piazza della Marina', 24);
assert(withinMin.inTerritory === true, 'Piazza della Marina 24 deve essere nel territorio');
assert(withinMin.rule === 'range [24-35]', 'Piazza della Marina 24 deve usare la regola range');

const withinMax = validator.verifyAddress('Piazza della Marina', 35);
assert(withinMax.inTerritory === true, 'Piazza della Marina 35 deve essere nel territorio');

const belowRange = validator.verifyAddress('Piazza della Marina', 23);
assert(belowRange.inTerritory === false, 'Piazza della Marina 23 deve essere fuori territorio');
assert(belowRange.rule === 'fuori range tutti', 'Piazza della Marina 23 deve indicare fuori range');

const aboveRange = validator.verifyAddress('Piazza della Marina', 36);
assert(aboveRange.inTerritory === false, 'Piazza della Marina 36 deve essere fuori territorio');

const missingCivic = validator.verifyStreetWithoutCivic('Piazza della Marina');
assert(missingCivic.inParish === null, 'senza civico la copertura di Piazza della Marina deve restare indeterminata');
assert(missingCivic.needsCivic === true, 'senza civico Piazza della Marina deve richiedere il civico');
assert(missingCivic.reason.includes('24-35'), 'il messaggio deve indicare chiaramente il range 24-35');
assert(missingCivic.details === 'range_civic_required', 'deve usare il dettaglio dedicato ai range');

const abbreviatedStreet = validator.normalizeStreetName('via g.vincenzo gravina');
assert(
  abbreviatedStreet === 'via giovanni vincenzo gravina',
  `normalizzazione abbreviazioni invariata attesa, ottenuto ${abbreviatedStreet}`
);

console.log('✅ Test TerritoryValidator OK');
