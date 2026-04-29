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

var EmailProcessor = class EmailProcessor {
  constructor(options = {}) {
    // Logger strutturato
    this.logger = (typeof createLogger === 'function')
      ? createLogger('EmailProcessor')
      : {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args),
        debug: (...args) => console.log(...args),
      };
    this.logger.info('Inizializzazione EmailProcessor');

    // Inietta dipendenze o crea default
    this.geminiService = options.geminiService || new GeminiService();
    this.classifier = options.classifier || new Classifier();
    this.requestClassifier = options.requestClassifier ||
      (typeof RequestTypeClassifier !== 'undefined'
        ? new RequestTypeClassifier()
        : {
          classify: () => ({ type: 'technical' }),
          getRequestTypeHint: () => ''
        });
    this.validator = options.validator || new ResponseValidator();
    this.gmailService = options.gmailService || new GmailService();
    this.promptEngine = options.promptEngine ||
      (typeof PromptEngine !== 'undefined'
        ? new PromptEngine()
        : { buildPrompt: (opts) => (opts && opts.emailContent) ? opts.emailContent : '' });
    this.memoryService = options.memoryService ||
      (typeof MemoryService !== 'undefined'
        ? new MemoryService()
        : {
          getMemory: () => ({}),
          updateMemoryAtomic: () => { },
          updateReaction: () => { }
        });
    // Integrazione TerritoryValidator
    this.territoryValidator = options.territoryValidator || (typeof TerritoryValidator !== 'undefined' ? new TerritoryValidator() : null);

    // Configurazione
    this.config = {
      validationEnabled: typeof CONFIG !== 'undefined' ? CONFIG.VALIDATION_ENABLED : true,
      dryRun: typeof CONFIG !== 'undefined' ? CONFIG.DRY_RUN : false,
      maxEmailsPerRun: typeof CONFIG !== 'undefined' ? CONFIG.MAX_EMAILS_PER_RUN : 3,
      maxExecutionTimeMs: typeof CONFIG !== 'undefined' && CONFIG.MAX_EXECUTION_TIME_MS
        ? CONFIG.MAX_EXECUTION_TIME_MS
        : 280 * 1000,
      minRemainingTimeMs: typeof CONFIG !== 'undefined' && typeof CONFIG.MIN_REMAINING_TIME_MS === 'number'
        ? CONFIG.MIN_REMAINING_TIME_MS
        : 90 * 1000,
      labelName: typeof CONFIG !== 'undefined' ? CONFIG.LABEL_NAME : 'IA',
      errorLabelName: typeof CONFIG !== 'undefined' ? CONFIG.ERROR_LABEL_NAME : 'Errore',
      validationErrorLabel: typeof CONFIG !== 'undefined' ? CONFIG.VALIDATION_ERROR_LABEL : 'Verifica',
      skipLabelName: typeof CONFIG !== 'undefined' && CONFIG.SKIP_LABEL_NAME ? CONFIG.SKIP_LABEL_NAME : '·',
      ignoreLabelName: typeof CONFIG !== 'undefined' && CONFIG.IGNORE_LABEL_NAME ? CONFIG.IGNORE_LABEL_NAME : 'Ignorato',
      validationWarningThreshold: typeof CONFIG !== 'undefined' && typeof CONFIG.VALIDATION_WARNING_THRESHOLD === 'number'
        ? CONFIG.VALIDATION_WARNING_THRESHOLD
        : 0.9,
      maxConsecutiveExternal: typeof CONFIG !== 'undefined' && typeof CONFIG.MAX_CONSECUTIVE_EXTERNAL === 'number'
        ? CONFIG.MAX_CONSECUTIVE_EXTERNAL
        : 5,
      emptyInboxWarningThreshold: typeof CONFIG !== 'undefined' && typeof CONFIG.EMPTY_INBOX_WARNING_THRESHOLD === 'number'
        ? CONFIG.EMPTY_INBOX_WARNING_THRESHOLD
        : 5,
      searchPageSize: typeof CONFIG !== 'undefined' && typeof CONFIG.SEARCH_PAGE_SIZE === 'number'
        ? CONFIG.SEARCH_PAGE_SIZE
        : 50
    };

    this.logger.info('EmailProcessor inizializzato', {
      validazione: this.config.validationEnabled,
      dryRun: this.config.dryRun
    });

    // Timestamp run corrente (usato da _isNearDeadline/_getRemainingTimeMs).
    // Viene poi resettato all'avvio di ogni batch in processUnreadEmails.
    this._startTime = Date.now();
  }

  /**
   * Elabora il singolo thread (analisi, categorizzazione, generazione risposta, invio)
   * @param {GmailThread} thread 
   * @param {string} knowledgeBase - KB testo semplice
   * @param {Array} doctrineBase - KB strutturata
   * @param {?Set} labeledMessageIds - ID messaggi già etichettati (opzionale)
   * @param {boolean} skipLock - Se true, salta acquisizione lock
   */
  processThread(thread, knowledgeBase, doctrineBase, labeledMessageIds = null, skipLock = false) {
    const threadId = thread.getId();
    const startTime = Date.now();
    // Garantisce che _isNearDeadline() funzioni anche se processThread
    // è invocato direttamente (test, debug) senza passare per processUnreadEmails.
    if (!this._startTime) {
      this._startTime = startTime;
    }
    const normalizedKnowledgeBase = this._normalizeTextContent(knowledgeBase);
    const normalizedDoctrineBase = this._normalizeTextContent(doctrineBase);
    const languageMode = this._getLanguageProcessingMode_();

    // ====================================================================
    // ACQUISIZIONE LOCK (LIVELLO-THREAD) - Previene condizioni di conflitto
    // ====================================================================

    let lockAcquired = false;
    const scriptCache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
      ? CacheService.getScriptCache()
      : null;
    const threadLockKey = `thread_lock_${threadId}`;
    let lockValue = null;

    if (skipLock) {
      console.log(`🔒 Lock saltato per thread ${threadId} (chiamante ha già lock)`);
    } else if (!scriptCache || typeof LockService === 'undefined' || !LockService || typeof LockService.getScriptLock !== 'function') {
      console.warn(`⚠️ Lock service/cache non disponibili per thread ${threadId}: procedo senza lock`);
    } else {
      const configuredTtl = (typeof CONFIG !== 'undefined' && Number(CONFIG.CACHE_LOCK_TTL))
        ? Number(CONFIG.CACHE_LOCK_TTL)
        : 240; // Fallback allineato al default config per coprire OCR + validazione semantica

      // CacheService supporta max 21600 secondi (6h): clamp difensivo.
      const ttlSeconds = Math.max(1, Math.min(configuredTtl, 21600));
      const lockTtlMs = ttlSeconds * 1000;

      // Aggiunge entropia per evitare collisioni se due thread identici partono nello stesso Ms 
      const entropy = Math.random().toString(36).substring(2, 8);
      lockValue = `${Date.now()}_${entropy}`;

      const scriptLock = LockService.getScriptLock();
      let scriptLockAcquired = false;
      try {
        if (!scriptLock.tryLock(5000)) {
          console.warn(`🔒 Impossibile acquisire lock globale per thread ${threadId}, salto`);
          return { status: 'skipped', reason: 'global_lock_unavailable' };
        }
        scriptLockAcquired = true;

        const existingLock = scriptCache.get(threadLockKey);
        if (existingLock) {
          const existingTimestamp = Number(String(existingLock).split('_')[0]);
          const isStale = !isNaN(existingTimestamp) && (Date.now() - existingTimestamp) > lockTtlMs;

          if (isStale) {
            console.warn(`🔓 Lock stale rilevato per thread ${threadId}, pulizia`);
            scriptCache.remove(threadLockKey);
          } else {
            console.warn(`🔒 Thread ${threadId} lockato da altro processo, salto`);
            return { status: 'skipped', reason: 'thread_locked' };
          }
        }

        scriptCache.put(threadLockKey, lockValue, ttlSeconds);
        const confirmValue = scriptCache.get(threadLockKey);
        if (confirmValue !== lockValue) {
          console.warn(`🔒 Collisione lock cache su thread ${threadId}, salto`);
          return { status: 'skipped', reason: 'thread_lock_collision' };
        }

        lockAcquired = true;
        console.log(`🔒 Lock acquisito per thread ${threadId}`);
      } catch (e) {
        console.warn(`⚠️ Errore acquisizione lock thread: ${e.message}`);
        return { status: 'error', error: 'Lock acquisition failed' };
      } finally {
        if (scriptLockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
          try {
            scriptLock.releaseLock();
          } catch (_) { }
        }
      }
    }

    const result = {
      status: 'unknown',
      validationFailed: false,
      dryRun: false,
      error: null
    };

    let candidate = null;
    let replySent = false;
    try {
      // Raccogli informazioni su thread e messaggi
      // Ottieni ultimo messaggio NON LETTO nel thread
      const messages = thread.getMessages();
      const unreadMessages = messages.filter(m => m.isUnread());

      // Recupero indirizzo email corrente con fallback robusto
      let myEmail = '';
      try {
        if (typeof Session !== 'undefined' && Session && typeof Session.getEffectiveUser === 'function') {
          const effectiveUser = Session.getEffectiveUser();
          if (effectiveUser && typeof effectiveUser.getEmail === 'function') {
            myEmail = effectiveUser.getEmail() || '';
          }
        }
      } catch (sessionError) {
        console.warn(`⚠️ Impossibile recuperare email utente da Session: ${sessionError.message}`);
      }

      let gmailAliases = [];
      try {
        gmailAliases = (typeof GmailApp !== 'undefined' && GmailApp && typeof GmailApp.getAliases === 'function')
          ? (GmailApp.getAliases() || [])
          : [];
      } catch (aliasError) {
        console.warn(`⚠️ Impossibile recuperare alias Gmail: ${aliasError.message}`);
      }

      if (!myEmail && gmailAliases.length > 0) {
        myEmail = gmailAliases[0] || '';
      }

      if (!myEmail) {
        const adminEmailProperty = (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function')
          ? PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL')
          : '';
        const adminEmailConfig = (typeof CONFIG !== 'undefined' && CONFIG.LOGGING && CONFIG.LOGGING.ADMIN_EMAIL)
          ? CONFIG.LOGGING.ADMIN_EMAIL
          : '';
        const adminEmail = adminEmailProperty || adminEmailConfig || '';
        const botEmailProperty = (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function')
          ? PropertiesService.getScriptProperties().getProperty('BOT_EMAIL')
          : '';
        const botEmailConfig = (typeof CONFIG !== 'undefined' && CONFIG.BOT_EMAIL) ? CONFIG.BOT_EMAIL : '';

        myEmail = adminEmail || botEmailProperty || botEmailConfig || '';

        if (myEmail) {
          console.warn(`⚠️ Session email non disponibile: uso fallback anti-loop (${myEmail})`);
        } else {
          console.warn('⚠️ Session email non disponibile e nessun fallback configurato (ScriptProperties.ADMIN_EMAIL/CONFIG.LOGGING.ADMIN_EMAIL/BOT_EMAIL/CONFIG.BOT_EMAIL)');
        }
      }

      // ====================================================================
      // FILTRO A LIVELLO MESSAGGIO
      // ====================================================================
      let effectiveLabeledIds;
      if (labeledMessageIds instanceof Set) {
        effectiveLabeledIds = labeledMessageIds;
      } else {
        const fetchedIds = this.gmailService.getMessageIdsWithLabel(this.config.labelName);
        effectiveLabeledIds = (fetchedIds instanceof Set) ? fetchedIds : new Set(fetchedIds || []);
      }

      const unlabeledUnread = unreadMessages.filter(message => {
        const messageId = message.getId();
        if (effectiveLabeledIds.has(messageId)) return false;
        return true;
      });

      const markUnlabeledUnreadAsProcessed = () => {
        unlabeledUnread.forEach(message => this._markMessageAsProcessed(message, labeledMessageIds));
      };

      // Build set of our own addresses (primary + aliases) per filtro early-stage
      const ownAddresses = new Set();
      if (myEmail) ownAddresses.add(this._normalizeEmailAddress_(myEmail));
      gmailAliases.forEach(alias => {
        if (alias) ownAddresses.add(this._normalizeEmailAddress_(alias));
      });
      const knownAliasesArray = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.KNOWN_ALIASES))
        ? CONFIG.KNOWN_ALIASES : [];
      knownAliasesArray.forEach(alias => {
        if (alias) ownAddresses.add(this._normalizeEmailAddress_(alias));
      });

      const externalUnread = unlabeledUnread.filter(message => {
        // B07: Usa getFrom() leggero anziché la costosa extractMessageDetails()
        const rawFrom = (message.getFrom() || '');
        const senderEmail = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
          ? this.gmailService._extractEmailAddress(rawFrom)
          : rawFrom;

        // Se non riusciamo ad estrarre l'email, consideriamo il mittente come esterno per sicurezza
        if (!senderEmail) return true;
        return !ownAddresses.has(this._normalizeEmailAddress_(senderEmail));
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
        // Messaggi interni (nostri/alias) non sono "processati da IA":
        // vanno marcati come saltati per non inquinare metrica/label IA.
        this._markMessagesAsSkipped(unlabeledUnread);
        result.status = 'skipped';
        result.reason = 'no_external_unread';
        return result;
      }

      // Seleziona ultimo messaggio non letto non etichettato da esterni.
      // La discovery resta deliberatamente a livello messaggio: l'eventuale presenza
      // di materiale IA nello stesso thread NON deve nascondere nuovi follow-up non letti.
      candidate = externalUnread[externalUnread.length - 1];

      // ====================================================================
      // STEP 0: CONTROLLO ULTIMO MITTENTE (Anti-Loop & Ownership)
      // Thread usato solo come contesto conversazionale e per capire chi ha parlato per ultimo.
      // Se l'ultimo intervento è nostro, ci fermiamo senza fare ulteriori chiamate metadata.
      // ====================================================================
      const normalizedMyEmail = myEmail ? this._normalizeEmailAddress_(myEmail) : '';
      const normalizedKnownAliases = Array.from(ownAddresses).filter(address => address && address !== normalizedMyEmail);
      const lastMessage = messages[messages.length - 1];
      const lastSenderRaw = lastMessage.getFrom() || '';
      const lastSenderEmail = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
        ? this._normalizeEmailAddress_(this.gmailService._extractEmailAddress(lastSenderRaw) || '')
        : '';
      const lastSpeakerIsUs = Boolean(lastSenderEmail) && ownAddresses.has(lastSenderEmail);

      if (lastSpeakerIsUs) {
        console.log('   ⊖ Saltato: l\'ultimo messaggio del thread è già nostro (bot o segreteria)');
        // Segniamo i non letti correnti come processati per evitare loop su thread
        // dove l'ultimo intervento è nostro ma restano flag "unread" riaperti manualmente.
        markUnlabeledUnreadAsProcessed();
        result.status = 'skipped';
        result.reason = 'last_speaker_is_me';
        return result;
      }

      // --- PORTA 0.5: Pre-check lingua locale sul soggetto (Zero API Cost) ---
      if (languageMode === 'foreign_only') {
        const subjectOnly = (candidate.getSubject() || '');
        let bodyPreview = '';
        try {
          bodyPreview = (candidate.getPlainBody && typeof candidate.getPlainBody === 'function')
            ? (candidate.getPlainBody() || '')
            : '';
        } catch (bodyError) {
          console.warn(`⚠️ Impossibile leggere body per pre-check lingua: ${bodyError.message}`);
        }
        if (subjectOnly.trim() !== '' && bodyPreview.trim() === '') {
          // Pre-check: solo termini inequivocabilmente italiani.
          // Escluse deliberatamente parole corte polisemiche (in, per, la, di, da, con, il, lo,
          // gli, le, un, uno, una, su, tra, fra) che causano falsi positivi su lingue straniere.
          const italianPattern = /(?:^|[^\p{L}\p{N}_])(appuntamento|fissare|prenotare|disponibilit[àa]|orari[oa]?|incontro|prenotazione|informazioni|chiedere|sapere|vorrei|come\s+faccio|requisiti|battesimo|cresima|confessione|grazie|salve|buongiorno|buonasera|preventivo|parrocchia|segreteria|messa|messe)(?=$|[^\p{L}\p{N}_])/iu;
          
          if (italianPattern.test(subjectOnly)) {
            console.log(`   ⊖ Pre-check locale: italiano rilevato nel solo oggetto ("${subjectOnly.substring(0, 20)}...") → skip anticipato`);
            this._markMessagesAsSkipped(unlabeledUnread);
            result.status = 'skipped';
            result.reason = 'italian_skipped_foreign_only_precheck';
            return result;
          }
        }
      }

      // STEP 1: Estrazione dati e pulizia
      console.log('   STEP 1: Estrazione dati e pulizia...');
      const messageDetails = this.gmailService.extractMessageDetails(candidate);
      console.log(`\n📧 Elaborazione: ${(messageDetails.subject || '').substring(0, 50)}...`);
      console.log(`   Da: ${messageDetails.senderEmail} (${messageDetails.senderName})`);

      // ====================================================================================================
      // STEP 1.5: FAIL-FAST LINGUA (a costo zero)
      // ====================================================================================================
      const bodyForLanguageDetection = (this.classifier && typeof this.classifier._extractMainContent === 'function')
        ? this.classifier._extractMainContent(messageDetails.body || '')
        : (messageDetails.body || '');

      const languageDetection = (this.geminiService && typeof this.geminiService.detectEmailLanguage === 'function')
        ? (this.geminiService.detectEmailLanguage(
          bodyForLanguageDetection,
          messageDetails.subject
        ) || {})
        : { lang: 'it' };
      
      // Estraiamo solo i primi 2 caratteri per gestire formati come "it-IT" o "en-US"
      let detectedLanguage = (languageDetection.lang || 'it').toLowerCase().substring(0, 2);
      if (bodyForLanguageDetection !== (messageDetails.body || '')) {
        console.log('   ✂️ Lingua: uso corpo pulito (senza firma/citazioni) per ridurre falsi positivi');
      }
      console.log(`   🌐 Lingua (rilevamento locale): ${detectedLanguage.toUpperCase()}`);

      // PORTA 1: Interrompiamo se l'email deve essere ignorata in base alla lingua
      if (this._shouldSkipByLanguageMode_(detectedLanguage, languageMode)) {
        console.log('   ⊖ Saltato: modalità "Solo straniere", email in italiano');
        // SCELTA CRITICA ANTI-REGRESSIONE (2 vincoli):
        //
        // 1) In modalità foreign_only NON dobbiamo marcare il messaggio come "IA/processato".
        //    Motivo operativo: se in futuro la parrocchia torna in modalità "all",
        //    questa stessa email italiana deve rimanere eleggibile per l'elaborazione.
        //
        // 2) L'etichetta da applicare DEVE essere skipLabelName ('·', punto centrato),
        //    MAI ignoreLabelName ('Ignorato'). La label '·' è discreta e non intrusiva
        //    nell'interfaccia Gmail; 'Ignorato' è riservata esclusivamente ai messaggi
        //    scartati per blacklist/spam/auto-reply (filtri _shouldIgnoreEmail).
        //    ⚠️  NON CAMBIARE: volontà esplicita del proprietario del progetto.
        this._markMessagesAsSkipped(unlabeledUnread);
        result.status = 'skipped';
        result.reason = 'italian_skipped_foreign_only';
        return result;
      }

      if (messageDetails.isNewsletter) {
        console.log('   ⊖ Saltato: rilevata newsletter (List-Unsubscribe/Precedence)');
        // Newsletter/automazioni NON devono finire sotto etichetta IA: restano "saltate"
        // per coerenza con gli altri filtri regolistici (ignore rules / no-reply).
        this._markMessagesAsSkipped(unlabeledUnread);
        result.status = 'filtered';
        result.reason = 'newsletter_header';
        return result;
      }

      // ====================================================================
      // STEP 0.2: AUTO-REPLY / OUT-OF-OFFICE DETECTION
      // ====================================================================
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

      if (
        /auto-replied|auto-generated/i.test(autoSubmitted) ||
        /bulk|auto_reply/i.test(precedence) ||
        /auto-reply|autoreply/i.test(xAutoReply) ||
        /oof|all|dr|rn|nri|auto/i.test(xAutoResponseSuppress)
      ) {
        console.log('   ⊖ Saltato: risposta automatica (header SMTP)');
        markUnlabeledUnreadAsProcessed();
        result.status = 'filtered';
        result.reason = 'out_of_office';
        return result;
      }

      const outOfOfficePatterns = [
        /\b(out of office|away from office|fuori ufficio|assente)\b/i,
        /\b(automatic reply|risposta automatica)\b/i,
        /\breturn(ing)? on\b/i,
        /\bdi ritorno (il|dal)\b/i,
        /\b(thank you for your message|mailbox monitored periodically)\b/i
      ];

      const oooSubject = messageDetails.subject || '';
      // Trunca a 2000 char per prevenire Regex Timeout su mega-thread
      const oooBody = (messageDetails.body || '').substring(0, 2000);
      if (outOfOfficePatterns.some(p => p.test(`${oooSubject} ${oooBody}`))) {
        console.log('   ⊖ Saltato: risposta automatica out-of-office (testo)');
        markUnlabeledUnreadAsProcessed();
        result.status = 'filtered';
        result.reason = 'out_of_office';
        return result;
      }

      const candidateIndex = messages.findIndex(msg => msg.getId() === candidate.getId());
      if (candidateIndex > 0 && messages[candidateIndex - 1]) {
        const previousMessage = messages[candidateIndex - 1];
        const previousSenderEmail = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
          ? this._normalizeEmailAddress_(this.gmailService._extractEmailAddress(previousMessage.getFrom() || '') || '')
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

        if (previousIsUs && arrivedSoonAfterUs && isShortClosureReply) {
          console.log('   ⊖ Saltato: risposta breve di chiusura (grazie/ok/perfetto)');
          markUnlabeledUnreadAsProcessed();
          result.status = 'filtered';
          result.reason = 'short_closure_reply';
          return result;
        }
      }

      // ====================================================================
      // STEP 0.5: ANTI-LOOP (rilevamento intelligente)
      // ====================================================================
      const MAX_THREAD_LENGTH = (typeof CONFIG !== 'undefined' && CONFIG.MAX_THREAD_LENGTH) ? CONFIG.MAX_THREAD_LENGTH : 8;
      const MAX_CONSECUTIVE_EXTERNAL = this.config.maxConsecutiveExternal;

      if (messages.length > MAX_THREAD_LENGTH) {
        const hasAnyIdentity = Boolean(normalizedMyEmail) || normalizedKnownAliases.length > 0;
        if (!hasAnyIdentity) {
          console.warn('   ⚠️ Identità mittente non disponibile con thread lungo: blocco precauzionale anti-loop');
          markUnlabeledUnreadAsProcessed();
          result.status = 'filtered';
          result.reason = 'anti_loop_identity_missing';
          return result;
        } else {
          let consecutiveExternal = 0;
          let botRepliesCount = 0;

          // Percorriamo i messaggi a ritroso per contare gli esterni consecutivi
          for (let i = messages.length - 1; i >= 0; i--) {
            const rawFrom = messages[i] && typeof messages[i].getFrom === 'function'
              ? messages[i].getFrom()
              : '';
            const msgFrom = String(rawFrom || '');
            const msgSenderEmail = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
              ? this._normalizeEmailAddress_(this.gmailService._extractEmailAddress(msgFrom) || '')
              : this._normalizeEmailAddress_(msgFrom);

            const isUs = Boolean(msgSenderEmail) && ownAddresses.has(msgSenderEmail);

            if (isUs) {
              botRepliesCount++;
              // Se troviamo un nostro messaggio, la sequenza di esterni consecutivi si interrompe
              break;
            } else {
              consecutiveExternal++;
            }
          }

          if (consecutiveExternal >= MAX_CONSECUTIVE_EXTERNAL) {
            console.log(`   ⊖ Saltato: prevenzione loop email (${consecutiveExternal} esterni consecutivi alla fine del thread)`);
            markUnlabeledUnreadAsProcessed();
            result.status = 'filtered';
            result.reason = 'email_loop_detected';
            return result;
          }
        }

        console.warn(`   ⚠️ Thread lungo (${messages.length} messaggi) ma non loop - elaboro`);
      }

      // ====================================================================
      // STEP 0.8: ANTI-MITTENTE-NOREPLY
      // ====================================================================
      const senderInfo = `${messageDetails.senderEmail} ${messageDetails.senderName}`.toLowerCase();
      const autoPattern = /no-reply|do-not-reply|noreply|daemon|postmaster|bounce|mailer/i;
      if (autoPattern.test(senderInfo)) {
        console.log('   ⊖ Saltato: mittente rilevato come casella automatica o no-reply');
        // Elaborato (filtrato): applichiamo IA per chiudere il processo
        markUnlabeledUnreadAsProcessed();
        result.status = 'filtered';
        result.reason = 'no_reply_sender';
        return result;
      }

      // ====================================================================
      // STEP 1: FILTRO - Domini/parole chiave ignorati
      // ====================================================================
      if (this._shouldIgnoreEmail(messageDetails)) {
        console.log('   ⊖ Filtrato: domain/keyword ignore');
        // Elaborato (filtrato): applichiamo IA per chiudere il processo
        markUnlabeledUnreadAsProcessed();

        result.status = 'filtered';
        result.reason = 'ignore_rules';
        return result;
      }

      // ====================================================================
      // STEP 2: CLASSIFICAZIONE - Filtro ack/greeting ultra-semplice
      // ====================================================================
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
        // Elaborato (filtrato): applichiamo IA per chiudere il processo
        markUnlabeledUnreadAsProcessed();
        result.status = 'filtered';
        return result;
      }

      // ====================================================================
      // STEP 3: CONTROLLO RAPIDO - Gemini decide se serve risposta
      // ====================================================================
      let quickCheck;
      try {
        quickCheck = this.geminiService.shouldRespondToEmail(
          messageDetails.body,
          messageDetails.subject,
          languageDetection
        );
      } catch (quickError) {
        console.warn(`   ⚠️ Gemini quick check fallito: ${quickError.message}. Thread lasciato non etichettato per retry successivo.`);
        result.status = 'error';
        result.error = 'quick_check_failed';
        return result;
      }

      if (!quickCheck.shouldRespond) {
        console.log(`   ⊖ Gemini quick check: nessuna risposta necessaria (${quickCheck.reason})`);
        if (quickCheck.reason === 'quick_check_failed') {
          console.warn('   ⚠️ Gemini quick check fallito: thread lasciato non etichettato per retry successivo.');
          result.status = 'error';
          result.error = 'quick_check_failed';
          return result;
          // ↑ Uscita intenzionale senza marcare nulla: i secondari restano
          //   visibili al prossimo trigger per garantire il retry.
        }
        this._markMessageAsProcessed(candidate, labeledMessageIds);

        // Marchiamo sempre i secondari quando il candidato è stato scartato:
        // il thread è già stato valutato e lasciarli non etichettati genera
        // riprocessamenti inutili nei trigger successivi.
        unlabeledUnread.forEach(message => {
          if (message.getId() !== candidate.getId()) {
            this._markMessageAsProcessed(message, labeledMessageIds);
          }
        });
        result.status = 'filtered';
        return result;
      }

      // Quick check superato con shouldRespond=true: marca i secondari ora.
      if (languageMode !== 'foreign_only') {
        unlabeledUnread.forEach(message => {
          if (message.getId() !== candidate.getId()) {
            this._markMessageAsProcessed(message, labeledMessageIds);
          }
        });
      } else {
        console.log('   🌐 Modalità "Solo straniere": non pre-marco i non letti secondari');
      }

      // Se Gemini Quick Check ha rilevato una lingua diversa con maggiore precisione, aggiorniamo
      if (quickCheck.language && quickCheck.language.substring(0, 2).toLowerCase() !== detectedLanguage) {
        detectedLanguage = quickCheck.language.substring(0, 2).toLowerCase();
        console.log(`   🌐 Lingua (aggiornata da AI): ${detectedLanguage.toUpperCase()}`);
      }

      // PORTA 1-bis: Coerenza modalità lingua dopo raffinamento quick-check.
      // Se la lingua viene aggiornata a IT in foreign_only, fermiamo qui senza
      // etichettare IA per mantenere la possibilità di riprocessare in modalità "all".
      if (this._shouldSkipByLanguageMode_(detectedLanguage, languageMode)) {
        console.log('   ⊖ Saltato: modalità "Solo straniere", lingua italiana confermata dopo quick-check');
        this._markMessagesAsSkipped(unlabeledUnread);
        result.status = 'skipped';
        result.reason = 'italian_skipped_foreign_only_post_quickcheck';
        return result;
      }

      // ====================================================================
      // STEP 4: CLASSIFICAZIONE TIPO RICHIESTA (Multi-dimensionale)
      // ====================================================================
      const requestTypeRaw = this.requestClassifier.classify(
        messageDetails.subject,
        messageDetails.body,
        quickCheck.classification
      );
      // Normalizzazione difensiva: alcuni fallback legacy possono restituire null/undefined.
      // Manteniamo sempre un oggetto per evitare accessi property non sicuri a valle.
      const requestType = (requestTypeRaw && typeof requestTypeRaw === 'object') ? requestTypeRaw : {};

      // ====================================================================
      // STEP 5: KB ENRICHMENT CONDIZIONALE
      // ====================================================================
      const knowledgeSections = [];
      const resourceCache = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE) ? GLOBAL_CACHE : {};
      const effectiveDoctrineBase = normalizedDoctrineBase || (resourceCache.doctrineBase || '');
      const doctrineStructured = Array.isArray(resourceCache.doctrineStructured) ? resourceCache.doctrineStructured : [];
      const aiCoreLite = (resourceCache.aiCoreLite != null) ? resourceCache.aiCoreLite : '';
      const aiCore = (resourceCache.aiCore != null) ? resourceCache.aiCore : '';

      // KB principale: passata "pulita" al PromptEngine per evitare overhead
      // e rispettare il budget di troncamento sui contenuti realmente informativi.
      knowledgeSections.push(normalizedKnowledgeBase);

      // AI_CORE e Dottrina NON vengono iniettati qui: è responsabilità esclusiva di
      // PromptEngine (buildPrompt) che li riceve via opzioni con logica selettiva.
      // Doppia iniezione causerebbe gonfiamento prompt e rischio truncation.

      // Placeholder: eventuali regole calendario speciali possono essere
      // iniettate qui quando verrà implementato un provider dedicato.

      const enrichedKnowledgeBase = knowledgeSections.filter(Boolean).join('\n\n');

      // ====================================================================
      // STEP 6: STORICO CONVERSAZIONE
      // ====================================================================
      let conversationHistory = '';
      if (messages.length > 1) {
        const candidateId = candidate.getId();
        const historyMessages = messages.filter(m => m.getId() !== candidateId);

        if (historyMessages.length > 0) {
          conversationHistory = this.gmailService.buildConversationHistory(
            historyMessages,
            10,
            myEmail,
            gmailAliases
          );
        }
      }

      // ====================================================================
      // STEP 6.5: CONTESTO MEMORIA
      // ====================================================================
      const memoryContext = this.memoryService.getMemory(threadId) || {};

      if (Object.keys(memoryContext).length > 0) {
        console.log(`   🧠 Memoria trovata: lang=${memoryContext.language}, topics=${(memoryContext.providedInfo || []).length}`);
      }

      // ====================================================================
      // STEP 6.6: CALCOLO DINAMICO SALUTO E RITARDO
      // ====================================================================
      const memoryMessageCount = Number.isFinite(Number(memoryContext.messageCount))
        ? Number(memoryContext.messageCount)
        : 0;

      const salutationMode = computeSalutationMode({
        isReply: safeSubjectLower.startsWith('re:'),
        messageCount: memoryMessageCount,
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

      // ====================================================================
      // STEP 7: COSTRUISCI PROMPT
      // ====================================================================
      let { greeting, closing } = this.geminiService.getAdaptiveGreeting(
        messageDetails.senderName,
        detectedLanguage
      );

      // Override strutturale: nessun saluto in conversazioni attive
      if (salutationMode === 'none_or_continuity' || salutationMode === 'session') {
        greeting = '';
      } else if (salutationMode === 'soft') {
        greeting = '';
      }

      // ====================================================================
      // PASSO 7.1: VERIFICA TERRITORIO (solo quando richiesta esplicita)
      // ====================================================================
      const territoryRequested = this._isTerritoryRequest(
        messageDetails.subject,
        messageDetails.body,
        quickCheck?.classification || {}, // Usa classificazione Gemini evitando errori se null.
        requestType
      );

      let territoryResult = { addressFound: false };
      if (territoryRequested && this.territoryValidator) {
        try {
          territoryResult = this.territoryValidator.analyzeEmailForAddress(
            messageDetails.body,
            messageDetails.subject
          );
        } catch (territoryError) {
          console.warn(`⚠️ Errore non fatale in territoryValidator: ${territoryError.message}`);
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
          ? (addressLines.length > 1 ? `${addressLines.length} indirizzi` : '1 indirizzo')
          : 'nessun indirizzo';
        console.log(`   🎯 Verifica territorio: ${summary}`);
      } else {
        console.log('   ⊖ Verifica territorio non richiesta: controllo saltato');
      }

      // ====================================================================
      // STEP 7.2: PROMPT CONTEXT (profilo e concern dinamici)
      // ====================================================================
      let promptProfile = 'standard';
      let activeConcerns = {};
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
          conversation: { messageCount: memoryMessageCount },
          territory: { addressFound: territoryResult.addressFound },
          knowledgeBase: enrichedKnowledgeBase,
          knowledgeBaseMeta: {
            length: enrichedKnowledgeBase.length,
            containsDates: this._detectTemporalMentions(enrichedKnowledgeBase, detectedLanguage) || /\b\d{1,2}\/\d{1,2}\b/.test(enrichedKnowledgeBase)
          },
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

      const requestTypeName = requestType && requestType.type ? requestType.type : '';
      const categoryHintSource = String(classification.category || requestTypeName || '').toLowerCase() || null;

      // ====================================================================
      // STEP 7.1: PREPARAZIONE ALLEGATI (Multimodale / Vision)
      // ====================================================================
      let attachmentBlobs = [];
      let textFromAttachments = '';
      let attachmentSkipped = [];

      if (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT && CONFIG.ATTACHMENT_CONTEXT.enabled) {
        if (this._isNearDeadline(this.config.maxExecutionTimeMs)) {
          attachmentSkipped.push({ reason: 'near_deadline' });
          console.warn('   ⏳ Allegati multimodali saltati: tempo residuo insufficiente.');
        } else {
          let hasAttachments = false;
          try {
            const attachments = candidate.getAttachments({ includeInlineImages: true, includeAttachments: true }) || [];
            hasAttachments = attachments.length > 0;
          } catch (e) {
            console.warn(`⚠️ Impossibile leggere allegati per pre-check: ${e.message}`);
          }

          if (!hasAttachments) {
            attachmentSkipped.push({ reason: 'no_attachments' });
            console.log('   📎 Elaborazione allegati saltata: nessun allegato nel messaggio candidato');
          } else if (
            (messageDetails.body || '').trim().length < 50 ||
            this._shouldTryOcr(messageDetails.body, messageDetails.subject, candidate)
          ) {
            // Body molto corto (<50 char) → l'allegato è probabilmente il contenuto principale
            if ((messageDetails.body || '').trim().length < 50) {
              console.log('   📎 Body corto: elaborazione allegati forzata');
            }
            console.log('   📎 Elaborazione allegati multimodale (Vision)...');
            const attachmentData = this.gmailService.getProcessableAttachments(candidate);
            attachmentBlobs = attachmentData.blobs || [];
            textFromAttachments = attachmentData.textContext || '';
            attachmentSkipped = attachmentData.skipped || [];

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
            console.log('   📎 Elaborazione allegati saltata: keyword trigger non rilevate');
          }

        }
      }


      const promptOptions = {
        emailContent: messageDetails.body,
        emailSubject: messageDetails.subject,
        knowledgeBase: enrichedKnowledgeBase,
        doctrineBase: effectiveDoctrineBase,
        senderName: messageDetails.senderName,
        senderEmail: messageDetails.senderEmail,
        conversationHistory: conversationHistory,
        category: categoryHintSource,
        topic: quickCheck.classification ? quickCheck.classification.topic : '',
        detectedLanguage: detectedLanguage,
        currentSeason: this._getCurrentSeason(),
        currentDate: this._getBusinessDateString(),
        salutation: greeting,
        closing: closing,
        subIntents: classification.subIntents || {},
        memoryContext: memoryContext,
        salutationMode: salutationMode,
        responseDelay: responseDelay,
        promptProfile: promptProfile,
        activeConcerns: activeConcerns,
        territoryContext: territoryContext,
        requestType: requestType,
        attachmentsContext: textFromAttachments,
        aiCoreLite: aiCoreLite,
        aiCore: aiCore,
        doctrineStructured: doctrineStructured
      };

      const prompt = this.promptEngine.buildPrompt(promptOptions);

      const fullPrompt = prompt;

      // ====================================================================
      // STEP 8: GENERA RISPOSTA
      // ====================================================================
      let response = null;
      let generationError = null;
      let initialError = null;
      let strategyUsed = null;
      let strategyUsedPlan = null;

      if (this._isNearDeadline(this.config.maxExecutionTimeMs)) {
        console.warn('⏳ Tempo residuo insufficiente prima della generazione AI: rimando il thread al prossimo turno.');
        result.status = 'skipped';
        result.reason = 'near_deadline_before_generation';
        return result;
      }

      const geminiModels = (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_MODELS) ? CONFIG.GEMINI_MODELS : {};
      const flashModel = (geminiModels['flash-2.5'] && geminiModels['flash-2.5'].name) ? geminiModels['flash-2.5'].name : 'gemini-2.5-flash';
      const liteModel = (geminiModels['flash-lite'] && geminiModels['flash-lite'].name) ? geminiModels['flash-lite'].name : 'gemini-2.5-flash-lite';

      const attemptStrategy = [
        { name: 'Primary-Flash2.5', key: this.geminiService.primaryKey, model: flashModel, skipRateLimit: false },
        { name: 'Backup-Flash2.5', key: this.geminiService.backupKey, model: flashModel, skipRateLimit: true },
        { name: 'Fallback-Lite', key: this.geminiService.primaryKey, model: liteModel, skipRateLimit: false }
      ];

      for (const plan of attemptStrategy) {
        if (!plan.key) continue;

        try {
          console.log(`🔄 Tentativo Generazione: ${plan.name}...`);

          response = this.geminiService.generateResponse(fullPrompt, {
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

          if (response) {
            strategyUsed = plan.name;
            strategyUsedPlan = plan;
            console.log(`✅ Generazione riuscita con strategia: ${plan.name}`);
            break;
          }

        } catch (err) {
          generationError = err;
          if (!initialError) initialError = err;
          const errorClass = this._classifyError(err);
          console.warn(`⚠️ Strategia '${plan.name}' fallita: ${err.message} [${errorClass.type}]`);

          if (errorClass.type === 'FATAL') {
            console.error('🛑 Errore fatale rilevato, interrompo strategia.');
            break;
          }

          if (['NETWORK', 'TIMEOUT', 'QUOTA_EXCEEDED', 'INVALID_RESPONSE', 'UNKNOWN'].includes(errorClass.type)) {
            console.warn(`↪️ Errore ${errorClass.type}, provo la strategia successiva.`);
            continue;
          }
        }
      }

      if (!response) {
        const errorToReport = initialError || generationError;
        const errorClass = errorToReport ? this._classifyError(errorToReport) : { type: 'UNKNOWN', retryable: false, message: 'Generation strategies exhausted' };
        console.error('🛑 TUTTE le strategie di generazione sono fallite.');
        if (!errorClass.retryable) {
          this._addErrorLabel(candidate || thread);
          this._markMessageAsProcessed(candidate, labeledMessageIds);
        } else {
          console.warn(`   ↻ Errore generazione retryable (${errorClass.type}) - nessuna marcatura permanente`);
        }
        result.status = 'error';
        result.error = errorToReport ? String(errorToReport.message || errorToReport) : 'Generation strategies exhausted';
        if (initialError && generationError && initialError !== generationError) {
          result.error += ` (Ultimo fallback: ${String(generationError.message || generationError)})`;
        }
        result.errorClass = errorClass.type;
        return result;
      }

      if (typeof response !== 'string') {
        console.error(`🛑 Risposta non valida da Gemini: tipo ricevuto '${typeof response}'`);
        this._addErrorLabel(candidate || thread);
        this._markMessageAsProcessed(candidate, labeledMessageIds);
        result.status = 'error';
        result.error = 'Invalid response type from GeminiService';
        result.errorClass = 'DATA';
        return result;
      }

      if (response.trim() === 'NO_REPLY') {
        console.log('   ⊖ AI ha restituito NO_REPLY');
        this._markMessageAsProcessed(candidate, labeledMessageIds);
        result.status = 'filtered';
        return result;
      }


      response = this._addTimeDiscrepancyNoteIfNeeded(
        response,
        messageDetails,
        detectedLanguage
      );

      // ====================================================================
      // STEP 9: VALIDAZIONE + RETRY INTELLIGENTE
      // ====================================================================
      let finalResponse = this._prepareOutboundResponse(response, messageDetails, detectedLanguage);
      let validation = null;
      let retryAttempted = false;
      let shouldLabelForReview = false;

      if (this.config.validationEnabled) {
        validation = this.validator.validateResponse(
          finalResponse,
          detectedLanguage,
          enrichedKnowledgeBase,
          messageDetails.body,
          messageDetails.subject,
          salutationMode
        );

        if (validation.fixedResponse) {
          console.log('   🩹 Usa risposta corretta automaticamente (Self-Healing)');
          finalResponse = validation.fixedResponse;
        }

        const retryConfig = (typeof CONFIG !== 'undefined' && CONFIG.INTELLIGENT_RETRY) ? CONFIG.INTELLIGENT_RETRY : null;
        const retryEnabled = retryConfig && retryConfig.enabled !== false;
        const maxRetries = retryEnabled ? Math.max(0, parseInt(retryConfig.maxRetries, 10) || 1) : 0;

        let retryCount = 0;
        while (!validation.isValid && retryEnabled && retryCount < maxRetries && !this._isNearDeadline(this.config.maxExecutionTimeMs)) {
          const shouldRetry = this._shouldAttemptIntelligentRetry(validation, detectedLanguage, retryConfig);
          if (!shouldRetry) break;

          retryAttempted = true;
          retryCount++;
          console.log(`🔄 Retry intelligente ${retryCount}/${maxRetries} (score: ${validation.score.toFixed(2)}, errori: ${validation.errors.length})`);

          const correctionPrompt = this._buildCorrectionPrompt(
            fullPrompt,
            finalResponse,
            validation,
            detectedLanguage,
            salutationMode
          );

          const retryPlan = strategyUsedPlan || attemptStrategy.find(p => p && p.key) || {
            key: this.geminiService.primaryKey,
            model: flashModel,
            skipRateLimit: false
          };

          let retryResponse = null;
          try {
            const retryResult = this.geminiService.generateResponse(correctionPrompt, {
              apiKey: retryPlan.key,
              modelName: retryPlan.model,
              skipRateLimit: retryPlan.skipRateLimit,
              attachments: attachmentBlobs
            });

            if (retryResult && typeof retryResult === 'object') {
              if (!retryResult.text && retryResult.success) {
                console.warn('⚠️ Retry: Gemini ha restituito successo senza testo');
              }
              retryResponse = retryResult.text;
            } else if (typeof retryResult === 'string') {
              retryResponse = retryResult;
            }
          } catch (retryError) {
            console.warn(`⚠️ Retry fallito per errore API: ${retryError.message}`);
          }

          if (!retryResponse) break;

          const preparedRetryResponse = this._prepareOutboundResponse(
            retryResponse,
            messageDetails,
            detectedLanguage
          );

          const retryValidation = this.validator.validateResponse(
            preparedRetryResponse,
            detectedLanguage,
            enrichedKnowledgeBase,
            messageDetails.body,
            messageDetails.subject,
            salutationMode
          );

          if (retryValidation.isValid) {
            console.log(`✅ Retry superato (score: ${retryValidation.score.toFixed(2)})`);
            finalResponse = retryValidation.fixedResponse || preparedRetryResponse;
            validation = retryValidation;
            break;
          }

          console.warn(
            `⚠️ Retry non sufficiente (score: ${retryValidation.score.toFixed(2)}). ` +
            `Errori residui: ${retryValidation.errors.join('; ')}`
          );
          if (retryValidation.score > validation.score) {
            console.log('   → Uso risposta del retry (score più alto, nonostante non valida)');
            finalResponse = retryValidation.fixedResponse || preparedRetryResponse;
            validation = retryValidation;
          }
        }

        if (!validation.isValid) {
          const retryNote = retryAttempted ? ' (dopo retry)' : '';
          console.warn(`   🛑 Validazione FALLITA${retryNote} (punteggio: ${validation.score.toFixed(2)})`);

          if (validation.details && validation.details.exposedReasoning && validation.details.exposedReasoning.score === 0.0) {
            console.warn("⚠️ Risposta bloccata per Thinking Leak. Invio a etichetta 'Verifica'.");
            result.reason = 'thinking_leak';
          }

          this._addValidationErrorLabel(candidate || thread);
          this._markMessageAsProcessed(candidate, labeledMessageIds);
          result.status = 'validation_failed';
          result.validationFailed = true;
          if (!result.reason) {
            result.reason = 'validation_score_below_threshold';
          }
          return result;
        }

        const warningThreshold = this.config.validationWarningThreshold || 0.90;
        shouldLabelForReview =
          validation.warnings && validation.warnings.length > 0 && validation.score < warningThreshold;

        if (shouldLabelForReview) {
          console.log(`   ⚠️ Label '${this.config.validationErrorLabel}' rinviata a dopo invio riuscito`);
        } else if (validation.warnings && validation.warnings.length > 0) {
          console.log(`   ℹ️ Validazione: Punteggio alto (${validation.score.toFixed(2)}). Warning ignorati: ${validation.warnings.join(', ')}`);
        }

        // L'eventuale testo perfezionato è già stato applicato in fase di validazione.

        console.log(`   ✓ Validazione PASSATA (punteggio: ${validation.score.toFixed(2)})`);
      }

      response = finalResponse;

      // ====================================================================
      // STEP 10: INVIA RISPOSTA
      // ====================================================================
      if (this.config.dryRun) {
        console.log('   🔴 DRY RUN - Risposta non inviata');
        console.log(`   📄 Invierebbe: ${response.substring(0, 100)}...`);
        result.dryRun = true;
        result.status = 'dry_run';
        result.durationMs = Date.now() - startTime;
        this.logger.info(`Thread processato in ${result.durationMs}ms`, { threadId: threadId, duration: result.durationMs });
        return result;
      }

      const sendTxn = this._beginSendTransaction(candidate.getId(), skipLock);
      if (!sendTxn.ok) {
        console.warn(`   ⊖ Invio saltato per idempotenza (${sendTxn.reason})`);
        if (sendTxn.reason === 'already_sent') {
          this._markMessageAsProcessed(candidate, labeledMessageIds);
          result.status = 'skipped';
          result.reason = 'already_sent_recently';
        } else {
          result.status = 'skipped';
          result.reason = sendTxn.reason;
        }
        result.durationMs = Date.now() - startTime;
        return result;
      }

      try {
        this.gmailService.sendHtmlReply(candidate, response, messageDetails);
        this._commitSendTransaction(candidate.getId());
        replySent = true;
        if (shouldLabelForReview) {
          this.gmailService.addLabelToMessage(candidate.getId(), this.config.validationErrorLabel);
        }
      } catch (e) {
        this._rollbackSendTransaction(candidate.getId());
        const errorMessage = e && e.message ? e.message : String(e);
        const classifiedSendError = this._classifyError(e);
        console.error(`   🛑 Errore invio Gmail: ${errorMessage}`);

        // Errori transienti: lascia il messaggio eleggibile per retry automatico.
        if (!classifiedSendError.retryable) {
          try {
            this._addErrorLabel(candidate || thread);
          } catch (labelError) {
            console.warn(`⚠️ Errore aggiunta errorLabel silenziato: ${labelError.message}`);
          }
          if (candidate) {
            try {
              this._markMessageAsProcessed(candidate, labeledMessageIds);
            } catch (markError) {
              console.warn(`⚠️ Errore label su thread in errore silenziato: ${markError.message}`);
            }
          }
        } else {
          console.warn(`   ↻ Errore invio retryable (${classifiedSendError.type}) - nessuna marcatura permanente`);
        }

        result.status = 'error';
        result.error = `gmail_send_failed: ${errorMessage}`;
        return result;
      }

      // ====================================================================
      // STEP 11: AGGIORNA MEMORIA
      // ====================================================================
      const providedTopics = this._detectProvidedTopics(response);

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

      if (memoryContext.providedInfo && memoryContext.providedInfo.length > 0) {
        this._inferUserReaction(messageDetails.body, memoryContext.providedInfo, threadId);
      }

      const memoryUpdate = {
        language: detectedLanguage,
        category: classification.category || requestTypeName
      };

      if (memorySummary) {
        memoryUpdate.memorySummary = memorySummary;
      }

      this.memoryService.updateMemoryAtomic(threadId, memoryUpdate, topicsWithObjects.length > 0 ? topicsWithObjects : null);

      if (candidate) {
        this._markMessageAsProcessed(candidate, labeledMessageIds);
      }
      result.status = 'replied';
      result.durationMs = Date.now() - startTime;
      this.logger.info(`Thread processato in ${result.durationMs}ms`, { threadId: threadId, duration: result.durationMs });
      return result;

    } catch (error) {
      console.error(`   🛑 Errore elaborazione thread: ${error.message}`);

      if (replySent) {
        console.warn('   ⚠️ Errore post-invio: thread non etichettato come errore perché la risposta è stata già inviata');
        if (candidate) {
          try {
            this._markMessageAsProcessed(candidate, labeledMessageIds);
          } catch (markError) {
            console.warn(`⚠️ Errore label post-invio silenziato: ${markError.message}`);
          }
        }
        result.status = 'replied';
        result.warning = `post_send_error: ${error.message}`;
        result.durationMs = Date.now() - startTime;
        return result;
      }

      try {
        this._addErrorLabel(candidate || thread);
      } catch (labelError) {
        console.warn(`⚠️ Errore aggiunta errorLabel silenziato: ${labelError.message}`);
      }
      if (candidate) {
        try {
          this._markMessageAsProcessed(candidate, labeledMessageIds);
        } catch (markError) {
          console.warn(`⚠️ Errore label su thread in errore silenziato: ${markError.message}`);
        }
      }
      result.status = 'error';
      result.error = error.message;
      return result;

    } finally {
      if (lockAcquired && scriptCache && threadLockKey) {
        try {
          const currentLockValue = scriptCache.get(threadLockKey);
          // Rilasciamo SOLO se il lock è inequivocabilmente il nostro.
          if (currentLockValue === lockValue) {
            scriptCache.remove(threadLockKey);
            console.log(`🔓 Lock rilasciato per thread ${threadId}`);
          } else if (currentLockValue) {
            console.warn(`⚠️ Rilascio lock saltato per thread ${threadId} (lock scaduto o di altro processo)`);
          } else {
            console.log(`🔓 Lock già scaduto naturalmente per thread ${threadId}`);
          }
        } catch (e) {
          console.warn('⚠️ Errore rilascio lock:', e.message);
        }
      }
    }
  }

  /**
   * Processa tutte le email non lette
   * @param {string} knowledgeBase
   * @param {string} doctrineBase
   * @param {boolean} skipExecutionLock - Evita il lock batch quando il chiamante gestisce l'orchestrazione
   * @param {boolean} locksAlreadyCovered - Se true, processThread evita lock interni già coperti da lock esterno
   */
  processUnreadEmails(knowledgeBase, doctrineBase = '', skipExecutionLock = false, locksAlreadyCovered = skipExecutionLock) {
    // Inizializzazione di _startTime per la precisione dei calcoli.
    // anche se l'istanza viene riutilizzata in trigger successivi.
    this._startTime = Date.now();

    console.log('\n' + '='.repeat(70));
    console.log('📬 Inizio elaborazione email...');
    console.log('='.repeat(70));

    const executionLock = (typeof LockService !== 'undefined' && LockService && typeof LockService.getScriptLock === 'function')
      ? LockService.getScriptLock()
      : null;
    let lockAcquiredHere = false;

    if (!skipExecutionLock) {
      const lockWaitMs = (typeof CONFIG !== 'undefined' && CONFIG.EXECUTION_LOCK_WAIT_MS)
        ? CONFIG.EXECUTION_LOCK_WAIT_MS : 5000;

      if (!executionLock || !executionLock.tryLock(lockWaitMs)) {
        console.warn('⚠️ Un\'altra esecuzione è già attiva: salto questo turno per evitare doppie risposte.');
        return { total: 0, replied: 0, filtered: 0, errors: 0, skipped: 1, reason: 'execution_locked' };
      }
      lockAcquiredHere = true;
    }

    try {
      const normalizedKnowledgeBase = this._normalizeTextContent(knowledgeBase);
      const normalizedDoctrineBase = this._normalizeTextContent(doctrineBase);
      const isKnowledgeBaseMissing = normalizedKnowledgeBase === null ||
        typeof normalizedKnowledgeBase === 'undefined' ||
        normalizedKnowledgeBase === '';

      if (isKnowledgeBaseMissing) {
        this.logger.error('Knowledge base non disponibile: interrompo batch per evitare risposte senza contesto.');
        return { total: 0, replied: 0, filtered: 0, errors: 1, skipped: 0, reason: 'knowledge_base_missing' };
      }

      if (this.config.dryRun) {
        console.warn('🔴 MODALITÀ DRY_RUN ATTIVA - Email NON inviate!');
      }

      const getEffectiveMaxEmailsPerRun = () => {
        const dynamicLimit = (typeof CONFIG !== 'undefined') ? parseInt(CONFIG.MAX_EMAILS_PER_RUN, 10) : NaN;
        const fallbackLimit = parseInt(this.config.maxEmailsPerRun, 10);
        const resolved = Number.isNaN(dynamicLimit) ? fallbackLimit : dynamicLimit;
        return Number.isNaN(resolved) ? 10 : resolved;
      };

      const languageMode = typeof this._getLanguageProcessingMode_ === 'function'
        ? this._getLanguageProcessingMode_()
        : 'all';
      const labelsDaIgnorare = [this.config.labelName];
      // Il punto medio (·) lo escludiamo dalla ricerca SOLO in modalità foreign_only.
      // In modalità 'all', non lo escludiamo: così le email "parcheggiate" vengono ripescate.
      if (languageMode === 'foreign_only') {
        labelsDaIgnorare.push(this.config.skipLabelName);
      }

      let threads;
      try {
        const DISCOVERY_POOL_MULTIPLIER = 15;
        const discoveryPoolSize = Math.min(
          50,
          Math.max(getEffectiveMaxEmailsPerRun() * DISCOVERY_POOL_MULTIPLIER, 20)
        );

        threads = this.gmailService.getUnprocessedUnreadThreads(
          this.config.labelName,
          this.config.errorLabelName,
          this.config.validationErrorLabel,
          this.config.searchPageSize || 150,
          discoveryPoolSize,
          3,
          labelsDaIgnorare
        );
      } catch (e) {
        this.logger.error(`❌ Impossibile recuperare thread da elaborare: ${e.message}. Batch interrotto per sicurezza.`);
        return { total: 0, replied: 0, filtered: 0, errors: 1, skipped: 0, reason: 'thread_discovery_failed' };
      }

      if (threads.length === 0) {
        const emptyStreak = this._trackEmptyInboxStreak(true);
        console.log('Nessuna email da elaborare.');

        if (emptyStreak >= this.config.emptyInboxWarningThreshold &&
            (emptyStreak === this.config.emptyInboxWarningThreshold || emptyStreak % 50 === 0)) {
          console.warn(`⚠️ Inbox vuota da ${emptyStreak} esecuzioni consecutive. Verificare filtri Gmail/trigger in ingresso.`);
        }

        return { total: 0, replied: 0, filtered: 0, errors: 0, emptyStreak: emptyStreak };
      }

      this._trackEmptyInboxStreak(false);
      console.log(`📬 Trovati ${threads.length} thread da elaborare`);

      let labeledMessageIds = new Set();
      if (this.gmailService && typeof this.gmailService.getMessageIdsWithLabel === 'function') {
        try {
          labeledMessageIds = this.gmailService.getMessageIdsWithLabel(this.config.labelName);
        } catch (e) {
          console.warn(`⚠️ Impossibile pre-caricare gli ID etichettati (${e.message}). Continuo senza cache label.`);
          labeledMessageIds = new Set();
        }
      } else {
        console.warn('⚠️ gmailService.getMessageIdsWithLabel non disponibile: continuo senza cache label pre-caricata.');
      }

      if (!(labeledMessageIds instanceof Set)) {
        if (Array.isArray(labeledMessageIds)) {
          labeledMessageIds = new Set(labeledMessageIds);
        } else {
          labeledMessageIds = new Set();
        }
      }

      // Pre-caricamento degli ID dei messaggi con etichetta skip (·)
      // per evitare ri-discovery di thread già valutati in foreign_only.
      let skippedMessageIds = new Set();
      if (languageMode === 'foreign_only' && this.gmailService && typeof this.gmailService.getMessageIdsWithLabel === 'function') {
        try {
          const skipIds = this.gmailService.getMessageIdsWithLabel(this.config.skipLabelName);
          skippedMessageIds = (skipIds instanceof Set) ? skipIds : new Set(skipIds || []);
          if (skippedMessageIds.size > 0) {
            console.log(`   🌐 Pre-caricati ${skippedMessageIds.size} ID messaggi skip (·) per fast-skip`);
          }
        } catch (e) {
          console.warn(`⚠️ Impossibile pre-caricare gli ID skip (${e.message}). Continuo senza cache skip.`);
        }
      }

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

      this._startTime = Date.now();
      const MAX_EXECUTION_TIME = this.config.maxExecutionTimeMs;
      let processedCount = 0;
      // Si usa la closure getEffectiveMaxEmailsPerRun definita esternamente per ottimizzare la leggibilità.

      for (let index = 0; index < threads.length; index++) {
        const safeLimit = getEffectiveMaxEmailsPerRun();
        if (processedCount >= safeLimit) {
          console.log(`🛑 Raggiunti ${safeLimit} thread elaborati. Stop.`);
          break;
        }

        const thread = threads[index];

        const remainingTimeMs = this._getRemainingTimeMs(MAX_EXECUTION_TIME);
        if (remainingTimeMs < this.config.minRemainingTimeMs || this._isNearDeadline(MAX_EXECUTION_TIME)) {
          console.warn(`⏳ Tempo insufficiente per un nuovo thread (${Math.round(remainingTimeMs / 1000)}s restanti). Stop preventivo.`);
          break;
        }

        if (!this._hasUnreadMessagesToProcess(thread, labeledMessageIds, skippedMessageIds)) {
          console.log(`\n--- Thread ${index + 1}/${threads.length} ---`);
          console.log('   ⊖ Fast-skip: thread con soli non letti già etichettati IA');
          stats.total++;
          stats.skipped++;
          stats.skipped_processed++;
          continue;
        }

        console.log(`\n--- Thread ${index + 1}/${threads.length} ---`);

        // Se il batch possiede già lo ScriptLock (o il chiamante esterno lo possiede),
        // non tentare un secondo lock dentro processThread: GAS non garantisce reentrancy
        // e un doppio tryLock può far saltare thread validi nella stessa esecuzione.
        const threadLockAlreadyCovered = locksAlreadyCovered || lockAcquiredHere;
        const result = this.processThread(
          thread,
          normalizedKnowledgeBase,
          normalizedDoctrineBase,
          labeledMessageIds,
          threadLockAlreadyCovered
        );
        stats.total++;

        // Incrementa contatore solo se c'è stata un'azione significativa o decisione esplicita dell'AI
        const isEffectiveWork = (
          result.status === 'replied' ||
          result.status === 'dry_run' ||
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
        } else if (result.status === 'dry_run') {
          stats.dryRun++;
        } else if (result.status === 'skipped') {
          stats.skipped++;
          if (result.reason === 'thread_locked' || result.reason === 'thread_locked_race') stats.skipped_locked++;
          if (result.reason === 'already_labeled_no_new_unread') stats.skipped_processed++;
          if (result.reason === 'no_external_unread' || result.reason === 'last_speaker_is_me') stats.skipped_internal++;
          if (result.reason === 'email_loop_detected') stats.skipped_loop++;
        } else if (result.status === 'filtered') {
          stats.filtered++;
          if (result.reason === 'email_loop_detected') stats.skipped_loop++;
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
      if (lockAcquiredHere) {
        try {
          executionLock.releaseLock();
        } catch (e) {
          console.warn(`⚠️ Errore rilascio execution lock: ${e.message}`);
        }
      }
    }
  }

  // ====================================================================
  // RILEVAMENTO TEMPORALE (Date/Orari)
  // ====================================================================

  /**
   * Verifica se l'email deve essere ignorata (blacklist, auto-reply, notifiche)
   * Usa le liste UNIFICATE (Codice + Foglio) presenti in GLOBAL_CACHE
   */
  _shouldIgnoreEmail(messageDetails) {
    const email = this._normalizeEmailAddress_(messageDetails.senderEmail || '');
    const subject = (messageDetails.subject || '').toLowerCase();
    const body = (messageDetails.body || '').toLowerCase();

    // 1. Controllo Blacklist Domini/Email
    // NOTA: GLOBAL_CACHE.ignoreDomains include già CONFIG.IGNORE_DOMAINS (merge in _loadAdvancedConfig)
    const ignoreDomainsArray = (typeof GLOBAL_CACHE !== 'undefined' && Array.isArray(GLOBAL_CACHE.ignoreDomains))
      ? GLOBAL_CACHE.ignoreDomains
      : ((typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.IGNORE_DOMAINS)) ? CONFIG.IGNORE_DOMAINS : []);
    const ignoreDomains = ignoreDomainsArray
      .map(d => String(d == null ? '' : d).trim().toLowerCase())
      .filter(Boolean);

    if (ignoreDomains.some(domain => {
      const localPart = email.includes('@') ? email.substring(0, email.lastIndexOf('@')) : email;
      const isExactMatch = email === domain;
      const isDomainMatch = email.endsWith(domain.startsWith('@') ? domain : '@' + domain);
      const isUsernameMatch = !domain.includes('@') && localPart === domain;
      return isExactMatch || isDomainMatch || isUsernameMatch;
    })) {
      console.log(`🚫 Ignorato: mittente in blacklist (${email})`);
      return true;
    }

    // 2. Controllo Keyword Oggetto/Corpo
    // NOTA: GLOBAL_CACHE.ignoreKeywords include già CONFIG.IGNORE_KEYWORDS (merge in _loadAdvancedConfig)
    const ignoreKeywordsArray = (typeof GLOBAL_CACHE !== 'undefined' && Array.isArray(GLOBAL_CACHE.ignoreKeywords))
      ? GLOBAL_CACHE.ignoreKeywords
      : ((typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.IGNORE_KEYWORDS)) ? CONFIG.IGNORE_KEYWORDS : []);
    const ignoreKeywords = ignoreKeywordsArray
      .map(k => String(k == null ? '' : k).trim().toLowerCase())
      .filter(Boolean);

    if (ignoreKeywords.some(keyword => subject.includes(keyword) || body.includes(keyword))) {
      console.log(`🚫 Ignorato: oggetto o corpo contiene keyword vietata`);
      return true;
    }

    // 3. Controllo Auto-reply e Notifiche (Standard)
    // NOTA: no-reply/noreply sono anche controllati in STEP 0.8 (defense-in-depth).
    // Qui manteniamo un set più mirato (segnali "sistemici" su sender/subject/body) per
    // ridurre falsi positivi rispetto al filtro preliminare regex più ampio.
    if (
      email.includes('no-reply') ||
      email.includes('noreply') ||
      email.includes('mailer-daemon') ||
      email.includes('postmaster') ||
      email.includes('notification@') ||
      email.includes('notifications@') ||
      // Filtro per evitare falsi positivi su indirizzi contenenti 'alert'.
      email.includes('alert@') || email.includes('alerts@') ||
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

  /**
   * Normalizza indirizzo email per confronti robusti (anti-loop/filtri):
   * - lowercase + trim
   * - rimozione display name eventuale (se presente)
   * - per Gmail/Googlemail: rimozione alias "+tag" nel local-part
   */
  _normalizeEmailAddress_(rawEmail) {
    if (!rawEmail) return '';
    const raw = String(rawEmail).trim();

    let extracted = raw;
    const bracketMatch = raw.match(/<([^>]+)>/);
    if (bracketMatch && bracketMatch[1]) {
      extracted = bracketMatch[1];
    }

    extracted = extracted.trim().toLowerCase();
    const atIdx = extracted.lastIndexOf('@');
    if (atIdx <= 0) return extracted;

    let local = extracted.substring(0, atIdx);
    let domain = extracted.substring(atIdx + 1);
    if (!domain) return extracted;

    if (domain === 'googlemail.com') {
      domain = 'gmail.com';
    }
    if (domain === 'gmail.com') {
      local = local.replace(/\+.*/, '').replace(/\./g, '');
    }

    return `${local}@${domain}`;
  }

  _shouldTryOcr(body, subject, message = null) {
    const settings = (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT)
      ? CONFIG.ATTACHMENT_CONTEXT
      : {};

    // Se trigger keywords non sono definite, OCR attivo di default.
    // Se presenti in configurazione, verranno usate come filtro.
    const triggerKeywords = Array.isArray(settings.ocrTriggerKeywords)
      ? settings.ocrTriggerKeywords
      : [];

    // Se la lista è vuota, significa "OCR sempre attivo se enabled=true"
    if (triggerKeywords.length === 0) return true;

    const normalizedBody = (body || '').toLowerCase().replace(/\s+/g, ' ');
    const normalizedSubject = (subject || '').toLowerCase().replace(/\s+/g, ' ');

    const hasKeywordMatch = triggerKeywords.some(keyword => {
      const needle = String(keyword == null ? '' : keyword).toLowerCase().trim();
      return needle && (normalizedBody.includes(needle) || normalizedSubject.includes(needle));
    });

    if (hasKeywordMatch) {
      return true;
    }

    const hasEmailText = Boolean(normalizedBody.trim() || normalizedSubject.trim());
    if (!hasEmailText && message) {
      try {
        const attachments = message.getAttachments({ includeInlineImages: true, includeAttachments: true }) || [];
        if (attachments.length > 0) {
          console.log('   📎 OCR fallback attivo: email senza testo ma con allegati');
          return true;
        }
      } catch (e) {
        console.warn(`⚠️ Impossibile verificare allegati per OCR fallback: ${e.message}`);
      }
    }

    return false;
  }

  // Il lock di idempotenza invio protegge il check-then-act su cache
  // (sentKey/sendingKey). Se il chiamante possiede già lo ScriptLock, evita
  // una riacquisizione non reentrant ma mantiene comunque le chiavi cache.
  _beginSendTransaction(messageId, skipLock = false) {
    if (!messageId) {
      console.warn('⚠️ Idempotenza non applicabile: messageId assente. Rischio di duplicazione.');
      return { ok: true, reason: 'missing_message_id' };
    }
    const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
      ? CacheService.getScriptCache()
      : null;

    if (!cache) {
      return { ok: true, reason: 'cache_unavailable' };
    }

    const sendingKey = `sending_${messageId}`;
    const sentKey = `sent_${messageId}`;
    const scriptLock = (typeof LockService !== 'undefined' && LockService && typeof LockService.getScriptLock === 'function')
      ? LockService.getScriptLock()
      : null;
    let lockAcquired = false;

    try {
      if (!skipLock && scriptLock && typeof scriptLock.tryLock === 'function') {
        lockAcquired = scriptLock.tryLock(500);
        if (!lockAcquired) {
          return { ok: false, reason: 'send_lock_unavailable' };
        }
      }

      if (cache.get(sentKey)) {
        return { ok: false, reason: 'already_sent' };
      }
      if (cache.get(sendingKey)) {
        return { ok: false, reason: 'in_flight' };
      }

      cache.put(sendingKey, String(Date.now()), 300); // 5 minuti
      return { ok: true, reason: 'acquired' };
    } finally {
      if (lockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
        scriptLock.releaseLock();
      }
    }
  }

  _commitSendTransaction(messageId) {
    if (!messageId) return;
    const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
      ? CacheService.getScriptCache()
      : null;
    if (!cache) return;

    cache.put(`sent_${messageId}`, String(Date.now()), 21600); // 6 ore max CacheService
    cache.remove(`sending_${messageId}`);
  }

  _rollbackSendTransaction(messageId) {
    if (!messageId) return;
    const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
      ? CacheService.getScriptCache()
      : null;
    if (!cache) return;
    cache.remove(`sending_${messageId}`);
  }

  _getBusinessDateString(date = new Date()) {
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      return Utilities.formatDate(date, 'Europe/Rome', 'yyyy-MM-dd');
    }

    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) return '';

    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(parsed);
    } catch (_) {
      // Fallback minimale quando Intl/timeZone non è disponibile.
      return parsed.toISOString().split('T')[0];
    }
  }

  _getCurrentSeason() {
    let month;
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      month = parseInt(Utilities.formatDate(new Date(), 'Europe/Rome', 'M'), 10);
    } else {
      month = new Date().getMonth() + 1;
    }
    return (month >= 6 && month <= 9) ? 'estivo' : 'invernale';
  }

  _getOcrLowConfidenceNote(languageCode) {
    const lang = ((languageCode || 'it') + '').toLowerCase().split(/[-_]/)[0];
    const notes = {
      it: 'Nota: Il documento allegato era di difficile lettura.',
      en: 'Note: The attached document was difficult to read.',
      es: 'Nota: El documento adjunto era difícil de leer.',
      fr: 'Remarque : Le document joint était difficile à lire.',
      de: 'Hinweis: Das angehängte Dokument war schwer lesbar.',
      pt: 'Nota: O documento em anexo estava difícil de ler. Posso ter omitido alguns detalhes.'
    };
    return notes[lang] || notes.it;
  }

  _getLanguageProcessingMode_() {
    const cacheMode = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE && typeof GLOBAL_CACHE.languageMode === 'string')
      ? GLOBAL_CACHE.languageMode
      : '';
    const normalized = String(cacheMode || '').trim().toLowerCase();
    return normalized === 'foreign_only' ? 'foreign_only' : 'all';
  }

  _shouldSkipByLanguageMode_(detectedLanguage, languageMode) {
    const lang = String(detectedLanguage || '').trim().toLowerCase();
    const mode = String(languageMode || '').trim().toLowerCase();
    return mode === 'foreign_only' && lang === 'it';
  }

  _markMessageAsProcessed(message, labeledMessageIds = null) {
    // SCELTA OPERATIVA INTENZIONALE:
    // - etichetta IA a livello *messaggio* (non thread), usando Gmail Advanced Service;
    // - NON marcare come letto qui.
    // Motivo: il segretario deve vedere a colpo d'occhio i non letti, anche se già gestiti da IA.
    // Cambiare questo comportamento altera la triage operativa.
    const messageId = message.getId();

    // Fail-safe operativo: in modalità "Solo straniere" un messaggio già marcato come
    // skip ('·') NON deve mai essere promosso a IA nello stesso assetto, anche se
    // _markMessageAsProcessed venisse chiamata da percorsi inattesi.
    if (this._shouldPreserveSkipLabelInForeignOnly_(messageId)) {
      console.log(`   ⛔ Preservata label '${this.config.skipLabelName}' su ${messageId} (foreign_only): non promuovo a IA`);
      return;
    }

    this.gmailService.addLabelToMessage(messageId, this.config.labelName);
    if (this.gmailService && typeof this.gmailService.removeLabelFromMessage === 'function') {
      this.gmailService.removeLabelFromMessage(messageId, this.config.skipLabelName);
    }
    if (labeledMessageIds && typeof labeledMessageIds.add === 'function') {
      labeledMessageIds.add(messageId);
    }
  }

  _shouldPreserveSkipLabelInForeignOnly_(messageId) {
    if (this._getLanguageProcessingMode_() !== 'foreign_only') return false;
    if (!messageId || !this.gmailService) return false;
    if (typeof this.gmailService._getOptionalLabelIdByName !== 'function') return false;
    if (typeof this.gmailService._getMessageMetadataWithResilience !== 'function') return false;

    const skipLabelId = this.gmailService._getOptionalLabelIdByName(this.config.skipLabelName);
    if (!skipLabelId) return false;

    const metadata = this.gmailService._getMessageMetadataWithResilience(messageId, { format: 'minimal' }, 1);
    if (!metadata || !Array.isArray(metadata.labelIds)) return false;

    return metadata.labelIds.includes(skipLabelId);
  }

  // Tracciamento ID saltati per ottimizzare il batch.
  _markMessagesAsSkipped(messages, labelName = this.config.skipLabelName, skippedMessageIds = null) {
    if (this.config.dryRun) {
      this.logger.info(`   🔴 DRY RUN - Label skip '${labelName}' non aggiunta (simulazione)`);
      return;
    }

    if (!this.gmailService || typeof this.gmailService.addLabelToMessage !== 'function') return;
    console.log(`   🏷️ Etichettatura messaggi come saltati (${labelName})...`);
    (messages || []).forEach(message => {
      if (!message) return;
      const msgId = message.getId();
      this.gmailService.addLabelToMessage(msgId, labelName);
      if (skippedMessageIds && typeof skippedMessageIds.add === 'function') {
        skippedMessageIds.add(msgId);
      }
    });
  }

  // Calcola se il tempo residuo è sufficiente per elaborare un nuovo thread
  _isNearDeadline(maxExecutionTimeMs) {
    const budgetMs = Number(maxExecutionTimeMs) || 330000;
    const minRemainingMs = (typeof this.config.minRemainingTimeMs === 'number')
      ? this.config.minRemainingTimeMs
      : 90000; // 90 secondi margine sicurezza

    if (!this._startTime) return false;

    const elapsed = Date.now() - this._startTime;
    return elapsed > Math.max(0, budgetMs - minRemainingMs);
  }

  _getRemainingTimeMs(maxExecutionTimeMs) {
    const budgetMs = Number(maxExecutionTimeMs) || 330000;
    const start = Number(this._startTime) || Date.now();
    const elapsed = Date.now() - start;
    return Math.max(0, budgetMs - elapsed);
  }


  // Supporto per skippedMessageIds.
  // per evitare ri-discovery inutile di thread già valutati in modalità foreign_only.
  _hasUnreadMessagesToProcess(thread, labeledMessageIds, skippedMessageIds) {
    try {
      const messages = thread.getMessages() || [];
      const unreadMessages = messages.filter(m => m.isUnread());

      // Nessun non letto: non c'è lavoro da fare.
      if (unreadMessages.length === 0) {
        return false;
      }

      let effectiveLabeledIds;
      if (labeledMessageIds instanceof Set) {
        effectiveLabeledIds = labeledMessageIds;
      } else {
        const fetchedIds = this.gmailService.getMessageIdsWithLabel(this.config.labelName);
        effectiveLabeledIds = (fetchedIds instanceof Set) ? fetchedIds : new Set(fetchedIds || []);
      }

      const effectiveSkippedIds = (skippedMessageIds instanceof Set) ? skippedMessageIds : new Set();

      return unreadMessages.some(message => {
        const messageId = message.getId();
        if (effectiveLabeledIds.has(messageId)) return false;
        if (effectiveSkippedIds.has(messageId)) return false;
        return true;
      });
    } catch (e) {
      // Fallback sicuro: in caso di errore non bloccare il thread, lasciamo decidere a processThread.
      this.logger.warn(`⚠️ Fast-skip check fallito: ${e.message}`);
      return true;
    }
  }

  _normalizeTextContent(value) {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (value == null) {
      return '';
    }
    try {
      return String(value).trim();
    } catch (e) {
      this.logger.warn(`⚠️ Impossibile normalizzare contenuto testuale: ${e.message}`);
      return '';
    }
  }

  _prepareOutboundResponse(responseText, messageDetails, detectedLanguage) {
    const safeText = typeof responseText === 'string'
      ? responseText
      : (responseText == null ? '' : String(responseText));

    if (this.gmailService && typeof this.gmailService.prepareOutboundText === 'function') {
      return this.gmailService.prepareOutboundText(safeText, messageDetails || {}, detectedLanguage);
    }

    return safeText;
  }

  _addErrorLabel(target) {
    if (target && typeof target.getThread === 'function' && typeof target.getId === 'function') {
      this.gmailService.addLabelToMessage(target.getId(), this.config.errorLabelName);
      return;
    }
    this.gmailService.addLabelToThread(target, this.config.errorLabelName);
  }

  _addValidationErrorLabel(target) {
    if (target && typeof target.getThread === 'function' && typeof target.getId === 'function') {
      this.gmailService.addLabelToMessage(target.getId(), this.config.validationErrorLabel);
      return;
    }
    this.gmailService.addLabelToThread(target, this.config.validationErrorLabel);
  }

  // Classifica gli errori di validazione in categorie utili per il retry LLM
  _classifyValidationForRetry(validationResult, detectedLanguage) {
    const details = (validationResult && validationResult.details) ? validationResult.details : {};
    const errors = (validationResult && Array.isArray(validationResult.errors)) ? validationResult.errors : [];
    const errorText = errors.map(e => String(e).toLowerCase());

    const hallucinations = (details.hallucinations && details.hallucinations.hallucinations)
      ? details.hallucinations.hallucinations
      : {};

    let hasHallucination = (
      (Array.isArray(hallucinations.emails) && hallucinations.emails.length > 0) ||
      (Array.isArray(hallucinations.phones) && hallucinations.phones.length > 0) ||
      (Array.isArray(hallucinations.times) && hallucinations.times.length > 0)
    );
    if (!hasHallucination && errorText.some(e => e.includes('non in kb') || e.includes('allucin'))) {
      hasHallucination = true;
    }

    const exposedErrors = (details.exposedReasoning && Array.isArray(details.exposedReasoning.errors))
      ? details.exposedReasoning.errors
      : [];
    let hasThinkingLeak = exposedErrors.length > 0 || errorText.some(e => e.includes('ragionamento esposto'));

    const semantic = details.semantic || {};
    if (semantic.thinkingLeak && semantic.thinkingLeak.isValid === false) {
      hasThinkingLeak = true;
    }
    if (semantic.hallucinations && semantic.hallucinations.isValid === false) {
      hasHallucination = true;
    }

    const langErrors = (details.language && Array.isArray(details.language.errors))
      ? details.language.errors
      : [];
    const hasLanguage = langErrors.length > 0 || errorText.some(e => e.includes('lingua'));

    const foundPlaceholders = (details.content && Array.isArray(details.content.foundPlaceholders))
      ? details.content.foundPlaceholders
      : [];
    const hasPlaceholder = foundPlaceholders.length > 0 || errorText.some(e => e.includes('placeholder'));

    const lengthErrors = (details.length && Array.isArray(details.length.errors))
      ? details.length.errors
      : [];
    const hasLength = lengthErrors.length > 0 || errorText.some(e => e.includes('troppo corta') || e.includes('troppo lunga') || e.includes('prolissa'));

    return {
      thinking_leak: hasThinkingLeak,
      hallucination: hasHallucination,
      language: hasLanguage,
      placeholder: hasPlaceholder,
      length: hasLength,
      lengthErrors: lengthErrors,
      foundPlaceholders: foundPlaceholders,
      hallucinations: hallucinations,
      detectedLanguage: detectedLanguage
    };
  }

  _shouldAttemptIntelligentRetry(validationResult, detectedLanguage, retryConfig) {
    if (!validationResult || validationResult.isValid) return false;
    const cfg = retryConfig || {};
    const flags = this._classifyValidationForRetry(validationResult, detectedLanguage);
    const allowed = (Array.isArray(cfg.onlyForErrors) && cfg.onlyForErrors.length > 0)
      ? cfg.onlyForErrors
      : ['thinking_leak', 'hallucination', 'language', 'placeholder', 'length'];

    const hasAllowed = allowed.some(key => flags[key]);
    if (!hasAllowed) return false;

    const minScore = (typeof cfg.minScoreToTrigger === 'number')
      ? cfg.minScoreToTrigger
      : ((typeof CONFIG !== 'undefined' && typeof CONFIG.VALIDATION_MIN_SCORE === 'number') ? CONFIG.VALIDATION_MIN_SCORE : 0.6);

    const critical = flags.thinking_leak || flags.hallucination;
    


    if (!critical && Number.isFinite(minScore) && Number.isFinite(validationResult.score) && validationResult.score < minScore) {
      return false;
    }

    return true;
  }

  /**
   * Costruisce un prompt correttivo "chirurgico" basato sugli errori di validazione.
   */
  _buildCorrectionPrompt(originalPrompt, failedResponse, validationResult, language, salutationMode) {
    const safePrompt = typeof originalPrompt === 'string' ? originalPrompt : (originalPrompt == null ? '' : String(originalPrompt));
    const safeResponse = typeof failedResponse === 'string' ? failedResponse : (failedResponse == null ? '' : String(failedResponse));
    const details = validationResult && validationResult.details ? validationResult.details : {};
    const flags = this._classifyValidationForRetry(validationResult, language);

    const correctionInstructions = [];
    const langNames = { it: 'italiano', en: 'inglese', es: 'spagnolo', fr: 'francese', de: 'tedesco', pt: 'portoghese' };
    const shouldIncludeSignature = salutationMode !== 'none_or_continuity' && salutationMode !== 'session';

    if (flags.thinking_leak) {
      correctionInstructions.push(
        'ERRORE CRITICO: Hai incluso il tuo ragionamento interno nella risposta.\n' +
        'CORREZIONE: Scrivi SOLO la risposta finale. Non usare frasi come "noto che", "devo correggere", ' +
        '"le istruzioni dicono", "rivedendo le informazioni".'
      );
    }

    if (flags.hallucination) {
      const items = [];
      if (Array.isArray(flags.hallucinations.emails) && flags.hallucinations.emails.length > 0) {
        items.push(`email: ${flags.hallucinations.emails.slice(0, 3).join(', ')}`);
      }
      if (Array.isArray(flags.hallucinations.phones) && flags.hallucinations.phones.length > 0) {
        items.push(`telefoni: ${flags.hallucinations.phones.slice(0, 3).join(', ')}`);
      }
      if (Array.isArray(flags.hallucinations.times) && flags.hallucinations.times.length > 0) {
        items.push(`orari: ${flags.hallucinations.times.slice(0, 3).join(', ')}`);
      }
      const itemsStr = items.length > 0
        ? `Rimuovi o verifica: ${items.join(' | ')}`
        : 'Rimuovi qualsiasi dato (orario, telefono, email, URL) non presente nelle informazioni fornite.';
      correctionInstructions.push(
        'ERRORE CRITICO: Hai inventato informazioni non presenti nelle informazioni disponibili.\n' +
        `CORREZIONE: ${itemsStr}\n` +
        'Se non conosci un dato, invita cortesemente a contattare la segreteria.'
      );
    }

    if (flags.language) {
      const langLabel = langNames[language] || language;
      correctionInstructions.push(
        `ERRORE: La risposta non è in ${langLabel}.\n` +
        `CORREZIONE: Riscrivi l'intera risposta in ${langLabel}. Saluto e firma devono essere in ${langLabel}.`
      );
    }

    if (flags.placeholder) {
      const placeholders = (flags.foundPlaceholders || []).slice(0, 4);
      const placeholderText = placeholders.length > 0 ? placeholders.join(', ') : '[segnaposti]';
      correctionInstructions.push(
        'ERRORE: La risposta contiene segnaposto non compilati.\n' +
        `CORREZIONE: Compila o rimuovi questi segnaposto: ${placeholderText}.`
      );
    }

    if (flags.length) {
      const lengthErrors = (flags.lengthErrors || []).map(e => String(e).toLowerCase());
      const tooShort = lengthErrors.some(e => e.includes('troppo corta'));
      const tooLong = lengthErrors.some(e => e.includes('troppo lunga') || e.includes('prolissa'));

      if (tooShort) {
        const signatureNote = shouldIncludeSignature
          ? 'Includi saluto e firma.'
          : 'NON includere saluti formali o firme: continua nel tono di conversazione già in corso.';
        correctionInstructions.push(
          'ERRORE: La risposta è troppo breve.\n' +
          `CORREZIONE: Espandi con 2-3 frasi complete e informazioni utili. ${signatureNote}`
        );
      }
      if (tooLong) {
        correctionInstructions.push(
          'ERRORE: La risposta è eccessivamente lunga.\n' +
          'CORREZIONE: Sintetizza e rispondi SOLO alla domanda posta, massimo 4-5 frasi.'
        );
      }
    }

    if (correctionInstructions.length === 0) {
      const scoreLabel = (validationResult && typeof validationResult.score === 'number')
        ? validationResult.score.toFixed(2)
        : '?';
      correctionInstructions.push(
        `La risposta non ha superato il controllo qualità (score: ${scoreLabel}).\n` +
        'Riscrivi la risposta in modo più preciso, professionale e coerente con le istruzioni.'
      );
    }

    const compactResponse = safeResponse.replace(/\s+/g, ' ').trim();
    const failedSnippet = compactResponse.length > 400 ? compactResponse.substring(0, 400) + '...' : compactResponse;

    const maxSafeTokens = (typeof CONFIG !== 'undefined' && Number.isFinite(CONFIG.MAX_SAFE_TOKENS))
      ? CONFIG.MAX_SAFE_TOKENS
      : 35000;
    // Riserva spazio per blocco correzioni + risposta precedente (stima: 4 char/token).
    const reservedTokens = 2500;
    const maxPromptChars = Math.max(2000, Math.floor((maxSafeTokens - reservedTokens) * 4));
    const promptForRetry = this._trimPromptForRetry_(safePrompt, maxPromptChars);

    return `${promptForRetry}

══════════════════════════════════════════════════════
CORREZIONE RICHIESTA — SECONDA GENERAZIONE
══════════════════════════════════════════════════════

La tua risposta precedente non è utilizzabile per i seguenti motivi:

${correctionInstructions.join('\n\n')}

══════════════════════════════════════════════════════
RISPOSTA PRECEDENTE (DA NON RIPETERE):
${failedSnippet}
══════════════════════════════════════════════════════

Genera ora una nuova risposta corretta, evitando tutti gli errori elencati sopra.
Rispondi SOLO con il testo della nuova email, senza spiegazioni o commenti.`;
  }

  _trimPromptForRetry_(prompt, maxChars) {
    if (typeof prompt !== 'string') return '';
    if (!Number.isFinite(maxChars) || maxChars <= 0 || prompt.length <= maxChars) {
      return prompt;
    }

    // Mantiene testa+coda per preservare istruzioni iniziali e contesto finale utente.
    const headChars = Math.floor(maxChars * 0.7);
    const tailChars = maxChars - headChars;
    return `${prompt.slice(0, headChars)}

[...PROMPT ORIGINALE TRONCATO PER RETRY...]

${prompt.slice(-tailChars)}`;
  }

  // Costruisce un sommario incrementale delle risposte inviate al thread
  _buildMemorySummary({ existingSummary, responseText, providedTopics }) {
    const maxChars = 2000;
    const maxBullets = 5;

    let summaryLines = [];
    if (existingSummary && typeof existingSummary === 'string') {
      summaryLines = existingSummary
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    }

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
      summarySentence = `Risposta con informazioni su: ${providedTopics.join(', ')}.`;
    }
    if (!summarySentence) {
      summarySentence = plainText.slice(0, 200);
    }

    // Aggiungiamo data contestuale per non collassare topic se esauditi in momenti diversi
    const newBullet = summarySentence ? `• [${this._getBusinessDateString()}] ${summarySentence}` : '';

    // Controlliamo l'overlap ma con tolleranza (data aiuta l'unicità)
    if (newBullet && !summaryLines.some(line => line.toLowerCase() === newBullet.toLowerCase())) {
      summaryLines.push(newBullet);
    }

    const trimmedLines = summaryLines.slice(-maxBullets);
    let summary = trimmedLines.join('\n').trim();

    if (summary.length > maxChars) {
      const truncated = summary.slice(0, maxChars);
      const lastBreak = truncated.lastIndexOf('\n');
      const lastSpace = truncated.lastIndexOf(' ');
      const cutIndex = lastBreak > 0 ? lastBreak : (lastSpace > 0 ? lastSpace : maxChars);
      summary = truncated.slice(0, cutIndex).trim() + '...';
    }

    return summary || null;
  }

  _isTerritoryRequest(subject, body, classification = {}, requestType = {}) {
    const text = `${subject || ''} ${body || ''}`.toLowerCase();
    const topic = String(classification && classification.topic ? classification.topic : '').toLowerCase();
    const type = String(requestType && requestType.type ? requestType.type : '').toLowerCase();

    // NOTA: RequestTypeClassifier non produce mai type='territory'.
    // La rilevazione avviene interamente via pattern sul testo qui sotto.
    if (topic.includes('territor') || topic.includes('parrocch')) return true;

    const explicitPatterns = [
      /\bterritorio\b/i,
      /\bparrocchia\s+di\s+residenza\b/i,
      /\brientra\b/i,
      /\bnon\s+rientra\b/i,
      /\bcompetenza\s+parrocchiale\b/i,
      /\bquale\s+parrocchia\b/i,
      /\bfuori\s+territorio\b/i
    ];

    return explicitPatterns.some((pattern) => pattern.test(text));
  }

  _extractTimes(text) {
    if (!text || typeof text !== 'string') return [];

    const matches = text.match(/\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b/g) || [];
    const normalized = matches.map((time) => {
      const [hh, mm] = time.replace('.', ':').split(':');
      return `${hh.padStart(2, '0')}:${mm}`;
    });

    return Array.from(new Set(normalized));
  }

  _hasExplicitTimeExpectation(text) {
    if (!text || typeof text !== 'string') return false;

    const timeExpectationPatterns = [
      /\bpensavo\b/i,
      /\bcredevo\b/i,
      /\bmi\s+era\s+stato\s+detto\b/i,
      /\bavevo\s+capito\b/i,
      /\bmi\s+risultava?\b/i,
      /\bsecondo\s+me\b/i,
      /\bmi\s+sembrava\b/i,
      /\bero\s+convint[oa]\b/i,
      /\bho\s+letto\b/i,
      /\b(?:fosse|era|sia|sarà|sarebbe|iniziasse|inizia|cominciasse|comincia)\s+(?:alle\s+)?(?:ore\s+)?(?:[01]?\d|2[0-3])[:.][0-5]\d\b/i
    ];

    return timeExpectationPatterns.some((pattern) => pattern.test(text));
  }

  _addTimeDiscrepancyNoteIfNeeded(response, messageDetails, detectedLanguage) {
    if (!response || typeof response !== 'string') return response;

    const language = String(detectedLanguage || 'it').toLowerCase();
    if (language !== 'it') return response;

    const sourceText = `${messageDetails && messageDetails.subject ? messageDetails.subject : ''} ${messageDetails && messageDetails.body ? messageDetails.body : ''}`.toLowerCase();
    const responseLower = response.toLowerCase();

    // Evita duplicazione note se già presente un chiarimento orario
    // (supporta varianti lessicali e il fallback "Nota: ...").
    const discrepancyNotePatterns = [
      /orario\s+(?:diverso|differente)\s+(?:da|rispetto\s+a)\s+(?:quanto\s+)?(?:da\s+)?lei\s+indicato/i,
      /orario\s+(?:diverso|differente)\s+da\s+quello\s+indicato/i,
      /orario\s+comunicato\s+è\s+diverso/i
    ];

    if (discrepancyNotePatterns.some((pattern) => pattern.test(responseLower))) {
      return response;
    }

    // Scatta solo se l'utente ha espresso un orario come aspettativa/presupposto.
    if (!this._hasExplicitTimeExpectation(sourceText)) return response;

    const userTimes = this._extractTimes(sourceText);
    const responseTimes = this._extractTimes(response);

    if (userTimes.length === 0 || responseTimes.length === 0) return response;

    const hasSameTime = userTimes.some((t) => responseTimes.includes(t));
    if (hasSameTime) return response;

    const toMinutes = (time) => {
      if (!time || typeof time !== 'string' || !time.includes(':')) return NaN;
      const [hhRaw, mmRaw] = time.split(':');
      const hh = Number(hhRaw);
      const mm = Number(mmRaw);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
      return (hh * 60) + mm;
    };

    let minDelta = Infinity;
    for (const ut of userTimes) {
      for (const rt of responseTimes) {
        const utMin = toMinutes(ut);
        const rtMin = toMinutes(rt);
        if (!Number.isFinite(utMin) || !Number.isFinite(rtMin)) continue;
        minDelta = Math.min(minDelta, Math.abs(utMin - rtMin));
      }
    }

    if (!Number.isFinite(minDelta)) return response;

    const note = minDelta >= 90
      ? 'in un orario differente da quanto indicato da Lei'
      : 'in un orario diverso rispetto a quanto da Lei indicato';

    // Inserisce la nota nella prima frase che contiene un orario, indipendentemente dal sacramento/corso.
    const sentencePattern = /([^\n.!?]*\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b[^\n.!?]*)([.!?]|\s*$)/i;

    if (sentencePattern.test(response)) {
      return response.replace(sentencePattern, (full, sentence, endPunct) => {
        if (sentence.toLowerCase().includes('orario diverso') || sentence.toLowerCase().includes('orario differente')) return full;
        return `${sentence}, ${note}${endPunct}`;
      });
    }

    return `${response.trim()}

Nota: l'orario comunicato è diverso da quello da Lei indicato.`;
  }

  /**
   * Rileva topic forniti nella risposta (per anti-ripetizione memoria)
   */
  _detectProvidedTopics(response) {
    if (!response || typeof response !== 'string') return [];
    const topics = [];
    // Usiamo il flag /s (dotAll) affinché .* includa anche gli a capo (\n)

    const patterns = {
      'orari_messe': /messe?\b.*\d{1,2}[:.]\d{2}|orari\w*\s+messe/is,
      'contatti': /telefono|email|@|segreteria/i,
      'battesimo_info': /battesimo.*documento|documento.*battesimo/is,
      'comunione_info': /comunione.*catechismo|catechismo.*comunione/is,
      'cresima_info': /cresima.*percorso|percorso.*cresima/is,
      'matrimonio_info': /matrimonio.*corso|corso.*matrimonio/is,
      'territorio': /rientra|non rientra|parrocchia.*competenza/is,
      'indirizzo': /(?:via|viale|corso|piazza|largo|circonvallazione)\s+[^,\n]{3,60}?,?\s*\d+/i
    };

    for (const [topic, pattern] of Object.entries(patterns)) {
      if (pattern.test(response)) {
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
    const normalizedTopics = previousTopics
      .map(info => (typeof info === 'object' && info !== null ? info.topic : info))
      .map(topic => this._normalizeTopicKey(topic));

    const mentionedTopics = normalizedTopics.filter(topic => {
      if (!topic) return false;
      const topicWithSpaces = topic.replace(/_/g, ' ');
      return bodyLower.includes(topic) || bodyLower.includes(topicWithSpaces);
    });

    let targetTopics = [];

    if (mentionedTopics.length > 0) {
      // Se l'utente cita esplicitamente dei topic, applica a tutti quelli trovati
      targetTopics = mentionedTopics;
    } else {
      // Fallback: applica all'ultimo topic discusso
      targetTopics = [normalizedTopics[normalizedTopics.length - 1]].filter(Boolean);
    }

    if (targetTopics.length === 0) return;

    const context = {
      source: 'user_reply',
      matchedPhrase: inferredReaction.match,
      excerpt: userBody.substring(0, 160)
    };

    targetTopics.forEach(topic => {
      console.log(`   🧠 Inferred Reaction: ${inferredReaction.type.toUpperCase()} su topic '${topic}'`);
      this.memoryService.updateReaction(threadId, topic, inferredReaction.type, context);
    });
  }

  _normalizeTopicKey(topic) {
    if (topic == null) return '';
    return String(topic)
      .toLowerCase()
      .trim()
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/ /g, '_');
  }
  /**
   * Punto 12: Classificazione centralizzata degli errori API
   * Determina se un errore è fatale, legato alla quota o alla rete.
   */
  _classifyError(error) {
    const mkResult = (type, retryable, message) => ({ type, retryable, message });

    if (!error) {
      console.warn('⚠️ _classifyError chiamato con errore nullo');
      return mkResult('UNKNOWN', false, '');
    }

    // Delega al classificatore centralizzato se disponibile
    if (typeof classifyError === 'function' && typeof ErrorTypes !== 'undefined') {
      const normalized = classifyError(error);
      switch (normalized.type) {
        case ErrorTypes.QUOTA_EXCEEDED:
          return mkResult('QUOTA_EXCEEDED', true, normalized.message);
        case ErrorTypes.TIMEOUT:
        case ErrorTypes.NETWORK:
          return mkResult('NETWORK', true, normalized.message);
        case ErrorTypes.INVALID_API_KEY:
          return mkResult('FATAL', false, normalized.message);
        case ErrorTypes.INVALID_RESPONSE:
          return mkResult('INVALID_RESPONSE', false, normalized.message);
        default:
          return mkResult('UNKNOWN', false, normalized.message);
      }
    }

    // Classificazione locale (fallback) con regex e messaggi grezzi
    let rawMessage = '';
    if (error != null) {
      if (typeof error === 'string') {
        rawMessage = error;
      } else if (error.message != null) {
        rawMessage = String(error.message);
      } else {
        try {
          rawMessage = JSON.stringify(error) || '';
        } catch (jsonError) {
          rawMessage = String(error);
        }
      }
    }
    const msg = rawMessage.toLowerCase();

    const RETRYABLE_ERRORS = ['quota', 'RESOURCE_EXHAUSTED', 'resource_exhausted'];
    const FATAL_ERRORS = ['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'unauthorized', 'forbidden', 'unauthenticated'];

    for (const fatal of FATAL_ERRORS) {
      if (msg.includes(fatal.toLowerCase())) return mkResult('FATAL', false, rawMessage);
    }
    if (/\b(401|403)\b/.test(msg)) return mkResult('FATAL', false, rawMessage);

    for (const retryable of RETRYABLE_ERRORS) {
      if (msg.includes(retryable.toLowerCase())) return mkResult('QUOTA_EXCEEDED', true, rawMessage);
    }
    if (/\b429\b/.test(msg)) return mkResult('QUOTA_EXCEEDED', true, rawMessage);

    if (msg.includes('timeout') || msg.includes('ECONNRESET') || msg.includes('econnreset') ||
        msg.includes('deadline') || msg.includes('request timed out') ||
        /\b(408|500|502|503|504)\b/.test(msg)) {
      return mkResult('NETWORK', true, rawMessage);
    }

    return mkResult('UNKNOWN', false, rawMessage);
  }

  /**
   * Traccia il contatore di inbox vuote consecutive (per avvisi diagnostici)
   */
  _trackEmptyInboxStreak(isEmpty) {
    try {
      const cache = (typeof CacheService !== "undefined" && CacheService && typeof CacheService.getScriptCache === "function")
        ? CacheService.getScriptCache()
        : null;
      if (!cache) return 0;

      const key = "empty_inbox_streak";
      let streak = parseInt(cache.get(key) || "0", 10);

      if (isEmpty) {
        streak++;
        cache.put(key, streak.toString(), 21600); // 6 ore
      } else {
        streak = 0;
        cache.remove(key);
      }
      return streak;
    } catch (e) {
      console.warn(`⚠️ CacheService temporaneamente indisponibile per metrica empty inbox: ${e.message}`);
      return 0;
    }
  }

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

// ====================================================================
// CALCOLATORE MODALITÀ SALUTO
// ====================================================================

/**
 * Calcola modalità saluto basata su segnali strutturali
 * @param {Object} params - Parametri di input
 * @returns {'full'|'soft'|'none_or_continuity'|'session'}
 */
function computeSalutationMode({ isReply = false, messageCount = 0, memoryExists = false, lastUpdated = null, now = new Date() } = {}) {
  const SESSION_WINDOW_MINUTES = 15;
  // 0️⃣ Nuovo contatto (non reply): privilegia sempre un saluto completo.
  // Anche in presenza di memoria pregressa, un nuovo thread/messaggio iniziale
  // deve evitare modalità "none_or_continuity".
  if (!isReply) {
    return 'full';
  }

  // 1️⃣ Memoria assente: fallback conservativo su saluto completo.
  // Evita saluti "continuity" quando il Memory Service non ha stato affidabile.
  if (!memoryExists) {
    return 'full';
  }

  // 2️⃣ Conversazione attiva (qui isReply è necessariamente true)
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

// ====================================================================
// ENTRY POINT PRINCIPALE
// ====================================================================

/**
 * Alias dell'entry point principale processEmailsMain() (gas_main.js).
 * Mantenuta per compatibilità con trigger preesistenti.
 */
function processUnreadEmailsMain() {
  if (typeof processEmailsMain === 'function') {
    processEmailsMain();
  } else {
    console.error('🛑 processEmailsMain non trovata — impossibile delegare.');
  }
}
