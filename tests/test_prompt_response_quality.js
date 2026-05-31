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
  formattingPrompt.includes('FORMATTAZIONE ED EVIDENZIAZIONE'),
  'il prompt deve mantenere le linee guida di formattazione'
);
assert(
  formattingPrompt.includes('Utilizza elenchi puntati con emoji contestuali') &&
    formattingPrompt.includes('Usa titoli Markdown (###)'),
  'il prompt deve preservare titoli e liste per risposte articolate'
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
  attachmentPrompt.includes('Rispondi alla richiesta effettiva, non al tema generale') &&
    attachmentPrompt.includes('Se bastano 1-3 frasi, fermati'),
  'il prompt deve preservare la congruenza della risposta'
);

console.log('--- Test prompt: sospetta consegna senza allegati non diventa ricezione documenti ---');
const noAttachmentFollowupPrompt = engine.buildPrompt({
  emailSubject: 'Re: Richiesta informazioni',
  emailContent: 'Mi dispiace, ma non avete risposto alla mia domanda sull\'opportunità di vestire gli ignudi. Cosa ne pensate?',
  knowledgeBase: 'Caritas: servizio di raccolta indumenti e aiuto alle persone senza fissa dimora.',
  detectedLanguage: 'it',
  promptProfile: 'standard',
  salutationMode: 'none_or_continuity',
  salutation: '',
  closing: 'Cordiali saluti,',
  attachmentsContext: "ATTENZIONE: L'utente NON ha inviato allegati fisici.",
  attachmentIntentContext: {
    intent: 'suspected_submission',
    responseDirective: 'Confermare la ricezione della documentazione allegata.',
    hasPhysicalAttachments: false
  }
});

assert(
  !noAttachmentFollowupPrompt.includes('ALLEGATO = DOCUMENTAZIONE CONSEGNATA') &&
    !noAttachmentFollowupPrompt.includes('Risposta predefinita: ringrazia e conferma la ricezione'),
  'una consegna solo sospetta senza allegati non deve attivare il guardrail di ricezione documentale'
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
  temporalPrompt.includes('Data ricezione/invio email utente:** 2026-05-07'),
  'il prompt deve includere la data originale del messaggio per oggi/domani/ieri dell\'utente'
);
assert(
  temporalPrompt.includes('Papa attuale:** Leone XIV') &&
    temporalPrompt.includes('Non presentare Papa Francesco come Papa attuale'),
  'il prompt deve includere il contesto papale aggiornato e vietare riferimenti presenti a Papa Francesco'
);
const kbDrivenPopePrompt = engine.buildPrompt({
  emailSubject: 'Contesto',
  emailContent: 'Chi è il Papa?',
  knowledgeBase: 'Informazioni di contesto | Papa regnante | Pio XIII',
  detectedLanguage: 'it',
  currentDate: '2026-05-15',
  promptProfile: 'lite'
});
assert(
  kbDrivenPopePrompt.includes('Papa attuale:** Pio XIII'),
  'il prompt deve far prevalere il Papa regnante indicato nella KB/istruzioni sui default tecnici'
);
assert(
  temporalPrompt.includes('Prima di descrivere un evento') &&
    temporalPrompt.includes('confrontalo rigidamente con la data odierna') &&
    temporalPrompt.includes('anno pastorale'),
  'il prompt deve formulare l\'obiettivo di confronto temporale'
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
  temporalGuardPrompt.includes('Ora locale attuale:** 23:23'),
  'il prompt deve includere l’orario locale corrente'
);
assert(
  temporalGuardPrompt.includes('Stile conversazionale') &&
    temporalGuardPrompt.includes('omettendo saluti rituali formali iniziali'),
  'il prompt deve guidare lo stile di continuità quando il saluto architetturale è omesso'
);

console.log('--- Test prompt: maxCharsWhenKbTruncated=0 omette testo allegati quando KB è troncata ---');
{
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  const originalMaxSafeTokens = global.CONFIG.MAX_SAFE_TOKENS;
  const originalPromptEngineConfig = global.CONFIG.PROMPT_ENGINE;
  global.CONFIG.ATTACHMENT_CONTEXT = { maxCharsWhenKbTruncated: 0 };
  global.CONFIG.MAX_SAFE_TOKENS = 10000;
  global.CONFIG.PROMPT_ENGINE = { OVERHEAD_TOKENS: 1000 };

  try {
    const recoverableKb = 'KB_RECOVERY_START ' + 'Informazioni KB molto lunghe. '.repeat(320) + 'KB_RECOVERY_END';
    const zeroAttachmentPrompt = engine.buildPrompt({
      emailSubject: 'Documento',
      emailContent: 'Buongiorno, allego il documento.',
      knowledgeBase: recoverableKb,
      attachmentsContext: 'OCR_ZERO_LIMIT_SHOULD_NOT_APPEAR '.repeat(900),
      detectedLanguage: 'it',
      promptProfile: 'lite',
      salutationMode: 'full',
      salutation: 'Buongiorno,',
      closing: 'Cordiali saluti,'
    });

    assert(
      !zeroAttachmentPrompt.includes('OCR_ZERO_LIMIT_SHOULD_NOT_APPEAR'),
      'maxCharsWhenKbTruncated=0 deve rimuovere il testo OCR quando la KB è troncata'
    );
    assert(
      zeroAttachmentPrompt.includes('KB_RECOVERY_END'),
      'il budget liberato dagli allegati ridotti deve essere recuperato per espandere la KB'
    );
  } finally {
    global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
    global.CONFIG.MAX_SAFE_TOKENS = originalMaxSafeTokens;
    global.CONFIG.PROMPT_ENGINE = originalPromptEngineConfig;
  }
}

