const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

const gasGeminiServicePath = path.join(__dirname, '..', 'gas_gemini_service.js');
const gasErrorTypesPath = path.join(__dirname, '..', 'gas_error_types.js');
vm.runInThisContext(fs.readFileSync(gasErrorTypesPath, 'utf8'), { filename: gasErrorTypesPath });
const code = fs.readFileSync(gasGeminiServicePath, 'utf8');
vm.runInThisContext(code, { filename: gasGeminiServicePath });

console.log('--- Test _tryBalanceJsonBraces: chiusura corretta oggetti+array annidati ---');
{
  const truncated = '{"dimensions":[1,2,{"k":"v"';
  const balanced = _tryBalanceJsonBraces(truncated);
  const parsed = JSON.parse(balanced);

  assert(Array.isArray(parsed.dimensions), 'dimensions deve essere un array valido');
  assert(parsed.dimensions[2].k === 'v', 'oggetto annidato in array deve restare valido');
}

console.log('--- Test _tryBalanceJsonBraces: parentesi in stringa non alterano lo stack ---');
{
  const truncated = '{"note":"valore con ] e } nel testo","arr":[1,2';
  const balanced = _tryBalanceJsonBraces(truncated);
  const parsed = JSON.parse(balanced);

  assert(parsed.note.includes('] e }'), 'caratteri strutturali in stringa non devono essere interpretati');
}

// Test rimosso perché la funzionalità di context caching è stata eliminata

console.log('--- Test _quoteUnquotedJsonKeysSafely: non corrompe virgole e pseudo-chiavi nelle stringhe ---');
{
  const raw = '{reply_needed:true, topic: "Richiesta, info: sbattezzo", category:"TECHNICAL"}';
  const fixed = _quoteUnquotedJsonKeysSafely(raw);
  const parsed = JSON.parse(fixed);

  assert(parsed.reply_needed === true, 'chiave non virgolettata deve essere corretta');
  assert(parsed.topic === 'Richiesta, info: sbattezzo', 'contenuto testuale con virgola e due punti non deve essere alterato');
  assert(parsed.category === 'TECHNICAL', 'category deve restare leggibile');
}

console.log('--- Test parseGeminiJsonLenient: virgole finali solo fuori dalle stringhe ---');
{
  const raw = '{"reply_needed":true,"reason":"Ciao,}","category":"TECHNICAL",}';
  const parsed = parseGeminiJsonLenient(raw);

  assert(parsed.reason === 'Ciao,}', 'virgola dentro stringa prima di graffa non deve essere rimossa');
  assert(parsed.category === 'TECHNICAL', 'virgola finale strutturale deve essere corretta');
}

console.log('--- Test parseGeminiJsonLenient: recupera flag territorio da JSON parziale ---');
{
  const raw = '{"reply_needed":true,"language":"it","category":"TECHNICAL","topic":"confini parrocchiali","is_territory_request":true,"territory_address_candidates":["via Bartolo Oriani"],"confidence":0.8, BAD';
  const parsed = parseGeminiJsonLenient(raw);

  assert(parsed.reply_needed === true, 'reply_needed deve essere recuperato dal JSON parziale');
  assert(parsed.is_territory_request === true, 'is_territory_request deve essere recuperato dal JSON parziale');
  assert(parsed.territory_address_candidates[0] === 'via Bartolo Oriani', 'territory_address_candidates deve essere recuperato dal JSON parziale');
  assert(parsed.topic === 'confini parrocchiali', 'topic deve essere recuperato dal JSON parziale');
}


console.log('--- Test EmailQuickCheckPolicy: distingue intento operativo da topic documentale/procedurale ---');
{
  const operational = EmailQuickCheckPolicy.inferRequestPurpose(
    'Certificato di battesimo per matrimonio',
    'Ho già avviato la pratica e mi serve il certificato in originale. Passerò in segreteria lunedì per ritirarlo.'
  );
  assert(operational.type === 'operational_request', 'richiesta documentale già avviata deve essere operativa, non informativa');

  const informative = EmailQuickCheckPolicy.inferRequestPurpose(
    'Certificato di battesimo',
    'Vorrei informazioni: dove devo richiederlo e quali documenti servono?'
  );
  assert(informative.type === 'information_request', 'domanda su dove/quali documenti deve restare informativa');
}

console.log('--- Test _classifyError: quota primaria non ritenta sulla stessa chiave ---');
{
  const service = Object.create(GeminiService.prototype);
  const primary = service._classifyError(new Error('PRIMARY_QUOTA_EXHAUSTED'));
  const compactPrimary = service._classifyError(new Error('PRIMARYQUOTAEXHAUSTED'));
  const allKeys = service._classifyError(new Error('QUOTA_EXHAUSTED_ALL_KEYS: Limite quota raggiunto'));
  const compactAllKeys = service._classifyError(new Error('quotaexhaustedallkeys'));

  assert(primary.type === 'QUOTA_EXHAUSTED', 'PRIMARY_QUOTA_EXHAUSTED deve restare quota esaurita');
  assert(primary.retryable === false, 'PRIMARY_QUOTA_EXHAUSTED non deve essere retryable localmente');
  assert(compactPrimary.type === 'QUOTA_EXHAUSTED', 'PRIMARYQUOTAEXHAUSTED compatto deve restare quota esaurita');
  assert(compactPrimary.retryable === false, 'PRIMARYQUOTAEXHAUSTED compatto non deve essere retryable localmente');
  assert(allKeys.type === 'QUOTA_EXHAUSTED', 'QUOTA_EXHAUSTED_ALL_KEYS deve restare quota esaurita');
  assert(allKeys.retryable === false, 'QUOTA_EXHAUSTED_ALL_KEYS non deve essere retryable localmente');
  assert(compactAllKeys.type === 'QUOTA_EXHAUSTED', 'quotaexhaustedallkeys compatto deve restare quota esaurita');
  assert(compactAllKeys.retryable === false, 'quotaexhaustedallkeys compatto non deve essere retryable localmente');

  const primaryTransient = new Error('PRIMARY_QUOTA_EXHAUSTED');
  primaryTransient.isTransient = true;
  const centralPrimary = classifyError(primaryTransient);
  assert(centralPrimary.type === ErrorTypes.QUOTA_EXCEEDED, 'classifyError centrale deve preservare quota anche con isTransient');
  assert(centralPrimary.retryable === true, 'classifyError centrale deve trattare il key-switch quota come retryable a livello orchestratore');
}

console.log('--- Test classifyError: testo vuoto Gemini è retryable ---');
{
  const emptyErr = new Error('Gemini ha restituito testo vuoto');
  emptyErr.isTransient = true;
  const classified = classifyError(emptyErr);

  assert(classified.retryable === true, 'errore testo vuoto marcato transient deve essere retryable');
  assert(classified.type === ErrorTypes.NETWORK, 'errore transient deve essere classificato come NETWORK');
}

console.log('--- Test getAdaptiveGreeting: non espone placeholder tecnici come nome ---');
{
  const service = Object.create(GeminiService.prototype);
  service._getSpecialDayGreeting = () => null;
  const previousUtilities = global.Utilities;
  global.Utilities = {
    formatDate: (_date, _tz, pattern) => {
      if (pattern === 'H') return '1';
      if (pattern === 'm') return '0';
      if (pattern === 'u') return '1';
      return '';
    }
  };

  try {
    const adaptive = service.getAdaptiveGreeting('fallbackSenderName', 'it');
    assert(!adaptive.greeting.includes('fallbackSenderName'), 'il placeholder tecnico non deve comparire nel saluto');
    assert(adaptive.greeting.includes('utente'), 'il placeholder deve essere sostituito da un fallback umano');
  } finally {
    global.Utilities = previousUtilities;
  }
}

