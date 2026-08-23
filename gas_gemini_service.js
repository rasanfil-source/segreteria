/**
 * GeminiService.js - Servizio API Gemini
 * Gestisce tutte le chiamate all'API Generativa di Google
 * 
 * FUNZIONALITÀ:
 * - Retry con exponential backoff
 * - Rilevamento lingua centralizzato
 * - Controllo rapido per decisione risposta
 * - Saluto adattivo (ora + calendario liturgico)
 * - Rate Limiter integrato con gestione quota
 */

var GEMINI_DEFAULT_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
];

var GEMINI_TASK_PROFILES = {
  generation: {
    maxOutputTokensConfigKey: 'MAX_OUTPUT_TOKENS',
    defaultMaxOutputTokens: 6000,
    temperature: 0.25,
    topK: 40,
    topP: 0.95
  },
  quick_check: {
    defaultMaxOutputTokens: 1024,
    temperature: 0.25,
    topK: 40,
    topP: 0.95,
    responseMimeType: 'application/json',
    omitResponseMimeTypeForModelIncludes: 'lite'
  },
  connection_test: {
    defaultMaxOutputTokens: 10,
    temperature: 0.1
  }
};

var GEMINI_MAX_INLINE_ATTACHMENT_BYTES = 10 * 1024 * 1024;

var GeminiContentClient = class GeminiContentClient {
  constructor(options = {}) {
    this.config = options.config || {};
    this.fetchFn = options.fetchFn;
    this.primaryKey = options.primaryKey;
    this.backupKey = options.backupKey || null;
    this.buildGenerateUrl = options.buildGenerateUrl;
    this.markPrimaryExhausted = options.markPrimaryExhausted || (() => {});
    this.isPrimaryKeyFallbackHttpError = options.isPrimaryKeyFallbackHttpError || (() => false);
    this.normalizePromptPayload = options.normalizePromptPayload || GeminiContentClient.normalizePromptPayload;
  }

  static normalizePromptPayload(promptData) {
    if (promptData && typeof promptData === 'object') {
      const userPrompt = promptData.prompt != null ? String(promptData.prompt) : '';
      const systemInstruction = promptData.systemInstruction != null
        ? String(promptData.systemInstruction)
        : '';
      return {
        userPrompt: userPrompt,
        systemInstruction: systemInstruction,
        combinedText: [systemInstruction, userPrompt].filter(Boolean).join('\n\n')
      };
    }

    const userPrompt = promptData == null ? '' : String(promptData);
    return {
      userPrompt: userPrompt,
      systemInstruction: '',
      combinedText: userPrompt
    };
  }

  getTaskProfile(taskType) {
    return GEMINI_TASK_PROFILES[taskType] || GEMINI_TASK_PROFILES.generation;
  }

  usesLatestSamplingPolicy(modelName) {
    const normalized = String(modelName || '').trim().toLowerCase();
    return /^gemini-(?:3\.7-flash|3\.6-flash|3\.5-flash-lite)(?:$|-)/.test(normalized);
  }

  buildGenerationConfig(taskType, modelName, overrides = {}) {
    const profile = this.getTaskProfile(taskType);
    const config = {};
    const hasOverride = (key) => Object.prototype.hasOwnProperty.call(overrides, key);
    const usesLatestSamplingPolicy = this.usesLatestSamplingPolicy(modelName);
    const maxOutputTokens = hasOverride('maxOutputTokens')
      ? overrides.maxOutputTokens
      : (profile.maxOutputTokensConfigKey && this.config && this.config[profile.maxOutputTokensConfigKey] != null
        ? this.config[profile.maxOutputTokensConfigKey]
        : profile.defaultMaxOutputTokens);

    if (maxOutputTokens != null) config.maxOutputTokens = maxOutputTokens;
    // Da Gemini 3.6 Flash / 3.5 Flash-Lite i parametri di sampling sono
    // deprecati: non devono essere inviati nemmeno se presenti nei profili legacy.
    if (!usesLatestSamplingPolicy) {
      if (hasOverride('temperature') || profile.temperature != null) {
        config.temperature = hasOverride('temperature') ? overrides.temperature : profile.temperature;
      }
      if (hasOverride('topK') || profile.topK != null) {
        config.topK = hasOverride('topK') ? overrides.topK : profile.topK;
      }
      if (hasOverride('topP') || profile.topP != null) {
        config.topP = hasOverride('topP') ? overrides.topP : profile.topP;
      }
    }

    const responseMimeType = hasOverride('responseMimeType')
      ? overrides.responseMimeType
      : profile.responseMimeType;
    const omitNeedle = profile.omitResponseMimeTypeForModelIncludes;
    const shouldOmitResponseMimeType = !!(
      responseMimeType &&
      omitNeedle &&
      String(modelName || '').toLowerCase().includes(String(omitNeedle).toLowerCase())
    );
    if (responseMimeType && !shouldOmitResponseMimeType) {
      config.responseMimeType = responseMimeType;
    }

    return config;
  }

  getSafetySettings() {
    return GEMINI_DEFAULT_SAFETY_SETTINGS.map((item) => Object.assign({}, item));
  }

  buildRequestParts(userPromptText, attachments = []) {
    const requestParts = [];
    if (attachments && attachments.length > 0) {
      attachments.forEach((blob) => {
        try {
          if (blob && blob.inlineData && blob.inlineData.data) {
            requestParts.push(blob);
            return;
          }
          const mimeType = blob && typeof blob.getContentType === 'function' ? blob.getContentType() : '';
          if (!mimeType) {
            console.warn('Allegato ignorato: contentType mancante o non valido');
            return;
          }
          if (typeof blob.getSize === 'function') {
            const size = Number(blob.getSize());
            if (Number.isFinite(size) && size > GEMINI_MAX_INLINE_ATTACHMENT_BYTES) {
              console.warn(`Allegato ignorato (OOM protection): dimensione superiore ai 10MB (${mimeType})`);
              return;
            }
          }
          const bytes = blob.getBytes();
          if (bytes && bytes.length > GEMINI_MAX_INLINE_ATTACHMENT_BYTES) {
            console.warn(`Allegato ignorato (OOM protection): dimensione superiore ai 10MB (${mimeType})`);
            return;
          }
          requestParts.push({
            inlineData: {
              mimeType: mimeType,
              data: Utilities.base64Encode(bytes)
            }
          });
        } catch (e) {
          console.warn(`Impossibile encodare l'allegato: ${e.message}`);
        }
      });
    }
    requestParts.push({ text: userPromptText });
    return requestParts;
  }

  buildGenerateContentPayload(request = {}) {
    const taskType = request.taskType || 'generation';
    const promptPayload = request.promptPayload || this.normalizePromptPayload(request.prompt);
    const userPromptText = promptPayload.userPrompt;
    const systemInstructionText = promptPayload.systemInstruction;
    const requestParts = request.parts || this.buildRequestParts(userPromptText, request.attachments || []);
    const payloadObj = {
      contents: [{ role: 'user', parts: requestParts }],
      generationConfig: request.generationConfig || this.buildGenerationConfig(taskType, request.modelName, request.generationConfigOverrides || {}),
      safetySettings: request.safetySettings || this.getSafetySettings()
    };

    if (systemInstructionText) {
      payloadObj.systemInstruction = {
        parts: [{ text: systemInstructionText }]
      };
    }

    return {
      payloadObj: payloadObj,
      promptPayload: promptPayload,
      requestParts: requestParts
    };
  }

  fetchGenerateContent(request = {}) {
    const activeKey = request.apiKey || this.primaryKey;
    const built = this.buildGenerateContentPayload(request);
    const url = this.buildGenerateUrl(request.modelName);
    let response;

    try {
      response = this.fetchFn(`${url}?key=${encodeURIComponent(activeKey)}`, {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify(built.payloadObj),
        muteHttpExceptions: true
      });
    } catch (error) {
      const prefix = request.networkErrorPrefix || 'Errore rete/timeout durante chiamata Gemini';
      throw new Error(`${prefix}: ${error.message}`);
    }

    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (request.primaryFallbackSignalReason &&
        this.isPrimaryKeyFallbackHttpError(responseCode, responseBody) &&
        activeKey === this.primaryKey && this.backupKey) {
      this.markPrimaryExhausted(request.primaryFallbackSignalReason, responseCode);
      const quotaError = new Error('PRIMARY_QUOTA_EXHAUSTED');
      quotaError.isTransient = true;
      throw quotaError;
    }

    return {
      response: response,
      responseCode: responseCode,
      responseBody: responseBody,
      payloadObj: built.payloadObj,
      promptPayload: built.promptPayload,
      requestParts: built.requestParts,
      activeKey: activeKey
    };
  }

  extractApiErrorMessage(responseBody) {
    let apiErrorMsg = (responseBody || '').substring(0, 200);
    try {
      const parsedObj = JSON.parse(responseBody);
      if (parsedObj && parsedObj.error && parsedObj.error.message) {
        apiErrorMsg = parsedObj.error.message;
      }
    } catch (e) {
      // Manteniamo fallback al body raw troncato.
    }
    return apiErrorMsg;
  }

  assertTextGenerationHttpOk(apiResponse) {
    const responseCode = apiResponse.responseCode;
    const responseBody = apiResponse.responseBody;
    const apiErrorMsg = this.extractApiErrorMessage(responseBody);

    if ([429, 500, 502, 503, 504].includes(responseCode)) {
      if (responseCode === 429) {
        const quotaError = new Error(`QUOTA_EXHAUSTED: Quota o rate limit superato (429): ${apiErrorMsg}`);
        quotaError.isTransient = true;
        throw quotaError;
      }
      const transientError = new Error(`Errore server temporaneo (${responseCode}): ${apiErrorMsg}`);
      transientError.isTransient = true;
      throw transientError;
    }

    if (responseCode === 400) {
      const bodyLower = responseBody.toLowerCase();
      const isTokenLimit = bodyLower.includes('token') && (bodyLower.includes('limit') || bodyLower.includes('exceed'));
      if (isTokenLimit) {
        throw new Error('Errore contenuto: prompt supera il limite token del modello.');
      }
      throw new Error(`Errore API 400: ${apiErrorMsg}`);
    }

    if (responseCode === 403) {
      throw new Error(`Errore API 403: ${apiErrorMsg}`);
    }

    if (responseCode !== 200) {
      throw new Error(`Errore API ${responseCode}: ${apiErrorMsg}`);
    }
  }

  parseJsonResponse(responseBody) {
    try {
      return JSON.parse(responseBody);
    } catch (error) {
      throw new Error(`Risposta Gemini non JSON valida: ${error.message}`);
    }
  }

  static normalizeUsageMetadata(usageMetadata) {
    if (!usageMetadata || typeof usageMetadata !== 'object') return null;

    const normalized = {};
    [
      'promptTokenCount',
      'candidatesTokenCount',
      'totalTokenCount',
      'cachedContentTokenCount',
      'thoughtsTokenCount',
      'toolUsePromptTokenCount'
    ].forEach((key) => {
      const value = Number(usageMetadata[key]);
      if (Number.isFinite(value) && value >= 0) {
        normalized[key] = value;
      }
    });

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  extractCandidateText(result) {
    if (!result.candidates || !result.candidates[0]) {
      const blockReason = result.promptFeedback && result.promptFeedback.blockReason
        ? result.promptFeedback.blockReason
        : null;
      if (blockReason) {
        throw new Error(`Risposta bloccata da Gemini (promptFeedback): ${blockReason}`);
      }
      throw new Error('Risposta Gemini non valida: nessun candidato');
    }

    const candidate = result.candidates[0];

    if (candidate.finishReason && ['SAFETY', 'RECITATION', 'OTHER', 'BLOCKLIST'].includes(candidate.finishReason)) {
      throw new Error(`Risposta bloccata da Gemini: ${candidate.finishReason}`);
    }

    const parts = candidate.content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) {
      const emptyPartsErr = new Error('Gemini ha restituito parti vuote o assenti');
      emptyPartsErr.isTransient = true;
      throw emptyPartsErr;
    }
    const generatedText = parts.map(p => p.text || '').join('').trim();

    if (!generatedText) {
      const emptyErr = new Error('Gemini ha restituito testo vuoto');
      emptyErr.isTransient = true;
      throw emptyErr;
    }

    return {
      text: generatedText,
      partsCount: parts.length,
      usageMetadata: GeminiContentClient.normalizeUsageMetadata(result.usageMetadata)
    };
  }

  generateText(request = {}) {
    const apiResponse = this.fetchGenerateContent(request);
    this.assertTextGenerationHttpOk(apiResponse);
    const result = this.parseJsonResponse(apiResponse.responseBody);
    return this.extractCandidateText(result);
  }
};

