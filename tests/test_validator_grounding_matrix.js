const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.resolve(__dirname, '../gas_response_validator.js');
const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, CONFIG: { SEMANTIC_VALIDATION: { enabled: false } } });
vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
const v = new context.ResponseValidator();
let cases = 0;
function row(label, fn) {
  try { fn(); cases++; } catch (error) { throw new Error(label, { cause: error }); }
}
const bools = [false, true];
const facts = [
  ['times', 'Alle 10:30.', 'Alle 10.30.'],
  ['times', 'Alle 10.', 'Ore 10:00.'],
  ['dates', 'Il 30/09/2026.', 'Il 30 settembre 2026.'],
  ['emails', 'Scriva a UFFICIO@example.org.', 'ufficio@example.org'],
  ['phones', 'Telefono 06 1234 5678.', '06-1234-5678']
];
for (const [kind, reply, source] of facts) for (const inKB of bools) for (const inMessage of bools) for (const objectKB of bools) row(`grounding ${kind}/${reply}/${inKB}/${inMessage}/${objectKB}`, () => {
  const kbText = inKB ? source : '';
  const result = v._checkHallucinations(reply, objectKB ? { text: kbText } : kbText, inMessage ? source : '', { currentDate: '2026-09-25' });
  const allowed = inKB || inMessage;
  assert.equal(result.score, allowed ? 1 : 0.5);
  assert.equal(result.errors.length, Number(!allowed));
  assert.equal(Boolean(result.hallucinations[kind]), !allowed);
});
for (const inKB of bools) for (const inMessage of bools) for (const technical of bools) row(`technical time ${inKB}/${inMessage}/${technical}`, () => {
  const text = 'Alle 10:30.';
  const result = v._checkHallucinations(text, inKB ? text : '', inMessage ? text : '', { currentTime: technical ? '10:30' : '11:00', currentDate: '2026-09-25' });
  assert.equal(Boolean(result.hallucinations.technicalTimes), technical && !inKB && !inMessage);
  assert.equal(Boolean(result.hallucinations.times), !technical && !inKB && !inMessage);
});
for (const text of ['Costo 10.30 euro.', 'Gv 10:30', 'Re 10:30', '2Re 10:30', 'Gen. 10:30', 'file v.10.30', 'via 10.30']) row(`not a time ${text}`, () => assert.equal(v._checkHallucinations(text, '').score, 1));
for (const text of ['Ore 10:30', 'ore 10.30', 'Incontro alle ore 10:30']) row(`unfounded time ${text}`, () => {
  const result = v._checkHallucinations(text, '');
  assert.equal(result.score, 0.5);
  assert.equal(result.hallucinations.times[0], '10:30');
});
row('multiple independent unsupported facts', () => {
  const result = v._checkHallucinations(facts.filter((_, i) => i !== 1).map(f => f[1]).join(' '), '', '', { currentDate: '2026-09-25' });
  assert.equal(result.errors.length, 4);
  assert.equal(result.score, 0.0625);
});
const replies = ['Rientra nel territorio.', 'Fuori dal territorio.', 'Indicare il numero civico.', 'Grazie per il messaggio.'];
// Table rows = certified context, columns = inside / outside / civic request / neutral.
for (const [certified, expected, blocked] of [
  ['', null, [false, false, false, false]],
  ['Sconosciuto', null, [false, false, false, false]],
  ['RIENTRA', 'inside', [false, true, false, false]],
  ['NON RIENTRA', 'outside', [true, false, false, false]],
  ['CIVICO NECESSARIO', 'needs_civic', [true, true, false, false]]
]) for (const alias of ['territoryContext', 'territory_context', 'territory']) for (let i = 0; i < replies.length; i++) row(`territory consistency ${certified}/${alias}/${i}`, () => {
  const result = v._checkTerritoryConsistency(replies[i], { [alias]: alias === 'territory' ? { context: certified } : certified });
  assert.equal(result.expected, expected);
  assert.equal(result.active, expected !== null);
  assert.equal(result.score, blocked[i] ? 0 : 1);
});
for (const shape of ['array', 'object', 'records']) for (const active of bools) row(`concern shape ${shape}/${active}`, () => {
  const concerns = shape === 'array' ? active ? ['relational_warmth'] : [] : shape === 'object' ? { relational_warmth: active } : [{ key: 'relational_warmth', value: active }];
  const result = v._checkSensitiveContinuityQuality('La informiamo che occorre presentare i dati.', '', { validationContext: { activeConcerns: concerns } });
  assert.equal(result.active, active);
  assert.equal(result.warnings.length, Number(active));
});
console.log(`Grounding decision matrices: ${cases} cases passed`);
