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
  MAX_SAFE_TOKENS: 35000,
  KB_TOKEN_BUDGET_RATIO: 0.5
};

global.createLogger = () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} });

const responseStrategyPath = path.join(__dirname, '..', 'gas_response_strategy.js');
vm.runInThisContext(fs.readFileSync(responseStrategyPath, 'utf8'), { filename: responseStrategyPath });

const codePath = path.join(__dirname, '..', 'gas_prompt_engine.js');
const code = fs.readFileSync(codePath, 'utf8');
vm.runInThisContext(code, { filename: codePath });

console.log('--- Test KB semantic truncation budget usage ---');
const engine = new PromptEngine();

const longKb = [
  'PARAGRAFO 1: '.padEnd(340, 'A'),
  'PARAGRAFO 2: '.padEnd(220, 'B'),
  'PARAGRAFO 3: '.padEnd(220, 'C'),
  'PARAGRAFO 4: '.padEnd(220, 'D')
].join('\n\n');

const limit = 400;
const truncated = engine._truncateKbSemantically(longKb, limit);

assert(truncated.length <= limit, `La KB troncata supera il limite: ${truncated.length} > ${limit}`);
assert(
  !truncated.includes('PARAGRAFO 1:'),
  'Una riga che supera il budget disponibile deve essere omessa interamente'
);
assert(
  truncated.includes('[SEZIONI OMESSE') || truncated.includes('...[omesso]') || truncated.endsWith('…'),
  'Manca indicatore di troncamento nel risultato'
);


console.log('--- Test KB semantic truncation preserves paragraph separators ---');
const crlfKb = [
  'PARAGRAFO ALFA: '.padEnd(90, 'A'),
  'PARAGRAFO BETA: '.padEnd(90, 'B'),
  'PARAGRAFO GAMMA: '.padEnd(90, 'C')
].join('\r\n\r\n');
const separated = engine._truncateKbSemantically(crlfKb, 260);

assert(separated.length <= 260, `La KB CRLF troncata supera il limite: ${separated.length} > 260`);
assert(
  separated.includes('PARAGRAFO ALFA') && separated.includes('PARAGRAFO BETA'),
  'La KB troncata dovrebbe mantenere i paragrafi completi quando entrano nel budget'
);
assert(
  separated.includes('A\n\nPARAGRAFO BETA') || separated.includes('A\n\n...'),
  'I paragrafi mantenuti non devono essere collassati senza separatore semantico'
);

console.log('--- Test KB semantic truncation marks first-paragraph cuts ---');
const singleHugeParagraph = 'PARAGRAFO UNICO: ' + 'X'.repeat(1000);
const singleTruncated = engine._truncateKbSemantically(singleHugeParagraph, 180);

assert(singleTruncated.length <= 180, `La KB mono-paragrafo supera il limite: ${singleTruncated.length} > 180`);
assert(
  singleTruncated.includes('[SEZIONI OMESSE') || singleTruncated.includes('...[omesso]') || singleTruncated.endsWith('…'),
  'Il taglio del primo paragrafo deve includere un indicatore di troncamento'
);

console.log('--- Test KB semantic truncation marks ultra-tight cuts ---');
const tinyTruncated = engine._truncateKbSemantically(singleHugeParagraph, 1);

assert(tinyTruncated.length <= 1, `La KB ultra-stretta supera il limite: ${tinyTruncated.length} > 1`);
assert(tinyTruncated === '…', 'Anche con budget minimo deve restare un indicatore di troncamento');

console.log('--- Test KB budget selection uses all requests and preserves complete rows ---');
const structuredKb = [
  'Orari | Orari estivi | La Basilica osserva orari estivi distinti.',
  'Accoglienza | Animali in chiesa | Gli animali non sono normalmente ammessi, salvo cani-guida per persone cieche.',
  ...Array.from({ length: 80 }, (_, index) =>
    `Archivio ${index} | Tema estraneo ${index} | ${'contenuto non pertinente '.repeat(5)}`)
].join('\n');
const selectionContext = {
  emailSubject: 'Accesso e orari',
  emailContent: 'Posso entrare con il cane-guida in Basilica? Quali sono gli orari estivi?',
  topic: 'accesso, orari',
  category: 'operativa',
  requestType: { type: 'operational' }
};
const selectedKb = engine._selectKnowledgeBaseForBudget_(structuredKb, 700, selectionContext);
assert(selectedKb.length <= 700, 'La selezione deve rispettare il budget complessivo');
assert(selectedKb.includes('Orari | Orari estivi | La Basilica osserva orari estivi distinti.'),
  'La risposta pertinente alla seconda domanda deve sopravvivere anche se in fondo alla KB');
assert(selectedKb.includes('Accoglienza | Animali in chiesa | Gli animali non sono normalmente ammessi, salvo cani-guida per persone cieche.'),
  'La riga deve mantenere insieme regola generale ed eccezione');
assert(!selectedKb.includes('Archivio 0 |'),
  'Le righe estranee iniziali non devono precedere quelle pertinenti');
assert(selectedKb.includes('[KB selezionata per le domande correnti'),
  'La selezione parziale deve essere dichiarata al modello');
