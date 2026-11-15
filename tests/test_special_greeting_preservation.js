const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
process.env.TZ = 'Europe/Rome';
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const ctx = vm.createContext({ console: quiet, CONFIG: { SEMANTIC_VALIDATION: { enabled: false } } });
for (const file of ['gas_main.js', 'gas_gemini_service.js', 'gas_response_validator.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
}
const service = Object.create(ctx.GeminiService.prototype);
const validator = new ctx.ResponseValidator();
const languages = ['it', 'en', 'es', 'pt', 'fr', 'de'];
const times = ['00:00', '04:59', '05:00', '11:59', '12:00', '13:00', '18:00', '19:00', '23:45'];
const fixed = [
  ['capodanno', 1, 1, 'Buon Capodanno!'], ['epifania', 1, 6, 'Buona Epifania!'],
  ['assunzione', 8, 15, 'Buona festa!'], ['ognissanti', 11, 1, 'Buona festa di Ognissanti!'],
  ['immacolata', 12, 8, 'Buona Immacolata!'], ['natale', 12, 25, 'Buon Natale!']
];
const sundayGreetings = ['Buona domenica.', 'Happy Sunday,', 'Feliz domingo,', 'Feliz domingo,',
  'Bon dimanche,', 'Einen schönen Sonntag,'];
const failures = [];
const counts = { special: 0, sunday: 0, ordinary: 0, fullValidation: 0 };
for (const [year, easterMonth, easterDay, pentecostMonth, pentecostDay, corpusMonth, corpusDay, familyDay, sundayDay]
  of [[2026, 4, 5, 5, 24, 6, 7, 27, 15], [2027, 3, 28, 5, 16, 5, 30, 26, 14]]) {
  const cases = [...fixed, ['pentecoste', pentecostMonth, pentecostDay, 'Buona Pentecoste!'],
    ['corpus_domini', corpusMonth, corpusDay, 'Buona festa!'],
    ['sacra_famiglia', 12, familyDay, 'Buona Festa della Sacra Famiglia.']];
  for (let offset = 0; offset <= 7; offset++) {
    cases.push(['ottava_pasqua_' + offset, easterMonth, easterDay + offset, 'Buona Pasqua!']);
  }
  for (const [kind, month, day, expectedItalian] of cases) {
    for (const language of languages) {
      for (const time of times) {
        const [hour, minute] = time.split(':').map(Number);
        const date = new Date(year, month - 1, day, hour, minute);
        const greeting = service.getAdaptiveGreeting('Maria', language, date).greeting;
        assert(service._getSpecialDayGreeting(date, language), `${kind}/${language}: ricorrenza riconosciuta`);
        if (language === 'it') assert.equal(greeting, expectedItalian, kind);
        const text = greeting + '\n\nTesto della risposta.';
        const temporal = { currentDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, currentTime: time };
        const refined = validator._perfezionamentoAutomatico(text, [], language, temporal).text;
        const check = validator._checkTimeBasedGreeting(greeting, language, temporal);
        if (refined !== text || check.warnings.length) failures.push({ year, kind, language, time, greeting, refined });
        counts.special++;
      }
    }
  }
  for (const [index, language] of languages.entries()) {
    for (const time of times) {
      const [hour, minute] = time.split(':').map(Number);
      const greeting = service.getAdaptiveGreeting('Maria', language, new Date(year, 10, sundayDay, hour, minute)).greeting;
      const night = hour < 5 || (hour === 23 && minute >= 30);
      if (night) continue;
      assert.equal(greeting, sundayGreetings[index]);
      const temporal = { currentDate: `${year}-11-${sundayDay}`, currentTime: time };
      const text = greeting + '\n\nTesto della risposta.';
      const refined = validator._perfezionamentoAutomatico(text, [], language, temporal).text;
      if (refined !== text) failures.push({ year, kind: 'domenica', language, time, greeting, refined });
      counts.sunday++;
    }
  }
}
// Le correzioni ordinarie restano efficaci anche quando il saluto richiesto è sbagliato.
for (const [language, wrong, expected] of [
  ['it', 'Buongiorno.', 'Buonasera.'], ['en', 'Good morning,', 'Good evening,'],
  ['es', 'Buenos días,', 'Buenas noches,'], ['pt', 'Bom dia,', 'Boa noite,'],
  ['fr', 'Bonjour,', 'Bonsoir,'], ['de', 'Guten Morgen,', 'Guten Abend,']
]) {
  assert.equal(validator._ottimizzaSalutoTemporale(wrong, language, { currentTime: '20:00' }).toLowerCase(), expected.toLowerCase());
  counts.ordinary++;
}
// La validazione completa applica la rifinitura anche in assenza di errori nel saluto.
for (const greeting of ['Buona domenica.', 'Buona Pentecoste!', 'Buona festa!', 'Buon Natale!']) {
  const text = `${greeting}\n\nLa segreteria riceve il lunedì dalle ore 10:00 alle ore 12:00.\n\nCordiali saluti,\nSegreteria Parrocchia Sant'Eugenio`;
  const result = validator.validateResponse(text, 'it', 'La segreteria riceve il lunedì dalle ore 10:00 alle ore 12:00.',
    'Quali sono gli orari della segreteria?', 'Orari', 'full', true,
    { currentDate: '2026-11-15', currentTime: '19:33' });
  assert.equal(result.isValid, true, JSON.stringify(result.errors));
  const finalText = result.fixedResponse || text;
  if (!finalText.startsWith(greeting)) failures.push({ kind: 'validazione_completa', greeting, refined: finalText });
  counts.fullValidation++;
}
console.log(JSON.stringify({ counts, failures }, null, 2));
if (!process.argv.includes('--audit')) assert.equal(failures.length, 0, 'I saluti propri restano invariati lungo la rifinitura');
