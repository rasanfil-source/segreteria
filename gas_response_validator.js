/**
 * ResponseValidator.gs - Validazione risposte AI
 * Controlla qualità e sicurezza delle risposte generate
 * 
 * CONTROLLI CRITICI:
 * ✅ Lunghezza (troppo corta/lunga = UX negativa)
 * ✅ Consistenza lingua (critico per multilingua)
 * ✅ Frasi vietate (indicatori allucinazione)
 * ✅ Placeholder (risposta incompleta)
 * ✅ Firma obbligatoria (identità brand)
 * ✅ Dati allucinati (email, telefoni, orari non in KB)
 * ✅ Ragionamento esposto (thinking leak)
 */
class ResponseValidator {
  constructor() {
    console.log('🔍 Inizializzazione ResponseValidator...');

    // Ottieni config - fallback a default se CONFIG non definito
    // Soglia minima accettabile
    this.MIN_VALID_SCORE = typeof CONFIG !== 'undefined' && CONFIG.VALIDATION_MIN_SCORE
      ? CONFIG.VALIDATION_MIN_SCORE
      : 0.6;

    // Soglie lunghezza
    this.MIN_LENGTH_CHARS = 25;
    this.OPTIMAL_MIN_LENGTH = 80;
    this.WARNING_MAX_LENGTH = 3000;

    // Frasi vietate (indicatori di incertezza/allucinazione)
    this.forbiddenPhrases = [
      'non ho abbastanza informazioni',
      'non posso rispondere',
      'mi dispiace ma non',
      'scusa ma non',
      'purtroppo non posso',
      'non sono sicuro',
      'non sono sicura',
      'potrebbe essere',
      'probabilmente',
      'forse',
      'suppongo',
      'immagino'
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
    this.placeholders = ['XXX', 'TODO', '<insert>', 'placeholder', 'tbd', 'TBD'];

    // Pattern di ragionamento esposto (thinking leak) - CRITICO
    // Pattern di ragionamento esposto (thinking leak) - CRITICO
    // IBRIDO: Regex semantiche + pattern statici specifici
    this.thinkingRegexes = [
      /\b(devo|dovrei)\s+(correggere|modificare|aggiornare)\s+(la\s+risposta|il\s+prompt|il\s+testo)\b/i, // Meta-commenti AI (ristretto)
      /\b(knowledge base|kb)\s+(dice|afferma|contiene|riporta|indica)\b/i,                       // Riferimenti KB
      /\b(rivedendo|consultando|controllando|verificando)\s+(la\s+)?(knowledge base|kb)\b/i,     // Azioni su KB
      /\b(ho\s+)?dedott[oaie]?\b[^.\n]{0,120}\b(knowledge base|kb)\b/i                          // Deduzioni esplicite da KB
    ];

    this.thinkingPatterns = [
      // Pattern conversazionali non catturati dalle regex
      'rivedendo la knowledge base',
      'pensandoci bene',
      '(nota:',
      'nota:',
      'n.b.:',
      'nb:',
      'come da istruzioni',
      'secondo le linee guida',
      'le date del 202',
      'sono passate',
      'non sono ancora presenti'
    ];

    // Pattern firma (case-insensitive) - supporta multilingua
    this.signaturePatterns = [
      /segreteria\s+parrocchia\s+sant['\u2018\u2019]?eugenio/i,        // IT
      /parish\s+secretariat\s+(of\s+)?sant['\u2018\u2019]?eugenio/i,   // EN
      /secretar[ií]a\s+parroquial/i,                                   // ES
      /secretaria\s+par[oó]quia(l)?\s+sant['\u2018\u2019]?eugenio/i    // PT
    ];

    // Pattern saluti per fasce orarie (Controllo #8)
    this.greetingPatterns = {
      'it': {
        morning: ['buongiorno', 'buon giorno'],
        afternoon: ['buon pomeriggio'],
        evening: ['buonasera', 'buona sera']
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
      'de': ['frohe weihnachten', 'frohe ostern', 'schönen advent', 'frohe pfingsten']
    };

    // Semantic Validator (opzionale)
    const semanticEnabled = typeof CONFIG !== 'undefined' &&
      CONFIG.SEMANTIC_VALIDATION &&
      CONFIG.SEMANTIC_VALIDATION.enabled === true;
    this.semanticValidator = semanticEnabled ? new SemanticValidator() : null;

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
  validateResponse(response, detectedLanguage, knowledgeBase, emailContent, emailSubject, salutationMode = 'full', attemptPerfezionamento = true) {
    // GUARDRAIL: questo validator non deve "appiattire" la formattazione utile
    // (liste, paragrafi, enfasi) salvo casi di sicurezza/qualità espliciti.
    // Interventi aggressivi di normalizzazione qui possono degradare UX e leggibilità.
    const errors = [];
    const warnings = [];
    const details = {};
    let score = 1.0;

    // Variabile per gestire la risposta (che potrebbe essere perfezionata)
    let currentResponse = typeof response === 'string' ? response : (response == null ? '' : String(response));
    let wasRefined = false;

    const safeDetectedLanguage = typeof detectedLanguage === 'string' && detectedLanguage.length > 0
      ? detectedLanguage
      : 'it';
    console.log(`🔍 Validazione risposta (${currentResponse.length} caratteri, lingua=${safeDetectedLanguage})...`);

    // --- PRIMO PASSAGGIO DI VALIDAZIONE ---
    let validationResult = this._runValidationChecks(currentResponse, safeDetectedLanguage, knowledgeBase, salutationMode, emailContent);

    // --- AUTOCORREZIONE (PERFEZIONAMENTO) ---
    if (!validationResult.isValid && attemptPerfezionamento) {
      console.log('🩺 Tentativo perfezionamento automatico...');

      const perfezionamentoResult = this._perfezionamentoAutomatico(currentResponse, validationResult.errors, safeDetectedLanguage);

      if (perfezionamentoResult.fixed) {
        console.log('   ✨ Risposta perfezionata (migliorata qualità o rimozione allucinazioni)');
        currentResponse = perfezionamentoResult.text;
        wasRefined = true;

        // Ri-esegui validazione sul testo corretto
        validationResult = this._runValidationChecks(currentResponse, safeDetectedLanguage, knowledgeBase, salutationMode, emailContent);

        if (validationResult.isValid) {
          console.log('   ✅ Autocorrezione ha risolto i problemi!');
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
        console.warn('❌ Semantic validator ha rilevato problemi non catturati da regex');
        validationResult.isValid = false;
        validationResult.score = Math.min(validationResult.score, semanticConfidence);
        const semanticReason = semHalluc.reason || semThinking.reason || 'Semantic validation failed without explicit reason';
        validationResult.errors.push(`Semantic: ${semanticReason}`);
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
   * Esegue i ✅ effettivi (estratto per riutilizzo)
   */
  _runValidationChecks(response, detectedLanguage, knowledgeBase, salutationMode, originalMessage = '') {
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
    details.content = contentResult;
    score *= contentResult.score;

    // === CONTROLLO 5: Allucinazioni ===
    const hallucResult = this._checkHallucinations(response, knowledgeBase, originalMessage);
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
      warnings.push(`Risposta molto lunga (${length} caratteri, potrebbe essere prolissa)`);
      score *= 0.95;
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

    const responseLower = response.toLowerCase();

    // Rileva lingua attuale usando marcatori
    const markerScores = {};
    for (const lang in this.languageMarkers) {
      markerScores[lang] = this.languageMarkers[lang].reduce((count, marker) => {
        return count + (responseLower.includes(marker) ? 1 : 0);
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
    if (salutationMode === 'none_or_continuity') {
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
    let score = 1.0;

    const responseLower = response.toLowerCase();

    // Controlla frasi vietate (indicatori incertezza)
    const foundForbidden = this.forbiddenPhrases.filter(
      phrase => responseLower.includes(phrase)
    );

    if (foundForbidden.length > 0) {
      errors.push(`Contiene frasi di incertezza: ${foundForbidden.slice(0, 2).join(', ')}`);
      score *= 0.50;
    }

    // Rilevamento placeholder intelligente
    const foundPlaceholders = [];
    for (const p of this.placeholders) {
      if (!p || !p.trim()) continue; // Guardia difensiva: ignora stringhe vuote
      // Per '...', verifica se usato come placeholder (non ellissi nel testo)
      if (p === '...') {
        if (/\[\.\.\.]/g.test(response) || /\.\.\.\s*$/g.test(response)) {
          foundPlaceholders.push(p);
        }
      } else if (responseLower.includes(p.toLowerCase())) {
        foundPlaceholders.push(p);
      }
    }

    const bracketPlaceholderPattern = /\[[A-Z][A-Z0-9_\s-]{1,30}\]/g;
    const bracketPlaceholders = response.match(bracketPlaceholderPattern) || [];
    if (bracketPlaceholders.length > 0) {
      foundPlaceholders.push(...bracketPlaceholders); // no nesting
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

    return { score, errors, foundForbidden, foundPlaceholders };
  }

  /**
   * Controllo 5: Allucinazioni (dati inventati non in KB)
   */
  _checkHallucinations(response, knowledgeBase, originalMessage = '') {
    const errors = [];
    const warnings = [];
    let score = 1.0;
    const hallucinations = {};
    const safeKnowledgeBase = typeof knowledgeBase === 'string' ? knowledgeBase : '';

    // Helper normalizzazione orari
    const normalizeTime = (t) => {
      // Escludi pattern che potrebbero essere URL o nomi file
      if (/[a-z]{2,}\.\d{1,2}\.[a-z]{2,}/i.test(t)) return t;
      if (/\/([\w-]+\.\d{1,2}\.\w+)$/i.test(t)) return t;

      t = t.replace(/\b(\d{1,2})\.([0-5]\d)\b/g, (match, h, m) => {
        const hour = parseInt(h, 10);
        if (hour >= 0 && hour <= 23) return `${h}:${m}`;
        return match;
      });
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
    const timePattern = /(?<![a-z]\.)\b\d{1,2}[:.]\d{2}\b(?!\.[a-z])/gi;
    const timeOrHourPattern = /\b\d{1,2}(?:[:.]\d{2})?\b/g;
    const responseTimesRaw = [];
    let match;
    // Reset lastIndex per sicurezza se regex è globale
    timePattern.lastIndex = 0;
    while ((match = timePattern.exec(response)) !== null) {
      const timeStr = match[0];
      const index = match.index;
      // Controlla contesto (20 caratteri prima e dopo)
      const prefix = response.substring(Math.max(0, index - 20), index).toLowerCase();
      const suffix = response.substring(index + timeStr.length, Math.min(response.length, index + timeStr.length + 10)).toLowerCase();

      // Whitelist: Escludi indirizzi (es. "Civico 12.30" raro ma possibile intero, o "n. 10")
      if (/(?:via|viale|piazza|corso|largo|vicolo|civico|n\.|num\.|int\.|scala)\s*$/i.test(prefix)) {
        continue;
      }
      // Whitelist: Escludi prezzi (es. 10.50 euro)
      if (/^\s*(?:euro|\u20AC|eur)/i.test(suffix)) {
        continue;
      }
      // Whitelist: Escludi versetti biblici (es. Gv 10,10 o Mt 10.10)
      if (/(?:gv|mt|mc|lc|gen|es|lv|nm|dt|is|ger|ez)\.?\s*$/i.test(prefix)) {
        continue;
      }

      responseTimesRaw.push(timeStr);
    }
    const kbTimesRaw = safeKnowledgeBase.match(timePattern) || [];
    const originalTimesRaw = (originalMessage || '').match(timeOrHourPattern) || [];

    const responseTimes = new Set(responseTimesRaw.map(normalizeTime));
    const kbTimes = new Set(kbTimesRaw.map(normalizeTime));
    const originalTimes = new Set(originalTimesRaw.map(normalizeTime));
    const inventedTimes = [...responseTimes].filter(t => !kbTimes.has(t) && !originalTimes.has(t));

    if (inventedTimes.length > 0) {
      warnings.push(`Orari non in KB: ${inventedTimes.join(', ')}`);
      score *= 0.85;
      hallucinations.times = inventedTimes;
    }

    // === Controllo email ===
    // Punto 6: Protezione ReDoS con limite esplicito sulla parte locale dell'email
    const emailPattern = /\b[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,64})@[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/gi;
    const responseEmails = new Set(
      (response.match(emailPattern) || []).map(e => e.toLowerCase())
    );
    const kbEmails = new Set(
      (safeKnowledgeBase.match(emailPattern) || []).map(e => e.toLowerCase())
    );
    const inventedEmails = [...responseEmails].filter(e => !kbEmails.has(e));

    if (inventedEmails.length > 0) {
      errors.push(`Indirizzi email non in KB: ${inventedEmails.join(', ')}`);
      score *= 0.50;
      hallucinations.emails = inventedEmails;
    }

    // === Controllo numeri telefono ===
    const phonePattern = /\b(?:\+?\d{1,3})?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,4}\b/g;
    const responsePhonesRaw = response.match(phonePattern) || [];
    const kbPhonesRaw = safeKnowledgeBase.match(phonePattern) || [];

    // 8+ cifre minimo per evitare falsi positivi. Escludi esplicitamente date YYYYMMDD (B18).
    const datePattern = /^\d{4}[01]\d[0-3]\d$/;
    const responsePhones = new Set(
      responsePhonesRaw.map(normalizePhone)
        .filter(p => p.length >= 8 && !datePattern.test(p))
    );
    const kbPhones = new Set(
      kbPhonesRaw.map(normalizePhone).filter(p => p.length >= 8)
    );

    // Escludi numeri presenti nella whitelist (es. mittente, thread) o nel messaggio originale
    const whitelistText = (originalMessage || '');
    const inventedPhones = [...responsePhones].filter(p => {
      if (kbPhones.has(p)) return false;
      // Se il numero è presente nel testo originale, è legittimo ripeterlo
      if (whitelistText.replace(/\s+/g, '').includes(p)) return false;
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
    const italianForbiddenCaps = [
      // Verbi
      'Siamo', 'Restiamo', 'Sono', 'È', "E'", 'Era', 'Sarà',
      'Ho', 'Hai', 'Ha', 'Abbiamo', 'Avete', 'Hanno',
      'Vorrei', 'Vorremmo', 'Volevamo', 'Desideriamo', 'Informiamo',
      // Articoli
      'Il', 'Lo', 'La', 'I', 'Gli', 'Le', 'Un', 'Uno', 'Una', "Un'",
      // Preposizioni
      'Per', 'Con', 'In', 'Su', 'Tra', 'Fra', 'Da', 'Di', 'A',
      // Congiunzioni e particelle (AGGIUNTE "E", "Ed")
      'Ma', 'Se', 'Che', 'Non', 'Sì', 'No', 'E', 'Ed', 'O', 'Oppure',
      // Pronomi
      'Vi', 'Ti', 'Mi', 'Ci', 'Si', 'Li',
      // Altre parole comuni
      'Ecco', 'Gentile', 'Caro', 'Cara', 'Spettabile'
    ];

    // Parole inglesi - lista limitata
    const englishForbiddenCaps = [
      'The', 'An', 'For', 'With', 'On', 'At', 'If', 'Or', 'And', 'But', 'To', 'In'
    ];

    // Parole spagnole
    const spanishForbiddenCaps = [
      'Estamos', 'Somos', 'Estaremos', 'Seremos',
      'El', 'Los', 'Las', 'Una', 'Por', 'En', 'De', 'Pero', 'Que'
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
    } else {
      forbiddenCaps = italianForbiddenCaps;
    }

    // Regex per trovare ", Parola"
    const pattern = /,\s+([A-ZÀÈÉÌÒÙ][a-zàèéìòù]*)/g;
    let match;
    const violations = [];

    while ((match = pattern.exec(response)) !== null) {
      if (!match[1]) continue;
      const word = String(match[1]); // Punto 8: Coercizione esplicita a stringa

      if (capitalizationExceptions.includes(word)) {
        continue;
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
        'come da istruzioni',
        'secondo le linee guida'
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

    // Determina fascia oraria corrente
    // Determina fascia oraria corrente
    const currentHour = new Date().getHours();
    let expectedTimeSlot;
    if (currentHour >= 5 && currentHour < 12) {
      expectedTimeSlot = 'morning';
    } else if (currentHour >= 12 && currentHour < 18) {
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

  // ========================================================================
  // METODI DI AUTO-CORREZIONE (SELF-HEALING)
  // ========================================================================

  /**
   * Tenta di correggere automaticamente gli errori rilevati
   */
  _perfezionamentoAutomatico(response, errors, language) {
    let textPerfezionato = response;
    let modified = false;

    // 1. Correzione Link duplicati (Markdown)
    // Cerca [url](url) o [url](url...) e semplifica
    const linksOttimizzati = this._ottimizzaLinkDuplicati(textPerfezionato);
    if (linksOttimizzati !== textPerfezionato) {
      textPerfezionato = linksOttimizzati;
      modified = true;
      console.log('   🩺 Ottimizzazione Link applicata');
    }

    // 2. Correzione Maiuscole dopo virgola
    // Applicabile solo se non è un errore di Thinking Leak (che richiede rigenerazione)
    // e se non ci sono placeholder
    if (!errors.some(e => e.includes('RAGIONAMENTO ESPOSTO') || e.includes('placeholder'))) {
      const capsOttimizzate = this._ottimizzaCapitalAfterComma(textPerfezionato, language);
      if (capsOttimizzate !== textPerfezionato) {
        textPerfezionato = capsOttimizzate;
        modified = true;
        console.log('   🩺 Ottimizzazione Maiuscole applicata');
      }
    }

    // 3. Correzione Saluto temporalmente incongruente
    if (!errors.some(e => e.includes('RAGIONAMENTO ESPOSTO') || e.includes('placeholder'))) {
      const salutoOttimizzato = this._ottimizzaSalutoTemporale(textPerfezionato, language);
      if (salutoOttimizzato !== textPerfezionato) {
        textPerfezionato = salutoOttimizzato;
        modified = true;
        console.log('   🩺 Ottimizzazione Saluto applicata');
      }
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
      if (label.trim() === url.trim() || url.includes(label.trim())) {
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

    // Determina fascia oraria corrente
    // Determina fascia oraria corrente
    const currentHour = new Date().getHours();
    let correctTimeSlot;
    if (currentHour >= 5 && currentHour < 12) {
      correctTimeSlot = 'morning';
    } else if (currentHour >= 12 && currentHour < 18) {
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
        const regex = new RegExp(`^(\\s*)(${greeting})\\b`, 'i');
        const match = firstPart.match(regex);

        if (match) {
          const originalGreeting = match[2];
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

  /**
   * Corregge maiuscole post-virgola per parole vietate
   */
  _ottimizzaCapitalAfterComma(text, language) {
    // Ri-utilizza la lista delle parole vietate appropriata in base alla lingua
    let targets = [];

    // Definiamo le regole per lingua
    if (language === 'it') {
      targets = [
        'Siamo', 'Restiamo', 'Sono', 'È', "E'", 'Era', 'Sarà',
        'Ho', 'Hai', 'Ha', 'Abbiamo', 'Avete', 'Hanno',
        'Vorrei', 'Vorremmo', 'Volevamo', 'Desideriamo', 'Informiamo',
        'Il', 'Lo', 'La', 'I', 'Gli', 'Le', 'Un', 'Uno', 'Una', "Un'",
        'Per', 'Con', 'In', 'Su', 'Tra', 'Fra', 'Da', 'Di', 'A',
        'Ma', 'Se', 'Che', 'Non', 'Sì', 'No', 'E', 'Ed', 'O', 'Oppure',
        'Vi', 'Ti', 'Mi', 'Ci', 'Si', 'Li',
        'Ecco', 'Gentile', 'Caro', 'Cara', 'Spettabile'
      ];
    } else if (language === 'en') {
      // Lista minima per inglese
      targets = ['The', 'An', 'For', 'With', 'On', 'At', 'If', 'Or', 'And', 'But', 'To', 'In'];
    } else if (language === 'es') {
      // Lista minima per spagnolo
      targets = ['Estamos', 'Somos', 'El', 'Los', 'Las', 'Una', 'Por', 'En', 'De', 'Pero', 'Que'];
    } else if (language === 'pt') {
      // Lista minima per portoghese
      targets = ['Estamos', 'Somos', 'Uma', 'Por', 'Com', 'De', 'Que', 'Para', 'Em'];
    } else {
      // Se lingua sconosciuta o non supportata, NON applicare correzioni rischiose
      console.log(`   ⚠️ Correzione automatica maiuscole disabilitata per lingua '${language}'`);
      return text;
    }

    const capitalizationExceptions = ['Dio', 'Gesù', 'Maria', 'Santo', 'Padre', 'Lei', 'La', 'Ella'];
    let result = text;

    // Per ogni parola vietata, cerca ", Parola" e sostituisci con ", parola"
    // Usa word boundary \b per evitare match parziali
    // Ma rispetta i nomi doppi: non correggere se seguito da altra maiuscola
    targets.forEach(word => {
      const regex = new RegExp(`,\\s+(${word})(?:\\b|(?=\\s|$))`, 'g');
      result = result.replace(regex, (fullMatch, p1, offset) => {
        if (capitalizationExceptions.includes(p1)) {
          return fullMatch;
        }
        // Euristica nomi doppi: se seguito da un'altra parola maiuscola, non correggere
        const afterMatchPos = offset + fullMatch.length;
        const textAfter = result.substring(afterMatchPos);
        if (textAfter.match(/^\s+[A-ZÀÈÉÌÒÙ][a-zàèéìòù]+/)) {
          return fullMatch; // Mantieni maiuscola: probabile nome doppio
        }
        return `, ${p1.toLowerCase()}`;
      });
    });

    return result;
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
class SemanticValidator {
  constructor() {
    console.log('🧠 Inizializzazione SemanticValidator...');

    const semanticConfig = typeof CONFIG !== 'undefined' && CONFIG.SEMANTIC_VALIDATION
      ? CONFIG.SEMANTIC_VALIDATION
      : {};

    this.enabled = semanticConfig.enabled === true;
    this.activationThreshold = semanticConfig.activationThreshold || 0.9;
    this.cacheEnabled = semanticConfig.cacheEnabled !== false;
    this.cacheTTL = semanticConfig.cacheTTL || 300;
    this.taskType = semanticConfig.taskType || 'semantic';
    this.fallbackOnError = semanticConfig.fallbackOnError !== false;
    this.maxRetries = semanticConfig.maxRetries || 1;

    this.geminiService = new GeminiService();

    this.cache = this.cacheEnabled ? CacheService.getScriptCache() : null;

    console.log('✓ SemanticValidator inizializzato');
  }

  shouldRun(validationScore) {
    return this.enabled && validationScore < this.activationThreshold;
  }

  /**
   * Valida allucinazioni usando semantic similarity
   */
  validateHallucinations(response, knowledgeBase, regexResult, emailContent) {
    if (!this.shouldRun(regexResult.score) && regexResult.errors.length === 0) {
      console.log('   ⚠ Semantic hallucination ✅ skippato (confidence alta)');
      return { isValid: true, confidence: regexResult.score, skipped: true };
    }

    const cacheKey = this._cacheKey('halluc', response + knowledgeBase);
    const cached = this._readCache(cacheKey);
    if (cached) return cached;

    console.log('   🧠 Eseguo semantic hallucination ✅...');

    try {
      const prompt = this._buildHallucinationPrompt(response, knowledgeBase, emailContent);
      const apiResponse = this._generateSemantic(prompt);
      const result = this._parseSemanticResponse(apiResponse);
      this._writeCache(cacheKey, result);
      return result;
    } catch (error) {
      console.warn(`⚠️ Semantic API fallita: ${error.message}`);
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
   * Valida thinking leaks usando semantic understanding
   */
  validateThinkingLeak(response, regexResult) {
    if (!this.shouldRun(regexResult.score)) {
      return { isValid: true, confidence: 1.0, skipped: true };
    }

    const cacheKey = this._cacheKey('thinking', response);
    const cached = this._readCache(cacheKey);
    if (cached) return cached;

    console.log('   🧠 Eseguo semantic thinking leak ✅...');

    try {
      const prompt = this._buildThinkingLeakPrompt(response);
      const apiResponse = this._generateSemantic(prompt);
      const result = this._parseSemanticResponse(apiResponse);
      this._writeCache(cacheKey, result);
      return result;
    } catch (error) {
      console.warn(`⚠️ Semantic thinking ✅ fallito: ${error.message}`);
      if (!this.fallbackOnError) throw error;
      const fallbackThreshold = 0.85;
      return {
        isValid: regexResult.score >= fallbackThreshold,
        confidence: regexResult.score,
        fallback: true,
        reason: `Semantic thinking validation unavailable: ${error.message || 'unknown error'}`
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
    const estimatedTokens = this.geminiService._estimateTokens(prompt);

    if (this.geminiService.useRateLimiter && this.geminiService.rateLimiter) {
      const result = this.geminiService.rateLimiter.executeRequest(
        this.taskType,
        (modelName) => this.geminiService._generateWithModel(prompt, modelName),
        {
          estimatedTokens: estimatedTokens,
          preferQuality: false
        }
      );

      if (result && result.success) {
        console.log(`✓ Semantic via Rate Limiter (modello: ${result.modelUsed})`);
        return result.result;
      }
    }

    const originalRetries = this.geminiService.maxRetries;
    this.geminiService.maxRetries = this.maxRetries;
    try {
      return this.geminiService._withRetry(
        () => this.geminiService._generateWithModel(prompt, this.geminiService.modelName),
        'Semantic validation'
      );
    } finally {
      this.geminiService.maxRetries = originalRetries;
    }
  }

  _parseSemanticResponse(apiResponse) {
    try {
      if (typeof parseGeminiJsonLenient === 'function') {
        const parsed = parseGeminiJsonLenient(apiResponse);
        return this._normalizeSemanticPayload(parsed);
      }

      let cleaned = apiResponse
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);
      return this._normalizeSemanticPayload(parsed);
    } catch (error) {
      console.error(`❌ Parse semantic response failed: ${error.message}`);
      throw new Error('Invalid JSON from semantic validator');
    }
  }

  _normalizeSemanticPayload(parsed) {
    return {
      isValid: parsed.isValid === true,
      confidence: Math.max(0, Math.min(parsed.confidence || 0.5, 1.0)),
      details: parsed.hallucinations || parsed.examples || {},
      reason: parsed.reason || 'No reason provided'
    };
  }

  _cacheKey(prefix, text) {
    return `${prefix}_${this._hashText(text)}`;
  }

  _readCache(cacheKey) {
    if (!this.cache) return null;
    const cached = this.cache.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  }

  _writeCache(cacheKey, value) {
    if (!this.cache) return;
    this.cache.put(cacheKey, JSON.stringify(value), this.cacheTTL);
  }

  _hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}

function createSemanticValidator() {
  return new SemanticValidator();
}
