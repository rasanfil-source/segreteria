/** Interpreta consegna/richiesta documentale e coerenza tassonomica o semantica.
 * Aggiorna classificazione e requestType esistenti; restituisce categoria e vincoli finali.
 * Le direttive sono aggiunte allo stesso array già consegnato alle opzioni del prompt.
 * GAS: namespace globale sincrono; dipendenze esplicite, nessun caricatore runtime.
 */
var ThreadDocuments = {
  /** interpret: ingressi locali espliciti; restituisce i dati della fase. */
  interpret(deps, {
    messageDetails, quickDocumentDelivery, quickAttachmentIntent, physicalAttachmentsDetected,
    attachmentItems, textFromAttachments, forceReceiptOnlyForSubmission, attachmentIntentContext,
    categoryHintSource, classification, requestType, attachmentPreCheckFailed, requestTypeName,
    quickCheck, attachmentSkipped
  }) {
    const certRequestText = `${messageDetails.subject || ''} ${messageDetails.body || ''}`;
    const documentRequestWithSupportingData = deps._detectDocumentRequestWithSupportingData_(
      messageDetails.subject,
      messageDetails.body
    );
    const hasCertificateSacramentalReference = /\bcertificat[ioa]\b[\s\S]{0,80}\b(battesim[oa]|cresim[ao]|matrimoni[oa]|morte)\b|\b(battesim[oa]|cresim[ao]|matrimoni[oa]|morte)\b[\s\S]{0,80}\bcertificat[ioa]\b/i.test(certRequestText);
    const hasCertificateRequestCue = /\b(richiesta|richied(?:o|ere|iamo|erei|erebbe|ete)|vorrei|desidero|serve|servirebbe|bisogno|ottenere|rilasci(?:o|are|ate)|prepar(?:are|ate|arlo|i|o)|stamp(?:are|arlo|ate|i|o)|mandar(?:mi|ci)|inviar(?:mi|ci))\b/i.test(certRequestText);
    const isCertRequest = documentRequestWithSupportingData.detected || (hasCertificateSacramentalReference && hasCertificateRequestCue);

    const documentDeliveryModel = deps._buildDocumentDeliveryModel_({
      subject: messageDetails.subject,
      body: messageDetails.body,
      quickDocumentDelivery: quickDocumentDelivery,
      quickAttachmentIntent: quickAttachmentIntent,
      physicalAttachmentsDetected: physicalAttachmentsDetected,
      attachmentItems: attachmentItems,
      textFromAttachments: textFromAttachments,
      attachmentSkipped: attachmentSkipped
    });
    const bodyContainsUsableDocumentContent = documentDeliveryModel.bodyContainsUsableDocumentContent;
    const expectsDocument = documentDeliveryModel.expectsDocument;
    const hasDocumentContentAvailable = documentDeliveryModel.hasDocumentContentAvailable;
    const hasExpectedDocumentMissing = documentDeliveryModel.status === 'missing';
    const receiptOnlyDeliveryChannel = documentDeliveryModel.receiptOnlyDeliveryChannel;
    if (
      !forceReceiptOnlyForSubmission &&
      expectsDocument &&
      bodyContainsUsableDocumentContent &&
      !isCertRequest &&
      !physicalAttachmentsDetected &&
      !(attachmentIntentContext && attachmentIntentContext.hasQuestions === true)
    ) {
      console.log('   📄 Documento compilato rilevato nel corpo: abilito conferma ricezione dati senza OCR');
      forceReceiptOnlyForSubmission = true;
      categoryHintSource = 'document_submission';
      classification.category = 'document_submission';
      classification.topic = 'dati documentali ricevuti nel testo';
      if (requestType && typeof requestType === 'object') {
        requestType.type = 'technical';
        requestType.needsDoctrine = false;
        requestType.needsDiscernment = false;
        requestType.topic = classification.topic;
      }
    }
    if (hasExpectedDocumentMissing) {
      console.warn('   ⚠️ Documento atteso ma non disponibile: nessun allegato e nessun contenuto compilato nel corpo');
    }

    const attachmentIntentName = String((attachmentIntentContext && attachmentIntentContext.intent) || '').toLowerCase();
    if (!physicalAttachmentsDetected && !attachmentPreCheckFailed && !bodyContainsUsableDocumentContent && !expectsDocument && /submission/i.test(attachmentIntentName)) {
      console.log('   📎 Guardrail allegati: nessun allegato fisico rilevato → disattivo contesto di consegna documentale');
      attachmentIntentContext = null;
      const fallbackCategory = (requestTypeName && requestTypeName !== 'technical') ? requestTypeName : null;
      if (/^(document_submission|suspected_submission)/i.test(String(categoryHintSource || ''))) {
        categoryHintSource = fallbackCategory;
      }
      if (/^(document_submission|suspected_submission)/i.test(String(classification.category || ''))) {
        classification.category = fallbackCategory;
        if (/document|allegat|consegna/i.test(String(classification.topic || ''))) {
          classification.topic = '';
        }
      }
      if (
        quickCheck &&
        quickCheck.classification &&
        typeof quickCheck.classification === 'object' &&
        /^(document_submission|suspected_submission)/i.test(String(quickCheck.classification.category || ''))
      ) {
        quickCheck.classification.category = fallbackCategory;
        if (/document|allegat|consegna/i.test(String(quickCheck.classification.topic || ''))) {
          quickCheck.classification.topic = '';
        }
      }
    }

    if (isCertRequest && categoryHintSource !== 'document_submission') {
      categoryHintSource = 'document_request';
    }
    const requestPurpose = deps._resolveRequestPurpose_(
      quickCheck,
      messageDetails.subject,
      messageDetails.body
    );
    quickCheck.request_purpose = requestPurpose.type;
    quickCheck.request_purpose_confidence = requestPurpose.confidence;
    quickCheck.request_purpose_source = requestPurpose.source;
    console.log(`   Scopo richiesta: ${requestPurpose.type}, confidence=${requestPurpose.confidence}, source=${requestPurpose.source}`);

    const indirectSbattezzo = deps._detectIndirectSbattezzoRequest_(messageDetails.subject, messageDetails.body);
    if (
      indirectSbattezzo.detected &&
      !/^document_submission/i.test(String(categoryHintSource || ''))
    ) {
      categoryHintSource = 'formal';
      classification.category = 'formal';
      classification.topic = 'sbattezzo';
      classification.subIntents = Object.assign({}, classification.subIntents || {}, {
        possible_sbattezzo_indirect: true
      });
      if (quickCheck && quickCheck.classification && typeof quickCheck.classification === 'object') {
        quickCheck.classification.category = 'formal';
        quickCheck.classification.topic = 'sbattezzo';
      }
      if (requestType && typeof requestType === 'object') {
        requestType.type = 'formal';
        requestType.isSbattezzo = true;
        requestType.needsDiscernment = false;
        requestType.needsDoctrine = false;
        requestType.formalScore = Math.max(Number(requestType.formalScore) || 0, 0.85);
      }
      console.log(`   ⚖️ Sbattezzo indiretto rilevato (${indirectSbattezzo.reason}) → routing FORMAL`);
    }

    return {
      isCertRequest, documentDeliveryModel, bodyContainsUsableDocumentContent, expectsDocument,
      hasDocumentContentAvailable, hasExpectedDocumentMissing, receiptOnlyDeliveryChannel, requestPurpose,
      attachmentIntentContext, categoryHintSource, forceReceiptOnlyForSubmission
    };
  },
  /** consistency: ingressi locali espliciti; restituisce i dati della fase. */
  consistency(deps, {
    documentDeliveryModel, messageDetails, attachmentItems, textFromAttachments,
    physicalAttachmentsDetected, attachmentIntentContext, quickDocumentDelivery, attachmentBlobs,
    quickAttachmentIntent, hasExpectedDocumentMissing, forceReceiptOnlyForSubmission, systemDirectives,
    promptOptions, expectsDocument, bodyContainsUsableDocumentContent, hasDocumentContentAvailable,
    receiptOnlyDeliveryChannel, runtimeContext
  }) {
    // Una menzione di documenti ancora attesi non descrive necessariamente
    // l'allegato presente: la coerenza si valuta solo su una consegna
    // effettivamente annunciata o riportata nel corpo.
    const assessConsistencyData = ThreadDocuments.assessConsistency(deps, {
      documentDeliveryModel, messageDetails, attachmentItems, textFromAttachments,
      physicalAttachmentsDetected, attachmentIntentContext, quickDocumentDelivery, attachmentBlobs,
      quickAttachmentIntent
    });
    let { documentConsistency, semanticConsistency, hasTaxonomyMismatch, hasSemanticMismatch, hasDocumentMismatch, documentMismatchReason, hasRiskyUnknownReceived } = assessConsistencyData;
    const hasDocumentDeliveryIncongruent = documentDeliveryModel.status === 'incongruent';
    const hasDocumentDeliveryUnverified = documentDeliveryModel.status === 'unverified_attachment';
    const hasDocumentDeliveryBlockingIssue = Boolean(
      hasExpectedDocumentMissing ||
      hasDocumentMismatch ||
      hasDocumentDeliveryIncongruent ||
      hasDocumentDeliveryUnverified
    );
    const effectiveDocumentMismatchReason = documentMismatchReason || documentDeliveryModel.blockReason || null;
    const shouldUseReceiptOnly = !hasDocumentDeliveryBlockingIssue && forceReceiptOnlyForSubmission;
    const shouldSkipValidationForReceiptOnly = shouldUseReceiptOnly;
    const directivesData = ThreadDocuments.directives(deps, {
      hasExpectedDocumentMissing, quickDocumentDelivery, quickAttachmentIntent, systemDirectives,
      hasDocumentMismatch, hasDocumentDeliveryIncongruent, hasDocumentDeliveryUnverified,
      hasSemanticMismatch, hasTaxonomyMismatch, effectiveDocumentMismatchReason, attachmentIntentContext,
      hasRiskyUnknownReceived, documentConsistency
    });
    let { injectedMissingDocumentDirective, injectedMismatchDirective } = directivesData;
    promptOptions.documentConsistency = documentConsistency;
    promptOptions.documentDelivery = {
      quickDocumentDelivery: quickDocumentDelivery,
      expectsDocument: expectsDocument,
      bodyContainsUsableDocumentContent: bodyContainsUsableDocumentContent,
      hasDocumentContentAvailable: hasDocumentContentAvailable,
      hasExpectedDocumentMissing: hasExpectedDocumentMissing,
      receiptOnlyDeliveryChannel: receiptOnlyDeliveryChannel,
      status: documentDeliveryModel.status,
      source: documentDeliveryModel.source,
      hasPhysicalAttachment: documentDeliveryModel.hasPhysicalAttachment,
      hasAttachmentAnalyzedContent: documentDeliveryModel.hasAttachmentAnalyzedContent,
      hasUsableAttachmentText: documentDeliveryModel.hasUsableAttachmentText,
      hasDocumentDeliveryUnverified: hasDocumentDeliveryUnverified,
      isCoherent: documentDeliveryModel.isCoherent,
      blocksReceiptOnly: documentDeliveryModel.blocksReceiptOnly,
      blockReason: documentDeliveryModel.blockReason
    };
    console.log(`   📎 Document consistency decision: ${JSON.stringify({
      taxonomyMode: documentConsistency ? (documentConsistency.mode || null) : null,
      semanticConsistent: semanticConsistency ? semanticConsistency.consistent : null,
      hasTaxonomyMismatch: hasTaxonomyMismatch,
      hasSemanticMismatch: hasSemanticMismatch,
      hasDocumentMismatch: hasDocumentMismatch,
      hasDocumentDeliveryUnverified: hasDocumentDeliveryUnverified,
      hasDocumentDeliveryBlockingIssue: hasDocumentDeliveryBlockingIssue,
      expectsDocument: expectsDocument,
      bodyContainsUsableDocumentContent: bodyContainsUsableDocumentContent,
      hasDocumentContentAvailable: hasDocumentContentAvailable,
      hasExpectedDocumentMissing: hasExpectedDocumentMissing,
      forceReceiptOnlyForSubmission: forceReceiptOnlyForSubmission,
      hasRiskyUnknownReceived: hasRiskyUnknownReceived,
      documentDeliveryStatus: documentDeliveryModel.status,
      documentDeliverySource: documentDeliveryModel.source,
      documentDeliveryBlocksReceiptOnly: documentDeliveryModel.blocksReceiptOnly,
      documentDeliveryBlockReason: documentDeliveryModel.blockReason,
      shouldUseReceiptOnly: shouldUseReceiptOnly,
      shouldSkipValidationForReceiptOnly: shouldSkipValidationForReceiptOnly,
      injectedMissingDocumentDirective: injectedMissingDocumentDirective,
      injectedMismatchDirective: injectedMismatchDirective
    })}`);

    const validationRuntimeContext = (hasDocumentMismatch || hasDocumentDeliveryIncongruent || hasDocumentDeliveryUnverified || hasExpectedDocumentMissing)
      ? Object.freeze(Object.assign({}, runtimeContext, {
        validationContext: Object.assign({}, runtimeContext.validationContext || {}, {
          documentMismatch: (hasDocumentMismatch || hasDocumentDeliveryIncongruent || hasDocumentDeliveryUnverified) ? {
            active: true,
            mode: hasDocumentDeliveryUnverified
              ? 'unverified_attachment'
              : (hasSemanticMismatch
                ? 'semantic'
                : (hasTaxonomyMismatch ? 'taxonomy' : 'document_delivery')),
            reason: effectiveDocumentMismatchReason || '',
            hasQuestions: Boolean(attachmentIntentContext && attachmentIntentContext.hasQuestions === true),
            expected: documentConsistency && documentConsistency.expected ? documentConsistency.expected : '',
            received: documentConsistency && documentConsistency.received ? documentConsistency.received : ''
          } : null,
          expectedDocumentMissing: hasExpectedDocumentMissing ? {
            active: true,
            expected: (quickDocumentDelivery && quickDocumentDelivery.expected_document_description) || '',
            deliveryChannel: quickDocumentDelivery ? quickDocumentDelivery.delivery_channel : 'unclear',
            bodyContainsUsableDocumentContent: bodyContainsUsableDocumentContent
          } : null
        })
      }))
      : runtimeContext;

    return { hasDocumentMismatch, hasRiskyUnknownReceived, shouldUseReceiptOnly, validationRuntimeContext };
  },
  /** initialCategory: ingressi locali espliciti; restituisce i dati della fase. */
  initialCategory(deps, { preQuickAttachmentIntentContext, requestType, quickCheck, classification }) {
    let attachmentIntentContext = preQuickAttachmentIntentContext;
    let forceReceiptOnlyForSubmission = false;

    const requestTypeName = requestType && requestType.type ? requestType.type : '';
    const quickCheckCategory = quickCheck && quickCheck.classification && quickCheck.classification.category
      ? String(quickCheck.classification.category).toLowerCase()
      : '';
    // Priorità al classificatore LLM del quick check rispetto all'euristica locale iniziale.
    let categoryHintSource = String(quickCheckCategory || classification.category || requestTypeName || '').toLowerCase() || null;

    if (attachmentIntentContext && (
      attachmentIntentContext.intent === 'document_submission' ||
      attachmentIntentContext.intent === 'document_submission_with_question'
    )) {
      categoryHintSource = attachmentIntentContext.intent;
      classification.category = 'document_submission';
      classification.topic = attachmentIntentContext.allowBodyQuestions
        ? 'documentazione ricevuta con domanda'
        : 'documentazione ricevuta';

      if (requestType && typeof requestType === 'object') {
        requestType.type = 'technical';
        requestType.needsDoctrine = false;
        requestType.needsDiscernment = false;
        requestType.topic = classification.topic;
      }
    }

    return { attachmentIntentContext, forceReceiptOnlyForSubmission, requestTypeName, categoryHintSource };
  },
  /** assessConsistency: returns documentConsistency, semanticConsistency, hasTaxonomyMismatch, hasSemanticMismatch, hasDocumentMismatch, documentMismatchReason, hasRiskyUnknownReceived; preserves the caller's service-effect order. */
  assessConsistency(deps, {
    documentDeliveryModel, messageDetails, attachmentItems, textFromAttachments,
    physicalAttachmentsDetected, attachmentIntentContext, quickDocumentDelivery, attachmentBlobs,
    quickAttachmentIntent
  }) {
    const inspectionSkippedForSize = documentDeliveryModel.blockReason === 'attachment_inspection_skipped_for_size';
    const documentConsistency = !inspectionSkippedForSize && deps.config.documentConsistencyCheckEnabled && documentDeliveryModel.expectsDocument
      ? deps._evaluateDocumentConsistency_(
        messageDetails.subject,
        messageDetails.body,
        attachmentItems,
        textFromAttachments
      )
      : null;
    const isDocumentDeliveryContext = Boolean(
      physicalAttachmentsDetected &&
      attachmentIntentContext &&
      /submission/i.test(String(attachmentIntentContext.intent || ''))
    );

    // La tassonomia locale (_evaluateDocumentConsistency_) riconosce solo
    // documenti sacramentali/anagrafici noti: per qualunque altro allegato
    // (video, locandine, programmi, documentazione generica) "expected"
    // risulta sempre 'unknown' e il mismatch non può mai scattare, anche
    // quando l'allegato è palesemente incongruo. In questo gap (e solo in
    // questo gap, per non moltiplicare le chiamate Gemini) deleghiamo la
    // verifica di coerenza a un controllo semantico zero-shot.
    const hasExplicitQuickDocumentExpectation = Boolean(
      documentDeliveryModel.expectsDocument &&
      quickDocumentDelivery &&
      quickDocumentDelivery.source === 'quick_check' &&
      quickDocumentDelivery.expected_document === true &&
      quickDocumentDelivery.expected_document_description
    );
    const needsSemanticConsistencyCheck = Boolean(
      deps.config.documentConsistencyCheckEnabled &&
      documentConsistency &&
      (
        documentConsistency.mode === 'unknown_expected' ||
        (hasExplicitQuickDocumentExpectation && documentConsistency.mode !== 'mismatch')
      ) &&
      physicalAttachmentsDetected &&
      (textFromAttachments || (Array.isArray(attachmentItems) && attachmentItems.length > 0))
    );
    const semanticConsistency = needsSemanticConsistencyCheck
      ? deps._evaluateAttachmentSemanticConsistency_({
        subject: messageDetails.subject,
        body: messageDetails.body,
        attachmentItems: attachmentItems,
        ocrText: textFromAttachments,
        attachmentBlobs: attachmentBlobs,
        expectedAttachmentDescription: (quickDocumentDelivery && quickDocumentDelivery.expected_document_description) ||
          (quickAttachmentIntent ? quickAttachmentIntent.expected_attachment_description : '')
      })
      : null;

    const hasTaxonomyMismatch = !!(documentConsistency && documentConsistency.mode === 'mismatch');
    const hasSemanticMismatch = !!(semanticConsistency && semanticConsistency.consistent === false);
    const hasDocumentMismatch = hasTaxonomyMismatch || hasSemanticMismatch;
    const documentMismatchReason = hasSemanticMismatch
      ? (semanticConsistency.reason || "contenuto dell'allegato non coerente con quanto descritto nell'email")
      : (hasTaxonomyMismatch
        ? `atteso ${documentConsistency.expected || 'unknown'}, ricevuto ${documentConsistency.received || 'unknown'}`
        : null);
    const hasRiskyUnknownReceived = !!(
      documentConsistency &&
      documentConsistency.mode === 'unknown_received' &&
      (isDocumentDeliveryContext || (
        documentDeliveryModel.expectsDocument &&
        documentDeliveryModel.hasAttachmentContent
      ))
    );
    if (hasDocumentMismatch) {
      documentDeliveryModel.status = 'incongruent';
      documentDeliveryModel.isCoherent = false;
      documentDeliveryModel.blocksReceiptOnly = true;
      documentDeliveryModel.blockReason = documentMismatchReason || 'document_mismatch';
    } else if (hasRiskyUnknownReceived && (documentDeliveryModel.expectsDocument || isDocumentDeliveryContext)) {
      // Un allegato non classificabile in un contesto di consegna documentale
      // non può essere trattato come conferma automatica. Non è però un
      // mismatch provato: è un allegato ricevuto ma non verificabile con certezza.
      documentDeliveryModel.status = 'unverified_attachment';
      documentDeliveryModel.isCoherent = false;
      documentDeliveryModel.blocksReceiptOnly = true;
      documentDeliveryModel.blockReason = documentDeliveryModel.expectsDocument
        ? 'expected_document_with_unknown_attachment'
        : 'submission_attachment_unknown_content';
    }
    return {
      documentConsistency, semanticConsistency, hasTaxonomyMismatch, hasSemanticMismatch,
      hasDocumentMismatch, documentMismatchReason, hasRiskyUnknownReceived
    };
  },
  /** directives: returns injectedMissingDocumentDirective, injectedMismatchDirective; preserves the caller's service-effect order. */
  directives(deps, {
    hasExpectedDocumentMissing, quickDocumentDelivery, quickAttachmentIntent, systemDirectives,
    hasDocumentMismatch, hasDocumentDeliveryIncongruent, hasDocumentDeliveryUnverified,
    hasSemanticMismatch, hasTaxonomyMismatch, effectiveDocumentMismatchReason, attachmentIntentContext,
    hasRiskyUnknownReceived, documentConsistency
  }) {
    let injectedMissingDocumentDirective = null;
    let injectedMismatchDirective = null;
    if (hasExpectedDocumentMissing) {
      // A fixed feminine referent avoids guessing gender/number of arbitrary descriptions.
      const expectedDocumentLabel = String(
        (quickDocumentDelivery && quickDocumentDelivery.expected_document_description) ||
        (quickAttachmentIntent && quickAttachmentIntent.expected_attachment_description) ||
        'documento atteso'
      ).trim();
      injectedMissingDocumentDirective = `DOCUMENTO ATTESO NON DISPONIBILE: Scrivi: "Non troviamo allegata né riportata nel testo la documentazione richiesta («${expectedDocumentLabel}»). Può cortesemente reinviarla o inserirne i dati nel corpo del messaggio?" Usa questa richiesta come contenuto principale, con saluto istituzionale.`;
      systemDirectives.unshift(injectedMissingDocumentDirective);
    }

    if (hasDocumentMismatch || hasDocumentDeliveryIncongruent || hasDocumentDeliveryUnverified) {
      console.warn(`   ⚠️ Problema documentale rilevato (${hasDocumentDeliveryUnverified ? 'non_verificabile' : (hasSemanticMismatch ? 'semantico' : (hasTaxonomyMismatch ? 'tassonomia' : 'document_delivery'))}): ${effectiveDocumentMismatchReason}`);

      // Il segnale deve arrivare a Gemini, non bypassarlo: iniettiamo una
      // direttiva di sistema. Se nel messaggio ci sono domande esplicite,
      // rispondiamo anche a quelle; in una consegna pura evitiamo di
      // inventare richieste operative non presenti.
      let directiveText = '';
      let prefixMsg = '';

      const inspectionSkippedForSize = effectiveDocumentMismatchReason === 'attachment_inspection_skipped_for_size';
      if (hasDocumentDeliveryUnverified && inspectionSkippedForSize) {
        directiveText = [
          'Il messaggio supera il limite di dimensioni per la lettura degli allegati: la loro presenza e il contenuto non sono verificati.',
          'Non affermare che il documento manca, è errato, è stato ricevuto, è corretto o completo.',
          'Conferma soltanto la ricezione del messaggio e rispondi alle domande usando i dati disponibili.',
          'Se il documento è indispensabile, spiega che non è stato possibile verificarlo e chiedi una copia di dimensioni ridotte o i dati nel corpo del messaggio.'
        ].join(' ');
        prefixMsg = 'CONTESTO INTERNO: LETTURA ALLEGATI NON ESEGUITA PER DIMENSIONI:';
      } else if (hasDocumentDeliveryUnverified) {
        directiveText = [
          'Il file è ricevuto ma non classificabile con certezza: questo non prova un errore dell’utente.',
          'Conferma la ricezione e rispondi alla richiesta corrente con KB e contesto; non imporre verifica o reinvio per la sola incertezza di classificazione.',
          'Chiedi un dato o una copia leggibile soltanto se indispensabile per rispondere alla richiesta e realmente non disponibile.',
          'Non confermare che il documento sia corretto o completo.',
          'Non usare formule come "sembra non corrispondere", "non corrisponde", "allegato incongruo", "allegato sbagliato" o "allegato errato".'
        ].join(' ');
        prefixMsg = 'CONTESTO INTERNO: ALLEGATO RICEVUTO, TIPO NON CLASSIFICATO (non è un avviso da riportare all’utente):';
      } else {
        directiveText = [
          'Quando l’allegato non corrisponde a quanto annunciato, scrivi in modo diretto e cortese:',
          '"L’allegato ricevuto sembra non corrispondere a [documento atteso]. La invitiamo a verificare il file e, se necessario, a reinviare il documento corretto."',
          'Sostituisci [documento atteso] con il documento atteso quando disponibile; altrimenti usa "quanto annunciato".',
          'Usa "sembra" per mantenere tono non accusatorio.',
          'Non spiegare il criterio interno o il processo di verifica.'
        ].join(' ');
        prefixMsg = 'AVVISO ALLEGATO NON COERENTE:';
      }

      if (attachmentIntentContext && attachmentIntentContext.hasQuestions === true) {
        const questionPriority = hasDocumentDeliveryUnverified
          ? "Senza imporre un avviso preliminare, rispondi comunque in modo completo e operativo alla richiesta contenuta nell'email, usando il testo del messaggio e il resto del contesto disponibile."
          : "Subito dopo l'avviso, rispondi comunque in modo completo e operativo alla richiesta contenuta nell'email, usando il testo del messaggio e il resto del contesto disponibile.";
        injectedMismatchDirective = `${prefixMsg} ${directiveText} Documento atteso/motivo: ${effectiveDocumentMismatchReason}. ${questionPriority}`;
      } else {
        const receiptInstruction = inspectionSkippedForSize
          ? 'Per una consegna senza domande, conferma solo il messaggio, senza confermare la ricezione del documento.'
          : hasDocumentDeliveryUnverified
          ? 'Per una consegna senza domande, conferma la ricezione senza richiedere reinvio per la sola incertezza di classificazione.'
          : 'Per una consegna senza domande, usa solo questo avviso e il saluto istituzionale.';
        injectedMismatchDirective = `${prefixMsg} ${directiveText} Documento atteso/motivo: ${effectiveDocumentMismatchReason}. ${receiptInstruction}`;
      }
      systemDirectives.unshift(injectedMismatchDirective);
    } else if (hasRiskyUnknownReceived) {
      console.warn(`   ⚠️ Documento non classificabile in contesto sponsor: atteso=${documentConsistency.expected || 'unknown'} ricevuto=unknown`);
    }
    return { injectedMissingDocumentDirective, injectedMismatchDirective };
  },
};