var EmailQuickCheckPolicy = class EmailQuickCheckPolicy {
  static getQuickCheckSchemaLevels() {
    return {
      level1_message: {
        always: true,
        fields: [
          'language',
          'category',
          'topic',
          'request_purpose',
          'relational_posture',
          'response_strategy',
          'attachment_intent',
          'document_delivery',
          'physical_presence_constraint',
          'is_territory_request',
          'territory_address_candidates'
        ]
      },
      level2_conversation: {
        always: false,
        requiresConversationContext: true,
        fields: [
          'conversation_shift',
          'goal_continuity',
          'response_focus_hint',
          'new_information_provided'
        ]
      },
      level3_longitudinal: {
        always: false,
        allowedInQuickCheck: false,
        fields: [
          'residual_sensitivity',
          'longitudinal_sensitivity'
        ]
      }
    };
  }

  static hasConversationContext(intentContext = null) {
    return !!(intentContext && intentContext.hasConversationContext === true);
  }

  static renderQuickMemoryContext(intentContext = null) {
    const memory = intentContext && intentContext.quickMemoryContext && typeof intentContext.quickMemoryContext === 'object'
      ? intentContext.quickMemoryContext
      : null;
    if (!memory) return '';

    const lines = [];
    const summary = String(memory.summary || '').trim().substring(0, 500);
    if (summary) lines.push(`- Sintesi breve: ${summary}`);

    const topics = Array.isArray(memory.providedInfo)
      ? memory.providedInfo.map(item => String(item || '').trim()).filter(Boolean).slice(-5)
      : [];
    if (topics.length > 0) lines.push(`- Topic già emersi: ${topics.join('; ')}`);

    const state = memory.conversationState && typeof memory.conversationState === 'object'
      ? memory.conversationState
      : null;
    if (state) {
      const stateParts = [];
      if (state.currentRelationalPosture) stateParts.push(`posture=${String(state.currentRelationalPosture).substring(0, 40)}`);
      if (state.responseFocusHint) stateParts.push(`focus=${String(state.responseFocusHint).substring(0, 80)}`);
      if (state.goalContinuity) stateParts.push(`goal=${String(state.goalContinuity).substring(0, 60)}`);
      if (stateParts.length > 0) lines.push(`- Stato conversazionale: ${stateParts.join(', ')}`);
    }

    const flags = memory.contextualFlags && typeof memory.contextualFlags === 'object'
      ? Object.keys(memory.contextualFlags).filter(key => memory.contextualFlags[key] === true).slice(0, 8)
      : [];
    if (flags.length > 0) lines.push(`- Flag contestuali: ${flags.join(', ')}`);

    if (lines.length === 0) return '';
    return `CONTESTO MEMORIA SINTETICO (solo per valutare continuità e non-ripetizione):
${lines.join('\n')}
`;
  }

  static stripForbiddenQuickCheckFields(data) {
    if (!data || typeof data !== 'object') return data;
    delete data.residual_sensitivity;
    delete data.longitudinal_sensitivity;
    return data;
  }

  static isDocumentSubmissionIntent(intentContext) {
    return !!(intentContext && (
      intentContext.intent === 'suspected_submission' ||
      intentContext.intent === 'suspected_submission_with_question' ||
      intentContext.intent === 'document_submission' ||
      intentContext.intent === 'document_submission_with_question'
    ));
  }

  static shouldClassifySponsorGuidance(intentContext) {
    return !!(intentContext && intentContext.sponsorGuidanceCheck === true);
  }

  static normalizeBoolean(value) {
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === 'yes' || normalized === 'si') return true;
      if (normalized === 'false' || normalized === 'no') return false;
    }
    return undefined;
  }

  static normalizePhysicalPresenceConstraint(data) {
    const raw = data && typeof data === 'object' ? data.physical_presence_constraint : null;
    if (!raw || typeof raw !== 'object') {
      return {
        has_constraint: false,
        type: 'none',
        confidence: 0,
        evidence: '',
        reason: '',
        visit_policy: 'unknown',
        source: 'quick_check'
      };
    }

    const allowedTypes = {
      geographic_distance: true,
      health: true,
      mobility: true,
      caregiving: true,
      legal_restriction: true,
      temporary_unavailability: true,
      remote_request: true,
      other: true,
      none: true
    };
    const allowedPolicies = {
      avoid_invitation: true,
      conditional_only: true,
      visit_ok: true,
      unknown: true
    };

    const normalizedHasConstraint = EmailQuickCheckPolicy.normalizeBoolean(
      Object.prototype.hasOwnProperty.call(raw, 'has_constraint')
        ? raw.has_constraint
        : raw.is_remote
    );
    const confidence = Number(raw.confidence);
    const safeConfidence = Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : (normalizedHasConstraint ? 0.75 : 0);
    const rawType = String(raw.type || '').trim().toLowerCase();
    const type = normalizedHasConstraint
      ? (allowedTypes[rawType] && rawType !== 'none' ? rawType : 'other')
      : 'none';
    const rawPolicy = String(raw.visit_policy || '').trim().toLowerCase();
    const visitPolicy = allowedPolicies[rawPolicy]
      ? rawPolicy
      : (normalizedHasConstraint ? 'conditional_only' : 'unknown');

    return {
      has_constraint: normalizedHasConstraint === true,
      type: type,
      confidence: safeConfidence,
      evidence: raw.evidence ? String(raw.evidence).substring(0, 180) : '',
      reason: raw.reason ? String(raw.reason).substring(0, 180) : '',
      visit_policy: visitPolicy,
      source: 'quick_check'
    };
  }

  static normalizeTerritoryAddressCandidates(value) {
    if (!Array.isArray(value)) return [];

    const seen = {};
    const normalized = [];
    value.forEach((candidate) => {
      if (candidate == null) return;
      const text = String(candidate)
        .replace(/\s+/g, ' ')
        .replace(/[=<>]/g, '')
        .trim()
        .substring(0, 120);
      if (!text) return;
      const key = text.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      normalized.push(text);
    });

    return normalized.slice(0, 3);
  }

  static normalizeAttachmentIntent(value) {
    const source = (value && typeof value === 'object') ? value : {};
    const expectedDescription = String(source.expected_attachment_description || '').trim().slice(0, 200);
    const reason = String(source.reason || '').trim().slice(0, 200);
    const requiresReading = EmailQuickCheckPolicy.normalizeBoolean(source.requires_attachment_reading) === true;
    const mentionsAttachment = EmailQuickCheckPolicy.normalizeBoolean(source.mentions_attachment_or_document) === true ||
      requiresReading ||
      expectedDescription.length > 0;

    return {
      mentions_attachment_or_document: mentionsAttachment,
      expected_attachment_description: expectedDescription,
      requires_attachment_reading: requiresReading,
      reason: reason
    };
  }

  static normalizeDocumentDelivery(value) {
    const source = (value && typeof value === 'object') ? value : {};
    const allowedChannels = {
      attachment: true,
      body: true,
      both: true,
      unclear: true
    };
    const expectedDescription = String(source.expected_document_description || '').trim().slice(0, 240);
    const rawChannel = String(source.delivery_channel || '').trim().toLowerCase();
    const deliveryChannel = allowedChannels[rawChannel] ? rawChannel : 'unclear';
    const bodyContainsFilledDocument = EmailQuickCheckPolicy.normalizeBoolean(source.body_contains_filled_document) === true;
    const requiresFileAttachment = EmailQuickCheckPolicy.normalizeBoolean(source.requires_file_attachment) === true;
    const missingDocumentIfNoAttachment = EmailQuickCheckPolicy.normalizeBoolean(source.missing_document_if_no_attachment) === true;
    const expectedDocument = EmailQuickCheckPolicy.normalizeBoolean(source.expected_document) === true ||
      expectedDescription.length > 0 ||
      bodyContainsFilledDocument ||
      requiresFileAttachment ||
      missingDocumentIfNoAttachment;

    return {
      expected_document: expectedDocument,
      expected_document_description: expectedDescription,
      delivery_channel: deliveryChannel,
      body_contains_filled_document: bodyContainsFilledDocument,
      requires_file_attachment: requiresFileAttachment,
      missing_document_if_no_attachment: missingDocumentIfNoAttachment,
      reason: String(source.reason || '').trim().slice(0, 240)
    };
  }

  static isOfficeVisitLogisticsRequest(emailSubject, emailContent) {
    const text = `${emailSubject || ''} ${emailContent || ''}`;
    return /\b(?:posso|possiamo|potrei|potremmo|vorrei|vorremmo)\s+(?:passare|venire|presentarmi|presentarci)\b/i.test(text) ||
      /\b(?:passo|passiamo|vengo|veniamo)\s+(?:oggi|domani|dopodomani|lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)\b/i.test(text) ||
      /\b(?:passare|venire|presentarmi|presentarci)\s+(?:oggi|domani|dopodomani|in\s+segreteria|presso\s+la\s+segreteria)\b/i.test(text);
  }

  static applyOfficeVisitLogisticsOverride(result, emailSubject, emailContent) {
    if (!EmailQuickCheckPolicy.isOfficeVisitLogisticsRequest(emailSubject, emailContent)) {
      return result;
    }

    const normalized = result && typeof result === 'object' ? result : {};
    const classification = normalized.classification && typeof normalized.classification === 'object'
      ? Object.assign({}, normalized.classification)
      : {};

    classification.category = 'TECHNICAL';
    classification.topic = classification.topic && !/battesimo|sacramento|certificato/i.test(String(classification.topic))
      ? classification.topic
      : 'passaggio in segreteria';
    classification.confidence = Math.max(Number(classification.confidence) || 0, 0.8);

    return Object.assign({}, normalized, { classification });
  }

  static buildPrompt(emailContent, emailSubject, intentContext = null) {
    const safeSubject = typeof emailSubject === 'string' ? emailSubject : (emailSubject == null ? '' : String(emailSubject));
    const safeContent = typeof emailContent === 'string' ? emailContent : (emailContent == null ? '' : String(emailContent));
    const hasSubmissionContext = EmailQuickCheckPolicy.isDocumentSubmissionIntent(intentContext);
    const shouldClassifySponsorGuidance = EmailQuickCheckPolicy.shouldClassifySponsorGuidance(intentContext);
    const hasOfficeVisitLogistics = EmailQuickCheckPolicy.isOfficeVisitLogisticsRequest(safeSubject, safeContent);
    const hasConversationContext = EmailQuickCheckPolicy.hasConversationContext(intentContext);
    const quickMemoryContext = hasConversationContext
      ? EmailQuickCheckPolicy.renderQuickMemoryContext(intentContext)
      : '';
    const quickIntentGuardrail = hasSubmissionContext ? `
CONTESTO STRUTTURALE ALLEGATI:
- Il testo del mittente contiene segnali di consegna documentale ("in allegato", "allego", "le invio", ecc.).
- Eventuali parole provenienti da allegati/OCR come "padrino", "madrina", "cresima", "idoneità", "requisiti" NON devono essere interpretate come richiesta informativa.
- Se ci sono domande esplicite nel corpo email, rispondi a quelle; altrimenti classifica come consegna documentazione.
- Una consegna documentale da parte di un fedele/utente richiede risposta di cortesia: reply_needed deve essere TRUE, salvo spam/newsletter/autorisposta.
- Topic consigliato se non ci sono domande esplicite: "documentazione ricevuta".
- Non trasformare una consegna di certificato in una richiesta sui requisiti del padrino/madrina.
` : '';
    const visitLogisticsGuardrail = hasOfficeVisitLogistics ? `
CONTESTO LOGISTICO VISITA:
- La domanda principale è se l'utente può passare/venire in segreteria.
- Classifica come category "TECHNICAL" e topic "passaggio in segreteria".
- Il sacramento o documento citato è l'oggetto della visita, non una richiesta primaria di requisiti o procedura sacramentale.
` : '';
    const sponsorGuidanceTask = shouldClassifySponsorGuidance ? `
17. Determina needs_sponsor_guidance (boolean):
   - TRUE solo se nella risposta conviene inserire le condizioni per il ruolo ecclesiale di padrino/madrina/godparent.
   - Considera equivalenti sacramentali: padrino/madrina (it/es), godparent/godfather/godmother o sponsor sacramentale (en), parrain/marraine (fr), padrinho/madrinha (pt), Pate/Patin/Firmpate/Firmpatin (de).
   - TRUE se il mittente vuole assumere quel ruolo sacramentale e non ha ancora la Cresima/Confirmation, oppure chiede esplicitamente requisiti, condizioni o idoneità per quel ruolo.
   - FALSE in tutti gli altri casi.
   - FALSE se il mittente sta consegnando documenti propri o del proprio padrino/madrina per ricevere un sacramento.
   - FALSE se "padrino" o "madrina" indica solo l'accompagnatore sacramentale del mittente.
   - In italiano, "sponsor" NON significa padrino/madrina: se indica pubblicità, finanziamento o magliette, rispondi FALSE.
   - "Testimone" di matrimonio NON è padrino/madrina e NON richiede Cresima: rispondi FALSE.
   - In inglese, "sponsor" vale solo se il contesto è chiaramente sacramentale (Confirmation/Baptism/Catholic godparent); altrimenti FALSE.
   - FALSE se il mittente chiede solo logistica, date, orari, luogo o conferma di ricezione documenti.
 ` : '';
    const sponsorGuidanceJsonField = shouldClassifySponsorGuidance
      ? `,
  "needs_sponsor_guidance": boolean`
      : '';
    const conversationalTasks = hasConversationContext ? `
12. Determina response_focus_hint:
   - Valore ammesso: "avoid_repeating_known_requirements", "answer_only_residual_question", "provide_next_operational_step", "acknowledge_document_without_reopening_procedure", oppure null.
   - Deve riguardare solo il thread/conversazione, non la persona.
   - Deve aiutare la prossima risposta a evitare ripetizioni o concentrarsi sul passo operativo successivo.
   - Deve essere null se non emerge un'indicazione utile.
   - Non descrivere tratti, emozioni o profili del mittente.
   - Fornisci anche response_focus_hint_confidence (0.0-1.0).
13. Determina conversation_shift come evento locale del turno, non come stato persistente:
    - Valori ammessi: "none", "new_question", "topic_change", "new_information", "closure".
    - "new_information": l'utente non fa una domanda, ma aggiunge un fatto esplicito al percorso già avviato.
    - "closure": conversazione praticamente chiusa, senza nuove domande o informazioni operative.
    - Fornisci anche conversation_shift_confidence (0.0-1.0).
14. Determina goal_continuity:
   - Descrive il rapporto tra il messaggio corrente e il percorso operativo già avviato nella conversazione.
   - Valori ammessi: "none", "maintain_goal_continuity", "goal_completed".
   - Usa "maintain_goal_continuity" solo se il messaggio corrente fa parte dello stesso percorso amministrativo o informativo già avviato.
   - NON usare "maintain_goal_continuity" se il tema cambia in modo netto e non correlato.
   - Fornisci anche goal_continuity_confidence (0.0-1.0).
15. Determina new_information_provided:
   - Lista degli slot informativi che l'utente ha esplicitamente fornito in questo messaggio.
   - Usa SOLO i valori della whitelist: deceased_name, preferred_date, preferred_time, availability_window, phone_number, email_address, confirmation_received, celebration_date, child_name, parent_name, spouse_name, residence_parish, parish_of_baptism, street_name, street_number, birth_place, document_type, certificate_type, sponsor_name, baptism_date.
   - Includi uno slot solo se il dato è presente in modo esplicito nel messaggio corrente e completa un percorso già contestualizzato.
   - Se nessun dato utile è presente, restituisci [].
   - Non inferire. Non dedurre da contesti impliciti.
` : `
11. Non estrarre segnali conversazionali: questo è un primo messaggio senza contesto conversazionale.
   - Nel JSON mantieni i campi conversazionali con default neutri: response_focus_hint=null, response_focus_hint_confidence=0, conversation_shift="none", conversation_shift_confidence=0, goal_continuity="none", goal_continuity_confidence=0, new_information_provided=[].
`;
    const relationalPostureConfidenceThreshold = EmailQuickCheckPolicy.getRelationalPostureConfidenceThreshold().toFixed(2);
    // residual_sensitivity e longitudinal_sensitivity restano fuori dalla quick check:
    // sono segnali storico-relazionali da memoria / PromptContext.
    const prompt = `Analizza questa email.
Rispondi ESCLUSIVAMENTE con un oggetto JSON valido e completo.
NON usare blocchi markdown e NON aggiungere testo extra prima o dopo il JSON.

Email:
Oggetto: ${safeSubject}
Testo: ${safeContent.substring(0, 800)}
${quickIntentGuardrail}
${visitLogisticsGuardrail}
${quickMemoryContext}

COMPITI:
1. Decidi se richiede risposta (reply_needed):
 - TRUE se l'utente pone domande, esprime dubbi o fornisce informazioni nuove/utili (appuntamenti, dati, modifiche).
 - FALSE se è solo un ringraziamento finale (es: \"Grazie mille\", \"Perfetto grazie\", \"Ricevuto\") senza nuove domande o info.
 - FALSE se è newsletter, spam o messaggi di sistema.
 - IMPORTANTE: Se l'utente chiede qualcosa già detto, rispondi TRUE ma con riferimento cordiale alla risposta precedente.

2. Rileva la lingua (language) - codice ISO 639-1 (es: "it", "en", "es", "fr", "de")
3. Classifica la richiesta (category):
   - "TECHNICAL": orari, documenti, info pratiche, iscrizioni
1. Decidi se richiede risposta (reply_needed):
 - TRUE se l'utente pone domande, esprime dubbi o fornisce informazioni nuove/utili (appuntamenti, dati, modifiche).
 - FALSE se è solo un ringraziamento finale (es: \"Grazie mille\", \"Perfetto grazie\", \"Ricevuto\") senza nuove domande o info.
 - FALSE se è newsletter, spam o messaggi di sistema.
 - IMPORTANTE: Se l'utente chiede qualcosa già detto, rispondi TRUE ma con riferimento cordiale alla risposta precedente.

2. Rileva la lingua (language) - codice ISO 639-1 (es: "it", "en", "es", "fr", "de")
3. Classifica la richiesta (category):
   - "TECHNICAL": orari, documenti, info pratiche, iscrizioni
   - "PASTORAL": richieste di aiuto, situazioni personali, lutto
   - "DOCTRINAL": dubbi di fede, domande teologiche
   - "FORMAL": richieste di sbattezzo, cancellazione registri, apostasia
   - "MIXED": mix di tecnica e pastorale
4. Fornisci punteggi continui (0.0-1.0) per ogni dimensione:
   - technical, pastoral, doctrinal, formal
5. Estrai l'argomento principale (topic) in ITALIANO (usando termini coerenti con la richiesta). Il topic descrive il tema trattato, NON lo scopo operativo/comunicativo dell'email.
6. Determina is_territory_request (boolean):
   - TRUE se il mittente chiede se una via, un indirizzo, un civico o una zona rientra nel territorio/nei confini della parrocchia, nella competenza territoriale, nella parrocchia di residenza o nella parrocchia di appartenenza.
   - TRUE anche se usa formulazioni indirette come "fa parte della vostra parrocchia", "confini parrocchiali", "competenza parrocchiale/territoriale", "a quale parrocchia appartengo", "rientro da voi".
   - FALSE per richieste generiche su attività, gruppi, sacramenti, orari o documenti che non chiedono la competenza territoriale di un indirizzo.
7. Estrai territory_address_candidates:
   - Array di massimo 3 stringhe con gli indirizzi/vie/civici da verificare territorialmente.
   - Riporta la via esattamente, includendo il tipo strada se presente o chiaramente inferibile: "via Bartolo Oriani", "Piazza della Marina 24".
   - Non includere frasi generiche, motivazioni o parole successive alla via.
   - Se non c'è alcun indirizzo/via/zona verificabile, restituisci [].
8. Determina attachment_intent:
   - mentions_attachment_or_document: TRUE se il testo menziona allegati, documenti, moduli, schede, certificati, attestati, iscrizioni, file inviati o consegna documentale.
   - expected_attachment_description: breve descrizione in italiano di ciò che l'utente dice di aver allegato o consegnato; stringa vuota se non emerge.
   - requires_attachment_reading: TRUE se per rispondere correttamente bisogna leggere/controllare l'allegato, anche quando il corpo non contiene domande esplicite. TRUE per consegne da confermare, schede/moduli/iscrizioni da ricevere, documenti da verificare o quando la risposta dovrebbe confermare la ricezione di ciò che è allegato.
   - reason: breve motivo osservabile.
   - Se non ci sono allegati/documenti menzionati: tutti i boolean a FALSE e stringhe vuote.
9. Determina document_delivery:
   - expected_document: TRUE se l'utente afferma, annuncia o implica che sta consegnando/inviando una scheda, modulo, documento, certificato, iscrizione o dati documentali compilati.
   - expected_document_description: breve descrizione in italiano del documento atteso o consegnato, es. "scheda di iscrizione al corso prematrimoniale"; stringa vuota se non emerge.
   - delivery_channel: "attachment" se il documento dovrebbe essere in allegato/file; "body" se i dati compilati sono riportati nel testo; "both" se entrambi; "unclear" se il canale non e chiaro.
   - body_contains_filled_document: TRUE solo se nel corpo ci sono dati compilati utilizzabili, non un semplice annuncio. Esempi forti: Nome/Cognome, Telefono, Email, Data di nascita, Luogo di nascita, Indirizzo, Parrocchia, Data matrimonio, Sposo/Sposa/Fidanzato/Fidanzata con valori.
   - requires_file_attachment: TRUE se l'utente dichiara che il documento e allegato/file o il flusso richiede proprio un file.
   - missing_document_if_no_attachment: TRUE solo quando dal testo resulta che il documento dovrebbe esserci come file/allegato e non sono presenti dati compilati nel corpo.
   - reason: breve motivo osservabile.
10. Fornisci un breve ragionamento (reason)
10b. Determina request_purpose, cioe lo SCOPO concreto del messaggio, separandolo esplicitamente dall'argomento/topic e prima di qualsiasi scelta di contenuti da KB:
   - "information_request": chiede come funziona, dove rivolgersi, quali requisiti/documenti servono o quali opzioni esistono.
   - "operational_request": chiede alla parrocchia di eseguire o predisporre un'azione (rilasciare/preparare un documento, iscrivere, prenotare, registrare, confermare) oppure fornisce gia dati e modalita per completarla.
   - "status_update": comunica dati, conferma una scelta, segnala una modifica o fornisce informazioni senza chiedere spiegazioni generali ne una nuova azione.
   - "acknowledgment": contiene soltanto ringraziamento o conferma di ricezione.
   - "mixed": contiene davvero sia una richiesta operativa sia una domanda informativa ancora aperta.
   - Non classificare come informativa una richiesta solo perche il suo argomento e un documento o una procedura; il criterio decisivo e cio che l'utente vuole ottenere adesso.
   - Espressioni come "richiedo", "potete preparare", "verro a ritirare", "ho gia avviato la pratica" o "desidero prenotare", accompagnate dai dati necessari, indicano una richiesta operativa anche se formulate cortesemente.
   - Fornisci anche request_purpose_confidence (0.0-1.0).
11. Determina physical_presence_constraint:
   - Rileva se il mittente manifesta che raggiungere fisicamente la parrocchia/segreteria e' difficile, impossibile o non ragionevole.
   - TRUE se vive/lavora lontano da Roma, e' all'estero, chiede percorsi a distanza, dice che non puo' venire, e' ricoverato/malato/convalescente, anziano con difficolta' di movimento, caregiver con vincoli familiari forti, deve allattare o ha neonati, e' agli arresti domiciliari o ha limitazioni legali.
   - FALSE se il mittente chiede esplicitamente di passare/venire, propone una visita, oppure non fornisce alcun vincolo personale.
   - FALSE per la sola residenza o il solo indirizzo lontano quando il mittente dichiara di trovarsi giÃ  a Roma, di essere in visita/vacanza a Roma o di partecipare localmente all'evento imminente. Un vincolo distinto di salute, mobilitÃ  o accessibilitÃ  resta invece valido.
   - Non considerare vincolo un luogo citato solo come riferimento non personale.
   - type deve essere uno tra: "geographic_distance", "health", "mobility", "caregiving", "legal_restriction", "temporary_unavailability", "remote_request", "other", "none".
   - visit_policy deve essere:
     "conditional_only" quando la presenza fisica puo' essere menzionata solo in modo ipotetico e rispettoso, formulato nella lingua dell'email;
     "avoid_invitation" quando e' meglio non proporre affatto la visita fisica;
     "visit_ok" quando l'invito/presenza in segreteria e' appropriato;
     "unknown" se non e' chiaro.
12. Determina relational_posture basandoti ESCLUSIVAMENTE su marcatori linguistici osservabili, non su stati psicologici:
   - "direct": richiesta neutra, essenziale o operativa, senza marcatori relazionali forti (DEFAULT).
   - "personal": condivisione esplicita di fatti personali delicati, vissuti intimi, richiesta di ascolto o bisogno pastorale.
   - "appreciative": entusiasmo esplicito, ringraziamenti non rituali, apprezzamento per persone/aspetti della parrocchia, oppure condivisione positiva di un legame personale concreto con la parrocchia, il percorso richiesto o la comunità.
     Marcatori forti includono formule come "grazie di cuore", riferimenti positivi a un sacerdote/parrocchia/percorso spirituale, desiderio espresso di svolgere quel percorso presso questa parrocchia per un legame personale concreto, o una narrazione personale positiva direttamente collegata alla richiesta.
     Non classificare come appreciative una semplice richiesta cortese o solo informativa.
   - "hesitant": scuse, minimizzazioni, "forse", "non vorrei disturbare", molte mitigazioni o incertezza formulata.
   - "complaint": insoddisfazione, reclamo, segnalazione di disservizio, frustrazione o tono polemico.
   - "open": tono collaborativo, disponibilita al dialogo, ringraziamento sostanziale con nuova informazione utile.
   - "urgent": solleciti, "urgente", richiesta di risposta rapida, ripetizioni o pressione temporale.
   - Fornisci anche relational_posture_confidence (0.0-1.0).
   - IMPORTANTE: il sistema accetta la postura solo se relational_posture_confidence >= ${relationalPostureConfidenceThreshold}; sotto quella soglia la postura viene ignorata e si usa "direct".
   - Imposta un valore >= ${relationalPostureConfidenceThreshold} quando almeno un marcatore linguistico e esplicito e inequivocabile nel testo. Se i marcatori sono vaghi o assenti, imposta un valore sotto soglia e scegli "direct".
${conversationalTasks}
16. Determina response_strategy:
   - Deve indicare come conviene orientare la risposta corrente.
   - Non descrive la persona.
   - Non è memoria.
   - Non è profilo.
   - Usa solo i valori ammessi.
   - provide_information: quando la risposta deve semplicemente dare informazioni richieste.
   - reduce_user_effort: l'utente sta cercando di completare una procedura con il minor numero possibile di passaggi, spostamenti, telefonate o interazioni aggiuntive. Esempi: chiede se può fare tutto via email, vuole sapere cosa serve prima di venire, chiede se è necessario presentarsi di persona.
   - confirm_receipt: quando la mail serve soprattutto a consegnare documenti/informazioni e va confermata ricezione.
   - guide_next_step: quando conviene indicare chiaramente il prossimo passo operativo.
   - offer_reassurance: quando la mail contiene preoccupazione, delicatezza pastorale o bisogno di essere rassicurati, senza inventare emozioni.
   - clarify_requirements: quando il punto centrale è chiarire requisiti, condizioni, documenti necessari o idoneità.
   - none: quando non emerge una strategia specifica.
   - Fornisci anche response_strategy_confidence (0.0-1.0).
${sponsorGuidanceTask}

⚠️ REGOLA CRITICA "SBATTEZZO":
Se l'utente esprime la volontà di non essere più cristiano, essere cancellato dai registri o "sbattezzarsi":
- Include formulazioni indirette come "uscire dalla Chiesa", "non voglio più essere cattolico", "cancellarmi dalla Chiesa", "rinunciare al battesimo", "togliermi dai registri".
- Classifica SEMPRE come "FORMAL"
- Topic: "sbattezzo"
- NON classificarlo come "PASTORAL" anche se c'è un tono emotivo.

Output JSON:
{
  "reply_needed": boolean,
  "language": "string (codice ISO 639-1)",
  "category": "TECHNICAL" | "PASTORAL" | "DOCTRINAL" | "FORMAL" | "MIXED",
  "dimensions": {
    "technical": number (0.0-1.0),
    "pastoral": number (0.0-1.0),
    "doctrinal": number (0.0-1.0),
    "formal": number (0.0-1.0)
  },
  "topic": "string",
  "request_purpose": "information_request" | "operational_request" | "status_update" | "acknowledgment" | "mixed",
  "request_purpose_confidence": number (0.0-1.0),
  "is_territory_request": boolean,
  "territory_address_candidates": ["string"],
  "confidence": number (0.0-1.0),
  "reason": "string",
  "attachment_intent": {
    "mentions_attachment_or_document": boolean,
    "expected_attachment_description": "string",
    "requires_attachment_reading": boolean,
    "reason": "string"
  },
  "document_delivery": {
    "expected_document": boolean,
    "expected_document_description": "string",
    "delivery_channel": "attachment" | "body" | "both" | "unclear",
    "body_contains_filled_document": boolean,
    "requires_file_attachment": boolean,
    "missing_document_if_no_attachment": boolean,
    "reason": "string"
  },
  "relational_posture": "urgent" | "hesitant" | "complaint" | "personal" | "open" | "appreciative" | "direct",
  "relational_posture_confidence": number (0.0-1.0),
  "response_focus_hint": "avoid_repeating_known_requirements" | "answer_only_residual_question" | "provide_next_operational_step" | "acknowledge_document_without_reopening_procedure" | null,
  "response_focus_hint_confidence": number (0.0-1.0),
  "conversation_shift": "none" | "new_question" | "topic_change" | "new_information" | "closure",
  "conversation_shift_confidence": number (0.0-1.0),
  "response_strategy": "provide_information" | "reduce_user_effort" | "confirm_receipt" | "guide_next_step" | "offer_reassurance" | "clarify_requirements" | "none",
  "response_strategy_confidence": number (0.0-1.0),
  "goal_continuity": "none" | "maintain_goal_continuity" | "goal_completed",
  "goal_continuity_confidence": number (0.0-1.0),
  "new_information_provided": ["string"],
  "physical_presence_constraint": {
    "has_constraint": boolean,
    "type": "geographic_distance" | "health" | "mobility" | "caregiving" | "legal_restriction" | "temporary_unavailability" | "remote_request" | "other" | "none",
    "confidence": number (0.0-1.0),
    "evidence": "short quote or paraphrase",
    "reason": "string",
    "visit_policy": "avoid_invitation" | "conditional_only" | "visit_ok" | "unknown"
  }${sponsorGuidanceJsonField}
}`;

    return {
      prompt: prompt,
      safeSubject: safeSubject,
      safeContent: safeContent,
      hasSubmissionContext: hasSubmissionContext,
      hasOfficeVisitLogistics: hasOfficeVisitLogistics,
      shouldClassifySponsorGuidance: shouldClassifySponsorGuidance,
      hasConversationContext: hasConversationContext
    };
  }

  static defaultResult(detection) {
    const safeDetection = detection || {};
    return {
      shouldRespond: false,
      language: safeDetection.lang,
      reason: 'quick_check_failed',
      classification: {
        category: 'TECHNICAL',
        topic: 'unknown',
        confidence: 0.0,
        is_territory_request: false,
        isTerritoryRequest: false,
        territory_address_candidates: []
      },
      is_territory_request: false,
      territory_address_candidates: [],
      physical_presence_constraint: {
        has_constraint: false,
        type: 'none',
        confidence: 0,
        evidence: '',
        reason: '',
        visit_policy: 'unknown',
        source: 'quick_check'
      },
      relational_posture: 'direct',
      relational_posture_confidence: 0,
      request_purpose: 'unknown',
      request_purpose_confidence: 0,
      request_purpose_source: 'default',
      response_focus_hint: null,
      response_focus_hint_confidence: 0,
      conversation_shift: 'none',
      conversation_shift_confidence: 0,
      response_strategy: 'none',
      response_strategy_confidence: 0,
      goal_continuity: 'none',
      goal_continuity_confidence: 0,
      new_information_provided: [],
      attachment_intent: {
        mentions_attachment_or_document: false,
        expected_attachment_description: '',
        requires_attachment_reading: false,
        reason: ''
      },
      document_delivery: {
        expected_document: false,
        expected_document_description: '',
        delivery_channel: 'unclear',
        body_contains_filled_document: false,
        requires_file_attachment: false,
        missing_document_if_no_attachment: false,
        reason: ''
      }
    };
  }

  static normalizeApiResponse(responseBody, detection, intentContext = null, options = {}) {
    const defaultResult = EmailQuickCheckPolicy.defaultResult(detection);
    const resolveLanguage = typeof options.resolveLanguage === 'function'
      ? options.resolveLanguage
      : ((candidate, fallback) => candidate || fallback || 'it');

    let result;
    try {
      result = JSON.parse(responseBody);
    } catch (parseError) {
      console.warn(`⚠️ JSON non valido nel controllo rapido Gemini: ${parseError.message}`);
      return defaultResult;
    }

    if (!result || typeof result !== 'object' || !result.candidates || !result.candidates[0]) {
      console.error('❌ Nessun candidato nella risposta Controllo Rapido Gemini');
      return defaultResult;
    }

    const candidate = result.candidates[0];

    if (candidate.finishReason && ['SAFETY', 'RECITATION', 'OTHER', 'BLOCKLIST'].includes(candidate.finishReason)) {
      console.warn(`⚠️ Controllo rapido bloccato: ${candidate.finishReason}`);
      return defaultResult;
    }

    const parts = candidate.content?.parts || [];
    const textResponse = parts.map(p => p.text || '').join('').trim();

    console.log('=========================================');
    console.log('🤖 RAW GEMINI CLASSIFIER JSON:');
    console.log(textResponse);
    console.log('=========================================');

    if (!textResponse) {
      console.error('❌ Risposta non valida: testo vuoto');
      return defaultResult;
    }

    let data;
    try {
      data = parseGeminiJsonLenient(textResponse);
    } catch (parseError) {
      console.warn(`⚠️ parseGeminiJsonLenient fallito: ${parseError.message}`);
      return defaultResult;
    }

    const normalized = EmailQuickCheckPolicy.normalizeDecisionData(data, detection, intentContext, {
      resolveLanguage: resolveLanguage,
      defaultResult: defaultResult,
      emailSubject: options.emailSubject,
      emailContent: options.emailContent
    });
    return EmailQuickCheckPolicy.applyOfficeVisitLogisticsOverride(
      normalized,
      options.emailSubject,
      options.emailContent
    );
  }

  static normalizeDecisionData(data, detection, intentContext = null, options = {}) {
    const defaultResult = options.defaultResult || EmailQuickCheckPolicy.defaultResult(detection);
    const safeDetection = detection || {};
    const resolveLanguage = typeof options.resolveLanguage === 'function'
      ? options.resolveLanguage
      : ((candidate, fallback) => candidate || fallback || 'it');

    if (!data || typeof data !== 'object') {
      console.warn('⚠️ Decisione quick check non è un oggetto JSON valido');
      return defaultResult;
    }

    EmailQuickCheckPolicy.stripForbiddenQuickCheckFields(data);

    const replyNeeded = data.reply_needed;
    const normalizedReplyNeeded = (typeof replyNeeded === 'string')
      ? replyNeeded.toLowerCase()
      : replyNeeded;
    // Fail-closed: il campo e obbligatorio. Un JSON sintatticamente valido ma
    // incompleto non deve trasformarsi in un'autorizzazione implicita a rispondere.
    const shouldRespond = (normalizedReplyNeeded === true || normalizedReplyNeeded === 'true');
    const finalShouldRespond = EmailQuickCheckPolicy.isDocumentSubmissionIntent(intentContext)
      ? true
      : shouldRespond;
    const safeDimensions = (data.dimensions && typeof data.dimensions === 'object')
      ? data.dimensions
      : null;
    const safeConfidence = Number.isFinite(data.confidence) ? data.confidence : 0.8;
    const rawSponsorGuidance = data.needs_sponsor_guidance;
    const normalizedSponsorGuidance = (typeof rawSponsorGuidance === 'string')
      ? rawSponsorGuidance.trim().toLowerCase()
      : rawSponsorGuidance;
    const needsSponsorGuidance = (normalizedSponsorGuidance === true || normalizedSponsorGuidance === 'true')
      ? true
      : ((normalizedSponsorGuidance === false || normalizedSponsorGuidance === 'false') ? false : undefined);
    const physicalPresenceConstraint = EmailQuickCheckPolicy.normalizePhysicalPresenceConstraint(data);
    const relationalPostureConfidence = EmailQuickCheckPolicy.normalizeRelationalPostureConfidence(data.relational_posture_confidence);
    const relationalPosture = EmailQuickCheckPolicy.normalizeRelationalPosture(
      data.relational_posture,
      relationalPostureConfidence
    );
    const hasConversationContext = EmailQuickCheckPolicy.hasConversationContext(intentContext);
    const responseFocusHintConfidence = hasConversationContext
      ? EmailQuickCheckPolicy.normalizeResponseFocusHintConfidence(data.response_focus_hint_confidence)
      : 0;
    const responseFocusHint = hasConversationContext
      ? EmailQuickCheckPolicy.normalizeResponseFocusHint(
        data.response_focus_hint,
        responseFocusHintConfidence
      )
      : null;
    const conversationShiftConfidence = hasConversationContext
      ? EmailQuickCheckPolicy.normalizeConversationShiftConfidence(data.conversation_shift_confidence)
      : 0;
    const conversationShift = hasConversationContext
      ? EmailQuickCheckPolicy.normalizeConversationShift(
        data.conversation_shift,
        conversationShiftConfidence
      )
      : 'none';
    const responseStrategyConfidence = EmailQuickCheckPolicy.normalizeResponseStrategyConfidence(data.response_strategy_confidence);
    const responseStrategy = EmailQuickCheckPolicy.normalizeResponseStrategy(
      data.response_strategy,
      responseStrategyConfidence
    );
    const requestPurposeResolution = EmailQuickCheckPolicy.resolveRequestPurpose(
      data.request_purpose,
      data.request_purpose_confidence,
      options.emailSubject,
      options.emailContent
    );
    const goalContinuityConfidence = hasConversationContext
      ? EmailQuickCheckPolicy.normalizeGoalContinuityConfidence(data.goal_continuity_confidence)
      : 0;
    const goalContinuity = hasConversationContext
      ? EmailQuickCheckPolicy.normalizeGoalContinuity(
        data.goal_continuity,
        goalContinuityConfidence
      )
      : 'none';
    const rawTerritoryRequest = Object.prototype.hasOwnProperty.call(data, 'is_territory_request')
      ? data.is_territory_request
      : data.territory_request;
    const isTerritoryRequest = EmailQuickCheckPolicy.normalizeBoolean(rawTerritoryRequest) === true;
    const territoryAddressCandidates = EmailQuickCheckPolicy.normalizeTerritoryAddressCandidates(data.territory_address_candidates);
    const attachmentIntent = EmailQuickCheckPolicy.normalizeAttachmentIntent(data.attachment_intent);
    const documentDelivery = EmailQuickCheckPolicy.normalizeDocumentDelivery(data.document_delivery);

    return {
      shouldRespond: finalShouldRespond,
      language: resolveLanguage(data.language, safeDetection.lang, safeDetection.safetyGrade),
      reason: data.reason || 'quick_check',
      classification: {
        category: data.category || 'TECHNICAL',
        topic: data.topic || '',
        confidence: safeConfidence,
        dimensions: safeDimensions,
        is_territory_request: isTerritoryRequest,
        isTerritoryRequest: isTerritoryRequest,
        territory_address_candidates: territoryAddressCandidates
      },
      is_territory_request: isTerritoryRequest,
      territory_address_candidates: territoryAddressCandidates,
      physical_presence_constraint: physicalPresenceConstraint,
      relational_posture: relationalPosture,
      relational_posture_confidence: relationalPostureConfidence,
      request_purpose: requestPurposeResolution.type,
      request_purpose_confidence: requestPurposeResolution.confidence,
      request_purpose_source: requestPurposeResolution.source,
      response_focus_hint: responseFocusHint,
      response_focus_hint_confidence: responseFocusHintConfidence,
      conversation_shift: conversationShift,
      conversation_shift_confidence: conversationShiftConfidence,
      response_strategy: responseStrategy,
      response_strategy_confidence: responseStrategyConfidence,
      attachment_intent: attachmentIntent,
      document_delivery: documentDelivery,
      goal_continuity: goalContinuity,
      goal_continuity_confidence: goalContinuityConfidence,
      new_information_provided: hasConversationContext
        ? EmailQuickCheckPolicy.normalizeNewInformationProvided(data.new_information_provided)
        : [],
      needs_sponsor_guidance: needsSponsorGuidance
    };
  }

  static normalizeRelationalPosture(value, confidence = 0) {
    const normalized = String(value || '').trim().toLowerCase();
    const aliases = {
      informational: 'direct',
      relational: 'personal',
      procedural: 'direct',
      open: 'appreciative',
      appreciative: 'appreciative',
      grateful: 'appreciative',
      gratitude: 'appreciative',
      enthusiastic: 'appreciative',
      complaint: 'complaint',
      frustrated: 'complaint',
      frustration: 'complaint',
      angry: 'complaint',
      upset: 'complaint',
      hesitant: 'uncertain'
    };
    const canonical = aliases[normalized] || normalized;
    const allowed = {
      direct: true,
      personal: true,
      appreciative: true,
      complaint: true,
      urgent: true,
      uncertain: true
    };
    if (!allowed[canonical] || canonical === 'direct') return 'direct';
    return EmailQuickCheckPolicy.isRelationalPostureConfidenceSufficient(confidence)
      ? canonical
      : 'direct';
  }

  static normalizeRelationalPostureConfidence(value) {
    const confidence = Number(value);
    return Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0;
  }

  static getRelationalPostureConfidenceThreshold() {
    const configured = (typeof CONFIG !== 'undefined' && CONFIG)
      ? Number(CONFIG.RELATIONAL_POSTURE_CONFIDENCE_THRESHOLD)
      : NaN;
    if (Number.isFinite(configured)) {
      return Math.max(0, Math.min(1, configured));
    }
    return 0.70;
  }

  static isRelationalPostureConfidenceSufficient(confidence) {
    return EmailQuickCheckPolicy.normalizeRelationalPostureConfidence(confidence) >=
      EmailQuickCheckPolicy.getRelationalPostureConfidenceThreshold();
  }

  static normalizeResponseFocusHintConfidence(value) {
    const confidence = Number(value);
    return Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0;
  }

  static normalizeResponseFocusHint(value, confidence = 0) {
    const normalized = String(value || '').trim().toLowerCase();
    const allowed = {
      avoid_repeating_known_requirements: true,
      answer_only_residual_question: true,
      provide_next_operational_step: true,
      acknowledge_document_without_reopening_procedure: true
    };
    if (!allowed[normalized]) return null;
    return EmailQuickCheckPolicy.normalizeResponseFocusHintConfidence(confidence) >= 0.65
      ? normalized
      : null;
  }

  static normalizeConversationShiftConfidence(value) {
    const confidence = Number(value);
    return Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0;
  }

  static normalizeConversationShift(value, confidence = 0) {
    const normalized = String(value || '').trim().toLowerCase();
    const allowed = {
      none: true,
      new_question: true,
      topic_change: true,
      new_information: true,
      closure: true
    };
    if (!allowed[normalized]) return 'none';
    return EmailQuickCheckPolicy.normalizeConversationShiftConfidence(confidence) >= 0.65
      ? normalized
      : 'none';
  }

  static getResponseStrategyConfidenceThreshold() {
    const configured = (typeof CONFIG !== 'undefined' && CONFIG)
      ? Number(CONFIG.RESPONSE_STRATEGY_CONFIDENCE_THRESHOLD)
      : NaN;
    if (Number.isFinite(configured)) {
      return Math.max(0, Math.min(1, configured));
    }
    return 0.65;
  }

  static normalizeResponseStrategyConfidence(value) {
    const confidence = Number(value);
    return Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0;
  }

  static normalizeResponseStrategy(value, confidence = 0) {
    const normalized = String(value || '').trim().toLowerCase();
    const allowed = {
      provide_information: true,
      reduce_user_effort: true,
      confirm_receipt: true,
      guide_next_step: true,
      offer_reassurance: true,
      clarify_requirements: true,
      none: true
    };
    if (!allowed[normalized]) return 'none';
    return EmailQuickCheckPolicy.normalizeResponseStrategyConfidence(confidence) >=
      EmailQuickCheckPolicy.getResponseStrategyConfidenceThreshold()
      ? normalized
      : 'none';
  }

  static normalizeGoalContinuityConfidence(value) {
    const confidence = Number(value);
    return Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0;
  }

  static normalizeGoalContinuity(value, confidence = 0) {
    const normalized = String(value || '').trim().toLowerCase().replace(/-/g, '_');
    const allowed = {
      none: true,
      maintain_goal_continuity: true,
      goal_completed: true
    };
    if (!allowed[normalized] || normalized === 'none') return 'none';
    return EmailQuickCheckPolicy.normalizeGoalContinuityConfidence(confidence) >= 0.65
      ? normalized
      : 'none';
  }

  static normalizeNewInformationProvided(value) {
    if (!Array.isArray(value)) return [];
    const aliases = {
      date: 'preferred_date',
      requested_date: 'preferred_date',
      appointment_date: 'preferred_date',
      time: 'preferred_time',
      requested_time: 'preferred_time',
      appointment_time: 'preferred_time',
      availability: 'availability_window',
      available_time: 'availability_window',
      phone: 'phone_number',
      telephone: 'phone_number',
      mobile: 'phone_number',
      email: 'email_address',
      child: 'child_name',
      child_full_name: 'child_name',
      son_name: 'child_name',
      daughter_name: 'child_name',
      parent: 'parent_name',
      mother_name: 'parent_name',
      father_name: 'parent_name',
      spouse: 'spouse_name',
      bride_name: 'spouse_name',
      groom_name: 'spouse_name',
      baptism_parish: 'parish_of_baptism',
      birth_parish: 'parish_of_baptism',
      place_of_birth: 'birth_place',
      document: 'document_type',
      document_name: 'document_type',
      certificate: 'certificate_type',
      requested_certificate: 'certificate_type',
      godparent_name: 'sponsor_name',
      godfather_name: 'sponsor_name',
      godmother_name: 'sponsor_name'
    };
    const allowed = new Set([
      'deceased_name',
      'preferred_date',
      'preferred_time',
      'availability_window',
      'phone_number',
      'email_address',
      'confirmation_received',
      'celebration_date',
      'child_name',
      'parent_name',
      'spouse_name',
      'residence_parish',
      'parish_of_baptism',
      'street_name',
      'street_number',
      'birth_place',
      'document_type',
      'certificate_type',
      'sponsor_name',
      'baptism_date'
    ]);
    return [...new Set(
      value
        .map(s => String(s || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, ''))
        .map(s => aliases[s] || s)
        .filter(s => allowed.has(s))
    )].slice(0, 8);
  }

  static normalizeRequestPurposeConfidence(value) {
    const confidence = Number(value);
    return Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0;
  }

  static normalizeRequestPurpose(value, confidence = 0) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const aliases = {
      informational: 'information_request',
      informational_request: 'information_request',
      information: 'information_request',
      operational: 'operational_request',
      action_request: 'operational_request',
      update: 'status_update',
      communication: 'status_update',
      confirmation: 'acknowledgment',
      acknowledgement: 'acknowledgment'
    };
    const canonical = aliases[normalized] || normalized;
    const allowed = new Set([
      'information_request',
      'operational_request',
      'status_update',
      'acknowledgment',
      'mixed'
    ]);
    if (!allowed.has(canonical)) return 'unknown';
    return EmailQuickCheckPolicy.normalizeRequestPurposeConfidence(confidence) >= 0.65
      ? canonical
      : 'unknown';
  }

  static inferRequestPurpose(emailSubject, emailContent) {
    const rawText = `${emailSubject || ''} ${emailContent || ''}`.replace(/\s+/g, ' ').trim();
    if (!rawText) return { type: 'unknown', confidence: 0, source: 'local_no_signal' };

    const text = rawText
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const actionPatterns = [
      /\b(?:richiedo|richiediamo|richiedono|si\s+richiede|chiedo)\b[\s\S]{0,80}\b(?:certificat\w*|rilasc\w*|copi\w*|document\w*|iscrizion\w*|prenotazion\w*)\b/,
      /\b(?:mi\s+serve|ci\s+serve|avrei\s+bisogno\s+di|abbiamo\s+bisogno\s+di)\b[\s\S]{0,80}\b(?:certificat\w*|document\w*|attestat\w*|iscrizion\w*)\b/,
      /\b(?:ho|abbiamo)\s+gia\s+(?:avviato|iniziato|presentato|compilato|consegnato|inviato)\b[\s\S]{0,100}\b(?:pratica|richiesta|modulo|domanda|document\w*|certificat\w*)\b/,
      /\b(?:vorrei|desidero|intendo)\s+(?:richiedere|ottenere|prenotare|iscrivermi|ritirare)\b/,
      /\b(?:potete|potreste|puo|puoi)\s+(?:preparare|stampare|rilasciare|prenotare|iscrivere|registrare|confermare)\b/,
      /\b(?:verro|passero|ritirero|vengo|passo)\b[\s\S]{0,60}\b(?:ritir\w*|segreteria|parrocchia|persona)\b/,
      /\b(?:je\s+demande|je\s+souhaite\s+demander|pourriez-vous\s+(?:preparer|delivrer|inscrire|reserver))\b/,
      /\b(?:i\s+(?:request|would\s+like\s+to\s+(?:request|book|register))|could\s+you\s+(?:prepare|issue|book|register))\b/,
      /\b(?:quisiera\s+(?:solicitar|reservar|inscribirme)|podrian\s+(?:preparar|expedir|reservar|inscribir))\b/,
      /\b(?:ich\s+mochte\s+(?:beantragen|buchen|mich\s+anmelden)|konnten\s+sie\s+(?:vorbereiten|ausstellen|buchen))\b/
    ];
    const informationPatterns = [
      /\b(?:come\s+(?:si\s+fa|funziona|posso)|quali\s+(?:dati|documenti|requisiti|passi)|cosa\s+(?:serve|occorre)|dove\s+(?:devo|posso)|a\s+chi\s+(?:devo|posso)|vorrei\s+(?:avere|ricevere)?\s*informazioni|chiedo\s+informazioni)\b/,
      /\b(?:how\s+(?:do|can)|what\s+(?:documents|requirements)|where\s+(?:do|can)|i\s+would\s+like\s+information)\b/,
      /\b(?:comment\s+(?:faire|puis-je)|quels?\s+(?:documents|conditions)|ou\s+(?:dois-je|puis-je)|je\s+voudrais\s+des\s+renseignements)\b/,
      /\b(?:como\s+(?:puedo|se\s+hace)|que\s+(?:documentos|requisitos)|donde\s+(?:debo|puedo)|quisiera\s+informacion)\b/,
      /\b(?:wie\s+(?:kann|funktioniert)|welche\s+(?:unterlagen|voraussetzungen)|wo\s+(?:muss|kann)|ich\s+mochte\s+informationen)\b/
    ];
    const updatePatterns = [
      /\b(?:vi\s+informo|vi\s+comunico|confermo\s+che|aggiorn\w*|invio|allego|trasmetto)\b/,
      /\b(?:i\s+am\s+writing\s+to\s+inform|i\s+confirm\s+that|attached\s+is|i\s+am\s+sending)\b/,
      /\b(?:je\s+vous\s+informe|je\s+confirme|je\s+vous\s+envoie|ci-joint)\b/
    ];
    const acknowledgmentPattern = /^(?:(?:buongiorno|buonasera|salve|bonjour|hello|hola)[,!. ]*)?(?:grazie|grazie\s+mille|perfetto,?\s+grazie|merci|thank\s+you|thanks|gracias|danke)[!. ]*$/i;

    const hasAction = actionPatterns.some(pattern => pattern.test(text));
    const hasInformationQuestion = informationPatterns.some(pattern => pattern.test(text));
    if (hasAction && hasInformationQuestion) {
      return { type: 'mixed', confidence: 0.93, source: 'local_explicit_mixed' };
    }
    if (hasAction) {
      return { type: 'operational_request', confidence: 0.96, source: 'local_explicit_action' };
    }
    if (hasInformationQuestion) {
      return { type: 'information_request', confidence: 0.92, source: 'local_explicit_question' };
    }
    if (updatePatterns.some(pattern => pattern.test(text)) && !/[?]/.test(text)) {
      return { type: 'status_update', confidence: 0.88, source: 'local_explicit_update' };
    }
    if (acknowledgmentPattern.test(text)) {
      return { type: 'acknowledgment', confidence: 0.9, source: 'local_acknowledgment' };
    }
    return { type: 'unknown', confidence: 0, source: 'local_no_signal' };
  }

  static resolveRequestPurpose(value, confidence = 0, emailSubject = '', emailContent = '') {
    const modelConfidence = EmailQuickCheckPolicy.normalizeRequestPurposeConfidence(confidence);
    const modelType = EmailQuickCheckPolicy.normalizeRequestPurpose(value, modelConfidence);
    const local = EmailQuickCheckPolicy.inferRequestPurpose(emailSubject, emailContent);

    // Le richieste d'azione esplicite sono osservabili nel testo e prevalgono su
    // un'eventuale etichetta informativa prodotta in base al solo argomento.
    if (
      local.confidence >= 0.9 &&
      (local.type === 'operational_request' || local.type === 'mixed')
    ) {
      return local;
    }
    if (modelType !== 'unknown') {
      return { type: modelType, confidence: modelConfidence, source: 'quick_check_model' };
    }
    return local;
  }
};

