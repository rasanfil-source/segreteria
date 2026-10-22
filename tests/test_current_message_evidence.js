// Verifica il passaggio dal testo corrente ai segnali, al contesto e alla memoria.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const silent = { log() {}, warn() {}, error() {}, info() {} };
const ctx = vm.createContext({ console: silent, createLogger: () => silent, CONFIG: {}, GLOBAL_CACHE: {} });
const load = (context, file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
for (const file of ['gas_classifier.js', 'gas_prompt_context.js', 'gas_prompt_engine.js',
  'gas_email_processor.js', 'gas_gmail_service.js', 'gas_response_strategy.js', 'gas_gemini_service.js']) load(ctx, file);
const classifier = new ctx.Classifier();
const processor = Object.create(ctx.EmailProcessor.prototype);
const engine = new ctx.PromptEngine();
const gmail = Object.create(ctx.GmailService.prototype);
function interpret(body, subject = 'Informazioni', signals = []) {
  const local = classifier.classifyEmail(subject, body);
  const classification = classifier._reconcileCurrentSignals_(local, subject, body, signals);
  const context = new ctx.PromptContext({ email: { body, subject, detectedLanguage: 'it' }, classification,
    requestType: { type: 'technical' } });
  const flags = processor._deriveContextualFlagsUpdate_({ classification });
  return { local, classification, context, flags };
}

for (const body of ['Non sono in lutto. Vorrei sapere che cosa significa la parola defunto nella liturgia.',
  'Vorrei conoscere il significato del funerale nella liturgia.', 'Mio padre non è morto.',
  'Il mio computer è morto. Potete mandarmi il modulo?', 'I am not bereaved. What does funeral mean?',
  'Ho perso il mio certificato.', 'I lost my document.', 'Se mio padre fosse morto, quali documenti servirebbero?']) {
  const { classification, context, flags } = interpret(body);
  assert(!classification.subIntents.bereavement, body);
  assert.notEqual(context.meta.responseMode, 'bereavement', body);
  assert(!flags.bereaved, body);
}
for (const body of ['Mio padre è morto.', 'È venuta a mancare mia madre.', 'È venuto a mancare il nonno.',
  'È morto mio suocero.', 'È mancata mia cognata.', 'È scomparso il coniuge.', 'È morto mio nipote.', 'Sono in lutto.',
  'Ho perso mia moglie.', 'My father passed away.', 'Non sono in crisi, ma mio marito è morto.',
  'Non sono in crisi: mio marito è morto.', 'È mancata la mamma.', 'È morto papà.',
  'C’è un lutto in famiglia.']) {
  const { classification, context, flags } = interpret(body);
  assert(classification.subIntents.bereavement, body);
  assert.equal(context.meta.responseMode, 'bereavement', body);
  assert(flags.bereaved, body);
}
assert.equal(classifier._detectBereavementEvidence_('È morto Papa Francesco.'), '',
  'il riferimento a un Papa non deve diventare lutto personale del mittente');
const loss = 'Mio marito è morto ieri. Ho parlato con don Paolo per il funerale. Sono disperata.';
const grief = interpret(loss);
assert(grief.local.subIntents.bereavement);
assert(grief.local.subIntents.prior_oral_communication.detected);
assert.equal(grief.local.subIntents.prior_oral_communication.mentioned_contact, 'don Paolo');
assert.equal(grief.context.meta.responseRegister, 'pastoral_crisis');
assert.equal(grief.context.meta.responseMode, 'bereavement');
assert(grief.flags.bereaved);

const oldQuote = 'Ora sto bene. Quali sono gli orari?\n\nIl giorno 1 ottobre 2026 Mario ha scritto:\n> Voglio morire. Mio padre è morto.';
const historical = interpret(oldQuote, 'Re: Voglio morire');
assert.equal(historical.context.meta.crisisCritical, false);
assert.equal(historical.context.meta.responseRegister, 'warm_institutional');
assert(!historical.flags.bereaved);
assert(historical.classification.messageEvidence.quotedText.includes('Voglio morire'));
assert(historical.context.input.email.originalBody.includes('Voglio morire'));
for (const body of ['Organizziamo un incontro sul trauma. Quali sono gli orari della sala?',
  'Qual è il significato della frase "voglio morire"?', 'Non sono in crisi e non sono disperata.',
  'Non ho un attacco di panico.', 'Sono in crisi con il modulo.', 'Non ce la faccio più a compilare il modulo.']) {
  assert.notEqual(interpret(body).context.meta.responseRegister, 'pastoral_crisis', body);
}
for (const body of ['Sono a pezzi.', 'Sto crollando.', 'Ho un attacco di panico.', 'Ho subito un trauma. Aiutatemi.']) {
  assert.equal(interpret(body).context.meta.responseRegister, 'pastoral_crisis', body);
}
const currentRisks = ['Voglio morire.', 'Non so più come andare avanti.', 'Soffro di autolesionismo.',
  'Ho letto un articolo e voglio morire.',
  'Mio figlio vuole suicidarsi.', 'I want to kill myself.', 'My son wants to kill himself.',
  'Je veux me suicider.', 'Quiero suicidarme.', 'Quero me matar.', 'Ich will mich umbringen.'];
for (const body of currentRisks) assert.equal(interpret(body).context.meta.crisisCritical, true, body);

const inline = 'Grazie.\n\nIl giorno 1 ottobre 2026 Mario ha scritto:\nEcco le indicazioni.\n- Vorrei fissare un appuntamento.';
assert.equal(classifier.classifyEmail('Re: Informazioni', inline).reason, 'ambiguous_inline_reply');
assert(classifier._extractMessageEvidence_(inline).ambiguousText.includes('Vorrei fissare'));
assert(!classifier._extractMessageEvidence_(inline).currentText.includes('Vorrei fissare'));
assert(gmail._extractCurrentMessageBody_(inline, '').includes('Vorrei fissare'));
const quotedRequest = 'Grazie.\n\nIl giorno 1 ottobre 2026 Mario ha scritto:\nVorrei fissare un appuntamento.';
assert.equal(classifier.classifyEmail('Re: Informazioni', quotedRequest).shouldReply, false);
assert.equal(classifier.classifyEmail('Re: Informazioni', inline.replace('Ecco le indicazioni.', '> Ecco le indicazioni.')).shouldReply, true);
const topPostedAcknowledgment = [
  'Grazie mille!',
  '',
  'Il giorno 19 ottobre 2026 alle 10:00 Maria <maria@example.org> ha scritto:',
  '',
  'La segreteria risponde dal lunedì al venerdì.',
  '',
  'Vorrei sapere quali documenti servono?'
].join('\n');
assert.equal(classifier.classifyEmail('Re: Informazioni', topPostedAcknowledgment).reason,
  'ultra_simple_acknowledgment', 'un ringraziamento in testa deve prevalere sulle domande dello storico ambiguo');
assert.equal(classifier.classifyEmail('Automatic reply: Fuori ufficio', topPostedAcknowledgment).reason,
  'out_of_office_auto_reply', 'la rilevazione OOO deve precedere la gestione dello storico ambiguo');
const emptyCurrentAmbiguous = [
  'Il giorno 19 ottobre 2026 alle 10:00 Maria <maria@example.org> ha scritto:',
  '',
  'La segreteria risponde dal lunedì al venerdì.',
  '',
  'Vorrei fissare un appuntamento.'
].join('\n');
const ambiguousWithoutCurrentText = classifier.classifyEmail('Re: Informazioni', emptyCurrentAmbiguous);
assert.equal(ambiguousWithoutCurrentText.reason, 'ambiguous_inline_reply');
assert(ambiguousWithoutCurrentText.category,
  'quando il testo corrente è vuoto, la categoria deve usare l’evidenza della risposta intercalata');

const semanticLoss = 'Depuis le décès de mon époux, je cherche du soutien.';
assert(interpret(semanticLoss, 'Informazioni', [{ kind: 'bereavement', text: semanticLoss }]).flags.bereaved);
const normalized = ctx.EmailQuickCheckPolicy.normalizeDecisionData({ reply_needed: true, language: 'fr',
  current_signals: [{ kind: 'bereavement', text: semanticLoss }, { kind: 'invented', text: semanticLoss },
    { kind: 'bereavement', text: true }, { kind: 'critical', text: 'x'.repeat(301) }] }, { lang: 'fr' });
assert.equal(normalized.current_signals.length, 1);
assert.equal(normalized.current_signals[0].text, semanticLoss);
for (const [body, signal] of [[oldQuote, { kind: 'critical', text: 'Voglio morire.' }],
  ['Non sono in lutto.', { kind: 'bereavement', text: 'Non sono in lutto.' }],
  ['Mio padre non è morto.', { kind: 'bereavement', text: 'Mio padre non è morto.' }],
  ['Quali orari?', { kind: 'bereavement', text: 'Mio padre è morto.' }]]) {
  assert.equal(interpret(body, 'Re: Informazioni', [signal]).classification.currentSignals.length, 0);
}
const accentedContrast = 'Non è morto mio padre, però è morto mio zio.';
const reconciledAccentedContrast = interpret(accentedContrast, 'Informazioni', [
  { kind: 'bereavement', text: 'però è morto mio zio.' }
]).classification;
assert.equal(reconciledAccentedContrast.currentSignals.length, 1,
  'il contrasto con però deve separare la negazione precedente dalla perdita affermata');
const noRefresh = processor._deriveContextualFlagsUpdate_({ existingFlags: { bereaved: true, _evidence: { bereaved: '2026-01-01' } },
  classification: historical.classification });
assert.equal(noRefresh._evidence.bereaved, '2026-01-01');
assert(noRefresh.bereaved);
assert(interpret('Buongiorno', 'Mio padre è morto').flags.bereaved);
for (const prefix of ['Re:', 'AW:', 'SV:', 'Rif - ', 'Fwd:', 'TR:']) {
  assert.equal(interpret('Quali sono gli orari?', prefix + ' Voglio morire').context.meta.crisisCritical, false);
}

for (const body of ['Non sono divorziato né separato e vorrei sposarmi in chiesa.',
  'Sono separata e vorrei una copia del certificato del mio matrimonio.',
  'Quali sono gli orari?\n> Sono divorziato e vorrei sposarmi in chiesa.']) {
  assert.equal(engine._hasCanonicalComplexitySignals_({ emailContent: body }), false, body);
}
assert(engine._hasCanonicalComplexitySignals_({ emailContent: 'Sono divorziato e vorrei risposarmi in chiesa.' }));
assert(engine._hasCanonicalComplexitySignals_({ emailContent: 'Sono divorziato. Quali documenti servono per il matrimonio?' }));

const { runScenario } = require('./helpers/thread_scenario');
const setup = (context, services) => {
  load(context, 'gas_classifier.js');
  const actual = new context.Classifier();
  services.classifier.classifyEmail = actual.classifyEmail.bind(actual);
  services.classifier._reconcileCurrentSignals_ = actual._reconcileCurrentSignals_.bind(actual);
};
for (const body of currentRisks) {
  const run = runScenario(root, { body }, { setup });
  assert.equal(run.result.reason, 'pastoral_crisis_human_review', body);
  assert(!run.effects.some(([name]) => name === 'generate'), body);
}
const normalRun = runScenario(root, { body: oldQuote, subject: 'Re: Voglio morire' }, { setup });
assert.equal(normalRun.result.status, 'replied');
const rejectedInline = runScenario(root, { body: inline, subject: 'Re: Informazioni', quickReject: true }, { setup });
assert.equal(rejectedInline.result.status, 'filtered');
assert(!rejectedInline.effects.some(([name]) => name === 'generate'));
const acceptedInline = runScenario(root, { body: inline, subject: 'Re: Informazioni' }, { setup });
assert.equal(acceptedInline.result.status, 'replied');
assert(acceptedInline.effects.find(([name]) => name === 'prompt')[1].emailContent.includes('Vorrei fissare'));
const ambiguousRisk = inline.replace('Vorrei fissare un appuntamento.', 'Vorrei parlare con qualcuno, voglio morire.');
assert.equal(interpret(ambiguousRisk).context.meta.crisisCritical, false);
const resolvedRisk = runScenario(root, { body: ambiguousRisk, quick: { current_signals: [
  { kind: 'critical', text: 'Vorrei parlare con qualcuno, voglio morire.' }] } }, { setup });
assert.equal(resolvedRisk.result.reason, 'pastoral_crisis_human_review');
const rejectedRisk = runScenario(root, { body: 'Voglio morire.', quickReject: true }, { setup });
assert.equal(rejectedRisk.result.reason, 'pastoral_crisis_human_review');
const newSubjectRisk = runScenario(root, { body: 'Vorrei parlare con qualcuno.', subject: 'Voglio morire', history: true }, { setup });
assert.equal(newSubjectRisk.result.reason, 'pastoral_crisis_human_review');
const lossRun = runScenario(root, { body: loss }, { setup });
const options = lossRun.effects.find(([name]) => name === 'prompt')[1];
assert(options.subIntents.bereavement && options.subIntents.prior_oral_communication.detected);
assert.equal(options.responseMode, 'bereavement');
const update = lossRun.effects.find(([name]) => name === 'memory.update');
assert(update && JSON.stringify(update).includes('"bereaved":true'));
const semanticRun = runScenario(root, { body: semanticLoss,
  quick: { current_signals: [{ kind: 'bereavement', text: semanticLoss }] } }, { setup });
assert.equal(semanticRun.effects.find(([name]) => name === 'prompt')[1].responseMode, 'bereavement');
assert.equal(semanticRun.effects.filter(([name]) => name === 'quickCheck').length, 1);
console.log('Lotto 1: provenienza, segnali compatibili, memoria e revisione umana verificati.');
