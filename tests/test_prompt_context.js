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
assert(
  flatBereavement.meta.responseMode === 'bereavement',
  'bereavement_sets_responseMode'
);
assert(
  flatBereavement.meta.operationalConstraints.includes('Apri con tatto.') &&
    flatBereavement.meta.operationalConstraints.includes('Dai solo i passaggi indispensabili.'),
  'bereavement deve produrre vincoli operativi di tatto e brevità'
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

const classificationOnlyBereavement = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Messa in suffragio',
    body: 'Vorrei chiedere una Messa per mio padre defunto.'
  },
  requestType: { type: 'technical' },
  classification: {
    confidence: 1,
    category: 'information',
    subIntents: { bereavement: true }
  }
});
assert(
  classificationOnlyBereavement.input._resolvedSubIntents.bereavement === true &&
    classificationOnlyBereavement.concerns.emotional_sensitivity === true,
  'PromptContext deve canonicalizzare classification.subIntents in _resolvedSubIntents'
);
assert(
  classificationOnlyBereavement.meta.responseRegister === 'pastoral_supportive',
  '_computeResponseRegister deve consumare i subIntents canonicalizzati'
);

const operationalConfusion = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Certificato',
    body: 'Non mi è chiaro come richiedere il certificato.'
  },
  requestType: { type: 'technical', needsDiscernment: false, needsDoctrine: false },
  classification: {
    confidence: 1,
    category: 'information',
    subIntents: { confusion: true }
  }
});
assert(
  operationalConfusion.concerns.pastoral_technical_blend === true,
  'una richiesta operativa con confusione deve attivare pastoral_technical_blend'
);
assert(
  operationalConfusion.profile === 'standard',
  'pastoral_technical_blend leggero deve usare profilo standard, non heavy'
);
assert(
  operationalConfusion.meta.concernSynthesis &&
    operationalConfusion.meta.concernSynthesis.key === 'pastoral_technical_blend' &&
    operationalConfusion.meta.concernSynthesis.directive.includes('rispondi anzitutto al dato pratico'),
  'pastoral_technical_blend deve produrre una direttiva consumabile'
);
assert(
  operationalConfusion.meta.responseMode === 'pastoral_operational',
  'pastoral_technical_blend deve produrre responseMode pastoral_operational'
);

console.log('--- Test PromptContext: categoria formale post-OCR alza profilo e registro ---');
const postOcrFormal = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Modulo allegato',
    body: ''
  },
  requestType: { type: 'technical', needsDiscernment: false, needsDoctrine: false },
  classification: { confidence: 1, category: 'formal' },
  salutationMode: 'full'
});
assert(
  postOcrFormal.profile === 'heavy',
  'una categoria formale scoperta post-OCR deve usare profilo heavy anche se requestType resta tecnico'
);
assert(
  postOcrFormal.meta.responseRegister === 'formal_institutional',
  'una categoria formale scoperta post-OCR deve usare registro formal_institutional'
);

const sbattezzoMode = createPromptContext({
  email: {
    isReply: false,
    detectedLanguage: 'it',
    subject: 'Richiesta formale',
    body: 'Vorrei procedere con lo sbattezzo.'
  },
  requestType: { type: 'formal', isSbattezzo: true, needsDiscernment: false, needsDoctrine: false },
  classification: { confidence: 1, category: 'formal', topic: 'sbattezzo' },
  salutationMode: 'full'
});
assert(
  sbattezzoMode.meta.responseMode === 'sensitive_canonical',
  'sbattezzo_sets_sensitive_canonical'
);
assert(
  sbattezzoMode.meta.operationalConstraints.includes('Non fare pressione pastorale.') &&
    sbattezzoMode.meta.operationalConstraints.includes('Non usare linguaggio giudicante.'),
  'sensitive_canonical deve produrre vincoli di neutralità e non pressione'
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
assert(
  sensitiveMemory.meta.responseMode === 'pastoral_longitudinal',
  'longitudinal_memory_sets_pastoral_longitudinal'
);

const contextualBereavedMemory = createPromptContext({
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
    contextualFlags: { bereaved: true }
  }
});
assert(
  contextualBereavedMemory.concerns.longitudinal_sensitivity === true &&
    contextualBereavedMemory.profile === 'heavy',
  'memory.contextualFlags.bereaved deve attivare longitudinal_sensitivity e profilo heavy'
);
assert(
  contextualBereavedMemory.meta.continuityCase &&
    contextualBereavedMemory.meta.continuityCase.key === 'bereavement_continuity' &&
    contextualBereavedMemory.meta.longitudinalCase.key === 'bereavement_continuity',
  'memory.contextualFlags.bereaved deve produrre un caso longitudinale canonico'
);