console.log('--- Test getAdaptiveGreeting: sera spagnola usa Buenas noches ---');
{
  const service = Object.create(GeminiService.prototype);
  service._getSpecialDayGreeting = () => null;
  const previousUtilities = global.Utilities;
  global.Utilities = {
    formatDate: (_date, _tz, pattern) => {
      if (pattern === 'H') return '20';
      if (pattern === 'm') return '0';
      if (pattern === 'u') return '1';
      return '';
    }
  };

  try {
    const adaptive = service.getAdaptiveGreeting('Carlos', 'es');
    assert(adaptive.greeting === 'Buenas noches,', 'il saluto spagnolo serale deve essere Buenas noches');
  } finally {
    global.Utilities = previousUtilities;
  }
}

console.log('--- Test getAdaptiveGreeting: lingua non preconfigurata non forza chiusura italiana ---');
{
  const service = Object.create(GeminiService.prototype);
  service._getSpecialDayGreeting = () => null;
  const adaptive = service.getAdaptiveGreeting('Jan', 'pl');
  assert(adaptive.greeting === 'Good day,', 'fallback saluto deve restare neutro e traducibile dal prompt');
  assert(adaptive.closing === 'Kind regards,', 'fallback chiusura non deve essere italiana per lingue non preconfigurate');
}

console.log('--- Test detectEmailLanguage: singolo termine istituzionale IT non domina testo inglese ---');
{
  const service = Object.create(GeminiService.prototype);
  const result = service.detectEmailLanguage(
    'Hello, thank you for the information. I would like to know how your parish handles la celebrazione. Kind regards.',
    'Information request'
  );

  assert(result.lang === 'en', `Atteso EN con un solo termine istituzionale italiano, ottenuto ${result.lang}`);
}

console.log('--- Test Gemini task profiles: generation e quick_check hanno configurazioni separate ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = null;
  service.config = { MAX_OUTPUT_TOKENS: 321 };
  service.fetchFn = () => null;
  service._buildGenerateUrl = () => 'https://example.test/generate';

  const generationConfig = service._buildGeminiGenerationConfig_('generation', 'gemini-3.7-flash');
  const quickLiteConfig = service._buildGeminiGenerationConfig_('quick_check', 'gemini-3.5-flash-lite');
  const quickFlashConfig = service._buildGeminiGenerationConfig_('quick_check', 'gemini-3.5-flash');
  const legacyGenerationConfig = service._buildGeminiGenerationConfig_('generation', 'gemini-3.5-flash');

  assert(generationConfig.maxOutputTokens === 321, 'generation deve usare MAX_OUTPUT_TOKENS configurato');
  assert(
    !Object.prototype.hasOwnProperty.call(generationConfig, 'temperature') &&
      !Object.prototype.hasOwnProperty.call(generationConfig, 'topK') &&
      !Object.prototype.hasOwnProperty.call(generationConfig, 'topP'),
    'Gemini 3.7 Flash non deve ricevere parametri di sampling deprecati'
  );
  assert(
    !Object.prototype.hasOwnProperty.call(quickLiteConfig, 'temperature') &&
      !Object.prototype.hasOwnProperty.call(quickLiteConfig, 'topK') &&
      !Object.prototype.hasOwnProperty.call(quickLiteConfig, 'topP'),
    'Gemini 3.5 Flash-Lite non deve ricevere parametri di sampling deprecati'
  );
  assert(legacyGenerationConfig.temperature === 0.25, 'i modelli legacy devono conservare il profilo di sampling compatibile');
  assert(quickLiteConfig.maxOutputTokens === 1024, 'quick_check deve avere budget token dedicato');
  assert(!Object.prototype.hasOwnProperty.call(quickLiteConfig, 'responseMimeType'), 'quick_check lite non deve forzare JSON MIME');
  assert(quickFlashConfig.responseMimeType === 'application/json', 'quick_check non-lite deve richiedere JSON MIME');
}

console.log('--- Test EmailQuickCheckPolicy: prompt include guardrail documentale e guidance sponsor solo se richiesti ---');
{
  const plainPrompt = EmailQuickCheckPolicy.buildPrompt('Vorrei informazioni sugli orari', 'Info', { hasConversationContext: false });
  const threadedPrompt = EmailQuickCheckPolicy.buildPrompt('Preferirei sabato prossimo', 'Re: Messa', { hasConversationContext: true });
  const visitPrompt = EmailQuickCheckPolicy.buildPrompt(
    'Buongiorno, posso passare domani in segreteria per un certificato di battesimo?',
    'Certificato di battesimo',
    null
  );
  const policyPrompt = EmailQuickCheckPolicy.buildPrompt(
    'Allego il certificato della madrina',
    'Documentazione',
    { intent: 'document_submission', sponsorGuidanceCheck: true }
  );

  assert(!plainPrompt.prompt.includes('CONTESTO STRUTTURALE ALLEGATI'), 'prompt ordinario non deve includere guardrail documentale');
  assert(!plainPrompt.prompt.includes('"needs_sponsor_guidance": boolean'), 'prompt ordinario non deve chiedere needs_sponsor_guidance');
  assert(plainPrompt.prompt.includes('"physical_presence_constraint"'), 'prompt ordinario deve chiedere il vincolo di presenza fisica');
  assert(
    plainPrompt.prompt.includes('dichiara di trovarsi gi') &&
      plainPrompt.prompt.includes('Un vincolo distinto di salute') &&
      plainPrompt.prompt.includes('resta invece valido'),
    'quick check deve distinguere la residenza estera dalla presenza locale attuale senza cancellare altri vincoli'
  );
  assert(plainPrompt.prompt.includes('"is_territory_request": boolean'), 'prompt ordinario deve chiedere il flag richiesta territorio');
  assert(plainPrompt.prompt.includes('"territory_address_candidates": ["string"]'), 'prompt ordinario deve chiedere gli indirizzi candidati territorio');
  assert(plainPrompt.prompt.includes('competenza territoriale'), 'prompt quick-check deve spiegare la competenza territoriale');
  assert(plainPrompt.prompt.includes('"relational_posture"'), 'prompt ordinario deve chiedere la postura relazionale');
  assert(plainPrompt.prompt.includes('"request_purpose"'), 'prompt ordinario deve distinguere lo scopo della richiesta dal topic');
  assert(plainPrompt.prompt.includes('Non classificare come informativa una richiesta solo perche'), 'prompt quick-check deve evitare il routing informativo basato sul solo argomento');
  assert(plainPrompt.prompt.includes('"relational_posture_confidence"'), 'prompt ordinario deve chiedere la confidenza della postura relazionale');
  assert(plainPrompt.prompt.includes('"response_focus_hint"'), 'prompt ordinario deve mantenere response_focus_hint nel JSON');
  assert(plainPrompt.prompt.includes('"attachment_intent"'), 'prompt ordinario deve chiedere attachment_intent nel JSON');
  assert(plainPrompt.prompt.includes('requires_attachment_reading'), 'prompt quick-check deve spiegare requires_attachment_reading');
  assert(plainPrompt.prompt.includes('"document_delivery"'), 'prompt ordinario deve chiedere document_delivery nel JSON');
  assert(plainPrompt.prompt.includes('body_contains_filled_document'), 'prompt quick-check deve spiegare body_contains_filled_document');
  assert(plainPrompt.prompt.includes('Non estrarre segnali conversazionali'), 'primo messaggio deve disattivare i task conversazionali');
  assert(!plainPrompt.prompt.includes('Determina conversation_shift'), 'primo messaggio non deve chiedere lo step conversation_shift');
  assert(threadedPrompt.prompt.includes('"avoid_repeating_known_requirements"'), 'thread avviato deve limitare response_focus_hint agli enum ammessi');
  assert(threadedPrompt.prompt.includes('"topic_change"'), 'thread avviato deve limitare conversation_shift agli enum ammessi');
  assert(plainPrompt.prompt.includes('relational_posture_confidence >= 0.70'), 'prompt quick-check deve comunicare la soglia operativa default della postura');
  assert(plainPrompt.prompt.includes('grazie di cuore'), 'prompt quick-check deve trattare ringraziamenti calorosi come marker appreciative');
  assert(plainPrompt.prompt.includes('Non classificare come appreciative una semplice richiesta cortese o solo informativa'), 'prompt quick-check deve evitare appreciative per richieste solo informative');
  assert(plainPrompt.prompt.includes('sotto quella soglia la postura viene ignorata'), 'prompt quick-check deve spiegare il fallback sotto soglia');
  assert(plainPrompt.prompt.includes('"direct": richiesta neutra'), 'prompt quick-check deve usare direct come default canonico');
  assert(!plainPrompt.prompt.includes('"informational": richiesta informativa'), 'prompt quick-check non deve piu descrivere il vocabolario postura legacy');
  assert(plainPrompt.prompt.includes('"complaint"'), 'prompt quick-check deve usare complaint come label osservabile');
  assert(plainPrompt.prompt.includes('"legal_restriction"'), 'prompt quick-check deve coprire limitazioni legali alla presenza fisica');
  assert(visitPrompt.prompt.includes('CONTESTO LOGISTICO VISITA'), 'richiesta di passaggio deve includere guardrail logistico');
  assert(visitPrompt.prompt.includes('category "TECHNICAL"'), 'guardrail logistico deve forzare category TECHNICAL');
  assert(visitPrompt.hasOfficeVisitLogistics === true, 'policy deve esporre il flag logistico');
  assert(policyPrompt.prompt.includes('CONTESTO STRUTTURALE ALLEGATI'), 'submission documentale deve includere guardrail dedicato');
  assert(policyPrompt.prompt.includes('"needs_sponsor_guidance": boolean'), 'precheck sponsor deve richiedere il campo JSON dedicato');
  assert(policyPrompt.safeSubject === 'Documentazione', 'policy deve normalizzare e preservare il subject sicuro');
  assert(policyPrompt.safeContent.includes('certificato'), 'policy deve normalizzare e preservare il contenuto sicuro');
}

