/** Pre-check, look-back limitato, budget di estrazione e interpretazione OCR.
 * Il look-back conserva intenzionalmente l’array dei messaggi del contesto per identità.
 * GAS: namespace globale sincrono; dipendenze esplicite, nessun caricatore runtime.
 */
var ThreadAttachments = {
  /** prepare: ingressi locali espliciti; restituisce i dati della fase. */
  prepare(deps, {
    responseContextMessages, candidate, threadLogger, messageDetails, messages, ownAddresses,
    quickAttachmentIntent, quickDocumentDelivery, attachmentIntentContext,
    preQuickAttachmentIntentContext, categoryHintSource, quickCheck, detectedLanguage,
    forceReceiptOnlyForSubmission, buildRuleContext, result
  }) {
    let attachmentBlobs = [];
    let textFromAttachments = '';
    let attachmentSkipped = [];
    let attachmentItems = [];
    let physicalAttachmentsDetected = false;
    let attachmentPreCheckFailed = false;

    if (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT && CONFIG.ATTACHMENT_CONTEXT.enabled) {
      if (deps._isNearDeadline(deps.config.maxExecutionTimeMs)) {
        attachmentSkipped.push({ reason: 'near_deadline' });
        console.warn('   ⏳ Allegati multimodali saltati: tempo residuo insufficiente.');
      } else {
        const attachmentSettings = Object.assign(
          { maxFiles: 3 },
          (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT) ? CONFIG.ATTACHMENT_CONTEXT : {}
        );
        const maxAttachmentMessageBytes = deps._getAttachmentDownloadLimitBytes_(attachmentSettings);
        const attachmentSourceMessages = (responseContextMessages && responseContextMessages.length > 0)
          ? responseContextMessages
          : [candidate].filter(Boolean);
        let hasAttachments = false;
        attachmentPreCheckFailed = false;
        try {
          hasAttachments = attachmentSourceMessages.some((message) => {
            const sizeEstimate = deps._getMessageSizeEstimateForAttachmentDownload_(message, threadLogger);
            if (Number.isFinite(sizeEstimate) && sizeEstimate > maxAttachmentMessageBytes) {
              let messageId = 'unknown';
              try {
                messageId = message && typeof message.getId === 'function' ? message.getId() : 'unknown';
              } catch (_) { }
              attachmentSkipped.push({
                messageId: messageId,
                reason: 'message_too_large_for_attachment_download',
                sizeEstimate: sizeEstimate,
                maxBytes: maxAttachmentMessageBytes
              });
              console.warn(`   📎 Allegati saltati per ${messageId}: messaggio troppo grande (${sizeEstimate}/${maxAttachmentMessageBytes} byte)`);
              return false;
            }
            const attachments = message.getAttachments({ includeInlineImages: true, includeAttachments: true }) || [];
            return attachments.length > 0;
          });
        } catch (e) {
          console.warn(`⚠️ Impossibile leggere allegati per pre-check: ${e.message}`);
          attachmentPreCheckFailed = true;
        }

        // LOOK-BACK STRETTO: se il messaggio corrente non ha allegati propri, recuperiamo
        // quello del messaggio immediatamente precedente SOLO se il corpo vi fa esplicito
        // riferimento testuale (es. "come da documento già inviato", "il modulo precedente")
        // e SOLO se quel messaggio precedente non è nostro. Nessuna scansione profonda del
        // thread: un solo salto indietro, ancorato semanticamente, per evitare di ripescare
        // allegati di mesi prima non più pertinenti al messaggio corrente.
        const lookBackData = ThreadAttachments.lookBack(deps, {
          messageDetails, hasAttachments, attachmentPreCheckFailed, messages, candidate, ownAddresses,
          attachmentSourceMessages
        });
        ({ hasAttachments } = lookBackData);
        physicalAttachmentsDetected = Boolean(hasAttachments);

        if (!hasAttachments && !attachmentPreCheckFailed) {
          attachmentSkipped.push({ reason: 'no_attachments' });
          console.log('   📎 Elaborazione allegati saltata: nessun allegato nel messaggio candidato');
        } else {
          const bodyIsVeryShort = (messageDetails.body || '').trim().length < 50;
          const quickCheckRequiresAttachmentReading = Boolean(
            hasAttachments &&
            (
              (quickAttachmentIntent && quickAttachmentIntent.requires_attachment_reading === true) ||
              (quickDocumentDelivery && quickDocumentDelivery.expected_document === true && (
                quickDocumentDelivery.requires_file_attachment === true ||
                quickDocumentDelivery.delivery_channel === 'attachment' ||
                quickDocumentDelivery.delivery_channel === 'both' ||
                quickDocumentDelivery.delivery_channel === 'unclear'
              ))
            )
          );
          const localOcrFallback = deps._shouldTryOcr(messageDetails.body, messageDetails.subject, hasAttachments);
          if (
            bodyIsVeryShort ||
            attachmentPreCheckFailed ||
            quickCheckRequiresAttachmentReading ||
            localOcrFallback
          ) {
            // Body molto corto (<50 char) → l'allegato è probabilmente il contenuto principale
            if (bodyIsVeryShort) {
              console.log('   📎 Body corto: elaborazione allegati forzata');
            } else if (quickCheckRequiresAttachmentReading) {
              const expectedFromQuickCheck = (quickDocumentDelivery && quickDocumentDelivery.expected_document_description) ||
                (quickAttachmentIntent && quickAttachmentIntent.expected_attachment_description) ||
                (quickDocumentDelivery && quickDocumentDelivery.reason) ||
                (quickAttachmentIntent && quickAttachmentIntent.reason) ||
                'documento allegato';
              console.log(`   📎 QuickCheck document_delivery: elaborazione allegati forzata (${expectedFromQuickCheck})`);
            }
            console.log('   📎 Elaborazione allegati multimodale (Vision)...');
            const collectData = ThreadAttachments.collect(deps, {
              attachmentSettings, attachmentSourceMessages, threadLogger, maxAttachmentMessageBytes
            });
            let { attachmentData, countProcessedAttachments } = collectData;
            attachmentBlobs = attachmentData.blobs || [];
            textFromAttachments = attachmentData.textContext || '';
            attachmentSkipped = attachmentData.skipped || [];
            attachmentItems = attachmentData.items || [];
            physicalAttachmentsDetected = Boolean(
              physicalAttachmentsDetected ||
              countProcessedAttachments() > 0 ||
              attachmentBlobs.length > 0 ||
              attachmentItems.length > 0
            );
            const interpretOcrData = ThreadAttachments.interpretOcr(deps, {
              messageDetails, attachmentItems, textFromAttachments, attachmentIntentContext,
              preQuickAttachmentIntentContext, categoryHintSource, quickCheck, detectedLanguage,
              forceReceiptOnlyForSubmission, buildRuleContext, result
            });
            ({ attachmentIntentContext, categoryHintSource, forceReceiptOnlyForSubmission } = interpretOcrData);
            if (attachmentBlobs.length > 0) {
              const blobNames = attachmentBlobs.map((b) => b.getName()).join(', ');
              console.log(`   📎 Pronti ${attachmentBlobs.length} allegati visivi per Gemini (${blobNames})`);
            }

            if (attachmentSkipped.length > 0) {
              const skippedNames = attachmentSkipped.map((s) => s.name || s.reason).join(', ');
              console.log(`   📎 Allegati ignorati/non supportati: ${attachmentSkipped.length} (${skippedNames})`);
            }
          } else {
            attachmentSkipped.push({ reason: 'precheck_no_ocr' });
            textFromAttachments = '[Avviso di sistema: sono presenti allegati nel thread, ma sono stati esclusi dall\'analisi automatica perché il pre-check non ha rilevato trigger OCR/multimodali rilevanti.]';
            console.log('   📎 Elaborazione allegati saltata: keyword trigger non rilevate');
          }
        }

      }
    }

    return {
      attachmentBlobs, textFromAttachments, attachmentItems, physicalAttachmentsDetected,
      attachmentPreCheckFailed, attachmentIntentContext, categoryHintSource, forceReceiptOnlyForSubmission
    };
  },
  /** collect: returns attachmentData, countProcessedAttachments; preserves the caller's service-effect order. */
  collect(deps, { attachmentSettings, attachmentSourceMessages, threadLogger, maxAttachmentMessageBytes }) {
    const maxAttachmentFiles = Math.max(1, parseInt(attachmentSettings.maxFiles, 10) || 3);
    const parsedMaxTotalChars = parseInt(attachmentSettings.maxTotalChars, 10);
    const maxTextChars = Number.isFinite(parsedMaxTotalChars) && parsedMaxTotalChars >= 0
      ? parsedMaxTotalChars
      : 9000;
    let attachmentData = { blobs: [], textContext: '', skipped: [], items: [], processedCount: 0 };
    const getReportedProcessedCount = (data) => {
      const reported = Number(data && data.processedCount);
      return Number.isFinite(reported) && reported >= 0 ? reported : null;
    };
    const inferProcessedAttachmentCount = (data) => Math.max(
      Array.isArray(data && data.items) ? data.items.length : 0,
      Array.isArray(data && data.blobs) ? data.blobs.length : 0
    );
    const countProcessedAttachments = () => attachmentData.processedCount || 0;
    // Aggrega allegati dai messaggi esterni inclusi nel contesto corrente, non solo dal candidato.
    // Evita perdita di contesto quando l'utente invia allegati in messaggi precedenti.
    for (let i = attachmentSourceMessages.length - 1; i >= 0; i--) {
      try {
        const remainingFiles = maxAttachmentFiles - countProcessedAttachments();
        if (remainingFiles <= 0) break;

        const sizeEstimate = deps._getMessageSizeEstimateForAttachmentDownload_(attachmentSourceMessages[i], threadLogger);
        if (Number.isFinite(sizeEstimate) && sizeEstimate > maxAttachmentMessageBytes) {
          let messageId = 'unknown';
          try {
            messageId = attachmentSourceMessages[i] && attachmentSourceMessages[i].getId ? attachmentSourceMessages[i].getId() : 'unknown';
          } catch (_) { }
          attachmentData.skipped.push({
            messageId: messageId,
            reason: 'message_too_large_for_attachment_download',
            sizeEstimate: sizeEstimate,
            maxBytes: maxAttachmentMessageBytes
          });
          console.warn(`   📎 Elaborazione allegati saltata per ${messageId}: messaggio troppo grande (${sizeEstimate}/${maxAttachmentMessageBytes} byte)`);
          continue;
        }

        const usedChars = (attachmentData.textContext || '').length;
        const safeMaxChars = maxTextChars > 0
          ? Math.max(0, maxTextChars - usedChars)
          : 0;
        const msgData = deps.gmailService.getProcessableAttachments(attachmentSourceMessages[i], {
          maxFiles: remainingFiles,
          maxTotalChars: safeMaxChars,
          shouldContinue: () => !deps._isNearDeadline(deps.config.maxExecutionTimeMs)
        });
        if (Array.isArray(msgData.blobs)) attachmentData.blobs.push(...msgData.blobs);
        if (msgData.textContext) {
          if (maxTextChars > 0) {
            const remainingChars = Math.max(0, maxTextChars - (attachmentData.textContext || '').length);
            if (remainingChars <= 0) {
              attachmentData.skipped.push({ reason: 'max_total_chars' });
            } else {
              const boundedText = msgData.textContext.length > remainingChars
                ? msgData.textContext.substring(0, remainingChars)
                : msgData.textContext;
              attachmentData.textContext += boundedText;
              if (boundedText.length < msgData.textContext.length) {
                attachmentData.skipped.push({ reason: 'max_total_chars', kept: boundedText.length });
              }
            }
          } else {
            attachmentData.textContext += msgData.textContext;
          }
        }
        if (Array.isArray(msgData.skipped)) attachmentData.skipped.push(...msgData.skipped);
        if (Array.isArray(msgData.items)) attachmentData.items.push(...msgData.items);
        const reportedCount = getReportedProcessedCount(msgData);
        attachmentData.processedCount += reportedCount !== null
          ? reportedCount
          : inferProcessedAttachmentCount(msgData);
        if (countProcessedAttachments() >= maxAttachmentFiles) break;
      } catch (attError) {
        let messageId = 'unknown';
        try {
          messageId = attachmentSourceMessages[i] && attachmentSourceMessages[i].getId ? attachmentSourceMessages[i].getId() : 'unknown';
        } catch (idError) {
          threadLogger.debug(`Impossibile recuperare ID messaggio durante errore allegati: ${idError.message}`);
        }
        console.warn(`   ⚠️ Errore critico estrazione allegati nel messaggio ${messageId}: ${attError.message}`);
        attachmentData.skipped.push({ reason: 'extraction_crash', error: attError.message });
      }
    }
    return { attachmentData, countProcessedAttachments };
  },
  /** interpretOcr: returns attachmentIntentContext, categoryHintSource, forceReceiptOnlyForSubmission; preserves the caller's service-effect order. */
  interpretOcr(deps, {
    messageDetails, attachmentItems, textFromAttachments, attachmentIntentContext,
    preQuickAttachmentIntentContext, categoryHintSource, quickCheck, detectedLanguage,
    forceReceiptOnlyForSubmission, buildRuleContext, result
  }) {
    const postOcrAttachmentIntentContext = deps._deriveAttachmentIntentContext_(
      messageDetails.body,
      messageDetails.subject,
      attachmentItems,
      textFromAttachments,
      'post_ocr'
    );
    attachmentIntentContext = postOcrAttachmentIntentContext || preQuickAttachmentIntentContext;

    // Se post-OCR cambia la categoria (es. rilevato modulo sbattezzo), aggiorniamo il routing
    if (attachmentIntentContext && attachmentIntentContext.categoryHintSource) {
      console.log(`   📎 Routing categoria aggiornato post-OCR: ${attachmentIntentContext.categoryHintSource}`);
      categoryHintSource = attachmentIntentContext.categoryHintSource;
    }

    if (attachmentIntentContext && /submission/i.test(String(attachmentIntentContext.intent || ''))) {
      const hasSubmissionQuestions = Boolean(attachmentIntentContext.hasQuestions);
      const sponsorSubmission = Boolean(
        (attachmentIntentContext.detectedDocTypes && attachmentIntentContext.detectedDocTypes.sponsor) ||
        /sponsor|padrin|madrin|idoneit/i.test(String(attachmentIntentContext.intent || '')) ||
        /sponsor|padrin|madrin|idoneit/i.test(`${messageDetails.subject || ''} ${messageDetails.body || ''}`)
      );
      const canonicalSubmissionText = [
        messageDetails.subject || '',
        messageDetails.body || '',
        Array.isArray(attachmentItems) ? attachmentItems.map((i) => (i && i.name) ? i.name : '').join(' ') : '',
        textFromAttachments || ''
      ].join(' ');
      const hasSacramentalTopic =
        /battesim|cresim|confermazion|confirmation|comunion|matrimon|sacrament/i.test(canonicalSubmissionText);
      const hasCanonicalActionRequest =
        /\b(?:permesso|autorizzazion\w*|nulla\s*osta|consenso|assenso|delega|firmare|firma|timbrare|timbro|restituir\w*|rinviare|approv\w*|permission|permit|authori[sz]ation|consent|sign|stamp|return|approve|approval)\b/i.test(canonicalSubmissionText);
      const isComplexCanonicalSubmission = Boolean(
        /sbattezz|apostasi|nullit/i.test(canonicalSubmissionText) ||
        (hasSacramentalTopic && hasCanonicalActionRequest)
      );
      let shouldProvideEligibilityGuidance = false;
      if (sponsorSubmission) {
        shouldProvideEligibilityGuidance = deps._shouldProvideEligibilityGuidance_(
          messageDetails.subject,
          messageDetails.body,
          attachmentIntentContext,
          quickCheck.needs_sponsor_guidance,
          detectedLanguage
        );
      }
      const submissionPolicyState = {
        forceReceiptOnlyForSubmission: forceReceiptOnlyForSubmission
      };
      const submissionPolicyContext = buildRuleContext({
        phase: 'post_ocr_policy',
        state: submissionPolicyState,
        isDocumentSubmission: true,
        hasSubmissionQuestions: hasSubmissionQuestions,
        isSponsorSubmission: sponsorSubmission,
        isComplexCanonicalSubmission: isComplexCanonicalSubmission,
        shouldProvideEligibilityGuidance: shouldProvideEligibilityGuidance
      });
      const submissionPolicyDecision = deps._evaluatePreAiRules_(submissionPolicyContext);
      deps._applyPreAiRuleDecision_(submissionPolicyDecision, submissionPolicyContext, result);
      forceReceiptOnlyForSubmission = submissionPolicyState.forceReceiptOnlyForSubmission;
    }
    return { attachmentIntentContext, categoryHintSource, forceReceiptOnlyForSubmission };
  },
  /** lookBack: returns hasAttachments; preserves the caller's service-effect order. */
  lookBack(deps, {
    messageDetails, hasAttachments, attachmentPreCheckFailed, messages, candidate, ownAddresses,
    attachmentSourceMessages
  }) {
    const bodyStr = messageDetails.body || '';
    const explicitPastReference = /\bcome\s.{0,25}\b(invi|alleg|trasmess|anticip)/i.test(bodyStr)
      || /\b(documento|modulo|certificato|file)\b.{0,30}\b(precedente|di\s+prima|gi[aà]\s+(?:invi|alleg))/i.test(bodyStr);

    if (!hasAttachments && !attachmentPreCheckFailed && messages.length > 1 && explicitPastReference) {
      const candidateIndex = messages.findIndex((m) => m.getId() === candidate.getId());

      // Finestra mobile invece di candidateIndex-1 fisso: nel flusso reale il bot
      // risponde quasi sempre al primo invio, quindi il messaggio immediatamente
      // precedente è spesso la NOSTRA risposta. Risaliamo saltando i nostri messaggi
      // fino al primo messaggio esterno, con un tetto di 3 passi per restare "stretto"
      // e non degenerare in una scansione dell'intero thread.
      let foundValidPastMsg = null;
      for (let j = candidateIndex - 1; j >= Math.max(0, candidateIndex - 3); j--) {
        const pastMsgCandidate = messages[j];
        const pastSenderRawCandidate = (pastMsgCandidate && typeof pastMsgCandidate.getFrom === 'function') ? (pastMsgCandidate.getFrom() || '') : '';
        const pastSenderEmailCandidate = (deps.gmailService && typeof deps.gmailService._extractEmailAddress === 'function')
          ? deps._normalizeEmailAddress_(deps.gmailService._extractEmailAddress(pastSenderRawCandidate) || '')
          : '';
        const pastIsUsCandidate = Boolean(pastSenderEmailCandidate) && ownAddresses.has(pastSenderEmailCandidate);
        if (!pastIsUsCandidate) {
          foundValidPastMsg = pastMsgCandidate;
          break;
        }
      }

      if (foundValidPastMsg) {
        const pastAttachments = foundValidPastMsg.getAttachments({ includeInlineImages: true, includeAttachments: true }) || [];
        if (pastAttachments.length > 0) {
          console.log(`   📎 Look-back stretto: recuperato allegato dal messaggio precedente (${foundValidPastMsg.getId()}) referenziato esplicitamente nel testo.`);
          attachmentSourceMessages.push(foundValidPastMsg);
          hasAttachments = true;
        }
      } else {
        console.log('   📎 Look-back stretto: nessun messaggio esterno trovato nel raggio di ricerca (3 passi).');
      }
    }
    return { hasAttachments };
  },
};
