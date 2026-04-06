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
        // CacheService.put accetta al massimo 21600 s (6 ore); valori superiori causano
        // un'eccezione silenziosa o un fallimento dell'operazione di put.
        this._cacheTtlSeconds = Math.min(21600, Math.max(60, Math.floor(this._cacheTTL / 1000)));
        this._scriptCache = CacheService.getScriptCache();

        // Mappa MIME types Office → tipo Google Workspace per conversione nativa
        this._officeMimeMap = {
            // Word → Google Docs
            'application/msword': 'application/vnd.google-apps.document',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
            // Excel → Google Sheets
            'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
            // PowerPoint → Google Slides
            'application/vnd.ms-powerpoint': 'application/vnd.google-apps.presentation',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation'
        };

        console.log('✓ GmailService inizializzato con cache etichette (TTL 1h)');
    }

    // ========================================================================
    // GESTIONE ETICHETTE (con cache)
    // ========================================================================

    /**
     * Ottiene o crea un'etichetta Gmail con caching
     * Nota: la creazione automatica è intenzionale (self-healing al primo avvio)
     * per evitare errori "label not found" in ambienti nuovi.
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

        let newLabel;
        try {
            newLabel = GmailApp.createLabel(labelName);
        } catch (e) {
            // Possibile race condition: un'altra esecuzione parallela ha creato la label
            // dopo il nostro check ma prima della createLabel().
            const existingLabel = GmailApp.getUserLabelByName(labelName);
            if (existingLabel) {
                this._labelCache.set(labelName, { label: existingLabel, ts: now });
                this._scriptCache.put(cacheKey, '1', this._cacheTtlSeconds);
                console.log(`✓ Label '${labelName}' recuperata dopo collisione di creazione`);
                return existingLabel;
            }
            throw e;
        }

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



    _getMessageMetadataWithResilience(messageId, params, maxAttempts = 2) {
        const safeAttempts = this._safePositiveInt(maxAttempts, 2, 1, 5);
        let lastError = null;

        for (let attempt = 1; attempt <= safeAttempts; attempt++) {
            try {
                const response = Gmail.Users.Messages.get('me', messageId, params);
                if (response === null || typeof response === 'undefined') {
                    throw new Error('Empty response');
                }
                return response;
            } catch (error) {
                lastError = error;
                const isEmptyResponse = this._isEmptyResponseError(error);
                const isRetryableError = this._isRetryableGmailApiError(error);
                const hasRetryBudget = attempt < safeAttempts;

                if (!isEmptyResponse && !isRetryableError) {
                    throw error;
                }

                const reason = isEmptyResponse ? 'risposta vuota' : `errore transiente: ${error.message}`;
                console.warn(`⚠️ Gmail.Users.Messages.get ${reason} per msg ${messageId} (tentativo ${attempt}/${safeAttempts})`);
                if (hasRetryBudget) {
                    Utilities.sleep(250 * attempt * attempt);
                    continue;
                }
            }
        }

        console.warn(`⚠️ Gmail.Users.Messages.get non recuperabile per msg ${messageId}: skip del messaggio (${lastError ? lastError.message : 'errore sconosciuto'})`);
        return null;
    }

    _listMessagesWithResilience(params, maxAttempts = 2) {
        const safeAttempts = this._safePositiveInt(maxAttempts, 2, 1, 5);
        let lastError = null;

        for (let attempt = 1; attempt <= safeAttempts; attempt++) {
            try {
                const response = Gmail.Users.Messages.list('me', params);
                if (response === null || typeof response === 'undefined') {
                    throw new Error('Empty response');
                }
                return response;
            } catch (error) {
                lastError = error;
                const isEmptyResponse = this._isEmptyResponseError(error);
                const isRetryableError = this._isRetryableGmailApiError(error);
                const hasRetryBudget = attempt < safeAttempts;

                if (!isEmptyResponse && !isRetryableError) {
                    throw error;
                }

                const reason = isEmptyResponse ? 'risposta vuota' : `errore transiente: ${error.message}`;
                console.warn(`⚠️ Gmail.Users.Messages.list ${reason} (tentativo ${attempt}/${safeAttempts})`);
                if (hasRetryBudget) {
                    Utilities.sleep(300 * attempt * attempt);
                    continue;
                }
            }
        }

        console.warn(`⚠️ Gmail.Users.Messages.list non recuperabile (${lastError ? lastError.message : 'errore sconosciuto'}): tratto la pagina come vuota per non interrompere il batch`);
        return { messages: [], nextPageToken: null };
    }

    _isEmptyResponseError(error) {
        const message = (error && error.message) ? String(error.message).toLowerCase() : '';
        return message.includes('empty response') || message.includes('risposta vuota');
    }

    _isRetryableGmailApiError(error) {
        const message = (error && error.message) ? String(error.message).toLowerCase() : '';
        if (!message) return false;

        return message.includes('unknown error')
            || message.includes('internal error')
            || message.includes('backend error')
            || message.includes('service unavailable')
            || message.includes('timed out')
            || message.includes('timeout')
            || message.includes('rate limit')
            || message.includes('user-rate limit')
            || message.includes('quota exceeded')
            || message.includes('too many requests')
            || message.includes('429')
            || message.includes('500')
            || message.includes('502')
            || message.includes('503')
            || message.includes('504');
    }

    /**
     * Ottiene gli ID di tutti i messaggi con una specifica etichetta
     */
    getMessageIdsWithLabel(labelName, onlyInbox = true, options = {}) {
        try {
            const label = this.getOrCreateLabel(labelName);
            const labelId = label.getId();

            const messageIds = new Set();
            let pageToken;

            const safeWindowDays = parseInt(options.windowDays, 10);
            const useWindowDays = Number.isFinite(safeWindowDays) && safeWindowDays > 0
                ? safeWindowDays
                : ((typeof CONFIG !== 'undefined' && CONFIG.GMAIL_LABEL_LOOKBACK_DAYS) || 0);
            const maxPages = this._safePositiveInt(
                options.maxPages,
                ((typeof CONFIG !== 'undefined' && CONFIG.GMAIL_LIST_MAX_PAGES) || 20),
                1
            );
            const maxMessages = this._safePositiveInt(
                options.maxMessages,
                ((typeof CONFIG !== 'undefined' && CONFIG.GMAIL_LIST_MAX_MESSAGES) || 5000),
                1
            );
            const pageSize = this._safePositiveInt(options.pageSize, 500, 50, 500);

            // Query composita: inbox opzionale + finestra temporale opzionale
            const queryParts = [];
            if (onlyInbox) queryParts.push('in:inbox');
            if (useWindowDays > 0) queryParts.push(`after:${this._getNDaysAgo(useWindowDays)}`);
            const query = queryParts.join(' ').trim();
            let pageCount = 0;

            do {
                if (pageCount >= maxPages || messageIds.size >= maxMessages) {
                    console.warn(`⚠️ Interruzione list label '${labelName}': limite raggiunto (pages=${pageCount}/${maxPages}, messages=${messageIds.size}/${maxMessages})`);
                    break;
                }

                const response = this._listMessagesWithResilience({
                    labelIds: [labelId],
                    q: query,
                    maxResults: pageSize,
                    pageToken: pageToken
                });
                pageCount++;

                if (response.messages) {
                    for (const m of response.messages) {
                        messageIds.add(m.id);
                        if (messageIds.size >= maxMessages) {
                            break;
                        }
                    }
                }

                pageToken = response.nextPageToken;
            } while (pageToken);

            console.log(`📦 Trovati ${messageIds.size} messaggi con label '${labelName}' (inbox: ${onlyInbox}, windowDays: ${useWindowDays || 'all'}, pages: ${pageCount})`);
            return messageIds;
        } catch (e) {
            console.warn(`⚠️ Impossibile ottenere messaggi con label ${labelName}: ${e.message}`);
            throw e;
        }
    }

    /**
     * Recupera i thread con almeno un messaggio non letto e non ancora etichettato.
     *
     * Modalità supportate:
     * - 'query'   : default operativo, più economica e coerente con la label a livello messaggio
     * - 'metadata': fallback prudente/manuale (list INBOX/UNREAD + get minimal per labelIds)
     *
     * @param {string} labelName            - Label applicata ai messaggi già elaborati (es. 'IA')
     * @param {string} errorLabel           - Label dei thread in errore (es. 'Errore')
     * @param {string} validationLabel      - Label dei thread in attesa di verifica (es. 'Verifica')
     * @param {number} [messageBuffer=150]  - Numero massimo di messaggi da esaminare per pagina
     * @param {number} [targetThreads=50]   - Numero di thread unici da raccogliere prima di fermarsi
     * @param {number} [maxPages=3]         - Limite pagine di paginazione per evitare loop
     * @returns {GmailThread[]}             - Thread unici, già istanziati, con almeno un messaggio da elaborare
     */
    getUnprocessedUnreadThreads(labelName, errorLabel, validationLabel, messageBuffer = 150, targetThreads = 50, maxPages = 3) {
        const mode = (typeof CONFIG !== 'undefined' && CONFIG.MESSAGE_DISCOVERY_MODE)
            ? CONFIG.MESSAGE_DISCOVERY_MODE
            : 'query';

        const safeMessageBuffer = this._safePositiveInt(messageBuffer, 150, 1, 500);
        const safeTargetThreads = this._safePositiveInt(targetThreads, 50, 1);
        const safeMaxPages = this._safePositiveInt(maxPages, 3, 1);

        if (mode === 'metadata') {
            return this._discoverByMetadata(
                labelName,
                errorLabel,
                validationLabel,
                safeMessageBuffer,
                safeTargetThreads,
                safeMaxPages
            ).threads;
        }

        return this._discoverByQuery(
            labelName,
            errorLabel,
            validationLabel,
            safeMessageBuffer,
            safeTargetThreads,
            safeMaxPages
        ).threads;
    }

    /**
     * Fallback prudente/manuale che verifica le label sul singolo messaggio via metadata.
     */
    _discoverByMetadata(labelName, errorLabel, validationLabel, safeMessageBuffer, safeTargetThreads, safeMaxPages) {
        const processedLabelId = this._getOptionalLabelIdByName(labelName);
        const errorLabelId = this._getOptionalLabelIdByName(errorLabel);
        const validationLabelId = this._getOptionalLabelIdByName(validationLabel);
        const excludedLabelIds = new Set([processedLabelId, errorLabelId, validationLabelId].filter(Boolean));

        const seenThreadIds = new Set();
        const unavailableThreadIds = new Set();
        const seenMessageIds = new Set();
        const threads = [];
        let pageToken;
        let page = 0;

        try {
            do {
                if (page >= safeMaxPages || seenThreadIds.size >= safeTargetThreads) break;

                const params = { labelIds: ['INBOX', 'UNREAD'], maxResults: safeMessageBuffer };
                if (pageToken) params.pageToken = pageToken;

                const response = this._listMessagesWithResilience(params);
                page++;

                const messages = (response && response.messages) || [];
                let addedInPage = 0;
                console.log(`📬 [metadata] Pagina ${page}: ${messages.length} messaggi candidati INBOX/UNREAD`);

                for (const msg of messages) {
                    if (!msg || !msg.id || !msg.threadId || seenThreadIds.has(msg.threadId) || unavailableThreadIds.has(msg.threadId)) continue;

                    const metadata = this._getMessageMetadataWithResilience(msg.id, { format: 'minimal' });
                    if (!metadata) {
                        console.warn(`⚠️ Gmail.Users.Messages.get risposta vuota per msg ${msg.id}: skip`);
                        continue;
                    }

                    const msgLabelIds = new Set(metadata.labelIds || []);
                    const isExcluded = [...excludedLabelIds].some(id => msgLabelIds.has(id));
                    if (isExcluded) continue;

                    let thread = null;
                    try {
                        thread = GmailApp.getThreadById(msg.threadId);
                    } catch (error) {
                        console.warn(`⚠️ Errore recupero thread ${msg.threadId}: ${error.message}`);
                    }
                    if (!thread) {
                        unavailableThreadIds.add(msg.threadId);
                        console.warn(`⚠️ GmailApp.getThreadById(${msg.threadId}) restituisce null o errore: thread ignorato`);
                        continue;
                    }

                    seenThreadIds.add(msg.threadId);
                    seenMessageIds.add(msg.id);
                    threads.push(thread);
                    addedInPage++;
                    if (seenThreadIds.size >= safeTargetThreads) break;
                }

                console.log(`📬 [metadata] Pagina ${page}: ${addedInPage} thread aggiunto/i dopo filtro label`);
                pageToken = response ? response.nextPageToken : null;
            } while (pageToken);

            console.log(`📬 [metadata] Trovati ${threads.length} thread da elaborare (${page} pagina/e)`);
            return {
                threads: threads,
                threadIds: seenThreadIds,
                messageIds: seenMessageIds
            };
        } catch (e) {
            console.error(`❌ _discoverByMetadata fallito: ${e.message}`);
            throw e;
        }
    }

    /**
     * Default operativo: variante più economica che usa la query testuale di Gmail.
     */
    _discoverByQuery(labelName, errorLabel, validationLabel, safeMessageBuffer, safeTargetThreads, safeMaxPages) {
        const lq = this._formatLabelQueryValue(labelName);
        const eq = this._formatLabelQueryValue(errorLabel);
        const vq = this._formatLabelQueryValue(validationLabel);
        const query = `is:unread -label:${lq} -label:${eq} -label:${vq} in:inbox`;

        const seenThreadIds = new Set();
        const unavailableThreadIds = new Set();
        const seenMessageIds = new Set();
        const threads = [];
        let pageToken;
        let page = 0;

        try {
            do {
                if (page >= safeMaxPages || seenThreadIds.size >= safeTargetThreads) break;

                const params = { q: query, maxResults: safeMessageBuffer };
                if (pageToken) params.pageToken = pageToken;

                const response = this._listMessagesWithResilience(params);
                page++;

                const messages = (response && response.messages) || [];
                console.log(`📬 [query] Pagina ${page}: ${messages.length} messaggi trovati`);

                for (const msg of messages) {
                    if (!msg || !msg.id || !msg.threadId || seenThreadIds.has(msg.threadId) || unavailableThreadIds.has(msg.threadId)) continue;
                    let thread = null;
                    try {
                        thread = GmailApp.getThreadById(msg.threadId);
                    } catch (error) {
                        console.warn(`⚠️ Errore recupero thread ${msg.threadId}: ${error.message}`);
                    }
                    if (!thread) {
                        unavailableThreadIds.add(msg.threadId);
                        console.warn(`⚠️ GmailApp.getThreadById(${msg.threadId}) restituisce null o errore: thread ignorato`);
                        continue;
                    }

                    seenThreadIds.add(msg.threadId);
                    seenMessageIds.add(msg.id);
                    threads.push(thread);
                    if (seenThreadIds.size >= safeTargetThreads) break;
                }

                pageToken = response ? response.nextPageToken : null;
            } while (pageToken);

            console.log(`📬 [query] Trovati ${threads.length} thread da elaborare (${page} pagina/e)`);
            return {
                threads: threads,
                threadIds: seenThreadIds,
                messageIds: seenMessageIds
            };
        } catch (e) {
            console.error(`❌ _discoverByQuery fallito: ${e.message}`);
            throw e;
        }
    }



    _formatLabelQueryValue(labelName) {
        const raw = String(labelName || '').trim();
        if (!raw) return '""';

        // Gmail label names non supportano virgolette letterali: normalizziamo eventuali input
        // anomali invece di iniettare escape nella query, che Gmail non interpreta come JavaScript.
        const normalized = raw.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
        return `"${normalized || raw}"`;
    }

    _getOptionalLabelIdByName(labelName) {
        const raw = String(labelName || '').trim();
        if (!raw) return null;

        const cachedEntry = this._labelCache.get(raw);
        const now = Date.now();
        if (cachedEntry && (now - cachedEntry.ts) < this._cacheTTL) {
            return cachedEntry.label ? cachedEntry.label.getId() : null;
        }

        const label = GmailApp.getUserLabelByName(raw);
        if (!label) {
            return null;
        }

        this._labelCache.set(raw, { label: label, ts: now });
        return label.getId();
    }


    _safePositiveInt(value, fallback, min, max = null) {
        const parsed = parseInt(value, 10);
        const fallbackParsed = parseInt(fallback, 10);
        let safe = Number.isFinite(parsed) ? parsed : (Number.isFinite(fallbackParsed) ? fallbackParsed : min);

        safe = Math.max(min, safe);
        if (max !== null) {
            safe = Math.min(max, safe);
        }

        return safe;
    }

    _getNDaysAgo(n) {
        const days = Math.max(0, parseInt(n, 10) || 0);
        const d = new Date();
        d.setDate(d.getDate() - days);
        return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy/MM/dd');
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
        let body = message.getPlainBody() || this._htmlToPlainText(message.getBody());
        body = this.extractMainReply(body);
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
            if (
                headers['list-unsubscribe'] ||
                /bulk|list/i.test(headers['precedence'] || '') ||
                /auto-generated|auto-replied/i.test(headers['auto-submitted'] || '')
            ) {
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
            const effectiveUser = Session.getEffectiveUser();
            recipientEmail = effectiveUser ? effectiveUser.getEmail() : '';
            if (!recipientEmail) {
                // Nota: Session.getActiveUser() in questo contesto GAS potrebbe restituire stringa vuota 
                // se non ci sono permessi specifici o se è un trigger.
                const activeUser = Session.getActiveUser();
                recipientEmail = activeUser ? activeUser.getEmail() : '';
            }
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
    // ALLEGATI: ESTRAZIONE TESTO (OCR PDF/immagini, conversione Office)
    // ========================================================================

    /**
     * Estrae testo dagli allegati per contesto prompt.
     * Supporta PDF/immagini (via OCR), Word, Excel e PowerPoint (via conversione nativa).
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
            maxFiles: 3,
            maxBytesPerFile: 3 * 1024 * 1024,
            maxCharsPerFile: 3000,
            maxTotalChars: 9000,
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

        this._cleanupOrphanedOcrFilesIfNeeded();

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

            const rawContentType = (attachment.getContentType() || '').toLowerCase();
            const contentType = rawContentType.split(';')[0].trim();
            const isPdf = contentType.includes('pdf');
            const isImage = contentType.startsWith('image/');
            const isOffice = Boolean(this._officeMimeMap[contentType]);

            if (!isPdf && !isImage && !isOffice) {
                skipped.push({ name: attachmentName, reason: 'unsupported_type', contentType: contentType });
                continue;
            }


            let size = attachment.getSize ? attachment.getSize() : 0;
            let isImageAttachment = contentType.startsWith('image/');
            const maxAllowedSize = isImageAttachment ? (2 * 1024 * 1024) : settings.maxBytesPerFile;

            if (size > maxAllowedSize) {
                skipped.push({ name: attachmentName, reason: 'too_large_for_ocr', size: size, limit: maxAllowedSize });
                continue;
            }

            // Check Nome File Generico (Segnale Debole)
            const fileNameLower = attachmentName.toLowerCase();
            const suspiciousNames = ["img_", "dsc_", "photo", "whatsapp image", "image", "screenshot"];
            const isGenericName = suspiciousNames.some(name => fileNameLower.includes(name));

            // Estrazione testo: conversione diretta per Office, OCR per PDF/immagini
            let ocrText, ocrConfidence;
            if (isOffice) {
                ocrText = this._extractOfficeText(attachment, this._officeMimeMap[contentType], settings);
                ocrConfidence = ocrText ? 1.0 : 0; // Conversione diretta, non ottica
                if (!ocrText || ocrText.replace(/\s+/g, ' ').trim().length < 30) {
                    skipped.push({ name: attachmentName, reason: 'office_empty', ocrConfidence: 0 });
                    continue;
                }
            } else {
                ocrText = this._extractOcrTextFromAttachment(attachment, settings);
                ocrConfidence = this._estimateOcrConfidence(ocrText, isGenericName);
                // Filtro qualità OCR (solo per PDF/immagini)
                if (!this._isMeaningfulOCR(ocrText, isGenericName)) {
                    skipped.push({ name: attachmentName, reason: 'ocr_quality_low', ocrConfidence: ocrConfidence });
                    continue;
                }
            }

            let normalized = this._normalizeAttachmentText(ocrText, settings);
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

    // ========================================================================
    // ALLEGATI: GESTIONE MULTIMODALE (Gemini Vision)
    // ========================================================================

    /**
     * Estrae gli allegati processabili in modalità multimodale.
     * - TXT/CSV: estratti come testo di contesto
     * - PDF/Immagini: passati come Blob
     * - DOC/DOCX/PPT/PPTX: convertiti al volo in PDF
     * @param {GmailMessage} message
     * @param {object} options
     * @returns {{textContext: string, blobs: Array<Blob>, skipped: Array}}
     */
    getProcessableAttachments(message, options = {}) {
        const defaults = (typeof CONFIG !== 'undefined' && CONFIG.ATTACHMENT_CONTEXT)
            ? CONFIG.ATTACHMENT_CONTEXT
            : {};
        const settings = Object.assign({
            maxFiles: 3,
            maxBytesPerFile: 3 * 1024 * 1024
        }, defaults, options);

        const result = {
            textContext: '',
            blobs: [],
            skipped: []
        };
        const maxFiles = Math.max(1, parseInt(settings.maxFiles, 10) || 3);
        const maxCharsPerFile = Math.max(0, parseInt(settings.maxCharsPerFile, 10) || 3000);
        const maxTotalChars = Math.max(0, parseInt(settings.maxTotalChars, 10) || 9000);
        let processedCount = 0;
        let totalTextChars = 0;

        let attachments = [];
        try {
            attachments = message.getAttachments({ includeInlineImages: true, includeAttachments: true }) || [];
        } catch (e) {
            console.warn(`⚠️ Impossibile leggere allegati: ${e.message}`);
            result.skipped.push({ reason: 'read_error', error: e.message });
            return result;
        }

        for (const attachment of attachments) {
            const name = attachment.getName ? (attachment.getName() || 'allegato') : 'allegato';

            if (processedCount >= maxFiles) {
                result.skipped.push({ name: name, reason: 'max_files' });
                continue;
            }

            const size = attachment.getSize ? attachment.getSize() : 0;
            if (size > settings.maxBytesPerFile) {
                result.skipped.push({ name: name, reason: 'too_large', size: size });
                continue;
            }

            const rawMimeType = (attachment.getContentType() || '').toLowerCase();
            const mimeType = rawMimeType.split(';')[0].trim();

            if (mimeType.includes('text/plain') || mimeType.includes('text/csv')) {
                try {
                    const rawText = attachment.getDataAsString() || '';
                    let text = rawText;
                    if (maxCharsPerFile > 0 && text.length > maxCharsPerFile) {
                        text = text.substring(0, maxCharsPerFile);
                        result.skipped.push({ name: name, reason: 'text_truncated', kept: text.length, originalSize: rawText.length });
                    }
                    const segment = `\n\n--- Contenuto file: ${name} ---\n${text}`;
                    if (maxTotalChars > 0) {
                        const remaining = maxTotalChars - totalTextChars;
                        if (remaining <= 0) {
                            result.skipped.push({ name: name, reason: 'max_total_chars' });
                            continue;
                        }
                        const bounded = segment.length > remaining ? segment.substring(0, remaining) : segment;
                        if (bounded.length < segment.length) {
                            result.skipped.push({ name: name, reason: 'max_total_chars', kept: bounded.length });
                        }
                        result.textContext += bounded;
                        totalTextChars += bounded.length;
                    } else {
                        result.textContext += segment;
                        totalTextChars += segment.length;
                    }
                    processedCount++;
                } catch (e) {
                    result.skipped.push({ name: name, reason: 'text_extract_error', error: e.message });
                }
                continue;
            }

            if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
                result.blobs.push(attachment.copyBlob());
                processedCount++;
                continue;
            }

            const isWord = mimeType.includes('msword') || mimeType.includes('wordprocessingml');
            const isExcel = mimeType.includes('ms-excel') || mimeType.includes('spreadsheetml');
            const isPowerPoint =
                mimeType.includes('ms-powerpoint') ||
                mimeType.includes('mspowerpoint') ||
                mimeType.includes('presentationml');

            if (isExcel) {
                try {
                    const rawText = this._extractOfficeText(attachment, this._officeMimeMap[mimeType], settings) || '';
                    if (!rawText.trim()) {
                        result.skipped.push({ name: name, reason: 'office_empty' });
                        continue;
                    }
                    const text = rawText.substring(0, maxCharsPerFile);
                    const segment = `\n\n--- Contenuto file: ${name} ---\n${text}`;
                    if (maxTotalChars > 0) {
                        const remaining = maxTotalChars - totalTextChars;
                        if (remaining <= 0) {
                            result.skipped.push({ name: name, reason: 'max_total_chars' });
                            continue;
                        }
                        const bounded = segment.length > remaining ? segment.substring(0, remaining) : segment;
                        if (bounded.length < segment.length) {
                            result.skipped.push({ name: name, reason: 'max_total_chars', kept: bounded.length });
                        }
                        result.textContext += bounded;
                        totalTextChars += bounded.length;
                    } else {
                        result.textContext += segment;
                        totalTextChars += segment.length;
                    }
                    processedCount++;
                } catch (e) {
                    result.skipped.push({ name: name, reason: 'text_extract_error', error: e.message });
                }
                continue;
            }

            if (isWord || isPowerPoint) {
                try {
                    console.log(`   🔄 Conversione al volo in PDF per: ${name}`);
                    const convertedPdf = this._convertOfficeToPdf(attachment);
                    if (convertedPdf) {
                        convertedPdf.setName(`${name}.pdf`);
                        result.blobs.push(convertedPdf);
                        processedCount++;
                    } else {
                        result.skipped.push({ name: name, reason: 'conversion_failed' });
                    }
                } catch (e) {
                    console.warn(`   ⚠️ Errore conversione per ${name}: ${e.message}`);
                    result.skipped.push({ name: name, reason: 'conversion_error', error: e.message });
                }
                continue;
            }

            result.skipped.push({ name: name, reason: 'unsupported_type', mimeType: mimeType });
        }

        return result;
    }

    /**
     * Converte un file Office in PDF usando Drive Advanced Service.
     * Crea un file temporaneo, lo esporta in PDF e lo cancella sempre.
     * @param {Blob} attachmentBlob
     * @returns {Blob}
     */
    _convertOfficeToPdf(attachmentBlob) {
        if (typeof Drive === 'undefined' || !Drive.Files) {
            throw new Error('Drive Advanced Service non abilitato. Attivare il servizio Drive nel progetto Apps Script.');
        }

        let fileId = null;
        try {
            // getContentType() può includere parametri (es. "; charset=UTF-8"):
            // per la lookup in _officeMimeMap usiamo il mime base normalizzato.
            const originalMimeFull = attachmentBlob.getContentType() || '';
            const originalMime = originalMimeFull.split(';')[0].trim().toLowerCase();
            const googleMime = (this._officeMimeMap && this._officeMimeMap[originalMime]) ? this._officeMimeMap[originalMime] : null;

            if (typeof Drive.Files.insert === 'function') {
                const resource = {
                    title: `TEMP_CONV_${attachmentBlob.getName() || 'allegato'}`,
                    mimeType: originalMime
                };

                const file = Drive.Files.insert(resource, attachmentBlob.copyBlob(), { convert: true });
                fileId = file && file.id ? file.id : null;
                if (!fileId) {
                    throw new Error('Conversione fallita: file temporaneo senza id.');
                }
            } else if (typeof Drive.Files.create === 'function') {
                if (!googleMime) {
                    throw new Error(`Conversione fallita: mimeType Office non supportato (${originalMime})`);
                }
                const resource = {
                    name: `TEMP_CONV_${attachmentBlob.getName() || 'allegato'}`,
                    mimeType: googleMime
                };
                const file = Drive.Files.create(resource, attachmentBlob.copyBlob(), { mimeType: googleMime });
                fileId = file && file.id ? file.id : null;
                if (!fileId) {
                    throw new Error('Conversione fallita: file temporaneo senza id.');
                }
                if (file.mimeType && file.mimeType !== googleMime) {
                    throw new Error(`Conversione Office non applicata (mimeType=${file.mimeType})`);
                }
            } else {
                throw new Error('Drive.Files non espone metodi compatibili (insert/create)');
            }

            // La conversione lato Drive può essere asincrona su file Office grandi.
            // Usiamo retry breve con backoff lineare per evitare PDF vuoti/corrotti.
            let pdfBlob = null;
            let lastError = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const candidateBlob = DriveApp.getFileById(fileId).getAs('application/pdf');
                    if (candidateBlob && typeof candidateBlob.getBytes === 'function' && candidateBlob.getBytes().length > 0) {
                        pdfBlob = candidateBlob;
                        break;
                    }
                    lastError = new Error('Blob PDF vuoto dopo conversione Office');
                } catch (e) {
                    lastError = e;
                }

                if (attempt < 2) {
                    Utilities.sleep(1000 * (attempt + 1));
                }
            }

            if (!pdfBlob) {
                throw lastError || new Error('Conversione Office->PDF fallita');
            }

            return pdfBlob;
        } finally {
            if (fileId) {
                try {
                    if (typeof Drive.Files.remove === 'function') {
                        Drive.Files.remove(fileId);
                    } else if (typeof Drive.Files.delete === 'function') {
                        Drive.Files.delete(fileId);
                    }
                } catch (e) {
                    console.warn(`⚠️ Errore cancellazione file temporaneo ${fileId}: ${e.message}`);
                }
            }
        }
    }



    _cleanupOrphanedOcrFilesIfNeeded() {
        try {
            const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
                ? CacheService.getScriptCache()
                : null;


            const throttleKey = 'OCR_ORPHAN_CLEANUP_LAST_RUN_V1';
            if (cache && cache.get(throttleKey)) {
                return;
            }

            this._cleanupOrphanedOcrFiles();

            if (cache) {
                cache.put(throttleKey, String(Date.now()), 21600); // max una volta ogni 6 ore
            }
        } catch (e) {
            console.warn(`⚠️ Cleanup orfani OCR non eseguito: ${e.message}`);
        }
    }

    _cleanupOrphanedOcrFiles() {
        if (typeof Drive === 'undefined' || !Drive.Files || typeof Drive.Files.list !== 'function') {
            return;
        }

        const cutoffIso = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
        // Compatibilità Drive API v2/v3: cambiano nomi campo in query e shape della risposta.
        // Manteniamo doppia strategia per evitare cleanup silenziosamente inattivo.
        const v2Query = `title contains 'OCR_' and trashed = false and modifiedDate < '${cutoffIso}'`;
        const v3Query = `name contains 'OCR_' and trashed = false and modifiedTime < '${cutoffIso}'`;

        let response;
        try {
            response = Drive.Files.list({ q: v2Query, maxResults: 20 });
        } catch (e) {
            try {
                response = Drive.Files.list({ q: v3Query, pageSize: 20 });
            } catch (v3Error) {
                console.warn(`⚠️ Cleanup orfani OCR non disponibile: ${v3Error.message}`);
                return;
            }
        }

        const files = response && (response.items || response.files) ? (response.items || response.files) : [];
        if (!files.length) {
            return;
        }

        let removed = 0;
        for (const file of files) {
            if (!file || !file.id) continue;
            try {
                if (typeof Drive.Files.remove === 'function') {
                    Drive.Files.remove(file.id);
                } else if (typeof Drive.Files.delete === 'function') {
                    Drive.Files.delete(file.id);
                } else if (typeof Drive.Files.trash === 'function') {
                    Drive.Files.trash(file.id);
                }
                removed++;
            } catch (e) {
                console.warn(`⚠️ Impossibile rimuovere file OCR orfano (${file.id}): ${e.message}`);
            }
        }

        if (removed > 0) {
            console.log(`🧹 Cleanup OCR: rimossi ${removed} file orfani`);
        }
    }

    /**
     * Estrae testo da un allegato Office (Word, Excel, PowerPoint)
     * tramite conversione nativa in Google Workspace.
     * @param {GmailAttachment} attachment - Allegato email
     * @param {string} googleMimeType - Tipo Google Workspace destinazione
     * @param {object} settings - Impostazioni pipeline
     * @returns {string} Testo estratto (vuoto se fallisce)
     */
    _extractOfficeText(attachment, googleMimeType, settings) {
        let fileId = null;
        const startedAt = Date.now();
        const maxOfficeExtractionMs = (settings && typeof settings.maxOfficeExtractionMs === 'number')
            ? settings.maxOfficeExtractionMs
            : 12000;
        const exceededBudget = () => (Date.now() - startedAt) > maxOfficeExtractionMs;
        try {
            if (typeof settings.shouldContinue === 'function' && !settings.shouldContinue()) {
                return '';
            }
            if (exceededBudget()) {
                console.warn('⚠️ Timeout estrazione Office: budget superato prima della conversione');
                return '';
            }

            if (typeof Drive === 'undefined' || !Drive.Files) {
                throw new Error('Drive Advanced Service non abilitato');
            }

            const blob = attachment.copyBlob();
            const fileName = attachment.getName() || 'allegato';

            // Caricamento con conversione nel formato Google Workspace corrispondente
            const originalMimeFull = blob.getContentType() || '';
            const originalMime = originalMimeFull.split(';')[0].trim().toLowerCase();
            if (typeof Drive.Files.insert === 'function') {
                const resource = {
                    title: `OCR_${fileName}`,
                    mimeType: originalMime
                };
                const file = Drive.Files.insert(resource, blob, { convert: true });
                if (!file || !file.id) {
                    throw new Error('Drive API ha restituito un file convertito non valido (id assente)');
                }
                fileId = file.id;
            } else if (typeof Drive.Files.create === 'function') {
                const resource = {
                    name: `OCR_${fileName}`,
                    mimeType: googleMimeType
                };
                const file = Drive.Files.create(resource, blob, { mimeType: googleMimeType });
                if (!file || !file.id) {
                    throw new Error('Drive API ha restituito un file convertito non valido (id assente)');
                }
                if (file.mimeType && file.mimeType !== googleMimeType) {
                    throw new Error(`Conversione Office non applicata (mimeType=${file.mimeType})`);
                }
                fileId = file.id;
            } else {
                throw new Error('Drive.Files non espone metodi compatibili (insert/create)');
            }
            if (exceededBudget()) {
                console.warn('⚠️ Timeout estrazione Office: budget superato dopo conversione Drive');
                return '';
            }

            // Estrazione testo in base al tipo Google Workspace
            if (googleMimeType === 'application/vnd.google-apps.document') {
                // Word → Google Docs
                const doc = DocumentApp.openById(fileId);
                return doc.getBody().getText();
            }

            if (googleMimeType === 'application/vnd.google-apps.spreadsheet') {
                // Excel → Google Sheets: concatena il testo di tutte le celle non vuote
                const ss = SpreadsheetApp.openById(fileId);
                const sheets = ss.getSheets();
                const parts = [];
                const maxSheets = Math.min(sheets.length, 3); // Limita a 3 fogli
                for (let s = 0; s < maxSheets; s++) {
                    if (typeof settings.shouldContinue === 'function' && !settings.shouldContinue()) break;
                    if (exceededBudget()) break;
                    const sheet = sheets[s];
                    const lastRow = Math.min(sheet.getLastRow(), 100); // Limita a 100 righe
                    const lastCol = Math.min(sheet.getLastColumn(), 20); // Limita a 20 colonne
                    if (lastRow === 0 || lastCol === 0) continue;
                    if (maxSheets > 1) {
                        parts.push(`[Foglio: ${sheet.getName()}]`);
                    }
                    const data = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
                    for (const row of data) {
                        const line = row.filter(Boolean).join(' | ');
                        if (line.trim()) parts.push(line);
                    }
                }
                return parts.join('\n');
            }

            if (googleMimeType === 'application/vnd.google-apps.presentation') {
                // PowerPoint → Google Slides: estrae testo da ogni diapositiva
                const presentation = SlidesApp.openById(fileId);
                const slides = presentation.getSlides();
                const parts = [];
                const maxSlides = Math.min(slides.length, 10); // Limita a 10 diapositive
                for (let i = 0; i < maxSlides; i++) {
                    if (typeof settings.shouldContinue === 'function' && !settings.shouldContinue()) break;
                    if (exceededBudget()) break;
                    const slide = slides[i];
                    const shapes = slide.getShapes();
                    const slideTexts = [];
                    for (const shape of shapes) {
                        if (exceededBudget()) break;
                        const tf = shape.getText();
                        if (tf) {
                            const text = tf.asString().trim();
                            if (text) slideTexts.push(text);
                        }
                    }
                    if (slideTexts.length > 0) {
                        parts.push(`[Slide ${i + 1}] ${slideTexts.join(' ')}`);
                    }
                }
                return parts.join('\n');
            }

            return '';
        } catch (e) {
            console.warn(`⚠️ Estrazione Office fallita: ${e.message}`);
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
                    console.warn(`⚠️ Cleanup file Office fallito (${fileId}): ${e.message}`);
                }
            }
        }
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

            if (typeof Drive.Files.create === 'function') {
                const resource = {
                    name: `OCR_${fileName}`,
                    // Drive API v3: per ottenere testo OCR apribile con DocumentApp,
                    // il file caricato va convertito in Google Doc.
                    mimeType: 'application/vnd.google-apps.document'
                };
                const file = Drive.Files.create(resource, blob, {
                    ocrLanguage: settings.ocrLanguage || 'it'
                });
                if (!file || !file.id) {
                    throw new Error('Drive API ha restituito un file OCR non valido (id assente)');
                }
                fileId = file.id;
            } else if (typeof Drive.Files.insert === 'function') {
                const resource = {
                    title: `OCR_${fileName}`,
                    mimeType: blob.getContentType()
                };

                const file = Drive.Files.insert(resource, blob, {
                    ocr: true,
                    ocrLanguage: settings.ocrLanguage || 'it',
                    convert: true
                });
                if (!file || !file.id) {
                    throw new Error('Drive API ha restituito un file OCR non valido (id assente)');
                }
                fileId = file.id;
            } else {
                throw new Error('Drive.Files non espone metodi OCR compatibili (create/insert)');
            }

            const doc = DocumentApp.openById(fileId);
            return doc.getBody().getText();
        } catch (e) {
            console.warn(`⚠️ OCR allegato fallito: ${e.message}`);
            return '';
        } finally {
            if (fileId) {
                try {
                    if (typeof Drive.Files.delete === 'function') {
                        Drive.Files.delete(fileId);
                    } else if (typeof Drive.Files.remove === 'function') {
                        Drive.Files.remove(fileId);
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
        const letters = (cleaned.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
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

        const alnumCount = (cleaned.match(/[a-zA-Z0-9À-ÿ]/g) || []).length;
        const chars = cleaned.length;
        const alnumRatio = Math.min(1, alnumCount / Math.max(1, chars * 0.5));

        let score = 0.3;
        score += Math.min(cleaned.length / 600, 0.35);
        score += alnumRatio * 0.3;

        if (isGenericName) {
            score -= 0.1;
        }

        return Math.max(0, Math.min(1, Number(score.toFixed(2))));
    }

    _normalizeAttachmentText(text, settings) {
        if (!text || typeof text !== 'string') return '';
        return text.replace(/\s+/g, ' ').trim();
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
        const ibanRegex = /\b[A-Z]{2}\d{2}(?:[A-Z0-9]{10,30}|\s[A-Z0-9]{10,30})\b/i;
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
        const safeFrom = String(fromField || '').trim();
        if (!safeFrom) {
            return 'Utente';
        }

        const match = safeFrom.match(/^"?(.+?)"?\s*</);
        let name = null;

        if (match) {
            name = match[1].trim();
        } else {
            const email = this._extractEmailAddress(safeFrom);
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
        const safeFrom = String(fromField || '');
        if (!safeFrom) return '';

        const angleMatch = safeFrom.match(/<([^>]+@[^>]+)>/);
        if (angleMatch) {
            return angleMatch[1];
        }

        // Evita regex RFC5322 troppo complesse (rischio backtracking su input malevoli).
        // Header From di Gmail sono già sanificati: pattern snello e lineare è sufficiente.
        const safeFromField = safeFrom.length > 512 ? safeFrom.substring(0, 512) : safeFrom;
        const emailMatch = safeFromField.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        if (emailMatch) {
            return emailMatch[0];
        }

        return '';
    }

    _htmlToPlainText(html) {
        if (!html) return '';

        let text = html;
        // Rimuove blocchi di codice/stile che altrimenti finirebbero nel prompt testuale.
        text = text.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
        // Preserva separatori strutturali per evitare blocchi di testo illeggibili.
        // È intenzionale: evitare il "muro di testo" migliora la qualità del parsing Gemini.
        text = text.replace(/<br\s*\/?\s*>/gi, '\n');
        text = text.replace(/<\/p\s*>/gi, '\n\n');
        text = text.replace(/<\/div\s*>/gi, '\n');

        text = text.replace(/<[^>]+>/g, ' ');
        text = text.replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        // Riduce spazi/tabs senza distruggere i newline significativi
        text = text
            .replace(/\r\n?/g, '\n')
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

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
            const effectiveUser = Session.getEffectiveUser();
            ourEmail = effectiveUser ? effectiveUser.getEmail() : '';
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
            /^(?:>\s?.*\n){1,}>\s?.*/m,
            /^On .* wrote:/m,
            /^Il giorno .* ha scritto:/m,
            /^-{3,}.*Original Message/im,
            /^-{3,}.*Messaggio originale/im
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
            /^cordiali saluti\b/im,
            /^distinti saluti\b/im,
            /^in fede\b/im,
            /best regards/i,
            /sincerely/i,
            /sent from my iphone/i,
            /inviato da/i
        ];

        const signatureSearchStart = Math.floor(result.length * 0.7);
        const signatureTail = result.substring(signatureSearchStart);

        for (const marker of sigMarkers) {
            const match = signatureTail.search(marker);
            if (match === -1) continue;

            const absoluteMatch = signatureSearchStart + match;
            const prefix = result.substring(0, absoluteMatch);

            // Tronca solo se la firma è su una nuova sezione (dopo riga vuota)
            if (/\n\s*\n\s*$/.test(prefix) || absoluteMatch === 0) {
                result = result.substring(0, absoluteMatch);
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

        const messages = gmailThread.getMessages();
        const lastMsg = messages[messages.length - 1];
        lastMsg.reply(replyText);

        console.log(`✓ Risposta inviata a ${messageDetails.senderEmail}`);

        if (messageDetails.hasReplyTo) {
            console.log("   📧 Risposta inviata all'indirizzo Reply-To");
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

        const htmlBody = (typeof markdownToHtml === 'function')
            ? markdownToHtml(finalResponse)
            : finalResponse
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>');
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

                let replySubject = this._sanitizeSubjectForHeader(messageDetails.subject);
                if (!replySubject.toLowerCase().startsWith('re:')) {
                    replySubject = 'Re: ' + replySubject;
                }

                let referencesHeader = messageDetails.rfc2822MessageId;
                if (messageDetails.existingReferences) {
                    referencesHeader = messageDetails.existingReferences + ' ' + messageDetails.rfc2822MessageId;
                }

                // From stabile: usa sempre l'account attivo (evita errori "non autorizzato")
                const stableFrom = Session.getEffectiveUser().getEmail();

                // Reply-To: usa alias solo se presente in To/Cc del messaggio originale
                let replyToEmail = null;
                const recipientHeaders = `${messageDetails.recipientEmail || ''},${messageDetails.recipientCc || ''}`;
                const emailRegex = /\b[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@(?!-)(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/gi;
                const recipientAddresses = (recipientHeaders.match(emailRegex) || [])
                    .map(addr => addr.replace(/[\r\n]+/g, '').trim().toLowerCase());
                const knownAliases = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.KNOWN_ALIASES))
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

                // Manteniamo `rawHeaders` come array e lo espandiamo nel payload MIME.
                const rawMessage = [
                    rawHeaders.join('\r\n'),
                    '',
                    `--${boundary}`,
                    'Content-Type: text/plain; charset=UTF-8',
                    'Content-Transfer-Encoding: base64',
                    '',
                    this._chunkBase64(Utilities.base64Encode(plainText, Utilities.Charset.UTF_8)),
                    '',
                    `--${boundary}`,
                    'Content-Type: text/html; charset=UTF-8',
                    'Content-Transfer-Encoding: base64',
                    '',
                    this._chunkBase64(Utilities.base64Encode(htmlBody, Utilities.Charset.UTF_8)),
                    '',
                    `--${boundary}--`,
                    ''
                ].join('\r\n');

                // Gmail API RAW richiede base64url RFC4648 senza padding finale '='.
                let encodedMessage;
                if (Utilities && typeof Utilities.base64EncodeWebSafe === 'function' && Utilities.Charset && Utilities.Charset.UTF_8) {
                    encodedMessage = Utilities.base64EncodeWebSafe(rawMessage, Utilities.Charset.UTF_8);
                } else if (Utilities && typeof Utilities.newBlob === 'function' && typeof Utilities.base64EncodeWebSafe === 'function') {
                    encodedMessage = Utilities.base64EncodeWebSafe(Utilities.newBlob(rawMessage, 'message/rfc822').getBytes());
                } else if (typeof Buffer !== 'undefined') {
                    encodedMessage = Buffer.from(rawMessage, 'utf8').toString('base64url');
                } else {
                    encodedMessage = Utilities.base64EncodeWebSafe(rawMessage);
                }
                encodedMessage = encodedMessage.replace(/=+$/, '');

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
        let mailEntity = null;

        if (isMessage) {
            mailEntity = resource;
        } else if (typeof resource === 'string') {
            const threadEntity = GmailApp.getThreadById(resource);
            const threadMessages = threadEntity ? threadEntity.getMessages() : [];
            mailEntity = threadMessages.length > 0 ? threadMessages[threadMessages.length - 1] : threadEntity;
        } else {
            mailEntity = resource;
        }

        if (!mailEntity || typeof mailEntity.reply !== 'function') {
            throw new Error('Entità Gmail non valida per reply() nel fallback HTML');
        }

        try {
            // Corpo minimo non vuoto per massimizzare compatibilità nel fallback nativo.
            const fallbackBody = plainText || this._stripHtmlTags(finalResponse) || 'Visualizza il contenuto HTML.';
            mailEntity.reply(fallbackBody, { htmlBody: htmlBody });
            console.log(`✓ Risposta HTML inviata a ${messageDetails.senderEmail} (metodo alternativo nativo)`);
        } catch (error) {
            console.error(`❌ Risposta fallita: ${error.message}`);
            try {
                mailEntity.reply(plainText || this._stripHtmlTags(finalResponse));
                console.log(`✓ Risposta plain text inviata a ${messageDetails.senderEmail} (alternativa)`);
            } catch (fallbackError) {
                console.error(`❌ CRITICO: Invio risposta alternativo fallito: ${fallbackError.message}`);
                const errorLabel = (typeof CONFIG !== 'undefined' && CONFIG.ERROR_LABEL_NAME) ? CONFIG.ERROR_LABEL_NAME : 'Errore';
                if (mailEntity) {
                    const targetThread = (typeof mailEntity.getThread === 'function')
                        ? mailEntity.getThread()
                        : mailEntity;

                    if (targetThread && typeof targetThread.getMessages === 'function') {
                        this.addLabelToThread(targetThread, errorLabel);
                    }
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

        // Intenzionale: array locale ricreato a ogni chiamata, quindi la mutazione
        // serve solo ad ampliare le eccezioni per il messaggio corrente.
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
        if (!text || !replacements || typeof replacements !== 'object') return text;

        let result = text;
        let count = 0;

        for (const [bad, good] of Object.entries(replacements)) {
            if (!bad) continue;

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

    _sanitizeSubjectForHeader(subject) {
        const safe = (subject === null || subject === undefined) ? '' : String(subject);
        const folded = safe
            .replace(/[\r\n]+/g, ' ')
            .replace(/\b(?:to|cc|bcc|from|subject|reply-to)\s*:/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        return folded || 'Re:';
    }

    /**
     * Spezza una stringa Base64 in righe da massimo 76 caratteri (RFC 2045).
     * @param {string} base64Str
     * @returns {string}
     */
    _chunkBase64(base64Str) {
        if (!base64Str || typeof base64Str !== 'string') {
            return '';
        }
        const chunks = base64Str.match(/.{1,76}/g);
        return chunks ? chunks.join('\r\n') : '';
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
            { type: 'Documento identità/passaporto', patterns: ["carta d'identit", "documento di identit", 'passaporto'], minMatches: 1 },
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

        // Classificazione per formato file Office
        const fileNameLower = (fileName || '').toLowerCase();
        if (fileNameLower.endsWith('.doc') || fileNameLower.endsWith('.docx')) return 'Documento Word';
        if (fileNameLower.endsWith('.xls') || fileNameLower.endsWith('.xlsx')) return 'Foglio Excel';
        if (fileNameLower.endsWith('.ppt') || fileNameLower.endsWith('.pptx')) return 'Presentazione PowerPoint';

        return 'Documento generico';
    }

    _extractDocumentFields(text, shouldMask = true) {
        const value = `${text || ''}`;
        if (!value) return [];

        const extract = [];
        const patterns = [
            { label: 'Nome e cognome', regex: /(?:nome\s*(?:e\s*cognome)?|cognome\s*e\s*nome)\s*[:\-]\s*([^\n;]{3,80})/i },
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

    if (/^mailto:/i.test(normalized)) {
        const emailPart = decoded.replace(/^mailto:/i, '').split('?')[0].trim();
        if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(emailPart)) {
            console.warn(`🛑 Bloccato mailto malformato: ${decoded}`);
            return null;
        }
    }

    // SSRF: blocco IP interni, IPv6 loopback/link-local, IP decimali
    const INTERNAL_IP_PATTERN = /^(https?:\/\/)?(localhost|127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/i;
    const DECIMAL_IP = /^https?:\/\/\d{8,10}(\/|$)/i;
    const USERINFO_BYPASS = /^https?:\/\/[^@]+@/i;

    // Blocca rappresentazioni numeriche alternative localhost (hex/octal/miste)
    // es: 0x7f000001, 0177.0.0.1, 0x7f.0.0.1
    const ALT_LOCALHOST_NUMERIC = /^https?:\/\/(?:0x[0-9a-f]+|0[0-7]+|\d+)(?::\d+)?(?:\/|$)/i;

    if (INTERNAL_IP_PATTERN.test(normalized) ||
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
            const match = value.match(/^https?:\/\/(\[[^\]]+\]|[^\/?#:]+)/i);
            return match ? match[1] : '';
        };

        const host = String(parseHostFromUrl(decoded) || '').toLowerCase();
        const hostNoBrackets = host.replace(/^\[|\]$/g, '');
        const normalizedHost = hostNoBrackets.replace(/\.+$/, '');

        if (normalizedHost === 'localhost') {
            console.warn(`🛑 Bloccato tentativo SSRF localhost canonico: ${decoded}`);
            return null;
        }

        const isBlockedIpv6Host = (ipv6Host) => {
            if (!ipv6Host || !ipv6Host.includes(':')) return false;

            const normalizedIpv6 = ipv6Host.toLowerCase();
            // Blocca loopback e indirizzi non specificati
            if (normalizedIpv6 === '::' || normalizedIpv6 === '::1') return true;
            // Block link-local
            if (normalizedIpv6.startsWith('fe80:')) return true;
            // Block unique-local (ULA)
            if (normalizedIpv6.startsWith('fc') || normalizedIpv6.startsWith('fd')) return true;

            return false;
        };

        if (isBlockedIpv6Host(hostNoBrackets)) {
            console.warn(`🛑 Bloccato tentativo SSRF IPv6 locale: ${decoded}`);
            return null;
        }
        const parts = normalizedHost.split('.');

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
        const mappedPatterns = [
            /^::ffff:(.+)$/i,
            /^0:0:0:0:0:ffff:(.+)$/i,
            /^0000:0000:0000:0000:0000:ffff:(.+)$/i
        ];

        const mappedMatch = mappedPatterns
            .map(pattern => hostNoBrackets.match(pattern))
            .find(match => match && match[1]);

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
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escape HTML per prevenire XSS.
 * Applicato PRIMA delle trasformazioni markdown.
 */
function escapeHtml(text) {
    const value = (text === null || typeof text === 'undefined') ? '' : String(text);
    return value
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
    if (text === null || typeof text === 'undefined') return '';
    const inputText = (typeof text === 'string') ? text : String(text);
    const normalizedInputText = inputText.replace(/\r\n?/g, '\n');

    const generatePlaceholderNonce = () => {
        if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.getUuid === 'function') {
            return Utilities.getUuid();
        }
        return Math.random().toString(36).slice(2);
    };

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
    let html = normalizedInputText.replace(/```[\s\S]*?```/g, (match) => {
        const sanitized = escapeHtml(match.replace(/```/g, '').trim());
        const token = `@@CODEBLOCK_PLACEHOLDER_${codeBlocks.length}_${generatePlaceholderNonce()}@@`;
        codeBlocks.push({ token: token, value: sanitized });
        return token;
    });

    // 2. Proteggi link markdown (prima dell'escape globale)
    const links = [];
    html = replaceMarkdownLinks(html, (linkText, url) => {
        const sanitizedUrl = sanitizeUrl(url.replace(/[\s\u200B-\u200D\uFEFF]/g, ''));
        const escapedText = escapeHtml(linkText);
        const token = `@@LINK_PLACEHOLDER_${links.length}_${generatePlaceholderNonce()}@@`;
        if (sanitizedUrl) {
            const hrefSafe = sanitizedUrl.replace(/&(?!amp;|lt;|gt;|quot;|#39;)/g, '&amp;');
            links.push({ token: token, value: `<a href="${hrefSafe}" style="color:#351c75;">${escapedText}</a>` });
        } else {
            console.warn(`⚠️ URL bloccato per sicurezza: ${url}`);
            links.push({ token: token, value: escapedText });
        }
        return token;
    });

    // 3. Escape globale (tutto il testo rimanente diventa sicuro)
    html = escapeHtml(html);

    // 4. Trasformazioni markdown su testo già escaped
    // Manteniamo una proporzione fissa tra corpo testo e titoli.
    const baseBodyFontPx = 20;
    const headingPx = {
        h4: Math.round(baseBodyFontPx * 1.00),
        h3: Math.round(baseBodyFontPx * 1.15),
        h2: Math.round(baseBodyFontPx * 1.30),
        h1: Math.round(baseBodyFontPx * 1.50)
    };

    // Headers
    html = html.replace(/^####\s+(.+)$/gm, `<p style="font-size:${headingPx.h4}px;font-weight:bold;margin:8px 0 4px;">$1</p>`);
    html = html.replace(/^###\s+(.+)$/gm, `<p style="font-size:${headingPx.h3}px;font-weight:bold;margin:10px 0 4px;">$1</p>`);
    html = html.replace(/^##\s+(.+)$/gm, `<p style="font-size:${headingPx.h2}px;font-weight:bold;margin:12px 0 4px;">$1</p>`);
    html = html.replace(/^#\s+(.+)$/gm, `<p style="font-size:${headingPx.h1}px;font-weight:bold;margin:14px 0 6px;">$1</p>`);

    // Bold / Italic (asterischi già escaped come testo, usiamo la versione escaped)
    // Nota: gli asterischi NON vengono escaped da escapeHtml(), quindi funzionano normalmente
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '<em>$1</em>');

    // 5. Liste markdown (bullet e numerate) -> <ul>/ <ol> + <li>
    // Liste puntate (- item  oppure  * item all'inizio riga)
    // Raggruppa righe consecutive con lo stesso prefisso in un unico <ul>
    html = html.replace(/((?:^[ \t]*[-*][ \t]+.+(?:\n|$))+)/gm, (block) => {
        const items = block
            .split('\n')
            .filter(l => l.trim())
            .map(l => `<li>${l.replace(/^[ \t]*[-*][ \t]+/, '')}</li>`)
            .join('');
        return `<ul style="margin:6px 0;padding-left:20px;">${items}</ul>`;
    });

    // Liste numerate (1. item)
    html = html.replace(/((?:^[ \t]*\d+\.[ \t]+.+(?:\n|$))+)/gm, (block) => {
        const items = block
            .split('\n')
            .filter(l => l.trim())
            .map(l => `<li>${l.replace(/^[ \t]*\d+\.[ \t]+/, '')}</li>`)
            .join('');
        return `<ol style="margin:6px 0;padding-left:20px;">${items}</ol>`;
    });

    html = html.trim();

    // 7. Ripristina link e code blocks
    links.forEach((entry) => {
        html = html.split(entry.token).join(entry.value);
    });

    codeBlocks.forEach((entry) => {
        html = html.split(entry.token).join(
            `<pre style="background:#f4f4f4;padding:10px;border-radius:4px;font-family:monospace;">${entry.value}</pre>`
        );
    });

    // 8. Converti Emoji in entità HTML
    html = Array.from(html).map(char => {
        const codePoint = char.codePointAt(0);
        if (codePoint > 0xFFFF) {
            return '&#' + codePoint + ';';
        }
        return char;
    }).join('');

    // 9. Costruzione paragrafi evitando nesting invalido di <p>
    // Inserisce separatori intorno ai blocchi per evitare casi tipo:
    // "Intro\n<ul>...</ul>" -> <p>Intro<br><ul>...</ul></p> (HTML invalido)
    html = html.replace(/(<\/?(?:ul|ol|pre|p|div|h[1-6])\b[^>]*>)/gi, '\n$1\n');

    const isBlockHtml = (fragment) => /^<(p|ul|ol|pre|div|h[1-6])\b/i.test(fragment.trim());
    const cleanedHtml = html
        .split(/\n\n+/)
        .map(fragment => fragment.trim())
        .filter(fragment => fragment.length > 0)
        .map(fragment => {
            const withLineBreaks = isBlockHtml(fragment)
                ? fragment
                : fragment.replace(/\n/g, '<br>');
            if (!withLineBreaks || withLineBreaks === '<br>') return withLineBreaks;
            return isBlockHtml(withLineBreaks) ? withLineBreaks : `<p>${withLineBreaks}</p>`;
        })
        .join('');

    const startsWithBlock = /^\s*<(p|ul|ol|pre|h[1-6])/i.test(cleanedHtml);
    const bodyContent = startsWithBlock ? cleanedHtml : `<p>${cleanedHtml}</p>`;

    // Manteniamo il corpo risposta a 20px: i programmatori non devono rompere le scatole con altre regressioni.
    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, Helvetica, sans-serif; font-size: ${baseBodyFontPx}px; color: #351c75; line-height: 1.6;">
  <div style="font-family: Arial, Helvetica, sans-serif; font-size: ${baseBodyFontPx}px; color: #351c75; line-height: 1.6;">
    ${bodyContent}
  </div>
</body>
</html>`;
}
