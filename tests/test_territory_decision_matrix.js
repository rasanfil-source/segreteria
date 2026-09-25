const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.resolve(__dirname, '../gas_territory_validator.js');
const context = vm.createContext({ console: { log() {}, warn() {}, error() {} } });
vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
const v = context.createTerritoryValidator();
let cases = 0;
function row(label, fn) {
  try { fn(); cases++; } catch (error) { throw new Error(label, { cause: error }); }
}
// Use a synthetic street to vary the rule, independently from production address data.
const street = 'via esempio';
const rules = [
  [{}, () => false], [{ tutti: true }, () => true],
  [{ pari: true }, n => n % 2 === 0], [{ dispari: true }, n => n % 2 === 1],
  [{ tutti: [10, 20] }, n => n >= 10 && n <= 20],
  [{ tutti: [null, 20] }, n => n <= 20], [{ tutti: [10, null] }, n => n >= 10],
  [{ tutti: [null, null] }, () => false],
  [{ pari: [10, 20] }, n => n % 2 === 0 && n >= 10 && n <= 20],
  [{ dispari: [11, 21] }, n => n % 2 === 1 && n >= 11 && n <= 21],
  [{ pari: [null, 20] }, n => n % 2 === 0 && n <= 20],
  [{ dispari: [null, 21] }, n => n % 2 === 1 && n <= 21],
  [{ pari: [10, null] }, n => n % 2 === 0 && n >= 10],
  [{ dispari: [11, null] }, n => n % 2 === 1 && n >= 11],
  [{ pari: true, dispari: true }, () => true]
];
for (const [rule, oracle] of rules) {
  v.rules.set(street, rule);
  for (const number of [0, 1, 8, 9, 10, 11, 12, 19, 20, 21, 22, 23, 9999]) for (const suffix of ['', 'A']) row(`rule ${JSON.stringify(rule)}/${number}${suffix}`, () => {
    const result = v.verifyAddress(street, number, `${number}${suffix}`);
    assert.equal(result.inTerritory, oracle(number));
    assert.equal(result.matchedKey, street);
    if (oracle(number) && Object.values(rule).some(Array.isArray)) assert.equal(Boolean(result.needsReview), Boolean(suffix));
  });
  row(`no civic ${JSON.stringify(rule)}`, () => {
    const result = v.verifyStreetWithoutCivic(street);
    const invalid = Array.isArray(rule.tutti) && rule.tutti.every(x => x === null);
    assert.equal(result.inParish, rule.tutti === true ? true : invalid ? false : null);
    assert.equal(result.needsCivic, rule.tutti !== true && !invalid);
  });
}
for (const civic of [null, undefined, '10', NaN, Infinity, -1]) row(`invalid civic ${civic}`, () => assert.equal(v.verifyAddress(street, civic).rule, 'invalid_civic'));
for (const [raw, expected] of [[null, ''], [undefined, ''], ['snc', 'SNC'], ['10 a', '10A'], ['10/A', '10A'], ['10-A', '10A'], [0, '0']]) row(`normalize ${raw}`, () => assert.equal(context.TerritoryValidator.normalizeCivic(raw), expected));
for (const type of ['via', 'viale', 'piazza', 'piazzale', 'largo', 'salita', 'lungotevere', 'vicolo', 'corso']) {
  for (const input of [type, type.toUpperCase(), type.split('').join('.')]) row(`street type ${input}`, () => assert.equal(v._normalizeStreetType(input), type));
  row(`extract ${type}`, () => {
    assert.equal(v.extractAddressFromText(`${type} Esempio 10`)[0].civic, 10);
    assert.equal(v.extractStreetOnlyFromText(`${type} Esempio`)[0], `${type} Esempio`);
  });
}
for (const input of [null, undefined, '', 123]) row(`empty inputs ${input}`, () => {
  assert.equal(v.extractAddressFromText(input), null);
  assert.equal(v.extractStreetOnlyFromText(input), null);
  assert.equal(v.findTerritoryMatch(input), null);
});
for (const [rule, civic, expected] of [
  [{ tutti: true }, '10', true], [{ pari: true }, '11', false],
  [{ tutti: [10, 20] }, '10A', true], [{ tutti: true }, 'snc', true],
  [{ pari: true }, 'snc', null], [{ tutti: true }, '', true], [{ pari: true }, '', null]
]) row(`email ${JSON.stringify(rule)}/${civic}`, () => {
  v.rules.set(street, rule);
  const result = v.analyzeEmailForAddress(`Via Esempio ${civic}`, 'Residenza');
  assert.equal(result.addressFound, true);
  assert.equal(result.addresses.length, 1);
  assert.equal(result.verification.inParish, expected);
  assert.equal(result.verification.needsCivic, !civic && expected === null);
});
row('no address', () => assert.equal(v.analyzeEmailForAddress('Grazie', '').addressFound, false));
row('duplicate street', () => assert.equal(v.extractStreetOnlyFromText('Via Esempio; Via Esempio').length, 1));
row('form fields', () => assert.equal(v.extractStreetOnlyFromText('Via: Esempio; nome: Mario')[0], 'via Esempio'));
row('bounded long input', () => {
  assert.equal(v.extractAddressFromText('Via Esempio 10. ' + 'test '.repeat(300))[0].civic, 10);
  assert.equal(v.extractAddressFromText('x'.repeat(1001) + ' Via Esempio 10'), null);
  assert.equal(v.extractStreetOnlyFromText('x'.repeat(1001) + ' Via Esempio'), null);
});
console.log(`Territory decision matrices: ${cases} cases passed`);
