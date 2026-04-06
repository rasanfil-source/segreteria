/**
 * gas_error_types.js - Classificazione centralizzata errori API
 *
 * Fornisce ErrorTypes e classifyError() per categorizzare
 * gli errori in modo uniforme in tutto il sistema.
 * Usato da GeminiService._withRetry e dai test.
 */

const ErrorTypes = {
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    INVALID_API_KEY: 'INVALID_API_KEY',
    TIMEOUT: 'TIMEOUT',
    INVALID_RESPONSE: 'INVALID_RESPONSE',
    NETWORK: 'NETWORK',
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

    // I messaggi 5xx possono contenere la parola "quota" (es. "Errore rete/server o quota (503)").
    // Manteniamo priorità alla classificazione NETWORK per evitare falsi positivi QUOTA_EXCEEDED.
    if (message.includes('rete/server') || message.includes('network') ||
        message.includes('service unavailable') ||
        /\b(500|502|503|504)\b/.test(message)) {
        return { type: ErrorTypes.NETWORK, retryable: true, message: rawMessage };
    }

    if (message.includes('quota') || message.includes('rate limit') ||
        message.includes('resource_exhausted') ||
        /\b429\b/.test(message)) {
        return { type: ErrorTypes.QUOTA_EXCEEDED, retryable: true, message: rawMessage };
    }

    if (message.includes('api key') || message.includes('unauthorized') ||
        message.includes('unauthenticated') || message.includes('permission_denied') ||
        /\b(401|403)\b/.test(message)) {
        return { type: ErrorTypes.INVALID_API_KEY, retryable: false, message: rawMessage };
    }

    if (message.includes('timeout') || message.includes('deadline exceeded') ||
        message.includes('econnreset') || message.includes('econnaborted') ||
        message.includes('request timed out') ||
        /\b408\b/.test(message)) {
        return { type: ErrorTypes.TIMEOUT, retryable: true, message: rawMessage };
    }

    if (message.includes('invalid_argument') || message.includes('malformed') ||
        message.includes('non json valida')) {
        return { type: ErrorTypes.INVALID_RESPONSE, retryable: false, message: rawMessage };
    }

    return { type: ErrorTypes.UNKNOWN, retryable: false, message: rawMessage };
}
