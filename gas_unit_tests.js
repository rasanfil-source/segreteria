// Runtime root compatibile (Node + Apps Script)
var __ROOT__ = (typeof globalThis !== 'undefined')
    ? globalThis
    : ((typeof this !== 'undefined') ? this : {});
if (typeof global === 'undefined') {
    var global = __ROOT__;
}

// Bootstrap Node.js: carica script GAS e mock minimi per esecuzione locale/CI
if (typeof process !== 'undefined' && typeof require !== 'undefined') {
    var fs = require('fs');
    var vm = require('vm');

    var loadedScripts = new Set();
    global.loadScript = function (path) {
        if (loadedScripts.has(path)) return;
        try {
            var code = fs.readFileSync(path, 'utf8');
            vm.runInThisContext(code, { filename: path });
            loadedScripts.add(path);
        } catch (e) {
            console.error(`❌ Errore caricamento script [${path}]: ${e.message}`);
        }
    };

    // Mock minimi obbligatori
    if (typeof global.createLogger !== 'function') {
        global.createLogger = () => ({ info: () => { }, warn: () => { }, debug: () => { }, error: () => { } });
    }
    if (typeof global.calculateEaster !== 'function') {
        global.calculateEaster = (year) => new Date(year, 3, 1);
    }
    if (typeof global.CONFIG === 'undefined') {
        global.CONFIG = {
            VALIDATION_MIN_SCORE: 0.6,
            SEMANTIC_VALIDATION: { enabled: false }
        };
    }
    if (typeof global.Utilities === 'undefined') {
        global.Utilities = {
            formatDate: (date, tz, fmt) => {
                const d = new Date(date);
                if (fmt === 'yyyy-MM-dd') return d.toISOString().slice(0, 10);
                if (fmt === 'H') return String(d.getUTCHours());
                if (fmt === 'm') return String(d.getUTCMinutes());
                if (fmt === 's') return String(d.getUTCSeconds());
                if (fmt === 'HH:mm') return d.toISOString().slice(11, 16);
                return d.toISOString();
            },
            sleep: () => { },
            computeDigest: () => [0, 1, 2, 3],
            DigestAlgorithm: { MD5: 'MD5' },
            getUuid: () => 'test-uuid-' + Math.random().toString(36).substring(2, 9),
            base64Encode: (data) => Buffer.from(data).toString('base64'),
            Charset: { UTF_8: 'utf-8' },
            base64EncodeWebSafe: (data) => Buffer.from(data).toString('base64url'),
            newBlob: (data) => ({
                getBytes: () => Buffer.from(data, 'utf8')
            })
        };
    }
    if (typeof global.PropertiesService === 'undefined') {
        var propsData = new Map();
        global.PropertiesService = {
            getScriptProperties: () => ({
                getProperty: (k) => {
                    if (propsData.has(k)) return propsData.get(k);
                    if (k === 'GEMINI_API_KEY') return 'abcdefghijklmnopqrstuvwxyz123456';
                    if (k === 'SPREADSHEET_ID') return 'sheet-123';
                    return null;
                },
                setProperty: (k, v) => propsData.set(k, String(v)),
                setProperties: (values) => {
                    Object.keys(values || {}).forEach(k => propsData.set(k, String(values[k])));
                },
                getProperties: () => {
                    const obj = {};
                    propsData.forEach((v, k) => obj[k] = v);
                    return obj;
                },
                deleteProperty: (k) => propsData.delete(k)
            })
        };
    }
    if (typeof global.LockService === 'undefined') {
        global.LockService = {
            getScriptLock: () => ({
                tryLock: () => true,
                waitLock: () => true,
                releaseLock: () => { },
                hasLock: () => true
            })
        };
    }
    if (typeof global.CacheService === 'undefined') {
        var cache = new Map();
        global.CacheService = {
            getScriptCache: () => ({
                get: (k) => (cache.has(k) ? cache.get(k) : null),
                put: (k, v) => cache.set(k, String(v)),
                remove: (k) => cache.delete(k),
                putAll: (values) => {
                    Object.entries(values || {}).forEach(([k, v]) => cache.set(k, String(v)));
                },
                getAll: (keys) => {
                    const result = {};
                    (keys || []).forEach((k) => {
                        if (cache.has(k)) result[k] = cache.get(k);
                    });
                    return result;
                },
                removeAll: (keys) => {
                    (keys || []).forEach((k) => cache.delete(k));
                }
            })
        };
    }

    if (typeof global.SpreadsheetApp === 'undefined') {
        const createMockRange = () => ({
            getValues: () => [[
                'threadId', 'language', 'category', 'tone',
                'providedInfo', 'lastUpdated', 'messageCount', 'version', 'memorySummary'
            ]],
            setValues: () => { },
            setFontWeight: () => { },
            setValue: () => { },
            getRow: () => 2,
            getColumn: () => 1,
            createTextFinder: (text) => ({
                matchEntireCell: () => ({
                    matchCase: () => ({
                        matchFormulaText: () => ({
                            findNext: () => (text.includes('test-thread') ? { getRow: () => 2, getColumn: () => 1 } : null)
                        })
                    })
                })
            })
        });

        const createMockSheet = () => ({
            getLastRow: () => 10,
            getRange: () => createMockRange(),
            appendRow: () => { },
            setFrozenRows: () => { },
            getMaxRows: () => 100,
            getLastColumn: () => 10,
            getMaxColumns: () => 10,
            createTextFinder: (text) => ({
                matchEntireCell: () => ({
                    matchCase: () => ({
                        matchFormulaText: () => ({
                            findNext: () => (text.includes('test-thread') ? { getRow: () => 2, getColumn: () => 1 } : null)
                        })
                    })
                })
            })
        });

        global.SpreadsheetApp = {
            flush: () => { },
            openById: () => ({
                getSheetByName: () => createMockSheet(),
                insertSheet: () => createMockSheet()
            })
        };
    }

    if (typeof global.GmailApp === 'undefined') {
        global.GmailApp = {
            getAliases: () => ['bot@example.com'],
            getThreadById: () => null
        };
    }

    if (typeof global.Session === 'undefined') {
        global.Session = {
            getEffectiveUser: () => ({ getEmail: () => 'bot@example.com' }),
            getActiveUser: () => ({ getEmail: () => 'bot@example.com' })
        };
    }

    // Caricamento script core
    [
        'gas_logger.js',
        'gas_config.example.js',
        'gas_error_types.js',
        'gas_rate_limiter.js',
        'gas_memory_service.js',
        'gas_territory_validator.js',
        'gas_gmail_service.js',
        'gas_prompt_context.js',
        'gas_prompt_engine.js',
        'gas_email_processor.js',
        'gas_gemini_service.js',
        'gas_classifier.js',
        'gas_request_classifier.js',
        'gas_response_validator.js',
        'gas_main.js'
    ].forEach(loadScript);
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNZIONI HELPER
// ═══════════════════════════════════════════════════════════════════════════

function testGroup(label, results, callback) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🧪 ${label}`);
    console.log('═'.repeat(70));
    try {
        callback();
    } catch (e) {
        console.error(`💥 ERRORE NEL GRUPPO [${label}]: ${e.message}`);
        if (typeof process !== 'undefined' && process && typeof process.exit === 'function') {
            process.exit(1);
        }
        throw e;
    }
}

function test(label, results, callback) {
    results.total = (results.total || 0) + 1;
    try {
        var result = callback();
        if (result === true || result === undefined) {
            console.log(`  ✅ ${label}`);
            results.passed = (results.passed || 0) + 1;
        } else {
            console.error(`  ❌ ${label}`);
            results.failed = (results.failed || 0) + 1;
        }
    } catch (error) {
        console.error(`  💥 ${label}: ${error.message}`);
        results.failed = (results.failed || 0) + 1;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SUITE DI PROVA
// ═══════════════════════════════════════════════════════════════════════════

function runAllTests() {
    console.log('╔' + '═'.repeat(68) + '╗');
    console.log('║' + ' '.repeat(15) + '🧪 SUITE DI TEST' + ' '.repeat(36) + '║');
    console.log('╚' + '═'.repeat(68) + '╝');

    const results = { total: 0, passed: 0, failed: 0 };
    const start = Date.now();

    // 0. Regressioni precedence/configurazione
    testGroup('Regressioni - Precedenza operatori e configurazione', results, () => {
        test('_getScriptProperty memorizza in cache anche con chiave assente inizialmente', results, () => {
            let propertyReads = 0;
            const context = {
                console,
                PropertiesService: {
                    getScriptProperties: () => ({
                        getProperty: (key) => {
                            propertyReads += 1;
                            return `${key}-value`;
                        }
                    })
                }
            };

            vm.createContext(context);
            vm.runInContext(fs.readFileSync('gas_config.js', 'utf8'), context, { filename: 'gas_config.js' });
            propertyReads = 0;

            const first = context._getScriptProperty('CACHE_REGRESSION_KEY');
            const second = context._getScriptProperty('CACHE_REGRESSION_KEY');
            return first === 'CACHE_REGRESSION_KEY-value'
                && second === first
                && propertyReads === 1;
        });

        test('_isSameCalendarDay rifiuta input non-Date senza eccezioni', results, () => {
            return _isSameCalendarDay('2026-04-05', new Date(2026, 3, 5)) === false
                && _isSameCalendarDay(new Date(2026, 3, 5), null) === false
                && _isSameCalendarDay(new Date('invalid'), new Date(2026, 3, 5)) === false
                && _isSameCalendarDay(new Date(2026, 3, 5), new Date(2026, 3, 5)) === true;
        });

        test('ResponseValidator usa il fallback locale se Utilities.formatDate non è disponibile', results, () => {
            const previousUtilities = Utilities;
            try {
                Utilities = undefined;
                const validator = new ResponseValidator();
                const result = validator._checkTimeBasedGreeting('Buongiorno, grazie per averci scritto.', 'it');
                return result && typeof result.score === 'number' && Array.isArray(result.warnings);
            } finally {
                Utilities = previousUtilities;
            }
        });

        test('I getter CONFIG reali leggono i nomi underscored delle Script Properties', results, () => {
            const propertyValues = {
                GEMINI_API_KEY: 'abcdefghijklmnopqrstuvwxyz123456',
                SPREADSHEET_ID: 'sheet-123',
                METRICS_SHEET_ID: 'metrics-sheet-123'
            };
            const context = {
                console,
                PropertiesService: {
                    getScriptProperties: () => ({
                        getProperty: (key) => Object.prototype.hasOwnProperty.call(propertyValues, key)
                            ? propertyValues[key]
                            : null
                    })
                }
            };

            vm.createContext(context);
            vm.runInContext(fs.readFileSync('gas_config.js', 'utf8'), context, { filename: 'gas_config.js' });

            return context.CONFIG.GEMINI_API_KEY === propertyValues.GEMINI_API_KEY
                && context.CONFIG.SPREADSHEET_ID === propertyValues.SPREADSHEET_ID
                && context.CONFIG.METRICS_SHEET_ID === propertyValues.METRICS_SHEET_ID;
        });
    });

    // 1. RateLimiter
    testGroup('RateLimiter - Persistenza Transazionale', results, () => {
        test('Il gestore della persistenza pulisce i registri dopo sincronizzazione riuscita', results, () => {
            const limiter = new GeminiRateLimiter();
            limiter._persistCacheToStorage();
            return limiter.props.getProperty('rate_limit_wal') === null;
        });
        test('Il ripristino di stato rigenera in modo coerente le finestre operative', results, () => {
            const limiter = new GeminiRateLimiter();
            const wal = { timestamp: Date.now(), rpm: [{ timestamp: Date.now(), modelKey: 'flash' }], tpm: [] };
            limiter.props.setProperty('rate_limit_wal', JSON.stringify(wal));
            limiter._recoverFromStorage();
            return limiter.cache.rpmWindow.length > 0;
        });
        test('Google Search Grounding incrementa senza ReferenceError sul lock', results, () => {
            const limiter = new GeminiRateLimiter();
            limiter.props.deleteProperty('grounding_google_search_date');
            limiter.props.deleteProperty('grounding_google_search_rpd');
            const stats = limiter.reserveGoogleSearchGroundingQueries(1);
            return stats.used === 1 && stats.limit > 0;
        });
        test('Google Search Grounding rispetta alreadyLocked senza nuovo ScriptLock', results, () => {
            const limiter = new GeminiRateLimiter();
            limiter.props.deleteProperty('grounding_google_search_date');
            limiter.props.deleteProperty('grounding_google_search_rpd');
            const previousLockService = LockService;
            try {
                LockService = {
                    getScriptLock: () => { throw new Error('getScriptLock non dovrebbe essere chiamato con alreadyLocked'); }
                };
                const stats = limiter._incrementGroundingCounter_(1, true);
                return stats.used === 1 && stats.limit > 0;
            } finally {
                LockService = previousLockService;
            }
        });
    });

    // 2. MemoryService
    testGroup('MemoryService - Timestamp & Lock', results, () => {
        const service = new MemoryService();
        test('Normalizzazione timestamp futuro', results, () => {
            const future = new Date(Date.now() + 200000000).toISOString();
            const normalized = service._validateAndNormalizeTimestamp(future);
            return new Date(normalized).getTime() <= Date.now() + 86400000;
        });
        test('Canonicalizza timestamp validi in ISO', results, () => {
            const normalized = service._validateAndNormalizeTimestamp('Wed, 01 Jan 2025 10:00:00 GMT');
            return normalized === '2025-01-01T10:00:00.000Z';
        });
        test('Lock gestion con threadId', results, () => {
            service.updateMemory('test-thread-id', { language: 'it' });
            return true;
        });
        test('Lock acquisito e rilasciato correttamente', results, () => {
            const threadId = 'test-thread-' + Date.now();
            try {
                service.updateMemory(threadId, { language: 'it' });
                const lockKey = service._getShardedLockKey(threadId);
                const cache = CacheService.getScriptCache();
                const lockStillHeld = cache.get(lockKey);
                return lockStillHeld === null;  // ✅ Lock rilasciato
            } catch (e) {
                return false;
            }
        });
    });

    // 3. TerritoryValidator
    testGroup('TerritoryValidator - Gestione Input Estremi', results, () => {
        const validator = new TerritoryValidator();
        test('L\'elaborazione dell\'input viene completata tempestivamente su schemi complessi', results, () => {
            const start = Date.now();
            validator.extractAddressFromText("via " + "a".repeat(1000) + " b");
            return (Date.now() - start) < 500;
        });
        test('Via da form non ingloba campo successivo', results, () => {
            const streets = validator.extractStreetOnlyFromText('Via Antonio Gramsci\nData Nascita: 01/01/1990');
            return Array.isArray(streets) && streets.includes('via Antonio Gramsci');
        });
        test('Caratteri speciali nel nome via → gestiti', results, () => {
            const special = "via Sant'Antonio 10";
            const result = validator.extractAddressFromText(special);
            return result && result[0].civic === 10;  // ✅ Apostrofo gestito
        });
        test('Civici alfanumerici distinti non deduplicati erroneamente', results, () => {
            const text = "via Roma 10 e via Roma 10A";
            const result = validator.extractAddressFromText(text);
            if (!result || result.length !== 2) return false;
            const civici = result.map(r => r.fullCivic).sort();
            return civici[0] === '10' && civici[1] === '10A';
        });
    });

    // 4. EmailProcessor
    testGroup('EmailProcessor - Topic Detection', results, () => {
        const processor = new EmailProcessor();
        test('_getCachedTimeZone cachea il fuso orario dello script', results, () => {
            const previousSession = global.Session;
            let calls = 0;
            try {
                global.Session = Object.assign({}, previousSession, {
                    getScriptTimeZone: () => {
                        calls++;
                        return 'Europe/Rome';
                    }
                });
                const localProcessor = new EmailProcessor();
                return localProcessor._getCachedTimeZone() === 'Europe/Rome'
                    && localProcessor._getCachedTimeZone() === 'Europe/Rome'
                    && calls === 1;
            } finally {
                global.Session = previousSession;
            }
        });
        test('_detectTemporalMentions rileva giorni italiani accentati', results, () => {
            return processor._detectTemporalMentions('Ci vediamo lunedì alle 18.', 'it') === true
                && processor._detectTemporalMentions('Disponibile martedì?', 'it') === true
                && processor._detectTemporalMentions('testolunedìfuso', 'it') === false;
        });
        test('MemoryService.getRecentHistory restituisce gli ultimi topic salvati', results, () => {
            const memory = Object.create(MemoryService.prototype);
            memory._initialized = true;
            memory.getMemory = () => ({
                providedInfo: [
                    { topic: 'uno', userReaction: 'unknown' },
                    { topic: 'due', userReaction: 'acknowledged' },
                    { topic: 'tre', userReaction: 'unknown' }
                ]
            });
            const history = memory.getRecentHistory('thread-1', 2);
            return Array.isArray(history)
                && history.length === 2
                && history[0].topic === 'due'
                && history[1].topic === 'tre';
        });
        test('Gestisce in modo dinamico la rilevazione in assenza esplicita di topic', results, () => {
            const topics = processor._detectProvidedTopics('La via Antonio Gramsci rientra nel territorio parrocchiale.');
            return Array.isArray(topics) && topics.includes('territorio');
        });
        test('Verifica territorio solo su richiesta esplicita', results, () => {
            const ask = processor._isTerritoryRequest('Info territorio', 'Via Antonio Gramsci rientra?');
            const noAsk = processor._isTerritoryRequest('Iscrizione cresima', 'Abito in via Antonio Gramsci.');
            return ask === true && noAsk === false;
        });
        test('Rileva Cresima come prerequisito implicito per padrino', results, () => {
            const policy = processor._deriveSponsorGuidancePolicy_(
                'Cresima per fare da padrino',
                'Ho bisogno della Cresima per fare da padrino al battesimo di mio nipote. Come posso fare?',
                null
            );
            return policy === 'cresima_prerequisite_for_sponsor_role';
        });
        test('Non tratta certificato idoneità della madrina come richiesta requisiti padrino', results, () => {
            const body = 'Invio in allegato il mio certificato di Battesimo e il certificato di idoneità della madrina per poter ricevere il sacramento della Cresima il prossimo 24 maggio 2026.';
            const policy = processor._deriveSponsorGuidancePolicy_(
                'Documenti Cresima',
                body,
                { intent: 'sponsor_eligibility_submission' }
            );
            return policy === 'no_eligibility_guidance' &&
                processor._detectCresimaAsPrerequisiteForSponsorRole_(body) === false;
        });
        test('Non basta citare madrina e Cresima per autorizzare i requisiti padrino', results, () => {
            const body = 'Vorrei fare da madrina alla Cresima di mia nipote: quali documenti devo portare?';
            const policy = processor._deriveSponsorGuidancePolicy_(
                'Madrina Cresima',
                body,
                null
            );
            return policy !== 'cresima_prerequisite_for_sponsor_role' &&
                processor._detectCresimaAsPrerequisiteForSponsorRole_(body) === false;
        });
        test('Rileva richiesta su Cresima necessaria per fare da padrino', results, () => {
            const body = 'La Cresima è obbligatoria per fare da padrino al Battesimo?';
            const policy = processor._deriveSponsorGuidancePolicy_(
                'Cresima padrino',
                body,
                null
            );
            return policy === 'cresima_prerequisite_for_sponsor_role';
        });
        test('Usa AI come disambiguatore quando padrino e Cresima compaiono insieme', results, () => {
            const body = 'Mi hanno chiesto di fare da padrino il giorno 13 di settembre e non trovo un corso di preparazione alla Cresima, che mi manca, per riceverla entro settembre.';
            const localDecision = processor._classifySponsorGuidanceLocally_(
                'Cresima per padrino',
                body,
                null,
                'it'
            );
            const yesByAi = processor._deriveSponsorGuidancePolicy_(
                'Cresima per padrino',
                body,
                null,
                true,
                'it'
            );
            const noByAi = processor._deriveSponsorGuidancePolicy_(
                'Cresima per padrino',
                body,
                null,
                false,
                'it'
            );
            return localDecision === 'ask_ai' &&
                yesByAi === 'cresima_prerequisite_for_sponsor_role' &&
                noByAi === 'no_eligibility_guidance';
        });
        test('Non interpreta sponsor pubblicitario italiano come padrino', results, () => {
            const body = 'Vorremmo proporvi di fare da sponsor sulle magliette della nostra squadra di calcio.';
            return processor._classifySponsorGuidanceLocally_('Sponsor magliette', body, null, 'it') === 'none' &&
                processor._deriveSponsorGuidancePolicy_('Sponsor magliette', body, null, true, 'it') === 'default';
        });
        test('Non interpreta testimone di matrimonio come padrino', results, () => {
            const body = 'Devo fare da testimone a un matrimonio e vorrei sapere se serve la Cresima.';
            return processor._classifySponsorGuidanceLocally_('Testimone matrimonio', body, null, 'it') === 'none' &&
                processor._deriveSponsorGuidancePolicy_('Testimone matrimonio', body, null, undefined, 'it') !== 'cresima_prerequisite_for_sponsor_role';
        });
        test('Radar padrino/Cresima è multilingue nelle lingue supportate', results, () => {
            const samples = [
                ['en', 'I was asked to be a sponsor at a baptism, but I have not received Confirmation.'],
                ['es', 'Me han pedido ser padrino, pero me falta la Confirmación.'],
                ['fr', 'On m’a demandé d’être parrain, mais il me manque la confirmation.'],
                ['pt', 'Pediram-me para ser padrinho, mas falta-me a Crisma.'],
                ['de', 'Ich soll Pate werden, bin aber nicht gefirmt.']
            ];
            return samples.every(([lang, body]) =>
                processor._classifySponsorGuidanceLocally_('Info', body, null, lang) === 'ask_ai'
            );
        });
        test('In inglese sponsor commerciale non attiva radar sacramentale', results, () => {
            const body = 'We would like to sponsor your football shirts this season.';
            return processor._classifySponsorGuidanceLocally_('Sponsorship proposal', body, null, 'en') === 'none';
        });
        test('In inglese confirm+sponsor commerciale resta fuori dal radar sacramentale', results, () => {
            const body = 'Could you confirm if we can sponsor your football shirts this season?';
            return processor._classifySponsorGuidanceLocally_('Sponsorship proposal', body, null, 'en') === 'none';
        });
        test('In inglese sponsor con mancanza Confirmation attiva radar sacramentale', results, () => {
            const body = 'I was asked to be a sponsor, but I am not confirmed.';
            return processor._classifySponsorGuidanceLocally_('Confirmation sponsor', body, null, 'en') === 'ask_ai';
        });
        test('Regex locale decide prima del segnale AI per guidance padrino', results, () => {
            const excludedDespiteAi = processor._deriveSponsorGuidancePolicy_(
                'Documenti Cresima',
                'Invio in allegato il mio certificato di Battesimo e il certificato di idoneità della madrina per poter ricevere il sacramento della Cresima il prossimo 24 maggio 2026.',
                { intent: 'sponsor_eligibility_submission' },
                true
            );
            return excludedDespiteAi === 'no_eligibility_guidance';
        });
        test('AI interviene solo sui casi padrino ambigui individuati dalla regex', results, () => {
            const ambiguous = 'Vorrei fare da madrina alla Cresima di mia nipote: potete aiutarmi?';
            const localDecision = processor._classifySponsorGuidanceLocally_(
                'Madrina Cresima',
                ambiguous,
                null
            );
            const yesByAi = processor._deriveSponsorGuidancePolicy_(
                'Madrina Cresima',
                ambiguous,
                null,
                true
            );
            const noByAi = processor._deriveSponsorGuidancePolicy_(
                'Madrina Cresima',
                ambiguous,
                null,
                false
            );
            return localDecision === 'ask_ai' &&
                yesByAi === 'cresima_prerequisite_for_sponsor_role' &&
                noByAi === 'no_eligibility_guidance';
        });
        test('Sanitizer rimuove blocco requisiti padrino se il mittente consegna documenti Cresima', results, () => {
            const body = 'Invio in allegato il mio certificato di Battesimo e il certificato di idoneità della madrina per poter ricevere il sacramento della Cresima il prossimo 24 maggio 2026.';
            const response = "Abbiamo ricevuto i documenti.\nLe ricordiamo che per poter assumere l'incarico di padrino o madrina è necessario soddisfare alcune condizioni:\nEssere cattolici battezzati e cresimati.\nAver ricevuto l'Eucaristia.\nCondurre una vita conforme alla fede.\nAvere almeno 16 anni.\nNon essere il genitore del battezzando.\nCordiali saluti.";
            const cleaned = processor._sanitizeUnrequestedSponsorGuidance_(
                response,
                'Documenti Cresima',
                body
            );
            return cleaned.includes('Abbiamo ricevuto i documenti.') &&
                cleaned.includes('Cordiali saluti.') &&
                !cleaned.includes('Essere cattolici battezzati');
        });
        test('Non forza sola ricezione quando la consegna sponsor contiene domanda su Cresima/padrino', results, () => {
            const shouldGuide = processor._shouldProvideEligibilityGuidance_(
                'Invio documenti',
                'Allego il certificato. Non sono cresimato, posso fare da padrino?',
                { intent: 'document_submission_with_question', hasQuestions: true }
            );
            return shouldGuide === true;
        });
        test('Mantiene guidance padrino quando la Cresima è prerequisito emerso dal testo', results, () => {
            const response = 'Per fare da padrino occorre essere battezzato e cresimato.\\nServe anche una vita cristiana conforme.';
            const cleaned = processor._sanitizeUnrequestedSponsorGuidance_(
                response,
                'Cresima',
                'Mi manca la Cresima per fare da padrino.'
            );
            return cleaned === response;
        });
        test('Aggiunge nota differenza orario in modo generico (non solo cresima)', results, () => {
            const response = 'Buonasera.\n\nIl prossimo corso prematrimoniale inizierà alle ore 16:30.\n\nCordiali saluti.';
            const messageDetails = { subject: 'Corso prematrimoniale', body: 'Pensavo iniziasse alle 17:00.' };
            const adjusted = processor._addTimeDiscrepancyNoteIfNeeded(response, messageDetails, 'it');
            return adjusted.includes('in un orario diverso rispetto a quanto da Lei indicato');
        });
        test('Non aggiunge nota se l\'utente cita un orario solo come contesto', results, () => {
            const response = 'Buonasera.\n\nL\'incontro inizierà alle ore 16:30.\n\nCordiali saluti.';
            const messageDetails = { subject: 'Incontro', body: 'Domani riesco a passare alle 17:00 per chiedere informazioni.' };
            const adjusted = processor._addTimeDiscrepancyNoteIfNeeded(response, messageDetails, 'it');
            return adjusted === response;
        });
        test('Usa formulazione generica per discrepanza oraria', results, () => {
            const response = "Buonasera.\n\nL'incontro inizierà alle ore 16:30.\n\nCordiali saluti.";
            const messageDetails = { subject: 'Incontro', body: 'Io avevo capito 20:00.' };
            const adjusted = processor._addTimeDiscrepancyNoteIfNeeded(response, messageDetails, 'it');
            return adjusted.includes("l'incontro si svolgerà in un orario diverso rispetto a quanto da Lei indicato");
        });
        test('Non duplica nota quando è già presente il fallback "Nota: orario comunicato"', results, () => {
            const response = "Buonasera.\n\nL'incontro inizierà alle ore 16:30.\n\nNota: l'orario comunicato è diverso da quello da Lei indicato.";
            const messageDetails = { subject: 'Incontro', body: 'Pensavo fosse alle 17:00.' };
            const adjusted = processor._addTimeDiscrepancyNoteIfNeeded(response, messageDetails, 'it');
            return adjusted === response;
        });

        test('processThread tratta un Set vuoto come cache già fornita', results, () => {
            const labelCalls = [];
            const labeledMessageIds = new Set();
            const thread = {
                getId: () => 'thread-123',
                getMessages: () => [
                    { getId: () => 'msg-1', isUnread: () => true, getFrom: () => 'user@external.com', getDate: () => new Date() },
                    { getId: () => 'msg-2', isUnread: () => true, getFrom: () => 'user@external.com', getDate: () => new Date() },
                    { getId: () => 'msg-3', isUnread: () => true, getFrom: () => 'user@external.com', getDate: () => new Date() }
                ]
            };
            const processor = new EmailProcessor({
                gmailService: {
                    // La cache vuota è trattata come assente: forniamo fallback neutro
                    getMessageIdsWithLabel: () => [],
                    extractMessageDetails: (m) => ({
                        senderEmail: 'user@external.com',
                        senderName: 'Utente',
                        subject: 'Richiesta informazioni',
                        body: 'Vorrei sapere gli orari delle messe domenicali, grazie mille.',
                        date: new Date(),
                        isNewsletter: false,
                        headers: {}
                    }),
                    _extractEmailAddress: (f) => f,
                    addLabelToMessage: (id, labelName) => labelCalls.push({ id, labelName })
                },
                geminiService: {
                    shouldRespondToEmail: () => ({ shouldRespond: false, reason: 'no_action_needed' }),
                    detectEmailLanguage: () => ({ lang: 'it', confidence: 3, safetyGrade: 3 })
                }
            });

            processor.processThread(thread, 'KB', 'Doctrine', labeledMessageIds, true);
            // Con il mock corretto, il path atteso è: classifyEmail → shouldReply:true →
            // shouldRespondToEmail → shouldRespond:false → _markMessageAsProcessed solo sul candidato,
            // preservando i secondari esterni per un trigger successivo.
            return !labeledMessageIds.has('msg-1') && !labeledMessageIds.has('msg-2') && labeledMessageIds.has('msg-3');
        });

        test('no_external_unread: non usa skip (·) sui messaggi interni', results, () => {
            const previousSession = (typeof Session !== 'undefined') ? Session : undefined;
            global.Session = {
                getEffectiveUser: () => ({
                    getEmail: () => 'segreteria@example.com'
                })
            };

            const labelCalls = [];
            const thread = {
                getId: () => 'thread-no-external-unread',
                getMessages: () => [
                    { getId: () => 'msg-internal-1', isUnread: () => true, getFrom: () => 'segreteria@example.com', getDate: () => new Date(), getSubject: () => 'Nota interna' }
                ]
            };

            const processor = new EmailProcessor({
                gmailService: {
                    getMessageIdsWithLabel: () => [],
                    _extractEmailAddress: (from) => from,
                    addLabelToMessage: (id, labelName) => labelCalls.push({ id, labelName })
                }
            });

            const out = processor.processThread(thread, 'KB', 'Doctrine', new Set(), true);
            const hasSkipLabel = labelCalls.some(call => call.id === 'msg-internal-1' && call.labelName === '·');
            const hasIaLabel = labelCalls.some(call => call.id === 'msg-internal-1' && call.labelName === 'IA');

            if (typeof previousSession === 'undefined') {
                delete global.Session;
            } else {
                global.Session = previousSession;
            }

            return out && out.status === 'skipped' && out.reason === 'no_external_unread' && !hasSkipLabel && hasIaLabel;
        });

        test('foreign_only: email italiane non vengono marcate, così restano processabili dopo cambio modalità', results, () => {
            const previousCache = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE) ? { ...GLOBAL_CACHE } : null;
            global.GLOBAL_CACHE = { ...(previousCache || {}), languageMode: 'foreign_only' };

            const labelCalls = [];
            const thread = {
                getId: () => 'thread-foreign-only-it',
                getMessages: () => [
                    { getId: () => 'msg-it-1', isUnread: () => true, getFrom: () => 'utente@example.com', getDate: () => new Date(), getSubject: () => 'Richiesta orari' },
                    { getId: () => 'msg-it-2', isUnread: () => true, getFrom: () => 'utente@example.com', getDate: () => new Date(), getSubject: () => 'Richiesta orari' }
                ]
            };

            const processor = new EmailProcessor({
                gmailService: {
                    extractMessageDetails: () => ({
                        senderEmail: 'utente@example.com',
                        senderName: 'Utente',
                        subject: 'Richiesta orari',
                        body: 'Buongiorno, vorrei informazioni sugli orari delle messe.',
                        isNewsletter: false,
                        headers: {}
                    }),
                    _extractEmailAddress: (from) => from,
                    addLabelToMessage: (id, labelName) => labelCalls.push({ id, labelName })
                },
                geminiService: {
                    detectEmailLanguage: () => ({ lang: 'it' })
                }
            });

            const out = processor.processThread(thread, 'KB', 'Doctrine', new Set(), true);

            if (previousCache) {
                global.GLOBAL_CACHE = previousCache;
            } else {
                delete global.GLOBAL_CACHE;
            }

            const hasIaLabel = labelCalls.some(call => call.labelName === 'IA');
            const hasSkipLabel = labelCalls.some(call => call.labelName === '·');
            const acceptedReasons = new Set(['italian_skipped_foreign_only', 'italian_skipped_foreign_only_precheck']);
            return out && out.status === 'skipped' && acceptedReasons.has(out.reason) && !hasIaLabel && hasSkipLabel;
        });

        test('foreign_only: se quick-check aggiorna lingua a IT, skip finale senza label IA', results, () => {
            const previousCache = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE) ? { ...GLOBAL_CACHE } : null;
            global.GLOBAL_CACHE = { ...(previousCache || {}), languageMode: 'foreign_only' };

            const labelCalls = [];
            const labeledMessageIds = new Set();
            const thread = {
                getId: () => 'thread-foreign-only-post-quickcheck-it',
                getMessages: () => [
                    { getId: () => 'msg-fq-1', isUnread: () => true, getFrom: () => 'user@example.com', getDate: () => new Date(), getSubject: () => 'Request info' }
                ]
            };

            const processor = new EmailProcessor({
                gmailService: {
                    extractMessageDetails: () => ({
                        senderEmail: 'user@example.com',
                        senderName: 'User',
                        subject: 'Request info',
                        body: 'Hello, I need help with appointment details.',
                        isNewsletter: false,
                        headers: {}
                    }),
                    _extractEmailAddress: (from) => from,
                    addLabelToMessage: (id, labelName) => labelCalls.push({ id, labelName })
                },
                classifier: {
                    classifyEmail: () => ({ shouldReply: true, reason: 'ok' })
                },
                geminiService: {
                    detectEmailLanguage: () => ({ lang: 'en', confidence: 4, safetyGrade: 3 }),
                    shouldRespondToEmail: (_body, _subject, precomputedDetection) => {
                        if (!precomputedDetection || precomputedDetection.lang !== 'en') {
                            throw new Error('precomputedDetection non passato correttamente');
                        }
                        return { shouldRespond: true, language: 'it', classification: { category: 'TECHNICAL' } };
                    },
                    getAdaptiveGreeting: () => ({ greeting: 'Ciao', closing: 'Cordiali saluti' })
                }
            });

            const out = processor.processThread(thread, 'KB', 'Doctrine', labeledMessageIds, true);

            if (previousCache) {
                global.GLOBAL_CACHE = previousCache;
            } else {
                delete global.GLOBAL_CACHE;
            }

            return out
                && out.status === 'skipped'
                && out.reason === 'italian_skipped_foreign_only_post_quickcheck'
                && !labelCalls.some(call => call.labelName === 'IA')
                && labelCalls.some(call => call.labelName === '·');
        });

        test('foreign_only: rilevamento lingua usa corpo pulito estratto dal classifier', results, () => {
            const previousCache = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE) ? { ...GLOBAL_CACHE } : null;
            global.GLOBAL_CACHE = { ...(previousCache || {}), languageMode: 'foreign_only' };

            const thread = {
                getId: () => 'thread-foreign-only-clean-body',
                getMessages: () => [
                    { getId: () => 'msg-clean-1', isUnread: () => true, getFrom: () => 'utente@example.com', getDate: () => new Date(), getSubject: () => 'Request details' }
                ]
            };

            let capturedBody = null;
            const processor = new EmailProcessor({
                gmailService: {
                    extractMessageDetails: () => ({
                        senderEmail: 'utente@example.com',
                        senderName: 'Utente',
                        subject: 'Request details',
                        body: 'TESTO ORIGINALE CON FIRMA LUNGA',
                        isNewsletter: false,
                        headers: {}
                    }),
                    _extractEmailAddress: (from) => from
                },
                classifier: {
                    _extractMainContent: () => 'Buongiorno, vorrei informazioni',
                    classifyEmail: () => ({ shouldReply: true, reason: 'ok' })
                },
                geminiService: {
                    detectEmailLanguage: (body) => {
                        capturedBody = body;
                        return { lang: 'it' };
                    }
                }
            });

            const out = processor.processThread(thread, 'KB', 'Doctrine', new Set(), true);

            if (previousCache) {
                global.GLOBAL_CACHE = previousCache;
            } else {
                delete global.GLOBAL_CACHE;
            }

            return capturedBody === 'Buongiorno, vorrei informazioni'
                && out
                && out.status === 'skipped'
                && out.reason === 'italian_skipped_foreign_only';
        });

        test('newsletter header in foreign_only: non usa skip (·), applica IA', results, () => {
            const previousCache = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE) ? { ...GLOBAL_CACHE } : null;
            global.GLOBAL_CACHE = { ...(previousCache || {}), languageMode: 'foreign_only' };

            const labelCalls = [];
            const thread = {
                getId: () => 'thread-newsletter-header',
                getMessages: () => [
                    { getId: () => 'msg-news-1', isUnread: () => true, getFrom: () => 'news@example.com', getDate: () => new Date(), getSubject: () => 'Promo editoriale' }
                ]
            };

            const processor = new EmailProcessor({
                gmailService: {
                    extractMessageDetails: () => ({
                        senderEmail: 'news@example.com',
                        senderName: 'Newsletter',
                        subject: 'Promo editoriale',
                        body: 'Scopri il nuovo catalogo.',
                        isNewsletter: true,
                        headers: { 'List-Unsubscribe': '<mailto:unsubscribe@example.com>' }
                    }),
                    _extractEmailAddress: (from) => from,
                    addLabelToMessage: (id, labelName) => labelCalls.push({ id, labelName })
                },
                geminiService: {
                    detectEmailLanguage: () => ({ lang: 'pt' })
                }
            });

            const out = processor.processThread(thread, 'KB', 'Doctrine', new Set(), true);

            if (previousCache) {
                global.GLOBAL_CACHE = previousCache;
            } else {
                delete global.GLOBAL_CACHE;
            }

            const hasSkipLabel = labelCalls.some(call => call.id === 'msg-news-1' && call.labelName === '·');
            const hasIaLabel = labelCalls.some(call => call.id === 'msg-news-1' && call.labelName === 'IA');
            return out && out.status === 'filtered' && out.reason === 'newsletter_header' && !hasSkipLabel && hasIaLabel;
        });

        test('_markMessageAsProcessed preserva skip in foreign_only (fail-safe)', results, () => {
            const previousCache = (typeof GLOBAL_CACHE !== 'undefined' && GLOBAL_CACHE) ? { ...GLOBAL_CACHE } : null;
            global.GLOBAL_CACHE = { ...(previousCache || {}), languageMode: 'foreign_only' };

            const labelCalls = [];
            const processor = new EmailProcessor({
                gmailService: {
                    addLabelToMessage: (id, labelName) => labelCalls.push({ id, labelName }),
                    removeLabelFromMessage: (id, labelName) => labelCalls.push({ id, labelName, remove: true }),
                    _getOptionalLabelIdByName: (labelName) => labelName === '·' ? 'LBL_SKIP' : null,
                    _getMessageMetadataWithResilience: () => ({ labelIds: ['LBL_SKIP'] })
                }
            });

            processor._markMessageAsProcessed({ getId: () => 'msg-skip-guard' }, new Set(), null);

            if (previousCache) {
                global.GLOBAL_CACHE = previousCache;
            } else {
                delete global.GLOBAL_CACHE;
            }

            return !labelCalls.some(call => call.labelName === 'IA')
                && !labelCalls.some(call => call.remove === true && call.labelName === '·');
        });

        test('_hasUnreadMessagesToProcess tratta un Set vuoto come cache già fornita', results, () => {
            const processor = new EmailProcessor({
                gmailService: {
                    getMessageIdsWithLabel: () => { throw new Error('fallback should not run'); },
                    _extractEmailAddress: (from) => from
                }
            });
            const thread = {
                getMessages: () => [
                    { getId: () => 'msg-empty-cache', isUnread: () => true }
                ]
            };

            return processor._hasUnreadMessagesToProcess(thread, new Set()) === true;
        });

        test('Fallback memoryService espone getRecentHistory e non rompe processThread', results, function () {
            var previousMemoryService = (typeof globalThis !== 'undefined') ? globalThis.MemoryService : undefined;
            try {
                if (typeof globalThis !== 'undefined') globalThis.MemoryService = undefined;

                var processor = new EmailProcessor({
                    gmailService: {
                        extractEmailAddress: function (from) { return from; },
                        extractMessageDetails: function () {
                            return {
                                senderEmail: 'user@example.com',
                                senderName: 'User',
                                subject: 'Richiesta informazioni',
                                body: 'Vorrei sapere gli orari.',
                                date: new Date(),
                                isNewsletter: false,
                                headers: {}
                            };
                        },
                        addLabelToMessage: function () { },
                        getMessageMetadataWithResilience: function () { return null; }
                    },
                    classifier: {
                        classifyEmail: function () { return { shouldReply: true, category: 'TECHNICAL', subIntents: [], confidence: 0.9 }; },
                        extractMainContent: function (body) { return body; }
                    },
                    geminiService: {
                        detectEmailLanguage: function () { return { lang: 'it', confidence: 5, safetyGrade: 5 }; },
                        shouldRespondToEmail: function () {
                            return {
                                shouldRespond: false,
                                reason: 'no_action_needed',
                                classification: { category: 'TECHNICAL', topic: 'orari' }
                            };
                        }
                    },
                    requestClassifier: {
                        classify: function () { return { type: 'technical' }; }
                    },
                    validator: {
                        validateResponse: function () { return { isValid: true, score: 1, warnings: [] }; }
                    }
                });

                var thread = {
                    getId: function () { return 'thread-fallback-memory'; },
                    getMessages: function () {
                        return [{
                            getId: function () { return 'msg-fallback-memory'; },
                            isUnread: function () { return true; },
                            getFrom: function () { return 'user@example.com'; },
                            getDate: function () { return new Date(); },
                            getSubject: function () { return 'Richiesta informazioni'; }
                        }];
                    }
                };

                var out = processor.processThread(thread, 'KB', 'Doctrine', new Set(), true);
                return out && (out.status === 'filtered' || out.status === 'skipped' || out.status === 'dryrun');
            } finally {
                if (typeof globalThis !== 'undefined') globalThis.MemoryService = previousMemoryService;
            }
        });
    });

    testGroup('Classifier - OOO patterns', results, () => {
        test('Non filtra come OOO una richiesta pastorale con "malattia" senza contesto assenza', results, () => {
            const classifier = new Classifier();
            const out = classifier.classifyEmail('Richiesta preghiera', 'Mia madre ha una malattia grave, possiamo parlare con il parroco?');
            return out.shouldReply === true && out.reason !== 'out_of_office_auto_reply';
        });
    });

    // 5. GeminiService
    testGroup('GeminiService - Language', results, () => {
        const service = new GeminiService();
        test('Rilevamento IT', results, () => service.detectEmailLanguage("Buongiorno").lang === 'it');
        test('Rilevamento IT con keyword iniziale', results, () => service.detectEmailLanguage("Non ho capito").lang === 'it');
        test('Rilevamento PT', results, () => service.detectEmailLanguage("Bom dia").lang === 'pt');
        test('Non confonde newsletter italiana con PT per stopword ambigue', results, () => {
            const subject = 'Fabio Rosini; il suo ultimo libro ora disponibile!';
            const body = 'Salve, il suo ultimo libro è ora disponibile in libreria. Grazie.';
            return service.detectEmailLanguage(body, subject).lang === 'it';
        });
        test('Gestisce blocco promptFeedback senza candidate', results, () => {
            const blockedService = new GeminiService({
                fetchFn: () => ({
                    getResponseCode: () => 200,
                    getContentText: () => JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] })
                })
            });
            try {
                blockedService._generateWithModel('ciao', 'gemini-2.5-flash');
                return false;
            } catch (e) {
                return e.message.includes('promptFeedback') && e.message.includes('SAFETY');
            }
        });
        test('Quick check usa al massimo 2 fetch con fallback backup su errore quota primaria', results, () => {
            const calls = [];
            const serviceWithBackup = new GeminiService({
                primaryKey: 'primary-key-abcdefghijklmnopqrstuvwxyz',
                backupKey: 'backup-key-abcdefghijklmnopqrstuvwxyz',
                fetchFn: (url) => {
                    calls.push(url);
                    if (calls.length === 1) {
                        return {
                            getResponseCode: () => 429,
                            getContentText: () => JSON.stringify({ error: { message: 'quota' } })
                        };
                    }
                    return {
                        getResponseCode: () => 200,
                        getContentText: () => JSON.stringify({
                            candidates: [{
                                content: {
                                    parts: [{
                                        text: JSON.stringify({
                                            reply_needed: true,
                                            language: 'it',
                                            category: 'TECHNICAL',
                                            dimensions: {
                                                technical: 1,
                                                pastoral: 0,
                                                doctrinal: 0,
                                                formal: 0
                                            },
                                            topic: 'test',
                                            confidence: 0.9,
                                            reason: 'ok'
                                        })
                                    }]
                                }
                            }]
                        })
                    };
                }
            });

            const out = serviceWithBackup._quickCheckWithModel('Testo richiesta', 'Oggetto', 'gemini-3.1-flash-lite');
            return calls.length === 2
                && calls[0].includes('primary-key-abcdefghijklmnopqrstuvwxyz')
                && calls[1].includes('backup-key-abcdefghijklmnopqrstuvwxyz')
                && out.shouldRespond === true;
        });
        test('Quick check forza risposta di cortesia su consegna documentale', results, () => {
            const service = new GeminiService({
                fetchFn: () => ({
                    getResponseCode: () => 200,
                    getContentText: () => JSON.stringify({
                        candidates: [{
                            content: {
                                parts: [{
                                    text: JSON.stringify({
                                        reply_needed: false,
                                        language: 'it',
                                        category: 'TECHNICAL',
                                        dimensions: {
                                            technical: 1,
                                            pastoral: 0,
                                            doctrinal: 0,
                                            formal: 0
                                        },
                                            topic: 'documentazione ricevuta',
                                            confidence: 0.9,
                                            reason: 'consegna documentazione',
                                            needs_sponsor_guidance: false
                                        })
                                }]
                            }
                        }]
                    })
                })
            });

            const out = service._quickCheckWithModel(
                'Buongiorno, allego il certificato richiesto.',
                'Documenti',
                'gemini-3.1-flash-lite',
                { lang: 'it', confidence: 5, safetyGrade: 5 },
                { intent: 'document_submission' }
            );
            return out.shouldRespond === true &&
                out.classification.topic === 'documentazione ricevuta' &&
                out.needs_sponsor_guidance === false;
        });
        test('Quick check chiede guidance padrino solo se il precheck regex lo richiede', results, () => {
            let promptWithoutSponsorCheck = '';
            const serviceWithoutSponsorCheck = new GeminiService({
                fetchFn: (_url, payload) => {
                    promptWithoutSponsorCheck = JSON.parse(payload.payload).contents[0].parts[0].text;
                    return {
                        getResponseCode: () => 200,
                        getContentText: () => JSON.stringify({
                            candidates: [{
                                content: {
                                    parts: [{
                                        text: JSON.stringify({
                                            reply_needed: true,
                                            language: 'it',
                                            category: 'TECHNICAL',
                                            dimensions: { technical: 1, pastoral: 0, doctrinal: 0, formal: 0 },
                                            topic: 'orari',
                                            confidence: 0.9,
                                            reason: 'richiesta semplice'
                                        })
                                    }]
                                }
                            }]
                        })
                    };
                }
            });
            const outWithoutSponsorCheck = serviceWithoutSponsorCheck._quickCheckWithModel(
                'Buongiorno, a che ora apre la segreteria?',
                'Orari',
                'gemini-3.1-flash-lite',
                { lang: 'it', confidence: 5, safetyGrade: 5 },
                { sponsorGuidanceCheck: false }
            );

            let promptWithSponsorCheck = '';
            const serviceWithSponsorCheck = new GeminiService({
                fetchFn: (_url, payload) => {
                    promptWithSponsorCheck = JSON.parse(payload.payload).contents[0].parts[0].text;
                    return {
                        getResponseCode: () => 200,
                        getContentText: () => JSON.stringify({
                            candidates: [{
                                content: {
                                    parts: [{
                                        text: JSON.stringify({
                                            reply_needed: true,
                                            language: 'it',
                                            category: 'TECHNICAL',
                                            dimensions: { technical: 1, pastoral: 0, doctrinal: 0, formal: 0 },
                                            topic: 'madrina cresima',
                                            confidence: 0.9,
                                            reason: 'caso ambiguo',
                                            needs_sponsor_guidance: true
                                        })
                                    }]
                                }
                            }]
                        })
                    };
                }
            });
            const outWithSponsorCheck = serviceWithSponsorCheck._quickCheckWithModel(
                'Vorrei fare da madrina alla Cresima di mia nipote: potete aiutarmi?',
                'Madrina Cresima',
                'gemini-3.1-flash-lite',
                { lang: 'it', confidence: 5, safetyGrade: 5 },
                { sponsorGuidanceCheck: true }
            );

            return !promptWithoutSponsorCheck.includes('needs_sponsor_guidance') &&
                outWithoutSponsorCheck.needs_sponsor_guidance === undefined &&
                promptWithSponsorCheck.includes('needs_sponsor_guidance') &&
                outWithSponsorCheck.needs_sponsor_guidance === true;
        });
    });

    // 6. ResponseValidator
    testGroup('ResponseValidator - Quality', results, () => {
        const validator = new ResponseValidator();
        test('Controlla e censura eventuali inferenze esposte di estrazione del LLM', results, () => {
            const res = validator.validateResponse("Rivedendo la knowledge base, ecco la risposta.", 'it', "...", "...", "...", "full");
            return res.details.exposedReasoning.score === 0.0;
        });
        test('Rileva placeholder "XXX"', results, () => {
            const res = validator.validateResponse("Gentile utente, XXX, saluti.", 'it', "...", "...", "...", "full");
            return res.details.content.score === 0.0;
        });
        test("Mantiene link descrittivo quando label è sottostringa dell'URL", results, () => {
            const optimized = validator._ottimizzaLinkDuplicati('[Santiago](https://tinyurl.com/santiago26)');
            return optimized === '[Santiago](https://tinyurl.com/santiago26)';
        });
        test('Segnala "La" articolo dopo virgola (non pronome formale)', results, () => {
            const cap = validator._checkCapitalAfterComma('Ciao, La messa è alle 10.', 'it');
            return Array.isArray(cap.violations) && cap.violations.includes('La');
        });
        test('Rileva inconsistenza lingua (ES invece di IT)', results, () => {
            const spanishText = "Hola, gracias por contactarnos. Saludos estimables.";
            const res = validator._checkLanguage(spanishText, 'it');
            return res.score < 1.0 && (res.detectedLang === 'es' || res.warnings.length > 0);
        });
        test('Considera "Buona domenica" come saluto neutro (non attiva warning orario)', results, () => {
            const res = validator._checkTimeBasedGreeting('Buona domenica a tutti voi.', 'it');
            return res.detectedTimeSlot === 'neutral' && res.score === 1.0;
        });
        test('Metodo validate accetta opts nullo senza crashare', results, () => {
            const res = validator.validate('Testo di prova lungo a sufficienza per superare il check lunghezza minimo.', null);
            return res && typeof res.isValid === 'boolean';
        });
    });

    testGroup('EmailProcessor - Business Date', results, () => {
        test('_getBusinessDateString con input nullo non usa epoch 1970 (usa data odierna)', results, () => {
            const processor = new EmailProcessor({});
            const dateStr = processor._getBusinessDateString(null);
            const currentYear = new Date().getFullYear().toString();
            return dateStr && dateStr.includes(currentYear) && !dateStr.includes('1970');
        });
    });

    // 7. Gemini JSON parser recovery
    testGroup('Gemini JSON Parser - Recovery', results, () => {
        test('Parsa JSON in blocco markdown', results, () => {
            const parsed = parseGeminiJsonLenient('```json\n{"reply_needed":true,"language":"it","category":"MIXED"}\n```');
            return parsed.reply_needed === true && parsed.language === 'it' && parsed.category === 'MIXED';
        });
        test('Recupera campi minimi da JSON troncato', results, () => {
            const parsed = parseGeminiJsonLenient('{"reply_needed": true, "language": "it", "category": "MIXED", "dimensions": {"technical": 0.6');
            return parsed.reply_needed === true && parsed.language === 'it' && parsed.category === 'MIXED';
        });
    });

    // 7b. GmailService discovery resiliency
    testGroup('GmailService - Discovery resiliente su risposta vuota', results, () => {
        const originalGmail = global.Gmail;
        const originalGmailApp = global.GmailApp;
        const originalCacheService = global.CacheService;
        const originalSession = global.Session;
        const originalUtilities = global.Utilities;
        const originalConfig = global.CONFIG;
        const makeUnreadMessage = (messageId) => ({
            getId: () => messageId,
            isUnread: () => true
        });
        const makeThreadFromMessage = (threadId, messageId) => ({
            id: threadId,
            getId: () => threadId,
            getMessages: () => [makeUnreadMessage(messageId || `msg-${threadId}`)],
            addLabel: () => { }
        });
        const searchViaAdvancedListMock = (query, start, max) => {
            const threads = [];
            let pageToken = null;
            let pages = 0;

            do {
                pages++;
                let response = null;
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        response = global.Gmail.Users.Messages.list('me', {
                            q: query,
                            maxResults: max,
                            pageToken: pageToken || undefined
                        });
                        break;
                    } catch (e) {
                        if (attempt === 1 || !/Unknown Error/i.test(String(e && e.message))) throw e;
                    }
                }

                if (!response || !Array.isArray(response.messages)) break;

                response.messages.forEach((message) => {
                    if (threads.length >= max) return;
                    const thread = global.GmailApp.getThreadById(message.threadId);
                    if (thread) threads.push(thread);
                });
                pageToken = response.nextPageToken || null;
            } while (pageToken && pages < 10 && threads.length < max);

            return threads;
        };

        try {
            global.CacheService = {
                getScriptCache: () => ({ get: () => null, put: () => { }, remove: () => { } })
            };
            global.Session = Object.assign({}, originalSession, { getScriptTimeZone: () => 'UTC' });
            global.Utilities = Object.assign({}, originalUtilities, {
                formatDate: () => '2026/03/20',
                sleep: () => { }
            });
            global.GmailApp = {
                search: searchViaAdvancedListMock,
                getThreadById: (threadId) => makeThreadFromMessage(threadId),
                getUserLabelByName: () => null
            };

            test('_discoverByQuery esclude label operative e skipLabel dalla query GmailApp.search', results, () => {
                const originalSearch = global.GmailApp.search;
                let capturedQuery = null;
                try {
                    global.GmailApp.search = (query) => {
                        capturedQuery = query;
                        return [];
                    };

                    const service = new GmailService();
                    service._discoverByQuery('IA', 'Errore', 'Verifica', 10, 5, 1, ['Saltata']);
                    return capturedQuery === 'is:unread in:inbox -label:"IA" -label:"Errore" -label:"Verifica" -label:"Saltata"';
                } finally {
                    global.GmailApp.search = originalSearch;
                }
            });

            test('_discoverByQuery gestisce eccezione diretta di GmailApp.search restituendo batch vuoto', results, () => {
                const originalSearch = global.GmailApp.search;
                try {
                    global.GmailApp.search = () => {
                        throw new Error('GmailApp.search unavailable');
                    };

                    const service = new GmailService();
                    const result = service._discoverByQuery('IA', 'Errore', 'Verifica', 10, 5, 1);
                    return Array.isArray(result.threads)
                        && result.threads.length === 0
                        && result.threadIds instanceof Set
                        && result.threadIds.size === 0
                        && result.messageIds instanceof Set
                        && result.messageIds.size === 0;
                } finally {
                    global.GmailApp.search = originalSearch;
                }
            });

            test('[via searchViaAdvancedListMock] Risposta nulla da Messages.list non interrompe il batch discovery', results, () => {
                global.Gmail = {
                    Users: {
                        Messages: {
                            list: () => null
                        }
                    }
                };

                const service = new GmailService();
                const threads = service._discoverByQuery('IA', 'Errore', 'Verifica', 10, 5, 1).threads;
                return Array.isArray(threads) && threads.length === 0;
            });

            test('[via searchViaAdvancedListMock] Errore transiente "Unknown Error" su list viene ritentato e recupera i thread', results, () => {
                let listCalls = 0;
                global.Gmail = {
                    Users: {
                        Messages: {
                            list: () => {
                                listCalls++;
                                if (listCalls < 2) {
                                    throw new Error('API call to gmail.users.messages.list failed with error: Unknown Error.');
                                }
                                return {
                                    messages: [{ id: 'm-recovered', threadId: 't-recovered' }],
                                    nextPageToken: null
                                };
                            }
                        }
                    }
                };

                const service = new GmailService();
                const result = service._discoverByQuery('IA', 'Errore', 'Verifica', 10, 5, 1);
                return listCalls === 2
                    && Array.isArray(result.threads)
                    && result.threads.length === 1
                    && result.threads[0].id === 't-recovered';
            });

            test('Metadata discovery salta il singolo messaggio con risposta vuota senza interrompere il batch', results, () => {
                let getCalls = 0;
                global.Gmail = {
                    Users: {
                        Messages: {
                            list: () => ({
                                messages: [
                                    { id: 'm-empty', threadId: 't-empty' },
                                    { id: 'm-good', threadId: 't-good' }
                                ],
                                nextPageToken: null
                            }),
                            get: (userId, messageId) => {
                                getCalls++;
                                if (messageId === 'm-empty') return null;
                                return { id: messageId, labelIds: ['INBOX', 'UNREAD'] };
                            }
                        }
                    }
                };

                const service = new GmailService();
                const threads = service._discoverByMetadata('IA', 'Errore', 'Verifica', 10, 5, 1).threads;
                return Array.isArray(threads)
                    && threads.length === 1
                    && threads[0].id === 't-good'
                    && getCalls >= 2;
            });

            test('_discoverByQuery filtra thread senza non letti e rispetta safeTargetThreads', results, () => {
                let requestedMax = null;
                global.GmailApp = {
                    search: (query, start, max) => {
                        requestedMax = max;
                        return [
                            makeThreadFromMessage('t-unread-1', 'msg-1'),
                            {
                                id: 't-no-unread',
                                getId: () => 't-no-unread',
                                getMessages: () => [{ getId: () => 'msg-read', isUnread: () => false }]
                            },
                            makeThreadFromMessage('t-unread-2', 'msg-2'),
                            makeThreadFromMessage('t-unread-3', 'msg-3')
                        ];
                    },
                    getUserLabelByName: () => null
                };

                const service = new GmailService();
                const result = service._discoverByQuery('IA', 'Errore', 'Verifica', 10, 2, 3);
                return Array.isArray(result.threads)
                    && result.threads.length === 2
                    && result.threads[0].getId() === 't-unread-1'
                    && result.threads[1].getId() === 't-unread-2'
                    && requestedMax === 6;
            });

            test('Discovery metadata continua sulle pagine successive se getThreadById restituisce null', results, () => {
                const fetchedThreadIds = [];
                global.GmailApp = {
                    getThreadById: (threadId) => {
                        fetchedThreadIds.push(threadId);
                        return threadId === 't-missing-meta' ? null : {
                            id: threadId,
                            getId: () => threadId,
                            getMessages: () => [],
                            addLabel: () => { }
                        };
                    },
                    getUserLabelByName: () => null
                };
                global.Gmail = {
                    Users: {
                        Messages: {
                            list: (userId, params) => {
                                if (!params.pageToken) {
                                    return {
                                        messages: [{ id: 'm-meta-1', threadId: 't-missing-meta' }],
                                        nextPageToken: 'page-2'
                                    };
                                }
                                return {
                                    messages: [{ id: 'm-meta-2', threadId: 't-good-meta' }],
                                    nextPageToken: null
                                };
                            },
                            get: (userId, messageId) => ({
                                id: messageId,
                                labelIds: ['INBOX', 'UNREAD']
                            })
                        }
                    }
                };

                const service = new GmailService();
                const result = service._discoverByMetadata('IA', 'Errore', 'Verifica', 10, 1, 5);
                return Array.isArray(result.threads)
                    && result.threads.length === 1
                    && result.threads[0].id === 't-good-meta'
                    && fetchedThreadIds.join(',') === 't-missing-meta,t-good-meta';
            });
        } finally {
            global.Gmail = originalGmail;
            global.GmailApp = originalGmailApp;
            global.CacheService = originalCacheService;
            global.Session = originalSession;
            global.Utilities = originalUtilities;
            global.CONFIG = originalConfig;
        }
    });

    testGroup('GmailService - Fallback label resiliente', results, () => {
        test('removeLabelFromMessage usa fallback a livello thread se API Avanzata fallisce', results, () => {
            const originalGmail = global.Gmail;
            const originalGmailApp = global.GmailApp;
            let threadFallbackCalled = false;

            try {
                global.Gmail = {
                    Users: {
                        Messages: {
                            modify: () => { throw new Error('API Error indotto'); }
                        }
                    }
                };
                global.GmailApp = Object.assign({}, originalGmailApp, {
                    getMessageById: () => ({
                        getThread: () => ({ removeLabel: () => { threadFallbackCalled = true; } })
                    }),
                    getUserLabelByName: () => ({ name: 'LabelTest' })
                });

                const service = new GmailService();
                service._getOptionalLabelIdByName = () => 'label_id_123';
                service._incrementGmailCallCounterOrThrow_ = () => { };
                service.removeLabelFromMessage('msg-123', 'LabelTest');
                return threadFallbackCalled === true;
            } finally {
                global.Gmail = originalGmail;
                global.GmailApp = originalGmailApp;
            }
        });
    });

    // 8. GmailService OCR document parsing
    testGroup('GmailService - OCR document hints', results, () => {
        const service = new GmailService();
        test('Riconosce certificato di battesimo', results, () => {
            const t = service._detectDocumentType('certificato_battesimo.pdf', 'certificato di battesimo');
            return t === 'Certificato di battesimo';
        });
        test('Maschera codice fiscale estratto', results, () => {
            const fields = service._extractDocumentFields('Codice fiscale: RSSMRA80A01H501U', true);
            return fields.length > 0 && fields[0].includes('*') && !fields[0].includes('RSSMRA80A01H501U');
        });
        test('Riconosce file Word come Documento Word', results, () => {
            const t = service._detectDocumentType('relazione.docx', 'testo generico');
            return t === 'Documento Word';
        });
        test('Riconosce file Excel come Foglio Excel', results, () => {
            const t = service._detectDocumentType('bilancio.xlsx', 'dati vari');
            return t === 'Foglio Excel';
        });
        test('Riconosce file PowerPoint come Presentazione PowerPoint', results, () => {
            const t = service._detectDocumentType('presentazione.pptx', 'slide varie');
            return t === 'Presentazione PowerPoint';
        });
        test('Mappa MIME Office contiene tutti i formati', results, () => {
            const map = service._officeMimeMap;
            return Boolean(map['application/msword'] &&
                map['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] &&
                map['application/vnd.ms-excel'] &&
                map['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] &&
                map['application/vnd.ms-powerpoint'] &&
                map['application/vnd.openxmlformats-officedocument.presentationml.presentation']);
        });

        test('_isMeaningfulOCR processa in sicurezza set estesi di caratteri e lettere accentate', results, () => {
            const service = new GmailService();
            // Testo con lettere accentate. Deve essere > 30 caratteri totali
            // e contenere almeno 5 lettere [a-zA-ZÀ-ÿ].
            const textWithAccents = "È una prova di testo accentato lunga abbastanza."; 
            return service._isMeaningfulOCR(textWithAccents, false) === true;
        });
        test('extractAttachmentContext applica il focus IBAN una sola volta', results, () => {
            const service = new GmailService();
            service._cleanupOrphanedOcrFilesIfNeeded = () => { };
            service._extractOcrTextFromAttachment = () => 'Pagamento ricevuto. IBAN IT60X0542811101000000123456 intestato alla parrocchia. Grazie.';
            service._estimateOcrConfidence = () => 1;
            service._isMeaningfulOCR = () => true;

            const message = {
                getAttachments: () => [{
                    getName: () => 'contabile.pdf',
                    getContentType: () => 'application/pdf',
                    getSize: () => 1024
                }]
            };

            const result = service.extractAttachmentContext(message, {
                ibanFocusEnabled: true,
                ibanContextChars: 40
            });
            const matches = result.text.match(/\[FOCUS IBAN DETECTED\]/g) || [];
            return matches.length === 1 && result.text.includes('IT60X0542811101000000123456');
        });
    });

    // 9. PromptEngine concerns normalization
    testGroup('PromptEngine - Concerns normalization', results, () => {
        const engine = new PromptEngine();
        const baseOptions = {
            emailContent: 'Test body',
            emailSubject: 'Test subject',
            knowledgeBase: 'KB minima',
            detectedLanguage: 'it',
            promptProfile: 'standard'
        };

        test('Accetta activeConcerns come array legacy', results, () => {
            const prompt = engine.buildPrompt(Object.assign({}, baseOptions, {
                activeConcerns: ['formatting_risk']
            }));
            return typeof prompt === 'string' && prompt.includes('✨ FORMATTAZIONE ELEGANTE E USO ICONE');
        });

        test('Accetta activeConcerns null senza eccezioni', results, () => {
            const prompt = engine.buildPrompt(Object.assign({}, baseOptions, {
                activeConcerns: null
            }));
            return typeof prompt === 'string' && prompt.length > 0;
        });
        test('Rafforza regola anti-infodumping nelle linee guida risposta', results, () => {
            const guidelines = engine._renderResponseGuidelines('it', 'ordinario', 'Buongiorno', 'Cordiali saluti');
            return guidelines.includes('REGOLA ANTI-INFODUMP') && guidelines.includes('massimo 4 frasi brevi');
        });
    });

    const duration = Date.now() - start;
    const successRate = results.total > 0 ? ((results.passed / results.total) * 100).toFixed(1) : 0;

    console.log('\n' + '╔' + '═'.repeat(68) + '╗');
    console.log('║' + ' '.repeat(20) + '📊 RISULTATI FINALI' + ' '.repeat(28) + '║');
    console.log(`║  Totale Test:      ${results.total.toString().padEnd(48)} ║`);
    console.log(`║  ✅ Superati:      ${results.passed.toString().padEnd(48)} ║`);
    console.log(`║  ❌ Falliti:       ${results.failed.toString().padEnd(48)} ║`);
    console.log(`║  Percentuale:      ${successRate}%`.padEnd(69) + '║');
    console.log(`║  Durata:           ${duration}ms`.padEnd(69) + '║');
    console.log('╚' + '═'.repeat(68) + '╝');

    return results;
}

if (typeof process !== 'undefined' && typeof require !== 'undefined' && require.main === module) {
    const results = runAllTests();
    process.exit(results.failed > 0 ? 1 : 0);
}
