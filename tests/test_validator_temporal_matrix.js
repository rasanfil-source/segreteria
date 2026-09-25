const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.resolve(__dirname, '../gas_response_validator.js');
const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Date, CONFIG: { SEMANTIC_VALIDATION: { enabled: false } } });
vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
const v = context.createResponseValidator();
let cases = 0;
function row(label, fn) {
  try { fn(); cases++; } catch (error) { throw new Error(label, { cause: error }); }
}
// Gregorian leap boundaries, every month, invalid day and month boundaries.
for (const year of [1900, 2000, 2024, 2025, 2026, 2100]) for (let month = 0; month <= 13; month++) for (const day of [0, 1, 28, 29, 30, 31, 32]) row(`calendar ${year}-${month}-${day}`, () => {
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const valid = month >= 1 && month <= 12 && day >= 1 && day <= lengths[month - 1];
  const result = v._parseDateOnly_(`${year}-${month}-${day}`);
  assert.equal(result !== null, valid);
  if (valid) assert.equal(v._formatDateOnly_(result), `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
});
for (const [input, months, expected] of [['2024-01-31', 1, '2024-02-29'], ['2025-01-31', 1, '2025-02-28'], ['2026-01-31', -1, '2025-12-31'], ['2026-12-31', 2, '2027-02-28'], ['2026-03-31', -13, '2025-02-28'], ['2026-01-15', 0, '2026-01-15']]) row(`month shift ${input}/${months}`, () => assert.equal(v._formatDateOnly_(v._addMonthsToDateOnly_(v._parseDateOnly_(input), months)), expected));
for (const bad of [null, 'bad', new Date(NaN)]) row(`invalid date helpers ${bad}`, () => {
  assert.equal(v._addDaysToDateOnly_(bad, 1), null);
  assert.equal(v._addMonthsToDateOnly_(bad, 1), null);
  assert.equal(v._startOfWeekDateOnly_(bad), null);
  assert.equal(v._resolveWeekdayDate_(bad, 1, 'current_week'), null);
});
for (const policy of ['strict_next_week', 'nearest_future']) for (let anchorDay = 0; anchorDay < 7; anchorDay++) for (let target = 0; target < 7; target++) for (const direction of ['current_week', 'next_week', 'next_week_strict', 'previous_week']) row(`weekday ${policy}/${anchorDay}/${target}/${direction}`, () => {
  context.CONFIG.TEMPORAL_PARSING = { nextWeekdayPolicy: policy };
  const anchor = new Date(2026, 8, 21 + anchorDay, 12); // Monday through Sunday.
  const result = v._resolveWeekdayDate_(anchor, target, direction);
  assert.equal(result.getDay(), target);
  const delta = Math.round((result - anchor) / 86400000);
  const targetMondayIndex = (target + 6) % 7;
  if (direction === 'current_week') assert.equal(delta, targetMondayIndex - anchorDay);
  else if (direction === 'next_week_strict' || direction === 'next_week' && policy === 'strict_next_week') assert.equal(delta, 7 + targetMondayIndex - anchorDay);
  else if (direction === 'previous_week') assert.ok(delta >= -7 && delta <= -1);
  else assert.ok(delta >= 1 && delta <= 7);
});
for (const [unit, expected] of [['giorni', '2026-02-02'], ['settimane', '2026-02-14'], ['mesi', '2026-03-31']]) for (const amount of ['2', 'due']) for (const prefix of ['tra', 'fra', 'in']) row(`relative offset ${prefix}/${amount}/${unit}`, () => {
  const result = v._extractTemporalReferences_(`${prefix} ${amount} ${unit}`, { currentDate: '2026-01-31' });
  assert.equal(result.length, 1);
  assert.equal(v._formatDateOnly_(result[0].normalizedDate), expected);
});
for (const status of ['past', 'future', undefined]) for (const [text, acknowledges] of [
  ['La scadenza è passata.', true], ['The deadline has passed.', true],
  ['La fecha ha pasado.', true], ['La date est passée.', true],
  ['O prazo esta vencido.', true], ['Die Frist ist abgelaufen.', true],
  ['La scadenza non è passata.', false], ['The deadline has not passed.', false],
  ['La scadenza. È passata.', false], ['Grazie per il messaggio.', false]
]) row(`deadline ${status}/${text}`, () => {
  const result = v._checkSacramentalDeadline(text, { sacramentalDeadlineContext: { temporal: { status } } });
  assert.equal(result.checked, status === 'past');
  assert.equal(result.errors.length, Number(status === 'past' && !acknowledges));
});
// Context aliases must forward consistently through the public API.
for (const nested of [false, true]) for (const aliases of [false, true]) row(`public options ${nested}/${aliases}`, () => {
  const validator = context.createResponseValidator();
  let captured;
  validator.validateResponse = (...args) => { captured = args; return 'forwarded'; };
  const temporal = { currentDate: '2026-09-25', currentTime: '12:00' };
  const opts = { ...(nested ? { temporalContext: temporal } : temporal), ...(aliases ? { body: 'body', subject: 'subject' } : { emailContent: 'body', emailSubject: 'subject' }), activeConcerns: ['relational_warmth'] };
  assert.equal(validator.validate('reply', opts), 'forwarded');
  assert.equal(captured[3], 'body'); assert.equal(captured[4], 'subject');
  assert.equal(captured[7].currentDate, '2026-09-25');
  assert.equal(captured[7].validationContext.activeConcerns[0], 'relational_warmth');
});
row('public defaults and stats', () => {
  const validator = context.createResponseValidator();
  validator.validateResponse = (...args) => args;
  assert.equal(validator.validate('reply')[1], 'it');
  assert.equal(validator.getValidationStats().minLength, 25);
});
console.log(`Temporal decision matrices: ${cases} cases passed`);
