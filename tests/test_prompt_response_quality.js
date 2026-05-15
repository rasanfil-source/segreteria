const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.CONFIG = {
  MAX_SAFE_TOKENS: 100000,
  MAX_SAFE_PROMPT_CHARS: 120000,
  KB_TOKEN_BUDGET_RATIO: 0.5,
  PROMPT_ENGINE: { OVERHEAD_TOKENS: 1000 }
};

global.createLogger = () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} });
global.estimateTokenCount = (text) => Math.ceil(String(text || '').length / 4);
global.Utilities = {
  formatDate: () => '2026-03-24'
};

const promptEnginePath = path.join(__dirname, '..', 'gas_prompt_engine.js');
const code = fs.readFileSync(promptEnginePath, 'utf8');
vm.runInThisContext(code, { filename: promptEnginePath });

const engine = new PromptEngine();

console.log('--- Test prompt: contratto qualità sempre presente ---');
const litePrompt = engine.buildPrompt({
  emailSubject: 'Orari Messe',
  emailContent: 'Buongiorno, a che ora sono le Messe domenicali?',
  knowledgeBase: 'Messe domenicali: 9:00 e 11:00.',
  detectedLanguage: 'it',
  promptProfile: 'lite',
  salutationMode: 'full',
  salutation: 'Buongiorno,',
  closing: 'Cordiali saluti,'
});

assert(
  litePrompt.includes('CONTRATTO DI RISPOSTA - CONGRUENZA, GARBO, ESSENZIALITÀ'),
  'il contratto qualità deve essere incluso anche nel profilo lite'
);
assert(
  litePrompt.includes('Soglia massima di informazioni aggiuntive non richieste: ZERO'),
  'il prompt deve vietare informazioni non richieste'
);

console.log('--- Test prompt: formattazione articolata preservata ---');
const formattingPrompt = engine.buildPrompt({
  emailSubject: 'Informazioni catechismo',
  emailContent: 'Buongiorno, potete mandarmi date, documenti e modalità di iscrizione?',
  knowledgeBase: 'Catechismo: iscrizioni dal 1 settembre. Documenti: modulo, certificato di battesimo. Incontri: domenica 10:00.',
  detectedLanguage: 'it',
  promptProfile: 'standard',
  activeConcerns: ['formatting_risk'],
  salutationMode: 'full',
  salutation: 'Buongiorno,',
  closing: 'Cordiali saluti,'
});

assert(
  formattingPrompt.includes('✨ FORMATTAZIONE ELEGANTE E USO ICONE'),
  'il prompt deve mantenere la formattazione elegante con icone'
);
assert(
  formattingPrompt.includes('Domande con risposta articolata') &&
    formattingPrompt.includes('usa titoli e icone'),
  'il prompt deve preservare titoli e icone per risposte articolate'
);

console.log('--- Test prompt: consegna documentale non diventa richiesta requisiti ---');
const attachmentPrompt = engine.buildPrompt({
  emailSubject: 'Invio idoneità padrino',
  emailContent: 'Buongiorno, vi allego il certificato richiesto.',
  knowledgeBase: 'Per informazioni sui padrini sono disponibili percorsi e requisiti.',
  detectedLanguage: 'it',
  promptProfile: 'standard',
  salutationMode: 'full',
  salutation: 'Buongiorno,',
  closing: 'Cordiali saluti,',
  category: 'document_submission',
  attachmentsContext: 'File: idoneita.pdf\nTesto OCR: padrino, madrina, cresima, requisiti, idoneità.',
  attachmentIntentContext: {
    intent: 'document_submission',
    responseDirective: 'Confermare la ricezione della documentazione allegata.'
  }
});