console.log('--- Test EmailQuickCheckPolicy: soglia postura relazionale configurabile nel prompt ---');
{
  const previousConfig = global.CONFIG;
  global.CONFIG = Object.assign({}, previousConfig || {}, {
    RELATIONAL_POSTURE_CONFIDENCE_THRESHOLD: 0.65
  });
  try {
    const thresholdPrompt = EmailQuickCheckPolicy.buildPrompt('Mi scusi, avrei una domanda', 'Info', null);
    assert(
      thresholdPrompt.prompt.includes('relational_posture_confidence >= 0.65'),
      'prompt quick-check deve usare la soglia configurata per la postura relazionale'
    );
  } finally {
    global.CONFIG = previousConfig;
  }
}

console.log('--- Test EmailQuickCheckPolicy: contratto esplicito livelli quick-check ---');
{
  const levels = EmailQuickCheckPolicy.getQuickCheckSchemaLevels();

  assert(levels.level1_message.always === true, 'livello 1 deve essere sempre disponibile');
  assert(levels.level1_message.fields.indexOf('response_strategy') !== -1, 'response_strategy deve restare livello 1');
  assert(levels.level1_message.fields.indexOf('request_purpose') !== -1, 'request_purpose deve essere livello 1');
  assert(levels.level1_message.fields.indexOf('attachment_intent') !== -1, 'attachment_intent deve essere livello 1');
  assert(levels.level1_message.fields.indexOf('document_delivery') !== -1, 'document_delivery deve essere livello 1');
  assert(levels.level2_conversation.requiresConversationContext === true, 'livello 2 deve richiedere contesto conversazionale');
  assert(levels.level2_conversation.fields.indexOf('conversation_shift') !== -1, 'conversation_shift deve essere livello 2');
  assert(levels.level3_longitudinal.allowedInQuickCheck === false, 'livello 3 non deve essere ammesso nella quick-check');
  assert(levels.level3_longitudinal.fields.indexOf('residual_sensitivity') !== -1, 'residual_sensitivity deve essere dichiarato longitudinale');
  assert(EmailQuickCheckPolicy.hasConversationContext({ hasConversationContext: true }) === true, 'helper contesto deve accettare solo true esplicito');
  assert(EmailQuickCheckPolicy.hasConversationContext({ hasConversationContext: 'true' }) === false, 'helper contesto non deve accettare stringhe truthy');
}

