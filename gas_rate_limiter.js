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
class GeminiRateLimiter {
  constructor() {
    console.log('🚦 Inizializzazione GeminiRateLimiter...');

    // ================================================================
    // CONFIGURAZIONE MODELLI (Legge da CONFIG)
    // ================================================================

    // Legge modelli da CONFIG.GEMINI_MODELS (centralizzato)
    if (typeof CONFIG !== 'undefined' && CONFIG.GEMINI_MODELS) {
      this.models = CONFIG.GEMINI_MODELS;
      console.log('   ✓ Modelli caricati da CONFIG.GEMINI_MODELS');
    } else {
      // Fallback se CONFIG non disponibile
      console.warn('   ⚠️ CONFIG.GEMINI_MODELS non trovato, uso default');
      this.models = {
        'flash-2.5': {
          name: 'gemini-2.5-flash',
          rpm: 15, tpm: 250000, rpd: 250,
          useCases: ['generation', 'quick_check', 'all']
        },
        'flash-lite': {
          name: 'gemini-2.5-flash-lite',
          rpm: 30, tpm: 1000000, rpd: 1000,
          useCases: ['fallback', 'high_volume', 'quick_check']
        }
      };
    }

    // Legge strategia da CONFIG.MODEL_STRATEGY (centralizzato)
    if (typeof CONFIG !== 'undefined' && CONFIG.MODEL_STRATEGY) {
      this.strategies = CONFIG.MODEL_STRATEGY;
      console.log('   ✓ Strategia caricata da CONFIG.MODEL_STRATEGY');
    } else {
      // Fallback default
      this.strategies = {
        'quick_check': ['flash-lite', 'flash-2.5'],
        'generation': ['flash-2.5', 'flash-lite'],
        'fallback': ['flash-lite', 'flash-2.5']
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

    // Inizializza contatori se non esistono
    this._initializeCounters();

    // ================================================================
    // CONFIGURAZIONE THROTTLING
    // ================================================================

    this.safetyMargin = {
      rpm: 0.8,   // 80% del limite (12 su 15)
      tpm: 0.8,
      rpd: 0.9    // 90% del limite
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

    console.log('✓ GeminiRateLimiter v2.1 inizializzato');
    console.log(`   Modelli: ${Object.keys(this.models).join(', ')}`);
    console.log(`   Default: ${this.defaultModel}`);
  }

  // ================================================================
  // INIZIALIZZAZIONE
  // ================================================================

  _initializeCounters() {
    // Usa ScriptLock per sincronizzare il reset tra esecuzioni parallele
    const lock = LockService.getScriptLock();
    try {
      // Tenta di acquisire il lock per 5 secondi
      if (lock.tryLock(5000)) {
        // Usa data Pacific per allinearsi al reset reale delle quote Google
        // Il reset Google avviene a mezzanotte Pacific = 9:00 AM italiana
        const pacificDate = this._getPacificDate();
        const storedDate = this.props.getProperty('rate_limit_date');

        // Reset quando cambia la data Pacific (non italiana!)
        if (storedDate !== pacificDate) {
          console.log(`📅 Giorno Pacific cambiato (${pacificDate}), reset contatori giornalieri`);
          console.log(`   (Ora italiana: ${Utilities.formatDate(new Date(), 'Europe/Rome', 'HH:mm')})`);
          this._resetDailyCounters();
          this.props.setProperty('rate_limit_date', pacificDate);
        }
      } else {
        console.warn('⚠️ Impossibile acquisire lock per reset quota, salto controllo');
      }
    } catch (e) {
      console.error(`❌ Errore durante lock inizializzazione quota: ${e.message}`);
    } finally {
      try { lock.releaseLock(); } catch (e) { console.warn(`⚠️ Errore rilascio lock (QuotaReset): ${e.message}`); }
    }
  }

  _resetDailyCounters() {
    for (const modelKey in this.models) {
      this.props.setProperty(`rpd_${modelKey}`, '0');
      this.props.setProperty(`tokens_${modelKey}`, '0');
    }
    // Reset anche cache
    this.props.setProperty('rpm_window', JSON.stringify([]));
    this.props.setProperty('tpm_window', JSON.stringify([]));
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
    // America/Los_Angeles gestisce automaticamente DST (PST/PDT)
    const pacificDate = Utilities.formatDate(now, 'America/Los_Angeles', 'yyyy-MM-dd');
    return pacificDate;
  }

  // ================================================================
  // SELEZIONE MODELLO
  // ================================================================

  selectModel(taskType, options) {
    options = options || {};
    const preferQuality = options.preferQuality || false;
    const forceModel = options.forceModel || null;
    const estimatedTokens = options.estimatedTokens || 1000;

    // Override manuale
    if (forceModel && this.models[forceModel]) {
      return this._validateModelAvailability(forceModel, estimatedTokens);
    }

    // Usa strategia da CONFIG (o fallback)
    // Aggiunge 'classification' come alias di 'quick_check' se non definito
    const taskStrategies = this.strategies;
    if (!taskStrategies['classification']) {
      taskStrategies['classification'] = taskStrategies['quick_check'] || ['flash-2.5', 'flash-lite'];
    }

    const candidates = taskStrategies[taskType] || taskStrategies['fallback'] || ['flash-2.5', 'flash-lite'];

    // Trova primo modello disponibile
    for (var i = 0; i < candidates.length; i++) {
      const modelKey = candidates[i];
      const result = this._validateModelAvailability(modelKey, estimatedTokens);
      if (result.available) {
        console.log(`✓ Selezionato: ${modelKey} per ${taskType}`);
        console.log(`   RPD rimanenti: ${result.quotaLeft.rpd}/${this.models[modelKey].rpd}`);
        return result;
      }
    }

    // Nessun modello disponibile
    console.error('❌ NESSUN MODELLO DISPONIBILE');
    return {
      available: false,
      modelKey: null,
      reason: 'all_quotas_exhausted',
      nextResetTime: this._getNextResetTime()
    };
  }

  _validateModelAvailability(modelKey, estimatedTokens) {
    const model = this.models[modelKey];
    if (!model) {
      return { available: false, reason: 'model_not_found' };
    }

    // Controllo RPD
    const rpdUsed = parseInt(this.props.getProperty(`rpd_${modelKey}`) || '0');
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
    const estimatedTokens = options.estimatedTokens || 1000;
    const maxRetries = options.maxRetries || 3;
    const preferQuality = options.preferQuality || false;

    // 1. Selezione modello
    const selection = this.selectModel(taskType, {
      estimatedTokens: estimatedTokens,
      preferQuality: preferQuality
    });

    if (!selection.available) {
      console.error(`❌ Nessun modello disponibile: ${selection.reason}`);
      throw new Error('QUOTA_EXHAUSTED: ' + selection.reason);
    }

    const modelKey = selection.modelKey;
    const model = selection.model;
    const shouldThrottle = selection.shouldThrottle;

    // 2. Throttling
    if (shouldThrottle && shouldThrottle.needed) {
      console.warn(`⏸️  Throttling (${shouldThrottle.reason}): ${shouldThrottle.delay}ms`);
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

        // Traccia richiesta riuscita
        this._trackRequest(modelKey, estimatedTokens, duration);

        console.log(`✓ Successo (${duration}ms)`);

        return {
          success: true,
          result: result,
          modelUsed: model.name,
          modelKey: modelKey,
          duration: duration,
          quotaUsed: {
            rpd: parseInt(this.props.getProperty(`rpd_${modelKey}`)),
            rpm: this._getRequestsInWindow('rpm', modelKey)
          }
        };

      } catch (error) {
        lastError = error;
        const errorMsg = error.message || '';

        // Controllo se errore 429
        if (errorMsg.indexOf('429') !== -1 ||
          errorMsg.indexOf('rate limit') !== -1 ||
          errorMsg.indexOf('quota') !== -1) {

          console.warn(`⚠️  Limite quota (429) al tentativo ${attempt + 1}`);

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
  // TRACKING (Ottimizzato con cache)
  // ================================================================

  _trackRequest(modelKey, tokensUsed, duration) {
    const now = Date.now();

    // 1. Contatore RPD
    const rpdKey = 'rpd_' + modelKey;
    const currentRpd = parseInt(this.props.getProperty(rpdKey) || '0');
    this.props.setProperty(rpdKey, (currentRpd + 1).toString());

    // 2. Contatore Token
    const tokensKey = 'tokens_' + modelKey;
    const currentTokens = parseInt(this.props.getProperty(tokensKey) || '0');
    this.props.setProperty(tokensKey, (currentTokens + tokensUsed).toString());

    // 3. Finestra RPM (con cache)
    this._updateWindow('rpm', {
      timestamp: now,
      modelKey: modelKey
    });

    // 4. Finestra TPM (con cache)
    this._updateWindow('tpm', {
      timestamp: now,
      modelKey: modelKey,
      tokens: tokensUsed
    });

    // Log
    console.log(`📊 Tracciato: ${modelKey}`);
    console.log(`   RPD: ${currentRpd + 1}/${this.models[modelKey].rpd}`);
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
    this.cache[cacheKey] = this.cache[cacheKey].filter(function (e) {
      return now - e.timestamp < 60000;
    });

    // Limita dimensioni array per rispettare limiti PropertiesService (~9kb)
    if (this.cache[cacheKey].length > 100) {
      this.cache[cacheKey] = this.cache[cacheKey].slice(-100);
    }

    // Persist ogni 10 secondi (batch writes)
    if (now - this.cache.lastCacheUpdate > 10000) {
      this._persistCache();
    }
  }

  _refreshCache() {
    const rpmWindow = JSON.parse(this.props.getProperty('rpm_window') || '[]');
    const tpmWindow = JSON.parse(this.props.getProperty('tpm_window') || '[]');

    const now = Date.now();

    // 1. Pulisci RPM e applica LIMITE DI SICUREZZA
    let newRpm = rpmWindow.filter(function (e) {
      return now - e.timestamp < 60000;
    });
    // Taglio di sicurezza esplicito per RPM
    if (newRpm.length > 100) {
      newRpm = newRpm.slice(-100);
    }
    this.cache.rpmWindow = newRpm;

    // 2. Pulisci TPM e applica LIMITE DI SICUREZZA
    let newTpm = tpmWindow.filter(function (e) {
      return now - e.timestamp < 60000;
    });
    // Taglio di sicurezza esplicito per TPM
    if (newTpm.length > 100) {
      newTpm = newTpm.slice(-100);
    }
    this.cache.tpmWindow = newTpm;

    this.cache.lastCacheUpdate = now;
  }

  _persistCache() {
    this.props.setProperty('rpm_window', JSON.stringify(this.cache.rpmWindow));
    this.props.setProperty('tpm_window', JSON.stringify(this.cache.tpmWindow));
    this.cache.lastCacheUpdate = Date.now();
  }

  _getRequestsInWindow(windowType, modelKey) {
    const now = Date.now();

    // Usa cache se fresh
    if (now - this.cache.lastCacheUpdate < this.cache.cacheTTL) {
      const cacheKey = windowType + 'Window';
      return this.cache[cacheKey].filter(function (e) {
        return e.modelKey === modelKey && (now - e.timestamp < 60000);
      }).length;
    }

    // Altrimenti leggi da PropertiesService
    const window = JSON.parse(this.props.getProperty(windowType + '_window') || '[]');
    return window.filter(function (e) {
      return e.modelKey === modelKey && (now - e.timestamp < 60000);
    }).length;
  }

  _getTokensInWindow(windowType, modelKey) {
    const now = Date.now();

    // Usa cache
    if (now - this.cache.lastCacheUpdate < this.cache.cacheTTL) {
      return this.cache.tpmWindow
        .filter(function (e) {
          return e.modelKey === modelKey && (now - e.timestamp < 60000);
        })
        .reduce(function (sum, e) { return sum + (e.tokens || 0); }, 0);
    }

    // Fallback PropertiesService
    const window = JSON.parse(this.props.getProperty('tpm_window') || '[]');
    return window
      .filter(function (e) {
        return e.modelKey === modelKey && (now - e.timestamp < 60000);
      })
      .reduce(function (sum, e) { return sum + (e.tokens || 0); }, 0);
  }

  // ================================================================
  // STATISTICHE
  // ================================================================

  getUsageStats() {
    const stats = {
      date: this._getItalianDate(),
      italianTime: Utilities.formatDate(new Date(), 'Europe/Rome', 'HH:mm'),
      pacificTime: Utilities.formatDate(new Date(), 'America/Los_Angeles', 'HH:mm') + ' (PST/PDT)',
      nextReset: this._getNextResetTime(),
      nextResetPacific: '00:00 Pacific Time', // Reset Google è sempre mezzanotte Pacific
      models: {}
    };

    for (var modelKey in this.models) {
      const model = this.models[modelKey];
      const rpdUsed = parseInt(this.props.getProperty('rpd_' + modelKey) || '0');
      const tokensUsed = parseInt(this.props.getProperty('tokens_' + modelKey) || '0');
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
    const now = new Date();
    const hour = parseInt(Utilities.formatDate(now, 'Europe/Rome', 'HH'));

    const resetTime = new Date(now);
    if (hour >= 9) {
      resetTime.setDate(resetTime.getDate() + 1);
    }
    resetTime.setHours(9, 0, 0, 0);
    return resetTime.toISOString();
  }

  /**
   * Stima il numero di token per un testo
   * Formula: parole * 1.25 + overhead 10%
   */
  _estimateTokens(text) {
    if (!text) return 0;

    const wordCount = text.split(/\s+/).length;
    const baseTokens = Math.ceil(wordCount * 1.25);
    const overhead = Math.ceil(baseTokens * 0.1);
    const charEstimate = Math.ceil(text.length / 3.5);

    return Math.max(baseTokens + overhead, charEstimate, 1);
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