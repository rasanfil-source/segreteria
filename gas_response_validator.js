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
 * ✅ Maiuscola dopo virgola (errore grammaticale)
 * ✅ Ragionamento esposto (thinking leak)
 */
class ResponseValidator {
  constructor() {
    console.log('🔍 Inizializzazione ResponseValidator...');

    // Ottieni config - fallback a default se CONFIG non definito
    const strictMode = typeof CONFIG !== 'undefined' ? CONFIG.VALIDATION_STRICT_MODE : false;
    const minScore = typeof CONFIG !== 'undefined' ? CONFIG.VALIDATION_MIN_SCORE : 0.6;

    // Soglia minima accettabile
    this.MIN_VALID_SCORE = strictMode ? 0.8 : minScore;
    this.STRICT_MODE_SCORE = 0.8;

    // Soglie lunghezza
    this.MIN_LENGTH_CHARS = 25;
    this.OPTIMAL_MIN_LENGTH = 100;
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
      'es': ['gracias', 'saludos', 'estimado', 'parroquia', 'misa', 'iglesia', 'querría']
    };

    // Placeholder da rilevare
    this.placeholders = ['XXX', 'TODO', '<insert>', 'placeholder', 'tbd', 'TBD', '...'];

    // Pattern di ragionamento esposto (thinking leak) - CRITICO
    // Pattern di ragionamento esposto (thinking leak) - CRITICO
    // IBRIDO: Regex semantiche + pattern statici specifici
    this.thinkingRegexes = [
      /\b(devo|dovrei|bisogna|necessario)\s+(usare|correggere|evitare|modificare|aggiornare)\b/i, // Meta-commenti
      /\b(knowledge base|kb)\s+(dice|afferma|contiene|riporta|indica)\b/i,                       // Riferimenti KB
      /\b(rivedendo|consultando|controllando|verificando)\s+(la\s+)?(knowledge base|kb)\b/i      // Azioni su KB
    ];

    this.thinkingPatterns = [
      // Pattern conversazionali non catturati dalle regex
      'in realtà',
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
      /secretar[ií]a\s+parroquial/i                                    // ES
    ];

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
  validateResponse(response, detectedLanguage, knowledgeBase, emailContent, emailSubject, salutationMode = 'full', attemptFix = true) {
    const errors = [];
    const warnings = [];
    const details = {};
    let score = 1.0;

    // Variabile per gestire la risposta (che potrebbe essere fixata)
    let currentResponse = response;
    let wasFixed = false;

    console.log(`🔍 Validazione risposta (${currentResponse.length} caratteri, lingua=${detectedLanguage})...`);

    // --- PRIMO PASSAGGIO DI VALIDAZIONE ---
    let validationResult = this._runValidationChecks(currentResponse, detectedLanguage, knowledgeBase, salutationMode);

    // --- AUTOCORREZIONE (SELF-HEALING) ---
    if (!validationResult.isValid && attemptFix) {
      console.log('🩹 Tentativo Autocorrezione (Self-Healing)...');

      const fixResult = this._attemptAutoFix(currentResponse, validationResult.errors, detectedLanguage);

      if (fixResult.fixed) {
        console.log('   ✨ Applicati fix automatici. Ri-validazione...');
        currentResponse = fixResult.text;
        wasFixed = true;

        // Ri-esegui validazione sul testo corretto
        validationResult = this._runValidationChecks(currentResponse, detectedLanguage, knowledgeBase, salutationMode);

        if (validationResult.isValid) {
          console.log('   ✅ Autocorrezione ha risolto i problemi!');
        } else {
          console.warn('   ⚠️ Autocorrezione insufficiente. Errori residui.');
        }
      } else {
        console.log('   🚫 Nessun fix automatico applicabile.');
      }
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
      fixedResponse: wasFixed ? currentResponse : null, // Restituisci testo corretto se modificato
      metadata: {
        responseLength: currentResponse.length,
        expectedLanguage: detectedLanguage,
        threshold: this.MIN_VALID_SCORE,
        wasFixed: wasFixed
      }
    };
  }