console.log('--- Test EmailQuickCheckPolicy: normalizza decisione e forza risposta su submission documentale ---');
{
  const responseBody = JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            reply_needed: false,
            language: 'en',
            category: 'TECHNICAL',
            dimensions: { technical: 1, pastoral: 0, doctrinal: 0, formal: 0 },
            topic: 'documentazione ricevuta',
            is_territory_request: 'true',
            territory_address_candidates: ['via Bartolo Oriani', 'via Bartolo Oriani', '   '],
            confidence: 0.7,
            reason: 'consegna documentazione',
            request_purpose: 'status_update',
            request_purpose_confidence: 0.9,
            relational_posture: 'frustrated',
            relational_posture_confidence: 0.91,
            response_focus_hint: 'acknowledge_document_without_reopening_procedure',
            response_focus_hint_confidence: 0.82,
            conversation_shift: 'new_information',
            conversation_shift_confidence: 0.88,
            attachment_intent: {
              mentions_attachment_or_document: 'true',
              expected_attachment_description: 'scheda di iscrizione al cammino di Santiago',
              requires_attachment_reading: 'true',
              reason: 'l utente consegna una scheda allegata'
            },
            document_delivery: {
              expected_document: 'true',
              expected_document_description: 'scheda di iscrizione al cammino di Santiago',
              delivery_channel: 'body',
              body_contains_filled_document: 'true',
              requires_file_attachment: 'false',
              missing_document_if_no_attachment: 'false',
              reason: 'i dati compilati sono riportati nel testo'
            },
            physical_presence_constraint: {
              has_constraint: 'true',
              type: 'geographic_distance',
              confidence: 0.9,
              evidence: 'vivo a Darmstadt in Germania',
              reason: 'vive lontano da Roma',
              visit_policy: 'conditional_only'
            },
            needs_sponsor_guidance: 'false'
          })
        }]
      }
    }]
  });

  const result = EmailQuickCheckPolicy.normalizeApiResponse(
    responseBody,
    { lang: 'it', confidence: 5, safetyGrade: 5 },
    { intent: 'document_submission', hasConversationContext: true },
    { resolveLanguage: (candidate, fallback, grade) => `${candidate}/${fallback}/${grade}` }
  );

  assert(result.shouldRespond === true, 'submission documentale deve forzare risposta anche se Gemini dice false');
  assert(result.language === 'en/it/5', 'policy deve delegare la risoluzione lingua alla funzione iniettata');
  assert(result.classification.topic === 'documentazione ricevuta', 'topic del quick-check deve essere preservato');
  assert(result.is_territory_request === true, 'is_territory_request stringa true deve diventare boolean true');
  assert(result.classification.is_territory_request === true, 'classification deve esporre is_territory_request per EmailProcessor');
  assert(result.classification.isTerritoryRequest === true, 'classification deve esporre anche alias camelCase');
  assert(result.territory_address_candidates.length === 1, 'territory_address_candidates deve deduplicare e filtrare valori vuoti');
  assert(result.territory_address_candidates[0] === 'via Bartolo Oriani', 'territory_address_candidates deve preservare la via');
  assert(result.classification.territory_address_candidates[0] === 'via Bartolo Oriani', 'classification deve esporre territory_address_candidates');
  assert(result.relational_posture === 'complaint', 'relational_posture legacy frustrated deve normalizzarsi a complaint');
  assert(result.request_purpose === 'status_update', 'request_purpose valido deve essere preservato');
  assert(result.request_purpose_confidence === 0.9, 'request_purpose_confidence deve essere preservata');
  assert(result.relational_posture_confidence === 0.91, 'relational_posture_confidence alta deve essere preservata');
  assert(result.response_focus_hint === 'acknowledge_document_without_reopening_procedure', 'response_focus_hint enum valido con confidenza alta deve essere preservato');
  assert(result.response_focus_hint_confidence === 0.82, 'response_focus_hint_confidence alta deve essere preservata');
  assert(result.conversation_shift === 'new_information', 'conversation_shift enum valido con confidenza alta deve essere preservato');
  assert(result.conversation_shift_confidence === 0.88, 'conversation_shift_confidence alta deve essere preservata');
  assert(result.attachment_intent.requires_attachment_reading === true, 'attachment_intent.requires_attachment_reading stringa true deve diventare boolean true');
  assert(result.attachment_intent.mentions_attachment_or_document === true, 'attachment_intent.mentions_attachment_or_document deve essere true');
  assert(result.attachment_intent.expected_attachment_description === 'scheda di iscrizione al cammino di Santiago', 'descrizione allegato atteso deve essere preservata');
  assert(result.document_delivery.expected_document === true, 'document_delivery.expected_document stringa true deve diventare boolean true');
  assert(result.document_delivery.delivery_channel === 'body', 'document_delivery.delivery_channel valido deve essere preservato');
  assert(result.document_delivery.body_contains_filled_document === true, 'document_delivery.body_contains_filled_document stringa true deve diventare boolean true');
  assert(result.document_delivery.expected_document_description === 'scheda di iscrizione al cammino di Santiago', 'descrizione documento atteso deve essere preservata');
  assert(result.needs_sponsor_guidance === false, 'needs_sponsor_guidance stringa false deve diventare boolean false');
  assert(result.physical_presence_constraint.has_constraint === true, 'vincolo presenza fisica stringa true deve diventare boolean true');
  assert(result.physical_presence_constraint.type === 'geographic_distance', 'tipo vincolo presenza fisica deve essere preservato');
  assert(result.physical_presence_constraint.visit_policy === 'conditional_only', 'policy visita condizionale deve essere preservata');

  const noContextResult = EmailQuickCheckPolicy.normalizeDecisionData({
    reply_needed: true,
    language: 'it',
    category: 'TECHNICAL',
    response_focus_hint: 'provide_next_operational_step',
    response_focus_hint_confidence: 0.99,
    conversation_shift: 'new_information',
    conversation_shift_confidence: 0.99,
    goal_continuity: 'maintain_goal_continuity',
    goal_continuity_confidence: 0.99,
    new_information_provided: ['preferred_date']
  }, { lang: 'it' }, { hasConversationContext: false });
  assert(noContextResult.response_focus_hint === null, 'senza contesto conversazionale response_focus_hint deve essere neutro');
  assert(noContextResult.conversation_shift === 'none', 'senza contesto conversazionale conversation_shift deve essere neutro');
  assert(noContextResult.conversation_shift_confidence === 0, 'senza contesto conversazionale conversation_shift_confidence deve essere zero');
  assert(noContextResult.goal_continuity === 'none', 'senza contesto conversazionale goal_continuity deve essere neutro');
  assert(noContextResult.goal_continuity_confidence === 0, 'senza contesto conversazionale goal_continuity_confidence deve essere zero');
  assert(Array.isArray(noContextResult.new_information_provided) && noContextResult.new_information_provided.length === 0, 'senza contesto conversazionale new_information_provided deve essere vuoto');
  assert(noContextResult.attachment_intent.requires_attachment_reading === false, 'attachment_intent mancante deve avere default false');
  assert(noContextResult.document_delivery.expected_document === false, 'document_delivery mancante deve avere default false');

  const longitudinalResult = EmailQuickCheckPolicy.normalizeDecisionData({
    reply_needed: true,
    language: 'it',
    category: 'PASTORAL',
    topic: 'colloquio',
    confidence: 0.8,
    residual_sensitivity: 'high',
    longitudinal_sensitivity: 'high'
  }, { lang: 'it' }, { hasConversationContext: true });
  assert(typeof longitudinalResult.residual_sensitivity === 'undefined', 'residual_sensitivity non deve uscire dalla quick-check');
  assert(typeof longitudinalResult.longitudinal_sensitivity === 'undefined', 'longitudinal_sensitivity non deve uscire dalla quick-check');

  const logisticsResponseBody = JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            reply_needed: true,
            language: 'it',
            category: 'SACRAMENT',
            dimensions: { technical: 0.4, pastoral: 0.7, doctrinal: 0, formal: 0 },
            topic: 'certificato di battesimo',
            confidence: 0.7,
            reason: 'cita battesimo'
          })
        }]
      }
    }]
  });
  const logisticsResult = EmailQuickCheckPolicy.normalizeApiResponse(
    logisticsResponseBody,
    { lang: 'it', confidence: 5, safetyGrade: 5 },
    null,
    {
      emailSubject: 'Certificato di battesimo',
      emailContent: 'Buongiorno, posso passare domani in segreteria per un certificato di battesimo?'
    }
  );
  assert(logisticsResult.classification.category === 'TECHNICAL', 'richiesta di passaggio deve correggere category sacramentale in TECHNICAL');
  assert(logisticsResult.classification.topic === 'passaggio in segreteria', 'topic sacramentale deve diventare logistico');

  const fallback = EmailQuickCheckPolicy.normalizeApiResponse('non json', { lang: 'es' }, null);
  assert(fallback.shouldRespond === false, 'JSON invalido deve restituire default failsafe');
  assert(fallback.language === 'es', 'default failsafe deve preservare lingua locale');
  assert(fallback.relational_posture === 'direct', 'default failsafe deve usare postura direct');
  assert(fallback.relational_posture_confidence === 0, 'default failsafe deve azzerare la confidenza postura');

  const lowConfidence = EmailQuickCheckPolicy.normalizeDecisionData({
    reply_needed: true,
    language: 'it',
    category: 'TECHNICAL',
    topic: 'sollecito',
    confidence: 0.8,
    reason: 'sollecito ambiguo',
    relational_posture: 'urgent',
    relational_posture_confidence: 0.4
  }, { lang: 'it' });
  assert(lowConfidence.relational_posture === 'direct', 'postura sotto soglia deve fare fallback a direct');
  assert(lowConfidence.relational_posture_confidence === 0.4, 'la confidenza sotto soglia resta tracciata');

  const legacyRelationalPosture = EmailQuickCheckPolicy.normalizeDecisionData({
    reply_needed: true,
    language: 'it',
    category: 'TECHNICAL',
    topic: 'richiesta personale',
    confidence: 0.8,
    reason: 'test legacy',
    relational_posture: 'relational',
    relational_posture_confidence: 0.95
  }, { lang: 'it' });
  assert(legacyRelationalPosture.relational_posture === 'personal', 'legacy relational deve normalizzarsi a personal');

  const legacyProceduralPosture = EmailQuickCheckPolicy.normalizeDecisionData({
    reply_needed: true,
    language: 'it',
    category: 'TECHNICAL',
    topic: 'procedura',
    confidence: 0.8,
    reason: 'test legacy',
    relational_posture: 'procedural',
    relational_posture_confidence: 0.95
  }, { lang: 'it' });
  assert(legacyProceduralPosture.relational_posture === 'direct', 'legacy procedural deve normalizzarsi a direct');

  const unsafeHint = EmailQuickCheckPolicy.normalizeDecisionData({
    reply_needed: true,
    language: 'it',
    category: 'TECHNICAL',
    topic: 'orari',
    confidence: 0.8,
    reason: 'test',
    response_focus_hint: 'utente ansioso, rispondere con calma',
    response_focus_hint_confidence: 0.95
  }, { lang: 'it' });
  assert(unsafeHint.response_focus_hint === null, 'response_focus_hint fuori enum deve essere scartato');

  const lowHintConfidence = EmailQuickCheckPolicy.normalizeDecisionData({
    reply_needed: true,
    language: 'it',
    category: 'TECHNICAL',
    topic: 'orari',
    confidence: 0.8,
    reason: 'test',
    response_focus_hint: 'answer_only_residual_question',
    response_focus_hint_confidence: 0.4
  }, { lang: 'it' });
  assert(lowHintConfidence.response_focus_hint === null, 'response_focus_hint sotto soglia deve essere scartato');

  const lowShiftConfidence = EmailQuickCheckPolicy.normalizeDecisionData({
    reply_needed: true,
    language: 'it',
    category: 'TECHNICAL',
    topic: 'orari',
    confidence: 0.8,
    reason: 'test',
    conversation_shift: 'topic_change',
    conversation_shift_confidence: 0.4
  }, { lang: 'it' });
  assert(lowShiftConfidence.conversation_shift === 'none', 'conversation_shift sotto soglia deve cadere a none');
}

