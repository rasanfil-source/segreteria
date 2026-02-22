/**
 * GeminiService.js - Servizio API Gemini
 * Gestisce tutte le chiamate all'API Generativa di Google
 * 
 * FUNZIONALITÀ:
 * - Retry con exponential backoff
 * - Rilevamento lingua centralizzato
 * - Controllo rapido per decisione risposta
 * - Saluto adattivo (ora + calendario liturgico)
 * - Rate Limiter integrato con gestione quota
 */

class GeminiService {
  constructor(options = {}) {
    const sharedConfig = (typeof CONFIG !== 'undefined') ? CONFIG : {};
    this.config = Object.assign({}, sharedConfig, options.config || {});

    // Logger strutturato (DI opzionale)
    this.logger = options.logger || createLogger('GeminiService');
    this.logger.info('Inizializzazione GeminiService');

    // Dipendenze esterne iniettabili (testabilità)
    this.fetchFn = options.fetchFn || ((url, requestOptions) => UrlFetchApp.fetch(url, requestOptions));
    this.props = options.props || PropertiesService.getScriptProperties();

    // ═══════════════════════════════════════════════════════════════════
    // CONFIGURAZIONE CHIAVI API (Strategia Cross-Key Quality First)
    // ═══════════════════════════════════════════════════════════════════

    // Chiave Primaria
    // Priorità: 1. override DI 2. Script Properties 3. CONFIG
    const propKey = this.props.getProperty('GEMINI_API_KEY');
    this.primaryKey = options.primaryKey || ((propKey && propKey.length > 20) ? propKey : this.config.GEMINI_API_KEY);

    // Chiave di Riserva (opzionale, per alternativa quando quota primaria esaurita)
    const propBackupKey = this.props.getProperty('GEMINI_API_KEY_BACKUP');
    this.backupKey = options.backupKey || ((propBackupKey && propBackupKey.length > 20) ? propBackupKey : null);

    // Manteniamo apiKey per retrocompatibilità
    this.apiKey = this.primaryKey;

    this.modelName = this.config.MODEL_NAME || 'gemini-2.5-flash';
    this.baseUrl = this._buildGenerateUrl(this.modelName);

    if (!this.primaryKey || this.primaryKey.length < 20 || /YOUR_[A-Z0-9_]+_HERE/.test(this.primaryKey)) {
      throw new Error('GEMINI_API_KEY non configurata correttamente (usa Script Properties, non placeholder)');
    }

    if (this.backupKey) {
      this.logger.info('Chiave di Riserva configurata (Cross-Key Quality First attivo)');
    }

    // Configurazione retry
    this.maxRetries = 3;
    this.retryDelay = 2000; // millisecondi
    this.backoffFactor = 1.5; // crescita graduale: 2s → 3s → 4.5s

    // Rate Limiter (abilitato da CONFIG.USE_RATE_LIMITER)
    this.useRateLimiter = this.config.USE_RATE_LIMITER === true;
    if (this.useRateLimiter) {
      try {
        if (typeof GeminiRateLimiter !== 'undefined') {
          this.rateLimiter = new GeminiRateLimiter();
          this.logger.info('Rate Limiter abilitato');
        } else {
          throw new Error('Classe GeminiRateLimiter non trovata nel bundle di script.');
        }
      } catch (e) {
        this.logger.warn('Inizializzazione Rate Limiter fallita, fallback a chiamate dirette', { errore: e.message });
        this.useRateLimiter = false;
      }
    } else {
      this.logger.debug('Rate Limiter disabilitato via config');
    }

    this.logger.info('GeminiService inizializzato', { modello: this.modelName });
  }

  // ========================================================================
  // HELPER RATE LIMITER
  // ========================================================================

  /**
   * Stima token da testo
   * Formula: parole * 1.25 + overhead 10% (allineato con GeminiRateLimiter)
   */
  _estimateTokens(text) {
    if (!text) return 0;

    const wordCount = text.split(/\s+/).length;
    const baseTokens = Math.ceil(wordCount * 1.25);
    const overhead = Math.ceil(baseTokens * 0.1);
    const charEstimate = Math.ceil(text.length / 3.5);

    return Math.max(baseTokens + overhead, charEstimate, 1);
  }

