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

var TECHNICAL_CONTEXT_ROUTING_CATEGORIES = new Set(['technical', 'appointment', 'quotation', 'information']);

function shouldSkipByLanguageMode_(detectedLanguage, languageMode) {
  const rawLang = String(detectedLanguage || '').trim().toLowerCase();
  const lang = rawLang.split(/[-_]/)[0];
  const mode = String(languageMode || '').trim().toLowerCase();
  return mode === 'foreign_only' && lang === 'it';
}

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
    this._scriptTimeZone = null;
    this.promptEngine = options.promptEngine ||
      (typeof PromptEngine !== 'undefined'
        ? new PromptEngine()
        : { buildPrompt: () => { throw new Error('CRITICO: PromptEngine assente. Sicurezza LLM compromessa.'); } });
    this.memoryService = options.memoryService ||
      (typeof MemoryService !== 'undefined'
        ? new MemoryService()
        : {
          getMemory: () => ({}),
          getRecentHistory: () => [],
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
      skipLabelName: (typeof CONFIG !== 'undefined' && Object.prototype.hasOwnProperty.call(CONFIG, 'SKIP_LABEL_NAME')) ? CONFIG.SKIP_LABEL_NAME : '·',
      maxHistoryMessages: (typeof CONFIG !== 'undefined' && typeof CONFIG.MAX_HISTORY_MESSAGES === 'number') ? CONFIG.MAX_HISTORY_MESSAGES : 10,
      validationWarningThreshold: typeof CONFIG !== 'undefined' && typeof CONFIG.VALIDATION_WARNING_THRESHOLD === 'number'
        ? CONFIG.VALIDATION_WARNING_THRESHOLD
        : 0.9,
      validationReviewAlerts: typeof CONFIG !== 'undefined' && CONFIG.VALIDATION_REVIEW_ALERTS
        ? CONFIG.VALIDATION_REVIEW_ALERTS
        : { enabled: true, cooldownSeconds: 3600, recipientProperty: 'VALIDATION_REVIEW_EMAIL' },
      maxConsecutiveExternal: typeof CONFIG !== 'undefined' && typeof CONFIG.MAX_CONSECUTIVE_EXTERNAL === 'number'
        ? CONFIG.MAX_CONSECUTIVE_EXTERNAL
        : 5,
      emptyInboxWarningThreshold: typeof CONFIG !== 'undefined' && typeof CONFIG.EMPTY_INBOX_WARNING_THRESHOLD === 'number'
        ? CONFIG.EMPTY_INBOX_WARNING_THRESHOLD
        : 5,
      searchPageSize: typeof CONFIG !== 'undefined' && typeof CONFIG.SEARCH_PAGE_SIZE === 'number'
        ? CONFIG.SEARCH_PAGE_SIZE
        : 50,
      documentConsistencyCheckEnabled: typeof CONFIG !== 'undefined' && typeof CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED === 'boolean'
        ? CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED
        : true
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
   * Restituisce il fuso orario dello script con caching locale per ridurre
   * le chiamate a Session.getScriptTimeZone() durante l'elaborazione del batch.
   */
  _getCachedTimeZone() {
    if (!this._scriptTimeZone) {
      try {
        this._scriptTimeZone =
          (typeof Session !== 'undefined' && Session &&
            typeof Session.getScriptTimeZone === 'function')
            ? Session.getScriptTimeZone()
            : 'Europe/Rome';
      } catch (e) {
        this._scriptTimeZone = 'Europe/Rome';
      }
    }
    return this._scriptTimeZone;
  }

  _acquireThreadLock(threadId, skipLock, threadLogger) {
    const scriptCache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
      ? CacheService.getScriptCache()
      : null;
    const threadLockKey = `thread_lock_${threadId}`;

    if (!scriptCache || typeof LockService === 'undefined' || !LockService || typeof LockService.getScriptLock !== 'function') {
      if (threadLogger && typeof threadLogger.warn === 'function') {
        threadLogger.warn('Lock service/cache non disponibili: procedo senza lock');
      }
      return { ok: true, acquired: false, cache: scriptCache, key: threadLockKey, value: null };
    }

    const configuredTtl = (typeof CONFIG !== 'undefined' && Number(CONFIG.CACHE_LOCK_TTL))
      ? Number(CONFIG.CACHE_LOCK_TTL)
      : 310;
    const ttlSeconds = Math.max(1, Math.min(configuredTtl, 21600));
    const lockTtlMs = ttlSeconds * 1000;
    const value = (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.getUuid === 'function')
      ? `${Date.now()}_${Utilities.getUuid()}`
      : `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const scriptLock = LockService.getScriptLock();
    let scriptLockAcquired = false;

    try {
      if (skipLock) {
        if (threadLogger && typeof threadLogger.debug === 'function') {
          threadLogger.debug('Mutex globale saltato (lock esecuzione già posseduto dal chiamante)');
        }
      } else {
        const threadLockWaitMs = (typeof CONFIG !== 'undefined' && CONFIG.EXECUTION_LOCK_WAIT_MS)
          ? CONFIG.EXECUTION_LOCK_WAIT_MS
          : 1000;
        scriptLockAcquired = scriptLock.tryLock(threadLockWaitMs);
        if (!scriptLockAcquired) {
          if (threadLogger && typeof threadLogger.warn === 'function') {
            threadLogger.warn(`Impossibile acquisire lock globale per thread ${threadId} (timeout ${threadLockWaitMs}ms), salto`);
          }
          return { ok: false, reason: 'global_lock_unavailable' };
        }
      }

      const existingLock = scriptCache.get(threadLockKey);
      if (existingLock) {
        const existingTimestamp = Number(String(existingLock).split('_')[0]);
        const isStale = !isNaN(existingTimestamp) && (Date.now() - existingTimestamp) > lockTtlMs;

        if (isStale) {
          if (threadLogger && typeof threadLogger.warn === 'function') {
            threadLogger.warn('Lock stale rilevato, sovrascrittura lock');
          }
        } else {
          if (threadLogger && typeof threadLogger.warn === 'function') {
            threadLogger.warn('Thread lockato da altro processo, salto');
          }
          return { ok: false, reason: 'thread_locked' };
        }
      }

      scriptCache.put(threadLockKey, value, ttlSeconds);
      if (scriptCache.get(threadLockKey) !== value) {
        return { ok: false, reason: 'thread_lock_collision' };
      }

      if (threadLogger && typeof threadLogger.debug === 'function') {
        threadLogger.debug('Lock acquisito');
      }
      return { ok: true, acquired: true, cache: scriptCache, key: threadLockKey, value: value };
    } catch (e) {
      if (threadLogger && typeof threadLogger.warn === 'function') {
        threadLogger.warn(`Errore acquisizione lock thread: ${e.message}`);
      }
      return { ok: false, reason: 'lock_acquisition_failed', error: e };
    } finally {
      if (scriptLockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
        try {
          scriptLock.releaseLock();
        } catch (_) { }
      }
    }
  }

  _releaseThreadLock(lockCtx, threadLogger) {
    if (!lockCtx || !lockCtx.acquired || !lockCtx.cache || !lockCtx.key) return;
    try {
      const currentLockValue = lockCtx.cache.get(lockCtx.key);
      if (currentLockValue === lockCtx.value) {
        lockCtx.cache.remove(lockCtx.key);
        if (threadLogger && typeof threadLogger.debug === 'function') {
          threadLogger.debug('Lock rilasciato');
        }
      } else if (currentLockValue) {
        if (threadLogger && typeof threadLogger.warn === 'function') {
          threadLogger.warn('Rilascio lock saltato (lock scaduto o di altro processo)');
        }
      } else if (threadLogger && typeof threadLogger.debug === 'function') {
        threadLogger.debug('Lock già scaduto naturalmente');
      }
    } catch (e) {
      if (threadLogger && typeof threadLogger.warn === 'function') {
        threadLogger.warn(`Errore rilascio lock: ${e.message}`);
      }
    }
  }


  /**
   * Elabora il singolo thread (analisi, categorizzazione, generazione risposta, invio)
   * @param {GmailThread} thread 
   * @param {string} knowledgeBase - KB testo semplice
   * @param {Array} doctrineBase - KB strutturata
   * @param {?Set} labeledMessageIds - ID messaggi già etichettati (opzionale)
   * @param {boolean} skipLock - Se true, salta acquisizione lock
   */
  processThread(thread, knowledgeBase, doctrineBase, labeledMessageIds = null, skipLock = false, skippedMessageIds = null, options = {}) {
    const threadId = thread.getId();
    const startTime = Date.now();
    const activeLogger = (options && options.logger) ? options.logger : this.logger;
    const baseThreadLogger = (activeLogger && typeof activeLogger.withMeta === 'function')
      ? activeLogger.withMeta({ threadId: threadId })
      : activeLogger;
    const threadLogger = (baseThreadLogger && typeof baseThreadLogger.info === 'function' && typeof baseThreadLogger.warn === 'function' && typeof baseThreadLogger.error === 'function')
      ? baseThreadLogger
      : {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args),
        debug: (...args) => console.log(...args),
      };
    const previousServiceLoggers = {
      geminiService: this.geminiService ? this.geminiService.logger : null,
      classifier: this.classifier ? this.classifier.logger : null,
      validator: this.validator ? this.validator.logger : null,
      requestClassifier: this.requestClassifier ? this.requestClassifier.logger : null,
      gmailService: this.gmailService ? this.gmailService.logger : null,
      memoryService: this.memoryService ? this.memoryService.logger : null
    };
    const restoreServiceLoggers = () => {
      if (this.geminiService) this.geminiService.logger = previousServiceLoggers.geminiService;
      if (this.classifier) this.classifier.logger = previousServiceLoggers.classifier;
      if (this.validator) this.validator.logger = previousServiceLoggers.validator;
      if (this.requestClassifier) this.requestClassifier.logger = previousServiceLoggers.requestClassifier;
      if (this.gmailService) this.gmailService.logger = previousServiceLoggers.gmailService;
      if (this.memoryService) this.memoryService.logger = previousServiceLoggers.memoryService;
    };
    if (this.geminiService && threadLogger && typeof threadLogger.withContext === 'function') {
      this.geminiService.logger = threadLogger.withContext('GeminiService');
    }
    if (this.classifier && threadLogger && typeof threadLogger.withContext === 'function') {
      this.classifier.logger = threadLogger.withContext('Classifier');
    }
    if (this.validator && threadLogger && typeof threadLogger.withContext === 'function') {
      this.validator.logger = threadLogger.withContext('Validator');
    }
    if (this.requestClassifier && threadLogger && typeof threadLogger.withContext === 'function') {
      this.requestClassifier.logger = threadLogger.withContext('RequestClassifier');
    }
    if (this.gmailService && threadLogger && typeof threadLogger.withContext === 'function') {
      this.gmailService.logger = threadLogger.withContext('GmailService');
    }
    if (this.memoryService && threadLogger && typeof threadLogger.withContext === 'function') {
      this.memoryService.logger = threadLogger.withContext('MemoryService');
    }
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

    let lockCtx = this._acquireThreadLock(threadId, skipLock, threadLogger);
    if (!lockCtx.ok) {
      restoreServiceLoggers();
      if (lockCtx.reason === 'lock_acquisition_failed') {
        return { status: 'error', error: 'Lock acquisition failed' };
      }
      return { status: 'skipped', reason: lockCtx.reason };
    }

    const result = {
      status: 'unknown',
      validationFailed: false,
      dryRun: false,
      error: null
    };

    let candidate = null;
    let replySent = false;
    let externalUnread = [];
    let markHandledUnread = () => {};
    const markFailureForCurrentBurst = (labelType, reviewContext = {}) => {
      const targets = (externalUnread && externalUnread.length > 0)
        ? externalUnread
        : (candidate ? [candidate] : []);

      if (targets.length === 0) {
        this._addErrorLabel(thread);
        return;
      }

      targets.forEach((message) => {
        if (labelType === 'validation') {
          this._addValidationErrorLabel(message, reviewContext);
        } else {
          this._addErrorLabel(message);
        }
        this._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds);
      });
    };
    try {
      // Raccogli informazioni su thread e messaggi
      // Ottieni ultimo messaggio NON LETTO nel thread
      const messages = thread.getMessages();
      const unreadMessages = messages.filter(m => m.isUnread());

      // Risoluzione indirizzo email principale e alias configurati
      let myEmail = '';
      try {
        if (typeof Session !== 'undefined' && Session && typeof Session.getEffectiveUser === 'function') {
          const effectiveUser = Session.getEffectiveUser();
          if (effectiveUser && typeof effectiveUser.getEmail === 'function') {
            myEmail = effectiveUser.getEmail() || '';
          }
        }
      } catch (sessionError) {
        threadLogger.warn(`Impossibile recuperare email utente da Session: ${sessionError.message}`);
      }

      let gmailAliases = [];
      try {
        gmailAliases = (typeof GmailApp !== 'undefined' && GmailApp && typeof GmailApp.getAliases === 'function')
          ? (GmailApp.getAliases() || [])
          : [];
      } catch (aliasError) {
        threadLogger.warn(`Impossibile recuperare alias Gmail: ${aliasError.message}`);
      }

      if (!myEmail && gmailAliases.length > 0) {
        myEmail = gmailAliases[0] || '';
      }

      if (!myEmail) {
        let adminEmailProperty = '';
        try {
          if (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function') {
            adminEmailProperty = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '';
          }
        } catch (propertyError) {
          threadLogger.warn(`Impossibile leggere ADMIN_EMAIL da ScriptProperties: ${propertyError.message}`);
        }
        const adminEmailConfig = (typeof CONFIG !== 'undefined' && CONFIG.LOGGING && CONFIG.LOGGING.ADMIN_EMAIL)
          ? CONFIG.LOGGING.ADMIN_EMAIL
          : '';
        const adminEmail = adminEmailProperty || adminEmailConfig || '';
        let botEmailProperty = '';
        try {
          if (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function') {
            botEmailProperty = PropertiesService.getScriptProperties().getProperty('BOT_EMAIL') || '';
          }
        } catch (propertyError) {
          threadLogger.warn(`Impossibile leggere BOT_EMAIL da ScriptProperties: ${propertyError.message}`);
        }
        const botEmailConfig = (typeof CONFIG !== 'undefined' && CONFIG.BOT_EMAIL) ? CONFIG.BOT_EMAIL : '';

        myEmail = botEmailProperty || botEmailConfig || adminEmail || '';

        if (myEmail) {
          threadLogger.warn(`Session email non disponibile: uso fallback configurato anti-loop (${myEmail})`);
        }
      }

      // ====================================================================
      // FILTRO A LIVELLO MESSAGGIO
      // ====================================================================
      const effectiveLabeledIds = (labeledMessageIds instanceof Set)
        ? labeledMessageIds
        : new Set();
      const metadataTerminalLabelIds = [];
      const metadataSkipLabelIds = new Set();
      if (this.gmailService && typeof this.gmailService._getOptionalLabelIdByName === 'function') {
        const terminalLabels = [
          { name: this.config.labelName, type: 'processed' },
          { name: this.config.errorLabelName, type: 'processed' },
          { name: this.config.validationErrorLabel, type: 'processed' }
        ];
        if (languageMode === 'foreign_only') {
          terminalLabels.push({ name: this.config.skipLabelName, type: 'skip' });
        }

        terminalLabels.forEach((entry) => {
          try {
            const labelId = entry && entry.name
              ? this.gmailService._getOptionalLabelIdByName(entry.name)
              : null;
            if (!labelId) return;
            metadataTerminalLabelIds.push(labelId);
            if (entry.type === 'skip') {
              metadataSkipLabelIds.add(labelId);
            }
          } catch (labelError) {
            threadLogger.warn(`Impossibile risolvere label terminale '${entry && entry.name ? entry.name : ''}': ${labelError.message}`);
          }
        });
      }

      const unlabeledUnread = unreadMessages.filter(message => {
        const messageId = message.getId();
        if (effectiveLabeledIds.has(messageId)) return false;

        // Cache miss hardening: l'ID potrebbe essere uscito dalla finestra maxMessages.
        // Verifica minimale su Gmail per evitare re-processing e loop di risposte duplicate
        // anche su label terminali diverse da IA (Errore/Verifica/skip foreign_only).
        if (this.gmailService && typeof this.gmailService._getMessageMetadataWithResilience === 'function') {
          const metadata = this.gmailService._getMessageMetadataWithResilience(messageId, { format: 'minimal' }, 1);
          if (metadata && Array.isArray(metadata.labelIds)) {
            const matchedTerminalId = metadataTerminalLabelIds.find(labelId => metadata.labelIds.includes(labelId));
            if (matchedTerminalId) {
              if (metadataSkipLabelIds.has(matchedTerminalId) && skippedMessageIds && typeof skippedMessageIds.add === 'function') {
                skippedMessageIds.add(messageId);
              }
              effectiveLabeledIds.add(messageId); // auto-healing cache locale
              return false;
            }
          }
        }
        return true;
      });

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

      externalUnread = unlabeledUnread.filter(message => {
        // Utilizza getFrom() per efficienza rispetto alla costosa extractMessageDetails()
        const rawFrom = (message.getFrom() || '');
        const senderEmail = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
          ? this.gmailService._extractEmailAddress(rawFrom)
          : rawFrom;



        // Se non riusciamo ad estrarre l'email, consideriamo il mittente come esterno per sicurezza
        if (!senderEmail) return true;

        return !ownAddresses.has(this._normalizeEmailAddress_(senderEmail));
      });

      if (options && Number.isFinite(Number(options.staleOnlyMs))) {
        const staleThresholdMs = Number(options.staleOnlyMs);
        const hasRecentExternalUnread = externalUnread.some(message => {
          const msgDate = (message && typeof message.getDate === 'function') ? message.getDate() : null;
          const messageTs = (msgDate && typeof msgDate.getTime === 'function') ? msgDate.getTime() : NaN;
          return Number.isFinite(messageTs) && messageTs > staleThresholdMs;
        });

        if (hasRecentExternalUnread) {
          console.log('     Stale-only: salto thread con follow-up esterni recenti per evitare risposta fuori contesto');
          result.status = 'skipped';
          result.reason = 'stale_thread_has_recent_messages';
          return result;
        }
      }

      // Nota di manutenzione sulle label:
      // - IA chiude i messaggi già gestiti tecnicamente (esterni filtrati, interni/nostri).
      // - '·' indica solo una email italiana rimandata perché siamo in modalità foreign_only.
      // Tenere separate queste due funzioni evita che il punto medio compaia in modalità "Tutte le lingue".
      markHandledUnread = () => {
        const externalIds = new Set(externalUnread.map(m => m.getId()));
        const internalUnread = [];
        unlabeledUnread.forEach(message => {
          const messageId = message.getId();
          if (externalIds.has(messageId)) {
            this._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds);
          } else {
            const rawFrom = (message && typeof message.getFrom === 'function') ? (message.getFrom() || '') : '';
            const senderEmail = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
              ? this.gmailService._extractEmailAddress(rawFrom)
              : rawFrom;
            const isOwnMessage = senderEmail && ownAddresses.has(this._normalizeEmailAddress_(senderEmail));
            if (isOwnMessage) {
              internalUnread.push(message);
            } else if (options && Number.isFinite(Number(options.staleOnlyMs))) {
              console.log(`   ℹ️ Stale-only: preservo messaggio esterno recente ${message.getId()} per il ciclo normale`);
            }
          }
        });
        if (internalUnread.length > 0) {
          internalUnread.forEach((message) => this._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds));
        }
      };

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

      // GUARDRAIL (critico): rispondiamo solo a guanti esterni.
      // I messaggi interni (noi/alias) vengono esclusi per evitare loop e risposte non dovute.
      // Se non ci sono messaggi da esterni → skip
      if (externalUnread.length === 0) {
        threadLogger.info('Saltato: nessun nuovo messaggio esterno non letto');
        // In modalità stale-only i messaggi recenti devono restare eleggibili per il ciclo normale.
        const isStaleOnlyRun = options && Number.isFinite(Number(options.staleOnlyMs));
        if (!isStaleOnlyRun) {
          // Messaggi interni (nostri/alias): sono già gestiti, ma non sono rinvii per lingua.
          // Per questo usiamo IA come chiusura tecnica e non il punto medio ('·').
          unlabeledUnread.forEach((message) => this._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds));
        } else {
          console.log('   ℹ️ Stale-only: messaggi recenti non marcati (saranno processati nel prossimo ciclo)');
        }
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
        console.log('   ⊖ Saltato: l\'ultimo messaggio del thread è nostro (bot o segreteria). Ignoro messaggi precedenti riaperti come non letti.');
        // Segniamo i non letti correnti come processati per evitare loop su thread
        // dove l'ultimo intervento è interno ma restano flag "unread" su messaggi precedenti.
        markHandledUnread();
        result.status = 'skipped';
        result.reason = 'last_speaker_is_me';
        return result;
      }

      // --- PORTA 0.5: Pre-check lingua locale sul soggetto (Costo API Zero) ---
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
          // Pre-controllo: solo termini inequivocabilmente italiani.
          // Escluse deliberatamente parole corte polisemiche (in, per, la, di, da, con, il, lo,
          // gli, le, un, uno, una, su, tra, fra) che causano falsi positivi su lingue straniere.
          const italianPattern = /(?:^|[^\p{L}\p{N}_])(appuntamento|fissare|prenotare|disponibilit[àa]|orari[oa]?|incontro|prenotazione|informazioni|chiedere|sapere|vorrei|come\s+faccio|requisiti|battesimo|cresima|confessione|grazie|salve|buongiorno|buonasera|preventivo|parrocchia|segreteria|messa|messe)(?=$|[^\p{L}\p{N}_])/iu;
          
          if (italianPattern.test(subjectOnly)) {
            console.log(`   ⊖ Pre-check locale: italiano rilevato nel solo oggetto ("${subjectOnly.substring(0, 20)}...") → skip anticipato`);
            this._markMessagesAsSkipped(externalUnread, this.config.skipLabelName, skippedMessageIds);
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

      // CRITICO: Ricostruzione del contesto in caso di burst (più email non lette dallo stesso utente).
      // Evita che un'email finale breve (es. "Grazie") faccia scartare le vere domande precedenti.
      if (externalUnread.length > 1) {
        const candidateSenderEmail = this._normalizeEmailAddress_(messageDetails.senderEmail || '');
        const candidateId = candidate.getId();
        const burstMessages = externalUnread.filter((message) => {
          if (!candidateSenderEmail || !message || typeof message.getFrom !== 'function') return message && message.getId && message.getId() === candidateId;
          const rawFrom = message.getFrom() || '';
          const sender = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
            ? this.gmailService._extractEmailAddress(rawFrom)
            : rawFrom;
          return this._normalizeEmailAddress_(sender || '') === candidateSenderEmail;
        });
        const aggregatedBody = burstMessages.map((message) => {
          const details = (message.getId() === candidateId
            ? messageDetails
            : this.gmailService.extractMessageDetails(message)) || {};
          const messageDate = (() => {
            if (!(details.date instanceof Date)) return 'data non disponibile';
            if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
              try {



                return Utilities.formatDate(details.date, this._getCachedTimeZone(), 'dd/MM/yyyy HH:mm');
              } catch (e) {
                // ripiego sotto
              }
            }
            return details.date.toISOString().slice(0, 16).replace('T', ' ');
          })();
          const bodyPart = details && typeof details.body === 'string' && details.body.trim()
            ? details.body.trim()
            : null;
          return bodyPart ? `--- Messaggio del ${messageDate} ---\n${bodyPart}` : null;
        }).filter(Boolean).join('\n\n');
        
        if (aggregatedBody) {
          messageDetails.body = aggregatedBody;
          console.log(`     Burst rilevato: accorpati contestualmente ${burstMessages.length} messaggi precedenti con timestamp`);
        }
      }

      // ====================================================================================================
      // STEP 1.5: LINGUA FAIL-FAST (a costo zero)
      // ====================================================================================================
      const bodyForLanguageDetection = (this.classifier && typeof this.classifier._extractMainContent === 'function')
        ? this.classifier._extractMainContent(messageDetails.body || '')
        : (messageDetails.body || '');

      const languageDetection = (this.geminiService && typeof this.geminiService.detectEmailLanguage === 'function')
        ? (this.geminiService.detectEmailLanguage(
          bodyForLanguageDetection || messageDetails.body || '',
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
      if (shouldSkipByLanguageMode_(detectedLanguage, languageMode)) {
        console.log('   ⊖ Saltato: modalità "Solo straniere", email in italiano');
        // Nota di manutenzione: il punto medio ('·') ha un significato preciso.
        // Qui segnala una email italiana solo temporaneamente rinviata perché
        // la modalità corrente risponde alle sole email straniere. Non va marcata IA:
        // quando si torna a "Tutte le lingue", deve rientrare tra le email lavorabili.
        this._markMessagesAsSkipped(unlabeledUnread, this.config.skipLabelName, skippedMessageIds);
        result.status = 'skipped';
        result.reason = 'italian_skipped_foreign_only';
        return result;
      }

      if (messageDetails.isNewsletter) {
        if (languageMode === 'foreign_only') {
          console.log('   ℹ️ Newsletter in foreign_only: arrivata qui perché NON intercettata dal gate lingua italiana iniziale');
        }
        console.log('   ⊖ Saltato: rilevata newsletter (List-Unsubscribe/Precedence)');
        // Le newsletter sono filtrate in modo definitivo: usiamo IA for non riprenderle
        // nei run successivi. Il punto medio ('·') non si usa qui perché non è un
        // rinvio temporaneo dovuto alla modalità "Solo straniere".
        let messagesToMark = (unlabeledUnread && unlabeledUnread.length > 0) ? unlabeledUnread : [candidate];
        // Evita di "demotare" messaggi già IA quando il fallback usa candidate.
        messagesToMark = (messagesToMark || []).filter((message) => {
          if (!message || typeof message.getId !== 'function') return false;
          const messageId = message.getId();
          return !(labeledMessageIds instanceof Set && labeledMessageIds.has(messageId));
        });

        if (messagesToMark.length > 0) {
          messagesToMark.forEach((message) => this._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds));
        }
        result.status = 'filtered';
        result.reason = 'newsletter_header';
        return result;
      }

      // ====================================================================
      // PASSO 0.15: THROTTLE CROSS-THREAD PER MITTENTE
      // Previene burst simultanei su thread diversi dallo stesso sender.
      // ====================================================================
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
            } catch (_) {}
          }
        }

        if (senderThrottleAlreadySet) {
          console.log(`   ⊘ Saltato: burst cross-thread rilevato per ${safeSenderEmail || 'mittente sconosciuto'}`);
          markHandledUnread();
          result.status = 'filtered';
          result.reason = 'cross_thread_burst';
          return result;
        }
      }

      // ====================================================================
      // PASSO 0.2: RISPOSTA AUTOMATICA / RILEVAMENTO FUORI SEDE
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
        try {
          markHandledUnread();
        } catch (markErr) {
          threadLogger.warn('markHandledUnread fallita (out_of_office): ' + markErr.message);
        }
        result.status = 'filtered';
        result.reason = 'out_of_office';
        return result;
      }

      const outOfOfficePatterns = [
        /\b(out of office|away from office|fuori ufficio|assente)\b/i,
        /\b(automatic reply|risposta automatica)\b/i,
        /\breturn(ing)? on\b/i,
        /\b(thank you for your message|mailbox monitored periodically|messaggio ricevuto)\b/i
      ];

      const oooSubject = messageDetails.subject || '';
      // Trunca a 2000 char per prevenire Regex Timeout su mega-thread
      const oooBody = (messageDetails.body || '').substring(0, 2000);
      if (outOfOfficePatterns.some(p => p.test(`${oooSubject} ${oooBody}`))) {
        console.log('   ⊖ Saltato: risposta automatica out-of-office (testo)');
        try {
          markHandledUnread();
        } catch (markErr) {
          threadLogger.warn('markHandledUnread fallita (out_of_office): ' + markErr.message);
        }
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
          markHandledUnread();
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

      const hasAnyIdentity = Boolean(normalizedMyEmail) || normalizedKnownAliases.length > 0;
      if (hasAnyIdentity) {
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
          const msgSenderEmail = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
            ? this._normalizeEmailAddress_(this.gmailService._extractEmailAddress(msgFrom) || '')
            : this._normalizeEmailAddress_(msgFrom);

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
            consecutiveExternal >= MAX_CONSECUTIVE_EXTERNAL ||
            botRepliesCount >= MAX_CONSECUTIVE_EXTERNAL ||
            (messages.length > MAX_THREAD_LENGTH && totalBotRepliesInThread >= maxBotRepliesInLongThread)
          ) {
            console.log(`   ⊖ Saltato: prevenzione loop email attivata (ping-pong/thread ripetitivo: interventiBot=${totalBotRepliesInThread}, sogliaBot=${maxBotRepliesInLongThread}, consecutivi=${Math.max(consecutiveExternal, botRepliesCount)})`);
            markHandledUnread();
            result.status = 'filtered';
            result.reason = 'email_loop_detected';
            return result;
          }
        }
      }

      if (messages.length > MAX_THREAD_LENGTH) {
        if (!hasAnyIdentity) {
          console.warn('   ⚠️ Identità mittente non disponibile con thread lungo: blocco precauzionale anti-loop');
          markHandledUnread();
          result.status = 'filtered';
          result.reason = 'anti_loop_identity_missing';
          return result;
        }

        console.warn(`   ⚠️ Thread lungo (${messages.length} messaggi) ma non loop - elaboro`);
      }

      // ====================================================================
      // STEP 0.8: ANTI-MITTENTE-NOREPLY
      // ====================================================================
      const originalSenderEmail = (
        this.gmailService && typeof this.gmailService._extractEmailAddress === 'function'
      )
        ? this.gmailService._extractEmailAddress(messageDetails.originalFrom || '')
        : (messageDetails.senderEmail || '');
      const senderInfo = `${originalSenderEmail} ${messageDetails.senderName}`.toLowerCase();
      const autoPattern = /no-reply|do-not-reply|noreply|daemon|postmaster|bounce|mailer/i;
      if (autoPattern.test(senderInfo) && !messageDetails.hasReplyTo) {
        console.log('   ⊖ Saltato: mittente rilevato come casella automatica o no-reply');
        // Elaborato (filtrato): applichiamo IA per chiudere il processo
        markHandledUnread();
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
        markHandledUnread();

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
      const isReplyPattern = /^(re|rif|r|ris|risp|aw|sv|fw|fwd|tr|i|wg|inc)\s*[:\-]/i;
      const isReplyBySubject = isReplyPattern.test(safeSubject.toLowerCase());

      const classification = this.classifier.classifyEmail(
        safeSubject,
        safeBody,
        isReplyBySubject
      );

      if (!classification.shouldReply) {
        console.log(`   ⊖ Filtrato dal classifier: ${classification.reason}`);
        // Elaborato (filtrato): applichiamo IA per chiudere il processo
        markHandledUnread();
        result.status = 'filtered';
        return result;
      }

      // ====================================================================
      // STEP 3: CONTROLLO RAPIDO - Gemini decide se serve risposta
      // ====================================================================
      let quickCheck;

      const preQuickAttachmentIntentContext = this._deriveAttachmentIntentContext_(
        messageDetails.body,
        messageDetails.subject,
        [],
        '',
        'pre_ocr'
      );
      const sponsorGuidancePrecheck = this._classifySponsorGuidanceLocally_(
        messageDetails.subject,
        messageDetails.body,
        preQuickAttachmentIntentContext,
        detectedLanguage
      );
      const quickIntentContext = Object.assign(
        {},
        preQuickAttachmentIntentContext || {},
        {
          sponsorGuidanceCheck: sponsorGuidancePrecheck === 'ask_ai',
          sponsorGuidanceLocalDecision: sponsorGuidancePrecheck
        }
      );

      try {
        quickCheck = this.geminiService.shouldRespondToEmail(
          messageDetails.body,
          messageDetails.subject,
          languageDetection,
          quickIntentContext
        );
      } catch (quickError) {
        const quickErrorClass = this._classifyError(quickError);
        const quickErrorMessage = quickError && quickError.message ? quickError.message : String(quickError);
        const isSystemic = quickErrorClass.type === 'SYSTEM_ERROR' || quickErrorClass.type === 'CONFIG_ERROR' || quickErrorClass.type === 'INVALID_API_KEY' || /\b(401|403|404)\b/.test(quickErrorMessage);
        if (!quickErrorClass.retryable && !isSystemic) {
          console.warn(`   ⚠️ Gemini quick check fallito: ${quickErrorMessage}. Applico etichetta errore al burst corrente per evitare loop.`);
          try {
            markFailureForCurrentBurst('error');
          } catch (markError) {
            threadLogger.warn(`Errore label quick-check silenziato: ${markError.message}`);
          }
        } else {
          console.warn(`   ↻ Gemini quick check fallito con errore retryable o di sistema (${quickErrorClass.type}): ${quickErrorMessage}. Nessuna label permanente.`);
        }
        result.status = 'error';
        result.error = `quick_check_failed: ${quickErrorMessage}`;
        result.errorClass = isSystemic ? 'SYSTEM_ERROR' : quickErrorClass.type;
        return result;
      }

      if (!quickCheck || typeof quickCheck !== 'object') {
        console.warn('   ⚠️ Gemini quick check ha restituito una risposta vuota/non valida: applico etichetta errore al burst corrente per evitare loop.');
        try {
          markFailureForCurrentBurst('error');
        } catch (markError) {
          threadLogger.warn(`Errore label quick-check non valido silenziato: ${markError.message}`);
        }
        result.status = 'error';
        result.error = 'quick_check_failed';
        return result;
      }

      // Se Gemini Quick Check ha rilevato una lingua diversa con maggiore precisione, aggiorniamo
      if (quickCheck.language && quickCheck.language.substring(0, 2).toLowerCase() !== detectedLanguage) {
        detectedLanguage = quickCheck.language.substring(0, 2).toLowerCase();
        console.log(`   🌐 Lingua (aggiornata da AI): ${detectedLanguage.toUpperCase()}`);
      }

      // Valutazione preliminare della lingua per il filtraggio selettivo.
      if (shouldSkipByLanguageMode_(detectedLanguage, languageMode)) {
        console.log('   ⊖ Saltato: modalità "Solo straniere", lingua italiana confermata dopo quick-check');
        this._markMessagesAsSkipped(unlabeledUnread, this.config.skipLabelName, skippedMessageIds);
        result.status = 'skipped';
        result.reason = 'italian_skipped_foreign_only_post_quickcheck';
        return result;
      }

      if (!quickCheck.shouldRespond) {
        console.log(`   ⊖ Gemini quick check: nessuna risposta necessaria (${quickCheck.reason})`);
        if (quickCheck.reason === 'quick_check_failed') {
          console.warn('   ⚠️ Gemini quick check fallito: applico etichetta errore al burst corrente per evitare retry infiniti.');
          try {
            markFailureForCurrentBurst('error');
          } catch (markError) {
            threadLogger.warn(`Errore label quick-check failed silenziato: ${markError.message}`);
          }
          result.status = 'error';
          result.error = 'quick_check_failed';
          return result;
        }
        // Il quick check riceve il corpo accorpato del burst quando esistono piu'
        // messaggi ravvicinati: se decide NO_REPLY, chiudiamo l'intero blocco
        // per evitare rielaborazioni retrograde dei messaggi precedenti.
        markHandledUnread();
        result.status = 'filtered';
        return result;
      }

      // Quick check superato con shouldRespond=true: marca i secondari ora.
      if (languageMode !== 'foreign_only') {
        const externalIds = new Set(externalUnread.map(m => m.getId()));
        const candidateDate = messageDetails && messageDetails.date instanceof Date
          ? messageDetails.date
          : (candidate && typeof candidate.getDate === 'function' ? candidate.getDate() : null);
        const candidateTs = candidateDate instanceof Date ? candidateDate.getTime() : 0;
        unlabeledUnread.forEach(message => {
          if (!message || message.getId() === candidate.getId()) return;
          if (externalIds.has(message.getId())) {
            const msgDate = (typeof message.getDate === 'function') ? message.getDate() : null;
            const msgTs = msgDate instanceof Date ? msgDate.getTime() : 0;
            // Fissa il candidato del burst: i messaggi esterni precedenti al candidato
            // sono considerati inclusi nel contesto della risposta corrente.
            if (msgTs && candidateTs && msgTs < candidateTs) {
              this._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds);
            }
            return;
          }
          this._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds);
        });
      } else {
        console.log('   🌐 Modalità "Solo straniere": non pre-marco i non letti secondari');
      }

      // ====================================================================
      // STEP 4: CLASSIFICAZIONE TIPO RICHIESTA (Multi-dimensionale)
      // ====================================================================
      const requestTypeRaw = this.requestClassifier.classify(
        messageDetails.subject,
        messageDetails.body,
        quickCheck.classification
      );
      // Normalizzazione dell'oggetto requestType per l'elaborazione successiva.
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

      // Inclusione della Knowledge Base testuale per il PromptEngine.
      knowledgeSections.push(normalizedKnowledgeBase);

      // PromptEngine gestisce l'integrazione selettiva di AI_CORE e Dottrina.

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
          conversationHistory = this.gmailService.getThreadHistory(
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
      // 2. Recupera cronologia recente per il contesto (max configurable)
      const historyLimit = this.config.maxHistoryMessages || 10;
      const history = (
        this.memoryService &&
        typeof this.memoryService.getRecentHistory === 'function'
      )
        ? this.memoryService.getRecentHistory(threadId, historyLimit)
        : [];
      const memoryContext = this.memoryService.getMemory(threadId) || {};

      if (memoryContext.lastUpdated) {
        console.log(`   🧠 Memoria trovata: lang=${memoryContext.language}, topics=${(memoryContext.providedInfo || []).length}`);
      }

      // ====================================================================
      // STEP 6.6: CALCOLO DINAMICO SALUTO E RITARDO
      // ====================================================================
      const memoryMessageCount = Number.isFinite(Number(memoryContext.messageCount))
        ? Number(memoryContext.messageCount)
        : 0;

      const salutationMode = computeSalutationMode({
        isReply: isReplyBySubject || messages.length > 1,
        memoryExists: !!memoryContext.lastUpdated,
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
          const bodyForTerritory = bodyForLanguageDetection || messageDetails.body;
          territoryResult = this.territoryValidator.analyzeEmailForAddress(
            bodyForTerritory,
            messageDetails.subject
          ) || { addressFound: false };
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
            isReply: isReplyBySubject || messages.length > 1,
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
            containsDates: /\b(19|20)\d{2}\b/.test(enrichedKnowledgeBase)
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

      // ====================================================================
      // CONTEXT ROUTING: inietta moduli KB pesanti solo quando servono.
      // Manteniamo default conservativo (dottrina attiva) in caso di dubbio.
      // ====================================================================
      let routedAiCoreLite = aiCoreLite;
      let routedAiCore = aiCore;
      let routedDoctrine = effectiveDoctrineBase;
      let routedDoctrineStructured = doctrineStructured;

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
        concernFlags.doctrine ||
        concernFlags.sensitive ||
        concernFlags.canonLaw ||
        concernFlags.sacrament ||
        concernFlags.formalComplaint ||
        hasMemoryPastoralContext
      );

      // Il context routing definitivo viene eseguito dopo l'OCR degli allegati:
      // _deriveAttachmentIntentContext_ può aggiornare categoryHintSource con segnali
      // sacramentali/formali estratti dai documenti, quindi filtrare qui sarebbe prematuro.


      // ====================================================================
      // STEP 7.1: PREPARAZIONE ALLEGATI (Multimodale / Vision)
      // ====================================================================
      let attachmentBlobs = [];
      let textFromAttachments = '';
      let attachmentSkipped = [];
      let attachmentItems = [];


      if (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT && CONFIG.ATTACHMENT_CONTEXT.enabled) {
        if (this._isNearDeadline(this.config.maxExecutionTimeMs)) {
          attachmentSkipped.push({ reason: 'near_deadline' });
          console.warn('   ⏳ Allegati multimodali saltati: tempo residuo insufficiente.');
        } else {
          let hasAttachments = false;
          let attachmentPreCheckFailed = false;
          try {
            hasAttachments = externalUnread.some((message) => {
              const attachments = message.getAttachments({ includeInlineImages: true, includeAttachments: true }) || [];
              return attachments.length > 0;
            });
          } catch (e) {
            console.warn(`⚠️ Impossibile leggere allegati per pre-check: ${e.message}`);
            attachmentPreCheckFailed = true;
          }

          if (!hasAttachments && !attachmentPreCheckFailed) {
            attachmentSkipped.push({ reason: 'no_attachments' });
            console.log('   📎 Elaborazione allegati saltata: nessun allegato nel messaggio candidato');
          } else if (
            (messageDetails.body || '').trim().length < 50 ||
            attachmentPreCheckFailed ||
            this._shouldTryOcr(messageDetails.body, messageDetails.subject, hasAttachments)
          ) {
            // Body molto corto (<50 char) → l'allegato è probabilmente il contenuto principale
            if ((messageDetails.body || '').trim().length < 50) {
              console.log('   📎 Body corto: elaborazione allegati forzata');
            }
            console.log('   📎 Elaborazione allegati multimodale (Vision)...');
            const attachmentSettings = Object.assign(
              { maxFiles: 3 },
              (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT) ? CONFIG.ATTACHMENT_CONTEXT : {}
            );
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
            // Aggrega allegati dai non letti esterni più recenti, non solo dal candidato.
            // Evita perdita di contesto quando l'utente invia allegati in messaggi precedenti.
            for (let i = externalUnread.length - 1; i >= 0; i--) {
              try {
                const remainingFiles = maxAttachmentFiles - countProcessedAttachments();
                if (remainingFiles <= 0) break;

                const usedChars = (attachmentData.textContext || '').length;
                const safeMaxChars = maxTextChars > 0
                  ? Math.max(0, maxTextChars - usedChars)
                  : 0;
                const msgData = this.gmailService.getProcessableAttachments(externalUnread[i], {
                  maxFiles: remainingFiles,
                  maxTotalChars: safeMaxChars,
                  shouldContinue: () => !this._isNearDeadline(this.config.maxExecutionTimeMs)
                });
                if (Array.isArray(msgData.blobs)) attachmentData.blobs.push(...msgData.blobs);
                if (msgData.textContext) {
                  if (maxTextChars > 0) {
                    const remainingChars = Math.max(0, maxTextChars - (attachmentData.textContext || '').length);
                    if (remainingChars <= 0) {
                      attachmentData.skipped.push({ reason: 'max_total_chars' });
                      continue;
                    }
                    const boundedText = msgData.textContext.length > remainingChars
                      ? msgData.textContext.substring(0, remainingChars)
                      : msgData.textContext;
                    attachmentData.textContext += boundedText;
                    if (boundedText.length < msgData.textContext.length) {
                      attachmentData.skipped.push({ reason: 'max_total_chars', kept: boundedText.length });
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
                  messageId = externalUnread[i] && externalUnread[i].getId ? externalUnread[i].getId() : 'unknown';
                } catch (idError) {
                  threadLogger.debug(`Impossibile recuperare ID messaggio durante errore allegati: ${idError.message}`);
                }
                console.warn(`   ⚠️ Errore critico estrazione allegati nel messaggio ${messageId}: ${attError.message}`);
                attachmentData.skipped.push({ reason: 'extraction_crash', error: attError.message });
              }
            }
            attachmentBlobs = attachmentData.blobs || [];
            textFromAttachments = attachmentData.textContext || '';
            attachmentSkipped = attachmentData.skipped || [];
            attachmentItems = attachmentData.items || [];
            const postOcrAttachmentIntentContext = this._deriveAttachmentIntentContext_(
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
              if (!hasSubmissionQuestions) {
                forceReceiptOnlyForSubmission = true;
                console.log('   📎 Guardrail submission: nessuna domanda esplicita → risposta solo conferma ricezione');
              }

              const sponsorSubmission = Boolean(
                (attachmentIntentContext.detectedDocTypes && attachmentIntentContext.detectedDocTypes.sponsor) ||
                /sponsor|padrin|madrin|idoneit/i.test(String(attachmentIntentContext.intent || '')) ||
                /sponsor|padrin|madrin|idoneit/i.test(`${messageDetails.subject || ''} ${messageDetails.body || ''}`)
              );
              if (sponsorSubmission) {
                const shouldProvideEligibilityGuidance = this._shouldProvideEligibilityGuidance_(
                  messageDetails.subject,
                  messageDetails.body,
                  attachmentIntentContext,
                  quickCheck.needs_sponsor_guidance,
                  detectedLanguage
                );
                forceReceiptOnlyForSubmission = hasSubmissionQuestions ? false : !shouldProvideEligibilityGuidance;
                if (forceReceiptOnlyForSubmission) {
                  console.log('   📎 Guardrail sponsor submission: consegna documentale → risposta solo conferma ricezione');
                } else if (hasSubmissionQuestions) {
                  console.log('   📎 Guardrail sponsor submission: domanda nel corpo → risposta alla domanda + conferma ricezione');
                }
              }
            }

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
      // ====================================================================
      // CONTEXT ROUTING post-OCR (definitivo)
      // ====================================================================
      const isTechnicalOnly = TECHNICAL_CONTEXT_ROUTING_CATEGORIES.has(categoryHintSource) && !hasPastoralConcern;
      if (isTechnicalOnly) {
        routedAiCore = '';
        routedDoctrine = '';
        routedDoctrineStructured = [];
        console.log('   🧭 Context routing: richiesta tecnica → disattivo moduli dottrinali pesanti.');
      } else {
        console.log('   🧭 Context routing: richiesta non tecnica o sensibile → mantengo moduli completi.');
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
        currentDate: this._getBusinessDateString(),
        currentTime: this._getBusinessTimeString(),
        messageDate: this._getBusinessDateString(messageDetails.date),
        salutation: greeting,
        closing: closing,
        subIntents: classification.subIntents || {},
        memoryContext: memoryContext,
        salutationMode: salutationMode,
        responseDelay: responseDelay,
        promptProfile: promptProfile,
        activeConcerns: activeConcerns,
        territoryContext: territoryContext,
        sponsorGuidancePolicy: this._deriveSponsorGuidancePolicy_(messageDetails.subject, messageDetails.body, attachmentIntentContext, quickCheck.needs_sponsor_guidance, detectedLanguage),
        requestType: requestType,
        attachmentsContext: attachmentBlobs.length > 0 ? textFromAttachments : "ATTENZIONE: L'utente NON ha inviato allegati fisici. Ha fornito solo dati nel testo. NON usare formule come 'ricezione della documentazione'. Rispondi direttamente alla richiesta operativa.",
        attachmentIntentContext: attachmentIntentContext,
        aiCoreLite: routedAiCoreLite,
        aiCore: routedAiCore,
        doctrineBase: routedDoctrine,
        doctrineStructured: routedDoctrineStructured
      };

      const documentConsistency = this.config.documentConsistencyCheckEnabled
        ? this._evaluateDocumentConsistency_(
          messageDetails.subject,
          messageDetails.body,
          attachmentItems,
          textFromAttachments
        )
        : null;
      const isDocumentDeliveryContext = Boolean(
        attachmentIntentContext &&
        /submission/i.test(String(attachmentIntentContext.intent || ''))
      );
      const hasDocumentMismatch = !!(documentConsistency && documentConsistency.mode === 'mismatch');
      const hasRiskyUnknownReceived = !!(
        documentConsistency &&
        documentConsistency.mode === 'unknown_received' &&
        isDocumentDeliveryContext
      );
      const shouldForcePrudentDocResponse = hasDocumentMismatch;
      if (hasDocumentMismatch) {
        console.warn(`   ⚠️ Mismatch documentale rilevato: atteso=${documentConsistency.expected || 'unknown'} ricevuto=${documentConsistency.received || 'unknown'}`);
      } else if (hasRiskyUnknownReceived) {
        console.warn(`   ⚠️ Documento non classificabile in contesto sponsor: atteso=${documentConsistency.expected || 'unknown'} ricevuto=unknown`);
      }

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
      const defaultGenerationStrategy = ['flash-3.5', 'flash-3.5-backup', 'flash-lite', 'flash-3.5-lite-backup'];
      const defaultGenerationModelNames = {
        'flash-3.5': 'gemini-3.5-flash',
        'flash-3.5-backup': 'gemini-3.5-flash',
        'flash-3.5-lite': 'gemini-3.1-flash-lite',
        'flash-lite': 'gemini-3.1-flash-lite',
        'flash-3': 'gemini-3-flash-preview',
        'flash-3-backup': 'gemini-3-flash-preview',
        'flash-3.5-lite-backup': 'gemini-3.1-flash-lite'
      };
      const configuredGenerationStrategy = (
        typeof CONFIG !== 'undefined' &&
        CONFIG.MODEL_STRATEGY &&
        Array.isArray(CONFIG.MODEL_STRATEGY.generation) &&
        CONFIG.MODEL_STRATEGY.generation.length > 0
      ) ? CONFIG.MODEL_STRATEGY.generation : defaultGenerationStrategy;
      const fallbackModelName = configuredGenerationStrategy
        .map(modelKey => (geminiModels[modelKey] && geminiModels[modelKey].name) || defaultGenerationModelNames[modelKey])
        .find(Boolean) || 'gemini-3.5-flash';

      const attemptStrategy = configuredGenerationStrategy
        .map((modelKey, index) => {
          const modelDef = geminiModels[modelKey];
          const modelName = (modelDef && modelDef.name) || defaultGenerationModelNames[modelKey];
          if (!modelName) {
            console.warn(`⚠️ Strategia generazione ignora modello non configurato: ${modelKey}`);
            return null;
          }

          const usesBackupKey = /backup/i.test(modelKey);
          if (!usesBackupKey && this.geminiService && this.geminiService.isPrimaryExhausted) {
            return null;
          }

          const apiKey = usesBackupKey ? this.geminiService.backupKey : this.geminiService.primaryKey;
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

      if (shouldForcePrudentDocResponse) {
        response = this._buildPrudentDocumentMismatchResponse_(detectedLanguage);
        strategyUsed = 'DocumentConsistency-PrudentResponse';
        console.log('✅ Risposta prudente generata per mismatch documentale');
      } else if (hasRiskyUnknownReceived || forceReceiptOnlyForSubmission) {
        response = this._buildReceiptOnlySubmissionResponse_(detectedLanguage);
        strategyUsed = hasRiskyUnknownReceived 
          ? 'DocumentConsistency-UnknownReceivedReceiptOnly'
          : 'Submission-ReceiptOnlyGuardrail';
        console.log(`✅ Risposta di sola ricezione generata (${strategyUsed})`);
      } else {
        for (const plan of attemptStrategy) {
        if (!plan.key) continue;
        if (!plan.usesBackupKey && this.geminiService && this.geminiService.isPrimaryExhausted) {
          console.warn(`↪️ Strategia '${plan.name}' saltata: chiave primaria già esaurita.`);
          continue;
        }

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
            // Se la chiave corrente è invalida/non autorizzata (401/403),
            // prova la strategia successiva: una chiave/modello di backup può essere ancora valido.
            if (/401|403|unauthorized|forbidden|permission_denied/i.test(String(err && err.message ? err.message : err))) {
              console.warn('↪️ Errore di autenticazione/permessi rilevato, provo la strategia successiva.');
              continue;
            }
            console.error('🛑 Errore fatale rilevato, interrompo strategia.');
            break;
          }

          const isLastPlan = attemptStrategy[attemptStrategy.length - 1] === plan;
          if ((errorClass.type === 'RETRYABLE' || errorClass.type === 'QUOTA_EXHAUSTED') && isLastPlan && String(err).toLowerCase().includes('quota')) {
            console.warn("🧯 QUOTA_EXHAUSTED sull'ultima strategia: nessuna strategia residua, uscita anticipata.");
            break;
          }

          if (['RETRYABLE', 'QUOTA_EXHAUSTED', 'NETWORK', 'TIMEOUT', 'QUOTA_EXCEEDED', 'INVALID_RESPONSE', 'UNKNOWN'].includes(errorClass.type)) {
            console.warn(`↪️ Errore ${errorClass.type}, provo la strategia successiva.`);
            continue;
          }
        }
      }
      }


      if (!response) {
        const errorToReport = generationError || initialError;
        const errorClass = errorToReport ? this._classifyError(errorToReport) : { type: 'UNKNOWN', retryable: false, message: 'Generation strategies exhausted' };
        console.error('🛑 TUTTE le strategie di generazione sono fallite.');
        if (!errorClass.retryable) {
          markFailureForCurrentBurst('error');
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
        markFailureForCurrentBurst('error');
        result.status = 'error';
        result.error = 'Invalid response type from GeminiService';
        result.errorClass = 'DATA';
        return result;
      }

      response = this._extractEmailXmlBlock_(response);

      if (response.trim() === 'NO_REPLY') {
        console.log('   ⊖ AI ha restituito NO_REPLY');
        markHandledUnread();
        result.status = 'filtered';
        return result;
      }


      response = this._addTimeDiscrepancyNoteIfNeeded(
        response,
        { ...messageDetails, body: messageDetails.body || '' },
        detectedLanguage
      );

      response = this._sanitizeUnrequestedSponsorGuidance_(
        response,
        messageDetails.subject,
        messageDetails.body,
        detectedLanguage
      );

      // Guardrail: blocca saluti confidenziali non giustificati.
      // Il flag /m abbina solo inizio riga, evitando falsi positivi nel corpo.
      // Lascia intatto "Dear" (standard formale EN) e "Cher" (formale FR).
      if (/^it/i.test(detectedLanguage || 'it')) {
        response = response.replace(/^(Caro|Cara|Carissimo|Carissima)\b/gm, 'Gentile');
      } else if (/^pt/i.test(detectedLanguage || '')) {
        response = response.replace(/^(Caro|Cara)\b/gm, 'Prezado');
      }

      // ====================================================================
      // PASSO 9: VALIDAZIONE + RETRY INTELLIGENTE
      // ====================================================================
      let finalResponse = this._prepareOutboundResponse(response, messageDetails, detectedLanguage);
      let validation = null;
      let retryAttempted = false;
      let shouldLabelForReview = false;

      if (this.config.validationEnabled && !shouldForcePrudentDocResponse && !forceReceiptOnlyForSubmission && !hasRiskyUnknownReceived) {
        const fullValidationKB = [
          enrichedKnowledgeBase,
          routedAiCoreLite,
          routedAiCore,
          routedDoctrine
        ].filter(Boolean).join('\n\n');
        const validationTemporalContext = {
          currentDate: this._getBusinessDateString(),
          messageDate: this._getBusinessDateString(messageDetails.date)
        };

        validation = this.validator.validateResponse(
          finalResponse,
          detectedLanguage,
          fullValidationKB,
          messageDetails.body,
          messageDetails.subject,
          salutationMode,
          true,
          validationTemporalContext
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
            model: fallbackModelName,
            skipRateLimit: false
          };

          let retryResponse = null;
          try {
            const retryResult = this.geminiService.generateResponse(correctionPrompt, {
              apiKey: retryPlan.key,
              modelName: retryPlan.model,
              skipRateLimit: retryPlan.skipRateLimit
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

          retryResponse = this._extractEmailXmlBlock_(retryResponse);

          const preparedRetryResponse = this._prepareOutboundResponse(
            retryResponse,
            messageDetails,
            detectedLanguage
          );

          const retryValidation = this.validator.validateResponse(
            preparedRetryResponse,
            detectedLanguage,
            fullValidationKB,
            messageDetails.body,
            messageDetails.subject,
            salutationMode,
            true,
            validationTemporalContext
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
          const retryNote = retryAttempted ? ' (dopo retry)' : '';
          console.warn(`   🛑 Validazione FALLITA${retryNote} (punteggio: ${validation.score.toFixed(2)})`);

          if (validation.details && validation.details.exposedReasoning && validation.details.exposedReasoning.score === 0.0) {
            console.warn("⚠️ Risposta bloccata per Thinking Leak. Invio a etichetta 'Verifica'.");
            result.reason = 'thinking_leak';
          }

          const validationReason = result.reason || 'validation_score_below_threshold';
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
          return result;
        }

        const configuredWarningThreshold = Number(this.config.validationWarningThreshold);
        const warningThreshold = Number.isFinite(configuredWarningThreshold)
          ? Math.max(0, Math.min(1, configuredWarningThreshold))
          : 0.90;
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
        threadLogger.info(`Thread processato in ${result.durationMs}ms`, { duration: result.durationMs });
        return result;
      }

      const sendTxn = this._beginSendTransaction(candidate.getId(), skipLock);
      if (!sendTxn.ok) {
        console.warn(`   ⊖ Invio saltato per idempotenza (${sendTxn.reason})`);
        if (sendTxn.reason === 'already_sent') {
          markHandledUnread();
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
        this._commitSendTransaction(candidate.getId(), sendTxn);
        replySent = true;

        // Pulisci le etichette dello stato precedente in caso di risposta positiva
        try {
          if (this.gmailService && typeof this.gmailService.removeLabelFromThread === 'function') {
            this.gmailService.removeLabelFromThread(thread, this.config.errorLabelName);
          }
          if (!shouldLabelForReview) {
            if (this.gmailService && typeof this.gmailService.removeLabelFromThread === 'function') {
              this.gmailService.removeLabelFromThread(thread, this.config.validationErrorLabel);
            }
            if (this.gmailService && typeof this.gmailService.removeLabelFromMessage === 'function') {
              this.gmailService.removeLabelFromMessage(candidate.getId(), this.config.validationErrorLabel);
            }
          }
        } catch (cleanupError) {
          console.warn(`⚠️ Cleanup label stato precedente fallito: ${cleanupError.message}`);
        }

        // Etichettatura non critica: non deve compromettere lo step successivo (memoria).
        try {
          if (shouldLabelForReview || shouldForcePrudentDocResponse) {
            this._addValidationErrorLabel(candidate, {
              reason: shouldForcePrudentDocResponse ? 'document_consistency_prudent_response' : 'validation_warning',
              validation: validation,
              subject: messageDetails.subject
            });
          }
        } catch (labelErr) {
          console.warn(`⚠️ Label di verifica non applicata (non bloccante): ${labelErr.message}`);
        }
      } catch (e) {
        const errorMessage = e && e.message ? e.message : String(e);
        const classifiedSendError = this._classifyError(e);
        if (classifiedSendError.type !== 'NETWORK' && classifiedSendError.type !== 'TIMEOUT') {
          this._rollbackSendTransaction(candidate.getId(), sendTxn);
        } else {
          // Gmail può aver accettato il messaggio prima che il client riceva un
          // timeout/errore di rete: promuoviamo l'idempotency marker a `sent`
          // per evitare un replay automatico alla ripresa del batch.
          this._commitSendTransaction(candidate.getId(), sendTxn);
        }
        console.error(`   🛑 Errore invio Gmail: ${errorMessage}`);

        // Errori transienti: lascia il messaggio eleggibile per retry automatico.
        if (!classifiedSendError.retryable) {
          try {
            markFailureForCurrentBurst('error');
          } catch (markError) {
            console.warn(`⚠️ Errore label su thread in errore silenziato: ${markError.message}`);
          }
        } else {
          console.warn(`   ↻ Errore invio retryable (${classifiedSendError.type}) - nessuna marcatura permanente`);
        }

        result.status = 'error';
        result.error = `gmail_send_failed: ${errorMessage}`;
        result.errorClass = classifiedSendError.type;
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

      const inferredReactionData = (memoryContext.providedInfo && memoryContext.providedInfo.length > 0)
        ? this._computeUserReaction(messageDetails.body, memoryContext.providedInfo)
        : null;

      const memoryUpdate = {
        language: detectedLanguage,
        category: classification.category || requestTypeName,
        _incrementMessageCount: true
      };

      if (memorySummary) {
        memoryUpdate.memorySummary = memorySummary;
      }

      try {
        const memorySaved = this.memoryService.updateMemoryAtomic(
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

      // Marca tutti i messaggi non letti esaminati nel thread:
      // evita reprocessing dei messaggi precedenti quando arrivano più email
      // ravvicinate prima dell'esecuzione del trigger.
      markHandledUnread();
      result.status = 'replied';
      result.durationMs = Date.now() - startTime;
      threadLogger.info(`Thread processato in ${result.durationMs}ms`, { duration: result.durationMs });
      return result;

    } catch (error) {
      threadLogger.error(`Errore elaborazione thread: ${error.message}`, { stack: error && error.stack ? error.stack : undefined });

      if (replySent) {
        threadLogger.warn('Errore post-invio: thread non etichettato come errore perché la risposta è stata già inviata');
        try {
          markHandledUnread();
        } catch (markError) {
          threadLogger.warn(`Errore label post-invio silenziato: ${markError.message}`);
        }
        result.status = 'replied';
        result.warning = `post_send_error: ${error.message}`;
        result.durationMs = Date.now() - startTime;
        return result;
      }

      const unhandledErrorClass = this._classifyError(error);
      const isSystemic = unhandledErrorClass.type === 'SYSTEM_ERROR' || unhandledErrorClass.type === 'CONFIG_ERROR' || unhandledErrorClass.type === 'INVALID_API_KEY' || /\b(401|403|404)\b/.test(error.message || '');
      if (!unhandledErrorClass.retryable && !isSystemic) {
        try {
          markFailureForCurrentBurst('error');
        } catch (labelError) {
          threadLogger.warn(`Errore aggiunta errorLabel silenziato: ${labelError.message}`);
        }
      } else {
        threadLogger.warn(`Errore retryable o sistemico (${unhandledErrorClass.type}): nessuna label permanente applicata.`);
      }
      result.status = 'error';
      result.error = error.message;
      result.errorClass = isSystemic ? 'SYSTEM_ERROR' : unhandledErrorClass.type;
      return result;

    } finally {
      restoreServiceLoggers();
      this._releaseThreadLock(lockCtx, threadLogger);
    }
  }

  /**
   * Processa tutte le email non lette
   * @param {string} knowledgeBase
   * @param {string} doctrineBase
   * @param {boolean} skipExecutionLock - Evita il lock batch quando il chiamante gestisce l'orchestrazione
   * @param {boolean} locksAlreadyCovered - Se true, processThread evita lock interni già coperti da lock esterno
   */
  processUnreadEmails(knowledgeBase, doctrineBase = '', skipExecutionLock = false, locksAlreadyCovered = skipExecutionLock, options = {}) {
    // Inizializzazione di _startTime per la precisione dei calcoli.
    // anche se l'istanza viene riutilizzata in trigger successivi.
    this._startTime = Date.now();
    const runId = (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.getUuid === 'function')
      ? Utilities.getUuid().substring(0, 8)
      : `${this._startTime}`;
    const candidateRunLogger = (this.logger && typeof this.logger.withMeta === 'function')
      ? this.logger.withMeta({ runId: runId })
      : this.logger;
    const runLogger = (candidateRunLogger &&
      typeof candidateRunLogger.info === 'function' &&
      typeof candidateRunLogger.warn === 'function' &&
      typeof candidateRunLogger.error === 'function')
      ? candidateRunLogger
      : {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args),
        debug: (...args) => console.log(...args),
      };
    const previousRunServiceLoggers = {
      gmailService: this.gmailService ? this.gmailService.logger : null,
      memoryService: this.memoryService ? this.memoryService.logger : null
    };
    const restoreRunServiceLoggers = () => {
      if (this.gmailService) this.gmailService.logger = previousRunServiceLoggers.gmailService;
      if (this.memoryService) this.memoryService.logger = previousRunServiceLoggers.memoryService;
    };
    if (runLogger && typeof runLogger.withContext === 'function') {
      if (this.gmailService) this.gmailService.logger = runLogger.withContext('GmailService');
      if (this.memoryService) this.memoryService.logger = runLogger.withContext('MemoryService');
    }
    runLogger.info('Inizio elaborazione email', { runId: runId });

    const executionLock = (typeof LockService !== 'undefined' && LockService && typeof LockService.getScriptLock === 'function')
      ? LockService.getScriptLock()
      : null;
    let lockAcquiredHere = false;
    let deferredBatchCheckpoint = null;
    const deferBatchCheckpoint = (threadsToResume, startIndex, remainingTimeMs) => {
      deferredBatchCheckpoint = {
        threads: threadsToResume,
        startIndex: startIndex,
        remainingTimeMs: remainingTimeMs
      };
    };

    if (!skipExecutionLock) {
      if (!executionLock) {
        console.warn('⚠️ LockService non disponibile: procedo senza lock globale per questo batch.');
      } else {
          const lockWaitMs = (typeof CONFIG !== 'undefined' && CONFIG.EXECUTION_LOCK_WAIT_MS)
            ? CONFIG.EXECUTION_LOCK_WAIT_MS : 1000;

        try {
          if (!executionLock.tryLock(lockWaitMs)) {
            runLogger.warn('Un\'altra esecuzione è già attiva: salto questo turno per evitare doppie risposte.');
            restoreRunServiceLoggers();
            return { total: 0, replied: 0, filtered: 0, errors: 0, skipped: 1, reason: 'execution_locked' };
          }
        } catch (e) {
          runLogger.error(`Errore servizio Lock Globale: ${e.message}. Batch interrotto.`);
          restoreRunServiceLoggers();
          return { total: 0, replied: 0, filtered: 0, errors: 1, skipped: 0, reason: 'lock_service_error' };
        }
        lockAcquiredHere = true;
      }
    }

    try {
      const normalizedKnowledgeBase = this._normalizeTextContent(knowledgeBase);
      const normalizedDoctrineBase = this._normalizeTextContent(doctrineBase);
      const isKnowledgeBaseMissing = normalizedKnowledgeBase === null ||
        typeof normalizedKnowledgeBase === 'undefined' ||
        normalizedKnowledgeBase === '';

      if (isKnowledgeBaseMissing) {
        runLogger.error('Knowledge base non disponibile: interrompo batch per evitare risposte senza contesto.');
        return { total: 0, replied: 0, filtered: 0, errors: 1, skipped: 0, reason: 'knowledge_base_missing' };
      }

      if (this.config.dryRun) {
        console.warn('🔴 MODALITÀ DRY_RUN ATTIVA - Email NON inviate!');
      }

      const getEffectiveMaxEmailsPerRun = () => {
        const dynamicLimit = (typeof CONFIG !== 'undefined') ? parseInt(CONFIG.MAX_EMAILS_PER_RUN, 10) : NaN;
        const fallbackLimit = parseInt(this.config.maxEmailsPerRun, 10);
        const resolved = Number.isNaN(dynamicLimit) ? fallbackLimit : dynamicLimit;
        const sanitized = Number.isNaN(resolved) ? 10 : resolved;
        const bounded = Math.max(0, Math.min(50, sanitized));
        if (bounded !== sanitized) {
          runLogger.warn(`⚠️ MAX_EMAILS_PER_RUN fuori range (${sanitized}), normalizzato a ${bounded}.`);
        }
        return bounded;
      };

      const initialMaxEmailsPerRun = getEffectiveMaxEmailsPerRun();
      if (initialMaxEmailsPerRun === 0) {
        runLogger.warn('Elaborazione email sospesa: MAX_EMAILS_PER_RUN=0.');
        this._clearBatchCheckpoint_('elaborazione sospesa');
        return {
          total: 0,
          replied: 0,
          filtered: 0,
          validationFailed: 0,
          errors: 0,
          dryRun: 0,
          skipped: 0,
          reason: 'processing_suspended'
        };
      }

      const languageMode = typeof this._getLanguageProcessingMode_ === 'function'
        ? this._getLanguageProcessingMode_()
        : 'all';
      // Discovery e punto medio:
      // - in "Solo straniere" escludiamo '·' perché identifica email italiane già rinviate;
      // - in "Tutte le lingue" non lo escludiamo, così quelle email tornano lavorabili.
      const labelsDaIgnorare = languageMode === 'foreign_only' ? [this.config.skipLabelName] : [];

      let threads;
      try {
        if (Array.isArray(options.threadIds) && options.threadIds.length > 0) {
          threads = options.threadIds
            .map((id) => {
              try {
                return GmailApp.getThreadById(id);
              } catch (getErr) {
                runLogger.debug(`Thread ${id} non recuperabile da checkpoint: ${getErr.message}`);
                return null;
              }
            })
            .filter(Boolean);
          runLogger.info(`Ripresa batch con ${threads.length}/${options.threadIds.length} thread da checkpoint`);
        } else {
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
            labelsDaIgnorare,
            {
              staleOnlyMs: options && Number.isFinite(Number(options.staleOnlyMs))
                ? Number(options.staleOnlyMs)
                : null
            }
          );
        }
      } catch (e) {
        if (e && e.message && String(e.message).includes('GMAIL_DAILY_CALL_LIMIT_REACHED')) {
          runLogger.warn('⚠️ Stop batch: raggiunto limite locale chiamate Gmail. Rimando al prossimo ciclo.');
          return { total: 0, replied: 0, filtered: 0, errors: 0, skipped: 1, reason: 'gmail_daily_limit_reached' };
        }
        if (e && e.message && String(e.message).includes('GMAIL_COUNTER_LOCK_NOT_ACQUIRED_RETRYABLE')) {
          runLogger.warn('⚠️ Stop batch: contatore Gmail temporaneamente conteso. Riproverà al prossimo ciclo.');
          return { total: 0, replied: 0, filtered: 0, errors: 0, skipped: 1, reason: 'gmail_counter_lock_unavailable' };
        }
        runLogger.error(`❌ Impossibile recuperare thread da elaborare: ${e.message}. Batch interrotto per sicurezza.`);
        return { total: 0, replied: 0, filtered: 0, errors: 1, skipped: 0, reason: 'thread_discovery_failed' };
      }

      if (!Array.isArray(threads)) {
        runLogger.warn(`⚠️ Discovery thread non valida (tipo=${typeof threads}). Applico fallback sicuro a lista vuota.`);
        threads = [];
      }

      if (threads.length === 0) {
        const emptyStreak = this._trackEmptyInboxStreak(true);
        runLogger.info('Nessuna email da elaborare.');

        if (emptyStreak >= this.config.emptyInboxWarningThreshold &&
            (emptyStreak === this.config.emptyInboxWarningThreshold || emptyStreak % 50 === 0)) {
          runLogger.warn(`Inbox vuota da ${emptyStreak} esecuzioni consecutive. Verificare filtri Gmail/trigger in ingresso.`);
        }

        this._clearBatchCheckpoint_('coda vuota');
        return { total: 0, replied: 0, filtered: 0, errors: 0, emptyStreak: emptyStreak };
      }

      this._trackEmptyInboxStreak(false);
      runLogger.info(`Trovati ${threads.length} thread da elaborare`);

      let labeledMessageIds = new Set();
      if (this.gmailService && typeof this.gmailService.getMessageIdsWithLabel === 'function') {
        try {
          labeledMessageIds = this.gmailService.getMessageIdsWithLabel(this.config.labelName, true, { onlyUnread: true });
        } catch (e) {
          runLogger.error(`Impossibile pre-caricare gli ID etichettati (${e.message}). Interrompo il batch per evitare risposte duplicate.`);
          return { total: 0, replied: 0, filtered: 0, errors: 1, skipped: 0, reason: 'label_cache_failed' };
        }
      } else {
        runLogger.warn('gmailService.getMessageIdsWithLabel non disponibile: continuo senza cache label pre-caricata.');
      }

      if (!(labeledMessageIds instanceof Set)) {
        if (Array.isArray(labeledMessageIds)) {
          labeledMessageIds = new Set(labeledMessageIds);
        } else {
          labeledMessageIds = new Set();
        }
      }

      // Include anche i messaggi unread già marcati come Errore/Verifica:
      // evitiamo retry infiniti del singolo messaggio, ma senza oscurare l'intero thread.
      if (this.gmailService && typeof this.gmailService.getMessageIdsWithLabel === 'function') {
        try {
          const errorIds = this.gmailService.getMessageIdsWithLabel(this.config.errorLabelName, true, { onlyUnread: true });
          const validationIds = this.gmailService.getMessageIdsWithLabel(this.config.validationErrorLabel, true, { onlyUnread: true });
          (errorIds || []).forEach((id) => labeledMessageIds.add(id));
          (validationIds || []).forEach((id) => labeledMessageIds.add(id));
        } catch (e) {
          runLogger.warn(`Impossibile pre-caricare ID error/validation (${e.message}). Continuo con sola cache IA.`);
        }
      }

      // Pre-caricamento degli ID dei messaggi con etichetta skip (·)
      // per evitare ri-discovery di thread già valutati in foreign_only.
      let skippedMessageIds = new Set();
      if (languageMode === 'foreign_only' && this.gmailService && typeof this.gmailService.getMessageIdsWithLabel === 'function') {
        try {
          const skipIds = this.gmailService.getMessageIdsWithLabel(this.config.skipLabelName, true, { onlyUnread: true });
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
          deferBatchCheckpoint(threads, index, this._getRemainingTimeMs(MAX_EXECUTION_TIME));
          break;
        }

        const thread = threads[index];

        const remainingTimeMs = this._getRemainingTimeMs(MAX_EXECUTION_TIME);
        if (remainingTimeMs < this.config.minRemainingTimeMs || this._isNearDeadline(MAX_EXECUTION_TIME)) {
          console.warn(`⏳ Tempo insufficiente per un nuovo thread (${Math.round(remainingTimeMs / 1000)}s restanti). Stop preventivo.`);
          deferBatchCheckpoint(threads, index, remainingTimeMs);
          break;
        }

        if (!this._hasUnreadMessagesToProcess(thread, labeledMessageIds, skippedMessageIds)) {
          runLogger.info(`Thread ${index + 1}/${threads.length} - Skip: già etichettato IA`);
          stats.total++;
          stats.skipped++;
          stats.skipped_processed++;
          continue;
        }

        runLogger.info(`Thread ${index + 1}/${threads.length}`);

        // Se abbiamo già acquisito il lock batch in questa funzione (o il chiamante
        // dichiara lock già coperti), evitiamo una seconda acquisizione in processThread.
        const threadLockAlreadyCovered = Boolean(locksAlreadyCovered || lockAcquiredHere);
        const result = this.processThread(
          thread,
          normalizedKnowledgeBase,
          normalizedDoctrineBase,
          labeledMessageIds,
          threadLockAlreadyCovered,
          skippedMessageIds,
          { ...options, logger: runLogger }
        );
        stats.total++;

        if (result && result.error && String(result.error).includes('GMAIL_DAILY_CALL_LIMIT_REACHED')) {
          runLogger.warn('⚠️ Stop batch: limite giornaliero chiamate Gmail raggiunto durante processThread.');
          // -1: checkpoint senza trigger (quota Gmail giornaliera, riprova domani)
          deferBatchCheckpoint(threads, index, -1);
          break;
        }

        if (
          result &&
          (
            result.errorClass === 'QUOTA_EXCEEDED' ||
            result.errorClass === 'QUOTA_EXHAUSTED' ||
            String(result.error || '').includes('QUOTA_EXHAUSTED')
          )
        ) {
          runLogger.warn('⚠️ Stop batch: quota API LLM esaurita, salvo checkpoint per evitare cascata di error label.');
          deferBatchCheckpoint(
            threads,
            index,
            this._getQuotaCheckpointDelayMs_(result, remainingTimeMs)
          );
          break;
        }

        if (result && (result.errorClass === 'NETWORK' || result.errorClass === 'TIMEOUT')) {
          runLogger.warn('⚠️ Stop batch: errore infrastrutturale retryable, salvo checkpoint per riprovare senza moltiplicare i fallimenti.');
          deferBatchCheckpoint(
            threads,
            index,
            this._getRemainingTimeMs(MAX_EXECUTION_TIME)
          );
          break;
        }

        if (result && (result.errorClass === 'SYSTEM_ERROR' || result.errorClass === 'CONFIG_ERROR' || result.errorClass === 'INVALID_API_KEY')) {
          runLogger.warn('⚠️ Stop batch: errore di sistema/configurazione, salvo checkpoint per evitare cascata di error label.');
          deferBatchCheckpoint(
            threads,
            index,
            this._getRemainingTimeMs(MAX_EXECUTION_TIME)
          );
          break;
        }

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
      runLogger.info('RIEPILOGO ELABORAZIONE', {
        total: stats.total,
        replied: stats.replied,
        filtered: stats.filtered,
        errors: stats.errors,
        duration: Date.now() - this._startTime
      });

      if (!deferredBatchCheckpoint) {
        this._clearBatchCheckpoint_('batch completato');
      }

      return stats;

    } finally {
      restoreRunServiceLoggers();
      if (lockAcquiredHere) {
        try {
          executionLock.releaseLock();
          runLogger.info('Lock esecuzione batch rilasciato');
        } catch (e) {
          console.warn(`⚠️ Errore rilascio execution lock: ${e.message}`);
        }
      }
      if (deferredBatchCheckpoint) {
        this._storeBatchCheckpointAndScheduleContinuation_(
          deferredBatchCheckpoint.threads,
          deferredBatchCheckpoint.startIndex,
          deferredBatchCheckpoint.remainingTimeMs
        );
      }
    }
  }

  _clearBatchCheckpoint_(reason) {
    try {
      const props = (typeof PropertiesService !== 'undefined' &&
        PropertiesService &&
        typeof PropertiesService.getScriptProperties === 'function')
        ? PropertiesService.getScriptProperties()
        : null;
      if (props && typeof props.deleteProperty === 'function') {
        props.deleteProperty('EMAIL_BATCH_CHECKPOINT');
        console.log(`🧹 Checkpoint batch ripulito (${reason || 'batch completato'}).`);
      }
    } catch (e) {
      console.warn(`⚠️ Errore pulizia checkpoint batch: ${e.message}`);
    }
  }

  _getQuotaCheckpointDelayMs_(result, remainingTimeMs) {
    const raw = [
      result && result.errorClass,
      result && result.error,
      result && result.reason
    ].filter(Boolean).join(' ').toLowerCase();

    const looksDailyQuota =
      raw.includes('daily') ||
      raw.includes('giornal') ||
      raw.includes('rpd');

    if (looksDailyQuota) {
      return -1;
    }

    const remaining = Number(remainingTimeMs);
    if (Number.isFinite(remaining) && remaining > 0) {
      return Math.max(60000, remaining);
    }

    // Quota non chiaramente giornaliera: pianifica una ripresa breve invece di
    // lasciare il checkpoint sospeso fino al prossimo trigger ordinario.
    return 60000;
  }

  _storeBatchCheckpointAndScheduleContinuation_(threads, startIndex, delayMs) {
    try {
      const props = (typeof PropertiesService !== 'undefined' &&
        PropertiesService &&
        typeof PropertiesService.getScriptProperties === 'function')
        ? PropertiesService.getScriptProperties()
        : null;
      if (!props || typeof props.setProperty !== 'function') {
        console.error('❌ PropertiesService non disponibile: checkpoint non salvabile, trigger NON schedulato.');
        return;
      }
      let currentDepth = 0;
      let previousCheckpoint = null;
      try {
        previousCheckpoint = JSON.parse(props.getProperty('EMAIL_BATCH_CHECKPOINT') || '{}');
        currentDepth = (previousCheckpoint && previousCheckpoint.depth) ? previousCheckpoint.depth : 0;
      } catch (_) {
        previousCheckpoint = null;
        currentDepth = 0;
      }

      // PropertiesService ha un limite dimensionale per valore: manteniamo margine
      // conservativo per evitare "Argument too large" in checkpoint voluminosi.
      const maxCheckpointThreads = (typeof CONFIG !== 'undefined' && Number(CONFIG.BATCH_CHECKPOINT_MAX_THREADS) > 0)
        ? Math.min(Math.max(1, Number(CONFIG.BATCH_CHECKPOINT_MAX_THREADS)), 150)
        : 150;
      const pendingThreadIds = (threads || [])
        .slice(startIndex)
        .map((thread) => {
          try { return thread && typeof thread.getId === 'function' ? thread.getId() : null; } catch (_) { return null; }
        })
        .filter(Boolean);

      const storedPendingThreadIds = pendingThreadIds.slice(0, maxCheckpointThreads);
      const previousPendingThreadIds = previousCheckpoint && Array.isArray(previousCheckpoint.pendingThreadIds)
        ? previousCheckpoint.pendingThreadIds
        : [];
      const isSameCheckpoint = storedPendingThreadIds.length === previousPendingThreadIds.length &&
        storedPendingThreadIds.every((id, idx) => id === previousPendingThreadIds[idx]);
      const previousRetryCount = Number(previousCheckpoint && previousCheckpoint.retryCount);
      const retryCount = isSameCheckpoint && Number.isFinite(previousRetryCount)
        ? previousRetryCount + 1
        : 1;
      // `depth` misura solo le riprese bloccate sullo stesso identico insieme di
      // thread pendenti. Se il checkpoint cambia, il batch sta avanzando e la
      // guardia anti-loop deve ripartire per non scartare code sane ma lunghe.
      const nextDepth = isSameCheckpoint ? currentDepth + 1 : 1;

      if (nextDepth > 5) {
        console.error('Limite massimo di continuazioni batch (5) raggiunto sullo stesso checkpoint. Interruzione per prevenire loop di trigger.');
        if (typeof props.deleteProperty === 'function') {
          props.deleteProperty('EMAIL_BATCH_CHECKPOINT');
        }
        return;
      }

      const checkpoint = {
        version: 2,
        runId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        startIndex: startIndex,
        remainingTimeMs: delayMs,
        pendingCount: pendingThreadIds.length,
        pendingThreadIds: storedPendingThreadIds,
        depth: nextDepth,
        retryCount: retryCount
      };
      props.setProperty('EMAIL_BATCH_CHECKPOINT', JSON.stringify(checkpoint));

      const canManageTriggers = (typeof ScriptApp !== 'undefined' &&
        ScriptApp &&
        typeof ScriptApp.getProjectTriggers === 'function' &&
        typeof ScriptApp.deleteTrigger === 'function' &&
        typeof ScriptApp.newTrigger === 'function');

      if (canManageTriggers) {
        const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'resumeEmailBatchFromCheckpoint');

        if (delayMs === -1) {
          existing.forEach((trigger) => {
            try { ScriptApp.deleteTrigger(trigger); } catch (_) {}
          });
          const conservativeResumeMs = 18 * 60 * 60 * 1000;
          ScriptApp.newTrigger('resumeEmailBatchFromCheckpoint').timeBased().after(conservativeResumeMs).create();
          console.log(`⏸️ Checkpoint batch salvato (${checkpoint.pendingCount} thread residui), trigger pianificato tra ~18h (quota giornaliera Gmail esaurita).`);
        } else {
          try {
            const safeDelayMs = Number.isFinite(delayMs) && delayMs > 0
              ? Math.max(1000, Math.floor(delayMs))
              : (60 * 1000);
            ScriptApp.newTrigger('resumeEmailBatchFromCheckpoint').timeBased().after(safeDelayMs).create();
            // Non eliminiamo trigger preesistenti qui per evitare race tra run concorrenti
            // che condividono l'handler ma possono avere checkpoint differenti.
            console.log(`⏭️ Checkpoint batch salvato (${checkpoint.pendingCount} thread residui), trigger pianificato tra ${(safeDelayMs / 1000).toFixed(0)}s.`);
          } catch (triggerError) {
            console.error(`❌ Impossibile creare trigger di ripresa batch; trigger preesistenti preservati: ${triggerError.message}`);
          }
        }
      }
    } catch (e) {
      console.warn(`⚠️ Salvataggio checkpoint batch fallito: ${e.message}`);
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

    const atIndex = email.lastIndexOf('@');
    const localPart = atIndex >= 0 ? email.substring(0, atIndex) : email;
    const senderDomain = atIndex >= 0 ? email.substring(atIndex + 1) : '';

    if (ignoreDomains.some(domain => {
      const blacklistDomain = domain.startsWith('@') ? domain.substring(1) : domain;
      const isExactMatch = email === domain;
      const isDomainMatch = (domain.startsWith('@') || !domain.includes('@')) && senderDomain === blacklistDomain;
      const isSubdomainMatch = !domain.startsWith('@') && !domain.includes('@') &&
        senderDomain.endsWith('.' + blacklistDomain);
      return isExactMatch || isDomainMatch || isSubdomainMatch;
    })) {
      console.log(`🚫 Ignorato: mittente in blacklist (${email})`);
      return true;
    }

    // Match username ristretto a pattern bot/notifica espliciti per evitare falsi positivi
    // su username legittimi (es. marketing@..., info@...).
    const BOT_USERNAMES = new Set(['noreply', 'no-reply', 'donotreply', 'mailer-daemon',
      'postmaster', 'bounce', 'notifications', 'newsletter', 'promo',
      'ads', 'bot', 'crm']);
    if (BOT_USERNAMES.has(localPart)) {
      console.log(`🚫 Ignorato: username di sistema/bot rilevato (${email})`);
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

  _shouldTryOcr(body, subject, hasAttachments = false) {
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

    // Fallback robusto: se il testo suggerisce un documento "atteso",
    // abilitiamo OCR anche quando le keyword configurate non coprono il caso.
    const expectedDocType = this._detectDocumentTypeFromText_(`${normalizedSubject} ${normalizedBody}`);
    if (expectedDocType && expectedDocType !== 'unknown' && hasAttachments) {
      console.log(`   📎 OCR fallback attivo: documento atteso rilevato (${expectedDocType})`);
      return true;
    }

    const hasEmailText = Boolean(normalizedBody.trim() || normalizedSubject.trim());
    if (!hasEmailText && hasAttachments) {
      console.log('   📎 OCR fallback attivo: email senza testo ma con allegati');
      return true;
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
    const startedKey = `sendstarted_${messageId}`;
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
        if (lockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
          try { scriptLock.releaseLock(); } catch (_) { }
        }
        return { ok: false, reason: 'already_sent' };
      }
      if (cache.get(sendingKey)) {
        if (lockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
          try { scriptLock.releaseLock(); } catch (_) { }
        }
        return { ok: false, reason: 'in_flight' };
      }
      if (cache.get(startedKey)) {
        if (lockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
          try { scriptLock.releaseLock(); } catch (_) { }
        }
        return { ok: false, reason: 'send_recently_started' };
      }

      const nowTs = String(Date.now());
      cache.put(sendingKey, nowTs, 300); // 5 minuti
      cache.put(startedKey, nowTs, 900); // 15 minuti: finestra anti-duplicato per errori ambigui
      if (lockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
        try { scriptLock.releaseLock(); } catch (_) { }
      }
      return { ok: true, reason: 'acquired', lock: null };
    } catch (e) {
      if (lockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
        try { scriptLock.releaseLock(); } catch (_) { }
      }
      throw e;
    }
  }

  _commitSendTransaction(messageId, sendTxn = null) {
    if (!messageId) return;
    const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
      ? CacheService.getScriptCache()
      : null;
    if (!cache) return;

    try {
      cache.put(`sent_${messageId}`, String(Date.now()), 21599);
      cache.remove(`sending_${messageId}`);
      cache.remove(`sendstarted_${messageId}`);
    } catch (e) {
      console.warn(`  Impossibile committare la transazione in cache per ${messageId}: ${e.message}`);
    } finally {
      if (sendTxn && sendTxn.lock && typeof sendTxn.lock.releaseLock === 'function') {
        sendTxn.lock.releaseLock();
      }
    }
  }

  _rollbackSendTransaction(messageId, sendTxn = null) {
    if (!messageId) return;
    const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
      ? CacheService.getScriptCache()
      : null;
    if (!cache) return;
    try {
      cache.remove(`sending_${messageId}`);
      // Non rimuovere sendstarted_: se l'invio ha avuto esito ambiguo,
      // preserviamo una finestra breve anti-duplicato.
    } catch (e) {
      console.warn(`  Impossibile eseguire il rollback della transazione in cache per ${messageId}: ${e.message}`);
    } finally {
      if (sendTxn && sendTxn.lock && typeof sendTxn.lock.releaseLock === 'function') {
        sendTxn.lock.releaseLock();
      }
    }
  }

  _getBusinessTimeString(date = new Date()) {
    const safeDateInput = date || Date.now();
    const parsedDate = new Date(safeDateInput);
    if (isNaN(parsedDate.getTime())) return '12:00';

    if (typeof Utilities !== 'undefined' && Utilities &&
        typeof Utilities.formatDate === 'function') {
      try {
        const tz = (typeof Session !== 'undefined' && Session &&
                    typeof Session.getScriptTimeZone === 'function')
          ? Session.getScriptTimeZone()
          : 'Europe/Rome';
        return Utilities.formatDate(parsedDate, tz, 'HH:mm');
      } catch (_) {
        // Fallback sotto
      }
    }

    try {
      return new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(parsedDate);
    } catch (_) {
      const h = String(parsedDate.getHours()).padStart(2, '0');
      const m = String(parsedDate.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    }
  }

  _getBusinessDateString(date = new Date()) {
    const safeDateInput = date || Date.now();
    const parsedDate = new Date(safeDateInput);
    if (isNaN(parsedDate.getTime())) return new Date().toISOString().split('T')[0];

    if (typeof Utilities !== 'undefined' && Utilities &&
        typeof Utilities.formatDate === 'function') {
      try {
        const tz = (typeof Session !== 'undefined' && Session &&
                    typeof Session.getScriptTimeZone === 'function')
          ? Session.getScriptTimeZone()
          : 'Europe/Rome';
        return Utilities.formatDate(parsedDate, tz, 'yyyy-MM-dd');
      } catch (_) {
        // Fallback sotto
      }
    }

    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(parsedDate);
    } catch (_) {
      // Fallback minimale quando Intl/timeZone non è disponibile.
      return parsedDate.toISOString().split('T')[0];
    }
  }

  _getCurrentSeason() {
    let month;
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      month = parseInt(Utilities.formatDate(new Date(), 'Europe/Rome', 'M'), 10);
    } else {
      month = new Date().getMonth() + 1;
    }
    if (month >= 3 && month <= 5) return 'primaverile';
    if (month >= 6 && month <= 9) return 'estivo';
    if (month >= 10 && month <= 11) return 'autunnale';
    return 'invernale';
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



  _markMessageAsProcessed(message, labeledMessageIds = null, skippedMessageIds = null) {
    // Nota di manutenzione: IA viene applicata a livello *messaggio* (non thread)
    // e non marca il messaggio come letto. Così il segretario continua a vedere i
    // non letti in Gmail, mentre il sistema sa che quel singolo messaggio è già gestito.
    const messageId = message.getId();

    // Se siamo ancora in modalità "Solo straniere", un messaggio già marcato con
    // punto medio ('·') resta in attesa: verrà promosso a IA solo quando si torna
    // a "Tutte le lingue" e viene effettivamente lavorato.
    if (this._shouldBlockPromotionToIAInForeignOnly_(messageId, skippedMessageIds)) {
      console.log(`   ⛔ Preservata label '${this.config.skipLabelName}' su ${messageId} (foreign_only): non promuovo a IA`);
      return;
    }

    if (labeledMessageIds && labeledMessageIds.has(messageId)) {
      return; // Previene doppia chiamata API sullo stesso messaggio
    }

    this.gmailService.addLabelToMessage(messageId, this.config.labelName);
    if (this.gmailService && typeof this.gmailService.removeLabelFromMessage === 'function') {
      // Best-effort cleanup: no-op se il messaggio non ha la label skip.
      this.gmailService.removeLabelFromMessage(messageId, this.config.skipLabelName);
      if (skippedMessageIds && skippedMessageIds.has(messageId)) {
        console.log(`   ♻️ Promozione da '${this.config.skipLabelName}' a '${this.config.labelName}' per ${messageId}`);
      }
    }
    if (labeledMessageIds && typeof labeledMessageIds.add === 'function') {
      labeledMessageIds.add(messageId);
    }
  }

  _shouldBlockPromotionToIAInForeignOnly_(messageId, skippedMessageIds = null) {
    if (this._getLanguageProcessingMode_() !== 'foreign_only') return false;
    if (skippedMessageIds instanceof Set && skippedMessageIds.has(messageId)) return true;
    return this._shouldPreserveSkipLabelInForeignOnly_(messageId);
  }

  _shouldPreserveSkipLabelInForeignOnly_(messageId) {
    if (this._getLanguageProcessingMode_() !== 'foreign_only') return false;
    if (!messageId || !this.gmailService) return false;
    if (typeof this.gmailService._getOptionalLabelIdByName !== 'function') return false;
    if (typeof this.gmailService._getMessageMetadataWithResilience !== 'function') return false;

    const skipLabelId = this.gmailService._getOptionalLabelIdByName(this.config.skipLabelName);
    // Fail-closed architetturale: se non recuperiamo l'ID label (quota/API/errore),
    // preserviamo lo stato skip per evitare promozioni accidentali.
    if (!skipLabelId) return true;

    const metadata = this.gmailService._getMessageMetadataWithResilience(messageId, { format: 'minimal' }, 1);

    // Fail-closed: in caso di errore/risposta non valida preserviamo lo stato skip.
    // Evita promozioni accidentali a IA dovute a guasti transitori Gmail API.
    if (!metadata || !Array.isArray(metadata.labelIds)) return true;

    return metadata.labelIds.includes(skipLabelId);
  }

  // Tracciamento ID saltati per ottimizzare il batch.
  _markMessagesAsSkipped(messages, labelName = this.config.skipLabelName, skippedMessageIds = null) {
    if (this.config.dryRun) {
      this.logger.info(`   🔴 DRY RUN - Label skip '${labelName}' non aggiunta (simulazione)`);
      (messages || []).forEach(message => {
        if (!message) return;
        const msgId = message.getId();
        if (skippedMessageIds && typeof skippedMessageIds.add === 'function') {
          skippedMessageIds.add(msgId);
        }
      });
      return;
    }

    if (!this.gmailService || typeof this.gmailService.addLabelToMessage !== 'function') return;

    // Stringa vuota = disabilitazione consapevole del labeling skip (falsy); null/undefined = guard difensivo.
    if (labelName) {
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

      const fetchLabeledIds = () => {
        if (!this.gmailService || typeof this.gmailService.getMessageIdsWithLabel !== 'function') {
          return new Set();
        }
        const terminalLabelNames = [
          this.config.labelName,
          this.config.errorLabelName,
          this.config.validationErrorLabel
        ].filter(Boolean);
        const fetchedIds = new Set();
        terminalLabelNames.forEach(labelName => {
          const ids = this.gmailService.getMessageIdsWithLabel(labelName, true, { onlyUnread: true });
          if (ids instanceof Set) {
            ids.forEach(id => fetchedIds.add(id));
          } else {
            (ids || []).forEach(id => fetchedIds.add(id));
          }
        });
        return fetchedIds;
      };
      const effectiveLabeledIds = (labeledMessageIds instanceof Set)
        ? labeledMessageIds
        : fetchLabeledIds();

      const mode = this._getLanguageProcessingMode_();
      const effectiveSkippedIds = (mode === 'foreign_only' && skippedMessageIds instanceof Set)
        ? skippedMessageIds
        : new Set();

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
    if (typeof value === 'object') {
      try {
        const cache = new Set();
        return JSON.stringify(value, (key, val) => {
          if (typeof val === 'object' && val !== null) {
            if (cache.has(val)) return '[Circular]';
            cache.add(val);
          }
          return val;
        }, 2);
      } catch (e) {
        return String(value).trim();
      }
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

  _extractEmailXmlBlock_(responseText) {
    const safeText = typeof responseText === 'string'
      ? responseText
      : (responseText == null ? '' : String(responseText));
    const match = safeText.match(/<email>\s*([\s\S]*?)\s*<\/email>/i);
    if (match && match[1]) {
      return match[1].trim();
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

  _addValidationErrorLabel(target, reviewContext = {}) {
    if (target && typeof target.getThread === 'function' && typeof target.getId === 'function') {
      this.gmailService.addLabelToMessage(target.getId(), this.config.validationErrorLabel);
      this._notifyValidationReview_(target, reviewContext);
      return;
    }
    this.gmailService.addLabelToThread(target, this.config.validationErrorLabel);
    this._notifyValidationReview_(target, reviewContext);
  }

  _notifyValidationReview_(target, reviewContext = {}) {
    try {
      const alertConfig = this.config.validationReviewAlerts || {};
      if (alertConfig.enabled === false) return;

      const recipient = this._getValidationReviewRecipient_(alertConfig);
      if (!recipient) return;

      const targetInfo = this._getValidationReviewTargetInfo_(target);
      const validation = reviewContext.validation || {};
      const reason = reviewContext.reason || 'validation_review';
      const score = Number.isFinite(Number(validation.score)) ? Number(validation.score).toFixed(2) : 'n/d';
      const warnings = Array.isArray(validation.warnings) ? validation.warnings : [];
      const errors = Array.isArray(validation.errors) ? validation.errors : [];
      const subjectText = String(reviewContext.subject || targetInfo.subject || '(senza oggetto)')
        .replace(/[\r\n]+/g, ' ')
        .trim();
      const signature = [
        reason,
        targetInfo.messageId || '',
        targetInfo.threadId || '',
        subjectText
      ].join('|');

      const canSendWithMailApp = typeof MailApp !== 'undefined' && MailApp && typeof MailApp.sendEmail === 'function';
      const canSendWithGmailApp = typeof GmailApp !== 'undefined' && GmailApp && typeof GmailApp.sendEmail === 'function';
      if (!canSendWithMailApp && !canSendWithGmailApp) return;
      if (this._isValidationReviewAlertThrottled_(signature, alertConfig)) return;

      const subject = `[${this.config.validationErrorLabel}] Revisione richiesta: ${subjectText}`.substring(0, 180);
      const gmailLink = targetInfo.threadId
        ? `https://mail.google.com/mail/u/0/#inbox/${targetInfo.threadId}`
        : '';
      const body = [
        'Una risposta automatica richiede verifica umana.',
        '',
        `Motivo: ${reason}`,
        `Punteggio validazione: ${score}`,
        `Oggetto: ${subjectText}`,
        targetInfo.threadId ? `Thread ID: ${targetInfo.threadId}` : '',
        targetInfo.messageId ? `Message ID: ${targetInfo.messageId}` : '',
        gmailLink ? `Link Gmail: ${gmailLink}` : '',
        warnings.length ? `Warning: ${warnings.join('; ')}` : '',
        errors.length ? `Errori: ${errors.join('; ')}` : ''
      ].filter(Boolean).join('\n');

      if (canSendWithMailApp) {
        MailApp.sendEmail(recipient, subject, body);
      } else if (canSendWithGmailApp) {
        GmailApp.sendEmail(recipient, subject, body);
      }
    } catch (e) {
      console.warn(`⚠️ Notifica Verifica non inviata: ${e.message}`);
    }
  }

  _getValidationReviewRecipient_(alertConfig) {
    const propKey = alertConfig.recipientProperty || 'VALIDATION_REVIEW_EMAIL';
    let propertyEmail = '';
    try {
      propertyEmail = (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function')
        ? PropertiesService.getScriptProperties().getProperty(propKey)
        : '';
    } catch (e) {
      propertyEmail = '';
    }

    const configEmail = alertConfig.email || '';
    const adminEmail = (typeof CONFIG !== 'undefined' && CONFIG.LOGGING && CONFIG.LOGGING.ADMIN_EMAIL)
      ? CONFIG.LOGGING.ADMIN_EMAIL
      : '';

    // Priorità:
    // 1. GLOBAL_CACHE (letto da cella A19 del foglio Controllo)
    // 2. Proprietà dello script (override dinamico)
    // 3. Configurazione statica VALIDATION_REVIEW_ALERTS.email
    // 4. Configurazione statica LOGGING.ADMIN_EMAIL
    const cacheEmail = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE) ? GLOBAL_CACHE.validationReviewEmail : '';
    const candidate = String(cacheEmail || propertyEmail || configEmail || adminEmail || '').trim();

    if (!candidate || candidate.includes('[') || candidate.includes('YOUR_')) return '';
    return candidate;
  }

  _getValidationReviewTargetInfo_(target) {
    const info = { messageId: '', threadId: '', subject: '' };
    try {
      if (target && typeof target.getThread === 'function') {
        info.messageId = typeof target.getId === 'function' ? target.getId() : '';
        const thread = target.getThread();
        info.threadId = thread && typeof thread.getId === 'function' ? thread.getId() : '';
        info.subject = typeof target.getSubject === 'function' ? target.getSubject() : '';
      } else if (target && typeof target.getId === 'function') {
        info.threadId = target.getId();
        info.subject = typeof target.getFirstMessageSubject === 'function' ? target.getFirstMessageSubject() : '';
      }
    } catch (e) {
      return info;
    }
    return info;
  }

  _isValidationReviewAlertThrottled_(signature, alertConfig) {
    const cooldownSeconds = Math.max(60, parseInt(alertConfig.cooldownSeconds, 10) || 3600);
    const hash = this._hashValidationReviewSignature_(signature);
    const key = `validation_review_alert_${hash}`;
    const now = Date.now();

    try {
      const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
        ? CacheService.getScriptCache()
        : null;
      if (cache && cache.get(key)) return true;
      if (cache) cache.put(key, 'sent', Math.min(cooldownSeconds, 21600));
    } catch (e) {
      // Il fallback su PropertiesService copre anche evizioni/cache non disponibili.
    }

    try {
      const props = (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function')
        ? PropertiesService.getScriptProperties()
        : null;
      if (!props) return false;
      const stateKey = 'VALIDATION_REVIEW_ALERT_STATE';
      let state = {};
      try {
        state = JSON.parse(props.getProperty(stateKey) || '{}');
      } catch (e) {
        state = {};
      }
      const lastTs = Number(state[hash]);
      if (Number.isFinite(lastTs) && ((now - lastTs) < cooldownSeconds * 1000)) {
        return true;
      }
      const nextState = { [hash]: now };
      Object.keys(state).forEach((existingHash) => {
        const ts = Number(state[existingHash]);
        if (Number.isFinite(ts) && ((now - ts) < cooldownSeconds * 1000)) {
          nextState[existingHash] = ts;
        }
      });
      props.setProperty(stateKey, JSON.stringify(nextState));
    } catch (e) {
      return false;
    }

    return false;
  }

  _hashValidationReviewSignature_(signature) {
    try {
      if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.computeDigest === 'function') {
        return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, signature)).substring(0, 16);
      }
    } catch (e) {
      // fallback deterministico sotto.
    }
    let hash = 0;
    const source = String(signature || '');
    for (let i = 0; i < source.length; i++) {
      hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
    }
    return String(Math.abs(hash));
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
    const temporalErrors = (details.temporalConsistency && Array.isArray(details.temporalConsistency.errors))
      ? details.temporalConsistency.errors
      : [];
    const hasTemporal = temporalErrors.length > 0 || errorText.some(e => e.includes('incoerenza temporale'));

    return {
      thinking_leak: hasThinkingLeak,
      hallucination: hasHallucination,
      language: hasLanguage,
      placeholder: hasPlaceholder,
      length: hasLength,
      temporal: hasTemporal,
      lengthErrors: lengthErrors,
      temporalErrors: temporalErrors,
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
      : ['thinking_leak', 'hallucination', 'language', 'placeholder', 'length', 'temporal'];

    const hasAllowed = allowed.some(key => flags[key]);
    if (!hasAllowed) return false;

    const minScore = (typeof cfg.minScoreToTrigger === 'number')
      ? cfg.minScoreToTrigger
      : ((typeof CONFIG !== 'undefined' && typeof CONFIG.VALIDATION_MIN_SCORE === 'number') ? CONFIG.VALIDATION_MIN_SCORE : 0.6);

    const critical = flags.thinking_leak || flags.hallucination || flags.temporal;
    


    // Per errori non critici, evita retry quando il punteggio è sotto soglia configurata.
    if (!critical && Number.isFinite(validationResult.score) && validationResult.score < minScore) {
      return false;
    }

    return true;
  }

  /**
   * Costruisce un prompt correttivo "chirurgico" basato sugli errori di validazione.
   */
  _buildCorrectionPrompt(originalPrompt, failedResponse, validationResult, language, salutationMode) {
    const safePrompt = this._normalizePromptForRetry_(originalPrompt);
    const safeResponse = typeof failedResponse === 'string' ? failedResponse : (failedResponse == null ? '' : String(failedResponse));
    const details = validationResult && validationResult.details ? validationResult.details : {};
    const flags = this._classifyValidationForRetry(validationResult, language);

    const correctionInstructions = [];
    const langNames = { it: 'italiano', en: 'inglese', es: 'spagnolo', fr: 'francese', de: 'tedesco', pt: 'portoghese' };
    const shouldIncludeSignature = salutationMode !== 'none_or_continuity' && salutationMode !== 'session';

    if (flags.thinking_leak) {
      correctionInstructions.push(
        'ERRORE CRITICO: Hai incluso il tuo ragionamento interno o fatto riferimento alle tue fonti nella risposta.\n' +
        'CORREZIONE: Scrivi SOLO la risposta finale. Non usare frasi come "noto che", "devo correggere", ' +
        '"le istruzioni dicono", "nella nostra base dati", "nella conoscenza di base". Se ti manca un dato, scrivi solo "Non abbiamo informazioni in proposito".'
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

    if (flags.temporal) {
      correctionInstructions.push(
        'ERRORE CRITICO: Hai qualificato temporalmente in modo errato un evento, corso o celebrazione.\n' +
        'CORREZIONE: Confronta ogni data esplicita con la DATA ODIERNA presente nel prompt: se la data è futura, presentala come programmata o futura; se è passata, presentala come già avvenuta; se non è chiara, non dedurre che sia conclusa.'
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
    // Riserva spazio per il blocco di rifinitura testuale + risposta precedente (stima conservativa it: ~3.6 char/token).
    const correctionBlockPreview =
      `\n\nCORREZIONE RICHIESTA\n${correctionInstructions.join('\n\n')}\n${failedSnippet}`;
    const reservedTokens = 2500 + Math.ceil(correctionBlockPreview.length / 4);
    const CHARS_PER_TOKEN_IT = 3.6;
    const maxPromptChars = Math.max(2000, Math.floor((maxSafeTokens - reservedTokens) * CHARS_PER_TOKEN_IT));
    const promptForRetry = this._trimPromptForRetry_(safePrompt, maxPromptChars);

    return `### ISTRUZIONI DI BASE ###
${promptForRetry}

### ATTENZIONE: CORREZIONE CRITICA RICHIESTA ###
La tua generazione precedente conteneva errori che DEVI correggere:
- ${correctionInstructions.join('\n- ')}

### RISPOSTA FALLITA (NON RIPETERE QUESTI ERRORI) ###
${failedSnippet}

### AZIONE ###
Genera la nuova risposta correggendo i problemi indicati.
Rispondi SOLO con il testo della nuova email, senza spiegazioni o commenti.`;
  }

  _trimPromptForRetry_(prompt, maxChars) {
    if (typeof prompt !== 'string') return '';
    if (!Number.isFinite(maxChars) || maxChars <= 0 || prompt.length <= maxChars) {
      return prompt;
    }

    // Evita splice testa+coda: concatenare due metà può corrompere JSON/XML interni.
    // Preferiamo mantenere solo l'inizio del prompt (istruzioni sistemiche) e troncare
    // in coda con marker, allineando il più possibile a boundary di riga/sezione.
    const marker = '\n\n[...PROMPT ORIGINALE TRONCATO PER RETRY...]';
    const budget = Math.max(0, maxChars - marker.length);
    let head = prompt.slice(0, budget);

    // Allinea il taglio a un boundary strutturale vicino alla fine del budget.
    const sectionBoundary = head.lastIndexOf('\n### ');
    const lineBoundary = head.lastIndexOf('\n');
    if (sectionBoundary > Math.floor(head.length * 0.6)) {
      head = head.slice(0, sectionBoundary);
    } else if (lineBoundary > Math.floor(head.length * 0.6)) {
      head = head.slice(0, lineBoundary);
    }

    return `${head}${marker}`;
  }

  _normalizePromptForRetry_(prompt) {
    if (typeof prompt === 'string') return prompt;
    if (prompt && typeof prompt === 'object') {
      const parts = [];
      if (prompt.systemInstruction) {
        parts.push(`### ISTRUZIONI DI SISTEMA ###\n${String(prompt.systemInstruction)}`);
      }
      if (prompt.prompt) {
        parts.push(`### DATI E CONTESTO UTENTE ###\n${String(prompt.prompt)}`);
      }
      if (parts.length > 0) return parts.join('\n\n');
    }
    return prompt == null ? '' : String(prompt);
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

    // Confronto semantico: controlla il testo privo di data per evitare duplicati giornalieri.
    const cleanBullet = summarySentence ? summarySentence.trim().toLowerCase() : '';
    const isDuplicate = cleanBullet && summaryLines.some(
      line => line.replace(/^•?\s*\[\d{4}-\d{2}-\d{2}\]\s*/, '').trim().toLowerCase() === cleanBullet
    );
    if (summarySentence && !isDuplicate) {
      const newBullet = `• [${this._getBusinessDateString()}] ${summarySentence}`;
      summaryLines.push(newBullet);
    }

    const trimmedLines = summaryLines.slice(-maxBullets);
    let summary = trimmedLines.join('\n').trim();

    if (summary.length > maxChars) {
      // Tronca l'inizio (ricordi più vecchi) e preserva la coda più recente.
      const truncated = summary.slice(-maxChars);
      const firstBreak = truncated.indexOf('\n');
      const firstSpace = truncated.indexOf(' ');
      const cutIndex = firstBreak > 0 ? firstBreak : (firstSpace > 0 ? firstSpace : 0);
      summary = '...' + truncated.slice(cutIndex).trim();
    }

    return summary || null;
  }

  _isTerritoryRequest(subject, body, classification = {}, requestType = null) {
    const text = `${subject || ''} ${body || ''}`.toLowerCase();
    const topic = String(classification && classification.topic ? classification.topic : '').toLowerCase();
    if (topic.includes('territor') || topic.includes('parrocchia di residenza') || topic.includes('competenza parrocchiale')) return true;

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

    // Eliminata l'ancora di fine stringa ( |$ ) per numeri isolati: previene falsi positivi orari su cifre finali
    const matches = text.match(/\b(?:[01]?\d|2[0-3])(?:[:.][0-5]\d)\b|\b(?:[01]?\d|2[0-3])\b(?=\s*(?:ore\b|am\b|pm\b|:))/gi) || [];
    const normalized = matches.map((time) => {
      const parts = time.replace('.', ':').split(':');
      const hh = parts[0];
      const mm = parts[1] || '00';
      return `${hh.padStart(2, '0')}:${mm}`;
    });

    return Array.from(new Set(normalized));
  }

  _hasExplicitTimeExpectation(text) {
    if (!text || typeof text !== 'string') return false;

    const timeExpectationPatterns = [
      // Italiano
      /\bpensavo\b/i,
      /\bcredevo\b/i,
      /\bmi\s+era\s+stato\s+detto\b/i,
      /\bavevo\s+capito\b/i,
      /\bmi\s+risultava?\b/i,
      /\bsecondo\s+me\b/i,
      /\bmi\s+sembrava\b/i,
      /\bero\s+convint[oa]\b/i,
      /\bho\s+letto\b/i,
      /\b(?:fosse|era|sia|sarà|sarebbe|iniziasse|inizia|cominciasse|comincia)\s+(?:alle\s+)?(?:ore\s+)?(?:[01]?\d|2[0-3])[:.][0-5]\d\b/i,
      // English
      /\bi\s+thought\b/i,
      /\bi\s+(?:understood|assumed|believed|expected)\b/i,
      /\bi\s+was\s+told\b/i,
      /\b(?:was|were|would\s+be|starts?\s+at|begins?\s+at)\s+(?:at\s+)?(?:[01]?\d|2[0-3])[:\.][0-5]\d\b/i,
      // Español
      /\bpensaba\b/i,
      /\bcreía\b/i,
      /\bme\s+(?:habían?\s+dicho|dijeron|hab[íi]an?\s+informado)\b/i,
      /\bentend[íi]a\s+que\b/i,
      // Français
      /\bje\s+pensais\b/i,
      /\bje\s+croyais\b/i,
      /\bon\s+m['’]avait\s+dit\b/i,
      /\bj['’]avais\s+compris\b/i,
      // Português
      /\bpensava\b/i,
      /\bacreditava\b/i,
      /\bme\s+(?:disseram|tinham\s+dito|informaram)\b/i,
      // Deutsch
      /\bich\s+dachte\b/i,
      /\bich\s+glaubte\b/i,
      /\bman\s+hatte\s+mir\s+gesagt\b/i,
      /\bich\s+hatte\s+(?:verstanden|angenommen)\b/i
    ];

    return timeExpectationPatterns.some((pattern) => pattern.test(text));
  }

  _addTimeDiscrepancyNoteIfNeeded(response, messageDetails, detectedLanguage) {
    if (!response || typeof response !== 'string') return response;

    const sourceText = `${messageDetails && messageDetails.subject ? messageDetails.subject : ''} ${messageDetails && messageDetails.body ? messageDetails.body : ''}`.toLowerCase();
    const responseLower = response.toLowerCase();

    // Evita duplicazione note se già presente un chiarimento orario
    // (supporta varianti lessicali italiane e multilingua).
    const discrepancyNotePatterns = [
      // Italiano
      /orario\s+(?:diverso|differente)\s+(?:da|rispetto\s+a)\s+(?:quanto\s+)?(?:da\s+)?lei\s+indicato/i,
      /orario\s+(?:diverso|differente)\s+da\s+quello\s+indicato/i,
      /in\s+un\s+orario\s+differente\s+da\s+quanto/i,
      /orario\s+comunicato\s+[eè]['’]?\s+diverso/i,
      // English
      /meeting\s+will\s+take\s+place\s+at\s+a\s+different\s+time/i,
      /takes?\s+place\s+at\s+a\s+different\s+time\s+than\s+what\s+you/i,
      /note:\s+the\s+(?:meeting|event|course|class)\s+(?:starts?|begins?)\s+at\s+a\s+different/i,
      // Español
      /horario\s+diferente\s+(?:al|de\s+lo)\s+(?:indicado|que\s+usted\s+indicó)/i,
      // Français
      /heure\s+différente\s+(?:de\s+celle\s+)?que\s+vous\s+avez\s+indiquée/i,
      // Português
      /horário\s+diferente\s+do\s+(?:que\s+)?indicad/i,
      // Deutsch
      /anderen\s+(?:uhrzeit|zeit)\s+(?:als\s+)?(?:von\s+ihnen\s+)?angegeben/i
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

    const notes = {
      it: "\n\nNota: la informiamo che l'incontro si svolgerà in un orario diverso rispetto a quanto da Lei indicato.",
      en: "\n\nNote: please note that the meeting will take place at a different time than what you indicated.",
      es: "\n\nNota: le informamos que la reunión se llevará a cabo en un horario diferente al indicado por usted.",
      pt: "\n\nNota: informamos que a reunião terá lugar num horário diferente do indicato por si.",
      fr: "\n\nNote : nous vous informons que la réunion aura lieu à une heure différente de celle que vous avez indiquée.",
      de: "\n\nHinweis: Wir informieren Sie, dass das Treffen zu einer anderen Zeit stattfinden wird, als von Ihnen angegeben."
    };

    const lang = String(detectedLanguage || 'it').toLowerCase().split('-')[0];
    const footer = notes[lang] || notes.it;
    
    return `${response.trim()}${footer}`;
  }

  /**
   * Rileva topic forniti nella risposta (per anti-ripetizione memoria)
   */
  _detectProvidedTopics(response) {
    if (!response || typeof response !== 'string') return [];
    const topics = [];
    // Usiamo il flag /s (dotAll) affinché .* includa anche gli a capo (\n)

    const patterns = {
      'orari_messe': /messe?\b.*?\d{1,2}[:.]\d{2}|orari\w*\s+messe|mass\s+time|mass\s+schedule/is,
      'contatti': /telefono|phone|email|@|segreteria|secretary/i,
      'battesimo_info': /battesimo.*?documento|documento.*?battesimo|baptism|baptême|bautismo/is,
      'comunione_info': /comunione.*?catechismo|catechismo.*?comunione/is,
      'cresima_info': /cresima.*?percorso|percorso.*?cresima|confirmation|confirmación/is,
      'matrimonio_info': /matrimonio.*?corso|corso.*?matrimonio|wedding|marriage|mariage/is,
      'territorio': /rientra|non rientra|parrocchia.*?competenza|parish\s+territory|territory/is,
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
  _computeUserReaction(userBody, previousTopics) {
    if (!previousTopics || previousTopics.length === 0) return null;
    if (!userBody || typeof userBody !== 'string') return null;

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
        'podría ampliar', 'más detalles', 'podría proporcionar más informazioni',
        'sería possibile tener más información', 'podría indicar los pasos'
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

    if (!inferredReaction) return null;

    // 1. Trova TUTTI i topic menzionati esplicitamente
    const normalizedTopics = previousTopics
      .map(info => (typeof info === 'object' && info !== null ? info.topic : info))
      .map(topic => this._normalizeTopicKey(topic));

    const mentionedTopics = normalizedTopics.filter(topic => {
      if (!topic) return false;
      // Rimuove suffissi tecnici (es. "_info") e underscore per confrontare
      // il topic interno con il linguaggio naturale usato dall'utente.
      const naturalTopic = topic.replace(/_info$/, '').replace(/_/g, ' ').trim();
      return !!naturalTopic && bodyLower.includes(naturalTopic);
    });

    let targetTopics = [];

    if (mentionedTopics.length > 0) {
      // Se l'utente cita esplicitamente dei topic, applica a tutti quelli trovati
      targetTopics = mentionedTopics;
    } else {
      // Fallback: applica all'ultimo argomento discusso
      targetTopics = [normalizedTopics[normalizedTopics.length - 1]].filter(Boolean);
    }

    if (targetTopics.length === 0) return null;

    return {
      reaction: inferredReaction.type,
      topics: targetTopics,
      source: 'user_reply',
      matchedPhrase: inferredReaction.match,
      excerpt: userBody.substring(0, 160)
    };
  }

  /**
   * Backward-compat alias mantenuto per test/call-site legacy.
   * Aggiorna direttamente la memoria con la reazione inferita.
   */
  _inferUserReaction(userBody, previousTopics, threadId) {
    const inferred = this._computeUserReaction(userBody, previousTopics);
    if (!inferred || !Array.isArray(inferred.topics) || inferred.topics.length === 0) return;
    if (!this.memoryService || typeof this.memoryService.updateReaction !== 'function') return;
    if (!threadId) return;

    inferred.topics.forEach(topic => {
      if (!topic) return;
      this.memoryService.updateReaction(
        threadId,
        this._normalizeTopicKey(topic),
        inferred.reaction,
        inferred.excerpt || userBody
      );
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
   * Classificazione centralizzata degli errori API
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
        case ErrorTypes.CACHE_EXPIRED:
          return mkResult('NETWORK', true, normalized.message);
        case ErrorTypes.INVALID_API_KEY:
        case ErrorTypes.CONFIG_ERROR:
          return mkResult(normalized.type, false, normalized.message);
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

    if (msg.includes('gmail_counter_lock_not_acquired_retryable')) {
      return mkResult('NETWORK', true, rawMessage);
    }
    if (msg.includes('gmail_daily_call_limit_reached') ||
        msg.includes('daily call limit') ||
        msg.includes('service invoked too many times')) {
      return mkResult('QUOTA_EXCEEDED', true, rawMessage);
    }
    if (msg.includes('rate_limiter_lock_timeout')) {
      return mkResult('NETWORK', true, rawMessage);
    }

    for (const fatal of FATAL_ERRORS) {
      if (msg.includes(fatal.toLowerCase())) return mkResult('FATAL', false, rawMessage);
    }
    if (/\b(401|403)\b/.test(msg)) return mkResult('INVALID_API_KEY', false, rawMessage);
    if (/\b404\b/.test(msg) && (msg.includes('models/') || msg.includes('not found'))) return mkResult('CONFIG_ERROR', false, rawMessage);

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
    let streak = 0;
    try {
      const cache = (typeof CacheService !== "undefined" && CacheService && typeof CacheService.getScriptCache === "function")
        ? CacheService.getScriptCache()
        : null;
      const props = (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function')
        ? PropertiesService.getScriptProperties()
        : null;
      if (!cache && !props) return 0;

      const key = "empty_inbox_streak";
      streak = parseInt((cache ? cache.get(key) : null) || (props ? props.getProperty(key) : null) || "0", 10);

      if (isEmpty) {
        streak++;
        if (cache) cache.put(key, streak.toString(), 21600); // 6 ore
        if (props && typeof props.setProperty === 'function' && streak % 10 === 0) props.setProperty(key, streak.toString());
      } else {
        streak = 0;
        // Usa put a "0" invece di remove() per mantenere semantica idempotente nella lettura dello stato 
        // in polyfill/mock usati in ambienti di test (props.removeProperty non è una funzione)
        if (cache) cache.put(key, "0", 21600);
        if (props && typeof props.setProperty === 'function') props.setProperty(key, "0");
      }
      return streak;
    } catch (e) {
      console.warn(`⚠️ CacheService temporaneamente indisponibile per metrica empty inbox: ${e.message}`);
      return Number.isFinite(streak) ? streak : 0;
    }
  }

  _detectTemporalMentions(text, language) {
    // Protezione contro input nulli o non validi
    if (!text || typeof text !== 'string') return false;
    const monthPatterns = {
      // Nota: \b è ASCII-only; i lookaround Unicode evitano falsi negativi
      // sulle parole con accento finale (lunedì, martedì, ecc.).
      'it': /(?<![a-zA-ZÀ-ÿ])(oggi|domani|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?![a-zA-ZÀ-ÿ])/i,
      'en': /(?<![a-zA-Z])(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)(?![a-zA-Z])/i,
      'es': /(?<![a-zA-ZÀ-ÿ])(hoy|ma[nñ]ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?![a-zA-ZÀ-ÿ])/i,
      'pt': /(?<![a-zA-ZÀ-ÿ])(hoje|amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|janeiro|fevereiro|mar\u00E7o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?![a-zA-ZÀ-ÿ])/i,
      'de': /(?<![a-zA-ZÄÖÜäöüß])(heute|morgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|januar|februar|m[äa]rz|april|mai|juni|juli|august|september|oktober|november|dezember)(?![a-zA-ZÄÖÜäöüß])/i
    };

    // Fallback su italiano se lingua non supportata
    const pattern = monthPatterns[language] || monthPatterns['it'];
    return pattern.test(text);
  }

  _deriveAttachmentIntentContext_(body, subject, attachmentItems, ocrText, phase = 'pre_ocr') {
    const fullText = `${subject || ''} ${body || ''} ${ocrText || ''}`.toLowerCase();
    const attachmentSignalText = `${ocrText || ''} ${(Array.isArray(attachmentItems) ? attachmentItems.map((i) => (i && i.name) ? i.name : '').join(' ') : '')}`.toLowerCase();
    const hasBodyQuestion = /\?|vorrei sapere|chiedo se|mi dica|sapere se/i.test(`${subject || ''} ${body || ''}`);
    // Non trattare punti interrogativi o label OCR come domande rivolte alla segreteria:
    // un form/certificato può contenere campi o diciture interrogative non intenzionali.
    const hasOcrQuestion = false;

    // Rilevamento tipologia documenti (euristico)
    // PRE-OCR: usa subject+body (fullText) per sospetto submission.
    // POST-OCR: usa segnali dagli allegati per evitare che il corpo "contamini"
    // la classificazione del documento effettivamente ricevuto.
    const docScopeText = phase === 'post_ocr' ? attachmentSignalText : fullText;
    const isSponsorDoc = /idoneit[aà]|padrino|madrina|sponsor/i.test(docScopeText);
    const isIdentityDoc = /carta d'identit[aà]|passaporto|documento identit[aà]/i.test(docScopeText);
    const isSbattezzoDoc = /modulo sbattezzo|richiesta cancellazione|registr[oi] battesim/i.test(docScopeText);
    const isSacramentalDoc = /certificat[oa].{0,80}(battesim[oa]|cresim[ao])|battesim[oa].{0,80}uso.{0,40}matrimoni[oa]|(prima comunione|cresima ragazzi|catechismo)|cresim[ao].{0,30}adult/i.test(docScopeText);

    // Rileva se ci sono evidenze (certificati) o dati pratica (moduli)
    const hasEvidence = (Array.isArray(attachmentItems) && attachmentItems.some(item => item && item.attachmentRole === 'submitted_evidence')) || /ruolo allegato:\s*submitted_evidence/i.test(ocrText || '');
    const hasCaseData = (Array.isArray(attachmentItems) && attachmentItems.some(item => item && item.attachmentRole === 'case_data')) || /ruolo allegato:\s*case_data/i.test(ocrText || '');








    // Se è un pre-check (senza OCR), siamo conservativi
    if (phase === 'pre_ocr') {
      const hasIdentityDataSubmission =
        /(?:data\s+di\s+emissione|numero\s+(?:documento|passaporto|carta)|scadenza|rilasciat[oa])/.test(fullText) &&
        /(?:carta d'identit[aà]|passaporto|documento identit[aà])/.test(fullText);
      const isCamminoContext = /cammino di santiago|pellegrinaggio|iscrizion/i.test(fullText);
      const isSuspectedSubmission =
        /allegato|invio|ecco|documento|certificato|modulo/i.test(fullText) ||
        hasIdentityDataSubmission ||
        (isCamminoContext && hasIdentityDataSubmission);
      if (!isSuspectedSubmission) return null;

      return {
        intent: hasBodyQuestion ? 'suspected_submission_with_question' : 'suspected_submission',
        confidence: hasBodyQuestion ? 0.55 : 0.75,
        phase: 'pre_ocr',
        suppressAttachmentIntentKeywords: true,
        allowBodyQuestions: hasBodyQuestion,
        responseDirective: hasBodyQuestion
          ? `Confermare la ricezione dell'allegato. Rispondere poi alle domande esplicite.`
          : `Confermare la ricezione della documentazione allegata.`
      };
    }

    // Fase post-OCR: analisi raffinata
    const hasAttachments = Array.isArray(attachmentItems) && attachmentItems.length > 0;
    if (!hasAttachments) return null;

    let intent = 'document_submission';
    let responseDirective = 'Consegna documenti rilevata. Ringrazia per l\'invio e conferma la ricezione.';
    let categoryHintSource = null;

    if (isSponsorDoc) {
      intent = 'sponsor_eligibility_submission';
      categoryHintSource = 'sacrament';
      responseDirective = 'Consegna documento idoneità padrino/madrina rilevata. Conferma la ricezione della documentazione allegata.';
    } else if (isSbattezzoDoc) {
      intent = 'formal_request_submission';
      categoryHintSource = 'formal';
      responseDirective = 'Ricevuto modulo per sbattezzo/apostasia. Segui protocollo FORMAL: conferma ricezione e informa che la pratica verrà inoltrata al Parroco.';
    } else if (isSacramentalDoc) {
      categoryHintSource = 'sacrament';
      responseDirective = 'Consegna documento sacramentale rilevata. Conferma la ricezione della documentazione allegata.';
    }

    if (hasBodyQuestion || hasOcrQuestion) {
      intent += '_with_question';
      responseDirective = `Confermare la ricezione dell'allegato. Rispondere poi puntualmente alle domande usando la KB.`;
    } else {
      responseDirective = `Confermare la ricezione della documentazione allegata.`;
    }

    return {
      intent: intent,
      confidence: 0.9,
      phase: 'post_ocr',
      categoryHintSource: categoryHintSource,
      responseDirective: responseDirective,
      hasQuestions: hasBodyQuestion || hasOcrQuestion,
      detectedDocTypes: {
        sponsor: isSponsorDoc,
        identity: isIdentityDoc,
        sbattezzo: isSbattezzoDoc,
        sacrament: isSacramentalDoc
      }
    };
  }
  _evaluateDocumentConsistency_(subject, body, attachmentItems, ocrText) {
    const expected = this._detectDocumentTypeFromText_(`${subject || ''} ${body || ''}`);
    const attachmentNames = Array.isArray(attachmentItems)
      ? attachmentItems.map((it) => (it && it.name) ? it.name : '').filter(Boolean).join(' ')
      : '';
    const received = this._detectDocumentTypeFromText_(`${attachmentNames} ${ocrText || ''}`);

    if (!expected || expected === 'unknown') {
      return { mode: 'unknown_expected', expected: 'unknown', received: received || 'unknown' };
    }
    if (!received || received === 'unknown') {
      return { mode: 'unknown_received', expected: expected, received: 'unknown' };
    }
    if (expected !== received) {
      return { mode: 'mismatch', expected: expected, received: received };
    }
    return { mode: 'match', expected: expected, received: received };
  }

  _detectDocumentTypeFromText_(text) {
    const src = String(text || '').toLowerCase();
    if (!src.trim()) return 'unknown';

    const rules = [
      { type: 'certificato_battesimo_uso_matrimonio', pattern: /\bbattesim[oa]\b[\s\S]{0,80}\buso\b[\s\S]{0,40}\bmatrimoni[oa]\b/i },
      { type: 'certificato_battesimo_uso_matrimonio', pattern: /\b(uso matrimoniale|per matrimonio)\b/i },
      { type: 'attestato_idoneita_padrino_madrina', pattern: /\b(attestat[oa]|certificat[oa])\b[\s\S]{0,60}\bidoneit[aà]\b/i },
      { type: 'attestato_idoneita_padrino_madrina', pattern: /\b(idoneit[aà]|padrin[oa]|madrin[ao]|sponsor)\b/i },
      { type: 'certificato_battesimo', pattern: /\bcertificat[oa]\b[\s\S]{0,40}\bbattesim[oa]\b/i },
      { type: 'certificato_cresima', pattern: /\bcertificat[oa]\b[\s\S]{0,40}\bcresim[ao]\b/i },
      { type: 'scheda_iscrizione_corso_prematrimoniale', pattern: /\b(scheda|modulo)\b[\s\S]{0,40}\biscrizion[ea]\b[\s\S]{0,60}\bprematrimoniale\b/i },
      { type: 'scheda_iscrizione_catechesi_comunione_cresima_ragazzi', pattern: /\b(prima comunione|cresima ragazzi|catechismo)\b/i },
      { type: 'scheda_iscrizione_cresima_adulti', pattern: /\bcresim[ao]\b[\s\S]{0,30}\badult/i },
      { type: 'scheda_iscrizione_catechesi_buon_pastore', pattern: /\bbuon pastore\b/i },
      { type: 'scheda_iscrizione_pellegrinaggio', pattern: /\bpellegrinaggi[oa]\b/i },
      { type: 'modulo_sbattezzo_rinuncia_cancellazione_registri', pattern: /\b(sbattezz[oa]|apostasi[ao]|rinuncia)\b/i },
      { type: 'modulo_sbattezzo_rinuncia_cancellazione_registri', pattern: /\bcancellazion[ea]\b[\s\S]{0,40}\bregistr[oi]\b[\s\S]{0,30}\bbattesim[oa]\b/i }
    ];

    for (const rule of rules) {
      if (rule.pattern.test(src)) return rule.type;
    }
    return 'unknown';
  }

  _buildPrudentDocumentMismatchResponse_(detectedLanguage) {
    const lang = this._normalizeBypassResponseLanguage_(detectedLanguage);
    const { greeting, closing } = this._getAdaptiveBypassGreetingAndClosing_(lang);
    if (lang === 'en') {
      return `${greeting}\n\nWe have received your attachment. Before proceeding, the parish office will verify the submitted documentation.\n\n${closing}\nParish Office`;
    }
    if (lang === 'es') {
      return `${greeting}\n\nHemos recibido el archivo adjunto. Antes de proceder, la secretaría parroquial verificará la documentación enviada.\n\n${closing}\nSecretaría Parroquial`;
    }
    if (lang === 'fr') {
      return `${greeting}\n\nNous avons bien reçu votre pièce jointe. Avant de poursuivre, le secrétariat paroissial vérifiera la documentation envoyée.\n\n${closing}\nSecrétariat paroissial`;
    }
    if (lang === 'pt') {
      return `${greeting}\n\nRecebemos o seu anexo. Antes de prosseguir, a secretaria paroquial verificará a documentação enviada.\n\n${closing}\nSecretaria Paroquial`;
    }
    if (lang === 'de') {
      return `${greeting}\n\nWir haben Ihren Anhang erhalten. Bevor wir fortfahren, prüft das Pfarrbüro die eingereichten Unterlagen.\n\n${closing}\nPfarrbüro`;
    }
    return `${greeting}\n\nAbbiamo ricevuto la documentazione allegata. Prima di procedere, la segreteria verificherà la documentazione inviata.\n\n${closing}\nSegreteria Parrocchia Sant'Eugenio`;
  }

  _normalizeSponsorGuidanceLanguage_(detectedLanguage) {
    const lang = String(detectedLanguage || 'it').substring(0, 2).toLowerCase();
    return ['it', 'en', 'es', 'fr', 'pt', 'de'].includes(lang) ? lang : 'it';
  }

  _hasConfirmationTopic_(text, detectedLanguage = 'it') {
    const source = String(text || '').toLowerCase();
    switch (this._normalizeSponsorGuidanceLanguage_(detectedLanguage)) {
      case 'en':
        return /\b(confirmation|sacrament of confirmation)\b/i.test(source);
      case 'es':
        return /\b(confirmaci[oó]n|confirmad[oa]s?)\b/i.test(source);
      case 'fr':
        return /\b(confirmation|confirm[ée]s?)\b/i.test(source);
      case 'pt':
        return /\b(crisma|crismad[oa]s?)\b/i.test(source);
      case 'de':
        return /\b(firmung|gefirmt\w*)\b/i.test(source);
      default:
        return /\bcresim\w*\b/i.test(source);
    }
  }

  _hasSacramentalContext_(text, detectedLanguage = 'it') {
    const source = String(text || '').toLowerCase();
    if (this._hasConfirmationTopic_(source, detectedLanguage)) return true;
    switch (this._normalizeSponsorGuidanceLanguage_(detectedLanguage)) {
      case 'en':
        return /\b(baptism|baptismal|christening|catholic|church|sacrament|godparent)\b/i.test(source);
      case 'es':
        return /\b(bautism\w*|cat[oó]lic\w*|iglesia|sacrament\w*)\b/i.test(source);
      case 'fr':
        return /\b(bapt[êe]m\w*|catholique|[ée]glise|sacrement\w*)\b/i.test(source);
      case 'pt':
        return /\b(batism\w*|cat[oó]lic\w*|igreja|sacrament\w*)\b/i.test(source);
      case 'de':
        return /\b(taufe|tauf\w*|katholisch\w*|kirche|sakrament\w*)\b/i.test(source);
      default:
        return /\b(battesim\w*|cattolic\w*|chiesa|sacrament\w*)\b/i.test(source);
    }
  }

  _hasSacramentalSponsorRole_(text, detectedLanguage = 'it') {
    const source = String(text || '').toLowerCase();
    switch (this._normalizeSponsorGuidanceLanguage_(detectedLanguage)) {
      case 'en':
        return /\b(godfather|godmother|godparent|godparents)\b/i.test(source) ||
          (/\bsponsors?\b/i.test(source) && (
            this._hasSacramentalContext_(source, 'en') ||
            this._hasMissingConfirmationSignal_(source, 'en')
          ));
      case 'es':
        return /\b(padrin\w*|madrin\w*)\b/i.test(source);
      case 'fr':
        return /\b(parrain|marraine)s?\b/i.test(source);
      case 'pt':
        return /\b(padrinh\w*|madrinh\w*)\b/i.test(source);
      case 'de':
        return /\b(firmpat\w*|taufpat\w*|pate|patin)\b/i.test(source);
      default:
        return /\b(padrin\w*|madrin\w*)\b/i.test(source);
    }
  }

  _hasSponsorEligibilityTopic_(text, detectedLanguage = 'it') {
    const source = String(text || '').toLowerCase();
    switch (this._normalizeSponsorGuidanceLanguage_(detectedLanguage)) {
      case 'en':
        return /\b(requirements?|conditions?|eligib(?:le|ility)|suitab(?:le|ility))\b/i.test(source);
      case 'es':
        return /\b(requisitos?|condiciones?|idoneidad|id[oó]ne[oa]s?)\b/i.test(source);
      case 'fr':
        return /\b(conditions?|exigences?|aptitude|apte)\b/i.test(source);
      case 'pt':
        return /\b(requisitos?|condi[cç][oõ]es|idoneidade|id[oô]ne[oa]s?)\b/i.test(source);
      case 'de':
        return /\b(voraussetzungen?|bedingungen?|eignung|geeignet)\b/i.test(source);
      default:
        return /\b(requisit[oi]|condizion[ei]|idoneit[aà]|idone[oa]i?)\b/i.test(source);
    }
  }

  _hasMissingConfirmationSignal_(text, detectedLanguage = 'it') {
    const source = String(text || '').toLowerCase();
    switch (this._normalizeSponsorGuidanceLanguage_(detectedLanguage)) {
      case 'en':
        return /\b(not|never)\b[\s\S]{0,30}\bconfirm(?:ed|ation)\b/i.test(source) ||
          /\b(have not|haven't|need|must|missing|lack)\b[\s\S]{0,80}\bconfirmation\b/i.test(source);
      case 'es':
        return /\b(no estoy|no he sido|me falta|necesito|debo)\b[\s\S]{0,80}\b(confirmaci[oó]n|confirmad[oa])\b/i.test(source) ||
          /\bconfirmaci[oó]n\b[\s\S]{0,40}\b(me falta|falta)\b/i.test(source);
      case 'fr':
        return /\b(pas|jamais|me manque|besoin|dois)\b[\s\S]{0,80}\b(confirmation|confirm[ée])\b/i.test(source) ||
          /\bconfirmation\b[\s\S]{0,40}\b(me manque|manque)\b/i.test(source);
      case 'pt':
        return /\b(n[aã]o sou|nunca fui|me falta|preciso|devo)\b[\s\S]{0,80}\b(crisma|crismad[oa])\b/i.test(source) ||
          /\bcrisma\b[\s\S]{0,40}\b(me falta|falta)\b/i.test(source);
      case 'de':
        return /\b(nicht|nie|fehlt|brauche|muss)\b[\s\S]{0,80}\b(firmung|gefirmt)\b/i.test(source);
      default:
        return /\bnon (sono|mi sono|ero|mi ero|ho ricevuto)\b[\s\S]{0,50}\bcresim\w*/i.test(source) ||
          /\bmi manca\b[\s\S]{0,50}\bcresim\w*/i.test(source) ||
          /\bcresim\w*[\s\S]{0,50}\b(che\s+)?mi manca\b/i.test(source) ||
          /\b(devo|dovrei|ho bisogno|mi serve)\b[\s\S]{0,80}\b(ricevere|fare)\b[\s\S]{0,30}\bcresim\w*/i.test(source);
    }
  }

  _hasSponsorRoleIntent_(text, detectedLanguage = 'it') {
    const source = String(text || '').toLowerCase();
    if (!this._hasSacramentalSponsorRole_(source, detectedLanguage)) return false;
    switch (this._normalizeSponsorGuidanceLanguage_(detectedLanguage)) {
      case 'en':
        return /\b(asked|chosen|need|want|would like|must)\b[\s\S]{0,90}\b(be|become|serve as|act as)\b[\s\S]{0,50}\b(godfather|godmother|godparent|sponsor)\b/i.test(source) ||
          /\b(be|become|serve as|act as)\b[\s\S]{0,50}\b(godfather|godmother|godparent|sponsor)\b/i.test(source);
      case 'es':
        return /\b(ser|hacer de|convertirme en|me pidieron|me han pedido)\b[\s\S]{0,70}\b(padrin\w*|madrin\w*)\b/i.test(source);
      case 'fr':
        return /\b([êe]tre|devenir|faire|demand[ée])\b[\s\S]{0,70}\b(parrain|marraine)\b/i.test(source);
      case 'pt':
        return /\b(ser|fazer de|tornar-me|pediram|me pediram)\b[\s\S]{0,70}\b(padrinh\w*|madrinh\w*)\b/i.test(source);
      case 'de':
        return /\b(pate|patin|firmpat\w*|taufpat\w*)\b[\s\S]{0,70}\b(sein|werden|gebeten)\b/i.test(source) ||
          /\b(sein|werden|gebeten)\b[\s\S]{0,70}\b(pate|patin|firmpat\w*|taufpat\w*)\b/i.test(source);
      default:
        return /\b(fare|diventare|essere|fungere|assumere|svolgere)\b[\s\S]{0,45}\b(da\s+|il\s+|la\s+)?(padrin\w*|madrin\w*)\b/i.test(source) ||
          /\b(scelt[oa]|chiest[oa]|chiamat[oa]|mi hanno chiesto|mi è stato chiesto)\b[\s\S]{0,90}\b(padrin\w*|madrin\w*)\b/i.test(source);
    }
  }

  _isSubmittingSponsorEligibilityDocument_(text, detectedLanguage = 'it') {
    const source = String(text || '').toLowerCase();
    const deliverySignals = /\b(allego|in allegato|invio|inoltro|trasmetto|mando|consegno|presento|deposito|ecco|attach|attached|send|sending|env[ií]o|adjunto|j['’]?envoie|anexo|sende)\b/i.test(source);
    const documentSignals = /\b(certificat\w*|attestat\w*|certificate|attestation|certificado|attestation|atestado|bescheinigung)\b/i.test(source);
    return this._hasSacramentalSponsorRole_(source, detectedLanguage) &&
      documentSignals &&
      this._hasSponsorEligibilityTopic_(source, detectedLanguage) &&
      deliverySignals;
  }

  _isExplicitSponsorEligibilityRequest_(text, detectedLanguage = 'it') {
    const source = String(text || '').toLowerCase();
    if (!this._hasSacramentalSponsorRole_(source, detectedLanguage)) return false;
    const hasQuestionIntent = /\?|come|cosa|quali|qual[eè]|posso|potrei|devo|dovrei|serve|servono|occorre|occorrono|bisogna|vorrei sapere|mi serve sapere|ho bisogno di sapere|informazioni|info|how|what|which|can i|could i|do i need|requirements?|requisitos?|conditions?|conditions?|exigences?|voraussetzungen?/i.test(source);
    return hasQuestionIntent && (this._hasSponsorEligibilityTopic_(source, detectedLanguage) || this._hasSponsorRoleIntent_(source, detectedLanguage));
  }

  _isReceivingOwnCresimaContext_(text, detectedLanguage = 'it') {
    const source = String(text || '').toLowerCase();
    switch (this._normalizeSponsorGuidanceLanguage_(detectedLanguage)) {
      case 'en':
        return /\b(receive|get|make)\b[\s\S]{0,50}\bconfirmation\b/i.test(source);
      case 'es':
        return /\b(recibir|hacer)\b[\s\S]{0,50}\bconfirmaci[oó]n\b/i.test(source);
      case 'fr':
        return /\b(recevoir|faire)\b[\s\S]{0,50}\bconfirmation\b/i.test(source);
      case 'pt':
        return /\b(receber|fazer)\b[\s\S]{0,50}\bcrisma\b/i.test(source);
      case 'de':
        return /\b(empfangen|machen|erhalten)\b[\s\S]{0,50}\bfirmung\b/i.test(source);
      default:
        return /\b(ricev\w+|ricever\w+|celebr\w+)\b[\s\S]{0,80}\bcresim\w*/i.test(source) ||
          /\b(fare|farò)\b\s+(la\s+)?cresim\w*/i.test(source) ||
          /\bcresim\w*[\s\S]{0,80}\b(prossim[aoie]?|imminente|celebrazione|cerimonia|\d{1,2}\s+\w+\s+20\d{2})\b/i.test(source);
    }
  }

  _classifySponsorGuidanceLocally_(subject, body, attachmentIntentContext, detectedLanguage = 'it') {
    const text = `${subject || ''} ${body || ''}`.toLowerCase();
    const intent = String((attachmentIntentContext && attachmentIntentContext.intent) || '').toLowerCase();
    const isSubmission = /submission/.test(intent);
    const hasSubmissionQuestion = Boolean(
      (attachmentIntentContext && attachmentIntentContext.hasQuestions) ||
      /with_question/.test(intent)
    );
    const hasSponsorRole = this._hasSacramentalSponsorRole_(text, detectedLanguage);
    const hasConfirmationTopic = this._hasConfirmationTopic_(text, detectedLanguage);
    const hasEligibilityTopic = this._hasSponsorEligibilityTopic_(text, detectedLanguage);
    const hasMissingConfirmation = this._hasMissingConfirmationSignal_(text, detectedLanguage);
    const hasSponsorRoleIntent = this._hasSponsorRoleIntent_(text, detectedLanguage);
    const asksEligibility = this._isExplicitSponsorEligibilityRequest_(text, detectedLanguage);

    if (this._isSubmittingSponsorEligibilityDocument_(text, detectedLanguage)) return 'exclude';
    if (this._isReceivingOwnCresimaContext_(text, detectedLanguage) && !hasSponsorRoleIntent && !asksEligibility) return 'exclude';
    if (isSubmission && !hasSubmissionQuestion && !asksEligibility) return 'exclude';

    if (hasSponsorRole && (hasConfirmationTopic || hasEligibilityTopic || hasMissingConfirmation || hasSponsorRoleIntent)) return 'ask_ai';
    return 'none';
  }

  _detectCresimaAsPrerequisiteForSponsorRole_(text, detectedLanguage = 'it') {
    const source = String(text || '').toLowerCase();
    const directSponsorRoleIntent = this._hasSponsorRoleIntent_(source, detectedLanguage);
    const sponsorRoleSignals = this._hasSacramentalSponsorRole_(source, detectedLanguage);
    const missingCresimaSignals = this._hasMissingConfirmationSignal_(source, detectedLanguage);
    const needsCresimaForRoleSignals = this._hasConfirmationTopic_(source, detectedLanguage) &&
      /\b(per poter|per fare|per diventare|necessari[aoe]?|obbligator\w*|requisit[oi]|in order to|to be|to become|required|needed|obligatory|requisito|requisitos?|pour|afin de|necess[aá]ri[oa]|n[oó]tig|erforderlich)\b/i.test(source);

    if (directSponsorRoleIntent && (missingCresimaSignals || needsCresimaForRoleSignals)) return true;

    if (this._isSubmittingSponsorEligibilityDocument_(source, detectedLanguage)) return false;

    const isReceivingOwnCresima = this._isReceivingOwnCresimaContext_(source, detectedLanguage);
    if (isReceivingOwnCresima && !directSponsorRoleIntent) return false;

    return sponsorRoleSignals && missingCresimaSignals;
  }

  _shouldProvideEligibilityGuidance_(subject, body, attachmentIntentContext, aiGuidanceSignal, detectedLanguage = 'it') {
    const text = `${subject || ''} ${body || ''}`.toLowerCase();
    const intent = String((attachmentIntentContext && attachmentIntentContext.intent) || '').toLowerCase();
    const hasSubmissionQuestion = Boolean(
      (attachmentIntentContext && attachmentIntentContext.hasQuestions) ||
      /with_question/.test(intent)
    );
    const isSubmission = /submission/.test(intent);
    const localDecision = this._classifySponsorGuidanceLocally_(subject, body, attachmentIntentContext, detectedLanguage);

    if (localDecision === 'exclude') return false;
    if (localDecision === 'none') return false;
    // localDecision === 'ask_ai': continua alla risoluzione del segnale AI.

    if (aiGuidanceSignal === true) return true;
    if (aiGuidanceSignal === false && isSubmission && !hasSubmissionQuestion) return false;

    const cresimaAsPrerequisiteSignals = this._detectCresimaAsPrerequisiteForSponsorRole_(text, detectedLanguage);
    const asksEligibility = this._isExplicitSponsorEligibilityRequest_(text, detectedLanguage);

    const deliverySignals = /\b(allego|in allegato|invio|inoltro|trasmetto|ecco|certificato|attestato|idoneit[aà])\b/i.test(text);
    if (deliverySignals && isSubmission && !hasSubmissionQuestion && !asksEligibility && !cresimaAsPrerequisiteSignals) {
      return false;
    }

    const infoSignals = /\b(vorrei|desidero|ho bisogno|mi serve|informazioni|info|come|percorso|corso)\b/i.test(text);
    const cresimaGoalSignals = /\b(cresima adulti?|fare la cresima|diventare padrin[oa]|fare da padrin[oa]|fare da madrin[ao])\b/i.test(text);
    return (infoSignals && cresimaGoalSignals) || asksEligibility || cresimaAsPrerequisiteSignals;
  }
  _sanitizeUnrequestedSponsorGuidance_(response, subject, body, detectedLanguage = 'it') {
    const text = typeof response === 'string' ? response : String(response || '');
    if (!text) return text;

    const userText = `${subject || ''} ${body || ''}`.toLowerCase();
    const asksEligibilityInfo = this._isExplicitSponsorEligibilityRequest_(userText, detectedLanguage);
    const cresimaAsPrerequisiteSignals = this._detectCresimaAsPrerequisiteForSponsorRole_(userText, detectedLanguage);
    if (asksEligibilityInfo || cresimaAsPrerequisiteSignals) return text;

    const mentionsPadrinoContext = this._hasSacramentalSponsorRole_(userText, detectedLanguage);
    if (!mentionsPadrinoContext) return text;

    const lines = text.split(/\n+/);
    const filtered = [];
    let skippingSponsorBlock = false;

    lines.forEach((line) => {
      const startsSponsorBlock = /\b(padrin[oa]?|madrin[ao]?|sponsor)\b[\s\S]{0,120}\b(requisit[oi]|condizion[ei]|necessario|necessari|soddisfare|idoneit[aà])\b/i.test(line) ||
        /\b(requisit[oi]|condizion[ei]|necessario|necessari|soddisfare|idoneit[aà])\b[\s\S]{0,120}\b(padrin[oa]?|madrin[ao]?|sponsor)\b/i.test(line);
      if (startsSponsorBlock) {
        skippingSponsorBlock = true;
        return;
      }

      if (skippingSponsorBlock) {
        const requirementLine = /^\s*(?:[-*•]|\d+[.)])?\s*(essere|aver|avere|condurre|non essere)\b/i.test(line);
        if (requirementLine || !line.trim()) return;
        skippingSponsorBlock = false;
      }

      // Rimuovi solo righe esplicitamente relative ai requisiti per padrino/madrina.
      // Termini generici come "divorzio" o "convivenza" possono essere legittimi
      // in risposte matrimoniali o pastorali e non vanno filtrati da soli.
      if (/\b(requisit[oi].*\b(padrin[oa]?|madrin[ao]?)|idoneit[aà].*\b(padrin[oa]?|madrin[ao]?)|fare da (padrin[oa]|madrin[ao]))\b/i.test(line)) {
        return;
      }
      filtered.push(line);
    });

    const cleaned = filtered.join('\n').trim();
    if (!cleaned) return text;
    if (cleaned !== text) {
      console.log('   🧹 Rimossa guida non richiesta su requisiti padrino/madrina dalla risposta.');
    }
    return cleaned;
  }

  _buildReceiptOnlySubmissionResponse_(lang = 'it') {
    const normalizedLang = this._normalizeBypassResponseLanguage_(lang);
    const { greeting, closing } = this._getAdaptiveBypassGreetingAndClosing_(normalizedLang);
    if (normalizedLang === 'it') {
      return `${greeting}

Con la presente confermiamo la ricezione della documentazione inviata.
Provvederemo a prenderne visione quanto prima.

${closing}
Segreteria Parrocchia Sant'Eugenio`;
    }
    if (normalizedLang === 'es') {
      return `${greeting}

Confirmamos la recepción de la documentación enviada.
La revisaremos lo antes possibile.

${closing}
Secretaría Parroquial`;
    }
    if (normalizedLang === 'fr') {
      return `${greeting}

Nous confirmons la réception de la documentation envoyée.
Nous l'examinerons dès que possible.

${closing}
Secrétariat paroissial`;
    }
    if (normalizedLang === 'pt') {
      return `${greeting}

Confirmamos a receção da documentação enviada.
Iremos analisá-la assim que possível.

${closing}
Secretaria Paroquial`;
    }
    if (normalizedLang === 'de') {
      return `${greeting}

Wir bestätigen den Eingang der zugesandten Unterlagen.
Wir werden sie so bald wie möglich prüfen.

${closing}
Pfarrbüro`;
    }
    return `${greeting}

We confirm the receipt of the documentation you sent.
We will review it as soon as possible.

${closing}
Parish Secretariat of Sant'Eugenio`;
  }


  _normalizeBypassResponseLanguage_(lang = 'it') {
    const normalized = String(lang || 'it').trim().toLowerCase().split(/[-_]/)[0];
    return ['it', 'en', 'es', 'fr', 'pt', 'de'].includes(normalized) ? normalized : 'it';
  }

  _getAdaptiveBypassGreetingAndClosing_(lang = 'it') {
    const normalized = this._normalizeBypassResponseLanguage_(lang);
    if (this.geminiService && typeof this.geminiService.getAdaptiveGreeting === 'function') {
      try {
        const fallbackSenderName = normalized === 'it' ? 'utente' : 'parishioner';
        const adaptive = this.geminiService.getAdaptiveGreeting(fallbackSenderName, normalized) || {};
        if (adaptive.greeting && adaptive.closing) {
          return {
            greeting: String(adaptive.greeting).trim(),
            closing: String(adaptive.closing).trim()
          };
        }
      } catch (e) {
        console.warn(`⚠️ Saluto adattivo bypass non disponibile: ${e.message}`);
      }
    }

    const fallback = normalized === 'en'
      ? { greeting: 'Good day,', closing: 'Kind regards,' }
      : { greeting: 'Buongiorno.', closing: 'Cordiali saluti,' };
    return fallback;
  }

  _deriveSponsorGuidancePolicy_(subject, body, attachmentIntentContext, aiGuidanceSignal, detectedLanguage = 'it') {
    const text = `${subject || ''} ${body || ''}`.toLowerCase();
    const intent = String((attachmentIntentContext && attachmentIntentContext.intent) || '').toLowerCase();
    const isSubmission = /submission/.test(intent);
    const localDecision = this._classifySponsorGuidanceLocally_(subject, body, attachmentIntentContext, detectedLanguage);

    if (localDecision === 'exclude') return 'no_eligibility_guidance';
    if (localDecision === 'none') {
      const asksLogisticsOnly = /\b(a che ora|orari|quando|arrivare|inizia|inizio|dove|luogo)\b/i.test(text);
      return asksLogisticsOnly ? 'logistics_only_no_eligibility' : 'default';
    }

    if (aiGuidanceSignal === true) return 'cresima_prerequisite_for_sponsor_role';
    if (aiGuidanceSignal === false) return 'no_eligibility_guidance';

    const asksEligibility = this._isExplicitSponsorEligibilityRequest_(text, detectedLanguage);
    const asksLogistics = /\b(a che ora|orari|quando|arrivare|inizia|inizio|dove|luogo)\b/i.test(text);
    const asksCresimaPath = /\b(informazioni|info|corso|percorso)\b/i.test(text) && /\b(cresima adulti?|fare la cresima)\b/i.test(text);
    const cresimaAsPrerequisiteSignals = this._detectCresimaAsPrerequisiteForSponsorRole_(text, detectedLanguage);

    if (cresimaAsPrerequisiteSignals) return 'cresima_prerequisite_for_sponsor_role';
    if (isSubmission && !asksEligibility) return 'no_eligibility_guidance';
    if (asksLogistics && !asksEligibility) return 'logistics_only_no_eligibility';
    if (asksCresimaPath) return 'allow_eligibility_context';
    return 'default';
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
function computeSalutationMode({ isReply = false, memoryExists = false, lastUpdated = null, now = new Date() } = {}) {
  const SESSION_WINDOW_MINUTES = 15;
  // Al momento la temporalità (lastUpdated) è il segnale primario.
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

  const parsedLastUpdated = (typeof parseDateSafe === 'function') ? parseDateSafe(lastUpdated, null) : new Date(lastUpdated);
  if (isNaN(parsedLastUpdated.getTime())) {
    return 'full';
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

  const parsedMessageDate = (typeof parseDateSafe === 'function') ? parseDateSafe(messageDate, null) : new Date(messageDate);
  if (!parsedMessageDate || isNaN(parsedMessageDate.getTime())) {
    return { shouldApologize: false, hours: 0, days: 0 };
  }
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
 * Alias del punto d'ingresso principale processEmailsMain() (gas_main.js).
 * Mantenuta per compatibilità con trigger preesistenti.
 */
function processUnreadEmailsMain() {
  if (typeof processEmailsMain === 'function') {
    processEmailsMain();
  } else {
    console.error('🛑 processEmailsMain non trovata — impossibile delegare.');
  }
}
