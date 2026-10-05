const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const ctx = vm.createContext({ console: quiet, createLogger: () => quiet });
for (const file of ['gas_config.js', 'gas_response_strategy.js', 'gas_request_classifier.js',
  'gas_prompt_context.js', 'gas_prompt_engine.js', 'gas_email_processor.js', 'gas_thread_context.js', 'gas_gmail_service.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
const { engine, processor, Context, thread, gmail } = vm.runInContext(`({engine:new PromptEngine(),
  processor:Object.create(EmailProcessor.prototype), Context:PromptContext, thread:ThreadContext,
  gmail:Object.create(GmailService.prototype)})`, ctx);
processor.config = {};
const base = { emailSubject: 'Informazioni', emailContent: 'Quali documenti servono?',
  knowledgeBase: 'Le procedure richiedono verifica. Non sono previste eccezioni.',
  currentDate: '2026-10-05', detectedLanguage: 'it', promptProfile: 'heavy' };
const formal = { ...base, topic: 'sbattezzo', category: 'formal', requestType: { type: 'formal', isSbattezzo: true } };
for (const type of ['information_request', 'status_update', 'acknowledgment']) {
  const result = engine.buildPrompt({ ...formal, requestPurpose: { type, confidence: .99 } });
  assert(!result.includes('trasmetteremo prontamente la Sua richiesta'), type);
  assert(!result.includes('USA ESATTAMENTE QUESTA STRUTTURA'), type);
}
assert(engine.buildPrompt({ ...formal, requestPurpose: { type: 'operational_request' } }).includes('trasmetteremo prontamente'));
assert(!engine.buildPrompt({ ...formal, salutationMode: 'session', requestPurpose: { type: 'operational_request' } }).includes('trasmetteremo prontamente'));
const canonical = { ...formal, emailContent: 'Sono risposato civilmente e chiedo lo sbattezzo.' };
assert(!engine._hasCanonicalComplexitySignals_(canonical));
assert(!engine.buildPrompt({ ...formal, requestPurpose: { type: 'operational_request' },
  memoryContext: { exists: true, memorySummary: 'Richiesta di sbattezzo già presa in carico.' } }).includes('trasmetteremo prontamente'));
assert(!engine._hasCanonicalComplexitySignals_({ emailContent: 'Sono risposato civilmente. Quali sono gli orari?', memoryContext: { flags: { canonical_complexity: true } } }));
assert(engine._hasCanonicalComplexitySignals_({ emailContent: 'Sono risposato civilmente e vorrei sposarmi in chiesa.' }));

const rows = [
  { Categoria: 'Sacramenti', 'Sotto-tema': 'Eucaristia', 'Principio dottrinale': 'EUCHARIST_SOURCE' },
  { Categoria: 'Sacramenti', 'Sotto-tema': 'Presenza reale', 'Principio dottrinale': 'REAL_PRESENCE_SOURCE' },
  { Categoria: 'Bioetica', 'Sotto-tema': 'Fecondazione assistita', 'Principio dottrinale': 'UNRELATED_SOURCE' },
  { Categoria: 'Sacramenti', 'Sotto-tema': 'Suffragio per i defunti', 'Principio dottrinale': 'SUFFRAGE_SOURCE',
    'Limiti da non superare': 'Non promettere effetti misurabili o automatici.' }
];
const doctrinal = { type: 'doctrinal', needsDoctrine: true, dimensions: { doctrinal: 1, pastoral: 0, technical: 0 } };
for (const profile of ['lite', 'standard', 'heavy']) {
  const eucharist = engine._renderSelectiveDoctrine(doctrinal, 'comunione', 'Qual è il significato della comunione?', '', profile, {}, rows);
  assert(eucharist.includes('EUCHARIST_SOURCE'));
  assert(!eucharist.includes('UNRELATED_SOURCE'));
  const presence = engine._renderSelectiveDoctrine(doctrinal, 'presenza reale di Cristo', 'What does the real presence of Christ mean?', '', profile, {}, rows);
  assert(presence.includes('REAL_PRESENCE_SOURCE'));
  assert(!presence.includes('UNRELATED_SOURCE'));
}
assert.equal(engine._renderSelectiveDoctrine(doctrinal, 'argomento sconosciuto', 'Domanda nuova', '', 'heavy', {}, rows), null);
assert(engine._renderSelectiveDoctrine(doctrinal, 'suffragio per i defunti', '', '', 'heavy', {}, rows).includes('Non promettere effetti misurabili o automatici.'));

const schedule = processor._resolveScheduleContext('Messe del 15 agosto 2027 e del 15 ottobre 2027?',
  'Orario estivo: dal 28 giugno al 29 agosto 2027.', '2026-10-05', 'it');
assert.equal(schedule.targets.length, 2);
assert.equal(schedule.targets[0].season, 'estivo');
assert.equal(schedule.targets[1].season, 'invernale');
const seasonal = engine.buildPrompt({ ...base, scheduleContext: schedule });
assert(seasonal.includes('2027-08-15: estivo; 2027-10-15: invernale'));
assert(!seasonal.includes('Non mostrare mai entrambi'));
assert(!engine._renderSpecialCases().includes('offri programmi flessibili'));
const territory = 'Indirizzo: Via Esterna 1\nRisultato: NON RIENTRA\nIndirizzo: Via Interna 2\nRisultato: RIENTRA';
assert.equal(engine._isNegativeTerritoryContext_(territory), false);
assert.equal(engine._isNegativeTerritoryContext_('Risultato: NON RIENTRA'), true);
const territorial = engine.buildPrompt({ ...base, territoryContext: territory,
  physicalPresenceConstraint: { has_constraint: true, type: 'mobility', visit_policy: 'avoid_invitation' } });
assert(!territorial.includes('territory_non_membership_overrides_remote_handling'));
assert(territorial.includes('Applica ogni esito solo al suo indirizzo'));

const personal = new Context({ email: { body: 'Situazione familiare delicata: quali documenti servono?', detectedLanguage: 'it' },
  classification: { category: 'information', confidence: .99 }, requestType: { type: 'technical' },
  relationalPosture: 'personal', relationalPostureConfidence: .99 });
assert.equal(personal.meta.responseRegister, 'pastoral_supportive');
const routing = thread.routeKnowledge(processor, { effectiveSalutationMode: 'full',
  activeConcerns: personal.concerns, memoryContext: {}, categoryHintSource: 'information',
  routedAiCoreLite: 'LITE_SOURCE', routedAiCore: 'CORE_SOURCE', routedDoctrine: '', routedDoctrineStructured: [],
  buildRuleContext: value => value, result: {}, territoryRequested: false, quickCheckTerritoryCandidates: [], isCertRequest: false });
assert.equal(routing.routedAiCore, 'CORE_SOURCE');
assert.equal(gmail.applyReplacements('Don Paolo prenderà in carico la richiesta.', { 'prenderà in carico': 'ha preso in carico' }),
  'Don Paolo prenderà in carico la richiesta.');
assert.equal(gmail.applyReplacements('Buon giorno', { 'Buon giorno': 'Buongiorno' }), 'Buongiorno');

const { runScenario } = require('./helpers/thread_scenario');
for (const [language, body] of [ ['it', 'Voglio morire, ho bisogno di aiuto.'], ['en', 'I want to kill myself. I need help.'],
  ['fr', 'Je veux me suicider. Aidez-moi.'], ['es', 'Quiero suicidarme.'], ['pt', 'Quero me matar.'], ['de', 'Ich will mich umbringen.'] ]) {
  const result = runScenario(root, { language, body, quick: { classification: { category: 'emotional_support', confidence: .99 } } });
  assert.equal(result.result.reason, 'pastoral_crisis_human_review', language);
  assert(!result.effects.some(([name]) => name === 'generate'), language);
}
for (const body of ['Organizziamo un incontro sulla prevenzione del suicidio. Quali sono gli orari della sala?',
  'Prima mi taglio i capelli, poi passo in segreteria.',
  'Non voglio morire.', "I don't want to kill myself.", 'Je ne veux pas mourir.', 'No quiero morir.', 'Não quero morrer.', 'Ich will nicht sterben.']) {
  assert.equal(new Context({ email: { body }, requestType: { type: 'technical' } }).meta.crisisCritical, false, body);
}
for (const body of ['Soffro di autolesionismo.', 'Sto pensando al suicidio.', 'Sono suicida.', 'Mi faccio del male.']) {
  assert.equal(new Context({ email: { body } }).meta.crisisCritical, true, body);
}
console.log('Prompt policy intersections: purpose, memory, doctrine, dates, territory, posture, substitutions and multilingual review passed');
