/** Costruisce contesto temporale, territoriale, relazionale e opzioni del prompt.
 * Il profilo e il routing definitivi sono calcolati dopo gli esiti OCR. Nessun invio.
 * GAS: namespace globale sincrono; dipendenze esplicite, nessun caricatore runtime.
 */
var ThreadContext = {
  /** knowledge: ingressi locali espliciti; restituisce i dati della fase. */
  knowledge(deps, { normalizedDoctrineBase, normalizedKnowledgeBase }) {
    const knowledgeSections = [];
    const resourceCache = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE) ? GLOBAL_CACHE : {};
    const effectiveDoctrineBase = normalizedDoctrineBase || (resourceCache.doctrineBase || '');
    const doctrineStructured = Array.isArray(resourceCache.doctrineStructured) ? resourceCache.doctrineStructured : [];
    const aiCoreLite = (resourceCache.aiCoreLite != null) ? resourceCache.aiCoreLite : '';
    const aiCore = (resourceCache.aiCore != null) ? resourceCache.aiCore : '';

    // Inclusione della Knowledge Base testuale per il PromptEngine.
    knowledgeSections.push(normalizedKnowledgeBase);

    // PromptEngine gestisce l'integrazione selettiva di AI_CORE e Dottrina.

    // Placeholder: eventuali regole calendario speciali possono essere
    // iniettate qui quando verrà implementato un provider dedicato.

    const enrichedKnowledgeBase = knowledgeSections.filter(Boolean).join('\n\n');

    return { effectiveDoctrineBase, doctrineStructured, aiCoreLite, aiCore, enrichedKnowledgeBase };
  },
  /** conversation: ingressi locali espliciti; restituisce i dati della fase. */
  conversation(deps, {
    messages, candidate, responseContextMessageIds, myEmail, gmailAliases, memoryContext,
    isReplyBySubject, hasPriorOwnMessage, ownConversationAnchor, processingTimestamp, messageDetails
  }) {
    let conversationHistory = '';
    if (messages.length > 1) {
      const candidateId = candidate.getId();
      const responseContextIdsForHistory = new Set(responseContextMessageIds || []);
      if (candidateId) responseContextIdsForHistory.add(candidateId);
      const historyMessages = messages.filter(m => !responseContextIdsForHistory.has(m.getId()));

      if (historyMessages.length > 0) {
        const historyLimit = deps.config.maxHistoryMessages || 10;
        conversationHistory = deps.gmailService.getThreadHistory(
          historyMessages,
          historyLimit,
          myEmail,
          gmailAliases
        );
      }
    }

    // ====================================================================
    // STEP 6.5: CONTESTO MEMORIA
    // ====================================================================
    if (memoryContext.lastUpdated) {
      console.log(`   🧠 Memoria trovata: lang=${memoryContext.language || 'n/a'}, topics=${(memoryContext.providedInfo || []).length}`);
    }

    // ====================================================================
    // STEP 6.6: CALCOLO DINAMICO SALUTO E RITARDO
    // ====================================================================

    const salutationMode = computeSalutationMode({
      isReply: isReplyBySubject || hasPriorOwnMessage,
      memoryExists: Boolean(ownConversationAnchor.lastMessageDate || memoryContext.lastUpdated),
      lastUpdated: ownConversationAnchor.lastMessageDate || memoryContext.lastUpdated || null,
      now: processingTimestamp
    });
    console.log(`   📊 Modalità saluto: ${salutationMode}`);

    const responseDelay = computeResponseDelay({
      messageDate: messageDetails.date,
      now: processingTimestamp
    });
    if (responseDelay.shouldApologize) {
      console.log(`   🕐 Ritardo risposta: ${responseDelay.days} giorni`);
    }

    return { conversationHistory, salutationMode, responseDelay };
  },
  /** territory: ingressi locali espliciti; restituisce i dati della fase. */
  territory(deps, { messageDetails, quickCheck, requestType, bodyForLanguageDetection }) {
    const territoryRequested = deps._isTerritoryRequest(
      messageDetails.subject,
      messageDetails.body,
      quickCheck?.classification || {}, // Usa classificazione Gemini evitando errori se null.
      requestType
    );
    const quickCheckTerritoryCandidates = deps._extractQuickCheckTerritoryCandidates_(quickCheck);

    let territoryResult = { addressFound: false };
    if (territoryRequested && deps.territoryValidator) {
      try {
        const bodyForTerritory = bodyForLanguageDetection || messageDetails.body;
        territoryResult = deps.territoryValidator.analyzeEmailForAddress(
          bodyForTerritory,
          messageDetails.subject
        ) || { addressFound: false };
        if (!territoryResult.addressFound) {
          territoryResult = deps._analyzeAiTerritoryCandidates_(quickCheckTerritoryCandidates) || territoryResult;
        }
      } catch (territoryError) {
        console.warn(`⚠️ Verifica territorio fallita: ${territoryError.message}`);
        territoryResult = { addressFound: false };
      }
    }

    const addressLines = territoryResult.addressFound
      ? (territoryResult.addresses || []).map((entry) => {
        const v = entry.verification || {};
        const sanitizedStreet = (entry.street || '').replace(/[=─]/g, '-');
        const civicLabel = entry.civic ? `n. ${entry.civic}` : 'senza numero civico';
        const resultLabel = v.needsCivic
          ? '⚠️ CIVICO NECESSARIO'
          : (v.inParish ? '✅ RIENTRA' : '❌ NON RIENTRA');
        const actionLabel = v.needsCivic ? 'Azione: richiedere il numero civico.' : null;
        return [
          `Indirizzo: ${sanitizedStreet} ${civicLabel}`,
          `Risultato: ${resultLabel}`,
          `Dettaglio: ${v.reason || 'Nessun dettaglio disponibile'}`,
          actionLabel
        ].filter(Boolean).join('\n');
      })
      : ['Nessun indirizzo rilevato nel testo.'];

    const territoryContext = territoryRequested
      ? `
 ====================================================================
🎯 VERIFICA TERRITORIO AUTOMATICA
 ====================================================================
${addressLines.join('\n\n')}
 ====================================================================
`
      : null;

    if (territoryRequested) {
      const summary = territoryResult.addressFound
        ? (addressLines.length > 1 ? `${addressLines.length} indirizzi` : (addressLines.length === 1 ? '1 indirizzo' : 'nessun indirizzo valido'))
        : 'nessun indirizzo';
      console.log(`   🎯 Verifica territorio: ${summary}`);
    } else {
      console.log('   ⊖ Verifica territorio non richiesta: controllo saltato');
    }

    return { territoryRequested, quickCheckTerritoryCandidates, territoryResult, territoryContext };
  },
  /** runtime: ingressi locali espliciti; restituisce i dati della fase. */
  runtime(deps, {
    messageDetails, processingTimestamp, routedAiCoreLite, routedAiCore, enrichedKnowledgeBase,
    routedDoctrine, detectedLanguage, physicalPresenceConstraint, territoryContext, activeConcerns,
    concernSynthesis, continuityCase, responseMode, operationalConstraints, continuityPolicy,
    responseRegister, promptProfile, categoryHintSource, classification, requestTypeName, requestPurpose,
    conversationHistory
  }) {
    const baseRuntimeContext = deps._buildRuntimeContext_(
      messageDetails,
      processingTimestamp,
      [routedAiCoreLite, routedAiCore, enrichedKnowledgeBase, routedDoctrine].filter(Boolean).join('\n')
    );
    const runtimeContext = Object.freeze(Object.assign({}, baseRuntimeContext, {
      sacramentalDeadlineContext: deps._extractSacramentalDeadlineContext_(
        messageDetails.subject, messageDetails.body, detectedLanguage, baseRuntimeContext.temporal),
      physicalPresenceConstraint: physicalPresenceConstraint || null,
      territoryContext: territoryContext || null,
      validationContext: deps._buildResponseValidationContext_({
        activeConcerns: activeConcerns,
        concernSynthesis: concernSynthesis,
        continuityCase: continuityCase,
        responseMode: responseMode,
        operationalConstraints: operationalConstraints,
        continuityPolicy: continuityPolicy,
        responseRegister: responseRegister,
        promptProfile: promptProfile,
        category: categoryHintSource || classification.category || null,
        requestType: requestTypeName || null,
        requestPurpose: requestPurpose,
        conversationHistory: conversationHistory
      })
    }));
    const scheduleContext = deps._resolveScheduleContext(
      `${messageDetails.subject || ''}\n${messageDetails.body || ''}`,
      enrichedKnowledgeBase,
      runtimeContext.temporal,
      detectedLanguage,
      runtimeContext.temporal.currentDate
    );

    return { runtimeContext, scheduleContext };
  },
  /** responseRouting: ingressi locali espliciti; restituisce i dati della fase. */
  responseRouting(deps, {
    quickCheck, memoryContext, processingTimestamp, categoryHintSource, requestTypeName, requestType,
    physicalPresenceConstraint, threadId
  }) {
    const allowedResponseStrategies = new Set([
      'provide_information',
      'reduce_user_effort',
      'confirm_receipt',
      'guide_next_step',
      'offer_reassurance',
      'clarify_requirements',
      'none'
    ]);
    const rawResponseStrategy = String(quickCheck.response_strategy || 'none').trim().toLowerCase();
    const responseStrategyConfidence = Number(quickCheck.response_strategy_confidence) || 0;
    const normalizedRelationalPosture = deps._normalizeRelationalPostureAlias_(quickCheck.relational_posture);
    const classifiedResponseStrategy = (
      allowedResponseStrategies.has(rawResponseStrategy) &&
      responseStrategyConfidence >= 0.65
    ) ? rawResponseStrategy : 'none';
    const hasGoalContinuitySignalForResponseStrategy = Boolean(
      quickCheck.goal_continuity &&
      String(quickCheck.goal_continuity || 'none').trim().toLowerCase() !== 'none' &&
      (Number(quickCheck.goal_continuity_confidence) || 0) >= 0.65
    );
    const responseFocusHintState = memoryContext && memoryContext.conversationState
      ? memoryContext.conversationState
      : null;
    const hasResponseFocusHintSignalForResponseStrategy = isResponseFocusApplicable_(
      responseFocusHintState,
      quickCheck.classification ? quickCheck.classification.topic : '',
      processingTimestamp
    );
    const hasStrongerResponseRoutingSignal = hasStrongerResponseRoutingSignal_(
      categoryHintSource, requestTypeName, requestType && requestType.isSbattezzo === true,
      physicalPresenceConstraint && physicalPresenceConstraint.has_constraint,
      hasGoalContinuitySignalForResponseStrategy,
      hasResponseFocusHintSignalForResponseStrategy
    );
    const responseStrategy = classifiedResponseStrategy !== 'none'
      ? classifiedResponseStrategy
      : (!hasStrongerResponseRoutingSignal ? mapRelationalPostureToResponseStrategy_(normalizedRelationalPosture) : 'none');
    if (responseStrategy !== 'none') {
      console.log(`   🧭 Response strategy: ${responseStrategy}, confidence=${responseStrategyConfidence}, threadId=${threadId}`);
    }

    const rawGoalContinuity = String(quickCheck.goal_continuity || 'none').trim().toLowerCase();
    const goalContinuityConfidence = Number(quickCheck.goal_continuity_confidence) || 0;
    const allowedGoalContinuity = new Set(['none', 'maintain_goal_continuity', 'goal_completed']);
    const goalContinuity = (allowedGoalContinuity.has(rawGoalContinuity) && goalContinuityConfidence >= 0.65)
      ? rawGoalContinuity
      : 'none';
    if (goalContinuity !== 'none') {
      console.log(`   🔗 Goal continuity: ${goalContinuity}, confidence=${goalContinuityConfidence}, threadId=${threadId}`);
    }

    return {
      normalizedRelationalPosture, hasStrongerResponseRoutingSignal, responseStrategy,
      goalContinuityConfidence, goalContinuity
    };
  },
  /** promptOptions: ingressi locali espliciti; restituisce i dati della fase. */
  promptOptions(deps, {
    runtimeContext, messageDetails, enrichedKnowledgeBase, conversationHistory, categoryHintSource,
    quickCheck, detectedLanguage, scheduleContext, greeting, closing, classification, memoryContext,
    effectiveSalutationMode, responseDelay, promptProfile, activeConcerns, concernSynthesis,
    continuityCase, responseMode, operationalConstraints, continuityPolicy, responseRegister,
    territoryContext, physicalPresenceConstraint, attachmentIntentContext, normalizedRelationalPosture,
    responseStrategy, requestPurpose, hasStrongerResponseRoutingSignal, goalContinuity,
    goalContinuityConfidence, requestType, physicalAttachmentsDetected, textFromAttachments,
    hasExpectedDocumentMissing, bodyContainsUsableDocumentContent, systemDirectives, routedAiCoreLite,
    routedAiCore, routedDoctrine, routedDoctrineStructured
  }) {
    const promptOptions = {
      runtimeContext: runtimeContext,
      emailContent: messageDetails.body,
      emailSubject: messageDetails.subject,
      knowledgeBase: enrichedKnowledgeBase,
      senderName: messageDetails.senderName,
      senderEmail: messageDetails.senderEmail,
      conversationHistory: conversationHistory,
      category: categoryHintSource,
      topic: quickCheck.classification ? quickCheck.classification.topic : '',
      detectedLanguage: detectedLanguage,
      currentSeason: scheduleContext.season,
      currentDate: runtimeContext.temporal.currentDate,
      currentTime: runtimeContext.temporal.currentTime,
      messageDate: runtimeContext.temporal.messageDate,
      scheduleContext: scheduleContext,
      salutation: greeting,
      closing: closing,
      subIntents: classification.subIntents || {},
      memoryContext: memoryContext,
      salutationMode: effectiveSalutationMode,
      responseDelay: responseDelay,
      promptProfile: promptProfile,
      activeConcerns: activeConcerns,
      concernSynthesis: concernSynthesis,
      continuityCase: continuityCase,
      responseMode: responseMode,
      operationalConstraints: operationalConstraints,
      continuityPolicy: continuityPolicy,
      responseRegister: responseRegister,
      territoryContext: territoryContext,
      physicalPresenceConstraint: physicalPresenceConstraint,
      sponsorGuidancePolicy: deps._deriveSponsorGuidancePolicy_(messageDetails.subject, messageDetails.body, attachmentIntentContext, quickCheck.needs_sponsor_guidance, detectedLanguage, conversationHistory),
      sacramentalDeadlineContext: runtimeContext.sacramentalDeadlineContext,
      relationalPosture: normalizedRelationalPosture,
      conversationShift: {
        shift: quickCheck?.conversation_shift || 'none',
        confidence: Number(quickCheck?.conversation_shift_confidence) || 0
      },
      responseStrategy: responseStrategy,
      requestPurpose: requestPurpose,
      responseStrategyInferenceBlocked: hasStrongerResponseRoutingSignal,
      newInformationProvided: Array.isArray(quickCheck.new_information_provided)
        ? quickCheck.new_information_provided
        : [],
      goalContinuity: {
        value: goalContinuity,
        confidence: goalContinuityConfidence
      },
      requestType: requestType,
      attachmentsContext: physicalAttachmentsDetected
        ? textFromAttachments
        : (hasExpectedDocumentMissing
          ? "ATTENZIONE: il documento atteso non è disponibile: non risultano allegati fisici né dati compilati utilizzabili nel corpo del messaggio."
          : (bodyContainsUsableDocumentContent
            ? "ATTENZIONE: il documento/la scheda è riportato nel corpo del messaggio come dati compilati utilizzabili; non parlare di allegato."
            : (attachmentIntentContext
              ? "ATTENZIONE: L'utente NON ha inviato allegati fisici. Ha fornito solo dati nel testo. NON usare formule come 'ricezione della documentazione'. Rispondi direttamente alla richiesta operativa."
              : ''))),
      attachmentIntentContext: attachmentIntentContext
        ? Object.assign({}, attachmentIntentContext, {
          hasPhysicalAttachments: physicalAttachmentsDetected,
          bodyContainsUsableDocumentContent: bodyContainsUsableDocumentContent,
          hasExpectedDocumentMissing: hasExpectedDocumentMissing
        })
        : null,
      systemDirectives: systemDirectives,
      aiCoreLite: routedAiCoreLite,
      aiCore: routedAiCore,
      doctrineBase: routedDoctrine,
      doctrineStructured: routedDoctrineStructured
    };

    return { promptOptions };
  },
  /** profileDefaults: ingressi locali espliciti; restituisce i dati della fase. */
  profileDefaults(deps, { salutationMode, memoryContext }) {
    let promptProfile = 'standard';
    let activeConcerns = {};
    let responseRegister = 'warm_institutional';
    let crisisCritical = false;
    let effectiveSalutationMode = salutationMode;
    let concernSynthesis = null;
    let continuityCase = null;
    let responseMode = 'standard_operational';
    let operationalConstraints = [];
    let continuityPolicy = null;
    const memoryProvidedInfo = Array.isArray(memoryContext.providedInfo)
      ? memoryContext.providedInfo
      : [];
    const memoryTopics = memoryProvidedInfo
      .map((item) => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        return item.topic || item.title || item.category || item.summary || item.detail || '';
      })
      .filter(Boolean)
      .slice(0, 12);

    return {
      promptProfile, activeConcerns, responseRegister, crisisCritical, effectiveSalutationMode,
      concernSynthesis, continuityCase, responseMode, operationalConstraints, continuityPolicy,
      memoryProvidedInfo, memoryTopics
    };
  },
  /** profile: ingressi locali espliciti; restituisce i dati della fase. */
  profile(deps, {
    categoryHintSource, classification, safeSubject, messageDetails, isReplyBySubject,
    hasPriorOwnMessage, detectedLanguage, requestType, memoryContext, memoryProvidedInfo, memoryTopics,
    memoryContextualFlags, memoryMessageCount, territoryResult, enrichedKnowledgeBase,
    messageBodyForSemanticAnalysis, salutationMode, physicalPresenceConstraint, quickCheck,
    requestPurpose, promptProfile, activeConcerns, responseRegister, crisisCritical,
    effectiveSalutationMode, concernSynthesis, continuityCase, responseMode, operationalConstraints,
    continuityPolicy, threadLogger, threadId, messageState, result, startTime
  }) {
    // PromptContext deve vedere la categoria definitiva: gli allegati OCR
    // possono trasformare una richiesta apparentemente tecnica in contesto
    // formale/sacramentale e cambiare profilo, concern e registro.
    if (typeof createPromptContext === 'function') {
      const promptContextCategory = String(categoryHintSource || classification.category || '').toLowerCase() || null;
      const promptContext = createPromptContext({
        email: {
          subject: safeSubject,
          body: messageDetails.body,
          isReply: isReplyBySubject || hasPriorOwnMessage,
          detectedLanguage: detectedLanguage
        },
        classification: {
          category: promptContextCategory,
          subIntents: classification.subIntents || {},
          confidence: classification.confidence || 0.8
        },
        requestType: requestType,
        memory: {
          exists: hasMeaningfulMemoryContext_(memoryContext),
          providedInfoCount: memoryProvidedInfo.length,
          lastUpdated: memoryContext.lastUpdated || null,
          category: memoryContext.category || null,
          memorySummary: memoryContext.memorySummary || '',
          topics: memoryTopics,
          contextualFlags: memoryContextualFlags,
          conversationState: memoryContext.conversationState || null
        },
        conversation: { messageCount: memoryMessageCount },
        territory: { addressFound: territoryResult.addressFound },
        knowledgeBase: enrichedKnowledgeBase,
        knowledgeBaseMeta: {
          length: enrichedKnowledgeBase.length,
          containsDates: /\b(19|20)\d{2}\b/.test(enrichedKnowledgeBase)
        },
        temporal: {
          mentionsDates: deps._detectTemporalMentions(messageBodyForSemanticAnalysis, detectedLanguage) || /\b\d{1,2}\/\d{1,2}\b/.test(messageBodyForSemanticAnalysis),
          mentionsTimes: /\d{1,2}[:.]\d{2}/.test(messageBodyForSemanticAnalysis)
        },
        salutationMode: salutationMode,
        physicalPresenceConstraint: physicalPresenceConstraint,
        relationalPosture: quickCheck?.relational_posture,
        relationalPostureConfidence: quickCheck?.relational_posture_confidence,
        quickCheck: {
          relational_posture: quickCheck?.relational_posture,
          relational_posture_confidence: quickCheck?.relational_posture_confidence,
          request_purpose: requestPurpose.type,
          request_purpose_confidence: requestPurpose.confidence
        }
      });
      promptProfile = promptContext.profile;
      activeConcerns = promptContext.concerns;
      responseRegister = promptContext.meta?.responseRegister || responseRegister;
      crisisCritical = promptContext.meta?.crisisCritical === true;
      effectiveSalutationMode = promptContext.meta?.salutationMode || effectiveSalutationMode;
      concernSynthesis = promptContext.meta?.concernSynthesis || null;
      continuityCase = promptContext.meta?.continuityCase || null;
      responseMode = promptContext.meta?.responseMode || responseMode;
      operationalConstraints = Array.isArray(promptContext.meta?.operationalConstraints)
        ? promptContext.meta.operationalConstraints
        : [];
      continuityPolicy = promptContext.meta?.continuityPolicy || null;
      const synthesisLog = concernSynthesis && concernSynthesis.key
        ? `, sintesi=${concernSynthesis.key}`
        : '';
      const continuityLog = continuityCase && continuityCase.key
        ? `, continuità=${continuityCase.key}`
        : '';
      console.log(`   🧠 PromptContext: profilo=${promptProfile}, registro=${responseRegister}, modalità=${responseMode}${synthesisLog}${continuityLog}`);
    }

    // Presa in carico prima della generazione: errori del modello non devono
    // impedire la revisione umana del segnale critico.
    const crisisHumanReviewEnabled = !(typeof CONFIG !== 'undefined' && CONFIG && CONFIG.CRISIS_HUMAN_REVIEW === false);
    if (crisisHumanReviewEnabled && crisisCritical === true) {
      console.warn('   🆘 Segnale di crisi rilevato: nessun invio automatico, richiesta presa in carico umana.');
      threadLogger.error('Crisi pastorale rilevata: intervento umano richiesto', {
        event: 'pastoral_crisis_human_review',
        threadId: threadId,
        messageId: messageState.candidate.getId()
      });
      messageState.markFailureForCurrentBurst('validation', {
        reason: 'pastoral_crisis_human_review',
        subject: messageDetails.subject,
        bypassThrottle: true
      });
      result.status = 'validation_failed';
      result.validationFailed = true;
      result.reason = 'pastoral_crisis_human_review';
      result.durationMs = Date.now() - startTime;
      return { terminal: true };
    }

    return {
      promptProfile, activeConcerns, responseRegister, crisisCritical, effectiveSalutationMode,
      concernSynthesis, continuityCase, responseMode, operationalConstraints, continuityPolicy
    };
  },
  /** routeKnowledge: ingressi locali espliciti; restituisce i dati della fase. */
  routeKnowledge(deps, {
    effectiveSalutationMode, greeting, closing, activeConcerns, memoryContext, categoryHintSource,
    routedAiCoreLite, routedAiCore, routedDoctrine, routedDoctrineStructured, buildRuleContext, result,
    territoryRequested, quickCheckTerritoryCandidates, isCertRequest, requestPurpose
  }) {
    const effectiveSalutationModeKey = String(effectiveSalutationMode || '').trim().toLowerCase();
    const shouldSuppressRitualGreeting = (
      effectiveSalutationModeKey === 'none_or_continuity' ||
      effectiveSalutationModeKey === 'session' ||
      effectiveSalutationModeKey === 'soft'
    );
    if (shouldSuppressRitualGreeting) {
      greeting = '';
      if (effectiveSalutationModeKey !== 'soft') {
        closing = '';
      }
    }

    const concernFlags = activeConcerns && typeof activeConcerns === 'object'
      ? activeConcerns
      : {};
    const memoryCategory = memoryContext && memoryContext.category
      ? String(memoryContext.category).toLowerCase()
      : '';
    const memoryPastoralCategories = ['pastoral', 'doctrinal', 'formal', 'sacrament', 'sacramento'];
    const hasMemoryPastoralContext = memoryPastoralCategories.some((category) =>
      memoryCategory.includes(category)
    );
    const hasPastoralConcern = Boolean(
      concernFlags.emotional_sensitivity ||
      concernFlags.discernment_risk ||
      concernFlags.longitudinal_sensitivity ||
      concernFlags.pastoral_technical_blend ||
      concernFlags.relational_warmth ||
      concernFlags.physical_presence_constraint ||
      hasMemoryPastoralContext
    );

    // ====================================================================
    // CONTEXT ROUTING post-OCR (definitivo)
    // ====================================================================
    const isTechnicalOnly = TECHNICAL_CONTEXT_ROUTING_CATEGORIES.has(categoryHintSource) && (
      !hasPastoralConcern ||
      categoryHintSource === 'document_request' ||
      categoryHintSource === 'document_submission'
    );
    const routingState = {
      routedAiCoreLite: routedAiCoreLite,
      routedAiCore: routedAiCore,
      routedDoctrine: routedDoctrine,
      routedDoctrineStructured: routedDoctrineStructured
    };
    const routingContext = buildRuleContext({
      phase: 'context_routing',
      state: routingState,
      categoryHintSource: categoryHintSource,
      hasPastoralConcern: hasPastoralConcern,
      isTechnicalOnly: isTechnicalOnly
    });
    const routingDecision = deps._evaluatePreAiRules_(routingContext);
    deps._applyPreAiRuleDecision_(routingDecision, routingContext, result);
    routedAiCoreLite = routingState.routedAiCoreLite;
    routedAiCore = routingState.routedAiCore;
    const systemDirectives = [];
    const pastoralFirewall = "DIVIETO DI DEROGA (CROSS-CONTAMINATION): I principi pastorali non possono MAI modificare, derogare o rendere flessibili le procedure, le date o i requisiti tecnici indicati nella Knowledge Base. Non introdurre percorsi personalizzati o eccezioni non autorizzati dalla Knowledge Base; quando la Knowledge Base li prevede, non negarli né restringerli con limiti non espliciti.";
    if (routedAiCore || routedAiCoreLite) systemDirectives.push(pastoralFirewall);
    routedDoctrine = routingState.routedDoctrine;
    routedDoctrineStructured = routingState.routedDoctrineStructured;

    if (!territoryRequested && quickCheckTerritoryCandidates.length > 0) {
      systemDirectives.push(
        "Il messaggio contiene un possibile riferimento di luogo o indirizzo, ma non è stata richiesta una verifica territoriale esplicita: non dedurre competenza parrocchiale senza verifica."
      );
    }

    const certificateDirective = deps._buildCertificateSystemDirective_(isCertRequest, requestPurpose);
    if (certificateDirective) systemDirectives.push(certificateDirective);

    return {
      effectiveSalutationModeKey, systemDirectives, greeting, closing, routedAiCoreLite, routedAiCore,
      routedDoctrine, routedDoctrineStructured
    };
  },
};
