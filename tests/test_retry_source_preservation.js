const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const { runScenario } = require('./helpers/thread_scenario');
const root = path.resolve(__dirname, '..');
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
const context = vm.createContext({ console: quiet, createLogger: () => quiet });
for (const file of ['gas_config.js', 'gas_response_strategy.js', 'gas_prompt_engine.js', 'gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const { engine, processor } = vm.runInContext(
  '({engine:new PromptEngine(),processor:Object.create(EmailProcessor.prototype)})', context);
const procedure = 'CERTIFICATO_SOURCE: Il certificato di battesimo può essere inviato via email dopo la verifica nei registri. L’idoneità padrino/madrina richiede presenza personale.';
const filler = Array.from({ length: 80 }, (_, i) => 'Avviso ' + i + ': ' + 'Informazioni sul parcheggio e sui concerti. '.repeat(7)).join('\n\n');
const prompt = engine.buildPrompt({
  emailSubject: 'Certificato di battesimo', emailContent: 'Vorrei il certificato di battesimo via email.',
  knowledgeBase: filler + '\n\n' + procedure + '\n\n' + filler,
  currentDate: '2026-10-20', detectedLanguage: 'it', requestType: { type: 'technical' },
  territoryContext: 'TERRITORY_SOURCE: Via Esempio 10: NON RIENTRA.',
  conversationHistory: 'STORIA_SECONDARIA '.repeat(800)
});
assert(Array.isArray(prompt.retrySources));
assert(!prompt.toString().includes('retrySources'));
const lengthFailure = { isValid: false, score: .7, errors: ['Risposta troppo lunga'],
  details: { length: { errors: ['Risposta troppo lunga'] } } };
const retry = processor._buildCorrectionPrompt(prompt, 'Bozza molto lunga.', lengthFailure, 'it', 'full');
assert(retry.includes(procedure), 'la procedura centrale resta intera anche per un errore di lunghezza');
assert(retry.includes('TERRITORY_SOURCE'));
assert(retry.includes('Vorrei il certificato'));
const grounding = processor._buildRetryGroundingContext_(prompt, 6000);
assert(grounding.length <= 6000);
assert(!grounding.includes('STORIA_SECONDARIA'), 'la storia cede spazio alle fonti');
const runtimeRetrySources = [
  { origin: 'runtime_request', kind: 'request', text: 'RUNTIME_REQUEST: Richiesta attuale.' },
  { origin: 'runtime_knowledge', kind: 'knowledge', text: 'RUNTIME_KNOWLEDGE: Fonte attuale.' },
  { origin: 'runtime_history', kind: 'history', text: 'RUNTIME_HISTORY: Contesto attuale.' }
];
const legacyPromptWithRuntimeSources = [
  '<user_email>LEGACY_REQUEST: Richiesta precedente.</user_email>',
  '<knowledge_base>LEGACY_KNOWLEDGE: Fonte precedente.</knowledge_base>',
  '<conversation_history>LEGACY_HISTORY: Contesto precedente.</conversation_history>'
].join('\n');
const runtimeGrounding = processor._buildRetryGroundingContext_(legacyPromptWithRuntimeSources, 6000, runtimeRetrySources);
for (const marker of ['RUNTIME_REQUEST', 'RUNTIME_KNOWLEDGE', 'RUNTIME_HISTORY']) assert(runtimeGrounding.includes(marker), marker);
for (const marker of ['LEGACY_REQUEST', 'LEGACY_KNOWLEDGE', 'LEGACY_HISTORY']) {
  assert(!runtimeGrounding.includes(marker), marker + ' non deve duplicare fonti runtime già presenti');
}
const additional = processor._buildCorrectionPrompt(prompt, 'Bozza.', lengthFailure, 'it', 'full', {
  retrySources: [...prompt.retrySources,
    { origin: 'validator_extra', kind: 'selected', text: 'VALIDATOR_SOURCE: Certificato rilasciato dopo controllo archivio.' },
    { origin: 'pastoral', kind: 'selected', text: 'PASTORAL_SOURCE: Accogli con sobrietà il dolore espresso.' },
    { origin: 'doctrine', kind: 'selected', text: 'DOCTRINE_SOURCE: Il battesimo è un sacramento.' }],
  temporal: { currentDate: '2026-10-20', messageDate: '2026-10-19', currentTime: '04:37', messageTime: '02:18' }
});
for (const marker of ['VALIDATOR_SOURCE', 'PASTORAL_SOURCE', 'DOCTRINE_SOURCE', '2026-10-20', '2026-10-19']) {
  assert(additional.includes(marker), marker);
}
assert(!additional.includes('04:37') && !additional.includes('02:18'));
assert(additional.length < 16000);
const doctrinal = engine.buildPrompt({
  emailSubject: 'Eucaristia', emailContent: 'Che cosa significa Eucaristia?',
  detectedLanguage: 'it', currentDate: '2026-10-20',
  requestType: { type: 'mixed', needsDoctrine: true, needsDiscernment: true },
  aiCoreLite: 'LITE_SELECTED: Accoglienza sobria.', aiCore: 'CORE_SELECTED: Ascolta le domande espresse.',
  doctrineStructured: [{ Categoria: 'Sacramenti', 'Sotto-tema': 'Eucaristia',
    'Principio dottrinale': 'DOCTRINE_SELECTED: Fonte e culmine della vita cristiana.' }]
});
const pastoralRetry = processor._buildCorrectionPrompt(doctrinal, 'Bozza.', lengthFailure, 'it', 'full');
for (const marker of ['LITE_SELECTED', 'CORE_SELECTED', 'DOCTRINE_SELECTED']) assert(pastoralRetry.includes(marker), marker);
for (const budget of [1000, 3000, 6000, 10000]) {
  const result = processor._buildRetryGroundingContext_(prompt, budget);
  assert(result.length <= budget);
  assert(result.includes(procedure));
}
const oversized = processor._selectRetrySourceUnits_([
  { origin: 'user_email', kind: 'request', text: 'Quale certificato serve?' },
  { origin: 'procedure', kind: 'knowledge', text: 'INIZIO_CONDIZIONE '.repeat(1000) + ' FINE_CONDIZIONE' }
], 1000);
assert(oversized.includes('Fonti parziali'));
assert(!oversized.includes('INIZIO_CONDIZIONE'), 'una procedura troppo grande non viene spezzata');
// La pipeline trasmette le fonti del validatore anche quando il compositore è simulato.
const run = runScenario(root, { retry: true });
const corrections = run.effects.filter(([event, args]) => event === 'generate' &&
  args[0] && typeof args[0] === 'object' && args[0].prompt.includes('CORREZIONE MIRATA'));
assert.equal(corrections.length, 1);
assert.equal(corrections[0][1][0].systemInstruction, 'Persona test');
assert(corrections[0][1][0].prompt.includes('Catechismo: iscrizioni in segreteria.'));
assert(corrections[0][1][0].prompt.includes('quali documenti servono'));
assert.equal(run.result.status, 'replied');
console.log('Lotto 4: fonti centrali, fonti di controllo, priorità, budget e pipeline verificati.');
