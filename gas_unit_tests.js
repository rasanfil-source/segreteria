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
            formatDate: (date, tz, fmt) => new Date(date).toISOString(),
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
                remove: (k) => cache.delete(k)
            })
        };
    }

    if (typeof global.SpreadsheetApp === 'undefined') {
        global.SpreadsheetApp = {
            flush: () => { },
            openById: () => ({
                getSheetByName: () => ({
                    getRange: (r) => ({
                        getValues: () => [[
                            'threadId', 'language', 'category', 'tone', 'providedInfo', 'lastUpdated', 'messageCount', 'version', 'memorySummary'
                        ]],
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
                    }),
                    createTextFinder: (text) => ({
                        matchEntireCell: () => ({
                            matchCase: () => ({
                                matchFormulaText: () => ({
                                    findNext: () => (text.includes('test-thread') ? { getRow: () => 2, getColumn: () => 1 } : null)
                                })
                            })
                        })
                    }),
                    appendRow: () => { },
                    getLastRow: () => 10,
                    getMaxRows: () => 100,
                    getMaxColumns: () => 10
                })
            })
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
        'gas_config.example.js',
        'gas_error_types.js',
        'gas_rate_limiter.js',
        'gas_memory_service.js',
        'gas_territory_validator.js',
        'gas_gmail_service.js',
        'gas_prompt_engine.js',
        'gas_email_processor.js',
        'gas_gemini_service.js',
        'gas_classifier.js',
        'gas_request_classifier.js',
        'gas_response_validator.js'
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
        process.exit(1);
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
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════

function runAllTests() {
    console.log('╔' + '═'.repeat(68) + '╗');
    console.log('║' + ' '.repeat(15) + '🧪 SUITE DI TEST' + ' '.repeat(36) + '║');
    console.log('╚' + '═'.repeat(68) + '╝');

    const results = { total: 0, passed: 0, failed: 0 };
    const start = Date.now();

    // 1. RateLimiter
    testGroup('Punto #1: RateLimiter - Persistenza Transazionale', results, () => {
        test('Il gestore della persistenza pulisce i registri dopo sincronizzazione riuscita', results, () => {
            const limiter = new GeminiRateLimiter();
            limiter._persistCacheWithWAL();
            return limiter.props.getProperty('rate_limit_wal') === null;
        });
        test('Il ripristino di stato rigenera in modo coerente le finestre operative', results, () => {
            const limiter = new GeminiRateLimiter();
            const wal = { timestamp: Date.now(), rpm: [{ timestamp: Date.now(), modelKey: 'flash' }], tpm: [] };
            limiter.props.setProperty('rate_limit_wal', JSON.stringify(wal));
            limiter._recoverFromWAL();
            return limiter.cache.rpmWindow.length > 0;
        });
    });

    // 2. MemoryService
    testGroup('Punto #2: MemoryService - Timestamp & Lock', results, () => {
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
    });

    // 3. TerritoryValidator
    testGroup('Punto #3: TerritoryValidator - Gestione Input Estremi', results, () => {
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
    });

    // 4. EmailProcessor
    testGroup('Punto #4: EmailProcessor - Topic Detection', results, () => {
        const processor = new EmailProcessor();
        test('Gestisce in modo dinamico la rilevazione in assenza esplicita di topic', results, () => {
            const topics = processor._detectProvidedTopics('La via Antonio Gramsci rientra nel territorio parrocchiale.');
            return Array.isArray(topics) && topics.includes('territorio');
        });
        test('Verifica territorio solo su richiesta esplicita', results, () => {
            const ask = processor._isTerritoryRequest('Info territorio', 'Via Antonio Gramsci rientra?');
            const noAsk = processor._isTerritoryRequest('Iscrizione cresima', 'Abito in via Antonio Gramsci.');
            return ask === true && noAsk === false;
        });
        test('Aggiunge nota differenza orario in modo generico (non solo cresima)', results, () => {
            const response = 'Buonasera.\n\nIl prossimo corso prematrimoniale inizierà alle ore 16:30.\n\nCordiali saluti.';
            const messageDetails = { subject: 'Corso prematrimoniale', body: 'Pensavo iniziasse alle 17:00.' };
            const adjusted = processor._addTimeDiscrepancyNoteIfNeeded(response, messageDetails, 'it', { topic: 'corso prematrimoniale' }, { type: 'technical' });
            return adjusted.includes('in un orario diverso rispetto a quanto da Lei indicato');
        });
        test('Non aggiunge nota se l\'utente cita un orario solo come contesto', results, () => {
            const response = 'Buonasera.\n\nL\'incontro inizierà alle ore 16:30.\n\nCordiali saluti.';
            const messageDetails = { subject: 'Incontro', body: 'Domani riesco a passare alle 17:00 per chiedere informazioni.' };
            const adjusted = processor._addTimeDiscrepancyNoteIfNeeded(response, messageDetails, 'it', { topic: 'incontro' }, { type: 'technical' });
            return adjusted === response;
        });
        test('Usa formulazione non minimizzante per scarti orari ampi', results, () => {
            const response = "Buonasera.\n\nL'incontro inizierà alle ore 16:30.\n\nCordiali saluti.";
            const messageDetails = { subject: 'Incontro', body: 'Io avevo capito 20:00.' };
            const adjusted = processor._addTimeDiscrepancyNoteIfNeeded(response, messageDetails, 'it', { topic: 'incontro' }, { type: 'technical' });
            return adjusted.includes('in un orario differente da quanto indicato da Lei');
        });

        test('processThread tratta un Set vuoto come cache già fornita', results, () => {
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
                    getMessageIdsWithLabel: () => { throw new Error('fallback should not run'); },
                    extractMessageDetails: (m) => ({ senderEmail: 'user@external.com', date: new Date() }),
                    _extractEmailAddress: (f) => f,
                    addLabelToMessage: (id) => labeledMessageIds.add(id)
                },
                geminiService: {
                    shouldRespondToEmail: () => ({ shouldRespond: false }) // Skip GEMINI per semplicità
                }
            });

            processor.processThread(thread, 'KB', 'Doctrine', labeledMessageIds, true);
            // Dovrebbe aver marcato tutti e 3 come elaborati (il candidate + gli altri 2)
            return labeledMessageIds.has('msg-1') && labeledMessageIds.has('msg-2') && labeledMessageIds.has('msg-3');
        });

        test('_hasUnreadMessagesToProcess tratta un Set vuoto come cache già fornita', results, () => {
            const processor = new EmailProcessor({
                gmailService: {
                    getMessageIdsWithLabel: () => { throw new Error('fallback should not run'); }
                }
            });
            const thread = {
                getMessages: () => [
                    { getId: () => 'msg-empty-cache', isUnread: () => true }
                ]
            };

            return processor._hasUnreadMessagesToProcess(thread, new Set()) === true;
        });
    });

    testGroup('Punto #4b: Classifier - OOO patterns', results, () => {
        test('Non filtra come OOO una richiesta pastorale con "malattia" senza contesto assenza', results, () => {
            const classifier = new Classifier();
            const out = classifier.classifyEmail('Richiesta preghiera', 'Mia madre ha una malattia grave, possiamo parlare con il parroco?');
            return out.shouldReply === true && out.reason !== 'out_of_office_auto_reply';
        });
    });

    // 5. GeminiService
    testGroup('Punto #5: GeminiService - Language', results, () => {
        const service = new GeminiService();
        test('Rilevamento IT', results, () => service.detectEmailLanguage("Buongiorno").lang === 'it');
        test('Rilevamento IT con keyword iniziale', results, () => service.detectEmailLanguage("Non ho capito").lang === 'it');
        test('Rilevamento PT', results, () => service.detectEmailLanguage("Bom dia").lang === 'pt');
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

            const out = serviceWithBackup._quickCheckWithModel('Testo richiesta', 'Oggetto', 'gemini-2.5-flash');
            return calls.length === 2
                && calls[0].includes('primary-key-abcdefghijklmnopqrstuvwxyz')
                && calls[1].includes('backup-key-abcdefghijklmnopqrstuvwxyz')
                && out.shouldRespond === true;
        });
    });

    // 6. ResponseValidator
    testGroup('Punto #6: ResponseValidator - Quality', results, () => {
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
    });

    // 7. Gemini JSON parser recovery
    testGroup('Punto #7: Gemini JSON Parser - Recovery', results, () => {
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
    testGroup('Punto #7b: GmailService - Discovery resiliente su risposta vuota', results, () => {
        const originalGmail = global.Gmail;
        const originalGmailApp = global.GmailApp;
        const originalCacheService = global.CacheService;
        const originalSession = global.Session;
        const originalUtilities = global.Utilities;
        const originalConfig = global.CONFIG;

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
                getThreadById: (threadId) => ({ id: threadId }),
                getUserLabelByName: () => null
            };

            test('Risposta nulla da Gmail.Users.Messages.list non interrompe il batch discovery', results, () => {
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

            test('Errore transiente "Unknown Error" su list viene ritentato e recupera i thread', results, () => {
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

            test('Metadata discovery salta messaggio con errore transiente su get e continua', results, () => {
                global.Gmail = {
                    Users: {
                        Messages: {
                            list: () => ({
                                messages: [
                                    { id: 'm-unknown', threadId: 't-unknown' },
                                    { id: 'm-good-meta-2', threadId: 't-good-meta-2' }
                                ],
                                nextPageToken: null
                            }),
                            get: (userId, messageId) => {
                                if (messageId === 'm-unknown') {
                                    throw new Error('API call failed with error: Unknown Error.');
                                }
                                return { id: messageId, labelIds: ['INBOX', 'UNREAD'] };
                            }
                        }
                    }
                };

                const service = new GmailService();
                const threads = service._discoverByMetadata('IA', 'Errore', 'Verifica', 10, 5, 1).threads;
                return Array.isArray(threads)
                    && threads.length === 1
                    && threads[0].id === 't-good-meta-2';
            });

            test('Discovery query continua sulle pagine successive se getThreadById restituisce null', results, () => {
                const fetchedThreadIds = [];
                global.GmailApp = {
                    getThreadById: (threadId) => {
                        fetchedThreadIds.push(threadId);
                        return threadId === 't-missing' ? null : { id: threadId };
                    },
                    getUserLabelByName: () => null
                };
                global.Gmail = {
                    Users: {
                        Messages: {
                            list: (userId, params) => {
                                if (!params.pageToken) {
                                    return {
                                        messages: [{ id: 'm-1', threadId: 't-missing' }],
                                        nextPageToken: 'page-2'
                                    };
                                }
                                return {
                                    messages: [{ id: 'm-2', threadId: 't-good-2' }],
                                    nextPageToken: null
                                };
                            }
                        }
                    }
                };

                const service = new GmailService();
                const result = service._discoverByQuery('IA', 'Errore', 'Verifica', 10, 1, 5);
                return Array.isArray(result.threads)
                    && result.threads.length === 1
                    && result.threads[0].id === 't-good-2'
                    && fetchedThreadIds.join(',') === 't-missing,t-good-2';
            });

            test('Discovery metadata continua sulle pagine successive se getThreadById restituisce null', results, () => {
                const fetchedThreadIds = [];
                global.GmailApp = {
                    getThreadById: (threadId) => {
                        fetchedThreadIds.push(threadId);
                        return threadId === 't-missing-meta' ? null : { id: threadId };
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

    // 8. GmailService OCR document parsing
    testGroup('Punto #8: GmailService - OCR document hints', results, () => {
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
    testGroup('Punto #9: PromptEngine - Concerns normalization', results, () => {
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
