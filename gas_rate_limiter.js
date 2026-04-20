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
  constructor() {
    console.log('\uD83D\uDEA6 Inizializzazione GeminiRateLimiter...');

    // ================================================================
    // CONFIGURAZIONE MODELLI (Legge da CONFIG)
    // ================================================================

    // Legge modelli da CONFIG.GEMINI_MODELS (centralizzato)
    if (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_MODELS) {
      this.models = this._normalizeDeprecatedModelNames(CONFIG.GEMINI_MODELS);
      console.log('   \u2713 Modelli caricati da CONFIG.GEMINI_MODELS');
    } else {
      // Fallback se CONFIG non disponibile
      console.warn('   \u26A0\uFE0F CONFIG.GEMINI_MODELS non trovato, uso default');
      // ATTENZIONE: Non modificare arbitrariamente. Verificare periodicamente in rete i limiti delle quote gratuiti stabiliti, mantenendo proporzionalità con le quote di base.
      this.models = {
        'flash-2.5': {
          name: 'gemini-2.5-flash',
          rpm: 10, tpm: 250000, rpd: 250,
          useCases: ['generation', 'all']
        },
        'flash-lite': {
          name: 'gemini-2.5-flash-lite',
          rpm: 15, tpm: 250000, rpd: 1000,
          useCases: ['fallback', 'classification', 'quick_check']
        }
      };
    }

    // Legge strategia da CONFIG.MODEL_STRATEGY (centralizzato)
    if (typeof CONFIG !== 'undefined' && CONFIG.MODEL_STRATEGY) {
      this.strategies = CONFIG.MODEL_STRATEGY;
      console.log('   \u2713 Strategia caricata da CONFIG.MODEL_STRATEGY');
    } else {
      // Fallback default
      this.strategies = {
        'quick_check': ['flash-lite', 'flash-2.5'],
        // Per generation evitiamo loop sul solo "lite" e usiamo fallback premium-safe.
        'generation': ['flash-2.5', 'flash-lite', 'flash-2.5-lite-backup'],
        'fallback': ['flash-lite', 'flash-2.5-lite-backup', 'flash-2.5']
      };
    }

    // Modello di default (primo nella lista generation)
    this.defaultModel = Object.keys(this.models)[0] || 'flash-2.5';

    // ================================================================
    // CACHE IN-MEMORY (per ridurre PropertiesService reads)
    // ================================================================

    this.cache = {
      rpmWindow: [],
      tpmWindow: [],
      lastCacheUpdate: 0,
      cacheTTL: 10000  // 10 secondi cache TTL
    };

    // ================================================================
    // PERSISTENZA (PropertiesService)
    // ================================================================

    this.props = PropertiesService.getScriptProperties();

    // Inizializza stato preesistente da transazioni persistenti
    this._recoverFromWAL();

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
      rpm: 5000,   // 5 secondi
      tpm: 3000,
      rpd: 10000
    };

    // Exponential backoff
    this.backoffBase = 2000;
    this.backoffMultiplier = 2;
    this.maxBackoff = 60000;

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
      // Mappatura modelli ritirati verso equivalenti 2.5
      'gemini-2.5-flash-exp': 'gemini-2.5-flash-lite',
      'gemini-2.0-flash-exp': 'gemini-2.5-flash-lite',
      'gemini-2.0-flash': 'gemini-2.5-flash-lite'
    };

    const knownCurrentModels = [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite'
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

      const fallbackName = String(modelKey).toLowerCase().includes('lite')
        ? 'gemini-2.5-flash-lite'
        : 'gemini-2.5-flash';

      normalized[modelKey] = Object.assign({}, modelConfig, {
        name: replacement || currentName || fallbackName
      });

      if (!currentName) {
        console.warn(`⚠️ Modello '${modelKey}' senza name in CONFIG: uso fallback '${normalized[modelKey].name}'.`);
      }
    });

    return normalized;
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
        // Il reset Google avviene a mezzanotte Pacific = 9:00 AM italiana
        const storedDate = this.props.getProperty('rate_limit_date');
        const pacificDate = this._getPacificDate();

        // Reset quando cambia la data Pacific (non italiana!)
        if (storedDate !== pacificDate) {
          console.log(`📅 Giorno Pacific cambiato (${pacificDate}), reset contatori giornalieri`);
          console.log(`   (Ora italiana: ${Utilities.formatDate(new Date(), 'Europe/Rome', 'HH:mm')})`);
          this._resetDailyCounters();
          this.props.setProperty('rate_limit_date', pacificDate);
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
    for (const modelKey in this.models) {
      this.props.setProperty(`rpd_${modelKey}`, '0');
      this.props.setProperty(`rpd_date_${modelKey}`, todayPacific);
      this.props.setProperty(`tokens_${modelKey}`, '0');
    }
    // Reset anche cache
    this.props.setProperty('rpm_window', JSON.stringify([]));
    this.props.setProperty('tpm_window', JSON.stringify([]));
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
      timeoutReason: 'lock_timeout',
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
      { classification: taskStrategies['quick_check'] || ['flash-lite', 'flash-2.5'] },
      taskStrategies
    );

    return resolvedStrategies[taskType] || resolvedStrategies['fallback'] || ['flash-lite', 'flash-2.5'];
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
      return { available: false, reason: 'model_not_found' };
    }

    // Controllo RPD
    const rpdUsed = parseInt(this.props.getProperty(`rpd_${modelKey}`) || '0', 10) || 0;
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
    const rpmUsed = this._getRequestsInWindow('rpm', modelKey);
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
    const tpmUsed = this._getTokensInWindow('tpm', modelKey);
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
      return { needed: true, reason: 'rpd', delay: this.throttleDelays.rpd };
    }
    if (rpmRatio >= this.safetyMargin.rpm) {
      return { needed: true, reason: 'rpm', delay: this.throttleDelays.rpm };
    }
    if (tpmRatio >= this.safetyMargin.tpm) {
      return { needed: true, reason: 'tpm', delay: this.throttleDelays.tpm };
    }

    return { needed: false };
  }

  _applySafetyValve_() {
    if (typeof CONFIG === 'undefined' || !Number.isFinite(CONFIG.MAX_EMAILS_PER_RUN)) return;
    if (CONFIG.MAX_EMAILS_PER_RUN <= 1) return;

    const todayPacific = this._getPacificDate();
    const dateKey = 'safety_valve_last_date';
    const valueKey = 'safety_valve_reduced_value';
    const alreadyAppliedToday = this.props.getProperty(dateKey) === todayPacific;

    if (alreadyAppliedToday) {
      // GAS usa runtime effimero: ricarichiamo il valore ridotto persistito a ogni esecuzione.
      const stored = parseInt(this.props.getProperty(valueKey) || '0', 10);
      if (stored > 0 && stored < CONFIG.MAX_EMAILS_PER_RUN) {
        console.warn(`🚨 Safety Valve (persistita): MAX_EMAILS_PER_RUN → ${stored}`);
        CONFIG.MAX_EMAILS_PER_RUN = stored;
      }
      return;
    }

    const reduced = Math.max(1, Math.floor(CONFIG.MAX_EMAILS_PER_RUN / 2));
    if (reduced < CONFIG.MAX_EMAILS_PER_RUN) {
      console.warn(`🚨 Safety Valve attiva: MAX_EMAILS_PER_RUN ${CONFIG.MAX_EMAILS_PER_RUN} → ${reduced}`);
      CONFIG.MAX_EMAILS_PER_RUN = reduced;
      this.props.setProperty(dateKey, todayPacific);
      this.props.setProperty(valueKey, String(reduced));
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
   * @param {Object} options - {estimatedTokens, maxRetries, preferQuality}
   * @returns {Object} {success, result, modelUsed, quotaUsed}
   */
  executeRequest(taskType, requestFn, options) {
    options = options || {};

    // ═══════════════════════════════════════════════════════════════════
    // BYPASS PER CHIAVE DI RISERVA
    // Se stiamo usando una chiave esterna, NON dobbiamo tracciare i consumi
    // sul Rate Limiter locale per non inquinare le statistiche della chiave principale
    // ═══════════════════════════════════════════════════════════════════
    if (options.skipRateLimit) {
      console.warn('\u23E9 RateLimiter BYPASSED (Chiave di Riserva in uso)');
      try {
        const startTime = Date.now();
        // Esecuzione diretta senza controlli quota
        const result = requestFn(options.modelNameOverride || 'gemini-2.5-flash');
        const duration = Date.now() - startTime;

        return {
          success: true,
          result: result,
          modelUsed: options.modelNameOverride || 'backup-model',
          quotaUsed: { rpd: 0, rpm: 0 }, // Statistiche fittizie per non sporcare contatori
          duration: duration
        };
      } catch (e) {
        // Se fallisce, rilancia l'errore per gestione esterna
        throw e;
      }
    }
    // ═══════════════════════════════════════════════════════════════════

    const estimatedTokens = options.estimatedTokens || 1000;
    const maxRetries = options.maxRetries || 3;
    const preferQuality = options.preferQuality || false;

    // 1. Selezione + riserva atomica della capacità minuto
    const selection = this._selectAndReserveModel(taskType, {
      preferQuality: preferQuality,
      estimatedTokens: estimatedTokens
    });

    if (!selection.available) {
      console.error(`\u274C Nessun modello disponibile: ${selection.reason}`);
      throw new Error('QUOTA_EXHAUSTED: ' + selection.reason);
    }

    const modelKey = selection.modelKey;
    const model = selection.model;
    const shouldThrottle = selection.shouldThrottle;
    const reservationId = selection.reservationId;

    // 2. Throttling
    if (shouldThrottle && shouldThrottle.needed) {
      console.warn(`\u23F8\uFE0F Throttling (${shouldThrottle.reason}): ${shouldThrottle.delay}ms`);
      Utilities.sleep(shouldThrottle.delay);
    }

    // 3. Esecuzione con retry (sincrono)
    var lastError = null;
    for (var attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const startTime = Date.now();

        console.log(`🚀 Tentativo richiesta ${attempt + 1}/${maxRetries}`);
        console.log(`   Modello: ${model.name}, Task: ${taskType}`);

        // CHIAMATA SINCRONA (no await)
        const result = requestFn(model.name);

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

        if (classifiedError.type === 'QUOTA_EXCEEDED' || classifiedError.type === 'NETWORK') {

          console.warn(`⚠️ Limite quota/rete (${classifiedError.type}) al tentativo ${attempt + 1}: ${classifiedError.message}`);

          if (attempt < maxRetries - 1) {
            const backoffDelay = Math.min(
              this.backoffBase * Math.pow(this.backoffMultiplier, attempt),
              this.maxBackoff
            );
            console.log(`   Attesa ${backoffDelay}ms...`);
            Utilities.sleep(backoffDelay);
            continue;
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
  _incrementCountersAtomic(modelKey, tokensUsed) {
    const lock = LockService.getScriptLock();
    // Timeout esteso per garantire persistenza contatori sotto burst concorrenti.
    const gotLock = lock.tryLock(25000);

    if (!gotLock) {
      console.warn(`⚠️ Impossibile tracciare RPD/Token per ${modelKey} (Lock Timeout)`);
      const rpdKey = 'rpd_' + modelKey;
      const tokensKey = 'tokens_' + modelKey;
      return {
        rpd: parseInt(this.props.getProperty(rpdKey) || '0', 10) || 0,
        tokens: parseInt(this.props.getProperty(tokensKey) || '0', 10) || 0
      };
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
      lock.releaseLock();
    }
  }

  /**
   * Aggiorna finestra con cache (riduce PropertiesService I/O)
   */
  _updateWindow(windowType, entry) {
    const now = Date.now();

    // Invalida cache se troppo vecchia
    if (now - this.cache.lastCacheUpdate > this.cache.cacheTTL) {
      this._refreshCache();
    }

    // Aggiungi a cache
    const cacheKey = windowType + 'Window';
    this.cache[cacheKey].push(entry);

    // Pulisci vecchie entry (>60 secondi)
    this.cache[cacheKey] = this.cache[cacheKey].filter(e => now - e.timestamp < 60000);

    // Limita dimensioni array per rispettare limiti PropertiesService (~9kb)
    if (this.cache[cacheKey].length > 60) {
      this.cache[cacheKey] = this.cache[cacheKey].slice(-60);
    }

    // Persist ogni 10 secondi (batch writes)
    if (now - this.cache.lastCacheUpdate > 10000) {
      this._persistCache();
    }
  }

  _refreshCache() {
    let rpmWindow = [];
    let tpmWindow = [];
    try {
      rpmWindow = JSON.parse(this.props.getProperty('rpm_window') || '[]');
    } catch (e) {
      console.warn('⚠️ Errore parsing rpm_window da PropertiesService, reset a []');
    }
    try {
      tpmWindow = JSON.parse(this.props.getProperty('tpm_window') || '[]');
    } catch (e) {
      console.warn('⚠️ Errore parsing tpm_window da PropertiesService, reset a []');
    }

    const now = Date.now();

    // 1. Pulisci RPM e applica LIMITE DI SICUREZZA
    let newRpm = rpmWindow.filter(e => now - e.timestamp < 60000);
    // Taglio di sicurezza esplicito per RPM
    if (newRpm.length > 60) {
      newRpm = newRpm.slice(-60);
    }
    this.cache.rpmWindow = newRpm;

    // 2. Pulisci TPM e applica LIMITE DI SICUREZZA
    let newTpm = tpmWindow.filter(e => now - e.timestamp < 60000);
    // Taglio di sicurezza esplicito per TPM
    if (newTpm.length > 60) {
      newTpm = newTpm.slice(-60);
    }
    this.cache.tpmWindow = newTpm;

    this.cache.lastCacheUpdate = now;
  }

  _persistCache() {
    // Delega al metodo con WAL per sicurezza
    this._persistCacheWithWAL();
  }

  /**
   * Persiste la cache tramite architettura di persistenza transazionale (WAL)
   * Garantisce coerenza strutturale dei dati in ambienti operativi distribuiti
   */
  _persistCacheWithWAL() {
    const lock = LockService.getScriptLock();
    // Timeout esteso per ridurre perdita cache in istanze effimere sotto alta concorrenza.
    const lockAcquired = lock.tryLock(25000);

    if (!lockAcquired) {
      console.warn('\u26A0\uFE0F Impossibile acquisire lock per salvataggio cache entro 25s. Dati mantenuti in memoria.');
      return;
    }

    try {
      const walTimestamp = Date.now();
      // Rilegge lo stato persistito dentro lock ed esegue merge con cache locale
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

      // Aggiorna cache locale dell'istanza con stato merged
      this.cache.rpmWindow = mergedRpm;
      this.cache.tpmWindow = mergedTpm;

      // 1. Crea checkpoint WAL con ultimi dati critici
      const wal = {
        timestamp: walTimestamp,
        // Mantieni finestra completa di sicurezza (max 100) per ripristino coerente
        rpm: mergedRpm.slice(),
        tpm: mergedTpm.slice()
      };

      // 2. Scrivi WAL prima (checkpoint di sicurezza)
      this.props.setProperty('rate_limit_wal', JSON.stringify(wal));

      // 3. Scrivi dati completi
      this.props.setProperty('rpm_window', JSON.stringify(mergedRpm));
      this.props.setProperty('tpm_window', JSON.stringify(mergedTpm));

      // 4. Rimuovi WAL solo dopo la scrittura completa
      this.props.deleteProperty('rate_limit_wal');
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Sincronizza lo stato operativo leggendo le transazioni WAL non completate
   * Chiamato nel constructor prima di inizializzare i contatori
   */
  _recoverFromWAL(alreadyLocked = false) {
    // Punto 1: Aggiunto lock per garantire atomicità durante la sincronizzazione attiva
    let lock = null;
    let lockAcquired = !!alreadyLocked;
    if (!alreadyLocked) {
      lock = LockService.getScriptLock();
      lockAcquired = lock.tryLock(5000);
      if (!lockAcquired) {
        console.warn('⚠️ Sincronizzazione WAL ritardata: impossibile acquisire lock entro 5s');
        return;
      }
    }

    try {
      const walData = this.props.getProperty('rate_limit_wal');
      if (!walData) return;

      console.warn('⚠️ Transazione WAL rilevata - ripristino stato operativo...');
      const wal = JSON.parse(walData);
      if (!wal || typeof wal !== 'object' || !wal.timestamp) {
        console.error('❌ Struttura WAL inconsistente, applico reset di sicurezza');
        this.props.deleteProperty('rate_limit_wal');
        return;
      }
      if (!Array.isArray(wal.rpm) || !Array.isArray(wal.tpm)) {
        console.error('❌ WAL con array invalidi');
        this.props.deleteProperty('rate_limit_wal');
        return;
      }

      // Verifica che il WAL non sia troppo vecchio (> 5 minuti)
      const age = Date.now() - wal.timestamp;
      if (age > 300000) {
        console.warn('   WAL troppo vecchio, ignorato');
        this.props.deleteProperty('rate_limit_wal');
        return;
      }

      // Leggi dati attuali
      const currentRpm = JSON.parse(this.props.getProperty('rpm_window') || '[]');
      const currentTpm = JSON.parse(this.props.getProperty('tpm_window') || '[]');

      // Merge WAL con dati esistenti (evita duplicati per timestamp)
      const mergedRpm = this._mergeWindowData(currentRpm, wal.rpm || []);
      const mergedTpm = this._mergeWindowData(currentTpm, wal.tpm || []);

      // Salva dati recuperati
      this.props.setProperty('rpm_window', JSON.stringify(mergedRpm));
      this.props.setProperty('tpm_window', JSON.stringify(mergedTpm));

      // Rimuovi transazione WAL a ripristino ultimato
      this.props.deleteProperty('rate_limit_wal');

      // Aggiorna cache in-memory
      this.cache.rpmWindow = mergedRpm;
      this.cache.tpmWindow = mergedTpm;
      this.cache.lastCacheUpdate = Date.now();

      console.log('✓ Dati recuperati da WAL con successo e cache aggiornata');

    } catch (error) {
      console.error(`❌ Errore di sincronizzazione WAL: ${error.message}`);
      // Rimuovi WAL inconsistente
      try { this.props.deleteProperty('rate_limit_wal'); } catch (e) { }
    } finally {
      if (!alreadyLocked && lockAcquired && lock) lock.releaseLock();
    }
  }

  /**
   * Merge dati finestra evitando duplicati
   */
  _mergeWindowData(existing, walData) {
    const toKey = (entry) => {
      const ts = entry && typeof entry.timestamp !== 'undefined' ? entry.timestamp : 'na';
      const nonce = entry && typeof entry.nonce !== 'undefined' ? entry.nonce : 'na';
      const model = entry && entry.modelKey ? entry.modelKey : 'na';
      const tokens = entry && typeof entry.tokens !== 'undefined' ? entry.tokens : 0;
      const reserved = entry && entry.reserved === true ? 'r1' : 'r0';
      const completed = entry && entry.completed === true ? 'c1' : 'c0';
      return `${ts}|${nonce}|${model}|${tokens}|${reserved}|${completed}`;
    };

    const existingEntries = new Set(existing.map(toKey));
    const merged = Array.isArray(existing) ? existing.slice() : [];

    for (const entry of walData) {
      const entryKey = toKey(entry);
      if (!existingEntries.has(entryKey)) {
        merged.push(Object.assign({}, entry));
        existingEntries.add(entryKey);
      }
    }

    // Ordina per timestamp e limita
    return merged
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-60);
  }

  _getRequestsInWindow(windowType, modelKey) {
    const now = Date.now();

    // Usa cache se fresh
    if (now - this.cache.lastCacheUpdate < this.cache.cacheTTL) {
      const cacheKey = windowType + 'Window';
      return this.cache[cacheKey].filter(e => e.modelKey === modelKey && (now - e.timestamp < 60000)).length;
    }

    // Altrimenti leggi da PropertiesService
    const windowData = JSON.parse(this.props.getProperty(windowType + '_window') || '[]');
    return windowData.filter(e => e.modelKey === modelKey && (now - e.timestamp < 60000)).length;
  }

  _getTokensInWindow(windowType, modelKey) {
    const now = Date.now();

    // Fail-safe difensivo: evita crash se la cache non è stata inizializzata
    // (es. stato corrotto/iniezione test incompleta).
    if (!this.cache || typeof this.cache !== 'object') {
      this.cache = {
        rpmWindow: [],
        tpmWindow: [],
        lastCacheUpdate: 0,
        cacheTTL: 10000
      };
    }

    // Usa cache
    if (now - this.cache.lastCacheUpdate < this.cache.cacheTTL) {
      const cacheKey = windowType + 'Window';
      const cachedWindow = Array.isArray(this.cache[cacheKey]) ? this.cache[cacheKey] : [];
      return cachedWindow
        .filter(e => e.modelKey === modelKey && (now - e.timestamp < 60000))
        .reduce((sum, e) => sum + (e.tokens || 0), 0);
    }

    // Fallback PropertiesService
    const windowData = JSON.parse(this.props.getProperty(windowType + '_window') || '[]');
    return windowData
      .filter(e => e.modelKey === modelKey && (now - e.timestamp < 60000))
      .reduce((sum, e) => sum + (e.tokens || 0), 0);
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
      nextResetPacific: '00:00 Pacific Time', // Reset Google è sempre mezzanotte Pacific
      models: {}
    };

    for (var modelKey in this.models) {
      const model = this.models[modelKey];
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

    return stats;
  }

  logUsageStats() {
    const stats = this.getUsageStats();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 UTILIZZO QUOTA GEMINI - ' + stats.date + ' ' + stats.italianTime);
    console.log('⏰ Prossimo reset: ' + stats.nextReset + ' (9:00 AM italiana)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    for (var modelKey in stats.models) {
      const model = stats.models[modelKey];
      console.log('\n' + modelKey.toUpperCase() + ' (' + model.name + '):');
      console.log('  RPD: ' + model.rpd.used + '/' + model.rpd.limit + ' (' + model.rpd.percent + '%)');
      console.log('  RPM: ' + model.rpm.used + '/' + model.rpm.limit + ' (' + model.rpm.percent + '%)');
      console.log('  Token oggi: ' + model.tokensToday.toLocaleString());
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  _getNextResetTime() {
    const nowMs = Date.now();
    const currentPacificDate = this._getPacificDate();

    // Trova il primo istante in cui cambia la data Pacific (mezzanotte locale Pacific)
    let low = nowMs;
    let high = nowMs + (36 * 60 * 60 * 1000); // margine abbondante per DST

    while (high - low > 1000) {
      const mid = Math.floor((low + high) / 2);
      const midPacificDate = Utilities.formatDate(new Date(mid), 'America/Los_Angeles', 'yyyy-MM-dd');

      if (midPacificDate === currentPacificDate) {
        low = mid;
      } else {
        high = mid;
      }
    }

    return new Date(high).toISOString();
  }

  /**
   * Stima il numero di token per un testo ed eventuali allegati
   * Formula: parole * 1.25 + overhead 10% + 200 per ogni allegato
   */
  _estimateTokens(text, attachments = []) {
    let tokens = 0;
    if (text) {
      const wordCount = text.split(/\s+/).length;
      const baseTokens = Math.ceil(wordCount * 1.25);
      const overhead = Math.ceil(baseTokens * 0.1);
      const charEstimate = Math.ceil(text.length / 3.5);
      tokens = Math.max(baseTokens + overhead, charEstimate);
    }

    // Aggiungi stima per allegati (es: 200 token fissi per immagine/PDF/OCR)
    if (attachments && Array.isArray(attachments)) {
      tokens += attachments.length * 200;
    }

    return Math.max(tokens, 1);
  }

  _selectAndReserveModel(taskType, options) {
    options = options || {};
    const estimatedTokens = options.estimatedTokens || 1000;
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
      timeoutReason: 'lock_timeout',
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
    });

    this._updateWindow('tpm', {
      timestamp: now,
      nonce: reservationId,
      modelKey: modelKey,
      tokens: estimatedTokens || 0,
      reserved: true,
      completed: false
    });

    this._persistCache();
    console.log(`🧾 Reservation creata: ${modelKey} (${reservationId})`);
    return reservationId;
  }

  _finalizeReservation(modelKey, reservationId, duration) {
    this._mutateReservation(modelKey, reservationId, function(entry) {
      entry.completed = true;
      entry.completedAt = Date.now();
      entry.duration = duration || 0;
      return true;
    });
  }

  _releaseReservation(modelKey, reservationId) {
    this._mutateReservation(modelKey, reservationId, function(entry) {
      return false;
    });
  }

  _mutateReservation(modelKey, reservationId, mutatorFn) {
    if (!reservationId) return;

    const lockResult = this._withRateLimitLock_(function () {
      this._refreshCache();

      ['rpmWindow', 'tpmWindow'].forEach(function(cacheKey) {
        const currentWindow = Array.isArray(this.cache[cacheKey]) ? this.cache[cacheKey] : [];
        this.cache[cacheKey] = currentWindow.filter(function(entry) {
          if (!entry || entry.modelKey !== modelKey || entry.nonce !== reservationId || entry.reserved !== true) {
            return true;
          }

          const mutableEntry = Object.assign({}, entry);
          const keepEntry = mutatorFn(mutableEntry);
          if (keepEntry === false) {
            return false;
          }
          Object.keys(entry).forEach(function(key) { delete entry[key]; });
          Object.assign(entry, mutableEntry);
          return true;
        });
      }.bind(this));

      this._persistCache();
      return true;
    }.bind(this), {
      timeoutReason: 'lock_timeout',
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
  for (var modelKey in stats.models) {
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
