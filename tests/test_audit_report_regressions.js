const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({
  console: { log() {}, warn() {}, error() {}, info() {} },
  CONFIG: { VALIDATION_MIN_SCORE: 0.6, SEMANTIC_VALIDATION: { enabled: false } },
  GLOBAL_CACHE: {}
});
for (const file of ['gas_response_strategy.js', 'gas_classifier.js', 'gas_request_classifier.js',
  'gas_gemini_service.js', 'gas_response_validator.js', 'gas_territory_validator.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}

const validator = new ctx.ResponseValidator();
const classifier = new ctx.Classifier();
assert.equal(validator._buildHallucinationSourceContext_('corrente', {}), 'corrente');
assert.equal(validator._buildHallucinationSourceContext_('corrente', {
  userThreadContext: 'numero utente', coverageSources: { attachmentText: 'telefono OCR' }
}), 'corrente\nnumero utente\ntelefono OCR');

assert.equal(ctx.EmailQuickCheckPolicy.normalizeBoolean('sì'), true);
assert.equal(ctx.EmailQuickCheckPolicy.normalizeBoolean('si'), true);
const missingDecision = ctx.EmailQuickCheckPolicy.normalizeDecisionData({ language: 'it' }, { lang: 'it' });
assert.equal(missingDecision.reason, 'quick_check_failed');

// Il contratto semantico della presenza è verificato in test_semantic_presence_contract.js.
const temporal = validator._checkTemporalConsistency(
  'L’incontro del 12 ottobre 2026 si è già tenuto; il prossimo si terrà il 10 novembre 2026.',
  'it', { currentDate: '2026-10-20' });
assert.equal(temporal.score, 1);
assert.equal(validator._checkTemporalConsistency(
  'Se ieri non ha potuto passare, può passare oggi o domani.', 'it', { currentDate: '2026-10-20' }).score, 1);
assert.equal(validator._hasPastTemporalQualification_('La cera pasquale', 'it'), false);
assert.equal(validator._hasPastTemporalQualification_('La Messa è celebrata alle 10', 'it'), false);
assert.equal(validator._checkHallucinations(
  'Il 25.12 la messa è alle 10.30 e il 15.08 alle 11.', 'Messe: 10:30 e 11:00', '', {}).score, 1);

assert.equal(classifier._detectBereavementEvidence_(
  'Ho perso il certificato di battesimo di mio figlio, posso avere un duplicato?'), '');
assert.equal(classifier._detectBereavementEvidence_(
  'Vorrei sapere il motivo della mancata convocazione di mio figlio.'), '');
assert(classifier._detectBereavementEvidence_('Ho perso mio padre la scorsa settimana.'));
assert(classifier._detectBereavementEvidence_('Ieri e\u0300 venuto a mancare mio papa\u0300, chiediamo informazioni per le esequie.'));
assert.equal(classifier._isOutOfOfficeAutoReply('Info orari',
  'Ho ricevuto la vostra risposta automatica ma nessuno mi ha ancora risposto.'), false);
assert.equal(classifier._detectSubIntents('Il giovedì non va bene per noi, possiamo spostare l’incontro?').emotional_distress, undefined);

const civic = validator._checkTerritoryConsistency(
  'Per verificare se la sua via rientra nel territorio parrocchiale, la preghiamo di indicarci il numero civico.',
  { territoryContext: 'CIVICO NECESSARIO' });
assert.equal(civic.score, 1);
assert.equal(validator._checkTerritoryConsistency(
  'Il suo indirizzo rientra nel territorio: ci indichi il numero civico.',
  { territoryContext: 'CIVICO NECESSARIO' }).score, 0);
assert.equal(validator._checkTerritoryConsistency('Your address is within the parish territory.',
  { territoryContext: 'NON RIENTRA' }).score, 0);

const territory = new ctx.TerritoryValidator();
for (const address of ['P.zza San Giovanni 4', 'V.le delle Milizie 10', 'Circonvallazione Cornelia 22']) {
  assert(territory.extractAddressFromText('Abito in ' + address), address);
}

const address = (street, civic, inParish) => ({ street, civic, fullCivic: String(civic),
  verification: { inParish, needsCivic: false } });
assert.equal(validator._checkTerritoryConsistency(
  'Via Gramsci rientra nel territorio. Via Flaminia 20 non rientra.',
  { territoryResult: { addresses: [address('via Antonio Gramsci', 5, true), address('via Flaminia', 20, false)] } }).score, 1);

const deadline = validator._checkSacramentalDeadline(
  'La scadenza di ottobre è ormai trascorsa e non è più possibile rispettarla.',
  { sacramentalDeadlineContext: { temporal: { status: 'past' } } });
assert.equal(deadline.score, 1);

const hallucinations = validator._runValidationChecks(
  'La contatteremo al 3331234567 appena possibile, grazie per la pazienza.', 'it', '', 'full', 'Confermo.', 'Re: info',
  { validationContext: { userThreadContext: 'Il mio numero è 3331234567',
    coverageSources: { attachmentText: 'Telefono: 3331234567' } } });
assert.equal(hallucinations.details.hallucinations.errors.length, 0);
validator._runValidationChecks('Rispondiamo al 3331234567.', 'it', '', 'full', 'Confermo.', 'Re: info',
  { validationContext: { coverageSources: {} } });

console.log('Report audit: regressioni confermate corrette.');
