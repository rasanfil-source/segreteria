const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const sandbox = { console, CONFIG: {} };
vm.createContext(sandbox);
require('./helpers/load_thread_components')(sandbox);
for (const file of ['gas_response_strategy.js', 'gas_email_processor.js', 'gas_prompt_engine.js', 'gas_response_validator.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file });
}
const api = vm.runInContext(`({processor: Object.create(EmailProcessor.prototype), engine: Object.create(PromptEngine.prototype), validator: Object.create(ResponseValidator.prototype)})`, sandbox);
const body = 'Buonasera, la ringrazio. Le invio in allegato il modulo per l’iscrizione al corso prematrimoniale in partenza il 3 Ottobre prossimo alle ore 17:30. Dove si terrà il corso?';
const ocr = 'Modulo di iscrizione al corso prematrimoniale. Nome e cognome. Firma. Data del matrimonio.';
const intent = api.processor._deriveAttachmentIntentContext_(body, 'Re: Corso prematrimoniale', [{name: 'modulo.pdf'}], ocr, 'post_ocr');
assert.equal(intent.hasQuestions, true);
assert.equal(intent.categoryHintSource, 'sacrament', 'existing routing preserved');
assert.equal(api.processor._evaluateDocumentConsistency_('', body, [{name: 'modulo.pdf'}], ocr).mode, 'match');
assert.equal(api.processor._evaluateDocumentConsistency_('', body, [{name: 'Corso-di-preparazione-al-Matrimonio.pdf'}], '').mode, 'unknown_received', 'production filename reproduces uncertainty');
const unknownContext = {validationContext: {documentMismatch: {active: true, mode: 'unverified_attachment'}}};
const neutral = api.validator._checkDocumentMismatchTemplate('Abbiamo ricevuto il modulo. Il corso si terrà nella sala indicata dalla segreteria.', unknownContext);
assert.equal(neutral.errors.length, 0, 'uncertainty must not force a resend template');
const unnecessaryResend = api.validator._checkDocumentMismatchTemplate("Abbiamo ricevuto l'allegato, ma non possiamo confermare con certezza che corrisponda al modulo per l'iscrizione al corso prematrimoniale. La invitiamo a verificarlo e, se necessario, a reinviare il file corretto.", unknownContext);
assert(unnecessaryResend.errors.some(error => error.includes('sola incertezza')), 'actual reported response must be rejected');
const falseMismatch = api.validator._checkDocumentMismatchTemplate('L’allegato è sbagliato e non corrisponde.', unknownContext);
assert(falseMismatch.errors.length > 0, 'uncertainty must not be presented as an incorrect document');
let semanticCalls = 0;
let semanticPrompt = '';
api.processor.geminiService = {primaryKey: 'fake', generateResponse: prompt => {
  semanticCalls++;
  semanticPrompt = prompt;
  return '{"consistent":null,"reason":"contenuto insufficiente"}';
}};
assert.equal(api.processor._evaluateAttachmentSemanticConsistency_({body,
  attachmentItems: [{name: 'Corso-di-preparazione-al-Matrimonio.pdf'}],
  ocrText: '\n--- File visivo inviato: Corso-di-preparazione-al-Matrimonio.pdf ---\nRuolo allegato: unknown'}), null);
assert.equal(semanticCalls, 0, 'visual metadata is not PDF content');
assert.equal(api.processor._evaluateAttachmentSemanticConsistency_({body, ocrText: 'Corso di preparazione al matrimonio'}), null);
assert(semanticPrompt.includes('sono equivalenti'));
assert(semanticPrompt.includes('chiaramente estraneo'));
api.processor.geminiService.generateResponse = () => '{"consistent":false,"reason":"catalogo di profumi"}';
assert.equal(api.processor._evaluateAttachmentSemanticConsistency_({body, ocrText: 'Catalogo di profumi e cosmetici'}).consistent, false);
console.log('Attachment follow-up regression tests passed.');