const contextualRemoteMemory = createPromptContext({
  email: {
    isReply: true,
    detectedLanguage: 'it',
    subject: 'Certificato',
    body: 'Vorrei ricevere il certificato via email.'
  },
  requestType: { type: 'technical', needsDiscernment: false, needsDoctrine: false },
  classification: { confidence: 1, category: 'information' },
  memory: {
    exists: true,
    contextualFlags: { remote_user: true }
  }
});
assert(
  contextualRemoteMemory.concerns.physical_presence_constraint === true,
  'memory.contextualFlags.remote_user deve attivare physical_presence_constraint'
);
assert(
  contextualRemoteMemory.meta.responseMode === 'remote_operational',
  'remote_user_sets_remote_operational'
);
assert(
  contextualRemoteMemory.meta.operationalConstraints.includes('Non proporre presenza fisica salvo necessità esplicita.') &&
    contextualRemoteMemory.meta.operationalConstraints.includes('Preferisci email, telefono o indicazione procedurale remota.'),
  'remote_operational deve produrre vincoli remoti consumabili'
);

const canonicalFormalContinuity = createPromptContext({
  email: {
    isReply: true,
    detectedLanguage: 'it',
    subject: 'Richiesta formale',
    body: 'Vorrei sapere il prossimo passaggio della procedura.'
  },
  requestType: { type: 'formal', needsDiscernment: false, needsDoctrine: false },
  classification: { confidence: 1, category: 'formal' },
  memory: {
    exists: true,
    contextualFlags: { canonical_complexity: true }
  }
});
assert(
  canonicalFormalContinuity.concerns.longitudinal_sensitivity === true &&
    canonicalFormalContinuity.meta.continuityCase.key === 'canonical_continuity',
  'canonical_complexity deve entrare nella matrice longitudinale'
);
assert(
  canonicalFormalContinuity.meta.responseRegister === 'formal_institutional' &&
    canonicalFormalContinuity.meta.concernSynthesis.directive.includes('precisione procedurale'),
  'la continuità canonica formale deve restare procedurale senza perdere delicatezza'
);

const relationalOpeningContinuity = createPromptContext({
  email: {
    isReply: true,
    detectedLanguage: 'it',
    subject: 'Grazie',
    body: 'Grazie, vorrei solo capire a che ora passare.'
  },
  requestType: { type: 'technical', needsDiscernment: false, needsDoctrine: false },
  classification: { confidence: 1, category: 'information' },
  memory: {
    exists: true,
    conversationState: {
      currentRelationalPosture: 'open',
      responseFocusHint: null,
      responseFocusHintConfidence: 0
    }
  }
});
assert(
  relationalOpeningContinuity.concerns.relational_warmth === true &&
    relationalOpeningContinuity.concerns.longitudinal_sensitivity === false &&
    relationalOpeningContinuity.meta.continuityCase.key === 'relational_opening_continuity',
  'una apertura relazionale ricordata deve cambiare postura senza diventare lutto o caso heavy'
);
assert(
  relationalOpeningContinuity.profile === 'standard' &&
    relationalOpeningContinuity.meta.concernSynthesis.key === 'relational_continuity',
  'la continuità relazionale deve produrre una direttiva leggera e consumabile'
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
assert(
  longitudinalFollowUp.meta.concernSynthesis &&
    longitudinalFollowUp.meta.concernSynthesis.key === 'longitudinal_operational' &&
    longitudinalFollowUp.meta.concernSynthesis.directive.includes('lutto ancora rilevante'),
  'sensibilità longitudinale operativa deve produrre una concernSynthesis consumabile'
);
assert(
  longitudinalFollowUp.meta.responseMode === 'pastoral_longitudinal' &&
    longitudinalFollowUp.meta.continuityPolicy &&
    longitudinalFollowUp.meta.continuityPolicy.key === 'do_not_reopen_past_context',
  'pastoral_longitudinal deve produrre una policy di continuità non riaprire'
);

const longitudinalSynthesisStandalone = Object.create(PromptContext.prototype);
longitudinalSynthesisStandalone.concerns = {
  longitudinal_sensitivity: true,
  emotional_sensitivity: false
};
longitudinalSynthesisStandalone.profile = 'standard';
const standaloneSynthesis = longitudinalSynthesisStandalone._buildConcernSynthesis('warm_institutional');
assert(
  standaloneSynthesis &&
    standaloneSynthesis.key === 'longitudinal_operational',
  'longitudinal_operational non deve dipendere implicitamente dal profilo heavy'
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
  'crisi pastorale con più domande deve attivare multi_question e pastoral_crisis'
);
assert(
  crisisMultiQuestion.meta.concernSynthesis &&
    crisisMultiQuestion.meta.concernSynthesis.key === 'crisis_multi_question' &&
    crisisMultiQuestion.meta.concernSynthesis.directive.includes('bisogno principale è la crisi espressa') &&
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
