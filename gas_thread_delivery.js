/** Gestisce dry-run, transazione idempotente, invio e riconciliazione.
 * delivery.confirmed è impostato subito dopo conferma Gmail, prima della persistenza.
 * Un errore successivo non può annullare la consegna né autorizzare un secondo invio.
 * GAS: namespace globale sincrono; dipendenze esplicite, nessun caricatore runtime.
 */
var ThreadDelivery = {
  /** send: ingressi locali espliciti; restituisce i dati della fase. */
  send(deps, {
    response, result, startTime, threadLogger, messageState, skipLock, messageDetails, delivery,
    duplicateReplyFingerprintContext, threadId
  }) {
    if (deps.config.dryRun) {
      console.log('   🔴 DRY RUN - Risposta non inviata');
      console.log(`   📄 Invierebbe: ${response.substring(0, 100)}...`);
      result.dryRun = true;
      result.status = 'dry_run';
      result.durationMs = Date.now() - startTime;
      threadLogger.info(`Thread processato in ${result.durationMs}ms`, { duration: result.durationMs });
      return { terminal: true };
    }

    const sendTxn = deps._beginSendTransaction(messageState.candidate.getId(), skipLock);
    if (!sendTxn.ok) {
      console.warn(`   ⊖ Invio saltato per idempotenza (${sendTxn.reason})`);
      if (sendTxn.reason === 'gmail_send_uncertain') {
        deps._addValidationErrorLabel(messageState.candidate, { reason: 'gmail_send_uncertain', subject: messageDetails.subject });
      }
      if (sendTxn.reason === 'already_sent') {
        messageState.markHandledUnreadOnce();
        result.status = 'skipped';
        result.reason = 'already_sent_recently';
      } else {
        result.status = 'skipped';
        result.reason = sendTxn.reason;
      }
      result.durationMs = Date.now() - startTime;
      return { terminal: true };
    }

    try {
      messageDetails.sendOperationId = 'reply_' + String(messageState.candidate.getId()).replace(/[^a-zA-Z0-9_-]/g, '');
      deps.gmailService.sendHtmlReply(messageState.candidate, response, messageDetails);
      delivery.confirmed = true;
      deps._commitSendTransaction(messageState.candidate.getId(), sendTxn);
      deps._recordConfirmedDuplicateReply_(
        duplicateReplyFingerprintContext,
        messageState.candidate.getId(),
        threadId
      );
      delivery.confirmed = true;
    } catch (e) {
      if (delivery.confirmed) throw e; // Post-send persistence failure must never roll back delivery.
      const errorMessage = e && e.message ? e.message : String(e);
      const classifiedSendError = deps._classifyError(e);
      const ambiguousSendOutcome = classifiedSendError.type === 'NETWORK' || classifiedSendError.type === 'TIMEOUT';
      if (!ambiguousSendOutcome) {
        deps._rollbackSendTransaction(messageState.candidate.getId(), sendTxn);
      } else {
        const confirmed = typeof deps.gmailService.reconcileSendOperation === 'function' &&
          deps.gmailService.reconcileSendOperation(messageDetails.sendOperationId);
        if (confirmed) {
          delivery.confirmed = true;
          deps._commitSendTransaction(messageState.candidate.getId(), sendTxn);
          messageState.markHandledUnreadOnce();
          result.status = 'replied';
          result.reason = 'send_reconciled';
          return { terminal: true };
        }
        messageState.responseContextMessages.forEach(message => {
          deps.props.setProperty(`send_uncertain_${message.getId()}`, String(Date.now()));
        });
        messageState.markFailureForCurrentBurst('validation', { reason: 'gmail_send_uncertain', subject: messageDetails.subject }, false);
        result.reason = 'gmail_send_uncertain';
      }
      console.error(`   🛑 Errore invio Gmail: ${errorMessage}`);

      // Errori transienti: lascia il messaggio eleggibile per retry automatico.
      if (!classifiedSendError.retryable) {
        try {
          messageState.markFailureForCurrentBurst('error');
        } catch (markError) {
          console.warn(`⚠️ Errore label su thread in errore silenziato: ${markError.message}`);
        }
      } else if (ambiguousSendOutcome) {
        console.warn('   ⚠️ Esito invio incerto: invio bloccato in attesa di revisione umana');
      } else {
        console.warn(`   ↻ Errore invio retryable (${classifiedSendError.type}) - nessuna marcatura permanente`);
      }

      result.status = 'error';
      result.error = `gmail_send_failed: ${errorMessage}`;
      result.errorClass = classifiedSendError.type;
      return { terminal: true };
    }

    // Chiude il burst subito dopo l'invio confermato: memoria, cleanup e label
    // di revisione sono post-processing e non devono lasciare il messaggio
    // riprocessabile in caso di errore successivo.
    messageState.markHandledUnreadOnce();

    return {  };
  },
};
