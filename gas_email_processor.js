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

var TECHNICAL_CONTEXT_ROUTING_CATEGORIES = new Set(['technical', 'appointment', 'quotation', 'information', 'document_submission', 'document_request']);

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
    this.props = options.props ||
      ((typeof PropertiesService !== 'undefined' && PropertiesService &&
        typeof PropertiesService.getScriptProperties === 'function')
        ? PropertiesService.getScriptProperties()
        : { getProperty: () => null });
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
          getRecentMemoryTopics: () => [],
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
      validationWarningThreshold: (() => {
        const configuredThreshold = (typeof CONFIG !== 'undefined' && typeof CONFIG.VALIDATION_WARNING_THRESHOLD === 'number')
          ? CONFIG.VALIDATION_WARNING_THRESHOLD
          : 0.9;
        if (typeof normalizeValidationScore === 'function') {
          return normalizeValidationScore(configuredThreshold);
        }
        return Math.max(0, Math.min(1, configuredThreshold > 1 ? configuredThreshold / 100 : configuredThreshold));
      })(),
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
    // Viene impostato all'avvio di ogni run, evitando state stale se
    // l'istanza viene riutilizzata dal container V8 tra esecuzioni distinte.
    this._startTime = null;
  }

  /**
   * Restituisce il fuso orario business con caching locale.
   * La sorgente autorevole è BUSINESS_TIME_ZONE (gas_main.js); Session può
   * divergere dal fuso operativo e non deve influenzare i timestamp business.
   */
  _getCachedTimeZone() {
    if (!this._scriptTimeZone) {
      this._scriptTimeZone = (typeof BUSINESS_TIME_ZONE !== 'undefined')
        ? BUSINESS_TIME_ZONE
        : 'Europe/Rome';
    }
    return this._scriptTimeZone;
  }

  _formatBurstMessageDate_(dateValue) {
    if (!(dateValue instanceof Date) || isNaN(dateValue.getTime())) {
      return 'data non disponibile';
    }

    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      try {
        return Utilities.formatDate(dateValue, this._getCachedTimeZone(), 'dd/MM/yyyy');
      } catch (e) {
        // Fallback ISO sotto.
      }
    }

    return dateValue.toISOString().slice(0, 10);
  }

  _escapeBurstXmlText_(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/&/g, '&amp;')
               .replace(/</g, '&lt;')
               .replace(/>/g, '&gt;')
               .replace(/"/g, '&quot;')
               .replace(/'/g, '&#039;');
  }

  _buildGenerationStrategies_(geminiService, options = {}) {
    if (geminiService && typeof geminiService.buildGenerationStrategies === 'function') {
      return geminiService.buildGenerationStrategies(options);
    }

    if (
      typeof GeminiService !== 'undefined' &&
      GeminiService &&
      GeminiService.prototype &&
      typeof GeminiService.prototype.buildGenerationStrategies === 'function'
    ) {
      const config = (typeof CONFIG !== 'undefined') ? CONFIG : {};
      const primaryKey = geminiService ? geminiService.primaryKey : null;
      const backupKey = geminiService ? geminiService.backupKey : null;
      let strategyAdapter = null;
      try {
        strategyAdapter = new GeminiService({
          config: config,
          logger: this.logger,
          primaryKey: primaryKey || config.GEMINI_API_KEY || '',
          backupKey: backupKey || null,
          props: {
            getProperty: (key) => {
              if (key === 'GEMINI_API_KEY') return primaryKey || config.GEMINI_API_KEY || '';
              if (key === 'GEMINI_API_KEY_BACKUP') return backupKey || '';
              return '';
            }
          }
        });
      } catch (e) {
        if (this.logger && typeof this.logger.warn === 'function') {
          this.logger.warn(`Fallback strategie Gemini non inizializzabile: ${e.message}`);
        }
        return {
          attemptStrategy: [],
          strategies: [],
          fallbackModelName: 'gemini-3.6-flash',
          configuredGenerationStrategy: []
        };
      }
      strategyAdapter.config = (typeof CONFIG !== 'undefined') ? CONFIG : {};
      strategyAdapter.primaryKey = geminiService ? geminiService.primaryKey : null;
      strategyAdapter.backupKey = geminiService ? geminiService.backupKey : null;
      strategyAdapter.isPrimaryExhausted = !!(geminiService && geminiService.isPrimaryExhausted);
      return strategyAdapter.buildGenerationStrategies(options);
    }

    return {
      attemptStrategy: [],
      strategies: [],
      fallbackModelName: 'gemini-3.6-flash',
      configuredGenerationStrategy: []
    };
  }

  _createRuleContext_(overrides = {}) {
    const base = {
      phase: '',
      threadId: '',
      languageMode: 'all',
      detectedLanguage: '',
      candidate: null,
      externalUnread: [],
      unlabeledUnread: [],
      skipLabelName: this.config ? this.config.skipLabelName : '·',
      actions: {},
      gmailTargets: {},
      state: {}
    };
    return Object.assign(base, overrides || {});
  }

  _evaluatePreAiRules_(context = {}) {
    return this._evaluateEmailPolicyRules_(context);
  }

  _evaluateEmailPolicyRules_(context = {}) {
    const rules = [
      {
        id: 'last-speaker-is-us',
        phase: 'pre_extract',
        when: (ctx) => ctx.lastSpeakerIsUs === true,
        do: {
          status: 'skipped',
          reason: 'last_speaker_is_me',
          logs: ['   ⊖ Saltato: l\'ultimo messaggio del thread è nostro (bot o segreteria). Ignoro messaggi precedenti riaperti come non letti.'],
          gmailActions: [{ type: 'markHandledUnread' }]
        }
      },
      {
        id: 'foreign-only-subject-italian-precheck',
        phase: 'pre_extract',
        when: (ctx) => ctx.foreignOnlySubjectItalianPrecheck === true,
        do: {
          status: 'skipped',
          reason: 'italian_skipped_foreign_only_precheck',
          logs: (ctx) => [`   ⊖ Pre-check locale: italiano rilevato nel solo oggetto ("${String(ctx.subject || '').substring(0, 20)}...") → skip anticipato`],
          gmailActions: [{ type: 'markSkipped', target: 'externalUnread', labelName: 'skip' }]
        }
      },
      {
        id: 'newsletter-header',
        phase: 'post_extract_pre_ai',
        when: (ctx) => ctx.isNewsletter === true,
        do: {
          status: 'filtered',
          reason: 'newsletter_header',
          logs: (ctx) => {
            const lines = [];
            if (ctx.languageMode === 'foreign_only') {
              lines.push('   ℹ️ Newsletter in foreign_only: arrivata qui perché NON intercettata dal gate lingua italiana iniziale');
            }
            lines.push('   ⊖ Saltato: rilevata newsletter (List-Unsubscribe/Precedence)');
            return lines;
          },
          gmailActions: [{ type: 'markProcessedMessages', target: 'newsletterMessagesToMark' }]
        }
      },
      {
        id: 'out-of-office',
        phase: 'post_extract_pre_ai',
        when: (ctx) => ctx.isAutoReplyHeader === true || ctx.isOutOfOfficeText === true,
        do: {
          status: 'filtered',
          reason: 'out_of_office',
          logs: (ctx) => [
            ctx.isAutoReplyHeader
              ? '   ⊖ Saltato: risposta automatica (header SMTP)'
              : '   ⊖ Saltato: risposta automatica out-of-office (testo)'
          ],
          gmailActions: [{
            type: 'markHandledUnread',
            safe: true,
            warnPrefix: 'markHandledUnread fallita (out_of_office): '
          }]
        }
      },
      {
        id: 'short-closure-reply',
        phase: 'post_extract_pre_ai',
        when: (ctx) => ctx.isShortClosureReply === true,
        do: {
          status: 'filtered',
          reason: 'short_closure_reply',
          logs: ['   ⊖ Saltato: risposta breve di chiusura (grazie/ok/perfetto)'],
          gmailActions: [{ type: 'markHandledUnread' }]
        }
      },
      {
        id: 'no-reply-sender',
        phase: 'post_extract_pre_ai',
        when: (ctx) => ctx.isNoReplySender === true,
        do: {
          status: 'filtered',
          reason: 'no_reply_sender',
          logs: ['   ⊖ Saltato: mittente rilevato come casella automatica o no-reply'],
          gmailActions: [{ type: 'markHandledUnread' }]
        }
      },
      {
        id: 'ignore-rules',
        phase: 'post_extract_pre_ai',
        when: (ctx) => ctx.shouldIgnoreEmail === true,
        do: {
          status: 'filtered',
          reason: 'ignore_rules',
          logs: ['   ⊖ Filtrato: domain/keyword ignore'],
          gmailActions: [{ type: 'markHandledUnread' }]
        }
      },
      {
        id: 'local-classifier-no-reply',
        phase: 'post_extract_pre_ai',
        when: (ctx) => ctx.classifierShouldReply === false,
        do: {
          status: 'filtered',
          logs: (ctx) => [`   ⊖ Filtrato dal classifier: ${ctx.classifierReason || ''}`],
          gmailActions: [{ type: 'markHandledUnread' }]
        }
      },
      {
        id: 'document-submission-response-policy',
        phase: 'post_ocr_policy',
        when: (ctx) => ctx.isDocumentSubmission === true,
        do: {
          stop: false,
          state: {
            forceReceiptOnlyForSubmission: (ctx) => {
              if (ctx.isComplexCanonicalSubmission) {
                return false;
              }
              if (ctx.isSponsorSubmission) {
                return ctx.hasSubmissionQuestions ? false : !ctx.shouldProvideEligibilityGuidance;
              }
              return !ctx.hasSubmissionQuestions;
            }
          },
          logs: (ctx) => {
            const lines = [];
            if (ctx.isComplexCanonicalSubmission) {
              lines.push('   📎 Guardrail submission: documento canonico/sacramentale con richiesta operativa → delega a Gemini');
            } else if (!ctx.hasSubmissionQuestions) {
              lines.push('   📎 Guardrail submission: nessuna domanda esplicita → risposta solo conferma ricezione');
            }
            if (ctx.isSponsorSubmission && !ctx.isComplexCanonicalSubmission) {
              const forceReceiptOnly = ctx.hasSubmissionQuestions ? false : !ctx.shouldProvideEligibilityGuidance;
              if (forceReceiptOnly) {
                lines.push('   📎 Guardrail sponsor submission: consegna documentale → risposta solo conferma ricezione');
              } else if (ctx.hasSubmissionQuestions) {
                lines.push('   📎 Guardrail sponsor submission: domanda nel corpo → risposta alla domanda + conferma ricezione');
              }
            }
            return lines;
          }
        }
      },
      {
        id: 'technical-context-routing',
        phase: 'context_routing',
        when: (ctx) => ctx.isTechnicalOnly === true,
        do: {
          stop: false,
          state: {
            routedAiCoreLite: '',
            routedAiCore: '',
            routedDoctrine: '',
            routedDoctrineStructured: []
          },
          logs: ['   🧭 Context routing: richiesta tecnica → disattivo moduli dottrinali pesanti.']
        }
      },
      {
        id: 'full-context-routing',
        phase: 'context_routing',
        when: () => true,
        do: {
          stop: false,
          logs: ['   🧭 Context routing: richiesta non tecnica o sensibile → mantengo moduli completi.']
        }
      }
    ];

    const phase = String(context.phase || '');
    for (const rule of rules) {
      if (rule.phase !== phase) continue;
      if (!rule.when(context)) continue;
      return Object.assign({ ruleId: rule.id, stop: true }, rule.do);
    }
    return null;
  }

  _applyPreAiRuleDecision_(decision, context = {}, result = null) {
    if (!decision) return false;

    const rawLogs = (typeof decision.logs === 'function')
      ? decision.logs(context)
      : decision.logs;
    const logs = Array.isArray(rawLogs) ? rawLogs : (rawLogs ? [rawLogs] : []);
    logs.filter(Boolean).forEach((line) => console.log(line));

    const actions = context.actions || {};
    const targets = context.gmailTargets || {};
    const state = context.state || (context.state = {});
    const gmailActions = Array.isArray(decision.gmailActions) ? decision.gmailActions : [];
    gmailActions.forEach((action) => {
      if (!action || !action.type) return;

      if (action.type === 'markHandledUnread' && typeof actions.markHandledUnread === 'function') {
        if (action.safe) {
          try {
            actions.markHandledUnread();
          } catch (markErr) {
            const warnPrefix = action.warnPrefix || 'markHandledUnread fallita: ';
            const warn = typeof actions.warn === 'function' ? actions.warn : console.warn;
            warn(warnPrefix + markErr.message);
          }
        } else {
          actions.markHandledUnread();
        }
        return;
      }

      if (action.type === 'markSkipped' && typeof actions.markSkipped === 'function') {
        const labelName = action.labelName === 'skip' ? context.skipLabelName : action.labelName;
        actions.markSkipped(targets[action.target] || [], labelName);
        return;
      }

      if (action.type === 'markProcessedMessages' && typeof actions.markProcessedMessages === 'function') {
        actions.markProcessedMessages(targets[action.target] || []);
      }
    });

    if (decision.state && typeof decision.state === 'object') {
      Object.keys(decision.state).forEach((key) => {
        const value = decision.state[key];
        state[key] = (typeof value === 'function') ? value(context) : value;
      });
    }

    if (result) {
      if (Object.prototype.hasOwnProperty.call(decision, 'status')) {
        result.status = decision.status;
      }
      if (Object.prototype.hasOwnProperty.call(decision, 'reason')) {
        result.reason = decision.reason;
      }
      if (Object.prototype.hasOwnProperty.call(decision, 'retryDelayMs')) {
        result.retryDelayMs = decision.retryDelayMs;
      }
    }

    return decision.stop !== false;
  }

  _getPacificDateForSafetyValve_() {
    const now = new Date();
    if (typeof Utilities !== 'undefined' && Utilities &&
      typeof Utilities.formatDate === 'function') {
      try {
        return Utilities.formatDate(now, 'America/Los_Angeles', 'yyyy-MM-dd');
      } catch (_) {
        // Fallback Intl sotto.
      }
    }
    return this._formatPacificDateWithIntl_(now) || now.toISOString().split('T')[0];
  }

  _formatPacificDateWithIntl_(date = new Date()) {
    if (typeof Intl === 'undefined' || !Intl || typeof Intl.DateTimeFormat !== 'function') {
      return null;
    }
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(date);
      const byType = {};
      parts.forEach(part => {
        if (part && part.type) byType[part.type] = part.value;
      });
      if (byType.year && byType.month && byType.day) {
        return `${byType.year}-${byType.month}-${byType.day}`;
      }
    } catch (_) {
      // Ultimo fallback gestito dal chiamante.
    }
    return null;
  }

  _getSafetyValveReducedLimit_(configuredLimit) {
    if (!this.props || typeof this.props.getProperty !== 'function') return null;
    if (!Number.isFinite(configuredLimit) || configuredLimit <= 1) return null;

    const valveDate = this.props.getProperty('safety_valve_last_date');
    if (valveDate !== this._getPacificDateForSafetyValve_()) return null;

    const reduced = parseInt(this.props.getProperty('safety_valve_reduced_value') || '0', 10);
    if (!Number.isFinite(reduced) || reduced <= 0 || reduced >= configuredLimit) return null;
    return reduced;
  }

  _getAttachmentDownloadLimitBytes_(attachmentSettings) {
    const configured = attachmentSettings && Number(attachmentSettings.maxMessageBytesForAttachmentDownload);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : 25 * 1024 * 1024;
  }

  _getMessageSizeEstimateForAttachmentDownload_(message, threadLogger) {
    if (!message || !this.gmailService ||
      typeof this.gmailService._getMessageMetadataWithResilience !== 'function') {
      return null;
    }

    let messageId = '';
    try {
      messageId = (typeof message.getId === 'function') ? message.getId() : '';
    } catch (_) {
      messageId = '';
    }
    if (!messageId) return null;

    try {
      const metadata = this.gmailService._getMessageMetadataWithResilience(messageId, { format: 'minimal' }, 1);
      const sizeEstimate = Number(metadata && metadata.sizeEstimate);
      return Number.isFinite(sizeEstimate) && sizeEstimate >= 0 ? sizeEstimate : null;
    } catch (e) {
      if (threadLogger && typeof threadLogger.warn === 'function') {
        threadLogger.warn(`Impossibile stimare dimensione messaggio ${messageId}: ${e.message}`);
      }
      return null;
    }
  }

  _acquireThreadLock(threadId, skipLock = false, threadLogger = null, options = {}) {
    const scriptCache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
      ? CacheService.getScriptCache()
      : null;
    const hasCache = !!(scriptCache &&
      typeof scriptCache.get === 'function' &&
      typeof scriptCache.put === 'function');
    const threadLockKey = `thread_lock_${threadId}`;

    if (!hasCache) {
      if (threadLogger && typeof threadLogger.warn === 'function') {
        threadLogger.warn('CacheService non disponibile per lock logico di thread');
      }
      return { ok: false, reason: 'cache_unavailable' };
    }

    const configuredTtl = (typeof CONFIG !== 'undefined' && Number(CONFIG.CACHE_LOCK_TTL))
      ? Number(CONFIG.CACHE_LOCK_TTL)
      : 600;
    const ttlSeconds = Math.max(1, Math.min(configuredTtl, 21600));
    const lockTtlMs = ttlSeconds * 1000;
    const tokenSuffix = (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.getUuid === 'function')
      ? Utilities.getUuid()
      : Math.random().toString(36).slice(2);
    const value = `${Date.now()}_${tokenSuffix}`;
    const lockAlreadyCovered = !!(options && options.lockAlreadyCovered);
    const shouldAcquirePhysicalLock = !lockAlreadyCovered;
    const scriptLock = (shouldAcquirePhysicalLock &&
      typeof LockService !== 'undefined' &&
      LockService &&
      typeof LockService.getScriptLock === 'function')
      ? LockService.getScriptLock()
      : null;

    if (shouldAcquirePhysicalLock && !scriptLock && !skipLock) {
      if (threadLogger && typeof threadLogger.warn === 'function') {
        threadLogger.warn('LockService globale non disponibile, impossibile garantire atomicità');
      }
      return { ok: false, reason: 'global_lock_unavailable' };
    }

    let scriptLockAcquired = false;
    const isStaleLock = (lockValue) => {
      if (!lockValue) return false;
      const existingTimestamp = Number.parseInt(String(lockValue), 10);
      return !Number.isFinite(existingTimestamp) || (Date.now() - existingTimestamp) > lockTtlMs;
    };

    try {
      if (lockAlreadyCovered) {
        if (threadLogger && typeof threadLogger.debug === 'function') {
          threadLogger.debug('Mutex globale saltato (lock esecuzione già posseduto dal chiamante)');
        }
      } else {
        const threadLockWaitMs = (typeof CONFIG !== 'undefined' && CONFIG.EXECUTION_LOCK_WAIT_MS)
          ? CONFIG.EXECUTION_LOCK_WAIT_MS
          : 1000;
        if (!scriptLock || typeof scriptLock.tryLock !== 'function') {
          if (threadLogger && typeof threadLogger.warn === 'function') {
            threadLogger.warn('LockService globale non disponibile: procedo in modalità compatibilità senza garanzia di atomicità fisica');
          }
        } else {
          scriptLockAcquired = scriptLock.tryLock(threadLockWaitMs);
        }
        if (scriptLock && !scriptLockAcquired) {
          if (threadLogger && typeof threadLogger.warn === 'function') {
            threadLogger.warn(`Impossibile acquisire lock globale per thread ${threadId} (timeout ${threadLockWaitMs}ms), salto`);
          }
          return { ok: false, reason: 'global_lock_unavailable' };
        }
      }

      const existingCacheLock = scriptCache.get(threadLockKey);
      const cacheLockIsStale = existingCacheLock && isStaleLock(existingCacheLock);

      if (existingCacheLock && !cacheLockIsStale) {
        if (threadLogger && typeof threadLogger.warn === 'function') {
          threadLogger.warn('Thread logicamente lockato da altro processo (CacheService), salto');
        }
        return { ok: false, reason: 'thread_locked' };
      }
      if (existingCacheLock && threadLogger && typeof threadLogger.warn === 'function') {
        threadLogger.warn('Lock stale rilevato, sovrascrittura lock');
      }

      let cacheLockWritten = false;
      scriptCache.put(threadLockKey, value, ttlSeconds);
      cacheLockWritten = true;

      if (threadLogger && typeof threadLogger.debug === 'function') {
        threadLogger.debug('Lock logico di thread acquisito con successo');
      }
      return {
        ok: true,
        acquired: true,
        cache: cacheLockWritten ? scriptCache : null,
        key: threadLockKey,
        value: value,
        lockCovered: lockAlreadyCovered
      };
    } catch (e) {
      if (threadLogger && typeof threadLogger.warn === 'function') {
        threadLogger.warn(`Errore acquisizione lock thread: ${e.message}`);
      }
      try {
        if (scriptCache &&
          typeof scriptCache.get === 'function' &&
          typeof scriptCache.remove === 'function' &&
          scriptCache.get(threadLockKey) === value) {
          scriptCache.remove(threadLockKey);
        }
      } catch (cleanupError) {
        if (threadLogger && typeof threadLogger.warn === 'function') {
          threadLogger.warn(`Cleanup lock parziale fallito: ${cleanupError.message}`);
        }
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
    if (!lockCtx || !lockCtx.acquired || !lockCtx.key) return;
    let scriptLock = null;
    let scriptLockAcquired = false;
    try {
      if (!lockCtx.lockCovered &&
        typeof LockService !== 'undefined' &&
        LockService &&
        typeof LockService.getScriptLock === 'function') {
        scriptLock = LockService.getScriptLock();
        if (scriptLock && typeof scriptLock.tryLock === 'function') {
          scriptLockAcquired = scriptLock.tryLock(500);
        }
      }
    } catch (_) { }

    try {
      if (!lockCtx.lockCovered && !scriptLockAcquired) {
        if (threadLogger && typeof threadLogger.warn === 'function') {
          threadLogger.warn('Mutex globale non acquisito per rilascio: lock logico lasciato al TTL per evitare cancellazioni concorrenti');
        }
        return;
      }

      let removed = false;
      if (lockCtx.cache && typeof lockCtx.cache.get === 'function' && typeof lockCtx.cache.remove === 'function') {
        const currentLockValue = lockCtx.cache.get(lockCtx.key);
        if (currentLockValue === lockCtx.value) {
          lockCtx.cache.remove(lockCtx.key);
          removed = true;
        }
      }

      if (removed && threadLogger && typeof threadLogger.debug === 'function') {
        threadLogger.debug('Lock logico rilasciato correttamente');
      } else if (!removed && threadLogger && typeof threadLogger.warn === 'function') {
        threadLogger.warn('Rilascio lock logico saltato (già scaduto o sovrascritto)');
      }
    } catch (e) {
      if (threadLogger && typeof threadLogger.warn === 'function') {
        threadLogger.warn(`Errore in rilascio lock: ${e.message}`);
      }
    } finally {
      if (scriptLockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
        try {
          scriptLock.releaseLock();
        } catch (_) { }
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
    const startTimeAgeMs = startTime - Number(this._startTime || 0);
    const staleStartThresholdMs = Math.max(0, this.config.maxExecutionTimeMs - this.config.minRemainingTimeMs);
    if (!this._startTime || startTimeAgeMs < 0 || startTimeAgeMs > staleStartThresholdMs) {
      this._startTime = startTime;
    }
    const normalizedKnowledgeBase = this._normalizeTextContent(knowledgeBase);
    const normalizedDoctrineBase = this._normalizeTextContent(doctrineBase);
    const languageMode = this._getLanguageProcessingMode_();

    // ====================================================================
    // ACQUISIZIONE LOCK (LIVELLO-THREAD) - Previene condizioni di conflitto
    // ====================================================================

    let lockCtx = this._acquireThreadLock(threadId, skipLock, threadLogger, {
      lockAlreadyCovered: !!(options && options.lockAlreadyCovered)
    });
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
    let responseContextMessageIds = new Set();
    let responseContextMessages = [];
    const setResponseContextMessages = (messagesForResponse) => {
      const source = Array.isArray(messagesForResponse) ? messagesForResponse : [];
      responseContextMessageIds = new Set();
      responseContextMessages = [];
      source.forEach((message) => {
        if (!message || typeof message.getId !== 'function') return;
        const messageId = message.getId();
        if (!messageId || responseContextMessageIds.has(messageId)) return;
        responseContextMessageIds.add(messageId);
        responseContextMessages.push(message);
      });
      if (candidate && typeof candidate.getId === 'function') {
        const candidateId = candidate.getId();
        if (candidateId && !responseContextMessageIds.has(candidateId)) {
          responseContextMessageIds.add(candidateId);
          responseContextMessages.push(candidate);
        }
      }
    };
    const isInResponseContext = (message) => (
      message &&
      typeof message.getId === 'function' &&
      responseContextMessageIds.has(message.getId())
    );
    let markHandledUnread = () => { };
    let handledUnreadMarked = false;
    const markHandledUnreadOnce = () => {
      if (handledUnreadMarked) return;
      markHandledUnread();
      handledUnreadMarked = true;
    };
    const markFailureForCurrentBurst = (labelType, reviewContext = {}) => {
      const targets = (responseContextMessages && responseContextMessages.length > 0)
        ? responseContextMessages
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
      this._refreshThreadBeforeUnreadRead_(thread, threadId, threadLogger);
      const messages = thread.getMessages();
      const unreadMessages = this._getUnreadMessagesForProcessing_(messages, threadLogger);

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
            const isUserLabelId = typeof this.gmailService._isUserLabelId_ === 'function'
              ? this.gmailService._isUserLabelId_(labelId)
              : (typeof labelId === 'string' && !/^(INBOX|UNREAD|STARRED|SENT|DRAFT|SPAM|TRASH|IMPORTANT|CHAT|CATEGORY_.+)$/i.test(labelId.trim()));
            if (!isUserLabelId) return;
            metadataTerminalLabelIds.push(labelId);
            if (entry.type === 'skip') {
              metadataSkipLabelIds.add(labelId);
            }
          } catch (labelError) {
            threadLogger.warn(`Impossibile risolvere label terminale '${entry && entry.name ? entry.name : ''}': ${labelError.message}`);
          }
        });
      }

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
      if (ownAddresses.size === 0) {
        throw new Error('CONFIG_ERROR: impossibile determinare identità bot/alias; elaborazione interrotta per evitare loop automatici');
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

      const getMessageSortTimestamp = (message) => {
        try {
          const date = message && typeof message.getDate === 'function' ? message.getDate() : null;
          return date instanceof Date && !isNaN(date.getTime()) ? date.getTime() : 0;
        } catch (e) {
          return 0;
        }
      };
      const getMessageSortId = (message) => {
        try {
          return message && typeof message.getId === 'function' ? String(message.getId() || '') : '';
        } catch (e) {
          return '';
        }
      };
      const compareMessagesByDateAndId = (left, right) => {
        const diff = getMessageSortTimestamp(left) - getMessageSortTimestamp(right);
        if (diff !== 0) return diff;
        const leftId = getMessageSortId(left);
        const rightId = getMessageSortId(right);
        if (leftId < rightId) return -1;
        if (leftId > rightId) return 1;
        return 0;
      };

      externalUnread = unlabeledUnread.filter(message => {
        // Utilizza getFrom() per efficienza rispetto alla costosa extractMessageDetails()
        const rawFrom = (message.getFrom() || '');
        const senderEmail = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
          ? this.gmailService._extractEmailAddress(rawFrom)
          : rawFrom;



        // Se non riusciamo ad estrarre l'email, consideriamo il mittente come esterno per sicurezza
        if (!senderEmail) return true;

        return !ownAddresses.has(this._normalizeEmailAddress_(senderEmail));
      }).sort(compareMessagesByDateAndId);

      const staleOnlyMs = this._getFiniteOptionNumber_(options, 'staleOnlyMs');
      if (Number.isFinite(staleOnlyMs)) {
        const hasRecentExternalUnread = externalUnread.some(message => {
          const msgDate = (message && typeof message.getDate === 'function') ? message.getDate() : null;
          const messageTs = (msgDate && typeof msgDate.getTime === 'function') ? msgDate.getTime() : NaN;
          return Number.isFinite(messageTs) && messageTs > staleOnlyMs;
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
        const isAbortAll = candidate === null;
        const candidateDate = (candidate && typeof candidate.getDate === 'function') ? candidate.getDate() : null;
        const candidateTimestamp = (candidateDate && typeof candidateDate.getTime === 'function')
          ? candidateDate.getTime()
          : (isAbortAll ? Infinity : 0);

        unlabeledUnread.forEach(message => {
          const messageId = message.getId();
          if (externalIds.has(messageId)) {
            // Temporal Reversal: rispondendo al messaggio esterno piu recente,
            // consumiamo anche gli esterni antecedenti rimasti appesi nel thread.
            const messageDate = (message && typeof message.getDate === 'function') ? message.getDate() : null;
            const messageTimestamp = (messageDate && typeof messageDate.getTime === 'function')
              ? messageDate.getTime()
              : 0;
            if (isAbortAll || isInResponseContext(message) || messageTimestamp <= candidateTimestamp) {
              this._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds);
            }
          } else {
            const rawFrom = (message && typeof message.getFrom === 'function') ? (message.getFrom() || '') : '';
            const senderEmail = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
              ? this.gmailService._extractEmailAddress(rawFrom)
              : rawFrom;
            const isOwnMessage = senderEmail && ownAddresses.has(this._normalizeEmailAddress_(senderEmail));
            if (isOwnMessage) {
              internalUnread.push(message);
            } else if (Number.isFinite(staleOnlyMs)) {
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
        const isStaleOnlyRun = Number.isFinite(staleOnlyMs);
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

      // CRITICO: il contesto del burst deve essere disponibile prima degli
      // early-exit di STEP 0. markHandledUnread() agisce solo sui messaggi in
      // responseContextMessages: se lo popoliamo dopo STEP 0, filtri come
      // last_speaker_is_me o email_loop_detected marcano solo il candidato finale.
      const buildBurstMessagesForCandidate = (candidateMessage, fallbackSenderEmail = '') => {
        if (!candidateMessage || typeof candidateMessage.getId !== 'function') return [];

        const candidateRawFrom = (candidateMessage && typeof candidateMessage.getFrom === 'function')
          ? (candidateMessage.getFrom() || '')
          : '';
        const candidateSenderEmail = this._normalizeConversationEmailAddress_(
          fallbackSenderEmail || (
            this.gmailService && typeof this.gmailService._extractEmailAddress === 'function'
              ? this.gmailService._extractEmailAddress(candidateRawFrom)
              : candidateRawFrom
          ) || ''
        );
        const candidateId = candidateMessage.getId();

        if (externalUnread.length <= 1 || !candidateSenderEmail) {
          return [candidateMessage];
        }

        return externalUnread.filter((message) => {
          if (!message || typeof message.getFrom !== 'function') {
            return message && typeof message.getId === 'function' && message.getId() === candidateId;
          }
          const rawFrom = message.getFrom() || '';
          const sender = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
            ? this.gmailService._extractEmailAddress(rawFrom)
            : rawFrom;
          return this._normalizeConversationEmailAddress_(sender || '') === candidateSenderEmail;
        }).sort(compareMessagesByDateAndId);
      };
      setResponseContextMessages(buildBurstMessagesForCandidate(candidate));

      const ruleActions = {
        markHandledUnread: () => markHandledUnread(),
        markSkipped: (messagesToSkip, labelName) => this._markMessagesAsSkipped(messagesToSkip, labelName, skippedMessageIds),
        markProcessedMessages: (messagesToProcess) => {
          (messagesToProcess || []).forEach((message) => this._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds));
        },
        warn: (message) => threadLogger.warn(message)
      };
      const buildRuleContext = (overrides = {}) => {
        const gmailTargets = Object.assign({
          externalUnread: externalUnread,
          unlabeledUnread: unlabeledUnread
        }, overrides.gmailTargets || {});
        const actions = Object.assign({}, ruleActions, overrides.actions || {});
        const merged = Object.assign({
          threadId: threadId,
          languageMode: languageMode,
          candidate: candidate,
          externalUnread: externalUnread,
          unlabeledUnread: unlabeledUnread,
          skipLabelName: this.config.skipLabelName,
          actions: actions,
          gmailTargets: gmailTargets
        }, overrides);
        merged.actions = actions;
        merged.gmailTargets = gmailTargets;
        return this._createRuleContext_(merged);
      };

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

      const lastSpeakerDecision = this._evaluatePreAiRules_(buildRuleContext({
        phase: 'pre_extract',
        lastSpeakerIsUs: lastSpeakerIsUs
      }));
      if (this._applyPreAiRuleDecision_(lastSpeakerDecision, buildRuleContext({ phase: 'pre_extract' }), result)) {
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

          const languagePrecheckDecision = this._evaluatePreAiRules_(buildRuleContext({
            phase: 'pre_extract',
            subject: subjectOnly,
            foreignOnlySubjectItalianPrecheck: italianPattern.test(subjectOnly)
          }));
          if (this._applyPreAiRuleDecision_(languagePrecheckDecision, buildRuleContext({
            phase: 'pre_extract',
            subject: subjectOnly
          }), result)) {
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
        // Manteniamo il burst già anticipato prima di STEP 0. Se l'estrazione
        // leggera del mittente non era riuscita, riproviamo ora con senderEmail
        // ottenuto da extractMessageDetails(candidate).
        if (responseContextMessages.length <= 1 && messageDetails.senderEmail) {
          setResponseContextMessages(buildBurstMessagesForCandidate(candidate, messageDetails.senderEmail));
        }
        const candidateId = candidate.getId();
        const burstMessages = responseContextMessages;
        const aggregatedBody = burstMessages.map((message) => {
          const details = (message.getId() === candidateId
            ? messageDetails
            : this.gmailService.extractMessageDetails(message)) || {};
          const messageDate = this._formatBurstMessageDate_(details.date);
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
        : { lang: 'unknown' };

      // Estraiamo solo codici ISO a 2 lettere per gestire formati come "it-IT" o "en-US".
      let detectedLanguage = this._normalizeLanguageCode_(languageDetection.lang, 'unknown');
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

      // Le newsletter sono filtrate in modo definitivo: usiamo IA per non riprenderle
      // nei run successivi. Il punto medio ('·') non si usa qui perché non è un
      // rinvio temporaneo dovuto alla modalità "Solo straniere".
      let newsletterMessagesToMark = (unlabeledUnread && unlabeledUnread.length > 0) ? unlabeledUnread : [candidate];
      // Evita di "demotare" messaggi già IA quando il fallback usa candidate.
      newsletterMessagesToMark = (newsletterMessagesToMark || []).filter((message) => {
        if (!message || typeof message.getId !== 'function') return false;
        const messageId = message.getId();
        return !(labeledMessageIds instanceof Set && labeledMessageIds.has(messageId));
      });
      const newsletterDecision = this._evaluatePreAiRules_(buildRuleContext({
        phase: 'post_extract_pre_ai',
        isNewsletter: messageDetails.isNewsletter,
        gmailTargets: { newsletterMessagesToMark: newsletterMessagesToMark }
      }));
      if (this._applyPreAiRuleDecision_(newsletterDecision, buildRuleContext({
        phase: 'post_extract_pre_ai',
        isNewsletter: messageDetails.isNewsletter,
        gmailTargets: { newsletterMessagesToMark: newsletterMessagesToMark }
      }), result)) {
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
            } catch (_) { }
          }
        }

        if (senderThrottleAlreadySet) {
          console.log(`   ⏳ Dilata: burst cross-thread rilevato per ${safeSenderEmail || 'mittente sconosciuto'}; riprovo in un batch successivo`);
          result.status = 'dilata';
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

      const isAutoReplyHeader = (
        /auto-replied|auto-generated/i.test(autoSubmitted) ||
        /bulk|auto_reply/i.test(precedence) ||
        /auto-reply|autoreply/i.test(xAutoReply) ||
        /oof|all|dr|rn|nri|auto/i.test(xAutoResponseSuppress)
      );
      const autoReplyHeaderDecision = this._evaluatePreAiRules_(buildRuleContext({
        phase: 'post_extract_pre_ai',
        isAutoReplyHeader: isAutoReplyHeader
      }));
      if (this._applyPreAiRuleDecision_(autoReplyHeaderDecision, buildRuleContext({
        phase: 'post_extract_pre_ai',
        isAutoReplyHeader: isAutoReplyHeader
      }), result)) {
        return result;
      }

      const outOfOfficePatterns = [
        /\b(out of office|away from office|fuori ufficio)\b/i,
        /\b(sono\s+assente|sarò\s+assente|resterò\s+assente|sar[oò]\s+fuori)\b/i,
        /\b(automatic reply|risposta automatica)\b/i,
        /\breturn(ing)? on\b/i,
        /\b(thank you for your message|mailbox monitored periodically|messaggio ricevuto)\b/i
      ];

      const oooSubject = messageDetails.subject || '';
      // Trunca a 2000 char per prevenire Regex Timeout su mega-thread
      const oooBody = (messageDetails.body || '').substring(0, 2000);
      const isOutOfOfficeText = outOfOfficePatterns.some(p => p.test(`${oooSubject} ${oooBody}`));
      const outOfOfficeTextDecision = this._evaluatePreAiRules_(buildRuleContext({
        phase: 'post_extract_pre_ai',
        isOutOfOfficeText: isOutOfOfficeText
      }));
      if (this._applyPreAiRuleDecision_(outOfOfficeTextDecision, buildRuleContext({
        phase: 'post_extract_pre_ai',
        isOutOfOfficeText: isOutOfOfficeText
      }), result)) {
        return result;
      }

      const candidateIndex = messages.findIndex(msg => msg.getId() === candidate.getId());
      let shortClosureReplyDetected = false;
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

        shortClosureReplyDetected = Boolean(previousIsUs && arrivedSoonAfterUs && isShortClosureReply);
      }
      const shortClosureDecision = this._evaluatePreAiRules_(buildRuleContext({
        phase: 'post_extract_pre_ai',
        isShortClosureReply: shortClosureReplyDetected
      }));
      if (this._applyPreAiRuleDecision_(shortClosureDecision, buildRuleContext({
        phase: 'post_extract_pre_ai',
        isShortClosureReply: shortClosureReplyDetected
      }), result)) {
        return result;
      }

      // ====================================================================
      // STEP 0.5: ANTI-LOOP (rilevamento intelligente)
      // ====================================================================
      const MAX_THREAD_LENGTH = (typeof CONFIG !== 'undefined' && CONFIG.MAX_THREAD_LENGTH) ? CONFIG.MAX_THREAD_LENGTH : 8;
      const MAX_CONSECUTIVE_EXTERNAL = this.config.maxConsecutiveExternal;

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
          (messages.length > MAX_THREAD_LENGTH && totalBotRepliesInThread > maxBotRepliesInLongThread)
        ) {
          console.log(`   ⊖ Saltato: prevenzione loop email attivata (ping-pong/thread ripetitivo: interventiBot=${totalBotRepliesInThread}, sogliaBot=${maxBotRepliesInLongThread}, consecutivi=${Math.max(consecutiveExternal, botRepliesCount)})`);
          markHandledUnread();
          result.status = 'filtered';
          result.reason = 'email_loop_detected';
          return result;
        }
      }

      if (messages.length > MAX_THREAD_LENGTH) {
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
      const noReplyDecision = this._evaluatePreAiRules_(buildRuleContext({
        phase: 'post_extract_pre_ai',
        isNoReplySender: autoPattern.test(senderInfo) && !messageDetails.hasReplyTo
      }));
      if (this._applyPreAiRuleDecision_(noReplyDecision, buildRuleContext({
        phase: 'post_extract_pre_ai',
        isNoReplySender: autoPattern.test(senderInfo) && !messageDetails.hasReplyTo
      }), result)) {
        return result;
      }

      // ====================================================================
      // STEP 1: FILTRO - Domini/parole chiave ignorati
      // ====================================================================
      const shouldIgnoreEmail = this._shouldIgnoreEmail(messageDetails);
      const ignoreDecision = this._evaluatePreAiRules_(buildRuleContext({
        phase: 'post_extract_pre_ai',
        shouldIgnoreEmail: shouldIgnoreEmail
      }));
      if (this._applyPreAiRuleDecision_(ignoreDecision, buildRuleContext({
        phase: 'post_extract_pre_ai',
        shouldIgnoreEmail: shouldIgnoreEmail
      }), result)) {
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

      const classifierDecision = this._evaluatePreAiRules_(buildRuleContext({
        phase: 'post_extract_pre_ai',
        classifierShouldReply: classification.shouldReply,
        classifierReason: classification.reason
      }));
      if (this._applyPreAiRuleDecision_(classifierDecision, buildRuleContext({
        phase: 'post_extract_pre_ai',
        classifierShouldReply: classification.shouldReply,
        classifierReason: classification.reason
      }), result)) {
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
      const memoryContext = this.memoryService.getMemory(threadId) || {};
      const memoryMessageCount = Number.isFinite(Number(memoryContext.messageCount))
        ? Number(memoryContext.messageCount)
        : 0;
      const memoryContextualFlags = (memoryContext.contextualFlags && typeof memoryContext.contextualFlags === 'object')
        ? memoryContext.contextualFlags
        : {};
      const hasConversationContext = Boolean(
        messages.length > 1 ||
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
            ? this._buildQuickCheckMemoryContext_(memoryContext)
            : null
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
      const quickCheckLanguage = this._normalizeLanguageCode_(quickCheck.language, '');
      if (quickCheckLanguage && quickCheckLanguage !== detectedLanguage) {
        detectedLanguage = quickCheckLanguage;
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

      const quickAttachmentIntent = this._resolveQuickCheckAttachmentIntent_(quickCheck);
      if (quickAttachmentIntent && quickAttachmentIntent.requires_attachment_reading) {
        console.log(`   📎 QuickCheck attachment intent: lettura allegati richiesta se presenti (${quickAttachmentIntent.reason || 'segnale documentale'})`);
      }
      const quickDocumentDelivery = this._resolveQuickCheckDocumentDelivery_(quickCheck);
      if (quickDocumentDelivery && quickDocumentDelivery.expected_document) {
        console.log(`   📎 QuickCheck document delivery: documento atteso via ${quickDocumentDelivery.delivery_channel || 'unclear'} (${quickDocumentDelivery.reason || quickDocumentDelivery.expected_document_description || 'segnale documentale'})`);
      }

      let physicalPresenceConstraint = this._resolvePhysicalPresenceConstraint_(
        quickCheck.physical_presence_constraint,
        messageDetails.subject,
        messageDetails.body
      );
      if (
        (!physicalPresenceConstraint || !physicalPresenceConstraint.has_constraint) &&
        (!physicalPresenceConstraint || physicalPresenceConstraint.source !== 'current_local_presence_override') &&
        memoryContextualFlags.remote_user === true
      ) {
        physicalPresenceConstraint = {
          has_constraint: true,
          type: 'geographic_distance',
          confidence: 0.7,
          evidence: 'vincolo di distanza salvato nella memoria del thread',
          reason: 'remote_user_contextual_flag',
          visit_policy: 'conditional_only',
          source: 'memory_contextual_flags'
        };
      }
      if (physicalPresenceConstraint && physicalPresenceConstraint.has_constraint) {
        console.log(
          `   Vincolo presenza fisica rilevato (${physicalPresenceConstraint.type}, ` +
          `policy=${physicalPresenceConstraint.visit_policy}, source=${physicalPresenceConstraint.source})`
        );
      }

      // Quick check superato con shouldRespond=true: marca i secondari ora.
      if (languageMode !== 'foreign_only') {
        const externalIds = new Set(externalUnread.map(m => m.getId()));
        unlabeledUnread.forEach(message => {
          if (!message || message.getId() === candidate.getId()) return;
          if (externalIds.has(message.getId())) {
            // Marca solo i messaggi esterni realmente inclusi nel payload corrente.
            // Messaggi di altri mittenti nello stesso thread restano eleggibili.
            if (isInResponseContext(message)) {
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
        const responseContextIdsForHistory = new Set(responseContextMessageIds || []);
        if (candidateId) responseContextIdsForHistory.add(candidateId);
        const historyMessages = messages.filter(m => !responseContextIdsForHistory.has(m.getId()));

        if (historyMessages.length > 0) {
          const historyLimit = this.config.maxHistoryMessages || 10;
          conversationHistory = this.gmailService.getThreadHistory(
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
        console.log(`   🧠 Memoria trovata: lang=${memoryContext.language}, topics=${(memoryContext.providedInfo || []).length}`);
      }

      // ====================================================================
      // STEP 6.6: CALCOLO DINAMICO SALUTO E RITARDO
      // ====================================================================
      const processingTimestamp = new Date();

      const salutationMode = computeSalutationMode({
        isReply: isReplyBySubject || messages.length > 1,
        memoryExists: !!memoryContext.lastUpdated,
        lastUpdated: memoryContext.lastUpdated || null,
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

      // ====================================================================
      // STEP 7: COSTRUISCI PROMPT
      // ====================================================================
      let { greeting, closing } = this.geminiService.getAdaptiveGreeting(
        messageDetails.senderName,
        detectedLanguage
      );

      // ====================================================================
      // PASSO 7.1: VERIFICA TERRITORIO (solo quando richiesta esplicita)
      // ====================================================================
      const territoryRequested = this._isTerritoryRequest(
        messageDetails.subject,
        messageDetails.body,
        quickCheck?.classification || {}, // Usa classificazione Gemini evitando errori se null.
        requestType
      );
      const quickCheckTerritoryCandidates = this._extractQuickCheckTerritoryCandidates_(quickCheck);

      let territoryResult = { addressFound: false };
      if (territoryRequested && this.territoryValidator) {
        try {
          const bodyForTerritory = bodyForLanguageDetection || messageDetails.body;
          territoryResult = this.territoryValidator.analyzeEmailForAddress(
            bodyForTerritory,
            messageDetails.subject
          ) || { addressFound: false };
          if (!territoryResult.addressFound) {
            territoryResult = this._analyzeAiTerritoryCandidates_(quickCheckTerritoryCandidates) || territoryResult;
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

      // ====================================================================
      // STEP 7.2: PROMPT CONTEXT (profilo e concern dinamici)
      // ====================================================================
      let promptProfile = 'standard';
      let activeConcerns = {};
      let responseRegister = 'warm_institutional';
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
      let physicalAttachmentsDetected = false;
      let attachmentPreCheckFailed = false;


      if (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT && CONFIG.ATTACHMENT_CONTEXT.enabled) {
        if (this._isNearDeadline(this.config.maxExecutionTimeMs)) {
          attachmentSkipped.push({ reason: 'near_deadline' });
          console.warn('   ⏳ Allegati multimodali saltati: tempo residuo insufficiente.');
        } else {
          const attachmentSettings = Object.assign(
            { maxFiles: 3 },
            (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT) ? CONFIG.ATTACHMENT_CONTEXT : {}
          );
          const maxAttachmentMessageBytes = this._getAttachmentDownloadLimitBytes_(attachmentSettings);
          const attachmentSourceMessages = (responseContextMessages && responseContextMessages.length > 0)
            ? responseContextMessages
            : [candidate].filter(Boolean);
          let hasAttachments = false;
          attachmentPreCheckFailed = false;
          try {
            hasAttachments = attachmentSourceMessages.some((message) => {
              const sizeEstimate = this._getMessageSizeEstimateForAttachmentDownload_(message, threadLogger);
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
              const pastSenderEmailCandidate = (this.gmailService && typeof this.gmailService._extractEmailAddress === 'function')
                ? this._normalizeEmailAddress_(this.gmailService._extractEmailAddress(pastSenderRawCandidate) || '')
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
            const localOcrFallback = this._shouldTryOcr(messageDetails.body, messageDetails.subject, hasAttachments);
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

                const sizeEstimate = this._getMessageSizeEstimateForAttachmentDownload_(attachmentSourceMessages[i], threadLogger);
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
                const msgData = this.gmailService.getProcessableAttachments(attachmentSourceMessages[i], {
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
                shouldProvideEligibilityGuidance = this._shouldProvideEligibilityGuidance_(
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
              const submissionPolicyDecision = this._evaluatePreAiRules_(submissionPolicyContext);
              this._applyPreAiRuleDecision_(submissionPolicyDecision, submissionPolicyContext, result);
              forceReceiptOnlyForSubmission = submissionPolicyState.forceReceiptOnlyForSubmission;
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
      }

      const documentDeliveryModel = this._buildDocumentDeliveryModel_({
        subject: messageDetails.subject,
        body: messageDetails.body,
        quickDocumentDelivery: quickDocumentDelivery,
        quickAttachmentIntent: quickAttachmentIntent,
        physicalAttachmentsDetected: physicalAttachmentsDetected,
        attachmentItems: attachmentItems,
        textFromAttachments: textFromAttachments
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

      const certRequestText = `${messageDetails.subject || ''} ${messageDetails.body || ''}`;
      const hasCertificateSacramentalReference = /\bcertificat[ioa]\b[\s\S]{0,60}\b(battesim[oa]|cresim[ao]|matrimoni[oa]|morte)\b/i.test(certRequestText);
      const hasCertificateRequestCue = /\b(richiesta|richied(?:o|ere|iamo|erei|erebbe|ete)|vorrei|desidero|serve|servirebbe|bisogno|ottenere|rilasci(?:o|are|ate)|mandar(?:mi|ci)|inviar(?:mi|ci))\b/i.test(certRequestText);
      const isCertRequest = hasCertificateSacramentalReference && hasCertificateRequestCue;
      if (isCertRequest && categoryHintSource !== 'document_submission') {
        categoryHintSource = 'document_request';
      }
      const requestPurpose = this._resolveRequestPurpose_(
        quickCheck,
        messageDetails.subject,
        messageDetails.body
      );
      quickCheck.request_purpose = requestPurpose.type;
      quickCheck.request_purpose_confidence = requestPurpose.confidence;
      quickCheck.request_purpose_source = requestPurpose.source;
      console.log(`   Scopo richiesta: ${requestPurpose.type}, confidence=${requestPurpose.confidence}, source=${requestPurpose.source}`);

      const indirectSbattezzo = this._detectIndirectSbattezzoRequest_(messageDetails.subject, messageDetails.body);
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

      // PromptContext deve vedere la categoria definitiva: gli allegati OCR
      // possono trasformare una richiesta apparentemente tecnica in contesto
      // formale/sacramentale e cambiare profilo, concern e registro.
      if (typeof createPromptContext === 'function') {
        const promptContextCategory = String(categoryHintSource || classification.category || '').toLowerCase() || null;
        const promptContext = createPromptContext({
          email: {
            subject: safeSubject,
            body: messageDetails.body,
            isReply: isReplyBySubject || messages.length > 1,
            detectedLanguage: detectedLanguage
          },
          classification: {
            category: promptContextCategory,
            subIntents: classification.subIntents || {},
            confidence: classification.confidence || 0.8
          },
          requestType: requestType,
          memory: {
            exists: Object.keys(memoryContext).length > 0,
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
            mentionsDates: this._detectTemporalMentions(messageDetails.body, detectedLanguage) || /\b\d{1,2}\/\d{1,2}\b/.test(messageDetails.body),
            mentionsTimes: /\d{1,2}[:.]\d{2}/.test(messageDetails.body)
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
      const routingDecision = this._evaluatePreAiRules_(routingContext);
      this._applyPreAiRuleDecision_(routingDecision, routingContext, result);
      routedAiCoreLite = routingState.routedAiCoreLite;
      routedAiCore = routingState.routedAiCore;
      const systemDirectives = [];
      const pastoralFirewall = "DIVIETO DI DEROGA (CROSS-CONTAMINATION): I principi pastorali non possono MAI modificare, derogare o rendere flessibili le procedure, le date o i requisiti tecnici indicati nella Knowledge Base. Non inventare percorsi personalizzati o eccezioni.";
      if (routedAiCore || routedAiCoreLite) systemDirectives.push(pastoralFirewall);
      routedDoctrine = routingState.routedDoctrine;
      routedDoctrineStructured = routingState.routedDoctrineStructured;

      if (!territoryRequested && quickCheckTerritoryCandidates.length > 0) {
        systemDirectives.push(
          "Il messaggio contiene un possibile riferimento di luogo o indirizzo, ma non è stata richiesta una verifica territoriale esplicita: non dedurre competenza parrocchiale senza verifica."
        );
      }

      const certificateDirective = this._buildCertificateSystemDirective_(isCertRequest, requestPurpose);
      if (certificateDirective) systemDirectives.push(certificateDirective);

      const baseRuntimeContext = this._buildRuntimeContext_(
        messageDetails,
        processingTimestamp,
        [routedAiCoreLite, routedAiCore, enrichedKnowledgeBase, routedDoctrine].filter(Boolean).join('\n')
      );
      const runtimeContext = Object.freeze(Object.assign({}, baseRuntimeContext, {
        physicalPresenceConstraint: physicalPresenceConstraint || null,
        territoryContext: territoryContext || null,
        validationContext: this._buildResponseValidationContext_({
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
          requestPurpose: requestPurpose
        })
      }));
      const scheduleContext = this._resolveScheduleContext(
        `${messageDetails.subject || ''}\n${messageDetails.body || ''}`,
        enrichedKnowledgeBase,
        runtimeContext.temporal,
        detectedLanguage,
        runtimeContext.temporal.currentDate
      );

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
      const normalizedRelationalPosture = this._normalizeRelationalPostureAlias_(quickCheck.relational_posture);
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
      const promptEngineSettings = (typeof CONFIG !== 'undefined' && CONFIG.PROMPT_ENGINE && typeof CONFIG.PROMPT_ENGINE === 'object')
        ? CONFIG.PROMPT_ENGINE
        : {};
      const configuredResponseFocusMinConfidence = Number(promptEngineSettings.RESPONSE_FOCUS_MIN_CONFIDENCE);
      const responseFocusMinConfidence = Number.isFinite(configuredResponseFocusMinConfidence)
        ? Math.max(0, Math.min(1, configuredResponseFocusMinConfidence))
        : 0.65;
      const responseFocusHintConfidence = Number(responseFocusHintState && responseFocusHintState.responseFocusHintConfidence);
      const hasResponseFocusHintSignalForResponseStrategy = Boolean(
        responseFocusHintState &&
        responseFocusHintState.responseFocusHint &&
        Number.isFinite(responseFocusHintConfidence) &&
        responseFocusHintConfidence >= responseFocusMinConfidence
      );
      const categoryBlocksPostureStrategy = [
        'formal',
        'sbattezzo',
        'document_submission',
        'document_submission_with_question',
        'quotation'
      ].includes(String(categoryHintSource || '').trim().toLowerCase());
      const requestTypeBlocksPostureStrategy = Boolean(
        requestTypeName === 'formal' ||
        requestTypeName === 'sbattezzo' ||
        (requestType && requestType.isSbattezzo === true)
      );
      const hasStrongerResponseRoutingSignal = Boolean(
        categoryBlocksPostureStrategy ||
        requestTypeBlocksPostureStrategy ||
        physicalPresenceConstraint ||
        hasGoalContinuitySignalForResponseStrategy ||
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
        sponsorGuidancePolicy: this._deriveSponsorGuidancePolicy_(messageDetails.subject, messageDetails.body, attachmentIntentContext, quickCheck.needs_sponsor_guidance, detectedLanguage),
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

      const documentConsistency = this.config.documentConsistencyCheckEnabled
        ? this._evaluateDocumentConsistency_(
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
        quickDocumentDelivery &&
        quickDocumentDelivery.source === 'quick_check' &&
        quickDocumentDelivery.expected_document === true &&
        quickDocumentDelivery.expected_document_description
      );
      const needsSemanticConsistencyCheck = Boolean(
        this.config.documentConsistencyCheckEnabled &&
        documentConsistency &&
        (
          documentConsistency.mode === 'unknown_expected' ||
          (hasExplicitQuickDocumentExpectation && documentConsistency.mode !== 'mismatch')
        ) &&
        physicalAttachmentsDetected &&
        (textFromAttachments || (Array.isArray(attachmentItems) && attachmentItems.length > 0))
      );
      const semanticConsistency = needsSemanticConsistencyCheck
        ? this._evaluateAttachmentSemanticConsistency_({
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

      const hasDocumentDeliveryIncongruent = documentDeliveryModel.status === 'incongruent';
      const hasDocumentDeliveryUnverified = documentDeliveryModel.status === 'unverified_attachment';
      const hasDocumentDeliveryBlockingIssue = Boolean(
        hasExpectedDocumentMissing ||
        hasDocumentMismatch ||
        hasDocumentDeliveryIncongruent ||
        hasDocumentDeliveryUnverified
      );
      const effectiveDocumentMismatchReason = documentMismatchReason || documentDeliveryModel.blockReason || null;
      const shouldUseReceiptOnly = !hasDocumentDeliveryBlockingIssue &&
        (forceReceiptOnlyForSubmission || hasRiskyUnknownReceived);
      const shouldSkipValidationForReceiptOnly = shouldUseReceiptOnly;
      let injectedMissingDocumentDirective = null;
      let injectedMismatchDirective = null;
      if (hasExpectedDocumentMissing) {
        const expectedDocumentLabel = this._formatExpectedDocumentLabel_(
          (quickDocumentDelivery && quickDocumentDelivery.expected_document_description) ||
          (quickAttachmentIntent && quickAttachmentIntent.expected_attachment_description) ||
          ''
        );
        injectedMissingDocumentDirective = `DOCUMENTO ATTESO NON DISPONIBILE: Scrivi: "Non troviamo allegata né riportata nel testo ${expectedDocumentLabel}. Può cortesemente reinviarla o inserirne i dati nel corpo del messaggio?" Usa questa richiesta come contenuto principale, con saluto istituzionale.`;
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

        if (hasDocumentDeliveryUnverified) {
          directiveText = [
            'Quando il contenuto dell’allegato non è verificabile con certezza, scrivi in modo diretto e cortese:',
            '"Abbiamo ricevuto l’allegato, ma non possiamo confermare con certezza che corrisponda a [documento atteso]. La invitiamo a verificarlo e, se necessario, a reinviare il file corretto."',
            'Sostituisci [documento atteso] con il documento atteso quando disponibile; altrimenti usa "quanto annunciato".',
            'Non confermare che il documento sia corretto o completo.',
            'Non usare formule come "sembra non corrispondere", "non corrisponde", "allegato incongruo", "allegato sbagliato" o "allegato errato".'
          ].join(' ');
          prefixMsg = 'AVVISO ALLEGATO NON VERIFICABILE:';
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
          injectedMismatchDirective = `${prefixMsg} ${directiveText} Documento atteso/motivo: ${effectiveDocumentMismatchReason}. Subito dopo l'avviso, rispondi comunque in modo completo e operativo alla richiesta contenuta nell'email, usando il testo del messaggio e il resto del contesto disponibile.`;
        } else {
          injectedMismatchDirective = `${prefixMsg} ${directiveText} Documento atteso/motivo: ${effectiveDocumentMismatchReason}. Per una consegna senza domande, usa solo questo avviso e il saluto istituzionale.`;
        }
        systemDirectives.unshift(injectedMismatchDirective);
      } else if (hasRiskyUnknownReceived) {
        console.warn(`   ⚠️ Documento non classificabile in contesto sponsor: atteso=${documentConsistency.expected || 'unknown'} ricevuto=unknown`);
      }
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
        result.status = 'dilata';
        result.reason = 'near_deadline_before_generation';
        result.retryDelayMs = 60000;
        return result;
      }

      const generationPlan = this._buildGenerationStrategies_(this.geminiService, {
        warn: (message) => console.warn(message)
      });
      const attemptStrategy = Array.isArray(generationPlan.attemptStrategy)
        ? generationPlan.attemptStrategy
        : [];
      const fallbackModelName = generationPlan.fallbackModelName || 'gemini-3.6-flash';

      if (shouldUseReceiptOnly) {
        response = this._buildReceiptOnlySubmissionResponse_(
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
      response = (this.validator && typeof this.validator._rimuoviThinkingLeak === 'function')
        ? this.validator._rimuoviThinkingLeak(response)
        : response;

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
        response = effectiveSalutationModeKey === 'full_warm'
          ? response.replace(/^(Carissimo|Carissima)\b/gm, 'Gentile')
          : response.replace(/^(Caro|Cara|Carissimo|Carissima)\b/gm, 'Gentile');
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

      if (this.config.validationEnabled && !shouldUseReceiptOnly) {
        const fullValidationKB = [
          enrichedKnowledgeBase,
          routedAiCoreLite,
          routedAiCore,
          routedDoctrine
        ].filter(Boolean).join('\n\n');
        validation = this.validator.validateResponse(
          finalResponse,
          detectedLanguage,
          fullValidationKB,
          messageDetails.body,
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
            effectiveSalutationMode,
            validationRuntimeContext
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
          retryResponse = (this.validator && typeof this.validator._rimuoviThinkingLeak === 'function')
            ? this.validator._rimuoviThinkingLeak(retryResponse)
            : retryResponse;
          retryResponse = this._addTimeDiscrepancyNoteIfNeeded(
            retryResponse,
            { ...messageDetails, body: messageDetails.body || '' },
            detectedLanguage
          );
          retryResponse = this._sanitizeUnrequestedSponsorGuidance_(
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
          ? ((typeof normalizeValidationScore === 'function')
            ? normalizeValidationScore(configuredWarningThreshold)
            : Math.max(0, Math.min(1, configuredWarningThreshold > 1 ? configuredWarningThreshold / 100 : configuredWarningThreshold)))
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
          markHandledUnreadOnce();
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
      } catch (e) {
        const errorMessage = e && e.message ? e.message : String(e);
        const classifiedSendError = this._classifyError(e);
        const ambiguousSendOutcome = classifiedSendError.type === 'NETWORK' || classifiedSendError.type === 'TIMEOUT';
        if (!ambiguousSendOutcome) {
          this._rollbackSendTransaction(candidate.getId(), sendTxn);
        } else {
          // Gmail può aver accettato il messaggio prima che il client riceva un
          // timeout/errore di rete: promuoviamo l'idempotency marker a `sent`
          // per evitare un replay automatico alla ripresa del batch.
          this._commitSendTransaction(candidate.getId(), sendTxn);
          try {
            markHandledUnreadOnce();
          } catch (markError) {
            threadLogger.warn(`Errore label dopo invio ambiguo silenziato: ${markError.message}`);
          }
        }
        console.error(`   🛑 Errore invio Gmail: ${errorMessage}`);

        // Errori transienti: lascia il messaggio eleggibile per retry automatico.
        if (!classifiedSendError.retryable) {
          try {
            markFailureForCurrentBurst('error');
          } catch (markError) {
            console.warn(`⚠️ Errore label su thread in errore silenziato: ${markError.message}`);
          }
        } else if (ambiguousSendOutcome) {
          console.warn(`   ↻ Errore invio ambiguo (${classifiedSendError.type}) - idempotenza promossa e messaggio marcato IA`);
        } else {
          console.warn(`   ↻ Errore invio retryable (${classifiedSendError.type}) - nessuna marcatura permanente`);
        }

        result.status = 'error';
        result.error = `gmail_send_failed: ${errorMessage}`;
        result.errorClass = classifiedSendError.type;
        return result;
      }

      // Chiude il burst subito dopo l'invio confermato: memoria, cleanup e label
      // di revisione sono post-processing e non devono lasciare il messaggio
      // riprocessabile in caso di errore successivo.
      markHandledUnreadOnce();

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
        if (shouldLabelForReview || hasDocumentMismatch) {
          this._addValidationErrorLabel(candidate, {
            reason: hasDocumentMismatch ? 'document_consistency_prudent_response' : 'validation_warning',
            validation: validation,
            subject: messageDetails.subject
          });
        }
      } catch (labelErr) {
        console.warn(`⚠️ Label di verifica non applicata (non bloccante): ${labelErr.message}`);
      }

      // ====================================================================
      // STEP 11: AGGIORNA MEMORIA
      // ====================================================================
      const providedTopics = this._detectProvidedTopics(response);

      const topicsWithObjects = providedTopics.map(topic => ({
        topic: topic,
        userReaction: 'unknown',
        context: null,
        timestamp: processingTimestamp.toISOString()
      }));

      const memorySummary = this._buildMemorySummary({
        existingSummary: memoryContext.memorySummary || '',
        responseText: response,
        providedTopics: providedTopics,
        referenceDate: processingTimestamp
      });

      const inferredReactionData = (memoryContext.providedInfo && memoryContext.providedInfo.length > 0)
        ? this._computeUserReaction(messageDetails.body, memoryContext.providedInfo)
        : null;

      const memoryUpdate = {
        language: detectedLanguage,
        category: categoryHintSource || classification.category || requestTypeName,
        _baseMemorySummary: memoryContext.memorySummary || '',
        _incrementMessageCount: true
      };
      const contextualFlagsUpdate = this._deriveContextualFlagsUpdate_({
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
      markHandledUnreadOnce();
      result.status = 'replied';
      result.durationMs = Date.now() - startTime;
      threadLogger.info(`Thread processato in ${result.durationMs}ms`, { duration: result.durationMs });
      return result;

    } catch (error) {
      threadLogger.error(`Errore elaborazione thread: ${error.message}`, { stack: error && error.stack ? error.stack : undefined });

      if (replySent) {
        threadLogger.warn('Errore post-invio: thread non etichettato come errore perché la risposta è stata già inviata');
        try {
          markHandledUnreadOnce();
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
    const previousGmailCounterLockCovered = this.gmailService
      ? this.gmailService._gmailCounterLockCovered
      : undefined;
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
        if (this.gmailService) {
          this.gmailService._gmailCounterLockCovered = true;
        }
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
        const safetyValveLimit = this._getSafetyValveReducedLimit_(resolved);
        const effectiveResolved = safetyValveLimit === null ? resolved : safetyValveLimit;
        if (safetyValveLimit !== null) {
          runLogger.warn(`🚨 Safety Valve persistita: MAX_EMAILS_PER_RUN effettivo ${resolved} → ${safetyValveLimit}.`);
        }
        const sanitized = Number.isNaN(effectiveResolved) ? 10 : effectiveResolved;
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
      let labeledMessageIds = new Set();
      let skippedMessageIds = new Set();
      let messageLabelCachesPreloaded = false;
      const canPreloadMessageLabelCaches = this.gmailService && typeof this.gmailService.getMessageIdsWithLabel === 'function';
      const addIdsToSet = (targetSet, ids) => {
        if (!(targetSet instanceof Set)) return;
        if (ids instanceof Set) {
          ids.forEach((id) => targetSet.add(id));
          return;
        }
        if (Array.isArray(ids)) {
          ids.forEach((id) => targetSet.add(id));
        }
      };
      const preloadMessageLabelCaches = () => {
        if (messageLabelCachesPreloaded) return;
        if (!canPreloadMessageLabelCaches) {
          runLogger.warn('gmailService.getMessageIdsWithLabel non disponibile: continuo senza cache label pre-caricata.');
          messageLabelCachesPreloaded = true;
          return;
        }

        try {
          addIdsToSet(
            labeledMessageIds,
            this.gmailService.getMessageIdsWithLabel(this.config.labelName, true, { onlyUnread: true })
          );
        } catch (e) {
          runLogger.error(`Impossibile pre-caricare gli ID etichettati (${e.message}). Interrompo il batch per evitare risposte duplicate.`);
          throw e;
        }

        // Include anche i messaggi unread già marcati come Errore/Verifica:
        // evitiamo retry infiniti del singolo messaggio, ma senza oscurare l'intero thread.
        try {
          addIdsToSet(
            labeledMessageIds,
            this.gmailService.getMessageIdsWithLabel(this.config.errorLabelName, true, { onlyUnread: true })
          );
          addIdsToSet(
            labeledMessageIds,
            this.gmailService.getMessageIdsWithLabel(this.config.validationErrorLabel, true, { onlyUnread: true })
          );
        } catch (e) {
          runLogger.warn(`Impossibile pre-caricare ID error/validation (${e.message}). Continuo con sola cache IA.`);
        }

        // Pre-caricamento degli ID dei messaggi con etichetta skip (·)
        // per evitare ri-discovery di thread già valutati in foreign_only.
        if (languageMode === 'foreign_only') {
          try {
            addIdsToSet(
              skippedMessageIds,
              this.gmailService.getMessageIdsWithLabel(this.config.skipLabelName, true, { onlyUnread: true })
            );
            if (skippedMessageIds.size > 0) {
              console.log(`   🌐 Pre-caricati ${skippedMessageIds.size} ID messaggi skip (·) per fast-skip`);
            }
          } catch (e) {
            console.warn(`⚠️ Impossibile pre-caricare gli ID skip (${e.message}). Continuo senza cache skip.`);
          }
        }

        messageLabelCachesPreloaded = true;
      };

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

          const discoveryOptions = {};
          const staleOnlyMs = this._getFiniteOptionNumber_(options, 'staleOnlyMs');
          if (Number.isFinite(staleOnlyMs)) {
            discoveryOptions.staleOnlyMs = staleOnlyMs;
          }
          if (canPreloadMessageLabelCaches) {
            discoveryOptions.blacklistMessageIds = labeledMessageIds;
            discoveryOptions.skipBlacklistMessageIds = skippedMessageIds;
            discoveryOptions.preloadBlacklistMessageIds = preloadMessageLabelCaches;
          }

          threads = this.gmailService.getUnprocessedUnreadThreads(
            this.config.labelName,
            this.config.errorLabelName,
            this.config.validationErrorLabel,
            this.config.searchPageSize || 150,
            discoveryPoolSize,
            3,
            labelsDaIgnorare,
            discoveryOptions
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

      if (!messageLabelCachesPreloaded) {
        try {
          preloadMessageLabelCaches();
        } catch (e) {
          return { total: 0, replied: 0, filtered: 0, errors: 1, skipped: 0, reason: 'label_cache_failed' };
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
        skipped_loop: 0,
        dilata: 0
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
          processedCount++;
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
          { ...options, logger: runLogger, lockAlreadyCovered: threadLockAlreadyCovered }
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
            60000
          );
          break;
        }

        if (result && (result.errorClass === 'SYSTEM_ERROR' || result.errorClass === 'CONFIG_ERROR' || result.errorClass === 'INVALID_API_KEY')) {
          runLogger.warn('⚠️ Stop batch: errore di sistema/configurazione, salvo checkpoint per evitare cascata di error label.');
          deferBatchCheckpoint(
            threads,
            index,
            300000
          );
          break;
        }

        if (result && result.status === 'dilata') {
          const senderThrottleWindowSeconds = (typeof CONFIG !== 'undefined' && Number(CONFIG.SENDER_THROTTLE_WINDOW_SECONDS) > 0)
            ? Number(CONFIG.SENDER_THROTTLE_WINDOW_SECONDS)
            : 60;
          const configuredRetryDelayMs = Number(result.retryDelayMs);
          const dilataDelayMs = Number.isFinite(configuredRetryDelayMs) && configuredRetryDelayMs > 0
            ? Math.max(1000, Math.floor(configuredRetryDelayMs))
            : Math.max(1000, Math.floor(senderThrottleWindowSeconds * 1000) + 5000);
          stats.dilata++;
          runLogger.info(`Thread ${index + 1}/${threads.length} - Dilata: ${result.reason || 'rinvio temporaneo'}`);
          deferBatchCheckpoint(threads, index, dilataDelayMs);
          break;
        }

        // Vincola il numero assoluto di thread analizzati nel run, inclusi
        // quelli scartati dopo pre-check/processThread, per evitare batch
        // serverless lunghi su code composte quasi solo da skip.
        processedCount++;

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
        dilata: stats.dilata,
        errors: stats.errors,
        duration: Date.now() - this._startTime
      });

      if (!deferredBatchCheckpoint) {
        this._clearBatchCheckpoint_('batch completato');
      }

      return stats;

    } finally {
      restoreRunServiceLoggers();
      if (this.gmailService) {
        if (typeof previousGmailCounterLockCovered === 'undefined') {
          delete this.gmailService._gmailCounterLockCovered;
        } else {
          this.gmailService._gmailCounterLockCovered = previousGmailCounterLockCovered;
        }
      }
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
      }
      this._deleteResumeBatchTriggers_(this._getResumeBatchTriggers_());
      console.log(`🧹 Checkpoint batch ripulito (${reason || 'batch completato'}).`);
    } catch (e) {
      console.warn(`⚠️ Errore pulizia checkpoint batch: ${e.message}`);
    }
  }

  _getResumeBatchTriggers_() {
    if (typeof ScriptApp === 'undefined' ||
      !ScriptApp ||
      typeof ScriptApp.getProjectTriggers !== 'function') {
      return [];
    }
    try {
      return ScriptApp.getProjectTriggers().filter(trigger => {
        try {
          return trigger &&
            typeof trigger.getHandlerFunction === 'function' &&
            trigger.getHandlerFunction() === 'resumeEmailBatchFromCheckpoint';
        } catch (_) {
          return false;
        }
      });
    } catch (e) {
      console.warn(`⚠️ Lettura trigger ripresa batch fallita: ${e.message}`);
      return [];
    }
  }

  _deleteResumeBatchTriggers_(triggers, keepTrigger) {
    if (typeof ScriptApp === 'undefined' ||
      !ScriptApp ||
      typeof ScriptApp.deleteTrigger !== 'function') {
      return 0;
    }
    let deleted = 0;
    (Array.isArray(triggers) ? triggers : this._getResumeBatchTriggers_()).forEach(trigger => {
      if (!trigger || (keepTrigger && trigger.getUniqueId() === keepTrigger.getUniqueId())) return;
      try {
        ScriptApp.deleteTrigger(trigger);
        deleted++;
      } catch (_) { }
    });
    return deleted;
  }

  _getQuotaCheckpointDelayMs_(result, _remainingTimeMs) {
    const raw = [
      result && result.errorClass,
      result && result.error,
      result && result.reason
    ]
      .filter(value => typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'undefined')
      .join(' ')
      .toLowerCase();

    const looksDailyQuota =
      raw.includes('daily') ||
      raw.includes('giornal') ||
      raw.includes('rpd');

    if (looksDailyQuota) {
      return -1;
    }

    // Quota non chiaramente giornaliera: RPM/TPM e transient quota si resettano
    // rapidamente. Il tempo residuo del trigger corrente non deve amplificare il backoff.
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
      const previousPendingCount = Number(previousCheckpoint && previousCheckpoint.pendingCount);
      const isSameCheckpoint = storedPendingThreadIds.length === previousPendingThreadIds.length &&
        storedPendingThreadIds.every((id, idx) => id === previousPendingThreadIds[idx]) &&
        (!Number.isFinite(previousPendingCount) || previousPendingCount === pendingThreadIds.length);
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
        const existing = this._getResumeBatchTriggers_();

        if (delayMs === -1) {
          try {
            const conservativeResumeMs = 18 * 60 * 60 * 1000;
            const createdTrigger = ScriptApp.newTrigger('resumeEmailBatchFromCheckpoint').timeBased().after(conservativeResumeMs).create();
            this._deleteResumeBatchTriggers_(existing, createdTrigger);
            console.log(`⏸️ Checkpoint batch salvato (${checkpoint.pendingCount} thread residui), trigger pianificato tra ~18h (quota giornaliera Gmail esaurita).`);
          } catch (triggerError) {
            console.error(`❌ Impossibile creare trigger di ripresa batch; trigger preesistenti preservati: ${triggerError.message}`);
          }
        } else {
          try {
            const safeDelayMs = Number.isFinite(delayMs) && delayMs > 0
              ? Math.max(1000, Math.floor(delayMs))
              : (60 * 1000);
            const createdTrigger = ScriptApp.newTrigger('resumeEmailBatchFromCheckpoint').timeBased().after(safeDelayMs).create();
            this._deleteResumeBatchTriggers_(existing, createdTrigger);
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
    const localPart = atIndex >= 0 ? email.substring(0, atIndex) : '';
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

  _normalizeConversationEmailAddress_(rawEmail) {
    const normalized = this._normalizeEmailAddress_(rawEmail);
    const atIdx = normalized.lastIndexOf('@');
    if (atIdx <= 0) return normalized;

    const local = normalized.substring(0, atIdx).replace(/\+.*/, '');
    const domain = normalized.substring(atIdx + 1);
    return `${local}@${domain}`;
  }

  _getFiniteOptionNumber_(options, key) {
    if (!options || typeof options !== 'object') return null;
    const rawValue = options[key];
    if (rawValue === null || rawValue === undefined || rawValue === '') return null;
    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
  }

  _normalizeQuickAttachmentBoolean_(value) {
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', 'yes', 'si', 'sì', '1'].includes(normalized)) return true;
      if (['false', 'no', '0'].includes(normalized)) return false;
    }
    return false;
  }

  _resolveQuickCheckAttachmentIntent_(quickCheck = {}) {
    const safeQuickCheck = (quickCheck && typeof quickCheck === 'object') ? quickCheck : {};
    const explicit = safeQuickCheck.attachment_intent;
    if (explicit && typeof explicit === 'object') {
      const expectedDescription = String(explicit.expected_attachment_description || '').trim().slice(0, 200);
      const requiresReading = this._normalizeQuickAttachmentBoolean_(explicit.requires_attachment_reading);
      const mentionsAttachment = this._normalizeQuickAttachmentBoolean_(explicit.mentions_attachment_or_document) ||
        requiresReading ||
        expectedDescription.length > 0;
      return {
        mentions_attachment_or_document: mentionsAttachment,
        expected_attachment_description: expectedDescription,
        requires_attachment_reading: requiresReading,
        reason: String(explicit.reason || '').trim().slice(0, 200),
        source: 'quick_check'
      };
    }

    const responseStrategy = String(safeQuickCheck.response_strategy || '').trim().toLowerCase();
    const responseFocusHint = String(safeQuickCheck.response_focus_hint || '').trim().toLowerCase();
    const newInformation = Array.isArray(safeQuickCheck.new_information_provided)
      ? safeQuickCheck.new_information_provided.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const topic = String(
      (safeQuickCheck.classification && safeQuickCheck.classification.topic) ||
      safeQuickCheck.topic ||
      ''
    ).trim();
    const reason = String(safeQuickCheck.reason || '').trim();
    const documentPattern = /\b(document\w*|scheda|sched[ae]|modul\w*|allegat\w*|iscrizion\w*|certificat\w*|attestat\w*|file)\b/i;
    const newInfoDocument = newInformation.find((item) => documentPattern.test(item)) || '';
    const topicOrReasonText = `${topic} ${reason}`;
    const hasTopicOrReasonDocument = documentPattern.test(topicOrReasonText);
    const inferredRequiresReading = responseStrategy === 'confirm_receipt' ||
      responseFocusHint === 'acknowledge_document_without_reopening_procedure' ||
      !!newInfoDocument ||
      hasTopicOrReasonDocument;
    const expectedDescription = (newInfoDocument || (documentPattern.test(topic) ? topic : '') || (documentPattern.test(reason) ? reason : '')).slice(0, 200);

    return {
      mentions_attachment_or_document: inferredRequiresReading,
      expected_attachment_description: expectedDescription,
      requires_attachment_reading: inferredRequiresReading,
      reason: inferredRequiresReading
        ? `fallback quick-check: ${[
          responseStrategy === 'confirm_receipt' ? 'response_strategy=confirm_receipt' : '',
          responseFocusHint === 'acknowledge_document_without_reopening_procedure' ? 'response_focus_hint=document_ack' : '',
          newInfoDocument ? 'new_information_provided=document' : '',
          hasTopicOrReasonDocument ? 'topic_or_reason=document' : ''
        ].filter(Boolean).join(', ')}`
        : '',
      source: 'quick_check_fallback'
    };
  }

  _resolveQuickCheckDocumentDelivery_(quickCheck = {}) {
    const safeQuickCheck = (quickCheck && typeof quickCheck === 'object') ? quickCheck : {};
    const explicit = safeQuickCheck.document_delivery;
    const normalizeChannel = (value) => {
      const normalized = String(value || '').trim().toLowerCase();
      return ['attachment', 'body', 'both', 'unclear'].includes(normalized) ? normalized : 'unclear';
    };

    if (explicit && typeof explicit === 'object') {
      const expectedDescription = String(explicit.expected_document_description || '').trim().slice(0, 240);
      const bodyContainsFilled = this._normalizeQuickAttachmentBoolean_(explicit.body_contains_filled_document);
      const requiresFileAttachment = this._normalizeQuickAttachmentBoolean_(explicit.requires_file_attachment);
      const missingIfNoAttachment = this._normalizeQuickAttachmentBoolean_(explicit.missing_document_if_no_attachment);
      const expectedDocument = this._normalizeQuickAttachmentBoolean_(explicit.expected_document) ||
        expectedDescription.length > 0 ||
        bodyContainsFilled ||
        requiresFileAttachment ||
        missingIfNoAttachment;
      return {
        expected_document: expectedDocument,
        expected_document_description: expectedDescription,
        delivery_channel: normalizeChannel(explicit.delivery_channel),
        body_contains_filled_document: bodyContainsFilled,
        requires_file_attachment: requiresFileAttachment,
        missing_document_if_no_attachment: missingIfNoAttachment,
        reason: String(explicit.reason || '').trim().slice(0, 240),
        source: 'quick_check'
      };
    }

    const responseStrategy = String(safeQuickCheck.response_strategy || '').trim().toLowerCase();
    const responseFocusHint = String(safeQuickCheck.response_focus_hint || '').trim().toLowerCase();
    const newInformation = Array.isArray(safeQuickCheck.new_information_provided)
      ? safeQuickCheck.new_information_provided.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const topic = String(
      (safeQuickCheck.classification && safeQuickCheck.classification.topic) ||
      safeQuickCheck.topic ||
      ''
    ).trim();
    const reason = String(safeQuickCheck.reason || '').trim();
    const text = `${topic} ${reason} ${newInformation.join(' ')}`;
    const documentPattern = /\b(document\w*|scheda|sched[ae]|modul\w*|allegat\w*|iscrizion\w*|certificat\w*|attestat\w*|file|dati\s+compilat\w*)\b/i;
    const attachmentChannelPattern = /\b(allegat\w*|file|pdf|scansion\w*)\b/i;
    const deliveryPattern = /\b(?:alleg\w*|invi(?:o|amo|a)\b|trasmett(?:o|iamo)\b|consegn\w*|mand(?:o|iamo)\b|inoltr(?:o|iamo)\b|ecco|riport(?:o|iamo)\b|compilat[oaie])\b/i;
    const newInfoDocument = newInformation.find((item) => documentPattern.test(item)) || '';
    const topicReasonText = `${topic} ${reason}`;
    const hasTopicReasonDelivery = documentPattern.test(topicReasonText) && deliveryPattern.test(topicReasonText);
    const expectedDocument = !!newInfoDocument ||
      hasTopicReasonDelivery ||
      responseStrategy === 'confirm_receipt' ||
      responseFocusHint === 'acknowledge_document_without_reopening_procedure';
    const expectedDescription = (
      newInfoDocument ||
      (hasTopicReasonDelivery && documentPattern.test(topic) ? topic : '') ||
      (hasTopicReasonDelivery && documentPattern.test(reason) ? reason : '')
    ).slice(0, 240);
    const requiresFileAttachment = expectedDocument && attachmentChannelPattern.test(text);

    return {
      expected_document: expectedDocument,
      expected_document_description: expectedDescription,
      delivery_channel: requiresFileAttachment ? 'attachment' : 'unclear',
      body_contains_filled_document: false,
      requires_file_attachment: requiresFileAttachment,
      missing_document_if_no_attachment: requiresFileAttachment && expectedDocument,
      reason: expectedDocument
        ? `fallback quick-check: ${[
          responseStrategy === 'confirm_receipt' ? 'response_strategy=confirm_receipt' : '',
          responseFocusHint === 'acknowledge_document_without_reopening_procedure' ? 'response_focus_hint=document_ack' : '',
          expectedDescription ? 'document_description' : '',
          requiresFileAttachment ? 'attachment_channel' : ''
        ].filter(Boolean).join(', ')}`
        : '',
      source: 'quick_check_fallback'
    };
  }

  _buildDocumentDeliveryModel_({
    subject,
    body,
    quickDocumentDelivery,
    quickAttachmentIntent,
    physicalAttachmentsDetected,
    attachmentItems,
    textFromAttachments
  } = {}) {
    const bodyContainsUsableDocumentContent = Boolean(
      (quickDocumentDelivery && quickDocumentDelivery.body_contains_filled_document === true) ||
      this._bodyLooksLikeFilledDocument_(body)
    );
    const announcedByBody = this._bodyAnnouncesDocumentDelivery_(body, subject);
    const expectsDocument = Boolean(
      bodyContainsUsableDocumentContent ||
      announcedByBody ||
      (quickDocumentDelivery && quickDocumentDelivery.expected_document === true) ||
      (quickDocumentDelivery && quickDocumentDelivery.missing_document_if_no_attachment === true)
    );
    const normalizedAttachmentText = String(textFromAttachments || '').trim();
    const hasPhysicalAttachment = Boolean(
      physicalAttachmentsDetected ||
      (Array.isArray(attachmentItems) && attachmentItems.length > 0)
    );
    const hasAttachmentAnalyzedContent = Boolean(normalizedAttachmentText);
    const hasUsableAttachmentText = Boolean(
      normalizedAttachmentText &&
      !/^\[Avviso di sistema:/i.test(normalizedAttachmentText)
    );
    const hasUsableAttachmentContent = Boolean(hasPhysicalAttachment || hasUsableAttachmentText);
    const hasAttachmentContent = hasUsableAttachmentContent;
    const hasDocumentContentAvailable = Boolean(hasUsableAttachmentContent || bodyContainsUsableDocumentContent);
    const expectedDescription = String(
      (quickDocumentDelivery && quickDocumentDelivery.expected_document_description) ||
      (quickAttachmentIntent && quickAttachmentIntent.expected_attachment_description) ||
      ''
    ).trim();
    const expectedLabel = this._formatExpectedDocumentLabel_(expectedDescription);

    let status = 'none';
    let source = 'none';
    if (expectsDocument && bodyContainsUsableDocumentContent) {
      status = 'received_body';
      source = 'body';
    } else if (expectsDocument && hasAttachmentContent) {
      status = 'received_attachment';
      source = 'attachment';
    } else if (expectsDocument) {
      status = 'missing';
      source = 'announced';
    } else if (hasAttachmentContent) {
      status = 'unannounced_attachment';
      source = 'attachment';
    }

    const blocksReceiptOnly = status === 'missing';
    const hasExpectedDocumentMissing = status === 'missing';
    return {
      expectedDocumentDescription: expectedDescription,
      expectedDocumentLabel: expectedLabel,
      announcedByBody: announcedByBody,
      expectsDocument: expectsDocument,
      bodyContainsUsableDocumentContent: bodyContainsUsableDocumentContent,
      hasPhysicalAttachment: hasPhysicalAttachment,
      hasAttachmentAnalyzedContent: hasAttachmentAnalyzedContent,
      hasUsableAttachmentText: hasUsableAttachmentText,
      hasUsableAttachmentContent: hasUsableAttachmentContent,
      hasAttachmentContent: hasAttachmentContent,
      hasDocumentContentAvailable: hasDocumentContentAvailable,
      hasExpectedDocumentMissing: hasExpectedDocumentMissing,
      status: status,
      source: source,
      isCoherent: status !== 'missing',
      blocksReceiptOnly: blocksReceiptOnly,
      blockReason: blocksReceiptOnly ? 'expected_document_missing' : '',
      receiptOnlyDeliveryChannel: bodyContainsUsableDocumentContent && !hasAttachmentContent
        ? 'body'
        : 'attachment'
    };
  }

  _bodyLooksLikeFilledDocument_(body) {
    const text = String(body || '').trim();
    if (text.length < 80) return false;

    const fieldChecks = [
      { key: 'name', pattern: /\bnome\s*[:\-]\s*\S.{1,}/i },
      { key: 'surname', pattern: /\bcognome\s*[:\-]\s*\S.{1,}/i },
      { key: 'name_surname', pattern: /\bnome\s+(?:e|\/)\s+cognome\s*[:\-]\s*\S.{3,}/i },
      { key: 'phone', pattern: /\b(?:telefono|cellulare|tel\.)\s*[:\-]\s*(?:\+?\d|[0-9])/i },
      { key: 'email', pattern: /\b(?:e-?mail|email)\s*[:\-]\s*[^\s@]+@[^\s@]+\.[^\s@]+/i },
      { key: 'birth_date', pattern: /\bdata\s+di\s+nascita\s*[:\-]\s*\S.{1,}/i },
      { key: 'birth_place', pattern: /\bluogo\s+di\s+nascita\s*[:\-]\s*\S.{1,}/i },
      { key: 'address', pattern: /\bindirizzo\s*[:\-]\s*\S.{3,}/i },
      { key: 'parish', pattern: /\bparrocchia\s*[:\-]\s*\S.{3,}/i },
      { key: 'wedding_date', pattern: /\bdata\s+(?:del\s+)?matrimonio\s*[:\-]\s*\S.{1,}/i },
      { key: 'groom', pattern: /\b(?:sposo|fidanzato)\s*[:\-]\s*\S.{2,}/i },
      { key: 'bride', pattern: /\b(?:sposa|fidanzata)\s*[:\-]\s*\S.{2,}/i }
    ];
    const matched = {};
    fieldChecks.forEach((entry) => {
      if (entry.pattern.test(text)) matched[entry.key] = true;
    });
    const count = Object.keys(matched).length;
    const hasIdentity = Boolean(matched.name || matched.surname || matched.name_surname || matched.groom || matched.bride);
    const hasContact = Boolean(matched.phone || matched.email);
    const hasEventOrAddress = Boolean(matched.birth_date || matched.birth_place || matched.address || matched.parish || matched.wedding_date);

    return count >= 4 || (count >= 3 && hasIdentity && (hasContact || hasEventOrAddress));
  }

  _bodyAnnouncesDocumentDelivery_(body, subject) {
    const text = `${subject || ''} ${body || ''}`;
    const documentPattern = /\b(?:scheda|sched[ae]|modul\w*|document\w*|certificat\w*|attestat\w*|iscrizion\w*)\b/i;
    const deliveryPattern = /\b(?:alleg\w*|invi(?:o|amo|a)\b|trasmett(?:o|iamo)\b|mando|mandiamo|inoltro|inoltriamo|ecco|riport(?:o|iamo)\b|compilat[oaie])\b/i;
    return documentPattern.test(text) && deliveryPattern.test(text);
  }

  _formatExpectedDocumentLabel_(description) {
    const raw = String(description || '').replace(/\s+/g, ' ').trim();
    if (!raw) return 'il documento atteso';
    if (/^(?:il|lo|la|l['’]|un|uno|una|i|gli|le)\s+/i.test(raw)) return raw;
    if (/^sched[ae]\b/i.test(raw)) return `la ${raw}`;
    if (/^documentazione\b/i.test(raw)) return `la ${raw}`;
    if (/^(?:modul|document|certificat|attestat|file)\w*\b/i.test(raw)) return `il ${raw}`;
    return raw;
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
  _getSendIdempotencyBackupTtlMs_() {
    const configured = (typeof CONFIG !== 'undefined' && CONFIG && Number.isFinite(Number(CONFIG.SEND_IDEMPOTENCY_BACKUP_TTL_MS)))
      ? Number(CONFIG.SEND_IDEMPOTENCY_BACKUP_TTL_MS)
      : (36 * 60 * 60 * 1000);
    const cacheTtlMs = 21599 * 1000;
    const maxTtlMs = 7 * 24 * 60 * 60 * 1000;
    return Math.max(cacheTtlMs, Math.min(maxTtlMs, Math.floor(configured)));
  }

  _parseSendIdempotencyBackupValue_(rawValue) {
    if (!rawValue) return null;

    let timestamp = NaN;
    let expiresAt = NaN;
    try {
      const parsed = JSON.parse(rawValue);
      if (parsed && typeof parsed === 'object') {
        timestamp = Number(parsed.ts);
        expiresAt = Number(parsed.expiresAt);
      } else {
        timestamp = Number(parsed);
      }
    } catch (_) {
      timestamp = Number.parseInt(String(rawValue), 10);
    }

    if (!Number.isFinite(timestamp)) return null;
    return {
      timestamp: timestamp,
      expiresAt: Number.isFinite(expiresAt)
        ? expiresAt
        : timestamp + this._getSendIdempotencyBackupTtlMs_()
    };
  }

  _readSendIdempotencyBackup_(messageId, props = null) {
    if (!messageId || !props || typeof props.getProperty !== 'function') return null;
    const key = `sent_backup_${messageId}`;
    let raw = '';
    try {
      raw = props.getProperty(key) || '';
    } catch (e) {
      console.warn(`  Impossibile leggere il backup idempotenza per ${messageId}: ${e.message}`);
      return null;
    }
    if (!raw) return null;

    const parsedMarker = this._parseSendIdempotencyBackupValue_(raw);
    if (!parsedMarker) {
      if (typeof props.deleteProperty === 'function') {
        try { props.deleteProperty(key); } catch (_) { }
      }
      return null;
    }

    if (Date.now() > parsedMarker.expiresAt) {
      if (typeof props.deleteProperty === 'function') {
        try { props.deleteProperty(key); } catch (_) { }
      }
      return null;
    }

    return { key: key, timestamp: parsedMarker.timestamp, expiresAt: parsedMarker.expiresAt };
  }

  _pruneExpiredSendIdempotencyBackups_(props = null, nowTs = Date.now()) {
    if (!props || typeof props.getProperties !== 'function' || typeof props.deleteProperty !== 'function') return;

    let allProps = {};
    try {
      allProps = props.getProperties() || {};
    } catch (e) {
      console.warn(`  Impossibile potare backup idempotenza scaduti: ${e.message}`);
      return;
    }

    Object.keys(allProps).forEach((key) => {
      if (!key || !key.startsWith('sent_backup_')) return;
      const parsedMarker = this._parseSendIdempotencyBackupValue_(allProps[key]);
      if (!parsedMarker || nowTs > parsedMarker.expiresAt) {
        try { props.deleteProperty(key); } catch (_) { }
      }
    });
  }

  _persistSendIdempotencyBackup_(messageId, props = null) {
    if (!messageId || !props || typeof props.setProperty !== 'function') return;
    const nowTs = Date.now();
    const payload = JSON.stringify({
      ts: nowTs,
      expiresAt: nowTs + this._getSendIdempotencyBackupTtlMs_()
    });
    try {
      this._pruneExpiredSendIdempotencyBackups_(props, nowTs);
      props.setProperty(`sent_backup_${messageId}`, payload);
    } catch (e) {
      console.warn(`  Impossibile salvare il backup idempotenza per ${messageId}: ${e.message}`);
    }
  }

  _beginSendTransaction(messageId, skipLock = false) {
    if (!messageId) {
      console.warn('⚠️ Idempotenza non applicabile: messageId assente. Invio bloccato per evitare duplicazioni.');
      return { ok: false, reason: 'missing_message_id' };
    }
    const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
      ? CacheService.getScriptCache()
      : null;

    if (!cache) {
      console.warn('⚠️ CacheService non disponibile: invio bloccato per garantire idempotenza.');
      return { ok: false, reason: 'cache_unavailable' };
    }
    const props = (typeof PropertiesService !== 'undefined' &&
      PropertiesService &&
      typeof PropertiesService.getScriptProperties === 'function')
      ? PropertiesService.getScriptProperties()
      : null;

    const sendingKey = `sending_${messageId}`;
    const startedKey = `sendstarted_${messageId}`;
    const sentKey = `sent_${messageId}`;
    const sendingTtlSeconds = 300;
    const startedTtlSeconds = 900;
    const isStaleMarker = (markerValue, ttlMs) => {
      if (!markerValue) return false;
      const existingTimestamp = Number.parseInt(String(markerValue), 10);
      return !Number.isFinite(existingTimestamp) || (Date.now() - existingTimestamp) > ttlMs;
    };
    const scriptLock = (typeof LockService !== 'undefined' && LockService && typeof LockService.getScriptLock === 'function')
      ? LockService.getScriptLock()
      : null;
    const sendLockWaitMs = (typeof CONFIG !== 'undefined' && Number.isFinite(Number(CONFIG.SEND_TRANSACTION_LOCK_WAIT_MS)))
      ? Math.max(0, Number(CONFIG.SEND_TRANSACTION_LOCK_WAIT_MS))
      : 2000;
    let lockAcquired = false;

    try {
      if (!skipLock) {
        if (!scriptLock || typeof scriptLock.tryLock !== 'function') {
          return { ok: false, reason: 'send_lock_unavailable' };
        }
        lockAcquired = scriptLock.tryLock(sendLockWaitMs);
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
      const persistedSentMarker = this._readSendIdempotencyBackup_(messageId, props);
      if (persistedSentMarker) {
        try {
          cache.put(sentKey, String(persistedSentMarker.timestamp), 21599);
        } catch (cacheRefreshError) {
          console.warn(`  Impossibile ripristinare in cache il marker sent per ${messageId}: ${cacheRefreshError.message}`);
        }
        if (lockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
          try { scriptLock.releaseLock(); } catch (_) { }
        }
        return { ok: false, reason: 'already_sent' };
      }
      const sendingMarker = cache.get(sendingKey);
      if (sendingMarker && !isStaleMarker(sendingMarker, sendingTtlSeconds * 1000)) {
        if (lockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
          try { scriptLock.releaseLock(); } catch (_) { }
        }
        return { ok: false, reason: 'in_flight' };
      }
      if (sendingMarker) {
        console.warn(`⚠️ Marker invio stale rilevato per ${messageId}, sovrascrivo sendingKey`);
      }

      const startedMarker = cache.get(startedKey);
      if (startedMarker && !isStaleMarker(startedMarker, startedTtlSeconds * 1000)) {
        if (lockAcquired && scriptLock && typeof scriptLock.releaseLock === 'function') {
          try { scriptLock.releaseLock(); } catch (_) { }
        }
        return { ok: false, reason: 'send_recently_started' };
      }
      if (startedMarker) {
        console.warn(`⚠️ Marker sendstarted stale rilevato per ${messageId}, consento nuovo tentativo`);
      }

      const nowTs = String(Date.now());
      cache.put(sendingKey, nowTs, sendingTtlSeconds); // 5 minuti
      cache.put(startedKey, nowTs, startedTtlSeconds); // 15 minuti: finestra anti-duplicato per errori ambigui
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
    const props = (typeof PropertiesService !== 'undefined' &&
      PropertiesService &&
      typeof PropertiesService.getScriptProperties === 'function')
      ? PropertiesService.getScriptProperties()
      : null;

    try {
      if (cache) {
        cache.put(`sent_${messageId}`, String(Date.now()), 21599);
      } else {
        console.warn(`  CacheService non disponibile durante commit invio per ${messageId}`);
      }
    } catch (e) {
      console.warn(`  Impossibile committare la transazione in cache per ${messageId}: ${e.message}`);
    } finally {
      this._persistSendIdempotencyBackup_(messageId, props);
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
        return Utilities.formatDate(parsedDate, this._getCachedTimeZone(), 'HH:mm');
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
      return this._formatRomeTimeFallback_(parsedDate);
    }
  }

  _getBusinessDateString(date = new Date()) {
    const safeDateInput = date || Date.now();
    const parsedDate = new Date(safeDateInput);
    if (isNaN(parsedDate.getTime())) return this._formatLocalDateOnly_(new Date());

    if (typeof Utilities !== 'undefined' && Utilities &&
      typeof Utilities.formatDate === 'function') {
      try {
        return Utilities.formatDate(parsedDate, this._getCachedTimeZone(), 'yyyy-MM-dd');
      } catch (_) {
        // Fallback sotto
      }
    }

    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Rome',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(parsedDate);
      const byType = {};
      parts.forEach(part => {
        if (part && part.type) byType[part.type] = part.value;
      });
      if (byType.year && byType.month && byType.day) {
        return `${byType.year}-${byType.month}-${byType.day}`;
      }
    } catch (_) {
      // Fallback minimale sotto quando Intl/timeZone non è disponibile.
    }

    return this._formatLocalDateOnly_(parsedDate);
  }

  _formatLocalDateOnly_(date = new Date()) {
    const safeDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    return this._formatRomeDateFallback_(safeDate);
  }

  _formatRomeTimeFallback_(date = new Date()) {
    const romeDate = this._shiftUtcToRomeWallClockFallback_(date);
    const hour = String(romeDate.getUTCHours()).padStart(2, '0');
    const minute = String(romeDate.getUTCMinutes()).padStart(2, '0');
    return `${hour}:${minute}`;
  }

  _formatRomeDateFallback_(date = new Date()) {
    const romeDate = this._shiftUtcToRomeWallClockFallback_(date);
    const year = String(romeDate.getUTCFullYear());
    const month = String(romeDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(romeDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  _shiftUtcToRomeWallClockFallback_(date = new Date()) {
    const safeDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    return new Date(safeDate.getTime() + this._getRomeOffsetMinutesFallback_(safeDate) * 60000);
  }

  _getRomeOffsetMinutesFallback_(date = new Date()) {
    const safeDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    const year = safeDate.getUTCFullYear();
    const dstStart = this._lastSundayUtc_(year, 2, 31, 1);
    const dstEnd = this._lastSundayUtc_(year, 9, 31, 1);
    const time = safeDate.getTime();
    return time >= dstStart.getTime() && time < dstEnd.getTime() ? 120 : 60;
  }

  _lastSundayUtc_(year, monthIndex, dayOfMonth, hour = 0) {
    const date = new Date(Date.UTC(year, monthIndex, dayOfMonth, hour, 0, 0));
    date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    return date;
  }

  _buildRuntimeContext_(messageDetails = {}, processingTimestamp = new Date(), papalSourceText = '') {
    const processingDate = processingTimestamp instanceof Date && !isNaN(processingTimestamp.getTime())
      ? new Date(processingTimestamp.getTime())
      : new Date();
    const rawMessageDate = messageDetails && messageDetails.date;
    const rawMessageDateValid = rawMessageDate instanceof Date && !isNaN(rawMessageDate.getTime());
    const messageDate = rawMessageDateValid
      ? new Date(rawMessageDate.getTime())
      : processingDate;
    const ageMs = Math.max(0, processingDate.getTime() - messageDate.getTime());
    const ageHours = ageMs / (1000 * 60 * 60);
    const daysAgo = Math.floor(ageHours / 24);

    const temporal = Object.freeze({
      timeZone: this._getCachedTimeZone ? this._getCachedTimeZone() : 'Europe/Rome',
      processingTimestampIso: processingDate.toISOString(),
      processingEpochMs: processingDate.getTime(),
      currentDate: this._getBusinessDateString(processingDate),
      currentTime: this._getBusinessTimeString(processingDate),
      messageDate: this._getBusinessDateString(messageDate),
      messageTime: rawMessageDateValid ? this._getBusinessTimeString(messageDate) : null,
      messageDateAvailable: rawMessageDateValid,
      messageDateSource: rawMessageDateValid ? 'gmail_message_date' : 'processing_fallback',
      messageTimestampIso: messageDate.toISOString(),
      messageEpochMs: messageDate.getTime(),
      ageHours: ageHours,
      daysAgo: daysAgo,
      isOldMessage: rawMessageDateValid && daysAgo >= 1
    });

    const papal = Object.freeze(this._buildPapalRuntimeContext_(papalSourceText));
    const runtimeContext = {
      temporal: temporal,
      papal: papal
    };

    return Object.freeze(runtimeContext);
  }

  _buildPapalRuntimeContext_(sourceText = '') {
    const hasConfig = typeof CONFIG !== 'undefined' && CONFIG;
    const cfg = (hasConfig && CONFIG.PAPAL_CONTEXT)
      ? CONFIG.PAPAL_CONTEXT
      : {};
    let fromPromptEngine = {};
    if (
      this.promptEngine &&
      typeof this.promptEngine._getPapalContext_ === 'function'
    ) {
      try {
        fromPromptEngine = this.promptEngine._getPapalContext_(sourceText) || {};
      } catch (_) {
        fromPromptEngine = {};
      }
    }
    const pick = (...values) => {
      for (const value of values) {
        if (value !== null && typeof value !== 'undefined' && String(value).trim() !== '') return value;
      }
      return '';
    };
    const legacyMinistryStart = hasConfig
      ? pick(CONFIG.CURRENT_POPE_MINISTRY_START, CONFIG.CURRENTPOPEMINISTRYSTART)
      : null;

    return {
      currentName: pick(fromPromptEngine.currentName, cfg.currentName, hasConfig ? CONFIG.CURRENT_POPE_NAME : null, 'Leone XIV'),
      previousName: pick(fromPromptEngine.previousName, cfg.previousName, hasConfig ? CONFIG.PREVIOUS_POPE_NAME : null, 'Papa Francesco'),
      currentSince: pick(fromPromptEngine.currentSince, cfg.currentSince, hasConfig ? CONFIG.CURRENT_POPE_SINCE : null, '2025-05-08'),
      ministryStart: pick(fromPromptEngine.ministryStart, cfg.ministryStart, legacyMinistryStart, '2025-05-18'),
      source: sourceText ? 'knowledge_context' : 'config'
    };
  }

  _getCurrentSeason(referenceDate = new Date(), knowledgeBaseText = '') {
    return this._resolveScheduleContext('', knowledgeBaseText, referenceDate, 'it').season;
  }

  _resolveScheduleContext(requestText = '', knowledgeBaseText = '', currentDateInput = new Date(), language = 'it', responseDateInput = null) {
    const temporalInput = currentDateInput && typeof currentDateInput === 'object' && !(currentDateInput instanceof Date)
      ? currentDateInput
      : null;
    const requestAnchorInput = temporalInput
      ? (temporalInput.messageDate || temporalInput.currentDate || new Date())
      : currentDateInput;
    const responseDateInputResolved = responseDateInput || (temporalInput ? temporalInput.currentDate : currentDateInput);
    const requestAnchorDate = this._coerceBusinessDateOnly_(requestAnchorInput) || this._coerceBusinessDateOnly_(new Date());
    const responseDate = this._coerceBusinessDateOnly_(responseDateInputResolved) || requestAnchorDate;
    const requestAnchorSource = temporalInput
      ? (temporalInput.messageDateSource || (temporalInput.messageDateAvailable === false ? 'processing_fallback' : 'runtime_temporal'))
      : 'argument';
    const messageDateAvailable = temporalInput
      ? temporalInput.messageDateAvailable !== false
      : true;
    const requestedDateInfo = this._resolveRequestedScheduleDate_(requestText, requestAnchorDate, language);
    const resolvedRequestDate = requestedDateInfo.isExplicit &&
      requestedDateInfo.date instanceof Date &&
      !isNaN(requestedDateInfo.date.getTime())
      ? requestedDateInfo.date
      : null;
    if (requestedDateInfo.isExplicit && !resolvedRequestDate) {
      console.warn('⚠️ _resolveScheduleContext: data richiesta esplicita non risolta, fallback a requestAnchorDate');
    }
    const targetDate = resolvedRequestDate || (requestedDateInfo.isExplicit ? requestAnchorDate : responseDate);
    const targetDateFallbackReason = requestedDateInfo.isExplicit && !resolvedRequestDate
      ? 'invalid_requested_date'
      : '';
    const summerRange = this._extractSummerScheduleRange_(knowledgeBaseText, targetDate.getFullYear()) ||
      this._getFormulaSummerScheduleRange_(targetDate.getFullYear());
    const season = this._isDateWithinInclusive_(targetDate, summerRange.start, summerRange.end)
      ? 'estivo'
      : 'invernale';
    const currentEpochDay = this._dateOnlyEpochDay_(responseDate);
    const targetDateIsPast = requestedDateInfo.isExplicit &&
      this._dateOnlyEpochDay_(targetDate) < currentEpochDay;
    const mentionedDateInCurrentYearIsPast = requestedDateInfo.originalInferredDate
      ? this._dateOnlyEpochDay_(requestedDateInfo.originalInferredDate) < currentEpochDay
      : false;

    return {
      season: season,
      currentDate: this._formatDateOnlyIso_(responseDate),
      requestAnchorDate: this._formatDateOnlyIso_(requestAnchorDate),
      requestAnchorSource: requestAnchorSource,
      messageDateAvailable: messageDateAvailable,
      requestAnchorDateIsFallback: messageDateAvailable === false,
      targetDate: this._formatDateOnlyIso_(targetDate),
      targetDateText: this._formatItalianDateLabel_(targetDate),
      isExplicitTarget: requestedDateInfo.isExplicit,
      targetSource: requestedDateInfo.source,
      targetDateFallbackReason: targetDateFallbackReason,
      targetDateIsPast: targetDateIsPast,
      mentionedDateInCurrentYear: requestedDateInfo.originalInferredDate
        ? this._formatDateOnlyIso_(requestedDateInfo.originalInferredDate)
        : '',
      mentionedDateInCurrentYearIsPast: mentionedDateInCurrentYearIsPast,
      temporalIntent: requestedDateInfo.temporalIntent || 'unspecified',
      yearInference: requestedDateInfo.yearInference || 'none',
      summerRangeText: summerRange.text,
      summerStartDate: this._formatDateOnlyIso_(summerRange.start),
      summerEndDate: this._formatDateOnlyIso_(summerRange.end),
      source: summerRange.source
    };
  }

  _resolveRequestedScheduleDate_(text = '', currentDate = new Date(), language = 'it') {
    const normalizedText = String(text || '').toLowerCase();
    const current = this._coerceBusinessDateOnly_(currentDate) || new Date();

    if (/(?<![a-zA-ZÀ-ÿ])dopodomani(?![a-zA-ZÀ-ÿ])/i.test(normalizedText)) {
      return {
        date: this._addDaysToDateOnly_(current, 2),
        isExplicit: true,
        source: 'relative:dopodomani'
      };
    }

    if (/(?<![a-zA-ZÀ-ÿ])domani(?![a-zA-ZÀ-ÿ])/i.test(normalizedText)) {
      return {
        date: this._addDaysToDateOnly_(current, 1),
        isExplicit: true,
        source: 'relative:domani'
      };
    }

    if (/(?<![a-zA-ZÀ-ÿ])oggi(?![a-zA-ZÀ-ÿ])/i.test(normalizedText)) {
      return {
        date: current,
        isExplicit: true,
        source: 'relative:oggi'
      };
    }

    const explicitDate = this._extractExplicitDateFromText_(normalizedText, current.getFullYear());
    if (explicitDate) {
      const normalizedExplicitDate = this._normalizeExplicitDateForTemporalIntent_(explicitDate, normalizedText, current);
      return {
        date: normalizedExplicitDate.date,
        isExplicit: true,
        source: normalizedExplicitDate.source,
        hasExplicitYear: explicitDate.hasExplicitYear === true,
        originalInferredDate: normalizedExplicitDate.originalInferredDate || explicitDate.date,
        temporalIntent: normalizedExplicitDate.temporalIntent,
        yearInference: normalizedExplicitDate.yearInference
      };
    }

    return {
      date: current,
      isExplicit: false,
      source: 'current_date'
    };
  }

  _extractExplicitDateFromText_(text, defaultYear) {
    const monthMap = this._getItalianMonthMap_();
    const monthNames = Object.keys(monthMap).join('|');
    const textualPattern = new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${monthNames})(?:\\s+(\\d{4}))?(?!\\d)`, 'i');
    const textualMatch = String(text || '').match(textualPattern);
    if (textualMatch) {
      const day = parseInt(textualMatch[1], 10);
      const month = monthMap[textualMatch[2]];
      const year = textualMatch[3] ? parseInt(textualMatch[3], 10) : defaultYear;
      const date = this._makeValidDateOnly_(year, month, day);
      if (date) {
        return {
          date: date,
          source: 'explicit:textual',
          hasExplicitYear: Boolean(textualMatch[3])
        };
      }
    }

    const numericMatch = String(text || '').match(/\b(\d{1,2})([\/.-])(\d{1,2})(?:\2(\d{2,4}))?(?![\/.-]\d)\b/);
    if (numericMatch) {
      const day = parseInt(numericMatch[1], 10);
      const month = parseInt(numericMatch[3], 10);
      let year = numericMatch[4] ? parseInt(numericMatch[4], 10) : defaultYear;
      if (year < 100) year += 2000;
      const date = this._makeValidDateOnly_(year, month, day);
      if (date) {
        return {
          date: date,
          source: 'explicit:numeric',
          hasExplicitYear: Boolean(numericMatch[4])
        };
      }
    }

    return null;
  }

  _normalizeExplicitDateForTemporalIntent_(explicitDate, text = '', currentDate = new Date()) {
    const date = explicitDate && explicitDate.date;
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return {
        date: date,
        source: explicitDate ? explicitDate.source : 'explicit:invalid',
        temporalIntent: 'unspecified',
        yearInference: 'none'
      };
    }

    const temporalIntent = this._detectYearlessDateTemporalIntent_(text);
    if (explicitDate.hasExplicitYear === true) {
      return {
        date: date,
        source: explicitDate.source,
        originalInferredDate: date,
        temporalIntent: temporalIntent,
        yearInference: 'explicit_year'
      };
    }

    const current = this._coerceBusinessDateOnly_(currentDate) || new Date();
    const comparison = this._dateOnlyEpochDay_(date) - this._dateOnlyEpochDay_(current);
    if (comparison < 0 && temporalIntent === 'future') {
      const nextDate = this._findValidSameMonthDayInYearDirection_(date, 1);
      return {
        date: nextDate,
        source: `${explicitDate.source}:year_inferred_next`,
        originalInferredDate: date,
        temporalIntent: temporalIntent,
        yearInference: nextDate && nextDate.getFullYear() === date.getFullYear() + 1
          ? 'next_year_from_future_intent'
          : 'next_valid_year_from_future_intent'
      };
    }

    if (comparison > 0 && temporalIntent === 'past') {
      const previousDate = this._findValidSameMonthDayInYearDirection_(date, -1);
      return {
        date: previousDate,
        source: `${explicitDate.source}:year_inferred_previous`,
        originalInferredDate: date,
        temporalIntent: temporalIntent,
        yearInference: previousDate && previousDate.getFullYear() === date.getFullYear() - 1
          ? 'previous_year_from_past_intent'
          : 'previous_valid_year_from_past_intent'
      };
    }

    return {
      date: date,
      source: explicitDate.source,
      originalInferredDate: date,
      temporalIntent: temporalIntent,
      yearInference: comparison < 0 ? 'current_year_past_ambiguous' : 'current_year'
    };
  }

  _detectYearlessDateTemporalIntent_(text = '') {
    const normalized = String(text || '').toLowerCase();
    const futurePattern = /\b(sar(?:à|a|anno)|ci\s+sar(?:à|a|anno)|avr(?:à|a|anno)|farete|celebrerete|terr(?:à|a|anno)|quando\s+(?:sar|avr|terr)|prossim[oaie]|ventura|futura|futuro|domani|dopodomani)\b/i;
    if (futurePattern.test(normalized)) return 'future';

    const pastPattern = /\b(sono\s+state|erano|c['’]?erano|si\s+(?:è|e)\s+(?:tenuta|tenuto|svolta|svolto)|avete\s+(?:celebrato|fatto)|passat[oaie]|scors[oaie])\b/i;
    if (pastPattern.test(normalized)) return 'past';

    return 'unspecified';
  }

  _extractSummerScheduleRange_(knowledgeBaseText = '', year) {
    const text = String(knowledgeBaseText || '');
    if (!text.trim()) return null;

    const lines = text.split(/\r?\n/);
    const preferredLines = lines.filter(line => /periodo\s+estiv/i.test(line));
    const candidates = preferredLines.length > 0 ? preferredLines : lines;

    for (const line of candidates) {
      const parsed = this._parseItalianDateRange_(line, year);
      if (parsed) return parsed;
    }

    return null;
  }

  _parseItalianDateRange_(text, year) {
    const monthMap = this._getItalianMonthMap_();
    const monthNames = Object.keys(monthMap).join('|');
    const pattern = new RegExp(`\\b(?:dal|da)\\s+(\\d{1,2})\\s+(${monthNames})\\s+(?:al|a)\\s+(\\d{1,2})\\s+(${monthNames})\\b`, 'i');
    const match = String(text || '').toLowerCase().match(pattern);
    if (!match) return null;

    const startMonth = monthMap[match[2]];
    const endMonth = monthMap[match[4]];
    const start = this._makeValidDateOnly_(year, startMonth, parseInt(match[1], 10));
    const endYear = endMonth < startMonth ? year + 1 : year;
    const end = this._makeValidDateOnly_(endYear, endMonth, parseInt(match[3], 10));
    if (!start || !end) return null;

    return {
      start: start,
      end: end,
      text: `Dal ${parseInt(match[1], 10)} ${match[2]} al ${parseInt(match[3], 10)} ${match[4]}`,
      source: 'knowledge_base'
    };
  }

  _getFormulaSummerScheduleRange_(year) {
    console.warn('⚠️ Periodo estivo non trovato in KB: uso formula tecnica annuale equivalente.');
    const june26 = this._makeValidDateOnly_(year, 6, 26);
    const daysToNextSunday = (8 - this._getSheetsWeekday_(june26)) % 7;
    const startSunday = this._addDaysToDateOnly_(june26, daysToNextSunday);
    const start = this._addDaysToDateOnly_(startSunday, 1);

    const august30 = this._makeValidDateOnly_(year, 8, 30);
    const end = this._addDaysToDateOnly_(august30, (8 - this._getSheetsWeekday_(august30)) % 7);

    return {
      start: start,
      end: end,
      text: `Dal ${this._formatItalianDateLabelNoYear_(start)} al ${this._formatItalianDateLabelNoYear_(end)}`,
      source: 'fallback_formula'
    };
  }

  _getItalianMonthMap_() {
    return {
      gennaio: 1,
      febbraio: 2,
      marzo: 3,
      aprile: 4,
      maggio: 5,
      giugno: 6,
      luglio: 7,
      agosto: 8,
      settembre: 9,
      ottobre: 10,
      novembre: 11,
      dicembre: 12
    };
  }

  _coerceBusinessDateOnly_(input) {
    if (input === null || typeof input === 'undefined') return null;
    if (typeof input === 'string' && input.trim() === '') return null;

    if (typeof input === 'string') {
      const direct = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (direct) {
        return this._makeValidDateOnly_(
          parseInt(direct[1], 10),
          parseInt(direct[2], 10),
          parseInt(direct[3], 10)
        );
      }
    }

    const parsed = input instanceof Date ? input : new Date(input);
    if (!(parsed instanceof Date) || isNaN(parsed.getTime())) return null;

    const iso = this._getBusinessDateString(parsed);
    const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0, 0);
    }

    return this._makeValidDateOnly_(
      parseInt(match[1], 10),
      parseInt(match[2], 10),
      parseInt(match[3], 10)
    );
  }

  _makeValidDateOnly_(year, month, day) {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  _findValidSameMonthDayInYearDirection_(date, direction) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    const step = direction >= 0 ? 1 : -1;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    for (let offset = 1; offset <= 8; offset++) {
      const candidate = this._makeValidDateOnly_(date.getFullYear() + (step * offset), month, day);
      if (candidate) return candidate;
    }
    return null;
  }

  _addDaysToDateOnly_(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12, 0, 0, 0);
  }

  _isDateWithinInclusive_(date, start, end) {
    const value = this._dateOnlyEpochDay_(date);
    return value >= this._dateOnlyEpochDay_(start) && value <= this._dateOnlyEpochDay_(end);
  }

  _dateOnlyEpochDay_(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  }

  _formatDateOnlyIso_(date) {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  _formatItalianDateLabel_(date) {
    const months = [
      'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
    ];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  _formatItalianDateLabelNoYear_(date) {
    const months = [
      'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
      'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
    ];
    return `${date.getDate()} ${months[date.getMonth()]}`;
  }

  _getSheetsWeekday_(date) {
    // Google Sheets WEEKDAY(date) default: domenica=1, lunedi=2, ..., sabato=7.
    return date.getDay() + 1;
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

  _normalizeLanguageCode_(language, fallback = 'it') {
    const normalizeCandidate = (value) => {
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) return '';
      if (['unknown', 'undetermined', 'und', 'undefined', 'null', 'n/a', 'na'].includes(raw)) return '';
      const code = raw.split(/[-_]/)[0].substring(0, 2);
      return /^[a-z]{2}$/.test(code) ? code : '';
    };

    const normalized = normalizeCandidate(language);
    if (normalized) return normalized;

    if (fallback === '') return '';
    return normalizeCandidate(fallback) || 'it';
  }

  _buildQuickCheckMemoryContext_(memoryContext = {}) {
    const safeMemory = memoryContext && typeof memoryContext === 'object' ? memoryContext : {};
    const providedInfo = Array.isArray(safeMemory.providedInfo)
      ? safeMemory.providedInfo.slice(-5).map((item) => {
        if (typeof item === 'string') return item.substring(0, 120);
        if (item && typeof item === 'object') {
          return String(item.topic || item.label || '').trim().substring(0, 120);
        }
        return '';
      }).filter(Boolean)
      : [];

    const rawState = safeMemory.conversationState && typeof safeMemory.conversationState === 'object'
      ? safeMemory.conversationState
      : null;
    const conversationState = rawState ? {
      currentRelationalPosture: rawState.currentRelationalPosture || rawState.lastRelationalPosture || null,
      responseFocusHint: rawState.responseFocusHint || null,
      responseFocusHintConfidence: Number(rawState.responseFocusHintConfidence) || 0,
      responseFocusHintUpdatedAt: rawState.responseFocusHintUpdatedAt || null,
      appliesToTopic: rawState.appliesToTopic || null,
      updatedAt: rawState.updatedAt || null
    } : null;

    const contextualFlags = {};
    const allowedFlags = ['remote_user', 'bereaved', 'canonical_complexity', 'ongoing_pastoral_process'];
    const rawFlags = safeMemory.contextualFlags && typeof safeMemory.contextualFlags === 'object'
      ? safeMemory.contextualFlags
      : {};
    allowedFlags.forEach((flag) => {
      if (rawFlags[flag] === true) contextualFlags[flag] = true;
    });

    return {
      summary: String(safeMemory.memorySummary || '').substring(0, 500),
      providedInfo: providedInfo,
      conversationState: conversationState,
      contextualFlags: contextualFlags
    };
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

    if (this.config.dryRun) {
      const targetLogger = this.logger && typeof this.logger.info === 'function' ? this.logger : console;
      targetLogger.info(`   🔴 DRY RUN - Label '${this.config.labelName}' non aggiunta al messaggio ${messageId} (simulazione)`);
      if (labeledMessageIds && typeof labeledMessageIds.add === 'function') {
        labeledMessageIds.add(messageId);
      }
      return;
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

    try {
      const metadata = this.gmailService._getMessageMetadataWithResilience(messageId, { format: 'minimal' }, 1);

      // Fail-closed: in caso di errore/risposta non valida preserviamo lo stato skip.
      // Evita promozioni accidentali a IA dovute a guasti transitori Gmail API.
      if (!metadata || !Array.isArray(metadata.labelIds)) return true;

      return metadata.labelIds.includes(skipLabelId);
    } catch (e) {
      console.warn(`⚠️ _shouldPreserveSkipLabelInForeignOnly_: metadata non recuperabili per ${messageId}, fail-closed: ${e.message}`);
      return true;
    }
  }

  // Tracciamento ID saltati per ottimizzare il batch.
  _markMessagesAsSkipped(messages, labelName = this.config.skipLabelName, skippedMessageIds = null) {
    if (this.config.dryRun) {
      this.logger.info(`   🔴 DRY RUN - Label skip '${labelName}' non aggiunta (simulazione)`);
      if (!labelName) return;
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

  _refreshThreadBeforeUnreadRead_(thread, threadId = '', logger = null) {
    try {
      if (this.gmailService && typeof this.gmailService._refreshThreadForUnreadDiscovery_ === 'function') {
        this.gmailService._refreshThreadForUnreadDiscovery_(thread, threadId);
        return;
      }
      if (typeof GmailApp !== 'undefined' && GmailApp && typeof GmailApp.refreshThread === 'function') {
        GmailApp.refreshThread(thread);
        return;
      }
      if (thread && typeof thread.refresh === 'function') {
        thread.refresh();
      }
    } catch (refreshError) {
      const targetLogger = logger && typeof logger.warn === 'function' ? logger : console;
      const idPart = threadId ? ` ${threadId}` : '';
      targetLogger.warn(`⚠️ Refresh thread${idPart} fallito prima della lettura unread: ${refreshError.message}`);
    }
  }

  _getUnreadMessagesForProcessing_(messages, logger = null) {
    const sourceMessages = Array.isArray(messages) ? messages : [];
    const nativeUnread = sourceMessages.filter(message => (
      message && typeof message.isUnread === 'function' && message.isUnread()
    ));

    if (!this.gmailService || typeof this.gmailService._getMessageMetadataWithResilience !== 'function') {
      return nativeUnread;
    }

    const targetLogger = logger && typeof logger.warn === 'function' ? logger : console;
    const nativeUnreadIds = new Set(nativeUnread
      .map(message => (message && typeof message.getId === 'function') ? message.getId() : '')
      .filter(Boolean));
    const metadataSource = (this.gmailService && typeof this.gmailService._getMetadataFallbackThreadCandidates_ === 'function')
      ? this.gmailService._getMetadataFallbackThreadCandidates_(sourceMessages)
      : sourceMessages;
    const metadataUnread = metadataSource.filter(message => {
      try {
        if (!message || typeof message.getId !== 'function') return false;
        const messageId = message.getId();
        if (!messageId) return false;
        if (nativeUnreadIds.has(messageId)) return false;
        const metadata = this.gmailService._getMessageMetadataWithResilience(messageId, { format: 'minimal' }, 1);
        const labelIds = metadata && Array.isArray(metadata.labelIds) ? metadata.labelIds : [];
        // La discovery garantisce l'eleggibilità inbox a livello thread; non richiedere INBOX sul singolo messaggio.
        return labelIds.includes('UNREAD');
      } catch (metadataError) {
        targetLogger.warn(`⚠️ Fallback metadata unread fallito: ${metadataError.message}`);
        return false;
      }
    });

    if (metadataUnread.length > 0) {
      targetLogger.warn(`⚠️ Recuperati ${metadataUnread.length} messaggi UNREAD via metadata dopo cache GmailApp incoerente.`);
    }

    return nativeUnread.concat(metadataUnread);
  }

  // Supporto per skippedMessageIds.
  // per evitare ri-discovery inutile di thread già valutati in modalità foreign_only.
  _hasUnreadMessagesToProcess(thread, labeledMessageIds, skippedMessageIds) {
    try {
      const threadId = thread && typeof thread.getId === 'function' ? thread.getId() : '';
      this._refreshThreadBeforeUnreadRead_(thread, threadId, this.logger);
      const messages = thread.getMessages() || [];
      const unreadMessages = this._getUnreadMessagesForProcessing_(messages, this.logger);

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
        const ancestors = [];
        return JSON.stringify(value, function(key, val) {
          if (typeof val === 'object' && val !== null) {
            while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
              ancestors.pop();
            }
            if (ancestors.includes(val)) return '[Circular]';
            ancestors.push(val);
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
    // Fallback: se Gemini ha dimenticato il tag di chiusura.
    const unclosedMatch = safeText.match(/<email>\s*([\s\S]*)/i);
    if (unclosedMatch && unclosedMatch[1]) {
      return unclosedMatch[1].trim();
    }
    return safeText;
  }

  _addErrorLabel(target) {
    if (this.config.dryRun) {
      const targetLogger = this.logger && typeof this.logger.info === 'function' ? this.logger : console;
      targetLogger.info(`   🔴 DRY RUN - Label errore '${this.config.errorLabelName}' non aggiunta (simulazione)`);
      return;
    }

    if (target && typeof target.getThread === 'function' && typeof target.getId === 'function') {
      this.gmailService.addLabelToMessage(target.getId(), this.config.errorLabelName);
      return;
    }
    this.gmailService.addLabelToThread(target, this.config.errorLabelName);
  }

  _addValidationErrorLabel(target, reviewContext = {}) {
    if (this.config.dryRun) {
      const targetLogger = this.logger && typeof this.logger.info === 'function' ? this.logger : console;
      targetLogger.info(`   🔴 DRY RUN - Label verifica '${this.config.validationErrorLabel}' non aggiunta (simulazione)`);
      return;
    }

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

      if (this.config.dryRun) {
        console.log('   🔴 DRY RUN - Notifica di revisione validazione non inviata (simulazione)');
        return;
      }

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
      (Array.isArray(hallucinations.times) && hallucinations.times.length > 0) ||
      (Array.isArray(hallucinations.technicalTimes) && hallucinations.technicalTimes.length > 0) ||
      (Array.isArray(hallucinations.dates) && hallucinations.dates.length > 0)
    );
    if (!hasHallucination && errorText.some(e =>
      e.includes('non in kb') ||
      e.includes('allucin') ||
      e.includes('orari tecnici da non citare')
    )) {
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
    const semanticGrounding = semantic.hallucinations || {};
    const semanticGroundingDetails = semanticGrounding.details && typeof semanticGrounding.details === 'object'
      ? semanticGrounding.details
      : {};
    const kbRelevanceIssues = Array.isArray(semanticGroundingDetails.irrelevantDetails)
      ? semanticGroundingDetails.irrelevantDetails
      : [];
    const semanticGroundingReason = String(semanticGrounding.reason || '').toLowerCase();
    const hasKbRelevance = kbRelevanceIssues.length > 0 || (
      semanticGrounding.isValid === false &&
      (semanticGroundingReason.includes('pertinen') || semanticGroundingReason.includes('irrilevant'))
    );
    if (semanticGrounding.isValid === false && !hasKbRelevance) {
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
    const papalErrors = (details.currentPopeReference && Array.isArray(details.currentPopeReference.errors))
      ? details.currentPopeReference.errors
      : [];
    const hasPapalReference = papalErrors.length > 0 || errorText.some(e => e.includes('riferimento papale non aggiornato'));
    const physicalPresenceErrors = (details.physicalPresenceConstraint && Array.isArray(details.physicalPresenceConstraint.errors))
      ? details.physicalPresenceConstraint.errors
      : [];
    const physicalPresencePolicy = details.physicalPresenceConstraint &&
      details.physicalPresenceConstraint.constraint &&
      details.physicalPresenceConstraint.constraint.visit_policy
        ? String(details.physicalPresenceConstraint.constraint.visit_policy).toLowerCase()
        : '';
    const hasPhysicalPresence = physicalPresenceErrors.length > 0 || errorText.some(e => e.includes('vincolo presenza fisica'));
    const sensitiveQualityErrors = (details.sensitiveContinuityQuality && Array.isArray(details.sensitiveContinuityQuality.errors))
      ? details.sensitiveContinuityQuality.errors
      : [];
    const sensitiveQualityWarnings = (details.sensitiveContinuityQuality && Array.isArray(details.sensitiveContinuityQuality.warnings))
      ? details.sensitiveContinuityQuality.warnings
      : [];
    const hasSensitiveQuality = sensitiveQualityErrors.length > 0 || errorText.some(e =>
      e.includes('continuita sensibile') ||
      e.includes('registro formale') ||
      e.includes('qualita sensibile') ||
      e.includes('qualita mista')
    );

    return {
      thinking_leak: hasThinkingLeak,
      hallucination: hasHallucination || hasPapalReference,
      kb_relevance: hasKbRelevance,
      papal_reference: hasPapalReference,
      language: hasLanguage,
      placeholder: hasPlaceholder,
      length: hasLength,
      temporal: hasTemporal,
      physical_presence: hasPhysicalPresence,
      sensitive_quality: hasSensitiveQuality,
      lengthErrors: lengthErrors,
      temporalErrors: temporalErrors,
      physicalPresenceErrors: physicalPresenceErrors,
      physicalPresencePolicy: physicalPresencePolicy,
      sensitiveQualityErrors: sensitiveQualityErrors,
      sensitiveQualityWarnings: sensitiveQualityWarnings,
      papalErrors: papalErrors,
      foundPlaceholders: foundPlaceholders,
      hallucinations: hallucinations,
      kbRelevanceIssues: kbRelevanceIssues,
      detectedLanguage: detectedLanguage
    };
  }

  _shouldAttemptIntelligentRetry(validationResult, detectedLanguage, retryConfig) {
    if (!validationResult || validationResult.isValid) return false;
    const cfg = retryConfig || {};
    const flags = this._classifyValidationForRetry(validationResult, detectedLanguage);
    const allowed = (Array.isArray(cfg.onlyForErrors) && cfg.onlyForErrors.length > 0)
      ? cfg.onlyForErrors
      : ['thinking_leak', 'hallucination', 'kb_relevance', 'language', 'placeholder', 'length', 'temporal', 'physical_presence', 'sensitive_quality'];

    const hasAllowed = allowed.some(key => flags[key]);
    if (!hasAllowed) return false;

    const configuredMinScore = (typeof cfg.minScoreToTrigger === 'number')
      ? cfg.minScoreToTrigger
      : ((typeof CONFIG !== 'undefined' && typeof CONFIG.VALIDATION_MIN_SCORE === 'number') ? CONFIG.VALIDATION_MIN_SCORE : 0.6);
    const minScore = (typeof normalizeValidationScore === 'function')
      ? normalizeValidationScore(configuredMinScore)
      : Math.max(0, Math.min(1, configuredMinScore > 1 ? configuredMinScore / 100 : configuredMinScore));

    const critical = flags.thinking_leak || flags.hallucination || flags.kb_relevance || flags.language || flags.temporal || flags.physical_presence || flags.sensitive_quality;



    // Per errori non critici, evita retry quando il punteggio è sotto soglia configurata.
    if (!critical && Number.isFinite(validationResult.score) && validationResult.score < minScore) {
      return false;
    }

    return true;
  }

  /**
   * Costruisce un prompt correttivo "chirurgico" basato sugli errori di validazione.
   */
  _buildCorrectionPrompt(originalPrompt, failedResponse, validationResult, language, salutationMode, runtimeContext = null) {
    const safePrompt = this._normalizePromptForRetry_(originalPrompt);
    const safeResponse = typeof failedResponse === 'string' ? failedResponse : (failedResponse == null ? '' : String(failedResponse));
    const details = validationResult && validationResult.details ? validationResult.details : {};
    const flags = this._classifyValidationForRetry(validationResult, language);

    const correctionInstructions = [];
    const langNames = { it: 'italiano', en: 'inglese', es: 'spagnolo', fr: 'francese', de: 'tedesco', pt: 'portoghese' };
    const effectiveSalutationMode = String(salutationMode || 'full').trim().toLowerCase() || 'full';
    const shouldIncludeSignature = effectiveSalutationMode !== 'none_or_continuity' && effectiveSalutationMode !== 'session';
    const shouldAvoidFormalGreeting = effectiveSalutationMode === 'none_or_continuity' || effectiveSalutationMode === 'session';
    const isSoftSalutationMode = effectiveSalutationMode === 'soft';

    if (flags.thinking_leak) {
      correctionInstructions.push(
        'ERRORE CRITICO: Hai incluso il tuo ragionamento interno o fatto riferimento alle tue fonti nella risposta.\n' +
        'CORREZIONE: Scrivi SOLO la risposta finale. Non usare frasi come "noto che", "devo correggere", ' +
        '"le istruzioni dicono", "nella nostra base dati", "nella conoscenza di base". Se ti manca un dato, scrivi solo "Non abbiamo informazioni in proposito".'
      );
    }

    if (flags.papal_reference) {
      const papalDetails = details.currentPopeReference || {};
      const currentPope = papalDetails.currentPope || 'il Papa regnante indicato nelle istruzioni';
      const staleNames = Array.isArray(papalDetails.stalePopeNames) && papalDetails.stalePopeNames.length > 0
        ? papalDetails.stalePopeNames.join(', ')
        : 'un Papa non regnante';
      correctionInstructions.push(
        `ERRORE CRITICO: Hai citato ${staleNames} in presente come se fosse il Papa attuale.\n` +
        `CORREZIONE: Il Papa attuale/regnante indicato dalle istruzioni è ${currentPope}. Non usare formule tipo "Papa X ci invita/ricorda..." per un Papa non regnante. Se il riferimento papale non è indispensabile, elimina del tutto la citazione papale; se serve un riferimento storico, scrivilo esplicitamente al passato.`
      );
    }

    if (flags.hallucination && !flags.papal_reference) {
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
      if (Array.isArray(flags.hallucinations.dates) && flags.hallucinations.dates.length > 0) {
        items.push(`date: ${flags.hallucinations.dates.slice(0, 3).join(', ')}`);
      }
      if (Array.isArray(flags.hallucinations.technicalTimes) && flags.hallucinations.technicalTimes.length > 0) {
        items.push(`orari tecnici da eliminare: ${flags.hallucinations.technicalTimes.slice(0, 3).join(', ')}`);
      }
      const technicalTimeInstruction = Array.isArray(flags.hallucinations.technicalTimes) && flags.hallucinations.technicalTimes.length > 0
        ? '\nNon sostituire questi orari con altri orari: elimina del tutto il riferimento all\'ora tecnica di sistema o di ricezione.'
        : '';
      const itemsStr = items.length > 0
        ? `Rimuovi o verifica: ${items.join(' | ')}`
        : 'Rimuovi qualsiasi dato (orario, telefono, email, URL) o procedura inventata (es. eccezioni, programmi personalizzati) non presente nelle informazioni fornite.';
      correctionInstructions.push(
        'ERRORE CRITICO: Hai inventato informazioni non presenti nelle informazioni disponibili.\n' +
        `CORREZIONE: ${itemsStr}${technicalTimeInstruction}\n` +
        'Se non conosci un dato, invita cortesemente a contattare la segreteria.'
      );
    }

    if (flags.kb_relevance) {
      const relevanceExamples = (flags.kbRelevanceIssues || []).slice(0, 3).map(issue => {
        if (issue && typeof issue === 'object') return issue.text || issue.reason || JSON.stringify(issue);
        return String(issue || '');
      }).filter(Boolean);
      const relevanceLabel = relevanceExamples.length > 0
        ? `Dettagli da rivalutare: ${relevanceExamples.join(' | ')}.\n`
        : '';
      correctionInstructions.push(
        'ERRORE CRITICO: La risposta ha trasferito dalla Knowledge Base dettagli veri ma non pertinenti al bisogno concreto del mittente.\n' +
        `CORREZIONE: ${relevanceLabel}Scomponi le frasi della Knowledge Base in unità informative indipendenti. Per ogni dettaglio verifica quale domanda, vincolo o prossimo passo risolve; elimina i rami accessori, le alternative non richieste e le eccezioni non applicabili. Conserva esatti dati e condizioni necessari, ma riformula la prosa invece di riprodurre il blocco sorgente.`
      );
    }

    if (flags.language) {
      const langLabel = langNames[language] || language;
      correctionInstructions.push(
        `ERRORE: La risposta non è in ${langLabel}.\n` +
        `CORREZIONE: Riscrivi l'intera risposta in ${langLabel}. Saluto, firma, formule di cortesia ed eventuali blocchi standard devono essere tutti in ${langLabel}; traduci o elimina ogni frase rimasta in un'altra lingua.`
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

    if (flags.physical_presence) {
      const avoidInvitation = String(flags.physicalPresencePolicy || '').toLowerCase() === 'avoid_invitation';
      correctionInstructions.push(
        'ERRORE CRITICO: Il mittente ha manifestato un vincolo a raggiungere fisicamente la parrocchia, ma la risposta lo invita a venire/passare di persona come opzione ordinaria.\n' +
        (avoidInvitation
          ? 'CORREZIONE: Rimuovi ogni invito alla presenza fisica, anche condizionale. Privilegia esclusivamente telefono/email o presa in carico a distanza, salvo obbligo procedurale esplicito e inevitabile.'
          : 'CORREZIONE: Rimuovi l\'invito diretto alla presenza fisica. Privilegia telefono/email. Un eventuale riferimento condizionale alla presenza va mantenuto solo se aggiunge un passaggio operativo necessario e deve essere formulato interamente nella lingua della risposta; non usarlo come chiusura di cortesia automatica.')
      );
    }

    if (flags.sensitive_quality) {
      const sensitiveIssues = (flags.sensitiveQualityErrors || []).concat(flags.sensitiveQualityWarnings || []).slice(0, 3);
      const issueText = sensitiveIssues.length > 0 ? sensitiveIssues.join(' | ') : 'postura sensibile non coerente con il contesto';
      correctionInstructions.push(
        'ERRORE: La risposta non rispetta la postura sensibile calcolata dal contesto.\n' +
        `PROBLEMA: ${issueText}\n` +
        'CORREZIONE: Rispondi al bisogno operativo senza nominare memoria, lutto o vissuti non ripresi dall\'utente. Nei flussi formali resta procedurale e non persuasivo; nei casi pastorale-tecnici mantieni una frase umana breve e poi dai il prossimo passo concreto.'
      );
    }

    if (flags.length) {
      const lengthErrors = (flags.lengthErrors || []).map(e => String(e).toLowerCase());
      const tooShort = lengthErrors.some(e => e.includes('troppo corta'));
      const tooLong = lengthErrors.some(e => e.includes('troppo lunga') || e.includes('prolissa'));

      if (tooShort) {
        const signatureNote = shouldAvoidFormalGreeting
          ? 'NON includere saluti formali o firme: continua nel tono di conversazione già in corso.'
          : (isSoftSalutationMode
            ? 'Mantieni una ripresa leggera, senza saluto rituale; includi una chiusura/firma essenziale.'
            : (shouldIncludeSignature ? 'Includi saluto e firma.' : 'Mantieni il formato di continuità previsto.'));
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
    const runtimeReminder = this._renderRuntimeContextForCorrection_(runtimeContext, language, salutationMode);

    return `### ISTRUZIONI DI BASE ###
${promptForRetry}
${runtimeReminder}

### ATTENZIONE: CORREZIONE CRITICA RICHIESTA ###
La tua generazione precedente conteneva errori che DEVI correggere:
- ${correctionInstructions.join('\n- ')}

### RISPOSTA FALLITA (NON RIPETERE QUESTI ERRORI) ###
${failedSnippet}

### AZIONE ###
Genera la nuova risposta correggendo i problemi indicati.
Rispondi SOLO con il testo della nuova email, OBBLIGATORIAMENTE racchiuso all'interno del tag XML <email>...</email>, senza aggiungere spiegazioni, commenti o ragionamenti interni.`;
  }

  _renderRuntimeContextForCorrection_(runtimeContext = null, detectedLanguage = 'it', salutationMode = 'full') {
    if (!runtimeContext || typeof runtimeContext !== 'object') return '';
    const temporal = runtimeContext.temporal && typeof runtimeContext.temporal === 'object'
      ? runtimeContext.temporal
      : {};
    const papal = runtimeContext.papal && typeof runtimeContext.papal === 'object'
      ? runtimeContext.papal
      : {};
    const hasConfig = typeof CONFIG !== 'undefined' && CONFIG;
    const papalConfig = hasConfig && CONFIG.PAPAL_CONTEXT ? CONFIG.PAPAL_CONTEXT : {};
    const pick = (...values) => {
      for (const value of values) {
        if (value !== null && typeof value !== 'undefined' && String(value).trim() !== '') return value;
      }
      return '';
    };
    const currentPope = pick(papal.currentName, papalConfig.currentName, hasConfig ? CONFIG.CURRENT_POPE_NAME : null, 'Leone XIV');
    const previousPope = pick(papal.previousName, papalConfig.previousName, hasConfig ? CONFIG.PREVIOUS_POPE_NAME : null, 'Papa Francesco');
    const papalForPrompt = Object.assign({}, papal, {
      currentName: currentPope,
      previousName: previousPope
    });
    const lines = [];

    if (temporal.currentDate) {
      lines.push(`- currentDate risposta: ${temporal.currentDate}`);
    }
    if (temporal.currentTime) {
      lines.push(`- currentTime risposta (NON MENZIONARE): ${temporal.currentTime}`);
    }
    if (temporal.messageDate) {
      lines.push(`- messageDate email originale: ${temporal.messageDate}`);
    }
    if (temporal.messageTime) {
      lines.push(`- messageTime email originale (NON MENZIONARE): ${temporal.messageTime}`);
    }
    if (temporal.messageDateSource) {
      lines.push(`- sorgente messageDate: ${temporal.messageDateSource}`);
    }
    if (Number.isFinite(Number(temporal.daysAgo)) && Number(temporal.daysAgo) > 0) {
      lines.push(`- eta email originale: ${temporal.daysAgo} giorni`);
    }
    if (temporal.isOldMessage) {
      lines.push('- ATTENZIONE: email vecchia; i relativi dell\'utente restano ancorati a messageDate.');
    }
    if (currentPope) {
      lines.push(`- Papa attuale/regnante: ${currentPope}`);
    }
    if (previousPope) {
      lines.push(`- Papa precedente/non regnante: ${previousPope}`);
    }
    if (papal.ministryStart) {
      lines.push(`- Inizio ministero Papa attuale: ${papal.ministryStart}`);
    }
    if (lines.length === 0) return '';

    let temporalAwareness = '';
    if (
      this.promptEngine &&
      typeof this.promptEngine._renderTemporalAwareness === 'function' &&
      temporal.currentDate
    ) {
      try {
        const papalSourceText = [
          papal.currentName,
          papal.previousName,
          papal.currentSince,
          papal.ministryStart
        ].filter(Boolean).join('\n');
        temporalAwareness = this.promptEngine._renderTemporalAwareness(
          temporal,
          detectedLanguage,
          papalSourceText,
          papalForPrompt
        ) || '';
      } catch (_) {
        temporalAwareness = '';
      }
    }

    const fallbackRules = [
      `Regola 1: usa currentDate (${temporal.currentDate || '?'}) come unica data di riferimento per decidere se nella risposta un evento e passato, presente o futuro.`,
      `Regola 2: usa messageDate (${temporal.messageDate || '?'}) solo per interpretare riferimenti relativi scritti dall'utente nell'email originale, come oggi, domani, ieri o sabato prossimo.`,
      `Regola 3: se messageDate non era disponibile ed e indicato un fallback tecnico, non presentare l'anno inferito come certo: chiedi conferma quando l'anno e ambiguo.`,
      `Regola 4: non presentare ${previousPope || 'il Papa precedente'} come Papa attuale o voce magisteriale in presente.`,
      `Regola 5: NON citare mai l'ora corrente di sistema (${temporal.currentTime || '?'}) né l'ora di ricezione del messaggio (${temporal.messageTime || '?'}) nel testo della risposta.`
    ].join('\n');

    const rulesBlock = temporalAwareness
      ? `\n\n### REGOLE TEMPORALI COMPLETE PER IL RETRY ###\n${temporalAwareness}`
      : `\n${fallbackRules}`;

    return `\n\n### RUNTIME CONTEXT IMMUTATO PER IL RETRY ###\n${lines.join('\n')}${rulesBlock}`;
  }

  _trimPromptForRetry_(prompt, maxChars) {
    if (typeof prompt !== 'string') return '';
    if (!Number.isFinite(maxChars) || maxChars <= 0 || prompt.length <= maxChars) {
      return prompt;
    }

    let candidate = prompt;
    const limit = Math.floor(maxChars);

    // Prima riduciamo i blocchi sacrificabili preservando i recinti XML: nei retry
    // conta piu' mantenere istruzioni + email corrente che portare tutta la storia.
    candidate = this._shrinkRetryPromptXmlBlock_(
      candidate,
      'conversation_history',
      Math.max(600, Math.floor(limit * 0.12)),
      {
        keep: 'tail',
        marker: '[...CRONOLOGIA PRECEDENTE RIDOTTA PER RETRY...]'
      }
    );
    if (candidate.length <= limit) return candidate;

    candidate = this._shrinkRetryPromptTextSection_(
      candidate,
      '**ALLEGATI (TESTO ESTRATTO):**',
      Math.max(800, Math.floor(limit * 0.16)),
      '[...TESTO ALLEGATI RIDOTTO PER RETRY...]'
    );
    if (candidate.length <= limit) return candidate;

    candidate = this._shrinkRetryPromptXmlBlock_(
      candidate,
      'knowledge_base',
      Math.max(1200, Math.floor(limit * 0.28)),
      {
        keep: 'head_tail',
        marker: '[...INFORMAZIONI DI RIFERIMENTO RIDOTTE PER RETRY...]'
      }
    );
    if (candidate.length <= limit) return candidate;

    candidate = this._shrinkRetryPromptXmlBlock_(
      candidate,
      'user_email',
      Math.max(800, Math.floor(limit * 0.35)),
      {
        keep: 'head_tail',
        marker: '[...EMAIL ORIGINALE RIDOTTA PER RETRY...]'
      }
    );
    if (candidate.length <= limit) return candidate;

    return this._finalTrimRetryPrompt_(candidate, limit);
  }

  _shrinkRetryPromptXmlBlock_(prompt, tagName, maxContentChars, options = {}) {
    const source = typeof prompt === 'string' ? prompt : '';
    const tag = String(tagName || '').trim();
    const limit = Math.max(0, Math.floor(Number(maxContentChars) || 0));
    if (!source || !tag || limit <= 0) return source;

    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    const openIndex = source.indexOf(openTag);
    if (openIndex < 0) return source;
    const contentStart = openIndex + openTag.length;
    const closeIndex = source.indexOf(closeTag, contentStart);
    if (closeIndex < 0) return source;

    const content = source.slice(contentStart, closeIndex);
    if (content.length <= limit) return source;

    const reduced = this._buildRetryPromptReducedContent_(
      content,
      limit,
      options.marker || '[...BLOCCO RIDOTTO PER RETRY...]',
      options.keep || 'head_tail'
    );
    return `${source.slice(0, contentStart)}${reduced}${source.slice(closeIndex)}`;
  }

  _shrinkRetryPromptTextSection_(prompt, heading, maxContentChars, markerText) {
    const source = typeof prompt === 'string' ? prompt : '';
    const title = String(heading || '');
    const limit = Math.max(0, Math.floor(Number(maxContentChars) || 0));
    if (!source || !title || limit <= 0) return source;

    const headingIndex = source.indexOf(title);
    if (headingIndex < 0) return source;
    const contentStart = headingIndex + title.length;
    const nextHeadingCandidates = ['\n**', '\n### ']
      .map(pattern => source.indexOf(pattern, contentStart + 1))
      .filter(index => index > contentStart);
    const contentEnd = nextHeadingCandidates.length > 0
      ? Math.min.apply(null, nextHeadingCandidates)
      : source.length;
    const content = source.slice(contentStart, contentEnd);
    if (content.length <= limit) return source;

    const reduced = this._buildRetryPromptReducedContent_(
      content,
      limit,
      markerText || '[...SEZIONE RIDOTTA PER RETRY...]',
      'head_tail'
    );
    return `${source.slice(0, contentStart)}${reduced}${source.slice(contentEnd)}`;
  }

  _buildRetryPromptReducedContent_(content, maxChars, markerText, keepMode) {
    const source = typeof content === 'string' ? content : '';
    const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
    if (!source || limit <= 0) return '';
    if (source.length <= limit) return source;

    const marker = `\n${markerText}\n`;
    if (limit <= marker.length + 16) {
      return this._sliceRetryPromptTextSafely_(marker.trim(), limit);
    }

    const keepBudget = Math.max(0, limit - marker.length);
    if (keepMode === 'tail') {
      const tail = source.slice(-keepBudget).trimStart();
      return this._sliceRetryPromptTextSafely_(`${marker}${tail}`, limit);
    }
    if (keepMode === 'head') {
      const head = source.slice(0, keepBudget).trimEnd();
      return this._sliceRetryPromptTextSafely_(`${head}${marker}`, limit);
    }

    const headBudget = Math.ceil(keepBudget * 0.55);
    const tailBudget = Math.max(0, keepBudget - headBudget);
    const head = source.slice(0, headBudget).trimEnd();
    const tail = tailBudget > 0 ? source.slice(-tailBudget).trimStart() : '';
    return this._sliceRetryPromptTextSafely_(`${head}${marker}${tail}`, limit);
  }

  _finalTrimRetryPrompt_(prompt, maxChars) {
    const source = typeof prompt === 'string' ? prompt : '';
    const limit = Math.floor(Number(maxChars));
    if (!source || !Number.isFinite(limit) || limit <= 0) return '';
    if (source.length <= limit) return source;

    const marker = '\n\n[...PROMPT ORIGINALE RIDOTTO PER RETRY...]\n\n';
    const userEmailOpen = '<user_email>';
    const userEmailClose = '</user_email>';
    const emailOpenIndex = source.indexOf(userEmailOpen);
    const emailCloseIndex = emailOpenIndex >= 0
      ? source.indexOf(userEmailClose, emailOpenIndex + userEmailOpen.length)
      : -1;

    if (emailOpenIndex >= 0 && emailCloseIndex > emailOpenIndex) {
      const blockStart = this._findRetryPromptBlockStart_(source, emailOpenIndex);
      const blockEnd = emailCloseIndex + userEmailClose.length;
      const emailBlock = source.slice(blockStart, blockEnd);
      const separator = marker;
      if (emailBlock.length + separator.length < limit) {
        const prefixBudget = limit - emailBlock.length - separator.length;
        const prefix = this._repairRetryPromptXmlFences_(
          this._sliceRetryPromptAtBoundary_(source.slice(0, blockStart), prefixBudget),
          prefixBudget
        );
        return this._repairRetryPromptXmlFences_(`${prefix}${separator}${emailBlock}`, limit);
      }
    }

    const budget = Math.max(0, limit - marker.length);
    const head = this._sliceRetryPromptAtBoundary_(source, budget);
    return this._repairRetryPromptXmlFences_(`${head}${marker}`, limit);
  }

  _findRetryPromptBlockStart_(source, blockOpenIndex) {
    const text = typeof source === 'string' ? source : '';
    const openIndex = Math.floor(Number(blockOpenIndex));
    if (!text || !Number.isFinite(openIndex) || openIndex < 0) return 0;

    const headingIndex = text.lastIndexOf('\n**', openIndex);
    if (headingIndex >= 0) return headingIndex + 1;

    const sectionIndex = text.lastIndexOf('\n### ', openIndex);
    if (sectionIndex >= 0) return sectionIndex + 1;

    const breakIndex = text.lastIndexOf('\n\n', openIndex);
    if (breakIndex >= 0) return breakIndex + 2;

    return openIndex;
  }

  _sliceRetryPromptAtBoundary_(text, maxChars) {
    const source = typeof text === 'string' ? text : '';
    const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
    if (!source || limit <= 0) return '';
    if (source.length <= limit) return source;

    let head = this._sliceRetryPromptTextSafely_(source, limit);
    const sectionBoundary = head.lastIndexOf('\n### ');
    const headingBoundary = head.lastIndexOf('\n**');
    const lineBoundary = head.lastIndexOf('\n');
    const minBoundary = Math.floor(head.length * 0.6);
    const bestBoundary = Math.max(sectionBoundary, headingBoundary, lineBoundary);
    if (bestBoundary > minBoundary) {
      head = head.slice(0, bestBoundary);
    }
    return this._stripDanglingRetryPromptTagFragment_(head);
  }

  _repairRetryPromptXmlFences_(text, maxChars) {
    const limit = Math.floor(Number(maxChars));
    let candidate = typeof text === 'string' ? text : '';
    if (!candidate || !Number.isFinite(limit) || limit <= 0) return '';

    for (let guard = 0; guard < 5; guard++) {
      candidate = this._stripDanglingRetryPromptTagFragment_(candidate);
      const pendingClosures = this._getPendingRetryPromptXmlFenceClosures_(candidate);
      if (pendingClosures.length === 0) {
        return candidate.length > limit ? this._sliceRetryPromptTextSafely_(candidate, limit) : candidate;
      }

      const suffix = pendingClosures.map(tag => `\n${tag}`).join('');
      if (candidate.length + suffix.length <= limit) {
        return candidate + suffix;
      }

      const bodyBudget = limit - suffix.length;
      if (bodyBudget <= 0) {
        return this._sliceRetryPromptTextSafely_(candidate, limit);
      }
      const trimmed = this._sliceRetryPromptTextSafely_(candidate, bodyBudget).trimEnd();
      if (trimmed === candidate) {
        return this._sliceRetryPromptTextSafely_(candidate, limit);
      }
      candidate = trimmed;
    }

    return this._sliceRetryPromptTextSafely_(candidate, limit);
  }

  _getPendingRetryPromptXmlFenceClosures_(text) {
    const candidate = typeof text === 'string' ? text : '';
    const tags = ['knowledge_base', 'conversation_history', 'user_email'];
    return tags
      .map(tag => ({
        tag: tag,
        openIndex: candidate.lastIndexOf(`<${tag}>`),
        closeIndex: candidate.lastIndexOf(`</${tag}>`)
      }))
      .filter(entry => entry.openIndex >= 0 && entry.closeIndex < entry.openIndex)
      .sort((a, b) => b.openIndex - a.openIndex)
      .map(entry => `</${entry.tag}>`);
  }

  _stripDanglingRetryPromptTagFragment_(text) {
    return (typeof text === 'string' ? text : '')
      .replace(/<\/?[A-Za-z_][A-Za-z0-9_:-]*$/, '')
      .trimEnd();
  }

  _sliceRetryPromptTextSafely_(text, maxChars) {
    const source = typeof text === 'string' ? text : '';
    const limit = Math.max(0, Math.floor(Number(maxChars) || 0));
    if (!source || limit <= 0) return '';
    if (source.length <= limit) return source;

    let sliced = source.slice(0, limit);
    const lastCodeUnit = sliced.charCodeAt(sliced.length - 1);
    if (lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF) {
      sliced = sliced.slice(0, -1);
    }
    return sliced;
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
  _buildMemorySummary({ existingSummary, responseText, providedTopics, referenceDate = null }) {
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
      const newBullet = `• [${this._getBusinessDateString(referenceDate || new Date())}] ${summarySentence}`;
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

  _detectIndirectSbattezzoRequest_(subject, body) {
    const source = `${subject || ''} ${body || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!source) {
      return { detected: false, reason: 'empty_text', confidence: 0 };
    }

    const physicalBuildingContext = /\b(?:messa|cerimonia|funeral[ei]|matrimoni[oa]|porta|uscita|navata|edificio|dopo\s+la\s+messa)\b/i.test(source);
    const rules = [
      { reason: 'explicit_sbattezzo', confidence: 0.98, pattern: /\b(?:sbattezzo|sbattezzamento|apostasia|apostatare)\b/i },
      { reason: 'church_membership_exit', confidence: physicalBuildingContext ? 0.45 : 0.86, pattern: /\buscire\s+dalla\s+chiesa(?:\s+cattolica)?\b/i },
      { reason: 'no_longer_catholic', confidence: 0.92, pattern: /\bnon\s+(?:voglio|desidero)\s+(?:piu|più)\s+essere\s+(?:cattolic[oa]|cristian[oa])\b/i },
      { reason: 'no_longer_identifies', confidence: 0.9, pattern: /\bnon\s+(?:mi\s+)?(?:ritengo|sento)\s+(?:piu|più)\s+(?:cattolic[oa]|cristian[oa])\b/i },
      { reason: 'church_unregister', confidence: 0.92, pattern: /\b(?:cancellarmi|disiscrivermi)\s+dalla\s+chiesa\b/i },
      { reason: 'baptism_renunciation', confidence: 0.94, pattern: /\brinunciare\s+al\s+battesim[oa]\b/i },
      { reason: 'registry_removal', confidence: 0.94, pattern: /\b(?:togliermi|rimuovermi|essere\s+rimosso)\s+dai\s+registr/i },
      { reason: 'baptism_registry_cancellation', confidence: 0.95, pattern: /\bcancellazion[ea]\b[\s\S]{0,60}\bregistr[oi]\b[\s\S]{0,40}\bbattesim[oa]\b/i },
      { reason: 'registered_catholic_removal', confidence: 0.94, pattern: /\bnon\s+essere\s+(?:piu|più)\s+registrat[oa]\s+come\s+cattolic[oa]\b/i },
      { reason: 'faith_abandonment', confidence: 0.82, pattern: /\b(?:abbandonare\s+la\s+(?:fede|religione)|rinnegare\s+la\s+fede)\b/i }
    ];

    for (const rule of rules) {
      if (!rule.pattern.test(source)) continue;
      if (rule.confidence < 0.65) continue;
      return {
        detected: true,
        reason: rule.reason,
        confidence: rule.confidence
      };
    }

    return { detected: false, reason: 'no_match', confidence: 0 };
  }

  _deriveContextualFlagsUpdate_({
    existingFlags = {},
    physicalPresenceConstraint = null,
    activeConcerns = {},
    classification = {},
    requestType = {},
    categoryHintSource = ''
  } = {}) {
    const flags = (existingFlags && typeof existingFlags === 'object')
      ? Object.assign({}, existingFlags)
      : {};
    const subIntents = (classification && classification.subIntents && typeof classification.subIntents === 'object')
      ? classification.subIntents
      : {};
    const requestTypeName = String(
      typeof requestType === 'string' ? requestType : ((requestType && requestType.type) || '')
    ).toLowerCase();
    const category = String(categoryHintSource || classification.category || '').toLowerCase();
    const topic = String((classification && classification.topic) || '').toLowerCase();
    const isSbattezzo = Boolean(
      topic.includes('sbattezzo') ||
      category === 'sbattezzo' ||
      requestTypeName === 'sbattezzo' ||
      (requestType && typeof requestType === 'object' && requestType.isSbattezzo === true) ||
      subIntents.possible_sbattezzo_indirect === true
    );
    const isFormal = Boolean(
      isSbattezzo ||
      category === 'formal' ||
      requestTypeName === 'formal'
    );

    if (physicalPresenceConstraint && physicalPresenceConstraint.has_constraint) {
      flags.remote_user = true;
    }
    if (subIntents.bereavement === true) {
      flags.bereaved = true;
    }
    if (isFormal) {
      flags.canonical_complexity = true;
    }
    if (
      requestTypeName === 'pastoral' ||
      requestTypeName === 'mixed' ||
      activeConcerns.pastoral_technical_blend === true ||
      (activeConcerns.longitudinal_sensitivity === true && !isFormal)
    ) {
      flags.ongoing_pastoral_process = true;
    }

    return flags;
  }

  _resolveRequestPurpose_(quickCheck = {}, subject = '', body = '') {
    const source = (quickCheck && typeof quickCheck === 'object') ? quickCheck : {};
    if (
      typeof EmailQuickCheckPolicy !== 'undefined' &&
      EmailQuickCheckPolicy &&
      typeof EmailQuickCheckPolicy.resolveRequestPurpose === 'function'
    ) {
      return EmailQuickCheckPolicy.resolveRequestPurpose(
        source.request_purpose,
        source.request_purpose_confidence,
        subject,
        body
      );
    }

    const allowed = new Set([
      'information_request',
      'operational_request',
      'status_update',
      'acknowledgment',
      'mixed'
    ]);
    const type = String(source.request_purpose || '').trim().toLowerCase();
    const confidence = Math.max(0, Math.min(1, Number(source.request_purpose_confidence) || 0));
    return {
      type: allowed.has(type) && confidence >= 0.65 ? type : 'unknown',
      confidence: allowed.has(type) ? confidence : 0,
      source: allowed.has(type) ? 'quick_check_model' : 'unavailable'
    };
  }

  _buildCertificateSystemDirective_(isCertificateRequest, requestPurpose = null) {
    if (!isCertificateRequest) return null;
    const purpose = requestPurpose && typeof requestPurpose === 'object'
      ? requestPurpose.type
      : requestPurpose;
    const type = String(purpose || 'unknown').trim().toLowerCase();

    if (type === 'information_request') {
      return "RICHIESTA INFORMATIVA SUI CERTIFICATI: spiega solo la procedura richiesta. Specifica che il certificato va richiesto alla parrocchia in cui e stato celebrato il sacramento; chiedi dati personali soltanto se servono al passo successivo e precisando che valgono per sacramenti celebrati presso la nostra parrocchia.";
    }
    if (type === 'operational_request') {
      return "RICHIESTA OPERATIVA DI CERTIFICATO: l'utente sta gia chiedendo il rilascio o la preparazione del documento. Prendi in carico la richiesta e conferma soltanto i passaggi concretamente supportati dalla KB. Non riaprire con spiegazioni generiche su come o dove richiedere il certificato se il messaggio mostra che la procedura e gia stata compresa; se manca un dato indispensabile, chiedi solo quello; se emerge un impedimento reale, spiegalo in modo mirato.";
    }
    if (type === 'mixed') {
      return "RICHIESTA MISTA DI CERTIFICATO: gestisci prima l'azione richiesta, poi rispondi soltanto alle domande procedurali ancora aperte. Non ripetere requisiti o indicazioni che l'utente ha gia soddisfatto nel messaggio.";
    }
    return "CONTESTO CERTIFICATO: determina dal testo se l'utente chiede informazioni o sta gia presentando una richiesta operativa. Non inserire automaticamente la regola generale sulla parrocchia di celebrazione: usala solo se risponde a una domanda aperta o segnala un impedimento concreto.";
  }

  _buildResponseValidationContext_({
    activeConcerns = {},
    concernSynthesis = null,
    continuityCase = null,
    responseMode = 'standard_operational',
    operationalConstraints = [],
    continuityPolicy = null,
    responseRegister = 'warm_institutional',
    promptProfile = 'standard',
    category = null,
    requestType = null,
    requestPurpose = null
  } = {}) {
    const normalizedConcerns = (activeConcerns && typeof activeConcerns === 'object')
      ? Object.assign({}, activeConcerns)
      : {};
    const normalizedRegister = String(responseRegister || 'warm_institutional').trim() || 'warm_institutional';
    const normalizedProfile = String(promptProfile || 'standard').trim() || 'standard';
    const normalizedCategory = (category === null || typeof category === 'undefined')
      ? null
      : (String(category).trim() || null);
    const rawRequestType = (requestType && typeof requestType === 'object')
      ? requestType.type
      : requestType;
    const normalizedRequestType = (rawRequestType === null || typeof rawRequestType === 'undefined')
      ? null
      : (String(rawRequestType).trim() || null);
    const normalizedResponseMode = String(responseMode || 'standard_operational').trim() || 'standard_operational';
    const normalizedOperationalConstraints = Array.isArray(operationalConstraints)
      ? operationalConstraints.slice(0, 12)
      : [];
    const rawRequestPurpose = (requestPurpose && typeof requestPurpose === 'object')
      ? requestPurpose.type
      : requestPurpose;
    const allowedRequestPurposes = new Set([
      'information_request',
      'operational_request',
      'status_update',
      'acknowledgment',
      'mixed',
      'unknown'
    ]);
    const normalizedRequestPurposeType = String(rawRequestPurpose || 'unknown').trim().toLowerCase();
    const normalizedRequestPurpose = {
      type: allowedRequestPurposes.has(normalizedRequestPurposeType)
        ? normalizedRequestPurposeType
        : 'unknown',
      confidence: Math.max(0, Math.min(1, Number(
        requestPurpose && typeof requestPurpose === 'object'
          ? requestPurpose.confidence
          : 0
      ) || 0)),
      source: String(
        requestPurpose && typeof requestPurpose === 'object'
          ? (requestPurpose.source || 'unknown')
          : 'unknown'
      ).slice(0, 80)
    };

    return {
      activeConcerns: normalizedConcerns,
      concernSynthesis: concernSynthesis || null,
      continuityCase: continuityCase || null,
      responseMode: normalizedResponseMode,
      operationalConstraints: normalizedOperationalConstraints,
      continuityPolicy: continuityPolicy || null,
      responseRegister: normalizedRegister,
      promptProfile: normalizedProfile,
      category: normalizedCategory,
      requestType: normalizedRequestType,
      requestPurpose: normalizedRequestPurpose
    };
  }

  _isTerritoryRequest(subject, body, classification = {}, requestType = null) {
    const text = `${subject || ''} ${body || ''}`.toLowerCase();
    const topic = String(classification && classification.topic ? classification.topic : '').toLowerCase();
    const aiTerritoryFlag = classification && (
      classification.isTerritoryRequest === true ||
      classification.is_territory_request === true ||
      classification.territory_request === true ||
      String(classification.isTerritoryRequest || '').toLowerCase() === 'true' ||
      String(classification.is_territory_request || '').toLowerCase() === 'true' ||
      String(classification.territory_request || '').toLowerCase() === 'true'
    );
    if (aiTerritoryFlag) return true;

    if (
      topic.includes('territor') ||
      topic.includes('confini parrocchiali') ||
      topic.includes('parrocchia di residenza') ||
      topic.includes('competenza parrocchiale') ||
      topic.includes('appartenenza')
    ) return true;

    const explicitPatterns = [
      /\bterritorio\b/i,
      /\bparrocchia\s+di\s+residenza\b/i,
      /\brientr[aio]\b/i,
      /\bnon\s+rientr[aio]\b/i,
      /\bcompetenza\s+parrocchiale\b/i,
      /\bquale\s+parrocchia\b/i,
      /\bfuori\s+territorio\b/i,
      /\bcircoscrizione\b/i,
      /\bconfini\s+(?:parrocchiali|della\s+parrocchia|di\s+parrocchia)\b/i,
      /\bfa\s+parte\b[\s\S]{0,80}\b(?:parrocchia|territorio|confini|zona)\b/i,
      /\bappartenenza\b/i
    ];

    return explicitPatterns.some((pattern) => pattern.test(text));
  }

  _extractQuickCheckTerritoryCandidates_(quickCheck) {
    const candidates = [];
    const addCandidates = (value) => {
      if (!value) return;
      const list = Array.isArray(value) ? value : [value];
      list.forEach((candidate) => {
        if (candidate == null) return;
        const text = String(candidate)
          .replace(/[=<>]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text || text.length > 120) return;
        if (!/\b(?:via|viale|piazza|piazzale|largo|lungotevere|salita|vicolo|corso)\b/i.test(text)) return;
        if (!candidates.some(existing => existing.toLowerCase() === text.toLowerCase())) {
          candidates.push(text);
        }
      });
    };

    addCandidates(quickCheck && quickCheck.territory_address_candidates);
    addCandidates(quickCheck && quickCheck.territory_address);
    addCandidates(quickCheck && quickCheck.classification && quickCheck.classification.territory_address_candidates);
    addCandidates(quickCheck && quickCheck.classification && quickCheck.classification.territory_address);

    return candidates.slice(0, 3);
  }

  _analyzeAiTerritoryCandidates_(candidates) {
    if (!this.territoryValidator || !Array.isArray(candidates) || candidates.length === 0) return null;

    const addresses = [];
    candidates.forEach((candidate) => {
      const detected = this.territoryValidator.analyzeEmailForAddress(candidate, '') || { addressFound: false };
      if (detected.addressFound && Array.isArray(detected.addresses)) {
        detected.addresses.forEach((entry) => addresses.push(entry));
      }
    });

    if (addresses.length === 0) return null;
    return {
      addressFound: true,
      addresses: addresses,
      street: addresses[0].street,
      civic: addresses[0].civic,
      verification: addresses[0].verification
    };
  }

  _extractTimes(text) {
    if (!text || typeof text !== 'string') return [];

    // Boundary Unicode: evita match dentro parole/sequenze numeriche, preservando "9:30" e "10 ore".
    const matches = text.match(/(?<![\p{L}\p{N}_])(?:[01]?\d|2[0-3])(?:[:.][0-5]\d)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:[01]?\d|2[0-3])(?=\s*(?:ore\b|am\b|pm\b|:))/giu) || [];
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

  _extractEventScheduleTimesForDiscrepancy_(response) {
    if (!response || typeof response !== 'string') return [];

    const sentences = response.match(/[^.!?\n]+(?:[.!?]+|$)/g) || [response];
    const eventSchedulePatterns = [
      /(?:^|[^\p{L}\p{N}_])(?:inizia|iniziano|inizier[àa]|inizieranno|comincia|cominciano|comincer[àa]|cominceranno|parte|partono|partir[àa]|partiranno)(?=$|[^\p{L}\p{N}_])/iu,
      /(?:^|[^\p{L}\p{N}_])(?:si\s+)?(?:tiene|terr[àa]|terranno|svolge|svolger[àa]|svolgeranno)(?=$|[^\p{L}\p{N}_])/iu,
      /(?:^|[^\p{L}\p{N}_])(?:avr[àa]|avranno)\s+luogo(?=$|[^\p{L}\p{N}_])/iu,
      /(?:^|[^\p{L}\p{N}_])(?:is|are|will\s+be)\s+(?:held|scheduled|planned)(?=$|[^\p{L}\p{N}_])/iu,
      /(?:^|[^\p{L}\p{N}_])(?:starts?|begins?|takes?\s+place)(?=$|[^\p{L}\p{N}_])/iu,
      /(?:^|[^\p{L}\p{N}_])(?:empieza|empiezan|comienza|comienzan|ser[áa]|ser[aá]n)(?=$|[^\p{L}\p{N}_])/iu,
      /(?:^|[^\p{L}\p{N}_])(?:commence|commencer[ao]nt|aura\s+lieu|auront\s+lieu|se\s+tiendra|se\s+tiendront)(?=$|[^\p{L}\p{N}_])/iu,
      /(?:^|[^\p{L}\p{N}_])(?:começa|começam|ter[áa]|ter[aã]o\s+lugar)(?=$|[^\p{L}\p{N}_])/iu,
      /(?:^|[^\p{L}\p{N}_])(?:beginnt|beginnen|findet|finden)\s+statt(?=$|[^\p{L}\p{N}_])/iu
    ];
    const eventNounPattern = /\b(?:incontro|riunione|corso|lezione|messa|messe|celebrazione|appuntamento|catechesi|ritiro|evento|meeting|course|class|event|appointment|reuni[oó]n|curso|rencontre|réunion|cours|treffen|kurs)\b/i;
    const directEventTimePattern = /(?:^|[^\p{L}\p{N}_])(?:è|e'|sar[àa]|sono|saranno|is|are|will\s+be|ser[áa]|sera|ser[aã]o|est[áa]|ist|sind)(?=$|[^\p{L}\p{N}_])[^.!?\n]{0,80}(?:^|[^\p{L}\p{N}_])(?:alle?|ore|at|a\s+las|às|à|um)\s+(?:[01]?\d|2[0-3])(?:[:.][0-5]\d)?(?=$|[^\p{L}\p{N}_])/iu;

    const scheduledTimes = [];
    sentences.forEach((sentence) => {
      const text = String(sentence || '').trim();
      if (!text) return;
      const hasScheduleVerb = eventSchedulePatterns.some((pattern) => pattern.test(text));
      const hasDirectEventTime = eventNounPattern.test(text) && directEventTimePattern.test(text);
      if (!hasScheduleVerb && !hasDirectEventTime) return;

      this._extractTimes(text).forEach((time) => {
        if (!scheduledTimes.includes(time)) scheduledTimes.push(time);
      });
    });

    return scheduledTimes;
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
    const responseTimes = this._extractEventScheduleTimesForDiscrepancy_(response);

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
        const delta = this._timeDistanceMinutesCircular_(toMinutes(ut), toMinutes(rt));
        if (!Number.isFinite(delta)) continue;
        minDelta = Math.min(minDelta, delta);
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

  _timeDistanceMinutesCircular_(leftMinutes, rightMinutes) {
    if (!Number.isFinite(leftMinutes) || !Number.isFinite(rightMinutes)) return NaN;
    const dayMinutes = 24 * 60;
    const rawDelta = Math.abs(leftMinutes - rightMinutes) % dayMinutes;
    return Math.min(rawDelta, dayMinutes - rawDelta);
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
      'contatti': /(?:\b(?:telefono|cellulare|phone)\b|\btel\.?)\s*[:：]?\s*(?:\+?\d|della\s+segreteria|parrocchiale)|\b(?:email|e-mail)\b\s*[:：]\s*[^\s@]+@[^\s@]+|\b(?:contatt\w*|scriv\w*|chiam\w*|telefon\w*)\b[\s\S]{0,100}(?:\b(?:telefono|cellulare|phone)\b|\btel\.?|\b(?:email|e-mail|segreteria)\b)/i,
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

    const bodyText = userBody.trim();
    const bodyLower = bodyText.toLowerCase();
    const wordMatches = bodyLower.match(/[a-zà-ÿ0-9]+/gi) || [];
    const wordCount = wordMatches.length;
    const hasFollowUpRequestSignal = /[?？]/.test(bodyText) ||
      /\b(?:ma|per[oò]|tuttavia|invece|anche|ancora)\b[\s\S]{0,160}\b(?:potrebbe|pu[oò]|potete|possiamo|potremmo|vorrei|desidero|sapere|indicarmi|indicare|dirmi|dire|confermare|chiarire|spiegare|quando|dove|come|quale|quali|quanto|orario|appuntamento)\b/i.test(bodyText) ||
      /\b(?:potrebbe|pu[oò]|potete|possiamo|potremmo|vorrei|desidero|sapere|indicarmi|dirmi|quando|dove|come|quale|quali|quanto|orario|appuntamento|prenotare|fissare)\b/i.test(bodyText) ||
      /\bmi\s+(?:pu[oò]|potrebbe)\s+(?:indicare|dire|confermare|chiarire|spiegare|mandare|inviare)\b/i.test(bodyText);
    const hasDocumentSubmissionSignal =
      /\b(?:allego|in allegato|invio|inoltro|trasmetto|mando|documento|modulo|certificato|dati)\b/i.test(bodyText);

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
        'potrebbe indicare i passaggi', 'potrebbe indicarmi', 'può indicarmi',
        'puo indicarmi', 'mi può indicare', 'mi puo indicare', 'mi potrebbe indicare',
        'può dirmi', 'puo dirmi', 'mi può dire', 'mi puo dire', 'mi potrebbe dire',
        'a che ora', 'orario esatto', 'quando posso', 'dove posso', 'come posso',
        'quali documenti', 'quale documento', 'cosa devo', 'cosa dobbiamo',
        'could you provide more details', 'more details', 'could you elaborate',
        'would it be possible to have more information', 'could you outline the steps',
        'could you let me know', 'would you let me know', 'what time', 'when can',
        'where can',
        'podría ampliar', 'más detalles', 'podría proporcionar más informazioni',
        'sería possibile tener más información', 'podría indicar los pasos'
      ]
    };

    const matchedQuestioned = patterns.questioned.find(p => bodyLower.includes(p));
    const matchedExpansion = patterns.needs_expansion.find(p => bodyLower.includes(p));
    const matchedAcknowledged = patterns.acknowledged.find(p => bodyLower.includes(p));
    const acknowledgementIsPure = Boolean(
      matchedAcknowledged &&
      wordCount <= 16 &&
      !hasFollowUpRequestSignal &&
      !hasDocumentSubmissionSignal
    );

    let inferredReaction = null;
    if (matchedQuestioned) {
      inferredReaction = { type: 'questioned', match: matchedQuestioned };
    } else if (matchedExpansion) {
      inferredReaction = { type: 'needs_expansion', match: matchedExpansion };
    } else if (acknowledgementIsPure) {
      inferredReaction = { type: 'acknowledged', match: matchedAcknowledged };
    }

    if (!inferredReaction) return null;

    // 1. Trova TUTTI i topic menzionati esplicitamente
    const normalizedTopics = previousTopics
      .map(info => (typeof info === 'object' && info !== null ? info.topic : info))
      .map(topic => this._normalizeTopicKey(topic));
    const uniqueNormalizedTopics = normalizedTopics.filter((topic, index, arr) =>
      topic && arr.indexOf(topic) === index
    );

    const mentionedTopics = uniqueNormalizedTopics.filter(topic => {
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
      // Fallback prudente: usa l'ultimo topic solo quando la reazione e breve/pura
      // oppure quando c'e un solo topic possibile in memoria.
      const canUseLastTopicFallback = inferredReaction.type === 'acknowledged'
        ? acknowledgementIsPure
        : (uniqueNormalizedTopics.length === 1 && wordCount <= 16);
      if (canUseLastTopicFallback) {
        targetTopics = [normalizedTopics[normalizedTopics.length - 1]].filter(Boolean);
      }
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
    if (msg.includes('config_error')) {
      return mkResult('CONFIG_ERROR', false, rawMessage);
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
      return isEmpty ? (Number.isFinite(streak) ? streak : 0) : 0;
    }
  }

  _parseBooleanSignal_(value) {
    if (value === true || value === false) return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === 'yes' || normalized === 'si') return true;
      if (normalized === 'false' || normalized === 'no') return false;
    }
    return undefined;
  }

  _normalizePhysicalPresenceConstraint_(constraint, source) {
    const raw = constraint && typeof constraint === 'object' ? constraint : null;
    if (!raw) return null;

    const allowedTypes = {
      geographic_distance: true,
      health: true,
      mobility: true,
      caregiving: true,
      legal_restriction: true,
      temporary_unavailability: true,
      remote_request: true,
      other: true,
      none: true
    };
    const allowedPolicies = {
      avoid_invitation: true,
      conditional_only: true,
      visit_ok: true,
      unknown: true
    };
    const hasConstraintRaw = Object.prototype.hasOwnProperty.call(raw, 'has_constraint')
      ? raw.has_constraint
      : raw.is_remote;
    const hasConstraint = this._parseBooleanSignal_(hasConstraintRaw);
    const confidence = Number(raw.confidence);
    const safeConfidence = Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : (hasConstraint ? 0.75 : 0);
    const typeRaw = String(raw.type || '').trim().toLowerCase();
    const type = hasConstraint
      ? (allowedTypes[typeRaw] && typeRaw !== 'none' ? typeRaw : 'other')
      : 'none';
    const policyRaw = String(raw.visit_policy || '').trim().toLowerCase();
    const visitPolicy = allowedPolicies[policyRaw]
      ? policyRaw
      : (hasConstraint ? 'conditional_only' : 'unknown');

    return {
      has_constraint: hasConstraint === true,
      type: type,
      confidence: safeConfidence,
      evidence: raw.evidence ? String(raw.evidence).substring(0, 180) : '',
      reason: raw.reason ? String(raw.reason).substring(0, 180) : '',
      visit_policy: visitPolicy,
      source: source || raw.source || 'unknown'
    };
  }

  _detectCurrentLocalPresence_(subject, body) {
    const text = `${subject || ''} ${body || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) return null;

    const patterns = [
      /\b(?:sono|siamo|mi\s+trovo|ci\s+troviamo)\s+(?:gia\s+|attualmente\s+)?(?:(?:in\s+vacanza|in\s+visita|di\s+passaggio)\s+)?(?:a|in)\s+roma\b/,
      /\b(?:i\s+am|we\s+are|i\s+m|we\s+re)\s+(?:already\s+|currently\s+)?(?:(?:on\s+vacation|on\s+holiday|visiting|staying)\s+)?in\s+rome\b/,
      /\b(?:je\s+suis|nous\s+sommes)\s+(?:deja\s+|actuellement\s+)?(?:(?:en\s+vacances|de\s+passage|en\s+sejour|en\s+visite)\s+)?a\s+rome\b/,
      /\b(?:estoy|estamos)\s+(?:ya\s+|actualmente\s+)?(?:(?:de\s+vacaciones|de\s+visita|de\s+paso)\s+)?en\s+roma\b/,
      /\b(?:estou|estamos)\s+(?:ja\s+|atualmente\s+)?(?:(?:de\s+ferias|de\s+visita|de\s+passagem)\s+)?em\s+roma\b/,
      /\b(?:ich\s+bin|wir\s+sind)\s+(?:schon\s+|derzeit\s+|aktuell\s+)?(?:(?:im\s+urlaub|zu\s+besuch|auf\s+besuch)\s+)?in\s+rom\b/
    ];

    if (!patterns.some((pattern) => pattern.test(text))) return null;

    return {
      detected: true,
      confidence: 0.95,
      reason: 'current_presence_in_rome'
    };
  }

  _resolvePhysicalPresenceConstraint_(quickConstraint, subject, body) {
    const normalizedQuick = this._normalizePhysicalPresenceConstraint_(quickConstraint, 'quick_check');
    const scheduledPresence = this._detectScheduledPresence_(subject, body);
    const currentLocalPresence = this._detectCurrentLocalPresence_(subject, body);

    if (
      normalizedQuick &&
      normalizedQuick.has_constraint &&
      normalizedQuick.confidence >= 0.65
    ) {
      if (
        currentLocalPresence &&
        (normalizedQuick.type === 'geographic_distance' || normalizedQuick.type === 'remote_request')
      ) {
        return {
          has_constraint: false,
          type: 'none',
          confidence: currentLocalPresence.confidence,
          evidence: '',
          reason: currentLocalPresence.reason,
          visit_policy: 'visit_ok',
          source: 'current_local_presence_override'
        };
      }
      if (scheduledPresence) normalizedQuick.scheduled_presence = scheduledPresence;
      return normalizedQuick;
    }

    const fallback = this._detectPhysicalPresenceConstraint_(subject, body);
    if (fallback) {
      if (scheduledPresence) fallback.scheduled_presence = scheduledPresence;
      return fallback;
    }

    return normalizedQuick || {
      has_constraint: false,
      type: 'none',
      confidence: 0,
      evidence: '',
      reason: '',
      visit_policy: 'unknown',
      source: 'default'
    };
  }

  _detectPhysicalPresenceConstraint_(subject, body) {
    const original = `${subject || ''} ${body || ''}`;
    const text = original
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ' ');
    const compact = text.replace(/\s+/g, ' ').trim();
    if (!compact) return null;

    const explicitVisitIntent = /\b(?:posso|possiamo|potrei|potremmo|vorrei|vorremmo)\s+(?:passare|venire|presentarmi|presentarci|recarmi|recarci)\b/.test(compact) ||
      /\b(?:passo|passiamo|vengo|veniamo)\s+(?:oggi|domani|dopodomani|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/.test(compact);
    const explicitCannotAttend = /\bnon\s+(?:posso|possiamo|riesco|riusciamo|riuscirei|riusciremmo|potrei|potremmo)\s+(?:venire|passare|recarmi|recarci|raggiungervi|spostarmi|spostarci|essere\s+presente|presentarmi|presentarci)\b/.test(compact);
    if (explicitVisitIntent && !explicitCannotAttend) return null;

    const rules = [
      {
        type: 'geographic_distance',
        confidence: 0.78,
        reason: 'lives_or_works_far_from_rome',
        pattern: /\b(?:vivo|abito|lavoro|risiedo|mi\s+trovo|sono)\s+(?:a|in|all[' ]?)\s+(?!roma\b)(?:germania|francia|spagna|inghilterra|gran\s+bretagna|regno\s+unito|uk|usa|stati\s+uniti|canada|australia|svizzera|austria|belgio|olanda|paesi\s+bassi|portogallo|irlanda|darmstadt|berlino|monaco|amburgo|colonia|francoforte|stoccarda|milano|torino|napoli|firenze|bologna|venezia|palermo|catania|bari|genova)\b/
      },
      {
        type: 'geographic_distance',
        confidence: 0.82,
        reason: 'abroad_or_far_from_rome',
        pattern: /\b(?:all[' ]?estero|fuori\s+roma|fuori\s+da\s+roma|lontano\s+da\s+roma|non\s+(?:sono|vivo|abito)\s+(?:a|di)\s+roma)\b/
      },
      {
        type: 'remote_request',
        confidence: 0.72,
        reason: 'remote_request',
        pattern: /\b(?:a\s+distanza|da\s+remoto|online|videochiamata|videocall)\b/
      },
      {
        type: 'health',
        confidence: 0.78,
        reason: 'health_or_hospital_constraint',
        pattern: /\b(?:ricoverat[oaie]?|ospedale|degenza|malat[oaie]?|convalescen[zt]a|allettat[oaie]?|terapia|operazione|intervento|invalid[oaie]?)\b/
      },
      {
        type: 'mobility',
        confidence: 0.72,
        reason: 'mobility_constraint',
        pattern: /\b(?:mobilita\s+ridotta|difficolt[ae]\s+(?:a\s+)?(?:muovermi|muoversi|spostarmi|spostarsi)|sedia\s+a\s+rotelle|deambulare|anzian[oa]\s+e\s+non\s+(?:riesco|posso))\b/
      },
      {
        type: 'caregiving',
        confidence: 0.7,
        reason: 'caregiving_or_baby_constraint',
        pattern: /\b(?:allatt|neonat[oa]|bimbo\s+piccolo|bambino\s+piccolo|non\s+posso\s+lasciare|assisto\s+(?:mia|mio|un|una)|caregiver)\b/
      },
      {
        type: 'legal_restriction',
        confidence: 0.86,
        reason: 'legal_restriction',
        pattern: /\b(?:arresti\s+domiciliari|detenzione\s+domiciliare|misura\s+cautelare|obbligo\s+di\s+dimora|detenut[oa]|carcere)\b/
      },
      {
        type: 'temporary_unavailability',
        confidence: 0.75,
        reason: 'cannot_attend',
        pattern: /\bnon\s+(?:posso|possiamo|riesco|riusciamo|riuscirei|riusciremmo|potrei|potremmo)\s+(?:venire|passare|recarmi|recarci|raggiungervi|spostarmi|spostarci|essere\s+presente|presentarmi|presentarci)\b/
      }
    ];

    for (const rule of rules) {
      if (rule.pattern.test(compact)) {
        return {
          has_constraint: true,
          type: rule.type,
          confidence: rule.confidence,
          evidence: '',
          reason: rule.reason,
          visit_policy: rule.type === 'legal_restriction' || rule.type === 'health'
            ? 'avoid_invitation'
            : 'conditional_only',
          source: 'local_fallback'
        };
      }
    }

    return null;
  }

  /**
   * Rileva se il mittente ha già pianificato una presenza fisica in parrocchia.
   * Deliberatamente conservativo: meglio perdere casi ambigui che trasformare
   * una semplice menzione di corso/incontro/appuntamento in presenza prevista.
   *
   * @param {string} subject
   * @param {string} body
   * @returns {{ detected: boolean, type: string, label: string } | null}
   */
  _detectScheduledPresence_(subject, body) {
    const text = `${subject || ''} ${body || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) return null;

    const patterns = [
      {
        pattern: /\b(?:vorrei|vorremmo|desidero|desideriamo|intendo|intendiamo|pensiamo|vorrei\s+informarmi\s+per|vorremmo\s+informarci\s+per|possibilita\s+di)\b.{0,80}\b(?:frequentare|partecipare\s+(?:a[l]?|a[l]?\s+un)|seguire|iscriver(?:mi|ci|si)|iscriversi\s+(?:a[l]?|al))\b.{0,80}\b(?:corso|percorso|cammino|incontri?)\b/,
        type: 'course',
        label: 'corso'
      },
      {
        pattern: /\b(?:mi\s+sono|ci\s+siamo|sono|siamo)\s+(?:gia\s+)?iscritt[ioe]\b.{0,80}\b(?:corso|percorso|cammino|incontri?)\b/,
        type: 'course',
        label: 'corso'
      },
      {
        pattern: /\b(?:frequenteremo|partecipero|parteciperemo|seguiremo|inizieremo)\b.{0,80}\b(?:corso|percorso|cammino|incontri?)\b/,
        type: 'course',
        label: 'corso'
      },
      {
        pattern: /\b(?:vorrei|vorremmo|desidero|desideriamo|intendo|intendiamo|possibilita\s+di)\b.{0,80}\b(?:frequentare|partecipare|seguire|iscriver(?:mi|ci|si)|iscriversi)\b.{0,80}\b(?:battesimo|cresima)\s+(?:degli?\s+)?adulti\b/,
        type: 'course',
        label: 'corso'
      },
      {
        pattern: /\b(?:ho|abbiamo)\s+(?:gia\s+)?(?:un\s+)?appuntament[oi]\b.{0,80}\b(?:fissato|confermato|concordato|previsto|preso)\b|\bappuntament[oi]\b.{0,80}\b(?:che\s+(?:ho|abbiamo)\s+(?:fissato|confermato|concordato|preso))\b/,
        type: 'appointment',
        label: 'appuntamento'
      }
    ];

    for (const { pattern, type, label } of patterns) {
      if (pattern.test(text)) {
        return { detected: true, type, label };
      }
    }

    return null;
  }

  _detectTemporalMentions(text, language) {
    // Protezione contro input nulli o non validi
    if (!text || typeof text !== 'string') return false;
    const monthPatterns = {
      // Nota: \b è ASCII-only; i lookaround Unicode evitano falsi negativi
      // sulle parole con accento finale (lunedì, martedì, ecc.).
      'it': /(?<![a-zA-ZÀ-ÿ])(oggi|domani|dopodomani|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?![a-zA-ZÀ-ÿ])/i,
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
    // Rileva domande esplicite, ma anche richieste implicite, condizionali e intenti
    // operativi (es. "se era possibile programmare...") che non contengono "?" né
    // le formule esatte "vorrei sapere"/"chiedo se". \w* dopo gli stem evita che il
    // confine di parola \b finale tronchi il match su forme flesse (es. "possibile",
    // "disponibilità").
    const attachmentBodyQuestionText = `${subject || ''} ${body || ''}`;
    const hasBodyOperationalRequest = (
      /\b(?:chiedo|richiedo|domando)\b[\s\S]{0,140}\b(?:permesso|autorizzazione|nulla\s*osta|consenso|assenso)\b/i.test(attachmentBodyQuestionText) ||
      /\b(?:permesso|autorizzazione|nulla\s*osta|consenso|assenso)\b[\s\S]{0,180}\b(?:firmare|timbrare|restituir\w*|rinviare|inviare|inoltrare|ricevere|celebrare|seguire)\b/i.test(attachmentBodyQuestionText) ||
      /\bse\s+acconsent\w*[\s\S]{0,120}\b(?:firmare|timbrare|restituir\w*|rinviare|inviare|inoltrare)\b/i.test(attachmentBodyQuestionText) ||
      /\b(?:firmare|timbrare|restituir\w*|rinviare|inviare|inoltrare)\b[\s\S]{0,100}\b(?:modul\w*|document\w*|letter\w*|autorizz\w*|permesso|nulla\s*osta)\b/i.test(attachmentBodyQuestionText) ||
      /\b(?:vi|le)\s+prego\s+di\s+(?:firmare|timbrare|restituir\w*|rinviare|inviare|inoltrare|confermare|autorizzare|approvare|rispondere)\b/i.test(attachmentBodyQuestionText)
    );
    const hasBodyQuestion = /\?|\b(?:vorrei|chiedo|mi dica|sapere|possibil\w*|possiamo|potremmo|programmare|fissare|disponibil\w*|se\s+(?:era|fosse|pu[oò]|potete))\b/i.test(attachmentBodyQuestionText)
      || hasBodyOperationalRequest;
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
    const isSacramentalDoc = /certificat[oa].{0,80}(battesim[oa]|cresim[ao])|battesim[oa].{0,80}uso.{0,40}matrimoni[oa]|(prima comunione|cresima ragazzi|catechismo|catechesi)|cresim[ao].{0,30}adult|iscrizion[ea].{0,40}(catechesi|corso|percorso)/i.test(docScopeText);

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
          ? `Confermare la ricezione dell'allegato, ma non limitarsi alla ricevuta: rispondere alla richiesta operativa esplicita nel corpo.`
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
      responseDirective = 'Consegna modulo sacramentale o di iscrizione alla catechesi rilevata. Conferma con calore la ricezione specificando chiaramente la tipologia di modulo/documento ricevuto dall\'utente.';
    }

    if (hasBodyQuestion || hasOcrQuestion) {
      intent += '_with_question';
      responseDirective = `Confermare la ricezione dell'allegato, poi rispondere puntualmente alla richiesta operativa contenuta nel corpo usando KB e contesto disponibili.`;
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

  /**
   * Validazione semantica "zero-shot" della coerenza tra il testo dell'email
   * e il contenuto effettivo dell'allegato (via OCR), usando una chiamata
   * leggera a Gemini.
   *
   * Complementa _evaluateDocumentConsistency_, che si basa su una tassonomia
   * locale fissa (certificati di battesimo/cresima, idoneità padrino/madrina,
   * moduli catechesi, sbattezzo, pellegrinaggio, documento d'identità...).
   * Quella tassonomia non ha alcuna opinione su allegati generici - video,
   * locandine, programmi, documentazione comunitaria - quindi "expected"
   * risulta sempre 'unknown' e un'incoerenza reale non può mai emergere.
   * Questo controllo chiude esattamente quel gap, chiedendo direttamente a
   * Gemini se l'allegato ricevuto è tematicamente coerente con quanto
   * l'utente descrive nell'email.
   *
   * Fail-open per design: se la chiamata fallisce, va in timeout o la
   * risposta non è interpretabile, ritorna null (nessuna opinione), senza
   * bloccare la pipeline né forzare un avviso non giustificato.
   *
   * @param {Object} params
   * @param {string} params.subject
   * @param {string} params.body
   * @param {Array} params.attachmentItems
   * @param {string} params.ocrText - testo estratto dall'allegato (OCR)
   * @param {Array} [params.attachmentBlobs] - riservato per un futuro controllo
   *   multimodale diretto sull'immagine; non utilizzato in questa versione
   *   testuale del controllo.
   * @param {string} [params.expectedAttachmentDescription] - descrizione attesa
   *   emersa dal quick check Gemini.
   * @returns {{consistent: boolean, reason: string, source: string}|null}
   */
  _evaluateAttachmentSemanticConsistency_({ subject, body, attachmentItems, ocrText, expectedAttachmentDescription } = {}) {
    const trimmedSubject = String(subject || '').trim();
    const trimmedBody = String(body || '').trim();
    const expectedDescription = String(expectedAttachmentDescription || '').trim();
    const attachmentNames = Array.isArray(attachmentItems)
      ? attachmentItems.map((it) => (it && it.name) ? it.name : '').filter(Boolean).join(', ')
      : '';
    const rawOcrText = String(ocrText || '').trim();
    // Il testo OCR può essere un avviso di sistema (impostato più sopra in
    // processThread quando il pre-check ha saltato l'estrazione OCR): non è
    // materiale reale su cui basare un giudizio di coerenza.
    const isPlaceholderOcr = /^\[Avviso di sistema/i.test(rawOcrText);
    const effectiveOcrText = isPlaceholderOcr ? '' : rawOcrText;

    if (!trimmedSubject && !trimmedBody) return null;
    if (!effectiveOcrText && !attachmentNames) return null;

    if (!this.geminiService || typeof this.geminiService.generateResponse !== 'function') {
      return null;
    }
    const apiKey = this.geminiService.primaryKey;
    if (!apiKey) return null;

    const prompt = [
      'Rispondi SOLO con un oggetto JSON valido, senza testo aggiuntivo, senza markdown e senza spiegazioni.',
      'Formato esatto: {"consistent": true, "reason": "breve motivo in italiano, massimo 15 parole"}',
      '',
      "Determina se il contenuto dell'allegato ricevuto è tematicamente coerente con ciò che l'utente descrive nella sua email. Non valutare la qualità, la forma o la completezza del documento: valuta solo se l'argomento dell'allegato corrisponde a quanto annunciato nel testo.",
      '',
      `OGGETTO EMAIL: ${trimmedSubject.slice(0, 300)}`,
      `CORPO EMAIL: ${trimmedBody.slice(0, 1500)}`,
      `DESCRIZIONE ATTESA DAL QUICK CHECK: ${expectedDescription ? expectedDescription.slice(0, 500) : '(non disponibile)'}`,
      '',
      `NOME/I ALLEGATO/I: ${attachmentNames || '(non disponibile)'}`,
      `TESTO ESTRATTO DALL'ALLEGATO (OCR): ${effectiveOcrText ? effectiveOcrText.slice(0, 2000) : "(nessun testo estratto, valuta solo in base al nome file se informativo)"}`
    ].join('\n');

    try {
      const rawResult = this.geminiService.generateResponse(prompt, {
        apiKey: apiKey,
        // Modello leggero per un controllo ausiliario a bassa latenza/costo:
        // stesso fallback usato altrove in questo file per chiamate non critiche.
        modelName: 'gemini-3.5-flash-lite',
        skipRateLimit: true
      });

      const rawText = (rawResult && typeof rawResult === 'object') ? rawResult.text : rawResult;
      if (!rawText || typeof rawText !== 'string') return null;

      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.consistent !== 'boolean') return null;

      return {
        consistent: parsed.consistent,
        reason: String(parsed.reason || '').trim().slice(0, 200),
        source: 'semantic_zero_shot'
      };
    } catch (semanticCheckError) {
      console.warn(`   ⚠️ Verifica semantica allegato fallita (non bloccante): ${semanticCheckError.message}`);
      return null;
    }
  }

  _detectDocumentTypeFromText_(text) {
    const src = String(text || '').toLowerCase();
    if (!src.trim()) return 'unknown';

    const rules = [
      { type: 'certificato_battesimo_uso_matrimonio', pattern: /\bbattesim[oa]\b[\s\S]{0,80}\buso\b[\s\S]{0,40}\bmatrimoni[oa]\b/i },
      { type: 'certificato_battesimo_uso_matrimonio', pattern: /\b(uso matrimoniale|per matrimonio)\b/i },
      // NOTA: \b dopo una vocale accentata (es. "idoneità") in JS non scatta mai, perché
      // l'engine regex valuta \w in ASCII-only e tratta "à" come carattere non di parola:
      // non c'è transizione \w/\W tra "à" e lo spazio o la fine stringa che segue. Per questo
      // usiamo (?![a-zàèéìòù]) al posto del \b finale dove lo stem può terminare in vocale accentata.
      { type: 'attestato_idoneita_padrino_madrina', pattern: /\b(attestat[oa]|certificat[oa])\b[\s\S]{0,60}\bidoneit[aà](?![a-zàèéìòù])/i },
      { type: 'attestato_idoneita_padrino_madrina', pattern: /\bidoneit[aà](?![a-zàèéìòù])|\bpadrin[oa]\b|\bmadrin[ao]\b|\bsponsor\b/i },
      { type: 'certificato_battesimo', pattern: /\bcertificat[oa]\b[\s\S]{0,40}\bbattesim[oa]\b/i },
      { type: 'certificato_cresima', pattern: /\bcertificat[oa]\b[\s\S]{0,40}\bcresim[ao]\b/i },
      { type: 'scheda_iscrizione_corso_prematrimoniale', pattern: /\b(scheda|modulo)\b[\s\S]{0,40}\biscrizion[ea]\b[\s\S]{0,60}\bprematrimoniale\b/i },
      { type: 'scheda_iscrizione_catechesi_comunione_cresima_ragazzi', pattern: /\b(prima comunione|cresima ragazzi|catechismo)\b/i },
      { type: 'scheda_iscrizione_cresima_adulti', pattern: /\bcresim[ao]\b[\s\S]{0,30}\badult/i },
      { type: 'scheda_iscrizione_catechesi_buon_pastore', pattern: /\bbuon pastore\b/i },
      { type: 'scheda_iscrizione_pellegrinaggio', pattern: /\bpellegrinaggi[oa]\b|\bcammino\s+di\s+santiago\b/i },
      { type: 'modulo_sbattezzo_rinuncia_cancellazione_registri', pattern: /\b(sbattezz[oa]|apostasi[ao]|rinuncia)\b/i },
      { type: 'modulo_sbattezzo_rinuncia_cancellazione_registri', pattern: /\bcancellazion[ea]\b[\s\S]{0,40}\bregistr[oi]\b[\s\S]{0,30}\bbattesim[oa]\b/i },
      // Tenuta in fondo come fallback di bassa priorità: un documento d'identità è quasi
      // sempre allegato a supporto di una richiesta più specifica (idoneità, battesimo...),
      // mai il "soggetto" della richiesta. Se la regola fosse più in alto, un corpo email
      // che cita sia "certificato di battesimo" sia "carta d'identità" verrebbe classificato
      // come documento_identita anziché certificato_battesimo, generando un mismatch falso
      // positivo per chi ha inviato il documento giusto.
      { type: 'documento_identita', pattern: /\bcarta\s+d['’]?identit[aà](?![a-zàèéìòù])|\bpassaporto\b|\bpatente\b|\bdocumento\s+(?:di\s+)?identit[aà](?![a-zàèéìòù])|\bcodice\s+fiscale\b/i }
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
    return `${greeting}\n\nAbbiamo ricevuto il suo messaggio. Non vorremmo sbagliare, ma ci sembra che ci abbia inviato un documento allegato non corrispondente a quanto annunciato o richiesto. La invitiamo a verificare l'allegato e, nel caso, a reinviare il file corretto.\n\n${closing}\nSegreteria Parrocchia Sant'Eugenio`;
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
          /\b(devo|dovrei|ho bisogno|ho la necessit[aà]|mi serve)\b[\s\S]{0,120}\b(ricevere|fare|completare)\b[\s\S]{0,140}\bcresim\w*/i.test(source) ||
          /\b(completare|concludere)\b[\s\S]{0,80}\b(percorso|iniziazione cristiana)\b[\s\S]{0,80}\bcresim\w*/i.test(source);
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
        return /\b(fare|faro|farò|diventare|essere|saro|sarò|fungere|assumere|svolgere|svolgero|svolgerò)(?![a-zàèéìòù])[\s\S]{0,45}\b(da\s+|il\s+|la\s+)?(padrin\w*|madrin\w*)\b/i.test(source) ||
          /\b(scelt[oa]|chiest[oa]|chiamat[oa]|mi hanno chiesto|mi è stato chiesto)\b[\s\S]{0,90}\b(padrin\w*|madrin\w*)\b/i.test(source) ||
          /\b(padrin\w*|madrin\w*)\b[\s\S]{0,40}\b(fare|faro|farò|essere|saro|sarò|svolgere|svolgero|svolgerò)(?![a-zàèéìòù])/i.test(source);
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

    const lines = text.split(/\r?\n/);
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
      if (/\b(requisit[oi]|condizion[ei]|necessari[oae]|idoneit[aà])\b.{0,60}\b(padrin[oa]?|madrin[ao]?|sponsor)\b|\b(padrin[oa]?|madrin[ao]?|sponsor)\b.{0,60}\b(requisit[oi]|condizion[ei]|necessari[oae]|idoneit[aà])\b/i.test(line)) {
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

  _buildReceiptOnlySubmissionResponse_(lang = 'it', categoryHintSource = null, deliveryChannel = 'attachment', options = {}) {
    const normalizedLang = this._normalizeBypassResponseLanguage_(lang);
    const senderName = options && typeof options === 'object' ? options.senderName : '';
    const { greeting, closing } = this._getAdaptiveBypassGreetingAndClosing_(normalizedLang, senderName);
    // Nome del documento usato solo nel testo IT, in base alla categoria già
    // rilevata post-OCR (sacrament/formal). Il guardrail "sola ricezione" resta
    // intatto: qui personalizziamo solo la formulazione, non la logica di decisione.
    const isBodyDelivery = deliveryChannel === 'body';
    let docNameIT = isBodyDelivery ? "i dati riportati nel messaggio" : "la documentazione allegata";
    if (!isBodyDelivery && categoryHintSource === 'sacrament') docNameIT = "il modulo sacramentale/di iscrizione allegato";
    else if (!isBodyDelivery && categoryHintSource === 'formal') docNameIT = "la richiesta formale allegata";
    if (normalizedLang === 'it') {
      return `${greeting}

Abbiamo ricevuto con successo ${docNameIT}.
Prima di procedere o confermare l'operazione, la segreteria ne verificherà il contenuto.

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

  _getAdaptiveBypassGreetingAndClosing_(lang = 'it', senderName = '') {
    const normalized = this._normalizeBypassResponseLanguage_(lang);
    const fallback = normalized === 'en'
      ? { greeting: 'Good day,', closing: 'Kind regards,' }
      : { greeting: 'Buongiorno.', closing: 'Cordiali saluti,' };

    if (this.geminiService && typeof this.geminiService.getAdaptiveGreeting === 'function') {
      try {
        const fallbackSenderName = senderName || (normalized === 'it' ? 'utente' : 'parishioner');
        const adaptive = this.geminiService.getAdaptiveGreeting(fallbackSenderName, normalized) || {};
        const greeting = String(adaptive.greeting || '').trim();
        const closing = String(adaptive.closing || '').trim();
        const leaksPlaceholder = /fallbackSenderName|\bundefined\b|\bnull\b|\[nome\]|\[name\]/i.test(`${greeting} ${closing}`);
        if (greeting && closing && !leaksPlaceholder) {
          return {
            greeting: greeting,
            closing: closing
          };
        }
      } catch (e) {
        console.warn(`⚠️ Saluto adattivo bypass non disponibile: ${e.message}`);
      }
    }

    return fallback;
  }

  _normalizeRelationalPostureAlias_(posture) {
    const normalized = String(posture || '').trim().toLowerCase();
    const aliases = {
      direct: 'informational',
      personal: 'relational',
      open: 'appreciative',
      appreciative: 'appreciative',
      grateful: 'appreciative',
      gratitude: 'appreciative',
      enthusiastic: 'appreciative',
      hesitant: 'uncertain',
      complaint: 'procedural'
    };
    const canonical = aliases[normalized] || normalized;
    const allowed = new Set(['informational', 'procedural', 'relational', 'appreciative', 'urgent', 'uncertain']);
    return allowed.has(canonical) ? canonical : 'informational';
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
    return 'full';
  }

  const parsedLastUpdated = parseDateForEmailTiming_(lastUpdated);
  if (!parsedLastUpdated) {
    return 'full';
  }

  const timeSinceLastMs = now.getTime() - parsedLastUpdated.getTime();
  const minutesSinceLast = timeSinceLastMs / (1000 * 60);
  const hoursSinceLast = timeSinceLastMs / (1000 * 60 * 60);

  if (isNaN(hoursSinceLast) || hoursSinceLast < 0) {
    console.warn(`⚠️ computeSalutationMode: timestamp futuro o invalido (lastUpdated=${lastUpdated}, delta=${Math.round(timeSinceLastMs / 1000)}s)`);
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

  const parsedMessageDate = parseDateForEmailTiming_(messageDate);
  if (!parsedMessageDate) {
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

function parseDateForEmailTiming_(value) {
  try {
    const parsed = (typeof parseDateSafe === 'function')
      ? parseDateSafe(value, null)
      : new Date(value);
    return (parsed instanceof Date && !isNaN(parsed.getTime())) ? parsed : null;
  } catch (_) {
    return null;
  }
}

// Compatibilità: rende la funzione disponibile anche in runtime che usano moduli/isolamento
if (typeof globalThis !== 'undefined' && typeof globalThis.computeResponseDelay !== 'function') {
  globalThis.computeResponseDelay = computeResponseDelay;
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