  /**
   * Genera risposta con modello specifico
   * @param {string} prompt - Prompt completo
   * @param {string} modelName - Nome modello API (es. 'gemini-2.5-flash')
   * @param {string} apiKeyOverride - Chiave API opzionale (per strategia multi-key)
   * @returns {string|null} Testo generato
   */
  _generateWithModel(prompt, modelName, apiKeyOverride = null) {
    // Usa chiave override se fornita, altrimenti chiave primaria
    const activeKey = apiKeyOverride || this.primaryKey;
    const url = this._buildGenerateUrl(modelName);
    const temperature = this.config.TEMPERATURE || 0.5;
    const maxTokens = this.config.MAX_OUTPUT_TOKENS || 6000;

    console.log(`\uD83E\uDD16 Chiamata ${modelName} (prompt: ${prompt.length} caratteri)...`);

    let response;
    try {
      response = this.fetchFn(`${url}?key=${encodeURIComponent(activeKey)}`, {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: temperature,
            maxOutputTokens: maxTokens
          }
        }),
        muteHttpExceptions: true
      });
    } catch (error) {
      throw new Error(`Errore rete/timeout durante chiamata Gemini: ${error.message}`);
    }

    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    // Separazione errori di rete/quota vs contenuto con semplici if
    if ([429, 500, 502, 503, 504].includes(responseCode)) {
      throw new Error(`Errore rete/server o quota (${responseCode}). Richiesto retry.`);
    }

    if (responseCode === 400) {
      const bodyLower = responseBody.toLowerCase();
      const isTokenLimit = bodyLower.includes('token') && (bodyLower.includes('limit') || bodyLower.includes('exceed'));
      if (isTokenLimit) {
        throw new Error('Errore contenuto: prompt supera il limite token del modello.');
      }
      throw new Error(`Errore contenuto: richiesta non valida (${responseCode}).`);
    }

    if (responseCode === 403) {
      throw new Error(`Errore API 403 (chiave non valida/restrizioni referrer-IP-API): ${responseBody.substring(0, 200)}`);
    }

    if (responseCode !== 200) {
      throw new Error(`Errore API: ${responseCode} - ${responseBody.substring(0, 200)}`);
    }

    let result;
    try {
      result = JSON.parse(responseBody);
    } catch (error) {
      throw new Error(`Risposta Gemini non JSON valida: ${error.message}`);
    }

    if (!result.candidates || !result.candidates[0]) {
      throw new Error('Risposta Gemini non valida: nessun candidato');
    }

    const candidate = result.candidates[0];

    // Controllo blocco safety
    if (candidate.finishReason && ['SAFETY', 'RECITATION', 'OTHER', 'BLOCKLIST'].includes(candidate.finishReason)) {
      throw new Error(`Risposta bloccata da Gemini: ${candidate.finishReason}`);
    }

    // Estrazione contenuto robusta
    const parts = candidate.content?.parts || [];
    const generatedText = parts.map(p => p.text || '').join('').trim();

    if (!generatedText) {
      throw new Error('Gemini ha restituito testo vuoto');
    }

    console.log(`\u2713 Generati ${generatedText.length} caratteri (da ${parts.length} parti)`);
    return generatedText;
  }

  /**
   * Controllo rapido con modello specifico
   * @param {string} emailContent - Contenuto email
   * @param {string} emailSubject - Oggetto email
   * @param {string} modelName - Nome modello API
   * @param {Object} [precomputedDetection] - Risultato detectEmailLanguage già calcolato (evita doppia chiamata)
   * @returns {Object} Risultato controllo rapido
   */
  _quickCheckWithModel(emailContent, emailSubject, modelName, precomputedDetection = null) {
    const safeSubject = typeof emailSubject === 'string' ? emailSubject : (emailSubject == null ? '' : String(emailSubject));
    const safeContent = typeof emailContent === 'string' ? emailContent : (emailContent == null ? '' : String(emailContent));
    const detection = precomputedDetection || this.detectEmailLanguage(safeContent, safeSubject);
    const prompt = `Analizza questa email.
Rispondi ESCLUSIVAMENTE con un oggetto JSON valido e completo.
NON usare blocchi markdown e NON aggiungere testo extra prima o dopo il JSON.

Email:
Oggetto: ${safeSubject}
Testo: ${safeContent.substring(0, 800)}

COMPITI:
1. Decidi se richiede risposta (reply_needed):
 - TRUE se l'utente pone domande, esprime dubbi o fornisce informazioni nuove/utili (appuntamenti, dati, modifiche).
 - FALSE se è solo un ringraziamento finale (es: \"Grazie mille\", \"Perfetto grazie\", \"Ricevuto\") senza nuove domande o info.
 - FALSE se è newsletter, spam o messaggi di sistema.
 - IMPORTANTE: Se l'utente chiede qualcosa già detto, rispondi TRUE ma con riferimento cordiale alla risposta precedente.

2. Rileva la lingua (language) - codice ISO 639-1 (es: "it", "en", "es", "fr", "de")
3. Classifica la richiesta (category):
   - "TECHNICAL": orari, documenti, info pratiche, iscrizioni
   - "PASTORAL": richieste di aiuto, situazioni personali, lutto
   - "DOCTRINAL": dubbi di fede, domande teologiche
   - "FORMAL": richieste di sbattezzo, cancellazione registri, apostasia
   - "MIXED": mix di tecnica e pastorale
4. Fornisci punteggi continui (0.0-1.0) per ogni dimensione:
   - technical, pastoral, doctrinal, formal
5. Estrai l'argomento principale (topic) in ITALIANO (usando termini coerenti con la richiesta)
6. Fornisci un breve ragionamento (reason)

⚠️ REGOLA CRITICA "SBATTEZZO":
Se l'utente esprime la volontà di non essere più cristiano, essere cancellato dai registri o "sbattezzarsi":
- Classifica SEMPRE come "FORMAL"
- Topic: "sbattezzo"
- NON classificarlo come "PASTORAL" anche se c'è un tono emotivo.

Output JSON:
{
  "reply_needed": boolean,
  "language": "string (codice ISO 639-1)",
  "category": "TECHNICAL" | "PASTORAL" | "DOCTRINAL" | "FORMAL" | "MIXED",
  "dimensions": {
    "technical": number (0.0-1.0),
    "pastoral": number (0.0-1.0),
    "doctrinal": number (0.0-1.0),
    "formal": number (0.0-1.0)
  },
  "topic": "string",
  "confidence": number (0.0-1.0),
  "reason": "string"
}`;

    const url = this._buildGenerateUrl(modelName);

    console.log(`🔍 Controllo rapido via ${modelName}...`);

    // Gestione con tentativo su chiave primaria e alternativa su secondaria
    let activeKey = this.primaryKey;
    let response;
    let responseCode;

    try {
      response = this.fetchFn(`${url}?key=${encodeURIComponent(activeKey)}`, {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024,
            responseMimeType: 'application/json'
          }
        }),
        muteHttpExceptions: true
      });


      // Punto 4: Estesa gestione errori con switch alla chiave di riserva
      responseCode = response.getResponseCode();
      if ([429, 500, 502, 503, 504].includes(responseCode) && this.backupKey) {
        console.warn(`\u26A0\uFE0F Chiave primaria esaurita / errore(${response.getResponseCode()}).Tentativo con chiave di riserva...`);
        activeKey = this.backupKey;
        response = this.fetchFn(`${url}?key=${encodeURIComponent(activeKey)}`, {
          method: 'POST',
          contentType: 'application/json',
          payload: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 1024,
              responseMimeType: 'application/json'
            }
          }),
          muteHttpExceptions: true
        });
      }

    } catch (e) {
      throw new Error(`Errore connessione API: ${e.message}`);
    }

    responseCode = response.getResponseCode();

    if ([429, 500, 502, 503, 504].includes(responseCode)) {
      throw new Error(`Errore server o quota Gemini(${responseCode})`);
    }

    if (responseCode !== 200) {
      throw new Error(`Errore API: ${responseCode}`);
    }

    const result = JSON.parse(response.getContentText());

    // Risultato default in caso di errori
    const defaultResult = {
      shouldRespond: false, // Failsafe conservativo: evita risposte massive in caso di errore
      language: detection.lang,
      reason: 'quick_check_failed',
      classification: {
        category: 'TECHNICAL',
        topic: 'unknown',
        confidence: 0.0
      }
    };

    if (!result.candidates || !result.candidates[0]) {
      console.error('\u274C Nessun candidato nella risposta Controllo Rapido Gemini');
      return defaultResult;
    }

    const candidate = result.candidates[0];

    if (candidate.finishReason && ['SAFETY', 'RECITATION', 'OTHER', 'BLOCKLIST'].includes(candidate.finishReason)) {
      console.warn(`\u26A0\uFE0F Controllo rapido bloccato: ${candidate.finishReason}`);
      return defaultResult;
    }

    // Estrazione contenuto robusta
    const parts = candidate.content?.parts || [];
    const textResponse = parts.map(p => p.text || '').join('').trim();

    console.log('=========================================');
    console.log('🤖 RAW GEMINI CLASSIFIER JSON:');
    console.log(textResponse);
    console.log('=========================================');

    if (!textResponse) {
      console.error('\u274C Risposta non valida: testo vuoto');
      return defaultResult;
    }

    // Parsing JSON con gestione errori
    let data;
    try {
      data = parseGeminiJsonLenient(textResponse);
    } catch (parseError) {
      console.warn(`\u26A0\uFE0F parseGeminiJsonLenient fallito: ${parseError.message}`);
      return defaultResult;
    }

    // Detection locale come lingua alternativa

    // Normalizzazione sicura booleano
    const replyNeeded = data.reply_needed;
    const isTrue = replyNeeded === true || (typeof replyNeeded === 'string' && replyNeeded.toLowerCase() === 'true');

    return {
      // Rispondi solo se la richiesta è esplicita e necessaria
      shouldRespond: isTrue,
      language: this._resolveLanguage(data.language, detection.lang, detection.safetyGrade),
      reason: data.reason || 'quick_check',
      classification: {
        category: data.category || 'TECHNICAL',
        topic: data.topic || '',
        confidence: data.confidence || 0.8,
        dimensions: data.dimensions || null
      }
    };
  }


  // ========================================================================
  // WRAPPER RETRY
  // ========================================================================

  /**
   * Esegue una funzione con retry temporizzati
   * Usa ritardi crescenti tra i tentativi
   * 
   * BUG FIX: La logica di classifyError() non esiste in questo scope, uso classificazione inline.
   */
  _withRetry(fn, context = 'Chiamata API', maxRetries = 3) {
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return fn();
      } catch (error) {
        lastError = error;
        const msg = String(error.message || '').toLowerCase();

        // Determina se l'errore è ritentabile
        const isRetryable = ['401', '403', '429', '500', '502', '503', '504', 'quota', 'timeout', 'deadline', 'econnreset'].some(term => msg.includes(term));

        if (isRetryable && attempt < maxRetries - 1) {
          const waitTime = this.retryDelay * Math.pow(this.backoffFactor, attempt);
          console.warn(`\u26A0\uFE0F ${context} fallito (tentativo ${attempt + 1}/${maxRetries}): ${error.message} - Attendendo ${waitTime}ms...`);
          Utilities.sleep(waitTime);
        } else {
          // Errore fatale o esaurimento tentativi
          throw error;
        }
      }
    }

    throw lastError || new Error(`Fallimento definitivo dopo ${maxRetries} tentativi`);
  }

  // ========================================================================
  // RILEVAMENTO LINGUA (Centralizzato)
  // ========================================================================

  /**
   * Rileva la lingua dell'email processando testo localmente tramite dizionario stop-words
   * Molto più veloce dell'API Gemini e fissa i rari switch di lingua su nomi stranieri.
   * @param {string} emailContent 
   * @param {string} emailSubject 
   * @returns {{lang: string, confidence: number, safetyGrade: number}} 
   */
  detectEmailLanguage(emailContent, emailSubject = '') {
    const safeSubject = typeof emailSubject === 'string' ? emailSubject : (emailSubject == null ? '' : String(emailSubject));
    const safeContent = typeof emailContent === 'string' ? emailContent : (emailContent == null ? '' : String(emailContent));
    const text = `${safeSubject} ${safeContent} `.toLowerCase();
    const originalText = `${safeSubject} ${safeContent} `;

    // Rilevamento caratteri specifici
    let spanishCharScore = 0;
    let portugueseCharScore = 0;

    if (originalText.includes('¿') || originalText.includes('¡')) {
      spanishCharScore = 1;
      console.log('   Trovata punteggiatura spagnola (¿ o ¡)');
    }
    if (text.includes('ñ')) {
      spanishCharScore += 2;
      console.log('   Trovato carattere spagnolo (ñ)');
    }
    if (text.includes('ã') || text.includes('õ') || text.includes('ç')) {
      portugueseCharScore += 2;
      console.log('   Trovato carattere portoghese (ã, õ, ç)');
    }

    // Parole chiave per rilevamento
    const englishUniqueKeywords = [
      'the', 'would', 'could', 'should', 'might',
      'we are', 'you are', 'they are', 'i am', "i'm", "we're", "you're",
      'please', 'thank you', 'thanks', 'dear sir', 'dear madam',
      'kind regards', 'best regards', 'sincerely', 'yours truly',
      'looking forward', 'i would like', 'we would like',
      'let me know', 'get back to', 'reach out',
      'however', 'therefore', 'furthermore', 'moreover'
    ];

    const englishStandardKeywords = [
      ' and ', ' but ', ' an ',
      'will', 'can', 'may', 'shall', 'must',
      'have', 'has', 'had', 'do', 'does', 'did',
      'what', 'when', 'where', 'how', 'why', 'which', 'who',
      ' on ', ' of ', ' to ', ' from ', ' for ', ' with ', ' at ', ' by '
    ];

    const spanishKeywords = [
      'he ido', 'había', 'hay', 'ido', 'sido',
      'hacer', 'haber', 'poder', 'estar', 'estoy', 'están',
      'por qué', 'porque', 'cuándo', 'cómo', 'dónde', 'qué tal',
      'por favor', 'muchas gracias', 'buenos días', 'buenas tardes',
      'misa', 'misas', 'iglesia', 'parroquia',
      'hola', 'gracias', 'necesito', 'quiero',
      'querido', 'estimado', 'saludos',
      ' no ', ' un ', ' unos ', ' unas ',
      ' del ', ' con el ', ' en el ', ' es '
    ];

    const portugueseKeywords = [
      'olá', 'obrigado', 'obrigada', 'agradecemos', 'agradeço',
      'orçamento', 'cotação', 'viatura', 'portagens', 'reserva',
      'estamos ao dispor', 'com os migliori cumprimentos', 'cumprimentos',
      'bom dia', 'boa tarde', 'boa noite',
      ' por ', ' para ', ' com ', ' não ', ' uma ', ' seu ', ' sua ',
      ' dos ', ' das ', ' ao ', ' aos '
    ];

    const italianKeywords = [
      'sono', 'siamo', 'stato', 'stata', 'ho', 'hai', 'abbiamo',
      'fare', 'avere', 'essere', 'potere', 'volere',
      'perché', 'perchè', 'quando', 'come', 'dove', 'cosa',
      'per favore', 'per piacere', 'molte grazie', 'buongiorno',
      'buonasera', 'gentile', 'egregio', 'cordiali saluti',
      ' non ', ' il ', ' di ', ' da ',
      ' nel ', ' della ', ' degli ', ' delle '
    ];

    // Conta corrispondenze con limiti di parola Unicode-safe
    const countMatches = (keywords, txt, weight = 1) => {
      let count = 0;
      for (const kw of keywords) {
        if (kw.startsWith(' ') || kw.endsWith(' ')) {
          const matches = (txt.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
          count += weight * matches;
        } else {
          const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'giu');
          const matches = (txt.match(pattern) || []).length;
          count += weight * matches;
        }
      }
      return count;
    };

    const englishScore = countMatches(englishUniqueKeywords, text, 2) +
      countMatches(englishStandardKeywords, text, 1);
    const spanishLexicalScore = countMatches(spanishKeywords, text, 1);

    const scores = {
      'en': englishScore,
      'es': spanishLexicalScore + Math.min(spanishCharScore, 2),
      'it': countMatches(italianKeywords, text, 1),
      'pt': countMatches(portugueseKeywords, text, 1)
    };

    console.log(`   Punteggi lingua: EN = ${scores['en']}, ES = ${scores['es']}, PT = ${scores['pt']}, IT = ${scores['it']}`);

    // Determina lingua rilevata e punteggio massimo
    let detectedLang = 'it';
    let maxScore = scores.it || 0;
    const langPriority = ['it', 'en', 'pt', 'es'];
    for (const lang of langPriority) {
      if (scores[lang] > maxScore) {
        maxScore = scores[lang];
        detectedLang = lang;
      }
    }

    // Default: IT se punteggi nulli o trascurabili
    if (maxScore < 2) {
      console.log('   \u2713 Default: ITALIANO (punteggio basso o nullo)');
      return { lang: 'it', confidence: maxScore, safetyGrade: 5 };
    }

    const safetyGrade = this._computeSafetyGrade(detectedLang, maxScore, scores);
    console.log(`   \u2713 Rilevato: ${detectedLang.toUpperCase()} (punteggio: ${maxScore}, grado sicurezza: ${safetyGrade})`);

    return {
      lang: detectedLang,
      confidence: maxScore,
      safetyGrade: safetyGrade
    };
  }

  /**
   * Calcola il grado di sicurezza del rilevamento locale (1-5)
   * Basato su punteggio assoluto e distacco dal secondo classificato
   */
  _computeSafetyGrade(detectedLang, score, allScores) {
    let secondScore = 0;
    for (const lang in allScores) {
      if (lang !== detectedLang && allScores[lang] > secondScore) {
        secondScore = allScores[lang];
      }
    }

    const gap = score - secondScore;

    // Grado 5: Dominio assoluto (es. 10 vs 1 o gap > 6)
    if (score >= 8 && gap >= 5) return 5;

    // Grado 4: Molto sicuro (gap netto)
    if (score >= 5 && gap >= 3) return 4;

    // Grado 3: Abbastanza sicuro
    if (gap >= 2) return 3;

    // Grado 2: Incertezza (punteggi vicini)
    if (gap >= 1) return 2;

    // Grado 1: Bassissima sicurezza (tie o quasi)
    return 1;
  }

  /**
   * Risolve il conflitto tra detection Gemini (API) e Locale (Regex)
   */
  _resolveLanguage(geminiLang, localLang, localSafetyGrade) {
    if (!geminiLang) return localLang || 'it';

    const normalizedGemini = String(geminiLang).toLowerCase().substring(0, 2);
    const normalizedLocal = String(localLang).toLowerCase().substring(0, 2);

    // 1. Se coincidono, massima sicurezza
    if (normalizedGemini === normalizedLocal) return normalizedGemini;

    // 2. Lingue "esotiche": Se Gemini rileva qualcosa che NON è IT/EN/ES/PT, 
    // ci fidiamo di Gemini prima del locale (che è ottimizzato solo per quelle 4).
    const supportedLocally = ['it', 'en', 'es', 'pt'];
    if (!supportedLocally.includes(normalizedGemini)) {
      console.log(`   \uD83C\uDF0D Lingua: ${normalizedGemini.toUpperCase()} (Gemini ha rilevato lingua non supportata localmente)`);
      return normalizedGemini;
    }

    // 3. Lingua principale: Se il locale è MOLTO sicuro (grado >= 4), 
    // prevale sulla detection API (che a volte si confonde con nomi propri o citazioni).
    if (localSafetyGrade >= 4) {
      console.log(`   \uD83C\uDF0D Lingua: ${normalizedLocal.toUpperCase()} (Locale vince per grado sicurezza ${localSafetyGrade})`);
      return normalizedLocal;
    }

    // 4. Default: Se c'è incertezza, ci fidiamo del rilevamento del modello Large
    console.log(`   \uD83C\uDF0D Lingua: ${normalizedGemini.toUpperCase()} (Gemini prioritario su locale incerto)`);
    return normalizedGemini;
  }

  // ===================================
  // SALUTO ADATTIVO
  // ===================================

  /**
   * Ottieni saluto e chiusura adattati a lingua, ora E giorni speciali
   * Supporta calendario liturgico completo
   */
  getAdaptiveGreeting(senderName, language = 'it') {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Domenica

    let greeting, closing;

    // Prima verifica saluto giorno speciale
    const specialGreeting = this._getSpecialDayGreeting(now, language);
    if (specialGreeting) {
      greeting = specialGreeting;
    } else {
      // Alternativa a saluto standard basato sull'ora
      const minutes = now.getMinutes();
      const isNightTime = (hour >= 0 && hour < 5) || (hour === 23 && minutes >= 30);

      if (language === 'it') {
        if (isNightTime) {
          greeting = `Gentile ${senderName}, `;
        } else if (day === 0) {
          greeting = 'Buona domenica.';
        } else if (hour >= 5 && hour < 13) {
          greeting = 'Buongiorno.';
        } else if (hour >= 13 && hour < 19) {
          greeting = 'Buon pomeriggio.';
        } else {
          greeting = 'Buonasera.';
        }
      } else if (language === 'en') {
        if (isNightTime) {
          greeting = 'Good day,';
        } else if (day === 0) {
          greeting = 'Happy Sunday,';
        } else if (hour >= 5 && hour < 12) {
          greeting = 'Good morning,';
        } else if (hour >= 12 && hour < 18) {
          greeting = 'Good afternoon,';
        } else {
          greeting = 'Good evening,';
        }
      } else if (language === 'es') {
        if (isNightTime) {
          greeting = `Estimado / a ${senderName}, `;
        } else if (day === 0) {
          greeting = 'Feliz domingo,';
        } else if (hour >= 5 && hour < 13) {
          greeting = 'Buenos días,';
        } else {
          greeting = 'Buenas tardes,';
        }
      } else if (language === 'pt') {
        if (isNightTime) {
          greeting = `Caro(a) ${senderName},`;
        } else if (day === 0) {
          greeting = 'Feliz domingo,';
        } else if (hour >= 5 && hour < 12) {
          greeting = 'Bom dia,';
        } else if (hour >= 12 && hour < 19) {
          greeting = 'Boa tarde,';
        } else {
          greeting = 'Boa noite,';
        }
      } else {
        // Altre lingue: saluto neutro
        greeting = 'Good day,';
      }
    }

    // Chiusura in base alla lingua
    if (language === 'it') {
      closing = 'Cordiali saluti,';
    } else if (language === 'en') {
      closing = 'Kind regards,';
    } else if (language === 'es') {
      closing = 'Cordiales saludos,';
    } else if (language === 'pt') {
      closing = 'Com os melhores cumprimentos,';
    } else {
      closing = 'Cordiali saluti,';
    }

    return { greeting, closing };
  }

  // ========================================================================
  // SALUTI GIORNI SPECIALI (Calendario Liturgico)
  // ========================================================================

  /**
   * Ottieni saluto speciale per feste liturgiche e festività
   */
  _getSpecialDayGreeting(dateObj, language = 'it') {
    const y = dateObj.getFullYear();
    const m = dateObj.getMonth() + 1;
    const d = dateObj.getDate();

    // === FESTIVITÀ FISSE ===

    // Capodanno
    if (m === 1 && d === 1) {
      if (language === 'en') return 'Happy New Year!';
      if (language === 'es') return '¡Feliz Año Nuevo!';
      if (language === 'pt') return 'Feliz Ano Novo!';
      return 'Buon Capodanno!';
    }

    // Epifania
    if (m === 1 && d === 6) {
      if (language === 'en') return 'Happy Epiphany!';
      if (language === 'es') return '¡Feliz Epifanía!';
      if (language === 'pt') return 'Feliz Epifania!';
      return 'Buona Epifania!';
    }

    // Assunzione (15 Agosto)
    if (m === 8 && d === 15) {
      if (language === 'en') return 'Happy Assumption Day!';
      if (language === 'es') return '¡Feliz día de la Asunción!';
      if (language === 'pt') return 'Feliz dia da Assunção!';
      return 'Buona festa!';
    }

    // Tutti i Santi (1 Novembre)
    if (m === 11 && d === 1) {
      if (language === 'en') return 'Happy All Saints Day!';
      if (language === 'es') return '¡Feliz día de Todos los Santos!';
      if (language === 'pt') return 'Feliz Dia de Todos os Santos!';
      return 'Buona festa di Ognissanti!';
    }

    // Immacolata Concezione (8 Dicembre)
    if (m === 12 && d === 8) {
      if (language === 'en') return 'Happy Feast of the Immaculate Conception!';
      if (language === 'es') return '¡Feliz día de la Inmaculada!';
      if (language === 'pt') return 'Feliz Imaculada Conceição!';
      return 'Buona Immacolata!';
    }

    // Natale (25 Dicembre)
    if (m === 12 && d === 25) {
      if (language === 'en') return 'Merry Christmas!';
      if (language === 'es') return '¡Feliz Navidad!';
      if (language === 'pt') return 'Feliz Natal!';
      return 'Buon Natale!';
    }

    // === FESTE MOBILI (basate sulla Pasqua) ===

    const easter = calculateEaster(y);

    // Ottava di Pasqua (Domenica di Pasqua + 7 giorni)
    const pasquaStart = easter;
    const pasquaEnd = this._addDays(easter, 7);
    if (this._isBetweenInclusive(dateObj, pasquaStart, pasquaEnd)) {
      if (language === 'en') return 'Happy Easter!';
      if (language === 'es') return '¡Feliz Pascua!';
      if (language === 'pt') return 'Feliz Páscoa!';
      return 'Buona Pasqua!';
    }

    // Pentecoste (Pasqua + 49 giorni)
    const pentecoste = this._addDays(easter, 49);
    if (this._isSameDate(dateObj, pentecoste)) {
      if (language === 'en') return 'Happy Pentecost!';
      if (language === 'es') return '¡Feliz Pentecostés!';
      if (language === 'pt') return 'Feliz Pentecostes!';
      return 'Buona Pentecoste!';
    }

    // Corpus Domini (Pasqua + 63 giorni in Italia)
    const corpusDominiIT = this._addDays(easter, 63);
    if (this._isSameDate(dateObj, corpusDominiIT)) {
      if (language === 'en') return 'Happy Corpus Christi!';
      if (language === 'es') return '¡Feliz Corpus Christi!';
      if (language === 'pt') return 'Feliz Corpus Christi!';
      return 'Buona festa!';
    }

    // Domenica della Sacra Famiglia
    const sacraFamiglia = this._getHolyFamilySunday(y);
    if (sacraFamiglia && this._isSameDate(dateObj, sacraFamiglia)) {
      if (language === 'en') return 'Happy Feast of the Holy Family!';
      if (language === 'es') return '¡Feliz Fiesta de la Sagrada Familia!';
      if (language === 'pt') return 'Feliz Festa da Sagrada Família!';
      return 'Buona Festa della Sacra Famiglia.';
    }

    return null; // Nessun giorno speciale
  }

  // ========================================================================
  // UTILITÀ DATE PER CALENDARIO LITURGICO
  // ========================================================================

  /**
   * Aggiunge giorni a una data
   */
  _addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  /**
   * Verifica se due date sono lo stesso giorno
   */
  _isSameDate(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate();
  }

  /**
   * Verifica se una data è compresa tra inizio e fine (inclusi)
   */
  _isBetweenInclusive(date, start, end) {
    const d = date.getTime();
    const s = start.getTime();
    const e = end.getTime();
    return d >= s && d <= e;
  }

  /**
   * Ottieni la data della Domenica della Sacra Famiglia
   * (Domenica tra 25 Dic e 1 Gen, o 30 Dic se nessuna domenica).
   * Nota: se il 25 dicembre cade di domenica, nel range 26-31 non c'è
   * alcuna domenica; in quel caso il fallback al 30 dicembre è intenzionale
   * (prassi liturgica del rito romano).
   */
  _getHolyFamilySunday(year) {
    for (let day = 26; day <= 31; day++) {
      const date = new Date(year, 11, day);
      if (date.getDay() === 0) {
        return date;
      }
    }
    return new Date(year, 11, 30);
  }

  // ========================================================================
  // CONTROLLO RAPIDO (Decisione risposta + Rilevamento lingua)
  // ========================================================================

  /**
   * Chiamata rapida Gemini per decidere se email richiede risposta E rilevare lingua
   * Supporta Rate Limiter + alternativa originale
   */
  shouldRespondToEmail(emailContent, emailSubject) {
    // Detection locale per lingua alternativa
    const detection = this.detectEmailLanguage(emailContent, emailSubject);
    const fallbackLang = detection.lang;
    const defaultResult = { shouldRespond: false, language: fallbackLang, reason: 'failsafe_local_detection' };

    // RATE LIMITER PATH
    if (this.useRateLimiter) {
      try {
        const result = this.rateLimiter.executeRequest(
          'quick_check',
          (modelName) => this._quickCheckWithModel(emailContent, emailSubject, modelName, detection),
          {
            estimatedTokens: 500,
            preferQuality: false  // Economia > qualità per controllo rapido
          }
        );

        if (result.success) {
          console.log(`✓ Controllo rapido via Rate Limiter(modello: ${result.modelUsed})`);
          return result.result;
        }
      } catch (error) {
        if (error.message && error.message.includes('QUOTA_EXHAUSTED')) {
          console.warn('⚠️ Rate Limiter in QUOTA_EXHAUSTED nel quick check, provo fallback diretto con retry');
          try {
            return this._withRetry(
              () => this._quickCheckWithModel(emailContent, emailSubject, this.modelName, detection),
              'Quick check fallback dopo QUOTA_EXHAUSTED'
            );
          } catch (directError) {
            console.error(`❌ Fallback diretto quick check fallito: ${directError.message}. Uso detection locale.`);
            return defaultResult;
          }
        }
        console.warn(`⚠️ Rate Limiter quick check fallito: ${error.message} `);
        // Prosegui con implementazione originale
      }
    }

    // IMPLEMENTAZIONE ORIGINALE (fallback o quando Rate Limiter disabilitato)
    try {
      console.log(`🔍 Gemini quick check per: ${emailSubject.substring(0, 40)}...`);
      return this._withRetry(
        () => this._quickCheckWithModel(emailContent, emailSubject, this.modelName, detection),
        'Quick check'
      );
    } catch (error) {
      console.warn(`⚠️ Quick check fallito: ${error.message}, uso detection locale`);
      return defaultResult;
    }
  }

  // ========================================================================
  // GENERAZIONE RISPOSTA PRINCIPALE
  // ========================================================================

  /**
   * Genera risposta AI con retry
   * Supporta Rate Limiter + fallback originale
   * 
   * @param {string} prompt - Prompt completo
   * @param {Object} options - Opzioni per strategia Cross-Key Quality First
   * @param {string} options.apiKey - Chiave API specifica (opzionale)
   * @param {string} options.modelName - Nome modello specifico (opzionale)
   * @param {boolean} options.skipRateLimit - Se true, bypassa Rate Limiter locale
   * @returns {Object} { success: boolean, text: string, error?: string, modelUsed?: string }
   */
  generateResponse(prompt, options = {}) {
    const targetKey = options.apiKey || this.primaryKey;
    const targetModel = options.modelName || this.modelName;
    const skipRateLimit = options.skipRateLimit || false;

    // ═══════════════════════════════════════════════════════════════════
    // RATE LIMITER PATH (solo se abilitato E non skippato)
    // ═══════════════════════════════════════════════════════════════════
    if (this.useRateLimiter && !skipRateLimit) {
      try {
        const estimatedTokens = this._estimateTokens(prompt);

        const result = this.rateLimiter.executeRequest(
          'generation',
          (modelName) => this._generateWithModel(prompt, modelName, targetKey),
          {
            estimatedTokens: estimatedTokens,
            preferQuality: true  // Qualità > economia per generation
          }
        );

        if (result.success) {
          console.log(`✓ Generato via Rate Limiter(modello: ${result.modelUsed}, token: ~${estimatedTokens})`);
          return { success: true, text: result.result, modelUsed: result.modelUsed };
        }
      } catch (error) {
        if (error.message && error.message.includes('QUOTA_EXHAUSTED')) {
          console.warn('⚠️ Quota primaria esaurita (intercettato da RateLimiter)');
          throw error; // Rilancia per gestione strategia nel Processor
        }
        console.warn(`⚠️ Rate Limiter generazione fallito: ${error.message} `);
        // Prosegui con implementazione originale
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // CHIAMATA DIRETTA (quando RateLimiter disabilitato O skippato per backup key)
    // ═══════════════════════════════════════════════════════════════════
    if (skipRateLimit) {
      console.log(`⏩ Chiamata diretta(bypass RateLimiter) con ${targetModel} `);
      const text = this._withRetry(
        () => this._generateWithModel(prompt, targetModel, targetKey),
        'Generazione diretta (Chiave di Riserva)'
      );
      return { success: !!text, text: text, modelUsed: targetModel };
    }

    // IMPLEMENTAZIONE ORIGINALE
    const result = this._withRetry(() => {
      console.log(`🤖 Chiamata Gemini API(prompt: ${prompt.length} caratteri)...`);

      const temperature = this.config.TEMPERATURE || 0.5;
      const maxTokens = this.config.MAX_OUTPUT_TOKENS || 6000;

      const url = this._buildGenerateUrl(targetModel);

      const response = this.fetchFn(`${url}?key=${encodeURIComponent(targetKey)}`, {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: temperature,
            maxOutputTokens: maxTokens
          }
        }),
        muteHttpExceptions: true
      });

      const responseCode = response.getResponseCode();

      if (responseCode === 429 || responseCode === 503) {
        throw new Error(`rate limit o servizio non disponibile: ${responseCode} `);
      }

      if (responseCode !== 200) {
        throw new Error(`Errore API Gemini: ${responseCode} - ${response.getContentText().substring(0, 200)}`);
      }

      const resJson = JSON.parse(response.getContentText());

      if (!resJson.candidates || !resJson.candidates[0] || !resJson.candidates[0].content) {
        console.error('❌ Risposta Gemini non valida: nessun candidato o contenuto');
        return null;
      }

      const candidate = resJson.candidates[0];

      if (candidate.finishReason === 'MAX_TOKENS') {
        console.warn('⚠️ Risposta troncata per limite MAX_TOKENS');
      }

      const parts = candidate.content?.parts || [];
      const generatedText = parts.map(p => p.text || '').join('').trim();

      if (!generatedText || generatedText.trim().length === 0) {
        console.error('❌ Gemini ha restituito risposta vuota');
        return null;
      }

      console.log(`✓ Risposta generata(${generatedText.length} caratteri)`);
      return generatedText;

    }, 'Generazione risposta');

    return {
      success: !!result,
      text: result,
      modelUsed: targetModel,
      error: result ? null : 'Risposta vuota o errore'
    };
  }

  // ========================================================================
  // METODI UTILITÀ
  // ===================================
  /**
   * Costruisce URL API per modello specifico
   */
  _buildGenerateUrl(modelName) {
    const safeModel = modelName || this.modelName;
    return `https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent`;
  }

  /**
   * Testa connessione API Gemini
   */
  testConnection() {
    const results = {
      connectionOk: false,
      canGenerate: false,
      errors: []
    };

    try {
      const testPrompt = 'Rispondi con una sola parola: OK';

      const url = this._buildGenerateUrl(this.modelName);
      const response = this.fetchFn(`${url}?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{ parts: [{ text: testPrompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 10
          }
        }),
        muteHttpExceptions: true
      });

      results.connectionOk = response.getResponseCode() === 200;

      if (results.connectionOk) {
        const result = JSON.parse(response.getContentText());
        if (result.candidates) {
          results.canGenerate = true;
        } else {
          results.errors.push('API non ha restituito candidati');
        }
      } else {
        results.errors.push(`API ha restituito status ${response.getResponseCode()} `);
      }

    } catch (error) {
      results.errors.push(`Errore connessione: ${error.message} `);
    }

    results.isHealthy = results.connectionOk && results.canGenerate;
    return results;
  }
}

// Funzione factory per compatibilità
function createGeminiService() {
  return new GeminiService();
}

// ====================================================================
// JSON PARSER TOLLERANTE PER GEMINI (Quick Check)
// ====================================================================

function parseGeminiJsonLenient(text) {
  if (!text) throw new Error('Risposta vuota');

  // 1) Estrazione markdown robusta: usa il primo blocco fenced se presente
  let cleaned = text;
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    cleaned = fencedMatch[1];
  }

  // 2) Estrazione oggetto JSON esterno
  const start = cleaned.indexOf('{');
  if (start === -1) {
    throw new Error('Nessun oggetto JSON trovato');
  }

  cleaned = cleaned.substring(start).trim();

  // 3) Recupero troncamenti: bilancia parentesi graffe mancanti
  cleaned = _tryBalanceJsonBraces(cleaned);

  // 4) Parsing diretto
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn('⚠️ Parsing JSON diretto fallito, tentativo di autocorrezione...');
  }

  // 5) Correzioni conservative: quote chiavi non quotate + trailing commas
  const safeFixed = _quoteUnquotedJsonKeysSafely(cleaned);
  const withoutTrailingCommas = safeFixed.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(withoutTrailingCommas);
  } catch (e) {
    // 6) Fallback estremo: estrazione campi minimi da JSON parziale/troncato
    const partial = _extractQuickCheckFieldsFromPartialJson(cleaned);
    if (partial) {
      console.warn('⚠️ JSON parziale recuperato con fallback regex');
      return partial;
    }
    throw new Error(`Impossibile parsare JSON da Gemini dopo autocorrezione: ${e.message}`);
  }
}

/**
 * Bilancia graffe mancanti in JSON troncato da MAX_TOKENS.
 * Aggiunge quote di chiusura e graffe di bilanciamento se necessario.
 */
function _tryBalanceJsonBraces(text) {
  if (!text) return text;

  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') depth = Math.max(depth - 1, 0);
  }

  let balanced = text;
  if (inString) balanced += '"';
  if (depth > 0) balanced += '}'.repeat(depth);
  return balanced;
}

/**
 * Estrae campi minimi del quick-check da JSON gravemente troncato.
 * Usa regex per recuperare reply_needed, language, category, topic, confidence.
 */
function _extractQuickCheckFieldsFromPartialJson(text) {
  if (!text) return null;

  const replyMatch = text.match(/"reply_needed"\s*:\s*(true|false|"true"|"false")/i);
  if (!replyMatch) return null;

  const languageMatch = text.match(/"language"\s*:\s*"([a-z]{2})"/i);
  const categoryMatch = text.match(/"category"\s*:\s*"(TECHNICAL|PASTORAL|DOCTRINAL|FORMAL|MIXED)"/i);
  const topicMatch = text.match(/"topic"\s*:\s*"([^"\n\r]{1,120})"/i);
  const confidenceMatch = text.match(/"confidence"\s*:\s*(0(?:\.\d+)?|1(?:\.0+)?)/i);

  return {
    reply_needed: String(replyMatch[1]).toLowerCase().includes('true'),
    language: languageMatch ? languageMatch[1].toLowerCase() : 'it',
    category: categoryMatch ? categoryMatch[1] : 'TECHNICAL',
    topic: topicMatch ? topicMatch[1].trim() : 'unknown',
    confidence: confidenceMatch ? Number(confidenceMatch[1]) : 0.5,
    reason: 'quick_check_partial_json_recovered'
  };
}

function _quoteUnquotedJsonKeysSafely(jsonText) {
  const segments = jsonText.split(/("(?:\\.|[^"\\])*")/g);

  for (let i = 0; i < segments.length; i += 2) {
    segments[i] = segments[i]
      .replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
  }

  return segments.join('');
}
