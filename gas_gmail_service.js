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

var GmailService = class GmailService {
    constructor() {
        console.log('📧 Inizializzazione GmailService...');

        // Cache etichette: in-memory (stessa esecuzione) + CacheService (cross-esecuzione)
        this._labelCache = new Map();
        this._cacheTTL = (typeof CONFIG !== 'undefined' && CONFIG.GMAIL_LABEL_CACHE_TTL) ? CONFIG.GMAIL_LABEL_CACHE_TTL : 3600000;
        // Limita il TTL entro i vincoli tecnici di CacheService.
        const safeTtl = Number.isFinite(Number(this._cacheTTL)) ? Number(this._cacheTTL) : 3600000;
        this._cacheTtlSeconds = Math.min(21599, Math.max(60, Math.floor(safeTtl / 1000)));
        this._scriptCache = (typeof CacheService !== 'undefined' && CacheService) ? CacheService.getScriptCache() : null;
        this._gmailDailyCallLimit = (typeof CONFIG !== 'undefined' && Number.isFinite(Number(CONFIG.GMAIL_DAILY_CALL_LIMIT)))
            ? Number(CONFIG.GMAIL_DAILY_CALL_LIMIT)
            : 18000;
        this._gmailDailyCounterWarnAt = Math.floor(this._gmailDailyCallLimit * 0.9);

        // Mappa MIME types Office → tipo Google Workspace per conversione nativa
        this._officeMimeMap = {
            // Parola → Documenti Google
            'application/msword': 'application/vnd.google-apps.document',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
            // Excel → Google Sheets
            'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
            'application/vnd.oasis.opendocument.spreadsheet': 'application/vnd.google-apps.spreadsheet',
            // PowerPoint → Google Slides
            'application/vnd.ms-powerpoint': 'application/vnd.google-apps.presentation',
            'application/vnd.mspowerpoint': 'application/vnd.google-apps.presentation',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'application/vnd.google-apps.presentation',
            'application/vnd.oasis.opendocument.presentation': 'application/vnd.google-apps.presentation',
            // OpenDocument Text → Google Docs
            'application/vnd.oasis.opendocument.text': 'application/vnd.google-apps.document'
        };

        const ttlHours = Math.max(1, Math.round((this._cacheTtlSeconds / 3600) * 10) / 10);
        console.log(`✓ GmailService inizializzato con cache etichette (TTL ${ttlHours}h)`);
        
        // Counter batched per ridurre I/O
        this._pendingGmailCallCount = 0;
        this._lastGmailCallCount = null;
    }

    _getGmailCounterDateKey_() {
        // Allineamento al timezone Pacifico (reset quote Gmail lato Google).
        const tz = 'America/Los_Angeles';
        const now = new Date(Date.now());
        if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function') {
            return `gmail_api_calls:${Utilities.formatDate(now, tz, 'yyyy-MM-dd')}`;
        }

        // Fallback locale/test: mantieni la stessa semantica Pacific Time anche
        // fuori da Apps Script, dove Utilities.formatDate potrebbe non esistere.
        if (typeof Intl !== 'undefined' && Intl && typeof Intl.DateTimeFormat === 'function') {
            try {
                const parts = new Intl.DateTimeFormat('en-CA', {
                    timeZone: tz,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }).formatToParts(now);
                const byType = parts.reduce((acc, part) => {
                    acc[part.type] = part.value;
                    return acc;
                }, {});
                if (byType.year && byType.month && byType.day) {
                    return `gmail_api_calls:${byType.year}-${byType.month}-${byType.day}`;
                }
            } catch (e) {
                console.warn(`⚠️ Fallback Intl timezone Pacifico non disponibile: ${e.message}`);
            }
        }

        // Ultimo fallback: approssima Pacific Standard Time (UTC-8) per evitare
        // il reset a mezzanotte UTC, che anticipa il reset quote Gmail.
        const pacificApprox = new Date(Date.now() - 8 * 60 * 60 * 1000);
        return `gmail_api_calls:${pacificApprox.toISOString().slice(0, 10)}`;
    }

    _incrementGmailCallCounterOrThrow_(opName) {
        if (!this._scriptCache || !this._gmailDailyCallLimit) return;
        
        // Sincronizziamo il contatore solo ogni 5 chiamate (o se vicino alla soglia warning)
        // per ridurre l'overhead di I/O verso CacheService.
        this._pendingGmailCallCount++;
        
        const key = this._getGmailCounterDateKey_();
        const flushThreshold = 5;
        const warningBuffer = 10; // soglia di sicurezza per forzare il flush
        
        // Se non abbiamo ancora un valore base in memoria, forziamo il flush immediato
        if (this._lastGmailCallCount === null || 
            this._pendingGmailCallCount >= flushThreshold ||
            (this._lastGmailCallCount + this._pendingGmailCallCount) > (this._gmailDailyCallLimit - warningBuffer)) {
            this._flushGmailCallCounter_(key, opName);
        }
    }

    _flushGmailCallCounter_(key, opName = 'batch') {
        if (!this._scriptCache) return;

        const lock = (typeof LockService !== 'undefined' && LockService && typeof LockService.getScriptLock === 'function')
            ? LockService.getScriptLock()
            : null;
        let lockAcquired = false;

        if (lock) {
            try {
                lockAcquired = lock.tryLock(5000);
            } catch (lockError) {
                console.warn(`⚠️ Impossibile acquisire lock flush contatore API: ${lockError.message}`);
            }
            if (!lockAcquired) {
                return;
            }
        }

        try {

            // Carichiamo il valore corrente dalla cache (con fallback su ScriptProperties)
            const raw = this._scriptCache.get(key);
            let current = 0;
            if (raw !== null) {
                current = Number.parseInt(raw, 10) || 0;
            } else if (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function') {
                try {
                    const props = PropertiesService.getScriptProperties();
                    current = Number.parseInt(props.getProperty(key) || '0', 10) || 0;
                } catch (e) {
                    console.warn(`⚠️ Impossibile leggere backup counter da ScriptProperties (${key}): ${e.message}`);
                }
            }

            const total = current + this._pendingGmailCallCount;
            this._lastGmailCallCount = total;
            this._pendingGmailCallCount = 0;

            // Aggiorniamo la cache (TTL 21599 = ~6 ore)
            this._scriptCache.put(key, String(total), 21599);

            // Allineamento periodico del counter su storage persistente.
            if (total % 10 === 0 && typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function') {
                try {
                    PropertiesService.getScriptProperties().setProperty(key, String(total));
                } catch (e) {}
            }

            if (total >= this._gmailDailyCounterWarnAt && total < this._gmailDailyCallLimit) {
                console.warn(`⚠️ Gmail API call counter alto: ${total}/${this._gmailDailyCallLimit} (${opName})`);
            }

            if (total >= this._gmailDailyCallLimit) {
                throw new Error(`GMAIL_DAILY_CALL_LIMIT_REACHED (${total}/${this._gmailDailyCallLimit})`);
            }
        } finally {
            if (lock && lockAcquired) {
                try { lock.releaseLock(); } catch (_) {}
            }
        }
    }

    // ========================================================================
    // GESTIONE ETICHETTE (con cache)
    // ========================================================================

    _getLabelCacheKey_(labelName) {
        const normalizedLabelName = String(labelName || '');
        if (normalizedLabelName.length <= 220) {
            return `gmail_label_exists:${normalizedLabelName}`;
        }
        const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normalizedLabelName);
        const hash = Utilities.base64EncodeWebSafe(digest).slice(0, 32);
        return `gmail_label_exists:${hash}`;
    }

    /**
     * Ottiene o crea un'etichetta Gmail con caching
     * Nota: la creazione automatica è intenzionale (self-healing al primo avvio)
     * per evitare errori "label not found" in ambienti nuovi.
     */
    getOrCreateLabel(labelName) {
        const cacheKey = this._getLabelCacheKey_(labelName);
        const cachedEntry = this._labelCache.get(labelName);
        const now = Date.now();
        if (cachedEntry && (now - cachedEntry.ts) < this._cacheTTL && cachedEntry.label != null) {
            console.log(`📦 Label '${labelName}' trovata in cache`);
            return cachedEntry.label;
        } else if (cachedEntry) {
            this._labelCache.delete(labelName);
        }

        let cachedExists = null;
        if (this._scriptCache) {
            try {
                cachedExists = this._scriptCache.get(cacheKey);
            } catch (e) {
                console.warn(`⚠️ CacheService.get fallito per label '${labelName}': ${e.message}`);
            }
        }
        if (cachedExists) {
            const label = GmailApp.getUserLabelByName(labelName);
            if (label) {
                this._labelCache.set(labelName, { ...(this._labelCache.get(labelName) || {}), label: label, ts: now });
                console.log(`📦 Label '${labelName}' trovata in cache persistente`);
                return label;
            }
            if (this._scriptCache) {
                try {
                    this._scriptCache.remove(cacheKey);
                } catch (_) { }
            }
        }

        const labels = GmailApp.getUserLabels();
        for (const label of labels) {
            if (label.getName() === labelName) {
                this._labelCache.set(labelName, { ...(this._labelCache.get(labelName) || {}), label: label, ts: now });
                if (this._scriptCache) {
                    try {
                        this._scriptCache.put(cacheKey, '1', this._cacheTtlSeconds);
                    } catch (_) { }
                }
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
                if (this._scriptCache) {
                    try {
                        this._scriptCache.put(cacheKey, '1', this._cacheTtlSeconds);
                    } catch (_) { }
                }
                console.log(`✓ Label '${labelName}' recuperata dopo collisione di creazione`);
                return existingLabel;
            }
            throw e;
        }

        this._labelCache.set(labelName, { ...(this._labelCache.get(labelName) || {}), label: newLabel, ts: now });
        if (this._scriptCache) {
            try {
                this._scriptCache.put(cacheKey, '1', this._cacheTtlSeconds);
            } catch (_) { }
        }
        console.log(`✓ Creata nuova label: ${labelName}`);
        return newLabel;
    }

    clearLabelCache() {
        this._labelCache.clear();
        console.log('🗑️ Cache label svuotata');
    }

    _clearPersistentLabelCache(labelName) {
        if (!labelName) return;
        if (this._scriptCache) {
            try {
                this._scriptCache.remove(this._getLabelCacheKey_(labelName));
            } catch (_) { }
        }
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

    removeLabelFromThread(thread, labelName) {
        if (!thread || !labelName) return;

        try {
            const label = this.getOrCreateLabel(labelName);
            thread.removeLabel(label);
            console.log(`✓ Rimossa label '${labelName}' dal thread`);
        } catch (e) {
            console.warn(`⚠️ removeLabelFromThread fallito per '${labelName}': ${e.message}`);
            if (this._isLabelNotFoundError(e)) {
                this._clearPersistentLabelCache(labelName);
                this.clearLabelCache();
                const label = this.getOrCreateLabel(labelName);
                thread.removeLabel(label);
                console.log(`✓ Rimossa label '${labelName}' dal thread (retry dopo cache reset)`);
            }
        }
    }

    /**
     * Aggiunge etichetta a un messaggio specifico (Gmail API avanzata)
     */
    addLabelToMessage(messageId, labelName) {
        try {
            const labelIdFromCache = this._getOptionalLabelIdByName(labelName);
            const labelId = labelIdFromCache || null;
            if (!labelId) {
                throw new Error(`Label ID non trovato per '${labelName}' (Advanced Service non disponibile o senza permessi): interrompo per preservare etichettatura a livello messaggio.`);
            }
            this._incrementGmailCallCounterOrThrow_('messages.modify:addLabel');
            const payload = { addLabelIds: [labelId] };
            Gmail.Users.Messages.modify(payload, 'me', messageId);
            console.log(`✓ Aggiunta label '${labelName}' al messaggio ${messageId}`);
        } catch (e) {
            console.warn(`⚠️ addLabelToMessage fallito per messaggio ${messageId}: ${e.message}`);
            if (this._isLabelNotFoundError(e)) {
                this._clearPersistentLabelCache(labelName);
                this.clearLabelCache();
                try {
                    const labelIdFromCache = this._getOptionalLabelIdByName(labelName);
                    const labelId = labelIdFromCache || null;
                    if (!labelId) throw new Error("Label ID non trovato tramite API Avanzata");
                    this._incrementGmailCallCounterOrThrow_('messages.modify:addLabel:retry');
                    const payload = { addLabelIds: [labelId] };
                    Gmail.Users.Messages.modify(payload, 'me', messageId);
                    console.log(`✓ Aggiunta label '${labelName}' al messaggio ${messageId} (retry dopo cache reset)`);
                } catch (retryError) {
                    console.warn(`⚠️ Retry addLabelToMessage fallito per messaggio ${messageId}: ${retryError.message}`);
                    console.warn(`⚠️ Skip fallback thread-level per msg ${messageId} con label '${labelName}' dopo label ID stale: preservo triage a livello messaggio`);
                    throw retryError;
                }
                return;
            }
            // Non degradare a label di thread: il triage operativo è message-level e
            // un fallback GmailApp.addLabelToThread inquinerebbe l'intera conversazione.
            console.warn(`⚠️ Skip fallback thread-level per msg ${messageId} con label '${labelName}': preservo triage a livello messaggio`);
            throw e;
        }
    }

    removeLabelFromMessage(messageId, labelName) {
        if (!labelName) return;
        const removeLabelFromNativeThread = () => {
            const nativeMessage = GmailApp.getMessageById(messageId);
            const thread = nativeMessage ? nativeMessage.getThread() : null;
            const nativeLabel = GmailApp.getUserLabelByName(labelName);
            if (thread && nativeLabel) {
                thread.removeLabel(nativeLabel);
                console.warn(`⚠️ Fallback thread-level: rimossa label '${labelName}' per msg ${messageId}`);
                return true;
            }
            return false;
        };

        try {
            const labelId = this._getOptionalLabelIdByName(labelName);
            if (!labelId) {
                try { removeLabelFromNativeThread(); } catch (fallbackError) {
                    console.warn(`⚠️ Fallback thread-level removeLabel fallito per msg ${messageId}: ${fallbackError.message}`);
                }
                return;
            }

            this._incrementGmailCallCounterOrThrow_('messages.modify:removeLabel');
            const payload = { removeLabelIds: [labelId] };
            Gmail.Users.Messages.modify(payload, 'me', messageId);
            console.log(`✓ Rimossa label '${labelName}' dal messaggio ${messageId}`);
        } catch (e) {
            console.warn(`⚠️ removeLabelFromMessage fallito per msg ${messageId}: ${e.message}`);
            try {
                removeLabelFromNativeThread();
            } catch (fallbackError) {
                console.warn(`⚠️ Fallback thread-level removeLabel fallito per msg ${messageId}: ${fallbackError.message}`);
            }
        }
    }

    /**
   * Aggiunge una label a più messaggi in una singola chiamata API (batch).
   * Riduce il consumo quota rispetto al loop su messages.modify.
   */
  batchAddLabelToMessages(messageIds, labelName) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return;

    const validIds = [...new Set(messageIds.filter(Boolean))];
    if (validIds.length === 0) return;

    try {
      const label = this.getOrCreateLabel(labelName);
      const labelId = this._getOptionalLabelIdByName(labelName)
        || (label && typeof label.getId === 'function' ? label.getId() : null);
      if (!labelId) {
        throw new Error(`Impossibile determinare labelId per "${labelName}"`);
      }
      this._incrementGmailCallCounterOrThrow_('messages.batchModify');
      Gmail.Users.Messages.batchModify({
        ids: validIds,
        addLabelIds: [labelId],
        removeLabelIds: []
      }, 'me');
      console.log(`✓ Aggiunta label '${labelName}' a ${validIds.length} messaggi (batch)`);
    } catch (e) {
      console.warn(`⚠️ batchAddLabelToMessages fallito (${labelName}): ${e.message}`);
      validIds.forEach(id => this.addLabelToMessage(id, labelName));
    }
  }

  _isLabelNotFoundError(error) {
        const message = (error && error.message) ? error.message.toLowerCase() : '';
        return (message.includes('label') && message.includes('not found')) ||
            message.includes('etichetta non trovata') ||
            message.includes('invalid label') ||
            (message.includes('label') && /\b404\b/.test(message));
    }



    _getMessageMetadataWithResilience(messageId, params, maxAttempts = 2) {
        const safeAttempts = this._safePositiveInt(maxAttempts, 2, 1, 5);
        let lastError = null;

        for (let attempt = 1; attempt <= safeAttempts; attempt++) {
            try {
                this._incrementGmailCallCounterOrThrow_('messages.get');
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
                    this._safeSleep_(250 * attempt * attempt);
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
                this._incrementGmailCallCounterOrThrow_('messages.list');
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
                    this._safeSleep_(300 * attempt * attempt);
                    continue;
                }
            }
        }

        throw new Error(`Gmail.Users.Messages.list non recuperabile (${lastError ? lastError.message : 'errore sconosciuto'})`);
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
            || message.includes('backend unavailable')
            || message.includes('authentication backend')
            || message.includes('service unavailable')
            || message.includes('timed out')
            || message.includes('timeout')
            || message.includes('rate limit')
            || message.includes('user-rate limit')
            || message.includes('quota exceeded')
            || message.includes('too many requests')
            || /\b429\b/.test(message)
            || /\b(500|502|503|504)\b/.test(message);
    }

    _safeSleep_(ms) {
        try {
            if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.sleep === 'function') {
                Utilities.sleep(ms);
            }
        } catch (_) { }
    }

    /**
     * Ottiene gli ID di tutti i messaggi con una specifica etichetta
     */
    getMessageIdsWithLabel(labelName, onlyInbox = true, options = {}) {
        try {
            const labelId = this._getOptionalLabelIdByName(labelName);
            const hasLabelId = !!labelId;
            if (!hasLabelId) {
                // Senza ID reale la query restituisce tutti gli unread in inbox, non solo quelli etichettati.
                // Fail-safe: evitiamo di inquinare la cache dei messaggi già etichettati.
                console.log(`⊖ Label '${labelName}' assente: nessun messaggio da pre-caricare.`);
                return new Set();
            }

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

            const unreadOnly = options.onlyUnread === true;
            // Query composita: inbox opzionale + filtro unread opzionale + finestra temporale opzionale
            const queryParts = [];
            if (onlyInbox) queryParts.push('in:inbox');
            if (unreadOnly) queryParts.push('is:unread');
            if (useWindowDays > 0) queryParts.push(`after:${this._getNDaysAgo(useWindowDays)}`);
            const query = queryParts.join(' ').trim();
            let pageCount = 0;

            do {
                if (pageCount >= maxPages || messageIds.size >= maxMessages) {
                    console.warn(`⚠️ Interruzione list label '${labelName}': limite raggiunto (pages=${pageCount}/${maxPages}, messages=${messageIds.size}/${maxMessages})`);
                    break;
                }

                const params = {
                    q: query,
                    maxResults: pageSize
                };
                if (hasLabelId) {
                    params.labelIds = [labelId];
                }
                if (pageToken) params.pageToken = pageToken;

                let response;
                try {
                    response = this._listMessagesWithResilience(params);
                } catch (listError) {
                    if (this._isLabelNotFoundError(listError)) {
                        this._clearPersistentLabelCache(labelName);
                        if (this._labelCache && typeof this._labelCache.delete === 'function') {
                            this._labelCache.delete(labelName);
                        }
                        console.warn(`⚠️ Label '${labelName}' non più esistente: cache pulita, restituisco Set vuoto.`);
                        return new Set();
                    }
                    throw listError;
                }
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
     * @param {string|string[]|null} [skipLabel=null]- Label dei messaggi da ignorare dinamicamente (es. '·')
     * @returns {GmailThread[]}             - Thread unici, già istanziati, con almeno un messaggio da elaborare
     */
    getUnprocessedUnreadThreads(labelName, errorLabel, validationLabel, messageBuffer = 150, targetThreads = 50, maxPages = 3, skipLabel = null) {
        const skipLabels = Array.isArray(skipLabel) ? skipLabel.filter(Boolean) : [skipLabel].filter(Boolean);
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
                safeMaxPages,
                skipLabels
            ).threads;
        }

        return this._discoverByQuery(
            labelName,
            errorLabel,
            validationLabel,
            safeMessageBuffer,
            safeTargetThreads,
            safeMaxPages,
            skipLabels
        ).threads;
    }

    /**
     * Fallback prudente/manuale che verifica le label sul singolo messaggio via metadata.
     */
    _discoverByMetadata(labelName, errorLabel, validationLabel, safeMessageBuffer, safeTargetThreads, safeMaxPages, skipLabel = null) {
        const processedLabelId = this._getOptionalLabelIdByName(labelName);
        const errorLabelId = this._getOptionalLabelIdByName(errorLabel);
        const validationLabelId = this._getOptionalLabelIdByName(validationLabel);
        const skipLabels = Array.isArray(skipLabel) ? skipLabel.filter(Boolean) : [skipLabel].filter(Boolean);
        const skipLabelIds = skipLabels
            .map(label => this._getOptionalLabelIdByName(label))
            .filter(Boolean);
        const excludedLabelIds = new Set([processedLabelId, errorLabelId, validationLabelId, ...skipLabelIds].filter(Boolean));

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

                let response = null;
                try {
                    response = this._listMessagesWithResilience(params);
                } catch (listError) {
                    console.error(`❌ [metadata] Interruzione discovery per list non recuperabile: ${listError.message}`);
                    break;
                }
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
    _discoverByQuery(labelName, errorLabel, validationLabel, safeMessageBuffer, safeTargetThreads, safeMaxPages, skipLabel = null) {
        const skipLabels = Array.isArray(skipLabel) ? skipLabel.filter(Boolean) : [skipLabel].filter(Boolean);
        // Non escludere labelName (es. IA): Gmail query può valutare label a livello thread
        // e nascondere nuovi follow-up non letti in thread già processati.
        const allExcludedLabels = [errorLabel, validationLabel, ...skipLabels].filter(Boolean);
        let query = `is:unread in:inbox`;
        allExcludedLabels.forEach(skipName => {
            const sq = this._formatLabelQueryValue(skipName);
            if (sq !== '""') query += ` -label:${sq}`;
        });

        const threads = [];
        const seenThreadIds = new Set();
        const seenMessageIds = new Set();

        try {
            // Utilizzo di GmailApp.search nativo per efficienza (batch recupero thread già pronti)
            // Invece di iterare sui singoli messaggi via API avanzata + getThreadById.
            // safeMessageBuffer e safeMaxPages non paginano direttamente GmailApp.search,
            // ma dimensionano il pool massimo di candidati esaminabili prima del filtro thread-level.
            const DISCOVERY_POOL_MULTIPLIER = 3;
            const discoveryPool = Math.min(500, Math.max(
                safeTargetThreads,
                Math.min(safeMessageBuffer * safeMaxPages, safeTargetThreads * DISCOVERY_POOL_MULTIPLIER)
            ));
            let searchResult = [];
            try {
                searchResult = GmailApp.search(query, 0, discoveryPool);
            } catch (searchError) {
                console.error(`❌ _discoverByQuery: GmailApp.search fallita: ${searchError.message}`);
                return {
                    threads: [],
                    threadIds: seenThreadIds,
                    messageIds: seenMessageIds
                };
            }

            const nativeThreads = Array.isArray(searchResult) ? searchResult : [];

            if (!Array.isArray(searchResult)) {
                console.warn('⚠️ GmailApp.search non ha restituito un array; considero 0 thread da elaborare.');
            }
            console.log(`📬 [query] GmailApp.search ha trovato ${nativeThreads.length} thread candidati`);

            for (const thread of nativeThreads) {
                if (!thread) continue;
                const threadId = thread.getId();
                if (seenThreadIds.has(threadId)) continue;

                // Verifichiamo che ci sia almeno un messaggio non letto nel thread
                // (GmailApp.search(is:unread) garantisce questo ma facciamo un check veloce)
                const messages = thread.getMessages();
                const unreadMessages = messages.filter(m => m.isUnread());
                
                if (unreadMessages.length > 0) {
                    seenThreadIds.add(threadId);
                    threads.push(thread);
                    // Registriamo il primo messaggio non letto come riferimento
                    seenMessageIds.add(unreadMessages[0].getId());
                }

                if (threads.length >= safeTargetThreads) break;
            }

            console.log(`📬 [query] Trovati ${threads.length} thread da elaborare`);
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
        if (!labelName) return '""';
        const trimmed = String(labelName).trim();
        if (!trimmed) return '""';

        // Gmail non supporta virgolette letterali nei nomi delle label nelle query.
        // Rimuoviamole per evitare di rompere la stringa racchiusa in "".
        const sanitized = trimmed.replace(/"/g, '');
        return `"${sanitized}"`;
    }

    _getOptionalLabelIdByName(labelName) {
        const raw = String(labelName || '').trim();
        if (!raw) return null;
        if (!this._labelCache || typeof this._labelCache.get !== 'function') {
            this._labelCache = new Map();
        }

        const cacheKey = this._getLabelCacheKey_(raw);
        const cachedEntry = this._labelCache.get(raw);
        const now = Date.now();
        if (cachedEntry && (now - cachedEntry.ts) < this._cacheTTL) {
            if (cachedEntry.labelId !== undefined) return cachedEntry.labelId;
            if (cachedEntry.label && typeof cachedEntry.label.getId === 'function') {
                return cachedEntry.label.getId();
            }
            return null;
        }

        if (this._scriptCache) {
            try {
                const cachedId = this._scriptCache.get(cacheKey);
                if (cachedId && cachedId !== '1') {
                    this._labelCache.set(raw, { ...(this._labelCache.get(raw) || {}), labelId: cachedId, ts: now });
                    return cachedId;
                }
            } catch (_) { }
        }

        // Fallback robusto: in ambienti dove Gmail.Users non è disponibile (es. test locali
        // o deployment senza servizio avanzato), usiamo GmailApp per verificare l'esistenza
        // della label e cache-iamo comunque il risultato (anche negativo).
        const hasGmailUsersList = (
            typeof Gmail !== 'undefined' &&
            Gmail &&
            Gmail.Users &&
            Gmail.Users.Labels &&
            typeof Gmail.Users.Labels.list === 'function'
        );
        if (!hasGmailUsersList) {
            try {
                // GmailApp.getUserLabelByName restituisce un GmailLabel utilizzabile con GmailApp,
                // ma non espone l'ID interno richiesto dalle Gmail Advanced API
                // (Gmail.Users.Messages.* vuole valori come "Label_123", non il display name).
                // Verifichiamo quindi solo l'esistenza per cache-are il lookup ed evitiamo di usare
                // getName() come falso ID: null forza i fallback GmailApp/thread-level sicuri.
                const nativeLabel = (typeof GmailApp !== 'undefined' && GmailApp && typeof GmailApp.getUserLabelByName === 'function')
                    ? GmailApp.getUserLabelByName(raw)
                    : null;
                const fallbackLabelId = null;
                this._labelCache.set(raw, { ...(this._labelCache.get(raw) || {}), labelId: fallbackLabelId, existsInGmailApp: !!nativeLabel, ts: now });
                return fallbackLabelId;
            } catch (e) {
                console.warn(`⚠️ _getOptionalLabelIdByName fallback GmailApp fallito per ${raw}, non metto in cache: ${e.message}`);
                return null;
            }
        }

        try {
            this._incrementGmailCallCounterOrThrow_('labels.list');
            const response = Gmail.Users.Labels.list('me');
            const apiLabels = (response && response.labels) ? response.labels : [];
            
            // Ottimizzazione: approfittiamo della chiamata list per popolare 
            // la cache di tutte le etichette scoperte, non solo quella richiesta.
            apiLabels.forEach(l => {
                if (l && l.name) {
                    this._labelCache.set(l.name, { ...(this._labelCache.get(l.name) || {}), labelId: l.id, ts: now });
                }
            });
            
            const matched = apiLabels.find(l => l && l.name === raw);
            return matched ? matched.id : null;
        } catch (e) {
            console.warn(`⚠️ _getOptionalLabelIdByName fallito per ${raw}, non metto in cache: ${e.message}`);
            return null;
        }
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
        const hasUtilitiesFormatDate = (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.formatDate === 'function');
        const hasSessionTimezone = (typeof Session !== 'undefined' && Session && typeof Session.getScriptTimeZone === 'function');

        if (hasUtilitiesFormatDate && hasSessionTimezone) {
            try {
                return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy/MM/dd');
            } catch (_) { }
        }

        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}/${mm}/${dd}`;
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
        let headersFound = false;
        const headers = {};
        try {
            const rawMessage = this._getMessageMetadataWithResilience(messageId, {
                format: 'metadata',
                metadataHeaders: [
                    'Message-ID',
                    'References',
                    'Auto-Submitted',
                    'Precedence',
                    'X-Autoreply',
                    'X-Auto-Response-Suppress',
                    'Reply-To',
                    'In-Reply-To',
                    'List-Unsubscribe'
                ]
            });
            if (!rawMessage) {
                throw new Error('Recupero metadati (headers) fallito: impossibile garantire il threading della conversazione');
            }
            if (rawMessage && rawMessage.payload && rawMessage.payload.headers) {
                headersFound = true;
                for (const header of rawMessage.payload.headers) {
                    if (!header || !header.name) continue;

                    const lowerName = String(header.name).toLowerCase().trim();
                    headers[lowerName] = header.value || '';

                    if (lowerName === 'message-id') {
                        rfc2822MessageId = header.value;
                    }
                    if (lowerName === 'references') {
                        existingReferences = header.value;
                    }
                    if (lowerName === 'in-reply-to') {
                        headers['in-reply-to'] = header.value || '';
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

        let replyTo = '';
        try {
            replyTo = message.getReplyTo();
        } catch (e) {
            replyTo = '';
        }

        let effectiveSender;
        let hasReplyTo = false;

        if (replyTo && replyTo.includes('@') && replyTo !== sender) {
            effectiveSender = replyTo;
            hasReplyTo = true;
            console.log(`   📧 Uso Reply-To: ${replyTo} (From originale: ${sender})`);
        } else {
            effectiveSender = sender;
        }

        const senderName = this.extractNameFromSender(effectiveSender);
        const senderEmail = this._extractEmailAddress(effectiveSender);

        let recipientEmail = null;
        try {
            const rawTo = message.getTo() || '';
            const matches = rawTo.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
            const normalizedMatches = matches.map(email => String(email || '').trim().toLowerCase()).filter(Boolean);
            const knownAliases = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.KNOWN_ALIASES))
                ? CONFIG.KNOWN_ALIASES.map(alias => String(alias || '').trim().toLowerCase()).filter(Boolean)
                : [];
            const botEmail = (typeof CONFIG !== 'undefined' && CONFIG.BOT_EMAIL)
                ? String(CONFIG.BOT_EMAIL).trim().toLowerCase()
                : '';
            const preferredRecipients = new Set([...knownAliases, botEmail].filter(Boolean));
            recipientEmail = normalizedMatches.find(email => preferredRecipients.has(email)) || normalizedMatches[0] || '';
        } catch (e) {
            // Silenzio sugli errori di parsing campo To; fallback applicato sotto.
        }
        if (!recipientEmail) {
            const hasSession = (typeof Session !== 'undefined' && Session);
            const effectiveUser = hasSession && typeof Session.getEffectiveUser === 'function'
                ? Session.getEffectiveUser()
                : null;
            recipientEmail = effectiveUser && typeof effectiveUser.getEmail === 'function'
                ? (effectiveUser.getEmail() || '')
                : '';
            if (!recipientEmail && typeof CONFIG !== 'undefined') {
                recipientEmail = CONFIG.BOT_EMAIL || (CONFIG.LOGGING && CONFIG.LOGGING.ADMIN_EMAIL) || '';
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
            inReplyTo: headers['in-reply-to'] || null,
            recipientEmail: recipientEmail,
            recipientCc: recipientCc,
            headers: headers,
            headersFound: headersFound,
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
            let contentType = rawContentType.split(';')[0].trim();
            const isPdf = contentType.includes('pdf');
            const isImage = contentType.startsWith('image/');
            let isOffice = Boolean(this._officeMimeMap[contentType]);

            if (!isOffice && (contentType === 'application/octet-stream' || contentType.startsWith('application/x-'))) {
                const ext = (attachmentName.split('.').pop() || '').toLowerCase();
                const extMap = {
                    doc: 'application/msword',
                    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    xls: 'application/vnd.ms-excel',
                    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    ppt: 'application/vnd.ms-powerpoint',
                    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    odt: 'application/vnd.oasis.opendocument.text',
                    ods: 'application/vnd.oasis.opendocument.spreadsheet',
                    odp: 'application/vnd.oasis.opendocument.presentation'
                };
                if (extMap[ext]) {
                    contentType = extMap[ext];
                    isOffice = true;
                }
            }
            const isText = contentType.includes('text/plain') || contentType.includes('text/csv');

            if (!isPdf && !isImage && !isOffice && !isText) {
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

            // Controlla Nome File Generico (Segnale Debole)
            const fileNameLower = attachmentName.toLowerCase();
            const suspiciousNames = ["img_", "dsc_", "photo", "whatsapp image", "image", "screenshot"];
            const isGenericName = suspiciousNames.some(name => fileNameLower.includes(name));

            // Estrazione testo: conversione diretta per Office, OCR per PDF/immagini
            let ocrText, ocrConfidence;
            if (isText) {
                ocrText = attachment.getDataAsString() || '';
                ocrConfidence = 1.0;
            } else if (isOffice) {
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
                    // Per i PDF usa un limite coerente con il cap pagine stimato,
                    // consentendo di superare il default generico quando necessario.
                    perFileLimit = estimatedLimit;
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
            const attachmentRole = this._classifyAttachmentRole(documentType, attachmentName, clipped);
            const extractedFields = this._extractDocumentFields(clipped, settings.documentFieldMasking !== false);

            items.push({
                name: attachmentName,
                contentType: contentType,
                size: size,
                ocrConfidence: ocrConfidence,
                documentType: documentType,
                attachmentRole: attachmentRole.attachmentRole,
                documentIntent: attachmentRole.documentIntent,
                intentContribution: attachmentRole.intentContribution,
                roleReason: attachmentRole.reason,
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
            const roleLine = item.attachmentRole
                ? `Ruolo allegato: ${item.attachmentRole}; intentContribution=${item.intentContribution}; documentIntent=${item.documentIntent}; reason=${item.roleReason || ''}`
                : '';
            const extractedFieldsLine = (item.extractedFields && item.extractedFields.length > 0)
                ? `Campi rilevati: ${item.extractedFields.join(' | ')}`
                : '';
            return [
                `(${idx + 1}) ${item.name} [${item.contentType || 'tipo sconosciuto'}, ${sizeKb}]`,
                docTypeLine,
                roleLine,
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
     * - XLS/XLSX: estratti come testo (tabellare) nel contesto
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
            skipped: [],
            items: []
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

            const supportedVisualImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
            const isSupportedVisualImage = supportedVisualImageTypes.includes(mimeType);

            // Evita richieste multimodali su micro-immagini decorative, immagini vettoriali/unsupported
            // (es. SVG/TIFF) e formati che possono stressare copyBlob/OCR in RAM.
            if (mimeType.startsWith('image/') && !isSupportedVisualImage) {
                result.skipped.push({ name: name, reason: 'unsupported_image_ignored', mimeType: mimeType, size: size });
                continue;
            }
            if (isSupportedVisualImage && size > 0 && size < 5120) {
                result.skipped.push({ name: name, reason: 'micro_image_ignored', size: size });
                continue;
            }

            if (mimeType.includes('text/plain') || mimeType.includes('text/csv')) {
                try {
                    const rawText = attachment.getDataAsString() || '';
                    let text = rawText;
                    if (maxCharsPerFile > 0 && text.length > maxCharsPerFile) {
                        text = text.substring(0, maxCharsPerFile);
                        result.skipped.push({ name: name, reason: 'text_truncated', kept: text.length, originalSize: rawText.length });
                    }
                    const documentType = this._detectDocumentType(name, text);
                    const attachmentRole = this._classifyAttachmentRole(documentType, name, text);
                    result.items.push({
                        name: name,
                        attachmentRole: attachmentRole.attachmentRole,
                        documentIntent: attachmentRole.documentIntent,
                        intentContribution: attachmentRole.intentContribution
                    });
                    const roleLine = `Ruolo allegato: ${attachmentRole.attachmentRole}; intentContribution=${attachmentRole.intentContribution}; documentIntent=${attachmentRole.documentIntent}`;
                    const segment = `\n\n--- Contenuto file: ${name} ---\n${roleLine}\n${text}`;
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
                try {
                    if (size > settings.maxBytesPerFile) {
                        result.skipped.push({ name: name, reason: 'too_large_for_blob', size: size });
                        continue;
                    }
                    const documentType = this._detectDocumentType(name, '');
                    const attachmentRole = this._classifyAttachmentRole(documentType, name, '');
                    result.items.push({
                        name: name,
                        attachmentRole: attachmentRole.attachmentRole,
                        documentIntent: attachmentRole.documentIntent,
                        intentContribution: attachmentRole.intentContribution
                    });
                    const roleLine = `Ruolo allegato: ${attachmentRole.attachmentRole}; intentContribution=${attachmentRole.intentContribution}; documentIntent=${attachmentRole.documentIntent}`;
                    result.textContext += `\n\n--- File visivo inviato: ${name} ---\n${roleLine}`;
                    result.blobs.push(attachment.copyBlob());
                    processedCount++;
                    continue;
                } catch (e) {
                    result.skipped.push({ name: name, reason: 'copy_blob_error', error: e.message });
                    continue;
                }
            }

            const googleMime = this._officeMimeMap[mimeType] || null;
            const isWord = googleMime === 'application/vnd.google-apps.document';
            const isExcel = googleMime === 'application/vnd.google-apps.spreadsheet';
            const isPowerPoint = googleMime === 'application/vnd.google-apps.presentation';

            if (!googleMime && !isWord && !isExcel && !isPowerPoint) {
                result.skipped.push({ name: name, reason: 'unsupported_type', mimeType: mimeType });
                continue;
            }

            // Excel (XLS/XLSX): preferisci testo contestuale invece di blob PDF
            if (isExcel) {
                try {
                    const googleMimeType = this._officeMimeMap[mimeType]
                        || 'application/vnd.google-apps.spreadsheet';
                    const extracted = this._extractOfficeText(attachment, googleMimeType, settings) || '';

                    if (!extracted.trim()) {
                        result.skipped.push({ name: name, reason: 'office_empty' });
                        continue;
                    }

                    let text = extracted;
                    if (maxCharsPerFile > 0 && text.length > maxCharsPerFile) {
                        text = text.substring(0, maxCharsPerFile);
                        result.skipped.push({
                            name: name,
                            reason: 'text_truncated',
                            kept: text.length,
                            originalSize: extracted.length
                        });
                    }

                    const documentType = this._detectDocumentType(name, text);
                    const attachmentRole = this._classifyAttachmentRole(documentType, name, text);
                    result.items.push({
                        name: name,
                        attachmentRole: attachmentRole.attachmentRole,
                        documentIntent: attachmentRole.documentIntent,
                        intentContribution: attachmentRole.intentContribution
                    });
                    const roleLine = `Ruolo allegato: ${attachmentRole.attachmentRole}; intentContribution=${attachmentRole.intentContribution}; documentIntent=${attachmentRole.documentIntent}`;
                    const segment = `\n\n--- Contenuto file: ${name} ---\n${roleLine}\n${text}`;
                    if (maxTotalChars > 0) {
                        const remaining = maxTotalChars - totalTextChars;
                        if (remaining <= 0) {
                            result.skipped.push({ name: name, reason: 'max_total_chars' });
                            continue;
                        }
                        const bounded = segment.length > remaining
                            ? segment.substring(0, remaining)
                            : segment;
                        if (bounded.length < segment.length) {
                            result.skipped.push({
                                name: name,
                                reason: 'max_total_chars',
                                kept: bounded.length
                            });
                        }
                        result.textContext += bounded;
                        totalTextChars += bounded.length;
                    } else {
                        result.textContext += segment;
                        totalTextChars += segment.length;
                    }

                    processedCount++;
                } catch (e) {
                    result.skipped.push({ name: name, reason: 'office_extract_error', error: e.message });
                }
                continue;
            }

            if (isWord || isPowerPoint) {
                if (typeof settings.shouldContinue === 'function' && !settings.shouldContinue()) {
                    result.skipped.push({ name: name, reason: 'near_deadline' });
                    break;
                }
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

        const startedAt = Date.now();
        const MAX_CONVERSION_MS = 15000; // 15s budget per singola conversione
        const exceededBudget = () => (Date.now() - startedAt) > MAX_CONVERSION_MS;

        let fileId = null;
        const tempFileName = `TEMP_CONV_${Date.now()}_${attachmentBlob.getName() || 'allegato'}`;
        try {
            if (exceededBudget()) {
                throw new Error('Budget temporale esaurito prima della conversione Office');
            }
            // getContentType() può includere parametri (es. "; charset=UTF-8"):
            // per la lookup in _officeMimeMap usiamo il mime base normalizzato.
            const originalMimeFull = attachmentBlob.getContentType() || '';
            const originalMime = originalMimeFull.split(';')[0].trim().toLowerCase();
            let googleMime = (this._officeMimeMap && this._officeMimeMap[originalMime]) ? this._officeMimeMap[originalMime] : null;
            if (!googleMime) {
                if (originalMime.includes('word')) googleMime = 'application/vnd.google-apps.document';
                else if (originalMime.includes('spreadsheet') || originalMime.includes('excel')) googleMime = 'application/vnd.google-apps.spreadsheet';
                else if (originalMime.includes('presentation') || originalMime.includes('powerpoint')) googleMime = 'application/vnd.google-apps.presentation';
            }

            if (typeof Drive.Files.insert === 'function') {
                const resource = {
                    title: tempFileName,
                    mimeType: originalMime
                };

                const file = Drive.Files.insert(resource, attachmentBlob.copyBlob(), { convert: true });
                fileId = file && file.id ? file.id : null;
                if (!fileId) {
                    console.error('❌ Drive.Files.insert ha avuto successo ma non ha restituito un file ID.');
                    throw new Error('Conversione fallita: file temporaneo senza id.');
                }
                this._rememberTemporaryDriveFile_(fileId);
            } else if (typeof Drive.Files.create === 'function') {
                if (!googleMime) {
                    throw new Error(`Conversione fallita: mimeType Office non supportato (${originalMime})`);
                }
                const resource = {
                    name: tempFileName,
                    mimeType: googleMime
                };
                const file = Drive.Files.create(resource, attachmentBlob.copyBlob(), {
                    fields: 'id,mimeType'
                });
                fileId = file && file.id ? file.id : null;
                if (!fileId) {
                    console.error('❌ Drive.Files.create ha avuto successo ma non ha restituito un file ID.');
                    throw new Error('Conversione fallita: file temporaneo senza id.');
                }
                this._rememberTemporaryDriveFile_(fileId);
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
            for (let attempt = 0; attempt < 5; attempt++) {
                if (exceededBudget()) {
                    throw new Error(`Timeout conversione Office dopo ${attempt} tentativi`);
                }
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

                if (exceededBudget()) {
                    break;
                }

                if (attempt < 4) {
                    Utilities.sleep(1000 * (attempt + 1));
                }
            }

            if (!pdfBlob) {
                throw lastError || new Error('Conversione Office->PDF fallita');
            }

            return pdfBlob;
        } catch (error) {
            // In caso di errore durante conversione/export, forza anche il cleanup
            // degli eventuali residui per ridurre accumulo file temporanei.
            try {
                this._cleanupOrphanedOcrFilesIfNeeded();
            } catch (_) { }
            throw error;
        } finally {
            if (!fileId && tempFileName && typeof Drive !== 'undefined' && Drive && Drive.Files &&
                typeof Drive.Files.list === 'function' &&
                (typeof Drive.Files.remove === 'function' || typeof Drive.Files.delete === 'function' || typeof Drive.Files.trash === 'function')) {
                try {
                    const escapedName = String(tempFileName).replace(/'/g, "\\'");
                    const queries = [
                        { q: `title = '${escapedName}' and 'me' in owners`, maxResults: 1 },
                        { q: `name = '${escapedName}' and 'me' in owners`, pageSize: 1 }
                    ];
                    for (const query of queries) {
                        let res = null;
                        try {
                            res = Drive.Files.list(query);
                        } catch (_) {
                            continue;
                        }
                        const files = res && (res.items || res.files) ? (res.items || res.files) : [];
                        if (files.length > 0 && files[0].id) {
                            if (typeof Drive.Files.remove === 'function') {
                                Drive.Files.remove(files[0].id);
                            } else if (typeof Drive.Files.delete === 'function') {
                                Drive.Files.delete(files[0].id);
                            } else {
                                Drive.Files.trash(files[0].id);
                            }
                            break;
                        }
                    }
                } catch (_) { }
            }
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
                    console.warn(`⚠️ Errore cancellazione file temporaneo ${fileId}: ${e.message}`);
                } finally {
                    // Rimuove dalla coda indipendentemente dall'esito: se la rimozione fallisce
                    // perché il file era già eliminato, non ha senso ritentare dalla coda.
                    this._forgetTemporaryDriveFile_(fileId);
                }
            }
        }
    }



    _cleanupOrphanedOcrFilesIfNeeded() {
        try {
            // La coda persistente ripara i crash avvenuti dopo la creazione del file temporaneo:
            // va drenata anche quando il cleanup orfani indicizzato per nome è ancora in throttle.
            this._cleanupQueuedTemporaryDriveFiles_();

            const cache = (typeof CacheService !== 'undefined' && CacheService && typeof CacheService.getScriptCache === 'function')
                ? CacheService.getScriptCache()
                : null;


            const throttleKey = 'OCR_ORPHAN_CLEANUP_LAST_RUN_V1';
            if (cache && cache.get(throttleKey)) {
                return;
            }

            // Backup persistente: CacheService può essere evicted prima del TTL.
            const props = (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function')
                ? PropertiesService.getScriptProperties()
                : null;
            const propKey = 'OCR_CLEANUP_LAST_TS';
            if (props) {
                const lastTs = parseInt(props.getProperty(propKey) || '0', 10);
                if ((Date.now() - lastTs) < 6 * 3600 * 1000) {
                    return;
                }
            }

            if (cache) {
                cache.put(throttleKey, String(Date.now()), 21599); // max una volta ogni 6 ore (evita edge-case al limite hard)
            }
            if (props) {
                try { props.setProperty(propKey, String(Date.now())); } catch (_) {}
            }

            this._cleanupOrphanedOcrFiles();
        } catch (e) {
            console.warn(`⚠️ Cleanup orfani OCR non eseguito: ${e.message}`);
        }
    }

    _cleanupOrphanedOcrFiles() {
        if (typeof Drive === 'undefined' || !Drive.Files || typeof Drive.Files.list !== 'function') {
            return;
        }

        const orphanMaxAgeHours = this._safePositiveInt((typeof CONFIG !== 'undefined' ? CONFIG.OCR_ORPHAN_MAX_AGE_HOURS : null), 1, 1, 24);
        const cutoffIso = new Date(Date.now() - (orphanMaxAgeHours * 60 * 60 * 1000))
            .toISOString()
            .replace(/\.\d{3}Z$/, 'Z');
        // Compatibilità Drive API v2/v3: cambiano nomi campo in query e shape della risposta.
        // Manteniamo doppia strategia per evitare cleanup silenziosamente inattivo.
        const v2Query = `(title contains 'OCR_' or title contains 'TEMP_CONV_') and 'me' in owners and trashed = false and modifiedDate < '${cutoffIso}'`;
        const v3Query = `(name contains 'OCR_' or name contains 'TEMP_CONV_') and 'me' in owners and trashed = false and modifiedTime < '${cutoffIso}'`;

        const cleanupStartedAtMs = Date.now();
        const cleanupMaxRuntimeMs = this._safePositiveInt((typeof CONFIG !== 'undefined' ? CONFIG.OCR_CLEANUP_MAX_RUNTIME_MS : null), 8000, 1000, 30000);
        let removed = 0;
        let pageToken = null;
        let stopCleanup = false;
        do {
            if (Date.now() - cleanupStartedAtMs > cleanupMaxRuntimeMs) {
                console.warn(`⚠️ Cleanup OCR interrotto preventivamente dopo ${removed} rimozioni per limite tempo (${cleanupMaxRuntimeMs}ms)`);
                break;
            }
            let response;
            try {
                response = Drive.Files.list({ q: v2Query, maxResults: 100, pageToken: pageToken });
            } catch (e) {
                try {
                    response = Drive.Files.list({ q: v3Query, pageSize: 100, pageToken: pageToken });
                } catch (v3Error) {
                    console.warn(`⚠️ Cleanup orfani OCR non disponibile: ${v3Error.message}`);
                    return;
                }
            }

            const files = response && (response.items || response.files) ? (response.items || response.files) : [];
            if (!files.length) {
                break;
            }

            for (const file of files) {
                if (Date.now() - cleanupStartedAtMs > cleanupMaxRuntimeMs) {
                    console.warn(`⚠️ Cleanup OCR interrotto durante la pagina dopo ${removed} rimozioni per limite tempo (${cleanupMaxRuntimeMs}ms)`);
                    pageToken = null;
                    break;
                }
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
            if (stopCleanup) {
                break;
            }
            pageToken = response.nextPageToken || null;
        } while (pageToken);

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
                    mimeType: originalMime,
                    parents: [{ id: 'root' }]
                };
                const file = Drive.Files.insert(resource, blob, { convert: true });
                if (!file || !file.id) {
                    throw new Error('Drive API ha restituito un file convertito non valido (id assente)');
                }
                fileId = file.id;
                this._rememberTemporaryDriveFile_(fileId);
            } else if (typeof Drive.Files.create === 'function') {
                const resource = {
                    name: `OCR_${fileName}`,
                    mimeType: googleMimeType
                };
                const file = Drive.Files.create(resource, blob, {
                    fields: 'id,mimeType'
                });
                if (!file || !file.id) {
                    throw new Error('Drive API ha restituito un file convertito non valido (id assente)');
                }
                if (file.mimeType && file.mimeType !== googleMimeType) {
                    throw new Error(`Conversione Office non applicata (mimeType=${file.mimeType})`);
                }
                fileId = file.id;
                this._rememberTemporaryDriveFile_(fileId);
            } else {
                throw new Error('Drive.Files non espone metodi compatibili (insert/create)');
            }
            if (exceededBudget()) {
                console.warn('⚠️ Timeout estrazione Office: budget superato dopo conversione Drive');
                return '';
            }

            let openedDoc = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    if (googleMimeType === 'application/vnd.google-apps.document') {
                        openedDoc = DocumentApp.openById(fileId);
                    } else if (googleMimeType === 'application/vnd.google-apps.spreadsheet') {
                        openedDoc = SpreadsheetApp.openById(fileId);
                    } else if (googleMimeType === 'application/vnd.google-apps.presentation') {
                        openedDoc = SlidesApp.openById(fileId);
                    }
                    if (openedDoc) break;
                } catch (openError) {
                    if (attempt === 2 || exceededBudget()) throw openError;
                    Utilities.sleep(1000 * (attempt + 1));
                }
            }

            // Estrazione testo in base al tipo Google Workspace
            if (googleMimeType === 'application/vnd.google-apps.document') {
                // Parola → Documenti Google
                return openedDoc.getBody().getText();
            }

            if (googleMimeType === 'application/vnd.google-apps.spreadsheet') {
                // Excel → Google Sheets: concatena il testo di tutte le celle non vuote
                const sheets = openedDoc.getSheets();
                const parts = [];
                const maxSheets = Math.min(sheets.length, 3); // Limita a 3 fogli
                for (let s = 0; s < maxSheets; s++) {
                    if (typeof settings.shouldContinue === 'function' && !settings.shouldContinue()) break;
                    if (exceededBudget()) break;
                    const sheet = sheets[s];
                    const lastRow = Math.min(sheet.getLastRow(), 100); // Limite a 100 righe
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
                const slides = openedDoc.getSlides();
                const parts = [];
                const maxSlides = Math.min(slides.length, 10); // Limita a 10 diapositivi
                for (let i = 0; i < maxSlides; i++) {
                    if (typeof settings.shouldContinue === 'function' && !settings.shouldContinue()) break;
                    if (exceededBudget()) break;
                    const slide = slides[i];
                    const shapes = slide.getShapes();
                    const slideTexts = [];
                    for (const shape of shapes) {
                        if (exceededBudget()) break;
                        try {
                            const tf = shape.getText();
                            if (tf) {
                                const text = tf.asString().trim();
                                if (text) slideTexts.push(text);
                            }
                        } catch (_) {
                            // Ignora shape non testuali o non leggibili
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
                    this._forgetTemporaryDriveFile_(fileId);
                } catch (e) {
                    console.warn(`⚠️ Cleanup file Office fallito (${fileId}): ${e.message}`);
                }
            }
        }
    }

    _extractOcrTextFromAttachment(attachment, settings) {
        let fileId = null;
        const startedAt = Date.now();
        const maxDurationMs = Number(settings && settings.maxAttachmentProcessingMs) > 0
            ? Number(settings.maxAttachmentProcessingMs)
            : 20000;
        const exceededBudget = () => (Date.now() - startedAt) > maxDurationMs;
        try {
            if (typeof settings.shouldContinue === 'function' && !settings.shouldContinue()) {
                return '';
            }
            if (exceededBudget()) {
                console.warn('⚠️ OCR allegato: budget temporale già esaurito prima di iniziare');
                return '';
            }

            if (typeof Drive === 'undefined' || !Drive.Files) {
                throw new Error('Drive Advanced Service non abilitato');
            }

            const blob = attachment.copyBlob();
            const fileName = attachment.getName() || 'allegato';
            const targetMimeType = 'application/vnd.google-apps.document';

            if (typeof Drive.Files.create === 'function') {
                const resource = {
                    name: `OCR_${fileName}`,
                    // Drive API v3: per ottenere testo OCR apribile con DocumentApp,
                    // il file caricato va convertito in Google Doc.
                    mimeType: targetMimeType
                };
                const file = Drive.Files.create(resource, blob, {
                    fields: 'id,mimeType',
                    ocrLanguage: settings.ocrLanguage || 'it'
                });
                if (!file || !file.id) {
                    throw new Error('Drive API ha restituito un file OCR non valido (id assente)');
                }
                if (file.mimeType && file.mimeType !== targetMimeType) {
                    throw new Error(`Conversione OCR non applicata (mimeType=${file.mimeType})`);
                }
                fileId = file.id;
                this._rememberTemporaryDriveFile_(fileId);
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
                this._rememberTemporaryDriveFile_(fileId);
            } else {
                throw new Error('Drive.Files non espone metodi OCR compatibili (create/insert)');
            }

            const doc = DocumentApp.openById(fileId);
            const ocrText = (doc && doc.getBody()) ? doc.getBody().getText() : '';
            return ocrText || '';
        } catch (e) {
            console.warn(`⚠️ OCR allegato fallito: ${e.message}`);
            return '';
        } finally {
            if (fileId) {
                try {
                    if (typeof Drive.Files.trash === 'function') {
                        Drive.Files.trash(fileId);
                    } else if (typeof Drive.Files.delete === 'function') {
                        Drive.Files.delete(fileId);
                    } else if (typeof Drive.Files.remove === 'function') {
                        // Fallback legacy (potrebbe non supportare signature a 1 argomento)
                        Drive.Files.remove(fileId);
                    }
                    this._forgetTemporaryDriveFile_(fileId);
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
        // Ridotto a 15 per consentire dati strutturati brevi (es. Codice Fiscale).
        if (cleaned.length < 15) return false;

        // 1.5 Fast-path per identificativi strutturati (anche con poche lettere, es. IBAN)
        const compact = cleaned.replace(/\s+/g, '').toUpperCase();
        const looksLikeCF = /[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]/.test(compact);
        const looksLikeIBAN = /IT[0-9]{2}[A-Z][0-9]{22}/.test(compact) || /[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}/.test(compact);
        if (looksLikeCF || looksLikeIBAN) return true;

        // 2. Filtro Contenuto Alfabetico (Immagini nere/rumore)
        // Conta le lettere effettive (a-z, A-Z)
        const letters = (cleaned.match(/[a-zA-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/g) || []).length;
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

        const alnumCount = (cleaned.match(/[a-zA-Z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/g) || []).length;
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

    _getTemporaryDriveQueueStore_() {
        if (typeof PropertiesService === 'undefined' || !PropertiesService ||
            typeof PropertiesService.getScriptProperties !== 'function') {
            return null;
        }
        return PropertiesService.getScriptProperties();
    }

    _rememberTemporaryDriveFile_(fileId) {
        if (!fileId) return;
        const store = this._getTemporaryDriveQueueStore_();
        if (!store) return;

        const key = 'TEMP_DRIVE_FILE_QUEUE_V1';
        try {
            let queue = [];
            try {
                queue = JSON.parse(store.getProperty(key) || '[]');
            } catch (_) {
                queue = [];
            }
            if (!Array.isArray(queue)) queue = [];

            const now = Date.now();
            queue = queue
                .filter(item => item && item.id && item.id !== fileId)
                .slice(-49);
            queue.push({ id: String(fileId), ts: now });
            store.setProperty(key, JSON.stringify(queue));
        } catch (e) {
            console.warn(`⚠️ Impossibile registrare file temporaneo Drive ${fileId}: ${e.message}`);
        }
    }

    _forgetTemporaryDriveFile_(fileId) {
        if (!fileId) return;
        const store = this._getTemporaryDriveQueueStore_();
        if (!store) return;

        const key = 'TEMP_DRIVE_FILE_QUEUE_V1';
        try {
            let queue = [];
            try {
                queue = JSON.parse(store.getProperty(key) || '[]');
            } catch (_) {
                queue = [];
            }
            if (!Array.isArray(queue)) queue = [];

            const nextQueue = queue.filter(item => item && item.id && item.id !== fileId);
            if (nextQueue.length === 0) {
                store.deleteProperty(key);
            } else if (nextQueue.length !== queue.length) {
                store.setProperty(key, JSON.stringify(nextQueue));
            }
        } catch (e) {
            console.warn(`⚠️ Impossibile aggiornare coda file temporanei Drive: ${e.message}`);
        }
    }

    _deleteTemporaryDriveFile_(fileId) {
        if (!fileId || typeof Drive === 'undefined' || !Drive || !Drive.Files) return false;

        if (typeof Drive.Files.remove === 'function') {
            Drive.Files.remove(fileId);
            return true;
        }
        if (typeof Drive.Files.delete === 'function') {
            Drive.Files.delete(fileId);
            return true;
        }
        if (typeof Drive.Files.trash === 'function') {
            Drive.Files.trash(fileId);
            return true;
        }
        return false;
    }

    _cleanupQueuedTemporaryDriveFiles_() {
        const store = this._getTemporaryDriveQueueStore_();
        if (!store) return;

        const key = 'TEMP_DRIVE_FILE_QUEUE_V1';
        let queue = [];
        try {
            queue = JSON.parse(store.getProperty(key) || '[]');
        } catch (_) {
            queue = [];
        }
        if (!Array.isArray(queue) || queue.length === 0) return;

        const retained = [];
        let removed = 0;
        for (const item of queue) {
            if (!item || !item.id) continue;
            try {
                if (this._deleteTemporaryDriveFile_(item.id)) {
                    removed++;
                } else {
                    retained.push(item);
                }
            } catch (e) {
                const msg = String(e && e.message || '').toLowerCase();
                if (msg.includes('not found') || msg.includes('file not found') || msg.includes('404')) {
                    removed++;
                } else {
                    retained.push(item);
                    console.warn(`⚠️ Impossibile rimuovere file temporaneo Drive in coda (${item.id}): ${e.message}`);
                }
            }
        }

        if (retained.length === 0) {
            store.deleteProperty(key);
        } else {
            store.setProperty(key, JSON.stringify(retained.slice(-50)));
        }

        if (removed > 0) {
            console.log(`🧹 Cleanup Drive: rimossi ${removed} file temporanei in coda`);
        }
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

        // Regex IBAN più stringente: 2 lettere + 2 cifre + 15-30 alfanumerici (min 15 per evitare collisioni)
        const ibanRegex = /\b[A-Z]{2}\d{2}[A-Z0-9]{15,30}\b/i;
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

    extractNameFromSender(fromField) {
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

        // Preserva separatori originali (spazi e trattini)
        return name.replace(/\b\w+/g, word => {
            if (word.length === 0) return word;
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        });
    }

    _extractEmailAddress(fromField) {
        const safeFrom = String(fromField || '');
        if (!safeFrom) return '';

        const angleMatch = safeFrom.match(/<([^>]+@[^>]+)>/);
        if (angleMatch) {
            const inner = String(angleMatch[1]).replace(/[\r\n]+/g, ' ').trim();
            const innerMatch = inner.match(/^[A-Za-z0-9._%+'!#=-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/);
            if (innerMatch) return innerMatch[0];
        }

        // Evita regex RFC5322 troppo complesse (rischio backtracking su input malevoli).
        // Header From di Gmail sono già sanificati: pattern snello e lineare è sufficiente.
        const safeFromField = safeFrom.length > 2048 ? safeFrom.substring(0, 2048) : safeFrom;
        const emailMatch = safeFromField.match(/[A-Za-z0-9._%+'!#=-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        if (emailMatch) {
            return emailMatch[0];
        }

        return '';
    }

    _htmlToPlainText(html) {
        if (!html) return '';

        // Troncamento preventivo: evita timeout V8 su HTML anomalo/massivo durante replace regex.
        let text = html.length > 50000 ? html.substring(0, 50000) : html;
        // Rimuove blocchi di codice/stile che altrimenti finirebbero nel prompt testuale.
        text = text.replace(/<(style|script)\b[^>]*>[\s\S]{0,5000}?<\/\1>/gi, '');
        // Preserva separatori strutturali per evitare blocchi di testo illeggibili.
        text = text.replace(/<br\s*\/?\s*>/gi, '\n');
        text = text.replace(/<\/p\s*>/gi, '\n\n');
        text = text.replace(/<\/div\s*>/gi, '\n');

        // Evita di rimuovere espressioni testuali tipo "A < B > C" trattando solo tag HTML plausibili
        text = text.replace(/<\/?(?:[a-z]+[1-6]?)(?:\s+[^>]*)?>/gi, ' ');

        // Fallback simboli per plain text (evita mojibake in ambienti non-UTF8)
        text = text
            .replace(/[\u2713\u2714]/g, '[OK]')
            .replace(/[\u274C\u2716\u2717]/g, '[X]')
            .replace(/[\u26A0]/g, '[!]')
            .replace(/\uD83D\uDCE7/g, '[Email]')
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2018\u2019]/g, "'");

        text = text.replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#(\d+);/g, (match, dec) => {
                const code = Number(dec);
                if (!Number.isFinite(code)) return match;
                try {
                    return String.fromCodePoint(code);
                } catch (_) {
                    return match;
                }
            })
            .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
                const code = Number.parseInt(hex, 16);
                if (!Number.isFinite(code)) return match;
                try {
                    return String.fromCodePoint(code);
                } catch (_) {
                    return match;
                }
            });
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
    getThreadHistory(messages, maxMessages = 10, ourEmail = '', ourAliases = []) {
        const normalizeOwnAddress = (value) => {
            if (!value) return '';
            const extracted = String(this._extractEmailAddress(value) || value).trim().toLowerCase();
            const atIdx = extracted.lastIndexOf('@');
            if (atIdx <= 0) return extracted;

            let local = extracted.substring(0, atIdx);
            let domain = extracted.substring(atIdx + 1);
            if (domain === 'googlemail.com') domain = 'gmail.com';
            if (domain === 'gmail.com') {
                local = local.replace(/\+.*/, '').replace(/\./g, '');
            }

            return `${local}@${domain}`;
        };

        const ownAddresses = new Set();
        const addOwnAddress = (value) => {
            const normalized = normalizeOwnAddress(value);
            if (normalized) ownAddresses.add(normalized);
        };

        if (!ourEmail) {
            if (typeof Session !== 'undefined' && Session && typeof Session.getEffectiveUser === 'function') {
                const effectiveUser = Session.getEffectiveUser();
                ourEmail = effectiveUser ? effectiveUser.getEmail() : '';
            }
        }

        addOwnAddress(ourEmail);
        (Array.isArray(ourAliases) ? ourAliases : []).forEach(addOwnAddress);
        if (typeof GmailApp !== 'undefined' && GmailApp && typeof GmailApp.getAliases === 'function') {
            try {
                (GmailApp.getAliases() || []).forEach(addOwnAddress);
            } catch (e) {
                console.warn(`⚠️ Impossibile leggere alias Gmail in getThreadHistory: ${e && e.message ? e.message : e}`);
            }
        }
        const knownAliases = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.KNOWN_ALIASES))
            ? CONFIG.KNOWN_ALIASES
            : [];
        knownAliases.forEach(addOwnAddress);

        if (messages.length > maxMessages) {
            console.warn(`⚠️ Thread con ${messages.length} messaggi, limitato a ultimi ${maxMessages}`);
            messages = messages.slice(-maxMessages);
        }

        const history = [];

        for (const msg of messages) {
            const details = this._extractMessageDetailsLite(msg);
            const normalizedSender = normalizeOwnAddress(details.senderEmail);
            const isOurs = normalizedSender && ownAddresses.has(normalizedSender);

            const prefix = isOurs ? 'Segreteria' : `Utente (${details.senderName})`;

            let body = details.body;
            if (body.length > 2000) {
                body = body.substring(0, 2000) + '\n[... messaggio troncato ...]';
            }

            history.push(`${prefix}: ${body}\n---`);
        }

        return history.join('\n');
    }

    /**
     * Estrazione leggera dettagli messaggio (senza fetch metadata API).
     * Usata per la sola costruzione della history conversazionale.
     */
    _extractMessageDetailsLite(message) {
        if (message && typeof message === 'object' && 'senderEmail' in message && 'body' in message) {
            return {
                senderName: message.senderName || this.extractNameFromSender(message.senderEmail || ''),
                senderEmail: message.senderEmail || '',
                body: message.body || ''
            };
        }

        let sender = '';
        try { sender = message.getFrom() || ''; } catch (e) {}

        let body = '';
        try {
            body = message.getPlainBody() || this._htmlToPlainText(message.getBody() || '');
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            console.warn(`⚠️ _extractMessageDetailsLite: impossibile leggere body (${msg})`);
        }
        body = this.extractMainReply(body);

        return {
            senderName: this.extractNameFromSender(sender),
            senderEmail: this._extractEmailAddress(sender),
            body: body || ''
        };
    }

    // ========================================================================
    // RIMOZIONE CITAZIONI/FIRME
    // ========================================================================

    extractMainReply(content) {
        const markers = [
            /^On .* wrote:/m,
            /^Il giorno .* ha scritto:/m,
            /^-{3,}.*Original Message/im,
            /^-{3,}.*Messaggio originale/im
        ];

        let result = content;
        let earliestMatch = -1;

        for (const marker of markers) {
            const match = result.search(marker);
            if (match !== -1 && (earliestMatch === -1 || match < earliestMatch)) {
                earliestMatch = match;
            }
        }

        if (earliestMatch !== -1) {
            result = result.substring(0, earliestMatch);
        }

        const sigMarkers = [
            /^cordiali\s+saluti[\s,!.-]*$/im,
            /^distinti\s+saluti[\s,!.-]*$/im,
            /^saluti[\s,!.-]*$/im,
            /^in\s+fede[\s,!.-]*$/im,
            /^best\s+regards[\s,!.-]*$/im,
            /^sincerely[\s,!.-]*$/im,
            /^sent\s+from\s+my\s+iphone[\s,!.-]*$/im,
            /^inviato\s+da\b.*$/im
        ];

        // Ricerca firma "tail-aware":
        // - email brevi: cerca su tutto il testo (evita falsi negativi)
        // - email lunghe: concentra la ricerca sulle ultime ~600 chars
        const signatureSearchStart = Math.max(0, result.length - 600);
        const signatureTail = result.substring(signatureSearchStart);

        let earliestSigMatch = -1;
        for (const marker of sigMarkers) {
            const match = signatureTail.search(marker);
            if (match === -1) continue;

            const absoluteMatch = signatureSearchStart + match;
            const prefix = result.substring(0, absoluteMatch);

            // Tronca solo se la firma è su una nuova sezione (dopo riga vuota)
            if (/\n\s*$/.test(prefix) || absoluteMatch === 0) {
                if (earliestSigMatch === -1 || absoluteMatch < earliestSigMatch) {
                    earliestSigMatch = absoluteMatch;
                }
            }
        }
        if (earliestSigMatch !== -1) {
            result = result.substring(0, earliestSigMatch);
        }

        return result.trim();
    }

    // ========================================================================
    // INVIO RISPOSTA
    // ========================================================================

    sendReply(thread, replyText, messageDetails) {
        const gmailThread = typeof thread === 'string' ?
            GmailApp.getThreadById(thread) : thread;

        this.sendHtmlReply(gmailThread, replyText, messageDetails || {});

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
        const finalResponse = responseText == null ? '' : String(responseText);

        const htmlBody = (typeof markdownToHtml === 'function')
            ? markdownToHtml(finalResponse)
            : finalResponse
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br>');
        const plainText = this._htmlToPlainText(htmlBody);

        const hasThreadingInfo = messageDetails.rfc2822MessageId;
        let apiSendError = null;

        const safeSessionEmail = (getterName) => {
            try {
                if (
                    typeof Session === 'undefined' ||
                    !Session ||
                    typeof Session[getterName] !== 'function'
                ) {
                    return '';
                }
                const user = Session[getterName]();
                return (user && typeof user.getEmail === 'function')
                    ? String(user.getEmail() || '').replace(/[\r\n]+/g, '').trim()
                    : '';
            } catch (e) {
                return '';
            }
        };

        // Da stabile: priorità all'indirizzo di ricezione solo se autorizzato
        // (utente effettivo/attivo o alias configurato in Gmail).
        const recipientFallbackEmail = this._extractEmailAddress(messageDetails.recipientEmail || '');
        const effectiveUser = safeSessionEmail('getEffectiveUser');
        const activeUser = safeSessionEmail('getActiveUser');

        let stableFrom = null;
        if (recipientFallbackEmail) {
            const allowedFrom = [effectiveUser, activeUser]
                .filter(Boolean)
                .map((value) => String(value).toLowerCase());
            try {
                const aliases = GmailApp.getAliases() || [];
                aliases.forEach((alias) => {
                    const normalized = String(alias || '').trim().toLowerCase();
                    if (normalized) allowedFrom.push(normalized);
                });
            } catch (_) { }

            if (allowedFrom.includes(String(recipientFallbackEmail).toLowerCase())) {
                stableFrom = recipientFallbackEmail;
            }
        }

        if (!stableFrom) {
            stableFrom = effectiveUser || activeUser || recipientFallbackEmail || null;
        }

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
                if (!/^(re|rif|r|ris|risp|aw|sv|fw|fwd|tr)\s*:/i.test(replySubject)) {
                    replySubject = 'Re: ' + replySubject;
                }

                const referenceIds = [];
                const collectReferenceIds = (value) => {
                    const matches = String(value || '')
                        .replace(/[\r\n]+/g, ' ')
                        .match(/<[^<>\s]+>/g) || [];
                    matches.forEach((id) => {
                        if (!referenceIds.includes(id)) {
                            referenceIds.push(id);
                        }
                    });
                };


                if (!stableFrom) {
                    throw new Error('Impossibile determinare un mittente valido per Gmail RAW');
                }

                // La specifica Gmail RAW richiede un Message-ID valido per l'header In-Reply-To.
                // Se non disponibile/valido, inviamo comunque via RAW con threadId e Subject pulito.
                const originalMessageId = this._normalizeRfcMessageId(messageDetails.rfc2822MessageId || '');
                collectReferenceIds(messageDetails.existingReferences || '');
                if (originalMessageId) {
                    collectReferenceIds(originalMessageId);
                }
                const boundedReferenceChain = referenceIds.slice(-20).join(' ');

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
                const encodeAddress = (addr) => {
                    const match = addr.match(/^(.*?)<(.+?)>$/);
                    if (!match) return addr;
                    const name = match[1].trim();
                    const email = match[2].trim();
                    if (!name || /^[\x00-\x7F]*$/.test(name)) return addr;
                    return `=?UTF-8?B?${this._base64EncodeUtf8_(name)}?= <${email}>`;
                };
                const safeFrom = encodeAddress(String(stableFrom || '').replace(/[\r\n]+/g, '').trim());
                const safeTo = encodeAddress(String(messageDetails.senderEmail || '').replace(/[\r\n]+/g, '').trim());
                const rawHeaders = [
                    'MIME-Version: 1.0',
                    `Date: ${new Date().toUTCString()}`,
                    `From: ${safeFrom}`,
                    `To: ${safeTo}`,
                    this._buildFoldedUtf8SubjectHeader(replySubject),
                    originalMessageId ? this._buildFoldedTokenHeader('In-Reply-To', originalMessageId) : '',
                    boundedReferenceChain ? this._buildFoldedTokenHeader('References', boundedReferenceChain) : '',
                    `Content-Type: multipart/alternative; boundary="${boundary}"`
                ].filter(Boolean);

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
                    this._chunkBase64(this._base64EncodeUtf8_(plainText)),
                    '',
                    `--${boundary}`,
                    'Content-Type: text/html; charset=UTF-8',
                    'Content-Transfer-Encoding: base64',
                    '',
                    this._chunkBase64(this._base64EncodeUtf8_(htmlBody)),
                    '',
                    `--${boundary}--`,
                    ''
                ].join('\r\n');

                // Gmail API RAW richiede base64url RFC4648 senza padding finale '='.
                let encodedMessage = this._base64UrlEncodeUtf8_(rawMessage);
                encodedMessage = encodedMessage.replace(/=+$/, '');

                this._incrementGmailCallCounterOrThrow_('messages.send');
                Gmail.Users.Messages.send({
                    raw: encodedMessage,
                    threadId: threadId
                }, 'me');

                console.log(`✓ Risposta HTML inviata via Gmail API a ${messageDetails.senderEmail}`);
                console.log(`   📧 Threading headers: In-Reply-To=${messageDetails.rfc2822MessageId.substring(0, 30)}...`);
                return;

            } catch (apiError) {
                apiSendError = apiError;
                const errMsg = String((apiError && apiError.message) || '').toLowerCase();
                if (
                    errMsg.includes('timeout')
                    || errMsg.includes('deadline')
                    || /\b(503|504)\b/.test(errMsg)
                ) {
                    throw new Error(`Timeout API avanzata: fallback nativo bloccato (${apiError.message})`);
                }
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
            const fallbackOptions = { htmlBody: htmlBody };
            if (stableFrom && stableFrom !== effectiveUser) {
                fallbackOptions.from = stableFrom;
            }
            mailEntity.reply(fallbackBody, fallbackOptions);
            console.log(`✓ Risposta HTML inviata a ${messageDetails.senderEmail} (metodo alternativo nativo)`);
        } catch (error) {
            console.error(`❌ Risposta fallita: ${error.message}`);
            try {
                mailEntity.reply(plainText || this._stripHtmlTags(finalResponse));
                console.log(`✓ Risposta plain text inviata a ${messageDetails.senderEmail} (alternativa)`);
            } catch (fallbackError) {
                let threadFallbackError = null;
                try {
                    const threadEntity = (mailEntity && typeof mailEntity.getThread === 'function')
                        ? mailEntity.getThread()
                        : null;
                    if (threadEntity && typeof threadEntity.reply === 'function') {
                        threadEntity.reply(plainText || this._stripHtmlTags(finalResponse));
                        console.log(`✓ Risposta plain text inviata a ${messageDetails.senderEmail} (fallback thread-level)`);
                        return;
                    }
                } catch (e) {
                    threadFallbackError = e;
                }

                console.error(`❌ CRITICO: Invio risposta alternativo fallito: ${fallbackError.message}`);
                const errorLabel = (typeof CONFIG !== 'undefined' && CONFIG.ERROR_LABEL_NAME) ? CONFIG.ERROR_LABEL_NAME : 'Errore';
                if (mailEntity) {
                    try {
                        const targetThread = (typeof mailEntity.getThread === 'function')
                            ? mailEntity.getThread()
                            : mailEntity;

                        if (targetThread && typeof targetThread.getMessages === 'function') {
                            this.addLabelToThread(targetThread, errorLabel);
                        }
                    } catch (labelErr) {
                        console.warn(`⚠️ Impossibile applicare label di errore: ${labelErr.message}`);
                    }
                }
                const rootCauses = [];
                if (apiSendError && apiSendError.message) {
                    rootCauses.push(`Gmail API: ${apiSendError.message}`);
                }
                rootCauses.push(`Fallback nativo: ${fallbackError.message}`);
                if (threadFallbackError && threadFallbackError.message) {
                    rootCauses.push(`Fallback thread: ${threadFallbackError.message}`);
                }
                throw new Error(rootCauses.join(' | '));
            }
        }
    }

    _stripHtmlTags(text) {
        if (!text) return '';
        return text
            // Rimuove tag HTML con pattern lineare per prevenire Catastrophic Backtracking (ReDoS).
            .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/#{1,4}\s+/g, '')
            // Mantieni link leggibile: [Testo](URL) -> Testo (URL)
            .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    // ========================================================================
    // SAFEGUARD DI FORMATTAZIONE
    // ========================================================================

    // ========================================================================
    // SAFEGUARD DI FORMATTAZIONE
    // ========================================================================

    /**
     * Prepara il testo per l'invio applicando sanificazione, sostituzioni e correzioni.
     */
    prepareOutboundText(responseText, messageDetails, languageCode) {
        let finalResponse = this._sanitizeHeaders(responseText);
        if (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE.replacements) {
            finalResponse = this.applyReplacements(finalResponse, GLOBAL_CACHE.replacements);
        }
        // Evita alterazioni meccaniche del casing dopo la generazione LLM:
        // in output multilingua può corrompere nomi propri e saluti.
        return this.ensureGreetingLineBreak(finalResponse);
    }

    /**
     * Corregge errori comuni di punteggiatura
     * Gestisce eccezioni per nomi doppi (es. "Maria Isabella")
     */
    fixPunctuation(text, senderName = '') {
        if (!text) return text;

        // 0. Normalizzazione Encoding: converte smart quotes in standard ASCII
        // e rimuove caratteri di controllo invisibili che possono corrompere il layout.
        text = text
            .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
            .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/[\u200B-\u200D\uFEFF]/g, '');

        // Intenzionale: array locale ricreato a ogni chiamata, quindi la mutazione
        // serve solo ad ampliare le eccezioni per il messaggio corrente.
        const baseExceptions = ['Don', 'Padre', 'Suor', 'Monsignor', 'Papa', 'Signore', 'Signora'];
        const exceptionsSet = new Set(baseExceptions);

        if (senderName) {
            const nameParts = senderName.split(/\s+/);
            for (const part of nameParts) {
                if (part) {
                    exceptionsSet.add(part);
                }
            }
        }

        // Evita di alterare acronimi/parole interamente maiuscole (es. "ISEE", "INVIA")
        // Range esplicitamente ristretto per coprire accentate europee escludendo simboli matematici (×, ÷).
        return text.replace(/(,\s+)([A-Z\u00C0-\u00D6\u00D8-\u00DE])([a-z\u00DF-\u00FF]+)/g, (match, commaAndSpace, firstLetter, rest, offset) => {
            // Eccezione per elenchi numerati (es: "1, Partecipanti")
            const beforeMatch = text.substring(Math.max(0, offset - 5), offset);
            if (beforeMatch.match(/\d+$/)) {
                return match;
            }

            const word = firstLetter + rest;
            if (exceptionsSet.has(word)) {
                return match;
            }

            const afterMatch = text.substring(offset + match.length);

            // Eccezione per virgola/punto successivo
            if (afterMatch.match(/^\s*[,.]/)) {
                return match;
            }

            // Eccezione per congiunzione "e" seguita da nome (es. "Maria e Giovanni,")
            if (afterMatch.match(/^\s+e\s+[A-Z\u00C0-\u00DE][a-z\u00DF-\u00FF]*\s*[,.]/)) {
                return match;
            }

            // Euristica nomi doppi: se la parola è seguita da un'altra parola maiuscola,
            // probabilmente sono nomi propri (es. "Maria Isabella", "Gian Luca", "Carlo Alberto")
            if (afterMatch.match(/^\s+[A-Z\u00C0-\u00DE][a-z\u00DF-\u00FF]+\s+[A-Z\u00C0-\u00DE][a-z\u00DF-\u00FF]+/)) {
                return match;
            }

            return `${commaAndSpace}${firstLetter.toLowerCase()}${rest}`;
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
            // Usa callback per evitare l'interpretazione dei pattern speciali ($1, $&, $', $`).
            result = result.replace(regex, () => good);

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
            .replace(/\r\n|\r/g, '\n')
            .replace(/(^|\n)(To|Cc|Bcc|From|Subject|Reply-To):/gi, '$1[$2]:');
    }

    _sanitizeSubjectForHeader(subject) {
        const safe = (subject === null || subject === undefined) ? '' : String(subject);
        const folded = safe
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/^(?:to|cc|bcc|from|subject|reply-to)\s*:/gi, '')
            // Rimuove eventuali Message-ID appesi all'oggetto (es: <abc@mail.gmail.com>)
            .replace(/\s*<[^<>\s]+@[^<>\s]+>\s*/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
        return folded || 'Re:';
    }

    _normalizeRfcMessageId(value) {
        const raw = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
        if (!raw) return '';
        const match = raw.match(/<[^<>\s]+@[^<>\s]+>/);
        if (match) return match[0];
        if (/^[^<>\s@]+@[^<>\s@]+$/.test(raw)) return `<${raw}>`;
        return '';
    }

    /**
     * Crea header Subject RFC 2047 UTF-8 Base64 con folding robusto.
     * Garantisce che:
     * 1. Ogni encoded-word sia <= 75 caratteri.
     * 2. Nessun carattere multi-byte (es. emoji, accentate) venga spezzato tra due word.
     * 3. Ogni word sia decodificabile indipendentemente (Base64 multiplo di 4).
     * @param {string} subject
     * @returns {string}
     */
    _buildFoldedUtf8SubjectHeader(subject) {
        const safeSubject = this._sanitizeSubjectForHeader(subject);
        
        // Se il soggetto è puramente ASCII e corto, potremmo evitare l'encoding,
        // ma per consistenza e sicurezza con nomi italiani/emoji usiamo sempre UTF-8 B.
        const encodedWordPrefix = '=?UTF-8?B?';
        const encodedWordSuffix = '?=';
        const maxLen = 75; // Limite RFC 2047 per singolo encoded-word
        const maxB64Len = maxLen - 12; // parola codificata in testa: 10 (prefisso) + 2 (suffisso)
        const maxBytesPerWord = Math.floor(maxB64Len / 4) * 3;

        const words = [];
        let currentPart = '';
        let currentBytes = 0;

        // Segmenta per grapheme quando disponibile, con fallback compatibile Apps Script.
        const chars = (typeof Intl !== 'undefined' && Intl && typeof Intl.Segmenter === 'function')
            ? Array.from(new Intl.Segmenter('it', { granularity: 'grapheme' }).segment(safeSubject)).map(s => s.segment)
            : Array.from(safeSubject);

        for (const char of chars) {
            const charBytes = this._utf8ByteLength_(char);

            if (currentBytes + charBytes > maxBytesPerWord && currentPart !== '') {
                words.push(encodedWordPrefix + this._base64EncodeUtf8_(currentPart) + encodedWordSuffix);
                currentPart = char;
                currentBytes = charBytes;
            } else {
                currentPart += char;
                currentBytes += charBytes;
            }
        }
        
        if (currentPart) {
            words.push(encodedWordPrefix + this._base64EncodeUtf8_(currentPart) + encodedWordSuffix);
        }

        // Folding: Subject: + prima riga + righe successive con spazio (WSP)
        const headerPrefix = 'Subject: ';
        const maxFirstLine = 78; // RFC 2822 SHOULD
        const maxContinuationLine = 76;
        const foldedLines = [];
        let currentLine = headerPrefix;

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const separator = (currentLine === headerPrefix) ? '' : ' ';
            
            const limit = (currentLine === headerPrefix) ? maxFirstLine : maxContinuationLine;
            const candidate = currentLine + separator + word;
            if (candidate.length <= limit) {
                currentLine = candidate;
            } else if (currentLine === headerPrefix) {
                // Piega immediatamente dopo il nome del campo quando si trova la prima parola codificata
                // supererebbe la lunghezza della prima riga consigliata RFC 2822.
                foldedLines.push(headerPrefix.trimEnd());
                currentLine = ' ' + word; // Continuation line
            } else {
                foldedLines.push(currentLine);
                currentLine = ' ' + word; // Continuation line
            }
        }
        foldedLines.push(currentLine);

        return foldedLines.join('\r\n');
    }

    _utf8ByteLength_(text) {
        let bytes = 0;
        for (const char of Array.from(String(text || ''))) {
            const code = char.codePointAt(0);
            bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
        }
        return bytes;
    }

    _base64EncodeUtf8_(value) {
        const text = value == null ? '' : String(value);
        if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.base64Encode === 'function') {
            if (Utilities.Charset && Utilities.Charset.UTF_8) {
                return Utilities.base64Encode(text, Utilities.Charset.UTF_8);
            }
            if (typeof Utilities.newBlob === 'function') {
                return Utilities.base64Encode(Utilities.newBlob(text, 'text/plain; charset=UTF-8').getBytes());
            }
            return Utilities.base64Encode(text);
        }
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(text, 'utf8').toString('base64');
        }
        throw new Error('Encoder Base64 UTF-8 non disponibile nel runtime corrente');
    }

    _base64UrlEncodeUtf8_(value) {
        const text = value == null ? '' : String(value);
        if (typeof Utilities !== 'undefined' && Utilities && typeof Utilities.base64EncodeWebSafe === 'function') {
            if (Utilities.Charset && Utilities.Charset.UTF_8) {
                return Utilities.base64EncodeWebSafe(text, Utilities.Charset.UTF_8);
            }
            if (typeof Utilities.newBlob === 'function') {
                return Utilities.base64EncodeWebSafe(Utilities.newBlob(text, 'message/rfc822; charset=UTF-8').getBytes());
            }
            return Utilities.base64EncodeWebSafe(text);
        }
        if (typeof Buffer !== 'undefined') {
            return Buffer.from(text, 'utf8').toString('base64url');
        }
        return this._base64EncodeUtf8_(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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
        const normalizedBase64 = base64Str.replace(/[\r\n\s]+/g, '');
        const chunks = normalizedBase64.match(/.{1,76}/g);
        return chunks ? chunks.join('\r\n') : '';
    }

    _buildFoldedTokenHeader(name, value, maxLineLength = 76) {
        const safeName = String(name || '').replace(/[\r\n:]+/g, '').trim();
        const safeValue = String(value || '').replace(/[\r\n]+/g, ' ').trim();
        if (!safeName || !safeValue) {
            return '';
        }

        const tokens = safeValue.split(/\s+/).filter(Boolean);
        const headerPrefix = `${safeName}:`;
        const lines = [];
        let currentLine = headerPrefix;

        let hasAtLeastOneToken = false;

        for (const token of tokens) {
            const candidate = `${currentLine} ${token}`;
            if (candidate.length <= maxLineLength || currentLine === headerPrefix) {
                currentLine = candidate;
            } else {
                // Se non c'è spazio, spingi la riga corrente (incluso il prefisso se è il primo token)
                // e manda il token a capo. Mantiene intatta la semantica e il nome dell'header.
                lines.push(currentLine);
                currentLine = ` ${token}`;
            }
            hasAtLeastOneToken = true;
        }

        if (!hasAtLeastOneToken) {
            return '';
        }

        lines.push(currentLine);
        return lines.join('\r\n');
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
                    this._clearPersistentLabelCache('_TEST_LABEL_');
                    if (this._labelCache && typeof this._labelCache.delete === 'function') {
                        this._labelCache.delete('_TEST_LABEL_');
                    }
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
            { type: 'Certificato di battesimo', patterns: ['certificato', 'battesimo', 'battezz'], minMatches: 2 },
            { type: 'Certificato di cresima', patterns: ['certificato', 'cresima', 'confermazion'], minMatches: 2 },
            { type: 'Modulo iscrizione cresima', patterns: ['cresima', 'confermazione'], minMatches: 1 },
            { type: 'Modulo iscrizione prima comunione/catechesi', patterns: ['prima comunione', 'catechesi', 'catechismo'], minMatches: 1 },
            { type: 'Modulo corso prematrimoniale', patterns: ['prematrimonial', 'fidanzati', 'matrimonio'], minMatches: 1 },
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

    _classifyAttachmentRole(documentType, fileName, text) {
        const source = `${documentType || ''}\n${fileName || ''}\n${text || ''}`.toLowerCase();

        const isSponsorEligibility =
            /idoneit[aà]/i.test(source) &&
            /\b(padrino|madrina)\b/i.test(source);

        if (isSponsorEligibility) {
            return {
                attachmentRole: 'submitted_evidence',
                documentIntent: 'document_submission',
                intentContribution: 'suppress',
                reason: 'sponsor_eligibility_certificate'
            };
        }

        if (/\b(certificato|attestato|ricevuta)\b/i.test(source)) {
            return {
                attachmentRole: 'submitted_evidence',
                documentIntent: 'document_submission',
                intentContribution: 'low',
                reason: 'certificate_or_attestation'
            };
        }

        if (/\b(modulo|iscrizione|richiesta)\b/i.test(source)) {
            return {
                attachmentRole: 'case_data',
                documentIntent: 'case_data',
                intentContribution: 'low',
                reason: 'form_or_application'
            };
        }

        return {
            attachmentRole: 'unknown',
            documentIntent: 'unknown',
            intentContribution: 'normal',
            reason: 'generic_attachment'
        };
    }

    _extractDocumentFields(text, shouldMask = true) {
        const value = `${text || ''}`;
        if (!value) return [];

        const extract = [];
        const patterns = [
            { label: 'Nome e cognome', regex: /(?:nome\s*(?:e\s*cognome)?|cognome\s*e\s*nome)\s*[:\-]\s*([^\n;]{3,80})/i },
            { label: 'Data di nascita', regex: /(?:data\s*di\s*nascita|nato\/a\s*il)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i },
            { label: 'Luogo di nascita', regex: /(?:luogo\s*di\s*nascita|nato\/a\s*a)\s*[:\-]\s*([^\n,;]{2,80})/i },
            // Supporta anche codici fiscali omocodici (sostituzioni LMNPQRSTUV nelle posizioni numeriche)
            { label: 'Codice fiscale', regex: /\b([A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z])\b/i },
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
    let normalized = decoded.toLowerCase().trim();

    // Compatibilità UX: URL legittimo senza schema (es. "www.parrocchia.it")
    // vengono normalizzati in https://... prima della whitelist protocolli.
    if (/^www\.[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(normalized)) {
        decoded = `https://${decoded.trim()}`;
        normalized = decoded.toLowerCase().trim();
    }

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
        const mailtoPayload = decoded.replace(/^mailto:/i, '').split('?')[0].trim();
        const decodedMailbox = mailtoPayload.replace(/%40/gi, '@');
        const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
        if (!emailPattern.test(decodedMailbox)) {
            console.warn(`🛑 Bloccato mailto non valido: ${decoded}`);
            return null;
        }
    }

    // SSRF: blocco IP interni, IPv6 loopback/link-local, IP decimali
    const INTERNAL_IP_PATTERN = /^\s*(https?:\/\/)?(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2[0-9]|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+)(?::\d+)?(?:\/|$)/i;
    const DECIMAL_IP = /^https?:\/\/\d{8,10}(?::\d+)?(\/|$)/i;
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
        const parts = hostNoBrackets.split('.').filter(Boolean);
        // Normalizza l'eventuale zone id IPv6 (es. ::1%25lo0 / ::1%lo0)
        // per evitare bypass delle regole SSRF su loopback/link-local.
        const hostWithoutZone = hostNoBrackets.replace(/%(25)?[a-z0-9_.~-]+$/i, '');
        const normalizedHost = hostWithoutZone.replace(/\.+$/, '');

        if (normalizedHost === 'localhost') {
            console.warn(`🛑 Bloccato tentativo SSRF localhost canonico: ${decoded}`);
            return null;
        }

        const isBlockedIpv6Host = (ipv6Host) => {
            if (!ipv6Host || !ipv6Host.includes(':')) return false;

            const normalizedIpv6 = ipv6Host.toLowerCase();
            // Blocca loopback e indirizzi non specificati
            if (normalizedIpv6 === '::' || normalizedIpv6 === '::1') return true;
            // Blocca varianti testuali equivalenti (es. 0:0:0:0:0:0:0:1, 0000::1, ::01)
            const hextets = normalizedIpv6.split('::');
            if (hextets.length <= 2) {
                const left = hextets[0] ? hextets[0].split(':').filter(Boolean) : [];
                const right = hextets[1] ? hextets[1].split(':').filter(Boolean) : [];
                const expanded = [];
                left.forEach(h => expanded.push(h));
                const missing = 8 - (left.length + right.length);
                if (missing >= 0) {
                    for (let i = 0; i < missing; i++) expanded.push('0');
                    right.forEach(h => expanded.push(h));
                    if (expanded.length === 8 && expanded.every(h => /^[0-9a-f]{1,4}$/i.test(h))) {
                        const asInt = expanded.map(h => parseInt(h, 16));
                        const isUnspecified = asInt.every(v => v === 0);
                        const isLoopback = asInt.slice(0, 7).every(v => v === 0) && asInt[7] === 1;
                        if (isUnspecified || isLoopback) return true;
                    }
                }
            }
            // Block link-local
            if (normalizedIpv6.startsWith('fe80:')) return true;
            // Block unique-local (ULA)
            if (normalizedIpv6.startsWith('fc') || normalizedIpv6.startsWith('fd')) return true;

            return false;
        };

        if (isBlockedIpv6Host(hostWithoutZone)) {
            console.warn(`🛑 Bloccato tentativo SSRF IPv6 locale: ${decoded}`);
            return null;
        }
        // Gestione delle notazioni IPv4 abbreviate (es. 127.1, 10.0.1)
        const isIpv4Candidate = parts.length > 0 && parts.length <= 4 && parts.every(part => /^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(part));

        if (isIpv4Candidate) {
            const parsedOctets = parts.map(part => {
                if (/^0x[0-9a-f]+$/i.test(part)) return parseInt(part, 16);
                if (/^0[0-7]+$/.test(part)) return parseInt(part, 8);
                if (/^\d+$/.test(part)) return parseInt(part, 10);
                return NaN;
            });
            // Espande la notazione short (es. [127, 1] diventa [127, 0, 0, 1])
            while (parsedOctets.length < 4) {
                parsedOctets.splice(parsedOctets.length - 1, 0, 0);
            }

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
            .map(pattern => hostWithoutZone.match(pattern))
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
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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

function escapeHtmlAttr(text) {
    return escapeHtml(text).replace(/`/g, '&#96;');
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
        let parsedLinksCount = 0;
        const MAX_LINKS = 100; // Limite iterazione profonda URLs per sicurezza

        while (cursor < input.length) {
            if (parsedLinksCount++ >= MAX_LINKS) {
                console.warn(`⚠️ Raggiunto limite parsing link (${MAX_LINKS}). Stop iterazione.`);
                result += input.slice(cursor);
                break;
            }
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
                // Degrada localmente il link malformato senza interrompere
                // il parsing di eventuali link validi successivi.
                result += input.slice(openBracket, closeBracket + 2);
                cursor = closeBracket + 2;
                continue;
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
            const hrefSafe = escapeHtmlAttr(sanitizedUrl);
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


    // 5. Liste markdown (bullet e numerate) -> <ul>/ <ol> + <li>
    // Liste puntate (- voce oppure * voce all'inizio riga)
    // Raggruppa righe consecutive con lo stesso prefisso in un unico <ul>
    html = html.replace(/((?:^[ \t]*[-*][ \t]+.*\n?)+)/gm, (block) => {
        const items = block
            .split('\n')
            .filter(l => l.trim())
            .map(l => `<li>${l.replace(/^[ \t]*[-*][ \t]+/, '')}</li>`)
            .join('');
        return `<ul style="margin:6px 0;padding-left:20px;">${items}</ul>`;
    });

    // Liste numerate (1. item)
    html = html.replace(/((?:^[ \t]*\d+\.[ \t]+.*\n?)+)/gm, (block) => {
        const items = block
            .split('\n')
            .filter(l => l.trim())
            .map(l => `<li>${l.replace(/^[ \t]*\d+\.[ \t]+/, '')}</li>`)
            .join('');
        return `<ol style="margin:6px 0;padding-left:20px;">${items}</ol>`;
    });

    // Bold / Italic (dopo le liste per evitare collisioni con "* item")
    // Nota: gli asterischi NON vengono escaped da escapeHtml(), quindi funzionano normalmente
    html = html.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
    // [^\n*] evita match cross-paragrafo e attraversamento di tag già inseriti
    html = html.replace(/(?<!\*)\*(?![\s*])([^\n*]+?)(?<!\s)\*(?!\*)/g, '<em>$1</em>');
    // Inline code (singolo backtick)
    html = html.replace(/`([^`\n]+)`/g,
        '<code style="font-family:monospace;background:#f4f4f4;' +
        'padding:2px 4px;border-radius:3px;font-size:0.9em;">$1</code>');
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

    // 8. Converti TUTTI i caratteri non-ASCII in entità HTML per massima compatibilità.
    // Questo previene mojibake (es: "â”", "âœ") in client che rilevano male il charset.
    html = Array.from(html).map(char => {
        const codePoint = char.codePointAt(0);
        // Mantieni UTF-8 nativo per accenti/latin; entità solo per codepoint fuori BMP.
        if (codePoint > 65535) {
            return '&#' + codePoint + ';';
        }
        return char;
    }).join('');

    // 9. Costruzione paragrafi evitando nesting invalido di <p>
    // Inserisce separatori intorno ai blocchi per evitare casi tipo:
    // "Intro\n<ul>...</ul>" -> <p>Intro<br><ul>...</ul></p> (HTML invalido)
    html = html.replace(/(<\/?(?:ul|ol|pre|p|div|h[1-6])\b[^>]*>)/gi, '\n$1\n');

    const isBlockHtml = (fragment) => /^<\/?(p|ul|ol|pre|div|h[1-6])\b/i.test(fragment.trim());
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
