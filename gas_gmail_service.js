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

    // Cache etichette per evitare chiamate API ripetute
    this._labelCache = new Map();
    this._cacheTTL = (typeof CONFIG !== 'undefined' && CONFIG.GMAIL_LABEL_CACHE_TTL) ? CONFIG.GMAIL_LABEL_CACHE_TTL : 3600000;

    console.log('✓ GmailService inizializzato con cache etichette (TTL 1h)');
  }

  // ========================================================================
  // GESTIONE ETICHETTE (con cache)
  // ========================================================================

  /**
   * Ottiene o crea un'etichetta Gmail con caching
   */
  getOrCreateLabel(labelName) {
    const cachedEntry = this._labelCache.get(labelName);
    const now = Date.now();
    if (cachedEntry && (now - cachedEntry.ts) < this._cacheTTL) {
      console.log(`📦 Label '${labelName}' trovata in cache`);
      return cachedEntry.label;
    } else if (cachedEntry) {
      this._labelCache.delete(labelName);
    }

    const labels = GmailApp.getUserLabels();
    for (const label of labels) {
      if (label.getName() === labelName) {
        this._labelCache.set(labelName, { label: label, ts: now });
        console.log(`✓ Label '${labelName}' trovata`);
        return label;
      }
    }

    const newLabel = GmailApp.createLabel(labelName);
    this._labelCache.set(labelName, { label: newLabel, ts: now });
    console.log(`✓ Creata nuova label: ${labelName}`);
    return newLabel;
  }

  clearLabelCache() {
    this._labelCache.clear();
    console.log('🗑️ Cache label svuotata');
  }

  addLabelToThread(thread, labelName) {
    const label = this.getOrCreateLabel(labelName);
    thread.addLabel(label);
    console.log(`✓ Aggiunta label '${labelName}' al thread`);
  }

  /**
   * Aggiunge etichetta a un messaggio specifico (Gmail API avanzata)
   */
  addLabelToMessage(messageId, labelName) {
    const label = this.getOrCreateLabel(labelName);
    const labelId = label.getId();
    try {
      Gmail.Users.Messages.modify({
        addLabelIds: [labelId],
        removeLabelIds: []
      }, 'me', messageId);
      console.log(`✓ Aggiunta label '${labelName}' al messaggio ${messageId}`);
    } catch (e) {
      console.warn(`⚠️ addLabelToMessage fallito per messaggio ${messageId}: ${e.message}`);
    }
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

    // Estrai RFC 2822 Message-ID per header In-Reply-To
    let rfc2822MessageId = null;
    let existingReferences = null;
    try {
      const rawMessage = Gmail.Users.Messages.get('me', messageId, { format: 'metadata', metadataHeaders: ['Message-ID', 'References'] });
      if (rawMessage && rawMessage.payload && rawMessage.payload.headers) {
        for (const header of rawMessage.payload.headers) {
          if (header.name === 'Message-ID' || header.name === 'Message-Id') {
            rfc2822MessageId = header.value;
          }
          if (header.name === 'References') {
            existingReferences = header.value;
          }
        }
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
      recipientEmail: recipientEmail
    };
  }

  _extractSenderName(fromField) {
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

    const emailMatch = fromField.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
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
      const match = content.search(marker);
      if (match !== -1) {
        result = content.substring(0, match);
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
    const plainText = this._stripHtmlTags(finalResponse);

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

        const fromEmail = messageDetails.recipientEmail || Session.getActiveUser().getEmail();

        const boundary = 'boundary_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
        const rawMessage = [
          'MIME-Version: 1.0',
          `From: ${fromEmail}`,
          `To: ${messageDetails.senderEmail}`,
          `Subject: =?UTF-8?B?${Utilities.base64Encode(replySubject, Utilities.Charset.UTF_8)}?=`,
          `In-Reply-To: ${messageDetails.rfc2822MessageId}`,
          `References: ${referencesHeader}`,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
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
        console.warn(`⚠️ Gmail API fallita, fallback a GmailApp: ${apiError.message}`);
      }
    }

    // Fallback: metodo tradizionale
    const mailEntity = typeof resource === 'string'
      ? GmailApp.getThreadById(resource)
      : resource;

    try {
      mailEntity.reply('', { htmlBody: htmlBody });
      console.log(`✓ Risposta HTML inviata a ${messageDetails.senderEmail} (metodo fallback)`);
    } catch (error) {
      console.error(`❌ Risposta fallita: ${error.message}`);
      try {
        mailEntity.reply(finalResponse);
        console.log(`✓ Risposta plain text inviata a ${messageDetails.senderEmail} (fallback)`);
      } catch (fallbackError) {
        console.error(`❌ CRITICO: Fallback risposta fallito: ${fallbackError.message}`);
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
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/#{1,4}\s+/g, '')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1');
  }

  // ========================================================================
  // SAFEGUARD DI FORMATTAZIONE
  // ========================================================================

  /**
   * Corregge errori comuni di punteggiatura
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

      if (afterMatch.match(/^\s*[,.]/) ||
        afterMatch.match(/^\s+e\s+[A-ZÀÈÉÌÒÙ][a-zàèéìòù]*\s*[,.]/)) {
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
}

// Funzione factory
function createGmailService() {
  return new GmailService();
}

// ====================================================================
// MARKDOWN → HTML
// ====================================================================

function markdownToHtml(text) {
  if (!text) return '';

  let html = text;

  // Proteggi code blocks
  const codeBlocks = [];
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODEBLOCK_${codeBlocks.length - 1}__`;
  });

  // Links con sanitizzazione
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, (match, linkText, url) => {
    const escapedText = linkText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const escapedUrl = url
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    let decodedUrl = escapedUrl;
    try {
      decodedUrl = decodeURIComponent(escapedUrl);
    } catch (e) { }
    decodedUrl = decodedUrl.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

    // Protezione SSRF
    const INTERNAL_IP_PATTERN = /^(https?:\/\/)?(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/i;

    if (INTERNAL_IP_PATTERN.test(decodedUrl)) {
      console.warn(`🛑 Bloccato tentativo SSRF: ${escapedUrl}`);
      return escapedText;
    }

    const isDangerous = /^\s*(javascript|vbscript|data|file):/i.test(decodedUrl);
    const isSafeProtocol = /^\s*(https?|mailto):/i.test(decodedUrl);

    if (isDangerous || !isSafeProtocol) {
      console.warn(`⚠️ Bloccato URL sospetto: ${escapedUrl}`);
      return escapedText;
    }

    return `<a href="${escapedUrl}" style="color:#351c75;">${escapedText}</a>`;
  });

  // Headers
  html = html.replace(/^####\s+(.+)$/gm, '<p style="font-size:14px;font-weight:bold;">$1</p>');
  html = html.replace(/^###\s+(.+)$/gm, '<p style="font-size:16px;font-weight:bold;">$1</p>');
  html = html.replace(/^##\s+(.+)$/gm, '<p style="font-size:18px;font-weight:bold;">$1</p>');
  html = html.replace(/^#\s+(.+)$/gm, '<p style="font-size:20px;font-weight:bold;">$1</p>');

  // Bold / Italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '<em>$1</em>');

  // Escape testo
  html = html.replace(/>[^<]+</g, (match) => {
    return match.slice(0, 1) +
      match.slice(1, -1)
        .replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g, '&amp;')
        .replace(/<(?![^>]*>)/g, '&lt;')
        .replace(/(?<![^<]*)>/g, '&gt;') +
      match.slice(-1);
  });

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    const code = block.replace(/```/g, '').trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    html = html.replace(
      `__CODEBLOCK_${i}__`,
      `<pre style="background:#f4f4f4;padding:10px;border-radius:4px;font-family:monospace;">${code}</pre>`
    );
  });

  // Paragraphs e line breaks
  html = html.replace(/\n\n+/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  // Emoji to HTML entities
  html = Array.from(html).map(char => {
    const codePoint = char.codePointAt(0);
    if (codePoint > 0x7F) {
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