/** Gestisce logger temporanei e classificazione degli errori, anche dopo l’invio.
 * Il coordinatore resta proprietario dell’acquisizione/rilascio del lock.
 * GAS: namespace globale sincrono; dipendenze esplicite, nessun caricatore runtime.
 */
var ThreadLifecycle = {
  /** handleError: ingressi locali espliciti; restituisce i dati della fase. */
  handleError(deps, { threadLogger, error, delivery, messageState, result, startTime }) {
    threadLogger.error(`Errore elaborazione thread: ${error.message}`, { stack: error && error.stack ? error.stack : undefined });

    if (delivery.confirmed) {
      threadLogger.warn('Errore post-invio: thread non etichettato come errore perché la risposta è stata già inviata');
      try {
        messageState.markHandledUnreadOnce();
      } catch (markError) {
        threadLogger.warn(`Errore label post-invio silenziato: ${markError.message}`);
      }
      result.status = 'replied';
      result.warning = `post_send_error: ${error.message}`;
      result.durationMs = Date.now() - startTime;
      return result;
    }

    const unhandledErrorClass = deps._classifyError(error);
    const isSystemic = unhandledErrorClass.type === 'SYSTEM_ERROR' || unhandledErrorClass.type === 'CONFIG_ERROR' || unhandledErrorClass.type === 'INVALID_API_KEY' || /\b(401|403|404)\b/.test(error.message || '');
    if (!unhandledErrorClass.retryable && !isSystemic) {
      try {
        messageState.markFailureForCurrentBurst('error');
      } catch (labelError) {
        threadLogger.warn(`Errore aggiunta errorLabel silenziato: ${labelError.message}`);
      }
    } else {
      threadLogger.warn(`Errore retryable o sistemico (${unhandledErrorClass.type}): nessuna label permanente applicata.`);
    }
    result.status = 'error';
    result.error = error.message;
    result.errorClass = isSystemic ? 'SYSTEM_ERROR' : unhandledErrorClass.type;
    return result;
  },
  /** loggers: ingressi locali espliciti; restituisce i dati della fase. */
  loggers(deps, { options, threadId }) {
    const activeLogger = (options && options.logger) ? options.logger : deps.logger;
    const baseThreadLogger = (activeLogger && typeof activeLogger.withMeta === 'function')
      ? activeLogger.withMeta({ threadId: threadId })
      : activeLogger;
    const threadLogger = (baseThreadLogger && typeof baseThreadLogger.info === 'function' && typeof baseThreadLogger.warn === 'function' && typeof baseThreadLogger.error === 'function')
      ? baseThreadLogger
      : {
        info: (...args) => console.log(...args),
        warn: (...args) => console.warn(...args),
        error: (...args) => console.error(...args),
        debug: (...args) => console.log(...args),
      };
    const previousServiceLoggers = {
      geminiService: deps.geminiService ? deps.geminiService.logger : null,
      classifier: deps.classifier ? deps.classifier.logger : null,
      validator: deps.validator ? deps.validator.logger : null,
      requestClassifier: deps.requestClassifier ? deps.requestClassifier.logger : null,
      gmailService: deps.gmailService ? deps.gmailService.logger : null,
      memoryService: deps.memoryService ? deps.memoryService.logger : null
    };
    const restoreServiceLoggers = () => {
      if (deps.geminiService) deps.geminiService.logger = previousServiceLoggers.geminiService;
      if (deps.classifier) deps.classifier.logger = previousServiceLoggers.classifier;
      if (deps.validator) deps.validator.logger = previousServiceLoggers.validator;
      if (deps.requestClassifier) deps.requestClassifier.logger = previousServiceLoggers.requestClassifier;
      if (deps.gmailService) deps.gmailService.logger = previousServiceLoggers.gmailService;
      if (deps.memoryService) deps.memoryService.logger = previousServiceLoggers.memoryService;
    };
    if (deps.geminiService && threadLogger && typeof threadLogger.withContext === 'function') {
      deps.geminiService.logger = threadLogger.withContext('GeminiService');
    }
    if (deps.classifier && threadLogger && typeof threadLogger.withContext === 'function') {
      deps.classifier.logger = threadLogger.withContext('Classifier');
    }
    if (deps.validator && threadLogger && typeof threadLogger.withContext === 'function') {
      deps.validator.logger = threadLogger.withContext('Validator');
    }
    if (deps.requestClassifier && threadLogger && typeof threadLogger.withContext === 'function') {
      deps.requestClassifier.logger = threadLogger.withContext('RequestClassifier');
    }
    if (deps.gmailService && threadLogger && typeof threadLogger.withContext === 'function') {
      deps.gmailService.logger = threadLogger.withContext('GmailService');
    }
    if (deps.memoryService && threadLogger && typeof threadLogger.withContext === 'function') {
      deps.memoryService.logger = threadLogger.withContext('MemoryService');
    }
    return { threadLogger, restoreServiceLoggers };
  },
};
