const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
global.createLogger = () => ({ info() {}, warn() {}, error() {}, debug() {} });
global.CONFIG = { MAX_SAFE_TOKENS: 100000, MAX_SAFE_PROMPT_CHARS: 120000, KB_TOKEN_BUDGET_RATIO: 0.5, PROMPT_ENGINE: { OVERHEAD_TOKENS: 1000 } };
for (const file of ['gas_response_strategy.js', 'gas_prompt_engine.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { filename: file });
}
const engine = new PromptEngine();
const apologies = {
  en: 'We apologize for the delay in responding.',
  es: 'Pedimos disculpas por la demora en nuestra respuesta.',
  fr: 'Nous vous prions de nous excuser pour le retard.',
  de: 'Wir entschuldigen uns für die verspätete Antwort.',
  pt: 'Pedimos desculpas pelo atraso na nossa resposta.'
};
const positiveItalian = /Siamo dispiaciuti per la perdita di suo padre|comprendiamo la delicatezza del momento|considerata la sua situazione|Gentile \[nome\]|Buongiorno\/Buonasera|Ci scusiamo per il ritardo|abbiamo ricevuto la Sua comunicazione/;
for (const lang of [...Object.keys(apologies), 'pl']) {
  const options = {
    detectedLanguage: lang, senderName: 'Alex', emailContent: 'Request.', knowledgeBase: '',
    salutation: '', closing: '', salutationMode: 'full_warm', promptProfile: 'heavy',
    responseDelay: { shouldApologize: true },
    physicalPresenceConstraint: { has_constraint: true, type: 'mobility', visit_policy: 'avoid_invitation' }
  };
  for (const context of [{ category: 'bereavement', topic: 'lutto' }, { category: 'formal', topic: 'sbattezzo', requestType: { type: 'formal', isSbattezzo: true } }]) {
    const prompt = String(engine.buildPrompt({ ...options, ...context }));
    assert(!positiveItalian.test(prompt), `formula italiana positiva in ${lang}/${context.topic}`);
    assert(prompt.includes('Riscrivi ogni elemento nella lingua rilevata'), 'obbligo lingua');
  }
  const apology = engine._renderResponseDelay({ shouldApologize: true }, lang);
  assert(apologies[lang] ? apology.includes(apologies[lang]) : apology.includes('scuse per il ritardo nella lingua della risposta'));
  assert.strictEqual(engine._renderResponseDelay({ shouldApologize: false }, lang), null);
  const warm = engine._renderOutputEnvelopePolicy(lang, 'full_warm', '', '');
  assert(warm.includes('cordiale, rispettoso e sobrio') && warm.includes('saluto temporale fornito'));
  if (lang !== 'en') {
    const formal = engine._renderSbattezzoTemplate('Alex', lang);
    for (const condition of ['verificare nei propri registri', 'Se registrato qui', 'Ordinario Diocesano', 'certificato di Battesimo', 'conseguenze canoniche', 'se la volontà resta confermata', 'decreto', 'Se non registrato qui', 'indicare la parrocchia', 'esito conclusa la verifica', 'fatto storico del sacramento non viene cancellato', 'non appartenere più alla Chiesa cattolica', 'Non aggiungere inviti a telefonare o fissare appuntamenti', '<email>']) {
      assert(formal.includes(condition), `${lang}: procedura incompleta: ${condition}`);
    }
  }
}
assert(engine._renderResponseDelay({ shouldApologize: true }, 'it').includes('Ci scusiamo per il ritardo con cui rispondiamo.'));
assert(engine._renderSbattezzoTemplate('Mario', 'it').includes('Gentile Mario,'));
assert(engine._renderSbattezzoTemplate('Alex', 'en').includes('Dear Alex,'));
assert(engine._renderOutputEnvelopePolicy('it', 'full_warm', '', '').includes('Gentile [nome]'));
const bereavement = engine._renderResponseStructure('bereavement', [], 'lutto');
assert(bereavement.includes('cordoglio sobrio') && bereavement.includes('esplicitata nel messaggio'));
const presence = engine._renderPhysicalPresenceConstraintGuideline({ has_constraint: true, type: 'mobility', visit_policy: 'avoid_invitation' }, null);
assert(presence.includes('Riconosci con naturalezza') && presence.includes('solo se utile') && presence.includes('stigmatizzante'));
for (const [lang, precision] of [['es', 'usa usted, no tú'], ['fr', 'avec le vouvoiement'], ['de', 'Sie-Anrede']]) {
  assert(engine._renderContextualChecklist(lang, null, 'full').includes(precision));
}
// The forced quality contract must survive actual budget omission of the checklist.
CONFIG.MAX_SAFE_TOKENS = 1;
CONFIG.MAX_SAFE_PROMPT_CHARS = 120000;
for (const lang of Object.keys(apologies)) {
  const prompt = engine.buildPrompt({ detectedLanguage: lang, emailContent: 'Request.', knowledgeBase: '', salutation: '', closing: '' });
  assert(!String(prompt).includes('**Schede e moduli di iscrizione:**'), 'checklist deve essere omessa per budget');
  assert(prompt.systemInstruction.includes('Riscrivi ogni elemento nella lingua rilevata'), 'obbligo linguistico forzato');
  assert(!prompt.systemInstruction.includes('DO NOT use ANY Italian words'), 'non ripristinare il divieto assoluto');
}
console.log('OK prompt language hygiene tests');