console.log('--- Test request purpose: azione esplicita prevale sul topic procedurale ---');
{
  const operationalEmail = [
    'Agnese Tonchei, nata il 28/02/1998, battesimo il 24/05/1998 a Sant Eugenio.',
    'Richiedo gentilmente il certificato di battesimo in originale per uso matrimonio.',
    'Verrò io a ritirarlo di persona lunedì 27 o martedì 28 luglio.'
  ].join(' ');
  const resolvedOperational = EmailQuickCheckPolicy.resolveRequestPurpose(
    'information_request',
    0.91,
    'Certificato di battesimo',
    operationalEmail
  );
  assert(resolvedOperational.type === 'operational_request', 'una richiesta esplicita di rilascio deve prevalere su un errato modello informativo');
  assert(resolvedOperational.source === 'local_explicit_action', 'l override deve restare tracciabile come segnale testuale locale');

  const information = EmailQuickCheckPolicy.resolveRequestPurpose(
    'unknown',
    0,
    'Informazioni certificato',
    'Quali documenti servono e dove devo richiedere il certificato di battesimo?'
  );
  assert(information.type === 'information_request', 'domande su requisiti e luogo devono restare informative');

  const update = EmailQuickCheckPolicy.resolveRequestPurpose(
    'unknown',
    0,
    'Aggiornamento',
    'Vi informo che la data prevista è cambiata e confermo il nuovo recapito.'
  );
  assert(update.type === 'status_update', 'una comunicazione senza domanda deve essere classificata come aggiornamento');
}

console.log('--- Test _generateWithModel: il client generico preserva prompt strutturato e profilo generation ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = null;
  service.config = { MAX_OUTPUT_TOKENS: 128 };
  service._buildGenerateUrl = () => 'https://example.test/generate';
  let capturedPayload = null;
  service.fetchFn = (_url, request) => {
    capturedPayload = JSON.parse(request.payload);
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Risposta ok' }] } }],
        usageMetadata: {
          promptTokenCount: 11,
          candidatesTokenCount: 5,
          totalTokenCount: 16
        }
      })
    };
  };

  const text = service._generateWithModel(
    { systemInstruction: 'Istruzioni di sistema', prompt: 'Prompt utente' },
    'gemini-test'
  );

  assert(text === 'Risposta ok', 'deve restituire il testo estratto dal client generico');
  assert(capturedPayload.systemInstruction.parts[0].text === 'Istruzioni di sistema', 'systemInstruction deve restare nel payload dedicato');
  assert(capturedPayload.contents[0].parts[0].text === 'Prompt utente', 'prompt utente deve restare nei contents');
  assert(capturedPayload.generationConfig.maxOutputTokens === 128, 'profilo generation deve rispettare MAX_OUTPUT_TOKENS');
  assert(Array.isArray(capturedPayload.safetySettings) && capturedPayload.safetySettings.length === 4, 'safety settings devono essere centralizzati nel payload');

  const envelope = service._generateWithModelEnvelope_('Prompt utente', 'gemini-test');
  assert(envelope.__rateLimiterEnvelope === true, 'envelope deve essere marcato esplicitamente per il RateLimiter');
  assert(envelope.result === 'Risposta ok', 'envelope deve preservare il testo generato');
  assert(envelope.actualTokens === 16, 'envelope deve estrarre usageMetadata.totalTokenCount');
  assert(envelope.usageMetadata.promptTokenCount === 11, 'envelope deve preservare usageMetadata normalizzato');
}

console.log('--- Test grounding counter: GeminiService delega al RateLimiter se disponibile ---');
{
  const service = Object.create(GeminiService.prototype);
  let delegatedCount = 0;
  service.useRateLimiter = true;
  service.rateLimiter = {
    reserveGoogleSearchGroundingQueries: (count) => {
      delegatedCount += count;
      return { used: count };
    }
  };
  service.config = { GEMINI_FREE_TIER_NOTES: { groundingSharedRpd: 10 } };

  const stats = service._incrementGroundingCounterLocal_(3);

  assert(delegatedCount === 3, 'il counter grounding locale deve delegare al RateLimiter');
  assert(stats && stats.used === 3, 'deve restituire il risultato del RateLimiter');
}

console.log('--- Test GeminiContentClient: allegato grande non chiama getBytes ---');
{
  const client = new GeminiContentClient({});
  let getBytesCalled = false;
  const parts = client.buildRequestParts('Prompt utente', [{
    getContentType: () => 'application/pdf',
    getSize: () => (10 * 1024 * 1024) + 1,
    getBytes: () => {
      getBytesCalled = true;
      return [];
    }
  }]);

  assert(getBytesCalled === false, 'allegato oltre soglia deve essere scartato prima di getBytes');
  assert(parts.length === 1 && parts[0].text === 'Prompt utente', 'il prompt testuale deve restare presente anche se l allegato viene scartato');
}

