/**
 * gas_error_types.js - Classificazione centralizzata errori API
 *
 * Fornisce ErrorTypes e classifyError() per categorizzare
 * gli errori in modo uniforme in tutto il sistema.
 * Usato da GeminiService._withRetry e dai test.
 */

var ErrorTypes = {
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    INVALID_API_KEY: 'INVALID_API_KEY',
    CONFIG_ERROR: 'CONFIG_ERROR',
    TIMEOUT: 'TIMEOUT',
    INVALID_RESPONSE: 'INVALID_RESPONSE',
    NETWORK: 'NETWORK',
    CACHE_EXPIRED: 'CACHE_EXPIRED',
    UNKNOWN: 'UNKNOWN'
};

/**
 * Classifica un errore in una categoria standard.
 * @param {Error|string|Object} error - Errore da classificare
 * @returns {{ type: string, retryable: boolean, message: string }}
 */
function classifyError(error) {
    let rawMessage = '';
    if (error != null) {
        if (typeof error === 'string') {
            rawMessage = error;
        } else if (error.message != null) {
            rawMessage = String(error.message);
        } else {
            try {
                rawMessage = JSON.stringify(error) || '';
            } catch (jsonError) {
                rawMessage = String(error);
            }
        }
    }
    const message = rawMessage.toLowerCase();
    const compactMessage = message.replace(/[^a-z0-9]+/g, '');

    if (compactMessage.includes('primaryquotaexhausted') ||
        compactMessage.includes('quotaexhaustedallkeys')) {
        return { type: ErrorTypes.QUOTA_EXCEEDED, retryable: true, message: rawMessage };
    }

    if (error && typeof error === 'object' && error.isTransient === true) {
        return { type: ErrorTypes.NETWORK, retryable: true, message: rawMessage };
    }

    if (message.includes('rate_limiter_lock_timeout')) {
        return { type: ErrorTypes.NETWORK, retryable: true, message: rawMessage };
    }

    if (message.includes('config_error')) {
        return { type: ErrorTypes.CONFIG_ERROR, retryable: false, message: rawMessage };
    }

    if (message.includes('gmail_daily_call_limit_reached') ||
        message.includes('daily call limit') ||
        message.includes('service invoked too many times')) {
        return { type: ErrorTypes.QUOTA_EXCEEDED, retryable: true, message: rawMessage };
    }

    // I messaggi 5xx possono contenere la parola "quota" (es. "Errore rete/server o quota (503)").
    // Manteniamo priorità alla classificazione NETWORK per evitare falsi positivi QUOTA_EXCEEDED.
    if (message.includes('rete/server') || message.includes('network') ||
        message.includes('service unavailable') ||
        message.includes('backend error') || message.includes('internal error') ||
        message.includes('connection reset') ||
        /\b(500|502|503|504)\b/.test(message)) {
        return { type: ErrorTypes.NETWORK, retryable: true, message: rawMessage };
    }

    if (message.includes('quota') || message.includes('rate limit') ||
        message.includes('resource_exhausted') ||
        /\b429\b/.test(message)) {
        return { type: ErrorTypes.QUOTA_EXCEEDED, retryable: true, message: rawMessage };
    }

    // Un 404 generico può indicare anche modello/endpoint errato: lo trattiamo
    // come cache scaduta/espulsa solo quando il messaggio cita esplicitamente
    // cachedContent o la cache Gemini.
    if ((/\b404\b/.test(message) || message.includes('not found')) &&
        (message.includes('cachedcontent') || message.includes('cached content') ||
            message.includes('cachedcontents') || message.includes('cache'))) {
        return { type: ErrorTypes.CACHE_EXPIRED, retryable: true, message: rawMessage };
    }

    if (message.includes('api key') || message.includes('unauthorized') ||
        message.includes('unauthenticated') || message.includes('permission_denied') ||
        /\b(401|403)\b/.test(message)) {
        return { type: ErrorTypes.INVALID_API_KEY, retryable: false, message: rawMessage };
    }

    if (/\b404\b/.test(message) && (message.includes('models/') || message.includes('not found'))) {
        return { type: ErrorTypes.CONFIG_ERROR, retryable: false, message: rawMessage };
    }

    if (message.includes('timeout') || message.includes('deadline exceeded') ||
        message.includes('econnreset') || message.includes('econnaborted') ||
        message.includes('request timed out') ||
        message.includes('testo vuoto') ||
        message.includes('empty text') ||
        /\b408\b/.test(message)) {
        return { type: ErrorTypes.TIMEOUT, retryable: true, message: rawMessage };
    }

    if (message.includes('invalid_argument') || message.includes('malformed') ||
        message.includes('non json valida')) {
        return { type: ErrorTypes.INVALID_RESPONSE, retryable: false, message: rawMessage };
    }

    return { type: ErrorTypes.UNKNOWN, retryable: false, message: rawMessage };
}
