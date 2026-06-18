/**
 * Classifier.gs - Classificazione email semplificata
 * 
 * FILOSOFIA:
 * - Filtra SOLO acknowledgment ultra-semplici (≤3 parole)
 * - Filtra SOLO saluti standalone
 * - TUTTO IL RESTO va a Gemini per analisi intelligente
 * - Zero falsi negativi: in caso di dubbio, Gemini decide
 * 
 * FUNZIONALITÀ:
 * - Rilevamento sub-intent per sfumature emotive
 * - Categorizzazione suggerimento per Gemini
 * - Estrazione contenuto principale (rimuove citazioni/firme)
 */
var Classifier = class Classifier {
  constructor() {
    console.log('🧠 Inizializzazione Classifier...');

    // Pattern saluto-solo (saluti standalone senza contenuto)
    this.greetingOnlyPatterns = [
      /^(buongiorno|buonasera|salve|ciao)\.?\s*$/i,
      /^cordiali\s+saluti\.?\s*$/i,
      /^distinti\s+saluti\.?\s*$/i
    ];

    // Categorie per suggerimenti a Gemini
    this.categories = {
      'appointment': [
        'appuntamento', 'fissare', 'prenotare', 'quando posso',
        'disponibilità', 'orario', 'incontro', 'prenotazione',
        'appointment', 'schedule', 'book', 'booking', 'availability'
      ],
      'information': [
        'informazioni', 'chiedere', 'sapere', 'vorrei sapere', 'info',
        'orari', 'dove', 'come fare', 'procedura', 'chiarimenti',
        'information', 'know', 'how to', 'procedure', 'clarification', 'hours'
      ],
      'document_submission': [
        'in allegato', 'allego', 'le invio', 'vi invio',
        'trasmetto', 'trova allegato', 'troverete allegato',
        'invio il documento', 'documento allegato', 'documento di',
        'mando il documento', 'inoltro il documento'
      ],
      'sacrament': [
        'battesimo', 'comunione', 'cresima', 'matrimonio',
        'sacramento', 'confessione', 'prima comunione',
        'baptism', 'communion', 'confirmation', 'marriage', 'sacrament', 'consegna certificato'
      ],
      'collaboration': [
        'collaborare', 'volontario', 'aiutare', 'proposta',
        'progetto', 'iniziativa', 'gruppo', 'offrire',
        'collaborate', 'volunteer', 'help', 'proposal', 'project'
      ],
      'complaint': [
        'lamentela', 'problema', 'disservizio', 'insoddisfatto',
        'reclamo', 'complaint', 'problem', 'issue', 'dissatisfied'
      ],
      'quotation': [
        'preventivo', 'offerta', 'quotazione', 'proposta commerciale',
        'prezzo', 'tariffa', 'costo', 'listino', 'budget',
        'orçamento', 'cotação', 'proposta', 'preço', 'presupuesto',
        'quote', 'quotation', 'pricing', 'offer', 'estimate', 'price list'
      ],
      'sbattezzo': [
        'sbattezzo', 'sbattezzamento', 'apostasia', 'apostatare',
        'abbandonare la religione', 'abbandonare la fede', 'rinnegare la fede',
        'non mi ritengo più cristiano', 'cancellazione dal registro', 'registri del battesimo',
        'uscire dalla chiesa', 'non voglio più essere cattolico', 'non voglio piu essere cattolico',
        'cancellarmi dalla chiesa', 'disiscrivermi dalla chiesa', 'rinunciare al battesimo',
        'togliermi dai registri', 'essere rimosso dai registri',
        'non essere più registrato come cattolico', 'non essere piu registrato come cattolico'
      ]
    };

    // Parole chiave sub-intent per sfumature emotive
    this.subIntentKeywords = {
      'emotional_distress': [
        'deluso', 'delusa', 'delusione', 'arrabbiato', 'arrabbiata',
        'insoddisfatto', 'insoddisfatta', 'frustrato', 'frustrata',
        'scandalizzato', 'indignato', 'amareggiato', 'dispiaciuto',
        'non va bene', 'inaccettabile', 'vergogna', 'pessimo',
        'disappointed', 'angry', 'frustrated', 'upset', 'unacceptable'
      ],
      'gratitude': [
        'ringrazio', 'grato', 'grata', 'riconoscente',
        'gentilissimo', 'gentilissima', 'prezioso aiuto',
        'grateful', 'thankful', 'appreciate'
      ],
      'bereavement': [
        'lutto', 'defunto', 'defunta', 'morto', 'morta', 'decesso',
        'scomparso', 'scomparsa', 'funerale', 'esequie',
        'deceased', 'passed away', 'funeral', 'bereavement'
      ],
      'confusion': [
        'non capisco', 'confuso', 'confusa', 'non mi è chiaro',
        'potrebbe spiegare', 'non ho capito',
        'confused', 'unclear', "don't understand"
      ]
    };

    console.log('✓ Classifier inizializzato');
    console.log(`   Filosofia: Filtra solo casi ovvi, delega il resto a Gemini`);
  }

  /**
   * Classifica email - filtro minimale
   */
  classifyEmail(subject, body, isReply = false, senderEmail = null) {
    const safeSubject = typeof subject === 'string' ? subject : '';
    let safeBody = typeof body === 'string' ? body : '';

    // Supporto firma alternativa: il 3° parametro può essere senderEmail anziché booleano.
    if (typeof isReply === 'string' && senderEmail === null) {
      senderEmail = isReply;
      isReply = /^(re|rif|r|ris|risp|aw|sv|fw|fwd|tr|i|wg|inc)\s*[:\-]/i.test(safeSubject.trim());
    }

    // Sicurezza null e limite lunghezza
    if (safeSubject.trim() === '' && safeBody.trim() === '') {
      console.error('  ❌ Contenuto email vuoto');
      return { shouldReply: false, reason: 'empty_email', category: null, subIntents: {}, confidence: 1.0 };
    }

    if (safeBody.length > 10000) {
      console.error('  ❌ Email molto lunga (>10000 caratteri)');
      const cut = safeBody.substring(0, 10000);
      const lastLt = cut.lastIndexOf('<');
      const lastGt = cut.lastIndexOf('>');

      // Evita di lasciare nel payload un tag HTML aperto/spezzato dal troncamento.
      if (lastLt > lastGt) {
        safeBody = cut.substring(0, lastLt);
      } else {
        const boundary = Math.max(cut.lastIndexOf('>'), cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
        safeBody = boundary > 0 ? cut.substring(0, boundary) : cut;
      }
    }

    console.log(`   🔍 Classificando: '${safeSubject.substring(0, 50)}...'`);

    // Estrai contenuto principale
    const mainContent = this._extractMainContent(safeBody);
    console.log(`      Contenuto principale: ${mainContent.length} caratteri`);

    const fullText = `${safeSubject} ${mainContent}`;
    const contextualSubIntents = this._detectSubIntents(fullText);

    if (this._isDocumentSubmission(mainContent)) {
      return {
        shouldReply: true,
        reason: 'document_submission_detected',
        category: 'document_submission',
        subIntents: contextualSubIntents,
        confidence: 0.95
      };
    }

    // Corpo vuoto + soggetto generico (es. "Re: Orari messe") → passa a Gemini
    if ((!mainContent || !mainContent.trim()) && isReply) {
      const subjectClean = safeSubject.replace(/^(re|rif|r|ris|risp|aw|sv|fw|fwd|tr|i|wg|inc)\s*[:\-]\s*/i, '').trim();
      if (subjectClean.length > 3 && subjectClean.length < 50) {
        console.log('      ✓ Body vuoto ma subject ragionevole -> Passa a Gemini');
        return {
          shouldReply: true,
          reason: 'needs_ai_analysis',
          category: null,
          subIntents: contextualSubIntents,
          confidence: 0.8
        };
      }
    }

    // Se il body è vuoto e NON soddisfa criterio sopra, usa subject per filtri rapidi
    const contentForQuickChecks = this._isTrivialReplyBody(mainContent) ? safeSubject : mainContent;

    // FILTRO 1: Acknowledgment ultra-semplice
    if (this._isUltraSimpleAcknowledgment(contentForQuickChecks)) {
      console.log('      ✗ Acknowledgment ultra-semplice (≤3 parole, nessuna domanda)');
      return {
        shouldReply: false,
        reason: 'ultra_simple_acknowledgment',
        category: null,
        subIntents: {},
        confidence: 1.0
      };
    }

    // FILTRO 2: Solo saluto
    if (this._isGreetingOnly(contentForQuickChecks)) {
      console.log('      ✗ Solo saluto (standalone)');
      return {
        shouldReply: false,
        reason: 'greeting_only',
        category: null,
        subIntents: {},
        confidence: 0.95
      };
    }

    // FILTRO 3: Auto-risposte esplicite (OOO/ferie)
    if (this._isOutOfOfficeAutoReply(safeSubject, safeBody)) {
      console.log('      ✗ Auto-risposta Out of Office rilevata');
      return {
        shouldReply: false,
        reason: 'out_of_office_auto_reply',
        category: null,
        subIntents: {},
        confidence: 0.98
      };
    }

    // PRIORITÀ LEGALE/PRIVACY: richieste formali (es. sbattezzo/apostasia)
    if (this._isSbattezzoFormalRequest_(fullText)) {
      console.log('      ⚠️ Richiesta formale rilevata (sbattezzo/apostasia)');
      return {
        shouldReply: true,
        reason: 'formal_request_detected',
        category: 'formal',
        subIntents: contextualSubIntents,
        confidence: 1.0
      };
    }

    // TUTTO IL RESTO: Passa a Gemini
    const category = this._categorizeContent(fullText);
    const subIntents = contextualSubIntents;

    console.log('      ✓ Passa a Gemini per analisi intelligente');
    if (category) {
      console.log(`      → Suggerimento categoria: ${category}`);
    }
    if (Object.keys(subIntents).length > 0) {
      console.log(`      → Sub-intent: ${Object.keys(subIntents).join(', ')}`);
    }

    return {
      shouldReply: true,
      reason: 'needs_ai_analysis',
      category: category,
      subIntents: subIntents,
      confidence: category ? 0.85 : 0.75
    };
  }

  // ========================================================================
  // METODI HELPER
  // ========================================================================


  /**
   * Estrae contenuto principale, rimuovendo citazioni e firme.
   * Input atteso: plain-text (body email).
   */
  _extractMainContent(body) {
    let processedBody = typeof body === 'string' ? body : '';

    const MAX_LENGTH = 50000;
    if (processedBody.length > MAX_LENGTH) {
      processedBody = processedBody.substring(0, MAX_LENGTH);
    }

    // Marcatori citazione per vari client email
    const quoteMarkers = [
      /^>\s*(?:Da|From|On|Il giorno|Le)\b.*$/im,
      /^On .* wrote:.*$/m,
      /^Il giorno .* ha scritto:.*$/m,
      /^Il .* alle .* .* ha scritto:.*$/m,
      /^Da:\s*.*<[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}>.*$/m,
      /^From:.*Sent:.*$/m,
      /^-{3,}.*Original Message.*$/m,
      /^-{3,}.*Messaggio originale.*$/m,
      /^_{3,}$/m,
      /^Begin forwarded message:.*$/m,
      /^Inizio messaggio inoltrato:.*$/m,
      /^-------- Forwarded Message --------$/m,
      /^\*From:\*.*$/m,
      /^Le .* \u00E0 .* .* a \u00E9crit.*$/m,
      /^Le .* a \u00E9crit.*$/m,
      /^Le .* a \u00E8crit.*$/m
    ];

    const lines = processedBody.split('\n');
    const cleanLines = [];
    let inQuoteBlock = false;

    for (const line of lines) {
      const safeLine = line == null ? '' : String(line);
      const stripped = safeLine.trim();

      // Mantieni righe vuote per separazione paragrafi
      if (stripped === '') {
        if (!inQuoteBlock) cleanLines.push(safeLine);
        continue;
      }

      // Salta saluti standalone all'inizio
      if (/^(salve|buongiorno|buonasera|ciao)[\s,!.]{0,5}$/i.test(stripped)) {
        continue;
      }

      // Salta blocchi citati, ma consenti inline-reply dopo quote
      let isQuote = false;
      for (const marker of quoteMarkers) {
        // Reset di sicurezza: previene la perdita di stato se gli indicatori di virgolette ottengono successivamente i flag /g o /y.
        marker.lastIndex = 0;
        if (marker.test(stripped)) {
          isQuote = true;
          break;
        }
      }
      if (isQuote || stripped.startsWith('>')) {
        inQuoteBlock = true;
        continue;
      }
      if (inQuoteBlock &&
          /^[\p{L}\p{N}]/u.test(stripped) &&
          !stripped.startsWith('>') &&
          !stripped.startsWith('|')) {
        inQuoteBlock = false;
      }

      cleanLines.push(safeLine);
    }

    let content = cleanLines.join('\n').trim();

    // Rimuovi firme solo quando appaiono come riga dedicata.
    // Classifica correttamente l'identificazione precisa delle firme contestuali in frasi come:
    // "Cordiali saluti da tutta la famiglia, vorrei sapere se..."
    // L'approccio line-based garantisce precisione nell'identificazione delle firme
    // ed evita falsi positivi all'interno di frasi di testo libero.
    const signatureLineMarkers = [
      /^cordiali\s+saluti[\s,!.-]*$/i,
      /^distinti\s+saluti[\s,!.-]*$/i,
      /^in\s+fede[\s,!.-]*$/i,
      /^best\s+regards[\s,!.-]*$/i,
      /^sincerely[\s,!.-]*$/i,
      /^sent\s+from\s+my\s+iphone[\s,!.-]*$/i,
      /^inviato\s+da\s+(?:mio\s+)?(?:iphone|samsung|smartphone|dispositivo|ipad|telefono)[\s,!.-]*$/i
    ];

    const contentLines = content.split('\n');
    let signatureStartIndex = -1;
    for (let i = contentLines.length - 1; i >= 0; i--) {
      const line = (contentLines[i] || '').trim();
      if (!line) continue;
      if (signatureLineMarkers.some(marker => marker.test(line))) {
        signatureStartIndex = i;
        break;
      }
    }

    if (signatureStartIndex !== -1) {
      const remainingLines = contentLines
        .slice(signatureStartIndex + 1)
        .map(line => (line || '').trim())
        .filter(Boolean);
      const remainingText = remainingLines.join(' ').trim();
      const containsUserContentAfterSignature = /[?!]|\b(?:ah\s+dimenticavo|dimenticavo|vorrei|posso|potrei|chiedo|sapere|informazioni|prenotare|allego|inoltre)\b/i.test(remainingText);
      const tailLooksLikeSignature = remainingLines.length === 0 || (
        remainingLines.length <= 3 &&
        !containsUserContentAfterSignature &&
        remainingLines.every((line) => {
          if (line.length > 80) return false;
          return /^[A-Za-zÀ-ÖØ-öø-ÿ .'-]+$/.test(line) ||
            /(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\+?\d[\d .()-]{5,}|https?:\/\/|www\.)/i.test(line);
        })
      );

      if (tailLooksLikeSignature) {
        content = contentLines.slice(0, signatureStartIndex).join('\n').trim();
      }
    }

    return content;
  }

  /**
   * Controlla se acknowledgment ultra-semplice (≤3 parole, nessuna domanda)
   */
  _isUltraSimpleAcknowledgment(text) {
    if (!text || text.trim().length === 0) return false;

    // Controllo presenza domanda prima della normalizzazione
    if (text.includes('?')) return false;

    // Normalizza
    let normalized = text.toLowerCase().trim();
    try {
      normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, '');
    } catch (e) {
      // Fallback compatibilità runtime che non supportano Unicode property escapes
      normalized = normalized.replace(/[^\w\sÀ-ÖØ-öø-ÿ]/g, '');
    }
    normalized = normalized.replace(/\s+/g, ' ');

    // Conta parole
    const wordCount = normalized.split(' ').filter(w => w.length > 0).length;
    const hasOperationalInfo = /\b(oggi|domani|stamattina|stasera|alle|ore|appuntamento|vengo|veniamo|venite|vado|arrivo|passo|porto|documenti|pagato|bonifico)\b|\d/.test(normalized);
    if (hasOperationalInfo) return false;

    // STRICT: max 3 parole
    if (wordCount > 3) return false;

    // Deve contenere parola di ringraziamento/ricevuto
    const thankWords = ['grazie', 'ringrazio', 'ricevuto', 'ok', 'perfetto'];
    const normalizedWords = normalized.split(' ').filter(w => w.length > 0);
    const hasThanks = normalizedWords.some(word => thankWords.includes(word));

    return hasThanks;
  }

  /**
   * Rileva pattern espliciti di auto-risposta (OOO/ferie)
   */
  _isOutOfOfficeAutoReply(subject, body) {
    const normalized = `${subject || ''} ${body || ''}`.toLowerCase();
    const oooPatterns = [
      /\bout\s+of\s+office\b/i,
      /\bout\s+of\s+the\s+office\b/i,
      /\bauto(?:matic)?\s*reply\b/i,
      /\brisposta\s+automatica\b/i,
      /\bsono\s+in\s+ferie\b/i,
      /\bassen[tz]a\s+per\s+ferie\b/i,
      /\bnon\s+sono\s+in\s+ufficio\b/i,
      /\bassenza\s+per\s+malattia\b/i,
      /\bcongedo\s+per\s+malattia\b/i,
      /\bsono\s+in\s+vacc?anze\b/i,
      /\btorno\s+dalle\s+vacc?anze\b/i
    ];

    return oooPatterns.some(pattern => pattern.test(normalized));
  }

  /**
   * Verifica se solo saluto
   */
  _isGreetingOnly(text) {
    // Controllo presenza domanda prima della normalizzazione
    if (text.includes('?')) return false;

    let normalized = text.toLowerCase().trim();
    try {
      normalized = normalized.normalize('NFC');
    } catch (e) {
      // Runtime legacy senza normalize: proseguiamo con la normalizzazione disponibile.
    }
    try {
      normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, '');
    } catch (e) {
      normalized = normalized.replace(/[^\w\sÀ-ÖØ-öø-ÿ]/g, '');
    }

    if (this.greetingOnlyPatterns.some(pattern => pattern.test(normalized))) {
      return true;
    }

    return false;
  }

  /**
   * Rileva body banale (vuoto o solo "Re:")
   */
  _isTrivialReplyBody(text) {
    if (!text) return true;

    const normalized = text.toLowerCase().trim();
    let cleaned;
    try {
      cleaned = normalized.replace(/[^\p{L}\p{N}\s:]/gu, '');
    } catch (e) {
      cleaned = normalized.replace(/[^\w\sÀ-ÖØ-öø-ÿ:]/g, '');
    }
    const words = cleaned.split(/\s+/).filter(Boolean);

    if (words.length === 0) return true;
    if (words[0] === 're' || words[0] === 're:') {
      return words.length <= 3;
    }

    return false;
  }

  /**
   * Categorizza contenuto (suggerimento per Gemini)
   */
  _categorizeContent(text) {
    if (this._isOfficeVisitLogisticsRequest(text)) {
      return 'appointment';
    }

    const textLower = text.toLowerCase();
    const categoryScores = {};

    for (const category in this.categories) {
      const keywords = this.categories[category];
      const score = keywords.filter(kw => this._matchesCategoryKeyword_(textLower, kw, category)).length;
      if (score > 0) {
        categoryScores[category] = score;
      }
    }

    if (Object.keys(categoryScores).length === 0) return null;

    // Ritorna categoria con punteggio più alto
    let maxCategory = null;
    let maxScore = 0;
    const priority = ['sbattezzo', 'sacrament', 'complaint', 'quotation', 'collaboration', 'appointment', 'information'];
    const getPriorityOrInfinity = (category) => {
      const idx = priority.indexOf(category);
      return idx !== -1 ? idx : Number.POSITIVE_INFINITY;
    };
    for (const cat in categoryScores) {
      const catPriority = getPriorityOrInfinity(cat);
      const maxPriority = maxCategory ? getPriorityOrInfinity(maxCategory) : Number.POSITIVE_INFINITY;
      if (
        categoryScores[cat] > maxScore ||
        (categoryScores[cat] === maxScore && catPriority < maxPriority)
      ) {
        maxScore = categoryScores[cat];
        maxCategory = cat;
      }
    }
    return maxCategory;
  }

  _matchesCategoryKeyword_(textLower, keyword, category) {
    const normalizedKeyword = String(keyword || '').toLowerCase().trim();
    if (!normalizedKeyword) return false;

    const escaped = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keywordRegex = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
    if (!keywordRegex.test(textLower)) return false;

    if (category === 'document_submission' && normalizedKeyword === 'documento di') {
      return /\b(allego|in\s+allegato|invio|trasmetto|mando|inoltro|spedisco)\b/i.test(textLower);
    }

    return true;
  }

  /**
   * Rileva sub-intent emotivi
   */
  _detectSubIntents(text) {
    const textLower = text.toLowerCase();
    const detected = {};

    for (const intentName in this.subIntentKeywords) {
      const keywords = this.subIntentKeywords[intentName];
      for (const keyword of keywords) {
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
        if (regex.test(textLower)) {
          detected[intentName] = true;
          break;
        }
      }
    }

    const priorOralCommunication = this._detectPriorOralCommunication(text);
    if (priorOralCommunication.detected) {
      detected.prior_oral_communication = priorOralCommunication;
    }

    return detected;
  }

  _isSbattezzoFormalRequest_(text) {
    const source = String(text || '').toLowerCase();
    return /\bsbattezzo\b|\bsbattezzamento\b|\bapostasia\b|\bapostatare\b|\babbandonare\s+la\s+(?:fede|religione)\b|\brinnegare\s+la\s+fede\b|cancellazione\s+(?:dal|dai|dei)\s+registr|registr[oi]\s+del\s+battesim[oa]|uscire\s+dalla\s+chiesa|cancellarmi\s+dalla\s+chiesa|disiscrivermi\s+dalla\s+chiesa|rinunciare\s+al\s+battesim[oa]|(?:togliermi|rimuovermi|essere\s+rimosso)\s+dai\s+registr|non\s+(?:voglio|desidero)\s+(?:piu|più)\s+essere\s+(?:cattolic[oa]|cristian[oa])|non\s+(?:mi\s+)?(?:ritengo|sento)\s+(?:piu|più)\s+(?:cattolic[oa]|cristian[oa])|non\s+essere\s+(?:piu|più)\s+registrat[oa]\s+come\s+cattolic[oa]/i.test(source);
  }

  /**
   * Rileva contatti telefonici o personali gia avvenuti, senza assumere che
   * ogni dettaglio sia gia stato approvato.
   */
  _detectPriorOralCommunication(text) {
    const source = String(text || '');
    const normalized = source.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return {
        detected: false,
        strength: 'none',
        mentioned_contact: null,
        signals: []
      };
    }

    const strongPatterns = [
      /\briscontro\s+telefonico\b/i,
      /\bcontatto\s+telefonico\b/i,
      /\bcolloquio\s+telefonico\b/i,
      /\btelefonata\s+(?:intercorsa|avuta|di|del|della|con)\b/i,
      /\b(?:ci|vi|mi)\s+siamo\s+sentit[ie]\b/i,
      /\b(?:ho|abbiamo|avevo|avevamo)\s+(?:gia\s+|già\s+)?parlato\s+con\b/i,
      /\bcome\s+(?:gia\s+|già\s+)?(?:concordato|anticipato|accennato)\b/i,
      /\bcome\s+da\s+(?:accordi|telefonata|colloquio|incontro)\b/i,
      /\bcome\s+ci\s+siamo\s+detti\b/i,
      /\ba\s+(?:seguito|conferma)\s+di\s+quanto\s+(?:discusso|detto|concordato)\b/i,
      /\ba\s+seguito\s+del(?:\s+nostro)?\s+(?:colloquio|incontro|appuntamento)\b/i,
      /\bdopo\s+il(?:\s+nostro)?\s+(?:colloquio|incontro|appuntamento)\b/i
    ];

    const weakPatterns = [
      /\bcome\s+(?:le|vi)\s+accennavo\b/i,
      /\bcome\s+(?:gia\s+|già\s+)?anticipato\b/i,
      /\briassumo\s+quanto\s+(?:detto|concordato)\b/i,
      /\bvi\s+scrivo\s+per\s+confermare\s+quanto\b/i,
      /\ble\s+scrivo\s+per\s+confermare\s+quanto\b/i
    ];

    const strongSignals = this._collectPriorCommunicationSignals_(normalized, strongPatterns);
    const weakSignals = strongSignals.length > 0
      ? []
      : this._collectPriorCommunicationSignals_(normalized, weakPatterns);
    const signals = strongSignals.length > 0 ? strongSignals : weakSignals;

    return {
      detected: signals.length > 0,
      strength: strongSignals.length > 0 ? 'strong' : (weakSignals.length > 0 ? 'weak' : 'none'),
      mentioned_contact: this._extractPriorCommunicationContact_(normalized),
      signals: signals.slice(0, 4)
    };
  }

  _collectPriorCommunicationSignals_(text, patterns) {
    const signals = [];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[0]) {
        signals.push(match[0].trim());
      }
    }
    return signals;
  }

  _extractPriorCommunicationContact_(text) {
    const safeText = String(text || '');
    const contactPatterns = [
      /\b(?:ho|abbiamo|avevo|avevamo)\s+(?:gia\s+|già\s+)?parlato\s+con\s+((?:don|padre|mons\.?|monsignore|sig\.?|sig\.ra|signor|signora)\s+[A-Za-zÀ-ÿ' -]{2,45}|il\s+parroco|la\s+segretaria|la\s+segreteria|un\s+sacerdote|una\s+persona\s+della\s+segreteria)\b/i,
      /\b(?:mi|ci)\s+sono\s+sentit[oaie]\s+con\s+((?:don|padre|mons\.?|monsignore|sig\.?|sig\.ra|signor|signora)\s+[A-Za-zÀ-ÿ' -]{2,45}|il\s+parroco|la\s+segretaria|la\s+segreteria|un\s+sacerdote|una\s+persona\s+della\s+segreteria)\b/i,
      /\b(?:referente|riferimento|contatto)\s*[:\-]\s*((?:don|padre|mons\.?|monsignore|sig\.?|sig\.ra|signor|signora)?\s*[A-Za-zÀ-ÿ' -]{2,45})\b/i
    ];

    for (const pattern of contactPatterns) {
      const match = safeText.match(pattern);
      if (match && match[1]) {
        return match[1]
          .replace(/\s+/g, ' ')
          .replace(/[.,;:!?]+$/g, '')
          .trim()
          .slice(0, 80);
      }
    }

    return null;
  }

  /**
   * Rileva se il testo contiene segnali espliciti di consegna documentale.
   * Usato come early-exit in classifyEmail per evitare falsi negativi su email
   * con allegati (es. "in allegato troverà il certificato").
   * @param {string} text - Testo principale estratto (body senza citazioni/firme)
   * @returns {boolean}
   */
  _isDocumentSubmission(text) {
    return /\b(in\s+allegato|allego|le\s+invio|vi\s+invio|trasmetto|trova\s+allegato|troverete\s+allegato|invio\s+il\s+documento|documento\s+allegato|mando\s+il\s+documento|inoltro\s+il\s+documento)\b/i
      .test(String(text || ''));
  }

  /**
   * Rileva domande operative in cui l'azione richiesta è passare/venire in
   * segreteria; eventuali sacramenti o documenti citati sono l'oggetto della
   * visita, non la categoria primaria della risposta.
   */
  _isOfficeVisitLogisticsRequest(text) {
    const safeText = String(text || '');
    return /\b(?:posso|possiamo|potrei|potremmo|vorrei|vorremmo)\s+(?:passare|venire|presentarmi|presentarci)\b/i.test(safeText) ||
      /\b(?:passo|passiamo|vengo|veniamo)\s+(?:oggi|domani|dopodomani|lunedi|lunedì|martedi|martedì|mercoledi|mercoledì|giovedi|giovedì|venerdi|venerdì|sabato|domenica)\b/i.test(safeText) ||
      /\b(?:passare|venire|presentarmi|presentarci)\s+(?:oggi|domani|dopodomani|in\s+segreteria|presso\s+la\s+segreteria)\b/i.test(safeText);
  }

  /**
   * Ottieni statistiche classificatore
   */
  getStats() {
    return {
      categories: Object.keys(this.categories).length,
      subIntents: Object.keys(this.subIntentKeywords).length,
      greetingPatterns: this.greetingOnlyPatterns.length,
      philosophy: 'minimal_filtering_gemini_decides'
    };
  }
}

// Funzione factory
function createClassifier() {
  return new Classifier();
}
