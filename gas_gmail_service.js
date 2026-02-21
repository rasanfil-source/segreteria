/**
 * GmailService.gs - Gestione operazioni Gmail
 * 
 * FUNZIONALITÀ:
 * - Label cache per performance
 * - Supporto header Reply-To per form web
 * - Costruttore cronologia conversazione
 * - Rimozione citazioni/firme
 * - Threading corretto (In-Reply-To, References)
 * - Markdown to HTML
 */

class GmailService {
  constructor() {
    console.log('📧 Inizializzazione GmailService...');

    // Cache etichette: in-memory (stessa esecuzione) + CacheService (cross-esecuzione)
    this._labelCache = new Map();
    this._cacheTTL = (typeof CONFIG !== 'undefined' && CONFIG.GMAIL_LABEL_CACHE_TTL) ? CONFIG.GMAIL_LABEL_CACHE_TTL : 3600000;
    this._cacheTtlSeconds = Math.max(60, Math.floor(this._cacheTTL / 1000));
    this._scriptCache = CacheService.getScriptCache();

    console.log('✓ GmailService inizializzato con cache etichette (TTL 1h)');
  }

  // ========================================================================
  // GESTIONE ETICHETTE (con cache)
  // ========================================================================

  /**
   * Ottiene o crea un'etichetta Gmail con caching
   */
  getOrCreateLabel(labelName) {
    const cacheKey = `gmail_label_exists:${labelName}`;
    const cachedEntry = this._labelCache.get(labelName);
    const now = Date.now();
    if (cachedEntry && (now - cachedEntry.ts) < this._cacheTTL) {
      console.log(`📦 Label '${labelName}' trovata in cache`);
      return cachedEntry.label;
    } else if (cachedEntry) {
      this._labelCache.delete(labelName);
    }

    const cachedExists = this._scriptCache.get(cacheKey);
    if (cachedExists) {
      const label = GmailApp.getUserLabelByName(labelName);
      if (label) {
        this._labelCache.set(labelName, { label: label, ts: now });
        console.log(`📦 Label '${labelName}' trovata in cache persistente`);
        return label;
      }
      this._scriptCache.remove(cacheKey);
    }

    const labels = GmailApp.getUserLabels();
    for (const label of labels) {
      if (label.getName() === labelName) {
        this._labelCache.set(labelName, { label: label, ts: now });
        this._scriptCache.put(cacheKey, '1', this._cacheTtlSeconds);
        console.log(`✓ Label '${labelName}' trovata`);
        return label;
      }
    }

    const newLabel = GmailApp.createLabel(labelName);
    this._labelCache.set(labelName, { label: newLabel, ts: now });
    this._scriptCache.put(cacheKey, '1', this._cacheTtlSeconds);
    console.log(`✓ Creata nuova label: ${labelName}`);
    return newLabel;
  }

  clearLabelCache() {
    this._labelCache.clear();
    console.log('🗑️ Cache label svuotata');
  }

  _clearPersistentLabelCache(labelName) {
    if (!labelName) return;
    this._scriptCache.remove(`gmail_label_exists:${labelName}`);
  }

  addLabelToThread(thread, labelName) {
    try {
      const label = this.getOrCreateLabel(labelName);
      thread.addLabel(label);
      console.log(`✓ Aggiunta label '${labelName}' al thread`);
    } catch (e) {
      console.warn(`⚠️ addLabelToThread fallito per '${labelName}': ${e.message}`);
      if (this._isLabelNotFoundError(e)) {
        this._clearPersistentLabelCache(labelName);
        this.clearLabelCache();
        const label = this.getOrCreateLabel(labelName);
        thread.addLabel(label);
        console.log(`✓ Aggiunta label '${labelName}' al thread (retry dopo cache reset)`);
        return;
      }

      // Non nascondere errori non correlati alla cache etichette (permessi, quota, thread invalido...)
      throw e;
    }
  }

  /**
   * Aggiunge etichetta a un messaggio specifico (Gmail API avanzata)
   */
  addLabelToMessage(messageId, labelName) {
    try {
      const label = this.getOrCreateLabel(labelName);
      const labelId = label.getId();
      Gmail.Users.Messages.modify({
        addLabelIds: [labelId],
        removeLabelIds: []
      }, 'me', messageId);
      console.log(`✓ Aggiunta label '${labelName}' al messaggio ${messageId}`);
    } catch (e) {
      console.warn(`⚠️ addLabelToMessage fallito per messaggio ${messageId}: ${e.message}`);
      if (this._isLabelNotFoundError(e)) {
        this._clearPersistentLabelCache(labelName);
        this.clearLabelCache();
        try {
          const label = this.getOrCreateLabel(labelName);
          const labelId = label.getId();
          Gmail.Users.Messages.modify({
            addLabelIds: [labelId],
            removeLabelIds: []
          }, 'me', messageId);
          console.log(`✓ Aggiunta label '${labelName}' al messaggio ${messageId} (retry dopo cache reset)`);
        } catch (retryError) {
          console.warn(`⚠️ Retry addLabelToMessage fallito per messaggio ${messageId}: ${retryError.message}`);
          throw retryError;
        }
        return;
      }
      throw e;
    }
  }

  _isLabelNotFoundError(error) {
    const message = (error && error.message) ? error.message.toLowerCase() : '';
    return (message.includes('label') && message.includes('not found')) ||
      message.includes('etichetta non trovata') ||
      message.includes('invalid label') ||
      message.includes('404');
  }

  /**
   * Ottiene gli ID di tutti i messaggi con una specifica etichetta
   */
  getMessageIdsWithLabel(labelName) {
    try {
      const label = this.getOrCreateLabel(labelName);
      const labelId = label.getId();

      const messageIds = new Set();
      let pageToken;

      do {
        const response = Gmail.Users.Messages.list('me', {
          labelIds: [labelId],
          maxResults: 500,
          pageToken: pageToken
        });

        if (response.messages) {
          response.messages.forEach(m => messageIds.add(m.id));
        }

        pageToken = response.nextPageToken;
      } while (pageToken);

      console.log(`📦 Trovati ${messageIds.size} messaggi con label '${labelName}'`);
      return messageIds;
    } catch (e) {
      console.warn(`⚠️ Impossibile ottenere messaggi con label ${labelName}: ${e.message}`);
      return new Set();
    }
  }

  // ========================================================================
  // ESTRAZIONE MESSAGGI (con supporto Reply-To)
  // ========================================================================

