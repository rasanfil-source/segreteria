/**
 * EmailProcessor.js - Orchestratore Pipeline Email
 * 
 * PIPELINE ELABORAZIONE:
 * 1. FILTRA: Dobbiamo processare questa email?
 * 2. CLASSIFICA: Che tipo di richiesta è?
 * 3. GENERA: Crea risposta AI
 * 4. VALIDA: Controlla qualità risposta
 * 5. INVIA: Rispondi all'email
 * 
 * FUNZIONALITÀ AVANZATE:
 * - Lock a livello thread (anti race condition)
 * - Anti-loop detection
 * - Salutation mode (full/soft/none_or_continuity/session)
 * - KB enrichment condizionale
 * - Memory tracking
 */

class EmailProcessor {
  constructor(options = {}) {
    // Logger strutturato
    this.logger = (typeof createLogger === 'function')
      ? createLogger('EmailProcessor')
      : {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args),
        debug: (...args) => console.log(...args)
      };
    this.logger.info('Inizializzazione EmailProcessor');

    // Inietta dipendenze o crea default
    this.geminiService = options.geminiService || new GeminiService();
    this.classifier = options.classifier || new Classifier();
    this.requestClassifier = options.requestClassifier || new RequestTypeClassifier();
    this.validator = options.validator || new ResponseValidator();
    this.gmailService = options.gmailService || new GmailService();
    this.promptEngine = options.promptEngine || new PromptEngine();
    this.memoryService = options.memoryService || new MemoryService();
    // Integrazione TerritoryValidator
    this.territoryValidator = options.territoryValidator || (typeof TerritoryValidator !== 'undefined' ? new TerritoryValidator() : null);

    // Configurazione
    this.config = {
      validationEnabled: typeof CONFIG !== 'undefined' ? CONFIG.VALIDATION_ENABLED : true,
      dryRun: typeof CONFIG !== 'undefined' ? CONFIG.DRY_RUN : false,
      maxEmailsPerRun: typeof CONFIG !== 'undefined' ? CONFIG.MAX_EMAILS_PER_RUN : 10,
      maxExecutionTimeMs: typeof CONFIG !== 'undefined' && CONFIG.MAX_EXECUTION_TIME_MS
        ? CONFIG.MAX_EXECUTION_TIME_MS
        : 280 * 1000,
      minRemainingTimeMs: typeof CONFIG !== 'undefined' && typeof CONFIG.MIN_REMAINING_TIME_MS === 'number'
        ? CONFIG.MIN_REMAINING_TIME_MS
        : 90 * 1000,
      labelName: typeof CONFIG !== 'undefined' ? CONFIG.LABEL_NAME : 'IA',
      errorLabelName: typeof CONFIG !== 'undefined' ? CONFIG.ERROR_LABEL_NAME : 'Errore',
      validationErrorLabel: typeof CONFIG !== 'undefined' ? CONFIG.VALIDATION_ERROR_LABEL : 'Verifica',
      validationWarningThreshold: typeof CONFIG !== 'undefined' && typeof CONFIG.VALIDATION_WARNING_THRESHOLD === 'number'
        ? CONFIG.VALIDATION_WARNING_THRESHOLD
        : 0.9
    };

