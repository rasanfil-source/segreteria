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
assert(
  technicalNew.concerns.response_calibration === false,
  'una richiesta tecnica vuota e ordinaria non deve attivare response_calibration'
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
assert(
  multiQuestion.concerns.response_calibration === true,
  'due domande operative devono attivare response_calibration'
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

const sensitivePrecision = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Messa per defunto',
    body: 'Vorrei chiedere una Messa per mio padre defunto, ma non so quali orari siano disponibili.'
  },
  requestType: { type: 'technical' },
  classification: { confidence: 1, category: 'information' },
  subIntents: { bereavement: true },
  knowledgeBase: 'A'.repeat(9001)
});
assert(
  sensitivePrecision.concerns.hallucination_risk === true &&
    sensitivePrecision.concerns.emotional_sensitivity === true,
  'KB lunga e contesto sensibile devono attivare precisione sensibile'
);
assert(
  sensitivePrecision.meta.concernSynthesis &&
    sensitivePrecision.meta.concernSynthesis.key === 'sensitive_precision' &&
    sensitivePrecision.meta.concernSynthesis.directive.includes('delicatezza e precisione') &&
    sensitivePrecision.meta.concernSynthesis.suppress.formattingGuidelines === true &&
    sensitivePrecision.meta.concernSynthesis.suppress.checklistHallucinationRule === true,
  'PromptContext deve sintetizzare hallucination_risk + emotional_sensitivity in una direttiva unica'
);

const sensitiveFormatting = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Orari per Messa di suffragio',
    body: 'Vorrei chiedere una Messa per mio padre defunto e sapere quali orari sono possibili.'
  },
  requestType: { type: 'technical' },
  classification: { confidence: 1, category: 'information' },
  subIntents: { bereavement: true },
  knowledgeBase: 'La segreteria prende nota delle intenzioni di Messa.'
});
assert(
  sensitiveFormatting.concerns.emotional_sensitivity === true &&
    sensitiveFormatting.concerns.formatting_risk === true &&
    sensitiveFormatting.concerns.hallucination_risk === false,
  'contesto emotivo con dati pratici deve attivare formattazione sensibile senza rischio allucinazione'
);
assert(
  sensitiveFormatting.meta.concernSynthesis &&
    sensitiveFormatting.meta.concernSynthesis.key === 'sensitive_formatting' &&
    sensitiveFormatting.meta.concernSynthesis.directive.includes('date, orari, documenti o passaggi pratici') &&
    sensitiveFormatting.meta.concernSynthesis.suppress.formattingGuidelines === true &&
    sensitiveFormatting.meta.concernSynthesis.suppress.checklistHallucinationRule === false,
  'PromptContext deve sintetizzare emotional_sensitivity + formatting_risk senza aggiungere regole hallucination'
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

const longitudinalOverloadBody = `${'Vorrei capire alcuni passaggi amministrativi. '.repeat(18)} Quali documenti servono? Quando posso consegnarli? Devo prendere appuntamento?`;
const longitudinalOverload = createPromptContext({
  email: {
    isReply: true,
    detectedLanguage: 'it',
    subject: 'Re: pratica',
    body: longitudinalOverloadBody
  },
  requestType: { type: 'technical', needsDiscernment: false, needsDoctrine: false },
  classification: { confidence: 1, category: 'technical' },
  memory: {
    exists: true,
    providedInfoCount: 1,
    memorySummary: 'Scambio precedente su lutto familiare',
    topics: ['esequie']
  }
});
assert(
  longitudinalOverload.concerns.longitudinal_sensitivity === true &&
    longitudinalOverload.concerns.user_overload === true,
  'memoria sensibile e richiesta lunga devono attivare longitudinal_sensitivity + user_overload'
);
assert(
  longitudinalOverload.meta.concernSynthesis &&
    longitudinalOverload.meta.concernSynthesis.key === 'longitudinal_overload' &&
    longitudinalOverload.meta.concernSynthesis.directive.includes('prosa breve e ben sequenziata') &&
    longitudinalOverload.meta.concernSynthesis.suppress.userOverloadGuidance === true,
  'PromptContext deve sintetizzare longitudinal_sensitivity + user_overload in una direttiva unica'
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
  overloaded.concerns.response_calibration === true,
  'email lunga con più domande deve attivare response_calibration'
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

const longitudinalFollowUp = createPromptContext({
  email: {
    isReply: true,
    detectedLanguage: 'it',
    subject: 'Re: informazioni',
    body: 'Grazie, vorrei confermare l’orario.'
  },
  requestType: { type: 'technical', needsDiscernment: false, needsDoctrine: false },
  classification: { confidence: 1, category: 'information' },
  memory: {
    exists: true,
    providedInfoCount: 1,
    memorySummary: 'Scambio precedente su lutto familiare',
    topics: ['esequie']
  },
  salutationMode: 'none_or_continuity'
});
assert(
  longitudinalFollowUp.meta.responseRegister === 'pastoral_supportive',
  'sensibilità longitudinale deve produrre registro pastorale di accompagnamento'
);
assert(
  longitudinalFollowUp.meta.salutationMode === 'soft',
  'follow-up longitudinalmente sensibile deve applicare override saluto soft'
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
assert(
  mildDistress.meta.salutationMode === 'full_warm',
  'primo contatto pastorale di supporto deve usare saluto full_warm'
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
assert(
  strongCrisis.meta.salutationMode === 'full_warm',
  'primo contatto in crisi pastorale deve usare saluto full_warm'
);

const sessionCrisis = createPromptContext({
  email: {
    isReply: true,
    detectedLanguage: 'it',
    subject: 'Re: emergenza',
    body: 'Sono in crisi e non ce la faccio, ho bisogno di parlare con qualcuno.'
  },
  requestType: { type: 'pastoral' },
  classification: { confidence: 1, category: 'information', subIntents: { emotional_distress: true } },
  salutationMode: 'session'
});
assert(
  sessionCrisis.meta.responseRegister === 'pastoral_crisis',
  'crisi in thread deve mantenere registro pastoral_crisis'
);
assert(
  sessionCrisis.meta.salutationMode === 'soft',
  'crisi in sessione ravvicinata deve uscire dalla modalita chat secca e usare saluto soft'
);

const crisisMultiQuestion = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Emergenza',
    body: 'Sono in crisi e non ce la faccio. Posso parlare con qualcuno? Quando posso venire?'
  },
  requestType: { type: 'pastoral' },
  classification: { confidence: 1, category: 'other', subIntents: { emotional_distress: true } },
  salutationMode: 'full'
});
assert(
  crisisMultiQuestion.concerns.multi_question === true &&
    crisisMultiQuestion.meta.responseRegister === 'pastoral_crisis',
  'crisi pastorale con piu domande deve attivare multi_question e pastoral_crisis'
);
assert(
  crisisMultiQuestion.meta.concernSynthesis &&
    crisisMultiQuestion.meta.concernSynthesis.key === 'crisis_multi_question' &&
    crisisMultiQuestion.meta.concernSynthesis.directive.includes('bisogno principale e la crisi espressa') &&
    crisisMultiQuestion.meta.concernSynthesis.suppress.responseCalibrationGuidance === true &&
    crisisMultiQuestion.meta.concernSynthesis.suppress.checklistCompletenessRule === true &&
    crisisMultiQuestion.meta.concernSynthesis.suppress.userOverloadGuidance === true,
  'PromptContext deve sintetizzare pastoral_crisis + multi_question senza affidare al modello la riconciliazione'
);

const crisisSingleQuestion = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Emergenza',
    body: 'Sono in crisi e non ce la faccio, posso parlare con qualcuno?'
  },
  requestType: { type: 'pastoral' },
  classification: { confidence: 1, category: 'other', subIntents: { emotional_distress: true } },
  salutationMode: 'full'
});
assert(
  crisisSingleQuestion.meta.responseRegister === 'pastoral_crisis' &&
    (!crisisSingleQuestion.meta.concernSynthesis ||
      crisisSingleQuestion.meta.concernSynthesis.key !== 'crisis_multi_question'),
  'crisi pastorale con una sola domanda non deve attivare la sintesi multi-domanda'
);

