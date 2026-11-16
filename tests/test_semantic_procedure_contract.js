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
  const logs = [];
  const c = vm.createContext({ console: { log(...args) { logs.push(args.join(' ')); }, warn() {}, error() {} }, UrlFetchApp: {},
    CONFIG: { SEMANTIC_VALIDATION: { enabled: true, completenessAlways: true, completenessMode: 'enforce', cacheEnabled: false } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'gas_response_validator.js'), 'utf8'), c);
  const s = new c.SemanticValidator();
  const context = s._prepareCoverageContext_(body, { requestCoverage: { openRequests: [request] } });
  return { c, s, context, logs, v: new c.ResponseValidator() };
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
// Il modello giudica la procedura, mentre il codice registra soltanto il riscontro letterale.
for (const reference of [kb, 'Il modulo di iscrizione telematico è obbligatorio.', 'Prenotazione mediante modulo online']) {
  const env = setup();
  const result = parse(env, payload({}, { sourceRef: reference }));
  assert.equal(result.coverageState, 'complete');
  assert.equal(result.isValid, true);
  assert.equal(result.contentValid, true);
  assert.equal(result.coverage.requests[0].sourceRefVerified, kb.includes(reference));
  assert.equal(result.coverage.itemsDiag[0].reclassified, false);
  checked++;
}
// Negazioni, condizioni ed eventi errati sono rilievi semantici, anche con citazioni letterali.
for (const knowledge of [
  'Raccogliamo prenotazioni via email.', 'Non raccogliamo prenotazioni via email.',
  'Il ritiro è consentito solo al richiedente.',
  'Il modulo https://example.invalid/altro è riservato al concerto, non alla proiezione.'
]) {
  const env = setup();
  const result = parse(env, payload({}, { procedureStatus: 'unsupported', sourceRef: knowledge,
    status: 'missing', reason: 'La procedura proposta contraddice il canale, le condizioni o l’evento della fonte.' }), knowledge);
  assert.equal(result.isValid, false);
  assert.equal(result.contentValid, false);
  assert.equal(result.coverageState, 'missing');
  checked++;
}
for (const [knowledge, reference] of [[kb, ''], ['', 'Iscrizione online.']]) {
  const result = parse(setup(), payload({}, { sourceRef: reference }), knowledge);
  assert.equal(result.coverageState, 'undeterminable');
  assert.equal(result.contentValid, true);
  assert.equal(result.coverage.itemsDiag[0].reclassificationReason, 'missing_procedure_source');
  checked++;
}
// Procedure e prove visive hanno fonti indipendenti nella stessa voce.
{
  const env = setup();
  env.context = env.s._prepareCoverageContext_('Leggete la foto allegata.', {
    attachments: [{ getName: () => 'richiesta.png' }], requestCoverage: { openRequests: [{ ...request, source: 'attachment' }] } });
  const value = payload({}, { sourceRef: 'richiesta.png', procedureSourceRef: kb });
  assert.equal(parse(env, value).isValid, true);
  value.coverage.requests[0].procedureSourceRef = 'Le iscrizioni si effettuano attraverso il modulo online';
  assert.equal(parse(env, value).isValid, true);
  assert.equal(parse(env, value).coverage.itemsDiag[0].sourceRefVerified, false);
  value.coverage.requests[0].procedureSourceRef = '';
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
// Fonti assenti, giudizi incerti e verdetti discordanti bloccano l'invio senza rigenerazioni aggiuntive.
for (const [changes, rowChanges, reason] of [
  [{}, { sourceRef: '' }, 'semantic_context_insufficient'],
  [{}, { procedureStatus: 'uncertain' }, 'semantic_context_insufficient'],
  [{ isValid: false }, { sourceRef: 'Citazione parafrasata' }, 'semantic_contract_error']
]) {
  const env = setup();
  let calls = 0;
  env.v.semanticValidator._generateSemantic = () => { calls++; return JSON.stringify(payload(changes, rowChanges)); };
  const out = runScenario(root, { body }, { setup(c, services) {
    services.validator.validateResponse = (...args) => env.v.validateResponse(...args);
  } });
  assert.equal(out.result.status, 'validation_review');
  assert.equal(out.result.reason, reason);
  assert.equal(out.effects.some(([event]) => event === 'send'), false);
  assert.equal(calls, 1);
  checked++;
}
// Il canale autorizzato con citazione parafrasata supera anche il percorso del thread.
{
  const env = setup(); let calls = 0;
  env.v.semanticValidator._generateSemantic = () => { calls++; return JSON.stringify(payload({}, { sourceRef: 'Il modulo online è il canale previsto.' })); };
  const out = runScenario(root, { body }, { setup(c, services) {
    services.validator.validateResponse = (...args) => env.v.validateResponse(...args);
  } });
  assert.equal(out.result.status, 'replied');
  assert.equal(out.effects.filter(([event]) => event === 'send').length, 1);
  assert.equal(calls, 1);
  checked++;
}
// Il riepilogo pubblico esclude gli identificativi e le motivazioni libere, anche con cache pregresse.
for (const [procedureStatus, status, originalEvidence, expectedStatus, expectedCode] of [
  ['supported', 'addressed', body, 'addressed', ''],
  ['uncertain', 'addressed', body, 'undeterminable', 'uncertain_procedure'],
  ['uncertain', 'undeterminable', body, 'undeterminable', ''],
  ['unsupported', 'missing', body, 'missing', ''],
  ['supported', 'addressed', 'Estratto non presente nella richiesta', 'undeterminable', 'unverified_request_evidence']
]) {
  const env = setup();
  const privateText = 'Nome Privato riservato@example.invalid';
  const privateRequest = { ...request, id: privateText, need: privateText, evidence: originalEvidence };
  const value = payload({}, { ...privateRequest, status, procedureStatus,
    reason: privateText, sourceRef: 'Iscrizione attraverso il modulo online.' });
  env.v.semanticValidator._generateSemantic = () => JSON.stringify(value);
  const result = env.v.validateResponse(response, 'it', kb, body, 'Prenotazione', 'full', false,
    { validationContext: { requestCoverage: { openRequests: [privateRequest] } } });
  const log = env.logs.find(line => line.startsWith('SEMANTIC_COVERAGE '));
  assert(log);
  const summary = JSON.parse(log.slice('SEMANTIC_COVERAGE '.length));
  assert.equal(summary.requests, undefined);
  assert.equal(summary.rawContentValid, true);
  assert.equal(summary.finalContentValid, procedureStatus !== 'unsupported');
  assert.equal(log.includes(privateText), false);
  assert.equal(log.includes('Iscrizione attraverso'), false);
  assert.deepEqual(summary.itemsDiag[0], {
    idx: 0, rawStatus: status, normalizedStatus: expectedStatus, procedureStatus,
    sourceRefPresent: true, sourceRefVerified: false,
    procedureAuthorized: procedureStatus === 'supported' ? true : procedureStatus === 'unsupported' ? false : null,
    reclassified: status !== expectedStatus, reclassificationReason: expectedCode
  });
  assert.equal(result.details.coverage.evaluation.requests[0].id, privateText, 'Il risultato mantiene i dettagli utili alla revisione');
  checked++;
}
{
  const env = setup();
  const row = { id: 'id-riservato', reason: 'testo-riservato', status: 'missing', rawStatus: 'testo-riservato',
    reclassifiedFrom: 'addressed', reclassificationReason: 'testo-riservato', procedureStatus: 'testo-riservato',
    sourceRef: 'citazione-riservata', sourceRefVerified: 'testo-riservato', procedureAuthorized: 'testo-riservato' };
  const result = JSON.stringify(env.c.buildCoverageItemDiagnostics_([row]));
  for (const secret of ['id-riservato', 'testo-riservato', 'citazione-riservata']) assert(!result.includes(secret));
  checked++;
}
console.log(`Contratto procedurale semantico: ${checked} prove superate; un solo controllo del modello per risposta.`);