var GeminiService = class GeminiService {
  constructor(options = {}) {
    const sharedConfig = (typeof CONFIG !== 'undefined') ? CONFIG : {};
    this.config = Object.assign({}, sharedConfig, options.config || {});

    // Logger strutturato (DI opzionale)
    this.logger = options.logger || createLogger('GeminiService');
    this.logger.info('Inizializzazione GeminiService');

    // Dipendenze esterne iniettabili (testabilità)
    this.fetchFn = options.fetchFn || ((url, requestOptions) => UrlFetchApp.fetch(url, requestOptions));
    this.props = options.props || PropertiesService.getScriptProperties();

    // ====================================================================
    // CONFIGURAZIONE CHIAVI API (Gestione Ridondanza)
    // ====================================================================

    // Chiave Primaria
    // Priorità: 1. override DI 2. Script Properties 3. CONFIG
    const propKey = this.props.getProperty('GEMINI_API_KEY');
    this.primaryKey = options.primaryKey || ((propKey && propKey.length > 20) ? propKey : this.config.GEMINI_API_KEY);

    // Chiave di Riserva (opzionale)
    const propBackupKey = this.props.getProperty('GEMINI_API_KEY_BACKUP');
    this.backupKey = options.backupKey || ((propBackupKey && propBackupKey.length > 20) ? propBackupKey : null);
    this._cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
      ? CacheService.getScriptCache()
      : null;
    this._primaryExhaustedCacheKey = 'gemini_primary_exhausted';
    this.isPrimaryExhausted = this._cache ? (this._cache.get(this._primaryExhaustedCacheKey) === 'true') : false;

    // Alias accessibile per i moduli che usano la proprietà apiKey
    this.apiKey = this.primaryKey;

    this.modelName = this.config.MODEL_NAME || 'gemini-3.7-flash';

    if (!this.primaryKey || this.primaryKey.length < 20 || /YOUR_[A-Z0-9_]+_HERE/.test(this.primaryKey)) {
      throw new Error('GEMINI_API_KEY non configurata correttamente (usa Script Properties, non placeholder)');
    }

    if (this.backupKey) {
      this.logger.info('Chiave di Riserva configurata');
    }

    // Nuovo tentativo di configurazione
    const backoffConfig = this.config.GEMINI_BACKOFF || {};
    this.maxRetries = Number(backoffConfig.maxRetries) > 0 ? Number(backoffConfig.maxRetries) : 2;
    this.retryDelay = Number(backoffConfig.retryDelayMs) > 0 ? Number(backoffConfig.retryDelayMs) : 4000;
    this.backoffFactor = Number(backoffConfig.factor) > 1 ? Number(backoffConfig.factor) : 2.5;
    this.maxBackoffMs = Number(backoffConfig.maxBackoffMs) > 0 ? Number(backoffConfig.maxBackoffMs) : 120000;
    this.retryJitterMs = Number(backoffConfig.jitterMs) >= 0 ? Number(backoffConfig.jitterMs) : 750;

    // Rate Limiter (abilitato da CONFIG.USE_RATE_LIMITER)
    this.useRateLimiter = this.config.USE_RATE_LIMITER === true;
    if (this.useRateLimiter) {
      try {
        if (options.rateLimiter) {
          this.rateLimiter = options.rateLimiter;
          this.logger.info('Rate Limiter iniettato via DI');
        } else if (typeof GeminiRateLimiter !== 'undefined') {
          this.rateLimiter = new GeminiRateLimiter();
          this.logger.info('Rate Limiter abilitato');
        } else {
          throw new Error('Classe GeminiRateLimiter non trovata nel bundle di script.');
        }
      } catch (e) {
        this.logger.warn('Rate Limiter non disponibile, procedo con chiamate dirette', { errore: e.message });
        this.useRateLimiter = false;
      }
    } else {
      this.logger.debug('Rate Limiter disabilitato via config');
    }

    this.logger.info('GeminiService inizializzato', { modello: this.modelName });
  }

  _markPrimaryExhausted_(reason = '', responseCode = null) {
    this.isPrimaryExhausted = true;
    if (this._cache) {
      try {
        // 429 puo essere un semplice RPM/TPM transitorio: effettuiamo un probe
        // della primaria dopo pochi minuti. Errori auth/config restano lunghi.
        const ttlSeconds = Number(responseCode) === 429 ? 300 : 21599;
        this._cache.put(this._primaryExhaustedCacheKey, 'true', ttlSeconds);
      } catch (cacheErr) {
        const detail = reason ? ` (${reason})` : '';
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn(`Impossibile salvare stato quota primary in cache${detail}: ${cacheErr.message}`);
        }
      }
    }
  }

  _isPrimaryKeyFallbackHttpError_(responseCode, responseBody = '') {
    if ([401, 403, 429].includes(responseCode)) return true;
    if (responseCode !== 400) return false;

    const bodyLower = String(responseBody || '').toLowerCase();
    return bodyLower.includes('api_key_invalid') ||
      bodyLower.includes('api key not valid') ||
      bodyLower.includes('invalid api key') ||
      bodyLower.includes('billing') ||
      bodyLower.includes('permission') ||
      bodyLower.includes('disabled') ||
      bodyLower.includes('not enabled');
  }

  getModelNameForTask(taskType, fallbackName = null) {
    const strategy = this.config && this.config.MODEL_STRATEGY
      ? this.config.MODEL_STRATEGY
      : {};
    const models = this.config && this.config.GEMINI_MODELS
      ? this.config.GEMINI_MODELS
      : {};
    const candidates = Array.isArray(strategy[taskType]) && strategy[taskType].length > 0
      ? strategy[taskType]
      : (Array.isArray(strategy.fallback) ? strategy.fallback : []);

    for (let i = 0; i < candidates.length; i++) {
      const modelKey = candidates[i];
      if (models[modelKey] && models[modelKey].name) {
        return models[modelKey].name;
      }
    }

    return fallbackName || this.modelName || 'gemini-3.7-flash';
  }

  _getDefaultGenerationModelNames_() {
    return {
      'flash-3.7': 'gemini-3.7-flash',
      'flash-3.7-backup': 'gemini-3.7-flash',
      'flash-3.6': 'gemini-3.6-flash',
      'flash-3.6-backup': 'gemini-3.6-flash',
      'flash-lite': 'gemini-3.5-flash-lite',
      'flash-lite-backup': 'gemini-3.5-flash-lite',
      'flash-3': 'gemini-3-flash-preview',
      'flash-3-backup': 'gemini-3-flash-preview'
    };
  }

  buildGenerationStrategies(options = {}) {
    const strategy = this.config && this.config.MODEL_STRATEGY
      ? this.config.MODEL_STRATEGY
      : {};
    const models = this.config && this.config.GEMINI_MODELS
      ? this.config.GEMINI_MODELS
      : {};
    const defaultGenerationStrategy = ['flash-3.7', 'flash-3.7-backup', 'flash-lite', 'flash-lite-backup'];
    const defaultGenerationModelNames = this._getDefaultGenerationModelNames_();
    const configuredGenerationStrategy = Array.isArray(strategy.generation) && strategy.generation.length > 0
      ? strategy.generation
      : defaultGenerationStrategy;
    const warn = typeof options.warn === 'function'
      ? options.warn
      : (message) => console.warn(message);
    const skipExhaustedPrimary = options.skipExhaustedPrimary !== false;
    const fallbackModelName = configuredGenerationStrategy
      .map(modelKey => (models[modelKey] && models[modelKey].name) || defaultGenerationModelNames[modelKey])
      .find(Boolean) || 'gemini-3.7-flash';

    const attemptStrategy = configuredGenerationStrategy
      .map((modelKey, index) => {
        const modelDef = models[modelKey];
        const modelName = (modelDef && modelDef.name) || defaultGenerationModelNames[modelKey];
        if (!modelName) {
          warn(`⚠️ Strategia generazione ignora modello non configurato: ${modelKey}`);
          return null;
        }

        const usesBackupKey = /backup/i.test(modelKey);
        if (skipExhaustedPrimary && !usesBackupKey && this.isPrimaryExhausted) {
          return null;
        }

        const apiKey = usesBackupKey ? this.backupKey : this.primaryKey;
        if (!apiKey) return null;

        return {
          name: `Generation-${index + 1}-${modelKey}${usesBackupKey ? '-BackupKey' : '-PrimaryKey'}`,
          key: apiKey,
          model: modelName,
          usesBackupKey: usesBackupKey,
          skipRateLimit: usesBackupKey
        };
      })
      .filter(Boolean);

    return {
      attemptStrategy: attemptStrategy,
      strategies: attemptStrategy,
      fallbackModelName: fallbackModelName,
      configuredGenerationStrategy: configuredGenerationStrategy.slice()
    };
  }

  _normalizePromptPayload_(promptData) {
    return GeminiContentClient.normalizePromptPayload(promptData);
  }

  _estimateTokens(text, attachments = []) {
    const promptPayload = this._normalizePromptPayload_(text);
    return typeof estimateTokenCount === 'function'
      ? estimateTokenCount(promptPayload.combinedText, attachments)
      : Math.ceil((promptPayload.combinedText || '').length / 3.2);
  }

  _createGeminiContentClient_() {
    return new GeminiContentClient({
      config: this.config || {},
      fetchFn: this.fetchFn,
      primaryKey: this.primaryKey,
      backupKey: this.backupKey,
      buildGenerateUrl: (modelName) => this._buildGenerateUrl(modelName),
      markPrimaryExhausted: (reason, responseCode) => this._markPrimaryExhausted_(reason, responseCode),
      isPrimaryKeyFallbackHttpError: (responseCode, responseBody) =>
        this._isPrimaryKeyFallbackHttpError_(responseCode, responseBody),
      normalizePromptPayload: (promptData) => this._normalizePromptPayload_(promptData)
    });
  }

  _buildGeminiGenerationConfig_(taskType, modelName, overrides = {}) {
    return this._createGeminiContentClient_().buildGenerationConfig(taskType, modelName, overrides);
  }

  _getGeminiSafetySettings_() {
    return this._createGeminiContentClient_().getSafetySettings();
  }

  _generateWithModelResult_(prompt, modelName, apiKeyOverride = null, attachments = []) {
    const client = this._createGeminiContentClient_();
    const promptPayload = this._normalizePromptPayload_(prompt);
    const userPromptText = promptPayload.userPrompt;
    const systemInstructionText = promptPayload.systemInstruction;

    console.log(`🤖 Chiamata ${modelName} (prompt utente: ${userPromptText.length} car., system: ${systemInstructionText.length} car.)...`);

    const generated = client.generateText({
      taskType: 'generation',
      prompt: prompt,
      promptPayload: promptPayload,
      modelName: modelName,
      apiKey: apiKeyOverride || this.primaryKey,
      attachments: attachments,
      primaryFallbackSignalReason: 'generateResponse'
    });
    const generatedText = generated.text;

    console.log(`✓ Generati ${generatedText.length} caratteri (da ${generated.partsCount} parti)`);
    return generated;
  }

  /**
   * Genera risposta con modello specifico
   * @param {string|Object} prompt - Prompt completo oppure {systemInstruction, prompt}
   * @param {string} modelName - Nome modello API (es. 'gemini-3.7-flash')
   * @param {string} apiKeyOverride - Chiave API opzionale (per strategia multi-key)
   * @param {Array<Blob>} attachments - Array di Blob (immagini/PDF) da inviare
   * @returns {string|null} Testo generato
   */
  _generateWithModel(prompt, modelName, apiKeyOverride = null, attachments = []) {
    const generated = this._generateWithModelResult_(prompt, modelName, apiKeyOverride, attachments);
    return generated.text;
  }

  _generateWithModelEnvelope_(prompt, modelName, apiKeyOverride = null, attachments = []) {
    const generated = this._generateWithModelResult_(prompt, modelName, apiKeyOverride, attachments);
    const usageMetadata = generated.usageMetadata || null;
    const actualTokens = usageMetadata && Number.isFinite(Number(usageMetadata.totalTokenCount))
      ? Number(usageMetadata.totalTokenCount)
      : null;

    return {
      __rateLimiterEnvelope: true,
      result: generated.text,
      text: generated.text,
      usageMetadata: usageMetadata,
      actualTokens: actualTokens,
      partsCount: generated.partsCount
    };
  }

  _incrementGroundingCounterLocal_(count) {
    const increment = Math.max(0, parseInt(count || 0, 10) || 0);
    if (increment <= 0) return;
    if (
      this.useRateLimiter &&
      this.rateLimiter &&
      typeof this.rateLimiter.reserveGoogleSearchGroundingQueries === 'function'
    ) {
      return this.rateLimiter.reserveGoogleSearchGroundingQueries(increment);
    }

    const notes = (this.config && this.config.GEMINI_FREE_TIER_NOTES) ? this.config.GEMINI_FREE_TIER_NOTES : {};
    const limit = Number(notes.groundingSharedRpd) > 0 ? Number(notes.groundingSharedRpd) : 1500;
    const lock = LockService.getScriptLock();
    const gotLock = lock.tryLock(25000);
    if (!gotLock) {
      throw new Error('QUOTA_EXHAUSTED: lock Google Search Grounding non acquisito');
    }
    try {
      const todayPacific = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
      const dateKey = 'grounding_google_search_date';
      const countKey = 'grounding_google_search_rpd';
      const storedDate = this.props.getProperty(dateKey) || '';
      let current = storedDate === todayPacific
        ? (parseInt(this.props.getProperty(countKey) || '0', 10) || 0)
        : 0;
      if (current + increment > limit) {
        throw new Error(`QUOTA_EXHAUSTED: Google Search Grounding ${current + increment}/${limit} query giornaliere`);
      }
      current += increment;
      this.props.setProperties({
        [dateKey]: todayPacific,
        [countKey]: String(current)
      });
    } finally {
      lock.releaseLock();
    }
  }

  _extractGroundingQueryCount_(result) {
    try {
      const metadata = result && result.candidates && result.candidates[0]
        ? result.candidates[0].groundingMetadata
        : null;
      const queries = metadata && Array.isArray(metadata.webSearchQueries)
        ? metadata.webSearchQueries.filter(Boolean)
        : [];
      const unique = {};
      queries.forEach(q => { unique[String(q)] = true; });
      return Object.keys(unique).length;
    } catch (e) {
      return 0;
    }
  }

  _hashString_(value) {
    const text = String(value || '');
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.computeDigest === 'function') {
      const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
      return bytes.map(function (b) {
        const n = b < 0 ? b + 256 : b;
        return ('0' + n.toString(16)).slice(-2);
      }).join('');
    }

    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash) + text.charCodeAt(i);
      hash = hash & 0xffffffff;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Controllo rapido con modello specifico
   * @param {string} emailContent - Contenuto email
   * @param {string} emailSubject - Oggetto email
   * @param {string} modelName - Nome modello API
   * @param {Object} [precomputedDetection] - Risultato detectEmailLanguage già calcolato (evita doppia chiamata)
   * @param {Object} [intentContext] - Segnali di intento già calcolati
   * @param {string|null} [apiKeyOverride] - Chiave coerente con il modelKey scelto dal RateLimiter
   * @returns {Object} Risultato controllo rapido
   */
  _quickCheckWithModel(emailContent, emailSubject, modelName, precomputedDetection = null, intentContext = null, apiKeyOverride = null) {
    const promptContext = EmailQuickCheckPolicy.buildPrompt(emailContent, emailSubject, intentContext);
    const detection = precomputedDetection || this.detectEmailLanguage(promptContext.safeContent, promptContext.safeSubject);
    const prompt = promptContext.prompt;

    const url = this._buildGenerateUrl(modelName);

    console.log(`🔍 Controllo rapido via ${modelName}...`);

    // Gestione con tentativo su chiave primaria e fallback singolo su chiave secondaria.
    let activeKey = apiKeyOverride || this.primaryKey;
    let response;
    let responseCode;
    let fetchError = null;
    const client = this._createGeminiContentClient_();
    const builtPayload = client.buildGenerateContentPayload({
      taskType: 'quick_check',
      prompt: prompt,
      modelName: modelName
    });
    const requestPayload = {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(builtPayload.payloadObj),
      muteHttpExceptions: true
    };
    const executeFetch = (apiKey) => this.fetchFn(`${url}?key=${encodeURIComponent(apiKey)}`, requestPayload);

    try {
      response = executeFetch(activeKey);
      responseCode = response.getResponseCode();
    } catch (e) {
      fetchError = e;
    }

    const primaryResponseBody = (typeof response !== 'undefined' && response && typeof response.getContentText === 'function')
      ? response.getContentText()
      : '';
    const isAuthOrQuotaError = responseCode !== undefined &&
      this._isPrimaryKeyFallbackHttpError_(responseCode, primaryResponseBody);
    const isRateLimiterKeyBound = !!apiKeyOverride;
    const shouldTryBackupKey = !isRateLimiterKeyBound
      && !!this.backupKey
      && activeKey !== this.backupKey
      && isAuthOrQuotaError;

    if (
      isRateLimiterKeyBound &&
      isAuthOrQuotaError &&
      activeKey === this.primaryKey &&
      this.backupKey &&
      this.backupKey !== activeKey
    ) {
      this._markPrimaryExhausted_('quick_check', responseCode);
      const keySwitchError = new Error('PRIMARY_QUOTA_EXHAUSTED');
      keySwitchError.isTransient = true;
      throw keySwitchError;
    }

    // Evita di moltiplicare retry cross-key su errori infrastrutturali Google/rete:
    // la backup key aiuta solo per autorizzazione o quota della chiave primaria.
    if (shouldTryBackupKey) {
      console.warn(`⚠️ Chiave primaria non utilizzabile (HTTP ${responseCode}). Tentativo con chiave di riserva...`);
      if (activeKey === this.primaryKey) {
        this._markPrimaryExhausted_('quick_check', responseCode);
      }
      activeKey = this.backupKey;
      try {
        Utilities.sleep(1500);
        response = executeFetch(activeKey);
        responseCode = response.getResponseCode();
        fetchError = null;
      } catch (backupError) {
        throw new Error(`Errore connessione API (anche con backup): ${backupError.message}`);
      }
    }

    if (fetchError) {
      throw new Error(`Errore connessione API: ${fetchError.message}`);
    }

    if (typeof responseCode === 'undefined') {
      throw new Error('Errore API: responseCode indefinito (possibile interruzione di rete pre-connessione)');
    }

    // responseCode è già valorizzato dal path primario o dal fallback backup key.

    if (responseCode === 429) {
      throw new Error('QUOTA_EXHAUSTED_ALL_KEYS: Limite quota raggiunto su tutte le chiavi disponibili (429)');
    }
    if ([500, 502, 503, 504].includes(responseCode)) {
      const transientError = new Error(`Errore server Gemini(${responseCode})`);
      transientError.isTransient = true;
      throw transientError;
    }

    if (responseCode !== 200) {
      throw new Error(`Errore API: ${responseCode}`);
    }

    return EmailQuickCheckPolicy.normalizeApiResponse(response.getContentText(), detection, intentContext, {
      resolveLanguage: (candidateLanguage, fallbackLanguage, safetyGrade) =>
        this._resolveLanguage(candidateLanguage, fallbackLanguage, safetyGrade),
      emailSubject: emailSubject,
      emailContent: emailContent
    });
  }


  // ========================================================================
  // TENTATIVO DEL WRAPPER
  // ========================================================================

  /**
   * Esegue una funzione con retry temporizzati
   * Usa ritardi crescenti tra i tentativi
   */
  _withRetry(fn, context = 'Chiamata API', maxRetries = null) {
    const attempts = Number(maxRetries) > 0
      ? Number(maxRetries)
      : (Number(this.maxRetries) > 0 ? Number(this.maxRetries) : 2);
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const result = fn();
        // Le risposte vuote sono considerate non transienti.
        // Le segnaliamo come errore non-retryable per evitare spreco quota API.
        if (result === undefined || result === null || result === '') {
          const emptyError = new Error(`Risposta vuota o undefined da ${context}`);
          emptyError._nonRetryable = true;
          throw emptyError;
        }
        return result;
      } catch (error) {
        lastError = error;

        // Manteniamo _classifyError come logica di classificazione interna centralizzata
        // e resta allineato al contratto condiviso retryable/type.
        // Nota: NON replichiamo qui una classificazione inline, per evitare drift
        // con la policy errori del servizio e falsi positivi nei retry.
        // NON usare classifyError globale: potrebbe non esistere in alcuni runtime GAS modulari.
        if (this._isKeySwitchSignal_(error)) {
          throw error;
        }

        const classified = this._classifyError(error);
        // Verifica del flag _nonRetryable per le risposte vuote.
        const isRetryable = classified.retryable && !(error && error._nonRetryable);

        if (!isRetryable) {
          // Errore fatale: interrompere immediatamente senza consumare altri tentativi
          throw error;
        }

        if (attempt < attempts - 1) {
          const retryDelay = Number(this.retryDelay) > 0 ? Number(this.retryDelay) : 4000;
          const backoffFactor = Number(this.backoffFactor) > 1 ? Number(this.backoffFactor) : 2.5;
          const maxBackoffMs = Number(this.maxBackoffMs) > 0 ? Number(this.maxBackoffMs) : 120000;
          const jitterMax = Number(this.retryJitterMs) > 0 ? Number(this.retryJitterMs) : 0;
          const jitter = jitterMax > 0 ? Math.floor(Math.random() * jitterMax) : 0;
          const waitTime = Math.min(
            retryDelay * Math.pow(backoffFactor, attempt),
            maxBackoffMs
          ) + jitter;
          const safeErrorMsg = this._getErrorMessage_(error);
          console.warn(`⚠️ ${context} fallito (tentativo ${attempt + 1}/${attempts}): [${classified.type}] ${safeErrorMsg} - Attendendo ${waitTime}ms...`);
          Utilities.sleep(waitTime);
        }
      }
    }

    throw lastError || new Error(`Fallimento definitivo dopo ${attempts} tentativi`);
  }

  _getErrorMessage_(error) {
    if (error == null) return '';
    if (typeof error === 'string') return error;
    if (error.message != null) return String(error.message);
    try {
      return JSON.stringify(error) || '';
    } catch (jsonError) {
      return String(error);
    }
  }

  _normalizeQuotaSignal_(error) {
    return this._getErrorMessage_(error).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  _isQuotaExhaustedSignal_(error) {
    const compactMsg = this._normalizeQuotaSignal_(error);
    return compactMsg.includes('primaryquotaexhausted') || compactMsg.includes('quotaexhaustedallkeys');
  }

  _isPrimaryKeySwitchSignal_(error) {
    return this._normalizeQuotaSignal_(error).includes('primaryquotaexhausted');
  }

  _isKeySwitchSignal_(error) {
    return this._isQuotaExhaustedSignal_(error);
  }

  _canFailoverToBackupKey_(error, activeKey) {
    return !!(
      this.backupKey &&
      activeKey === this.primaryKey &&
      this.backupKey !== activeKey &&
      this._isPrimaryKeySwitchSignal_(error)
    );
  }

  /**
   * Categorizza l'errore internamente al GeminiService per la logica di retry.
   * @param {Error} error 
   * @returns {{type: string, retryable: boolean}}
   */
  _classifyError(error) {
    const rawMessage = this._getErrorMessage_(error);
    const msg = rawMessage.toLowerCase();

    // Segnali interni di esaurimento quota: non ritentare sulla stessa chiave,
    // lascia che il chiamante passi subito alla strategia/chiave successiva.
    // Normalizziamo separatori/case per accettare sia PRIMARY_QUOTA_EXHAUSTED
    // sia varianti compatte come PRIMARYQUOTAEXHAUSTED.
    if (this._isQuotaExhaustedSignal_(error)) {
      return { type: 'QUOTA_EXHAUSTED', retryable: false };
    }

    if (typeof classifyError === 'function' && typeof ErrorTypes !== 'undefined') {
      const central = classifyError(error);
      if (central.type === ErrorTypes.QUOTA_EXCEEDED || central.type === ErrorTypes.NETWORK ||
          central.type === ErrorTypes.TIMEOUT || central.type === ErrorTypes.CACHE_EXPIRED) {
        return { type: 'RETRYABLE', retryable: true };
      }
      return { type: 'FATAL', retryable: false };
    }
    const RETRYABLE_ERRORS = ['quota', 'timeout', 'deadline', 'econnreset'];
    const FATAL_ERRORS = ['unauthorized', 'forbidden', 'permission denied', 'unauthenticated'];

    // 401/403 sono tipicamente problemi di credenziali o permessi: ritentare non li risolve.
    // PRIMARY_QUOTA_EXHAUSTED deve saltare i retry locali per passare subito al backup.
    for (const kw of FATAL_ERRORS) {
      if (msg.includes(kw)) {
        return { type: 'FATAL', retryable: false };
      }
    }

    if (/\b(401|403)\b/.test(msg)) {
      return { type: 'FATAL', retryable: false };
    }

    let retryable = false;
    for (const kw of RETRYABLE_ERRORS) {
      if (msg.includes(kw)) {
        retryable = true;
        break;
      }
    }
    if (!retryable && /\b(429|500|502|503|504)\b/.test(msg)) {
      retryable = true;
    }
    return { type: retryable ? 'RETRYABLE' : 'FATAL', retryable: retryable };
  }

  // ========================================================================
  // RILEVAMENTO LINGUA (Centralizzato)
  // ========================================================================

  /**
   * Rileva la lingua dell'email processando testo localmente tramite dizionario stop-words
   * Molto più veloce dell'API Gemini e fissa i rari switch di lingua su nomi stranieri.
   * @param {string} emailContent 
   * @param {string} emailSubject 
   * @returns {{lang: string, confidence: number, safetyGrade: number}} 
   */
  detectEmailLanguage(emailContent, emailSubject = '') {
    const safeSubject = typeof emailSubject === 'string' ? emailSubject : (emailSubject == null ? '' : String(emailSubject));
    let safeContent = typeof emailContent === 'string' ? emailContent : (emailContent == null ? '' : String(emailContent));

    // PROTEZIONE: limite ampio prima delle RegEx per evitare CPU Timeout se
    // un utente invia una mail infinita, ma rimuoviamo le citazioni prima del
    // truncamento finale del segnale lingua per non far consumare il budget dal thread storico.
    safeContent = safeContent.substring(0, 60000);

    // Rimuove le citazioni per evitare che il testo quotato (es. precedente thread in italiano) alteri il punteggio
    safeContent = safeContent.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
    safeContent = safeContent.replace(/<div\s+class=["']gmail_quote["'][^>]*>[\s\S]*$/gi, '');
    // Fallback per citazioni testuali se l'HTML è già stato strippato o è incompleto
    safeContent = safeContent.replace(/(?:^|\n)>{1,3}[^\n]*/g, '');
    safeContent = safeContent.replace(/(?:^|\n)(On |Il giorno )[^\n]*(wrote|ha scritto):[\s\S]*/gi, '');
    safeContent = safeContent.replace(/(?:^|\n)-{3,}.*(Original Message|Messaggio originale).*[\s\S]*/gi, '');
    safeContent = safeContent.substring(0, 15000);

    // Trunca a 3000 char per evitare CPU Timeout sull'elaborazione lingua
    const text = ` ${safeSubject} ${safeContent} `.substring(0, 3000).toLowerCase();
    const originalText = ` ${safeSubject} ${safeContent} `.substring(0, 3000);

    // 1. Rilevamento potenziato Italiano istituzionale
    // Previene errori su richieste formali. Trasformato in boost per evitare falsi positivi su nomi propri.
    const snippet = text.substring(0, 800);
    let itIstituzionaleScore = 0;
    
    // Rimosse parole come "parrocchia", "sant'eugenio", "segreteria" e "don raimondo" 
    // perché usate universalmente dagli stranieri per riferirsi a voi.
    const itIstituzionale = [
      'ufficio parrocchiale', 'certificato di battesimo', 'nulla osta', 
      'la celebrazione', 'il sacramento', 'l\'eucaristia', 'la comunione', 
      'la cresima', 'il matrimonio', 'il funerale', 'la benedizione'
    ];
    
    const itIstituzionaleMatches = itIstituzionale.filter(k => snippet.includes(k)).length;
    if (itIstituzionaleMatches > 0) {
      itIstituzionaleScore = Math.min(15, itIstituzionaleMatches * 5);
      console.log(`   Trovati ${itIstituzionaleMatches} termini istituzionali italiani (+${itIstituzionaleScore} punti IT)`);
    }

    // 2. Score basato su indicatori frequenti (fallback)
    const indicators = {
      'it': ['buon', 'grazie', 'messaggio', 'cortesi', 'saluti', 'gentile', 'lei', 'perché', 'come', 'quando', 'vorrei'],
      'en': ['thank', 'regards', 'dear', 'parish', 'mass', 'church', 'would', 'could'],
      'es': ['gracias', 'saludos', 'estimado', 'parroquia', 'misa', 'iglesia', 'querría'],
      'fr': ['merci', 'cordialement', 'cher', 'paroisse', 'messe', 'église', 'voudrais'],
      'de': ['danke', 'grüße', 'liebe', 'pfarrei', 'messe', 'kirche', 'möchte'],
      'pt': ['obrigado', 'obrigada', 'cumprimentos', 'paróquia', 'missa', 'igreja', 'orçamento']
    };

    // Rilevamento caratteri specifici
    let spanishCharScore = 0;
    let portugueseCharScore = 0;

    if (originalText.includes('¿') || originalText.includes('¡')) {
      spanishCharScore = 1;
      console.log('   Trovata punteggiatura spagnola (¿ o ¡)');
    }
    if (text.includes('ñ')) {
      spanishCharScore += 2;
      console.log('   Trovato carattere spagnolo (ñ)');
    }
    if (text.includes('ã') || text.includes('õ') || text.includes('ç')) {
      if (text.includes('ã') || text.includes('õ')) {
        portugueseCharScore += 2;
        console.log('   Trovato carattere portoghese forte (ã, õ)');
      } else {
        portugueseCharScore += 0.5;
        console.log('   Trovato carattere ambiguo (ç): boost portoghese ridotto');
      }
    }

    // Parole chiave per rilevamento
    const englishUniqueKeywords = [
      'kind regards', 'best regards', 'sincerely', 'yours truly',
      'looking forward', 'i would like', 'we would like',
      'let me know', 'get back to', 'reach out',
      'however', 'therefore', 'furthermore', 'moreover',
      'hello', 'hi', 'dear', 'good morning', 'good afternoon', 'good evening',
      'need', 'want', 'information', 'help'
    ];

    const englishStandardKeywords = [
      // Evitiamo stopword troppo corte/ambigue ("in", "no", "me", "to", ...)
      // perché in italiano e nelle firme email causano falsi positivi EN.
      'and', 'but',
      'will', 'shall', 'must',
      'have', 'has', 'had', 'does', 'did',
      'what', 'when', 'where', 'how', 'why', 'which', 'who',
      'from', 'for', 'with',
      'are', 'were', 'this', 'that', 'your', 'not'
    ];

    const spanishKeywords = [
      'he ido', 'había', 'hay', 'ido', 'sido',
      'hacer', 'haber', 'pseudo-podere', 'estar', 'estoy', 'están',
      'por qué', 'porque', 'cuándo', 'cómo', 'dónde', 'qué tal',
      'por favor', 'muchas gracias', 'buenos días', 'buenas tardes',
      'misa', 'misas', 'iglesia', 'parroquia',
      'hola', 'gracias', 'necesito', 'quiero',
      'querido', 'estimado', 'saludos',
      'unos', 'unas',
      'del', 'con el', 'en el', 'es',
      'ustedes', 'nosotros', 'tambien', 'también'
    ];

    const portugueseUniqueKeywords = [
      'olá', 'obrigado', 'obrigada', 'agradecemos', 'agradeço',
      'por favor', 'bom dia', 'boa tarde', 'boa noite',
      'missa', 'missas', 'igreja', 'paróquia',
      'atenciosamente', 'cumprimentos', 'atualização'
    ];

    const portugueseStandardKeywords = [
      'por', 'para', 'com', 'não', 'uma', 'seu', 'sua',
      'dos', 'das', 'ao', 'aos'
    ];

    const italianKeywords = [
      'sono', 'siamo', 'stato', 'stata', 'ho', 'hai', 'abbiamo',
      'fare', 'avere', 'essere', 'potere', 'volere',
      'perché', 'perchè', 'quando', 'come', 'dove', 'cosa',
      'per favore', 'per piacere', 'molte grazie', 'buongiorno',
      'buonasera', 'gentile', 'egregio', 'cordiali saluti',
      'si invia', 'in allegato', 'ufficio di segreteria', 'vicariato di roma',
      'non', 'il', 'di', 'da',
      'nel', 'della', 'degli', 'delle'
    ];

    // Conta corrispondenze con limiti di parola Unicode-safe
    const countMatches = (keywords, txt, weight = 1) => {
      let count = 0;
      for (const kw of keywords) {
        if (kw.startsWith(' ') || kw.endsWith(' ')) {
          const matches = (txt.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
          count += weight * matches;
        } else {
          const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          // NOTA: niente \b perché in JS è ASCII-only e fallisce con accenti (es. "olá", "perché").
          // Usiamo invece un confine Unicode esplicito senza lookbehind per massima compatibilità runtime.
          const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'giu');
          const matches = (txt.match(pattern) || []).length;
          count += weight * matches;
        }
      }
      return count;
    };

    const englishScore = countMatches(englishUniqueKeywords, text, 2) +
      countMatches(englishStandardKeywords, text, 1);
    const spanishLexicalScore = countMatches(spanishKeywords, text, 1);

    const ptUniqueScore = countMatches(portugueseUniqueKeywords, text, 2);
    const ptStandardScoreRaw = countMatches(portugueseStandardKeywords, text, 1);
    const portugueseStrongMarkers = /(?:^|[^\p{L}\p{N}_])(n[ãa]o|voc[êe]s?|estou|obrigad[oa]|or[cç]amento|viatura|portagens|agradecemos|cumprimentos|par[oó]quia|igreja|atenciosamente)(?=$|[^\p{L}\p{N}_])/iu;
    const hasPortugueseStrongSignal =
      ptUniqueScore >= 2 ||
      portugueseCharScore >= 2 ||
      portugueseStrongMarkers.test(text);
    // Guardrail anti-falso-positivo: senza marker forti, le sole stopword PT
    // ("por/para/com/uma/...") non devono dominare testi italiani.
    const ptStandardScore = hasPortugueseStrongSignal
      ? ptStandardScoreRaw
      : Math.min(ptStandardScoreRaw, 1);

    const scores = {
      'en': englishScore,
      'es': spanishLexicalScore + Math.min(spanishCharScore, 2),
      'it': countMatches(italianKeywords, text, 1) + itIstituzionaleScore,
      'pt': ptUniqueScore + ptStandardScore + Math.min(portugueseCharScore, 2),
      // Supporto markers per lingue secondarie.
      'fr': countMatches(indicators.fr, text, 1.5),
      'de': countMatches(indicators.de, text, 1.5)
    };

    // Disambiguazione ES/PT su testi brevi: evita confusione quando i punteggi sono quasi pari.
    const compactText = text.replace(/\s+/g, ' ').trim();
    if (compactText.length <= 150 && Math.abs(scores.es - scores.pt) <= 1.5 && Math.max(scores.es, scores.pt) >= 1) {
      // Marcatori forti Portuguese: não, você, obrigado, você, vocês, estou, hoje, amanhã, bom, bem
      const ptStrongMarkers = /(?:^|[^\p{L}\p{N}_])(n[ãa]o|voc[êe]s?|estou|obrigad[oa]|hoje|amanh[ãa]|bom|bem|muito|atenciosamente)(?=$|[^\p{L}\p{N}_])/iu;
      // Marcatori forti Spanish: usted, ustedes, gracias, presupuesto, coche, iglesia, parroquia, estimado, querido, hoy, mañana, bien
      const esStrongMarkers = /(?:^|[^\p{L}\p{N}_])(usted|ustedes|gracias|hoy|ma[ñn]ana|iglesia|parroquia|estimado|querido|bien|mucho|atentamente)(?=$|[^\p{L}\p{N}_])/iu;
      
      if (ptStrongMarkers.test(compactText) && !esStrongMarkers.test(compactText)) {
        scores.pt += 1.5;
      } else if (esStrongMarkers.test(compactText) && !ptStrongMarkers.test(compactText)) {
        scores.es += 1.5;
      }
    }

    console.log(`   Punteggi lingua: IT = ${scores['it']}, EN = ${scores['en']}, ES = ${scores['es']}, PT = ${scores['pt']}, FR = ${scores['fr']}, DE = ${scores['de']}`);

    // Determina lingua rilevata e punteggio massimo
    let detectedLang = 'it';
    let maxScore = scores.it || 0;
    const langPriority = ['it', 'en', 'pt', 'es', 'fr', 'de'];
    for (const lang of langPriority) {
      if (scores[lang] > maxScore) {
        maxScore = scores[lang];
        detectedLang = lang;
      }
    }

    // Default: IT se punteggi nulli o trascurabili
    if (maxScore < 2) {
      console.log('   ✓ Default: ITALIANO (punteggio basso o nullo)');
      return { lang: 'it', confidence: maxScore, safetyGrade: 1 };
    }

    const safetyGrade = this._computeSafetyGrade(detectedLang, maxScore, scores);
    
    // Se il grado di sicurezza è basso (< 3), tentiamo un rilevamento AI come fallback.
    // Questo è cruciale per messaggi molto brevi o ambigui in qualsiasi lingua.
    if (safetyGrade < 3 && typeof this.detectLanguageAI === 'function') {
      try {
        const aiLang = this.detectLanguageAI(text);
        if (aiLang && aiLang !== detectedLang) {
          console.log(`   🔄 Override AI: ${detectedLang.toUpperCase()} → ${aiLang.toUpperCase()}`);
          return { lang: aiLang, confidence: maxScore, safetyGrade: 4, method: 'ai_fallback' };
        }
      } catch (e) {
        console.warn(`   ⚠️ Fallback AI fallito: ${e.message}`);
      }
    }

    console.log(`   ✓ Rilevato: ${detectedLang.toUpperCase()} (punteggio: ${maxScore}, grado sicurezza: ${safetyGrade})`);

    return {
      lang: detectedLang,
      confidence: maxScore,
      safetyGrade: safetyGrade,
      method: 'local_regex'
    };
  }

  /**
   * Rilevamento lingua tramite AI (fallback).
   */
  detectLanguageAI(text) {
    const prompt = `Analizza questo testo e identifica la lingua prevalente.
Rispondi ESCLUSIVAMENTE con il codice ISO 639-1 (es. it, en, es, fr, de, pt).
NON aggiungere altro testo.

Testo:
"${text.substring(0, 1000)}"`;

    const languageModelName = this.getModelNameForTask('language', 'gemini-3.5-flash-lite');

    try {
      const response = this._withRetry(
        () => this._generateWithModel(prompt, languageModelName),
        'Language detection AI',
        1 // Solo 1 retry per non bloccare la pipeline
      );
      
      const cleaned = (response || '').replace(/`/g, '').trim().toLowerCase().substring(0, 2);
      return /^[a-z]{2}$/.test(cleaned) ? cleaned : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Calcola il grado di sicurezza del rilevamento locale (1-5)
   * Basato su punteggio assoluto e distacco dal secondo classificato
   */
  _computeSafetyGrade(detectedLang, score, allScores) {
    let secondScore = 0;
    for (const lang in allScores) {
      if (lang !== detectedLang && allScores[lang] > secondScore) {
        secondScore = allScores[lang];
      }
    }

    const gap = score - secondScore;

    // Grado 5: Dominio assoluto (es. 10 vs 1 o gap > 6)
    if (score >= 8 && gap >= 5) return 5;

    // Grado 4: Molto sicuro (gap netto)
    if (score >= 5 && gap >= 3) return 4;

    // Grado 3: Abbastanza sicuro
    if (gap >= 2) return 3;

    // Grado 2: Incertezza (punteggi vicini)
    if (gap >= 1) return 2;

    // Grado 1: Bassissima sicurezza (tie o quasi)
    return 1;
  }

  /**
   * Risolve il conflitto tra detection Gemini (API) e Locale (Regex)
   */
  _resolveLanguage(geminiLang, localLang, localSafetyGrade) {
    if (!geminiLang) return localLang || 'it';

    const normalizedGemini = String(geminiLang).toLowerCase().substring(0, 2);
    const normalizedLocal = localLang ? String(localLang).toLowerCase().substring(0, 2) : 'it';

    // 1. Se coincidono, massima sicurezza
    if (normalizedGemini === normalizedLocal) return normalizedGemini;

    // 2. Lingue non coperte dal rilevamento locale: in quel caso ci fidiamo di Gemini.
    const supportedLocally = ['it', 'en', 'es', 'pt', 'fr', 'de'];
    if (!supportedLocally.includes(normalizedGemini)) {
      console.log(`   🌍 Lingua: ${normalizedGemini.toUpperCase()} (Gemini ha rilevato lingua non supportata localmente)`);
      return normalizedGemini;
    }

    // 3. Lingua principale: Se il locale è MOLTO sicuro (grado >= 4), 
    // prevale sulla detection API (che a volte si confonde con nomi propri o citazioni).
    if (localSafetyGrade >= 4) {
      console.log(`   🌍 Lingua: ${normalizedLocal.toUpperCase()} (Locale vince per grado sicurezza ${localSafetyGrade})`);
      return normalizedLocal;
    }

    // 4. Default: Se c'è incertezza, ci fidiamo del rilevamento del modello Large
    console.log(`   🌍 Lingua: ${normalizedGemini.toUpperCase()} (Gemini prioritario su locale incerto)`);
    return normalizedGemini;
  }

  // ===================================
  // SALUTO ADATTIVO
  // ===================================

  /**
 * Ottieni un saluto e chiusura adattati alla lingua, ora e giorni speciali
 * Supporta calendario liturgico completo
 */
  getAdaptiveGreeting(senderName, language = 'it') {
    const safeSenderName = this._sanitizeSenderNameForGreeting_(senderName, language);
    const now = new Date();
    let hour = now.getHours();
    let day = now.getDay(); // 0 = Domenica
    let minutes = now.getMinutes();

    // Coerenza business: saluti basati sempre sull'orario italiano,
    // anche se il fuso del progetto è stato modificato per errore.
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      try {
        hour = parseInt(Utilities.formatDate(now, 'Europe/Rome', 'H'), 10);
        minutes = parseInt(Utilities.formatDate(now, 'Europe/Rome', 'm'), 10);
        const isoDay = parseInt(Utilities.formatDate(now, 'Europe/Rome', 'u'), 10);
        if (!isNaN(isoDay)) day = isoDay % 7;
      } catch (e) {
        // fallback locale: manteniamo comportamento precedente se Utilities non è disponibile
      }
    }

    let greeting, closing;

    // Prima verifica saluto giorno speciale
    const specialGreeting = this._getSpecialDayGreeting(now, language);
    if (specialGreeting) {
      greeting = specialGreeting;
    } else {
      // Alternativa un saluto standard basato sull'ora
      const isNightTime = (hour >= 0 && hour < 5) || (hour === 23 && minutes >= 30);

      if (language === 'it') {
        if (isNightTime) {
          greeting = `Gentile ${safeSenderName}, `;
        } else if (day === 0) {
          greeting = 'Buona domenica.';
        } else if (hour >= 5 && hour < 13) {
          greeting = 'Buongiorno.';
        } else if (hour >= 13 && hour < 19) {
          greeting = 'Buon pomeriggio.';
        } else {
          greeting = 'Buonasera.';
        }
      } else if (language === 'en') {
        if (isNightTime) {
          greeting = 'Good day,';
        } else if (day === 0) {
          greeting = 'Happy Sunday,';
        } else if (hour >= 5 && hour < 12) {
          greeting = 'Good morning,';
        } else if (hour >= 12 && hour < 18) {
          greeting = 'Good afternoon,';
        } else {
          greeting = 'Good evening,';
        }
      } else if (language === 'es') {
        if (isNightTime) {
          greeting = `Estimado / a ${safeSenderName}, `;
        } else if (day === 0) {
          greeting = 'Feliz domingo,';
        } else if (hour >= 5 && hour < 13) {
          greeting = 'Buenos días,';
        } else if (hour >= 13 && hour < 19) {
          greeting = 'Buenas tardes,';
        } else {
          greeting = 'Buenas noches,';
        }
      } else if (language === 'pt') {
        if (isNightTime) {
          greeting = `Prezado(a) ${safeSenderName},`;
        } else if (day === 0) {
          greeting = 'Feliz domingo,';
        } else if (hour >= 5 && hour < 12) {
          greeting = 'Bom dia,';
        } else if (hour >= 12 && hour < 19) {
          greeting = 'Boa tarde,';
        } else {
          greeting = 'Boa noite,';
        }
      } else if (language === 'fr') {
        if (isNightTime) {
          greeting = 'Bonjour,';
        } else if (day === 0) {
          greeting = 'Bon dimanche,';
        } else if (hour >= 5 && hour < 18) {
          greeting = 'Bonjour,';
        } else {
          greeting = 'Bonsoir,';
        }
      } else if (language === 'de') {
        if (isNightTime) {
          greeting = 'Guten Tag,';
        } else if (day === 0) {
          greeting = 'Einen schönen Sonntag,';
        } else if (hour >= 5 && hour < 18) {
          greeting = 'Guten Tag,';
        } else {
          greeting = 'Guten Abend,';
        }
      } else {
        // Altre lingue: saluto neutro
        greeting = 'Good day,';
      }
    }

    // Chiusura in base alla lingua
    if (language === 'it') {
      closing = 'Cordiali saluti,';
    } else if (language === 'en') {
      closing = 'Kind regards,';
    } else if (language === 'es') {
      closing = 'Cordiales saludos,';
    } else if (language === 'pt') {
      closing = 'Com os melhores cumprimentos,';
    } else if (language === 'fr') {
      closing = 'Cordialement,';
    } else if (language === 'de') {
      closing = 'Freundliche Grüße,';
    } else {
      // Lingue non preconfigurate: il prompt traduce/localizza questa chiusura nella lingua target.
      closing = 'Kind regards,';
    }

    return { greeting, closing };
  }

  _sanitizeSenderNameForGreeting_(senderName, language = 'it') {
    const fallback = String(language || '').toLowerCase().startsWith('it') ? 'utente' : 'parishioner';
    const raw = String(senderName || '').replace(/[<>\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw || /^(fallbacksendername|undefined|null|\[nome\]|\[name\])$/i.test(raw)) {
      return fallback;
    }
    return raw.substring(0, 50);
  }

  // ========================================================================
  // SALUTI GIORNI SPECIALI (Calendario Liturgico)
  // ========================================================================

  /**
   * Ottieni saluto speciale per feste liturgiche e festività
   */
  _getSpecialDayGreeting(dateObj, language = 'it') {
    const parts = this._getRomeDateParts_(dateObj);
    const y = parts.year;
    const m = parts.month;
    const d = parts.day;

    // === FESTIVITÀ FISSE ===

    // Capodanno
    if (m === 1 && d === 1) {
      if (language === 'en') return 'Happy New Year!';
      if (language === 'es') return '¡Feliz Año Nuevo!';
      if (language === 'pt') return 'Feliz Ano Novo!';
      return 'Buon Capodanno!';
    }

    // Epifania
    if (m === 1 && d === 6) {
      if (language === 'en') return 'Happy Epiphany!';
      if (language === 'es') return '¡Feliz Epifanía!';
      if (language === 'pt') return 'Feliz Epifania!';
      return 'Buona Epifania!';
    }

    // Assunzione (15 Agosto)
    if (m === 8 && d === 15) {
      if (language === 'en') return 'Happy Assumption Day!';
      if (language === 'es') return '¡Feliz día de la Asunción!';
      if (language === 'pt') return 'Feliz dia da Assunção!';
      return 'Buona festa!';
    }

    // Tutti i Santi (1 Novembre)
    if (m === 11 && d === 1) {
      if (language === 'en') return 'Happy All Saints Day!';
      if (language === 'es') return '¡Feliz día de Todos los Santos!';
      if (language === 'pt') return 'Feliz Dia de Todos os Santos!';
      return 'Buona festa di Ognissanti!';
    }

    // Immacolata Concezione (8 Dicembre)
    if (m === 12 && d === 8) {
      if (language === 'en') return 'Happy Feast of the Immaculate Conception!';
      if (language === 'es') return '¡Feliz día de la Inmaculada!';
      if (language === 'pt') return 'Feliz Imaculada Conceição!';
      return 'Buona Immacolata!';
    }

    // Natale (25 Dicembre)
    if (m === 12 && d === 25) {
      if (language === 'en') return 'Merry Christmas!';
      if (language === 'es') return '¡Feliz Navidad!';
      if (language === 'pt') return 'Feliz Natal!';
      return 'Buon Natale!';
    }

    // === FESTE MOBILI (basate sulla Pasqua) ===

    if (typeof calculateEaster !== 'function') return null;
    const easter = calculateEaster(y);

    // Ottava di Pasqua (Domenica di Pasqua + 7 giorni)
    const pasquaStart = easter;
    const pasquaEnd = this._addDays(easter, 7);
    if (this._isBetweenInclusive(dateObj, pasquaStart, pasquaEnd)) {
      if (language === 'en') return 'Happy Easter!';
      if (language === 'es') return '¡Feliz Pascua!';
      if (language === 'pt') return 'Feliz Páscoa!';
      return 'Buona Pasqua!';
    }

    // Pentecoste (Pasqua + 49 giorni)
    const pentecoste = this._addDays(easter, 49);
    if (this._isSameDate(dateObj, pentecoste)) {
      if (language === 'en') return 'Happy Pentecost!';
      if (language === 'es') return '¡Feliz Pentecostés!';
      if (language === 'pt') return 'Feliz Pentecostes!';
      return 'Buona Pentecoste!';
    }

    // Corpus Domini (Pasqua + 63 giorni in Italia)
    const corpusDominiIT = this._addDays(easter, 63);
    if (this._isSameDate(dateObj, corpusDominiIT)) {
      if (language === 'en') return 'Happy Corpus Christi!';
      if (language === 'es') return '¡Feliz Corpus Christi!';
      if (language === 'pt') return 'Feliz Corpus Christi!';
      return 'Buona festa!';
    }

    // Domenica della Sacra Famiglia
    const sacraFamiglia = this._getHolyFamilySunday(y);
    if (sacraFamiglia && this._isSameDate(dateObj, sacraFamiglia)) {
      if (language === 'en') return 'Happy Feast of the Holy Family!';
      if (language === 'es') return '¡Feliz Fiesta de la Sagrada Familia!';
      if (language === 'pt') return 'Feliz Festa da Sagrada Família!';
      return 'Buona Festa della Sacra Famiglia.';
    }

    return null; // Nessun giorno speciale
  }

  // ========================================================================
  // UTILITÀ DATE PER CALENDARIO LITURGICO
  // ========================================================================

  /**
   * Aggiunge giorni a una data
   */
  _addDays(date, days) {
    return new Date(new Date(date).getTime() + (days * 24 * 60 * 60 * 1000));
  }

  _getRomeDateParts_(dateObj) {
    const safeDate = dateObj instanceof Date ? dateObj : new Date(dateObj);
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      try {
        const formatted = Utilities.formatDate(safeDate, 'Europe/Rome', 'yyyy-MM-dd');
        const match = String(formatted || '').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
        if (match) {
          return {
            year: parseInt(match[1], 10),
            month: parseInt(match[2], 10),
            day: parseInt(match[3], 10)
          };
        }

        const year = parseInt(Utilities.formatDate(safeDate, 'Europe/Rome', 'yyyy'), 10);
        const month = parseInt(Utilities.formatDate(safeDate, 'Europe/Rome', 'M'), 10);
        const day = parseInt(Utilities.formatDate(safeDate, 'Europe/Rome', 'd'), 10);
        if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return { year: year, month: month, day: day };
        }
      } catch (e) {
        // locale di riserva sotto.
      }
    }
    return {
      year: safeDate.getFullYear(),
      month: safeDate.getMonth() + 1,
      day: safeDate.getDate()
    };
  }

  _romeDayOrdinal_(dateObj) {
    const parts = this._getRomeDateParts_(dateObj);
    return Date.UTC(parts.year, parts.month - 1, parts.day);
  }

  _getRomeWeekday_(dateObj) {
    const safeDate = dateObj instanceof Date ? dateObj : new Date(dateObj);
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      try {
        const isoDay = parseInt(Utilities.formatDate(safeDate, 'Europe/Rome', 'u'), 10);
        if (!isNaN(isoDay) && isoDay >= 1 && isoDay <= 7) return isoDay % 7;
      } catch (e) {
        // locale di riserva sotto.
      }
    }
    return safeDate.getDay();
  }

  /**
   * Verifica se due date sono lo stesso giorno
   */
  _isSameDate(date1, date2) {
    return this._romeDayOrdinal_(date1) === this._romeDayOrdinal_(date2);
  }

  /**
   * Verifica se una data è compresa tra inizio e fine (inclusi)
   */
  _isBetweenInclusive(date, start, end) {
    const d = this._romeDayOrdinal_(date);
    const s = this._romeDayOrdinal_(start);
    const e = this._romeDayOrdinal_(end);
    return d >= s && d <= e;
  }

  /**
   * Ottieni la data della Domenica della Sacra Famiglia
   * (Domenica tra 25 Dic e 1 Gen, o 30 Dic se nessuna domenica).
   * Nota: se il 25 dicembre cade di domenica, nel range 26-31 non c'è
   * alcuna domenica; in quel caso il fallback al 30 dicembre è intenzionale
   * (prassi liturgica del rito romano).
   */
  _getHolyFamilySunday(year) {
    // Il range 26-31 è intenzionale: cerchiamo la domenica *dopo* Natale.
    // Se il 25 è domenica, non esiste altra domenica nell'ottava e il
    // calendario romano prevede il fallback al 30 dicembre.
    for (let day = 26; day <= 31; day++) {
      const date = new Date(Date.UTC(year, 11, day, 12, 0, 0));
      if (this._getRomeWeekday_(date) === 0) {
        return date;
      }
    }
    return new Date(Date.UTC(year, 11, 30, 12, 0, 0));
  }

  // ========================================================================
  // CONTROLLO RAPIDO (Decisione risposta + Rilevamento lingua)
  // ========================================================================

  /**
   * Chiamata rapida Gemini per decidere se email richiede risposta E rilevare lingua
   * Supporta Rate Limiter + alternativa originale
   */
  shouldRespondToEmail(emailContent, emailSubject, precomputedDetection = null, intentContext = null) {
    const detection = precomputedDetection || this.detectEmailLanguage(emailContent, emailSubject);

    // PERCORSO LIMITATORE DI VELOCITÀ
    if (this.useRateLimiter) {
      try {
        const result = this.rateLimiter.executeRequest(
          'quick_check',
          (modelName, requestContext) => {
            const selectedApiKey = requestContext && requestContext.usesBackupKey && this.backupKey
              ? this.backupKey
              : this.primaryKey;
            return this._quickCheckWithModel(emailContent, emailSubject, modelName, detection, intentContext, selectedApiKey);
          },
          {
            estimatedTokens: 500
          }
        );

        const normalized = this._normalizeExecuteRequestResult_(result);
        if (normalized.success) {
          console.log(`🔍 Controllo rapido via Rate Limiter(modello: ${result.modelUsed})`);
          return normalized.result;
        }

        const rejectReason = (result && result.reason) ? result.reason : 'Rate limit interno';
        throw new Error(`Rate Limiter ha rifiutato il quick check: ${rejectReason}`);
      } catch (error) {
        if (error.message && error.message.includes('QUOTA_EXHAUSTED')) {
          // L'eccezione non viene gestita con un fallback diretto per allineamento a generateResponse.
          // Il fallback diretto bypasserebbe il quota tracking del RateLimiter,
          // causando consumo API non tracciato. Il Processor gestirà l'eccezione
          // come skip del thread (comportamento coerente e sicuro).
          console.warn('⚠️ Quick check: QUOTA_EXHAUSTED — rilancio per gestione corretta nel Processor.');
          throw error;
        }
        // NON bypassare il RateLimiter su errori transienti/non-quota:
        // executeRequest include già retry+backoff e il fallback diretto
        // causerebbe consumo API non tracciato.
        const msg = (error && error.message) ? error.message : String(error);
        if (msg.includes('Errore API: 404') || msg.includes('404')) {
          console.warn('⚠️ Quick check: modello Gemini non trovato (404). Verifica CONFIG.GEMINI_MODELS e il modello quick_check effettivamente disponibile per la tua API key/progetto.');
        }
        console.warn(`⚠️ Rate Limiter quick check fallito: ${msg}. Interruzione per evitare bypass quota.`);
        throw error;
      }
    }

    // IMPLEMENTAZIONE ORIGINALE (fallback o quando Rate Limiter disabilitato)
    try {
      const safeSubject = typeof emailSubject === "string" ? emailSubject : (emailSubject == null ? "" : String(emailSubject));
      const quickModelName = this.getModelNameForTask('quick_check', 'gemini-3.5-flash-lite');
      console.log(`🔍 Gemini quick check per: ${safeSubject.substring(0, 40)}...`);
      return this._withRetry(
        () => this._quickCheckWithModel(emailContent, safeSubject, quickModelName, detection, intentContext),
        'Quick check'
      );
    } catch (error) {
      console.warn(`⚠️ Quick check fallito: ${error.message}. Interruzione per evitare skip silente.`);
      throw error;
    }
  }

  _normalizeExecuteRequestResult_(result) {
    if (!result || typeof result !== 'object') {
      throw new Error('executeRequest ha restituito un risultato non valido');
    }
    return {
      success: result.success === true,
      result: (typeof result.result === 'undefined') ? null : result.result,
      modelUsed: result.modelUsed || 'unknown'
    };
  }

  // ========================================================================
  // GENERAZIONE RISPOSTA PRINCIPALE
  // ========================================================================

  /**
   * Genera risposta AI con retry
   * Supporta Rate Limiter + fallback originale
   * 
   * @param {string} prompt - Prompt completo
   * @param {Object} options - Opzioni per strategia Cross-Key Quality First
   * @param {string} options.apiKey - Chiave API specifica (opzionale)
   * @param {string} options.modelName - Nome modello specifico (opzionale)
   * @param {boolean} options.skipRateLimit - Se true, bypassa Rate Limiter locale
   * @param {Array<Blob>} options.attachments - Array di Blob (immagini/PDF)
   * @returns {Object} { success: boolean, text: string, error?: string, modelUsed?: string }
   */
  generateResponse(prompt, options = {}) {
    const requestedKey = options.apiKey || this.primaryKey;
    const targetModel = options.modelName || this.modelName;
    const startsOnBackupKey = !!(
      this.backupKey &&
      requestedKey === this.primaryKey &&
      this.isPrimaryExhausted === true
    );
    const targetKey = startsOnBackupKey ? this.backupKey : requestedKey;
    const skipRateLimit = !!(
      options.skipRateLimit ||
      startsOnBackupKey ||
      (this.backupKey && targetKey === this.backupKey && targetKey !== this.primaryKey)
    );
    const attachments = options.attachments || [];

    if (startsOnBackupKey) {
      console.warn('↪️ Chiave primaria già marcata esaurita: generazione instradata sulla chiave di riserva.');
    }

    // Pre-elaborazione Base64 per evitare ripetizione I/O e allocazioni pesanti durante i retry.
    const preEncodedAttachments = attachments.map(blob => {
      if (blob && blob.inlineData && blob.inlineData.data) return blob;
      try {
        const mimeType = blob && typeof blob.getContentType === 'function' ? blob.getContentType() : '';
        if (!mimeType) return null;
        if (blob && typeof blob.getSize === 'function') {
          const size = Number(blob.getSize());
          if (Number.isFinite(size) && size > GEMINI_MAX_INLINE_ATTACHMENT_BYTES) {
            console.warn(`Allegato ignorato (OOM protection): dimensione superiore ai 10MB (${mimeType})`);
            return null;
          }
        }
        const bytes = blob.getBytes();
        if (bytes && bytes.length > GEMINI_MAX_INLINE_ATTACHMENT_BYTES) {
          console.warn(`Allegato ignorato (OOM protection): dimensione superiore ai 10MB (${mimeType})`);
          return null;
        }
        return {
          inlineData: {
            mimeType: mimeType,
            data: Utilities.base64Encode(bytes)
          }
        };
      } catch (e) {
        console.warn(`Impossibile pre-encodare allegato: ${e.message}`);
        return null;
      }
    }).filter(Boolean);
    const runDirectGeneration = (apiKey, contextLabel) => {
      const text = this._withRetry(
        () => this._generateWithModel(prompt, targetModel, apiKey, preEncodedAttachments),
        contextLabel
      );
      return {
        success: !!text,
        text: text,
        modelUsed: targetModel,
        error: text ? null : 'Risposta vuota o errore'
      };
    };
    const runBackupFailover = (error, contextLabel) => {
      if (!this._canFailoverToBackupKey_(error, targetKey)) {
        return null;
      }
      console.warn(`↪️ ${contextLabel}: primaria non utilizzabile, failover immediato su chiave di riserva.`);
      return runDirectGeneration(this.backupKey, 'Generazione risposta (Failover Chiave di Riserva)');
    };
    const forceModelKey = this.useRateLimiter && this.rateLimiter && this.rateLimiter.models
      ? Object.keys(this.rateLimiter.models).find((key) =>
          key === targetModel || this.rateLimiter.models[key].name === targetModel
        )
      : null;

    // ====================================================================
    // RATE LIMITER PATH (solo se abilitato E non skippato)
    // ====================================================================
    if (this.useRateLimiter && !skipRateLimit) {
      try {
        const estimatedTokens = this._estimateTokens(prompt, attachments);

        const result = this.rateLimiter.executeRequest(
          'generation',
          (modelName, requestContext) => {
            const selectedApiKey = requestContext && requestContext.usesBackupKey && this.backupKey
              ? this.backupKey
              : targetKey;
            return this._generateWithModelEnvelope_(prompt, modelName, selectedApiKey, preEncodedAttachments);
          },
          {
            estimatedTokens: estimatedTokens,
            forceModel: forceModelKey,
            modelNameOverride: targetModel
          }
        );

        if (result.success) {
          const tokenLabel = result.actualTokens ? String(result.actualTokens) : `~${estimatedTokens}`;
          console.log(`✅ Generato via Rate Limiter (modello: ${result.modelUsed}, token: ${tokenLabel})`);
          return { success: true, text: result.result, modelUsed: result.modelUsed };
        }

        const rejectReason = (result && result.reason) ? result.reason : 'Rate limit interno';
        throw new Error(`Rate Limiter ha rifiutato la richiesta: ${rejectReason}`);
      } catch (error) {
        const backupResult = runBackupFailover(error, 'RateLimiter generazione');
        if (backupResult) {
          return backupResult;
        }
        if (error.message && error.message.includes('QUOTA_EXHAUSTED')) {
          console.warn('⚠️ Quota primaria esaurita (intercettato da RateLimiter)');
          throw error; // Rilancia per gestione strategia nel Processor
        }
        // NON effettuare fallback diretto: i retry sono già gestiti nel RateLimiter
        // e una seconda esecuzione fuori limiter falserebbe i contatori quota.
        const errorMessage = (error && error.message) ? error.message : String(error);
        console.warn(`⚠️ Rate Limiter generazione fallito: ${errorMessage}. Interruzione per evitare bypass quota.`);
        throw error; // Preserva l'eccezione originale per il classificatore
      }
    }

    // ====================================================================
    // CHIAMATA DIRETTA (quando RateLimiter disabilitato O skippato per backup key)
    // ====================================================================
    if (skipRateLimit) {
      console.log(`⏩ Chiamata diretta (bypass RateLimiter) con ${targetModel}`);
      try {
        return runDirectGeneration(targetKey, 'Generazione diretta (Chiave di Riserva)');
      } catch (error) {
        const backupResult = runBackupFailover(error, 'Generazione diretta');
        if (backupResult) {
          return backupResult;
        }
        throw error;
      }
    }

    try {
      return runDirectGeneration(targetKey, 'Generazione risposta');
    } catch (error) {
      const backupResult = runBackupFailover(error, 'Generazione risposta');
      if (backupResult) {
        return backupResult;
      }
      throw error;
    }
  }


  // ========================================================================
  // METODI UTILITÀ
  // ===================================
  /**
   * Costruisce URL API per modello specifico
   */
  _buildGenerateUrl(modelName) {
    const safeModel = modelName || this.modelName;
    return `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`;
  }

  /**
   * Testa connessione API Gemini
   */
  testConnection() {
    const results = {
      connectionOk: false,
      canGenerate: false,
      errors: []
    };

    try {
      const testPrompt = 'Rispondi con una sola parola: OK';

      const url = this._buildGenerateUrl(this.modelName);
      const generationConfig = this._buildGeminiGenerationConfig_('connection_test', this.modelName);
      const response = this.fetchFn(`${url}?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: testPrompt }] }],
          generationConfig: generationConfig
        }),
        muteHttpExceptions: true
      });

      results.connectionOk = response.getResponseCode() === 200;

      if (results.connectionOk) {
        try {
          const result = JSON.parse(response.getContentText());
          if (Array.isArray(result.candidates) && result.candidates.length > 0) {
            results.canGenerate = true;
          } else {
            results.errors.push('API non ha restituito candidati');
          }
        } catch (e) {
          results.connectionOk = false;
          results.errors.push(`Risposta API non è JSON valido: ${e.message}`);
        }
      } else {
        results.errors.push(`API ha restituito status ${response.getResponseCode()} `);
      }

    } catch (error) {
      results.errors.push(`Errore connessione: ${error.message} `);
    }

    results.isHealthy = results.connectionOk && results.canGenerate;
    return results;
  }
}