assert(
  attachmentPrompt.includes('STOP') &&
    attachmentPrompt.includes('ALLEGATO = DOCUMENTAZIONE CONSEGNATA') &&
    attachmentPrompt.includes('Risposta predefinita: ringrazia e conferma la ricezione'),
  'il prompt deve indicare una risposta predefinita di ricezione'
);
assert(
  attachmentPrompt.includes('Non elencare i requisiti per fare da padrino/madrina'),
  'il prompt deve bloccare requisiti non richiesti dagli allegati'
);
assert(
  attachmentPrompt.includes('non citare il contenuto OCR nel testo finale'),
  'il prompt deve evitare citazioni OCR non necessarie'
);
assert(
  attachmentPrompt.includes('Se il mittente chiede una conferma, non trasformarla in spiegazione'),
  'il prompt deve preservare la congruenza della risposta'
);

console.log('--- Test prompt: Cresima prerequisito per padrino autorizza guidance mirata ---');
const prerequisitePrompt = engine.buildPrompt({
  emailSubject: 'Cresima per fare da padrino',
  emailContent: 'Buongiorno, ho bisogno della Cresima per fare da padrino al battesimo di mio nipote. Come posso fare?',
  knowledgeBase: 'Cresima adulti: percorso dedicato in parrocchia.',
  detectedLanguage: 'it',
  promptProfile: 'standard',
  salutationMode: 'full',
  salutation: 'Buongiorno,',
  closing: 'Cordiali saluti,',
  sponsorGuidancePolicy: 'cresima_prerequisite_for_sponsor_role'
});

assert(
  prerequisitePrompt.includes('PREREQUISITO CRESIMA') &&
    prerequisitePrompt.includes('avere almeno 16 anni') &&
    prerequisitePrompt.includes('non essere il genitore del battezzando') &&
    prerequisitePrompt.includes('Non parlare di "discernimento pastorale"') &&
    prerequisitePrompt.includes('casistica ordinaria prevista'),
  'il prompt deve autorizzare le condizioni padrino quando la Cresima è prerequisito implicito'
);

console.log('--- Test prompt: data messaggio originale presente per riferimenti relativi ---');
const temporalPrompt = engine.buildPrompt({
  emailSubject: 'Appuntamento',
  emailContent: 'Domani posso passare?',
  knowledgeBase: 'Segreteria aperta dal lunedì al venerdì.',
  detectedLanguage: 'it',
  currentDate: '2026-05-15',
  messageDate: '2026-05-07',
  promptProfile: 'lite'
});

assert(
  temporalPrompt.includes('DATA DI RICEZIONE/INVIO EMAIL: 2026-05-07'),
  'il prompt deve includere la data originale del messaggio per oggi/domani/ieri dell\'utente'
);
assert(
  temporalPrompt.includes('Prima di dire se un evento, corso o celebrazione è futuro') &&
    temporalPrompt.includes('Se la data è successiva alla DATA ODIERNA') &&
    temporalPrompt.includes('non dedurre che l\'evento sia già passato'),
  'il prompt deve formulare l\'obiettivo di confronto temporale senza dipendere da singole frasi tipizzate'
);

console.log('--- Test prompt: orario locale e guardrail anti saluto in continuità ---');
const temporalGuardPrompt = engine.buildPrompt({
  emailSubject: 'Invio documenti',
  emailContent: 'Vi allego i documenti richiesti.',
  knowledgeBase: 'La segreteria conferma la ricezione dei documenti.',
  detectedLanguage: 'it',
  promptProfile: 'lite',
  currentDate: '2026-05-15',
  currentTime: '23:23',
  salutationMode: 'none_or_continuity',
  salutation: '',
  closing: 'Cordiali saluti,'
});

assert(
  temporalGuardPrompt.includes('⏰ ORA ATTUALE LOCALE: 23:23 (Roma, Italia)'),
  'il prompt deve includere l’orario locale corrente'
);
assert(
  temporalGuardPrompt.includes('NON inventare saluti iniziali come "Buongiorno", "Buonasera" o "Salve"'),
  'il prompt deve vietare saluti inventati quando il saluto architetturale è omesso'
);

console.log('✅ Test qualità prompt risposta passati');