    this.logger.info('EmailProcessor inizializzato', {
      validazione: this.config.validationEnabled,
      dryRun: this.config.dryRun
    });
  }

  /**
   * Elabora il singolo thread (analisi, categorizzazione, generazione risposta, invio)
   * @param {GmailThread} thread 
   * @param {string} knowledgeBase - KB testo semplice
   * @param {Array} doctrineBase - KB strutturata
   * @param {Set} labeledMessageIds - ID messaggi già etichettati (opzionale)
   * @param {boolean} skipLock - Se true, salta acquisizione lock
   */
  processThread(thread, knowledgeBase, doctrineBase, labeledMessageIds = new Set(), skipLock = false) {
    const threadId = thread.getId();

    // ====================================================================================================
    // ACQUISIZIONE LOCK (LIVELLO-THREAD) - Previene condizioni di conflitto
    // ====================================================================================================

    var lockAcquired = false;
    var scriptCache = CacheService.getScriptCache();
    var threadLockKey = `thread_lock_${threadId}`;
    var lockValue = null;

    if (skipLock) {
      console.log(`🔒 Lock saltato per thread ${threadId} (chiamante ha già lock)`);
    } else {
      const ttlSeconds = (typeof CONFIG !== 'undefined' && CONFIG.CACHE_LOCK_TTL) ? CONFIG.CACHE_LOCK_TTL : 30;
      const lockTtlMs = ttlSeconds * 1000;
      lockValue = Date.now().toString();

      // 1. Controllo preliminare (fallimento rapido)
      const existingLock = scriptCache.get(threadLockKey);
      if (existingLock) {
        const existingTimestamp = Number(existingLock);
        const isStale = !isNaN(existingTimestamp) && (Date.now() - existingTimestamp) > lockTtlMs;

        if (isStale) {
          console.warn(`🔓 Lock stale rilevato per thread ${threadId}, pulizia`);
          scriptCache.remove(threadLockKey);
        } else {
          console.warn(`🔒 Thread ${threadId} lockato da altro processo, salto`);
          return { status: 'skipped', reason: 'thread_locked' };
        }
      }

      // 2. Acquisizione lock
      try {
        scriptCache.put(threadLockKey, lockValue, ttlSeconds);

        // 3. Pausa per rilevare conflitti
        const raceSleep = (typeof CONFIG !== 'undefined' && CONFIG.CACHE_RACE_SLEEP_MS) ? CONFIG.CACHE_RACE_SLEEP_MS : 200;
        Utilities.sleep(raceSleep);

        // 4. Doppio controllo
        const checkValue = scriptCache.get(threadLockKey);
        if (checkValue !== lockValue) {
          console.warn(`🔒 Race rilevata per thread ${threadId}: atteso ${lockValue}, ottenuto ${checkValue}`);
          return { status: 'skipped', reason: 'thread_locked_race' };
        }

        lockAcquired = true;
        console.log(`🔒 Lock acquisito per thread ${threadId}`);
      } catch (e) {
        console.warn(`⚠️ Errore acquisizione lock: ${e.message}`);
        return { status: 'error', error: 'Lock acquisition failed' };
      }
    }

    const result = {
      status: 'unknown',
      validationFailed: false,
      dryRun: false,
      error: null
    };

    // Snapshot robusto del classificatore errori per evitare dipendenze implicite da `this`
    const classifyError = (this && typeof this._classifyError === 'function')
      ? this._classifyError.bind(this)
      : function fallbackClassifyError() { return 'UNKNOWN'; };

    let candidate = null;
    try {
      // Raccogli informazioni su thread e messaggi
      const currentLabels = (thread.getLabels() || []).map(l => l.getName());
      const hasProcessedLabel = currentLabels.includes(this.config.labelName);

      // Ottieni ultimo messaggio NON LETTO nel thread
      const messages = thread.getMessages();
      const unreadMessages = messages.filter(m => m.isUnread());

      // Recupero indirizzo email corrente con fallback
      let myEmail = '';
      try {
        const effectiveUser = Session.getEffectiveUser();
        myEmail = effectiveUser ? effectiveUser.getEmail() : '';

        if (!myEmail) {
          const activeUser = Session.getActiveUser();
          myEmail = activeUser ? activeUser.getEmail() : '';
        }
      } catch (e) {
        console.warn(`⚠️ Impossibile recuperare email utente: ${e.message}`);
      }

      // ====================================================================================================
      // FILTRO A LIVELLO MESSAGGIO
      // ====================================================================================================
      const effectiveLabeledIds = (labeledMessageIds && labeledMessageIds.size > 0)
        ? labeledMessageIds
        : this.gmailService.getMessageIdsWithLabel(this.config.labelName);

      const unlabeledUnread = unreadMessages.filter(message => {
        return !effectiveLabeledIds.has(message.getId());
      });

      // Solo messaggi da mittenti esterni
      // NOTA: Se senderEmail è null/vacante (es. estrazione fallita), lo lasciamo passare
      // per evitare perdite silenziose. Sarà gestito/validato negli step successivi.
      const externalUnread = unlabeledUnread.filter(message => {
        const details = this.gmailService.extractMessageDetails(message);
        // Navigazione sicura
        const senderEmail = (details.senderEmail || '');

        // Se non riusciamo ad estrarre l'email, consideriamo il mittente come esterno per sicurezza
        if (!senderEmail) return true;
        return senderEmail.toLowerCase() !== myEmail.toLowerCase();
      });

      // GUARDRAIL (critico): se un messaggio è già stato etichettati IA, non deve
      // rientrare nel ciclo di risposta automatica anche se il thread è ancora aperto.
      // Questo evita doppie risposte su stesso messaggio.
      // Se non ci sono messaggi non letti non ancora etichettati → skip
      if (unlabeledUnread.length === 0) {
        console.log('   ⊖ Thread già elaborato (nessun nuovo messaggio non letto)');
        result.status = 'skipped';
        result.reason = 'already_labeled_no_new_unread';
        return result;
      }

      // GUARDRAIL (critico): rispondiamo solo a mittenti esterni.
      // I messaggi interni (noi/alias) vengono esclusi per evitare loop e risposte non dovute.
      // Se non ci sono messaggi da esterni → skip
      if (externalUnread.length === 0) {
        console.log('   ⊖ Saltato: nessun nuovo messaggio esterno non letto');
        unlabeledUnread.forEach(message => this._markMessageAsProcessed(message));
        result.status = 'skipped';
        result.reason = 'no_external_unread';
        return result;
      }

      // Seleziona ultimo messaggio non letto non etichettato da esterni
      candidate = externalUnread[externalUnread.length - 1];
      const messageDetails = this.gmailService.extractMessageDetails(candidate);

      console.log(`\n📧 Elaborazione: ${(messageDetails.subject || '').substring(0, 50)}...`);
      console.log(`   Da: ${messageDetails.senderEmail} (${messageDetails.senderName})`);


      if (messageDetails.isNewsletter) {
        console.log('   ⊖ Saltato: rilevata newsletter (List-Unsubscribe/Precedence)');
        this._markMessageAsProcessed(candidate);
        result.status = 'filtered';
        result.reason = 'newsletter_header';
        return result;
      }

      // ====================================================================================================
      // STEP 0: CONTROLLO ULTIMO MITTENTE (Anti-Loop & Ownership)
      // GUARDRAIL (critico): se l'ultimo intervento nel thread è nostro,
      // il bot NON deve inviare un'altra risposta. Si attende il prossimo messaggio utente.
      // ====================================================================================================
      const lastMessage = messages[messages.length - 1];
      const lastSender = (lastMessage.getFrom() || '').toLowerCase();

      if (myEmail && lastSender.includes(myEmail.toLowerCase())) {
        console.log('   ⊖ Saltato: l\'ultimo messaggio del thread è già nostro (bot o segreteria)');
        // Non marchiamo nulla, semplicemente ci fermiamo finché l'utente non risponde
        result.status = 'skipped';
        result.reason = 'last_speaker_is_me';
        return result;
      }

      // ====================================================================================================
      // STEP 0.1: ANTI-AUTO-RISPOSTA (Safe Sender Check)
      // ====================================================================================================
      const safeSenderEmail = (messageDetails.senderEmail || '').toLowerCase();

      // Controllo esteso per alias conosciuti
      const knownAliases = (typeof CONFIG !== 'undefined' && CONFIG.KNOWN_ALIASES) ? CONFIG.KNOWN_ALIASES : [];
      const normalizedMyEmail = myEmail ? myEmail.toLowerCase() : '';

      // Verifica mittente: usa myEmail calcolata in modo sicuro
      const isMe = Boolean(normalizedMyEmail) && (
        safeSenderEmail === normalizedMyEmail ||
        knownAliases.some(alias => safeSenderEmail === alias.toLowerCase())
      );

      if (isMe) {
        console.log('   ⊖ Saltato: messaggio auto-inviato (o da alias conosciuto)');
        this._markMessageAsProcessed(candidate);
        result.status = 'skipped';
        result.reason = 'self_sent';
        return result;
      }

      // ====================================================================================================
      // STEP 0.2: AUTO-REPLY / OUT-OF-OFFICE DETECTION
      // ====================================================================================================
      const headers = messageDetails.headers || {};
      const autoSubmitted = headers['auto-submitted'] || '';
      const precedence = headers['precedence'] || '';
      const xAutoReply = headers['x-autoreply'] || '';
      const xAutoResponseSuppress = headers['x-auto-response-suppress'] || '';

      if (
        /auto-replied/i.test(autoSubmitted) ||
        /bulk|auto_reply/i.test(precedence) ||
        /auto-reply|autoreply/i.test(xAutoReply) ||
        /oof|all|dr|rn|nri|auto/i.test(xAutoResponseSuppress)
      ) {
        console.log('   ⊖ Saltato: risposta automatica (header SMTP)');
        this._markMessageAsProcessed(candidate);
        result.status = 'filtered';
        result.reason = 'out_of_office';
        return result;
      }

      const outOfOfficePatterns = [
        /\b(out of office|away from office|fuori ufficio|assente)\b/i,
        /\b(automatic reply|risposta automatica)\b/i,
        /\breturn(ing)? on\b/i,
        /\bdi ritorno (il|dal)\b/i,
        /\b(thank you for your message|mailbox monitored periodically|messaggio ricevuto)\b/i
      ];

      if (outOfOfficePatterns.some(p => p.test(`${messageDetails.subject} ${messageDetails.body}`))) {
        console.log('   ⊖ Saltato: risposta automatica out-of-office (testo)');
        this._markMessageAsProcessed(candidate);
        result.status = 'filtered';
        result.reason = 'out_of_office';
        return result;
      }

      const candidateIndex = messages.findIndex(msg => msg.getId() === candidate.getId());
      if (candidateIndex > 0 && messages[candidateIndex - 1]) {
        const previousMessage = messages[candidateIndex - 1];
        const previousSender = (previousMessage.getFrom() || '').toLowerCase();
        const candidateDate = messageDetails.date ? messageDetails.date.getTime() : null;
        const previousDate = previousMessage.getDate() ? previousMessage.getDate().getTime() : null;
        const arrivedSoonAfterUs = candidateDate && previousDate
          ? (candidateDate - previousDate) <= 10 * 60 * 1000
          : false;
        const previousIsUs = myEmail ? previousSender.includes(myEmail.toLowerCase()) : false;
        const candidateBody = messageDetails.body || '';
        const candidateWords = candidateBody.trim().split(/\s+/).filter(Boolean);
        const isShortClosureReply = candidateWords.length > 0 && candidateWords.length < 10 &&
          /\b(grazie|ok|perfetto)\b/i.test(candidateBody);

        if (previousIsUs && arrivedSoonAfterUs && isShortClosureReply) {
          console.log('   ⊖ Saltato: risposta breve di chiusura (grazie/ok/perfetto)');
          this._markMessageAsProcessed(candidate);
          result.status = 'filtered';
          result.reason = 'short_closure_reply';
          return result;
        }
      }

      // ====================================================================================================
      // STEP 0.5: ANTI-LOOP (rilevamento intelligente)
      // ====================================================================================================
      const MAX_THREAD_LENGTH = (typeof CONFIG !== 'undefined' && CONFIG.MAX_THREAD_LENGTH) ? CONFIG.MAX_THREAD_LENGTH : 10;
      const MAX_CONSECUTIVE_EXTERNAL = 5;

      if (messages.length > MAX_THREAD_LENGTH) {
        const ourEmail = Session.getActiveUser()?.getEmail() || '';
        if (!ourEmail) {
          console.warn('   ⚠️ Email utente non disponibile: skip controllo anti-loop basato su mittente');
        }
        let consecutiveExternal = 0;

        for (let i = messages.length - 1; i >= 0; i--) {
          const msgFrom = messages[i].getFrom().toLowerCase();
          if (ourEmail && !msgFrom.includes(ourEmail.toLowerCase())) {
            consecutiveExternal++;
          } else {
            break;
          }
        }

        if (ourEmail && consecutiveExternal >= MAX_CONSECUTIVE_EXTERNAL) {
          console.log(`   ⊖ Saltato: probabile loop email (${consecutiveExternal} esterni consecutivi)`);
          this._markMessageAsProcessed(candidate);
          result.status = 'skipped';
          result.reason = 'email_loop_detected';
          return result;
        }

        console.warn(`   ⚠️ Thread lungo (${messages.length} messaggi) ma non loop - elaboro`);
      }

      // ====================================================================================================
      // STEP 0.8: ANTI-MITTENTE-NOREPLY
      // ====================================================================================================
      const senderInfo = `${messageDetails.senderEmail} ${messageDetails.senderName}`.toLowerCase();
      if (/no-reply|do-not-reply|noreply/i.test(senderInfo)) {
        console.log('   ⊖ Saltato: mittente o nome no-reply');
        this._markMessageAsProcessed(candidate);
        result.status = 'filtered';
        result.reason = 'no_reply_sender';
        return result;
      }

      // ====================================================================================================
      // STEP 1: FILTRO - Domini/parole chiave ignorati
      // ====================================================================================================
      if (this._shouldIgnoreEmail(messageDetails)) {
        console.log('   ⊖ Filtrato: domain/keyword ignore');
        this._markMessageAsProcessed(candidate);
        result.status = 'filtered';
        return result;
      }

      // ====================================================================================================
      // STEP 2: CLASSIFICAZIONE - Filtro ack/greeting ultra-semplice
      // ====================================================================================================
      const MAX_SUBJECT_LENGTH = 1000;
      const safeSubject = (messageDetails.subject || '').substring(0, MAX_SUBJECT_LENGTH);
      const safeBody = (messageDetails.body || '');
      const safeSubjectLower = safeSubject.toLowerCase();

      const classification = this.classifier.classifyEmail(
        safeSubject,
        safeBody,
        safeSubjectLower.startsWith('re:')
      );

      if (!classification.shouldReply) {
        console.log(`   ⊖ Filtrato dal classifier: ${classification.reason}`);
        this._markMessageAsProcessed(candidate);
        result.status = 'filtered';
        return result;
      }

      // ====================================================================================================
      // STEP 3: CONTROLLO RAPIDO - Gemini decide se serve risposta
      // ====================================================================================================
      const quickCheck = this.geminiService.shouldRespondToEmail(
        messageDetails.body,
        messageDetails.subject
      );

      if (!quickCheck.shouldRespond) {
        console.log(`   ⊖ Gemini quick check: nessuna risposta necessaria (${quickCheck.reason})`);
        this._markMessageAsProcessed(candidate);
        result.status = 'filtered';
        return result;
      }

      const detectedLanguage = quickCheck.language;
      console.log(`   🌐 Lingua: ${detectedLanguage.toUpperCase()}`);

      // ====================================================================================================
      // STEP 4: CLASSIFICAZIONE TIPO RICHIESTA (Multi-dimensionale)
      // ====================================================================================================
      const requestType = this.requestClassifier.classify(
        messageDetails.subject,
        messageDetails.body,
        quickCheck.classification
      );

      // Estrai dati dalla nuova struttura classificazione
      const categoryHint = this.requestClassifier.getRequestTypeHint(requestType);
      const isPastoral = requestType.dimensions ? (requestType.dimensions.pastoral > 0.6) : (requestType.type === 'pastoral'); // Compatibilità

      // ====================================================================================================
      // STEP 5: KB ENRICHMENT CONDIZIONALE
      // ====================================================================================================
      const knowledgeSections = [];
      let enrichedKnowledgeBase = knowledgeBase;

      // Regola messe speciali
      if (typeof getSpecialMassTimeRule === 'function') {
        const specialMassRule = getSpecialMassTimeRule(new Date());
        if (specialMassRule) {
          console.log('   🚨 Regola Messe Speciali iniettata nel Prompt');
          knowledgeSections.push(specialMassRule);
        }
      }

      knowledgeSections.push(knowledgeBase);
      enrichedKnowledgeBase = knowledgeSections.filter(Boolean).join('\n\n');

      // ====================================================================================================
      // STEP 6: STORICO CONVERSAZIONE
      // ====================================================================================================
      let conversationHistory = '';
      if (messages.length > 1) {
        const candidateId = candidate.getId();
        const historyMessages = messages.filter(m => m.getId() !== candidateId);

        if (historyMessages.length > 0) {
          conversationHistory = this.gmailService.buildConversationHistory(
            historyMessages,
            10,
            myEmail
          );
        }
      }

      // ====================================================================================================
      // STEP 6.5: CONTESTO MEMORIA
      // ====================================================================================================
      const memoryContext = this.memoryService.getMemory(threadId);

      if (Object.keys(memoryContext).length > 0) {
        console.log(`   🧠 Memoria trovata: lang=${memoryContext.language}, topics=${(memoryContext.providedInfo || []).length}`);
      }

      // ====================================================================================================
      // STEP 6.6: CALCOLO DINAMICO SALUTO E RITARDO
      // ====================================================================================================
      const salutationMode = computeSalutationMode({
        isReply: safeSubjectLower.startsWith('re:'),
        messageCount: memoryContext.messageCount || messages.length,
        memoryExists: Object.keys(memoryContext).length > 0,
        lastUpdated: memoryContext.lastUpdated || null,
        now: new Date()
      });
      console.log(`   📊 Modalità saluto: ${salutationMode}`);

      const responseDelay = computeResponseDelay({
        messageDate: messageDetails.date,
        now: new Date()
      });
      if (responseDelay.shouldApologize) {
        console.log(`   🕐 Ritardo risposta: ${responseDelay.days} giorni`);
      }

      // ====================================================================================================
      // STEP 7: COSTRUISCI PROMPT
      // ====================================================================================================
      let { greeting, closing } = this.geminiService.getAdaptiveGreeting(
        messageDetails.senderName,
        detectedLanguage
      );

      // Override strutturale: nessun saluto in conversazioni attive
      if (salutationMode === 'none_or_continuity' || salutationMode === 'session') {
        greeting = '';
      } else if (salutationMode === 'soft') {
        greeting = '[Inizia con breve frase di riaggancio cordiale]';
      }

      // ====================================================================================================
      // PASSO 7.1: VERIFICA TERRITORIO (se TerritoryValidator disponibile)
      // ====================================================================================================
      let territoryResult = { addressFound: false };
      if (this.territoryValidator) {
        territoryResult = this.territoryValidator.analyzeEmailForAddress(
          messageDetails.body,
          messageDetails.subject
        );
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

      const territoryContext = `
====================================================================================================
🎯 VERIFICA TERRITORIO AUTOMATICA
====================================================================================================
${addressLines.join('\n\n')}
====================================================================================================
`;
      // knowledgeSections.unshift(territoryContext); // RIMOSSO: Passato separatamente per evidenza critica

      const summary = territoryResult.addressFound
        ? (addressLines.length > 1 ? `${addressLines.length} indirizzi` : '1 indirizzo')
        : 'nessun indirizzo';
      console.log(`   🎯 Verifica territorio: ${summary}`);

      // ====================================================================================================
      // STEP 7.2: PROMPT CONTEXT (profilo e concern dinamici)
      // ====================================================================================================
      let promptProfile = 'standard';
      let activeConcerns = [];
      if (typeof createPromptContext === 'function') {
        const promptContext = createPromptContext({
          email: {
            subject: safeSubject,
            body: messageDetails.body,
            isReply: safeSubjectLower.startsWith('re:'),
            detectedLanguage: detectedLanguage
          },
          classification: {
            category: classification.category,
            subIntents: classification.subIntents || {},
            confidence: classification.confidence || 0.8
          },
          requestType: requestType,
          memory: {
            exists: Object.keys(memoryContext).length > 0,
            providedInfoCount: (memoryContext.providedInfo || []).length,
            lastUpdated: memoryContext.lastUpdated || null
          },
          conversation: { messageCount: memoryContext.messageCount || messages.length },
          territory: { addressFound: territoryResult.addressFound },
          knowledgeBase: { length: enrichedKnowledgeBase.length, containsDates: /\d{4}/.test(enrichedKnowledgeBase) },
          temporal: {
            mentionsDates: this._detectTemporalMentions(messageDetails.body, detectedLanguage) || /\b\d{1,2}\/\d{1,2}\b/.test(messageDetails.body),
            mentionsTimes: /\d{1,2}[:.]\d{2}/.test(messageDetails.body)
          },
          salutationMode: salutationMode
        });
        promptProfile = promptContext.profile;
        activeConcerns = promptContext.concerns;
        console.log(`   🧠 PromptContext: profilo=${promptProfile}`);
      }

      const categoryHintSource = classification.category || requestType.type;

      // ====================================================================================================
      // STEP 7.1: ESTRAZIONE CONTESTO ALLEGATI (OCR) - Eseguita SOLO ORA
      // ====================================================================================================
      let attachmentContext = { text: '', items: [], skipped: [] };
      if (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT && CONFIG.ATTACHMENT_CONTEXT.enabled) {
        if (this._shouldTryOcr(messageDetails.body, messageDetails.subject)) {
          attachmentContext = this.gmailService.extractAttachmentContext(candidate, {
            detectedLanguage: detectedLanguage
          });
        } else {
          attachmentContext.skipped.push({ reason: 'precheck_no_ocr' });
          console.log('   📎 Allegati OCR saltati: pre-check negativo (keyword non trovate)');
        }
      } else {
        // OCR disabilitato da config
      }
      if (attachmentContext && attachmentContext.items && attachmentContext.items.length > 0) {
        const attachmentNames = attachmentContext.items.map(item => item.name).join(', ');
        console.log(`   📎 Allegati OCR: ${attachmentContext.items.length} file inclusi nel contesto (${attachmentNames})`);
      } else if (attachmentContext && attachmentContext.skipped && attachmentContext.skipped.length > 0) {
        const skippedNames = attachmentContext.skipped.map(item => item.name || item.reason).join(', ');
        console.log(`   📎 Allegati OCR saltati: ${attachmentContext.skipped.length} (${skippedNames})`);
      }

      const promptOptions = {
        emailContent: messageDetails.body,
        emailSubject: messageDetails.subject,
        knowledgeBase: enrichedKnowledgeBase,
        senderName: messageDetails.senderName,
        senderEmail: messageDetails.senderEmail,
        conversationHistory: conversationHistory,
        category: categoryHintSource,
        topic: quickCheck.classification ? quickCheck.classification.topic : '',
        detectedLanguage: detectedLanguage,
        currentSeason: this._getCurrentSeason(),
        currentDate: new Date().toISOString().split('T')[0],
        salutation: greeting,
        closing: closing,
        subIntents: classification.subIntents || {},
        memoryContext: memoryContext,
        salutationMode: salutationMode,
        responseDelay: responseDelay,
        promptProfile: promptProfile,
        activeConcerns: activeConcerns,
        territoryContext: territoryContext, // Passiamo il contesto separatamente per rendering prioritario
        requestType: requestType, // Aggiunto per recupero selettivo Dottrina
        attachmentsContext: attachmentContext ? attachmentContext.text : ''
      };

      const prompt = this.promptEngine.buildPrompt(promptOptions);

      // Aggiungi hint tipo richiesta (nuovo metodo blended)
      const typeHint = this.requestClassifier.getRequestTypeHint(requestType);
      const fullPrompt = typeHint + '\n\n' + prompt;

      // ====================================================================================================
      // STEP 8: GENERA RISPOSTA (STRATEGIA "CROSS-KEY QUALITY FIRST")
      // ====================================================================================================
      // NOTA ARCHITETTURALE:
      // Questa fase può richiedere più tempo del normale (fino a 4 tentativi API).
      // SCELTA DELIBERATA: Privilegiamo la qualità della risposta (Modello Flash 2.5)
      // rispetto alla velocità. 
      // 1. Proviamo Flash 2.5 sulla chiave primaria.
      // 2. Se fallisce, proviamo Flash 2.5 sulla chiave di RISERVA.
      // 3. Solo se entrambe falliscono, degradiamo al modello Lite (più economico).
      // Questo "costo" in termini di tempo è gestito riducendo MAX_EMAILS_PER_RUN a 3.
      // ====================================================================================================

      let response = null;
      let generationError = null;
      let strategyUsed = null;

      // Punto 12: Utilizzo del metodo di classe centralizzato per la classificazione degli errori


      // Definizione strategie di generazione (Punti di robustezza cross-key)
      const geminiModels = (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_MODELS) ? CONFIG.GEMINI_MODELS : {};
      const flashModel = (geminiModels['flash-2.5'] && geminiModels['flash-2.5'].name) ? geminiModels['flash-2.5'].name : 'gemini-2.5-flash';
      const liteModel = (geminiModels['flash-lite'] && geminiModels['flash-lite'].name) ? geminiModels['flash-lite'].name : 'gemini-2.5-flash-lite';

      const attemptStrategy = [
        { name: 'Primary-Flash2.5', key: this.geminiService.primaryKey, model: flashModel, skipRateLimit: false },
        { name: 'Backup-Flash2.5', key: this.geminiService.backupKey, model: flashModel, skipRateLimit: true },
        { name: 'Fallback-Lite', key: this.geminiService.primaryKey, model: liteModel, skipRateLimit: false }
      ];

      // Esecuzione Loop Strategico
      for (const plan of attemptStrategy) {
        // Salta se manca la chiave (es. backupKey non configurata)
        if (!plan.key) continue;

        try {
          console.log(`🔄 Tentativo Generazione: ${plan.name}...`);

          response = this.geminiService.generateResponse(fullPrompt, {
            apiKey: plan.key,
            modelName: plan.model,
            skipRateLimit: plan.skipRateLimit
          });

          // Compatibilità: GeminiService può restituire stringa (legacy) oppure
          // oggetto strutturato { success, text, modelUsed }.
          if (response && typeof response === 'object') {
            response = response.text;
          }

          if (response) {
            strategyUsed = plan.name;
            console.log(`✅ Generazione riuscita con strategia: ${plan.name}`);
            break; // Successo! Esci dal loop
          }

        } catch (err) {
          generationError = err; // Salva l'ultimo errore
          const errorClass = classifyError(err);
          console.warn(`⚠️ Strategia '${plan.name}' fallita: ${err.message} [${errorClass}]`);

          if (errorClass === 'FATAL') {
            console.error('🛑 Errore fatale rilevato, interrompo strategia.');
            break;
          }

          if (errorClass === 'NETWORK') {
            console.warn('🌐 Errore di rete, continuo con prossima strategia.');
            continue;
          }
          // QUOTA e UNKNOWN: continua
        }
      }

      // Verifiche finali post-loop
      if (!response) {
        const errorClass = generationError ? classifyError(generationError) : 'UNKNOWN';
        console.error('🛑 TUTTE le strategie di generazione sono fallite.');
        this._addErrorLabel(thread);
        this._markMessageAsProcessed(candidate);
        result.status = 'error';
        result.error = generationError ? generationError.message : 'Generation strategies exhausted';
        result.errorClass = errorClass;
        return result;
      }

      // Controlla marcatore NO_REPLY
      if (typeof response !== 'string') {
        console.error(`🛑 Risposta non valida da Gemini: tipo ricevuto '${typeof response}'`);
        this._addErrorLabel(thread);
        this._markMessageAsProcessed(candidate);
        result.status = 'error';
        result.error = 'Invalid response type from GeminiService';
        result.errorClass = 'DATA';
        return result;
      }

      if (response.trim() === 'NO_REPLY') {
        console.log('   ⊖ AI ha restituito NO_REPLY');
        this._markMessageAsProcessed(candidate);
        result.status = 'filtered';
        return result;
      }

      // Nota OCR bassa confidenza: avviso leggibilità allegato
      if (attachmentContext && attachmentContext.ocrConfidenceLow) {
        const ocrLowConfidenceNote = this._getOcrLowConfidenceNote(detectedLanguage);
        if (ocrLowConfidenceNote && !response.includes(ocrLowConfidenceNote)) {
          response = `${response.trim()}\n\n${ocrLowConfidenceNote}`;
          console.log(`   ⚠️ Nota OCR aggiunta (confidenza media: ${attachmentContext.ocrConfidence})`);
        }
      }

      // ====================================================================================================
      // STEP 9: VALIDA RISPOSTA
      // ====================================================================================================
      if (this.config.validationEnabled) {
        const validation = this.validator.validateResponse(
          response,
          detectedLanguage,
          enrichedKnowledgeBase,
          messageDetails.body,
          messageDetails.subject,
          salutationMode
        );

        if (!validation.isValid) {
          console.warn(`   🛑 Validazione FALLITA (punteggio: ${validation.score.toFixed(2)})`);

          // Gestione errore validazione critica
          if (validation.details && validation.details.exposedReasoning && validation.details.exposedReasoning.score === 0.0) {
            console.warn("⚠️ Risposta bloccata per Thinking Leak. Invio a etichetta 'Verifica'.");
            // Qui potremmo tentare un retry con temperatura più bassa o altro modello
            // Per ora marchiamo per revisione umana
            result.status = 'validation_failed';
            result.reason = 'thinking_leak';
          }

          this._addValidationErrorLabel(thread);
          this._markMessageAsProcessed(candidate);
          result.status = 'validation_failed';
          result.validationFailed = true;
          return result;
        }

        // Se ci sono WARNING e il punteggio è sotto la soglia di sicurezza, aggiungi etichetta "verifica"
        // Ignoriamo i warning per punteggi alti (es. >= 0.90) assumendo siano nits minori (es. firma)
        const warningThreshold = this.config.validationWarningThreshold || 0.90;

        if (validation.warnings && validation.warnings.length > 0 && validation.score < warningThreshold) {
          console.log(
            `   ⚠️ Validazione: Punteggio ${validation.score.toFixed(2)} < ${warningThreshold} con warning - Aggiungo etichetta '${this.config.validationErrorLabel}'`
          );
          this.gmailService.addLabelToMessage(candidate.getId(), this.config.validationErrorLabel);
        } else if (validation.warnings && validation.warnings.length > 0) {
          console.log(`   ℹ️ Validazione: Punteggio alto (${validation.score.toFixed(2)}). Warning ignorati: ${validation.warnings.join(', ')}`);
        }

        if (validation.fixedResponse) {
          console.log('   🩹 Usa risposta corretta automaticamente (Self-Healing)');
          response = validation.fixedResponse;
        }

        console.log(`   ✓ Validazione PASSATA (punteggio: ${validation.score.toFixed(2)})`);
      }

      // ====================================================================================================
      // STEP 10: INVIA RISPOSTA
      // ====================================================================================================
      if (this.config.dryRun) {
        console.log('   🔴 DRY RUN - Risposta non inviata');
        console.log(`   📄 Invierebbe: ${response.substring(0, 100)}...`);
        result.dryRun = true;
        // In DRY_RUN non aggiorniamo memoria né label per non avere effetti permanenti
        result.status = 'replied';
        return result;
      }

      try {
        this.gmailService.sendHtmlReply(candidate, response, messageDetails);
      } catch (e) {
        const errorMessage = e && e.message ? e.message : String(e);
        console.error(`   🛑 Errore invio Gmail: ${errorMessage}`);
        this._addErrorLabel(thread);
        if (candidate) {
          this._markMessageAsProcessed(candidate);
        }
        result.status = 'error';
        result.error = `gmail_send_failed: ${errorMessage}`;
        return result;
      }

      // ====================================================================================================
      // STEP 11: AGGIORNA MEMORIA (solo se non DRY_RUN)
      // ====================================================================================================
      const providedTopics = this._detectProvidedTopics(response);

      // Strutturazione Oggetti Topic
      const topicsWithObjects = providedTopics.map(topic => ({
        topic: topic,
        userReaction: 'unknown',
        context: null,
        timestamp: new Date().toISOString()
      }));

      const memorySummary = this._buildMemorySummary({
        existingSummary: memoryContext.memorySummary || '',
        responseText: response,
        providedTopics: providedTopics
      });

      // Inferisci reazione utente su topic precedenti (se presenti)
      if (memoryContext.providedInfo && memoryContext.providedInfo.length > 0) {
        this._inferUserReaction(messageDetails.body, memoryContext.providedInfo, threadId);
      }

      const memoryUpdate = {
        language: detectedLanguage,
        category: classification.category || requestType.type
      };

      if (memorySummary) {
        memoryUpdate.memorySummary = memorySummary;
      }

      this.memoryService.updateMemoryAtomic(threadId, memoryUpdate, topicsWithObjects.length > 0 ? topicsWithObjects : null);

      if (candidate) {
        this._markMessageAsProcessed(candidate);
      }
      result.status = 'replied';
      return result;

    } catch (error) {
      console.error(`   🛑 Errore elaborazione thread: ${error.message}`);
      this._addErrorLabel(thread);
      if (candidate) {
        this._markMessageAsProcessed(candidate);
      }
      result.status = 'error';
      result.error = error.message;
      return result;

    } finally {
      // Rilascia lock (solo se acquisito)
      if (lockAcquired && scriptCache && threadLockKey) {
        try {
          const currentLockValue = scriptCache.get(threadLockKey);
          if (!currentLockValue || currentLockValue === lockValue) {
            scriptCache.remove(threadLockKey);
            console.log(`🔓 Lock rilasciato per thread ${threadId}`);
          } else {
            console.warn(`⚠️ Rilascio lock saltato per thread ${threadId} (lock di altro processo)`);
          }
        } catch (e) {
          console.warn('⚠️ Errore rilascio lock:', e.message);
        }
      }
    }
  }

  /**
   * Processa tutte le email non lette
   */
  processUnreadEmails(knowledgeBase, doctrineBase = '') {
    console.log('\n' + '='.repeat(70));
    console.log('📬 Inizio elaborazione email...');
    console.log('='.repeat(70));

    // Lock globale run-level: evita che due trigger simultanei scarichino la stessa inbox
    // prima che entri in gioco il lock per-thread.
    const executionLock = LockService.getScriptLock();
    const lockWaitMs = (typeof CONFIG !== 'undefined' && CONFIG.EXECUTION_LOCK_WAIT_MS)
      ? CONFIG.EXECUTION_LOCK_WAIT_MS
      : 5000;

    if (!executionLock.tryLock(lockWaitMs)) {
      console.warn('⚠️ Un\'altra esecuzione è già attiva: salto questo turno per evitare doppie risposte.');
      return { total: 0, replied: 0, filtered: 0, errors: 0, skipped: 1, reason: 'execution_locked' };
    }

    try {

      if (this.config.dryRun) {
        console.warn('🔴 MODALITÀ DRY_RUN ATTIVA - Email NON inviate!');
      }

      // Cerca thread non letti nella inbox
      // Utilizziamo un buffer di ricerca più ampio per gestire thread saltati (es. loop interni)
      // Rimuoviamo il filtro etichetta per permettere la gestione dei follow-up in thread già elaborati
      const searchQuery = 'in:inbox is:unread';
      const searchLimit = (this.config.searchPageSize || 50);

      const threads = GmailApp.search(
        searchQuery,
        0,
        searchLimit
      );

      if (threads.length === 0) {
        console.log('Nessuna email da elaborare.');
        return { total: 0, replied: 0, filtered: 0, errors: 0 };
      }

      console.log(`📬 Trovate ${threads.length} email da elaborare (query: ${searchQuery})`);

      // Carica etichette una sola volta
      const labeledMessageIds = this.gmailService.getMessageIdsWithLabel(this.config.labelName);
      console.log(`📦 Trovati in cache ${labeledMessageIds.size} messaggi già elaborati`);

      // Statistiche
      const stats = {
        total: 0,
        replied: 0,
        filtered: 0,
        validationFailed: 0,
        errors: 0,
        dryRun: 0,
        skipped: 0,
        skipped_locked: 0,
        skipped_processed: 0,
        skipped_internal: 0,
        skipped_loop: 0
      };

      // Processa ogni thread fino a raggiungere il limite di elaborazione
      this._startTime = Date.now();
      const MAX_EXECUTION_TIME = this.config.maxExecutionTimeMs;
      let processedCount = 0; // Contatore thread effettivamente elaborati

      for (let index = 0; index < threads.length; index++) {
        // Stop se abbiamo raggiunto il target di elaborazione effettiva
        if (processedCount >= parseInt(this.config.maxEmailsPerRun, 10)) {
          console.log(`🛑 Raggiunti ${this.config.maxEmailsPerRun} thread elaborati. Stop.`);
          break;
        }

        const thread = threads[index];

        // Controllo tempo residuo
        if (this._isNearDeadline(MAX_EXECUTION_TIME)) {
          console.warn(`⏳ Tempo esecuzione in esaurimento. Interrompo dopo ${index} thread.`);
          break;
        }
        console.log(`\n--- Thread ${index + 1}/${threads.length} ---`);

        const result = this.processThread(thread, knowledgeBase, doctrineBase, labeledMessageIds);
        stats.total++;

        // Incrementa contatore solo se c'è stata un'azione significativa o decisione esplicita dell'AI
        const isEffectiveWork = (
          result.status === 'replied' ||
          result.status === 'error' ||
          result.status === 'validation_failed' ||
          result.status === 'filtered'
        );

        if (isEffectiveWork) {
          processedCount++;
        }

        if (result.validationFailed) {
          stats.validationFailed++;
        } else if (result.status === 'replied') {
          stats.replied++;
          if (result.dryRun) stats.dryRun++;
        } else if (result.status === 'skipped') {
          stats.skipped++;
          if (result.reason === 'thread_locked' || result.reason === 'thread_locked_race') stats.skipped_locked++;
          if (result.reason === 'already_labeled_no_new_unread') stats.skipped_processed++;
          if (result.reason === 'no_external_unread' || result.reason === 'self_sent') stats.skipped_internal++;
          if (result.reason === 'email_loop_detected') stats.skipped_loop++;
        } else if (result.status === 'filtered') {
          stats.filtered++;
        } else if (result.status === 'error') {
          stats.errors++;
        }
      }

      // Stampa riepilogo
      console.log('\n' + '='.repeat(70));
      console.log('📊 RIEPILOGO ELABORAZIONE');
      console.log('='.repeat(70));
      console.log(`   Totale analizzate (buffer): ${stats.total}`);
      console.log(`   ✓ Risposte inviate: ${stats.replied}`);
      if (stats.dryRun > 0) console.warn(`   🔴 DRY RUN: ${stats.dryRun}`);

      if (stats.skipped > 0) {
        console.log(`   ⊖ Saltate (Totale): ${stats.skipped}`);
      }

      console.log(`   ⊖ Filtrate (AI/Regole): ${stats.filtered}`);
      if (stats.validationFailed > 0) console.warn(`   🛑 Validazione fallita: ${stats.validationFailed}`);
      if (stats.errors > 0) console.error(`   🛑 Errori: ${stats.errors}`);
      stats.processed = processedCount;
      console.log('='.repeat(70));

      return stats;
    } finally {
      try {
        executionLock.releaseLock();
      } catch (e) {
        console.warn(`⚠️ Errore rilascio execution lock: ${e.message}`);
      }
    }
  }

  // ====================================================================================================
  // RILEVAMENTO TEMPORALE (Date/Orari)
  // ====================================================================================================

  /**
   * Verifica se l'email deve essere ignorata (blacklist, auto-reply, notifiche)
   * Usa le liste UNIFICATE (Codice + Foglio) presenti in GLOBAL_CACHE
   */
  _shouldIgnoreEmail(messageDetails) {
    const email = (messageDetails.senderEmail || '').toLowerCase();
    const subject = (messageDetails.subject || '').toLowerCase();
    const body = (messageDetails.body || '').toLowerCase();

    // 1. Controllo Blacklist Domini/Email
    const configDomains = (typeof CONFIG !== 'undefined' && CONFIG.IGNORE_DOMAINS) ? CONFIG.IGNORE_DOMAINS : [];
    const cacheDomains = (typeof GLOBAL_CACHE !== 'undefined' && Array.isArray(GLOBAL_CACHE.ignoreDomains))
      ? GLOBAL_CACHE.ignoreDomains
      : [];
    const ignoreDomains = Array.from(new Set([...configDomains, ...cacheDomains].map(d => String(d).toLowerCase())));

    if (ignoreDomains.some(domain => email.includes(domain.toLowerCase()))) {
      console.log(`🚫 Ignorato: mittente in blacklist (${email})`);
      return true;
    }

    // 2. Controllo Keyword Oggetto
    const configKeywords = (typeof CONFIG !== 'undefined' && CONFIG.IGNORE_KEYWORDS) ? CONFIG.IGNORE_KEYWORDS : [];
    const cacheKeywords = (typeof GLOBAL_CACHE !== 'undefined' && Array.isArray(GLOBAL_CACHE.ignoreKeywords))
      ? GLOBAL_CACHE.ignoreKeywords
      : [];
    const ignoreKeywords = Array.from(new Set([...configKeywords, ...cacheKeywords].map(k => String(k).toLowerCase())));

    if (ignoreKeywords.some(keyword => subject.includes(keyword.toLowerCase()))) {
      console.log(`🚫 Ignorato: oggetto contiene keyword vietata`);
      return true;
    }

    // 3. Controllo Auto-reply e Notifiche (Standard)
    if (
      email.includes('no-reply') ||
      email.includes('noreply') ||
      email.includes('mailer-daemon') ||
      email.includes('postmaster') ||
      email.includes('notification') ||
      email.includes('alert') ||
      subject.includes('delivery status notification') ||
      subject.includes('automatic reply') ||
      subject.includes('fuori sede') ||
      subject.includes('out of office') ||
      body.includes('this is an automatically generated message') ||
      body.includes('do not reply to this email')
    ) {
      console.log('🚫 Ignorato: auto-reply o notifica di sistema');
      return true;
    }

    return false;
  }

  _shouldTryOcr(body, subject) {
    const settings = (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT)
      ? CONFIG.ATTACHMENT_CONTEXT
      : {};

    // Se trigger keywords non sono definite, default a true (comportamento legacy)
    // Ma nel config nuovo sono definite, quindi userà quelle.
    const triggerKeywords = settings.ocrTriggerKeywords || [];

    // Se la lista è vuota, significa "OCR sempre attivo se enabled=true"
    if (triggerKeywords.length === 0) return true;

    const normalizedBody = (body || '').toLowerCase().replace(/\s+/g, ' ');
    const normalizedSubject = (subject || '').toLowerCase().replace(/\s+/g, ' ');

    return triggerKeywords.some(keyword => {
      const needle = (keyword || '').toLowerCase();
      // startWith, includes, o regex word boundary? Includes è più sicuro for ora.
      return needle && (normalizedBody.includes(needle) || normalizedSubject.includes(needle));
    });
  }

  _getCurrentSeason() {
    const month = new Date().getMonth() + 1;
    return (month >= 6 && month <= 9) ? 'estivo' : 'invernale';
  }

  _getOcrLowConfidenceNote(languageCode) {
    const lang = ((languageCode || 'it') + '').toLowerCase().split(/[-_]/)[0];
    const notes = {
      it: 'Nota: Il documento allegato era di difficile lettura.',
      en: 'Note: The attached document was difficult to read.',
      es: 'Nota: El documento adjunto era difícil de leer.',
      fr: 'Remarque : Le document joint était difficile à lire.',
      de: 'Hinweis: Das angehängte Dokument war schwer lesbar.'
    };
    return notes[lang] || notes.it;
  }

  _markMessageAsProcessed(message) {
    // SCELTA OPERATIVA INTENZIONALE:
    // - etichetta IA a livello *messaggio* (non thread), usando Gmail Advanced Service;
    // - NON marcare come letto qui.
    // Motivo: il segretario deve vedere a colpo d'occhio i non letti, anche se già gestiti da IA.
    // Cambiare questo comportamento altera la triage operativa.
    this.gmailService.addLabelToMessage(message.getId(), this.config.labelName);
  }

  _isNearDeadline(maxExecutionTimeMs) {
    const budgetMs = Number(maxExecutionTimeMs) || 330000;
    const minRemainingMs = (typeof this.config.minRemainingTimeMs === 'number')
      ? this.config.minRemainingTimeMs
      : 90000;
    const start = Number(this._startTime) || Date.now();
    const elapsed = Date.now() - start;
    return elapsed > Math.max(0, budgetMs - minRemainingMs);
  }

  _addErrorLabel(thread) {
    this.gmailService.addLabelToThread(thread, this.config.errorLabelName);
  }

  _addValidationErrorLabel(thread) {
    this.gmailService.addLabelToThread(thread, this.config.validationErrorLabel);
  }

  _buildMemorySummary({ existingSummary, responseText, providedTopics }) {
    const maxBullets = (typeof CONFIG !== 'undefined' && CONFIG.MAX_MEMORY_SUMMARY_BULLETS) || 4;
    const maxChars = (typeof CONFIG !== 'undefined' && CONFIG.MAX_MEMORY_SUMMARY_CHARS) || 600;
    const sanitizedSummary = (typeof existingSummary === 'string') ? existingSummary : '';
    const summaryLines = sanitizedSummary
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    if (!responseText) {
      return summaryLines.slice(-maxBullets).join('\n') || null;
    }

    const plainText = responseText
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const sentenceMatches = plainText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    const ignorePatterns = [
      /^ciao\b/i,
      /^buongiorno/i,
      /^buonasera/i,
      /^gentile/i,
      /^salve\b/i,
      /^grazie\b/i,
      /^cordiali saluti/i,
      /^saluti\b/i
    ];

    const candidateSentences = sentenceMatches
      .map(sentence => sentence.trim())
      .filter(sentence => sentence.length > 20)
      .filter(sentence => !ignorePatterns.some(pattern => pattern.test(sentence)));

    let summarySentence = candidateSentences.slice(0, 2).join(' ');
    if (!summarySentence && providedTopics && providedTopics.length > 0) {
      summarySentence = `Ho fornito informazioni su: ${providedTopics.join(', ')}.`;
    }
    if (!summarySentence) {
      summarySentence = plainText.slice(0, 200);
    }

    const newBullet = summarySentence ? `• ${summarySentence}` : '';
    if (newBullet && !summaryLines.some(line => line.toLowerCase() === newBullet.toLowerCase())) {
      summaryLines.push(newBullet);
    }

    const trimmedLines = summaryLines.slice(-maxBullets);
    let summary = trimmedLines.join('\n').trim();

    if (summary.length > maxChars) {
      const truncated = summary.slice(0, maxChars);
      const lastBreak = truncated.lastIndexOf('\n');
      summary = (lastBreak > 0 ? truncated.slice(0, lastBreak) : truncated).trim();
    }

    return summary || null;
  }

  /**
   * Rileva topic forniti nella risposta (per anti-ripetizione memoria)
   */
  _detectProvidedTopics(response) {
    if (!response || typeof response !== 'string') return [];
    const topics = [];
    const lower = response.toLowerCase();

    const patterns = {
      'orari_messe': /messe?\b.*\d{1,2}[:.]\d{2}|orari\w*\s+messe/i,
      'contatti': /telefono|email|@|segreteria/i,
      'battesimo_info': /battesimo.*documento|documento.*battesimo/i,
      'comunione_info': /comunione.*catechismo|catechismo.*comunione/i,
      'cresima_info': /cresima.*percorso|percorso.*cresima/i,
      'matrimonio_info': /matrimonio.*corso|corso.*matrimonio/i,
      'territorio': /rientra|non rientra|parrocchia.*competenza/i,
      'indirizzo': /(?:via|viale|corso|piazza|largo|circonvallazione)\s+(?:[a-zA-ZàèéìòùÀÈÉÌÒÙ']+\s+){0,10}[a-zA-ZàèéìòùÀÈÉÌÒÙ']+\s*,?\s*\d+/i
    };

    for (const [topic, pattern] of Object.entries(patterns)) {
      if (pattern.test(lower)) {
        topics.push(topic);
      }
    }

    return topics;
  }
  /**
   * Inferisce la reazione dell'utente rispetto ai topic forniti in precedenza
   */
  _inferUserReaction(userBody, previousTopics, threadId) {
    if (!previousTopics || previousTopics.length === 0) return;
    if (!userBody || typeof userBody !== 'string') return;

    const bodyLower = userBody.toLowerCase();

    // Pattern semplici di reazione
    const patterns = {
      questioned: [
        'non ho capito', 'non capisco', 'mi scusi non ho capito', 'non mi è chiaro',
        'non è chiaro', 'può chiarire', 'potrebbe chiarire', 'potrebbe spiegare',
        'cosa significa', 'dubbio', 'confuso', 'mi aiuta a capire',
        'i did not understand', 'i don\'t understand', 'not clear',
        'could you clarify', 'could you please clarify', 'could you explain',
        'no entiendo', 'no entendí', 'no me queda claro', 'podría aclarar',
        'podría explicar', 'podría ayudarme a entender'
      ],
      acknowledged: [
        'ho capito', 'tutto chiaro', 'grazie per la spiegazione', 'ok grazie',
        'perfetto', 'chiarissimo', 'ricevuto', 'la ringrazio', 'grazie',
        'gentilissimi', 'va benissimo', 'compreso',
        'thank you', 'thanks', 'understood', 'all clear', 'received',
        'gracias', 'entendido', 'entendida', 'recibido', 'recibida', 'perfecto', 'clarísimo'
      ],
      needs_expansion: [
        'potrebbe aggiungere', 'potrebbe fornire maggiori dettagli', 'maggiori dettagli',
        'più dettagli', 'approfondire', 'potrebbe spiegare meglio', 'potrebbe ampliare',
        'sarebbe possibile avere più informazioni', 'servirebbero più informazioni',
        'potrebbe indicare i passaggi',
        'could you provide more details', 'more details', 'could you elaborate',
        'would it be possible to have more information', 'could you outline the steps',
        'podría ampliar', 'más detalles', 'podría proporcionar más información',
        'sería posible tener más información', 'podría indicar los pasos'
      ]
    };

    const matchedQuestioned = patterns.questioned.find(p => bodyLower.includes(p));
    const matchedAcknowledged = patterns.acknowledged.find(p => bodyLower.includes(p));
    const matchedExpansion = patterns.needs_expansion.find(p => bodyLower.includes(p));

    let inferredReaction = null;
    if (matchedQuestioned) {
      inferredReaction = { type: 'questioned', match: matchedQuestioned };
    } else if (matchedExpansion) {
      inferredReaction = { type: 'needs_expansion', match: matchedExpansion };
    } else if (matchedAcknowledged) {
      inferredReaction = { type: 'acknowledged', match: matchedAcknowledged };
    }

    if (!inferredReaction) return;

    // 1. Trova TUTTI i topic menzionati esplicitamente
    const normalizedTopics = previousTopics.map(info => (typeof info === 'object' ? info.topic : info));
    const mentionedTopics = normalizedTopics.filter(topic => bodyLower.includes(topic.toLowerCase()));

    let targetTopics = [];

    if (mentionedTopics.length > 0) {
      // Se l'utente cita esplicitamente dei topic, applica a tutti quelli trovati
      targetTopics = mentionedTopics;
    } else {
      // Fallback: applica all'ultimo topic discusso
      targetTopics = [normalizedTopics[normalizedTopics.length - 1]];
    }

    if (targetTopics.length === 0) return;

    const context = {
      source: 'user_reply',
      matchedPhrase: inferredReaction.match,
      excerpt: userBody.substring(0, 160)
    };

    targetTopics.forEach(topic => {
      console.log(`🧠 Inferred Reaction: ${inferredReaction.type.toUpperCase()} su topic '${topic}'`);
      this.memoryService.updateReaction(threadId, topic, inferredReaction.type, context);
    });
  }
  /**
   * Punto 12: Classificazione centralizzata degli errori API
   * Determina se un errore è fatale, legato alla quota o alla rete.
   */
  _classifyError(error) {
    if (!error) {
      console.warn('⚠️ _classifyError chiamato con errore nullo');
      return 'UNKNOWN';
    }

    const msg = String(error.message || error.toString() || '');
    if (!msg) {
      console.warn('⚠️ Errore senza messaggio utile:', error);
      return 'UNKNOWN';
    }

    const RETRYABLE_ERRORS = ['429', 'rate limit', 'quota', 'RESOURCE_EXHAUSTED'];
    const FATAL_ERRORS = ['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED'];

    for (const fatal of FATAL_ERRORS) {
      if (msg.includes(fatal)) return 'FATAL';
    }

    for (const retryable of RETRYABLE_ERRORS) {
      if (msg.includes(retryable)) return 'QUOTA';
    }

    if (msg.includes('timeout') || msg.includes('ECONNRESET') || msg.includes('503') || msg.includes('500') || msg.includes('502') || msg.includes('504')) {
      return 'NETWORK';
    }

    return 'UNKNOWN';
  }

  /**
   * Rileva riferimenti temporali (mesi) in varie lingue
   */
  _detectTemporalMentions(text, language) {
    // Punto 15: Protezione contro input nulli o non validi
    if (!text || typeof text !== 'string') return false;
    const monthPatterns = {
      'it': /\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\b/i,
      'en': /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
      'es': /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i,
      'pt': /\b(janeiro|fevereiro|mar\u00E7o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i
    };

    // Fallback su italiano se lingua non supportata
    const pattern = monthPatterns[language] || monthPatterns['it'];
    return pattern.test(text);
  }
}

// ====================================================================================================
// CALCOLATORE MODALITÀ SALUTO
// ====================================================================================================

/**
 * Calcola modalità saluto basata su segnali strutturali
 * @param {Object} params - Parametri di input
 * @returns {'full'|'soft'|'none_or_continuity'|'session'}
 */ // Fix: added 'session' to contract
function computeSalutationMode({ isReply = false, messageCount = 0, memoryExists = false, lastUpdated = null, now = new Date() } = {}) {
  const SESSION_WINDOW_MINUTES = 15;
  // 1️⃣ Primo messaggio assoluto
  if (!isReply && !memoryExists && messageCount <= 1) {
    return 'full';
  }

  // 2️⃣ Conversazione attiva
  if (isReply || messageCount > 1 || memoryExists) {
    if (!lastUpdated) {
      return 'none_or_continuity';
    }

    const parsedLastUpdated = new Date(lastUpdated);
    if (isNaN(parsedLastUpdated.getTime())) {
      return 'none_or_continuity';
    }

    const timeSinceLastMs = now.getTime() - parsedLastUpdated.getTime();
    const minutesSinceLast = timeSinceLastMs / (1000 * 60);
    const hoursSinceLast = timeSinceLastMs / (1000 * 60 * 60);

    if (isNaN(hoursSinceLast) || hoursSinceLast < 0) {
      console.warn('⚠️ Timestamp futuro o invalido');
      return 'full';
    }

    // Sessione conversazionale ravvicinata (entro 15 minuti)
    if (minutesSinceLast <= SESSION_WINDOW_MINUTES) {
      return 'session';
    }

    // Follow-up ravvicinato (entro 48h)
    if (hoursSinceLast <= 48) {
      return 'none_or_continuity';
    }

    // Conversazione ripresa dopo pausa (48h - 4 giorni)
    if (hoursSinceLast <= 96) {
      return 'soft';
    }

    // Troppo tempo passato (> 4 giorni) → nuovo contatto
    return 'full';
  }

  // Fallback
  return 'full';
}

// Compatibilità: rende la funzione disponibile anche in runtime che usano moduli/isolamento
if (typeof globalThis !== 'undefined' && typeof globalThis.computeSalutationMode !== 'function') {
  globalThis.computeSalutationMode = computeSalutationMode;
}

// Funzione factory
function createEmailProcessor(options) {
  return new EmailProcessor(options);
}

/**
 * Calcola ritardo risposta rispetto alla data del messaggio
 * @param {Object} params
 * @returns {{shouldApologize: boolean, hours: number, days: number}}
 */
function computeResponseDelay({ messageDate, now = new Date(), thresholdHours = 72 }) {
  if (!messageDate) {
    return { shouldApologize: false, hours: 0, days: 0 };
  }

  const parsedMessageDate = new Date(messageDate);
  const diffMs = now.getTime() - parsedMessageDate.getTime();

  if (isNaN(diffMs) || diffMs < 0) {
    return { shouldApologize: false, hours: 0, days: 0 };
  }

  const hours = diffMs / (1000 * 60 * 60);
  const days = Math.floor(hours / 24);

  return {
    shouldApologize: hours >= thresholdHours,
    hours: Math.round(hours),
    days: days
  };
}

// ====================================================================================================
// ENTRY POINT PRINCIPALE
// ====================================================================================================

function processUnreadEmailsMain() {
  try {
    const configCheck = typeof validateConfig === 'function' ? validateConfig() : { valid: true, errors: [] };
    if (!configCheck.valid) {
      console.error('🚨 CONFIGURAZIONE NON VALIDA - ARRESTO SISTEMA');
      configCheck.errors.forEach(e => console.error(`   ${e}`));
      return;
    }

    // Controlla orario sospensione
    if (typeof isInSuspensionTime === 'function' && isInSuspensionTime()) {
      console.log('Servizio sospeso per orario di lavoro.');
      return;
    }

    // Carica risorse
    if (typeof loadResources === 'function') {
      try {
        loadResources(true, false);
      } catch (resourceError) {
        console.warn(`⚠️ loadResources standard fallita: ${resourceError.message}`);

        // Fallback operativo: tentativo diretto senza lock esterno.
        if (typeof _loadResourcesInternal === 'function') {
          _loadResourcesInternal();
        }
      }
    }

    // Ottieni knowledge base
    const knowledgeBase = typeof GLOBAL_CACHE !== 'undefined' ?
      GLOBAL_CACHE.knowledgeBase || '' : '';
    const doctrineBase = typeof GLOBAL_CACHE !== 'undefined' ?
      GLOBAL_CACHE.doctrineBase || '' : '';

    if (!knowledgeBase) {
      console.error('🛑 Knowledge Base non caricata, esco');
      return;
    }

    // Crea processore ed esegui
    const processor = new EmailProcessor();
    processor.processUnreadEmails(knowledgeBase, doctrineBase);

  } catch (error) {
    console.error(`🛑 Errore nel processo principale: ${error.message}`);
  }
}