console.log('--- Test _generateWithModel: testo vuoto marca isTransient ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = null;
  service.config = { MAX_OUTPUT_TOKENS: 128 };
  service._buildGenerateUrl = () => 'https://example.test/generate';
  service._normalizePromptPayload_ = (prompt) => ({ userPrompt: String(prompt), systemInstruction: '' });
  service.fetchFn = () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({
      candidates: [{ content: { parts: [{ text: '   ' }] } }]
    })
  });

  try {
    service._generateWithModel('ciao', 'gemini-test');
    assert(false, 'testo vuoto deve lanciare errore');
  } catch (error) {
    assert(error.message.includes('testo vuoto'), 'errore deve descrivere il testo vuoto');
    assert(error.isTransient === true, 'errore testo vuoto deve essere marcato isTransient');
  }
}


console.log('--- Test _generateWithModel: parts assenti marca isTransient ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = null;
  service.config = { MAX_OUTPUT_TOKENS: 128 };
  service._buildGenerateUrl = () => 'https://example.test/generate';
  service._normalizePromptPayload_ = (prompt) => ({ userPrompt: String(prompt), systemInstruction: '' });
  service.fetchFn = () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({
      candidates: [{ content: {} }]
    })
  });

  try {
    service._generateWithModel('ciao', 'gemini-test');
    assert(false, 'parts assenti devono lanciare errore');
  } catch (error) {
    assert(error.message.includes('parti vuote o assenti'), 'errore deve descrivere parts assenti');
    assert(error.isTransient === true, 'errore parts assenti deve essere marcato isTransient');
  }
}

console.log('--- Test _generateWithModel: 5xx marca errore transitorio ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = null;
  service.config = { MAX_OUTPUT_TOKENS: 128 };
  service._buildGenerateUrl = () => 'https://example.test/generate';
  service._normalizePromptPayload_ = (prompt) => ({ userPrompt: String(prompt), systemInstruction: '' });
  service.fetchFn = () => ({
    getResponseCode: () => 503,
    getContentText: () => JSON.stringify({ error: { message: 'Service unavailable' } })
  });

  try {
    service._generateWithModel('ciao', 'gemini-test');
    assert(false, '5xx deve lanciare errore');
  } catch (error) {
    assert(error.message.includes('Errore server temporaneo'), 'errore 5xx deve descrivere server temporaneo');
    assert(error.isTransient === true, 'errore 5xx deve essere marcato isTransient');
  }
}

console.log('--- Test _resolveLanguage: localLang nullo non genera codice nu ---');
{
  const service = Object.create(GeminiService.prototype);
  const resolved = service._resolveLanguage('en', null, 5);
  assert(resolved === 'it', 'localLang nullo con alta sicurezza locale deve usare fallback it, non nu');
}



console.log('--- Test _withRetry: segnale switch chiave non consuma retry locali ---');
{
  const previousUtilities = global.Utilities;
  global.Utilities = {
    sleep: () => {
      assert(false, 'PRIMARY_QUOTA_EXHAUSTED non deve attendere retry locali');
    }
  };

  const service = Object.create(GeminiService.prototype);
  service.maxRetries = 3;
  service.retryDelay = 1;
  service.backoffFactor = 2;
  service.maxBackoffMs = 10;
  service.retryJitterMs = 0;
  service._classifyError = () => ({ type: 'RETRYABLE', retryable: true });
  let calls = 0;

  try {
    service._withRetry(() => {
      calls += 1;
      throw new Error('PRIMARY_QUOTA_EXHAUSTED');
    }, 'test switch chiave');
    assert(false, 'deve rilanciare immediatamente PRIMARY_QUOTA_EXHAUSTED');
  } catch (error) {
    assert(error.message === 'PRIMARY_QUOTA_EXHAUSTED', 'deve preservare il segnale di switch chiave');
    assert(calls === 1, 'deve eseguire un solo tentativo locale');
  } finally {
    global.Utilities = previousUtilities;
  }
}

console.log('--- Test classifyError: 404 cachedContent è rigenerabile, 404 generico no ---');
{
  const cacheExpired = classifyError(new Error('Errore API 404: Cached content not found'));
  const genericNotFound = classifyError(new Error('Errore API 404: model not found'));

  assert(cacheExpired.type === ErrorTypes.CACHE_EXPIRED, '404 cachedContent deve essere CACHE_EXPIRED');
  assert(cacheExpired.retryable === true, 'CACHE_EXPIRED deve essere retryable');
  assert(genericNotFound.type !== ErrorTypes.CACHE_EXPIRED, '404 generico non deve essere trattato come cache scaduta');
  assert(genericNotFound.retryable === false, '404 generico non deve essere retryable');
}

console.log('--- Test shouldRespondToEmail: preserva errore RateLimiter non quota ---');
{
  const service = Object.create(GeminiService.prototype);
  const originalError = new Error('transiente interno');
  originalError._nonRetryable = true;
  service.useRateLimiter = true;
  service.rateLimiter = {
    executeRequest: () => { throw originalError; }
  };

  try {
    service.shouldRespondToEmail('contenuto', 'oggetto', { language: 'it' });
    assert(false, 'shouldRespondToEmail deve rilanciare errori RateLimiter non quota');
  } catch (error) {
    assert(error === originalError, 'deve preservare identità e stack trace dell’errore originale');
    assert(error._nonRetryable === true, 'deve preservare proprietà custom dell’errore originale');
  }
}

console.log('--- Test _generateWithModel: 429 senza backup propaga QUOTA_EXHAUSTED ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = '';
  service.config = { TEMPERATURE: 0.5, MAX_OUTPUT_TOKENS: 1000 };
  service._buildGenerateUrl = () => 'https://generativelanguage.googleapis.com/v1beta/models/test:generateContent';
  service.fetchFn = () => ({
    getResponseCode: () => 429,
    getContentText: () => JSON.stringify({ error: { message: 'rate limit' } })
  });

  let thrown = null;
  try {
    service._generateWithModel('prompt', 'gemini-test', 'primary-key', []);
  } catch (error) {
    thrown = error;
  }

  assert(thrown && thrown.message.includes('QUOTA_EXHAUSTED'), '429 deve includere QUOTA_EXHAUSTED per il RateLimiter');
  assert(thrown.isTransient === true, '429 deve essere marcato isTransient per backoff/retry');
}

console.log('--- Test _generateWithModel: 429 primaria con backup marca segnale transient di key switch ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = 'backup-key';
  service.config = { TEMPERATURE: 0.5, MAX_OUTPUT_TOKENS: 1000 };
  service._buildGenerateUrl = () => 'https://generativelanguage.googleapis.com/v1beta/models/test:generateContent';
  let markedReason = '';
  service._markPrimaryExhausted_ = (reason) => {
    markedReason = reason;
    service.isPrimaryExhausted = true;
  };
  service.fetchFn = () => ({
    getResponseCode: () => 429,
    getContentText: () => JSON.stringify({ error: { message: 'rate limit primary' } })
  });

  let thrown = null;
  try {
    service._generateWithModel('prompt', 'gemini-test', 'primary-key', []);
  } catch (error) {
    thrown = error;
  }

  assert(thrown && thrown.message === 'PRIMARY_QUOTA_EXHAUSTED', '429 sulla primaria con backup deve segnalare key switch');
  assert(thrown.isTransient === true, 'il segnale di key switch deve essere marcato transient per i wrapper esterni');
  assert(markedReason === 'generateResponse' && service.isPrimaryExhausted === true, 'la primaria deve essere marcata esaurita');
}