  /**
   * Esegue i check effettivi (estratto per riutilizzo)
   */
  _runValidationChecks(response, detectedLanguage, knowledgeBase, salutationMode) {
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
    const hallucResult = this._checkHallucinations(response, knowledgeBase);
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
      // Per '...', verifica se usato come placeholder (non ellissi nel testo)
      if (p === '...') {
        if (/\[\.\.\.]/g.test(response) || /\.\.\.\s*$/g.test(response)) {
          foundPlaceholders.push(p);
        }
      } else if (responseLower.includes(p.toLowerCase())) {
        foundPlaceholders.push(p);
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

    return { score, errors, foundForbidden, foundPlaceholders };
  }

  /**
   * Controllo 5: Allucinazioni (dati inventati non in KB)
   */
  _checkHallucinations(response, knowledgeBase) {
    const errors = [];
    const warnings = [];
    let score = 1.0;
    const hallucinations = {};
    const safeKnowledgeBase = typeof knowledgeBase === 'string' ? knowledgeBase : '';

    // Helper normalizzazione orari
    const normalizeTime = (t) => {
      // Escludi pattern che potrebbero essere URL o nomi file
      if (/[a-z]{2,}\.\d{1,2}\.[a-z]{2,}/i.test(t)) return t;
      if (/\/([\\w-]+\.\d{1,2}\.\w+)$/i.test(t)) return t;

      t = t.replace(/\b(\d{1,2})\.([0-5]\d)\b/g, (match, h, m) => {
        const hour = parseInt(h, 10);
        if (hour >= 0 && hour <= 23) return `${h}:${m}`;
        return match;
      });
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
    const responseTimesRaw = response.match(timePattern) || [];
    const kbTimesRaw = safeKnowledgeBase.match(timePattern) || [];

    const responseTimes = new Set(responseTimesRaw.map(normalizeTime));
    const kbTimes = new Set(kbTimesRaw.map(normalizeTime));
    const inventedTimes = [...responseTimes].filter(t => !kbTimes.has(t));

    if (inventedTimes.length > 0) {
      warnings.push(`Orari non in KB: ${inventedTimes.join(', ')}`);
      score *= 0.85;
      hallucinations.times = inventedTimes;
    }

    // === Controllo email ===
    const emailPattern = /\b[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/gi;
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

    // 8+ cifre minimo per evitare falsi positivi
    const responsePhones = new Set(
      responsePhonesRaw.map(normalizePhone).filter(p => p.length >= 8)
    );
    const kbPhones = new Set(
      kbPhonesRaw.map(normalizePhone).filter(p => p.length >= 8)
    );
    const inventedPhones = [...responsePhones].filter(p => !kbPhones.has(p));

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
      const word = match[1];
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

    // Se trovati pattern critici, blocca la risposta
    if (foundPatterns.length > 0) {
      errors.push(
        `RAGIONAMENTO ESPOSTO RILEVATO: "${foundPatterns[0]}..."`
      );
      score = 0.0;
      // Log speciale per monitoraggio immediato
      console.error(`🚨 RILEVAMENTO THINKING LEAK (Pattern: ${foundPatterns[0]}).`);
    }

    return { score, errors, warnings, foundPatterns };
  }

  // ========================================================================
  // METODI DI AUTO-CORREZIONE (SELF-HEALING)
  // ========================================================================

  /**
   * Tenta di correggere automaticamente gli errori rilevati
   */
  _attemptAutoFix(response, errors, language) {
    let fixedText = response;
    let modified = false;

    // 1. Correzione Link duplicati (Markdown)
    // Cerca [url](url) o [url](url...) e semplifica
    const fixedLinks = this._fixDuplicateLinks(fixedText);
    if (fixedLinks !== fixedText) {
      fixedText = fixedLinks;
      modified = true;
      console.log('   🩹 Fix Links applicato');
    }

    // 2. Correzione Maiuscole dopo virgola
    // Applicabile solo se non è un errore di Thinking Leak (che richiede rigenerazione)
    // e se non ci sono placeholder
    if (!errors.some(e => e.includes('RAGIONAMENTO ESPOSTO') || e.includes('placeholder'))) {
      const fixedCaps = this._fixCapitalAfterComma(fixedText, language);
      if (fixedCaps !== fixedText) {
        fixedText = fixedCaps;
        modified = true;
        console.log('   🩹 Fix Maiuscole applicato');
      }
    }

    return { fixed: modified, text: fixedText };
  }

  /**
   * Corregge link markdown ridondanti
   * Es. [https://example.com](https://example.com) -> https://example.com
   */
  _fixDuplicateLinks(text) {
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
   * Corregge maiuscole post-virgola per parole vietate
   */
  _fixCapitalAfterComma(text, language) {
    // Ri-utilizza la lista delle parole vietate (definita internalmente o spostata a proprietà classe)
    // Per semplicità, ridefinisco qui quelle critiche italiane
    // TODO: Centralizzare la lista 'forbiddenCaps' come proprietà di classe in refactoring futuro
    const targets = [
      'Siamo', 'Restiamo', 'Sono', 'È', "E'", 'Era', 'Sarà',
      'Ho', 'Hai', 'Ha', 'Abbiamo', 'Avete', 'Hanno',
      'Vorrei', 'Vorremmo', 'Volevamo', 'Desideriamo', 'Informiamo',
      'Il', 'Lo', 'La', 'I', 'Gli', 'Le', 'Un', 'Uno', 'Una', "Un'",
      'Per', 'Con', 'In', 'Su', 'Tra', 'Fra', 'Da', 'Di', 'A',
      'Ma', 'Se', 'Che', 'Non', 'Sì', 'No', 'E', 'Ed', 'O', 'Oppure',
      'Vi', 'Ti', 'Mi', 'Ci', 'Si', 'Li',
      'Ecco', 'Gentile', 'Caro', 'Cara', 'Spettabile'
    ];

    let result = text;

    // Per ogni parola vietata, cerca ", Parola" e sostituisci con ", parola"
    // Usa word boundary \b per evitare match parziali
    targets.forEach(word => {
      const regex = new RegExp(`,\\s+(${word})\\b`, 'g');
      result = result.replace(regex, (match, p1) => {
        return match.replace(p1, p1.toLowerCase());
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
      placeholdersCount: this.placeholders.length,
      version: '2.1'
    };
  }
}

// Funzione factory per compatibilità
function createResponseValidator() {
  return new ResponseValidator();
}