  /**
   * Estrae dettagli messaggio con supporto Reply-To e threading
   */
  extractMessageDetails(message) {
    const subject = message.getSubject();
    const sender = message.getFrom();
    const date = message.getDate();
    const body = message.getPlainBody() || this._htmlToPlainText(message.getBody());
    const messageId = message.getId();

    // Estrai RFC 2822 Message-ID e header utili per filtraggio
    let rfc2822MessageId = null;
    let existingReferences = null;
    let isNewsletter = false;
    const headers = {};
    try {
      const rawMessage = Gmail.Users.Messages.get('me', messageId, {
        format: 'metadata',
        metadataHeaders: [
          'Message-ID',
          'References',
          'Auto-Submitted',
          'Precedence',
          'X-Autoreply',
          'X-Auto-Response-Suppress',
          'Reply-To',
          'List-Unsubscribe'
        ]
      });
      if (rawMessage && rawMessage.payload && rawMessage.payload.headers) {
        for (const header of rawMessage.payload.headers) {
          if (header && header.name) {
            headers[header.name.toLowerCase()] = header.value || '';
          }
          if (header.name === 'Message-ID' || header.name === 'Message-Id') {
            rfc2822MessageId = header.value;
          }
          if (header.name === 'References') {
            existingReferences = header.value;
          }
        }
      }

      // Calcolo flag newsletter basato su header raccolti
      if (headers['list-unsubscribe'] || /bulk|list/i.test(headers['precedence'] || '')) {
        isNewsletter = true;
      }
    } catch (e) {
      console.warn(`⚠️ Impossibile estrarre RFC 2822 Message-ID: ${e.message}`);
    }

    const replyTo = message.getReplyTo();

    let effectiveSender;
    let hasReplyTo = false;

    if (replyTo && replyTo.includes('@') && replyTo !== sender) {
      effectiveSender = replyTo;
      hasReplyTo = true;
      console.log(`   📧 Uso Reply-To: ${replyTo} (From originale: ${sender})`);
    } else {
      effectiveSender = sender;
    }

    const senderName = this._extractSenderName(effectiveSender);
    const senderEmail = this._extractEmailAddress(effectiveSender);

    let recipientEmail = null;
    try {
      recipientEmail = message.getTo();
    } catch (e) {
      recipientEmail = Session.getActiveUser().getEmail();
    }

    let recipientCc = '';
    try {
      recipientCc = message.getCc() || '';
    } catch (e) {
      recipientCc = '';
    }

    return {
      id: messageId,
      subject: subject,
      sender: effectiveSender,
      senderName: senderName,
      senderEmail: senderEmail,
      date: date,
      body: body,
      originalFrom: sender,
      hasReplyTo: hasReplyTo,
      rfc2822MessageId: rfc2822MessageId,
      existingReferences: existingReferences,
      recipientEmail: recipientEmail,
      recipientCc: recipientCc,
      headers: headers,
      isNewsletter: isNewsletter
    };
  }

  // ========================================================================
  // ALLEGATI: OCR PDF/IMMAGINI PER CONTESTO PROMPT
  // ========================================================================