console.log('--- Test _generateWithModel: 403 primaria con backup marca segnale transient di key switch ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = 'backup-key';
  service.config = { TEMPERATURE: 0.5, MAX_OUTPUT_TOKENS: 1000 };
  service._buildGenerateUrl = () => 'https://generativelanguage.googleapis.com/v1beta/models/test:generateContent';
  let markedReason = '';
  service._markPrimaryExhausted_ = (reason) => {
    markedReason = reason;
    service.isPrimaryExhausted = true;
  };
  service.fetchFn = () => ({
    getResponseCode: () => 403,
    getContentText: () => JSON.stringify({ error: { message: 'billing disabled' } })
  });

  let thrown = null;
  try {
    service._generateWithModel('prompt', 'gemini-test', 'primary-key', []);
  } catch (error) {
    thrown = error;
  }

  assert(thrown && thrown.message === 'PRIMARY_QUOTA_EXHAUSTED', '403 sulla primaria con backup deve segnalare key switch');
  assert(thrown.isTransient === true, 'il segnale di key switch su 403 deve essere transient');
  assert(markedReason === 'generateResponse' && service.isPrimaryExhausted === true, 'la primaria deve essere marcata non utilizzabile su 403');
}

console.log('--- Test generateResponse: 429 primaria fa failover sincrono su backup ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = 'backup-key';
  service.isPrimaryExhausted = false;
  service.useRateLimiter = false;
  service.config = { MAX_OUTPUT_TOKENS: 128 };
  service.maxRetries = 2;
  service.retryDelay = 1;
  service.backoffFactor = 2;
  service.maxBackoffMs = 10;
  service.retryJitterMs = 0;
  const urls = [];
  service.fetchFn = (url) => {
    urls.push(url);
    if (urls.length === 1) {
      return {
        getResponseCode: () => 429,
        getContentText: () => JSON.stringify({ error: { message: 'rate limit primary' } })
      };
    }
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Risposta backup' }] } }]
      })
    };
  };

  const result = service.generateResponse('prompt', { modelName: 'gemini-test' });

  assert(result && result.success === true, 'generateResponse deve riuscire con la backup key');
  assert(result.text === 'Risposta backup', 'deve restituire il testo generato dalla backup key');
  assert(urls.length === 2, 'deve eseguire primary e poi backup nello stesso ciclo');
  assert(urls[0].includes('primary-key') && urls[1].includes('backup-key'), 'ordine chiavi atteso primary -> backup');
  assert(service.isPrimaryExhausted === true, 'la primary deve restare marcata esaurita dopo il failover');
}

// Test rimossi perché la funzionalità di context caching è stata eliminata

console.log('--- Test model policy: quick_check non rate-limited usa lite, non MODEL_NAME qualita ---');
{
  const service = Object.create(GeminiService.prototype);
  service.useRateLimiter = false;
  service.modelName = 'gemini-3.7-flash';
  service.config = {
    MODEL_STRATEGY: {
      quick_check: ['flash-lite'],
      generation: ['flash-3.7']
    },
    GEMINI_MODELS: {
      'flash-3.7': { name: 'gemini-3.7-flash' },
      'flash-lite': { name: 'gemini-3.5-flash-lite' }
    }
  };
  service.detectEmailLanguage = () => ({ lang: 'it', confidence: 5, safetyGrade: 5 });
  service._withRetry = (fn) => fn();
  let modelUsed = null;
  service._quickCheckWithModel = (_content, _subject, modelName) => {
    modelUsed = modelName;
    return { shouldRespond: true, language: 'it', classification: { category: 'TECHNICAL' } };
  };

  const result = service.shouldRespondToEmail('Vorrei informazioni', 'Info');
  assert(result.shouldRespond === true, 'quick_check deve restituire il risultato del modello');
  assert(modelUsed === 'gemini-3.5-flash-lite', `quick_check deve usare lite, ottenuto ${modelUsed}`);
  assert(service.getModelNameForTask('generation') === 'gemini-3.7-flash', 'generation deve risolvere il modello qualita');
}

console.log('--- Test generation strategies: rispetta configurazione e backup key ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = 'backup-key';
  service.isPrimaryExhausted = false;
  service.config = {
    MODEL_STRATEGY: {
      generation: ['custom_b', 'custom_a', 'custom-backup']
    },
    GEMINI_MODELS: {
      custom_b: { name: 'model-b' },
      custom_a: { name: 'model-a' },
      'custom-backup': { name: 'model-backup' }
    }
  };

  const plan = service.buildGenerationStrategies();

  assert(plan.fallbackModelName === 'model-b', 'fallbackModelName deve usare il primo modello configurato valido');
  assert(plan.configuredGenerationStrategy.join('|') === 'custom_b|custom_a|custom-backup', 'deve conservare la strategia configurata');
  assert(plan.attemptStrategy.map(item => item.model).join('|') === 'model-b|model-a|model-backup', 'deve rispettare ordine MODEL_STRATEGY.generation');
  assert(plan.attemptStrategy[0].key === 'primary-key' && plan.attemptStrategy[1].key === 'primary-key', 'strategie non-backup devono usare primary key');
  assert(plan.attemptStrategy[2].key === 'backup-key', 'strategie backup devono usare backup key');
  assert(plan.attemptStrategy[0].skipRateLimit === false && plan.attemptStrategy[2].skipRateLimit === true, 'solo backup deve saltare il RateLimiter');
}

console.log('--- Test generation strategies: salta primary esaurita ma mantiene fallback model ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = 'backup-key';
  service.isPrimaryExhausted = true;
  service.config = {
    MODEL_STRATEGY: {
      generation: ['flash-3.7', 'flash-lite', 'flash-lite-backup']
    },
    GEMINI_MODELS: {}
  };

  const plan = service.buildGenerationStrategies();

  assert(plan.fallbackModelName === 'gemini-3.7-flash', 'fallbackModelName deve restare il primo modello valido anche se la primary e esaurita');
  assert(plan.attemptStrategy.length === 1, 'con primary esaurita deve restare solo la strategia backup');
  assert(plan.attemptStrategy[0].name === 'Generation-3-flash-lite-backup-BackupKey', 'deve mantenere indice e nome della strategia originale');
  assert(plan.attemptStrategy[0].model === 'gemini-3.5-flash-lite', 'backup lite deve usare il modello default atteso');
  assert(plan.attemptStrategy[0].usesBackupKey === true && plan.attemptStrategy[0].skipRateLimit === true, 'backup deve essere segnata come tale');
}

console.log('--- Test quickCheck generationConfig: responseMimeType escluso per modelli lite ---');
{
  const makeService = () => {
    const service = Object.create(GeminiService.prototype);
    service.primaryKey = 'primary-key';
    service.backupKey = null;
    service._buildGenerateUrl = (modelName) => `https://example.test/${modelName}:generateContent`;
    service._resolveLanguage = (_candidate, fallback) => fallback || 'it';
    return service;
  };

  let litePayload = null;
  const liteService = makeService();
  liteService.fetchFn = (_url, payload) => {
    litePayload = JSON.parse(payload.payload);
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"reply_needed":true,"language":"it","category":"TECHNICAL","topic":"info","confidence":0.9,"reason":"ok"}' }] } }]
      })
    };
  };

  const liteOut = liteService._quickCheckWithModel(
    'Vorrei informazioni',
    'Info',
    'gemini-3.1-flash-lite',
    { lang: 'it', confidence: 5, safetyGrade: 5 }
  );

  assert(liteOut.shouldRespond === true, 'quick check lite deve restare funzionante');
  assert(!Object.prototype.hasOwnProperty.call(litePayload.generationConfig, 'responseMimeType'), 'i modelli lite non devono ricevere responseMimeType');

  let flashPayload = null;
  const flashService = makeService();
  flashService.fetchFn = (_url, payload) => {
    flashPayload = JSON.parse(payload.payload);
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"reply_needed":true,"language":"it","category":"TECHNICAL","topic":"info","confidence":0.9,"reason":"ok"}' }] } }]
      })
    };
  };

  flashService._quickCheckWithModel(
    'Vorrei informazioni',
    'Info',
    'gemini-3.5-flash',
    { lang: 'it', confidence: 5, safetyGrade: 5 }
  );

  assert(flashPayload.generationConfig.responseMimeType === 'application/json', 'i modelli non-lite devono mantenere responseMimeType JSON');
}