console.log('--- Test prompt: contenuto email resta presente anche a budget sezioni esaurito ---');
{
  const originalMaxSafeTokens = global.CONFIG.MAX_SAFE_TOKENS;
  const originalMaxSafePromptChars = global.CONFIG.MAX_SAFE_PROMPT_CHARS;
  const originalPromptEngineConfig = global.CONFIG.PROMPT_ENGINE;
  global.CONFIG.MAX_SAFE_TOKENS = 900;
  global.CONFIG.MAX_SAFE_PROMPT_CHARS = 30000;
  global.CONFIG.PROMPT_ENGINE = { OVERHEAD_TOKENS: 100 };

  try {
    const starvationPrompt = engine.buildPrompt({
      emailSubject: 'Richiesta specifica',
      emailContent: 'EMAIL_CONTEXT_SENTINEL: vorrei sapere come prenotare un certificato.',
      knowledgeBase: 'Informazioni KB molto lunghe. '.repeat(600),
      detectedLanguage: 'it',
      promptProfile: 'lite',
      salutationMode: 'full',
      salutation: 'Buongiorno,',
      closing: 'Cordiali saluti,'
    });

    assert(
      starvationPrompt.prompt.includes('EMAIL_CONTEXT_SENTINEL') &&
        starvationPrompt.prompt.includes('<user_email>') &&
        starvationPrompt.prompt.includes('</user_email>'),
      'il contenuto email deve restare nel prompt anche quando le sezioni opzionali saturano il budget'
    );
  } finally {
    global.CONFIG.MAX_SAFE_TOKENS = originalMaxSafeTokens;
    global.CONFIG.MAX_SAFE_PROMPT_CHARS = originalMaxSafePromptChars;
    global.CONFIG.PROMPT_ENGINE = originalPromptEngineConfig;
  }
}

console.log('--- Test prompt: troncamento fisico preserva recinto user_email ---');
{
  const originalMaxSafeTokens = global.CONFIG.MAX_SAFE_TOKENS;
  const originalMaxSafePromptChars = global.CONFIG.MAX_SAFE_PROMPT_CHARS;

  try {
    global.CONFIG.MAX_SAFE_TOKENS = 100000;
    global.CONFIG.MAX_SAFE_PROMPT_CHARS = 120000;
    const baselinePrompt = engine.buildPrompt({
      emailSubject: 'Baseline',
      emailContent: 'Messaggio breve.',
      knowledgeBase: 'KB breve.',
      detectedLanguage: 'it',
      promptProfile: 'lite'
    });

    global.CONFIG.MAX_SAFE_PROMPT_CHARS = baselinePrompt.systemInstruction.length + 750;
    const truncatedPrompt = engine.buildPrompt({
      emailSubject: 'Email molto lunga',
      emailContent: 'EMAIL_TAG_SENTINEL ' + 'testo lungo '.repeat(1000),
      knowledgeBase: 'KB_PRECEDENTE '.repeat(1000),
      conversationHistory: 'CONVERSAZIONE_PRECEDENTE '.repeat(300),
      detectedLanguage: 'it',
      promptProfile: 'lite'
    });

    const openIndex = truncatedPrompt.prompt.indexOf('<user_email>');
    const closeIndex = truncatedPrompt.prompt.indexOf('</user_email>');
    assert(truncatedPrompt.length <= global.CONFIG.MAX_SAFE_PROMPT_CHARS, 'il prompt troncato deve rispettare il limite fisico configurato');
    assert(truncatedPrompt.prompt.includes('EMAIL_TAG_SENTINEL'), 'il troncamento deve preservare il contenuto email prioritario');
    assert(openIndex >= 0 && closeIndex > openIndex, 'il recinto user_email deve rimanere aperto e chiuso correttamente');
  } finally {
    global.CONFIG.MAX_SAFE_TOKENS = originalMaxSafeTokens;
    global.CONFIG.MAX_SAFE_PROMPT_CHARS = originalMaxSafePromptChars;
  }
}

console.log('--- Test prompt: dottrina heavy esclude righe generiche senza match ---');
{
  const genericDoctrine = engine._renderSelectiveDoctrine(
    { type: 'doctrinal', needsDoctrine: true, dimensions: { doctrinal: 1 } },
    '',
    'Buongiorno, vorrei informazioni sugli orari della segreteria.',
    'Orari segreteria',
    'heavy',
    {},
    [
      {
        Categoria: 'generica',
        'Sotto-tema': 'nota generica amministrativa',
        'Principio dottrinale': 'Non pertinente alla richiesta.'
      }
    ]
  );
  assert(genericDoctrine === null, 'il profilo heavy non deve includere righe dottrinali generiche senza match testuale o categorico');
}

console.log('--- Test prompt: riparazione tag XML chiude blocchi strutturali troncati ---');
{
  const repairedKb = engine._truncateUserPromptSafely_(
    '<knowledge_base>\n' + 'dato '.repeat(100),
    80
  );
  assert(repairedKb.length <= 80, 'la riparazione XML deve rispettare il limite passato');
  assert(
    repairedKb.includes('<knowledge_base>') && repairedKb.includes('</knowledge_base>'),
    'un knowledge_base troncato deve essere richiuso'
  );
}

console.log('✅ Test qualità prompt risposta passati');
