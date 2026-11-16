// Verifica il contratto con giudizi simulati: l'accuratezza del modello richiede il collaudo reale.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runScenario } = require('./helpers/thread_scenario');
const root = path.resolve(__dirname, '..');
const body = 'Vorrei prenotare un posto';
const request = { id: 'r1', need: 'prenotare un posto', evidence: body, role: 'primary' };
const kb = 'Prenotazioni esclusivamente online su https://example.invalid/prenota.';
const response = "Buona domenica. Per prenotare un posto compili il modulo online. Cordiali saluti, Segreteria Parrocchia Sant'Eugenio";
let checked = 0;
function setup() {
  const c = vm.createContext({ console: { log() {}, warn() {}, error() {} }, UrlFetchApp: {},
    CONFIG: { SEMANTIC_VALIDATION: { enabled: true, completenessAlways: true, completenessMode: 'enforce', cacheEnabled: false } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'gas_response_validator.js'), 'utf8'), c);
  const s = new c.SemanticValidator();
  const context = s._prepareCoverageContext_(body, { requestCoverage: { openRequests: [request] } });
  return { c, s, context, v: new c.ResponseValidator() };
}
function payload(changes = {}, rowChanges = {}) {
  return { isValid: true, contentValid: true, confidence: .95, reason: 'Giudizio del modello.',
    hallucinations: { unsupportedClaims: [] }, irrelevantDetails: [],
    presence: { state: 'compatible', reason: 'Nessuno spostamento proposto', requestEvidence: '', responseEvidence: '' },
    coverage: { evaluated: true, requests: [{ ...request, status: 'addressed', procedureStatus: 'supported',
      reason: 'Il modulo è previsto dalla KB.', sourceRef: kb, ...rowChanges }],
    additionalRequests: [], unsupportedExtractedRequests: [], undeterminableReason: null }, ...changes };
}
function parse(env, value, knowledge = kb) {
  return env.s._parseSemanticResponse(JSON.stringify(value), { coverageRequired: true,
    coverageContext: env.context, knowledgeBase: knowledge, responseText: response });
}
// Stati e verdetti discordanti attraversano la stessa chiamata, anche con punteggio deterministico pieno.
for (const procedureStatus of ['supported', 'unsupported', 'uncertain', 'not_applicable']) {
  for (const contentValid of [true, false]) for (const isValid of [true, false]) {
    const env = setup();
    const value = payload({ contentValid, isValid }, { procedureStatus });
    const result = parse(env, value);
    const approved = contentValid && isValid && ['supported', 'not_applicable'].includes(procedureStatus);
    assert.equal(result.isValid, approved, `${procedureStatus}/${contentValid}/${isValid}`);
    if (procedureStatus === 'unsupported') {
      assert.equal(result.contentValid, false);
      assert.equal(result.details.unsupportedClaims.length, 1);
    }
    let calls = 0;
    env.v.semanticValidator._generateSemantic = prompt => {
      calls++;
      assert(prompt.includes('procedureStatus=supported'));
      return JSON.stringify(value);
    };
    env.v.semanticValidator.validateThinkingLeak = () => assert.fail('Nessuna chiamata ulteriore per il nuovo giudizio');
    env.v._runValidationChecks = () => ({ isValid: true, score: 1, errors: [], warnings: [],
      details: { hallucinations: { score: 1, errors: [] }, exposedReasoning: { score: 1, errors: [] } } });
    const final = env.v.validateResponse(response, 'it', kb, body, 'Prenotazione', 'full', false,
      { validationContext: { requestCoverage: { openRequests: [request] } } });
    assert.equal(calls, 1);
    assert.equal(final.isValid, approved);
    if (procedureStatus === 'uncertain') assert.equal(final.pendingSemanticReview, 'semantic_context_insufficient');
    if (contentValid && !isValid && ['supported', 'not_applicable'].includes(procedureStatus)) {
      assert.equal(final.pendingSemanticReview, 'semantic_contract_error');
    }
    checked++;
  }
}
// La presenza di tutte le parole non verifica una citazione con significato opposto.
for (const [knowledge, reference] of [
  ['Raccogliamo prenotazioni via email.', 'Non raccogliamo prenotazioni via email.'],
  ['Il ritiro è consentito al richiedente. La delega riguarda altri servizi.', 'Il ritiro è consentito al delegato.'],
  [kb, 'Il modulo di iscrizione telematico è obbligatorio.'], [kb, ''],
  [kb, 'Prenotazioni esclusivamente online su https://example.invalid/altro.']
]) {
  const env = setup();
  const result = parse(env, payload({}, { status: 'explicit_limit_service', sourceRef: reference }), knowledge);
  // L'inclusione letterale verifica soltanto la citazione: il significato resta un giudizio del modello.
  const exact = reference && knowledge.toLowerCase().includes(reference.toLowerCase());
  assert.equal(result.coverageState, exact ? 'complete' : 'undeterminable');
  assert.equal(result.coverage.requests[0].sourceRefVerified, Boolean(exact));
  checked++;
}
// Una negazione contraria alla fonte viene respinta dal giudizio semantico anche se ne cita le parole esatte.
for (const knowledge of ['Raccogliamo prenotazioni via email.', 'Non raccogliamo prenotazioni via email.']) {
  const env = setup();
  const result = parse(env, payload({}, { procedureStatus: 'unsupported', sourceRef: knowledge,
    reason: 'La risposta attribuisce al canale email il significato opposto a quello della KB.' }), knowledge);
  assert.equal(result.isValid, false);
  assert.equal(result.contentValid, false);
  checked++;
}
// Procedure e prove visive hanno fonti indipendenti nella stessa voce.
{
  const env = setup();
  env.context = env.s._prepareCoverageContext_('Leggete la foto allegata.', {
    attachments: [{ getName: () => 'richiesta.png' }], requestCoverage: { openRequests: [{ ...request, source: 'attachment' }] } });
  const value = payload({}, { sourceRef: 'richiesta.png', procedureSourceRef: kb });
  assert.equal(parse(env, value).isValid, true);
  value.coverage.requests[0].procedureSourceRef = 'Procedura non citata nella KB';
  assert.equal(parse(env, value).coverageState, 'undeterminable');
  checked++;
}
// Contratti incompleti, tipi impropri e stati incompatibili non diventano approvazioni.
for (const mutate of [
  p => delete p.coverage.requests[0].procedureStatus,
  p => p.coverage.requests[0].procedureStatus = 'autorizzato',
  p => p.coverage.requests[0].reason = '',
  p => Object.assign(p.coverage.requests[0], { status: 'explicit_limit_service', procedureStatus: 'not_applicable' })
]) {
  const env = setup(), value = payload(); mutate(value);
  assert.equal(parse(env, value).coverageState, 'contract_error');
  checked++;
}
for (const contentValid of ['false', 'true', null, 0, 1, {}]) {
  assert.throws(() => parse(setup(), payload({ contentValid })), { code: 'SEMANTIC_CONTRACT_ERROR' });
  checked++;
}
// Il giudizio esplicito sul contenuto vale anche quando la copertura non è richiesta.
assert.equal(setup().s._parseSemanticResponse(JSON.stringify(payload({ contentValid: false }))).isValid, false);
checked++;
// Una citazione incerta e un disaccordo arrivano al blocco invio del thread, senza rigenerazioni aggiuntive.
for (const rowChanges of [{ sourceRef: 'Parafrasi non verificabile' }, { procedureStatus: 'uncertain' }]) {
  const env = setup();
  let calls = 0;
  env.v.semanticValidator._generateSemantic = () => { calls++; return JSON.stringify(payload({}, rowChanges)); };
  const out = runScenario(root, { body }, { setup(c, services) {
    services.validator.validateResponse = (...args) => env.v.validateResponse(...args);
  } });
  assert.equal(out.result.status, 'validation_review');
  assert.equal(out.result.reason, 'semantic_context_insufficient');
  assert.equal(out.effects.some(([event]) => event === 'send'), false);
  assert.equal(calls, 1);
  checked++;
}
console.log(`Contratto procedurale semantico: ${checked} prove superate; un solo controllo del modello per risposta.`);
