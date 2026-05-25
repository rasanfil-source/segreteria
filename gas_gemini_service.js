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

var GeminiService = class GeminiService {
  constructor(options = {}) {
    const sharedConfig = (typeof CONFIG !== 'undefined') ? CONFIG : {};
    this.config = Object.assign({}, sharedConfig, options.config || {});

    // Logger strutturato (DI opzionale)
    this.logger = options.logger || createLogger('GeminiService');
    this.logger.info('Inizializzazione GeminiService');

    // Dipendenze esterne iniettabili (testabilità)
    this.fetchFn = options.fetchFn || ((url, requestOptions) => UrlFetchApp.fetch(url, requestOptions));
    this.props = options.props || PropertiesService.getScriptProperties();

    // ====================================================================
    // CONFIGURAZIONE CHIAVI API (Gestione Ridondanza)
    // ====================================================================

    // Chiave Primaria
    // Priorità: 1. override DI 2. Script Properties 3. CONFIG
    const propKey = this.props.getProperty('GEMINI_API_KEY');
    this.primaryKey = options.primaryKey || ((propKey && propKey.length > 20) ? propKey : this.config.GEMINI_API_KEY);

    // Chiave di Riserva (opzionale)
    const propBackupKey = this.props.getProperty('GEMINI_API_KEY_BACKUP');
    this.backupKey = options.backupKey || ((propBackupKey && propBackupKey.length > 20) ? propBackupKey : null);
    this.isPrimaryExhausted = false;

    // Alias accessibile per i moduli che usano la proprietà apiKey
    this.apiKey = this.primaryKey;

    this.modelName = this.config.MODEL_NAME || 'gemini-3.5-flash';
    this.baseUrl = this._buildGenerateUrl(this.modelName);

    if (!this.primaryKey || this.primaryKey.length < 20 || /YOUR_[A-Z0-9_]+_HERE/.test(this.primaryKey)) {
      throw new Error('GEMINI_API_KEY non configurata correttamente (usa Script Properties, non placeholder)');
    }

    if (this.backupKey) {
      this.logger.info('Chiave di Riserva configurata');
    }

    // Nuovo tentativo di configurazione
    const backoffConfig = this.config.GEMINI_BACKOFF || {};
    this.maxRetries = Number(backoffConfig.maxRetries) > 0 ? Number(backoffConfig.maxRetries) : 2;
    this.retryDelay = Number(backoffConfig.retryDelayMs) > 0 ? Number(backoffConfig.retryDelayMs) : 4000;
    this.backoffFactor = Number(backoffConfig.factor) > 1 ? Number(backoffConfig.factor) : 2.5;
    this.maxBackoffMs = Number(backoffConfig.maxBackoffMs) > 0 ? Number(backoffConfig.maxBackoffMs) : 120000;
    this.retryJitterMs = Number(backoffConfig.jitterMs) >= 0 ? Number(backoffConfig.jitterMs) : 750;

    // Rate Limiter (abilitato da CONFIG.USE_RATE_LIMITER)
    this.useRateLimiter = this.config.USE_RATE_LIMITER === true;
    if (this.useRateLimiter) {
      try {
        if (options.rateLimiter) {
          this.rateLimiter = options.rateLimiter;
          this.logger.info('Rate Limiter iniettato via DI');
        } else if (typeof GeminiRateLimiter !== 'undefined') {
          this.rateLimiter = new GeminiRateLimiter();
          this.logger.info('Rate Limiter abilitato');
        } else {
          throw new Error('Classe GeminiRateLimiter non trovata nel bundle di script.');
        }
      } catch (e) {
        this.logger.warn('Rate Limiter non disponibile, procedo con chiamate dirette', { errore: e.message });
        this.useRateLimiter = false;
      }
    } else {
      this.logger.debug('Rate Limiter disabilitato via config');
    }

    this.logger.info('GeminiService inizializzato', { modello: this.modelName });
  }

  getModelNameForTask(taskType, fallbackName = null) {
    const strategy = this.config && this.config.MODEL_STRATEGY
      ? this.config.MODEL_STRATEGY
      : {};
    const models = this.config && this.config.GEMINI_MODELS
      ? this.config.GEMINI_MODELS
      : {};
    const candidates = Array.isArray(strategy[taskType]) && strategy[taskType].length > 0
      ? strategy[taskType]
      : (Array.isArray(strategy.fallback) ? strategy.fallback : []);

    for (let i = 0; i < candidates.length; i++) {
      const modelKey = candidates[i];
      if (models[modelKey] && models[modelKey].name) {
        return models[modelKey].name;
      }
    }

    return fallbackName || this.modelName || 'gemini-3.5-flash';
  }

  _normalizePromptPayload_(promptData) {
    if (promptData && typeof promptData === 'object') {
      const userPrompt = promptData.prompt != null ? String(promptData.prompt) : '';
      const systemInstruction = promptData.systemInstruction != null
        ? String(promptData.systemInstruction)
        : '';
      return {
        userPrompt: userPrompt,
        systemInstruction: systemInstruction,
        combinedText: [systemInstruction, userPrompt].filter(Boolean).join('\n\n')
      };
    }

    const userPrompt = promptData == null ? '' : String(promptData);
    return {
      userPrompt: userPrompt,
      systemInstruction: '',
      combinedText: userPrompt
    };
  }

  _estimateTokens(text, attachments = []) {
    const promptPayload = this._normalizePromptPayload_(text);
    return estimateTokenCount(promptPayload.combinedText, attachments);
  }

  /**
   * Genera risposta con modello specifico
   * @param {string|Object} prompt - Prompt completo oppure {systemInstruction, prompt}
   * @param {string} modelName - Nome modello API (es. 'gemini-3.5-flash')
   * @param {string} apiKeyOverride - Chiave API opzionale (per strategia multi-key)
   * @param {Array<Blob>} attachments - Array di Blob (immagini/PDF) da inviare
   * @returns {string|null} Testo generato
   */
  _generateWithModel(prompt, modelName, apiKeyOverride = null, attachments = []) {
    // Usa chiave override se fornita, altrimenti chiave primaria
    const activeKey = apiKeyOverride || this.primaryKey;
    const url = this._buildGenerateUrl(modelName);
    const maxTokens = this.config.MAX_OUTPUT_TOKENS ?? 6000;
    const promptPayload = this._normalizePromptPayload_(prompt);
    const userPromptText = promptPayload.userPrompt;
    const systemInstructionText = promptPayload.systemInstruction;

    console.log(`🤖 Chiamata ${modelName} (prompt utente: ${userPromptText.length} car., system: ${systemInstructionText.length} car.)...`);

    const requestParts = [];
    if (attachments && attachments.length > 0) {
      attachments.forEach((blob) => {
        try {
          if (blob && blob.inlineData && blob.inlineData.data) {
            requestParts.push(blob);
            return;
          }
          const mimeType = blob && typeof blob.getContentType === 'function' ? blob.getContentType() : '';
          if (!mimeType) {
            console.warn('Allegato ignorato: contentType mancante o non valido');
            return;
          }
          requestParts.push({
            inlineData: {
              mimeType: mimeType,
              data: Utilities.base64Encode(blob.getBytes())
            }
          });
        } catch (e) {
          console.warn(`Impossibile encodare l'allegato: ${e.message}`);
        }
      });
    }
    requestParts.push({ text: userPromptText });

    const payloadObj = {
      contents: [{ role: 'user', parts: requestParts }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.25,
        topK: 40,
        topP: 0.95
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    };

    if (systemInstructionText) {
      payloadObj.systemInstruction = {
        parts: [{ text: systemInstructionText }]
      };
    }

    let response;
    try {
      response = this.fetchFn(`${url}?key=${encodeURIComponent(activeKey)}`, {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify(payloadObj),
        muteHttpExceptions: true
      });
    } catch (error) {
      throw new Error(`Errore rete/timeout durante chiamata Gemini: ${error.message}`);
    }

    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    // Se la primaria risponde 429 e abbiamo una chiave di riserva,
    // segnaliamo esplicitamente al chiamante di passare subito al fallback
    // senza consumare riprovare inutili sulla stessa chiave.
    if (responseCode === 429 && activeKey === this.primaryKey && this.backupKey) {
      this.isPrimaryExhausted = true;
      throw new Error('PRIMARY_QUOTA_EXHAUSTED');
    }

    let apiErrorMsg = responseBody.substring(0, 200);
    try {
      const parsedObj = JSON.parse(responseBody);
      if (parsedObj && parsedObj.error && parsedObj.error.message) {
        apiErrorMsg = parsedObj.error.message;
      }
    } catch (e) {
      // Manteniamo fallback al body raw troncato.
    }

    // Separazione errori di rete/quota vs contenuto con semplici if
    if ([429, 500, 502, 503, 504].includes(responseCode)) {
      if (responseCode === 429) {
        throw new Error(`QUOTA_EXHAUSTED: Quota o rate limit superato (429): ${apiErrorMsg}`);
      }
      throw new Error(`Errore server temporaneo (${responseCode}): ${apiErrorMsg}`);
    }

    if (responseCode === 400) {
      const bodyLower = responseBody.toLowerCase();
      const isTokenLimit = bodyLower.includes('token') && (bodyLower.includes('limit') || bodyLower.includes('exceed'));
      if (isTokenLimit) {
        throw new Error('Errore contenuto: prompt supera il limite token del modello.');
      }
      throw new Error(`Errore API 400: ${apiErrorMsg}`);
    }

    if (responseCode === 403) {
      throw new Error(`Errore API 403: ${apiErrorMsg}`);
    }

    if (responseCode !== 200) {
      throw new Error(`Errore API ${responseCode}: ${apiErrorMsg}`);
    }

    let result;
    try {
      result = JSON.parse(responseBody);
    } catch (error) {
      throw new Error(`Risposta Gemini non JSON valida: ${error.message}`);
    }

    if (!result.candidates || !result.candidates[0]) {
      const blockReason = result.promptFeedback && result.promptFeedback.blockReason
        ? result.promptFeedback.blockReason
        : null;
      if (blockReason) {
        throw new Error(`Risposta bloccata da Gemini (promptFeedback): ${blockReason}`);
      }
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

    console.log(`✓ Generati ${generatedText.length} caratteri (da ${parts.length} parti)`);
    return generatedText;
  }

  _incrementGroundingCounterLocal_(count) {
    const increment = Math.max(0, parseInt(count || 0, 10) || 0);
    if (increment <= 0) return;
    const notes = (this.config && this.config.GEMINI_FREE_TIER_NOTES) ? this.config.GEMINI_FREE_TIER_NOTES : {};
    const limit = Number(notes.groundingSharedRpd) > 0 ? Number(notes.groundingSharedRpd) : 1500;
    const lock = LockService.getScriptLock();
    const gotLock = lock.tryLock(25000);
    if (!gotLock) {
      throw new Error('QUOTA_EXHAUSTED: lock Google Search Grounding non acquisito');
    }
    try {
      const todayPacific = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd');
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
    } finally {
      lock.releaseLock();
    }
  }

  _extractGroundingQueryCount_(result) {
    try {
      const metadata = result && result.candidates && result.candidates[0]
        ? result.candidates[0].groundingMetadata
        : null;
      const queries = metadata && Array.isArray(metadata.webSearchQueries)
        ? metadata.webSearchQueries.filter(Boolean)
        : [];
      const unique = {};
      queries.forEach(q => { unique[String(q)] = true; });
      return Object.keys(unique).length;
    } catch (e) {
      return 0;
    }
  }

  _hashString_(value) {
    const text = String(value || '');
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.computeDigest === 'function') {
      const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
      return bytes.map(function (b) {
        const n = b < 0 ? b + 256 : b;
        return ('0' + n.toString(16)).slice(-2);
      }).join('');
    }

    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash) + text.charCodeAt(i);
      hash = hash & 0xffffffff;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Controllo rapido con modello specifico
   * @param {string} emailContent - Contenuto email
   * @param {string} emailSubject - Oggetto email
   * @param {string} modelName - Nome modello API
   * @param {Object} [precomputedDetection] - Risultato detectEmailLanguage già calcolato (evita doppia chiamata)
   * @returns {Object} Risultato controllo rapido
   */
  _quickCheckWithModel(emailContent, emailSubject, modelName, precomputedDetection = null, intentContext = null) {
    const safeSubject = typeof emailSubject === 'string' ? emailSubject : (emailSubject == null ? '' : String(emailSubject));
    const safeContent = typeof emailContent === 'string' ? emailContent : (emailContent == null ? '' : String(emailContent));
    const detection = precomputedDetection || this.detectEmailLanguage(safeContent, safeSubject);
    const hasSubmissionContext = intentContext && (
      intentContext.intent === 'suspected_submission' ||
      intentContext.intent === 'suspected_submission_with_question' ||
      intentContext.intent === 'document_submission' ||
      intentContext.intent === 'document_submission_with_question'
    );
    const shouldClassifySponsorGuidance = !!(intentContext && intentContext.sponsorGuidanceCheck === true);
    const quickIntentGuardrail = hasSubmissionContext ? `
CONTESTO STRUTTURALE ALLEGATI:
- Il testo del mittente contiene segnali di consegna documentale ("in allegato", "allego", "le invio", ecc.).
- Eventuali parole provenienti da allegati/OCR come "padrino", "madrina", "cresima", "idoneità", "requisiti" NON devono essere interpretate come richiesta informativa.
- Se ci sono domande esplicite nel corpo email, rispondi a quelle; altrimenti classifica come consegna documentazione.
- Una consegna documentale da parte di un fedele/utente richiede risposta di cortesia: reply_needed deve essere TRUE, salvo spam/newsletter/autorisposta.
- Topic consigliato se non ci sono domande esplicite: "documentazione ricevuta".
- Non trasformare una consegna di certificato in una richiesta sui requisiti del padrino/madrina.
` : '';
    const sponsorGuidanceTask = shouldClassifySponsorGuidance ? `
7. Determina needs_sponsor_guidance (boolean):
   - TRUE solo se nella risposta conviene inserire le condizioni per il ruolo ecclesiale di padrino/madrina/godparent.
   - Considera equivalenti sacramentali: padrino/madrina (it/es), godparent/godfather/godmother o sponsor sacramentale (en), parrain/marraine (fr), padrinho/madrinha (pt), Pate/Patin/Firmpate/Firmpatin (de).
   - TRUE se il mittente vuole assumere quel ruolo sacramentale e non ha ancora la Cresima/Confirmation, oppure chiede esplicitamente requisiti, condizioni o idoneità per quel ruolo.
   - FALSE in tutti gli altri casi.
   - FALSE se il mittente sta consegnando documenti propri o del proprio padrino/madrina per ricevere un sacramento.
   - FALSE se "padrino" o "madrina" indica solo l'accompagnatore sacramentale del mittente.
   - In italiano, "sponsor" NON significa padrino/madrina: se indica pubblicità, finanziamento o magliette, rispondi FALSE.
   - "Testimone" di matrimonio NON è padrino/madrina e NON richiede Cresima: rispondi FALSE.
   - In inglese, "sponsor" vale solo se il contesto è chiaramente sacramentale (Confirmation/Baptism/Catholic godparent); altrimenti FALSE.
   - FALSE se il mittente chiede solo logistica, date, orari, luogo o conferma di ricezione documenti.
` : '';
    const sponsorGuidanceJsonField = shouldClassifySponsorGuidance
      ? `,
  "needs_sponsor_guidance": boolean`
      : '';
    const prompt = `Analizza questa email.
Rispondi ESCLUSIVAMENTE con un oggetto JSON valido e completo.
NON usare blocchi markdown e NON aggiungere testo extra prima o dopo il JSON.

Email:
Oggetto: ${safeSubject}
Testo: ${safeContent.substring(0, 800)}
${quickIntentGuardrail}

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
${sponsorGuidanceTask}

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
  "reason": "string"${sponsorGuidanceJsonField}
}`;

    const url = this._buildGenerateUrl(modelName);

    console.log(`🔍 Controllo rapido via ${modelName}...`);

    // Gestione con tentativo su chiave primaria e fallback singolo su chiave secondaria.
    let activeKey = this.primaryKey;
    let response;
    let responseCode;
    let fetchError = null;
    const requestPayload = {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.25,
          topK: 40,
          topP: 0.95,
          responseMimeType: 'application/json'
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
        ]
      }),
      muteHttpExceptions: true
    };
    const executeFetch = (apiKey) => this.fetchFn(`${url}?key=${encodeURIComponent(apiKey)}`, requestPayload);

    try {
      response = executeFetch(activeKey);
      responseCode = response.getResponseCode();
    } catch (e) {
      fetchError = e;
    }

    const shouldTryBackupKey = !!this.backupKey
      && activeKey !== this.backupKey
      && (
        fetchError !== null
        || (responseCode !== undefined && [401, 403, 429, 500, 502, 503, 504].includes(responseCode))
      );

    // Nota: gestiamo esplicitamente anche errori "hard" di UrlFetchApp (timeout/DNS)
    // perché non forniscono responseCode e altrimenti salterebbero il fallback cross-key.
    if (shouldTryBackupKey) {
      console.warn('⚠️ Chiave primaria non utilizzabile (errore rete/quota). Tentativo con chiave di riserva...');
      activeKey = this.backupKey;
      try {
        // Evita un burst immediato di due richieste quando l'errore della chiave primaria è temporaneo.
        Utilities.sleep(1500);
        response = executeFetch(activeKey);
        responseCode = response.getResponseCode();
        fetchError = null;
      } catch (backupError) {
        throw new Error(`Errore connessione API (anche con backup): ${backupError.message}`);
      }
    }

    if (fetchError) {
      throw new Error(`Errore connessione API: ${fetchError.message}`);
    }

    if (typeof responseCode === 'undefined') {
      throw new Error('Errore API: responseCode indefinito (possibile interruzione di rete pre-connessione)');
    }

    // responseCode è già valorizzato dal path primario o dal fallback backup key.

    if (responseCode === 429) {
      throw new Error('QUOTA_EXHAUSTED_ALL_KEYS: Limite quota raggiunto su tutte le chiavi disponibili (429)');
    }
    if ([500, 502, 503, 504].includes(responseCode)) {
      throw new Error(`Errore server Gemini(${responseCode})`);
    }

    if (responseCode !== 200) {
      throw new Error(`Errore API: ${responseCode}`);
    }

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

    let result;
    try {
      result = JSON.parse(response.getContentText());
    } catch (parseError) {
      console.warn(`⚠️ JSON non valido nel controllo rapido Gemini: ${parseError.message}`);
      return defaultResult;
    }

    if (!result || typeof result !== 'object' || !result.candidates || !result.candidates[0]) {
      console.error('❌ Nessun candidato nella risposta Controllo Rapido Gemini');
      return defaultResult;
    }

    const candidate = result.candidates[0];

    if (candidate.finishReason && ['SAFETY', 'RECITATION', 'OTHER', 'BLOCKLIST'].includes(candidate.finishReason)) {
      console.warn(`⚠️ Controllo rapido bloccato: ${candidate.finishReason}`);
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
      console.error('❌ Risposta non valida: testo vuoto');
      return defaultResult;
    }

    // Parsing JSON con gestione errori
    let data;
    try {
      data = parseGeminiJsonLenient(textResponse);
    } catch (parseError) {
      console.warn(`⚠️ parseGeminiJsonLenient fallito: ${parseError.message}`);
      return defaultResult;
    }
    if (!data || typeof data !== 'object') {
      console.warn('⚠️ Decisione quick check non è un oggetto JSON valido');
      return defaultResult;
    }

    // Normalizzazione sicura booleano
    const replyNeeded = data.reply_needed;
    const normalizedReplyNeeded = (typeof replyNeeded === 'string')
      ? replyNeeded.toLowerCase()
      : replyNeeded;
    // Fail-open: rispondi in assenza del flag o in caso di formato inatteso.
    // L'unico caso "non rispondere" è un false esplicito.
    const shouldRespond = !(normalizedReplyNeeded === false || normalizedReplyNeeded === 'false');

    const isDocumentSubmissionIntent = intentContext && (
      intentContext.intent === 'suspected_submission' ||
      intentContext.intent === 'suspected_submission_with_question' ||
      intentContext.intent === 'document_submission' ||
      intentContext.intent === 'document_submission_with_question'
    );

    const finalShouldRespond = isDocumentSubmissionIntent ? true : shouldRespond;

    const safeDimensions = (data.dimensions && typeof data.dimensions === 'object')
      ? data.dimensions
      : null;
    const safeConfidence = Number.isFinite(data.confidence) ? data.confidence : 0.8;
    const rawSponsorGuidance = data.needs_sponsor_guidance;
    const normalizedSponsorGuidance = (typeof rawSponsorGuidance === 'string')
      ? rawSponsorGuidance.trim().toLowerCase()
      : rawSponsorGuidance;
    const needsSponsorGuidance = (normalizedSponsorGuidance === true || normalizedSponsorGuidance === 'true')
      ? true
      : ((normalizedSponsorGuidance === false || normalizedSponsorGuidance === 'false') ? false : undefined);

    return {
      // Fail-open deliberato: shouldRespond=false solo con rifiuto esplicito.
      shouldRespond: finalShouldRespond,
      language: this._resolveLanguage(data.language, detection.lang, detection.safetyGrade),
      reason: data.reason || 'quick_check',
      classification: {
        category: data.category || 'TECHNICAL',
        topic: data.topic || '',
        confidence: safeConfidence,
        dimensions: safeDimensions
      },
      needs_sponsor_guidance: needsSponsorGuidance
    };
  }


  // ========================================================================
  // TENTATIVO DEL WRAPPER
  // ========================================================================

  /**
   * Esegue una funzione con retry temporizzati
   * Usa ritardi crescenti tra i tentativi
   */
  _withRetry(fn, context = 'Chiamata API', maxRetries = null) {
    const attempts = Number(maxRetries) > 0
      ? Number(maxRetries)
      : (Number(this.maxRetries) > 0 ? Number(this.maxRetries) : 2);
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const result = fn();
        // Le risposte vuote sono considerate non transienti.
        // Le segnaliamo come errore non-retryable per evitare spreco quota API.
        if (result === undefined || result === null || result === '') {
          const emptyError = new Error(`Risposta vuota o undefined da ${context}`);
          emptyError._nonRetryable = true;
          throw emptyError;
        }
        return result;
      } catch (error) {
        lastError = error;

        // Manteniamo _classifyError come logica di classificazione interna centralizzata
        // e resta allineato al contratto condiviso retryable/type.
        // Nota: NON replichiamo qui una classificazione inline, per evitare drift
        // con la policy errori del servizio e falsi positivi nei retry.
        // NON usare classifyError globale: potrebbe non esistere in alcuni runtime GAS modulari.
        if (this._isKeySwitchSignal_(error)) {
          throw error;
        }

        const classified = this._classifyError(error);
        // Verifica del flag _nonRetryable per le risposte vuote.
        const isRetryable = classified.retryable && !(error && error._nonRetryable);

        if (!isRetryable) {
          // Errore fatale: interrompere immediatamente senza consumare altri tentativi
          throw error;
        }

        if (attempt < attempts - 1) {
          const retryDelay = Number(this.retryDelay) > 0 ? Number(this.retryDelay) : 4000;
          const backoffFactor = Number(this.backoffFactor) > 1 ? Number(this.backoffFactor) : 2.5;
          const maxBackoffMs = Number(this.maxBackoffMs) > 0 ? Number(this.maxBackoffMs) : 120000;
          const jitterMax = Number(this.retryJitterMs) > 0 ? Number(this.retryJitterMs) : 0;
          const jitter = jitterMax > 0 ? Math.floor(Math.random() * jitterMax) : 0;
          const waitTime = Math.min(
            retryDelay * Math.pow(backoffFactor, attempt),
            maxBackoffMs
          ) + jitter;
          const safeErrorMsg = this._getErrorMessage_(error);
          console.warn(`⚠️ ${context} fallito (tentativo ${attempt + 1}/${attempts}): [${classified.type}] ${safeErrorMsg} - Attendendo ${waitTime}ms...`);
          Utilities.sleep(waitTime);
        }
      }
    }

    throw lastError || new Error(`Fallimento definitivo dopo ${attempts} tentativi`);
  }

  _getErrorMessage_(error) {
    if (error == null) return '';
    if (typeof error === 'string') return error;
    if (error.message != null) return String(error.message);
    try {
      return JSON.stringify(error) || '';
    } catch (jsonError) {
      return String(error);
    }
  }

  _isKeySwitchSignal_(error) {
    const msg = this._getErrorMessage_(error).toLowerCase();
    return msg.includes('primary_quota_exhausted') || msg.includes('quota_exhausted_all_keys');
  }

  /**
   * Categorizza l'errore internamente al GeminiService per la logica di retry.
   * @param {Error} error 
   * @returns {{type: string, retryable: boolean}}
   */
  _classifyError(error) {
    const rawMessage = this._getErrorMessage_(error);
    const msg = rawMessage.toLowerCase();

    // Segnali interni di esaurimento quota: non ritentare sulla stessa chiave,
    // lascia che il chiamante passi subito alla strategia/chiave successiva.
    if (msg.includes('primary_quota_exhausted') || msg.includes('quota_exhausted_all_keys')) {
      return { type: 'QUOTA_EXHAUSTED', retryable: false };
    }

    if (typeof classifyError === 'function' && typeof ErrorTypes !== 'undefined') {
      const central = classifyError(error);
      if (central.type === ErrorTypes.QUOTA_EXCEEDED || central.type === ErrorTypes.NETWORK ||
          central.type === ErrorTypes.TIMEOUT || central.type === ErrorTypes.CACHE_EXPIRED) {
        return { type: 'RETRYABLE', retryable: true };
      }
      return { type: 'FATAL', retryable: false };
    }
    const RETRYABLE_ERRORS = ['quota', 'timeout', 'deadline', 'econnreset'];
    const FATAL_ERRORS = ['unauthorized', 'forbidden', 'permission denied', 'unauthenticated'];

    // 401/403 sono tipicamente problemi di credenziali o permessi: ritentare non li risolve.
    // PRIMARY_QUOTA_EXHAUSTED deve saltare i retry locali per passare subito al backup.
    for (const kw of FATAL_ERRORS) {
      if (msg.includes(kw)) {
        return { type: 'FATAL', retryable: false };
      }
    }

    if (/\b(401|403)\b/.test(msg)) {
      return { type: 'FATAL', retryable: false };
    }

    let retryable = false;
    for (const kw of RETRYABLE_ERRORS) {
      if (msg.includes(kw)) {
        retryable = true;
        break;
      }
    }
    if (!retryable && /\b(429|500|502|503|504)\b/.test(msg)) {
      retryable = true;
    }
    return { type: retryable ? 'RETRYABLE' : 'FATAL', retryable: retryable };
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
    let safeContent = typeof emailContent === 'string' ? emailContent : (emailContent == null ? '' : String(emailContent));

    // PROTEZIONE: limite ampio prima delle RegEx per evitare CPU Timeout se
    // un utente invia una mail infinita, ma rimuoviamo le citazioni prima del
    // truncamento finale del segnale lingua per non far consumare il budget dal thread storico.
    safeContent = safeContent.substring(0, 60000);

    // Rimuove le citazioni per evitare che il testo quotato (es. precedente thread in italiano) alteri il punteggio
    safeContent = safeContent.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
    safeContent = safeContent.replace(/<div\s+class=["']gmail_quote["'][^>]*>[\s\S]*$/gi, '');
    // Fallback per citazioni testuali se l'HTML è già stato strippato o è incompleto
    safeContent = safeContent.replace(/(?:^|\n)>{1,3}[^\n]*/g, '');
    safeContent = safeContent.replace(/(?:^|\n)(On |Il giorno )[^\n]*(wrote|ha scritto):[\s\S]*/gi, '');
    safeContent = safeContent.replace(/(?:^|\n)-{3,}.*(Original Message|Messaggio originale).*[\s\S]*/gi, '');
    safeContent = safeContent.substring(0, 15000);

    // Trunca a 3000 char per evitare CPU Timeout sull'elaborazione lingua
    const text = ` ${safeSubject} ${safeContent} `.substring(0, 3000).toLowerCase();
    const originalText = ` ${safeSubject} ${safeContent} `.substring(0, 3000);

    // 1. Rilevamento potenziato Italiano istituzionale
    // Previene errori su richieste formali. Trasformato in boost per evitare falsi positivi su nomi propri.
    const snippet = text.substring(0, 800);
    let itIstituzionaleScore = 0;
    
    // Rimosse parole come "parrocchia", "sant'eugenio", "segreteria" e "don raimondo" 
    // perché usate universalmente dagli stranieri per riferirsi a voi.
    const itIstituzionale = [
      'ufficio parrocchiale', 'certificato di battesimo', 'nulla osta', 
      'la celebrazione', 'il sacramento', 'l\'eucaristia', 'la comunione', 
      'la cresima', 'il matrimonio', 'il funerale', 'la benedizione'
    ];
    
    if (itIstituzionale.some(k => snippet.includes(k))) {
      itIstituzionaleScore = 15; // Forte boost, ma superabile da un testo interamente in inglese
      console.log(`   Trovati termini istituzionali italiani (+15 punti IT)`);
    }

    // 2. Score basato su indicatori frequenti (fallback)
    const indicators = {
      'it': ['buon', 'grazie', 'messaggio', 'cortesi', 'saluti', 'gentile', 'lei', 'perché', 'come', 'quando', 'vorrei'],
      'en': ['thank', 'regards', 'dear', 'parish', 'mass', 'church', 'would', 'could'],
      'es': ['gracias', 'saludos', 'estimado', 'parroquia', 'misa', 'iglesia', 'querría'],
      'fr': ['merci', 'cordialement', 'cher', 'paroisse', 'messe', 'église', 'voudrais'],
      'de': ['danke', 'grüße', 'liebe', 'pfarrei', 'messe', 'kirche', 'möchte'],
      'pt': ['obrigado', 'obrigada', 'cumprimentos', 'paróquia', 'missa', 'igreja', 'orçamento']
    };

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
      if (text.includes('ã') || text.includes('õ')) {
        portugueseCharScore += 2;
        console.log('   Trovato carattere portoghese forte (ã, õ)');
      } else {
        portugueseCharScore += 0.5;
        console.log('   Trovato carattere ambiguo (ç): boost portoghese ridotto');
      }
    }

    // Parole chiave per rilevamento
    const englishUniqueKeywords = [
      'kind regards', 'best regards', 'sincerely', 'yours truly',
      'looking forward', 'i would like', 'we would like',
      'let me know', 'get back to', 'reach out',
      'however', 'therefore', 'furthermore', 'moreover',
      'hello', 'hi', 'dear', 'good morning', 'good afternoon', 'good evening',
      'need', 'want', 'information', 'help'
    ];

    const englishStandardKeywords = [
      // Evitiamo stopword troppo corte/ambigue ("in", "no", "me", "to", ...)
      // perché in italiano e nelle firme email causano falsi positivi EN.
      'and', 'but',
      'will', 'shall', 'must',
      'have', 'has', 'had', 'does', 'did',
      'what', 'when', 'where', 'how', 'why', 'which', 'who',
      'from', 'for', 'with',
      'are', 'were', 'this', 'that', 'your', 'not'
    ];

    const spanishKeywords = [
      'he ido', 'había', 'hay', 'ido', 'sido',
      'hacer', 'haber', 'pseudo-podere', 'estar', 'estoy', 'están',
      'por qué', 'porque', 'cuándo', 'cómo', 'dónde', 'qué tal',
      'por favor', 'muchas gracias', 'buenos días', 'buenas tardes',
      'misa', 'misas', 'iglesia', 'parroquia',
      'hola', 'gracias', 'necesito', 'quiero',
      'querido', 'estimado', 'saludos',
      'unos', 'unas',
      'del', 'con el', 'en el', 'es',
      'ustedes', 'nosotros', 'tambien', 'también'
    ];

    const portugueseUniqueKeywords = [
      'olá', 'obrigado', 'obrigada', 'agradecemos', 'agradeço',
      'por favor', 'bom dia', 'boa tarde', 'boa noite',
      'missa', 'missas', 'igreja', 'paróquia',
      'atenciosamente', 'cumprimentos', 'atualização'
    ];

    const portugueseStandardKeywords = [
      'por', 'para', 'com', 'não', 'uma', 'seu', 'sua',
      'dos', 'das', 'ao', 'aos'
    ];

    const italianKeywords = [
      'sono', 'siamo', 'stato', 'stata', 'ho', 'hai', 'abbiamo',
      'fare', 'avere', 'essere', 'potere', 'volere',
      'perché', 'perchè', 'quando', 'come', 'dove', 'cosa',
      'per favore', 'per piacere', 'molte grazie', 'buongiorno',
      'buonasera', 'gentile', 'egregio', 'cordiali saluti',
      'si invia', 'in allegato', 'ufficio di segreteria', 'vicariato di roma',
      'non', 'il', 'di', 'da',
      'nel', 'della', 'degli', 'delle'
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
          // NOTA: niente \b perché in JS è ASCII-only e fallisce con accenti (es. "olá", "perché").
          // Usiamo invece un confine Unicode esplicito senza lookbehind per massima compatibilità runtime.
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

    const ptUniqueScore = countMatches(portugueseUniqueKeywords, text, 2);
    const ptStandardScoreRaw = countMatches(portugueseStandardKeywords, text, 1);
    const portugueseStrongMarkers = /(?:^|[^\p{L}\p{N}_])(não|voc[êe]s?|estou|obrigad[oa]|orçamento|viatura|portagens|agradecemos|cumprimentos|paróquia|igreja|atenciosamente)(?=$|[^\p{L}\p{N}_])/iu;
    const hasPortugueseStrongSignal =
      ptUniqueScore >= 2 ||
      portugueseCharScore >= 2 ||
      portugueseStrongMarkers.test(text);
    // Guardrail anti-falso-positivo: senza marker forti, le sole stopword PT
    // ("por/para/com/uma/...") non devono dominare testi italiani.
    const ptStandardScore = hasPortugueseStrongSignal
      ? ptStandardScoreRaw
      : Math.min(ptStandardScoreRaw, 1);

    const scores = {
      'en': englishScore,
      'es': spanishLexicalScore + Math.min(spanishCharScore, 2),
      'it': countMatches(italianKeywords, text, 1) + itIstituzionaleScore,
      'pt': ptUniqueScore + ptStandardScore + Math.min(portugueseCharScore, 2),
      // Supporto markers per lingue secondarie.
      'fr': countMatches(indicators.fr, text, 1.5),
      'de': countMatches(indicators.de, text, 1.5)
    };

    // Disambiguazione ES/PT su testi brevi: evita confusione quando i punteggi sono quasi pari.
    const compactText = text.replace(/\s+/g, ' ').trim();
    if (compactText.length <= 150 && Math.abs(scores.es - scores.pt) <= 1.5 && Math.max(scores.es, scores.pt) >= 1) {
      // Marcatori forti Portuguese: não, você, obrigado, você, vocês, estou, hoje, amanhã, bom, bem
      const ptStrongMarkers = /(?:^|[^\p{L}\p{N}_])(n[ãa]o|voc[êe]s?|estou|obrigad[oa]|hoje|amanh[ãa]|bom|bem|muito|atenciosamente)(?=$|[^\p{L}\p{N}_])/iu;
      // Marcatori forti Spanish: usted, ustedes, gracias, presupuesto, coche, iglesia, parroquia, estimado, querido, hoy, mañana, bien
      const esStrongMarkers = /(?:^|[^\p{L}\p{N}_])(usted|ustedes|gracias|hoy|ma[ñn]ana|iglesia|parroquia|estimado|querido|bien|mucho|atentamente)(?=$|[^\p{L}\p{N}_])/iu;
      
      if (ptStrongMarkers.test(compactText) && !esStrongMarkers.test(compactText)) {
        scores.pt += 1.5;
      } else if (esStrongMarkers.test(compactText) && !ptStrongMarkers.test(compactText)) {
        scores.es += 1.5;
      }
    }

    console.log(`   Punteggi lingua: IT = ${scores['it']}, EN = ${scores['en']}, ES = ${scores['es']}, PT = ${scores['pt']}, FR = ${scores['fr']}, DE = ${scores['de']}`);

    // Determina lingua rilevata e punteggio massimo
    let detectedLang = 'it';
    let maxScore = scores.it || 0;
    const langPriority = ['it', 'en', 'pt', 'es', 'fr', 'de'];
    for (const lang of langPriority) {
      if (scores[lang] > maxScore) {
        maxScore = scores[lang];
        detectedLang = lang;
      }
    }

    // Default: IT se punteggi nulli o trascurabili
    if (maxScore < 2) {
      console.log('   ✓ Default: ITALIANO (punteggio basso o nullo)');
      return { lang: 'it', confidence: maxScore, safetyGrade: 1 };
    }

    const safetyGrade = this._computeSafetyGrade(detectedLang, maxScore, scores);
    
    // Se il grado di sicurezza è basso (< 3), tentiamo un rilevamento AI come fallback.
    // Questo è cruciale per messaggi molto brevi o ambigui in qualsiasi lingua.
    if (safetyGrade < 3 && typeof this.detectLanguageAI === 'function') {
      try {
        const aiLang = this.detectLanguageAI(text);
        if (aiLang && aiLang !== detectedLang) {
          console.log(`   🔄 Override AI: ${detectedLang.toUpperCase()} → ${aiLang.toUpperCase()}`);
          return { lang: aiLang, confidence: maxScore, safetyGrade: 4, method: 'ai_fallback' };
        }
      } catch (e) {
        console.warn(`   ⚠️ Fallback AI fallito: ${e.message}`);
      }
    }

    console.log(`   ✓ Rilevato: ${detectedLang.toUpperCase()} (punteggio: ${maxScore}, grado sicurezza: ${safetyGrade})`);

    return {
      lang: detectedLang,
      confidence: maxScore,
      safetyGrade: safetyGrade,
      method: 'local_regex'
    };
  }

  /**
   * Rilevamento lingua tramite AI (fallback).
   */
  detectLanguageAI(text) {
    const prompt = `Analizza questo testo e identifica la lingua prevalente.
Rispondi ESCLUSIVAMENTE con il codice ISO 639-1 (es. it, en, es, fr, de, pt).
NON aggiungere altro testo.

Testo:
"${text.substring(0, 1000)}"`;

    const languageModelName = this.getModelNameForTask('language', 'gemini-3.1-flash-lite');

    try {
      const response = this._withRetry(
        () => this._generateWithModel(prompt, languageModelName),
        'Language detection AI',
        1 // Solo 1 retry per non bloccare la pipeline
      );
      
      const cleaned = (response || '').replace(/`/g, '').trim().toLowerCase().substring(0, 2);
      return /^[a-z]{2}$/.test(cleaned) ? cleaned : null;
    } catch (e) {
      return null;
    }
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

    // 2. Lingue non coperte dal rilevamento locale: in quel caso ci fidiamo di Gemini.
    const supportedLocally = ['it', 'en', 'es', 'pt', 'fr', 'de'];
    if (!supportedLocally.includes(normalizedGemini)) {
      console.log(`   🌍 Lingua: ${normalizedGemini.toUpperCase()} (Gemini ha rilevato lingua non supportata localmente)`);
      return normalizedGemini;
    }

    // 3. Lingua principale: Se il locale è MOLTO sicuro (grado >= 4), 
    // prevale sulla detection API (che a volte si confonde con nomi propri o citazioni).
    if (localSafetyGrade >= 4) {
      console.log(`   🌍 Lingua: ${normalizedLocal.toUpperCase()} (Locale vince per grado sicurezza ${localSafetyGrade})`);
      return normalizedLocal;
    }

    // 4. Default: Se c'è incertezza, ci fidiamo del rilevamento del modello Large
    console.log(`   🌍 Lingua: ${normalizedGemini.toUpperCase()} (Gemini prioritario su locale incerto)`);
    return normalizedGemini;
  }

  // ===================================
  // SALUTO ADATTIVO
  // ===================================

  /**
 * Ottieni un saluto e chiusura adattati alla lingua, ora e giorni speciali
 * Supporta calendario liturgico completo
 */
  getAdaptiveGreeting(senderName, language = 'it') {
    const now = new Date();
    let hour = now.getHours();
    let day = now.getDay(); // 0 = Domenica
    let minutes = now.getMinutes();

    // Coerenza business: saluti basati sempre sull'orario italiano,
    // anche se il fuso del progetto è stato modificato per errore.
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      try {
        hour = parseInt(Utilities.formatDate(now, 'Europe/Rome', 'H'), 10);
        minutes = parseInt(Utilities.formatDate(now, 'Europe/Rome', 'm'), 10);
        const isoDay = parseInt(Utilities.formatDate(now, 'Europe/Rome', 'u'), 10);
        if (!isNaN(isoDay)) day = isoDay % 7;
      } catch (e) {
        // fallback locale: manteniamo comportamento precedente se Utilities non è disponibile
      }
    }

    let greeting, closing;

    // Prima verifica saluto giorno speciale
    const specialGreeting = this._getSpecialDayGreeting(now, language);
    if (specialGreeting) {
      greeting = specialGreeting;
    } else {
      // Alternativa un saluto standard basato sull'ora
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
        } else if (hour >= 13 && hour < 19) {
          greeting = 'Buenas tardes,';
        } else {
          greeting = 'Buenas tardes,';
        }
      } else if (language === 'pt') {
        if (isNightTime) {
          greeting = `Prezado(a) ${senderName},`;
        } else if (day === 0) {
          greeting = 'Feliz domingo,';
        } else if (hour >= 5 && hour < 12) {
          greeting = 'Bom dia,';
        } else if (hour >= 12 && hour < 19) {
          greeting = 'Boa tarde,';
        } else {
          greeting = 'Boa noite,';
        }
      } else if (language === 'fr') {
        if (isNightTime) {
          greeting = 'Bonjour,';
        } else if (day === 0) {
          greeting = 'Bon dimanche,';
        } else if (hour >= 5 && hour < 18) {
          greeting = 'Bonjour,';
        } else {
          greeting = 'Bonsoir,';
        }
      } else if (language === 'de') {
        if (isNightTime) {
          greeting = 'Guten Tag,';
        } else if (day === 0) {
          greeting = 'Einen schönen Sonntag,';
        } else if (hour >= 5 && hour < 18) {
          greeting = 'Guten Tag,';
        } else {
          greeting = 'Guten Abend,';
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
    } else if (language === 'fr') {
      closing = 'Cordialement,';
    } else if (language === 'de') {
      closing = 'Freundliche Grüße,';
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
    const parts = this._getRomeDateParts_(dateObj);
    const y = parts.year;
    const m = parts.month;
    const d = parts.day;

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

    if (typeof calculateEaster !== 'function') return null;
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
    return new Date(new Date(date).getTime() + (days * 24 * 60 * 60 * 1000));
  }

  _getRomeDateParts_(dateObj) {
    const safeDate = dateObj instanceof Date ? dateObj : new Date(dateObj);
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      try {
        const formatted = Utilities.formatDate(safeDate, 'Europe/Rome', 'yyyy-MM-dd');
        const match = String(formatted || '').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
        if (match) {
          return {
            year: parseInt(match[1], 10),
            month: parseInt(match[2], 10),
            day: parseInt(match[3], 10)
          };
        }

        const year = parseInt(Utilities.formatDate(safeDate, 'Europe/Rome', 'yyyy'), 10);
        const month = parseInt(Utilities.formatDate(safeDate, 'Europe/Rome', 'M'), 10);
        const day = parseInt(Utilities.formatDate(safeDate, 'Europe/Rome', 'd'), 10);
        if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return { year: year, month: month, day: day };
        }
      } catch (e) {
        // locale di riserva sotto.
      }
    }
    return {
      year: safeDate.getFullYear(),
      month: safeDate.getMonth() + 1,
      day: safeDate.getDate()
    };
  }

  _romeDayOrdinal_(dateObj) {
    const parts = this._getRomeDateParts_(dateObj);
    return Date.UTC(parts.year, parts.month - 1, parts.day);
  }

  _getRomeWeekday_(dateObj) {
    const safeDate = dateObj instanceof Date ? dateObj : new Date(dateObj);
    if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
      try {
        const isoDay = parseInt(Utilities.formatDate(safeDate, 'Europe/Rome', 'u'), 10);
        if (!isNaN(isoDay) && isoDay >= 1 && isoDay <= 7) return isoDay % 7;
      } catch (e) {
        // locale di riserva sotto.
      }
    }
    return safeDate.getDay();
  }

  /**
   * Verifica se due date sono lo stesso giorno
   */
  _isSameDate(date1, date2) {
    return this._romeDayOrdinal_(date1) === this._romeDayOrdinal_(date2);
  }

  /**
   * Verifica se una data è compresa tra inizio e fine (inclusi)
   */
  _isBetweenInclusive(date, start, end) {
    const d = this._romeDayOrdinal_(date);
    const s = this._romeDayOrdinal_(start);
    const e = this._romeDayOrdinal_(end);
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
    // Il range 26-31 è intenzionale: cerchiamo la domenica *dopo* Natale.
    // Se il 25 è domenica, non esiste altra domenica nell'ottava e il
    // calendario romano prevede il fallback al 30 dicembre.
    for (let day = 26; day <= 31; day++) {
      const date = new Date(Date.UTC(year, 11, day, 12, 0, 0));
      if (this._getRomeWeekday_(date) === 0) {
        return date;
      }
    }
    return new Date(Date.UTC(year, 11, 30, 12, 0, 0));
  }

  // ========================================================================
  // CONTROLLO RAPIDO (Decisione risposta + Rilevamento lingua)
  // ========================================================================

  /**
   * Chiamata rapida Gemini per decidere se email richiede risposta E rilevare lingua
   * Supporta Rate Limiter + alternativa originale
   */
  shouldRespondToEmail(emailContent, emailSubject, precomputedDetection = null, intentContext = null) {
    const detection = precomputedDetection || this.detectEmailLanguage(emailContent, emailSubject);

    // PERCORSO LIMITATORE DI VELOCITÀ
    if (this.useRateLimiter) {
      try {
        const result = this.rateLimiter.executeRequest(
          'quick_check',
          (modelName) => this._quickCheckWithModel(emailContent, emailSubject, modelName, detection, intentContext),
          {
            estimatedTokens: 500
          }
        );

        const normalized = this._normalizeExecuteRequestResult_(result);
        if (normalized.success) {
          console.log(`🔍 Controllo rapido via Rate Limiter(modello: ${result.modelUsed})`);
          return normalized.result;
        }

        const rejectReason = (result && result.reason) ? result.reason : 'Rate limit interno';
        throw new Error(`Rate Limiter ha rifiutato il quick check: ${rejectReason}`);
      } catch (error) {
        if (error.message && error.message.includes('QUOTA_EXHAUSTED')) {
          // L'eccezione non viene gestita con un fallback diretto per allineamento a generateResponse.
          // Il fallback diretto bypasserebbe il quota tracking del RateLimiter,
          // causando consumo API non tracciato. Il Processor gestirà l'eccezione
          // come skip del thread (comportamento coerente e sicuro).
          console.warn('⚠️ Quick check: QUOTA_EXHAUSTED — rilancio per gestione corretta nel Processor.');
          throw error;
        }
        // NON bypassare il RateLimiter su errori transienti/non-quota:
        // executeRequest include già retry+backoff e il fallback diretto
        // causerebbe consumo API non tracciato.
        const msg = (error && error.message) ? error.message : String(error);
        if (msg.includes('Errore API: 404') || msg.includes('404')) {
          console.warn('⚠️ Quick check: modello Gemini non trovato (404). Verifica CONFIG.GEMINI_MODELS e il modello quick_check effettivamente disponibile per la tua API key/progetto.');
        }
        console.warn(`⚠️ Rate Limiter quick check fallito: ${msg}. Interruzione per evitare bypass quota.`);
        throw error;
      }
    }

    // IMPLEMENTAZIONE ORIGINALE (fallback o quando Rate Limiter disabilitato)
    try {
      const safeSubject = typeof emailSubject === "string" ? emailSubject : (emailSubject == null ? "" : String(emailSubject));
      const quickModelName = this.getModelNameForTask('quick_check', 'gemini-3.1-flash-lite');
      console.log(`🔍 Gemini quick check per: ${safeSubject.substring(0, 40)}...`);
      return this._withRetry(
        () => this._quickCheckWithModel(emailContent, safeSubject, quickModelName, detection, intentContext),
        'Quick check'
      );
    } catch (error) {
      console.warn(`⚠️ Quick check fallito: ${error.message}. Interruzione per evitare skip silente.`);
      throw error;
    }
  }

  _normalizeExecuteRequestResult_(result) {
    if (!result || typeof result !== 'object') {
      throw new Error('executeRequest ha restituito un risultato non valido');
    }
    return {
      success: result.success === true,
      result: (typeof result.result === 'undefined') ? null : result.result,
      modelUsed: result.modelUsed || 'unknown'
    };
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
   * @param {Array<Blob>} options.attachments - Array di Blob (immagini/PDF)
   * @returns {Object} { success: boolean, text: string, error?: string, modelUsed?: string }
   */
  generateResponse(prompt, options = {}) {
    const targetKey = options.apiKey || this.primaryKey;
    const targetModel = options.modelName || this.modelName;
    const skipRateLimit = options.skipRateLimit || false;
    const attachments = options.attachments || [];

    // Pre-elaborazione Base64 per evitare ripetizione I/O e allocazioni pesanti durante i retry.
    const preEncodedAttachments = attachments.map(blob => {
      if (blob && blob.inlineData && blob.inlineData.data) return blob;
      try {
        const mimeType = blob && typeof blob.getContentType === 'function' ? blob.getContentType() : '';
        if (!mimeType) return null;
        return {
          inlineData: {
            mimeType: mimeType,
            data: Utilities.base64Encode(blob.getBytes())
          }
        };
      } catch (e) {
        console.warn(`Impossibile pre-encodare allegato: ${e.message}`);
        return null;
      }
    }).filter(Boolean);
    const forceModelKey = this.useRateLimiter && this.rateLimiter && this.rateLimiter.models
      ? Object.keys(this.rateLimiter.models).find((key) =>
          key === targetModel || this.rateLimiter.models[key].name === targetModel
        )
      : null;

    // ====================================================================
    // RATE LIMITER PATH (solo se abilitato E non skippato)
    // ====================================================================
    if (this.useRateLimiter && !skipRateLimit) {
      try {
        const estimatedTokens = this._estimateTokens(prompt, attachments);

        const result = this.rateLimiter.executeRequest(
          'generation',
          (modelName) => this._generateWithModel(prompt, modelName, targetKey, preEncodedAttachments),
          {
            estimatedTokens: estimatedTokens,
            forceModel: forceModelKey,
            modelNameOverride: targetModel
          }
        );

        if (result.success) {
          console.log(`✅ Generato via Rate Limiter (modello: ${result.modelUsed}, token: ~${estimatedTokens})`);
          return { success: true, text: result.result, modelUsed: result.modelUsed };
        }

        const rejectReason = (result && result.reason) ? result.reason : 'Rate limit interno';
        throw new Error(`Rate Limiter ha rifiutato la richiesta: ${rejectReason}`);
      } catch (error) {
        if (error.message && error.message.includes('QUOTA_EXHAUSTED')) {
          console.warn('⚠️ Quota primaria esaurita (intercettato da RateLimiter)');
          throw error; // Rilancia per gestione strategia nel Processor
        }
        // NON effettuare fallback diretto: i retry sono già gestiti nel RateLimiter
        // e una seconda esecuzione fuori limiter falserebbe i contatori quota.
        const errorMessage = (error && error.message) ? error.message : String(error);
        console.warn(`⚠️ Rate Limiter generazione fallito: ${errorMessage}. Interruzione per evitare bypass quota.`);
        throw error; // Preserva l'eccezione originale per il classificatore
      }
    }

    // ====================================================================
    // CHIAMATA DIRETTA (quando RateLimiter disabilitato O skippato per backup key)
    // ====================================================================
    if (skipRateLimit) {
      console.log(`⏩ Chiamata diretta (bypass RateLimiter) con ${targetModel}`);
      const text = this._withRetry(
        () => this._generateWithModel(prompt, targetModel, targetKey, preEncodedAttachments),
        'Generazione diretta (Chiave di Riserva)'
      );
      // `success` è coerente con la presenza di testo generato (nessuna inversione logica).
      return { success: !!text, text: text, modelUsed: targetModel };
    }

    const result = this._withRetry(
      () => this._generateWithModel(prompt, targetModel, targetKey, preEncodedAttachments),
      'Generazione risposta'
    );

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
          contents: [{ role: 'user', parts: [{ text: testPrompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 10
          }
        }),
        muteHttpExceptions: true
      });

      results.connectionOk = response.getResponseCode() === 200;

      if (results.connectionOk) {
        try {
          const result = JSON.parse(response.getContentText());
          if (Array.isArray(result.candidates) && result.candidates.length > 0) {
            results.canGenerate = true;
          } else {
            results.errors.push('API non ha restituito candidati');
          }
        } catch (e) {
          results.connectionOk = false;
          results.errors.push(`Risposta API non è JSON valido: ${e.message}`);
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

  // 2) Estrazione JSON esterno (oggetto o array)
  const startObj = cleaned.indexOf('{');
  const startArr = cleaned.indexOf('[');
  const start = (startObj !== -1 && startArr !== -1)
    ? Math.min(startObj, startArr)
    : Math.max(startObj, startArr);
  if (start === -1) {
    throw new Error('Nessun payload JSON trovato');
  }
  const openingChar = cleaned[start];
  const end = cleaned.lastIndexOf(openingChar === '{' ? '}' : ']');

  cleaned = (end === -1 || end < start)
    ? cleaned.substring(start).trim()
    : cleaned.substring(start, end + 1).trim();

  // 3) Recupero troncamenti: bilancia parentesi graffe mancanti
  cleaned = _tryBalanceJsonBraces(cleaned);

  // 4) Parsing diretto
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn('⚠️ Meccanismo di sanitizzazione preventiva JSON in esecuzione...');
  }

  // 5) Normalizzazione della notazione: quoting rigoroso chiavi e pulizia code strutturali
  const safeFixed = _quoteUnquotedJsonKeysSafely(cleaned);
  const withoutTrailingCommas = safeFixed.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(withoutTrailingCommas);
  } catch (e) {
    // 6) Motore euristico avanzato: ricostruzione dei campi minimi diretti tramite analisi regex
    const partial = _extractQuickCheckFieldsFromPartialJson(cleaned);
    if (partial) {
      console.warn('⚠️ Metadati recuperati attivamente tramite ricostruzione regex');
      return partial;
    }
    throw new Error(`L'architettura di conformità JSON non ha potuto validare l'output stringente: ${e.message}`);
  }
}

/**
 * Assicura conformità strutturale dei blocchi JSON complessi.
 * Struttura dinamicamente gli alberi gerarchici per validazione sicura.
 */
function _tryBalanceJsonBraces(text) {
  if (!text) return text;

  let stringDelimiter = null;
  let escaped = false;
  const stack = [];

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
      if (!stringDelimiter) {
        stringDelimiter = ch;
      } else if (stringDelimiter === ch) {
        stringDelimiter = null;
      }
      continue;
    }
    if (stringDelimiter) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
  }

  let balanced = text;
  if (stringDelimiter) balanced += stringDelimiter;
  while (stack.length > 0) {
    balanced += stack.pop();
  }
  return balanced;
}

/**
 * Motore di ricostruzione euristica per l'estrazione dati in scenari architetturali complessi.
 * Impiega pattern matching per mappare reply_needed, language, category, topic, confidence.
 */
function _extractQuickCheckFieldsFromPartialJson(text) {
  if (!text) return null;

  const replyMatch = text.match(/"reply_needed"\s*:\s*(true|false|"true"|"false")/i);
  if (!replyMatch) return null;

  const languageMatch = text.match(/"language"\s*:\s*"([a-z]{2}(?:-[a-z]{2})?)"/i);
  const categoryMatch = text.match(/"category"\s*:\s*"(TECHNICAL|PASTORAL|DOCTRINAL|FORMAL|MIXED)"/i);
  // Supporta apici interni escapati, es: "topic": "Richiesta \"info\""
  const topicMatch = text.match(/"topic"\s*:\s*"((?:\\.|[^"\\])*)"/i);
  const confidenceMatch = text.match(/"confidence"\s*:\s*(0(?:\.\d+)?|1(?:\.0+)?)/i);

  return {
    reply_needed: String(replyMatch[1]).toLowerCase().includes('true'),
    language: languageMatch ? languageMatch[1].toLowerCase() : 'it',
    category: categoryMatch ? categoryMatch[1] : 'TECHNICAL',
    topic: topicMatch ? topicMatch[1].trim() : 'unknown',
    confidence: (confidenceMatch && !isNaN(Number(confidenceMatch[1]))) ? Number(confidenceMatch[1]) : 0.5,
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