console.log('--- Test quickCheck: 503 non consuma chiave backup ---');
{
  const previousUtilities = global.Utilities;
  global.Utilities = {
    sleep: () => {
      assert(false, 'errore server 503 non deve attivare sleep/fallback sulla backup key');
    }
  };

  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = 'backup-key';
  service._buildGenerateUrl = () => 'https://example.test/generate';
  service._resolveLanguage = (_candidate, fallback) => fallback || 'it';
  let calls = 0;
  service.fetchFn = (url) => {
    calls += 1;
    assert(url.includes('primary-key'), 'il 503 deve restare sulla chiave primaria');
    return {
      getResponseCode: () => 503,
      getContentText: () => JSON.stringify({ error: { message: 'server overloaded' } })
    };
  };

  try {
    service._quickCheckWithModel(
      'Vorrei informazioni',
      'Info',
      'gemini-3.5-flash',
      { lang: 'it', confidence: 5, safetyGrade: 5 }
    );
    assert(false, '503 deve essere propagato come errore server');
  } catch (error) {
    assert(String(error.message || '').includes('Errore server Gemini(503)'), '503 deve restare errore server retryable');
    assert(error.isTransient === true, '503 quick check deve essere marcato transitorio per i wrapper di retry');
    assert(calls === 1, '503 non deve causare una seconda chiamata con backup key');
  } finally {
    global.Utilities = previousUtilities;
  }
}

console.log('--- Test quickCheck: 429 primary marca stato exhausted e passa a backup ---');
{
  const previousUtilities = global.Utilities;
  global.Utilities = { sleep: () => {} };

  const cache = {};
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = 'backup-key';
  service.isPrimaryExhausted = false;
  service._primaryExhaustedCacheKey = 'gemini_primary_exhausted';
  service._cache = {
    put: (key, value) => { cache[key] = value; }
  };
  service._buildGenerateUrl = () => 'https://example.test/generate';
  service._resolveLanguage = (_candidate, fallback) => fallback || 'it';
  const urls = [];
  service.fetchFn = (url) => {
    urls.push(url);
    if (urls.length === 1) {
      return {
        getResponseCode: () => 429,
        getContentText: () => JSON.stringify({ error: { message: 'quota exhausted' } })
      };
    }
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"reply_needed":true,"language":"it","category":"TECHNICAL","topic":"info","confidence":0.9,"reason":"ok"}' }] } }]
      })
    };
  };

  try {
    const result = service._quickCheckWithModel(
      'Vorrei informazioni',
      'Info',
      'gemini-3.5-flash',
      { lang: 'it', confidence: 5, safetyGrade: 5 }
    );
    assert(result.shouldRespond === true, 'quick check deve usare la risposta della backup key');
    assert(urls.length === 2, '429 primaria deve fare un solo fallback sulla backup key');
    assert(urls[0].includes('primary-key') && urls[1].includes('backup-key'), 'deve chiamare prima primary e poi backup');
    assert(service.isPrimaryExhausted === true, '429 primaria nel quick check deve propagare lo stato exhausted');
    assert(cache.gemini_primary_exhausted === 'true', '429 primaria nel quick check deve persistere lo stato exhausted in cache');
  } finally {
    global.Utilities = previousUtilities;
  }
}



console.log('--- Test quickCheck: 400 API key invalid primaria passa a backup ---');
{
  const previousUtilities = global.Utilities;
  global.Utilities = { sleep: () => {} };

  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = 'backup-key';
  service.isPrimaryExhausted = false;
  service._primaryExhaustedCacheKey = 'gemini_primary_exhausted';
  service._cache = { put: () => {} };
  service._buildGenerateUrl = () => 'https://example.test/generate';
  service._resolveLanguage = (_candidate, fallback) => fallback || 'it';
  const urls = [];
  service.fetchFn = (url) => {
    urls.push(url);
    if (urls.length === 1) {
      return {
        getResponseCode: () => 400,
        getContentText: () => JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } })
      };
    }
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"reply_needed":true,"language":"it","category":"TECHNICAL","topic":"info","confidence":0.9,"reason":"ok"}' }] } }]
      })
    };
  };

  try {
    const result = service._quickCheckWithModel(
      'Vorrei informazioni',
      'Info',
      'gemini-3.5-flash',
      { lang: 'it', confidence: 5, safetyGrade: 5 }
    );
    assert(result.shouldRespond === true, 'quick check deve usare backup key su 400 API key invalid');
    assert(urls.length === 2, '400 API key invalid primaria deve fare fallback una sola volta');
    assert(urls[0].includes('primary-key') && urls[1].includes('backup-key'), 'deve provare prima primary e poi backup');
    assert(service.isPrimaryExhausted === true, '400 key invalid deve marcare la primary non utilizzabile');
  } finally {
    global.Utilities = previousUtilities;
  }
}

console.log('✅ Test bilanciamento JSON Gemini passati');

console.log('--- Test EmailQuickCheckPolicy: response_strategy normalizzazione enum e soglia ---');
{
  const strategyCases = [
    ['Serve il certificato originale o basta copia?', 'clarify_requirements'],
    ['Abito fuori Roma, posso inviare tutto via mail?', 'reduce_user_effort'],
    ['Le invio in allegato il certificato.', 'confirm_receipt'],
    ['Quando posso passare?', 'guide_next_step'],
    ['Vorrei sapere gli orari della segreteria.', 'provide_information'],
    ['Sono preoccupato perché non so se posso fare da padrino.', 'offer_reassurance']
  ];

  for (const [text, expected] of strategyCases) {
    const result = EmailQuickCheckPolicy.normalizeDecisionData({
      reply_needed: true,
      language: 'it',
      category: 'TECHNICAL',
      topic: text,
      confidence: 0.8,
      reason: 'test',
      response_strategy: expected,
      response_strategy_confidence: 0.7
    }, { lang: 'it' });
    assert(result.response_strategy === expected, `response_strategy valido per "${text}" deve essere preservato`);
    assert(result.response_strategy_confidence >= 0.65, 'response_strategy_confidence valida deve essere preservata/clampata');
  }

  const unsafeStrategy = EmailQuickCheckPolicy.normalizeDecisionData({
    reply_needed: true,
    language: 'it',
    category: 'TECHNICAL',
    topic: 'test',
    confidence: 0.8,
    reason: 'test',
    response_strategy: 'psychological_support',
    response_strategy_confidence: 0.95
  }, { lang: 'it' });
  assert(unsafeStrategy.response_strategy === 'none', 'response_strategy fuori enum deve diventare none');

  const lowStrategy = EmailQuickCheckPolicy.normalizeDecisionData({
    reply_needed: true,
    language: 'it',
    category: 'TECHNICAL',
    topic: 'test',
    confidence: 0.8,
    reason: 'test',
    response_strategy: 'guide_next_step',
    response_strategy_confidence: 0.4
  }, { lang: 'it' });
  assert(lowStrategy.response_strategy === 'none', 'response_strategy sotto soglia deve diventare none');
}
