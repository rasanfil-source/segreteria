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
        const hasLanguageSafety = Boolean(
            i.email?.detectedLanguage !== 'it' ||
            (i.classification?.confidence ?? 1) < 0.8
        );
        const hasHallucinationRisk = Boolean(
            (i.knowledgeBaseMeta?.length ?? i.knowledgeBase?.length ?? 0) > configuredThreshold ||
            i.temporal?.mentionsDates ||
            i.temporal?.mentionsTimes
        );
        const hasFormattingRisk = Boolean(
            i.temporal?.mentionsTimes ||
            ['information', 'sacrament'].includes(i.classification?.category)
        );
        const hasTemporalRisk = Boolean(
            i.temporal?.mentionsDates ||
            i.knowledgeBaseMeta?.containsDates
        );
        const hasDiscernmentRisk = Boolean(
            i.requestType?.needsDiscernment ||
            i.territory?.addressFound
        );
        const hasEmotionalSensitivity = Boolean(
            i.requestType?.type === 'pastoral' ||
            i.classification?.subIntents?.emotional_distress ||
            i.classification?.subIntents?.bereavement ||
            i.subIntents?.emotional_distress ||
            i.subIntents?.bereavement
        );
        const hasRepetitionRisk = Boolean(
            i.memory?.exists ||
            (i.conversation?.messageCount ?? 0) > 1
        );
        const hasResponseScopeControl = Boolean(
            i.email?.isReply ||
            (i.classification?.confidence ?? 1) < 0.7
        );
        const hasPhysicalPresenceConstraint =
            !!(i.physicalPresenceConstraint && i.physicalPresenceConstraint.has_constraint);
        const calibrationSignalCount = [
            isMultiQuestion,
            bodyLength > 450,
            hasLanguageSafety,
            hasHallucinationRisk,
            hasTemporalRisk,
            hasDiscernmentRisk,
            hasEmotionalSensitivity,
            longitudinalSensitivity,
            hasRepetitionRisk,
            hasPhysicalPresenceConstraint
        ].filter(Boolean).length;
        const needsResponseCalibration =
            isMultiQuestion ||
            bodyLength > 450 ||
            calibrationSignalCount >= 2;

        return {
            language_safety:
                hasLanguageSafety,

            hallucination_risk:
                hasHallucinationRisk,

            formatting_risk:
                hasFormattingRisk,

            temporal_risk:
                hasTemporalRisk,

            discernment_risk:
                hasDiscernmentRisk,

            emotional_sensitivity:
                hasEmotionalSensitivity,

            longitudinal_sensitivity:
                longitudinalSensitivity,

            repetition_risk:
                hasRepetitionRisk,

            identity_consistency:
                (i.email?.isReply === false) &&
                i.requestType?.type !== 'technical',

            response_scope_control:
                hasResponseScopeControl,

            multi_question:
                isMultiQuestion,

            user_overload:
                bodyLength > 600 && isMultiQuestion,

            response_calibration:
                needsResponseCalibration,

            salutation_control:
                i.salutationMode && i.salutationMode !== 'full',

            physical_presence_constraint:
                hasPhysicalPresenceConstraint,

            residual_sensitivity:
                longitudinalSensitivity && !(
                    hasEmotionalSensitivity
                )
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
        const register = this._computeResponseRegister();

        if (register === 'pastoral_crisis' &&
            (mode === 'none_or_continuity' || mode === 'session')) {
            return 'soft';
        }

        if (mode === 'none_or_continuity' &&
            (this.concerns.emotional_sensitivity ||
             this.concerns.longitudinal_sensitivity)) {
            return 'soft';
        }
        // NUOVO: primo contatto emotivo
        if (mode === 'full' &&
            (register === 'pastoral_crisis' ||
             register === 'pastoral_supportive')) {
            return 'full_warm';
        }
        return mode;
    }

    _buildConcernSynthesis(responseRegister) {
        const c = this.concerns || {};
        const isSensitive = Boolean(c.emotional_sensitivity || c.longitudinal_sensitivity);
        if (this.profile !== 'heavy' || !isSensitive) {
            return null;
        }

        let key = null;
        const directiveParts = [];
        const suppress = {
            formattingGuidelines: false,
            checklistHallucinationRule: false,
            userOverloadGuidance: false,
            responseCalibrationGuidance: false,
            checklistCompletenessRule: false
        };
        const isCrisis = String(responseRegister || '').toLowerCase() === 'pastoral_crisis';

        if (c.hallucination_risk) {
            key = 'sensitive_precision';
            directiveParts.push(isCrisis
                ? 'Questo messaggio richiede massima delicatezza e precisione. Se mancano dati nella Knowledge Base o il contesto e incompleto, ammetti l\'incertezza con garbo invece di dedurre.'
                : 'Questo messaggio richiede delicatezza e precisione. Se mancano dati nella Knowledge Base o il contesto e incompleto, ammetti l\'incertezza con garbo invece di dedurre.'
            );
            suppress.formattingGuidelines = true;
            suppress.checklistHallucinationRule = true;
        }

        if (c.emotional_sensitivity && c.formatting_risk) {
            key = key || 'sensitive_formatting';
            directiveParts.push('Se ci sono date, orari, documenti o passaggi pratici, integrali solo quando servono alla risposta e senza trasformare il testo in elenco, tabella, titolo Markdown o formula decorativa.');
            suppress.formattingGuidelines = true;
        }

        if (c.longitudinal_sensitivity && c.user_overload) {
            key = key || 'longitudinal_overload';
            directiveParts.push('La memoria segnala un contesto personale delicato: rispondi alle domande per priorita, ma in prosa breve e ben sequenziata. Non trasformare la risposta in checklist e non riaprire il vissuto se il messaggio attuale e operativo.');
            suppress.userOverloadGuidance = true;
        }

        if (isCrisis && c.multi_question) {
            key = 'crisis_multi_question';
            directiveParts.push('Il messaggio contiene piu domande, ma il bisogno principale e la crisi espressa. Apri con una risposta umana, breve e concreta al punto piu urgente; poi dai solo il prossimo passo operativo indispensabile. Le domande secondarie non vanno ignorate: se appesantirebbero la risposta, rinviale con garbo a un momento successivo o al primo contatto utile.');
            suppress.userOverloadGuidance = true;
            suppress.responseCalibrationGuidance = true;
            suppress.checklistCompletenessRule = true;
        }

        if (directiveParts.length === 0) {
            return null;
        }

        const closingDirective = isCrisis
            ? 'Mantieni frasi brevi, sobrie e umane: niente liste, titoli o formattazione decorativa.'
            : 'Il tono resta sobrio, umano e concreto: evita liste, enfasi o formattazione decorativa se irrigidiscono la risposta.';

        return {
            key: key,
            directive: directiveParts.concat([closingDirective]).join(' '),
            suppress: suppress
        };
    }

    _buildMeta() {
        const active = Object.entries(this.concerns)
            .filter(([_, v]) => v)
            .map(([k]) => k);
        const responseRegister = this._computeResponseRegister();
        const salutationMode = this._computeEffectiveSalutationMode();
        const concernSynthesis = this._buildConcernSynthesis(responseRegister);

        return {
            profile: this.profile,
            activeConcerns: active,
            responseRegister: responseRegister,
            salutationMode: salutationMode,
            concernSynthesis: concernSynthesis
        };
    }
}

// Factory function
function createPromptContext(input) {
    return new PromptContext(input);
}
