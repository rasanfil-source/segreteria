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
class Classifier {
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
        'informazioni', 'chiedere', 'sapere', 'vorrei sapere',
        'come faccio', 'dove', 'cosa serve', 'requisiti',
        'information', 'ask', 'know', 'how to', 'where', 'requirements'
      ],
      'sacrament': [
        'battesimo', 'comunione', 'cresima', 'matrimonio',
        'sacramento', 'confessione', 'prima comunione',
        'baptism', 'communion', 'confirmation', 'marriage', 'sacrament'
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
        'orçamento', 'cotação', 'proposta', 'preço',
        'quote', 'quotation', 'pricing', 'offer', 'estimate', 'price list'
      ],
      'sbattezzo': [
        'sbattezzo', 'sbattezzamento', 'apostasia', 'apostatare',
        'abbandonare la religione', 'abbandonare la fede', 'rinnegare la fede',
        'non mi ritengo più cristiano', 'cancellazione dal registro', 'registri del battesimo'
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
  classifyEmail(subject, body, isReply = false) {
    const safeSubject = typeof subject === 'string' ? subject : '';
    const safeBody = typeof body === 'string' ? body : '';
    console.log(`   🔍 Classificando: '${safeSubject.substring(0, 50)}...'`);

    // Estrai contenuto principale
    const mainContent = this._extractMainContent(safeBody);
    console.log(`      Contenuto principale: ${mainContent.length} caratteri`);

    // Body vuoto + subject generico (es. "Re: Orari messe") → passa a Gemini
    if ((!mainContent || !mainContent.trim()) && isReply) {
      const subjectClean = safeSubject.replace(/^re:\s*/i, '').trim();
      if (subjectClean.length > 3 && subjectClean.length < 50) {
        console.log('      ✓ Body vuoto ma subject ragionevole -> Passa a Gemini');
        return {
          shouldReply: true,
          reason: 'empty_body_generic_subject',
          category: null,
          subIntents: {},
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

    // TUTTO IL RESTO: Passa a Gemini
    const fullText = `${safeSubject} ${mainContent}`;
    const category = this._categorizeContent(fullText);
    const subIntents = this._detectSubIntents(fullText);

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
   * Estrae contenuto principale, rimuovendo citazioni e firme
   * Gestisce blockquote HTML e vari formati client email
   */
  _extractMainContent(body) {
    let processedBody = typeof body === 'string' ? body : '';

    const MAX_LENGTH = 50000;
    if (processedBody.length > MAX_LENGTH) {
      processedBody = processedBody.substring(0, MAX_LENGTH);
    }

    // Rimuove blockquote con limite iterazioni per evitare loop su HTML malformato
    let iterations = 0;
    const MAX_ITERATIONS = 10;
    while (/<blockquote/i.test(processedBody) && iterations < MAX_ITERATIONS) {
      processedBody = processedBody.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');
      iterations++;
    }
    if (iterations >= MAX_ITERATIONS) {
      console.warn('⚠️ Raggiunto limite rimozione blockquote');
      // Rimuove eventuali blockquote non chiusi rimasti dopo il limite
      processedBody = processedBody.replace(/<blockquote[^>]*>[\s\S]*$/gi, '');
    }
    processedBody = processedBody.replace(/<blockquote[^>]*>/gi, '');
    processedBody = processedBody.replace(/<\/blockquote>/gi, '');

    // Rimuove div.gmail_quote
    processedBody = processedBody.replace(/<div\s+class=["']gmail_quote["'][^>]*>[\s\S]*?<\/div>/gi, '');

    // Rimuove quote stile Outlook
    processedBody = processedBody.replace(/<div\s+id=["']?divRplyFwdMsg["']?[^>]*>[\s\S]*?$/gi, '');

    // Marcatori citazione per vari client email
    const quoteMarkers = [
      /^>.*$/m,
      /^On .* wrote:.*$/m,
      /^Il giorno .* ha scritto:.*$/m,
      /^Il .* alle .* .* ha scritto:.*$/m,
      /^Da:.*$/m,
      /^From:.*Sent:.*$/m,
      /^-{3,}.*Original Message.*$/m,
      /^-{3,}.*Messaggio originale.*$/m,
      /^_{3,}$/m,
      /^Begin forwarded message:.*$/m,
      /^Inizio messaggio inoltrato:.*$/m,
      /^-------- Forwarded Message --------$/m,
      /^\*From:\*.*$/m,
      /^Le .* à .* .* a écrit.*$/m
    ];

    const lines = processedBody.split('\n');
    const cleanLines = [];

    for (const line of lines) {
      const safeLine = line == null ? '' : String(line);
      const stripped = safeLine.trim();

      // Mantieni righe vuote per separazione paragrafi
      if (stripped === '') {
        cleanLines.push(safeLine);
        continue;
      }

      // Salta saluti standalone all'inizio
      if (/^(salve|buongiorno|buonasera|ciao)[\s,!.]*$/i.test(stripped)) {
        continue;
      }

      // Ferma ai marcatori di citazione
      let isQuote = false;
      for (const marker of quoteMarkers) {
        if (marker.test(stripped)) {
          isQuote = true;
          break;
        }
      }
      if (isQuote) break;

      cleanLines.push(safeLine);
    }

    let content = cleanLines.join('\n').trim();

    // Rimuovi firme
    const signatureMarkers = [
      /cordiali saluti/i,
      /distinti saluti/i,
      /in fede/i,
      /best regards/i,
      /sincerely/i,
      /sent from my iphone/i,
      /inviato da/i
    ];

    for (const marker of signatureMarkers) {
      const match = content.search(marker);
      if (match !== -1) {
        content = content.substring(0, match).trim();
        break;
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
    normalized = normalized.replace(/[^\w\sàèéìòù!]/g, '');
    normalized = normalized.replace(/\s+/g, ' ');

    // Conta parole
    const wordCount = normalized.split(' ').filter(w => w.length > 0).length;

    // STRICT: max 3 parole
    if (wordCount > 3) return false;

    // Deve contenere parola di ringraziamento/ricevuto
    const thankWords = ['grazie', 'ringrazio', 'ricevuto', 'ok', 'perfetto'];
    const hasThanks = thankWords.some(word => normalized.includes(word));

    return hasThanks && wordCount <= 3;
  }

  /**
   * Verifica se solo saluto
   */
  _isGreetingOnly(text) {
    // Controllo presenza domanda prima della normalizzazione
    if (text.includes('?')) return false;

    let normalized = text.toLowerCase().trim();
    normalized = normalized.replace(/[^\w\sàèéìòù]/g, '');

    if (this.greetingOnlyPatterns.some(pattern => pattern.test(normalized))) {
      return true;
    }

    // Permette saluti con titolo/nome breve (es. "Buongiorno don")
    const words = normalized.split(/\s+/).filter(Boolean);
    const greetingWord = words[0];
    const greetingSet = new Set(['buongiorno', 'buonasera', 'salve', 'ciao']);

    return greetingSet.has(greetingWord) && words.length <= 3;
  }

  /**
   * Rileva body banale (vuoto o solo "Re:")
   */
  _isTrivialReplyBody(text) {
    if (!text) return true;
    const normalized = text.toLowerCase().trim();
    const cleaned = normalized.replace(/[^\w\sàèéìòù:]/g, '');
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
    const textLower = text.toLowerCase();
    const categoryScores = {};

    for (const category in this.categories) {
      const keywords = this.categories[category];
      const score = keywords.filter(kw => textLower.includes(kw)).length;
      if (score > 0) {
        categoryScores[category] = score;
      }
    }

    if (Object.keys(categoryScores).length === 0) return null;

    // Ritorna categoria con punteggio più alto
    let maxCategory = null;
    let maxScore = 0;
    for (const cat in categoryScores) {
      if (categoryScores[cat] > maxScore) {
        maxScore = categoryScores[cat];
        maxCategory = cat;
      }
    }
    return maxCategory;
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
        if (textLower.includes(keyword)) {
          detected[intentName] = true;
          break;
        }
      }
    }

    return detected;
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