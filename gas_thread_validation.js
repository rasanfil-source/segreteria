/** Valida e corregge la risposta preservando tentativi, modelli e confronto dei punteggi.
 * Le correzioni mantengono systemInstruction e contesto documentale della validazione.
 * GAS: namespace globale sincrono; dipendenze esplicite, nessun caricatore runtime.
 */
var ThreadValidation = {
  /** validate: ingressi locali espliciti; restituisce i dati della fase. */
  validate(deps, {
    response, messageDetails, detectedLanguage, shouldUseReceiptOnly, enrichedKnowledgeBase,
    routedAiCoreLite, routedAiCore, routedDoctrine, messageBodyForSemanticAnalysis,
    effectiveSalutationMode, validationRuntimeContext, fullPrompt, strategyUsedPlan, attemptStrategy,
    fallbackModelName, markFailureForCurrentBurst, result, effectiveSalutationModeKey
  }) {
    let finalResponse = deps._prepareOutboundResponse(response, messageDetails, detectedLanguage);
    let validation = null;
    let retryAttempted = false;
    let retryInfrastructureFailure = null;
    let retryPermanentApiFailure = null;
    let shouldLabelForReview = false;

    if (deps.config.validationEnabled && !shouldUseReceiptOnly) {
      const fullValidationKB = [
        enrichedKnowledgeBase,
        routedAiCoreLite,
        routedAiCore,
        routedDoctrine
      ].filter(Boolean).join('\n\n');
      validation = deps.validator.validateResponse(
        finalResponse,
        detectedLanguage,
        fullValidationKB,
        messageBodyForSemanticAnalysis,
        messageDetails.subject,
        effectiveSalutationMode,
        true,
        validationRuntimeContext
      );

      if (validation.fixedResponse) {
        console.log('   🩹 Usa risposta corretta automaticamente (Self-Healing)');
        finalResponse = validation.fixedResponse;
      }

      const retryConfig = (typeof CONFIG !== 'undefined' && CONFIG.INTELLIGENT_RETRY) ? CONFIG.INTELLIGENT_RETRY : null;
      const retryEnabled = retryConfig && retryConfig.enabled !== false;
      const parsedMaxRetries = retryConfig ? parseInt(retryConfig.maxRetries, 10) : NaN;
      const maxRetries = retryEnabled
        ? (Number.isFinite(parsedMaxRetries) && parsedMaxRetries >= 0 ? parsedMaxRetries : 1)
        : 0;

      let retryCount = 0;
      while (!validation.isValid && retryEnabled && retryCount < maxRetries && !deps._isNearDeadline(deps.config.maxExecutionTimeMs)) {
        const shouldRetry = deps._shouldAttemptIntelligentRetry(validation, detectedLanguage, retryConfig);
        if (!shouldRetry) break;

        retryAttempted = true;
        retryCount++;
        console.log(`🔄 Retry intelligente ${retryCount}/${maxRetries} (score: ${validation.score.toFixed(2)}, errori: ${validation.errors.length})`);

        const correctionPrompt = deps._buildCorrectionPrompt(
          fullPrompt,
          finalResponse,
          validation,
          detectedLanguage,
          effectiveSalutationMode,
          validationRuntimeContext
        );

        const correctionPlansData = ThreadValidation.correctionPlans(deps, { strategyUsedPlan, attemptStrategy, fallbackModelName });
        let { retryPlans } = correctionPlansData;
        // Il retry deve rigenerare con la stessa systemInstruction (persona,
        // pastoral firewall, vincoli di sicurezza, formato): senza di essa il
        // modello vede solo la risposta fallita e le istruzioni di correzione.
        const retryPayload = (fullPrompt && typeof fullPrompt === 'object' && fullPrompt.systemInstruction)
          ? { systemInstruction: fullPrompt.systemInstruction, prompt: correctionPrompt }
          : correctionPrompt;

        const regenerateData = ThreadValidation.regenerate(deps, {
          retryInfrastructureFailure, retryPermanentApiFailure, retryPlans, retryPayload
        });
        let { retryResponse } = regenerateData;
        ({ retryInfrastructureFailure, retryPermanentApiFailure } = regenerateData);
        if (!retryResponse) break;
        retryInfrastructureFailure = null;
        retryPermanentApiFailure = null;

        const parsedRetryResponse = deps._parseEmailResponse_(retryResponse);
        retryResponse = parsedRetryResponse.text;
        if (parsedRetryResponse.incomplete) {
          markFailureForCurrentBurst('validation', { reason: 'truncated_output' });
          result.status = 'validation_failed';
          result.reason = 'truncated_output';
          return { terminal: true };
        }
        // Validare anche il retry prima di rimuovere eventuali leak.
        retryResponse = deps._addTimeDiscrepancyNoteIfNeeded(
          retryResponse,
          { ...messageDetails, body: messageDetails.body || '' },
          detectedLanguage
        );
        retryResponse = deps._sanitizeUnrequestedSponsorGuidance_(
          retryResponse,
          messageDetails.subject,
          messageDetails.body,
          detectedLanguage
        );
        if (/^it/i.test(detectedLanguage || 'it')) {
          retryResponse = effectiveSalutationModeKey === 'full_warm'
            ? retryResponse.replace(/^(Carissimo|Carissima)\b/gm, 'Gentile')
            : retryResponse.replace(/^(Caro|Cara|Carissimo|Carissima)\b/gm, 'Gentile');
        } else if (/^pt/i.test(detectedLanguage || '')) {
          retryResponse = retryResponse.replace(/^(Caro|Cara)\b/gm, 'Prezado');
        }

        const preparedRetryResponse = deps._prepareOutboundResponse(
          retryResponse,
          messageDetails,
          detectedLanguage
        );

        const retryValidation = deps.validator.validateResponse(
          preparedRetryResponse,
          detectedLanguage,
          fullValidationKB,
          messageBodyForSemanticAnalysis,
          messageDetails.subject,
          effectiveSalutationMode,
          true,
          validationRuntimeContext
        );

        if (retryValidation.isValid) {
          console.log(`✅ Retry superato (score: ${retryValidation.score.toFixed(2)})`);
          finalResponse = retryValidation.fixedResponse || preparedRetryResponse;
          validation = retryValidation;
          break;
        }

        console.warn(
          `⚠️ Retry non sufficiente (score: ${retryValidation.score.toFixed(2)}). ` +
          `Errori residui: ${((retryValidation && Array.isArray(retryValidation.errors)) ? retryValidation.errors : []).join('; ')}`
        );
        if (retryValidation.score > validation.score) {
          console.log('   → Uso risposta del retry (score più alto, nonostante non valida)');
          finalResponse = retryValidation.fixedResponse || preparedRetryResponse;
          validation = retryValidation;
        } else {
          console.warn('   → Retry peggiorativo, mantengo la risposta originale migliore');
        }
      }

      if (!validation.isValid) {
        if (retryInfrastructureFailure) {
          const retryFailure = retryInfrastructureFailure;
          console.warn('   ↻ Correzione non completata per indisponibilità transitoria Gemini: nessuna label terminale applicata.');
          result.status = 'error';
          result.reason = 'intelligent_retry_transient_failure';
          result.error = String(retryFailure.error && retryFailure.error.message ? retryFailure.error.message : retryFailure.error);
          result.errorClass = retryFailure.classification.type;
          result.retryable = true;
          result.retryDelayMs = Number(retryFailure.error && retryFailure.error.retryAfterMs) || 60000;
          return { terminal: true };
        }

        if (retryPermanentApiFailure) {
          const retryFailure = retryPermanentApiFailure;
          console.warn('   🛑 Correzione interrotta per errore API definitivo: applico la gestione Errore, non Verifica.');
          markFailureForCurrentBurst('error');
          result.status = 'error';
          result.reason = 'intelligent_retry_permanent_api_failure';
          result.error = String(retryFailure.error && retryFailure.error.message ? retryFailure.error.message : retryFailure.error);
          result.errorClass = retryFailure.classification.type;
          result.retryable = false;
          return { terminal: true };
        }

        const retryNote = retryAttempted ? ' (dopo retry)' : '';
        console.warn(`   🛑 Validazione FALLITA${retryNote} (punteggio: ${validation.score.toFixed(2)})`);

        if (validation.details && validation.details.exposedReasoning && validation.details.exposedReasoning.score === 0.0) {
          console.warn("⚠️ Risposta bloccata per Thinking Leak. Invio a etichetta 'Verifica'.");
          result.reason = 'thinking_leak';
        }

        const validationReason = result.reason || validation.reasonCode || 'validation_score_below_threshold';
        markFailureForCurrentBurst('validation', {
          reason: validationReason,
          validation: validation,
          subject: messageDetails.subject
        });
        result.status = 'validation_failed';
        result.validationFailed = true;
        if (!result.reason) {
          result.reason = validationReason;
        }
        return { terminal: true };
      }

      const configuredWarningThreshold = Number(deps.config.validationWarningThreshold);
      const warningThreshold = Number.isFinite(configuredWarningThreshold)
        ? ((typeof normalizeValidationScore === 'function')
          ? normalizeValidationScore(configuredWarningThreshold)
          : Math.max(0, Math.min(1, configuredWarningThreshold > 1 ? configuredWarningThreshold / 100 : configuredWarningThreshold)))
        : 0.90;
      shouldLabelForReview =
        validation.warnings && validation.warnings.length > 0 && validation.score < warningThreshold;

      if (shouldLabelForReview) {
        console.log(`   ⚠️ Label '${deps.config.validationErrorLabel}' rinviata a dopo invio riuscito`);
      } else if (validation.warnings && validation.warnings.length > 0) {
        console.log(`   ℹ️ Validazione: Punteggio alto (${validation.score.toFixed(2)}). Warning ignorati: ${validation.warnings.join(', ')}`);
      }

      // L'eventuale testo perfezionato è già stato applicato in fase di validazione.

      console.log(`   ✓ Validazione PASSATA (punteggio: ${validation.score.toFixed(2)})`);
    }

    response = finalResponse;

    return { validation, shouldLabelForReview, response };
  },
  /** correctionPlans: returns retryPlans; preserves the caller's service-effect order. */
  correctionPlans(deps, { strategyUsedPlan, attemptStrategy, fallbackModelName }) {
    const retryPlan = strategyUsedPlan || attemptStrategy.find(p => p && p.key) || {
      key: deps.geminiService.primaryKey,
      model: fallbackModelName,
      skipRateLimit: false
    };

    // Dopo un 503/high-demand privilegia un modello fisico differente, non
    // un secondo tentativo identico. Le strategie con lo stesso modello
    // restano in coda solo come ultima risorsa (per esempio su backup key).
    const retryPlanKey = (plan) => `${String(plan && plan.key || '')}|${String(plan && plan.model || '')}`;
    const alternativePlans = attemptStrategy.filter(plan => plan && plan.key && retryPlanKey(plan) !== retryPlanKey(retryPlan));
    const retryPlans = [
      retryPlan,
      ...alternativePlans.filter(plan => String(plan.model || '') !== String(retryPlan.model || '')),
      ...alternativePlans.filter(plan => String(plan.model || '') === String(retryPlan.model || ''))
    ].filter((plan, index, plans) => plans.findIndex(candidatePlan => retryPlanKey(candidatePlan) === retryPlanKey(plan)) === index);
    return { retryPlans };
  },
  /** regenerate: returns retryResponse, retryInfrastructureFailure, retryPermanentApiFailure; preserves the caller's service-effect order. */
  regenerate(deps, { retryInfrastructureFailure, retryPermanentApiFailure, retryPlans, retryPayload }) {
    let retryResponse = null;
    retryInfrastructureFailure = null;
    retryPermanentApiFailure = null;
    for (let retryPlanIndex = 0; retryPlanIndex < retryPlans.length; retryPlanIndex++) {
      const currentRetryPlan = retryPlans[retryPlanIndex];
      if (deps._isNearDeadline(deps.config.maxExecutionTimeMs)) {
        console.warn('   ⏱️ Deadline vicina: interrompo la catena di retry.');
        break;
      }
      try {
        console.log(`   ↻ Correzione con modello: ${currentRetryPlan.model || 'default'}`);
        const retryResult = deps.geminiService.generateResponse(retryPayload, {
          apiKey: currentRetryPlan.key,
          modelName: currentRetryPlan.model,
          skipRateLimit: currentRetryPlan.skipRateLimit
        });

        if (retryResult && typeof retryResult === 'object') {
          if (!retryResult.text && retryResult.success) {
            console.warn('⚠️ Retry: Gemini ha restituito successo senza testo');
          }
          retryResponse = retryResult.text;
        } else if (typeof retryResult === 'string') {
          retryResponse = retryResult;
        }
        if (retryResponse) break;
      } catch (retryError) {
        const retryErrorClass = deps._classifyError(retryError);
        const isTransientRetryError = retryErrorClass.retryable === true || retryError.isTransient === true;
        console.warn(`⚠️ Retry fallito per errore API: ${retryError.message} [${retryErrorClass.type}]`);
        if (isTransientRetryError) {
          retryInfrastructureFailure = { error: retryError, classification: retryErrorClass };
          const hasNextRetryPlan = retryPlanIndex < retryPlans.length - 1;
          if (hasNextRetryPlan) {
            console.warn('   ↪️ Errore transitorio: provo il modello di riserva prima di rinviare il messaggio.');
            continue;
          }
        } else {
          retryInfrastructureFailure = null;
          retryPermanentApiFailure = { error: retryError, classification: retryErrorClass };
        }
        break;
      }
    }
    return { retryResponse, retryInfrastructureFailure, retryPermanentApiFailure };
  },
};
