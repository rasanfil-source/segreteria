/**
 * GeminiRateLimiter.gs - Gestione Quote API Gemini
 * 
 * SINCRONO - Compatibile con Google Apps Script
 * Configurazione modelli centralizzata in gas_config.js
 * Reset quota: ore 9:00 italiane (mezzanotte Pacific)
 * Cache ottimizzata per ridurre letture PropertiesService
 * 
 * FUNZIONALITÀ:
 * - Traccia utilizzo RPM (richieste/minuto), TPM (token/minuto), RPD (richieste/giorno)
 * - Seleziona automaticamente il modello disponibile
 * - Applica throttling quando ci si avvicina ai limiti
 * - Passa al modello di riserva se il principale è esaurito
 */
var GeminiRateLimiter = class GeminiRateLimiter {
  constructor(options = {}) {
    console.log('\uD83D\uDEA6 Inizializzazione GeminiRateLimiter...');

    // ================================================================
    // CONFIGURAZIONE MODELLI (Legge da CONFIG)
    // ================================================================

    // Legge modelli da CONFIG.GEMINI_MODELS (centralizzato)
    if (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_MODELS) {
      this.models = CONFIG.GEMINI_MODELS;
      this.models = this._normalizeDeprecatedModelNames(this.models);
      console.log('   \u2713 Modelli caricati da CONFIG.GEMINI_MODELS');
    } else {
      // Fallback se CONFIG non disponibile
      console.warn('   \u26A0\uFE0F CONFIG.GEMINI_MODELS non trovato, uso default');
      // Default conservativo allineato alla policy: 2.5 Flash per generazione,
      // 3.1 Flash-Lite per task rapidi/ausiliari.
      this.models = {
        'flash-3.5': {
          name: 'gemini-3.5-flash',
          rpm: 15, tpm: 1000000, rpd: 1500,
          contextWindowTokens: 1048576,
          useCases: ['generation', 'all']
        },
        'flash-3.5-backup': {
          name: 'gemini-3.5-flash',
          rpm: 15, tpm: 1000000, rpd: 1500,
          contextWindowTokens: 1048576,
          useCases: ['generation', 'backup']
        },
        'flash-lite': {
          name: 'gemini-3.1-flash-lite',
          rpm: 15, tpm: 1000000, rpd: 1500,
          contextWindowTokens: 1048576,
          useCases: ['fallback', 'classification', 'quick_check', 'language', 'semantic', 'newsletter_summary']
        },
        'flash-3.5-lite': {
          name: 'gemini-3.1-flash-lite',
          rpm: 15, tpm: 1000000, rpd: 1500,
          contextWindowTokens: 1048576,
          useCases: ['fallback', 'classification', 'quick_check', 'language', 'semantic', 'newsletter_summary']
        },
        'flash-3.5-lite-backup': {
          name: 'gemini-3.1-flash-lite',
          rpm: 15, tpm: 1000000, rpd: 1500,
          contextWindowTokens: 1048576,
          useCases: ['fallback', 'backup', 'classification', 'quick_check', 'language', 'semantic', 'newsletter_summary']
        }
      };
    }

    // Legge strategia da CONFIG.MODEL_STRATEGY (centralizzato)
    if (typeof CONFIG !== 'undefined' && CONFIG.MODEL_STRATEGY) {
      this.strategies = CONFIG.MODEL_STRATEGY;
      console.log('   \u2713 Strategia caricata da CONFIG.MODEL_STRATEGY');
    } else {
      // Impostazione predefinita di fallback
      this.strategies = {
        'quick_check': ['flash-lite'],
        'classification': ['flash-lite'],
        'language': ['flash-lite'],
        'newsletter_summary': ['flash-lite'],
        'generation': ['flash-3.5', 'flash-3.5-backup', 'flash-lite', 'flash-3.5-lite-backup'],
        'semantic': ['flash-lite', 'flash-3.5-lite-backup'],
        'fallback': ['flash-lite', 'flash-3.5-lite-backup']
      };
    }

    // Modello di default (primo nella lista generation)
    this.defaultModel = (this.strategies.generation && this.strategies.generation[0]) ||
      Object.keys(this.models)[0] ||
      'flash-3.5';

    // ================================================================
    // CACHE IN-MEMORY (per ridurre PropertiesService reads)
    // ================================================================

    this.cache = {
      rpmWindow: [],
      tpmWindow: [],
      lastCacheUpdate: 0,
      lastPersistUpdate: 0,
      cacheTTL: 10000  // 10 secondi cache TTL
    };

    // ================================================================
    // PERSISTENZA (PropertiesService)
    // ================================================================

    this.props = options.props || PropertiesService.getScriptProperties();

    // Sincronizzazione dello stato con lo storage persistente.
    this._recoverFromWAL(options.alreadyLocked || false);

    // Inizializza contatori se non esistono
    this._initializeCounters();

    // ================================================================
    // CONFIGURAZIONE THROTTLING
    // ================================================================

    this.safetyMargin = {
      rpm: 0.8,   // 80% del limite RPM
      tpm: 0.8,
      rpd: (typeof CONFIG !== 'undefined' && Number.isFinite(CONFIG.SAFETY_VALVE_THRESHOLD))
        ? CONFIG.SAFETY_VALVE_THRESHOLD
        : 0.8
    };

    this.throttleDelays = {
      rpm: 250,    // Calibrato dinamicamente in _shouldThrottle
      tpm: 1000,
      rpd: 15000
    };

    // Exponential backoff
    const backoffConfig = (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_BACKOFF) ? CONFIG.GEMINI_BACKOFF : {};
    this.backoffBase = Number(backoffConfig.retryDelayMs) > 0 ? Number(backoffConfig.retryDelayMs) : 4000;
    this.backoffMultiplier = Number(backoffConfig.factor) > 1 ? Number(backoffConfig.factor) : 2.5;
    this.maxBackoff = Number(backoffConfig.maxBackoffMs) > 0 ? Number(backoffConfig.maxBackoffMs) : 120000;
    this.defaultMaxRetries = Number(backoffConfig.rateLimiterMaxRetries) > 0 ? Number(backoffConfig.rateLimiterMaxRetries) : 2;

    console.log('✓ GeminiRateLimiter inizializzato');
    console.log(`   Modelli: ${Object.keys(this.models).join(', ')}`);
    console.log(`   Default: ${this.defaultModel}`);
  }

  /**
   * Sostituisce nomi modello deprecati/ritirati con equivalenti supportati.
   * Mantiene la stessa struttura dell'oggetto modelli.
   *
   * @param {Object<string, {name: string}>} models
   * @returns {Object<string, {name: string}>}
   */
  _normalizeDeprecatedModelNames(models) {
    const deprecatedMap = {
      // Mappatura alias lite storici verso il profilo operativo rapido scelto.
      'gemini-2.5-flash-lite': 'gemini-3.1-flash-lite',
      'gemini-2.5-flash-exp': 'gemini-3.1-flash-lite',
      'gemini-2.0-flash-exp': 'gemini-3.1-flash-lite',
      'gemini-2.0-flash': 'gemini-3.1-flash-lite',
      'gemini-2.0-flash-lite': 'gemini-3.1-flash-lite',
      // Refuso ricorrente: non esiste un modello testuale 'gemini-3.1-flash'; il full-tier è Gemini 3 Flash Preview.
      'gemini-3.1-flash': 'gemini-3-flash-preview',
      'gemini-2.5-flash': 'gemini-3.5-flash'
    };

    const knownCurrentModels = [
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.1-flash-lite-preview',
      'gemini-3-flash-preview'
    ];

    const normalized = {};
    Object.keys(models || {}).forEach(modelKey => {
      const modelConfig = models[modelKey] || {};
      const currentName = modelConfig.name;
      const replacement = deprecatedMap[currentName];

      if (replacement) {
        console.warn(`⚠️ Modello deprecato rilevato per '${modelKey}': ${currentName} → ${replacement}`);
      } else if (currentName && !knownCurrentModels.includes(currentName)) {
        console.warn(`⚠️ Modello sconosciuto per '${modelKey}': '${currentName}' non è tra i modelli noti né deprecati. Verificare CONFIG.`);
      }

      const fallbackName = this._getFallbackModelNameForKey_(modelKey, modelConfig);

      normalized[modelKey] = Object.assign({}, modelConfig, {
        name: replacement || ((currentName === undefined || currentName === null || (typeof currentName === 'string' && currentName.trim() === '')) ? fallbackName : currentName)
      });

      const nameWasMissing = currentName === undefined || currentName === null;
      const nameWasEmpty = typeof currentName === 'string' && currentName.trim() === '';
      if (nameWasMissing || nameWasEmpty) {
        console.warn(`⚠️ Modello '${modelKey}' con name ${nameWasMissing ? 'assente' : 'vuoto'} in CONFIG: uso fallback '${normalized[modelKey].name}'.`);
      }
    });

    // Restituisce sempre una nuova copia normalizzata: il chiamante decide se riassegnarla.
    return normalized;
  }

  _getFallbackModelNameForKey_(modelKey, modelConfig) {
    const key = String(modelKey || '').toLowerCase();
    const useCases = Array.isArray(modelConfig && modelConfig.useCases)
      ? modelConfig.useCases.map(value => String(value || '').toLowerCase())
      : [];
    const isLiteTask = key.includes('lite') || useCases.some(value =>
      ['quick_check', 'classification', 'language', 'semantic', 'newsletter_summary'].includes(value)
    );
    return isLiteTask ? 'gemini-3.1-flash-lite' : 'gemini-3.5-flash';
  }

  // ================================================================
  // INIZIALIZZAZIONE
  // ================================================================

  _initializeCounters() {
    // Usa ScriptLock per sincronizzare il reset tra esecuzioni parallele
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    try {
      // Tentativo di acquisizione lock con retry (backoff breve)
      for (let i = 0; i < 3; i++) {
        if (lock.tryLock(2000)) {
          lockAcquired = true;
          break;
        }
        if (i < 2) {
          Utilities.sleep(500 * (i + 1));
        }
      }

      if (lockAcquired) {
        // Rileggi sempre le proprietà dopo aver acquisito il lock per evitare race condition
        // Usa data Pacific per allinearsi al reset reale delle quote Google
        // Il ripristino di Google avviene a mezzanotte del Pacifico = 9:00 AM italiana
        const storedDate = this.props.getProperty('rate_limit_date');
        const pacificDate = this._getPacificDate();

        // Reset quando cambia la data Pacific (non italiana!)
        if (storedDate !== pacificDate) {
          console.log(`📅 Giorno Pacific cambiato (${pacificDate}), reset contatori giornalieri`);
          console.log(`   (Ora italiana: ${Utilities.formatDate(new Date(), 'Europe/Rome', 'HH:mm')})`);
          this._resetDailyCounters();
          // Forza svuotamento cache locale per riflettere subito il reset
          this.cache.lastCacheUpdate = 0;
        }
      } else {
        console.warn('⚠️ Impossibile acquisire lock per reset quota, salto controllo');
      }
    } catch (e) {
      console.error(`❌ Errore durante lock inizializzazione quota: ${e.message}`);
    } finally {
      if (lockAcquired) {
        try {
          lock.releaseLock();
        } catch (e) {
          console.warn(`⚠️ Errore rilascio lock (QuotaReset): ${e.message}`);
        }
      }
    }
  }

  _resetDailyCounters() {
    const todayPacific = this._getPacificDate();
    const newProps = {};
    for (const modelKey in this.models) {
      newProps[`rpd_${modelKey}`] = '0';
      newProps[`rpd_date_${modelKey}`] = todayPacific;
      newProps[`tokens_${modelKey}`] = '0';
    }

    // Reset anche cache + data Pacific in un'unica scrittura atomica.
    newProps.rpm_window = JSON.stringify([]);
    newProps.tpm_window = JSON.stringify([]);
    newProps.rate_limit_date = todayPacific;
    this.props.setProperties(newProps);

    this.cache.rpmWindow = [];
    this.cache.tpmWindow = [];
    this.cache.lastCacheUpdate = 0;
    console.log('✓ Contatori giornalieri resettati');
  }

  /**
   * Ottieni data in formato italiano (per logging user-friendly)
   */
  _getItalianDate() {
    const now = new Date();
    const italianDate = Utilities.formatDate(now, 'Europe/Rome', 'yyyy-MM-dd');
    return italianDate;
  }

  /**
   * Ottieni data Pacific (per reset quote Google)
   * Il reset delle quote Google avviene a mezzanotte Pacific Time.
   * Mezzanotte Pacific = 9:00 AM italiana (in inverno, 8:00 in estate con DST)
   */
  _getPacificDate() {
    const now = new Date();
    try {
      // America/Los_Angeles gestisce automaticamente DST (PST/PDT)
      const pacificDate = Utilities.formatDate(now, 'America/Los_Angeles', 'yyyy-MM-dd');

      const month = now.getMonth();
      if (month === 2 || month === 10) {
        const hour = parseInt(Utilities.formatDate(now, 'America/Los_Angeles', 'HH'), 10);
        if (hour >= 0 && hour <= 3) {
          console.warn(`⚠️ Possibile transizione DST in corso, ora Pacific: ${hour}`);
        }
      }

      return pacificDate;
    } catch (error) {
      console.error(`❌ Errore getPacificDate: ${error.message}`);
      return Utilities.formatDate(now, 'UTC', 'yyyy-MM-dd');
    }
  }

  // ================================================================
  // SELEZIONE MODELLO
  // ================================================================

  selectModel(taskType, options, alreadyLocked = false) {
    options = options || {};
    const forceModel = options.forceModel || null;
    const estimatedTokens = options.estimatedTokens || 1000;

    if (alreadyLocked) {
      this._recoverFromWAL(true);
      this._refreshCache();
      return this._selectModelUnlocked(taskType, options);
    }

    const lockResult = this._withRateLimitLock_(function () {
      this._recoverFromWAL(true);
      this._refreshCache();
      return this._selectModelUnlocked(taskType, {
        forceModel: forceModel,
        estimatedTokens: estimatedTokens
      });
    }.bind(this), {
      timeoutReason: 'rate_limiter_lock_timeout',
      lockDescription: 'selezione modello'
    });

    if (!lockResult.ok) {
      return lockResult.result;
    }
    return lockResult.result;
  }

  _selectModelUnlocked(taskType, options) {
    options = options || {};
    const forceModel = options.forceModel || null;
    const estimatedTokens = options.estimatedTokens || 1000;

    if (forceModel && this.models[forceModel]) {
      return this._validateModelAvailability(forceModel, estimatedTokens);
    }

    const candidates = this._getCandidateModels(taskType);
    for (var i = 0; i < candidates.length; i++) {
      const modelKey = candidates[i];
      const result = this._validateModelAvailability(modelKey, estimatedTokens);
      if (result.available) {
        console.log(`✓ Selezionato: ${modelKey} per ${taskType}`);
        return result;
      }
    }

    return {
      available: false,
      modelKey: null,
      reason: 'all_quotas_exhausted',
      nextResetTime: this._getNextResetTime()
    };
  }

  _getCandidateModels(taskType) {
    const taskStrategies = this.strategies || {};
    const resolvedStrategies = Object.assign(
      {
        classification: taskStrategies['quick_check'] || ['flash-lite'],
        language: taskStrategies['quick_check'] || ['flash-lite'],
        newsletter_summary: taskStrategies['quick_check'] || ['flash-lite']
      },
      taskStrategies
    );

    return resolvedStrategies[taskType] || resolvedStrategies['fallback'] || ['flash-lite', 'flash-3.5-lite-backup'];
  }

  _withRateLimitLock_(fn, options) {
    options = options || {};
    const timeoutReason = options.timeoutReason || 'lock_timeout';
    const lockDescription = options.lockDescription || 'rate limiter';
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    const maxLockAttempts = 3;

    for (let attempt = 0; attempt < maxLockAttempts; attempt++) {
      lockAcquired = lock.tryLock(5000);
      if (lockAcquired) break;
      if (attempt < maxLockAttempts - 1) {
        const backoffMs = 150 * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
        Utilities.sleep(backoffMs);
      }
    }

    if (!lockAcquired) {
      console.warn(`⚠️ Lock non acquisito per ${lockDescription} dopo retry`);
      return {
        ok: false,
        result: {
          available: false,
          modelKey: null,
          reason: timeoutReason,
          nextResetTime: this._getNextResetTime()
        }
      };
    }

    try {
      return { ok: true, result: fn() };
    } finally {
      lock.releaseLock();
    }
  }

  _validateModelAvailability(modelKey, estimatedTokens) {
    const model = this.models[modelKey];
    if (!model) {
      return { available: false, reason: 'model_not_found_in_config', message: `Modello '${modelKey}' non trovato in GEMINI_MODELS` };
    }

    // Controllo quote per modelKey logico (evita over-count tra alias fisici)
    const rpdUsed = parseInt(this.props.getProperty(`rpd_${modelKey}`) || '0', 10) || 0;
    const rpmUsed = this._getRequestsInWindow('rpm', modelKey);
    const tpmUsed = this._getTokensInWindow('tpm', modelKey);
    const rpdLeft = model.rpd - rpdUsed;

    if (rpdLeft <= 0) {
      return {
        available: false,
        modelKey: modelKey,
        reason: 'rpd_exhausted',
        quotaLeft: { rpd: 0 }
      };
    }

    // Controllo RPM (ultimo minuto)
    const rpmLeft = model.rpm - rpmUsed;

    if (rpmLeft <= 0) {
      return {
        available: false,
        modelKey: modelKey,
        reason: 'rpm_exhausted',
        retryAfter: 60
      };
    }

    // Controllo TPM (ultimo minuto)
    const tpmLeft = model.tpm - tpmUsed;

    if (tpmLeft < estimatedTokens) {
      return {
        available: false,
        modelKey: modelKey,
        reason: 'tpm_insufficient',
        quotaLeft: { tpm: tpmLeft },
        retryAfter: 60
      };
    }

    // Modello disponibile
    return {
      available: true,
      modelKey: modelKey,
      model: model,
      quotaLeft: {
        rpd: rpdLeft,
        rpm: rpmLeft,
        tpm: tpmLeft
      },
      shouldThrottle: this._shouldThrottle(modelKey, rpdUsed, rpmUsed, tpmUsed)
    };
  }

  _shouldThrottle(modelKey, rpdUsed, rpmUsed, tpmUsed) {
    const model = this.models[modelKey];

    const rpdRatio = rpdUsed / model.rpd;
    const rpmRatio = rpmUsed / model.rpm;
    const tpmRatio = tpmUsed / model.tpm;

    if (rpdRatio >= this.safetyMargin.rpd) {
      this._applySafetyValve_();
      const rpdDelay = Math.min(60000, Math.max(this.throttleDelays.rpd, Math.round((rpdRatio - this.safetyMargin.rpd + 0.05) * 120000)));
      return { needed: true, reason: 'rpd', delay: rpdDelay };
    }
    if (rpmRatio >= this.safetyMargin.rpm) {
      const minIntervalMs = Math.ceil(60000 / Math.max(1, model.rpm));
      const overSafetyRequests = Math.max(1, rpmUsed - Math.floor(model.rpm * this.safetyMargin.rpm) + 1);
      const rpmDelay = Math.min(30000, Math.max(this.throttleDelays.rpm, overSafetyRequests * minIntervalMs));
      return { needed: true, reason: 'rpm', delay: rpmDelay };
    }
    if (tpmRatio >= this.safetyMargin.tpm) {
      const tpmDelay = Math.min(30000, Math.max(this.throttleDelays.tpm, Math.round((tpmRatio - this.safetyMargin.tpm + 0.05) * 60000)));
      return { needed: true, reason: 'tpm', delay: tpmDelay };
    }

    return { needed: false };
  }

  _applySafetyValve_() {
    if (typeof CONFIG === 'undefined') return;
    const initialCap = Number(CONFIG.MAX_EMAILS_PER_RUN);
    if (!Number.isFinite(initialCap) || initialCap <= 1) return;


    const todayPacific = this._getPacificDate();
    const dateKey = 'safety_valve_last_date';
    const valueKey = 'safety_valve_reduced_value';
    const originalKey = 'safety_valve_original_value';
    const alreadyAppliedToday = this.props.getProperty(dateKey) === todayPacific;

    if (alreadyAppliedToday) {
      // GAS usa runtime effimero: ricarichiamo il valore ridotto persistito a ogni esecuzione.
      const currentCap = Number(CONFIG.MAX_EMAILS_PER_RUN);
      if (!Number.isFinite(currentCap) || currentCap <= 1) return;
      const stored = parseInt(this.props.getProperty(valueKey) || '0', 10);
      const canReapplyStored =
        stored > 0 &&
        currentCap >= stored;

      if (canReapplyStored && stored < currentCap) {
        console.warn(`🚨 Safety Valve (persistita): MAX_EMAILS_PER_RUN → ${stored}`);
        CONFIG.MAX_EMAILS_PER_RUN = stored;
      }
      return;
    }

    const currentCap = Number(CONFIG.MAX_EMAILS_PER_RUN);
    if (!Number.isFinite(currentCap) || currentCap <= 1) return;
    const reduced = Math.max(1, Math.floor(currentCap / 2));
    if (reduced < currentCap) {
      console.warn(`🚨 Safety Valve attiva: MAX_EMAILS_PER_RUN ${currentCap} → ${reduced}`);
      CONFIG.MAX_EMAILS_PER_RUN = reduced;
      this.props.setProperty(dateKey, todayPacific);
      this.props.setProperty(valueKey, String(reduced));
      this.props.setProperty(originalKey, String(currentCap));
    }
  }

  // ================================================================
  // ESECUZIONE RICHIESTA (SINCRONO)
  // ================================================================

  /**
   * Esegue richiesta con rate limiting
   * VERSIONE SINCRONA per Google Apps Script
   * 
   * @param {string} taskType - Tipo task: 'quick_check', 'generation', etc.
   * @param {Function} requestFn - Funzione che riceve modelName ed esegue la richiesta
   * @param {Object} options - {estimatedTokens, maxRetries, forceModel, skipRateLimit}
   * @returns {Object} {success, result, modelUsed, quotaUsed}
   */
  executeRequest(taskType, requestFn, options) {
    options = options || {};

    // ═══════════════════════════════════════════════════════════════════
    // BYPASS PER CHIAVE DI RISERVA
    // Se stiamo usando una chiave esterna, NON dobbiamo tracciare i consumi
    // sul Rate Limiter locale per non inquinare le statistiche della chiave principale
    // ═══════════════════════════════════════════════════════════════════
    if (options.skipRateLimit) {
      console.warn('\u23E9 RateLimiter BYPASSED (Chiave di Riserva in uso)');
      try {
        const startTime = Date.now();
        // Esecuzione diretta senza controlli quota
        const result = this._safeExecuteRequestFn_(requestFn, options.modelNameOverride || 'gemini-3.5-flash');
        const duration = Date.now() - startTime;

        return {
          success: true,
          result: result,
          modelUsed: options.modelNameOverride || 'backup-model',
          quotaUsed: { rpd: 0, rpm: 0 }, // Statistiche fittizie per non sporcare contatori
          duration: duration
        };
      } catch (e) {
        throw new Error(`RATE_LIMITER_EXECUTE_BYPASS_FAILED: ${e.message}`);
      }
    }
    // ═══════════════════════════════════════════════════════════════════

    const estimatedTokens = options.estimatedTokens ?? 1000;
    const maxRetries = options.maxRetries ?? this.defaultMaxRetries ?? 2;
    const forceModel = options.forceModel || null;

    // 1. Esecuzione con retry (sincrono)
    var lastError = null;
    for (var attempt = 0; attempt < maxRetries; attempt++) {
      const selection = this._selectAndReserveModel(taskType, {
        estimatedTokens: estimatedTokens,
        forceModel: forceModel
      });

      if (!selection.available) {
        console.error(`\u274C Nessun modello disponibile (tentativo ${attempt + 1}): ${selection.reason}`);
        if (selection.reason === 'model_not_found_in_config') {
          throw new Error('CONFIG_ERROR: ' + (selection.message || selection.reason));
        }
        throw new Error('QUOTA_EXHAUSTED: ' + selection.reason);
      }

      const modelKey = selection.modelKey;
      const model = selection.model;
      const shouldThrottle = selection.shouldThrottle;
      const reservationId = selection.reservationId;

      // 1.2 Throttling
      if (shouldThrottle && shouldThrottle.needed) {
        console.warn(`\u23F8\uFE0F Throttling (${shouldThrottle.reason}): ${shouldThrottle.delay}ms`);
        Utilities.sleep(shouldThrottle.delay);
      }

      try {
        const startTime = Date.now();

        console.log(`🚀 Tentativo richiesta ${attempt + 1}/${maxRetries}`);
        console.log(`   Modello: ${model.name}, Task: ${taskType}`);

        // CHIAMATA SINCRONA (nessuna attesa)
        const result = this._safeExecuteRequestFn_(requestFn, model.name);

        const duration = Date.now() - startTime;

        // Completa la richiesta consumando contatori giornalieri e consolidando la riserva RPM/TPM.
        this._trackRequest(modelKey, estimatedTokens, duration, reservationId);

        console.log(`✓ Successo (${duration}ms)`);

        return {
          success: true,
          result: result,
          modelUsed: model.name,
          modelKey: modelKey,
          reservationId: reservationId,
          duration: duration,
          quotaUsed: {
            rpd: parseInt(this.props.getProperty(`rpd_${modelKey}`) || '0', 10) || 0,
            rpm: this._getRequestsInWindow('rpm', modelKey)
          }
        };

      } catch (error) {
        lastError = error;
        const errorMsg = error.message || '';

        // Rilascia la riserva corrente prima di eventuali retry o abort,
        // così non blocchiamo artificialmente la capacità minuto.
        try {
          if (reservationId) {
            this._releaseReservation(modelKey, reservationId);
          }
        } catch (releaseError) {
          console.warn(`⚠️ Rilascio reservation fallito (${modelKey}/${reservationId}): ${releaseError.message}`);
        }

        // Interrompi immediatamente se la quota è esaurita su TUTTE le chiavi
        if (errorMsg.indexOf('PRIMARY_QUOTA_EXHAUSTED') !== -1 || errorMsg.indexOf('QUOTA_EXHAUSTED_ALL_KEYS') !== -1) {
          console.error('❌ Quota API completamente esaurita su tutte le chiavi. Interruzione retry immediata.');
          throw error;
        }

        // Uso la classificazione centralizzata (difensiva in caso di runtime modulare)
        const classifiedError = typeof classifyError === 'function' ? classifyError(error) : { type: 'UNKNOWN', retryable: false, message: errorMsg };

        if (classifiedError.retryable) {

          console.warn(`⚠️ Limite quota/rete (${classifiedError.type}) al tentativo ${attempt + 1}: ${classifiedError.message}`);

          if (attempt < maxRetries - 1) {
            const backoffDelay = Math.min(
              this.backoffBase * Math.pow(this.backoffMultiplier, attempt),
              this.maxBackoff
            ) + Math.floor(Math.random() * 500);
            console.log(`   Attesa ${backoffDelay}ms...`);
            Utilities.sleep(backoffDelay);
          }
        } else {
          // Errore non ritentabile
          throw error;
        }
      }
    }

    // Tutti i tentativi falliti
    console.error(`❌ Tutti i ${maxRetries} tentativi falliti`);
    throw lastError || new Error('Richiesta fallita dopo tutti i tentativi');
  }

  _safeExecuteRequestFn_(requestFn, modelName) {
    if (typeof requestFn !== 'function') {
      throw new Error('requestFn non valido: attesa funzione');
    }

    let raw;
    try {
      raw = requestFn(modelName);
    } catch (e) {
      if (e && e._nonRetryable) throw e;
      throw new Error(`requestFn exception (${modelName}): ${e.message}`);
    }

    if (raw === null || raw === undefined) {
      const emptyErr = new Error(`requestFn ha restituito payload vuoto (${modelName})`);
      emptyErr._nonRetryable = true;
      throw emptyErr;
    }

    return raw;
  }

  // ================================================================
  // TRACCIAMENTO con cache
  // ================================================================

  _trackRequest(modelKey, tokensUsed, duration, reservationId) {
    const now = Date.now();
    const nonce = `${Math.floor(Math.random() * 1000000)}`;

    // Se la richiesta era stata già riservata nelle finestre RPM/TPM, non dobbiamo
    // aggiungere una seconda entry minuto: aggiorniamo solo i contatori giornalieri
    // e marchiamo la reservation come completata per dedup/diagnostica.
    if (reservationId) {
      this._finalizeReservation(modelKey, reservationId, duration);
    }

    // 1-2. Contatori RPD/Tokens con incremento atomico (evita race condition)
    const counters = this._incrementCountersAtomic(modelKey, tokensUsed);

    // 3. Finestra RPM (con cache) - solo per richieste non prenotate
    if (reservationId) {
      console.log(`📊 Tracciato tramite reservation: ${modelKey}`);
      console.log(`   RPD: ${counters.rpd}/${this.models[modelKey].rpd}`);
      return;
    }

    this._updateWindow('rpm', {
      timestamp: now,
      nonce: nonce,
      modelKey: modelKey
    });

    // 4. Finestra TPM (con cache)
    this._updateWindow('tpm', {
      timestamp: now,
      nonce: nonce,
      modelKey: modelKey,
      tokens: tokensUsed
    });

    // GAS esegue trigger in istanze effimere: persistenza immediata evita perdite
    // silenziose delle entry RPM/TPM quando una run termina in meno di 10s.
    this._persistCache();

    // Log
    console.log(`📊 Tracciato: ${modelKey}`);
    console.log(`   RPD: ${counters.rpd}/${this.models[modelKey].rpd}`);
  }

  /**
   * Incrementa contatori persistenti con lock script-level.
   */
  _incrementCountersAtomic(modelKey, tokensUsed, alreadyLocked = false) {
    const lock = alreadyLocked ? null : LockService.getScriptLock();
    // Timeout ridotto per evitare hang prolungati in console sotto concorrenza
    const gotLock = alreadyLocked || lock.tryLock(10000);

    if (!gotLock) {
      console.warn(`⚠️ Lock timeout RPD/Token per ${modelKey}: tento incremento non protetto`);
      const rpdKey = 'rpd_' + modelKey;
      const rpdDateKey = 'rpd_date_' + modelKey;
      const tokensKey = 'tokens_' + modelKey;
      try {
        const todayPacific = this._getPacificDate();
        const lastRpdDate = this.props.getProperty(rpdDateKey) || '';
        let currentRpd = parseInt(this.props.getProperty(rpdKey) || '0', 10) || 0;
        let currentTokens = parseInt(this.props.getProperty(tokensKey) || '0', 10) || 0;
        if (lastRpdDate !== todayPacific) {
          currentRpd = 0;
          currentTokens = 0;
          this.props.setProperty(rpdDateKey, todayPacific);
        }
        const nextRpd = currentRpd + 1;
        const nextTokens = currentTokens + (tokensUsed || 0);
        this.props.setProperty(rpdKey, String(nextRpd));
        this.props.setProperty(tokensKey, String(nextTokens));
        return { rpd: nextRpd, tokens: nextTokens };
      } catch (e) {
        console.error(`❌ Incremento RPD/Token non protetto fallito per ${modelKey}: ${e.message}`);
        return {
          rpd: parseInt(this.props.getProperty(rpdKey) || '0', 10) || 0,
          tokens: parseInt(this.props.getProperty(tokensKey) || '0', 10) || 0
        };
      }
    }

    try {
      const rpdKey = 'rpd_' + modelKey;
      const rpdDateKey = 'rpd_date_' + modelKey;
      const tokensKey = 'tokens_' + modelKey;
      const todayPacific = this._getPacificDate();
      const lastRpdDate = this.props.getProperty(rpdDateKey) || '';
      let currentRpd = parseInt(this.props.getProperty(rpdKey) || '0', 10) || 0;
      let currentTokens = parseInt(this.props.getProperty(tokensKey) || '0', 10) || 0;
      if (lastRpdDate !== todayPacific) {
        currentRpd = 0;
        currentTokens = 0;
        this.props.setProperty(rpdDateKey, todayPacific);
      }
      const nextRpd = currentRpd + 1;
      const nextTokens = currentTokens + (tokensUsed || 0);

      this.props.setProperty(rpdKey, String(nextRpd));
      this.props.setProperty(tokensKey, String(nextTokens));

      return { rpd: nextRpd, tokens: nextTokens };
    } finally {
      if (!alreadyLocked && lock) {
        lock.releaseLock();
      }
    }
  }

  /**
   * Traccia chiamate Gemini ausiliarie non gestite dal normale executeRequest
   * (es. creazione cache REST). Anche queste consumano RPD, quindi passano
   * dallo stesso contatore giornaliero con ScriptLock.
   */
  trackAuxiliaryRequest(modelNameOrKey, tokensUsed, label, alreadyLocked = false) {
    const modelKey = this._resolveModelKey_(modelNameOrKey);
    if (!modelKey) {
      console.warn(`⚠️ Chiamata ausiliaria Gemini non tracciata: modello '${modelNameOrKey}' non in CONFIG`);
      return null;
    }
    const counters = this._incrementCountersAtomic(modelKey, tokensUsed || 0, alreadyLocked);
    console.log(`📊 Chiamata ausiliaria Gemini tracciata (${label || 'aux'}): ${modelKey} RPD ${counters.rpd}/${this.models[modelKey].rpd}`);
    return counters;
  }

  _resolveModelKey_(modelNameOrKey) {
    if (!modelNameOrKey) return null;
    if (this.models[modelNameOrKey]) return modelNameOrKey;
    const modelName = String(modelNameOrKey);
    const keys = Object.keys(this.models || {});
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (this.models[key] && this.models[key].name === modelName) {
        return key;
      }
    }
    return null;
  }

  reserveGoogleSearchGroundingQueries(count) {
    return this._incrementGroundingCounter_(count || 1);
  }

  reconcileGoogleSearchGroundingQueries(reservedCount, actualCount) {
    const reserved = Math.max(0, parseInt(reservedCount || 0, 10) || 0);
    const actual = Math.max(0, parseInt(actualCount || 0, 10) || 0);
    if (actual > reserved) {
      return this._incrementGroundingCounter_(actual - reserved);
    }
    // Conservativo: non rilasciamo la prenotazione se il modello non ha cercato,
    // per evitare race tra esecuzioni concorrenti e sottostime del limite condiviso.
    return this.getGoogleSearchGroundingStats();
  }

  getGoogleSearchGroundingStats() {
    const todayPacific = this._getPacificDate();
    const dateKey = 'grounding_google_search_date';
    const countKey = 'grounding_google_search_rpd';
    const storedDate = this.props.getProperty(dateKey) || '';
    const used = storedDate === todayPacific
      ? (parseInt(this.props.getProperty(countKey) || '0', 10) || 0)
      : 0;
    const notes = (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_FREE_TIER_NOTES) ? CONFIG.GEMINI_FREE_TIER_NOTES : {};
    const limit = Number(notes.groundingSharedRpd) > 0 ? Number(notes.groundingSharedRpd) : 1500;
    return {
      used: used,
      limit: limit,
      percent: (used / limit * 100).toFixed(1),
      date: todayPacific
    };
  }

  _incrementGroundingCounter_(count, alreadyLocked = false) {
    const increment = Math.max(0, parseInt(count || 0, 10) || 0);
    if (increment <= 0) return this.getGoogleSearchGroundingStats();

    const notes = (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_FREE_TIER_NOTES) ? CONFIG.GEMINI_FREE_TIER_NOTES : {};
    const limit = Number(notes.groundingSharedRpd) > 0 ? Number(notes.groundingSharedRpd) : 1500;
    const lock = alreadyLocked ? null : LockService.getScriptLock();
    // Timeout ridotto a 10s per evitare hang
    const gotLock = alreadyLocked || lock.tryLock(10000);
    if (!gotLock) {
      throw new Error('QUOTA_EXHAUSTED: impossibile acquisire lock per Google Search Grounding');
    }

    try {
      const todayPacific = this._getPacificDate();
      const dateKey = 'grounding_google_search_date';
      const countKey = 'grounding_google_search_rpd';
      const storedDate = this.props.getProperty(dateKey) || '';
      let current = storedDate === todayPacific
        ? (parseInt(this.props.getProperty(countKey) || '0', 10) || 0)
        : 0;

      if (current + increment > limit) {
        throw new Error(`QUOTA_EXHAUSTED: Google Search Grounding ${current + increment}/${limit} query giornaliere`);
      }

      current += increment;
      this.props.setProperties({
        [dateKey]: todayPacific,
        [countKey]: String(current)
      });
      return {
        used: current,
        limit: limit,
        percent: (current / limit * 100).toFixed(1),
        date: todayPacific
      };
    } finally {
      if (!alreadyLocked && lock) {
        lock.releaseLock();
      }
    }
  }

  /**
   * Aggiorna finestra con cache (riduce PropertiesService I/O)
   */
  _updateWindow(windowType, entry, skipPersist = false) {
    const now = Date.now();

    // Invalida cache se troppo vecchia
    if (now - this.cache.lastCacheUpdate > this.cache.cacheTTL) {
      this._refreshCache();
    }

    // Aggiungi in cache garantendo nonce univoco (chiave dedup merge)
    const cacheKey = windowType + 'Window';
    const safeEntry = Object.assign({}, entry || {});
    if (typeof safeEntry.nonce === 'undefined' || safeEntry.nonce === null || safeEntry.nonce === '') {
      safeEntry.nonce = `${now}-${Math.floor(Math.random() * 1e9)}`;
    }
    this.cache[cacheKey].push(safeEntry);

    // Pulisci vecchie entry (>60 secondi)
    this.cache[cacheKey] = this.cache[cacheKey].filter(e => now - e.timestamp < 60000);

    // Limita dimensioni array per rispettare limiti PropertiesService (~9kb)
    while (JSON.stringify(this.cache[cacheKey]).length > 8000 && this.cache[cacheKey].length > 0) {
      this.cache[cacheKey].shift();
    }

    // GAS è runtime effimero: persiste subito per non perdere stato RPM/TPM tra esecuzioni.
    if (!skipPersist) {
      this._persistCache();
    }
  }

  _ensureWindowCache() {
    if (!this.cache || typeof this.cache !== 'object') {
      this.cache = {};
    }
    if (!Array.isArray(this.cache.rpmWindow)) this.cache.rpmWindow = [];
    if (!Array.isArray(this.cache.tpmWindow)) this.cache.tpmWindow = [];
    if (!Number.isFinite(this.cache.lastCacheUpdate)) this.cache.lastCacheUpdate = 0;
    if (!Number.isFinite(this.cache.lastPersistUpdate)) this.cache.lastPersistUpdate = 0;
    if (!Number.isFinite(this.cache.cacheTTL)) this.cache.cacheTTL = 10000;
  }

  _readWindowFromProperties(windowType, backupKey) {
    let windowData = [];
    try {
      windowData = JSON.parse(this.props.getProperty(windowType + '_window') || '[]');
      if (!Array.isArray(windowData)) {
        console.warn(`⚠️ ${windowType}_window non è un array, reset a []`);
        windowData = [];
      }
      if (!windowData.length && backupKey) {
        const backup = this.props.getProperty(backupKey);
        if (backup) {
          const backupData = JSON.parse(backup);
          windowData = Array.isArray(backupData) ? backupData : [];
        }
      }
    } catch (e) {
      console.warn(`⚠️ Errore parsing ${windowType}_window da PropertiesService, reset a []`);
    }
    return windowData;
  }

  _refreshCache() {
    this._ensureWindowCache();
    const rpmFromProps = this._readWindowFromProperties('rpm', 'rate_limit_rpm_backup');
    const tpmFromProps = this._readWindowFromProperties('tpm', 'rate_limit_tpm_backup');

    const now = Date.now();

    // 1. Merge dello stato persistito con eventuali entry in-memory recenti.
    const freshFromPropsRpm = rpmFromProps.filter(e => now - e.timestamp < 60000);
    const inMemoryRpm = Array.isArray(this.cache.rpmWindow)
      ? this.cache.rpmWindow.filter(e => now - e.timestamp < 60000)
      : [];
    let newRpm = this._mergeWindowData(freshFromPropsRpm, inMemoryRpm);
    // Taglio di sicurezza esplicito per RPM (garantito da _mergeWindowData, ma ri-applicato come fallback)
    while (JSON.stringify(newRpm).length > 8000 && newRpm.length > 0) {
      newRpm.shift();
    }
    this.cache.rpmWindow = newRpm;

    // 2. Stessa logica di merge per TPM.
    const freshFromPropsTpm = tpmFromProps.filter(e => now - e.timestamp < 60000);
    const inMemoryTpm = Array.isArray(this.cache.tpmWindow)
      ? this.cache.tpmWindow.filter(e => now - e.timestamp < 60000)
      : [];
    let newTpm = this._mergeWindowData(freshFromPropsTpm, inMemoryTpm);
    // Taglio di sicurezza esplicito per TPM (garantito da _mergeWindowData, ma ri-applicato come fallback)
    while (JSON.stringify(newTpm).length > 8000 && newTpm.length > 0) {
      newTpm.shift();
    }
    this.cache.tpmWindow = newTpm;

    this.cache.lastCacheUpdate = now;
  }

  _persistCache(alreadyLocked = false) {
    this._persistCacheWithWAL(alreadyLocked);
  }

  _persistCacheToStorage(alreadyLocked = false) {
    return this._persistCache(alreadyLocked);
  }

  /**
   * Persiste la cache tramite architettura di persistenza transazionale (WAL)
   * Garantisce coerenza strutturale dei dati in ambienti operativi distribuiti
   */
  _persistCacheWithWAL(alreadyLocked = false) {
    if (alreadyLocked) {
      this._doPersistCacheWrite();
      return;
    }

    const lock = LockService.getScriptLock();
    // Timeout ridotto a 10s per evitare blocchi infiniti in console.
    const lockAcquired = lock.tryLock(10000);

    if (!lockAcquired) {
      console.warn('\u26A0\uFE0F Impossibile acquisire lock per salvataggio cache entro 10s. Dati mantenuti in memoria.');
      return;
    }

    try {
      this._doPersistCacheWrite();
    } finally {
      lock.releaseLock();
    }
  }

  _doPersistCacheWrite() {
    const walTimestamp = Date.now();
    // Rilegge lo stato persistito dentro lock ed esegue merge con cache locale.
    let currentRpm;
    let currentTpm;
    try {
      currentRpm = JSON.parse(this.props.getProperty('rpm_window') || '[]');
      currentTpm = JSON.parse(this.props.getProperty('tpm_window') || '[]');
    } catch (e) {
      currentRpm = [];
      currentTpm = [];
    }

    const mergedRpm = this._mergeWindowData(currentRpm, this.cache.rpmWindow);
    const mergedTpm = this._mergeWindowData(currentTpm, this.cache.tpmWindow);

    this.cache.rpmWindow = mergedRpm;
    this.cache.tpmWindow = mergedTpm;

    this._writeChunkedData(walTimestamp, mergedRpm, mergedTpm);
    this.props.setProperties({
      rpm_window: JSON.stringify(mergedRpm),
      tpm_window: JSON.stringify(mergedTpm),
      // Backup durevole per sopravvivere a eventuale eviction cache/flush transitori
      rate_limit_rpm_backup: JSON.stringify(mergedRpm.slice(-10)),
      rate_limit_tpm_backup: JSON.stringify(mergedTpm.slice(-10))
    });
    this._cleanStorageBuffers();
    this.cache.lastPersistUpdate = Date.now();
  }

  /**
   * Sincronizza lo stato operativo leggendo le transazioni WAL non completate
   * Chiamato nel constructor prima di inizializzare i contatori
   */
  _recoverFromWAL(alreadyLocked = false) {
    // Utilizzo di lock per garantire atomicità durante la sincronizzazione attiva
    let lock = null;
    let lockAcquired = !!alreadyLocked;
    if (!alreadyLocked) {
      lock = LockService.getScriptLock();
      lockAcquired = lock.tryLock(5000);
      if (!lockAcquired) {
        console.warn('⚠️ Sincronizzazione storage ritardata: impossibile acquisire lock entro 5s');
        return;
      }
    }

    try {
      const walTs = this.props.getProperty('rate_limit_wal_ts');
      const oldWalData = this.props.getProperty('rate_limit_wal');
      if (!walTs && !oldWalData) return;

      console.warn('⚠️ Sincronizzazione buffer rilevata - ripristino stato operativo...');
      let wal = null;
      if (oldWalData) {
        wal = JSON.parse(oldWalData);
      } else {
        const chunkedRpm = this._readChunkedDataWindow('rpm');
        const chunkedTpm = this._readChunkedDataWindow('tpm');
        const walRpmStr = this.props.getProperty('rate_limit_wal_rpm');
        const walTpmStr = this.props.getProperty('rate_limit_wal_tpm');
        wal = {
          timestamp: parseInt(walTs, 10),
          rpm: chunkedRpm || (walRpmStr ? JSON.parse(walRpmStr) : []),
          tpm: chunkedTpm || (walTpmStr ? JSON.parse(walTpmStr) : [])
        };
      }

      if (!wal || typeof wal !== 'object' || !wal.timestamp) {
        console.error('❌ Struttura buffer inconsistente, applico reset di sicurezza');
        this._cleanStorageBuffers();
        return;
      }
      if (!Array.isArray(wal.rpm) || !Array.isArray(wal.tpm)) {
        console.error('❌ Buffer con dati invalidi');
        this._cleanStorageBuffers();
        return;
      }

      // Verifica che il WAL non sia troppo vecchio (> 5 minuti)
      const age = Date.now() - wal.timestamp;
      if (age > 300000) {
        console.warn('   Buffer dati obsoleto, ignorato');
        this._cleanStorageBuffers();
        return;
      }

      // Leggi dati attuali
      const rawRpm = this.props.getProperty('rpm_window');
      const rawTpm = this.props.getProperty('tpm_window');
      let parsedRpm = [];
      let parsedTpm = [];
      try { parsedRpm = JSON.parse(rawRpm || '[]'); } catch (_) {}
      try { parsedTpm = JSON.parse(rawTpm || '[]'); } catch (_) {}
      const currentRpm = Array.isArray(parsedRpm) ? parsedRpm : [];
      const currentTpm = Array.isArray(parsedTpm) ? parsedTpm : [];

      // Merge WAL con dati esistenti (evita duplicati per timestamp)
      const mergedRpm = this._mergeWindowData(currentRpm, wal.rpm || []);
      const mergedTpm = this._mergeWindowData(currentTpm, wal.tpm || []);

      // Salva dati recuperati
      this.props.setProperty('rpm_window', JSON.stringify(mergedRpm));
      this.props.setProperty('tpm_window', JSON.stringify(mergedTpm));

      // Rimuovi la transazione WAL al ripristino ultimato
      this._cleanStorageBuffers();

      // Aggiorna cache in-memory
      this.cache.rpmWindow = mergedRpm;
      this.cache.tpmWindow = mergedTpm;
      this.cache.lastCacheUpdate = Date.now();

      console.log('✓ Dati recuperati correttamente e cache aggiornata');

    } catch (error) {
      console.error(`❌ Errore di sincronizzazione storage: ${error.message}`);
      this._cleanStorageBuffers();
    } finally {
      if (!alreadyLocked && lockAcquired && lock) lock.releaseLock();
    }
  }

  _recoverFromStorage(alreadyLocked = false) {
    return GeminiRateLimiter.prototype._recoverFromWAL.call(this, alreadyLocked);
  }

  _cleanStorageBuffers() {
    try {
      // Ottimizzazione: evitiamo getProperties() che è lentissimo.
      // Leggiamo il numero di chunk direttamente dalle proprietà note.
      const rpmChunkCount = parseInt(this.props.getProperty('rate_limit_wal_rpm_chunks') || '0', 10) || 0;
      const tpmChunkCount = parseInt(this.props.getProperty('rate_limit_wal_tpm_chunks') || '0', 10) || 0;
      
      const keysToDelete = [
        'rate_limit_wal',
        'rate_limit_wal_ts',
        'rate_limit_wal_rpm',
        'rate_limit_wal_tpm',
        'rate_limit_wal_rpm_chunks',
        'rate_limit_wal_tpm_chunks'
      ];

      // Eliminiamo i chunk RPM
      for (let i = 0; i < rpmChunkCount; i++) {
        keysToDelete.push(`rate_limit_wal_rpm_${i}`);
      }
      // Eliminiamo i chunk TPM
      for (let i = 0; i < tpmChunkCount; i++) {
        keysToDelete.push(`rate_limit_wal_tpm_${i}`);
      }

      // Eliminazione selettiva delle chiavi WAL
      keysToDelete.forEach(k => this.props.deleteProperty(k));
    } catch (e) { 
      console.warn(`⚠️ Errore durante pulizia buffer: ${e.message}`);
    }
  }

  _deletePropertiesList(keys) {
    keys.forEach(k => this.props.deleteProperty(k));
  }

  _writeChunkedData(walTimestamp, mergedRpm, mergedTpm) {
    const rpmChunks = this._chunkWindowForProperties(mergedRpm);
    const tpmChunks = this._chunkWindowForProperties(mergedTpm);
    const walProps = {
      rate_limit_wal_ts: String(walTimestamp),
      rate_limit_wal_rpm_chunks: String(rpmChunks.length),
      rate_limit_wal_tpm_chunks: String(tpmChunks.length)
    };

    for (let i = 0; i < rpmChunks.length; i++) {
      walProps[`rate_limit_wal_rpm_${i}`] = rpmChunks[i];
    }
    for (let i = 0; i < tpmChunks.length; i++) {
      walProps[`rate_limit_wal_tpm_${i}`] = tpmChunks[i];
    }

    this.props.setProperties(walProps);
  }

  _readChunkedDataWindow(windowType) {
    const count = parseInt(this.props.getProperty(`rate_limit_wal_${windowType}_chunks`) || '0', 10) || 0;
    if (count <= 0) return null;

    const merged = [];
    for (let i = 0; i < count; i++) {
      const chunkStr = this.props.getProperty(`rate_limit_wal_${windowType}_${i}`);
      if (!chunkStr) continue;
      try {
        const chunk = JSON.parse(chunkStr);
        if (Array.isArray(chunk)) {
          for (const entry of chunk) merged.push(entry);
        }
      } catch (e) {
        console.warn(`⚠️ WAL chunk corrotto ignorato (rate_limit_wal_${windowType}_${i}): ${e.message}`);
      }
    }
    return merged;
  }

  _chunkWindowForProperties(windowEntries) {
    const maxChunkBytes = 8000;
    const chunks = [];
    let currentChunk = [];
    let currentChunkBytes = 2; // []

    for (const entry of (Array.isArray(windowEntries) ? windowEntries : [])) {
      const serializedEntry = JSON.stringify(entry);
      const candidateBytes = currentChunk.length === 0
        ? 2 + serializedEntry.length
        : currentChunkBytes + 1 + serializedEntry.length; // virgola separatrice

      if (candidateBytes > maxChunkBytes && currentChunk.length > 0) {
        chunks.push(JSON.stringify(currentChunk));
        currentChunk = [entry];
        currentChunkBytes = 2 + serializedEntry.length;
      } else {
        currentChunk.push(entry);
        currentChunkBytes = candidateBytes;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(JSON.stringify(currentChunk));
    }

    if (chunks.length === 0) {
      chunks.push('[]');
    }

    return chunks;
  }

  /**
   * Merge dati finestra evitando duplicati
   */
  _mergeWindowData(existing, walData) {
    const toKey = (entry) => {
      const ts = entry && typeof entry.timestamp !== 'undefined' ? entry.timestamp : 'na';
      const nonce = entry && typeof entry.nonce !== 'undefined' ? entry.nonce : 'na';
      const model = entry && entry.modelKey ? entry.modelKey : 'na';
      return `${ts}|${nonce}|${model}`;
    };

    const lifecycleRank = (entry) => {
      if (entry && entry.released === true) return 3;
      if (entry && entry.completed === true) return 2;
      if (entry && entry.reserved === true) return 1;
      return 0;
    };

    const lifecycleTime = (entry) => {
      const candidates = [
        entry && entry.releasedAt,
        entry && entry.completedAt,
        entry && entry.timestamp
      ];
      return candidates
        .map(value => Number(value))
        .filter(value => Number.isFinite(value))
        .reduce((max, value) => Math.max(max, value), 0);
    };

    const shouldReplace = (candidate, current) => {
      const candidateRank = lifecycleRank(candidate);
      const currentRank = lifecycleRank(current);
      if (candidateRank !== currentRank) {
        return candidateRank > currentRank;
      }
      return lifecycleTime(candidate) >= lifecycleTime(current);
    };

    const mergedByKey = new Map();
    const ingest = (entry) => {
      if (!entry || typeof entry !== 'object') return;
      const copy = Object.assign({}, entry);
      const key = toKey(copy);
      const current = mergedByKey.get(key);
      if (!current || shouldReplace(copy, current)) {
        mergedByKey.set(key, copy);
      }
    };

    (Array.isArray(existing) ? existing : []).forEach(ingest);
    (Array.isArray(walData) ? walData : []).forEach(ingest);

    // Ordina per timestamp e limita
    const sorted = Array.from(mergedByKey.values())
      .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));

    // Limita dimensione array a max 8KB per evitare crash PropertiesService.
    // Evita il pattern O(n²) di JSON.stringify() ad ogni iterazione.
    const maxBytes = 8000;
    const serializedEntries = sorted.map(entry => JSON.stringify(entry));
    let totalBytes = 2; // []
    for (let i = 0; i < serializedEntries.length; i++) {
      totalBytes += serializedEntries[i].length;
      if (i > 0) totalBytes += 1; // virgola separatrice
    }

    let start = 0;
    while (totalBytes > maxBytes && start < serializedEntries.length) {
      totalBytes -= serializedEntries[start].length;
      if (start < serializedEntries.length - 1) {
        totalBytes -= 1; // rimuove anche una virgola
      }
      start++;
    }

    if (start > 0) {
      return sorted.slice(start);
    }

    return sorted;
  }

  _getRequestsInWindow(windowType, modelKey) {
    const now = Date.now();
    this._ensureWindowCache();

    // Usa cache se fresh
    if (now - this.cache.lastCacheUpdate < this.cache.cacheTTL) {
      const cacheKey = windowType + 'Window';
      const cachedWindow = Array.isArray(this.cache[cacheKey]) ? this.cache[cacheKey] : [];
      return cachedWindow.filter(e => e.modelKey === modelKey && e.released !== true && (now - e.timestamp < 60000)).length;
    }

    // Altrimenti leggi da PropertiesService
    const windowData = this._readWindowFromProperties(windowType);
    return windowData.filter(e => e.modelKey === modelKey && e.released !== true && (now - e.timestamp < 60000)).length;
  }

  _getTokensInWindow(windowType, modelKey) {
    const now = Date.now();

    this._ensureWindowCache();

    // Usa cache
    if (now - this.cache.lastCacheUpdate < this.cache.cacheTTL) {
      const cacheKey = windowType + 'Window';
      const cachedWindow = Array.isArray(this.cache[cacheKey]) ? this.cache[cacheKey] : [];
      return cachedWindow
        .filter(e => e.modelKey === modelKey && e.released !== true && (now - e.timestamp < 60000))
        .reduce((sum, e) => sum + (Number(e.tokens) || 0), 0);
    }

    // Servizio proprietà di fallback
    const windowData = this._readWindowFromProperties(windowType);
    return windowData
      .filter(e => e.modelKey === modelKey && e.released !== true && (now - e.timestamp < 60000))
      .reduce((sum, e) => sum + (Number(e.tokens) || 0), 0);
  }

  // ================================================================
  // STATISTICHE
  // ================================================================

  getUsageStats() {
    const now = new Date();
    const canFormatDates = typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function';
    const fallbackTime = now.toISOString().slice(11, 16);
    const stats = {
      date: canFormatDates ? this._getItalianDate() : now.toISOString().slice(0, 10),
      italianTime: canFormatDates ? Utilities.formatDate(now, 'Europe/Rome', 'HH:mm') : fallbackTime,
      pacificTime: (canFormatDates ? Utilities.formatDate(now, 'America/Los_Angeles', 'HH:mm') : fallbackTime) + ' (PST/PDT)',
      nextReset: canFormatDates ? this._getNextResetTime() : 'n/a',
      nextResetPacific: '00:00 Pacific Time', // Ripristina Google è sempre mezzanotte Pacifico
      models: {},
      groundingGoogleSearch: null
    };

    for (const modelKey of Object.keys(this.models)) {
      const model = this.models[modelKey];
      // Ottimizzazione: leggiamo solo le chiavi specifiche invece di allProps.getProperties()
      const rpdUsed = parseInt(this.props.getProperty('rpd_' + modelKey) || '0', 10) || 0;
      const tokensUsed = parseInt(this.props.getProperty('tokens_' + modelKey) || '0', 10) || 0;
      const rpmUsed = this._getRequestsInWindow('rpm', modelKey);
      const tpmUsed = this._getTokensInWindow('tpm', modelKey);

      stats.models[modelKey] = {
        name: model.name,
        rpd: {
          used: rpdUsed,
          limit: model.rpd,
          percent: (rpdUsed / model.rpd * 100).toFixed(1)
        },
        rpm: {
          used: rpmUsed,
          limit: model.rpm,
          percent: (rpmUsed / model.rpm * 100).toFixed(1)
        },
        tpm: {
          used: tpmUsed,
          limit: model.tpm,
          percent: (tpmUsed / model.tpm * 100).toFixed(1)
        },
        tokensToday: tokensUsed
      };
    }

    stats.groundingGoogleSearch = this.getGoogleSearchGroundingStats();

    return stats;
  }

  logUsageStats() {
    const stats = this.getUsageStats();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 UTILIZZO QUOTA GEMINI - ' + stats.date + ' ' + stats.italianTime);
    console.log('⏰ Prossimo reset: ' + stats.nextReset + ' (9:00 AM italiana)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    for (const modelKey of Object.keys(stats.models)) {
      const model = stats.models[modelKey];
      console.log('\n' + modelKey.toUpperCase() + ' (' + model.name + '):');
      console.log('  RPD: ' + model.rpd.used + '/' + model.rpd.limit + ' (' + model.rpd.percent + '%)');
      console.log('  RPM: ' + model.rpm.used + '/' + model.rpm.limit + ' (' + model.rpm.percent + '%)');
      console.log('  TPM: ' + model.tpm.used + '/' + model.tpm.limit + ' (' + model.tpm.percent + '%)');
      console.log('  Token oggi: ' + String(model.tokensToday));
    }

    if (stats.groundingGoogleSearch) {
      console.log('\nGOOGLE SEARCH GROUNDING (limite condiviso):');
      console.log('  Query: ' + stats.groundingGoogleSearch.used + '/' + stats.groundingGoogleSearch.limit + ' (' + stats.groundingGoogleSearch.percent + '%)');
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  _getNextResetTime() {
    const now = new Date();
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      try {
        // Recupera data/ora corrente Pacific tramite API GAS nativa (robusta su trigger).
        const pacificDate = Utilities.formatDate(now, 'America/Los_Angeles', 'yyyy-MM-dd');
        const pacificTime = Utilities.formatDate(now, 'America/Los_Angeles', 'HH:mm:ss');
        const [y, m, d] = pacificDate.split('-').map(Number);
        const [hh, mm, ss] = pacificTime.split(':').map(Number);

        // Offset istantaneo Pacifico rispetto a UTC (DST-safe, calcolato "adesso").
        const pacificAsUtcMs = Date.UTC(y, m - 1, d, hh, mm, ss);
        const pacificOffsetMs = now.getTime() - pacificAsUtcMs;

        // Mezzanotte Pacific del giorno successivo riportata in UTC.
        const utcAtPacificNextMidnight = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
        return new Date(utcAtPacificNextMidnight + pacificOffsetMs).toISOString();
      } catch (e) {
        console.warn(`⚠️ _getNextResetTime fallback: ${e.message}`);
      }
    }

    // Fallback locale approssimativo se Utilities non è disponibile.
    const tomorrow = new Date(now.getTime() + 86400000);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.toISOString();
  }

  // Nota: niente _estimateTokens locale.
  // Il rate limiter riceve estimatedTokens dal chiamante (es. GeminiService),
  // che può applicare logiche multimodali più accurate rispetto a una stima generica.

  _selectAndReserveModel(taskType, options) {
    options = options || {};
    const estimatedTokens = options.estimatedTokens ?? 1000;
    const forceModel = options.forceModel || null;

    const lockResult = this._withRateLimitLock_(function () {
      this._recoverFromWAL(true);
      this._refreshCache();

      const selection = this._selectModelUnlocked(taskType, {
        forceModel: forceModel,
        estimatedTokens: estimatedTokens
      });

      if (!selection.available) {
        return selection;
      }

      const reservationId = this._createReservationUnlocked(selection.modelKey, estimatedTokens);
      selection.reservationId = reservationId;
      return selection;
    }.bind(this), {
      timeoutReason: 'rate_limiter_lock_timeout',
      lockDescription: 'selezione+reservation modello'
    });

    if (!lockResult.ok) {
      return lockResult.result;
    }
    return lockResult.result;
  }

  _createReservationUnlocked(modelKey, estimatedTokens) {
    const now = Date.now();
    const reservationId = `res_${now}_${Math.floor(Math.random() * 1000000)}`;

    this._updateWindow('rpm', {
      timestamp: now,
      nonce: reservationId,
      modelKey: modelKey,
      reserved: true,
      completed: false
    }, true);

    this._updateWindow('tpm', {
      timestamp: now,
      nonce: reservationId,
      modelKey: modelKey,
      tokens: estimatedTokens ?? 0,
      reserved: true,
      completed: false
    }, true);

    this._persistCache(true);
    console.log(`🧾 Reservation creata: ${modelKey} (${reservationId})`);
    return reservationId;
  }

  _finalizeReservation(modelKey, reservationId, duration) {
    this._mutateReservation(modelKey, reservationId, function (entry) {
      entry.completed = true;
      entry.completedAt = Date.now();
      entry.duration = duration || 0;
      return true;
    });
  }

  _releaseReservation(modelKey, reservationId) {
    this._mutateReservation(modelKey, reservationId, function (entry) {
      entry.released = true;
      entry.releasedAt = Date.now();
      return true;
    });
  }

  _mutateReservation(modelKey, reservationId, mutatorFn) {
    if (!reservationId) return;

    const lockResult = this._withRateLimitLock_(function () {
      this._refreshCache();

      ['rpmWindow', 'tpmWindow'].forEach(function (cacheKey) {
        const currentWindow = Array.isArray(this.cache[cacheKey]) ? this.cache[cacheKey] : [];
        this.cache[cacheKey] = currentWindow.map(function (entry) {
          if (!entry || entry.modelKey !== modelKey || entry.nonce !== reservationId || entry.reserved !== true) {
            return entry;
          }

          const mutableEntry = Object.assign({}, entry);
          const keepEntry = mutatorFn(mutableEntry);
          if (keepEntry === false) {
            return null;
          }
          return mutableEntry;
        }).filter(Boolean);
      }.bind(this));

      this._persistCache(true);
      return true;
    }.bind(this), {
      timeoutReason: 'rate_limiter_lock_timeout',
      lockDescription: 'mutation reservation'
    });

    if (!lockResult.ok) {
      console.warn(`⚠️ mutateReservation non completata per ${reservationId}: ${lockResult.result.reason}`);
    }
  }
}

// ================================================================
// FUNZIONI UTILITÀ (per dashboard e manutenzione)
// ================================================================

/**
 * Dashboard quota (esegui manualmente da editor script)
 */
function showQuotaDashboard() {
  const limiter = new GeminiRateLimiter();
  limiter.logUsageStats();

  // Avviso se >80%
  const stats = limiter.getUsageStats();
  for (const modelKey of Object.keys(stats.models)) {
    const model = stats.models[modelKey];
    if (parseFloat(model.rpd.percent) > 80) {
      console.warn('⚠️  ATTENZIONE: ' + modelKey + ' RPD > 80% (' + model.rpd.percent + '%)');
    }
  }
}

/**
 * Reset manuale contatori (usare con cautela!)
 */
function resetQuotaCounters() {
  const limiter = new GeminiRateLimiter();
  limiter._resetDailyCounters();
  limiter.props.setProperty('rate_limit_date', limiter._getPacificDate());
  console.log('✓ Contatori quota resettati manualmente (usando data Pacific)');
}
