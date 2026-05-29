/**
 * ResponseValidator.gs - Validazione risposte AI
 * Controlla qualità e sicurezza delle risposte generate
 * 
 * CONTROLLI DI QUALITÀ:
 * ✅ Lunghezza ed UX
 * ✅ Consistenza linguistica
 * ✅ Rilevamento frasi di incertezza
 * ✅ Identificazione placeholder
 * ✅ Validazione firma
 * ✅ Verifica integrità dati (email, telefoni, orari)
 * ✅ Rilevamento leak di processo (thinking leak)
 */
const ITALIAN_FORBIDDEN_CAPS = [
  'Siamo', 'Restiamo', 'Sono', 'È', 'Era', 'Sarà',
  'Ho', 'Hai', 'Ha', 'Abbiamo', 'Avete', 'Hanno',
  'Vorrei', 'Vorremmo', 'Volevamo', 'Desideriamo', 'Informiamo',
  'Il', 'Lo', 'La', 'I', 'Gli', 'Le', 'Un', 'Uno', 'Una',
  'Per', 'Con', 'In', 'Su', 'Tra', 'Fra', 'Da', 'Di', 'A',
  'Ma', 'Se', 'Che', 'Non', 'Sì', 'No', 'E', 'Ed', 'O', 'Oppure',
  'Vi', 'Ti', 'Mi', 'Ci', 'Si', 'Li',
  'Ecco', 'Gentile', 'Caro', 'Cara', 'Spettabile'
];
 
