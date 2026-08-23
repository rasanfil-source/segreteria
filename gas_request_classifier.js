/**
 * RequestTypeClassifier.gs - Classificazione Tecnica/Pastorale/Mista
 * 
 * TIPI RICHIESTA:
 * - TECHNICAL: domande procedurali ("si può", "quanti", "quando")
 * - PASTORAL: coinvolgimento personale ("mi sento", emozioni, ferite)
 * - MIXED: entrambi gli aspetti
 * - DOCTRINAL: richieste spiegazione teologica/dottrinale
 * 
 * LOGICA ATTIVAZIONE KB:
 * - AI-Core Lite: Solo quando needsDiscernment || needsDoctrine
 * - AI-Core: Solo quando needsDiscernment = true
 * - Dottrina: Solo quando needsDoctrine = true
 */
var RequestTypeClassifier = class RequestTypeClassifier {
  constructor() {
    console.log('📊 Inizializzazione RequestTypeClassifier...');

    // ========================================================================
    // INDICATORI TECNICI
    // Domande procedurali, normative, su numeri, condizioni formali
    // ========================================================================
    this.TECHNICAL_INDICATORS = [
      // Possibilità/obbligo (peso 2)
      { pattern: /\bsi può\b/i, weight: 2 },
      { pattern: /\bnon si può\b/i, weight: 2 },
      { pattern: /\bè possibile\b/i, weight: 2 },
      { pattern: /\bè obbligatorio\b/i, weight: 2 },
      { pattern: /\bbisogna\b/i, weight: 2 },
      { pattern: /\bdeve\b/i, weight: 1 },
      { pattern: /\bdevono\b/i, weight: 1 },

      // Domande su numeri/quantità (peso 2)
      { pattern: /\bquanti\b/i, weight: 2 },
      { pattern: /\bquante\b/i, weight: 2 },
      { pattern: /\bquanto costa\b/i, weight: 2 },

      // Domande temporali (peso 1-2)
      { pattern: /\bquando\b/i, weight: 1 },
      { pattern: /\ba che ora\b/i, weight: 2 },
      { pattern: /\borari\b/i, weight: 2 },

      // Domande procedurali (peso 2)
      { pattern: /\bcome (?:si )?fa\b/i, weight: 2 },
      { pattern: /\bcome funziona\b/i, weight: 2 },
      { pattern: /\bqual è la procedura\b/i, weight: 2 },
      { pattern: /\bche documenti?\b/i, weight: 2 },
      { pattern: /\binformazion[ei]\b/i, weight: 1 },
      { pattern: /\brequisit[oi]\b/i, weight: 2 },
      { pattern: /\bcorso\b/i, weight: 1 },

      // Riferimenti a ruoli formali (peso 1-2)
      { pattern: /\bpadrino\b/i, weight: 1 },
      { pattern: /\bmadrina\b/i, weight: 1 },
      { pattern: /\btestimone\b/i, weight: 1 },
      { pattern: /\bcresima\b/i, weight: 1 },
      { pattern: /\bcertificato\b/i, weight: 2 },
      { pattern: /\bdocument\w+\b/i, weight: 1 },
      { pattern: /\bmodulo\b/i, weight: 1 },
      { pattern: /\biscrizione\b/i, weight: 1 }
    ];

    // ========================================================================
    // INDICATORI PASTORALI
    // Prima persona, emozioni, situazioni di vita, richieste di senso
    // ========================================================================
    this.PASTORAL_INDICATORS = [
      // Prima persona emotiva (peso 3)
      { pattern: /\bmi sento\b/i, weight: 3 },
      { pattern: /\bmi pesa\b/i, weight: 3 },
      { pattern: /\bmi sono sentit[oa]\b/i, weight: 3 },
      { pattern: /\bnon mi sento\b/i, weight: 3 },

      // Emozioni (peso 2)
      { pattern: /\bsoffr\w+\b/i, weight: 2 },
      { pattern: /\bdifficolt[àa]\b/i, weight: 2 },
      { pattern: /\bferit[oa]\b/i, weight: 2 },
      { pattern: /\besclus[oa]\b/i, weight: 2 },
      { pattern: /\bsol[oa]\b/i, weight: 2 },
      { pattern: /\bpaura\b/i, weight: 2 },
      { pattern: /\bansia\b/i, weight: 2 },
      { pattern: /\btristezza\b/i, weight: 2 },
      { pattern: /\bcolpa\b/i, weight: 2 },
      { pattern: /\bvergogna\b/i, weight: 2 },

      // Incomprensione (peso 2)
      { pattern: /\bnon capisco\b/i, weight: 2 },
      { pattern: /\bnon riesco a capire\b/i, weight: 2 },

      // Situazioni di vita complesse - ITALIANO (peso 2)
      { pattern: /\bdivorziat[oa]\b/i, weight: 2 },
      { pattern: /\bseparat[oa]\b/i, weight: 2 },
      { pattern: /\brisposat[oa]\b/i, weight: 2 },
      { pattern: /\bconvivente\b/i, weight: 2 },
      { pattern: /\blutto\b/i, weight: 2 },
      { pattern: /\bdefunt[oa]\b/i, weight: 2 },
      { pattern: /\bmalattia\b/i, weight: 2 },
      { pattern: /\bmort[oa]\b/i, weight: 2 },
      { pattern: /\bdecesso\b/i, weight: 2 },
      { pattern: /\bscompars[oa]\b/i, weight: 2 },
      { pattern: /\bfuneral[ei]?\b/i, weight: 2 },
      { pattern: /\besequie\b/i, weight: 2 },
      { pattern: /\bmancat[oa]\b/i, weight: 2 },
      { pattern: /\brisposarmi\b/i, weight: 3 },
      { pattern: /\bsposarmi di nuovo\b/i, weight: 3 },

      // Situazioni di vita complesse - ENGLISH (peso 2)
      { pattern: /\bdivorced\b/i, weight: 2 },
      { pattern: /\bseparated\b/i, weight: 2 },
      { pattern: /\bremarried\b/i, weight: 2 },
      { pattern: /\bcohabiting\b/i, weight: 2 },
      { pattern: /\banglican\b/i, weight: 2 },
      { pattern: /\bprotestant\b/i, weight: 2 },
      { pattern: /\bprevious marriage\b/i, weight: 2 },
      { pattern: /\bdeath\b/i, weight: 2 },
      { pattern: /\bdead\b/i, weight: 2 },
      { pattern: /\bpassed away\b/i, weight: 2 },
      { pattern: /\bfuneral\b/i, weight: 2 },
      { pattern: /\bbereavement\b/i, weight: 2 },
      { pattern: /\bdeceased\b/i, weight: 2 },

      // Richieste di senso (peso 3)
      { pattern: /\bperché la chiesa\b/i, weight: 3 },
      { pattern: /\bperché dio\b/i, weight: 3 },
      { pattern: /\bche senso ha\b/i, weight: 3 },
      { pattern: /\bcome vivere\b/i, weight: 3 },
      { pattern: /\bcome affrontare\b/i, weight: 2 }
    ];

    // ========================================================================
    // INDICATORI DOTTRINALI ESPLICITI
    // ========================================================================
    this.DOCTRINE_INDICATORS = [
      { pattern: /\bspiegazione\b/i, weight: 2 },
      { pattern: /\bspiegami\b/i, weight: 2 },
      { pattern: /\bperché la chiesa (?:insegna|dice|crede)\b/i, weight: 3 },
      { pattern: /\bfondamento teologic\w+\b/i, weight: 3 },
      { pattern: /\bdottrina\b/i, weight: 2 },
      { pattern: /\bmagistero\b/i, weight: 3 },
      { pattern: /\bcatechismo\b/i, weight: 2 },
      { pattern: /\binsegnamento della chiesa\b/i, weight: 3 }
    ];

    // ========================================================================
    // INDICATORI FORMALI / AMMINISTRATIVI (Sbattezzo)
    // ========================================================================
    this.FORMAL_INDICATORS = [
      { pattern: /\bsbattezzo\b/i, weight: 4 },
      { pattern: /\bapostasia\b/i, weight: 4 },
      { pattern: /\bapostatare\b/i, weight: 4 },
      { pattern: /\bcancellazione dal registro\b/i, weight: 4 },
      { pattern: /\bnon mi ritengo più cristiano\b/i, weight: 4 },
      { pattern: /\buscire\s+dalla\s+chiesa\b/i, weight: 4 },
      { pattern: /\bcancellarmi\s+dalla\s+chiesa\b/i, weight: 4 },
      { pattern: /\bdisiscrivermi\s+dalla\s+chiesa\b/i, weight: 4 },
      { pattern: /\brinunciare\s+al\s+battesim[oa]\b/i, weight: 4 },
      { pattern: /\b(?:togliermi|rimuovermi|essere\s+rimosso)\s+dai\s+registr/i, weight: 4 },
      { pattern: /\bnon\s+(?:voglio|desidero)\s+(?:piu|più)\s+essere\s+(?:cattolic[oa]|cristian[oa])\b/i, weight: 4 },
      { pattern: /\bnon\s+essere\s+(?:piu|più)\s+registrat[oa]\s+come\s+cattolic[oa]\b/i, weight: 4 },
      { pattern: /\bnon voglio più risultare\b/i, weight: 3 },
      { pattern: /\babbandonare la fede\b/i, weight: 3 },
      { pattern: /\babbandonare la religione\b/i, weight: 3 }
    ];

    console.log('✓ RequestTypeClassifier inizializzato');
  }

  /**
   * Classifica la richiesta email
   * Restituisce dimensioni continue, complessità e flag di attivazione KB.
   */
  classify(subject, body, externalHint = null) {
    // Configurazione del livello di logging per il monitoraggio delle inferenze.
    const logLevel = (typeof CONFIG !== 'undefined' && CONFIG.LOGGING && CONFIG.LOGGING.LEVEL)
      ? String(CONFIG.LOGGING.LEVEL).toUpperCase()
      : 'INFO';
    const shouldLogRawHint = logLevel === 'DEBUG';

    if (shouldLogRawHint) {
      console.log(`🤖 DEBUG EXTERNAL HINT (GEMINI RAW):\n`, JSON.stringify(externalHint, null, 2));
    }

    // Smart Truncation (primi 1500 + ultimi 1500 caratteri)
    const MAX_ANALYSIS_LENGTH = 3000;
    const sanitizedText = this._sanitizeText(subject, body);
    const text = sanitizedText.length > MAX_ANALYSIS_LENGTH
      ? (
        sanitizedText.substring(0, 1500) +
        ' ... ' +
        sanitizedText.substring(sanitizedText.length - 1500)
      ).toLowerCase()
      : sanitizedText.toLowerCase();

    // 1. Calcola punteggi grezzi
    const technicalResult = this._calculateScore(text, this.TECHNICAL_INDICATORS);
    const pastoralResult = this._calculateScore(text, this.PASTORAL_INDICATORS);
    const doctrineResult = this._calculateScore(text, this.DOCTRINE_INDICATORS);
    const formalResult = this._calculateScore(text, this.FORMAL_INDICATORS);

    // 2. Normalizzazione Punteggi (0.0 - 1.0)
    // Soglia saturazione arbitraria: 5 match = 1.0
    const SATURATION_POINT = 5;
    let dimensions = {
      technical: Math.min(technicalResult.score / SATURATION_POINT, 1.0),
      pastoral: Math.min(pastoralResult.score / SATURATION_POINT, 1.0),
      doctrinal: Math.min(doctrineResult.score / SATURATION_POINT, 1.0),
      formal: Math.min(formalResult.score / SATURATION_POINT, 1.0)
    };

    // 3. Logica Ibrida (Integrazione Gemini se disponibile)
    let source = 'regex';
    const classificationGuards = [];
    const externalDims = this._extractExternalDimensions(externalHint);
    const externalConfidence = this._normalizeConfidence(externalHint && externalHint.confidence);
    const hasExternalHint = Boolean(
      (externalDims && externalHint && externalConfidence >= 0.6) ||
      (externalHint && externalHint.category && externalConfidence >= 0.75)
    );
    const externalSbattezzoHint = this._externalHintIndicatesSbattezzo_(externalHint);

    if (externalDims && hasExternalHint) {
      dimensions = { ...dimensions, ...externalDims };
      source = 'llm';
    } else if (hasExternalHint) {
      // Boost dimensionale basato su Gemini (alternativa a categoria)
      const categoryMap = {
        'technical': 'technical',
        'information': 'technical',
        'appointment': 'technical',
        'quotation': 'technical',
        'certificates': 'technical',
        'certificate': 'technical',
        'document_submission': 'technical',
        'document_submission_with_question': 'technical',
        'sacrament': 'pastoral',
        'baptism': 'pastoral',
        'marriage': 'pastoral',
        'funeral': 'pastoral',
        'pastoral': 'pastoral',
        'doctrinal': 'doctrinal',
        'doctrine': 'doctrinal',
        'formal': 'formal',
        'sbattezzo': 'formal'
      };

      const normalizedCategory = typeof externalHint.category === 'string'
        ? externalHint.category.trim().toLowerCase()
        : '';
      const mappedDim = categoryMap[normalizedCategory];
      if (mappedDim) {
        dimensions[mappedDim] = Math.max(dimensions[mappedDim], 0.8); // Trust Gemini
        source = 'hybrid';
      }
    }

    if (this._shouldDowngradeProceduralSacramentPastoral_(text, technicalResult, pastoralResult, dimensions)) {
      dimensions = Object.assign({}, dimensions, {
        technical: Math.max(dimensions.technical || 0, 0.7),
        pastoral: Math.min(dimensions.pastoral || 0, 0.2),
        doctrinal: Math.min(dimensions.doctrinal || 0, 0.3)
      });
      classificationGuards.push('procedural_sacrament_pastoral_downgrade');
      source = source === 'regex' ? 'regex_guarded' : 'hybrid_guarded';
    }

    // 4. Determinazione Tipo Primario (Compatibilità Base)
    let requestType = 'technical';

    // Priorità gerarchica
    if (dimensions.formal >= 0.6) {
      requestType = 'formal';
    } else if (dimensions.doctrinal >= 0.6) {
      requestType = 'doctrinal';
    } else if (dimensions.pastoral >= 0.6 && dimensions.pastoral > dimensions.technical) {
      requestType = 'pastoral';
    } else if (dimensions.technical >= 0.6) {
      requestType = 'technical';
    } else {
      // Caso misto: due dimensioni sopra 0.4
      const activeDims = Object.entries(dimensions)
        .filter(([k, v]) => v > 0.4)
        .sort((a, b) => b[1] - a[1]);

      if (activeDims.length >= 2) {
        requestType = 'mixed';
      } else {
        requestType = 'technical'; // Valore predefinito
      }
    }
    const isSbattezzoRequest = formalResult.score >= 4 || externalSbattezzoHint;

    // Override prioritari (Logica critica)
    if (isSbattezzoRequest || dimensions.formal >= 0.8) {
      requestType = 'formal';
    } else if (dimensions.doctrinal >= 0.8 && dimensions.pastoral < 0.4) {
      requestType = 'doctrinal'; // Pura dottrina, salvo flussi formali prioritari.
    }

    // 4b. Confidenza e criteri di sicurezza (anti-falsi positivi)
    const confidence = this._estimateConfidence({
      dimensions,
      results: [technicalResult, pastoralResult, doctrineResult, formalResult],
      textLength: text.length,
      hasExternalHint
    });

    const safetyFlags = this._buildSafetyFlags({
      confidence,
      dimensions,
      results: [technicalResult, pastoralResult, doctrineResult, formalResult],
      textLength: text.length,
      hasExternalHint
    });
    classificationGuards.forEach(flag => safetyFlags.push(flag));

    // Downgrade conservativo: evita etichette forti con segnali deboli
    if (confidence < 0.35 && requestType !== 'formal' && !hasExternalHint) {
      requestType = 'technical';
      safetyFlags.push('low_confidence_downgrade');
    }

    // 5. Calcolo Metriche Derivate

    // Complessità: Somma delle dimensioni attive (> 0.2)
    const activeDims = Object.values(dimensions).filter(v => v > 0.2).length;
    let complexity = 'Low';
    if (activeDims >= 3 || Math.max(...Object.values(dimensions)) > 0.8) complexity = 'High';
    else if (activeDims === 2) complexity = 'Medium';

    // Carico Emotivo: Basato su dimensione pastorale
    let emotionalLoad = 'Low';
    if (dimensions.pastoral > 0.7) emotionalLoad = 'High';
    else if (dimensions.pastoral > 0.4) emotionalLoad = 'Medium';

    // Indicatori di necessità
    const needsDiscernment = dimensions.pastoral > 0.3 || requestType === 'mixed';
    const needsDoctrine = dimensions.doctrinal > 0.3 || (dimensions.doctrinal > 0 && requestType !== 'technical');

    const result = {
      type: requestType, // Categoria classica
      source: source,
      dimensions: dimensions, // Nuova metrica
      complexity: complexity,
      emotionalLoad: emotionalLoad,

      technicalScore: dimensions.technical, // Normalizzati
      pastoralScore: dimensions.pastoral,
      doctrineScore: dimensions.doctrinal,
      formalScore: dimensions.formal,

      confidence: confidence,
      safetyFlags: safetyFlags,

      needsDiscernment: needsDiscernment,
      needsDoctrine: needsDoctrine,
      // Usato da getRequestTypeHint() per selezionare template amministrativo.
      isSbattezzo: isSbattezzoRequest,
      detectedIndicators: [
        ...technicalResult.matched,
        ...pastoralResult.matched,
        ...doctrineResult.matched,
        ...formalResult.matched
      ]
    };

    console.log(`   📊 Classificazione: ${requestType.toUpperCase()} (Emozione: ${emotionalLoad}, Complessità: ${complexity})`);
    console.log(`      Dims: T=${dimensions.technical.toFixed(2)} P=${dimensions.pastoral.toFixed(2)} D=${dimensions.doctrinal.toFixed(2)} F=${dimensions.formal.toFixed(2)}`);
    console.log(`      Emotion=${emotionalLoad}, Complex=${complexity}`);

    return result;
  }

  /**
   * Interfaccia semplificata (soggetto + corpo) con ordine parametri invertito.
   * @deprecated Preferire classify(subject, body, externalHint) per evitare ambiguità.
   */
  classifyRequest(bodyFirst, subjectSecond, externalHint = null) {
    console.warn('[DEPRECATED] classifyRequest() usa l\'ordine legacy (body, subject). Preferire classify(subject, body).');
    return this.classify(subjectSecond, bodyFirst, externalHint);
  }

  /**
   * Calcola punteggio ponderato per set di indicatori
   */
  _calculateScore(text, indicators) {
    let total = 0;
    const matched = [];
    let matchCount = 0;

    for (const indicator of indicators) {
      // Crea una nuova RegExp globale per ogni indicatore, evitando stato lastIndex condiviso.
      const sourceFlags = indicator.pattern.flags || '';
      const flags = sourceFlags.includes('g') ? sourceFlags : sourceFlags + 'g';
      const pattern = new RegExp(indicator.pattern.source, flags);

      const matches = text.match(pattern);
      if (matches) {
        // match() con global flag ritorna array di stringhe matchate, non gruppi
        total += indicator.weight * matches.length;
        matchCount += matches.length;
        matched.push(indicator.pattern.source);
      }
    }

    return { score: total, matched: matched, matchCount: matchCount };
  }

  _shouldDowngradeProceduralSacramentPastoral_(text, technicalResult, pastoralResult, dimensions) {
    if (!text || !dimensions) return false;

    const technicalScore = Number(dimensions.technical) || 0;
    const pastoralScore = Number(dimensions.pastoral) || 0;
    const localTechnicalScore = (technicalResult && Number(technicalResult.score)) || 0;
    const localPastoralScore = (pastoralResult && Number(pastoralResult.score)) || 0;

    if (pastoralScore < 0.6 || technicalScore < 0.4) return false;
    if (localTechnicalScore < 2 || localPastoralScore > 0) return false;

    const hasConfirmationTopic = /\b(?:cresima|confermazione|confirmation)\b/i.test(text);
    const hasProceduralMarker = /\b(?:padrin[oa]|madrina|sponsor|adult[ioa]?|corso|iscrizion[ei]|requisit[oi]|date?|incontr[io]|modulo|informazion[ei]|come\s+(?:posso|fare|funziona))\b/i.test(text);
    const hasConcretePersonalCase = /\b(?:divorziat[oa]|separat[oa]|risposat[oa]|convivent[ei]|lutto|malattia|mort[oa]|decesso|funeral[ei]?|sbattezzo|apostasia)\b/i.test(text);

    return hasConfirmationTopic && hasProceduralMarker && !hasConcretePersonalCase;
  }

  /**
   * Sanitizza il testo evitando falsi positivi da quote e firme
   */
  _sanitizeText(subject, body) {
    const normalizePart = (value) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (typeof value === 'object') {
        if (typeof value.textPlain === 'string') return value.textPlain;
        if (typeof value.body === 'string') return value.body;
      }
      return '';
    };

    let text = `${normalizePart(subject)}\n${normalizePart(body)}`;

    let iterations = 0;
    while (/<blockquote/i.test(text) && iterations < 10) {
      const previousText = text;
      text = text.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
      if (text === previousText) {
        break;
      }
      iterations++;
    }
    if (iterations >= 10) {
      text = text.replace(/<blockquote[^>]*>[\s\S]*$/gi, '');
    }
    text = text.replace(/<div\s+class=["']gmail_quote["'][^>]*>[\s\S]*?<\/div>/gi, '');
    text = text.replace(/<div\s+id=["']?divRplyFwdMsg["']?[^>]*>[\s\S]*?$/gi, '');

    const lines = text.split('\n');
    const cleaned = [];
    let inQuotedSection = false;
    let inSignature = false;

    for (const line of lines) {
      const stripped = line.trim();

      if (stripped === '') {
        cleaned.push('');
        continue;
      }

      if (/^--\s*$/.test(stripped) || /^__+$/.test(stripped) || /^inviato da/i.test(stripped)) {
        inSignature = true;
      }

      if (inSignature) {
        continue;
      }

      if (
        /^>/.test(stripped) ||
        /^On .* wrote:.*$/i.test(stripped) ||
        /^Il giorno .* ha scritto:.*$/i.test(stripped) ||
        /^Il .* alle .* ha scritto:.*$/i.test(stripped) ||
        /^-{3,}.*Messaggio originale.*$/i.test(stripped) ||
        /^-{3,}.*Original Message.*$/i.test(stripped)
      ) {
        inQuotedSection = true;
      }

      if (inQuotedSection) {
        continue;
      }

      cleaned.push(stripped);
    }

    return cleaned.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Normalizza confidence LLM in range [0..1], accettando anche formati localizzati.
   * Esempi supportati: 0.82, "0,82", "82%", 82.
   */
  _normalizeConfidence(confidenceValue) {
    const clamp = (value) => Math.max(0, Math.min(1, value));
    if (typeof confidenceValue === 'number' && Number.isFinite(confidenceValue)) {
      return clamp(confidenceValue > 1 ? confidenceValue / 100 : confidenceValue);
    }

    if (typeof confidenceValue !== 'string') {
      return 0;
    }

    const raw = confidenceValue.trim();
    if (!raw) return 0;

    const hasPercent = raw.includes('%');
    const numeric = parseFloat(raw.replace(',', '.').replace('%', '').trim());
    if (!Number.isFinite(numeric)) return 0;

    if (hasPercent || numeric > 1) {
      return clamp(numeric / 100);
    }
    return clamp(numeric);
  }

  /**
   * Stima confidenza classificazione (0.0 - 1.0) in modo conservativo
   */
  _estimateConfidence({ dimensions, results, textLength, hasExternalHint }) {
    const totalMatches = results.reduce((acc, res) => acc + (res.matchCount || 0), 0);
    const sortedDims = Object.values(dimensions).slice().sort((a, b) => b - a);
    const maxDim = sortedDims[0] || 0;
    const gap = (sortedDims[0] || 0) - (sortedDims[1] || 0);

    let confidence = 0.2;
    if (totalMatches > 0) {
      confidence += Math.min(totalMatches / 6, 0.4);
    }
    confidence += Math.min(gap / 0.5, 0.2);
    if (maxDim >= 0.8) {
      confidence += 0.1;
    }
    if (textLength < 80) {
      confidence -= 0.1;
    }
    if (hasExternalHint) {
      confidence = Math.max(confidence, 0.7);
    }

    return Math.max(0.1, Math.min(confidence, 1.0));
  }

  /**
   * Flag di sicurezza per trasparenza (non bloccanti)
   */
  _buildSafetyFlags({ confidence, dimensions, results, textLength, hasExternalHint }) {
    const flags = [];
    const totalMatches = results.reduce((acc, res) => acc + (res.matchCount || 0), 0);
    const sortedDims = Object.values(dimensions).slice().sort((a, b) => b - a);
    const gap = (sortedDims[0] || 0) - (sortedDims[1] || 0);

    if (totalMatches === 0) flags.push('low_signal');
    if (textLength < 80) flags.push('short_text');
    if (gap < 0.2 && (sortedDims[0] || 0) > 0.3) flags.push('ambiguous');
    if (confidence < 0.35) flags.push('low_confidence');
    if (hasExternalHint) flags.push('external_hint');

    return flags;
  }

  /**
   * Estrae dimensioni continue da hint esterno (0.0 - 1.0)
   */
  _extractExternalDimensions(externalHint) {
    if (!externalHint || !externalHint.dimensions) return null;

    const dims = externalHint.dimensions;
    const keys = ['technical', 'pastoral', 'doctrinal', 'formal'];
    const normalized = {};
    let found = false;

    for (const key of keys) {
      const value = dims[key];
      const raw = typeof value === 'number'
        ? value
        : (typeof value === 'string' ? parseFloat(value.replace(',', '.').replace('%', '').trim()) : NaN);

      if (Number.isFinite(raw)) {
        const scaled = (typeof value === 'string' && value.includes('%')) || raw > 1 ? raw / 100 : raw;
        normalized[key] = Math.max(0, Math.min(scaled, 1));
        found = true;
      }
    }

    return found ? normalized : null;
  }

  _externalHintIndicatesSbattezzo_(externalHint) {
    if (!externalHint || typeof externalHint !== 'object') return false;

    const category = String(externalHint.category || '').trim().toLowerCase();
    if (category === 'sbattezzo') return true;

    const subIntents = (externalHint.subIntents && typeof externalHint.subIntents === 'object')
      ? externalHint.subIntents
      : {};
    if (subIntents.possible_sbattezzo_indirect === true) return true;

    const searchableText = [
      externalHint.topic,
      externalHint.reason,
      externalHint.summary,
      externalHint.description
    ].map(value => String(value || '').toLowerCase()).join(' ');

    return /\bsbattezzo\b|\bsbattezzamento\b|\bapostasia\b|\bapostatare\b|cancellazione\s+(?:dal|dai|dei)\s+registr|registr[oi]\s+del\s+battesim[oa]|uscire\s+dalla\s+chiesa|rinunciare\s+al\s+battesim[oa]/i.test(searchableText);
  }

  /**
   * Generatore separatore standard (80 char) per UI hints
   */
  _getSep() {
    return '─'.repeat(80);
  }

  /**
   * Ottiene suggerimento tipo richiesta per iniezione nel prompt
   * Supporta sia stringa pura che oggetto classificazione completo
   */
  getRequestTypeHint(classificationOrType) {
    // Normalizzazione input: se è stringa, usa solo switch base
    if (typeof classificationOrType === 'string') {
      return this._getSimpleHint(classificationOrType);
    }

    // Input oggetto completo (Nuovo sistema blended)
    const typeInfo = classificationOrType || {};
    const reqType = typeInfo.type || 'mixed';
    const isSbattezzo = !!typeInfo.isSbattezzo;
    const sep = this._getSep();

    // Costruisce l'hint specifico
    if (isSbattezzo) {
      return `
🎯 TIPO RICHIESTA RILEVATO: FORMALE / AMMINISTRATIVA (SBATTEZZO)
${sep}
Linee guida specifiche per lo sbattezzo:
- Non cercare di convincere la persona a cambiare idea
- Spiega la procedura amministrativa (trasmissione al Vescovado)
- Conferma che la volontà sarà rispettata
- Mantieni un tono neutro e rispettoso della libertà di coscienza
${sep}
📖 REGOLA DOTTRINALE (GAS-02):
Questa è una richiesta di natura amministrativa/canonica.
Fornisci informazioni sulla procedura senza giudizio o moralizzazione.
L'accompagnamento pastorale in questo caso è limitato alla cortesia formale.
${sep}
`;
    }

    if (reqType === 'technical') {
      return `TIPO RICHIESTA RILEVATO: TECNICA
---
Linee guida per la risposta:
- Questa richiesta ha componente tecnica/procedurale: attiva la KB informativa e procedurale.
- IL TONO DEVE ESSERE DETTATO ESCLUSIVAMENTE DALLE LINEE GUIDA PRAGMATICHE (Relational Posture).
---`;
    }

    if (reqType === 'pastoral') {
      return `TIPO RICHIESTA RILEVATO: PASTORALE
---
Linee guida per la risposta:
- Questa richiesta ha componente pastorale: attiva i riferimenti dottrinali sacramentali.
- Recupera dalla KB i nodi relativi a: sacramenti, accompagnamento, situazioni di vita.
- IL TONO DEVE ESSERE DETTATO ESCLUSIVAMENTE DALLE LINEE GUIDA PRAGMATICHE (Relational Posture).
---`;
    }

    // Default per mixed o altro
    return `
🎯 TIPO RICHIESTA RILEVATO: MISTA / DOTTRINALE
${sep}
Linee guida per la risposta:
- Questa richiesta richiede sia rigore tecnico che attenzione dottrinale.
- Attiva i riferimenti della Knowledge Base per fornire informazioni precise.
- IL TONO DEVE ESSERE DETTATO ESCLUSIVAMENTE DALLE LINEE GUIDA PRAGMATICHE (Relational Posture).
${sep}
📖 REGOLA DOTTRINALE (GAS-02):
Questa è una richiesta di SPIEGAZIONE dottrinale generale.
✅ DEVI: Spiegare l'insegnamento della Chiesa
✅ DEVI: Essere chiaro, fedele, informativo
❌ NON: Rimandare al sacerdote per domande teoriche
❌ NON: Evitare di rispondere per "prudenza"

Il rinvio al sacerdote è riservato SOLO a:
- Situazioni personali concrete
- Discernimento su stati di vita
- Accompagnamento spirituale individuale
${sep}
`;
  }

  /**
   * Metodo privato per compatibilità con chiamate semplici (solo stringa)
   */
  _getSimpleHint(requestType) {
    const sep = this._getSep();
    if (requestType === 'technical') {
      return `\n🎯 TIPO RICHIESTA: TECNICA\n${sep}\nSegui le linee guida pragmatiche per il tono.\n${sep}\n`;
    } else if (requestType === 'pastoral') {
      return `\n🎯 TIPO RICHIESTA: PASTORALE\n${sep}\nSegui le linee guida pragmatiche per il tono.\n${sep}\n`;
    }
    return `\n🎯 TIPO RICHIESTA: GENERALE\n${sep}\nSegui le linee guida pragmatiche per il tono.\n${sep}\n`;
  }
}

// Funzione factory
function createRequestTypeClassifier() {
  return new RequestTypeClassifier();
}