const quotedTopicKb = [
  'Certificati | Battesimo | Procedura per richiedere un certificato di battesimo.',
  ...Array.from({ length: 70 }, (_, index) =>
    `Archivio ${index} | Tema estraneo ${index} | ${'contenuto non pertinente '.repeat(5)}`),
  'Orari | Basilica estiva | Gli orari estivi della Basilica sono distinti.'
].join('\n');
const currentOnlySelection = engine._selectKnowledgeBaseForBudget_(quotedTopicKb, 500, {
  emailContent: 'Vorrei il certificato di battesimo menzionato nella citazione.',
  knowledgeSelectionText: 'Quali sono gli orari estivi della Basilica?'
});
assert(currentOnlySelection.includes('Orari | Basilica estiva'),
  'La domanda corrente deve indirizzare la selezione anche se il corpo contiene citazioni');
assert(!currentOnlySelection.includes('Certificati | Battesimo'),
  'Un argomento presente solo nella citazione non deve guidare la selezione');

console.log('--- Test prompt integration selects relevant rows from oversized KB ---');
const previousMaxTokens = CONFIG.MAX_SAFE_TOKENS;
const previousRatio = CONFIG.KB_TOKEN_BUDGET_RATIO;
CONFIG.MAX_SAFE_TOKENS = 12000;
CONFIG.KB_TOKEN_BUDGET_RATIO = 0.5;
const oversizedKb = [
  ...Array.from({ length: 220 }, (_, index) =>
    `Archivio ${index} | Tema estraneo ${index} | ${'contenuto non pertinente '.repeat(5)}`),
  'Accoglienza | Animali in chiesa | Gli animali non sono normalmente ammessi, salvo cani-guida per persone cieche.',
  'Orari | Orari estivi | La Basilica osserva orari estivi distinti.'
].join('\n');
const integratedPrompt = engine.buildPrompt({
  emailSubject: 'Accesso e orari',
  emailContent: selectionContext.emailContent,
  knowledgeBase: oversizedKb,
  category: 'operativa',
  topic: 'accesso, orari',
  requestType: { type: 'operational' },
  promptProfile: 'lite',
  detectedLanguage: 'it'
});
assert(integratedPrompt.includes('Orari | Orari estivi | La Basilica osserva orari estivi distinti.'),
  'Il buildPrompt deve usare la selezione anche per il budget reale');
assert(integratedPrompt.includes('cani-guida per persone cieche'),
  'Il buildPrompt deve conservare le eccezioni della procedura pertinente');
assert(!integratedPrompt.includes('Archivio 0 |'),
  'Il buildPrompt non deve conservare solo le righe iniziali della KB');
CONFIG.MAX_SAFE_TOKENS = previousMaxTokens;
CONFIG.KB_TOKEN_BUDGET_RATIO = previousRatio;

console.log('--- Test ThreadContext passes current-message evidence to KB selection ---');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'gas_thread_context.js'), 'utf8'), {
  filename: path.join(__dirname, '..', 'gas_thread_context.js')
});
const promptOptionsResult = ThreadContext.promptOptions({
  _deriveSponsorGuidancePolicy_: () => 'default'
}, {
  runtimeContext: { temporal: { currentDate: '2026-10-20', currentTime: '10:00', messageDate: '2026-10-20' } },
  messageDetails: { subject: 'FW: vecchia richiesta', body: 'citazione lunga', senderName: 'Utente', senderEmail: '' },
  enrichedKnowledgeBase: structuredKb,
  conversationHistory: '',
  categoryHintSource: 'information',
  quickCheck: { classification: { topic: '' } },
  detectedLanguage: 'it',
  scheduleContext: { season: 'invernale' },
  greeting: 'Buongiorno.',
  closing: '',
  classification: { subIntents: {}, messageEvidence: {
    currentSubject: 'Orari estivi',
    currentText: 'Quali sono gli orari della Basilica?',
    quotedText: 'Vorrei un certificato di battesimo.'
  } },
  memoryContext: {},
  effectiveSalutationMode: 'none',
  responseDelay: null,
  promptProfile: 'lite',
  activeConcerns: {},
  concernSynthesis: null,
  continuityCase: null,
  responseMode: 'standard_operational',
  operationalConstraints: [],
  continuityPolicy: null,
  responseRegister: 'warm_institutional',
  territoryContext: null,
  physicalPresenceConstraint: null,
  attachmentIntentContext: null,
  normalizedRelationalPosture: 'direct',
  responseStrategy: 'none',
  requestPurpose: null,
  hasStrongerResponseRoutingSignal: false,
  goalContinuity: 'none',
  goalContinuityConfidence: 0,
  requestType: { type: 'operational' },
  physicalAttachmentsDetected: false,
  textFromAttachments: '',
  hasExpectedDocumentMissing: false,
  bodyContainsUsableDocumentContent: false,
  systemDirectives: [],
  routedAiCoreLite: '',
  routedAiCore: '',
  routedDoctrine: '',
  routedDoctrineStructured: null,
  documentDeliveryModel: null
});
assert(promptOptionsResult.promptOptions.knowledgeSelectionText ===
  'Orari estivi\nQuali sono gli orari della Basilica?',
  'La selezione deve basarsi sulle evidenze correnti e non sul testo citato');

console.log('✅ Test KB truncation passati');