var ResponseValidator = class ResponseValidator {
  constructor() {
    console.log('🔍 Inizializzazione ResponseValidator...');

    // Ottieni config - fallback a default se CONFIG non definito
    // Soglia minima accettabile
    this.MIN_VALID_SCORE = typeof CONFIG !== 'undefined' && CONFIG
      ? (CONFIG.VALIDATION_MIN_SCORE ?? 0.6)
      : 0.6;

    // Soglie lunghezza
    this.MIN_LENGTH_CHARS = 25;
    this.OPTIMAL_MIN_LENGTH = 80;
    // Limite superiore per risposte strutturate (es. sacramenti multipli).
    this.WARNING_MAX_LENGTH = 4500;

    // Frasi vietate (indicatori di rifiuto/incapacità — bloccanti)
    this.forbiddenPhrases = [
      'non ho abbastanza informazioni',
      'non posso rispondere',
      'mi dispiace ma non',
      'scusa ma non',
      'purtroppo non posso'
    ];

    // Frasi di incertezza legittima (soft-warning, NO riduzione score)
    // In contesto pastorale, espressioni come "potrebbe essere" o "probabilmente"
    // sono spesso appropriate e non devono bloccare la risposta.
    this.softWarningPhrases = [
      'non sono sicuro',
      'non sono sicura',
      'suppongo',
      'immagino',
      'potrebbe essere',
      'probabilmente',
      'forse'
    ];

    // Marcatori lingua (usa costante condivisa se disponibile)
    this.languageMarkers = typeof LANGUAGE_MARKERS !== 'undefined' ? LANGUAGE_MARKERS : {
      'it': ['grazie', 'cordiali', 'saluti', 'gentile', 'parrocchia', 'messa', 'vorrei', 'quando'],
      'en': ['thank', 'regards', 'dear', 'parish', 'mass', 'church', 'would', 'could'],
      'es': ['gracias', 'saludos', 'estimado', 'parroquia', 'misa', 'iglesia', 'querría'],
      'fr': ['merci', 'cordialement', 'cher', 'paroisse', 'messe', 'église', 'voudrais'],
      'de': ['danke', 'grüße', 'liebe', 'pfarrei', 'messe', 'kirche', 'möchte'],
      'pt': ['obrigado', 'obrigada', 'cumprimentos', 'paróquia', 'missa', 'igreja', 'orçamento']
    };

    // Placeholder da rilevare
    this.placeholders = ['XXX', 'TODO', '...', '<insert>', 'placeholder', 'tbd'];

    // Pattern di ragionamento esposto (thinking leak) - CRITICO
    // IBRIDO: Regex semantiche + pattern statici specifici
    this.thinkingRegexes = [
      /\b(devo|dovrei)\s+(correggere|modificare|aggiornare)\s+(la\s+risposta|il\s+prompt|il\s+testo)\b/i, // Meta-commenti AI (ristretto)
      /\b(knowledge base|kb)\s+(dice|afferma|contiene|riporta|indica)\b/i,                       // Riferimenti KB
      /\b(rivedendo|consultando|controllando|verificando)\s+(la\s+)?(knowledge base|kb)\b/i,     // Azioni su KB
      // Range limitato e stop su punto/newline: scelta intenzionale anti-backtracking e anti-falsi positivi cross-frase.
      /\b(ho\s+)?dedott[oaie]?\b[^.\n]{0,120}\b(knowledge base|kb)\b/i                          // Deduzioni esplicite da KB
    ];

    this.thinkingPatterns = [
      // Pattern conversazionali non catturati dalle regex 
      'rivedendo la knowledge base',
      'pensandoci bene',
      // Varianti con/senza parentesi: il matching è statico case-insensitive,
      // quindi elenchiamo esplicitamente le forme più probabili.
      'nota interna:',
      'note interne:',
      '(nota interna:',
      '(note interne:',
      'come da istruzioni',
      'non sono ancora presenti nella kb',
      'non sono ancora presenti in knowledge base',
      'le date indicate non sono nella kb',
      'queste date non sono presenti nella kb'
    ];

    // Pattern firma (case-insensitive) - supporta multilingua
    this.signaturePatterns = [
      /segreteria\s+parrocchia\s+sant['\u2018\u2019]?eugenio/i,        // IT
      /parish\s+secretariat\s+(of\s+)?sant['\u2018\u2019]?eugenio/i,   // EN
      /secretar[ií]a\s+parroquial/i,                                   // ES
      /secretaria\s+par[oó]quia(l)?\s+sant['\u2018\u2019]?eugenio/i,   // PT
      /secr[eé]tariat\s+paroiss(e|ial)\s+sant['\u2018\u2019]?eugenio/i, // FR
      /pfarrsekretariat\s+sant['\u2018\u2019]?eugenio/i                // DE
    ];

    // Pattern saluti per fasce orarie (Controllo #8)
    this.greetingPatterns = {
      'it': {
        morning: ['buongiorno', 'buon giorno'],
        afternoon: ['buon pomeriggio'],
        evening: ['buonasera', 'buona sera'],
        neutral: ['buona domenica']
      },
      'en': {
        morning: ['good morning'],
        afternoon: ['good afternoon'],
        evening: ['good evening']
      },
      'es': {
        morning: ['buenos días', 'buen día'],
        afternoon: ['buenas tardes'],
        evening: ['buenas noches']
      },
      'fr': {
        morning: ['bonjour'],
        afternoon: ['bon après-midi'],
        evening: ['bonsoir']
      },
      'de': {
        morning: ['guten morgen'],
        afternoon: ['guten tag'],
        evening: ['guten abend']
      },
      'pt': {
        morning: ['bom dia'],
        afternoon: ['boa tarde'],
        evening: ['boa noite']
      }
    };

    // Saluti liturgici speciali (eccezione al ✅ orario)
    this.liturgicalGreetings = {
      'it': ['buon natale', 'buona pasqua', 'buon avvento', 'buona quaresima', 'buona pentecoste'],
      'en': ['merry christmas', 'happy easter', 'happy advent', 'happy pentecost'],
      'es': ['feliz navidad', 'feliz pascua', 'feliz adviento', 'feliz pentecostés'],
      'fr': ['joyeux noël', 'joyeuses pâques', 'joyeux avent', 'joyeuse pentecôte'],
      'de': ['frohe weihnachten', 'frohe ostern', 'schönen advent', 'frohe pfingsten'],
      'pt': ['feliz natal', 'feliz páscoa', 'feliz advento', 'feliz quaresma', 'feliz pentecostes']
    };

    // Semantic Validator (opzionale)
    const semanticEnabled = typeof CONFIG !== 'undefined' &&
      CONFIG.SEMANTIC_VALIDATION &&
      CONFIG.SEMANTIC_VALIDATION.enabled === true;
    this.semanticValidator = semanticEnabled ? new SemanticValidator() : null;
    this.geminiService = null;

    console.log('✓ ResponseValidator inizializzato');
    console.log(`   Soglia minima validità: ${this.MIN_VALID_SCORE}`);
  }

  /**
   * Valida risposta in modo completo
   * @param {string} response - Testo risposta da validare
   * @param {string} detectedLanguage - Lingua rilevata
   * @param {string} knowledgeBase - KB per confronto allucinazioni
   * @param {string} emailContent - Contenuto email originale
   * @param {string} emailSubject - Oggetto email
   * @param {string} salutationMode - Modalità saluto ('full'|'soft'|'none_or_continuity')
   * @returns {Object} Risultato validazione
   */
  validateResponse(response, detectedLanguage, knowledgeBase, emailContent, emailSubject, salutationMode = 'full', attemptPerfezionamento = true, temporalContext = null) {
    const errors = [];
    const warnings = [];
    const details = {};
    let score = 1.0;

    // Variabile per gestire la risposta
    let rawResponse = typeof response === 'string' ? response : (response == null ? '' : String(response));
    let currentResponse = rawResponse;
    let wasRefined = false;

    // ====================================================================
    // ESTRAZIONE DEL TESTO FINALE DAI TAG XML (Gemini 3.x Flash)
    // ====================================================================
    const emailMatch = rawResponse.match(/<email>\s*([\s\S]*?)\s*<\/email>/i);
    if (emailMatch && emailMatch[1]) {
      currentResponse = emailMatch[1].trim();
      console.log(`✂️ Estratto blocco <email> (${currentResponse.length} caratteri). Ignorato blocco <analisi>.`);
    } else {
      // Fallback: se il modello dimentica <email>, puliamo almeno il blocco <analisi>.
      const hasAnalisi = /<analisi>[\s\S]*?<\/analisi>/i.test(currentResponse);
      if (hasAnalisi) {
        currentResponse = currentResponse.replace(/<analisi>[\s\S]*?<\/analisi>/i, '').trim();
        console.log('✂️ Rimosso blocco <analisi> di fallback.');
      }
    }

    const safeDetectedLanguage = typeof detectedLanguage === 'string' && detectedLanguage.length > 0
      ? detectedLanguage
      : 'it';
    console.log(`🔍 Validazione risposta netta (${currentResponse.length} caratteri, lingua=${safeDetectedLanguage})...`);

    // --- PRIMO PASSAGGIO DI VALIDAZIONE ---
    let validationResult = this._runValidationChecks(currentResponse, safeDetectedLanguage, knowledgeBase, salutationMode, emailContent, emailSubject, temporalContext);

    // --- PERFEZIONAMENTO QUALITATIVO ---
    if (!validationResult.isValid && attemptPerfezionamento) {
      console.log('✨ Tentativo perfezionamento automatico...');

      const perfezionamentoResult = this._perfezionamentoAutomatico(currentResponse, validationResult.errors, safeDetectedLanguage);

      if (perfezionamentoResult.fixed) {
        console.log('   ✨ Risposta perfezionata (migliorata qualità o rimozione allucinazioni)');
        currentResponse = perfezionamentoResult.text;
        wasRefined = true;

        // Ri-esegui validazione sul testo corretto
        validationResult = this._runValidationChecks(currentResponse, safeDetectedLanguage, knowledgeBase, salutationMode, emailContent, emailSubject, temporalContext);

        if (validationResult.isValid) {
          console.log('   ✅ Elaborazione di raffinamento completata');
        } else {
          console.warn('   ⚠️ Perfezionamento insufficiente. Errori residui.');
        }
      } else {
        console.log('   🚫 Nessun perfezionamento automatico applicabile.');
      }
    }

    // === SEMANTIC VALIDATION (solo se necessario) ===
    if (this.semanticValidator && this.semanticValidator.shouldRun(validationResult.score)) {
      console.log('🧠 Attivazione Semantic Validation (score sotto soglia)...');

      const semHalluc = this.semanticValidator.validateHallucinations(
        currentResponse,
        knowledgeBase,
        validationResult.details.hallucinations,
        emailContent
      );

      const semThinking = this.semanticValidator.validateThinkingLeak(
        currentResponse,
        validationResult.details.exposedReasoning
      );

      const semanticValid = semHalluc.isValid && semThinking.isValid;
      const semanticConfidence = Math.min(semHalluc.confidence, semThinking.confidence);

      if (!semanticValid) {
        console.warn('❌ Il validatore semantico ha rilevato problemi non catturati da regex');
        validationResult.isValid = false;
        validationResult.score = Math.min(validationResult.score, semanticConfidence);
        const semanticReason = semHalluc.reason || semThinking.reason || 'Validazione semantica fallita senza motivo esplicito';
        validationResult.errors.push(`Semantica: ${semanticReason}`);
      }

      validationResult.details.semantic = {
        hallucinations: semHalluc,
        thinkingLeak: semThinking
      };
    }

    // Log finale
    if (validationResult.errors.length > 0) {
      console.warn(`❌ Validazione FALLITA: ${validationResult.errors.length} errore/i`);
      validationResult.errors.forEach((err, i) => console.warn(`   ${i + 1}. ${err}`));
    }

    if (validationResult.isValid) {
      console.log(`✓ Validazione SUPERATA (punteggio: ${validationResult.score.toFixed(2)})`);
    }

    return {
      isValid: validationResult.isValid,
      score: validationResult.score,
      errors: validationResult.errors,
      warnings: validationResult.warnings,
      details: validationResult.details,
      fixedResponse: (wasRefined && validationResult.isValid) ? currentResponse : null, // Restituisci testo perfezionato SOLO se valido
      metadata: {
        responseLength: currentResponse.length,
        expectedLanguage: safeDetectedLanguage,
        threshold: this.MIN_VALID_SCORE,
        wasRefined: wasRefined
      }
    };
  }

  /**
   * Alias per la firma ad oggetto (supporta chiamata con parametri nominali).
   * Evita rotture quando il chiamante usa validator.validate(response, { ...opts }).
   * @param {string} response
   * @param {{language?: string, knowledgeBase?: string, emailContent?: string, body?: string, emailSubject?: string, subject?: string, salutationMode?: string, currentDate?: string, messageDate?: string, temporalContext?: Object}} opts
   * @returns {Object}
   */
  validate(response, opts) {
    const safeOpts = opts || {};
    return this.validateResponse(
      response,
      safeOpts.language || 'it',
      safeOpts.knowledgeBase || '',
      safeOpts.emailContent || safeOpts.body || '',
      safeOpts.emailSubject || safeOpts.subject || '',
      safeOpts.salutationMode || 'full',
      true,
      safeOpts.temporalContext || {
        currentDate: safeOpts.currentDate || null,
        messageDate: safeOpts.messageDate || null
      }
    );
  }

  /**
   * Esegue i ✅ effettivi (estratto per riutilizzo)
   */
  _runValidationChecks(response, detectedLanguage, knowledgeBase, salutationMode, originalMessage = '', emailSubject = '', temporalContext = null) {
    const errors = [];
    const warnings = [];
    const details = {};
    let score = 1.0;

    // === CONTROLLO 1: Lunghezza ===
    const lengthResult = this._checkLength(response);
    errors.push(...lengthResult.errors);
    warnings.push(...lengthResult.warnings);
    details.length = lengthResult;
    score *= lengthResult.score;

    // === CONTROLLO 2: Consistenza lingua ===
    const langResult = this._checkLanguage(response, detectedLanguage);
    errors.push(...langResult.errors);
    warnings.push(...langResult.warnings);
    details.language = langResult;
    score *= langResult.score;

    // === CONTROLLO 3: Firma ===
    const sigResult = this._checkSignature(response, salutationMode);
    errors.push(...sigResult.errors);
    warnings.push(...sigResult.warnings);
    details.signature = sigResult;
    score *= sigResult.score;

    // === CONTROLLO 4: Contenuto vietato ===
    const contentResult = this._checkForbiddenContent(response);
    errors.push(...contentResult.errors);
    warnings.push(...contentResult.warnings);
    details.content = contentResult;
    score *= contentResult.score;

    // === CONTROLLO 5: Allucinazioni ===
    const originalContext = [emailSubject, originalMessage].filter(Boolean).join('\n').trim();
    const hallucResult = this._checkHallucinations(response, knowledgeBase, originalContext);
    errors.push(...hallucResult.errors);
    warnings.push(...hallucResult.warnings);
    details.hallucinations = hallucResult;
    score *= hallucResult.score;

    // === CONTROLLO 6: Maiuscola dopo virgola ===
    const capResult = this._checkCapitalAfterComma(response, detectedLanguage);
    errors.push(...capResult.errors);
    warnings.push(...capResult.warnings);
    details.capitalAfterComma = capResult;
    score *= capResult.score;

    // === CONTROLLO 7: Ragionamento esposto ===
    const reasoningResult = this._checkExposedReasoning(response);
    errors.push(...reasoningResult.errors);
    warnings.push(...reasoningResult.warnings);
    details.exposedReasoning = reasoningResult;
    score *= reasoningResult.score;

    // === CONTROLLO 8: Saluto temporalmente incongruente ===
    const greetingResult = this._checkTimeBasedGreeting(response, detectedLanguage);
    warnings.push(...greetingResult.warnings);
    details.greeting = greetingResult;
    score *= greetingResult.score;

    // === CONTROLLO 9: Coerenza temporale eventi/date ===
    const temporalResult = this._checkTemporalConsistency(response, detectedLanguage, temporalContext);
    errors.push(...temporalResult.errors);
    warnings.push(...temporalResult.warnings);
    details.temporalConsistency = temporalResult;
    score *= temporalResult.score;

    // === CONTROLLO 10: riferimenti papali aggiornati ===
    const papalResult = this._checkCurrentPopeReferences(response, knowledgeBase, originalContext, temporalContext);
    errors.push(...papalResult.errors);
    warnings.push(...papalResult.warnings);
    details.currentPopeReference = papalResult;
    score *= papalResult.score;

    // Determina validità
    const isValid = errors.length === 0 && score >= this.MIN_VALID_SCORE;

    return { isValid, score, errors, warnings, details };
  }

  // ========================================================================
  // CONTROLLI DI VALIDAZIONE
  // ========================================================================

  /**
   * Controllo 1: Validazione lunghezza
   */
  _checkLength(response) {
    const errors = [];
    const warnings = [];
    let score = 1.0;

    const length = response.trim().length;

    if (length < this.MIN_LENGTH_CHARS) {
      errors.push(`Risposta troppo corta (${length} caratteri, minimo ${this.MIN_LENGTH_CHARS})`);
      score = 0.0;
    } else if (length < this.OPTIMAL_MIN_LENGTH) {
      warnings.push(`Risposta piuttosto corta (${length} caratteri)`);
      score *= 0.85;
    } else if (length > this.WARNING_MAX_LENGTH) {
      // Degradazione progressiva invece di azzeramento diretto del punteggio.
      // 4500-6000 → avviso (0,85); >6000 → errore bloccante.
      const HARD_MAX_LENGTH = 6000;
      if (length > HARD_MAX_LENGTH) {
        errors.push(`Risposta eccessivamente lunga (${length} caratteri, limite assoluto ${HARD_MAX_LENGTH})`);
        score = 0.0;
      } else {
        warnings.push(`Risposta lunga (${length} caratteri, raccomandato max ${this.WARNING_MAX_LENGTH})`);
        const overRatio = (length - this.WARNING_MAX_LENGTH) / (HARD_MAX_LENGTH - this.WARNING_MAX_LENGTH);
        score *= Math.max(0.65, 0.85 - overRatio * 0.25);
      }
    }

    return { score, errors, warnings, length };
  }

  /**
   * Controllo 2: Consistenza lingua
   */
  _checkLanguage(response, expectedLanguage) {
    const errors = [];
    const warnings = [];
    let score = 1.0;

    // Rimuove le citazioni HTML per evitare che il testo quotato (es. thread storico)
    // influenzi la rilevazione della lingua della risposta attuale.
    const cleanResponse = response
      .replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '')
      .replace(/<div\s+class=["']gmail_quote["'][^>]*>[\s\S]*$/gi, '');

    const responseLower = cleanResponse.toLowerCase();

    // Rileva lingua attuale usando marcatori
    const markerScores = {};
    for (const lang in this.languageMarkers) {
      markerScores[lang] = this.languageMarkers[lang].reduce((count, marker) => {
        const escapedMarker = String(marker).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Confini accent-aware senza lookbehind/property escapes: Apps Script V8 può
        // variare per versione, mentre questo intervallo copre i marker latini supportati.
        // (es. "paróquia", "grüße", "querría"). \b è ASCII-only e fallisce con diacritici.
        const regex = new RegExp(`(?:^|[^\\wÀ-ÿ])${escapedMarker}(?=[^\\wÀ-ÿ]|$)`, 'i');
        return count + (regex.test(responseLower) ? 1 : 0);
      }, 0);
    }

    // Scegli lingua con punteggio più alto
    let detectedLang = expectedLanguage;
    let maxScore = 0;
    for (const lang in markerScores) {
      if (markerScores[lang] > maxScore) {
        maxScore = markerScores[lang];
        detectedLang = lang;
      }
    }

    // Verifica corrispondenza
    if (detectedLang !== expectedLanguage) {
      if (markerScores[detectedLang] >= 3 && markerScores[expectedLanguage] < 2) {
        errors.push(
          `Lingua non corrispondente: attesa ${expectedLanguage.toUpperCase()}, ` +
          `rilevata ${detectedLang.toUpperCase()}`
        );
        score *= 0.30;
      } else {
        warnings.push('Possibile inconsistenza lingua');
        score *= 0.85;
      }
    }

    // Verifica lingue miste
    const highScoringLangs = Object.keys(markerScores).filter(
      lang => markerScores[lang] >= 3
    );

    if (highScoringLangs.length > 1) {
      warnings.push(`Possibili lingue miste: ${highScoringLangs.join(', ')}`);
      score *= 0.85;
    }

    return { score, errors, warnings, detectedLang, markerScores };
  }

  /**
   * Controllo 3: Firma (obbligatoria su primo contatto, opzionale su follow-up)
   */
  _checkSignature(response, salutationMode = 'full') {
    const errors = [];
    const warnings = [];
    let score = 1.0;

    // Nei follow-up ravvicinati la firma è opzionale
    if (salutationMode === 'none_or_continuity' || salutationMode === 'session') {
      return { score, errors, warnings };
    }

    // Per primo contatto ('full') e riprese dopo pausa ('soft'): firma attesa
    const hasValidSignature = this.signaturePatterns.some(pattern => pattern.test(response));

    if (!hasValidSignature) {
      warnings.push("Firma mancante (es. 'Segreteria Parrocchia Sant'Eugenio')");
      score = 0.95;
    }

    return { score, errors, warnings };
  }

  /**
   * Controllo 4: Contenuto vietato e placeholder
   */
  _checkForbiddenContent(response) {
    const errors = [];
    const warnings = [];
    let score = 1.0;

    const responseLower = response.toLowerCase();

    // Controlla frasi vietate (indicatori incertezza) con confini di parola/frase
    // per ridurre falsi positivi su sottostringhe.
    const foundForbidden = this.forbiddenPhrases.filter((phrase) => {
      if (!phrase || !phrase.trim()) return false;
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$|[.,!?;:])`, 'i');
      return rx.test(responseLower);
    });

    if (foundForbidden.length > 0) {
      errors.push(`Contiene frasi di incertezza: ${foundForbidden.slice(0, 2).join(', ')}`);
      score *= 0.50;
    }

    const foundSoftWarnings = this.softWarningPhrases.filter((phrase) => {
      if (!phrase || !phrase.trim()) return false;
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$|[.,!?;:])`, 'i');
      return rx.test(responseLower);
    });
    if (foundSoftWarnings.length > 0) {
      warnings.push(`Tono prudente rilevato: ${foundSoftWarnings.slice(0, 2).join(', ')}`);
    }

    // Rilevamento placeholder intelligente
    const foundPlaceholders = [];
    const hasPlaceholderToken = (placeholder) => {
      const normalized = String(placeholder || '').trim();
      if (!normalized) return false;

      // Evita falsi positivi su sottostringhe di parole reali
      // (es. "todo" in spagnolo) per placeholder alfabetici.
      if (/^[A-Za-z]+$/.test(normalized)) {
        // Evita falsi positivi su parole naturali in minuscolo (es. "todo" in spagnolo).
        // Placeholder acronimici devono comparire in maiuscolo.
        if (normalized === normalized.toUpperCase()) {
          const escapedUpper = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const upperRx = new RegExp(`(?:^|[^\\wÀ-ÿ])${escapedUpper}(?=$|[^\\wÀ-ÿ])`);
          return upperRx.test(response);
        }
        const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = new RegExp(`(?:^|[^\\wÀ-ÿ])${escaped}(?=$|[^\\wÀ-ÿ])`, 'i');
        return rx.test(response);
      }

      return responseLower.includes(normalized.toLowerCase());
    };

    for (const p of this.placeholders) {
      if (!p || !p.trim()) continue; // Validazione input: ignora stringhe vuote
      // Per '...', verifica se usato come placeholder (non ellissi nel testo)
      if (p === '...') {
        if (/\[\.\.\.]/g.test(response)) {
          foundPlaceholders.push(p);
        }
      } else if (hasPlaceholderToken(p)) {
        foundPlaceholders.push(p);
      }
    }

    const bracketPlaceholderPattern = /\[[A-Z][A-Z0-9_\s-]{1,30}\]/g;
    const systemBracketTokens = new Set([
      'RIENTRA',
      'NON RIENTRA',
      'CIVICO NECESSARIO',
      'NOREPLY',
      'FOCUS IBAN DETECTED'
    ]);
    const explicitPlaceholderWords = /(?:^|[\s_-])(NOME|COGNOME|DATA|ORA|ORARIO|EMAIL|MAIL|TELEFONO|CELLULARE|INDIRIZZO|IMPORTO|IBAN|LUOGO|LINK|URL|INSERIRE|INSERT|PLACEHOLDER|TODO|TBD|XXX)(?:$|[\s_-])/i;
    const bracketPlaceholders = response.match(bracketPlaceholderPattern) || [];
    if (bracketPlaceholders.length > 0) {
      const filteredBracketPlaceholders = bracketPlaceholders.filter((token) => {
        const inner = token.replace(/^\[|\]$/g, '').trim();
        if (systemBracketTokens.has(inner)) return false;

        // Le parentesi quadre sono usate anche per etichette o riferimenti testuali.
        // Blocchiamo solo token che somigliano davvero a campi da compilare,
        // evitando falsi positivi su testo normale in maiuscolo tra parentesi.
        return explicitPlaceholderWords.test(inner);
      });
      if (filteredBracketPlaceholders.length > 0) {
        foundPlaceholders.push(...filteredBracketPlaceholders); // nessuna nidificazione
      }
    }

    if (foundPlaceholders.length > 0) {
      errors.push(`Contiene placeholder: ${foundPlaceholders.join(', ')}`);
      score = 0.0;
    }

    // Verifica perdita NO_REPLY
    if (response.includes('NO_REPLY') && response.trim().length > 20) {
      errors.push("Contiene istruzione 'NO_REPLY' (doveva essere filtrata)");
      score = 0.0;
    }

    return { score, errors, warnings, foundForbidden, foundSoftWarnings, foundPlaceholders };
  }

  /**
   * Controllo 5: Allucinazioni (dati inventati non in KB)
   */
  _checkHallucinations(response, knowledgeBase, originalMessage = '') {
    const errors = [];
    const warnings = [];
    let score = 1.0;
    const hallucinations = {};
    
    // Previene elaborazioni su input malformati o KB non caricate.
    let safeKnowledgeBase = '';
    if (typeof knowledgeBase === 'string') {
      safeKnowledgeBase = knowledgeBase;
    } else if (knowledgeBase && typeof knowledgeBase === 'object') {
      try {
        safeKnowledgeBase = JSON.stringify(knowledgeBase);
      } catch (e) {
        console.warn('⚠️ Impossibile serializzare knowledgeBase per check allucinazioni');
        safeKnowledgeBase = '';
      }
    }

    // Helper normalizzazione orari
    const normalizeTime = (t) => {
      // Escludi pattern che potrebbero essere URL o nomi file
      if (/[a-z]{2,}\.\d{1,2}\.[a-z]{2,}/i.test(t)) return t;
      if (/\/([\w-]+\.\d{1,2}\.\w+)$/i.test(t)) return t;

      // Sostituzione mirata dei separatori orari.
      // di corrompere pattern come "10.5" o nomi file.
      t = t.replace(/(\d)\.(\d)/g, '$1:$2');
      if (/^\d{1,2}$/.test(t)) {
        const hour = parseInt(t, 10);
        if (!isNaN(hour) && hour >= 0 && hour <= 23) {
          return `${hour.toString().padStart(2, '0')}:00`;
        }
      }
      const parts = t.split(':');
      if (parts.length === 2) {
        try {
          const h = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          if (!isNaN(h) && !isNaN(m)) {
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
          }
        } catch (e) {
          return t;
        }
      }
      return t;
    };

    // Helper normalizzazione telefono
    const normalizePhone = (p) => p.replace(/\D/g, '');

    // === Controllo orari ===
    // Compatibilità GAS: evita lookbehind a lunghezza variabile, che in alcuni runtime V8
    // può fallire in fase di parsing. Il filtro di contesto replica le esclusioni precedenti.
    const timePattern = /\b\d{1,2}[:.]\d{2}\b(?![\/.-]\d{2,4})(?!\.[a-z])/gi;
    const contextualHourPattern = /\b(?:alle?|ore)\s+(\d{1,2})\b/gi;
    const collectStandaloneTimes = (text) => {
      const found = [];
      const safeText = text || '';
      let timeMatch;
      timePattern.lastIndex = 0;
      while ((timeMatch = timePattern.exec(safeText)) !== null) {
        const timeStr = timeMatch[0];
        const index = timeMatch.index;
        const prefix = safeText.substring(Math.max(0, index - 20), index).toLowerCase();
        const suffix = safeText.substring(index + timeStr.length, Math.min(safeText.length, index + timeStr.length + 10)).toLowerCase();

        // Whitelist: Escludi URL/nomi file (es. "v.10.30"), indirizzi, prezzi, date e versetti biblici.
        if (/[a-z]\.$/i.test(prefix)) continue;
        if (/\b\d{1,2}[\/.-]$/i.test(prefix)) continue;
        if (/(?:via|viale|piazza|corso|largo|vicolo|civico|n\.|num\.|int\.|scala)\s*$/i.test(prefix)) continue;
        if (/^\s*(?:euro|\u20AC|eur)/i.test(suffix)) continue;
        if (/^\.\d{2,4}\b/.test(suffix) || /(?:^|[\s(])\d{1,2}[\/.-]\d{1,2}$/.test(prefix.trim())) continue;
        if (/(?:gv|mt|mc|lc|gen|es|lv|nm|dt|gs|dc|rut|1?sam|2sam|1?re|2re|1?cr|2cr|esd|ne|tb|gdt|est|gb|sal|pr|qo|ct|sap|sir|is|ger|lam|bar|ez|dn|os|gl|am|abd|gna|mi|na|ab|sof|ag|zc|ml|at|rm|1?cor|2cor|gal|ef|fil|col|1?ts|2ts|1?tm|2tm|tt|fm|eb|gc|1?pt|2pt|1?gv|2gv|3gv|gd|ap)\.?\s*$/i.test(prefix)) continue;

        found.push(timeStr);
      }
      return found;
    };

    const responseTimesRaw = collectStandaloneTimes(response);
    const kbTimesRaw = collectStandaloneTimes(safeKnowledgeBase);
    const originalTimesRaw = collectStandaloneTimes(originalMessage || '');
    const collectContextualHours = (text, target) => {
      contextualHourPattern.lastIndex = 0;
      let contextualHourMatch;
      while ((contextualHourMatch = contextualHourPattern.exec(text || '')) !== null) {
        target.push(contextualHourMatch[1]);
      }
    };

    collectContextualHours(response, responseTimesRaw);
    collectContextualHours(safeKnowledgeBase, kbTimesRaw);
    collectContextualHours(originalMessage || '', originalTimesRaw);

    const responseTimes = new Set(responseTimesRaw.map(normalizeTime));
    const kbTimes = new Set(kbTimesRaw.map(normalizeTime));
    const originalTimes = new Set(originalTimesRaw.map(normalizeTime));
    const inventedTimes = [...responseTimes].filter(t => !kbTimes.has(t) && !originalTimes.has(t));

    if (inventedTimes.length > 0) {
      errors.push(`Orari non in KB: ${inventedTimes.join(', ')}`);
      score *= 0.50;
      hallucinations.times = inventedTimes;
    }

    // === Controllo email ===
    // Protezione ReDoS con limite esplicito sulla parte locale dell'email
    const emailPattern = /\b[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,64})@[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/gi;
    const responseEmails = new Set(
      (response.match(emailPattern) || []).map(e => e.toLowerCase())
    );
    const kbEmails = new Set(
      (safeKnowledgeBase.match(emailPattern) || []).map(e => e.toLowerCase())
    );
    const originalEmails = new Set(
      ((originalMessage || '').match(emailPattern) || []).map(e => e.toLowerCase())
    );
    const inventedEmails = [...responseEmails].filter(e => !kbEmails.has(e) && !originalEmails.has(e));

    if (inventedEmails.length > 0) {
      errors.push(`Indirizzi email non in KB: ${inventedEmails.join(', ')}`);
      score *= 0.50;
      hallucinations.emails = inventedEmails;
    }

    // === Controllo numeri telefono ===
    // Pattern selettivo: richiede prefisso internazionale o separatori standard
    // Esclude pattern data (GG/MM/AAAA) e orari common
    const phonePattern = /(?:(?:\+\d{1,3}[\s.-])?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}(?!\d))|(?:\+?39)?0\d{7,9}\b/g;
    const responsePhonesRaw = response.match(phonePattern) || [];
    const kbPhonesRaw = safeKnowledgeBase.match(phonePattern) || [];

    // 8+ cifre minimo per evitare falsi positivi. Escludi date YYYYMMDD e DDMMYYYY (B18).
    const datePattern = /^\d{4}[01]\d[0-3]\d$|^[0-3]\d[01]\d\d{4}$/;
    const responsePhones = new Set(
      responsePhonesRaw
        .map(raw => ({ raw, normalized: normalizePhone(raw) }))
        .filter(({ raw, normalized }) => normalized.length >= 8 && !datePattern.test(raw) && !datePattern.test(normalized))
        .map(({ normalized }) => normalized)
    );
    const kbPhones = new Set(
      kbPhonesRaw
        .map(raw => ({ raw, normalized: normalizePhone(raw) }))
        .filter(({ raw, normalized }) => normalized.length >= 8 && !datePattern.test(raw) && !datePattern.test(normalized))
        .map(({ normalized }) => normalized)
    );

    // Escludi numeri presenti nella whitelist (es. mittente, thread) o nel messaggio originale
    const whitelistText = (originalMessage || '');
    const inventedPhones = [...responsePhones].filter(p => {
      if (kbPhones.has(p)) return false;
      // Se il numero è presente nel testo originale, è legittimo ripeterlo
      if (whitelistText.replace(/\D/g, '').includes(p)) return false;
      return true;
    });

    if (inventedPhones.length > 0) {
      errors.push(`Numeri telefono non in KB: ${inventedPhones.join(', ')}`);
      score *= 0.50;
      hallucinations.phones = inventedPhones;
    }

    return { score, errors, warnings, hallucinations };
  }

  /**
   * Controllo 6: Maiuscola dopo virgola
   */
  _checkCapitalAfterComma(response, expectedLanguage = 'it') {
    const errors = [];
    const warnings = [];
    let score = 1.0;
    const capitalizationExceptions = [
      'Dio', 'Gesù', 'Maria', 'Santo', 'Padre', 'Lei', 'La', 'Ella',
      // Titoli e forme onorifiche (specialmente in contesto ecclesiastico)
      'Don', 'Monsignore', 'Mons', 'Suor', 'Fra', 'Frate', 'Reverendo', 'Cardinale', 'Vescovo'
    ];

    // Parole italiane che NON devono essere maiuscole dopo una virgola
    const italianForbiddenCaps = ITALIAN_FORBIDDEN_CAPS;

    // Parole inglesi - lista limitata
    const englishForbiddenCaps = [
      'The', 'An', 'For', 'With', 'On', 'At', 'If', 'Or', 'And', 'But', 'To', 'In'
    ];

    // Parole spagnole
    const spanishForbiddenCaps = [
      'Estamos', 'Somos', 'Estaremos', 'Seremos',
      'El', 'Los', 'Las', 'Una', 'Por', 'En', 'De', 'Pero', 'Que'
    ];

    // Parole portoghesi
    const portugueseForbiddenCaps = [
      'Estamos', 'Somos', 'Estaremos', 'Seremos',
      'O', 'A', 'Os', 'As', 'Um', 'Uma', 'Por', 'Em', 'De', 'Mas', 'Que', 'E', 'Ou'
    ];

    // Seleziona lista in base alla lingua
    let forbiddenCaps;
    const isStrictMode = false; // Solo warning, non blocca l'invio

    if (expectedLanguage === 'it') {
      forbiddenCaps = italianForbiddenCaps;
    } else if (expectedLanguage === 'en') {
      forbiddenCaps = englishForbiddenCaps;
    } else if (expectedLanguage === 'es') {
      forbiddenCaps = spanishForbiddenCaps;
    } else if (expectedLanguage === 'pt') {
      forbiddenCaps = portugueseForbiddenCaps;
    } else if (expectedLanguage === 'fr') {
      // Francese: set conservativo per ridurre falsi positivi.
      forbiddenCaps = ['Le', 'La', 'Les', 'Un', 'Une', 'Des', 'Et', 'Ou', 'Mais', 'Pour', 'Dans', 'Sur', 'Par', 'Avec', 'Nous', 'Vous', 'Ils'];
    } else if (expectedLanguage === 'de') {
      // Tedesco: i sostantivi sono maiuscoli per grammatica, quindi questa regola
      // causerebbe warning sistematici non affidabili.
      forbiddenCaps = [];
    } else {
      // Lingua non supportata: evita warning non correggibili automaticamente
      return { score: 1.0, errors: [], warnings: [], violations: [] };
    }

    // Regex mirata ai token alfabetici semplici dopo virgola: evita falsi positivi su forme elise (es. Un'altra).
    // Nota: mantenuta intenzionalmente conservativa perché questa regola genera warning stilistici, non errori bloccanti.
    const pattern = /,\s+([A-ZÀÈÉÌÒÙ][a-zàèéìòù]*)/g;
    let match;
    const violations = [];

    while ((match = pattern.exec(response)) !== null) {
      if (!match[1]) continue;
      const word = String(match[1]); // Coercizione esplicita a stringa

      if (capitalizationExceptions.includes(word)) {
        if (word !== 'La') {
          continue;
        }

        // "La" è ambigua: può essere pronome formale (ok) o articolo (da segnalare).
        // Se seguito da un verbo comune, trattalo come eccezione; altrimenti lascia passare i controlli.
        const afterMatchPosLa = match.index + match[0].length;
        const textAfterLa = response.substring(afterMatchPosLa);
        const nextWordMatch = textAfterLa.match(/^\s+([a-zàèéìòù']+)/);
        const nextWord = nextWordMatch ? nextWordMatch[1].toLowerCase() : '';
        const likelyFormalPronoun = /^(informo|ringrazio|avviso|aggiorno|contatto|invito|prego|saluto|ascolto|rassicuro|confermo|ricordo|attendo)$/.test(nextWord);

        if (likelyFormalPronoun) {
          continue;
        }
      }

      // Euristica nomi doppi: se la parola è seguita da un'altra maiuscola,
      // probabilmente sono nomi propri (es. "Maria Isabella", "Gian Luca")
      const afterMatchPos = match.index + match[0].length;
      const textAfter = response.substring(afterMatchPos);
      if (textAfter.match(/^\s+[A-ZÀÈÉÌÒÙ][a-zàèéìòù]+/)) {
        continue; // Salta: probabile nome doppio
      }

      if (forbiddenCaps.includes(word)) {
        violations.push(word);

        if (isStrictMode) {
          errors.push(
            `Errore grammaticale: '${word}' maiuscolo dopo virgola. Dovrebbe essere: '${word.toLowerCase()}'`
          );
        } else {
          warnings.push(
            `Possibile errore grammaticale: '${word}' maiuscolo dopo virgola`
          );
        }
      }
    }

    if (violations.length > 0) {
      if (isStrictMode) {
        score *= Math.max(0.5, 1.0 - (violations.length * 0.15));
      } else {
        score *= Math.max(0.9, 1.0 - (violations.length * 0.05));
      }
    }

    return { score, errors, warnings, violations };
  }

  /**
   * Controllo 7: Ragionamento esposto (Thinking Leak)
   * Rileva quando l'IA espone il suo processo di pensiero nella risposta
   */
  _checkExposedReasoning(response) {
    const errors = [];
    const warnings = [];
    let score = 1.0;
    const foundPatterns = [];

    const responseLower = response.toLowerCase();

    // 1. Cerca pattern Regex (Meta-commenti strutturali)
    for (const regex of this.thinkingRegexes) {
      if (regex.test(response)) {
        foundPatterns.push(`Regex Match: ${regex.source}`);
      }
    }

    // 2. Cerca pattern statici residui
    for (const pattern of this.thinkingPatterns) {
      if (responseLower.includes(pattern.toLowerCase())) {
        foundPatterns.push(pattern);
      }
    }

    // Se trovati pattern, applica penalizzazione graduata
    if (foundPatterns.length > 0) {
      const firstPattern = String(foundPatterns[0] || '').toLowerCase();
      const hardPatterns = [
        'rivedendo la knowledge base',
        'consultando la knowledge base',
        'come da istruzioni'
      ];

      const isRegexMatch = firstPattern.startsWith('regex match:');
      const isHardMatch = isRegexMatch || hardPatterns.some(pattern => firstPattern.includes(pattern));

      if (isHardMatch) {
        errors.push(`RAGIONAMENTO ESPOSTO CRITICO: "${foundPatterns[0]}..."`);
        score = 0.0;
      } else {
        warnings.push(`Possibile meta-commento: "${foundPatterns[0]}..."`);
        score = Math.min(score, 0.75);
      }

      console.error(`🚨 THINKING LEAK CHECK (Pattern: ${foundPatterns[0]}).`);
    }

    return { score, errors, warnings, foundPatterns };
  }

  /**
   * Controllo 8: Saluto temporalmente incongruente
   * Rileva se il saluto nella risposta è appropriato per l'orario corrente
   */
  _checkTimeBasedGreeting(response, language) {
    const warnings = [];
    let score = 1.0;

    // Verifica lingua supportata
    if (!this.greetingPatterns[language]) {
      return { score, warnings, message: 'Lingua non supportata per ✅ saluti' };
    }

    // Determina fascia oraria corrente (fuso orario italiano)
    const currentHour = this._getCurrentHourInRome_();
    let expectedTimeSlot;
    if (currentHour >= 5 && currentHour < 13) {
      expectedTimeSlot = 'morning';
    } else if (currentHour >= 13 && currentHour < 19) {
      expectedTimeSlot = 'afternoon';
    } else {
      expectedTimeSlot = 'evening';
    }

    // Estrai saluto dai primi 100 caratteri della risposta
    const responseStart = response.substring(0, 100).toLowerCase();

    // Cerca pattern di saluto
    const patterns = this.greetingPatterns[language];
    let detectedGreeting = null;
    let detectedTimeSlot = null;

    for (const [timeSlot, greetings] of Object.entries(patterns)) {
      for (const greeting of greetings) {
        if (responseStart.includes(greeting)) {
          detectedGreeting = greeting;
          detectedTimeSlot = timeSlot;
          break;
        }
      }
      if (detectedGreeting) break;
    }

    // Se nessun saluto rilevato, OK (potrebbe essere modalità continuity)
    if (!detectedGreeting) {
      return {
        score,
        warnings,
        message: 'Nessun saluto rilevato (OK per modalità continuity)',
        detectedGreeting: null,
        expectedTimeSlot,
        currentHour
      };
    }

    // Verifica se è un saluto liturgico speciale (eccezione)
    const liturgical = this.liturgicalGreetings[language] || [];
    const isLiturgical = liturgical.some(lg => responseStart.includes(lg));
    if (isLiturgical) {
      return {
        score,
        warnings,
        message: 'Saluto liturgico speciale (Natale, Pasqua, etc.)',
        detectedGreeting,
        isLiturgical: true
      };
    }

    // Se il saluto è neutro (es. "Buona domenica"), saltiamo il controllo orario.
    if (detectedTimeSlot === 'neutral') {
      return {
        score,
        warnings,
        message: 'Saluto neutro (OK indipendentemente dall\'orario)',
        detectedGreeting,
        detectedTimeSlot
      };
    }

    // Controlla congruenza saluto-orario
    if (detectedTimeSlot !== expectedTimeSlot) {
      const timeSlotNames = { morning: 'mattina', afternoon: 'pomeriggio', evening: 'sera' };
      warnings.push(
        `Saluto incongruente: "${detectedGreeting}" usato alle ore ${currentHour}:00 ` +
        `(dovrebbe essere ${timeSlotNames[expectedTimeSlot]})`
      );
      score *= 0.95; // Penalità lieve (errore di cortesia, non sostanziale)

      return {
        score,
        warnings,
        detectedGreeting,
        detectedTimeSlot,
        expectedTimeSlot,
        currentHour,
        canAutoFix: true
      };
    }

    return {
      score,
      warnings,
      message: 'Saluto congruente con orario',
      detectedGreeting,
      detectedTimeSlot,
      expectedTimeSlot,
      currentHour
    };
  }

  /**
   * Controllo 9: coerenza temporale tra date esplicite e modo in cui sono qualificate.
   * Il prompt ragiona per obiettivo; qui usiamo pattern conservativi solo come rete di sicurezza.
   */
  _checkTemporalConsistency(response, detectedLanguage, temporalContext = null) {
    const errors = [];
    const warnings = [];
    const currentDate = this._resolveTemporalCurrentDate_(temporalContext);
    if (!currentDate) {
      return { score: 1.0, errors, warnings, violations: [], skipped: true };
    }

    const dates = this._extractExplicitDates_(response, currentDate);
    if (!dates.length) {
      return { score: 1.0, errors, warnings, violations: [], checkedDates: 0 };
    }

    const todayOrdinal = this._dateOnlyOrdinal_(currentDate);
    const violations = [];

    dates.forEach((item) => {
      if (!item || !item.date || this._dateOnlyOrdinal_(item.date) <= todayOrdinal) return;

      const windowText = this._extractTemporalWindow_(response, item.index, item.length);
      if (this._hasPastTemporalQualification_(windowText, detectedLanguage)) {
        violations.push({
          dateText: item.text,
          date: this._formatDateOnly_(item.date),
          context: windowText.replace(/\s+/g, ' ').trim().substring(0, 180)
        });
      }
    });

    if (violations.length > 0) {
      errors.push(
        `Incoerenza temporale: una data futura (${violations[0].dateText}) è presentata come evento già passato o concluso.`
      );
      return { score: 0.0, errors, warnings, violations, checkedDates: dates.length };
    }

    return { score: 1.0, errors, warnings, violations, checkedDates: dates.length };
  }

  _checkCurrentPopeReferences(response, knowledgeBase = '', originalContext = '', temporalContext = null) {
    const errors = [];
    const warnings = [];
    let score = 1.0;

    const sourceText = [knowledgeBase, originalContext].filter(Boolean).join('\n');
    const papalContext = this._getCurrentPopeContext_(sourceText);
    const currentDate = this._resolveTemporalCurrentDate_(temporalContext) || new Date();
    const transitionDate = this._parseDateOnly_(papalContext.currentSince);
    if (transitionDate && currentDate && currentDate < transitionDate) {
      return { score, errors, warnings, checked: false, reason: 'before_current_pontificate' };
    }

    const text = String(response || '');
    const stalePopeNames = this._findStalePresentPopeReferences_(text, papalContext.currentName);
    if (stalePopeNames.length > 0) {
      const staleLabel = stalePopeNames.join(', ');
      errors.push(
        `Riferimento papale non aggiornato: ${staleLabel} è citato in presente come Papa attuale; il Papa attuale è ${papalContext.currentName}.`
      );
      score = 0.0;
    } else if (papalContext.previousName) {
      const escapedPrev = String(papalContext.previousName)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prevRx = new RegExp('\\b' + escapedPrev + '\\b', 'i');
      if (prevRx.test(text) && !prevRx.test(sourceText)) {
        warnings.push(`Citazione di ${papalContext.previousName} non presente nelle fonti della risposta.`);
        score *= 0.85;
      }
    }

    return {
      score,
      errors,
      warnings,
      currentPope: papalContext.currentName,
      previousPope: papalContext.previousName,
      currentSince: papalContext.currentSince,
      stalePopeNames: stalePopeNames
    };
  }

  _getCurrentPopeContext_(sourceText = '') {
    const fromSources = this._extractPapalContextFromText_(sourceText);
    const cfg = (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.PAPAL_CONTEXT)
      ? CONFIG.PAPAL_CONTEXT
      : {};
    return {
      currentName: fromSources.currentName || cfg.currentName || (typeof CONFIG !== 'undefined' && CONFIG.CURRENT_POPE_NAME) || 'Leone XIV',
      previousName: fromSources.previousName || cfg.previousName || (typeof CONFIG !== 'undefined' && CONFIG.PREVIOUS_POPE_NAME) || 'Papa Francesco',
      currentSince: cfg.currentSince || (typeof CONFIG !== 'undefined' && CONFIG.CURRENT_POPE_SINCE) || '2025-05-08'
    };
  }

  _extractPapalContextFromText_(sourceText = '') {
    const result = {};
    const text = String(sourceText || '');
    if (!text) return result;

    const lines = text.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      if (!line || !/(papa|pontefice)\s+(regnante|attuale|precedente|emerito)/i.test(line)) continue;

      const cells = line.split(/\t|\s*\|\s*/).map(cell => cell.trim()).filter(Boolean);
      const currentIndex = cells.findIndex(cell => /^(?:papa|pontefice)\s+(?:regnante|attuale)$/i.test(cell));
      if (currentIndex >= 0 && cells[currentIndex + 1]) {
        result.currentName = this._cleanPopeName_(cells[currentIndex + 1]);
        if (result.currentName) return result;
      }

      const previousIndex = cells.findIndex(cell => /^(?:papa|pontefice)\s+(?:precedente|emerito)$/i.test(cell));
      if (previousIndex >= 0 && cells[previousIndex + 1]) {
        result.previousName = this._cleanPopeName_(cells[previousIndex + 1]);
      }

      const currentInline = /\b(?:papa|pontefice)\s+(?:regnante|attuale)\s*(?:[:=\-]\s*)+(.+)$/i.exec(line);
      if (currentInline && currentInline[1]) {
        result.currentName = this._cleanPopeName_(currentInline[1]);
        if (result.currentName) return result;
      }
    }

    return result;
  }

  _findStalePresentPopeReferences_(responseText, currentPopeName) {
    const text = String(responseText || '');
    const staleNames = [];
    const addName = (rawName) => {
      const name = this._cleanPopeName_(rawName);
      if (!name || this._samePopeName_(name, currentPopeName)) return;
      if (!staleNames.some(existing => this._samePopeName_(existing, name))) {
        staleNames.push(name);
      }
    };

    const verbs = '(?:invita|ricorda|esorta|chiede|incoraggia|sollecita|insegna|sottolinea|richiama)';
    const popeNamePattern = "[A-ZÀ-ÖØ-Ý][\\wÀ-ÖØ-öø-ÿ'’.-]*(?:\\s+[A-Z0-9IVXLCDMÀ-ÖØ-Ý][\\wÀ-ÖØ-öø-ÿ'’.-]*){0,4}";
    const titleThenVerb = new RegExp(
      '\\b(?:Papa|Pontefice|Santo\\s+Padre)\\s+(' + popeNamePattern + ')\\s+(?:ci\\s+)?' + verbs + '\\b',
      'g'
    );
    const currentTitle = new RegExp('\\b(?:attuale\\s+(?:Papa|Pontefice)|Papa\\s+attuale)\\s+(' + popeNamePattern + ')\\b', 'g');
    const nameIsPope = new RegExp('\\b(' + popeNamePattern + ')\\s+(?:è|e\')\\s+(?:l[\'’]?\\s*)?(?:attuale\\s+)?(?:Papa|Pontefice)\\b', 'g');

    let match;
    while ((match = titleThenVerb.exec(text)) !== null) addName(match[1]);
    while ((match = currentTitle.exec(text)) !== null) addName(match[1]);
    while ((match = nameIsPope.exec(text)) !== null) addName(match[1]);

    return staleNames;
  }

  _cleanPopeName_(value) {
    const verbs = '(?:invita|ricorda|esorta|chiede|incoraggia|sollecita|insegna|sottolinea|richiama)';
    const cleaned = String(value || '')
      .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
      .replace(/^(?:papa|pontefice|santo\s+padre)\s+/i, '')
      .replace(new RegExp('\\s+(?:ci\\s+)?' + verbs + '\\b.*$', 'i'), '')
      .replace(/\s+(?:è|e')\s+(?:l['’]?\s*)?(?:attuale\s+)?(?:Papa|Pontefice).*$/i, '')
      .replace(/[.;,].*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return /^[A-Za-zÀ-ÖØ-öø-ÿ]/.test(cleaned) ? cleaned : '';
  }

  _samePopeName_(left, right) {
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^(?:papa|pontefice|santo\s+padre)\s+/i, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return normalize(left) === normalize(right);
  }

  _resolveTemporalCurrentDate_(temporalContext) {
    let value = null;
    if (temporalContext instanceof Date || typeof temporalContext === 'string') {
      value = temporalContext;
    } else if (temporalContext && typeof temporalContext === 'object') {
      value = temporalContext.currentDate || temporalContext.today || temporalContext.messageDate || null;
    }

    if (!value) {
      if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
        try {
          value = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd');
        } catch (_) {
          value = null;
        }
      }
      if (!value) value = new Date();
    }

    return this._parseDateOnly_(value);
  }

  _parseDateOnly_(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0);
    }

    const source = String(value || '').trim();
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(source);
    if (match) {
      return this._makeDateOnly_(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10));
    }

    const parsed = new Date(source);
    if (!isNaN(parsed.getTime())) {
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0);
    }
    return null;
  }

  _makeDateOnly_(year, month, day) {
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day, 12, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  _dateOnlyOrdinal_(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  }

  _formatDateOnly_(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  _stripDiacritics_(value) {
    try {
      return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (_) {
      return String(value || '');
    }
  }

  _monthNameMap_() {
    return {
      gennaio: 1, gen: 1, january: 1, jan: 1, enero: 1, janvier: 1, janeiro: 1, januar: 1,
      febbraio: 2, feb: 2, february: 2, febrero: 2, fevrier: 2, fevereiro: 2, februar: 2,
      marzo: 3, mar: 3, march: 3, mars: 3, marco: 3, marz: 3, maerz: 3,
      aprile: 4, apr: 4, april: 4, abril: 4, avril: 4,
      maggio: 5, mag: 5, may: 5, mayo: 5, mai: 5, maio: 5,
      giugno: 6, giu: 6, june: 6, jun: 6, junio: 6, juin: 6, junho: 6, juni: 6,
      luglio: 7, lug: 7, july: 7, jul: 7, julio: 7, juillet: 7, julho: 7, juli: 7,
      agosto: 8, ago: 8, august: 8, aug: 8, aout: 8,
      settembre: 9, set: 9, september: 9, sep: 9, septiembre: 9, septembre: 9, setembro: 9,
      ottobre: 10, ott: 10, october: 10, oct: 10, octubre: 10, octobre: 10, outubro: 10, oktober: 10, okt: 10,
      novembre: 11, nov: 11, november: 11, noviembre: 11, novembro: 11,
      dicembre: 12, dic: 12, december: 12, dec: 12, diciembre: 12, decembre: 12, dezembro: 12, dezember: 12, dez: 12
    };
  }

  _extractExplicitDates_(text, referenceDate) {
    const source = String(text || '');
    const normalized = this._stripDiacritics_(source).toLowerCase();
    const monthMap = this._monthNameMap_();
    const dates = [];
    const seen = new Set();
    const referenceYear = referenceDate ? referenceDate.getFullYear() : new Date().getFullYear();

    const addDate = (year, month, day, index, length, textValue) => {
      const date = this._makeDateOnly_(year, month, day);
      if (!date || index < 0) return;
      const key = `${index}:${this._formatDateOnly_(date)}`;
      if (seen.has(key)) return;
      seen.add(key);
      dates.push({ date, index, length, text: textValue || source.substring(index, index + length) });
    };

    let match;
    const iso = /\b(20\d{2})-(0?[1-9]|1[0-2])-([0-2]?\d|3[01])\b/g;
    while ((match = iso.exec(normalized)) !== null) {
      addDate(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10), match.index, match[0].length, source.substring(match.index, match.index + match[0].length));
    }

    const numeric = /\b([0-2]?\d|3[01])[\/.-](0?[1-9]|1[0-2])[\/.-](20\d{2})\b/g;
    while ((match = numeric.exec(normalized)) !== null) {
      addDate(parseInt(match[3], 10), parseInt(match[2], 10), parseInt(match[1], 10), match.index, match[0].length, source.substring(match.index, match.index + match[0].length));
    }

    const dayMonthYear = /\b([0-2]?\d|3[01])(?:°|º|\.)?\s+(?:di\s+|de\s+|del\s+|d['’]\s*)?([a-z]{3,15})\.?\s+(20\d{2})\b/g;
    while ((match = dayMonthYear.exec(normalized)) !== null) {
      const month = monthMap[match[2]];
      if (month) addDate(parseInt(match[3], 10), month, parseInt(match[1], 10), match.index, match[0].length, source.substring(match.index, match.index + match[0].length));
    }

    const monthDayYear = /\b([a-z]{3,15})\.?\s+([0-2]?\d|3[01])(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/g;
    while ((match = monthDayYear.exec(normalized)) !== null) {
      const month = monthMap[match[1]];
      if (month) addDate(parseInt(match[3], 10), month, parseInt(match[2], 10), match.index, match[0].length, source.substring(match.index, match.index + match[0].length));
    }

    const dayMonth = /\b([0-2]?\d|3[01])(?:°|º|\.)?\s+(?:di\s+|de\s+|del\s+|d['’]\s*)?([a-z]{3,15})\.?\b/g;
    while ((match = dayMonth.exec(normalized)) !== null) {
      const trailing = normalized.substring(match.index + match[0].length, match.index + match[0].length + 8);
      const month = monthMap[match[2]];
      if (month && !/\s*20\d{2}/.test(trailing)) {
        addDate(referenceYear, month, parseInt(match[1], 10), match.index, match[0].length, source.substring(match.index, match.index + match[0].length));
      }
    }

    return dates.sort((a, b) => a.index - b.index);
  }

  _extractTemporalWindow_(text, index, length) {
    const source = String(text || '');
    const before = source.substring(0, index);
    const previousBoundaries = ['.', '!', '?', '\n'].map(token => before.lastIndexOf(token));
    const previousBoundary = Math.max.apply(null, previousBoundaries);
    const start = previousBoundary >= 0 ? previousBoundary + 1 : Math.max(0, index - 180);

    const afterStart = index + (length || 0);
    const after = source.substring(afterStart);
    const nextBoundaries = ['.', '!', '?', '\n']
      .map(token => after.indexOf(token))
      .filter(pos => pos >= 0);
    const nextBoundary = nextBoundaries.length > 0 ? Math.min.apply(null, nextBoundaries) : -1;
    const end = nextBoundary >= 0 ? afterStart + nextBoundary + 1 : Math.min(source.length, afterStart + 180);

    return source.substring(start, end);
  }

  _hasPastTemporalQualification_(text, detectedLanguage) {
    const source = this._stripDiacritics_(String(text || '').toLowerCase());
    const patterns = [
      /\bsi\s+e\s+(?:gia\s+)?(?:tenut|svolt|celebrat|conclus|terminat|chius)\w*/i,
      /\b(?:e|risulta|resta)\s+gia\s+(?:conclus|terminat|svolt|tenut|passat)\w*/i,
      /\b(?:ha|hanno)\s+(?:gia\s+)?(?:avuto luogo|concluso|terminato)\b/i,
      /\b(?:was|were)\s+(?:already\s+)?(?:held|celebrated|concluded|completed)\b/i,
      /\bhas\s+already\s+(?:taken place|been held|concluded|finished|ended)\b/i,
      /\b(?:se\s+)?(?:celebro|realizo|concluyo|termino)\b/i,
      /\bya\s+(?:se\s+)?(?:celebro|realizo|concluyo|termino|ha\s+terminado)\b/i,
      /\b(?:ja\s+)?(?:se\s+)?(?:realizou|celebrou|concluiu|terminou)\b/i,
      /\bja\s+(?:esta|foi)\s+(?:concluido|terminado|realizado|celebrado)\b/i,
      /\bs['’]?est\s+(?:tenu|deroule|termine|conclu)\w*/i,
      /\ba\s+(?:deja\s+)?(?:eu lieu|ete celebre|ete conclu|ete termine)\b/i,
      /\b(?:hat|haben)\s+(?:bereits\s+)?(?:stattgefunden|geendet)\b/i,
      /\b(?:wurde|wurden|ist|sind)\s+(?:bereits\s+)?(?:abgehalten|gefeiert|abgeschlossen|beendet)\b/i
    ];

    return patterns.some(pattern => pattern.test(source));
  }

  // ========================================================================
  // METODI DI RAFFINAMENTO AUTOMATICO (QUALITY ENHANCEMENT)
  // ========================================================================

  /**
   * Tenta di correggere automaticamente gli errori rilevati
   */
  _perfezionamentoAutomatico(response, errors, language) {
    let textPerfezionato = response;
    let modified = false;

    const applicaOttimizzazione = (label, optimizer) => {
      try {
        const optimizedText = optimizer(textPerfezionato);
        if (optimizedText !== textPerfezionato) {
          textPerfezionato = optimizedText;
          modified = true;
          console.log(`   ✨ Ottimizzazione ${label} applicata`);
        }
      } catch (e) {
        const message = e && e.message ? e.message : String(e);
        console.warn(`   ⚠️ Ottimizzazione ${label} saltata: ${message}`);
      }
    };

    // 1. Perfezionamento Link duplicati (Markdown)
    // Cerca [url](url) o [url](url...) e semplifica
    applicaOttimizzazione('Link', (currentText) => this._ottimizzaLinkDuplicati(currentText));

    // 2. Perfezionamento Maiuscole dopo virgola
    // Applicabile solo se non è un errore di Thinking Leak (che richiede rigenerazione)
    // e se non ci sono placeholder
    if (!errors.some(e => e.includes('RAGIONAMENTO ESPOSTO') || e.includes('placeholder'))) {
      applicaOttimizzazione('Maiuscole', (currentText) => this._ottimizzaCapitalAfterComma(currentText, language));
    }

    // 3. Perfezionamento Saluto temporalmente incongruente
    if (!errors.some(e => e.includes('RAGIONAMENTO ESPOSTO') || e.includes('placeholder'))) {
      applicaOttimizzazione('Saluto', (currentText) => this._ottimizzaSalutoTemporale(currentText, language));
    }

    return { fixed: modified, text: textPerfezionato };
  }

  /**
   * Ottimizza link markdown ridondanti
   * Es. [https://example.com](https://example.com) -> https://example.com
   */
  _ottimizzaLinkDuplicati(text) {
    // Caso 1: [URL](URL) -> URL
    // Regex cattura: [ (gruppo1) ] ( (gruppo2) )
    // Verifica se gruppo1 == gruppo2 (o molto simile)
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
      if (label.trim() === url.trim()) {
        return url; // Ritorna solo l'URL
      }
      return match;
    });
  }

  /**
   * Corregge saluto temporalmente incongruente
   * Es. "Buongiorno" alle 20:00 → "Buonasera"
   */
  _ottimizzaSalutoTemporale(text, language) {
    if (!this.greetingPatterns[language]) return text;

    // Determina fascia oraria corrente (fuso orario italiano)
    const currentHour = this._getCurrentHourInRome_();
    let correctTimeSlot;
    if (currentHour >= 5 && currentHour < 13) {
      correctTimeSlot = 'morning';
    } else if (currentHour >= 13 && currentHour < 19) {
      correctTimeSlot = 'afternoon';
    } else {
      correctTimeSlot = 'evening';
    }

    // Ottieni saluto corretto per l'orario
    const correctGreeting = this.greetingPatterns[language][correctTimeSlot][0];
    const correctGreetingCapitalized = correctGreeting.charAt(0).toUpperCase() + correctGreeting.slice(1);

    // Cerca saluto errato nei primi 80 caratteri
    const firstPart = text.substring(0, 80);
    let fixedText = text;

    // Itera su tutte le fasce orarie per trovare saluti errati
    const patterns = this.greetingPatterns[language];
    for (const [timeSlot, greetings] of Object.entries(patterns)) {
      if (timeSlot === correctTimeSlot) continue; // Salta la fascia corretta

      for (const greeting of greetings) {
        const regex = new RegExp(`^(\\s*[\\*#]*\\s*)(${this._escapeRegex(greeting)})\\b`, 'i');
        const match = firstPart.match(regex);

        if (match) {
          const originalGreeting = match[2] || match[0];
          if (!originalGreeting) return fixedText;
          let replacement;

          // Preserva capitalizzazione originale
          if (originalGreeting === originalGreeting.toUpperCase()) {
            replacement = correctGreetingCapitalized.toUpperCase();
          } else if (originalGreeting[0] === originalGreeting[0].toUpperCase()) {
            replacement = correctGreetingCapitalized;
          } else {
            replacement = correctGreeting;
          }

          // Sostituisci solo la prima occorrenza all'inizio
          fixedText = text.replace(regex, `$1${replacement}`);
          console.log(`   🔍 Saluto "${originalGreeting}" → "${replacement}" (ore ${currentHour}:00)`);
          return fixedText;
        }
      }
    }

    return fixedText;
  }

  _getCurrentHourInRome_() {
    if (
      typeof Utilities !== 'undefined' &&
      Utilities &&
      typeof Utilities.formatDate === 'function'
    ) {
      const parsedHour = parseInt(Utilities.formatDate(new Date(), 'Europe/Rome', 'HH'), 10);
      if (Number.isInteger(parsedHour) && parsedHour >= 0 && parsedHour <= 23) {
        return parsedHour;
      }
    }

    const fallbackHour = new Date().getHours();
    return Number.isInteger(fallbackHour) && fallbackHour >= 0 && fallbackHour <= 23
      ? fallbackHour
      : 12;
  }

  /**
   * Corregge maiuscole post-virgola per parole vietate
   */
  _ottimizzaCapitalAfterComma(text, language) {
    // Ri-utilizza la lista delle parole vietate appropriata in base alla lingua
    let targets = [];

    // Definiamo le regole per lingua
    if (language === 'it') {
      targets = ITALIAN_FORBIDDEN_CAPS;
    } else if (language === 'en') {
      // Lista minima per inglese
      targets = ['The', 'An', 'For', 'With', 'On', 'At', 'If', 'Or', 'And', 'But', 'To', 'In'];
    } else if (language === 'es') {
      // Lista minima per spagnolo
      targets = ['Estamos', 'Somos', 'El', 'Los', 'Las', 'Una', 'Por', 'En', 'De', 'Pero', 'Que'];
    } else if (language === 'pt') {
      // Lista minima per portoghese
      targets = ['Estamos', 'Somos', 'Uma', 'Por', 'Com', 'De', 'Que', 'Para', 'Em'];
    } else if (language === 'fr') {
      targets = ['Le', 'La', 'Les', 'Un', 'Une', 'Des', 'Et', 'Ou', 'Mais',
                 'Pour', 'Dans', 'Sur', 'Par', 'Avec', 'Nous', 'Vous', 'Ils'];
    } else {
      // Se lingua sconosciuta o non supportata, NON applicare correzioni rischiose
      console.log(`   ⚠️ Correzione automatica maiuscole disabilitata per lingua '${language}'`);
      return text;
    }

    const capitalizationExceptions = ['Dio', 'Gesù', 'Maria', 'Santo', 'Padre', 'Lei', 'La', 'Ella'];
    let result = text;

    // Per ogni parola vietata, cerca ", Parola" e sostituisci con ", parola"
    // Usa lookahead negativo per evitare match parziali anche con apostrofi finali (es. "E'" / "E\u2019")
    // Ma rispetta i nomi doppi: non correggere se seguito da altra maiuscola
    targets.forEach(word => {
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const apostropheAgnosticWord = escapedWord.replace(/'/g, "['\u2019]");
      const regex = new RegExp(`,(\\s+)(${apostropheAgnosticWord})(?!['\\u2019])(?![\\wÀ-ÖØ-öø-ÿ])(?!\\s+[A-ZÀÈÉÌÒÙ])`, 'g');
      result = result.replace(regex, (fullMatch, sep, p1) => {
        if (capitalizationExceptions.includes(p1)) {
          return fullMatch;
        }
        return `,${sep}${p1.toLowerCase()}`;
      });
    });

    return result;
  }

  /**
   * Escape metacaratteri per uso sicuro in RegExp
   */
  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Rimuove ragionamento esposto (thinking leak) in modo robusto
   */
  _rimuoviThinkingLeak(text) {
    let cleaned = text;

    // Rimuove prefissi meta-ragionamento comuni in apertura frase
    // senza attendere rigenerazione completa.
    cleaned = cleaned.replace(
      /^(?:in base alla knowledge base|consultando i dati|consultando la knowledge base|rivedendo le istruzioni),?\s*/i,
      ''
    );

    // Usa thinkingPatterns come sorgente per le keyword di ragionamento
    const keywords = this.thinkingPatterns || [];
    keywords.forEach(kw => {
      const escaped = this._escapeRegex(kw);
      const regex = new RegExp(`(^|[\\s.,;!?])${escaped}[^.?!]*[.?!]`, 'gi');
      cleaned = cleaned.replace(regex, '$1');
    });
    return cleaned.trim();
  }

  // ========================================================================
  // METODI UTILITÀ
  // ========================================================================

  /**
   * Ottieni statistiche configurazione validatore
   */
  getValidationStats() {
    return {
      minValidScore: this.MIN_VALID_SCORE,
      minLength: this.MIN_LENGTH_CHARS,
      maxLengthWarning: this.WARNING_MAX_LENGTH,
      forbiddenPhrasesCount: this.forbiddenPhrases.length,
      supportedLanguages: Object.keys(this.languageMarkers),
      placeholdersCount: this.placeholders.length
    };
  }
}

// Funzione factory per compatibilità
function createResponseValidator() {
  return new ResponseValidator();
}

/**
 * SemanticValidator.gs - Validazione semantica con Gemini
 *
 * FILOSOFIA:
 * - Usato SOLO quando regex non è sicura (score < soglia)
 * - Chiamate API leggere
 * - Fallback automatico a regex se API fallisce
 * - Cache risultati (stesso thread)
 */
var SemanticValidator = class SemanticValidator {
  constructor() {
    console.log('🧠 Inizializzazione SemanticValidator...');

    const semanticConfig = typeof CONFIG !== 'undefined' && CONFIG.SEMANTIC_VALIDATION
      ? CONFIG.SEMANTIC_VALIDATION
      : {};

    this.enabled = semanticConfig.enabled === true;
    this.activationThreshold = semanticConfig.activationThreshold ?? 0.9;
    this.cacheEnabled = semanticConfig.cacheEnabled !== false;
    this.cacheTTL = semanticConfig.cacheTTL ?? 300;
    this.taskType = semanticConfig.taskType || 'semantic';
    this.fallbackOnError = semanticConfig.fallbackOnError !== false;
    this.maxRetries = semanticConfig.maxRetries ?? 1;
    this.runtimeSemanticAvailable = typeof UrlFetchApp !== 'undefined';
    this.geminiService = null;
    this.cache = (
      this.cacheEnabled &&
      typeof CacheService !== 'undefined' &&
      CacheService &&
      typeof CacheService.getScriptCache === 'function'
    )
      ? CacheService.getScriptCache()
      : null;

    console.log('✓ SemanticValidator inizializzato');
  }

  shouldRun(validationScore) {
    return this.enabled && validationScore < this.activationThreshold;
  }

  /**
   * Valida allucinazioni usando similitudine semantica
   */
  validateHallucinations(response, knowledgeBase, regexResult, emailContent) {
    if (!this.runtimeSemanticAvailable) {
      return {
        isValid: regexResult.score >= 0.6,
        confidence: regexResult.score,
        skipped: true,
        reason: 'Validazione semantica non disponibile nel runtime corrente (UrlFetchApp mancante)'
      };
    }

    if (!this.shouldRun(regexResult.score) && regexResult.errors.length === 0) {
      console.log('   ⚠ Validazione semantica allucinazioni ignorata (alta confidenza base)');
      return { isValid: true, confidence: regexResult.score, skipped: true };
    }

    console.log('   🧠 Eseguo validazione semantica allucinazioni...');

    try {
      const cacheMaterial = [
        response || '',
        knowledgeBase || '',
        emailContent || ''
      ].join('\n<<SEMANTIC-HALLUCINATION-SCOPE>>\n');
      const cacheKey = this._cacheKey('halluc', cacheMaterial);
      const cached = this._readCache(cacheKey);
      if (cached) return cached;

      const prompt = this._buildHallucinationPrompt(response, knowledgeBase, emailContent);
      const apiResponse = this._generateSemantic(prompt);
      const result = this._parseSemanticResponse(apiResponse);
      this._writeCache(cacheKey, result);
      return result;
    } catch (error) {
      console.warn(`⚠️ API Semantica fallita: ${error.message}`);
      if (!this.fallbackOnError) throw error;
      return {
        isValid: regexResult.score >= 0.6,
        confidence: regexResult.score,
        fallback: true,
        error: error.message
      };
    }
  }

  /**
   * Valida leak di pensiero usando comprensione semantica
   */
  validateThinkingLeak(response, regexResult) {
    if (!this.runtimeSemanticAvailable) {
      const fallbackThreshold = 0.85;
      return {
        isValid: regexResult.score >= fallbackThreshold,
        confidence: regexResult.score,
        fallback: true,
        skipped: true,
        reason: 'Validazione semantica del pensiero non disponibile nel runtime corrente (UrlFetchApp mancante)'
      };
    }

    if (!this.shouldRun(regexResult.score)) {
      return { isValid: true, confidence: regexResult.score, skipped: true };
    }

    console.log('   🧠 Eseguo validazione semantica ragionamento esposto...');

    try {
      const cacheKey = this._cacheKey('thinking', response);
      const cached = this._readCache(cacheKey);
      if (cached) return cached;

      const prompt = this._buildThinkingLeakPrompt(response);
      const apiResponse = this._generateSemantic(prompt);
      const result = this._parseSemanticResponse(apiResponse);
      this._writeCache(cacheKey, result);
      return result;
    } catch (error) {
      console.warn(`⚠️ Validazione semantica ragionamento esposto fallita: ${error.message}`);
      if (!this.fallbackOnError) throw error;
      const fallbackThreshold = 0.85;
      return {
        isValid: regexResult.score >= fallbackThreshold,
        confidence: regexResult.score,
        fallback: true,
        reason: `Validazione semantica ragionamento esposto non disponibile: ${error.message || 'errore sconosciuto'}`
      };
    }
  }

  // ========================================================================
  // COSTRUTTORI PROMPT (ottimizzati per brevità)
  // ========================================================================

  _buildHallucinationPrompt(response, knowledgeBase, emailContent) {
    const kbTruncated = knowledgeBase && knowledgeBase.length > 2000
      ? knowledgeBase.substring(0, 2000) + '...[TRUNCATED]'
      : knowledgeBase;
    const emailTruncated = emailContent && emailContent.length > 2000
      ? emailContent.substring(0, 2000) + '...[TRUNCATED]'
      : emailContent;

    return `Sei un validatore. Verifica se la RISPOSTA contiene informazioni NON presenti nella BASE CONOSCENZA o nell'EMAIL ORIGINALE.

BASE CONOSCENZA (fonte verità):
"""
${kbTruncated || ''}
"""

EMAIL ORIGINALE:
"""
${emailTruncated || ''}
"""

RISPOSTA DA VALIDARE:
"""
${response}
"""

COMPITO:
Estrai dalla RISPOSTA:
1. Orari menzionati (formato HH:MM)
2. Email menzionate
3. Numeri telefono menzionati

Per ciascuno, verifica se è presente (anche con sinonimi/varianti) nella BASE CONOSCENZA o nell'EMAIL ORIGINALE.

Rispondi SOLO con questo JSON (senza markdown):
{
  "hallucinations": {
    "times": ["10:30", "18:00"],
    "emails": ["fake@test.com"],
    "phones": ["1234567890"]
  },
  "isValid": true,
  "confidence": 0.95,
  "reason": "Tutti gli orari sono presenti nella KB con varianti simili"
}`;
  }

  _buildThinkingLeakPrompt(response) {
    return `Sei un validatore. Verifica se la RISPOSTA espone ragionamento interno dell'AI.

RISPOSTA:
"""
${response}
"""

THINKING LEAK = frasi che mostrano il processo di pensiero dell'AI, come:
- "Consultando la knowledge base..."
- "Rivedendo le istruzioni..."
- "Devo correggere..."
- "La KB dice che..."
- "Secondo le linee guida interne..."
- "Verificando i dati forniti..."

Rispondi SOLO con questo JSON (senza markdown):
{
  "thinkingLeakDetected": false,
  "examples": [],
  "isValid": true,
  "confidence": 0.98,
  "reason": "La risposta è naturale, senza meta-commenti"
}`;
  }

  // ========================================================================
  // PARSING E UTILITY
  // ========================================================================

  _generateSemantic(prompt) {
    if (!this.geminiService) {
      if (typeof GeminiService !== 'function') {
        throw new Error('GeminiService non disponibile per validazione semantica');
      }
      this.geminiService = new GeminiService();
    }

    const estimatedTokens = estimateTokenCount(prompt);

    if (this.geminiService.useRateLimiter && this.geminiService.rateLimiter) {
      const result = this.geminiService.rateLimiter.executeRequest(
        this.taskType,
        (modelName) => this.geminiService._generateWithModel(prompt, modelName),
        {
          estimatedTokens: estimatedTokens
        }
      );

      if (result && result.success) {
        console.log(`✓ Semantic via Rate Limiter (modello: ${result.modelUsed})`);
        return result.result;
      }
    }

    const semanticModelName = typeof this.geminiService.getModelNameForTask === 'function'
      ? this.geminiService.getModelNameForTask(this.taskType, 'gemini-3.1-flash-lite')
      : (this.geminiService.modelName || 'gemini-3.1-flash-lite');

    return this.geminiService._withRetry(
      () => this.geminiService._generateWithModel(prompt, semanticModelName),
      'Semantic validation',
      this.maxRetries
    );
  }

  _parseSemanticResponse(apiResponse) {
    try {
      if (typeof parseGeminiJsonLenient === 'function') {
        const parsed = parseGeminiJsonLenient(apiResponse);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('JSON semantico vuoto o non-oggetto');
        }
        return this._normalizeSemanticPayload(parsed);
      }

      let cleaned = apiResponse
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('JSON semantico vuoto o non-oggetto');
      }
      return this._normalizeSemanticPayload(parsed);
    } catch (error) {
      console.error(`❌ Errore nel parse della risposta semantica: ${error.message}`);
      throw new Error('JSON non valido dal validatore semantico');
    }
  }

  _normalizeSemanticPayload(parsed) {
    const payload = parsed && typeof parsed === 'object' ? parsed : {};
    const examples = Array.isArray(payload.examples) ? payload.examples : [];
    const hallucinations = payload.hallucinations && typeof payload.hallucinations === 'object'
      ? payload.hallucinations
      : null;
    const hasHallucinations = !!hallucinations && Object.values(hallucinations).some((value) => {
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === 'object') return Object.keys(value).length > 0;
      return Boolean(value);
    });
    const hasThinkingLeak =
      payload.thinkingLeakDetected === true ||
      examples.length > 0;

    const normalizedIsValid = (typeof payload.isValid === 'boolean')
      ? payload.isValid
      : !(hasThinkingLeak || hasHallucinations);
    const rawConfidence = Number(payload.confidence);
    const confidence = Number.isFinite(rawConfidence) ? rawConfidence : 0.5;

    return {
      isValid: normalizedIsValid,
      confidence: Math.max(0, Math.min(confidence, 1.0)),
      details: hallucinations || examples || {},
      reason: payload.reason || 'Nessuna motivazione fornita'
    };
  }

  _cacheKey(prefix, text) {
    return `${prefix}_${this._hashText(text)}`;
  }

  _readCache(cacheKey) {
    if (!this.cache) return null;
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;
    try {
      return JSON.parse(cached);
    } catch (error) {
      console.warn(`⚠️ Cache semantica corrotta per key ${cacheKey}: ${error.message}`);
      try {
        this.cache.remove(cacheKey);
      } catch (_) {}
      return null;
    }
  }

  _writeCache(cacheKey, value) {
    if (!this.cache) return;
    this.cache.put(cacheKey, JSON.stringify(value), this.cacheTTL);
  }

  _hashText(text) {
    // Campiona inizio+fine per ridurre collisioni su testi lunghi ma simili
    const sample = text.length > 500 ? text.slice(0, 250) + text.slice(-250) : text;
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < sample.length; i++) {
      const ch = sample.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    return `${text.length}_${Math.abs(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
  }
}

function createSemanticValidator() {
  return new SemanticValidator();
}
