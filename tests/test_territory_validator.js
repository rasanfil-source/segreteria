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

console.log('--- Test TerritoryValidator: via assente produce fuori_territorio assertivo ---');
const missingAddress = validator.verifyAddress('Via Bartolo Oriani', 10);
assert(missingAddress.inTerritory === false, 'Via Bartolo Oriani 10 deve essere fuori territorio se non presente nelle regole');
assert(missingAddress.rule === 'fuori_territorio', 'via assente con civico deve usare fuori_territorio, non uno stato nullo');
assert(missingAddress.needsReview === false, 'via assente non deve richiedere revisione civico');

const missingStreetOnly = validator.verifyStreetWithoutCivic('Via Bartolo Oriani');
assert(missingStreetOnly.inParish === false, 'Via Bartolo Oriani senza civico deve essere fuori territorio se non presente nelle regole');
assert(missingStreetOnly.needsCivic === false, 'via assente non deve chiedere il civico');
assert(missingStreetOnly.details === 'fuori_territorio', 'via assente senza civico deve usare fuori_territorio, non street_not_found');

const streetInSentence = validator.extractStreetOnlyFromText('Buona domenica, via Bartolo Oriani fa parte della vostra parrocchia?');
assert(Array.isArray(streetInSentence), 'la via in frase naturale deve essere rilevata');
assert(streetInSentence[0] === 'via Bartolo Oriani', `la via deve essere tagliata prima della frase successiva, ottenuto ${streetInSentence && streetInSentence[0]}`);

const sentenceAnalysis = validator.analyzeEmailForAddress(
  'Verro ad abitare in Via Bartolo Oriani. Vorrei sapere se rientra nel territorio.',
  'Trasferimenti'
);
assert(sentenceAnalysis.addressFound === true, 'l analisi deve rilevare la via anche senza civico in una frase naturale');
assert(sentenceAnalysis.addresses[0].street === 'via Bartolo Oriani', `indirizzo naturale tagliato male: ${sentenceAnalysis.addresses[0].street}`);
assert(sentenceAnalysis.addresses[0].verification.details === 'fuori_territorio', 'via naturale assente dal DB deve produrre fuori_territorio');

console.log('--- Test TerritoryValidator: tutti [null, null] fallisce chiuso ---');
validator.rules.set('via test invalida', { tutti: [null, null] });
const invalidRange = validator.verifyAddress('Via Test Invalida', 10);
assert(invalidRange.inTerritory === false, 'range tutti [null, null] non deve accettare qualunque civico');
assert(invalidRange.rule === 'invalid_tutti_range', 'range tutti [null, null] deve indicare configurazione invalida');

const invalidStreetOnly = validator.verifyStreetWithoutCivic('Via Test Invalida');
assert(invalidStreetOnly.inParish === false, 'via con range invalido non deve risultare in parrocchia senza civico');
assert(invalidStreetOnly.details === 'invalid_tutti_range', 'via con range invalido deve esporre dettaglio dedicato');

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
