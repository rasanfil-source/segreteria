/** Esegue cleanup delle etichette e aggiornamento atomico della memoria dopo l’invio.
 * Errori non critici restano best-effort; non richiama mai l’invio.
 * GAS: namespace globale sincrono; dipendenze esplicite, nessun caricatore runtime.
 */
var ThreadCompletion = {
  /** labels: ingressi locali espliciti; restituisce i dati della fase. */
  labels(deps, { thread, shouldLabelForReview, messageState, hasDocumentMismatch, validation, messageDetails }) {
    // Pulisci le etichette dello stato precedente in caso di risposta positiva
    try {
      if (deps.gmailService && typeof deps.gmailService.removeLabelFromThread === 'function') {
        deps.gmailService.removeLabelFromThread(thread, deps.config.errorLabelName);
      }
      if (!shouldLabelForReview) {
        if (deps.gmailService && typeof deps.gmailService.removeLabelFromThread === 'function') {
          deps.gmailService.removeLabelFromThread(thread, deps.config.validationErrorLabel);
        }
        if (deps.gmailService && typeof deps.gmailService.removeLabelFromMessage === 'function') {
          deps.gmailService.removeLabelFromMessage(messageState.candidate.getId(), deps.config.validationErrorLabel);
        }
      }
    } catch (cleanupError) {
      console.warn(`⚠️ Cleanup label stato precedente fallito: ${cleanupError.message}`);
    }

    // Etichettatura non critica: non deve compromettere lo step successivo (memoria).
    try {
      if (shouldLabelForReview || hasDocumentMismatch) {
        deps._addValidationErrorLabel(messageState.candidate, {
          reason: hasDocumentMismatch ? 'document_consistency_prudent_response' : 'validation_warning',
          validation: validation,
          subject: messageDetails.subject
        });
      }
    } catch (labelErr) {
      console.warn(`⚠️ Label di verifica non applicata (non bloccante): ${labelErr.message}`);
    }

    return {  };
  },
  /** memory: ingressi locali espliciti; restituisce i dati della fase. */
  memory(deps, {
    response, processingTimestamp, memoryContext, messageDetails, detectedLanguage, categoryHintSource,
    classification, requestTypeName, memoryContextualFlags, physicalPresenceConstraint, activeConcerns,
    requestType, quickCheck, threadId, threadLogger
  }) {
    const providedTopics = deps._detectProvidedTopics(response);

    const topicsWithObjects = providedTopics.map(topic => ({
      topic: topic,
      userReaction: 'unknown',
      context: null,
      timestamp: processingTimestamp.toISOString()
    }));

    const memorySummary = deps._buildMemorySummary({
      existingSummary: memoryContext.memorySummary || '',
      responseText: response,
      providedTopics: providedTopics,
      referenceDate: processingTimestamp
    });

    const inferredReactionData = (memoryContext.providedInfo && memoryContext.providedInfo.length > 0)
      ? deps._computeUserReaction(messageDetails.body, memoryContext.providedInfo)
      : null;

    const memoryUpdate = {
      language: detectedLanguage,
      category: categoryHintSource || classification.category || requestTypeName,
      _baseMemorySummary: memoryContext.memorySummary || '',
      _incrementMessageCount: true
    };
    const contextualFlagsUpdate = deps._deriveContextualFlagsUpdate_({
      existingFlags: memoryContextualFlags,
      physicalPresenceConstraint: physicalPresenceConstraint,
      activeConcerns: activeConcerns,
      classification: classification,
      requestType: requestType,
      categoryHintSource: categoryHintSource
    });
    if (Object.keys(contextualFlagsUpdate).length > 0) {
      memoryUpdate.contextualFlags = contextualFlagsUpdate;
    }

    const quickCheckTopic = quickCheck && quickCheck.classification
      ? (quickCheck.classification.topic || null)
      : null;
    memoryUpdate.conversationStateUpdate = {
      currentRelationalPosture: quickCheck?.relational_posture || 'direct',
      responseFocusHint: quickCheck?.response_focus_hint || null,
      responseFocusHintConfidence: Number(quickCheck?.response_focus_hint_confidence) || 0,
      appliesToTopic: quickCheckTopic,
      updatedAt: processingTimestamp.toISOString(),
      source: 'quick_check'
    };
    if (physicalPresenceConstraint.memoryState) {
      memoryUpdate.conversationStateUpdate.physicalPresenceState = physicalPresenceConstraint.memoryState;
    }

    if (memoryUpdate.conversationStateUpdate.responseFocusHint) {
      console.log(
        `   🧭 Stato thread: posture=${memoryUpdate.conversationStateUpdate.currentRelationalPosture}, ` +
        `hint=${memoryUpdate.conversationStateUpdate.responseFocusHint}, ` +
        `confidence=${memoryUpdate.conversationStateUpdate.responseFocusHintConfidence}, threadId=${threadId}`
      );
    }

    if (memorySummary) {
      memoryUpdate.memorySummary = memorySummary;
    }

    try {
      const memorySaved = deps.memoryService.updateMemoryAtomic(
        threadId,
        memoryUpdate,
        topicsWithObjects.length > 0 ? topicsWithObjects : null,
        inferredReactionData
      );

      if (!memorySaved) {
        threadLogger.warn('Persistenza memoria non confermata, ma risposta già gestita');
      }
    } catch (memoryError) {
      threadLogger.warn(`Persistenza memoria fallita, ma risposta già gestita: ${memoryError.message}`);
    }

    return {  };
  },
};