console.log('--- Test PromptContext: residual_sensitivity per memoria storica non attiva su email emotiva ---');
const residualTrue = createPromptContext({
  email: {
    isReply: true,
    detectedLanguage: 'it',
    subject: 'Re: informazioni',
    body: 'Grazie, vorrei confermare l’orario.'
  },
  requestType: { type: 'technical', needsDiscernment: false, needsDoctrine: false },
  classification: { confidence: 1, category: 'information' },
  memory: {
    exists: true,
    providedInfoCount: 1,
    memorySummary: 'Scambio precedente su lutto familiare',
    topics: ['esequie']
  }
});
assert(
  residualTrue.concerns.residual_sensitivity === true,
  'con lutto in memoria e email non emotiva, residual_sensitivity deve essere true'
);

const residualFalse = createPromptContext({
  email: {
    isReply: true,
    detectedLanguage: 'it',
    subject: 'Re: lutto',
    body: 'Mio padre è venuto a mancare.'
  },
  requestType: { type: 'pastoral' },
  classification: { confidence: 1, category: 'information', subIntents: { bereavement: true } },
  memory: {
    exists: true,
    providedInfoCount: 1,
    memorySummary: 'Scambio precedente su lutto familiare',
    topics: ['esequie']
  }
});
assert(
  residualFalse.concerns.residual_sensitivity === false,
  'con lutto in memoria ma email correntemente emotiva, residual_sensitivity deve essere false'
);

console.log('✅ Test PromptContext OK');
