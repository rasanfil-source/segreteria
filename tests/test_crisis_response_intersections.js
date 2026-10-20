const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runScenario } = require('./helpers/thread_scenario');
const root = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const ctx = vm.createContext({ console: quiet, createLogger: () => quiet });
for (const file of ['gas_config.js', 'gas_response_strategy.js', 'gas_classifier.js',
  'gas_prompt_context.js', 'gas_prompt_engine.js', 'gas_response_validator.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
const { engine, validator, Context } = vm.runInContext(
  '({ engine:new PromptEngine(), validator:new ResponseValidator(), Context:PromptContext })', ctx);

// La crisi non critica arriva alla generazione anche nelle categorie operative.
for (const category of ['sacrament', 'formal', 'document_submission', 'complaint']) {
  const formal = category === 'formal';
  const body = 'Sono a pezzi. ' + (formal ? 'Chiedo lo sbattezzo.' : 'Quali documenti servono?');
  const context = new Context({ email: { body, detectedLanguage: 'it' },
    classification: { category, topic: formal ? 'sbattezzo' : 'battesimo' },
    requestType: { type: formal ? 'formal' : 'technical', isSbattezzo: formal } });
  assert.equal(context.meta.responseRegister, 'pastoral_crisis');
  assert.equal(context.meta.crisisCritical, false);
  const options = { emailContent: body, emailSubject: 'Richiesta', category,
    topic: formal ? 'sbattezzo' : 'battesimo', responseRegister: context.meta.responseRegister,
    responseMode: context.meta.responseMode, activeConcerns: context.concerns,
    requestType: { type: formal ? 'formal' : 'technical', isSbattezzo: formal },
    requestPurpose: { type: 'operational_request' }, currentDate: '2026-10-20',
    knowledgeBase: 'Documenti: modulo e certificato di battesimo.', detectedLanguage: 'it' };
  const prompt = engine.buildPrompt(options);
  assert(prompt.includes('STRUTTURA RISPOSTA (CRISI)'));
  assert(!prompt.includes('STRUTTURA RISPOSTA (FORMALE)'));
  assert(!prompt.includes('STRUTTURA RISPOSTA RACCOMANDATA (SACRAMENTO)'));
  assert(!prompt.includes('**Uso Liste:**'));
  assert(!prompt.includes('1. Accogli con calore'));
  assert(!prompt.includes('USA ESATTAMENTE QUESTA STRUTTURA'));
  if (formal) {
    assert(prompt.includes("all'Ordinario Diocesano"));
    assert(prompt.includes('se la volontà resta confermata'));
    assert(prompt.includes('Rispondi anche alle domande residue'));
  }
  const temporalContext = { validationContext: {
    responseRegister: context.meta.responseRegister, responseMode: context.meta.responseMode, category
  } };
  for (const structure of ['### Documenti\nModulo e certificato.', '1. Modulo\n2. Certificato',
    '* Modulo\n* Certificato', '<ul><li>Modulo</li></ul>']) {
    const response = '<email>Grazie per averci scritto.\n' + structure + '\nRestiamo a disposizione per chiarimenti.</email>';
    const result = validator.validate(response, { language: 'it', emailContent: body, temporalContext });
    assert.equal(result.isValid, false);
    assert(result.details.sensitiveContinuityQuality.violations.includes('sensitive_prose_format'));
  }
  assert.equal(validator._checkSensitiveContinuityQuality(
    'Grazie per averci scritto. Servono il modulo e il certificato di battesimo.',
    body, temporalContext).score, 1);
}
// Il registro formale si valida anche senza concern sensibili.
assert(validator._checkSensitiveContinuityQuality('La invitiamo a ripensarci.', '', {
  validationContext: { responseRegister: 'formal_institutional' }
}).violations.includes('formal_pastoral_contamination'));
assert.equal(validator._checkSensitiveContinuityQuality('1. Modulo\n2. Certificato', '', {
  validationContext: { responseRegister: 'warm_institutional' }
}).score, 1);
const sensitivePrompt = engine.buildPrompt({
  emailContent: 'Sono triste. Quali documenti servono per il battesimo?',
  category: 'sacrament', topic: 'battesimo', subIntents: { emotional_distress: true },
  responseRegister: 'pastoral_supportive', knowledgeBase: 'Servono modulo e certificato.',
  detectedLanguage: 'it', currentDate: '2026-10-20'
});
assert(sensitivePrompt.includes('STRUTTURA RISPOSTA (SENSIBILE)'));
assert(!sensitivePrompt.includes('1. Accogli con calore'));

const setup = (context, services) => {
  vm.runInContext(fs.readFileSync(path.join(root, 'gas_classifier.js'), 'utf8'), context);
  const classifier = new context.Classifier();
  services.classifier.classifyEmail = classifier.classifyEmail.bind(classifier);
  services.classifier._reconcileCurrentSignals_ = classifier._reconcileCurrentSignals_.bind(classifier);
};
const setupClassificationSequence = (context, services, observed) => {
  setup(context, services);
  vm.runInContext(fs.readFileSync(path.join(root, 'gas_request_classifier.js'), 'utf8'), context);
  const classifier = new context.Classifier();
  services.classifier.classifyEmail = (...args) => {
    observed.order.push('initial_classifier');
    const result = classifier.classifyEmail(...args);
    observed.initial = { reason: result.reason, category: result.category };
    return result;
  };
  services.classifier._reconcileCurrentSignals_ = classifier._reconcileCurrentSignals_.bind(classifier);
  const quickCheck = services.geminiService.shouldRespondToEmail;
  services.geminiService.shouldRespondToEmail = (...args) => {
    observed.order.push('gemini_quick_check');
    return quickCheck(...args);
  };
  const requestClassifier = new context.RequestTypeClassifier();
  services.requestClassifier.classify = (...args) => {
    observed.order.push('request_type_classifier');
    const result = requestClassifier.classify(...args);
    observed.requestType = result;
    return result;
  };
};

// La classificazione iniziale conserva l'argomento anche quando il segnale di crisi anticipa il routing.
for (const item of [
  { body: 'Sono a pezzi. Quali documenti servono per la Cresima?', category: 'sacrament', expectedMode: null },
  { body: 'Sono a pezzi. Chiedo lo sbattezzo.', category: 'formal', expectedMode: 'sensitive_canonical' }
]) {
  const observed = { order: [] };
  const result = runScenario(root, {
    body: item.body,
    subject: item.category === 'formal' ? 'Richiesta di sbattezzo' : 'Informazioni Cresima',
    quick: { classification: { topic: item.category === 'formal' ? 'sbattezzo' : 'cresima' } }
  }, { setup(context, services) { setupClassificationSequence(context, services, observed); } });
  const promptOptions = result.effects.find(([event]) => event === 'prompt')[1];
  assert.deepEqual(observed.order, ['initial_classifier', 'gemini_quick_check', 'request_type_classifier']);
  assert.equal(observed.initial.reason, 'pastoral_crisis_detected');
  assert.equal(observed.initial.category, item.category);
  assert.equal(promptOptions.category, item.category);
  assert.equal(promptOptions.responseRegister, 'pastoral_crisis');
  assert.equal(promptOptions.responseMode, item.expectedMode || promptOptions.responseMode);
  assert.equal(result.result.status, 'replied');
}

// La precedenza di revisione critica resta valida anche con una richiesta formale riconosciuta dai classificatori successivi.
{
  const observed = { order: [] };
  const result = runScenario(root, {
    body: 'Voglio morire. Chiedo lo sbattezzo.', subject: 'Richiesta di sbattezzo', quickReject: true,
    quick: { classification: { category: 'formal', topic: 'sbattezzo' } }
  }, { setup(context, services) { setupClassificationSequence(context, services, observed); } });
  assert.deepEqual(observed.order, ['initial_classifier', 'gemini_quick_check', 'request_type_classifier']);
  assert.equal(observed.initial.reason, 'pastoral_crisis_detected');
  assert.equal(observed.initial.category, 'formal');
  assert.equal(observed.requestType.type, 'formal');
  assert.equal(result.result.reason, 'pastoral_crisis_human_review');
  assert(!result.effects.some(([event]) => ['prompt', 'generate', 'send'].includes(event)));
}

const delivery = { attachment: true, ocr: 'Scheda iscrizione Nome: Mario Cognome: Rossi',
  quick: { request_purpose: 'status_update', request_purpose_confidence: .99,
    document_delivery: { expected_document: true, delivery_channel: 'attachment', requires_file_attachment: true } } };
for (const body of [
  'Invio il modulo. Sono a pezzi.',
  'Invio il modulo. Mio padre è morto ieri.',
  'Invio il modulo. Vorrei passare sabato per ritirare il certificato.',
  'Invio il modulo. Passerei sabato in segreteria.',
  'Invio il modulo. A che ora posso venire?',
  'Invio il modulo. Si richiede un documento per la Cresima.'
]) {
  const result = runScenario(root, { ...delivery, body }, { setup });
  assert.equal(result.result.status, 'replied', body);
  assert(result.effects.some(([event]) => event === 'validate'), body);
  assert(result.effects.some(([event, args]) => event === 'generate' && typeof args[0] !== 'string'), body);
}
for (const memory of [{}, { exists: true, contextualFlags: { bereaved: true },
  memorySummary: 'Lutto familiare comunicato in passato.' }]) {
  const result = runScenario(root, { ...delivery, body: 'Invio in allegato la scheda compilata.', memory }, { setup });
  assert.equal(result.result.status, 'replied');
  assert(!result.effects.some(([event]) => event === 'validate'));
  if (memory.exists) {
    assert.equal(result.effects.find(([event]) => event === 'prompt')[1].responseMode, 'longitudinal_tone_only');
  }
}
// Il contratto runtime arriva al validatore reale e impedisce l'invio del formato errato.
let actualValidation;
const invalidFormat = runScenario(root, { body: 'Sono a pezzi. Quali documenti servono?',
  response: '<email>Grazie per averci scritto.\n1. Modulo\n2. Certificato\nRestiamo a disposizione.</email>' }, {
  setup(context, services) {
    setup(context, services);
    vm.runInContext(fs.readFileSync(path.join(root, 'gas_response_validator.js'), 'utf8'), context);
    const actual = new context.ResponseValidator();
    services.validator.validateResponse = (...args) => {
      actualValidation = actual.validateResponse(...args);
      return actualValidation;
    };
  }
});
assert(actualValidation.details.sensitiveContinuityQuality.violations.includes('sensitive_prose_format'));
assert(!invalidFormat.effects.some(([event]) => event === 'send'));
const bodyDelivery = runScenario(root, {
  body: 'Comunico i dati richiesti: Mario Rossi, nato a Roma il 12.03.1980. Grazie.',
  quick: { request_purpose: 'status_update', request_purpose_confidence: .99,
    document_delivery: { expected_document: false, body_contains_filled_document: true,
      delivery_channel: 'body', requires_file_attachment: false } }
}, { setup });
assert.equal(bodyDelivery.result.status, 'replied');
assert(!bodyDelivery.effects.some(([event]) => event === 'validate'));
console.log('Lotto 2: incroci crisi/categoria/validatore e ricevute verificati.');
