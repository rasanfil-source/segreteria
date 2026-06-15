/**
 * PromptContext.gs - Calcola profilo e concern runtime
 * Determina dinamicamente quali regole del prompt sono attive
 */

var PromptContext = class PromptContext {
    constructor(input) {
        // Validazione input
        if (!input || typeof input !== 'object') {
            console.error(`🚨 PromptContext: input non valido`);
            input = {};
        }

        // Copia shallow iniziale per evitare side-effect sul parametro in ingresso.
        const safeInput = Object.assign({}, input);

        // Sanitizza lastUpdated non valido.
        // Nota: il doppio controllo su memory è intenzionale per evitare TypeError
        // quando il chiamante non passa il blocco memoria.
        if (safeInput.memory && safeInput.memory.lastUpdated) {
            if (isNaN(new Date(safeInput.memory.lastUpdated).getTime())) {
                console.warn(`⚠️ PromptContext: lastUpdated non valido, reset a null`);
                safeInput.memory = Object.assign({}, safeInput.memory, { lastUpdated: null });
            }
        }

        this.input = this._normalizeInput(safeInput);
        this.concerns = this._computeConcerns();
        this.profile = this._computeProfile();
        this.meta = this._buildMeta();
    }

    _normalizeInput(input) {
        const normalizedInput = Object.assign({}, input);

        const incomingMeta = (normalizedInput.knowledgeBaseMeta && typeof normalizedInput.knowledgeBaseMeta === 'object')
            ? normalizedInput.knowledgeBaseMeta
            : null;

        // Mantiene knowledgeBase originale inalterata e crea metadati separati.
        // NOTA: i metadati restano dentro input (knowledgeBaseMeta) per compatibilita con i test
        // e con il codice che legge this.input in debug/telemetria: non usiamo un campo esterno.
        if (normalizedInput.knowledgeBase) {
            const isString = typeof normalizedInput.knowledgeBase === 'string';
            let knowledgeBaseRaw = '';

            if (isString) {
                knowledgeBaseRaw = normalizedInput.knowledgeBase;
            } else {
                knowledgeBaseRaw = this._safeStringify(normalizedInput.knowledgeBase);
            }

            normalizedInput.knowledgeBaseRaw = knowledgeBaseRaw;
            const hasExplicitContainsDates = typeof incomingMeta?.containsDates === 'boolean';
            normalizedInput.knowledgeBaseMeta = {
                length: Number.isFinite(incomingMeta?.length) ? incomingMeta.length : knowledgeBaseRaw.length,
                // Se il chiamante fornisce containsDates esplicito (true/false),
                // deve avere precedenza per evitare override automatici inattesi.
                containsDates: hasExplicitContainsDates
                    ? incomingMeta.containsDates
                    : this._containsTemporalHintsInKnowledgeBase(knowledgeBaseRaw)
            };
        } else if (incomingMeta) {
            normalizedInput.knowledgeBaseMeta = {
                length: Number.isFinite(incomingMeta.length) ? incomingMeta.length : 0,
                containsDates: incomingMeta.containsDates === true
            };
        }

        return normalizedInput;
    }

    /**
     * Rileva segnali temporali nella KB testuale.
     * Copre anni espliciti, date locali (dd/mm o dd-mm) e orari (hh:mm).
     */
    _containsTemporalHintsInKnowledgeBase(knowledgeBaseRaw) {
        if (!knowledgeBaseRaw || typeof knowledgeBaseRaw !== 'string') {
            return false;
        }

        return /\b(19|20)\d{2}\b|\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b|\b\d{1,2}:\d{2}\b/.test(knowledgeBaseRaw);
    }

    /**
     * Serializzazione robusta della KB:
     * - gestisce riferimenti circolari senza lanciare eccezioni;
     * - evita fallback generici tipo "[object Object]" che perderebbero informazione.
     */
    _safeStringify(value) {
        const seen = new WeakSet();

        try {
            return JSON.stringify(value, (key, current) => {
                if (typeof current === 'object' && current !== null) {
                    if (seen.has(current)) {
                        return '[Circular]';
                    }
                    seen.add(current);
                }
                return current;
            });
        } catch (e) {
            console.warn('⚠️ PromptContext: knowledgeBase non serializzabile, uso fallback controllato');
            if (value === null || typeof value === 'undefined') {
                return '';
            }
            if (typeof value === 'string') {
                return value;
            }
            try {
                return String(value);
            } catch (_) {
                return Object.prototype.toString.call(value);
            }
        }
    }

    _computeConcerns() {
        const i = this.input;
        const configuredThreshold = (typeof CONFIG !== 'undefined' && Number.isFinite(CONFIG.KB_HALLUCINATION_RISK_THRESHOLD))
            ? CONFIG.KB_HALLUCINATION_RISK_THRESHOLD
            : 8000;
        const memoryTopics = Array.isArray(i.memory?.topics)
            ? i.memory.topics.join(' ')
            : '';
        const memoryText = [
            i.memory?.category,
            i.memory?.memorySummary,
            memoryTopics
        ].filter(Boolean).join(' ').toLowerCase();
        const longitudinalSensitivity = /\b(lutto|decesso|malattia|funerale|esequie|defunt[oaie]|sbattezzo|apostasia|divorzio|divorziat[oaie]|separazione|separat[oaie]|vedov[oaie])\b/.test(memoryText);
        const isMultiQuestion = this._detectMultiQuestion(i.email?.body, i.email?.subject);
        const bodyLength = String(i.email?.body || '').length;

        return {
            language_safety:
                i.email?.detectedLanguage !== 'it' ||
                (i.classification?.confidence ?? 1) < 0.8,

            hallucination_risk:
                (i.knowledgeBaseMeta?.length ?? i.knowledgeBase?.length ?? 0) > configuredThreshold ||
                i.temporal?.mentionsDates ||
                i.temporal?.mentionsTimes,

            formatting_risk:
                i.temporal?.mentionsTimes ||
                ['information', 'sacrament'].includes(i.classification?.category),

            temporal_risk:
                i.temporal?.mentionsDates ||
                i.knowledgeBaseMeta?.containsDates,

            discernment_risk:
                i.requestType?.needsDiscernment ||
                i.territory?.addressFound,

            emotional_sensitivity:
                i.requestType?.type === 'pastoral' ||
                i.classification?.subIntents?.emotional_distress ||
                i.classification?.subIntents?.bereavement ||
                i.subIntents?.emotional_distress ||
                i.subIntents?.bereavement,

            longitudinal_sensitivity:
                longitudinalSensitivity,

            repetition_risk:
                i.memory?.exists ||
                (i.conversation?.messageCount ?? 0) > 1,

            identity_consistency:
                (i.email?.isReply === false) &&
                i.requestType?.type !== 'technical',

            response_scope_control:
                i.email?.isReply ||
                (i.classification?.confidence ?? 1) < 0.7,

            multi_question:
                isMultiQuestion,

            user_overload:
                bodyLength > 600 && isMultiQuestion,

            salutation_control:
                i.salutationMode && i.salutationMode !== 'full',

            physical_presence_constraint:
                !!(i.physicalPresenceConstraint && i.physicalPresenceConstraint.has_constraint)
        };
    }

    _detectMultiQuestion(body, subject) {
        const text = [subject, body].filter(Boolean).join('\n').toLowerCase();
        if (!text.trim()) return false;

        const questionMarks = (text.match(/\?/g) || []).length;
        const questionOpeners = (text.match(/\b(?:quando|dove|come|quanto|quanti|quale|quali|chi|posso|possiamo|potrei|potremmo|vorrei|vorremmo|serve|servono|occorre|occorrono|bisogna|devo|dobbiamo|si\s+puo|si\s+può)\b/g) || []).length;
        const topicSignals = [
            /\b(?:orari?|date?|giorni?|appuntament[oi])\b/g,
            /\b(?:document[oi]|certificat[oi]|modul[oi]|validit[aà])\b/g,
            /\b(?:requisit[oi]|procedur[ae]|iscrizion[ei]|tempistiche?)\b/g,
            /\b(?:accessibilit[aà]|barriere|scale|ascensore|disabil[ei]|carrozzina)\b/g,
            /\b(?:costi?|offert[ae]|quota|pagamento)\b/g
        ].reduce((count, rx) => count + ((text.match(rx) || []).length > 0 ? 1 : 0), 0);

        return questionMarks >= 2 ||
            questionOpeners >= 3 ||
            (questionMarks >= 1 && topicSignals >= 2) ||
            (questionOpeners >= 1 && topicSignals >= 3);
    }

    _computeProfile() {
        const c = this.concerns;
        const requestType = this.input.requestType;
        const isFormal = !!(requestType && (requestType.type === 'formal' || requestType.formalScore > 0.6));
        const isDoctrinal = !!(requestType && (requestType.type === 'doctrinal' || requestType.doctrineScore > 0.6));

        if (c.discernment_risk || c.emotional_sensitivity || c.longitudinal_sensitivity || isFormal || isDoctrinal) {
            return 'heavy';
        }

        if (c.hallucination_risk || c.formatting_risk || c.temporal_risk) {
            return 'standard';
        }

        return 'lite';
    }

    _computeResponseRegister() {
        const c = this.concerns;
        const requestType = this.input.requestType || {};
        const type = String(requestType.type || '').toLowerCase();
        const category = String(this.input.classification?.category || '').toLowerCase();
        const isFormal = type === 'formal' || requestType.formalScore > 0.6 || category === 'formal' || category === 'sbattezzo';

        const subIntents = Object.assign({}, this.input.classification?.subIntents || {}, this.input.subIntents || {});
        const hasEmotionalDistress = !!subIntents.emotional_distress;
        const hasBereavement = !!subIntents.bereavement;
        const messageText = [this.input.email?.subject, this.input.email?.body].filter(Boolean).join(' ').toLowerCase();
        const hasStrongCrisisSignal = /\b(?:crisi|disperat[oaie]?|non\s+ce\s+la\s+faccio|panico|angoscia|crollo|trauma|emergenza|suicid[ioa]|autolesionismo)\b/.test(messageText);

        if (c.emotional_sensitivity && hasEmotionalDistress && (hasBereavement || hasStrongCrisisSignal)) {
            return 'pastoral_crisis';
        }
        // Longitudinal sensitivity (for example bereavement in memory) must keep
        // the supportive register even when the current message is neutral.
        if (c.emotional_sensitivity || c.longitudinal_sensitivity || type === 'pastoral') {
            return 'pastoral_supportive';
        }
        if (isFormal) {
            return 'formal_institutional';
        }
        return 'warm_institutional';
    }

    _computeEffectiveSalutationMode() {
        const mode = this.input.salutationMode || 'full';
        if (mode === 'none_or_continuity' &&
            (this.concerns.emotional_sensitivity || this.concerns.longitudinal_sensitivity)) {
            return 'soft';
        }
        return mode;
    }

    _buildMeta() {
        const active = Object.entries(this.concerns)
            .filter(([_, v]) => v)
            .map(([k]) => k);
        const responseRegister = this._computeResponseRegister();
        const salutationMode = this._computeEffectiveSalutationMode();

        return {
            profile: this.profile,
            activeConcerns: active,
            responseRegister: responseRegister,
            salutationMode: salutationMode
        };
    }
}

// Factory function
function createPromptContext(input) {
    return new PromptContext(input);
}