  /**
   * Estrae testo OCR dagli allegati (PDF/immagini) per contesto prompt.
   * Richiede Drive Advanced Service abilitato.
   * @param {GmailMessage} message
   * @param {object} options
   * @returns {{text: string, items: Array, skipped: Array}}
   */
  extractAttachmentContext(message, options = {}) {
    const defaults = (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT)
      ? CONFIG.ATTACHMENT_CONTEXT
      : {};
    const settings = Object.assign({
      enabled: true,
      maxFiles: 4,
      maxBytesPerFile: 5 * 1024 * 1024,
      maxCharsPerFile: 4000,
      maxTotalChars: 12000,
      ocrLanguage: 'it',
      ocrConfidenceWarningThreshold: 0.8,
      pdfMaxPages: 2,
      pdfCharsPerPage: 1800,
      shouldContinue: null
    }, defaults, options);

    settings.ocrLanguage = this._resolveOcrLanguage(options.detectedLanguage || settings.ocrLanguage || 'it');

    if (!settings.enabled) {
      return { text: '', items: [], skipped: [], ocrConfidence: null, ocrConfidenceLow: false };
    }

    let attachments = [];
    try {
      attachments = message.getAttachments({ includeInlineImages: true, includeAttachments: true }) || [];
    } catch (e) {
      console.warn(`⚠️ Impossibile leggere allegati: ${e.message}`);
      return { text: '', items: [], skipped: [{ reason: 'read_error', error: e.message }], ocrConfidence: null, ocrConfidenceLow: false };
    }

    if (attachments.length === 0) {
      return { text: '', items: [], skipped: [], ocrConfidence: null, ocrConfidenceLow: false };
    }
    console.log(`   📎 Allegati trovati: ${attachments.length}`);

    const items = [];
    const skipped = [];
    let totalChars = 0;

    for (const attachment of attachments) {
      if (typeof settings.shouldContinue === 'function' && !settings.shouldContinue()) {
        skipped.push({ reason: 'near_deadline' });
        console.warn('   ⏳ OCR interrotto: tempo residuo insufficiente');
        break;
      }

      const attachmentName = attachment.getName ? attachment.getName() : 'allegato';
      if (items.length >= settings.maxFiles) {
        skipped.push({ name: attachmentName, reason: 'max_files' });
        continue;
      }

      const contentType = (attachment.getContentType() || '').toLowerCase();
      const isPdf = contentType.includes('pdf');
      const isImage = contentType.startsWith('image/');

      if (!isPdf && !isImage) {
        skipped.push({ name: attachmentName, reason: 'unsupported_type', contentType: contentType });
        continue;
      }


      const size = attachment.getSize ? attachment.getSize() : 0;
      if (size > settings.maxBytesPerFile) {
        skipped.push({ name: attachmentName, reason: 'too_large', size: size });
        continue;
      }

      // Check Nome File Generico (Segnale Debole)
      const fileNameLower = attachmentName.toLowerCase();
      const suspiciousNames = ["img_", "dsc_", "photo", "whatsapp image", "image", "screenshot"];
      const isGenericName = suspiciousNames.some(name => fileNameLower.includes(name));

      const ocrText = this._extractOcrTextFromAttachment(attachment, settings);
      const ocrConfidence = this._estimateOcrConfidence(ocrText, isGenericName);
      // Logica Filtro Qualità OCR
      if (!this._isMeaningfulOCR(ocrText, isGenericName)) {
        skipped.push({ name: attachmentName, reason: 'ocr_quality_low', ocrConfidence: ocrConfidence });
        continue;
      }

      let normalized = this._normalizeAttachmentText(ocrText);
      if (settings.ibanFocusEnabled) {
        const focused = this._focusTextAroundIban(normalized, settings.ibanContextChars || 300);
        if (focused.matched) {
          console.log(`   💳 IBAN rilevato nell'allegato. Estraggo contesto focalizzato.`);
          normalized = `[FOCUS IBAN DETECTED]\n...${focused.text}...`;
        }
      }

      let perFileLimit = settings.maxCharsPerFile;
      if (isPdf && settings.pdfMaxPages && settings.pdfCharsPerPage) {
        const estimatedPages = Math.ceil(normalized.length / settings.pdfCharsPerPage);
        if (estimatedPages > settings.pdfMaxPages) {
          const estimatedLimit = settings.pdfMaxPages * settings.pdfCharsPerPage;
          perFileLimit = Math.min(perFileLimit, estimatedLimit);
        }
      }

      let clipped = normalized.slice(0, perFileLimit).trim();
      if (!clipped) {
        skipped.push({ name: attachmentName, reason: 'empty_after_clip' });
        continue;
      }

      const remaining = settings.maxTotalChars - totalChars;
      if (remaining <= 0) {
        skipped.push({ name: attachmentName, reason: 'total_limit' });
        break;
      }

      if (clipped.length > remaining) {
        clipped = clipped.slice(0, Math.max(0, remaining - 1)).trim() + '…';
      }

      const documentType = this._detectDocumentType(attachmentName, clipped);
      const extractedFields = this._extractDocumentFields(clipped, settings.documentFieldMasking !== false);

      items.push({
        name: attachmentName,
        contentType: contentType,
        size: size,
        ocrConfidence: ocrConfidence,
        documentType: documentType,
        extractedFields: extractedFields,
        text: clipped
      });

      totalChars += clipped.length;
    }

    if (items.length === 0) {
      return { text: '', items: [], skipped: skipped, ocrConfidence: null, ocrConfidenceLow: false };
    }

    const text = items.map((item, idx) => {
      const sizeKb = item.size ? `${Math.round(item.size / 1024)}KB` : 'n/a';
      const docTypeLine = item.documentType ? `Tipo documento stimato: ${item.documentType}` : '';
      const extractedFieldsLine = (item.extractedFields && item.extractedFields.length > 0)
        ? `Campi rilevati: ${item.extractedFields.join(' | ')}`
        : '';
      return [
        `(${idx + 1}) ${item.name} [${item.contentType || 'tipo sconosciuto'}, ${sizeKb}]`,
        docTypeLine,
        extractedFieldsLine,
        item.text
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    const averageConfidence = items.length > 0
      ? items.reduce((acc, item) => acc + (item.ocrConfidence || 0), 0) / items.length
      : null;

    return {
      text: text,
      items: items,
      skipped: skipped,
      ocrConfidence: averageConfidence,
      ocrConfidenceLow: averageConfidence !== null && averageConfidence < (settings.ocrConfidenceWarningThreshold || 0.8)
    };
  }

  _extractOcrTextFromAttachment(attachment, settings) {
    let fileId = null;
    try {
      if (typeof settings.shouldContinue === 'function' && !settings.shouldContinue()) {
        return '';
      }

      if (typeof Drive === 'undefined' || !Drive.Files) {
        throw new Error('Drive Advanced Service non abilitato');
      }

      const blob = attachment.copyBlob();
      const fileName = attachment.getName() || 'allegato';

      if (typeof Drive.Files.insert === 'function') {
        const resource = {
          title: `OCR_${fileName}`,
          mimeType: blob.getContentType()
        };

        const file = Drive.Files.insert(resource, blob, {
          ocr: true,
          ocrLanguage: settings.ocrLanguage || 'it',
          convert: true
        });
        fileId = file.id;
      } else if (typeof Drive.Files.create === 'function') {
        const resource = {
          name: `OCR_${fileName}`,
          mimeType: blob.getContentType()
        };
        const file = Drive.Files.create(resource, blob, {
          ocrLanguage: settings.ocrLanguage || 'it'
        });
        fileId = file.id;
      } else {
        throw new Error('Drive.Files non espone metodi OCR compatibili (insert/create)');
      }

      const doc = DocumentApp.openById(fileId);
      return doc.getBody().getText();
    } catch (e) {
      console.warn(`⚠️ OCR allegato fallito: ${e.message}`);
      return '';
    } finally {
      if (fileId) {
        try {
          if (typeof Drive.Files.remove === 'function') {
            Drive.Files.remove(fileId);
          } else if (typeof Drive.Files.delete === 'function') {
            Drive.Files.delete(fileId);
          } else if (typeof Drive.Files.trash === 'function') {
            Drive.Files.trash(fileId);
          }
        } catch (e) {
          console.warn(`⚠️ Cleanup OCR allegato fallito (${fileId}): ${e.message}`);
        }
      }
    }
  }

  /**
   * Valuta se il testo OCR è significativo o spazzatura/vuoto.
   * @param {string} text - Testo grezzo OCR
   * @param {boolean} isGenericName - Se il nome file è generico (es. IMG_1234.jpg)
   * @returns {boolean} - True se il testo è valido
   */
  _isMeaningfulOCR(text, isGenericName) {
    if (!text) return false;

    // Pulizia base: spazi multipli -> singolo spazio
    const cleaned = text.replace(/\s+/g, ' ').trim();

    // 1. Filtro Lunghezza Minima Assoluta
    // Se meno di 30 caratteri, è probabilmente rumore o intestazioni vuote
    if (cleaned.length < 30) return false;

    // 2. Filtro Contenuto Alfabetico (Immagini nere/rumore)
    // Conta le lettere effettive (a-z, A-Z)
    const letters = (cleaned.match(/[a-zA-Z]/g) || []).length;
    if (letters < 5) return false; // Meno di 5 lettere = spazzatura (es. "|||||--")

    // 3. Filtro Combinato per Nomi Generici
    // Se il file ha nome generico (es. IMG_...), richiediamo più testo (50 caratteri)
    // per evitare di includere screenshot accidentali o foto sfocate con poco testo.
    if (isGenericName && cleaned.length < 50) {
      return false;
    }

    return true;
  }

  _resolveOcrLanguage(languageCode) {
    const normalized = (languageCode || 'it').toString().toLowerCase().trim();
    if (!normalized) return 'it';

    const supported = new Set(['it', 'en', 'es', 'fr', 'de', 'pt', 'nl']);
    if (supported.has(normalized)) {
      return normalized;
    }

    // Gestione codici regionali tipo en-US -> en
    const base = normalized.split(/[-_]/)[0];
    return supported.has(base) ? base : 'it';
  }

  _estimateOcrConfidence(text, isGenericName) {
    if (!text || typeof text !== 'string') return 0;

    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return 0;

    const letters = (cleaned.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
    const chars = cleaned.length;
    const letterRatio = Math.min(1, letters / Math.max(1, chars * 0.45));

    let score = 0.3;
    score += Math.min(cleaned.length / 600, 0.35);
    score += letterRatio * 0.3;

    if (isGenericName) {
      score -= 0.1;
    }

    return Math.max(0, Math.min(1, Number(score.toFixed(2))));
  }

  _normalizeAttachmentText(text, settings) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text.replace(/\s+/g, ' ').trim();

    // Logica Focus IBAN
    if (settings && settings.ibanFocusEnabled) {
      // Regex IBAN IT (semplificata: IT + 2 cifre + 1 lettera + 22 alfanumerici)
      // O generica: IT\d{2}[A-Z]\d{10}[A-Z0-9]{12}
      // Usiamo una regex che cattura 'IT' seguito da 25 chars circa
      // Regex IBAN universale (27 paesi EU + altri SEPA)
      const ibanRegex = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/i;
      const match = cleaned.match(ibanRegex);

      if (match) {
        const ibanIndex = match.index;
        const contextChars = settings.ibanContextChars || 300;
        const start = Math.max(0, ibanIndex - contextChars);
        const end = Math.min(cleaned.length, ibanIndex + match[0].length + contextChars);

        console.log(`   💳 IBAN rilevato nell'allegato. Estraggo contesto focalizzato.`);
        return `[FOCUS IBAN DETECTED]\n...${cleaned.slice(start, end)}...`;
      }
    }

    return cleaned;
  }

  /**
   * Estrae contesto focalizzato attorno a un IBAN rilevato nel testo.
   * @param {string} text - Testo da analizzare
   * @param {number} contextChars - Caratteri di contesto prima/dopo IBAN
   * @returns {{matched: boolean, text: string}} Risultato con flag e testo estratto
   */
  _focusTextAroundIban(text, contextChars = 300) {
    if (!text || typeof text !== 'string') {
      return { matched: false, text: '' };
    }

    // Regex IBAN italiano (IT + 2 cifre controllo + 1 lettera CIN + 22 alfanumerici)
    // Regex IBAN universale (27 paesi EU + altri SEPA)
    const ibanRegex = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/i;
    const match = text.match(ibanRegex);

    if (!match) {
      return { matched: false, text: text };
    }

    const ibanIndex = match.index;
    const start = Math.max(0, ibanIndex - contextChars);
    const end = Math.min(text.length, ibanIndex + match[0].length + contextChars);

    return {
      matched: true,
      text: text.slice(start, end)
    };
  }

  _extractSenderName(fromField) {
    if (!fromField || typeof fromField !== 'string') {
      return 'Utente';
    }

    const match = fromField.match(/^"?(.+?)"?\s*</);
    let name = null;

    if (match) {
      name = match[1].trim();
    } else {
      const email = this._extractEmailAddress(fromField);
      if (email) {
        name = email.split('@')[0];
      }
    }

    if (name) {
      return this._capitalizeName(name);
    }

    return 'Utente';
  }

  _capitalizeName(name) {
    if (!name) return name;

    return name
      .split(/[\s-]+/)
      .map(word => {
        if (word.length === 0) return word;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }

  _extractEmailAddress(fromField) {
    if (typeof fromField !== 'string') return '';

    const angleMatch = fromField.match(/<(.+?)>/);
    if (angleMatch) {
      return angleMatch[1];
    }

    // Punto 3: Regex più robusta per l'estrazione degli indirizzi email
    const emailMatch = fromField.match(/\b[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\b/i);
    if (emailMatch) {
      return emailMatch[0];
    }

    return '';
  }

  _htmlToPlainText(html) {
    if (!html) return '';

    let text = html.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  // ========================================================================
  // CRONOLOGIA CONVERSAZIONE
  // ========================================================================

  /**
   * Costruisce cronologia conversazione da messaggi thread
   */
  buildConversationHistory(messages, maxMessages = 10, ourEmail = '') {
    if (!ourEmail) {
      ourEmail = Session.getActiveUser().getEmail();
    }

    if (messages.length > maxMessages) {
      console.warn(`⚠️ Thread con ${messages.length} messaggi, limitato a ultimi ${maxMessages}`);
      messages = messages.slice(-maxMessages);
    }

    const history = [];

    for (const msg of messages) {
      const details = this.extractMessageDetails(msg);
      const isOurs = ourEmail && details.senderEmail.toLowerCase() === ourEmail.toLowerCase();

      const prefix = isOurs ? 'Segreteria' : `Utente (${details.senderName})`;

      let body = details.body;
      if (body.length > 2000) {
        body = body.substring(0, 2000) + '\n[... messaggio troncato ...]';
      }

      history.push(`${prefix}: ${body}\n---`);
    }

    return history.join('\n');
  }

  // ========================================================================
  // RIMOZIONE CITAZIONI/FIRME
  // ========================================================================

  extractMainReply(content) {
    const markers = [
      /^>/m,
      /^On .* wrote:/m,
      /^Il giorno .* ha scritto:/m,
      /^-{3,}.*Original Message/m
    ];

    let result = content;

    for (const marker of markers) {
      const match = result.search(marker);
      if (match !== -1) {
        result = result.substring(0, match);
        break;
      }
    }

    const sigMarkers = [
      /cordiali saluti/i,
      /distinti saluti/i,
      /in fede/i,
      /best regards/i,
      /sincerely/i,
      /sent from my iphone/i,
      /inviato da/i
    ];

    for (const marker of sigMarkers) {
      const match = result.search(marker);
      if (match !== -1) {
        result = result.substring(0, match);
        break;
      }
    }

    return result.trim();
  }

  // ========================================================================
  // INVIO RISPOSTA
  // ========================================================================

  sendReply(thread, replyText, messageDetails) {
    const gmailThread = typeof thread === 'string' ?
      GmailApp.getThreadById(thread) : thread;

    gmailThread.reply(replyText);

    console.log(`✓ Risposta inviata a ${messageDetails.senderEmail}`);

    if (messageDetails.hasReplyTo) {
      console.log('   📧 Risposta inviata all\'indirizzo Reply-To');
    }

    return true;
  }

  /**
   * Invia risposta come HTML con threading corretto
   */
  sendHtmlReply(resource, responseText, messageDetails) {
    const sanitizedText = this._sanitizeHeaders(responseText);

    let finalResponse = sanitizedText;
    if (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE.replacements) {
      const replacementCount = Object.keys(GLOBAL_CACHE.replacements).length;
      if (replacementCount > 0) {
        finalResponse = this.applyReplacements(finalResponse, GLOBAL_CACHE.replacements);
        console.log(`   ✓ Applicate ${replacementCount} regole sostituzione`);
      }
    }

    finalResponse = this.fixPunctuation(finalResponse, messageDetails.senderName);
    finalResponse = this.ensureGreetingLineBreak(finalResponse);

    const htmlBody = markdownToHtml(finalResponse);
    const plainText = this._htmlToPlainText(htmlBody);

    const hasThreadingInfo = messageDetails.rfc2822MessageId;

    if (hasThreadingInfo) {
      try {
        let threadId = null;
        if (typeof resource === 'string') {
          threadId = resource;
        } else if (resource && typeof resource.getId === 'function') {
          if (typeof resource.getThread === 'function') {
            threadId = resource.getThread().getId();
          } else {
            threadId = resource.getId();
          }
        }

        let replySubject = messageDetails.subject;
        if (!replySubject.toLowerCase().startsWith('re:')) {
          replySubject = 'Re: ' + replySubject;
        }

        let referencesHeader = messageDetails.rfc2822MessageId;
        if (messageDetails.existingReferences) {
          referencesHeader = messageDetails.existingReferences + ' ' + messageDetails.rfc2822MessageId;
        }

        // From stabile: usa sempre l'account attivo (evita errori "non autorizzato")
        const stableFrom = Session.getActiveUser().getEmail();

        // Reply-To: usa alias solo se presente in To/Cc del messaggio originale
        let replyToEmail = null;
        const recipientHeaders = `${messageDetails.recipientEmail || ''},${messageDetails.recipientCc || ''}`;
        const emailRegex = /\b[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,64})@[A-Za-z0-9-]+\.[A-Za-z]{2,}\b/gi;
        const recipientAddresses = (recipientHeaders.match(emailRegex) || [])
          .map(addr => addr.replace(/[\r\n]+/g, '').trim().toLowerCase());
        const knownAliases = (typeof CONFIG !== 'undefined' && CONFIG.KNOWN_ALIASES)
          ? CONFIG.KNOWN_ALIASES.map(alias => (alias || '').toLowerCase())
          : [];

        const matchedAlias = recipientAddresses.find(addr => knownAliases.includes(addr));
        if (matchedAlias && matchedAlias !== stableFrom.toLowerCase()) {
          replyToEmail = matchedAlias;
        }

        const boundary = 'boundary_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
        const rawHeaders = [
          'MIME-Version: 1.0',
          `From: ${stableFrom}`,
          `To: ${messageDetails.senderEmail}`,
          `Subject: =?UTF-8?B?${Utilities.base64Encode(replySubject, Utilities.Charset.UTF_8)}?=`,
          `In-Reply-To: ${messageDetails.rfc2822MessageId}`,
          `References: ${referencesHeader}`,
          `Content-Type: multipart/alternative; boundary="${boundary}"`
        ];

        if (replyToEmail) {
          rawHeaders.splice(2, 0, `Reply-To: ${replyToEmail}`);
        }

        const rawMessage = [
          ...rawHeaders,
          '',
          `--${boundary}`,
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
          '',
          Utilities.base64Encode(plainText, Utilities.Charset.UTF_8),
          '',
          `--${boundary}`,
          'Content-Type: text/html; charset=UTF-8',
          'Content-Transfer-Encoding: base64',
          '',
          Utilities.base64Encode(htmlBody, Utilities.Charset.UTF_8),
          '',
          `--${boundary}--`
        ].join('\r\n');

        const encodedMessage = Utilities.base64EncodeWebSafe(rawMessage);

        Gmail.Users.Messages.send({
          raw: encodedMessage,
          threadId: threadId
        }, 'me');

        console.log(`✓ Risposta HTML inviata via Gmail API a ${messageDetails.senderEmail}`);
        console.log(`   📧 Threading headers: In-Reply-To=${messageDetails.rfc2822MessageId.substring(0, 30)}...`);
        return;

      } catch (apiError) {
        console.warn(`⚠️ Gmail API fallita, ripiego su GmailApp: ${apiError.message}`);
      }
    }

    // Alternativa: metodo tradizionale
    // Nel fallback nativo prediligiamo il cast esplicito a GmailMessage (se disponibile)
    // affinché la libreria interna mantenga al meglio il riferimento al messaggio specifico
    const isMessage = resource && typeof resource.reply === 'function' && typeof resource.getThread === 'function';
    const mailEntity = isMessage ? resource : (typeof resource === 'string' ? GmailApp.getThreadById(resource) : resource);

    try {
      mailEntity.reply('', { htmlBody: htmlBody });
      console.log(`✓ Risposta HTML inviata a ${messageDetails.senderEmail} (metodo alternativo nativo)`);
    } catch (error) {
      console.error(`❌ Risposta fallita: ${error.message}`);
      try {
        mailEntity.reply(plainText || this._stripHtmlTags(finalResponse));
        console.log(`✓ Risposta plain text inviata a ${messageDetails.senderEmail} (alternativa)`);
      } catch (fallbackError) {
        console.error(`❌ CRITICO: Invio risposta alternativo fallito: ${fallbackError.message}`);
        const errorLabel = (typeof CONFIG !== 'undefined' && CONFIG.ERROR_LABEL_NAME) ? CONFIG.ERROR_LABEL_NAME : 'Errore';
        if (mailEntity && typeof mailEntity.getMessages === 'function') {
          this.addLabelToThread(mailEntity, errorLabel);
        }
      }
    }
  }

  _stripHtmlTags(text) {
    if (!text) return '';
    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/#{1,4}\s+/g, '')
      // Mantieni link leggibile: [Testo](URL) -> Testo (URL)
      .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');
  }

  // ========================================================================
  // SAFEGUARD DI FORMATTAZIONE
  // ========================================================================

  /**
   * Corregge errori comuni di punteggiatura
   * Gestisce eccezioni per nomi doppi (es. "Maria Isabella")
   */
  fixPunctuation(text, senderName = '') {
    if (!text) return text;

    const exceptions = ['Don', 'Padre', 'Suor', 'Monsignor', 'Papa', 'Signore', 'Signora'];

    if (senderName) {
      const nameParts = senderName.split(/\s+/);
      for (const part of nameParts) {
        if (part && !exceptions.includes(part)) {
          exceptions.push(part);
        }
      }
    }

    return text.replace(/,\s+([A-ZÀÈÉÌÒÙ])([a-zàèéìòù]*)/g, (match, firstLetter, rest, offset) => {
      const word = firstLetter + rest;

      if (exceptions.includes(word)) {
        return match;
      }

      const afterMatch = text.substring(offset + match.length);

      // Eccezione per virgola/punto successivo
      if (afterMatch.match(/^\s*[,.]/)) {
        return match;
      }

      // Eccezione per congiunzione "e" seguita da nome (es. "Maria e Giovanni,")
      if (afterMatch.match(/^\s+e\s+[A-ZÀÈÉÌÒÙ][a-zàèéìòù]*\s*[,.]/)) {
        return match;
      }

      // Euristica nomi doppi: se la parola è seguita da un'altra parola maiuscola,
      // probabilmente sono nomi propri (es. "Maria Isabella", "Gian Luca", "Carlo Alberto")
      if (afterMatch.match(/^\s+[A-ZÀÈÉÌÒÙ][a-zàèéìòù]+/)) {
        return match;
      }

      return `, ${firstLetter.toLowerCase()}${rest}`;
    });
  }

  ensureGreetingLineBreak(text) {
    if (!text) return text;

    const lines = text.split('\n');
    if (lines.length > 1) {
      const firstLine = lines[0].trim();
      if (/^(Buongiorno|Buonasera|Salve|Gentile|Egregio|Ciao)/i.test(firstLine)) {
        if (lines[1].trim() !== '') {
          lines.splice(1, 0, '');
          return lines.join('\n');
        }
      }
    }
    return text;
  }

  /**
   * Applica sostituzioni testo dal foglio Sostituzioni
   */
  applyReplacements(text, replacements) {
    if (!text || !replacements) return text;

    let result = text;
    let count = 0;

    for (const [bad, good] of Object.entries(replacements)) {
      const regex = new RegExp(bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const before = result;
      result = result.replace(regex, good);

      if (result !== before) {
        count++;
      }
    }

    if (count > 0) {
      console.log(`✓ Applicate ${count} sostituzioni`);
    }

    return result;
  }

  _sanitizeHeaders(text) {
    if (!text) return '';
    return text
      .replace(/(^|\n)(To|Cc|Bcc|From|Subject|Reply-To):/gi, '$1[$2]:')
      .replace(/\r\n|\r/g, '\n');
  }

  // ========================================================================
  // VERIFICA STATO
  // ========================================================================

  testConnection() {
    const results = {
      connectionOk: false,
      canListMessages: false,
      canCreateLabels: false,
      errors: []
    };

    try {
      const threads = GmailApp.search('is:unread', 0, 1);
      results.connectionOk = true;
      results.canListMessages = true;

      try {
        const testLabel = this.getOrCreateLabel('_TEST_LABEL_');
        results.canCreateLabels = true;

        try {
          testLabel.deleteLabel();
        } catch (e) { }
      } catch (e) {
        results.errors.push(`Impossibile creare label: ${e.message}`);
      }

    } catch (e) {
      results.errors.push(`Errore connessione: ${e.message}`);
    }

    results.isHealthy = results.connectionOk && results.canListMessages;
    return results;
  }

  _detectDocumentType(fileName, text) {
    const source = `${fileName || ''}\n${text || ''}`.toLowerCase();
    const docPatterns = [
      { type: 'Modulo iscrizione cresima', patterns: ['cresima', 'confermazione'], minMatches: 1 },
      { type: 'Modulo iscrizione prima comunione/catechesi', patterns: ['prima comunione', 'catechesi', 'catechismo'], minMatches: 1 },
      { type: 'Modulo corso prematrimoniale', patterns: ['prematrimonial', 'fidanzati', 'matrimonio'], minMatches: 1 },
      { type: 'Certificato di battesimo', patterns: ['certificato', 'battesimo', 'battezz'], minMatches: 2 },
      { type: 'Certificato di cresima', patterns: ['certificato', 'cresima', 'confermazion'], minMatches: 2 },
      { type: 'Documento identità/passaporto', patterns: ['carta d\'identit', 'documento di identit', 'passaporto'], minMatches: 1 },
      { type: 'Tessera sanitaria/codice fiscale', patterns: ['tessera sanitaria', 'codice fiscale'], minMatches: 1 }
    ];

    for (const rule of docPatterns) {
      const matches = rule.patterns.reduce((acc, pattern) => acc + (source.includes(pattern) ? 1 : 0), 0);
      if (matches >= (rule.minMatches || rule.patterns.length)) {
        return rule.type;
      }
    }

    if (source.includes('certificato')) return 'Certificato (non specificato)';
    if (source.includes('modulo') || source.includes('iscrizione')) return 'Modulo parrocchiale';
    return 'Documento generico';
  }

  _extractDocumentFields(text, shouldMask = true) {
    const value = `${text || ''}`;
    if (!value) return [];

    const extract = [];
    const patterns = [
      { label: 'Nome e cognome', regex: /(?:nome\s*(?:e\s*cognome)?|cognome\s*e\s*nome)\s*[:\-]\s*([^\n,;]{3,80})/i },
      { label: 'Data di nascita', regex: /(?:data\s*di\s*nascita|nato\/a\s*il)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i },
      { label: 'Luogo di nascita', regex: /(?:luogo\s*di\s*nascita|nato\/a\s*a)\s*[:\-]\s*([^\n,;]{2,80})/i },
      { label: 'Codice fiscale', regex: /\b([A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z])\b/i },
      { label: 'Documento', regex: /(?:numero\s*(?:documento|doc\.)|n\.\s*documento)\s*[:\-]?\s*([A-Z0-9\-]{5,20})/i },
      { label: 'Contatto email', regex: /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i },
      { label: 'Telefono', regex: /(?:tel(?:efono)?|cell(?:ulare)?)\s*[:\-]?\s*(\+?[0-9\s]{7,16})/i }
    ];

    for (const p of patterns) {
      const m = value.match(p.regex);
      if (!m || !m[1]) continue;
      const normalized = m[1].trim();
      extract.push(`${p.label}: ${shouldMask ? this._maskSensitiveValue(normalized) : normalized}`);
    }

    return extract.slice(0, 8);
  }

  _maskSensitiveValue(raw) {
    const value = `${raw || ''}`.trim();
    if (!value) return '';
    if (value.length <= 4) return '****';
    const visiblePrefix = value.slice(0, 2);
    const visibleSuffix = value.slice(-2);
    return `${visiblePrefix}${'*'.repeat(Math.max(4, value.length - 4))}${visibleSuffix}`;
  }
}

// Funzione factory
function createGmailService() {
  return new GmailService();
}

// ====================================================================
// MARKDOWN → HTML
// ====================================================================

/**
 * Sanitizzazione URL robusta con whitelist di protocolli
 */
function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return null;

  let decoded = url
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  try {
    decoded = decodeURIComponent(decoded);
  } catch (e) {
    console.warn('⚠️ URL decode fallito, uso raw');
  }

  decoded = decoded.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  const normalized = decoded.toLowerCase().trim();

  const FORBIDDEN_PROTOCOLS = /^\s*(javascript|vbscript|data|file):/i;
  const ALLOWED_PROTOCOLS = /^\s*(https?|mailto):/i;

  if (FORBIDDEN_PROTOCOLS.test(normalized)) {
    console.warn(`🛑 Bloccato protocollo pericoloso: ${decoded}`);
    return null;
  }

  if (!ALLOWED_PROTOCOLS.test(normalized)) {
    console.warn(`🛑 Bloccato protocollo non whitelisted: ${decoded}`);
    return null;
  }

  // SSRF: blocco IP interni, IPv6 loopback/link-local, IP decimali
  const INTERNAL_IP_PATTERN = /^(https?:\/\/)?(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/i;
  const IPV6_LOOPBACK = /\[?::1\]?/;
  const IPV6_UNSPECIFIED = /\[?::\]?/;
  const IPV6_MAPPED_LOOPBACK = /\[?::ffff:127\./i;
  const IPV6_LINKLOCAL = /\[?fe80:/i;
  const IPV6_UNIQUE_LOCAL = /\[?fc[0-9a-f]{2}:|\[?fd[0-9a-f]{2}:/i;
  const DECIMAL_IP = /^https?:\/\/\d{8,10}(\/|$)/i;
  const USERINFO_BYPASS = /^https?:\/\/[^@]+@/i;

  // Blocca rappresentazioni numeriche alternative localhost (hex/octal/miste)
  // es: 0x7f000001, 0177.0.0.1, 0x7f.0.0.1
  const ALT_LOCALHOST_NUMERIC = /^https?:\/\/(?:0x[0-9a-f]+|0[0-7]+|\d+)(?::\d+)?(?:\/|$)/i;

  if (INTERNAL_IP_PATTERN.test(normalized) ||
    IPV6_LOOPBACK.test(normalized) ||
    IPV6_UNSPECIFIED.test(normalized) ||
    IPV6_MAPPED_LOOPBACK.test(normalized) ||
    IPV6_LINKLOCAL.test(normalized) ||
    IPV6_UNIQUE_LOCAL.test(normalized) ||
    DECIMAL_IP.test(normalized) ||
    ALT_LOCALHOST_NUMERIC.test(normalized) ||
    USERINFO_BYPASS.test(normalized)) {
    console.warn(`🛑 Bloccato tentativo SSRF: ${decoded}`);
    return null;
  }

  // Validazione hostname post-parse per bloccare dotted-quad in notazione esadecimale/ottale
  // es: http://0x7f.0x0.0x0.0x1/
  try {
    const parseHostFromUrl = (value) => {
      if (typeof URL === 'function') {
        return new URL(value).hostname || '';
      }
      const match = value.match(/^https?:\/\/([^\/?#:]+)/i);
      return match ? match[1] : '';
    };

    const host = String(parseHostFromUrl(decoded) || '').toLowerCase();
    const hostNoBrackets = host.replace(/^\[|\]$/g, '');
    const parts = hostNoBrackets.split('.');

    if (parts.length === 4) {
      const parsedOctets = parts.map(part => {
        if (/^0x[0-9a-f]+$/i.test(part)) return parseInt(part, 16);
        if (/^0[0-7]+$/.test(part)) return parseInt(part, 8);
        if (/^\d+$/.test(part)) return parseInt(part, 10);
        return NaN;
      });

      const isNumericHost = parsedOctets.every(v => Number.isInteger(v) && v >= 0 && v <= 255);
      const firstOctet = parsedOctets[0];
      const secondOctet = parsedOctets[1];

      const isLoopback = firstOctet === 127;
      const isPrivate10 = firstOctet === 10;
      const isPrivate172 = firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
      const isPrivate192 = firstOctet === 192 && secondOctet === 168;
      const isLinkLocal = firstOctet === 169 && secondOctet === 254;
      const isZeroNet = firstOctet === 0;
      const isCgnat = firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127;
      const isBenchmarkNet = firstOctet === 198 && (secondOctet === 18 || secondOctet === 19);

      if (isNumericHost && (isLoopback || isPrivate10 || isPrivate172 || isPrivate192 || isLinkLocal || isZeroNet || isCgnat || isBenchmarkNet)) {
        console.warn(`🛑 Bloccato tentativo SSRF hostname numerico: ${decoded}`);
        return null;
      }
    }

    // Blocca IPv4-mapped IPv6 verso reti locali/loopback
    // es: http://[::ffff:127.0.0.1]/, http://[::ffff:7f00:1]/
    const mappedMatch = hostNoBrackets.match(/^::ffff:(.+)$/i);
    if (mappedMatch && mappedMatch[1]) {
      const mapped = mappedMatch[1].replace(/^\[|\]$/g, '');
      let mappedOctets = null;

      if (/^\d+\.\d+\.\d+\.\d+$/.test(mapped)) {
        mappedOctets = mapped.split('.').map(v => parseInt(v, 10));
      } else if (/^[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(mapped)) {
        const [highHex, lowHex] = mapped.split(':');
        const high = parseInt(highHex, 16);
        const low = parseInt(lowHex, 16);
        mappedOctets = [
          (high >> 8) & 0xff,
          high & 0xff,
          (low >> 8) & 0xff,
          low & 0xff
        ];
      }

      if (mappedOctets && mappedOctets.length === 4 && mappedOctets.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) {
        const firstOctet = mappedOctets[0];
        const secondOctet = mappedOctets[1];
        const isLoopback = firstOctet === 127;
        const isPrivate10 = firstOctet === 10;
        const isPrivate172 = firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31;
        const isPrivate192 = firstOctet === 192 && secondOctet === 168;
        const isLinkLocal = firstOctet === 169 && secondOctet === 254;
        const isZeroNet = firstOctet === 0;
        const isCgnat = firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127;
        const isBenchmarkNet = firstOctet === 198 && (secondOctet === 18 || secondOctet === 19);

        if (isLoopback || isPrivate10 || isPrivate172 || isPrivate192 || isLinkLocal || isZeroNet || isCgnat || isBenchmarkNet) {
          console.warn(`🛑 Bloccato tentativo SSRF IPv4-mapped IPv6: ${decoded}`);
          return null;
        }
      }
    }
  } catch (e) {
    console.warn(`⚠️ URL parse fallito, blocco prudenziale: ${decoded}`);
    return null;
  }

  return decoded
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape HTML per prevenire XSS.
 * Applicato PRIMA delle trasformazioni markdown.
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Converte Markdown in HTML sicuro.
 * Strategia: escape-first, poi trasformazioni markdown.
 */
function markdownToHtml(text) {
  if (!text) return '';

  const replaceMarkdownLinks = (input, replacer) => {
    let result = '';
    let cursor = 0;

    while (cursor < input.length) {
      const openBracket = input.indexOf('[', cursor);
      if (openBracket === -1) {
        result += input.slice(cursor);
        break;
      }

      result += input.slice(cursor, openBracket);

      const closeBracket = input.indexOf(']', openBracket + 1);
      if (closeBracket === -1 || input[closeBracket + 1] !== '(') {
        result += input.slice(openBracket, closeBracket === -1 ? input.length : closeBracket + 1);
        cursor = closeBracket === -1 ? input.length : closeBracket + 1;
        continue;
      }

      const linkText = input.slice(openBracket + 1, closeBracket);
      let i = closeBracket + 2;
      let depth = 0;
      let foundClosingParen = false;

      while (i < input.length) {
        const ch = input[i];
        if (ch === '(') {
          depth++;
        } else if (ch === ')') {
          if (depth === 0) {
            foundClosingParen = true;
            break;
          }
          depth--;
        }
        i++;
      }

      if (!foundClosingParen) {
        result += input.slice(openBracket);
        break;
      }

      const url = input.slice(closeBracket + 2, i);
      result += replacer(linkText, url);
      cursor = i + 1;
    }

    return result;
  };

  // 1. Proteggi code blocks (prima dell'escape globale)
  const codeBlocks = [];
  let html = text.replace(/```[\s\S]*?```/g, (match) => {
    const sanitized = escapeHtml(match.replace(/```/g, '').trim());
    const token = `@@CODEBLOCK_PLACEHOLDER_${codeBlocks.length}_${Utilities.getUuid()}@@`;
    codeBlocks.push({ token: token, value: sanitized });
    return token;
  });

  // 2. Proteggi link markdown (prima dell'escape globale)
  const links = [];
  html = replaceMarkdownLinks(html, (linkText, url) => {
    const sanitizedUrl = sanitizeUrl(url);
    const escapedText = escapeHtml(linkText);
    const token = `@@LINK_PLACEHOLDER_${links.length}_${Utilities.getUuid()}@@`;
    if (sanitizedUrl) {
      links.push({ token: token, value: `<a href="${sanitizedUrl}" style="color:#351c75;">${escapedText}</a>` });
    } else {
      console.warn(`⚠️ URL bloccato per sicurezza: ${url}`);
      links.push({ token: token, value: escapedText });
    }
    return token;
  });

  // 3. Escape globale (tutto il testo rimanente diventa sicuro)
  html = escapeHtml(html);

  // 4. Trasformazioni markdown su testo già escaped
  // Headers
  html = html.replace(/^####\s+(.+)$/gm, '<p style="font-size:1em;font-weight:bold;margin:8px 0 4px;">$1</p>');
  html = html.replace(/^###\s+(.+)$/gm, '<p style="font-size:1.15em;font-weight:bold;margin:10px 0 4px;">$1</p>');
  html = html.replace(/^##\s+(.+)$/gm, '<p style="font-size:1.3em;font-weight:bold;margin:12px 0 4px;">$1</p>');
  html = html.replace(/^#\s+(.+)$/gm, '<p style="font-size:1.5em;font-weight:bold;margin:14px 0 6px;">$1</p>');

  // Bold / Italic (asterischi già escaped come testo, usiamo la versione escaped)
  // Nota: gli asterischi NON vengono escaped da escapeHtml(), quindi funzionano normalmente
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '<em>$1</em>');

  // 5. Ripristina link e code blocks
  links.forEach((entry) => {
    html = html.split(entry.token).join(entry.value);
  });

  codeBlocks.forEach((entry) => {
    html = html.split(entry.token).join(
      `<pre style="background:#f4f4f4;padding:10px;border-radius:4px;font-family:monospace;">${entry.value}</pre>`
    );
  });

  // 6. Liste markdown (bullet) -> <ul><li>
  html = html.replace(/^[•\-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(?:<li>.*?<\/li>\s*)+/gs, (block) => {
    const cleaned = block.replace(/\n+/g, '');
    return `<ul style="margin:8px 0;padding-left:20px;">${cleaned}</ul>`;
  });

  // 7. Paragraphs e line breaks
  html = html.replace(/\n\n+/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  // 8. Emoji to HTML entities
  html = Array.from(html).map(char => {
    const codePoint = char.codePointAt(0);
    if (codePoint > 0xFFFF) {
      return '&#' + codePoint + ';';
    }
    return char;
  }).join('');

  return `
    <div style="
      font-family: Arial, Helvetica, sans-serif;
      font-size: 20px;
      color: #351c75;
      line-height: 1.6;
    ">
      <p>${html}</p>
    </div>
  `;
}