// Funzione factory per compatibilità
function createGeminiService() {
  return new GeminiService();
}

// ====================================================================
// JSON PARSER TOLLERANTE PER GEMINI (Quick Check)
// ====================================================================

function parseGeminiJsonLenient(text) {
  if (!text) throw new Error('Risposta vuota');

  // 1) Estrazione markdown robusta: usa il primo blocco fenced se presente
  let cleaned = text;
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    cleaned = fencedMatch[1];
  }

  // 2) Estrazione JSON esterno (oggetto o array)
  const startObj = cleaned.indexOf('{');
  const startArr = cleaned.indexOf('[');
  const start = (startObj !== -1 && startArr !== -1)
    ? Math.min(startObj, startArr)
    : Math.max(startObj, startArr);
  if (start === -1) {
    throw new Error('Nessun payload JSON trovato');
  }
  const openingChar = cleaned[start];
  const end = cleaned.lastIndexOf(openingChar === '{' ? '}' : ']');

  cleaned = (end === -1 || end < start)
    ? cleaned.substring(start).trim()
    : cleaned.substring(start, end + 1).trim();

  // 3) Recupero troncamenti: bilancia parentesi graffe mancanti
  cleaned = _tryBalanceJsonBraces(cleaned);

  // 4) Parsing diretto
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn('⚠️ Meccanismo di sanitizzazione preventiva JSON in esecuzione...');
  }

  // 5) Normalizzazione della notazione: quoting rigoroso chiavi e pulizia code strutturali
  const safeFixed = _quoteUnquotedJsonKeysSafely(cleaned);
  const withoutTrailingCommas = _removeTrailingCommasOutsideStrings_(safeFixed);

  try {
    return JSON.parse(withoutTrailingCommas);
  } catch (e) {
    // 6) Motore euristico avanzato: ricostruzione dei campi minimi diretti tramite analisi regex
    const partial = _extractQuickCheckFieldsFromPartialJson(cleaned);
    if (partial) {
      console.warn('⚠️ Metadati recuperati attivamente tramite ricostruzione regex');
      return partial;
    }
    throw new Error(`L'architettura di conformità JSON non ha potuto validare l'output stringente: ${e.message}`);
  }
}

