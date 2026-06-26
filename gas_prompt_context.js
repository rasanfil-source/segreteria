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
        const classificationSubIntents = this._normalizeSubIntentMap(normalizedInput.classification?.subIntents);
        const rootSubIntents = this._normalizeSubIntentMap(normalizedInput.subIntents);
        normalizedInput._resolvedSubIntents = this._mergeSubIntentMaps(classificationSubIntents, rootSubIntents);

        if (Object.keys(classificationSubIntents).length > 0 && Object.keys(rootSubIntents).length === 0) {
            console.warn('⚠️ PromptContext: subIntents presenti in classification ma non al livello radice. Merge automatico applicato.');
        }

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

    _normalizeSubIntentMap(subIntents) {
        if (!subIntents || typeof subIntents !== 'object') return {};
        return Object.keys(subIntents).reduce((acc, key) => {
            if (!key) return acc;
            acc[String(key).trim()] = !!subIntents[key];
            return acc;
        }, {});
    }

    _mergeSubIntentMaps(primary = {}, secondary = {}) {
        const merged = {};
        Object.keys(primary || {}).forEach((key) => {
            merged[key] = primary[key] === true;
        });
        Object.keys(secondary || {}).forEach((key) => {
            merged[key] = merged[key] === true || secondary[key] === true;
        });
        return merged;
    }

    _deriveContinuityCase(input) {
        const data = input && typeof input === 'object' ? input : {};
        const memoryText = String(data.memoryText || '').toLowerCase();
        const hasAffirmedMemorySignal = (pattern) => this._hasAffirmedMemorySignal_(memoryText, pattern);
        const flags = (data.contextualFlags && typeof data.contextualFlags === 'object')
            ? data.contextualFlags
            : {};
        const conversationState = (data.conversationState && typeof data.conversationState === 'object')
            ? data.conversationState
            : {};
        const sourceSignals = [];
        const addSignal = (signal) => {
            if (signal && sourceSignals.indexOf(signal) === -1) sourceSignals.push(signal);
        };
        const bereavementMemoryPattern = /\b(lutto|decesso|malattia|funerale|esequie|defunt[oaie]|vedov[oaie])\b/;
        const canonicalMemoryPattern = /\b(sbattezzo|apostasia|divorzio|divorziat[oaie]|separazione|separat[oaie])\b/;
        const pastoralProcessMemoryPattern = /\b(accompagnamento|percorso\s+pastorale|cammino\s+pastorale|direzione\s+spirituale|colloquio\s+pastorale)\b/;
        const memoryMentionsBereavement = hasAffirmedMemorySignal(bereavementMemoryPattern);
        const memoryMentionsCanonicalComplexity = hasAffirmedMemorySignal(canonicalMemoryPattern);
        const memoryMentionsPastoralProcess = hasAffirmedMemorySignal(pastoralProcessMemoryPattern);

        const hasBereavementMemory =
            flags.bereaved === true ||
            memoryMentionsBereavement;
        if (flags.bereaved === true) addSignal('memoryFlag:bereaved');
        if (memoryMentionsBereavement) {
            addSignal('memoryText:bereavement');
        }

        const hasCanonicalComplexity =
            flags.canonical_complexity === true ||
            memoryMentionsCanonicalComplexity;
        if (flags.canonical_complexity === true) addSignal('memoryFlag:canonical_complexity');
        if (memoryMentionsCanonicalComplexity) {
            addSignal('memoryText:canonical_complexity');
        }

        const hasOngoingPastoralProcess =
            flags.ongoing_pastoral_process === true ||
            memoryMentionsPastoralProcess;
        if (flags.ongoing_pastoral_process === true) addSignal('memoryFlag:ongoing_pastoral_process');
        if (memoryMentionsPastoralProcess) {
            addSignal('memoryText:ongoing_pastoral_process');
        }

        const rememberedPosture = String(
            conversationState.currentRelationalPosture ||
            conversationState.lastRelationalPosture ||
            ''
        ).trim().toLowerCase();
        const hasRelationalOpening = [
            'open',
            'appreciative',
            'grateful',
            'gratitude',
            'enthusiastic',
            'relational',
            'personal'
        ].includes(rememberedPosture);
        if (hasRelationalOpening) addSignal(`conversationState:posture:${rememberedPosture}`);

        let key = null;
        if (hasBereavementMemory) {
            key = 'bereavement_continuity';
        } else if (hasCanonicalComplexity) {
            key = 'canonical_continuity';
        } else if (hasOngoingPastoralProcess) {
            key = 'pastoral_process_continuity';
        } else if (hasRelationalOpening) {
            key = 'relational_opening_continuity';
        }

        if (!key) return null;

        return {
            key: key,
            longitudinal: hasBereavementMemory || hasCanonicalComplexity || hasOngoingPastoralProcess,
            relationalWarmth: hasRelationalOpening,
            sourceSignals: sourceSignals.slice(0, 8)
        };
    }

    _getContinuityCaseDirective(continuityCase, mode) {
        const key = continuityCase && typeof continuityCase === 'object'
            ? continuityCase.key
            : String(continuityCase || '');
        const overload = mode === 'overload';
        const directives = {
            bereavement_continuity: overload
                ? 'La memoria segnala un lutto ancora rilevante: rispondi alle domande per priorità, in prosa breve e ben sequenziata. Non trasformare la risposta in checklist e non riaprire o nominare il lutto se il messaggio attuale resta operativo.'
                : 'La memoria segnala un lutto ancora rilevante. Anche se il messaggio attuale è operativo, rispondi concretamente con tono sobrio e umano. Non riaprire o nominare il lutto se l’utente non lo riprende esplicitamente.',
            canonical_continuity: overload
                ? 'La memoria segnala una complessità canonica o formale: ordina le informazioni per priorità, con precisione procedurale e senza irrigidire il tono. Non trasformare la risposta in accompagnamento pastorale esteso se l’utente chiede un passaggio amministrativo.'
                : 'La memoria segnala una complessità canonica o formale. Mantieni precisione procedurale, tono rispettoso e sobrio, senza paternalismi e senza riaprire motivazioni personali non riprese dall’utente.',
            pastoral_process_continuity: overload
                ? 'La memoria segnala un percorso pastorale in corso: non ripartire da zero, rispondi al prossimo passo concreto e alleggerisci il carico ordinando le informazioni in prosa breve.'
                : 'La memoria segnala un percorso pastorale in corso. Non ripartire da zero: riconosci implicitamente la continuità e rispondi al prossimo passo concreto, senza trasformare ogni dettaglio in nuova istruzione generale.',
            relational_opening_continuity:
                'La memoria di conversazione segnala apertura relazionale: valorizzala con una ripresa naturale e breve, poi passa al dato pratico. Non aggiungere enfasi pastorale se il messaggio attuale è amministrativo.'
        };

        return directives[key] || null;
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

    _hasAffirmedMemorySignal_(memoryText, pattern) {
        if (!memoryText || !pattern) return false;
        const flags = pattern.flags && pattern.flags.indexOf('g') === -1 ? pattern.flags : String(pattern.flags || '').replace(/g/g, '');
        const regex = new RegExp(pattern.source, flags);
        const negationWindow = /(?:\bnon\b|\bnessun[oa]?\b|\bsenza\b|\bnon\s+riguarda\b|\bnon\s+si\s+tratta\s+di\b)[^.;:\n]{0,60}$/i;
        const segments = String(memoryText).split(/[.;:\n]+/);
        return segments.some((segment) => {
            const match = regex.exec(segment);
            if (!match) return false;
            const before = segment.slice(0, match.index);
            return !negationWindow.test(before);
        });
    }

    _stringifyMemoryContinuityValue_(value, depth = 0) {
        if (value == null || depth > 2) return '';
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
        if (Array.isArray(value)) return value.slice(0, 20).map((item) => this._stringifyMemoryContinuityValue_(item, depth + 1)).filter(Boolean).join(' ');
        if (typeof value === 'object') {
            return ['topic', 'summary', 'value', 'label', 'category', 'notes', 'providedInfo', 'details']
                .map((key) => this._stringifyMemoryContinuityValue_(value[key], depth + 1))
                .filter(Boolean)
                .join(' ');
        }
        return '';
    }

    _buildMemoryContinuityText_(memory) {
        const safeMemory = memory && typeof memory === 'object' ? memory : {};
        return [
            safeMemory.category,
            safeMemory.memorySummary,
            this._stringifyMemoryContinuityValue_(safeMemory.topics),
            this._stringifyMemoryContinuityValue_(safeMemory.providedInfo)
        ].filter(Boolean).join(' ').toLowerCase();
    }

    _computeConcerns() {
        const i = this.input;
        const configuredThreshold = (typeof CONFIG !== 'undefined' && Number.isFinite(CONFIG.KB_HALLUCINATION_RISK_THRESHOLD))
            ? CONFIG.KB_HALLUCINATION_RISK_THRESHOLD
            : 8000;
        const memoryText = this._buildMemoryContinuityText_(i.memory);
        const resolvedSubIntents = i._resolvedSubIntents || {};
        const contextualFlags = (i.memory?.contextualFlags && typeof i.memory.contextualFlags === 'object')
            ? i.memory.contextualFlags
            : {};
        const continuityCase = this._deriveContinuityCase({
            memoryText: memoryText,
            contextualFlags: contextualFlags,
            conversationState: i.memory?.conversationState
        });
        this.input._continuityCase = continuityCase;
        const longitudinalSensitivity = Boolean(continuityCase && continuityCase.longitudinal);
        const emailBodyRaw = String(i.email?.body || '');
        const isMultiQuestion = this._detectMultiQuestion(i.email?.body, i.email?.subject);
        const bodyLength = emailBodyRaw.length;
        const relationalPostureRaw = String(
            i.relationalPosture ||
            i.relational?.posture ||
            i.quickCheck?.relational_posture ||
            ''
        ).trim().toLowerCase();
        const relationalPostureConfidence = Number(
            i.relationalPostureConfidence ??
            i.relational?.confidence ??
            i.quickCheck?.relational_posture_confidence ??
            0
        );
        const relationalThreshold = (typeof CONFIG !== 'undefined' && Number.isFinite(Number(CONFIG.RELATIONAL_POSTURE_CONFIDENCE_THRESHOLD)))
            ? Math.max(0, Math.min(1, Number(CONFIG.RELATIONAL_POSTURE_CONFIDENCE_THRESHOLD)))
            : 0.70;
        const currentRelationalWarmth = ['appreciative', 'grateful', 'gratitude', 'enthusiastic', 'open'].includes(relationalPostureRaw) &&
            Number.isFinite(relationalPostureConfidence) &&
            relationalPostureConfidence >= relationalThreshold;
        const hasRelationalWarmth = currentRelationalWarmth ||
            Boolean(continuityCase && continuityCase.relationalWarmth);
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
        const requestTypeName = String(i.requestType?.type || '').toLowerCase();
        const classificationCategory = String(i.classification?.category || '').toLowerCase();
        const crisisSignal = this._detectPastoralCrisisSignal_(i.email?.subject, i.email?.body);
        const hasEmotionalSensitivity = Boolean(
            i.requestType?.type === 'pastoral' ||
            classificationCategory === 'emotional_support' ||
            resolvedSubIntents.emotional_distress ||
            resolvedSubIntents.bereavement ||
            crisisSignal.strong
        );
        const formalRoute = Boolean(
            requestTypeName === 'formal' ||
            i.requestType?.isSbattezzo === true ||
            Number(i.requestType?.formalScore) > 0.6 ||
            classificationCategory === 'formal' ||
            classificationCategory === 'sbattezzo'
        );
        const operationalTypes = [
            '',
            'technical',
            'information',
            'appointment',
            'document_request',
            'document_submission',
            'document_submission_with_question',
            'certificate',
            'certificates'
        ];
        const requestLooksOperational = operationalTypes.includes(requestTypeName);
        const categoryLooksOperational = operationalTypes.includes(classificationCategory);
        const hasPastoralTechnicalBlend = Boolean(
            !formalRoute &&
            requestLooksOperational &&
            categoryLooksOperational &&
            (
                resolvedSubIntents.bereavement ||
                resolvedSubIntents.emotional_distress ||
                resolvedSubIntents.confusion
            )
        );
        const hasRepetitionRisk = Boolean(
            i.memory?.exists ||
            (i.conversation?.messageCount ?? 0) > 1
        );
        const hasPhysicalPresenceConstraint =
            !!(i.physicalPresenceConstraint && i.physicalPresenceConstraint.has_constraint) ||
            contextualFlags.remote_user === true;
        const calibrationSignalCount = [
            isMultiQuestion,
            bodyLength > 450,
            hasLanguageSafety,
            hasHallucinationRisk,
            hasTemporalRisk,
            hasDiscernmentRisk,
            hasEmotionalSensitivity,
            longitudinalSensitivity,
            hasPastoralTechnicalBlend,
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

            multi_question:
                isMultiQuestion,

            user_overload:
                bodyLength > 600 && isMultiQuestion,

            response_calibration:
                needsResponseCalibration,

            physical_presence_constraint:
                hasPhysicalPresenceConstraint,

            pastoral_technical_blend:
                hasPastoralTechnicalBlend,

            relational_warmth:
                hasRelationalWarmth,

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

    _normalizeSignalText_(text) {
        return String(text || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    _detectPastoralCrisisSignal_(subject, body) {
        const text = this._normalizeSignalText_([subject, body].filter(Boolean).join(' '));
        if (!text.trim()) {
            return { critical: false, strong: false };
        }

        const hasCriticalSignal = Boolean(
            /\b(?:suicid(?:io|a|armi|arsi)|autolesionismo|autolesionist[aoie]|farmi\s+del\s+male|togliermi\s+la\s+vita|farla\s+finita|la\s+faccio\s+finita|vorrei\s+morire|voglio\s+morire|non\s+voglio\s+piu\s+vivere|non\s+riesco\s+piu\s+a\s+vivere|vorrei\s+sparire|voglio\s+sparire|scomparire\s+per\s+sempre)\b/.test(text) ||
            /\b(?:non\s+so\s+piu\s+come\s+andare\s+avanti|non\s+vedo\s+via\s+d[' ]?uscita|non\s+trovo\s+via\s+d[' ]?uscita|non\s+riesco\s+piu\s+ad?\s+andare\s+avanti)\b/.test(text)
        );
        const hasAcuteSignal = /\b(?:sono\s+in\s+crisi|mi\s+sento\s+disperat[oaie]?|sono\s+disperat[oaie]?|sto\s+crollando|sono\s+a\s+pezzi|attacco\s+di\s+panico|angoscia\s+fortissima|trauma|emergenza\s+personale)\b/.test(text);
        const hasDistressSignal = /\b(?:crisi|disperat[oaie]?|crollo|panico|angoscia|trauma|non\s+ce\s+la\s+faccio)\b/.test(text);
        const hasHelpContext = /\b(?:aiuto|aiutatemi|parlare\s+con\s+qualcuno|sacerdote|prete|parroco|colloquio|ascolto|confessione|pregare|preghiera|fede|dio)\b/.test(text);

        return {
            critical: hasCriticalSignal,
            strong: hasCriticalSignal || hasAcuteSignal || (hasDistressSignal && hasHelpContext)
        };
    }

    _computeProfile() {
        const c = this.concerns;
        const requestType = this.input.requestType;
        const category = String(this.input.classification?.category || '').toLowerCase();
        const isFormal = !!(
            requestType &&
            (requestType.type === 'formal' || requestType.formalScore > 0.6)
        ) || category === 'formal' || category === 'sbattezzo';
        const isDoctrinal = !!(requestType && (requestType.type === 'doctrinal' || requestType.doctrineScore > 0.6));

        if (c.discernment_risk || c.emotional_sensitivity || c.longitudinal_sensitivity || isFormal || isDoctrinal) {
            return 'heavy';
        }

        if (c.hallucination_risk || c.formatting_risk || c.temporal_risk || c.relational_warmth || c.pastoral_technical_blend) {
            return 'standard';
        }

        return 'lite';
    }

    _isToneOnlyLongitudinalFollowUp_() {
        const c = this.concerns || {};
        if (!c.longitudinal_sensitivity) return false;
        if (
            c.emotional_sensitivity ||
            c.user_overload ||
            c.multi_question ||
            c.discernment_risk ||
            c.pastoral_technical_blend ||
            c.physical_presence_constraint
        ) {
            return false;
        }

        const input = this.input || {};
        const requestType = input.requestType || {};
        const type = String(requestType.type || '').toLowerCase();
        const category = String(input.classification?.category || '').toLowerCase();
        const subIntents = input._resolvedSubIntents || {};

        if (
            type === 'pastoral' ||
            type === 'formal' ||
            type === 'doctrinal' ||
            requestType.isSbattezzo === true ||
            Number(requestType.formalScore) > 0.6 ||
            Number(requestType.doctrineScore) > 0.6 ||
            category === 'formal' ||
            category === 'sbattezzo' ||
            category === 'pastoral' ||
            category === 'emotional_support' ||
            subIntents.emotional_distress === true ||
            subIntents.bereavement === true
        ) {
            return false;
        }

        const body = this._normalizeSignalText_(input.email?.body || '');
        if (!body) return false;
        const configuredMaxChars = (typeof CONFIG !== 'undefined' && Number(CONFIG.LONGITUDINAL_TONE_ONLY_MAX_CHARS) > 0)
            ? Number(CONFIG.LONGITUDINAL_TONE_ONLY_MAX_CHARS)
            : 500;
        const maxChars = Math.max(1, Math.floor(configuredMaxChars));
        if (body.length > maxChars) return false;

        const currentSensitiveSignal = /\b(?:lutto|morte|morto|morta|decesso|defunt[oaie]?|funeral[ei]|esequie|malattia|separat[oaie]?|divorziat[oaie]?|vedov[oaie]?|crisi|disperat[oaie]?|angoscia|panico|non\s+ce\s+la\s+faccio|vorrei\s+sparire|non\s+so\s+piu\s+come\s+andare\s+avanti)\b/.test(body);
        const asksForPastoralSupport = /\b(?:aiuto|aiutatemi|parlare\s+con\s+qualcuno|sacerdote|prete|parroco|colloquio|ascolto|confessione|pregare|preghiera)\b/.test(body);

        return !currentSensitiveSignal && !asksForPastoralSupport;
    }

    _computeResponseRegister() {
        const c = this.concerns;
        const requestType = this.input.requestType || {};
        const type = String(requestType.type || '').toLowerCase();
        const category = String(this.input.classification?.category || '').toLowerCase();
        const isFormal = type === 'formal' || requestType.formalScore > 0.6 || category === 'formal' || category === 'sbattezzo';

        const subIntents = this.input._resolvedSubIntents || {};
        const hasEmotionalDistress = !!subIntents.emotional_distress;
        const hasBereavement = !!subIntents.bereavement;
        const crisisSignal = this._detectPastoralCrisisSignal_(this.input.email?.subject, this.input.email?.body);
        const hasStrongCrisisSignal = crisisSignal.strong;
        const hasPastoralCrisisContext = Boolean(
            hasEmotionalDistress ||
            hasBereavement ||
            c.emotional_sensitivity ||
            type === 'pastoral' ||
            category === 'emotional_support'
        );

        if (crisisSignal.critical || (hasStrongCrisisSignal && hasPastoralCrisisContext)) {
            return 'pastoral_crisis';
        }
        if (isFormal) {
            return 'formal_institutional';
        }
        if (c.emotional_sensitivity || type === 'pastoral') {
            return 'pastoral_supportive';
        }
        if (c.longitudinal_sensitivity && !this._isToneOnlyLongitudinalFollowUp_()) {
            return 'pastoral_supportive';
        }
        const relationalPosture = String(
            this.input.relationalPosture ||
            this.input.relational?.posture ||
            this.input.quickCheck?.relational_posture ||
            ''
        ).trim().toLowerCase();
        const relationalConfidence = Number(
            this.input.relationalPostureConfidence ??
            this.input.relational?.confidence ??
            this.input.quickCheck?.relational_posture_confidence ??
            0
        );
        const relationalThreshold = (typeof CONFIG !== 'undefined' && Number.isFinite(Number(CONFIG.RELATIONAL_POSTURE_CONFIDENCE_THRESHOLD)))
            ? Math.max(0, Math.min(1, Number(CONFIG.RELATIONAL_POSTURE_CONFIDENCE_THRESHOLD)))
            : 0.70;
        const personalPosture = ['personal', 'relational'].includes(relationalPosture);
        const warmPosture = ['appreciative', 'grateful', 'gratitude', 'enthusiastic', 'open'].includes(relationalPosture) &&
            Number.isFinite(relationalConfidence) &&
            relationalConfidence >= relationalThreshold;
        if ((c.relational_warmth || personalPosture || warmPosture) && !isFormal) {
            return 'pastoral_supportive';
        }
        return 'warm_institutional';
    }

    _computeResponseMode() {
        const c = this.concerns || {};
        const requestType = (this.input && this.input.requestType && typeof this.input.requestType === 'object')
            ? this.input.requestType
            : {};
        const requestTypeName = String(requestType.type || '').trim().toLowerCase();
        const category = String(this.input?.classification?.category || '').trim().toLowerCase();
        const topic = String(this.input?.classification?.topic || '').trim().toLowerCase();
        const subIntents = this.input?._resolvedSubIntents || {};
        const isFormal = Boolean(
            requestTypeName === 'formal' ||
            Number(requestType.formalScore) > 0.6 ||
            category === 'formal'
        );
        const isSbattezzo = Boolean(
            requestType.isSbattezzo === true ||
            requestTypeName === 'sbattezzo' ||
            subIntents.possible_sbattezzo_indirect === true ||
            category === 'sbattezzo' ||
            topic.includes('sbattezzo')
        );

        if (isSbattezzo) return 'sensitive_canonical';
        if (isFormal && (c.longitudinal_sensitivity || c.emotional_sensitivity)) return 'formal_sensitive';
        if (subIntents.bereavement === true) return 'bereavement';
        if (c.longitudinal_sensitivity) {
            return this._isToneOnlyLongitudinalFollowUp_()
                ? 'longitudinal_tone_only'
                : 'pastoral_longitudinal';
        }
        if (c.physical_presence_constraint) return 'remote_operational';
        if (c.pastoral_technical_blend) return 'pastoral_operational';
        return 'standard_operational';
    }

    _computeOperationalConstraints(responseMode) {
        const mode = String(responseMode || 'standard_operational').trim().toLowerCase();
        const c = this.concerns || {};
        const constraints = [];
        const add = (value) => {
            const text = String(value || '').replace(/\s+/g, ' ').trim();
            if (text && constraints.indexOf(text) === -1) constraints.push(text);
        };

        if (mode === 'remote_operational') {
            add('Non proporre presenza fisica salvo necessità esplicita.');
            add('Preferisci email, telefono o indicazione procedurale remota.');
        } else if (mode === 'bereavement') {
            add('Apri con tatto.');
            add('Dai solo i passaggi indispensabili.');
            add('Evita tono burocratico.');
        } else if (mode === 'sensitive_canonical') {
            add('Mantieni neutralità, rispetto e precisione procedurale.');
            add('Non fare pressione pastorale.');
            add('Non usare linguaggio giudicante.');
        } else if (mode === 'formal_sensitive') {
            add('Mantieni la procedura formale come asse principale.');
            add('Usa tono sobrio e umano, senza trasformare la risposta in accompagnamento pastorale.');
            add('Non riaprire il contesto personale passato se l’utente non lo riprende.');
        } else if (mode === 'longitudinal_tone_only') {
            add('Non riaprire il vissuto se l’utente non lo riprende.');
            add('Mantieni un tono istituzionale caldo e naturale, senza accompagnamento pastorale aggiuntivo.');
            add('Rispondi solo al contenuto operativo attuale.');
        } else if (mode === 'pastoral_longitudinal') {
            add('Non riaprire il vissuto se l’utente non lo riprende.');
            add('Mantieni tono sobrio e umano.');
            add('Rispondi al passaggio attuale senza ripartire da zero.');
        } else if (mode === 'pastoral_operational') {
            add('Rispondi anzitutto al dato pratico richiesto.');
            add('Usa una frase umana e sobria solo se aiuta la comprensione.');
            add('Non trasformare la risposta in accompagnamento pastorale esteso.');
        }

        if (c.physical_presence_constraint && mode !== 'remote_operational') {
            add('Non proporre presenza fisica salvo necessità esplicita.');
            add('Preferisci email, telefono o indicazione procedurale remota.');
        }
        if (c.user_overload) {
            add('Riduci il carico dell’utente: priorità chiare, prosa breve e niente checklist superflue.');
        }

        return constraints;
    }

    _computeContinuityPolicy(responseMode) {
        const mode = String(responseMode || 'standard_operational').trim().toLowerCase();
        const continuityCase = this.input && this.input._continuityCase
            ? this.input._continuityCase
            : null;
        const continuityKey = continuityCase && continuityCase.key
            ? String(continuityCase.key).trim()
            : '';
        const withRelationalOpening = (policy) => {
            if (!policy || continuityKey !== 'relational_opening_continuity' || policy.key === 'relational_opening_continuity') {
                return policy;
            }
            return Object.assign({}, policy, {
                sourceCase: continuityKey,
                relationalOpeningContinuity: true,
                directive: `${policy.directive} Se coerente con il messaggio attuale, valorizza anche l’apertura relazionale con una ripresa naturale e breve prima del dato pratico.`
            });
        };

        if (mode === 'bereavement') {
            return withRelationalOpening({
                key: 'current_bereavement_tact',
                directive: 'Il lutto è nel messaggio attuale: riconoscilo con tatto solo quanto basta, poi passa ai passaggi indispensabili.',
                sourceCase: continuityKey || null,
                doNotReopenPastContext: false
            });
        }

        if (mode === 'pastoral_longitudinal') {
            return withRelationalOpening({
                key: 'do_not_reopen_past_context',
                directive: 'Non riaprire il vissuto se l’utente non lo riprende; mantieni la continuità in modo implicito nel tono e nella scelta dei passaggi.',
                sourceCase: continuityKey || null,
                doNotReopenPastContext: true
            });
        }

        if (mode === 'longitudinal_tone_only') {
            return withRelationalOpening({
                key: 'implicit_sensitive_continuity',
                directive: 'La memoria resta solo un guardrail implicito: non riaprire il contesto personale passato e rispondi al dato attuale con tono istituzionale caldo.',
                sourceCase: continuityKey || null,
                doNotReopenPastContext: true
            });
        }

        if (mode === 'sensitive_canonical') {
            return withRelationalOpening({
                key: 'canonical_neutrality',
                directive: 'Non interpretare le motivazioni personali e non aggiungere pressione pastorale: resta neutro, rispettoso e procedurale.',
                sourceCase: continuityKey || null,
                doNotReopenPastContext: true
            });
        }

        if (mode === 'formal_sensitive') {
            return withRelationalOpening({
                key: 'formal_sensitive_continuity',
                directive: 'La richiesta resta formale: mantieni precisione procedurale e tono rispettoso; non riaprire il contesto personale passato se l’utente non lo riprende.',
                sourceCase: continuityKey || null,
                doNotReopenPastContext: true
            });
        }

        if (mode === 'pastoral_operational') {
            return withRelationalOpening({
                key: 'pastoral_signal_operational_scope',
                directive: 'Il segnale personale orienta il tono, non amplia l’oggetto della risposta: prima il dato operativo, poi eventuale cura minima.',
                sourceCase: continuityKey || null,
                doNotReopenPastContext: false
            });
        }

        if (continuityKey === 'relational_opening_continuity') {
            return {
                key: 'relational_opening_continuity',
                directive: 'Valorizza l’apertura relazionale con una ripresa naturale e breve, poi passa al dato pratico.',
                sourceCase: continuityKey,
                doNotReopenPastContext: false
            };
        }

        return null;
    }

    _computeEffectiveSalutationMode(responseRegister = null) {
        const mode = this.input.salutationMode || 'full';
        const register = responseRegister || this._computeResponseRegister();

        if (register === 'pastoral_crisis' &&
            (mode === 'none_or_continuity' || mode === 'session')) {
            return 'soft';
        }

        if (mode === 'none_or_continuity' &&
            (this.concerns.emotional_sensitivity ||
             (this.concerns.longitudinal_sensitivity && !this._isToneOnlyLongitudinalFollowUp_()) ||
             this.concerns.relational_warmth)) {
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

    _buildConcernSynthesis(responseRegister, responseMode, operationalConstraints) {
        const c = this.concerns || {};
        const isSensitive = Boolean(c.emotional_sensitivity || c.longitudinal_sensitivity);
        const isBlend = Boolean(c.pastoral_technical_blend);
        const mode = String(responseMode || this._computeResponseMode()).trim().toLowerCase() || 'standard_operational';
        const constraints = Array.isArray(operationalConstraints)
            ? operationalConstraints
            : this._computeOperationalConstraints(mode);
        const continuityCase = this.input && this.input._continuityCase
            ? this.input._continuityCase
            : null;
        const shouldBuildSensitiveSynthesis = isSensitive && this.profile === 'heavy';
        const shouldBuildLongitudinalSynthesis = Boolean(c.longitudinal_sensitivity);
        const shouldBuildBlendSynthesis = isBlend;
        const shouldBuildModeSynthesis = mode !== 'standard_operational';
        const shouldBuildRelationalContinuitySynthesis = Boolean(
            c.relational_warmth &&
            continuityCase &&
            continuityCase.key === 'relational_opening_continuity'
        );
        if (!shouldBuildSensitiveSynthesis && !shouldBuildLongitudinalSynthesis && !shouldBuildBlendSynthesis && !shouldBuildModeSynthesis && !shouldBuildRelationalContinuitySynthesis) {
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
        const modeDirectives = {
            bereavement: 'Modalità lutto: apri con tatto, rispondi con i soli passaggi indispensabili e tieni fuori tono burocratico o formule decorative.',
            sensitive_canonical: 'Modalità canonica sensibile: resta neutro, rispettoso e preciso; non fare pressione pastorale e non usare linguaggio giudicante.',
            formal_sensitive: 'Modalità formale sensibile: mantieni precisione procedurale e procedura prioritaria, ma con tono sobrio e rispettoso; non riaprire il contesto personale passato se l’utente non lo riprende.',
            remote_operational: 'Modalità remota: non proporre presenza fisica salvo necessità esplicita; preferisci email, telefono o procedura remota.',
            pastoral_longitudinal: 'Modalità longitudinale: non riaprire il vissuto se l’utente non lo riprende; mantieni tono sobrio e umano.',
            pastoral_operational: 'Modalità pastorale-operativa: il segnale personale orienta il tono, ma la risposta deve restare centrata sul dato pratico.'
        };

        if (mode === 'sensitive_canonical') {
            key = 'sensitive_canonical';
            directiveParts.push(modeDirectives.sensitive_canonical);
            suppress.formattingGuidelines = true;
        }

        if (mode === 'formal_sensitive') {
            key = 'formal_sensitive';
            directiveParts.push(modeDirectives.formal_sensitive);
        }

        if (c.hallucination_risk) {
            key = key || 'sensitive_precision';
            directiveParts.push(isCrisis
                ? 'Questo messaggio richiede massima delicatezza e precisione. Se mancano dati nella Knowledge Base o il contesto è incompleto, ammetti l’incertezza con garbo invece di dedurre.'
                : 'Questo messaggio richiede delicatezza e precisione. Se mancano dati nella Knowledge Base o il contesto è incompleto, ammetti l’incertezza con garbo invece di dedurre.'
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
            directiveParts.push(this._getContinuityCaseDirective(continuityCase, 'overload') || 'La memoria segnala un contesto personale delicato: rispondi alle domande per priorità, ma in prosa breve e ben sequenziata. Non trasformare la risposta in checklist e non riaprire il vissuto se il messaggio attuale è operativo.');
            suppress.userOverloadGuidance = true;
        }

        if (c.longitudinal_sensitivity && !c.emotional_sensitivity && directiveParts.length === 0) {
            if (mode === 'longitudinal_tone_only') {
                key = 'longitudinal_tone_only';
                directiveParts.push('La memoria segnala solo una continuità implicita: non riaprire o nominare il contesto delicato se l’utente non lo riprende esplicitamente. Mantieni registro istituzionale caldo e rispondi solo al dato operativo attuale.');
            } else {
                key = 'longitudinal_operational';
                directiveParts.push(this._getContinuityCaseDirective(continuityCase, 'operational') || 'La memoria segnala un contesto personale delicato ancora rilevante. Anche se il messaggio attuale è operativo, rispondi concretamente con tono sobrio e umano, senza freddezza procedurale. Non riaprire o nominare il contesto delicato se l’utente non lo riprende esplicitamente.');
            }
        }

        if (c.relational_warmth && continuityCase && continuityCase.key === 'relational_opening_continuity' && directiveParts.length === 0) {
            key = 'relational_continuity';
            directiveParts.push(this._getContinuityCaseDirective(continuityCase, 'operational'));
        }

        if (c.pastoral_technical_blend && directiveParts.length === 0) {
            key = 'pastoral_technical_blend';
            directiveParts.push('La richiesta resta operativa, ma contiene un segnale personale o di confusione: rispondi anzitutto al dato pratico, con una frase umana e sobria se pertinente. Non trasformare la risposta in accompagnamento pastorale esteso e non irrigidirla in burocrazia.');
            suppress.responseCalibrationGuidance = false;
        }

        if (isCrisis && c.multi_question) {
            key = 'crisis_multi_question';
            directiveParts.push('Il messaggio contiene più domande, ma il bisogno principale è la crisi espressa. Apri con una risposta umana, breve e concreta al punto più urgente; poi dai solo il prossimo passo operativo indispensabile. Le domande secondarie non vanno ignorate: se appesantirebbero la risposta, rinviale con garbo a un momento successivo o al primo contatto utile.');
            suppress.userOverloadGuidance = true;
            suppress.responseCalibrationGuidance = true;
            suppress.checklistCompletenessRule = true;
        }

        if (mode !== 'sensitive_canonical' && mode !== 'formal_sensitive' && modeDirectives[mode]) {
            if (directiveParts.length === 0) key = mode === 'pastoral_longitudinal' ? 'longitudinal_operational' : mode;
            directiveParts.push(modeDirectives[mode]);
        }

        if (constraints.length > 0 && directiveParts.length > 0) {
            directiveParts.push(`Vincoli operativi prioritari: ${constraints.slice(0, 4).join(' ')}`);
        }

        if (directiveParts.length === 0) {
            return null;
        }

        const closingDirective = isCrisis
            ? 'Mantieni frasi brevi, sobrie e umane: niente liste, nessuna emoji, nessun titolo Markdown o formattazione decorativa.'
            : 'Il tono resta sobrio, umano e concreto: evita liste, emoji, titoli Markdown, enfasi o formattazione decorativa se irrigidiscono la risposta.';

        return {
            key: key,
            directive: directiveParts.concat([closingDirective]).join(' '),
            responseMode: mode,
            operationalConstraints: constraints.slice(0, 8),
            suppress: suppress
        };
    }

    _buildMeta() {
        const active = Object.entries(this.concerns)
            .filter(([_, v]) => v)
            .map(([k]) => k);
        const responseRegister = this._computeResponseRegister();
        const salutationMode = this._computeEffectiveSalutationMode(responseRegister);
        const responseMode = this._computeResponseMode();
        const operationalConstraints = this._computeOperationalConstraints(responseMode);
        const continuityPolicy = this._computeContinuityPolicy(responseMode);
        const concernSynthesis = this._buildConcernSynthesis(responseRegister, responseMode, operationalConstraints);

        return {
            profile: this.profile,
            activeConcerns: active,
            responseMode: responseMode,
            responseRegister: responseRegister,
            salutationMode: salutationMode,
            concernSynthesis: concernSynthesis,
            operationalConstraints: operationalConstraints,
            continuityPolicy: continuityPolicy,
            continuityCase: this.input._continuityCase || null,
            longitudinalCase: (this.input._continuityCase && this.input._continuityCase.longitudinal)
                ? this.input._continuityCase
                : null
        };
    }
}

// Factory function
function createPromptContext(input) {
    return new PromptContext(input);
}
