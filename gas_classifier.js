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
      /^(buongiorno|buon\s+giorno|buonasera|buona\s+sera|buon\s+pomeriggio|salve|ciao|good\s+morning|good\s+afternoon|good\s+evening|hello|hi)\.?\s*$/i,
      /^cordiali\s+saluti\.?\s*$/i,
      /^distinti\s+saluti\.?\s*$/i,
      /^cordialmente\.?\s*$/i,
      /^in\s+fede\.?\s*$/i,
      /^(?:best|kind|warm)\s+regards\.?\s*$/i,
      /^sincerely\.?\s*$/i,
      /^(?:sent\s+from\s+my\s+(?:iphone|ipad|galaxy|smartphone|device)|get\s+outlook\s+for\s+(?:ios|android)|inviato\s+da(?:l)?\s+(?:mio\s+)?(?:iphone|samsung|smartphone|dispositivo|ipad|telefono|galaxy)|inviato\s+da\s+outlook(?:\s+per\s+(?:android|ios))?)\.?\s*$/i
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
        'in allegato', 'allego',
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
        'non mi ritengo più cristiano', 'cancellazione dal registro battesimale', 'registri del battesimo',
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
        'inaccettabile', 'vergogna', 'pessimo',
        'disappointed', 'angry', 'frustrated', 'upset', 'unacceptable'
      ],
      'gratitude': [
        'ringrazio', 'grato', 'grata', 'riconoscente',
        'gentilissimo', 'gentilissima', 'prezioso aiuto',
        'grateful', 'thankful', 'appreciate'
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
  classifyEmail(subject, body, isReply = undefined, senderEmail = null) {
    const safeSubject = typeof subject === 'string' ? subject : '';
    let safeBody = typeof body === 'string' ? body : '';

    const replySubjectPattern = /^(?:re|rif|r|ris|risp|aw|sv)(?:\s*:|\s+[-–—]\s+)/i;
    // Supporto firma alternativa: il 3° parametro può essere senderEmail anziché booleano.
    if (typeof isReply === 'string' && senderEmail === null) {
      senderEmail = isReply;
      isReply = replySubjectPattern.test(safeSubject.trim());
    } else if (typeof isReply !== 'boolean') {
      isReply = replySubjectPattern.test(safeSubject.trim());
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
      if (lastLt > lastGt && (cut.length - lastLt) <= 256 && /^<\/?[A-Za-z][^<>]*$/.test(cut.slice(lastLt))) {
        safeBody = cut.substring(0, lastLt);
      } else {
        const boundary = Math.max(lastGt >= 0 ? lastGt + 1 : -1, cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
        safeBody = boundary > 0 && cut.length - boundary <= 256 ? cut.substring(0, boundary) : cut;
      }
    }

    console.log(`   🔍 Classificando: '${safeSubject.substring(0, 50)}...'`);

    // Estrai contenuto principale
    const messageEvidence = this._extractMessageEvidence_(safeBody);
    const mainContent = messageEvidence.currentText;
    // L'oggetto ereditato descrive il thread, non un'esperienza riaffermata nel turno.
    const currentSubject = this._currentSubject_(safeSubject);
    messageEvidence.currentSubject = currentSubject;
    const contextualSubIntents = this._detectSubIntents(`${currentSubject}\n${mainContent}`);
    if (this._hasPastoralCrisisSignal_(mainContent, currentSubject)) {
      // Il segnale di crisi governa la presa in carico; la categoria conserva il contenuto della richiesta.
      const currentRequestText = `${currentSubject}\n${mainContent}`;
      const crisisCategory = this._isSbattezzoFormalRequest_(currentRequestText)
        ? 'formal'
        : (this._isDocumentSubmission(mainContent)
          ? 'document_submission'
          : (this._categorizeContent(currentRequestText) || 'pastoral'));
      return { shouldReply: true, reason: 'pastoral_crisis_detected', category: crisisCategory,
        subIntents: Object.assign(contextualSubIntents, { emotional_distress: true }), messageEvidence, confidence: 1.0 };
    }
    console.log(`      Contenuto principale: ${mainContent.length} caratteri`);

    // Lo storico non prefissato può contenere una risposta intercalata: decide il quick check.
    const subjectForChecks = safeSubject.replace(/^(?:(?:re|rif|r|ris|risp|aw|sv|fw|fwd|tr|i|wg|inc)(?:\s*:|\s+[-–—]\s+)\s*)+/i, '').trim();
    if (this._isOutOfOfficeAutoReply(safeSubject, safeBody)) {
      return { shouldReply: false, reason: 'out_of_office_auto_reply', category: null, subIntents: {}, confidence: 0.98 };
    }
    const greetingBody = this._extractMainContent(safeBody, { preserveGreetings: true });
    const greetingLines = greetingBody.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!subjectForChecks && !mainContent.trim() && !greetingLines.some(line => line !== '--')) {
      return { shouldReply: false, reason: 'empty_email', category: null, subIntents: {}, confidence: 1.0 };
    }
    const hasFreshSubjectQuestion = /[?？]/.test(safeSubject) &&
      !/^(?:re|rif|r|ris|risp|aw|sv|fw|fwd|tr|i|wg|inc)(?:\s*:|\s+[-–—]\s+)/i.test(safeSubject.trim());
    const hasCurrentRequest = this._isSbattezzoFormalRequest_(mainContent) || this._isDocumentSubmission(mainContent);
    // Un oggetto ereditato dalla conversazione non riapre un messaggio esplicito di chiusura.
    // Una risposta con corpo vuoto viene analizzata in base all’oggetto.
    if (isReply && !messageEvidence.hasExplicitInlineReply && !hasFreshSubjectQuestion && !hasCurrentRequest && (
      this._isUltraSimpleAcknowledgment(greetingBody) ||
      (Boolean(mainContent.trim()) && this._isUltraSimpleAcknowledgment(mainContent))
    )) {
      return { shouldReply: false, reason: 'ultra_simple_acknowledgment', category: null, subIntents: {}, confidence: 1.0 };
    }
    if (isReply && !messageEvidence.hasExplicitInlineReply && !hasFreshSubjectQuestion && !hasCurrentRequest && greetingLines.length &&
        greetingLines.every(line => this._isGreetingOnly(line) || this._isUltraSimpleAcknowledgment(line))) {
      const closingReason = greetingLines.every(line => this._isGreetingOnly(line))
        ? 'greeting_only' : 'ultra_simple_acknowledgment';
      return { shouldReply: false, reason: closingReason, category: null, subIntents: {}, confidence: 0.95 };
    }

    if (messageEvidence.hasAmbiguousReply) {
      const category = this._categorizeContent(mainContent) ||
        this._categorizeContent(messageEvidence.ambiguousText);
      return { shouldReply: true, reason: 'ambiguous_inline_reply', category,
        subIntents: contextualSubIntents, messageEvidence, confidence: 0.5 };
    }

    const fullText = `${safeSubject} ${mainContent}`;

    // PRIORITÀ LEGALE/PRIVACY: richieste formali (es. sbattezzo/apostasia)
    if (this._isSbattezzoFormalRequest_((isReply && !mainContent.trim()) ? mainContent : fullText)) {
      console.log('        Richiesta formale rilevata (sbattezzo/apostasia)');
      return {
        shouldReply: true,
        reason: 'formal_request_detected',
        category: 'formal',
        subIntents: contextualSubIntents, messageEvidence,
        confidence: 1.0
      };
    }

    if (this._isDocumentSubmission(mainContent)) {
      return {
        shouldReply: true,
        reason: 'document_submission_detected',
        category: 'document_submission',
        subIntents: contextualSubIntents, messageEvidence,
        confidence: 0.95
      };
    }

    // Un oggetto operativo resta una richiesta anche con corpo composto da saluti.
    const subjectHasRequest = Boolean(subjectForChecks) &&
      !/^(?:messaggio|saluti|nessun oggetto|\(no subject\))$/i.test(subjectForChecks) &&
      !this._isGreetingOnly(subjectForChecks) && !this._isUltraSimpleAcknowledgment(subjectForChecks);
    if (!mainContent.trim() && !subjectHasRequest && greetingLines.every(line => line === '--' || this._isGreetingOnly(line))) {
      const reason = greetingLines.some(line => line !== '--') || /^saluti$/i.test(subjectForChecks) ? 'greeting_only' : 'empty_email';
      return { shouldReply: false, reason, category: null, subIntents: {}, confidence: 0.95 };
    }
    // Corpo vuoto + soggetto generico (es. "Re: Orari messe") → passa a Gemini
    if ((!mainContent || !mainContent.trim()) && isReply) {
      if (subjectHasRequest && subjectForChecks.length > 3) {
        console.log('      ✓ Body vuoto ma subject ragionevole -> Passa a Gemini');
        return {
          shouldReply: true,
          reason: 'needs_ai_analysis',
          category: this._categorizeContent(subjectForChecks),
          subIntents: contextualSubIntents, messageEvidence,
          confidence: 0.8
        };
      }
      if (!hasFreshSubjectQuestion && !greetingLines.some(line => line !== '--')) {
        return { shouldReply: false, reason: 'empty_email', category: null, subIntents: {}, confidence: 0.95 };
      }
    }

    // Se il body è vuoto e NON soddisfa criterio sopra, usa subject per filtri rapidi
    const contentForQuickChecks = this._isTrivialReplyBody(mainContent) ? subjectForChecks : mainContent;

    // FILTRO 1: Acknowledgment ultra-semplice
    if (!hasFreshSubjectQuestion && this._isUltraSimpleAcknowledgment(contentForQuickChecks) && (isReply || !subjectHasRequest)) {
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
    if (!hasFreshSubjectQuestion && this._isGreetingOnly(contentForQuickChecks) && (isReply || !subjectHasRequest)) {
      console.log('      ✗ Solo saluto (standalone)');
      return {
        shouldReply: false,
        reason: 'greeting_only',
        category: null,
        subIntents: {},
        confidence: 0.95
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
      messageEvidence,
      confidence: category ? 0.85 : 0.75
    };
  }

  // ========================================================================
  // METODI HELPER
  // ========================================================================

  _currentSubject_(subject) {
    const value = String(subject || '');
    return /^(?:re|rif|r|ris|risp|aw|sv|fw|fwd|tr|i|wg|inc)(?:\s*:|\s+[-–—]\s+)/i.test(value.trim()) ? '' : value;
  }

  /** Conserva la provenienza del testo senza promuovere lo storico a messaggio corrente. */
  _extractMessageEvidence_(body) {
    const evidence = { quotedLines: [], ambiguousLines: [] };
    const currentText = this._extractMainContent(body, { evidence });
    return {
      currentText,
      quotedText: evidence.quotedLines.join('\n').trim(),
      ambiguousText: evidence.ambiguousLines.join('\n').trim(),
      hasAmbiguousReply: evidence.ambiguousLines.length > 0,
      hasExplicitInlineReply: evidence.ambiguousLines.some(line => /^(?:\s*[-*•]|\s*\[)/.test(line))
    };
  }


  /**
   * Estrae contenuto principale, rimuovendo citazioni e firme.
   * Input atteso: plain-text (body email).
   */
  _extractMainContent(body, options = {}) {
    let processedBody = typeof body === 'string' ? body : '';

    const MAX_LENGTH = 50000;
    if (processedBody.length > MAX_LENGTH) {
      processedBody = processedBody.substring(0, MAX_LENGTH);
    }

    // Unfold limitato agli header di citazione, anche quando il verbo è su una terza riga.
    processedBody = processedBody.replace(
      /^((?:On|Il giorno|Il|Le)\b[^\n]{1,200})(?:\r?\n[ \t]*(?!>)[^\n]{1,200}){0,2}\r?\n[ \t]*(?!>)(?:[^\n]{0,200}?[ \t])?(?:wrote|ha scritto|a écrit):[ \t]*\r?$/gim,
      header => header.replace(/\r?\n[ \t]*/g, ' ')
    );

    // Marcatori citazione per vari client email
    const quoteMarkers = [
      /^>\s*(?:Da|From|On|Il giorno|Le)\b.*$/im,
      /^On (?=[^\n]*(?:\d|@))[^\n]* wrote:\s*$/im,
      /^Il giorno (?=[^\n]*(?:\d|@))[^\n]* ha scritto:\s*$/im,
      /^Il .* alle .* .* ha scritto:.*$/im,
      /^Da:\s*.*<[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}>.*$/m,
      /^From:.*Sent:.*$/m,
      /^-{3,}.*Original Message.*$/m,
      /^-{3,}.*Messaggio originale.*$/m,
      /^Begin forwarded message:.*$/m,
      /^Inizio messaggio inoltrato:.*$/m,
      /^-------- Forwarded Message --------$/m,
      /^\*From:\*.*$/m,
      /^Le .* \u00E0 .* .* a \u00E9crit.*$/im,
      /^Le .* a \u00E9crit.*$/im
    ];

    const lines = processedBody.split('\n');
    const cleanLines = [];
    const evidence = options.evidence;
    const record = (kind, line) => { if (evidence) evidence[kind].push(line); };
    let inQuoteBlock = false;
    let quoteMode = null; // intestazione, citazione con prefisso o storico senza prefisso
    let historyLines = 0;
    let ambiguousTail = false;

    for (const [lineIndex, line] of lines.entries()) {
      const safeLine = line == null ? '' : String(line);
      const stripped = safeLine.trim();

      // Mantieni righe vuote per separazione paragrafi
      if (stripped === '') {
        if (inQuoteBlock && quoteMode === 'header') quoteMode = 'after_header';
        if (!inQuoteBlock) cleanLines.push(safeLine);
        continue;
      }

      // Salta blocchi citati, ma consenti inline-reply dopo quote
      let isQuote = false;
      // Il separatore grafico apre lo storico solo insieme a un'intestazione email.
      if (/^_{3,}$/.test(stripped)) {
        const nextLine = lines.slice(lineIndex + 1, lineIndex + 5).find(value => value.trim()) || '';
        if (!/^\s*(?:Da|From|De|Von|Inviato|Sent|Enviado|Envoyé|Gesendet):/iu.test(nextLine)) continue;
        isQuote = true;
      }
      for (const marker of quoteMarkers) {
        if (marker.test(stripped)) {
          isQuote = true;
          break;
        }
      }
      const isPrefixedQuote = stripped.startsWith('>') || stripped.startsWith('|');
      if (isQuote && !isPrefixedQuote) {
        inQuoteBlock = true;
        quoteMode = 'header';
        historyLines = 0;
        ambiguousTail = false;
        record('quotedLines', safeLine);
        continue;
      }
      if (isPrefixedQuote) {
        inQuoteBlock = true;
        if (quoteMode !== 'history') quoteMode = 'prefixed';
        record('quotedLines', safeLine);
        continue;
      }
      // I campi aggiuntivi e i valori delle intestazioni su più righe sono esclusi dal corpo storico.
      if (inQuoteBlock && quoteMode === 'header' &&
          (/^(?:Da|From|De|Von|A|To|Para|An|Cc|Bcc|Ccn|Oggetto|Subject|Assunto|Asunto|Objet|Betreff|Data|Date|Fecha|Datum|Inviato|Sent|Enviado|Envoy[eé]|Gesendet):/iu.test(stripped.normalize('NFC')) ||
           /^[ \t]+\S/.test(safeLine))) continue;
      // Le citazioni con prefisso consentono risposte intercalate; una nuova intestazione reimposta la modalità.
      if (inQuoteBlock && (quoteMode === 'header' || quoteMode === 'after_header')) quoteMode = 'history';
      if (inQuoteBlock && quoteMode === 'history') {
        // La separazione grafica suggerisce un intervento, ma non ne prova l'autore.
        const separated = lineIndex > 0 && !lines[lineIndex - 1].trim();
        const requestCue = /[?？]|\b(?:vorrei|posso|chiedo|allego|confermo|please|could|would|quisiera|je\s+voudrais|ich\s+mochte)\b/i.test(stripped);
        if (historyLines > 0 && requestCue && (separated || /^(?:[-*•]|\[)/.test(stripped))) ambiguousTail = true;
        record(ambiguousTail ? 'ambiguousLines' : 'quotedLines', safeLine);
        historyLines++;
        continue;
      }
      if (inQuoteBlock &&
          /^(?:[¿¡]\s*)?[\p{L}\p{N}]/u.test(stripped) &&
          !stripped.startsWith('>') &&
          !stripped.startsWith('|')) {
        inQuoteBlock = false;
        quoteMode = null;
      }

      // Una voce di elenco con richiesta operativa riapre la risposta intercalata; la sola punteggiatura è insufficiente.
      if (inQuoteBlock && /^(?:[-*•]|\[)[\s\S]*\b(?:vorrei|posso|chiedo|allego|confermo|please|could|would)\b/i.test(stripped)) {
        inQuoteBlock = false;
        quoteMode = null;
      }
      if (inQuoteBlock) continue;
      // Aggiorna prima lo stato delle citazioni: un saluto può aprire una risposta inline.
      if (!options.preserveGreetings && /^(salve|buongiorno|buon\s+giorno|buonasera|buona\s+sera|buon\s+pomeriggio|ciao|good\s+morning|good\s+afternoon|good\s+evening|hello|hi)[\s,!.]{0,5}$/i.test(stripped)) continue;
      cleanLines.push(safeLine);
    }

    let content = cleanLines.join('\n').trim();

    // Rimuovi firme solo quando appaiono come riga dedicata.
    // Classifica correttamente l'identificazione precisa delle firme contestuali in frasi come:
    // "Cordiali saluti da tutta la famiglia, vorrei sapere se..."
    // L'approccio line-based garantisce precisione nell'identificazione delle firme
    // ed evita falsi positivi all'interno di frasi di testo libero.
    const signatureLineMarkers = [
      /^--\s*$/,
      /^cordiali\s+saluti[\s,!.-]*$/i,
      /^cordialmente[\s,!.-]*$/i,
      /^distinti\s+saluti[\s,!.-]*$/i,
      /^in\s+fede[\s,!.-]*$/i,
      /^(?:best|kind|warm)\s+regards[\s,!.-]*$/i,
      /^sincerely[\s,!.-]*$/i,
      /^sent\s+from\s+my\s+iphone[\s,!.-]*$/i,
      /^(?:sent\s+from\s+my\s+(?:iphone|ipad|galaxy|smartphone|device)|get\s+outlook\s+for\s+(?:ios|android)|inviato\s+da(?:l)?\s+(?:mio\s+)?(?:iphone|samsung|smartphone|dispositivo|ipad|telefono|galaxy)|inviato\s+da\s+outlook(?:\s+per\s+(?:android|ios))?)[\s,!.-]*$/i
    ];
    const contentLines = content.split('\n');
    let signatureStartIndex = -1;
    for (let i = contentLines.length - 1; i >= 0; i--) {
      if (!signatureLineMarkers.some(marker => marker.test(contentLines[i].trim()))) continue;
      const remainingLines = contentLines
        .slice(i + 1)
        .map(line => (line || '').trim())
        .filter(line => line && !signatureLineMarkers.some(marker => marker.test(line)));
      const remainingText = remainingLines.join(' ').trim();
      const containsUserContentAfterSignature = /[?!]|\b(?:ah\s+dimenticavo|dimenticavo|vorrei|vorremmo|posso|possiamo|potrei|potremmo|chiedo|chiediamo|sapere|informazioni|prenotare|allego|inoltre|vengo|veniamo|passo|passiamo|arrivo|arriviamo|porto|portiamo|ritirare|consegnare|domani|oggi|dopodomani|stamattina|stasera|pomeriggio)\b/i.test(remainingText);
      const tailLooksLikeSignature = remainingLines.length === 0 || (
        remainingLines.length <= 3 &&
        !containsUserContentAfterSignature &&
        remainingLines.every((line) => {
          if (line.length > 80) return false;
          return /^[A-Za-zÀ-ÖØ-öø-ÿ .'-]+$/.test(line) ||
            /(?:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\+?\d[\d .()-]{5,}|https?:\/\/|www\.)/i.test(line);
        })
      );

      if (tailLooksLikeSignature) signatureStartIndex = i;
    }
    if (signatureStartIndex !== -1) {
      if (options.preserveGreetings) {
        const preservedClosings = contentLines
          .slice(signatureStartIndex)
          .map(line => (line || '').trim())
          .filter(line => line && !/^--\s*$/.test(line) && signatureLineMarkers.some(marker => marker.test(line)));
        content = contentLines.slice(0, signatureStartIndex).concat(preservedClosings).join('\n').trim();
      } else {
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
    if (this._hasPastoralCrisisSignal_(text)) return false;

    // Controllo presenza domanda prima della normalizzazione
    if (/[?？]/.test(text)) return false;

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
    const hasOperationalInfo = /(?:^|\s)(?:oggi|domani|dopodomani|stamattina|stasera|mattina|pomeriggio|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|alle|ore|appuntamento|vengo|veniamo|venite|vado|arrivo|passo|porto|document[oi]|pagato|bonifico)(?=$|\s)|\d/.test(normalized);
    if (hasOperationalInfo || /\b(non|no|not|never|mai|niente|nulla|nessun[oa]?|neanche|nemmeno)\b/.test(normalized)) return false;

    // STRICT: max 3 parole
    if (wordCount > 3) return false;

    // Deve contenere parola di ringraziamento/ricevuto
    const thankWords = ['grazie', 'ringrazio', 'ricevuto', 'ok', 'perfetto', 'thanks', 'thank', 'received', 'noted', 'gracias', 'agradezco', 'recibido', 'merci', 'remercie', 'danke', 'erhalten', 'obrigado', 'obrigada', 'recebido'];
    const normalizedWords = normalized.split(' ').filter(w => w.length > 0);
    const hasThanks = normalizedWords.some(word => thankWords.includes(word));

    return hasThanks;
  }

  /**
   * Rileva pattern espliciti di auto-risposta (OOO/ferie)
   */
  _isOutOfOfficeAutoReply(subject, body) {
    const rawSubject = String(subject || '');
    const extractedBody = this._extractMainContent(String(body || ''), { preserveGreetings: true });
    const normalized = `${rawSubject} ${extractedBody}`.toLowerCase();
    // Una descrizione personale dell'assenza non prova un autoresponder.
    const isReplySubject = /^(?:re|rif|r|ris|risp|aw|sv|fw|fwd|tr|i|wg|inc)(?:\s*:|\s+[-–—]\s+)/i.test(rawSubject.trim());
    const declaresAutoReply = text => /^\s*(?:(?:gentile\s+mittente|dear\s+sender)[,:]?\s*)?(?:auto(?:matic)?\s*reply|risposta\s+automatica|out\s+of\s+(?:the\s+)?office)\b/i.test(text);
    const subjectWithoutReplyMarkers = rawSubject.trim().replace(/^(?:\s*(?:re|rif|r|ris|risp|aw|sv|fw|fwd|tr|i|wg|inc)(?:\s*:|\s+[-–—]\s+))+\s*/i, '');
    if (!isReplySubject && declaresAutoReply(subjectWithoutReplyMarkers)) return true;
    const textForRequestCheck = isReplySubject ? extractedBody.toLowerCase() : normalized;
    if (/[?？]|\b(?:possiamo|vorrei|potete|chiedo|fissare|appuntamento)\b/i.test(textForRequestCheck)) return false;
    if (declaresAutoReply(subjectWithoutReplyMarkers)) return true;
    // Una citazione dell'autoresponder non equivale a dichiararsi tale.
    return declaresAutoReply(extractedBody) ||
      /^\s*(?:mailbox (?:is )?monitored periodically|casella (?:di posta )?consultata periodicamente)\b/i.test(extractedBody);
  }

  /**
   * Verifica se solo saluto
   */
  _hasPastoralCrisisSignal_(text, subject = '') {
    if (typeof PromptContext === 'function') {
      return PromptContext.prototype._detectPastoralCrisisSignal_.call(PromptContext.prototype, subject || '', text || '').strong;
    }
    // Compatibilità con utilizzatori che caricano solo il classificatore.
    return /\b(?:voglio\s+morire|vorrei\s+morire|suicid\w*|farmi\s+del\s+male|farla\s+finita|togliermi\s+la\s+vita|sono\s+disperat[oa]|sto\s+crollando)\b/i.test(`${subject || ''} ${text || ''}`);
  }

  _isGreetingOnly(text) {
    if (typeof text !== 'string' || !text.trim()) return false;
    // Controllo presenza domanda prima della normalizzazione
    if (/[?？]/.test(text)) return false;

    let normalized = text.toLowerCase().trim();
    try {
      normalized = normalized.normalize('NFC');
    } catch (e) {
      // In assenza di normalize, usa la normalizzazione disponibile nel runtime.
    }
    try {
      normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, '');
    } catch (e) {
      normalized = normalized.replace(/[^\w\sÀ-ÖØ-öø-ÿ]/g, '');
    }

    normalized = normalized.replace(/\s+/g, ' ').trim();
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
    if (/[?¿？]/.test(text)) return false;
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
    const priority = ['sbattezzo', 'document_submission', 'sacrament', 'complaint', 'quotation', 'collaboration', 'appointment', 'information'];
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
    if (category === 'sbattezzo' && ['uscire dalla chiesa', 'registri del battesimo'].includes(normalizedKeyword)) {
      return this._isSbattezzoFormalRequest_(textLower);
    }

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

    const bereavement = this._detectBereavementEvidence_(text);
    if (bereavement) detected.bereavement = true;

    const priorOralCommunication = this._detectPriorOralCommunication(text);
    if (priorOralCommunication.detected) {
      detected.prior_oral_communication = priorOralCommunication;
    }

    return detected;
  }

  /** Un lutto personale richiede un'esperienza affermata, non il solo nome del tema. */
  _detectBereavementEvidence_(text) {
    const rawText = String(text || '').normalize('NFC').toLowerCase();
    const rawClauses = rawText.split(/[.!?;\n]+|(?<![\p{L}\p{N}_])(?:ma|però|pero|but)(?![\p{L}\p{N}_])/iu);
    const normalizedText = rawText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const clauses = normalizedText.split(/[.!?;\n]+|(?<![\p{L}\p{N}_])(?:ma|pero|but)(?![\p{L}\p{N}_])/iu);
    return clauses.find((clause, index) => {
      if (this._isNonAssertedSensitiveEvidence_(clause, 'bereavement')) return false;
      const hasAccentedFather = /\bpapà\b/i.test(rawClauses[index] || '');
      const personal = /\b(?:mi[oaie]|nostr[oaie])\s+(?:car[oa]\s+)?(?:marito|moglie|padr[ei]|madr[ei]|mamma|papa|nonn[oa]|figli[oa]|fratello|sorella|zi[oa]|cugin[oa]|amic[oa]|compagn[oa]|fidanzat[oa]|suocer[oa]|cognat[oa]|nipot[ei]|coniuge|familiare|parente)\b|\b(?:my|our)\s+(?:husband|wife|father|mother|mum|dad|son|daughter|brother|sister|grandmother|grandfather|friend|partner|relative)\b/.test(clause);
      const implicitCloseRelative = /\b(?:la\s+(?:mamma|madre|nonna|suocera|cognata|nipote)|il\s+(?:papa|padre|nonno|suocero|cognato|nipote|coniuge)|mamma|papa)\b/.test(clause);
      const namedPope = /\bpapa\s+(?:francesco|leone|benedetto|giovanni|paolo|pietro)\b/.test(clause);
      const papalTitle = !hasAccentedFather && /\b(?:il\s+)?papa\b[^.!?;\n]{0,50}\b(?:e|era|ha|aveva|fu|sara|sarà|morto|deceduto|scomparso)\b/.test(clause);
      const familyBereavement = /\b(?:lutto\s+in\s+famiglia|un\s+lutto\s+familiare|stiamo\s+vivendo\s+un\s+lutto\s+in\s+famiglia)\b/.test(clause);
      const event = /\b(?:mort[oaie]|decedut[oaie]|defunt[oaie]|decesso|venut[oaie]\s+a\s+mancare|(?:e|era|sono)\s+(?:(?:purtroppo|recentemente|improvvisamente|da\s+poco)\s+)?mancat[oaie]|scompars[oaie]|funerale|esequie|died|deceased|passed\s+away|funeral)\b/.test(clause);
      const lostRelative = /\b(?:(?:ho|abbiamo)\s+(?:da\s+poco\s+|recentemente\s+)?perso|i\s+(?:have\s+)?lost)\s+(?:(?:il|la|i|le)\s+)?(?:mi[oaie]|nostr[oaie]|my|our)\s+(?:car[oa]\s+)?(?:marito|moglie|padr[ei]|madr[ei]|mamma|papa|nonn[oa]|figli[oa]|fratello|sorella|zi[oa]|cugin[oa]|amic[oa]|compagn[oa]|fidanzat[oa]|suocer[oa]|cognat[oa]|nipot[ei]|coniuge|familiare|parente|husband|wife|father|mother|mum|dad|son|daughter|brother|sister|grandmother|grandfather|friend|partner|relative)\b/.test(clause);
      const explicitCurrentGrief = /\b(?:lutto|suffragio|anniversario|ricorrenza|mi\s+manca|ci\s+manca|sto\s+soffrendo|stiamo\s+soffrendo|ricordo\s+con\s+affetto)\b/.test(clause);
      const datedPast = clause.match(/\b(?:nel|in)\s+((?:18|19|20)\d{2})\b/);
      const oldDeath = Boolean(
        (datedPast && new Date().getFullYear() - Number(datedPast[1]) >= 2) ||
        /\b(?:\d+|molti|parecchi|diversi)\s+anni\s+fa\b|\bda\s+(?:molti|parecchi|diversi)\s+anni\b/.test(clause)
      );
      if (oldDeath && !explicitCurrentGrief) return false;
      return (personal && event) || lostRelative ||
        (!namedPope && !papalTitle && implicitCloseRelative && event) || familyBereavement ||
        /\b(?:(?:sono|siamo|sto|stiamo)\s+(?:vivendo\s+un\s+|affrontando\s+un\s+|in\s+)lutto|i\s+am\s+(?:bereaved|in\s+mourning))\b/.test(clause);
    })?.trim() || '';
  }

  _isNonAssertedSensitiveEvidence_(text, kind) {
    const source = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const negations = {
      bereavement: /\b(?:non\s+(?:sono|siamo|e|era|si\s+e)\s+(?:mai\s+|piu\s+)?(?:in\s+lutto|mort[oa]|defunt[oa]|decedut[oa]|scompars[oa])|non\s+(?:ho|abbiamo)\s+(?:mai\s+)?perso|not\s+(?:bereaved|dead|deceased|in\s+mourning))\b/,
      prior_contact: /\b(?:non\s+(?:ho|abbiamo|avevo|avevamo)\s+(?:mai\s+|ancora\s+)?(?:parlato|avuto)|vorrei\s+(?:un\s+)?(?:riscontro|contatto|colloquio))\b/,
      distress: /\bnon\s+(?:sono|siamo|mi\s+sento)\s+(?:piu\s+)?(?:in\s+crisi|disperat[oa]|delus[oa]|a\s+pezzi)\b/,
      crisis: /\bnon\s+(?:sono|siamo|mi\s+sento)\s+(?:piu\s+)?(?:in\s+crisi|disperat[oa]|a\s+pezzi)\b/,
      critical: /\b(?:(?:do\s+not|don't)\s+want\s+to\s+(?:die|kill\s+myself)|non\s+(?:voglio|intendo)\s+(?:morire|suicidarmi|farmi\s+del\s+male))\b/
    };
    return Boolean(negations[kind]?.test(source)) ||
      /\b(?:significato\s+(?:della\s+parola|del\s+termine)|cosa\s+significa|che\s+cosa\s+significa|traduci|tradurre|translate|meaning\s+of|ipotizziamo|supponiamo)\b/.test(source) ||
      /\b(?:se|if)\b.{0,70}\b(?:foss[ei]|fossero|dovesse|were|would)\b/.test(source);
  }

  /** Le evidenze del quick check integrano lo stesso turno, con estratti verificabili. */
  _reconcileCurrentSignals_(classification, subject, body, signals) {
    const messageEvidence = this._extractMessageEvidence_(body);
    const currentSubject = this._currentSubject_(subject);
    messageEvidence.currentSubject = currentSubject;
    const current = `${currentSubject}\n${messageEvidence.currentText}`;
    const subIntents = Object.assign({}, classification.subIntents || {});
    const acceptedSignals = [];
    const normalize = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim();
    for (const signal of (Array.isArray(signals) ? signals.slice(0, 6) : [])) {
      if (!signal || !['bereavement', 'distress', 'crisis', 'critical', 'prior_contact'].includes(signal.kind)) continue;
      const quote = normalize(signal.text);
      if (quote.length < 8 || quote.length > 300) continue;
      const source = normalize(current).includes(quote) ? 'current' :
        (normalize(messageEvidence.ambiguousText).includes(quote) ? 'resolved_inline' : null);
      if (!source) continue;
      const origin = source === 'current' ? current : messageEvidence.ambiguousText;
      const clause = origin.split(/[.!?;\n]+|(?<![\p{L}\p{N}_])(?:ma|per[oò]|but)(?![\p{L}\p{N}_])/iu)
        .find(value => normalize(value).includes(quote.replace(/[.!?;]+$/, '')));
      if (this._isNonAssertedSensitiveEvidence_(clause || quote, signal.kind)) continue;
      acceptedSignals.push({ kind: signal.kind, text: quote, source });
      if (signal.kind === 'bereavement') subIntents.bereavement = true;
      if (['distress', 'crisis', 'critical'].includes(signal.kind)) subIntents.emotional_distress = true;
      if (signal.kind === 'prior_contact') {
        const contact = this._detectPriorOralCommunication(quote);
        subIntents.prior_oral_communication = Object.assign(contact, { detected: true, strength: 'strong', signals: [quote] });
      }
    }
    return Object.assign({}, classification, { subIntents, messageEvidence, currentSignals: acceptedSignals });
  }

  _isSbattezzoFormalRequest_(text) {
    const source = String(text || '').toLowerCase();
    const explicitRequest = /\bsbattezzo\b|\bsbattezzamento\b|\bapostasia\b|\bapostatare\b|\babbandonare\s+la\s+(?:fede|religione)\b|\brinnegare\s+la\s+fede\b|cancellazione\s+(?:dal|dai|dei)\s+registr(?:o\s+battesimale|i\s+(?:del\s+)?battesimo)\b|cancellarmi\s+dalla\s+chiesa|disiscrivermi\s+dalla\s+chiesa|rinunciare\s+al\s+battesim[oa]|(?:togliermi|rimuovermi|essere\s+rimoss[oa])\s+dai\s+registr|non\s+(?:voglio|desidero)\s+(?:piu|più)\s+essere\s+(?:cattolic[oa]|cristian[oa])|non\s+(?:mi\s+)?(?:ritengo|sento)\s+(?:piu|più)\s+(?:cattolic[oa]|cristian[oa])|non\s+essere\s+(?:piu|più)\s+registrat[oa]\s+come\s+cattolic[oa]/i.test(source);
    if (explicitRequest) return true;
    const ecclesialRegistryCancellation = source.split(/[.!?;\n]+/).some(clause =>
      /\bcancellazione\s+(?:dal|dai|dei)\s+registr/i.test(clause) &&
      /\b(?:battesim\w*|parrocch\w*|cattolic\w*|cristian\w*|chiesa|diocesi|apostasi\w*|religion\w*)\b/i.test(clause)
    );
    if (ecclesialRegistryCancellation) return true;
    // Valuta ogni dichiarazione di uscita nel suo contesto, indipendentemente da eventi estranei.
    return source.split(/[.!?;\n]+/).some(clause => {
      if (!/\buscire\s+dalla\s+chiesa\b/i.test(clause)) return false;
      const institutionalDecision = /\b(?:ho\s+deciso\s+di|intendo|voglio|vorrei|desidero|chiedo\s+(?:come|informazioni\s+per)|procedura\s+per)\s+uscire\s+dalla\s+chiesa\s+cattolica\b/i.test(clause);
      if (institutionalDecision && !/\b(?:porta|uscita|navata|edificio|rampa|scale|carrozzina|accessibil\w*|disabil\w*)\b/i.test(clause)) return true;
      const physicalExit = /\b(?:porta|uscita|navata|edificio|rampa|scale|carrozzina|accessibil\w*|disabil\w*)\b/i.test(clause) ||
        /\b(?:dopo|durante|prima|al termine di|alla fine di)\s+(?:la|della|una|un|il|del)?\s*(?:messa|cerimonia|funerale|matrimonio)\b/i.test(clause);
      return !physicalExit;
    });
  }

  /**
   * Rileva contatti telefonici o personali gia avvenuti, senza assumere che
   * ogni dettaglio sia gia stato approvato.
   */
  _detectPriorOralCommunication(text) {
    const source = String(text || '');
    const normalized = source.replace(/\s+/g, ' ').trim();
    const linePreserved = source.replace(/[^\S\r\n]+/g, ' ').trim();
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
      /(?<!\b(?:non|mai|neanche|nemmeno)\s+)\b(?:(?:ci\s+siamo\s+sentit[ie]|vi\s+siete\s+sentit[ie])\b(?!\s+(?:male|bene|sol[ie]|trist[ie]|felici|stanchi|stanche|abbandonat[ie]|ascoltat[ie]|accolt[ie]|a\s+disagio)\b)|mi\s+sono\s+sentit[oa]\s+(?:con\b|al\s+telefono\b|telefonicamente\b|per\s+telefono\b))/i,
      /(?<!\b(?:non|mai|neanche|nemmeno)\s+)\b(?:ho|abbiamo|avevo|avevamo)\s+(?:gia\s+|già\s+)?parlato\s+con\b/i,
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
      mentioned_contact: signals.length > 0 ? this._extractPriorCommunicationContact_(linePreserved) : null,
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
    const safeText = String(text || '').normalize('NFC');
    const contactPatterns = [
      /(?<!\b(?:non|mai|neanche|nemmeno)\s+)\b(?:ho|abbiamo|avevo|avevamo)\s+(?:gia\s+|già\s+)?parlato\s+con\s+(?:(?:il|lo|la|l['’])\s*)?((?:don|padre|monsignore|mons\.?|sig\.ra|signora|signor|sig\.?)[ \t]+[\p{L}'’ -]{2,45}|il\s+parroco|la\s+segretaria|la\s+segreteria|un\s+sacerdote|una\s+persona\s+della\s+segreteria)(?=$|[^\p{L}\p{N}_])/iu,
      /(?<!\b(?:non|mai|neanche|nemmeno)\s+)\b(?:mi\s+sono\s+sentit[oa]|ci\s+siamo\s+sentit[ie]|vi\s+siete\s+sentit[ie])\s+con\s+(?:(?:il|lo|la|l['’])\s*)?((?:don|padre|monsignore|mons\.?|sig\.ra|signora|signor|sig\.?)[ \t]+[\p{L}'’ -]{2,45}|il\s+parroco|la\s+segretaria|la\s+segreteria|un\s+sacerdote|una\s+persona\s+della\s+segreteria)(?=$|[^\p{L}\p{N}_])/iu,
      /\b(?:referente|riferimento|contatto)[ \t]*[:\-][ \t]*(?:(?:il|lo|la|l['’])[ \t]*)?(il[ \t]+parroco|la[ \t]+segretaria|la[ \t]+segreteria|un[ \t]+sacerdote|una[ \t]+persona[ \t]+della[ \t]+segreteria|(?:don|padre|monsignore|mons\.?|sig\.ra|signora|signor|sig\.?)[ \t]+[\p{L}'’ -]{2,45})(?=$|[^\p{L}\p{N}_])/iu
    ];
    for (const pattern of contactPatterns) {
      const match = safeText.match(pattern);
      if (match && match[1]) {
        return match[1]
          .split(/\s+[-–—]\s+/)[0]
          .split(/\s+(?:le|gli)\s+(?:ha|aveva|ho|hanno|avevano|sono|siamo)\b/iu)[0]
          // Termina prima dei complementi narrativi e conserva i cognomi composti, come De Luca.
          .split(/\s+(?:ieri|oggi|domani|stamattina|stasera|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica|questa|questo|scorsa|scorso|per|con|che|e|ed|ma|per[oò]|perch[eé]|quando|circa|riguardo|relativamente|invece|mi|ci|vi|ha|aveva|sono|siamo|alle|alla|al|sul|sulla|durante|dopo|prima|in|telefonicamente|abbiamo|avevamo|vorrei|vorremmo|chiedo|chiediamo|scrivo|invio|allego|confermo|grazie|saluti|buongiorno|buonasera)(?=$|[^\p{L}\p{N}_])/iu)[0]
          .replace(/\s+/g, ' ')
          .replace(/[.,;:!?]+$/g, '')
          .trim()
          .slice(0, 80);
      }
    }

    // Riconosce nomi espliciti senza titolo ed esclude istruzioni generiche di contatto.
    const namedContact = safeText.match(/\b(?:[Rr]eferente|[Rr]iferimento|[Cc]ontatto)[ \t]*[:\-][ \t]*(\p{Lu}[\p{L}'’]+(?:[ \t]+\p{Lu}[\p{L}'’]+){1,3})(?=$|[^\p{L}\p{N}_])/u);
    return namedContact ? namedContact[1] : null;
  }

  /**
   * Rileva se il testo contiene segnali espliciti di consegna documentale.
   * Usato come early-exit in classifyEmail per evitare falsi negativi su email
   * con allegati (es. "in allegato troverà il certificato").
   * @param {string} text - Testo principale estratto (body senza citazioni/firme)
   * @returns {boolean}
   */
  _isDocumentSubmission(text) {
    const source = String(text || '');
    const explicitDocumentDelivery = /\b(in\s+allegato|allego|trasmetto|trova\s+allegato|troverete\s+allegato|invio\s+il\s+documento|documento\s+allegato|mando\s+il\s+documento|inoltro\s+il\s+documento)\b/i.test(source);
    const pronounDeliveryWithDocument = /\b(?:le|vi)\s+invio\b[^.!?\n]{0,80}\b(?:document\w*|sched\w*|modul\w*|certificat\w*|allegat\w*|file|attest\w*)\b/i.test(source);
    return explicitDocumentDelivery || pronounDeliveryWithDocument;
  }

  /**
   * Rileva domande operative in cui l'azione richiesta è passare/venire in
   * segreteria; eventuali sacramenti o documenti citati sono l'oggetto della
   * visita, non la categoria primaria della risposta.
   */
  _isOfficeVisitLogisticsRequest(text) {
    // Mantiene le proposte affermative successive ("non posso oggi, ma posso
    // domani"), rimuovendo il predicato negato con gli avverbi intermedi.
    const visitVerbPattern = '(?:passare|venire|presentarmi|presentarci|passo|passiamo|vengo|veniamo)';
    const coordinatedVisits = `${visitVerbPattern}(?:\\s+(?:o|oppure|n[eé])\\s+(?:a\\s+)?${visitVerbPattern})*\\b`;
    const safeText = String(text || '')
      .replace(new RegExp(`\\b(?:non|mai|neanche|nemmeno)\\s+(?:(?:posso|possiamo|potrei|potremmo|vorrei|vorremmo|riesco|riusciamo)\\s+)?(?:(?:proprio|pi[uù]|purtroppo|assolutamente|davvero|neanche|nemmeno|mai|a)\\s+)*${coordinatedVisits}`, 'gi'), ' ')
      .replace(new RegExp(`\\b(?:senza\\s+(?:dover\\s+|poter\\s+)?|impossibilitat[oaie]\\s+a\\s+|impossibile\\s+|evitare\\s+di\\s+)${coordinatedVisits}`, 'gi'), ' ');
    return /\b(?:posso|possiamo|potrei|potremmo|vorrei|vorremmo)\s+(?:passare|venire|presentarmi|presentarci)\b/i.test(safeText) ||
      /\b(?:passo|passiamo|vengo|veniamo)\s+(?:oggi|domani|dopodomani|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)(?![\p{L}\p{N}_])/iu.test(safeText) ||
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
