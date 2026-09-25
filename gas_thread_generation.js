/** Esegue le strategie di generazione esistenti e prepara il testo da validare.
 * Preserva fallback, quote, NO_REPLY, guardrail di ricezione e ordine delle trasformazioni.
 * GAS: namespace globale sincrono; dipendenze esplicite, nessun caricatore runtime.
 */
var ThreadGeneration = {
  /** generate: ingressi locali espliciti; restituisce i dati della fase. */
  generate(deps, {
    result, shouldUseReceiptOnly, detectedLanguage, categoryHintSource, receiptOnlyDeliveryChannel,
    messageDetails, hasRiskyUnknownReceived, fullPrompt, attachmentBlobs, quickCheck,
    markFailureForCurrentBurst
  }) {
    let response = null;
    let generationError = null;
    let initialError = null;
    let strategyUsed = null;
    let strategyUsedPlan = null;

    if (deps._isNearDeadline(deps.config.maxExecutionTimeMs)) {
      console.warn('⏳ Tempo residuo insufficiente prima della generazione AI: rimando il thread al prossimo turno.');
      result.status = 'dilata';
      result.reason = 'near_deadline_before_generation';
      result.retryDelayMs = 60000;
      return { terminal: true };
    }

    const generationPlan = deps._buildGenerationStrategies_(deps.geminiService, {
      warn: (message) => console.warn(message)
    });
    const attemptStrategy = Array.isArray(generationPlan.attemptStrategy)
      ? generationPlan.attemptStrategy
      : [];
    const fallbackModelName = generationPlan.fallbackModelName || 'gemini-3.7-flash';

    if (shouldUseReceiptOnly) {
      response = deps._buildReceiptOnlySubmissionResponse_(
        detectedLanguage,
        categoryHintSource,
        receiptOnlyDeliveryChannel,
        { senderName: messageDetails.senderName }
      );
      strategyUsed = hasRiskyUnknownReceived
        ? 'DocumentConsistency-UnknownReceivedReceiptOnly'
        : 'Submission-ReceiptOnlyGuardrail';
      console.log(`✅ Risposta di sola ricezione generata (${strategyUsed})`);
    } else {
      for (const plan of attemptStrategy) {
        if (!plan.key) continue;
        if (!plan.usesBackupKey && deps.geminiService && deps.geminiService.isPrimaryExhausted) {
          console.warn(`↪️ Strategia '${plan.name}' saltata: chiave primaria già esaurita.`);
          continue;
        }

        try {
          console.log(`🔄 Tentativo Generazione: ${plan.name}...`);

          response = deps.geminiService.generateResponse(fullPrompt, {
            apiKey: plan.key,
            modelName: plan.model,
            skipRateLimit: plan.skipRateLimit,
            attachments: attachmentBlobs
          });

          if (response && typeof response === 'object') {
            if (!response.text && response.success) {
              console.warn(`⚠️ Gemini ha restituito successo senza testo (${plan.name})`);
            }
            response = response.text;
          }

          if (
            deps._isNoReplyToken_(response) &&
            quickCheck &&
            quickCheck.shouldRespond === true
          ) {
            console.warn(
              `⚠️ Strategia '${plan.name}' ha restituito NO_REPLY in contrasto con reply_needed=true: provo il fallback successivo.`
            );
            response = null;
            const unexpectedNoReplyError = new Error('NO_REPLY inatteso dopo decisione reply_needed=true');
            unexpectedNoReplyError.code = 'UNEXPECTED_NO_REPLY';
            throw unexpectedNoReplyError;
          }

          if (response) {
            strategyUsed = plan.name;
            strategyUsedPlan = plan;
            console.log(`✅ Generazione riuscita con strategia: ${plan.name}`);
            break;
          }

        } catch (err) {
          generationError = err;
          if (!initialError) initialError = err;
          const errorClass = deps._classifyError(err);
          console.warn(`⚠️ Strategia '${plan.name}' fallita: ${err.message} [${errorClass.type}]`);

          if (errorClass.type === 'FATAL' || errorClass.type === 'INVALID_API_KEY') {
            // Se la chiave corrente è invalida/non autorizzata (401/403),
            // prova la strategia successiva: una chiave/modello di backup può essere ancora valido.
            if (/401|403|unauthorized|forbidden|permission_denied|api[_\s-]?key/i.test(String(err && err.message ? err.message : err))) {
              console.warn('↪️ Errore di autenticazione/permessi rilevato, provo la strategia successiva.');
              continue;
            }
            console.error('🛑 Errore fatale rilevato, interrompo strategia.');
            break;
          }

          const planIndex = attemptStrategy.indexOf(plan);
          const hasNextPlan = planIndex >= 0 && planIndex < attemptStrategy.length - 1;
          const rawGenerationError = String(err && err.message ? err.message : err).toLowerCase();
          const isQuotaLike = (
            errorClass.type === 'QUOTA_EXHAUSTED' ||
            errorClass.type === 'QUOTA_EXCEEDED' ||
            rawGenerationError.includes('quota')
          );
          const canTryNextPlan = hasNextPlan && (
            isQuotaLike ||
            ['RETRYABLE', 'NETWORK', 'TIMEOUT', 'INVALID_RESPONSE', 'UNKNOWN'].includes(errorClass.type)
          );

          if (canTryNextPlan) {
            console.warn(`↪️ Errore ${errorClass.type}, provo la strategia successiva.`);
            continue;
          }

          if (isQuotaLike) {
            console.warn('🧯 Errore quota sull\'ultima strategia: nessuna strategia residua, uscita anticipata.');
            break;
          }

          if (['CONFIG_ERROR', 'SYSTEM_ERROR', 'DATA'].includes(errorClass.type)) {
            console.error(`🛑 Errore ${errorClass.type} non recuperabile da fallback modello, interrompo generazione.`);
            break;
          }

          console.warn(`🛑 Nessuna strategia residua utile per errore ${errorClass.type}, interrompo generazione.`);
          break;
        }
      }
    }

    if (!response) {
      const errorToReport = generationError || initialError;
      const errorClass = errorToReport ? deps._classifyError(errorToReport) : { type: 'UNKNOWN', retryable: false, message: 'Generation strategies exhausted' };
      console.error('🛑 TUTTE le strategie di generazione sono fallite.');
      if (!errorClass.retryable) {
        markFailureForCurrentBurst('error');
      } else {
        console.warn(`   ↻ Errore generazione retryable (${errorClass.type}) - nessuna marcatura permanente`);
      }
      result.status = 'error';
      result.error = errorToReport ? String(errorToReport.message || errorToReport) : 'Generation strategies exhausted';
      result.retryable = !!errorClass.retryable;
      if (errorToReport && errorToReport.code === 'UNEXPECTED_NO_REPLY') {
        result.reason = 'unexpected_no_reply_after_reply_required';
      }
      if (initialError && generationError && initialError !== generationError) {
        result.error += ` (Ultimo fallback: ${String(generationError.message || generationError)})`;
      }
      result.errorClass = errorClass.type;
      return { terminal: true };
    }

    if (typeof response !== 'string') {
      console.error(`🛑 Risposta non valida da Gemini: tipo ricevuto '${typeof response}'`);
      markFailureForCurrentBurst('error');
      result.status = 'error';
      result.error = 'Invalid response type from GeminiService';
      result.errorClass = 'DATA';
      return { terminal: true };
    }

    return { response, strategyUsedPlan, attemptStrategy, fallbackModelName };
  },
  /** prepareResponse: ingressi locali espliciti; restituisce i dati della fase. */
  prepareResponse(deps, {
    response, markFailureForCurrentBurst, result, markHandledUnread, messageDetails, detectedLanguage,
    effectiveSalutationModeKey
  }) {
    const parsedResponse = deps._parseEmailResponse_(response);
    response = parsedResponse.text;
    if (parsedResponse.incomplete) {
      console.warn('   ⚠️ Blocco <email> incompleto: rinvio per revisione.');
      markFailureForCurrentBurst('validation', { reason: 'truncated_output' });
      result.status = 'validation_failed';
      result.reason = 'truncated_output';
      return { terminal: true };
    }
    // Lo strip pre-validazione nasconde i pattern statici al validatore
    // (che quindi non attiva mai il retry per thinking_leak) e puo' lasciare
    // frasi mozze. Meglio lasciare che il validatore veda il testo integrale.

    if (deps._isNoReplyToken_(response)) {
      console.log('   ⊖ AI ha restituito NO_REPLY');
      markHandledUnread();
      result.status = 'filtered';
      return { terminal: true };
    }

    response = deps._addTimeDiscrepancyNoteIfNeeded(
      response,
      { ...messageDetails, body: messageDetails.body || '' },
      detectedLanguage
    );

    response = deps._sanitizeUnrequestedSponsorGuidance_(
      response,
      messageDetails.subject,
      messageDetails.body,
      detectedLanguage
    );

    // Guardrail: blocca saluti confidenziali non giustificati.
    // Il flag /m abbina solo inizio riga, evitando falsi positivi nel corpo.
    // Lascia intatto "Dear" (standard formale EN) e "Cher" (formale FR).
    if (/^it/i.test(detectedLanguage || 'it')) {
      response = effectiveSalutationModeKey === 'full_warm'
        ? response.replace(/^(Carissimo|Carissima)\b/gm, 'Gentile')
        : response.replace(/^(Caro|Cara|Carissimo|Carissima)\b/gm, 'Gentile');
    } else if (/^pt/i.test(detectedLanguage || '')) {
      response = response.replace(/^(Caro|Cara)\b/gm, 'Prezado');
    }

    return { response };
  },
};
