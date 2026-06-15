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
  KB_HALLUCINATION_RISK_THRESHOLD: 8000
};

const promptContextPath = path.join(__dirname, '..', 'gas_prompt_context.js');
const code = fs.readFileSync(promptContextPath, 'utf8');
vm.runInThisContext(code, { filename: promptContextPath });

console.log('--- Test PromptContext: identity_consistency solo per nuove richieste non tecniche ---');
const technicalNew = createPromptContext({
  email: { isReply: false, detectedLanguage: 'it' },
  requestType: { type: 'technical' },
  classification: { confidence: 1, category: 'technical' }
});
assert(
  technicalNew.concerns.identity_consistency === false,
  'una nuova richiesta tecnica non deve attivare identity_consistency'
);

const nonTechnicalReply = createPromptContext({
  email: { isReply: true, detectedLanguage: 'it' },
  requestType: { type: 'information' },
  classification: { confidence: 1, category: 'other' }
});
assert(
  nonTechnicalReply.concerns.identity_consistency === false,
  'una risposta in thread non tecnico non deve attivare identity_consistency'
);

const nonTechnicalNew = createPromptContext({
  email: { isReply: false, detectedLanguage: 'it' },
  requestType: { type: 'information' },
  classification: { confidence: 1, category: 'other' }
});
assert(
  nonTechnicalNew.concerns.identity_consistency === true,
  'una nuova richiesta non tecnica deve attivare identity_consistency'
);

console.log('--- Test PromptContext: multi_question per email con più dubbi operativi ---');
const multiQuestion = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Battesimo',
    body: 'Vorrei sapere quali documenti servono? Ci sono costi e date disponibili?'
  },
  requestType: { type: 'technical' },
  classification: { confidence: 1, category: 'information' }
});
assert(
  multiQuestion.concerns.multi_question === true,
  'due domande operative devono attivare multi_question'
);

console.log('--- Test PromptContext: emotional_sensitivity legge subIntents flat ---');
const flatBereavement = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Messa in suffragio',
    body: 'Vorrei chiedere una Messa per mio padre defunto.'
  },
  requestType: { type: 'technical' },
  classification: { confidence: 1, category: 'information' },
  subIntents: { bereavement: true }
});
assert(
  flatBereavement.concerns.emotional_sensitivity === true,
  'subIntents.bereavement flat deve attivare emotional_sensitivity'
);
assert(
  flatBereavement.profile === 'heavy',
  'lutto da subIntent flat deve alzare il profilo prompt a heavy'
);

const flatDistress = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Richiesta',
    body: 'Sto attraversando un momento difficile e vorrei parlare con qualcuno.'
  },
  requestType: { type: 'technical' },
  classification: { confidence: 1, category: 'information' },
  subIntents: { emotional_distress: true }
});
assert(
  flatDistress.concerns.emotional_sensitivity === true,
  'subIntents.emotional_distress flat deve attivare emotional_sensitivity'
);

console.log('--- Test PromptContext: memoria semantica sensibile alza il profilo ---');
const sensitiveMemory = createPromptContext({
  email: {
    isReply: true,
    detectedLanguage: 'it',
    subject: 'Orario incontro',
    body: 'A che ora ci vediamo?'
  },
  requestType: { type: 'technical', needsDiscernment: false, needsDoctrine: false },
  classification: { confidence: 1, category: 'information' },
  memory: {
    exists: true,
    providedInfoCount: 2,
    lastUpdated: '2026-06-01T10:00:00.000Z',
    category: 'information',
    memorySummary: 'Scambio precedente su lutto familiare',
    topics: ['esequie', 'accompagnamento famiglia']
  }
});
assert(
  sensitiveMemory.concerns.longitudinal_sensitivity === true,
  'la memoria semantica sensibile deve attivare longitudinal_sensitivity'
);
assert(
  sensitiveMemory.profile === 'heavy',
  'la memoria semantica sensibile deve alzare il profilo a heavy'
);

console.log('--- Test PromptContext: memoria sensibile riconosce forme flesse ---');
[
  'utente separato',
  'persona separata',
  'padre divorziato',
  'madre divorziata',
  'signore vedovo',
  'signora vedova',
  'coniugi separati',
  'fedeli divorziate'
].forEach((memorySummary) => {
  const ctx = createPromptContext({
    email: {
      isReply: true,
      detectedLanguage: 'it',
      subject: 'Informazioni',
      body: 'Grazie, vorrei sapere l’orario.'
    },
    requestType: { type: 'technical', needsDiscernment: false, needsDoctrine: false },
    classification: { confidence: 1, category: 'technical' },
    memory: {
      exists: true,
      providedInfoCount: 1,
      memorySummary,
      topics: []
    }
  });
  assert(
    ctx.concerns.longitudinal_sensitivity === true,
    `memoria "${memorySummary}" deve attivare longitudinal_sensitivity`
  );
});

console.log('--- Test PromptContext: registro sintetico, overload e override saluto emotivo ---');
const longMultiBody = `${'Vorrei capire alcuni passaggi. '.repeat(25)} Quali documenti servono? Quando posso consegnarli? Ci sono costi?`;
const overloaded = createPromptContext({
  email: {
    isReply: true,
    detectedLanguage: 'it',
    subject: 'Pratica lunga',
    body: longMultiBody
  },
  requestType: { type: 'technical' },
  classification: { confidence: 1, category: 'information' },
  salutationMode: 'none_or_continuity'
});
assert(
  overloaded.concerns.user_overload === true,
  'email lunga con più domande deve attivare user_overload'
);
assert(
  overloaded.meta.responseRegister === 'warm_institutional',
  'richiesta tecnica ordinaria deve produrre registro warm_institutional'
);
assert(
  overloaded.meta.salutationMode === 'none_or_continuity',
  'senza sensibilità emotiva il saluto di continuità resta invariato'
);

const emotionalFollowUp = createPromptContext({
  email: {
    isReply: true,
    detectedLanguage: 'it',
    subject: 'Re: lutto',
    body: 'Sono molto provata per la morte di mio padre, come posso organizzare la Messa?'
  },
  requestType: { type: 'pastoral' },
  classification: { confidence: 1, category: 'information', subIntents: { bereavement: true } },
  salutationMode: 'none_or_continuity'
});
assert(
  emotionalFollowUp.meta.responseRegister === 'pastoral_supportive',
  'sensibilità emotiva deve produrre registro pastorale di accompagnamento'
);
assert(
  emotionalFollowUp.meta.salutationMode === 'soft',
  'follow-up emotivamente sensibile deve applicare override saluto soft'
);


const mildDistress = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Richiesta di aiuto',
    body: 'Sono un po’ agitata e vorrei parlare con qualcuno.'
  },
  requestType: { type: 'pastoral' },
  classification: { confidence: 1, category: 'information', subIntents: { emotional_distress: true } },
  salutationMode: 'full'
});
assert(
  mildDistress.meta.responseRegister === 'pastoral_supportive',
  'emotional_distress senza lutto o segnali forti non deve produrre pastoral_crisis'
);

const strongCrisis = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Emergenza',
    body: 'Sono in crisi e non ce la faccio, ho bisogno di parlare con qualcuno.'
  },
  requestType: { type: 'pastoral' },
  classification: { confidence: 1, category: 'information', subIntents: { emotional_distress: true } },
  salutationMode: 'full'
});
assert(
  strongCrisis.meta.responseRegister === 'pastoral_crisis',
  'emotional_distress con segnali forti deve produrre pastoral_crisis'
);

console.log('✅ Test PromptContext OK');