function _removeTrailingCommasOutsideStrings_(text) {
  let output = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      output += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      output += ch;
      continue;
    }

    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j < text.length && (text[j] === '}' || text[j] === ']')) {
        i = j - 1;
        continue;
      }
    }

    output += ch;
  }

  return output;
}

/**
 * Assicura conformità strutturale dei blocchi JSON complessi.
 * Struttura dinamicamente gli alberi gerarchici per validazione sicura.
 */
function _tryBalanceJsonBraces(text) {
  if (!text) return text;

  let stringDelimiter = null;
  let escaped = false;
  const stack = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      if (!stringDelimiter) {
        stringDelimiter = ch;
      } else if (stringDelimiter === ch) {
        stringDelimiter = null;
      }
      continue;
    }
    if (stringDelimiter) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  let balanced = text;
  if (stringDelimiter) balanced += stringDelimiter;
  while (stack.length > 0) {
    balanced += stack.pop();
  }
  return balanced;
}

/**
 * Motore di ricostruzione euristica per l'estrazione dati in scenari architetturali complessi.
 * Impiega pattern matching per mappare reply_needed, language, category, topic, confidence.
 */
function _extractQuickCheckFieldsFromPartialJson(text) {
  if (!text) return null;

  const replyMatch = text.match(/"reply_needed"\s*:\s*(true|false|"true"|"false")/i);
  if (!replyMatch) return null;

  const languageMatch = text.match(/"language"\s*:\s*"([a-z]{2}(?:-[a-z]{2})?)"/i);
  const categoryMatch = text.match(/"category"\s*:\s*"(TECHNICAL|PASTORAL|DOCTRINAL|FORMAL|MIXED)"/i);
  // Supporta apici interni escapati, es: "topic": "Richiesta \"info\""
  const topicMatch = text.match(/"topic"\s*:\s*"((?:\\.|[^"\\])*)"/i);
  const territoryRequestMatch = text.match(/"is_territory_request"\s*:\s*(true|false|"true"|"false")/i);
  const territoryCandidatesMatch = text.match(/"territory_address_candidates"\s*:\s*\[([\s\S]*?)\]/i);
  const confidenceMatch = text.match(/"confidence"\s*:\s*(0(?:\.\d+)?|1(?:\.0+)?)/i);
  const territoryAddressCandidates = territoryCandidatesMatch
    ? (territoryCandidatesMatch[1].match(/"((?:\\.|[^"\\])*)"/g) || [])
      .map(item => item.slice(1, -1).replace(/\\"/g, '"').trim())
      .filter(Boolean)
    : [];

  return {
    reply_needed: String(replyMatch[1]).toLowerCase().includes('true'),
    language: languageMatch ? languageMatch[1].toLowerCase() : 'it',
    category: categoryMatch ? categoryMatch[1] : 'TECHNICAL',
    topic: topicMatch ? topicMatch[1].trim() : 'unknown',
    is_territory_request: territoryRequestMatch ? String(territoryRequestMatch[1]).toLowerCase().includes('true') : false,
    territory_address_candidates: territoryAddressCandidates,
    confidence: (confidenceMatch && !isNaN(Number(confidenceMatch[1]))) ? Number(confidenceMatch[1]) : 0.5,
    reason: 'quick_check_partial_json_recovered'
  };
}

function _quoteUnquotedJsonKeysSafely(jsonText) {
  const segments = jsonText.split(/("(?:\\.|[^"\\])*")/g);

  for (let i = 0; i < segments.length; i += 2) {
    segments[i] = segments[i]
      .replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
  }

  return segments.join('');
}
