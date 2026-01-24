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
class RequestTypeClassifier {
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

      // Riferimenti a ruoli formali (peso 1-2)
      { pattern: /\bpadrino\b/i, weight: 1 },
      { pattern: /\bmadrina\b/i, weight: 1 },
      { pattern: /\btestimone\b/i, weight: 1 },
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

      // Situazioni di vita complesse - ENGLISH (peso 2)
      { pattern: /\bdivorced\b/i, weight: 2 },
      { pattern: /\bseparated\b/i, weight: 2 },
      { pattern: /\bremarried\b/i, weight: 2 },
      { pattern: /\bcohabiting\b/i, weight: 2 },
      { pattern: /\banglican\b/i, weight: 2 },
      { pattern: /\bprotestant\b/i, weight: 2 },
      { pattern: /\bprevious marriage\b/i, weight: 2 },

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
      { pattern: /\bnon voglio più risultare\b/i, weight: 3 },
      { pattern: /\babbandonare la fede\b/i, weight: 3 },
      { pattern: /\babbandonare la religione\b/i, weight: 3 }
    ];

    console.log('✓ RequestTypeClassifier inizializzato');
  }

  /**
   * Classifica la richiesta email
   * Restituisce dimensioni continue, complessità e tono suggerito.
   */
  classify(subject, body, externalHint = null) {
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
    const dimensions = {
      technical: Math.min(technicalResult.score / SATURATION_POINT, 1.0),
      pastoral: Math.min(pastoralResult.score / SATURATION_POINT, 1.0),
      doctrinal: Math.min(doctrineResult.score / SATURATION_POINT, 1.0),
      formal: Math.min(formalResult.score / SATURATION_POINT, 1.0)
    };

    // 3. Logica Ibrida (Integrazione Gemini se disponibile)
    let source = 'regex';
    const hasExternalHint = Boolean(externalHint && externalHint.category && externalHint.confidence >= 0.75);
    if (hasExternalHint) {
      // Boost dimensionale basato su Gemini
      const categoryMap = {
        'technical': 'technical',
        'appointment': 'technical',
        'pastoral': 'pastoral',
        'doctrinal': 'doctrinal',
        'formal': 'formal',
        'sbattezzo': 'formal'
      };

      const mappedDim = categoryMap[externalHint.category.toLowerCase()];
      if (mappedDim) {
        dimensions[mappedDim] = Math.max(dimensions[mappedDim], 0.8); // Trust Gemini
        source = 'hybrid';
      }
    }

    // 4. Determinazione Tipo Primario (Backward Compatibility)
    let requestType = 'technical';

    // Priorità gerarchica
    if (dimensions.formal >= 0.6) {
      requestType = 'formal';
    } else if (dimensions.doctrinal >= 0.6) {
      requestType = 'doctrinal';
    } else if (dimensions.pastoral >= 0.6 && dimensions.pastoral > dimensions.technical) {
      requestType = 'pastoral';
    } else if (dimensions.pastoral >= 0.4 && dimensions.technical >= 0.4) {
      requestType = 'mixed';
    } else {
      requestType = 'technical';
    }

    // Override specifico per sbattezzo (Critical logic)
    if (formalResult.score >= 4) requestType = 'formal';

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

    // Tono Suggerito
    let suggestedTone = 'Professionale';
    if (dimensions.pastoral > dimensions.technical) suggestedTone = 'Empatico e Accogliente';
    else if (dimensions.formal > 0.5) suggestedTone = 'Istituzionale e Neutro';
    else if (dimensions.doctrinal > 0.5) suggestedTone = 'Istruttivo e Chiaro';
    else if (complexity === 'High') suggestedTone = 'Strutturato e Dettagliato';

    // Flag legacy
    const needsDiscernment = dimensions.pastoral > 0.3 || requestType === 'mixed';
    const needsDoctrine = dimensions.doctrinal > 0.3 || (dimensions.doctrinal > 0 && requestType !== 'technical');

    const result = {
      type: requestType, // Legacy
      source: source,
      dimensions: dimensions, // New
      complexity: complexity, // New
      emotionalLoad: emotionalLoad, // New
      suggestedTone: suggestedTone, // New

      technicalScore: dimensions.technical, // Normalized
      pastoralScore: dimensions.pastoral,
      doctrineScore: dimensions.doctrinal,
      formalScore: dimensions.formal,

      confidence: confidence,
      safetyFlags: safetyFlags,

      needsDiscernment: needsDiscernment,
      needsDoctrine: needsDoctrine,
      detectedIndicators: [
        ...technicalResult.matched,
        ...pastoralResult.matched,
        ...doctrineResult.matched,
        ...formalResult.matched
      ]
    };

    console.log(`   📊 Classificazione: ${requestType.toUpperCase()} (Tono: ${suggestedTone})`);
    console.log(`      Dims: T=${dimensions.technical.toFixed(2)} P=${dimensions.pastoral.toFixed(2)} D=${dimensions.doctrinal.toFixed(2)} F=${dimensions.formal.toFixed(2)}`);
    console.log(`      Emotion=${emotionalLoad}, Complex=${complexity}`);

    return result;
  }

  /**
   * Calcola punteggio ponderato per set di indicatori
   */
  _calculateScore(text, indicators) {
    let total = 0;
    const matched = [];
    let matchCount = 0;

    for (const indicator of indicators) {
      const matches = text.match(indicator.pattern);
      if (matches) {
        total += indicator.weight * matches.length;
        matchCount += matches.length;
        matched.push(indicator.pattern.source);
      }
    }

    return { score: total, matched: matched, matchCount: matchCount };
  }

  /**
   * Sanitizza il testo evitando falsi positivi da quote e firme
   */
  _sanitizeText(subject, body) {
    let text = `${subject || ''}\n${body || ''}`;

    text = text.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
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
   * Ottiene suggerimento tipo richiesta per iniezione nel prompt
   * Supporta sia stringa legacy che oggetto classificazione completo
   */
  getRequestTypeHint(classificationOrType) {
    // Normalizzazione input: se è stringa (legacy), usa solo switch base
    if (typeof classificationOrType === 'string') {
      return this._getLegacyHint(classificationOrType);
    }

    // Input oggetto completo (Nuovo sistema blended)
    const cls = classificationOrType;
    if (!cls || !cls.dimensions) return '';

    // Costruzione Hint Composito
    // Costruzione Hint Composito (Evoluzione 4: Blended Hints)
    const hints = [];
    const dims = cls.dimensions;

    // 1. Header Dinamico
    let header = `🎯 ANALISI RICHIESTA (Complessità: ${cls.complexity}, Emotività: ${cls.emotionalLoad})`;

    // 2. Mix Dimensionale Graduale
    if (dims.formal > 0.6) {
      hints.push(`⚖️ FORMALE (${(dims.formal * 100).toFixed(0)}%):
       - Usa template rigidi e tono istituzionale
       - Evita commenti personali non richiesti`);
    }

    // Componente Tecnica
    if (dims.technical >= 0.3) {
      const intensity = dims.technical >= 0.8 ? 'PRIMARIO' : 'IMPORTANTE';
      hints.push(`⚙️ COMPONENTE TECNICA (${intensity}):
       - Fornisci informazioni concrete e verificabili
       - Usa bullet point se 3+ elementi
       - Specifica orari/date/luoghi esatti`);
    }

    // Componente Pastorale
    if (dims.pastoral >= 0.3) {
      const intensity = dims.pastoral >= 0.8 ? 'PRIMARIA' : 'PRESENTE';
      const emoContext = cls.emotionalLoad === 'High' ? 'massima priorità empatica' : 'tono cordiale';
      hints.push(`💙 COMPONENTE PASTORALE (${intensity}):
       - Riconosci la situazione personale espressa (${emoContext})
       - ${cls.emotionalLoad === 'High' ? 'Offri disponibilità al dialogo umano' : 'Mostra comprensione e calore'}`);
    }

    // Componente Dottrinale
    if (dims.doctrinal >= 0.3) {
      hints.push(`📖 COMPONENTE DOTTRINALE (RILEVANTE):
       - Spiega l'insegnamento della Chiesa con chiarezza
       - Cita fonti se utile (Catechismo, etc.)`);
    }

    // Istruzioni di Bilanciamento (Core Logic)
    if (dims.technical >= 0.4 && dims.pastoral >= 0.4) {
      hints.push(`⚖️ BILANCIAMENTO RICHIESTO:
       Questa email richiede ENTRAMBI gli approcci (Tecnico + Pastorale).
       1. Inizia riconoscendo la situazione personale (Empatia)
       2. Poi fornisci le informazioni concrete richieste (Efficienza)
       3. Chiudi con disponibilità umana`);
    }

    // 3. Tono Consigliato
    const toneInstruction = `\n🗣️ TONO SUGGERITO: ${cls.suggestedTone.toUpperCase()}`;

    return `${header}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${hints.join('\n\n')}\n${toneInstruction}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  /**
   * Metodo privato per backward compatibility con chiamate legacy (solo stringa)
   */
  _getLegacyHint(requestType) {
    if (requestType === 'technical') {
      return `
🎯 TIPO RICHIESTA RILEVATO: TECNICA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Linee guida per la risposta:
- Rispondi in modo CHIARO e BREVE
- Fornisci l'informazione richiesta direttamente
- Non eccedere in empatia o moralizzazione
- Evita lunghe introduzioni emotive

📖 REGOLA DOTTRINALE (GAS-02):
Se il contenuto richiesto è dottrinale o canonico generale
e NON coinvolge una situazione personale o discernimento,
SPIEGA direttamente l'insegnamento della Chiesa.
NON rimandare al sacerdote per domande informative.
Il rinvio è riservato SOLO ai casi di discernimento personale.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    } else if (requestType === 'pastoral') {
      return `
🎯 TIPO RICHIESTA RILEVATO: PASTORALE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Linee guida per la risposta:
- Rispondi in modo ACCOGLIENTE e PERSONALE
- Riconosci la situazione/sentimento espresso
- Accompagna la persona, non giudicare
- Non fermarti solo alla norma
- Invita al dialogo personale se opportuno
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    } else if (requestType === 'mixed') {
      return `
🎯 TIPO RICHIESTA RILEVATO: MISTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Linee guida per la risposta:
- Rispondi TECNICAMENTE (chiarezza) ma con TONO pastorale
- Non fermarti alla sola regola
- Non scivolare nel permissivismo
- Bilancia informazione e accoglienza
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    } else if (requestType === 'doctrinal') {
      return `
🎯 TIPO RICHIESTA RILEVATO: DOTTRINALE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Linee guida per la risposta:
- RISPONDI DIRETTAMENTE alle domande di fede
- Spiega la dottrina in modo chiaro e accessibile
- Usa fonti: Catechismo, Magistero, Scrittura
- NON rimandare al sacerdote per domande informative

📖 REGOLA DOTTRINALE (GAS-02):
Questa è una richiesta di SPIEGAZIONE dottrinale generale.
✅ DEVI: Spiegare l'insegnamento della Chiesa
✅ DEVI: Essere chiaro, fedele, informativo
❌ NON: Rimandare al sacerdote per domande teorie
❌ NON: Evitare di rispondere per "prudenza"

Il rinvio al sacerdote è riservato SOLO a:
- Situazioni personali concrete
- Discernimento su stati di vita
- Accompagnamento spirituale individuale
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    } else if (requestType === 'formal') {
      return `
🎯 TIPO RICHIESTA RILEVATO: FORMALE / AMMINISTRATIVA (SBATTEZZO)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Linee guida per la risposta:
- USA ESCLUSIVAMENTE IL TEMPLATE "SBATTEZZO"
- NON aggiungere consigli pastorali o inviti al colloquio non previsti nel template
- Tono professionale, neutro e formale
- Non fare moralismi o commenti teologici extra
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    }

    // Fallback predefinito
    return '';
  }
}

// Funzione factory
function createRequestTypeClassifier() {
  return new RequestTypeClassifier();
}