/** Applica nell’ordine le policy locali e il quick check con i servizi esistenti.
 * Le uscite terminali aggiornano result e applicano solo le azioni previste dalla policy.
 * GAS: namespace globale sincrono; dipendenze esplicite, nessun caricatore runtime.
 */
var ThreadPolicy = {
  /** ruleContext: ingressi locali espliciti; restituisce i dati della fase. */
  ruleContext(deps, {
    messageState, skippedMessageIds, labeledMessageIds, threadLogger, unlabeledUnread, threadId,
    languageMode
  }) {
    const ruleActions = {
      markHandledUnread: () => messageState.markHandledUnread(),
      markSkipped: (messagesToSkip, labelName) => deps._markMessagesAsSkipped(messagesToSkip, labelName, skippedMessageIds),
      markProcessedMessages: (messagesToProcess) => {
        (messagesToProcess || []).forEach((message) => deps._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds));
      },
      warn: (message) => threadLogger.warn(message)
    };
    const buildRuleContext = (overrides = {}) => {
      const gmailTargets = Object.assign({
        externalUnread: messageState.externalUnread,
        unlabeledUnread: unlabeledUnread
      }, overrides.gmailTargets || {});
      const actions = Object.assign({}, ruleActions, overrides.actions || {});
      const merged = Object.assign({
        threadId: threadId,
        languageMode: languageMode,
        candidate: messageState.candidate,
        externalUnread: messageState.externalUnread,
        unlabeledUnread: unlabeledUnread,
        skipLabelName: deps.config.skipLabelName,
        actions: actions,
        gmailTargets: gmailTargets
      }, overrides);
      merged.actions = actions;
      merged.gmailTargets = gmailTargets;
      return deps._createRuleContext_(merged);
    };

    return { buildRuleContext };
  },
  /** beforeExtraction: ingressi locali espliciti; restituisce i dati della fase. */
  beforeExtraction(deps, { myEmail, ownAddresses, messages, buildRuleContext, result, languageMode, messageState }) {
    const normalizedMyEmail = myEmail ? deps._normalizeEmailAddress_(myEmail) : '';
    const normalizedKnownAliases = Array.from(ownAddresses).filter(address => address && address !== normalizedMyEmail);
    const lastMessage = messages[messages.length - 1];
    const lastSenderRaw = lastMessage.getFrom() || '';
    const lastSenderEmail = (deps.gmailService && typeof deps.gmailService._extractEmailAddress === 'function')
      ? deps._normalizeEmailAddress_(deps.gmailService._extractEmailAddress(lastSenderRaw) || '')
      : '';
    const lastSpeakerIsUs = Boolean(lastSenderEmail) && ownAddresses.has(lastSenderEmail);

    const lastSpeakerDecision = deps._evaluatePreAiRules_(buildRuleContext({
      phase: 'pre_extract',
      lastSpeakerIsUs: lastSpeakerIsUs
    }));
    if (deps._applyPreAiRuleDecision_(lastSpeakerDecision, buildRuleContext({ phase: 'pre_extract' }), result)) {
      return { terminal: true };
    }

    // --- PORTA 0.5: Pre-check lingua locale sul soggetto (Costo API Zero) ---
    if (languageMode === 'foreign_only') {
      const subjectOnly = (messageState.candidate.getSubject() || '');
      let bodyPreview = '';
      try {
        bodyPreview = (messageState.candidate.getPlainBody && typeof messageState.candidate.getPlainBody === 'function')
          ? (messageState.candidate.getPlainBody() || '')
          : '';
      } catch (bodyError) {
        console.warn(`⚠️ Impossibile leggere body per pre-check lingua: ${bodyError.message}`);
      }
      if (subjectOnly.trim() !== '' && bodyPreview.trim() === '') {
        // Pre-controllo: solo termini inequivocabilmente italiani.
        // Escluse deliberatamente parole corte polisemiche (in, per, la, di, da, con, il, lo,
        // gli, le, un, uno, una, su, tra, fra) che causano falsi positivi su lingue straniere.
        const italianPattern = /(?:^|[^\p{L}\p{N}_])(appuntamento|fissare|prenotare|disponibilit[àa]|orari[oa]?|incontro|prenotazione|informazioni|chiedere|sapere|vorrei|come\s+faccio|requisiti|battesimo|cresima|confessione|grazie|salve|buongiorno|buonasera|preventivo|parrocchia|segreteria|messa|messe)(?=$|[^\p{L}\p{N}_])/iu;

        const languagePrecheckDecision = deps._evaluatePreAiRules_(buildRuleContext({
          phase: 'pre_extract',
          subject: subjectOnly,
          foreignOnlySubjectItalianPrecheck: italianPattern.test(subjectOnly)
        }));
        if (deps._applyPreAiRuleDecision_(languagePrecheckDecision, buildRuleContext({
          phase: 'pre_extract',
          subject: subjectOnly
        }), result)) {
          return { terminal: true };
        }
      }
    }

    return {  };
  },
  /** languageAndNewsletter: ingressi locali espliciti; restituisce i dati della fase. */
  languageAndNewsletter(deps, {
    messageDetails, languageMode, unlabeledUnread, skippedMessageIds, result, messageState,
    labeledMessageIds, buildRuleContext
  }) {
    const bodyForLanguageDetection = (deps.classifier && typeof deps.classifier._extractMainContent === 'function')
      ? deps.classifier._extractMainContent(messageDetails.body || '')
      : (messageDetails.body || '');

    const languageDetection = (deps.geminiService && typeof deps.geminiService.detectEmailLanguage === 'function')
      ? (deps.geminiService.detectEmailLanguage(
        bodyForLanguageDetection || messageDetails.body || '',
        messageDetails.subject
      ) || {})
      : { lang: 'unknown' };

    // Estraiamo solo codici ISO a 2 lettere per gestire formati come "it-IT" o "en-US".
    let detectedLanguage = deps._normalizeLanguageCode_(languageDetection.lang, 'unknown');
    if (bodyForLanguageDetection !== (messageDetails.body || '')) {
      console.log('   ✂️ Lingua: uso corpo pulito (senza firma/citazioni) per ridurre falsi positivi');
    }
    console.log(`   🌐 Lingua (rilevamento locale): ${detectedLanguage.toUpperCase()}`);

    // PORTA 1: Interrompiamo se l'email deve essere ignorata in base alla lingua
    if (shouldSkipByLanguageMode_(detectedLanguage, languageMode)) {
      console.log('   ⊖ Saltato: modalità "Solo straniere", email in italiano');
      // Nota di manutenzione: il punto medio ('·') ha un significato preciso.
      // Qui segnala una email italiana solo temporaneamente rinviata perché
      // la modalità corrente risponde alle sole email straniere. Non va marcata IA:
      // quando si torna a "Tutte le lingue", deve rientrare tra le email lavorabili.
      deps._markMessagesAsSkipped(unlabeledUnread, deps.config.skipLabelName, skippedMessageIds);
      result.status = 'skipped';
      result.reason = 'italian_skipped_foreign_only';
      return { terminal: true };
    }

    // Le newsletter sono filtrate in modo definitivo: usiamo IA per non riprenderle
    // nei run successivi. Il punto medio ('·') non si usa qui perché non è un
    // rinvio temporaneo dovuto alla modalità "Solo straniere".
    let newsletterMessagesToMark = (unlabeledUnread && unlabeledUnread.length > 0) ? unlabeledUnread : [messageState.candidate];
    // Evita di "demotare" messaggi già IA quando il fallback usa candidate.
    newsletterMessagesToMark = (newsletterMessagesToMark || []).filter((message) => {
      if (!message || typeof message.getId !== 'function') return false;
      const messageId = message.getId();
      return !(labeledMessageIds instanceof Set && labeledMessageIds.has(messageId));
    });
    const newsletterDecision = deps._evaluatePreAiRules_(buildRuleContext({
      phase: 'post_extract_pre_ai',
      isNewsletter: messageDetails.isNewsletter,
      gmailTargets: { newsletterMessagesToMark: newsletterMessagesToMark }
    }));
    if (deps._applyPreAiRuleDecision_(newsletterDecision, buildRuleContext({
      phase: 'post_extract_pre_ai',
      isNewsletter: messageDetails.isNewsletter,
      gmailTargets: { newsletterMessagesToMark: newsletterMessagesToMark }
    }), result)) {
      return { terminal: true };
    }

    return { bodyForLanguageDetection, languageDetection, detectedLanguage };
  },
  /** throttle: ingressi locali espliciti; restituisce i dati della fase. */
  throttle(deps, { messageDetails, lockCtx, threadLogger, result }) {
    const safeSenderEmail = (messageDetails.senderEmail || '').toLowerCase();
    const senderThrottleWindowSeconds = (typeof CONFIG !== 'undefined' && CONFIG.SENDER_THROTTLE_WINDOW_SECONDS)
      ? CONFIG.SENDER_THROTTLE_WINDOW_SECONDS
      : 60;
    const senderThrottleKey = `sender_throttle_${safeSenderEmail || 'unknown'}`;
    const senderThrottleCache = lockCtx && lockCtx.cache ? lockCtx.cache : null;
    if (senderThrottleCache && safeSenderEmail && typeof LockService !== 'undefined' && LockService && typeof LockService.getScriptLock === 'function') {
      let senderThrottleAlreadySet = false;
      const senderThrottleLock = LockService.getScriptLock();
      let senderThrottleLockAcquired = false;
      try {
        senderThrottleLockAcquired = senderThrottleLock.tryLock(500);
        if (senderThrottleLockAcquired) {
          senderThrottleAlreadySet = Boolean(senderThrottleCache.get(senderThrottleKey));
          if (!senderThrottleAlreadySet) {
            senderThrottleCache.put(senderThrottleKey, '1', senderThrottleWindowSeconds);
          }
        } else {
          // Fallback best-effort: in assenza lock evitiamo di bloccare il flusso.
          senderThrottleAlreadySet = Boolean(senderThrottleCache.get(senderThrottleKey));
          if (!senderThrottleAlreadySet) {
            senderThrottleCache.put(senderThrottleKey, '1', senderThrottleWindowSeconds);
          }
          threadLogger.warn('Sender throttle lock non acquisito, applicazione in modalità best-effort');
        }
      } finally {
        if (senderThrottleLockAcquired && senderThrottleLock && typeof senderThrottleLock.releaseLock === 'function') {
          try {
            senderThrottleLock.releaseLock();
          } catch (_) { }
        }
      }

      if (senderThrottleAlreadySet) {
        console.log(`   ⏳ Dilata: burst cross-thread rilevato per ${safeSenderEmail || 'mittente sconosciuto'}; riprovo in un batch successivo`);
        result.status = 'dilata';
        result.reason = 'cross_thread_burst';
        return { terminal: true };
      }
    }

    return {  };
  },
  /** automaticReplies: ingressi locali espliciti; restituisce i dati della fase. */
  automaticReplies(deps, { messageDetails, buildRuleContext, result, messages, messageState, ownAddresses }) {
    const headers = messageDetails.headers || {};
    // Lookup case-insensitive: i server SMTP possono restituire header in casing arbitrario
    const getHeader = (name) => {
      const lower = name.toLowerCase();
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower) return headers[key];
      }
      return '';
    };
    const autoSubmitted = getHeader('auto-submitted');
    const precedence = getHeader('precedence');
    const xAutoReply = getHeader('x-autoreply');
    const xAutoResponseSuppress = getHeader('x-auto-response-suppress');

    const isAutoReplyHeader = (
      /auto-replied|auto-generated/i.test(autoSubmitted) ||
      /bulk|auto_reply/i.test(precedence) ||
      /auto-reply|autoreply/i.test(xAutoReply) ||
      /oof|all|dr|rn|nri|auto/i.test(xAutoResponseSuppress)
    );
    const autoReplyHeaderDecision = deps._evaluatePreAiRules_(buildRuleContext({
      phase: 'post_extract_pre_ai',
      isAutoReplyHeader: isAutoReplyHeader
    }));
    if (deps._applyPreAiRuleDecision_(autoReplyHeaderDecision, buildRuleContext({
      phase: 'post_extract_pre_ai',
      isAutoReplyHeader: isAutoReplyHeader
    }), result)) {
      return { terminal: true };
    }

    const outOfOfficePatterns = [
      /\b(out of office|away from office|fuori ufficio)\b/i,
      /\b(sono\s+assente|sarò\s+assente|resterò\s+assente|sar[oò]\s+fuori)\b/i,
      /\b(automatic reply|risposta automatica)\b/i,
      /\breturn(ing)? on\b/i,
      /\b(mailbox (?:is )?monitored periodically|casella (?:di posta )?(?:e )?consultata periodicamente)\b/i
    ];

    const oooSubject = messageDetails.subject || '';
    // Trunca a 2000 char per prevenire Regex Timeout su mega-thread
    const oooBody = (messageDetails.body || '').substring(0, 2000);
    const isOutOfOfficeText = outOfOfficePatterns.some(p => p.test(`${oooSubject} ${oooBody}`));
    const outOfOfficeTextDecision = deps._evaluatePreAiRules_(buildRuleContext({
      phase: 'post_extract_pre_ai',
      isOutOfOfficeText: isOutOfOfficeText
    }));
    if (deps._applyPreAiRuleDecision_(outOfOfficeTextDecision, buildRuleContext({
      phase: 'post_extract_pre_ai',
      isOutOfOfficeText: isOutOfOfficeText
    }), result)) {
      return { terminal: true };
    }

    const candidateIndex = messages.findIndex(msg => msg.getId() === messageState.candidate.getId());
    let shortClosureReplyDetected = false;
    if (candidateIndex > 0 && messages[candidateIndex - 1]) {
      const previousMessage = messages[candidateIndex - 1];
      const previousSenderEmail = (deps.gmailService && typeof deps.gmailService._extractEmailAddress === 'function')
        ? deps._normalizeEmailAddress_(deps.gmailService._extractEmailAddress(previousMessage.getFrom() || '') || '')
        : '';
      const candidateDate = messageDetails.date ? messageDetails.date.getTime() : null;
      const previousDate = previousMessage.getDate() ? previousMessage.getDate().getTime() : null;
      const arrivedSoonAfterUs = candidateDate && previousDate
        ? Math.abs(candidateDate - previousDate) <= 10 * 60 * 1000
        : false;
      const previousIsUs = Boolean(previousSenderEmail) && ownAddresses.has(previousSenderEmail);
      const candidateBody = messageDetails.body || '';
      const candidateWords = candidateBody.trim().split(/\s+/).filter(Boolean);
      const hasThanksCue = /\b(grazie|ok|perfetto|ricevuto)\b/i.test(candidateBody);
      const hasQuestionSignal = /\?|\b(quando|come|dove|quale|quali|perché|perche|posso|potete|mi\s+serve|vorrei)\b/i
        .test(candidateBody);
      const isShortClosureReply = candidateWords.length > 0 && candidateWords.length <= 4 &&
        hasThanksCue && !hasQuestionSignal;

      shortClosureReplyDetected = Boolean(previousIsUs && arrivedSoonAfterUs && isShortClosureReply);
    }
    const shortClosureDecision = deps._evaluatePreAiRules_(buildRuleContext({
      phase: 'post_extract_pre_ai',
      isShortClosureReply: shortClosureReplyDetected
    }));
    if (deps._applyPreAiRuleDecision_(shortClosureDecision, buildRuleContext({
      phase: 'post_extract_pre_ai',
      isShortClosureReply: shortClosureReplyDetected
    }), result)) {
      return { terminal: true };
    }

    return {  };
  },
  /** loopAndSender: ingressi locali espliciti; restituisce i dati della fase. */
  loopAndSender(deps, { messages, ownAddresses, messageState, messageDetails, result, buildRuleContext }) {
    const MAX_THREAD_LENGTH = (typeof CONFIG !== 'undefined' && CONFIG.MAX_THREAD_LENGTH) ? CONFIG.MAX_THREAD_LENGTH : 8;
    const MAX_CONSECUTIVE_EXTERNAL = deps.config.maxConsecutiveExternal;

    let consecutiveExternal = 0;
    let botRepliesCount = 0;
    let totalBotRepliesInThread = 0;
    const maxBotRepliesInLongThread = Math.max(2, Math.floor(MAX_THREAD_LENGTH / 2));

    // Percorriamo una finestra degli ultimi MAX_THREAD_LENGTH messaggi a ritroso
    // per contare sequenze esterne e densità di risposte del bot.
    const startIndex = Math.max(0, messages.length - MAX_THREAD_LENGTH);
    for (let i = messages.length - 1; i >= startIndex; i--) {
      const rawFrom = messages[i] && typeof messages[i].getFrom === 'function'
        ? messages[i].getFrom()
        : '';
      const msgFrom = String(rawFrom || '');
      const msgSenderEmail = (deps.gmailService && typeof deps.gmailService._extractEmailAddress === 'function')
        ? deps._normalizeEmailAddress_(deps.gmailService._extractEmailAddress(msgFrom) || '')
        : deps._normalizeEmailAddress_(msgFrom);

      const isUs = Boolean(msgSenderEmail) && ownAddresses.has(msgSenderEmail);

      if (isUs) {
        botRepliesCount++;
        totalBotRepliesInThread++;
        consecutiveExternal = 0;
      } else {
        consecutiveExternal++;
        botRepliesCount = 0;
      }

      if (
        botRepliesCount >= MAX_CONSECUTIVE_EXTERNAL ||
        (messages.length > MAX_THREAD_LENGTH && totalBotRepliesInThread > maxBotRepliesInLongThread)
      ) {
        console.log(`   ⊖ Saltato: prevenzione loop email attivata (ping-pong/thread ripetitivo: interventiBot=${totalBotRepliesInThread}, sogliaBot=${maxBotRepliesInLongThread}, consecutivi=${Math.max(consecutiveExternal, botRepliesCount)})`);
        messageState.markFailureForCurrentBurst('validation', { reason: 'possible_email_loop', subject: messageDetails.subject }, false);
        result.status = 'validation_failed';
        result.reason = 'possible_email_loop';
        return { terminal: true };
      }
    }

    if (messages.length > MAX_THREAD_LENGTH) {
      console.warn(`   ⚠️ Thread lungo (${messages.length} messaggi) ma non loop - elaboro`);
    }

    // ====================================================================
    // STEP 0.8: ANTI-MITTENTE-NOREPLY
    // ====================================================================
    const originalSenderEmail = (
      deps.gmailService && typeof deps.gmailService._extractEmailAddress === 'function'
    )
      ? deps.gmailService._extractEmailAddress(messageDetails.originalFrom || '')
      : (messageDetails.senderEmail || '');
    const senderInfo = `${originalSenderEmail} ${messageDetails.senderName}`.toLowerCase();
    const autoPattern = /no-reply|do-not-reply|noreply|daemon|postmaster|bounce|mailer/i;
    const noReplyDecision = deps._evaluatePreAiRules_(buildRuleContext({
      phase: 'post_extract_pre_ai',
      isNoReplySender: autoPattern.test(senderInfo) && !messageDetails.hasReplyTo
    }));
    if (deps._applyPreAiRuleDecision_(noReplyDecision, buildRuleContext({
      phase: 'post_extract_pre_ai',
      isNoReplySender: autoPattern.test(senderInfo) && !messageDetails.hasReplyTo
    }), result)) {
      return { terminal: true };
    }

    // ====================================================================
    // STEP 1: FILTRO - Domini/parole chiave ignorati
    // ====================================================================
    const shouldIgnoreEmail = deps._shouldIgnoreEmail(messageDetails);
    const ignoreDecision = deps._evaluatePreAiRules_(buildRuleContext({
      phase: 'post_extract_pre_ai',
      shouldIgnoreEmail: shouldIgnoreEmail
    }));
    if (deps._applyPreAiRuleDecision_(ignoreDecision, buildRuleContext({
      phase: 'post_extract_pre_ai',
      shouldIgnoreEmail: shouldIgnoreEmail
    }), result)) {
      return { terminal: true };
    }

    return {  };
  },
  /** classify: ingressi locali espliciti; restituisce i dati della fase. */
  classify(deps, { messageDetails, buildRuleContext, result }) {
    const MAX_SUBJECT_LENGTH = 1000;
    const safeSubject = (messageDetails.subject || '').substring(0, MAX_SUBJECT_LENGTH);
    const safeBody = (messageDetails.body || '');
    const isReplyPattern = /^(re|rif|r|ris|risp|aw|sv|fw|fwd|tr|i|wg|inc)\s*[:\-]/i;
    const isReplyBySubject = isReplyPattern.test(safeSubject.toLowerCase());

    const classification = deps.classifier.classifyEmail(
      safeSubject,
      safeBody,
      isReplyBySubject
    );

    const classifierDecision = deps._evaluatePreAiRules_(buildRuleContext({
      phase: 'post_extract_pre_ai',
      classifierShouldReply: classification.shouldReply,
      classifierReason: classification.reason
    }));
    if (deps._applyPreAiRuleDecision_(classifierDecision, buildRuleContext({
      phase: 'post_extract_pre_ai',
      classifierShouldReply: classification.shouldReply,
      classifierReason: classification.reason
    }), result)) {
      return { terminal: true };
    }

    return { safeSubject, isReplyBySubject, classification };
  },
  /** quickCheck: ingressi locali espliciti; restituisce i dati della fase. */
  quickCheck(deps, {
    messageDetails, detectedLanguage, threadId, messages, messageState, ownAddresses, languageDetection,
    threadLogger, result, languageMode, unlabeledUnread, skippedMessageIds
  }) {
    let quickCheck;

    const preQuickAttachmentIntentContext = deps._deriveAttachmentIntentContext_(
      messageDetails.body,
      messageDetails.subject,
      [],
      '',
      'pre_ocr'
    );
    const sponsorGuidancePrecheck = deps._classifySponsorGuidanceLocally_(
      messageDetails.subject,
      messageDetails.body,
      preQuickAttachmentIntentContext,
      detectedLanguage
    );
    const memoryContext = deps.memoryService.getMemory(threadId) || {};
    const ownConversationAnchor = deps._getOwnConversationAnchor_(messages, messageState.candidate, ownAddresses);
    const hasPriorOwnMessage = ownConversationAnchor.exists === true;
    const memoryMessageCount = Number.isFinite(Number(memoryContext.messageCount))
      ? Number(memoryContext.messageCount)
      : 0;
    const memoryContextualFlags = (memoryContext.contextualFlags && typeof memoryContext.contextualFlags === 'object')
      ? memoryContext.contextualFlags
      : {};
    const hasConversationContext = Boolean(
      hasPriorOwnMessage ||
      memoryMessageCount > 0 ||
      memoryContext.exists === true ||
      !!memoryContext.lastUpdated ||
      !!memoryContext.memorySummary ||
      !!memoryContext.conversationState ||
      Object.keys(memoryContextualFlags).length > 0 ||
      (Array.isArray(memoryContext.providedInfo) && memoryContext.providedInfo.length > 0)
    );
    console.log(`   🧠 QuickCheck context: ${hasConversationContext ? 'thread' : 'first_message'}`);
    console.log(`   🧠 Conversational fields: ${hasConversationContext ? 'enabled' : 'neutral defaults'}`);

    const quickIntentContext = Object.assign(
      {},
      preQuickAttachmentIntentContext || {},
      {
        sponsorGuidanceCheck: sponsorGuidancePrecheck === 'ask_ai',
        sponsorGuidanceLocalDecision: sponsorGuidancePrecheck,
        hasConversationContext: hasConversationContext,
        quickMemoryContext: hasConversationContext
          ? deps._buildQuickCheckMemoryContext_(memoryContext)
          : null
      }
    );

    try {
      quickCheck = deps.geminiService.shouldRespondToEmail(
        messageDetails.body,
        messageDetails.subject,
        languageDetection,
        quickIntentContext
      );
    } catch (quickError) {
      const quickErrorClass = deps._classifyError(quickError);
      const quickErrorMessage = quickError && quickError.message ? quickError.message : String(quickError);
      const isSystemic = quickErrorClass.type === 'SYSTEM_ERROR' || quickErrorClass.type === 'CONFIG_ERROR' || quickErrorClass.type === 'INVALID_API_KEY' || /\b(401|403|404)\b/.test(quickErrorMessage);
      if (!quickErrorClass.retryable && !isSystemic) {
        console.warn(`   ⚠️ Gemini quick check fallito: ${quickErrorMessage}. Applico etichetta errore al burst corrente per evitare loop.`);
        try {
          messageState.markFailureForCurrentBurst('error');
        } catch (markError) {
          threadLogger.warn(`Errore label quick-check silenziato: ${markError.message}`);
        }
      } else {
        console.warn(`   ↻ Gemini quick check fallito con errore retryable o di sistema (${quickErrorClass.type}): ${quickErrorMessage}. Nessuna label permanente.`);
      }
      result.status = 'error';
      result.error = `quick_check_failed: ${quickErrorMessage}`;
      result.errorClass = isSystemic ? 'SYSTEM_ERROR' : quickErrorClass.type;
      return { terminal: true };
    }

    if (!quickCheck || typeof quickCheck !== 'object') {
      console.warn('   ⚠️ Gemini quick check ha restituito una risposta vuota/non valida: applico etichetta errore al burst corrente per evitare loop.');
      try {
        messageState.markFailureForCurrentBurst('error');
      } catch (markError) {
        threadLogger.warn(`Errore label quick-check non valido silenziato: ${markError.message}`);
      }
      result.status = 'error';
      result.error = 'quick_check_failed';
      return { terminal: true };
    }

    // Se Gemini Quick Check ha rilevato una lingua diversa con maggiore precisione, aggiorniamo
    const quickCheckLanguage = deps._normalizeLanguageCode_(quickCheck.language, '');
    if (quickCheckLanguage && quickCheckLanguage !== detectedLanguage) {
      detectedLanguage = quickCheckLanguage;
      console.log(`   🌐 Lingua (aggiornata da AI): ${detectedLanguage.toUpperCase()}`);
    }

    // Valutazione preliminare della lingua per il filtraggio selettivo.
    if (shouldSkipByLanguageMode_(detectedLanguage, languageMode)) {
      console.log('   ⊖ Saltato: modalità "Solo straniere", lingua italiana confermata dopo quick-check');
      deps._markMessagesAsSkipped(unlabeledUnread, deps.config.skipLabelName, skippedMessageIds);
      result.status = 'skipped';
      result.reason = 'italian_skipped_foreign_only_post_quickcheck';
      return { terminal: true };
    }

    if (!quickCheck.shouldRespond) {
      console.log(`   ⊖ Gemini quick check: nessuna risposta necessaria (${quickCheck.reason})`);
      if (quickCheck.reason === 'quick_check_failed') {
        console.warn('   ⚠️ Gemini quick check fallito: applico etichetta errore al burst corrente per evitare retry infiniti.');
        try {
          messageState.markFailureForCurrentBurst('error');
        } catch (markError) {
          threadLogger.warn(`Errore label quick-check failed silenziato: ${markError.message}`);
        }
        result.status = 'error';
        result.error = 'quick_check_failed';
        return { terminal: true };
      }
      // Il quick check riceve il corpo accorpato del burst quando esistono piu'
      // messaggi ravvicinati: se decide NO_REPLY, chiudiamo l'intero blocco
      // per evitare rielaborazioni retrograde dei messaggi precedenti.
      messageState.markHandledUnread();
      result.status = 'filtered';
      return { terminal: true };
    }

    const quickAttachmentIntent = deps._resolveQuickCheckAttachmentIntent_(quickCheck);
    if (quickAttachmentIntent && quickAttachmentIntent.requires_attachment_reading) {
      console.log(`   📎 QuickCheck attachment intent: lettura allegati richiesta se presenti (${quickAttachmentIntent.reason || 'segnale documentale'})`);
    }
    const quickDocumentDelivery = deps._resolveQuickCheckDocumentDelivery_(quickCheck);
    if (quickDocumentDelivery && quickDocumentDelivery.expected_document) {
      console.log(`   📎 QuickCheck document delivery: documento atteso via ${quickDocumentDelivery.delivery_channel || 'unclear'} (${quickDocumentDelivery.reason || quickDocumentDelivery.expected_document_description || 'segnale documentale'})`);
    }

    const processingTimestamp = new Date();
    const physicalPresenceConstraint = deps._reconcilePhysicalPresenceConstraint_(
      quickCheck.physical_presence_constraint,
      messageDetails.subject,
      messageDetails.body,
      memoryContext,
      processingTimestamp
    );
    if (physicalPresenceConstraint && physicalPresenceConstraint.has_constraint) {
      console.log(
        `   Vincolo presenza fisica rilevato (${physicalPresenceConstraint.type}, ` +
        `policy=${physicalPresenceConstraint.visit_policy}, source=${physicalPresenceConstraint.source})`
      );
    }

    return {
      quickCheck, preQuickAttachmentIntentContext, memoryContext, ownConversationAnchor,
      hasPriorOwnMessage, memoryMessageCount, memoryContextualFlags, quickAttachmentIntent,
      quickDocumentDelivery, processingTimestamp, physicalPresenceConstraint, detectedLanguage
    };
  },
};
