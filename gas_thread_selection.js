/** Risolve identità e messaggi eleggibili, seleziona il candidato e aggrega il burst.
 * Mantiene l’ordine delle letture Gmail, della guardia duplicati e delle marcature.
 * GAS: namespace globale sincrono; dipendenze esplicite, nessun caricatore runtime.
 */
var ThreadSelection = {
  /** identity: ingressi locali espliciti; restituisce i dati della fase. */
  identity(deps, { threadLogger }) {
    let myEmail = '';
    try {
      if (typeof Session !== 'undefined' && Session && typeof Session.getEffectiveUser === 'function') {
        const effectiveUser = Session.getEffectiveUser();
        if (effectiveUser && typeof effectiveUser.getEmail === 'function') {
          myEmail = effectiveUser.getEmail() || '';
        }
      }
    } catch (sessionError) {
      threadLogger.warn(`Impossibile recuperare email utente da Session: ${sessionError.message}`);
    }

    let gmailAliases = [];
    try {
      gmailAliases = (typeof GmailApp !== 'undefined' && GmailApp && typeof GmailApp.getAliases === 'function')
        ? (GmailApp.getAliases() || [])
        : [];
    } catch (aliasError) {
      threadLogger.warn(`Impossibile recuperare alias Gmail: ${aliasError.message}`);
    }

    if (!myEmail && gmailAliases.length > 0) {
      myEmail = gmailAliases[0] || '';
    }

    if (!myEmail) {
      let adminEmailProperty = '';
      try {
        if (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function') {
          adminEmailProperty = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL') || '';
        }
      } catch (propertyError) {
        threadLogger.warn(`Impossibile leggere ADMIN_EMAIL da ScriptProperties: ${propertyError.message}`);
      }
      const adminEmailConfig = (typeof CONFIG !== 'undefined' && CONFIG.LOGGING && CONFIG.LOGGING.ADMIN_EMAIL)
        ? CONFIG.LOGGING.ADMIN_EMAIL
        : '';
      const adminEmail = adminEmailProperty || adminEmailConfig || '';
      let botEmailProperty = '';
      try {
        if (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function') {
          botEmailProperty = PropertiesService.getScriptProperties().getProperty('BOT_EMAIL') || '';
        }
      } catch (propertyError) {
        threadLogger.warn(`Impossibile leggere BOT_EMAIL da ScriptProperties: ${propertyError.message}`);
      }
      const botEmailConfig = (typeof CONFIG !== 'undefined' && CONFIG.BOT_EMAIL) ? CONFIG.BOT_EMAIL : '';

      myEmail = botEmailProperty || botEmailConfig || adminEmail || '';

      if (myEmail) {
        threadLogger.warn(`Session email non disponibile: uso fallback configurato anti-loop (${myEmail})`);
      }
    }

    return { myEmail, gmailAliases };
  },
  /** unread: ingressi locali espliciti; restituisce i dati della fase. */
  unread(deps, { labeledMessageIds, languageMode, threadLogger, myEmail, gmailAliases, unreadMessages, skippedMessageIds }) {
    const effectiveLabeledIds = (labeledMessageIds instanceof Set)
      ? labeledMessageIds
      : new Set();
    const metadataTerminalLabelIds = [];
    const metadataSkipLabelIds = new Set();
    if (deps.gmailService && typeof deps.gmailService._getOptionalLabelIdByName === 'function') {
      const terminalLabels = [
        { name: deps.config.labelName, type: 'processed' },
        { name: deps.config.errorLabelName, type: 'processed' },
        { name: deps.config.validationErrorLabel, type: 'processed' }
      ];
      if (languageMode === 'foreign_only') {
        terminalLabels.push({ name: deps.config.skipLabelName, type: 'skip' });
      }

      terminalLabels.forEach((entry) => {
        try {
          const labelId = entry && entry.name
            ? deps.gmailService._getOptionalLabelIdByName(entry.name)
            : null;
          if (!labelId) return;
          const isUserLabelId = typeof deps.gmailService._isUserLabelId_ === 'function'
            ? deps.gmailService._isUserLabelId_(labelId)
            : (typeof labelId === 'string' && !/^(INBOX|UNREAD|STARRED|SENT|DRAFT|SPAM|TRASH|IMPORTANT|CHAT|CATEGORY_.+)$/i.test(labelId.trim()));
          if (!isUserLabelId) return;
          metadataTerminalLabelIds.push(labelId);
          if (entry.type === 'skip') {
            metadataSkipLabelIds.add(labelId);
          }
        } catch (labelError) {
          threadLogger.warn(`Impossibile risolvere label terminale '${entry && entry.name ? entry.name : ''}': ${labelError.message}`);
        }
      });
    }

    // Build set of our own addresses (primary + aliases) per filtro early-stage
    const ownAddresses = new Set();
    if (myEmail) ownAddresses.add(deps._normalizeEmailAddress_(myEmail));
    gmailAliases.forEach(alias => {
      if (alias) ownAddresses.add(deps._normalizeEmailAddress_(alias));
    });
    const knownAliasesArray = (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.KNOWN_ALIASES))
      ? CONFIG.KNOWN_ALIASES : [];
    knownAliasesArray.forEach(alias => {
      if (alias) ownAddresses.add(deps._normalizeEmailAddress_(alias));
    });
    if (ownAddresses.size === 0) {
      throw new Error('CONFIG_ERROR: impossibile determinare identità bot/alias; elaborazione interrotta per evitare loop automatici');
    }

    const unlabeledUnread = unreadMessages.filter(message => {
      const messageId = message.getId();
      if (effectiveLabeledIds.has(messageId)) return false;

      // Cache miss hardening: l'ID potrebbe essere uscito dalla finestra maxMessages.
      // Verifica minimale su Gmail per evitare re-processing e loop di risposte duplicate
      // anche su label terminali diverse da IA (Errore/Verifica/skip foreign_only).
      if (deps.gmailService && typeof deps.gmailService._getMessageMetadataWithResilience === 'function') {
        const metadata = deps.gmailService._getMessageMetadataWithResilience(messageId, { format: 'minimal' }, 1);
        if (metadata && Array.isArray(metadata.labelIds)) {
          const matchedTerminalId = metadataTerminalLabelIds.find(labelId => metadata.labelIds.includes(labelId));
          if (matchedTerminalId) {
            if (metadataSkipLabelIds.has(matchedTerminalId) && skippedMessageIds && typeof skippedMessageIds.add === 'function') {
              skippedMessageIds.add(messageId);
            }
            effectiveLabeledIds.add(messageId); // auto-healing cache locale
            return false;
          }
        }
      }
      return true;
    });

    return { ownAddresses, unlabeledUnread };
  },
  /** select: ingressi locali espliciti; restituisce i dati della fase. */
  select(deps, {
    messageState, unlabeledUnread, ownAddresses, options, result, labeledMessageIds, skippedMessageIds,
    threadLogger
  }) {
    const getMessageSortTimestamp = (message) => {
      try {
        const date = message && typeof message.getDate === 'function' ? message.getDate() : null;
        return date instanceof Date && !isNaN(date.getTime()) ? date.getTime() : 0;
      } catch (e) {
        return 0;
      }
    };
    const getMessageSortId = (message) => {
      try {
        return message && typeof message.getId === 'function' ? String(message.getId() || '') : '';
      } catch (e) {
        return '';
      }
    };
    const compareMessagesByDateAndId = (left, right) => {
      const diff = getMessageSortTimestamp(left) - getMessageSortTimestamp(right);
      if (diff !== 0) return diff;
      const leftId = getMessageSortId(left);
      const rightId = getMessageSortId(right);
      if (leftId < rightId) return -1;
      if (leftId > rightId) return 1;
      return 0;
    };

    messageState.externalUnread = unlabeledUnread.filter(message => {
      // Utilizza getFrom() per efficienza rispetto alla costosa extractMessageDetails()
      const rawFrom = (message.getFrom() || '');
      const senderEmail = (deps.gmailService && typeof deps.gmailService._extractEmailAddress === 'function')
        ? deps.gmailService._extractEmailAddress(rawFrom)
        : rawFrom;

      // Se non riusciamo ad estrarre l'email, consideriamo il mittente come esterno per sicurezza
      if (!senderEmail) return true;

      return !ownAddresses.has(deps._normalizeEmailAddress_(senderEmail));
    }).sort(compareMessagesByDateAndId);

    const staleOnlyMs = deps._getFiniteOptionNumber_(options, 'staleOnlyMs');
    if (Number.isFinite(staleOnlyMs)) {
      const hasRecentExternalUnread = messageState.externalUnread.some(message => {
        const msgDate = (message && typeof message.getDate === 'function') ? message.getDate() : null;
        const messageTs = (msgDate && typeof msgDate.getTime === 'function') ? msgDate.getTime() : NaN;
        return Number.isFinite(messageTs) && messageTs > staleOnlyMs;
      });

      if (hasRecentExternalUnread) {
        console.log('     Stale-only: salto thread con follow-up esterni recenti per evitare risposta fuori contesto');
        result.status = 'skipped';
        result.reason = 'stale_thread_has_recent_messages';
        return { terminal: true };
      }
    }

    // Nota di manutenzione sulle label:
    // - IA chiude i messaggi già gestiti tecnicamente (esterni filtrati, interni/nostri).
    // - '·' indica solo una email italiana rimandata perché siamo in modalità foreign_only.
    // Tenere separate queste due funzioni evita che il punto medio compaia in modalità "Tutte le lingue".
    messageState.markHandledUnread = () => {
      const externalIds = new Set(messageState.externalUnread.map(m => m.getId()));
      const internalUnread = [];
      const isAbortAll = messageState.candidate === null;
      const candidateDate = (messageState.candidate && typeof messageState.candidate.getDate === 'function') ? messageState.candidate.getDate() : null;
      const candidateTimestamp = (candidateDate && typeof candidateDate.getTime === 'function')
        ? candidateDate.getTime()
        : (isAbortAll ? Infinity : 0);

      unlabeledUnread.forEach(message => {
        const messageId = message.getId();
        if (externalIds.has(messageId)) {
          // Temporal Reversal: rispondendo al messaggio esterno piu recente,
          // consumiamo anche gli esterni antecedenti rimasti appesi nel thread.
          const messageDate = (message && typeof message.getDate === 'function') ? message.getDate() : null;
          const messageTimestamp = (messageDate && typeof messageDate.getTime === 'function')
            ? messageDate.getTime()
            : 0;
          if (isAbortAll || messageState.isInResponseContext(message) || messageTimestamp <= candidateTimestamp) {
            deps._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds);
          }
        } else {
          const rawFrom = (message && typeof message.getFrom === 'function') ? (message.getFrom() || '') : '';
          const senderEmail = (deps.gmailService && typeof deps.gmailService._extractEmailAddress === 'function')
            ? deps.gmailService._extractEmailAddress(rawFrom)
            : rawFrom;
          const isOwnMessage = senderEmail && ownAddresses.has(deps._normalizeEmailAddress_(senderEmail));
          if (isOwnMessage) {
            internalUnread.push(message);
          } else if (Number.isFinite(staleOnlyMs)) {
            console.log(`   ℹ️ Stale-only: preservo messaggio esterno recente ${message.getId()} per il ciclo normale`);
          }
        }
      });
      if (internalUnread.length > 0) {
        internalUnread.forEach((message) => deps._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds));
      }
    };

    // GUARDRAIL (critico): se un messaggio è già stato etichettati IA, non deve
    // rientrare nel ciclo di risposta automatica anche se il thread è ancora aperto.
    // Questo evita doppie risposte su stesso messaggio.
    // Se non ci sono messaggi non letti non ancora etichettati → skip
    if (unlabeledUnread.length === 0) {
      console.log('   ⊖ Thread già elaborato (nessun nuovo messaggio non letto)');
      result.status = 'skipped';
      result.reason = 'already_labeled_no_new_unread';
      return { terminal: true };
    }

    // GUARDRAIL (critico): rispondiamo solo a guanti esterni.
    // I messaggi interni (noi/alias) vengono esclusi per evitare loop e risposte non dovute.
    // Se non ci sono messaggi da esterni → skip
    if (messageState.externalUnread.length === 0) {
      threadLogger.info('Saltato: nessun nuovo messaggio esterno non letto');
      // In modalità stale-only i messaggi recenti devono restare eleggibili per il ciclo normale.
      const isStaleOnlyRun = Number.isFinite(staleOnlyMs);
      if (!isStaleOnlyRun) {
        // Messaggi interni (nostri/alias): sono già gestiti, ma non sono rinvii per lingua.
        // Per questo usiamo IA come chiusura tecnica e non il punto medio ('·').
        unlabeledUnread.forEach((message) => deps._markMessageAsProcessed(message, labeledMessageIds, skippedMessageIds));
      } else {
        console.log('   ℹ️ Stale-only: messaggi recenti non marcati (saranno processati nel prossimo ciclo)');
      }
      result.status = 'skipped';
      result.reason = 'no_external_unread';
      return { terminal: true };
    }

    // Seleziona ultimo messaggio non letto non etichettato da esterni.
    // La discovery resta deliberatamente a livello messaggio: l'eventuale presenza
    // di materiale IA nello stesso thread NON deve nascondere nuovi follow-up non letti.
    messageState.candidate = messageState.externalUnread[messageState.externalUnread.length - 1];

    // CRITICO: il contesto del burst deve essere disponibile prima degli
    // early-exit di STEP 0. markHandledUnread() agisce solo sui messaggi in
    // responseContextMessages: se lo popoliamo dopo STEP 0, filtri come
    // last_speaker_is_me o email_loop_detected marcano solo il candidato finale.
    const buildBurstMessagesForCandidate = (candidateMessage, fallbackSenderEmail = '') => {
      if (!candidateMessage || typeof candidateMessage.getId !== 'function') return [];

      const candidateRawFrom = (candidateMessage && typeof candidateMessage.getFrom === 'function')
        ? (candidateMessage.getFrom() || '')
        : '';
      const candidateSenderEmail = deps._normalizeConversationEmailAddress_(
        fallbackSenderEmail || (
          deps.gmailService && typeof deps.gmailService._extractEmailAddress === 'function'
            ? deps.gmailService._extractEmailAddress(candidateRawFrom)
            : candidateRawFrom
        ) || ''
      );
      const candidateId = candidateMessage.getId();

      if (messageState.externalUnread.length <= 1 || !candidateSenderEmail) {
        return [candidateMessage];
      }

      return messageState.externalUnread.filter((message) => {
        if (!message || typeof message.getFrom !== 'function') {
          return message && typeof message.getId === 'function' && message.getId() === candidateId;
        }
        const rawFrom = message.getFrom() || '';
        const sender = (deps.gmailService && typeof deps.gmailService._extractEmailAddress === 'function')
          ? deps.gmailService._extractEmailAddress(rawFrom)
          : rawFrom;
        return deps._normalizeConversationEmailAddress_(sender || '') === candidateSenderEmail;
      }).sort(compareMessagesByDateAndId);
    };
    messageState.setResponseContextMessages(buildBurstMessagesForCandidate(messageState.candidate));

    return { buildBurstMessagesForCandidate };
  },
  /** extractAndAggregate: ingressi locali espliciti; restituisce i dati della fase. */
  extractAndAggregate(deps, {
    messageState, duplicateReplyFingerprintContext, threadLogger, threadId, labeledMessageIds,
    skippedMessageIds, result, startTime, buildBurstMessagesForCandidate
  }) {
    // STEP 1: Estrazione dati e pulizia
    console.log('   STEP 1: Estrazione dati e pulizia...');
    const messageDetails = deps.gmailService.extractMessageDetails(messageState.candidate);
    let messageBodyForSemanticAnalysis = messageDetails.body || '';
    console.log(`\n📧 Elaborazione: ${(messageDetails.subject || '').substring(0, 50)}...`);
    console.log(`   Da: ${messageDetails.senderEmail} (${messageDetails.senderName})`);

    // Guardia deterministica anti-duplicato: usa soltanto l'input originale
    // del singolo messaggio e interviene prima di memoria, quick check e AI.
    // I burst e i messaggi con allegati restano esclusi per evitare falsi positivi.
    if (messageState.externalUnread.length === 1) {
      duplicateReplyFingerprintContext = deps._buildDuplicateReplyFingerprintContext_(messageState.candidate, messageDetails);
      const duplicateReplyDecision = deps._findConfirmedDuplicateReply_(duplicateReplyFingerprintContext);
      if (duplicateReplyDecision.isDuplicate) {
        const currentMessageId = messageState.candidate.getId();
        const ageSeconds = Math.max(0, Math.floor(duplicateReplyDecision.ageMs / 1000));
        threadLogger.info('Risposta duplicata soppressa', {
          event: 'duplicate_already_replied',
          currentMessageId: currentMessageId,
          currentThreadId: threadId,
          previousMessageId: duplicateReplyDecision.previousMessageId,
          previousThreadId: duplicateReplyDecision.previousThreadId,
          ageSeconds: ageSeconds
        });
        deps._markMessageAsProcessed(messageState.candidate, labeledMessageIds, skippedMessageIds);
        result.status = 'skipped';
        result.reason = 'duplicate_already_replied';
        result.duplicateOfMessageId = duplicateReplyDecision.previousMessageId;
        result.duplicateOfThreadId = duplicateReplyDecision.previousThreadId;
        result.duplicateAgeSeconds = ageSeconds;
        result.durationMs = Date.now() - startTime;
        return { terminal: true };
      }
    }

    // CRITICO: Ricostruzione del contesto in caso di burst (più email non lette dallo stesso utente).
    // Evita che un'email finale breve (es. "Grazie") faccia scartare le vere domande precedenti.
    if (messageState.externalUnread.length > 1) {
      // Manteniamo il burst già anticipato prima di STEP 0. Se l'estrazione
      // leggera del mittente non era riuscita, riproviamo ora con senderEmail
      // ottenuto da extractMessageDetails(candidate).
      if (messageState.responseContextMessages.length <= 1 && messageDetails.senderEmail) {
        messageState.setResponseContextMessages(buildBurstMessagesForCandidate(messageState.candidate, messageDetails.senderEmail));
      }
      const candidateId = messageState.candidate.getId();
      const burstMessages = messageState.responseContextMessages;
      const semanticBodyParts = [];
      const aggregatedBody = burstMessages.map((message) => {
        const details = (message.getId() === candidateId
          ? messageDetails
          : deps.gmailService.extractMessageDetails(message)) || {};
        const messageDate = deps._formatBurstMessageDate_(details.date);
        const bodyPart = details && typeof details.body === 'string' && details.body.trim()
          ? details.body.trim()
          : null;
        if (bodyPart) semanticBodyParts.push(bodyPart);
        return bodyPart ? `--- Messaggio del ${messageDate} ---\n${bodyPart}` : null;
      }).filter(Boolean).join('\n\n');

      if (aggregatedBody) {
        messageDetails.body = aggregatedBody;
        messageBodyForSemanticAnalysis = semanticBodyParts.join('\n\n');
        console.log(`     Burst rilevato: accorpati contestualmente ${burstMessages.length} messaggi precedenti con timestamp`);
      }
    }

    return { messageDetails, messageBodyForSemanticAnalysis, duplicateReplyFingerprintContext };
  },
};
