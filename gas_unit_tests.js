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
    var crypto = require('crypto');

    var loadedScripts = new Set();
    global.loadScript = function (path) {
        if (loadedScripts.has(path)) return;
        if (path === 'gas_prompt_engine.js') {
            global.loadScript('gas_response_strategy.js');
        }
        if (path === 'gas_email_processor.js') {
            global.loadScript('gas_response_strategy.js');
            global.loadScript('gas_error_types.js');
        }
        try {
            var code = fs.readFileSync(path, 'utf8');
            vm.runInThisContext(code, { filename: path });
            loadedScripts.add(path);
        } catch (e) {
            console.error(`❌ Errore caricamento script [${path}]: ${e.message}`);
            throw e;
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
        const formatDateParts = (date, tz) => {
            const d = new Date(date);
            const timeZone = tz || 'UTC';
            const parts = new Intl.DateTimeFormat('en-GB', {
                timeZone,
                hourCycle: 'h23',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }).formatToParts(d);
            return parts.reduce((acc, part) => {
                if (part.type !== 'literal') acc[part.type] = part.value;
                return acc;
            }, {});
        };
        global.Utilities = {
            formatDate: (date, tz, fmt) => {
                const d = new Date(date);
                const parts = formatDateParts(d, tz);
                if (fmt === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
                if (fmt === 'H') return String(Number(parts.hour));
                if (fmt === 'm') return String(Number(parts.minute));
                if (fmt === 's') return String(Number(parts.second));
                if (fmt === 'HH:mm') return `${parts.hour}:${parts.minute}`;
                return d.toISOString();
            },
            sleep: () => { },
            computeDigest: (algorithm, data) => {
                const algMap = { MD5: 'md5', SHA_256: 'sha256' };
                const nodeAlgorithm = algMap[algorithm] || 'sha256';
                return Array.from(crypto.createHash(nodeAlgorithm).update(String(data)).digest());
            },
            DigestAlgorithm: { MD5: 'MD5', SHA_256: 'SHA_256' },
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
            getAliases: () => Array.isArray(global.__GMAIL_ALIASES__)
                ? global.__GMAIL_ALIASES__.slice()
                : ['bot@example.com'],
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
        (fs.existsSync('gas_config.js') ? 'gas_config.js' : 'gas_config.example.js'),
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
            const backingValues = {};
            const context = {
                console,
                PropertiesService: {
                    getScriptProperties: () => ({
                        getProperty: (key) => {
                            propertyReads += 1;
                            return Object.prototype.hasOwnProperty.call(backingValues, key)
                                ? backingValues[key]
                                : null;
                        }
                    })
                }
            };

            vm.createContext(context);
            vm.runInContext(fs.readFileSync('gas_config.js', 'utf8'), context, { filename: 'gas_config.js' });
            propertyReads = 0;

            const first = context._getScriptProperty('CACHE_REGRESSION_KEY');
            backingValues.CACHE_REGRESSION_KEY = 'late-value';
            const second = context._getScriptProperty('CACHE_REGRESSION_KEY');
            return first === null
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
        test('Mock Utilities.formatDate rispetta il fuso Europe/Rome', results, () => {
            const winterHour = Utilities.formatDate(new Date('2026-01-01T22:30:05Z'), 'Europe/Rome', 'H');
            const winterTime = Utilities.formatDate(new Date('2026-01-01T22:30:05Z'), 'Europe/Rome', 'HH:mm');
            const nextRomeDay = Utilities.formatDate(new Date('2026-01-01T23:30:00Z'), 'Europe/Rome', 'yyyy-MM-dd');
            return winterHour === '23' && winterTime === '23:30' && nextRomeDay === '2026-01-02';
        });
        test('Mock GmailApp.getAliases supporta piu alias configurabili', results, () => {
            const hadAliases = Object.prototype.hasOwnProperty.call(global, '__GMAIL_ALIASES__');
            const previousAliases = global.__GMAIL_ALIASES__;
            try {
                global.__GMAIL_ALIASES__ = ['bot@example.com', 'segreteria@example.com'];
                const aliases = GmailApp.getAliases();
                return Array.isArray(aliases) &&
                    aliases.includes('bot@example.com') &&
                    aliases.includes('segreteria@example.com');
            } finally {
                if (hadAliases) {
                    global.__GMAIL_ALIASES__ = previousAliases;
                } else {
                    delete global.__GMAIL_ALIASES__;
                }
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

    testGroup('RequestTypeClassifier - Guardrail operativo sacramenti', results, () => {
        test('Cresima per fare da padrino resta tecnica anche se il quick-check sovrastima il pastorale', results, () => {
            const classifier = new RequestTypeClassifier();
            const result = classifier.classify(
                'iNFORMAZIONI (sCUSATE IL DISTURBO)',
                [
                    'Buongiorno, scusate il disturbo.',
                    'Avrei bisogno della Cresima per poter fare da padrino.',
                    'Non so bene da dove iniziare e vorrei informazioni sul corso e sui requisiti.'
                ].join('\n'),
                {
                    category: 'MIXED',
                    confidence: 0.95,
                    dimensions: { technical: 0.6, pastoral: 0.8, doctrinal: 0.4, formal: 0.1 }
                }
            );

            return result.type === 'technical' &&
                result.needsDiscernment === false &&
                result.needsDoctrine === false &&
                result.dimensions.pastoral <= 0.3 &&
                result.dimensions.doctrinal <= 0.3 &&
                result.safetyFlags.includes('procedural_sacrament_pastoral_downgrade');
        });

        test('Situazione personale concreta su padrino non viene declassata a tecnica', results, () => {
            const classifier = new RequestTypeClassifier();
            const result = classifier.classify(
                'Cresima e padrino',
                'Sono divorziato e risposato civilmente. Vorrei capire se posso fare da padrino e come muovermi per la Cresima.',
                {
                    category: 'MIXED',
                    confidence: 0.95,
                    dimensions: { technical: 0.6, pastoral: 0.8, doctrinal: 0.2, formal: 0.1 }
                }
            );

            return result.type === 'pastoral' &&
                result.needsDiscernment === true &&
                !result.safetyFlags.includes('procedural_sacrament_pastoral_downgrade');
        });

        test('FORMAL esterno generico resta formale ma non diventa sbattezzo', results, () => {
            const classifier = new RequestTypeClassifier();
            const result = classifier.classify(
                'Richiesta formale certificato',
                'Buongiorno, chiedo formalmente il rilascio di un certificato di battesimo.',
                {
                    category: 'FORMAL',
                    topic: 'certificato di battesimo',
                    confidence: 0.95,
                    dimensions: { technical: 0.6, pastoral: 0.0, doctrinal: 0.0, formal: 0.8 }
                }
            );

            return result.type === 'formal' && result.isSbattezzo === false;
        });

        test('FORMAL esterno con topic sbattezzo attiva isSbattezzo', results, () => {
            const classifier = new RequestTypeClassifier();
            const result = classifier.classify(
                'Richiesta',
                'Vorrei informazioni sulla procedura.',
                {
                    category: 'FORMAL',
                    topic: 'sbattezzo',
                    confidence: 0.95,
                    dimensions: { technical: 0.2, pastoral: 0.0, doctrinal: 0.0, formal: 0.8 }
                }
            );

            return result.type === 'formal' && result.isSbattezzo === true;
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
            limiter._recoverFromWAL();
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
        test('Accetta timestamp futuri entro 24h per drift/fusi orari', results, () => {
            const futureWithinDrift = new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString();
            const normalized = service._validateAndNormalizeTimestamp(futureWithinDrift);
            return normalized === futureWithinDrift;
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
        test('_findRowByThreadId recupera righe con whitespace nel threadId', results, () => {
            const dirtyRow = [' test-thread-dirty ', 'it', 'info', '', '[]', '2026-05-28T10:00:00.000Z', 1, 2, ''];
            const localService = Object.create(MemoryService.prototype);
            localService._getColumnCount = () => 9;
            const makeFinder = () => {
                const finder = {
                    matchEntireCell: () => finder,
                    matchCase: () => finder,
                    matchFormulaText: () => finder,
                    findNext: () => null
                };
                return finder;
            };
            localService._sheet = {
                getLastRow: () => 2,
                getLastColumn: () => 9,
                getRange: (row, _col, numRows, numCols) => {
                    if (row === 2 && numRows === 1 && numCols === 1) {
                        return {
                            createTextFinder: () => makeFinder(),
                            getValues: () => [[dirtyRow[0]]]
                        };
                    }
                    if (row === 2 && numRows === 1) {
                        return { getValues: () => [dirtyRow.slice()] };
                    }
                    return {
                        createTextFinder: () => makeFinder(),
                        getValues: () => [[dirtyRow[0]]]
                    };
                }
            };

            const found = localService._findRowByThreadId('test-thread-dirty');
            return found && found.rowIndex === 2 && String(found.values[0]).trim() === 'test-thread-dirty';
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
        test('_getCachedTimeZone usa BUSINESS_TIME_ZONE senza dipendere da Session', results, () => {
            const previousSession = global.Session;
            const previousBusinessTimeZone = global.BUSINESS_TIME_ZONE;
            let calls = 0;
            try {
                global.BUSINESS_TIME_ZONE = 'Europe/Rome';
                global.Session = Object.assign({}, previousSession, {
                    getScriptTimeZone: () => {
                        calls++;
                        return 'America/New_York';
                    }
                });
                const localProcessor = new EmailProcessor();
                return localProcessor._getCachedTimeZone() === 'Europe/Rome'
                    && localProcessor._getCachedTimeZone() === 'Europe/Rome'
                    && calls === 0;
            } finally {
                global.Session = previousSession;
                if (typeof previousBusinessTimeZone === 'undefined') {
                    delete global.BUSINESS_TIME_ZONE;
                } else {
                    global.BUSINESS_TIME_ZONE = previousBusinessTimeZone;
                }
            }
        });
        test('_detectTemporalMentions rileva giorni italiani accentati', results, () => {
            return processor._detectTemporalMentions('Ci vediamo lunedì alle 18.', 'it') === true
                && processor._detectTemporalMentions('Disponibile martedì?', 'it') === true
                && processor._detectTemporalMentions('testolunedìfuso', 'it') === false;
        });
        test('MemoryService.getRecentMemoryTopics restituisce gli ultimi topic salvati', results, () => {
            const memory = Object.create(MemoryService.prototype);
            memory._initialized = true;
            memory.getMemory = () => ({
                providedInfo: [
                    { topic: 'uno', userReaction: 'unknown' },
                    { topic: 'due', userReaction: 'acknowledged' },
                    { topic: 'tre', userReaction: 'unknown' }
                ]
            });
            const history = memory.getRecentMemoryTopics('thread-1', 2);
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
        test('Verifica territorio riconosce appartenenza parrocchiale, rientro e circoscrizione', results, () => {
            const fromTopic = processor._isTerritoryRequest(
                '',
                'Abito in via Barnaba Oriani.',
                { topic: 'Verifica appartenenza parrocchiale' }
            );
            const fromText = processor._isTerritoryRequest(
                '',
                "Vorrei sapere se rientro nella circoscrizione della parrocchia di Sant'Eugenio. Abito in via Barnaba Oriani."
            );
            const negative = processor._isTerritoryRequest(
                'Gruppo giovani',
                'Vorrei informazioni sul gruppo giovani della parrocchia.'
            );
            return fromTopic === true && fromText === true && negative === false;
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
        test('Sanitizer rimuove requisiti sponsor anche con ordine invertito e sinonimi', results, () => {
            const response = [
                'Abbiamo ricevuto i documenti.',
                'Il padrino deve rispettare alcune condizioni previste.',
                'È necessario che lo sponsor abbia ricevuto i sacramenti.',
                'I requisiti per la madrina includono la Cresima.',
                'La convivenza e il divorzio richiedono un discernimento pastorale specifico.',
                'Cordiali saluti.'
            ].join('\n');
            const cleaned = processor._sanitizeUnrequestedSponsorGuidance_(
                response,
                'Documenti Cresima',
                'Mio fratello sarà padrino. Invio il certificato richiesto.'
            );
            return cleaned.includes('Abbiamo ricevuto i documenti.') &&
                cleaned.includes('convivenza e il divorzio') &&
                cleaned.includes('Cordiali saluti.') &&
                !cleaned.includes('padrino deve rispettare') &&
                !cleaned.includes('necessario che lo sponsor') &&
                !cleaned.includes('requisiti per la madrina');
        });
        // ---- DEADLINE SACRAMENTALE ----
        test('Estrae deadline da richiesta Cresima con scadenza per padrino', results, () => {
            const ctx = processor._extractSacramentalDeadlineContext_(
                'Cresima padrino',
                'Devo fare la Cresima entro metà ottobre per fare da padrino al battesimo di mio nipote.',
                'it'
            );
            return ctx !== null &&
                ctx.deadline === 'metà ottobre' &&
                /cresima/i.test(ctx.target_outcome) &&
                /padrin/i.test(ctx.purpose) &&
                ctx.confidence >= 0.6;
        });
        test('Estrae deadline da battesimo previsto per settembre con Cresima mancante', results, () => {
            const ctx = processor._extractSacramentalDeadlineContext_(
                'Cresima',
                'Il battesimo è previsto per settembre 2026 e mi hanno chiesto di fare da madrina, ma mi manca la Cresima.',
                'it'
            );
            return ctx !== null &&
                ctx.deadline === 'settembre 2026' &&
                /cresima/i.test(ctx.target_outcome) &&
                /madrina/i.test(ctx.purpose);
        });
        test('Non estrae deadline senza vincolo temporale', results, () => {
            const ctx = processor._extractSacramentalDeadlineContext_(
                'Cresima padrino',
                'Vorrei fare la Cresima da adulto per poter fare da padrino.',
                'it'
            );
            return ctx === null;
        });
        test('Non estrae deadline senza ruolo ecclesiale', results, () => {
            const ctx = processor._extractSacramentalDeadlineContext_(
                'Cresima',
                'Vorrei fare la Cresima entro ottobre.',
                'it'
            );
            return ctx === null;
        });
        test('Rendering deadline policy produce sezione con tripletta e regole', results, () => {
            const engine = new PromptEngine();
            const rendered = engine._renderSacramentalDeadlinePolicy({
                target_outcome: 'ricevere la Cresima',
                deadline: 'metà ottobre 2026',
                purpose: 'poter svolgere il ruolo di padrino',
                confidence: 0.85
            });
            return rendered !== null &&
                rendered.includes('ricevere la Cresima') &&
                rendered.includes('metà ottobre 2026') &&
                rendered.includes('poter svolgere il ruolo di padrino') &&
                rendered.includes('COERENZA TEMPORALE');
        });
        test('Rendering deadline policy ritorna null con confidence bassa', results, () => {
            const engine = new PromptEngine();
            const rendered = engine._renderSacramentalDeadlinePolicy({
                target_outcome: 'ricevere la Cresima',
                deadline: 'ottobre',
                purpose: 'padrino',
                confidence: 0.4
            });
            return rendered === null;
        });
        test('Rendering deadline policy ritorna null senza contesto', results, () => {
            const engine = new PromptEngine();
            return engine._renderSacramentalDeadlinePolicy(null) === null &&
                engine._renderSacramentalDeadlinePolicy(undefined) === null;
        });
        test('Estrae deadline in inglese', results, () => {
            const ctx = processor._extractSacramentalDeadlineContext_(
                'Confirmation',
                'I need to receive Confirmation by October because I have been asked to be a godfather at a baptism.',
                'en'
            );
            return ctx !== null &&
                ctx.deadline === 'October' &&
                /confirmation/i.test(ctx.target_outcome) &&
                /godfather/i.test(ctx.purpose);
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
        test('Non aggiunge nota se la risposta nega info evento e cita solo orari di ritiro', results, () => {
            const response = "Buonasera Marco.\n\nIn merito alla riunione a cui fa riferimento, non abbiamo informazioni in proposito.\n\nPer quanto riguarda il certificato di battesimo di Sua figlia, per poterlo produrre abbiamo bisogno che ci comunichi le sue generalità. Una volta pronto il documento, la avviseremo; Sua cugina potrà certamente passare a ritirarlo al Suo posto dal lunedì al venerdì, dalle 8:00 alle 12:00.\n\nCordiali saluti.";
            const messageDetails = {
                subject: 'Riunione e certificato',
                body: "Salve, avevo capito che la riunione iniziasse alle 9:30, ma forse comincia un'ora dopo. Vorrei sapere se giovedì prossimo posso passare a ritirare il certificato. Non posso venire di mattina, ma mia cugina potrebbe farmi la cortesia."
            };
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
                    getMessageIdsWithLabel: () => new Set(),
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
            // shouldRespondToEmail → shouldRespond:false → _markMessageAsProcessed su tutto il burst
            // già valutato, evitando replay retrogrado dei messaggi precedenti.
            return labeledMessageIds.has('msg-1') && labeledMessageIds.has('msg-2') && labeledMessageIds.has('msg-3');
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

        test('Fallback memoryService espone topic recenti e non rompe processThread', results, function () {
            var previousMemoryService = (typeof globalThis !== 'undefined') ? globalThis.MemoryService : undefined;
            try {
                if (typeof globalThis !== 'undefined') globalThis.MemoryService = undefined;

                var processor = new EmailProcessor({
                    gmailService: {
                        extractEmailAddress: function (from) { return from; },
                        extractMessageDetails: function () {
                            return {
                                senderEmail: 'fallback-user@example.com',
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
                            getFrom: function () { return 'fallback-user@example.com'; },
                            getDate: function () { return new Date(); },
                            getSubject: function () { return 'Richiesta informazioni'; }
                        }];
                    }
                };

                var out = processor.processThread(thread, 'KB', 'Doctrine', new Set(), true);
                return typeof processor.memoryService.getRecentMemoryTopics === 'function'
                    && typeof processor.memoryService.getRecentHistory === 'function'
                    && out
                    && (out.status === 'filtered' || out.status === 'skipped' || out.status === 'dryrun');
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
        test('Richiesta formale prevale su consegna documentale', results, () => {
            const classifier = new Classifier();
            const out = classifier.classifyEmail(
                'Richiesta di sbattezzo',
                'In allegato il modulo per la cancellazione dai registri del battesimo.'
            );
            return out.shouldReply === true &&
                out.reason === 'formal_request_detected' &&
                out.category === 'formal';
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

            const out = serviceWithBackup._quickCheckWithModel('Testo richiesta', 'Oggetto', 'gemini-3.5-flash-lite');
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
                'gemini-3.5-flash-lite',
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
                'gemini-3.5-flash-lite',
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
                'gemini-3.5-flash-lite',
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
            const res = validator.validateResponse("Rivedendo la knowledge base, ecco la risposta.", 'it', "...", "...", "...", "full", false);
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
        test('Rileva maiuscole latine accentate dopo virgola', results, () => {
            const cap = validator._checkCapitalAfterComma('Hola, Él responderá pronto.', 'es');
            return Array.isArray(cap.violations) && cap.violations.includes('Él');
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
        test('Saluto temporale usa fallback se currentTime manca e salta se è invalido', results, () => {
            const missingTime = validator._checkTimeBasedGreeting(
                'Buongiorno, le confermiamo la disponibilità.',
                'it',
                { temporal: { currentDate: '2026-06-07', messageDate: '2026-06-07', timeZone: 'Europe/Rome' } }
            );
            const invalidTime = validator._checkTimeBasedGreeting(
                'Buongiorno, le confermiamo la disponibilità.',
                'it',
                { temporal: { currentDate: '2026-06-07', currentTime: 'sera', messageDate: '2026-06-07', timeZone: 'Europe/Rome' } }
            );
            return missingTime && missingTime.skipped !== true &&
                Number.isInteger(missingTime.currentHour) &&
                missingTime.currentHour >= 0 &&
                missingTime.currentHour <= 23 &&
                !missingTime.warnings.includes('missing currentTime') &&
                invalidTime && invalidTime.skipped === true &&
                invalidTime.score === 1.0 &&
                invalidTime.warnings.includes('invalid currentTime');
        });
        test('normalizeTime preserva 0 come input esplicito', results, () => {
            return ResponseValidator.toString().includes("String(t ?? '')");
        });
        test('normalizeTime converte solo pattern orari con punto completi', results, () => {
            const source = ResponseValidator.toString();
            return source.includes("replace(/^(\\d{1,2})\\.(\\d{2})$/") &&
                !source.includes("replace(/(\\d)\\.(\\d)/g");
        });
        test('CurrentTime runtime citato e leak tecnico, non orario inventato generico', results, () => {
            const result = validator._checkHallucinations(
                'Sono le 10:00. La segreteria le rispondera appena possibile.',
                'Orari disponibili: 09:00 e 11:00.',
                'Vorrei sapere gli orari delle messe.',
                { temporal: { currentDate: '2026-06-08', currentTime: '10:00', messageDate: '2026-06-08' } }
            );
            return result.errors.some(e => e.includes('Orari tecnici da non citare: 10:00')) &&
                !result.errors.some(e => e.includes('Orari non in KB: 10:00')) &&
                result.hallucinations &&
                Array.isArray(result.hallucinations.technicalTimes) &&
                result.hallucinations.technicalTimes.includes('10:00');
        });
        test('MessageTime runtime citato e leak tecnico, non orario inventato generico', results, () => {
            const result = validator._checkHallucinations(
                'Abbiamo ricevuto la sua email alle 10:45 e le rispondiamo ora.',
                'Orari disponibili: 09:00 e 11:00.',
                'Vorrei informazioni sul percorso per adulti.',
                { temporal: { currentDate: '2026-06-08', currentTime: '15:30', messageDate: '2026-06-08', messageTime: '10:45' } }
            );
            return result.errors.some(e => e.includes('Orari tecnici da non citare: 10:45')) &&
                !result.errors.some(e => e.includes('Orari non in KB: 10:45'));
        });
        test('Orario uguale al runtime resta valido se presente in KB', results, () => {
            const result = validator._checkHallucinations(
                'Il corso inizia alle 10:45.',
                'Corso adulti: sabato alle 10:45.',
                'Vorrei informazioni sul corso.',
                { temporal: { currentDate: '2026-06-08', currentTime: '10:45', messageDate: '2026-06-08', messageTime: '08:15' } }
            );
            return result.score === 1.0;
        });
        test('Metodo validate accetta opts nullo senza crashare', results, () => {
            const res = validator.validate('Testo di prova lungo a sufficienza per superare il check lunghezza minimo.', null);
            return res && typeof res.isValid === 'boolean';
        });
        test("Riferimento relativo dell'email originale non resta futuro quando ormai passato", results, () => {
            const runtimeContext = {
                temporal: {
                    currentDate: '2026-06-07',
                    currentTime: '14:27',
                    messageDate: '2026-06-01',
                    processingEpochMs: new Date('2026-06-07T12:27:00Z').getTime(),
                    messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
                    timeZone: 'Europe/Rome'
                },
                papal: {
                    currentName: 'Leone XIV',
                    previousName: 'Papa Francesco',
                    currentSince: '2025-05-08'
                }
            };
            const result = validator._checkOriginalDateQualification(
                'Confermiamo che ci vediamo domani per il corso.',
                'Ci vediamo domani per il corso.',
                runtimeContext,
                'it'
            );
            return result && result.score === 0.0 &&
                Array.isArray(result.violations) &&
                result.violations.length > 0;
        });
        test('Email scritta lunedì interpreta domani come martedì', results, () => {
            const runtimeContext = {
                temporal: {
                    currentDate: '2026-06-07',
                    currentTime: '14:00',
                    messageDate: '2026-06-01',
                    processingEpochMs: new Date('2026-06-07T12:00:00Z').getTime(),
                    messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
                    timeZone: 'Europe/Rome'
                }
            };
            const refs = validator._extractTemporalReferences_('Ci vediamo domani.', runtimeContext, 'user');
            const tomorrowRef = refs.find(ref => /domani/i.test(ref.text));
            return tomorrowRef &&
                tomorrowRef.anchorRole === 'messageDate' &&
                validator._formatDateOnly_(tomorrowRef.normalizedDate) === '2026-06-02';
        });
        test('Response senza currentDate usa messageDate prima del clock', results, () => {
            const refs = validator._extractTemporalReferences_(
                'Domani posso passare?',
                { messageDate: '2026-06-01', timeZone: 'Europe/Rome' },
                'response'
            );
            const tomorrowRef = refs.find(ref => ref.type === 'relative_point');
            return tomorrowRef &&
                tomorrowRef.anchorRole === 'messageDateFallback' &&
                tomorrowRef.anchorIsFallback === false &&
                validator._formatDateOnly_(tomorrowRef.normalizedDate) === '2026-06-02';
        });
        test('Fallback anchor parser usa Europe/Rome prima del clock locale', results, () => {
            const originalUtilities = global.Utilities;
            const originalDateTimeFormat = global.Intl.DateTimeFormat;
            let seenTimeZone = null;
            try {
                global.Utilities = {
                    formatDate: () => { throw new Error('timezone unavailable'); }
                };
                global.Intl.DateTimeFormat = function (_locale, options) {
                    seenTimeZone = options && options.timeZone;
                    return {
                        formatToParts: () => [
                            { type: 'year', value: '2026' },
                            { type: 'literal', value: '-' },
                            { type: 'month', value: '06' },
                            { type: 'literal', value: '-' },
                            { type: 'day', value: '08' }
                        ]
                    };
                };
                const refs = validator._extractTemporalReferences_('Domani posso passare?', {}, 'response');
                const tomorrowRef = refs.find(ref => ref.type === 'relative_point');
                return seenTimeZone === 'Europe/Rome' &&
                    tomorrowRef &&
                    tomorrowRef.anchorRole === 'systemFallback' &&
                    tomorrowRef.anchorIsFallback === true &&
                    validator._formatDateOnly_(tomorrowRef.normalizedDate) === '2026-06-09';
            } finally {
                global.Utilities = originalUtilities;
                global.Intl.DateTimeFormat = originalDateTimeFormat;
            }
        });
        test('_resolveTemporalCurrentDate fallback Intl usa Europe/Rome', results, () => {
            const originalUtilities = global.Utilities;
            const originalDateTimeFormat = global.Intl.DateTimeFormat;
            let seenTimeZone = null;
            try {
                global.Utilities = {
                    formatDate: () => { throw new Error('timezone unavailable'); }
                };
                global.Intl.DateTimeFormat = function (_locale, options) {
                    seenTimeZone = options && options.timeZone;
                    return {
                        formatToParts: () => [
                            { type: 'year', value: '2026' },
                            { type: 'literal', value: '-' },
                            { type: 'month', value: '06' },
                            { type: 'literal', value: '-' },
                            { type: 'day', value: '08' }
                        ]
                    };
                };
                const resolved = validator._resolveTemporalCurrentDate_(null);
                return seenTimeZone === 'Europe/Rome' &&
                    validator._formatDateOnly_(resolved) === '2026-06-08';
            } finally {
                global.Utilities = originalUtilities;
                global.Intl.DateTimeFormat = originalDateTimeFormat;
            }
        });
        test('OriginalDateQualification intercetta oggi vecchio ripetuto come futuro operativo', results, () => {
            const runtimeContext = {
                temporal: {
                    currentDate: '2026-06-07',
                    currentTime: '11:30',
                    messageDate: '2026-06-01',
                    processingEpochMs: new Date('2026-06-07T09:30:00Z').getTime(),
                    messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
                    daysAgo: 6,
                    isOldMessage: true,
                    timeZone: 'Europe/Rome'
                }
            };
            const result = validator._checkOriginalDateQualification(
                'Oggi può passare in segreteria.',
                'Oggi posso passare in segreteria?',
                runtimeContext,
                'it'
            );
            return result && result.score === 0.0 &&
                Array.isArray(result.violations) &&
                result.violations.some(v => v.originalDate === '2026-06-01' && v.responseDate === '2026-06-07');
        });
        test('OriginalDateQualification intercetta weekday futuro vecchio ripetuto come futuro', results, () => {
            const runtimeContext = {
                temporal: {
                    currentDate: '2026-06-21',
                    currentTime: '10:00',
                    messageDate: '2026-06-14',
                    processingEpochMs: new Date('2026-06-21T08:00:00Z').getTime(),
                    messageEpochMs: new Date('2026-06-14T08:00:00Z').getTime(),
                    daysAgo: 7,
                    isOldMessage: true,
                    timeZone: 'Europe/Rome'
                }
            };
            const result = validator._checkOriginalDateQualification(
                'Prossimo lunedì può passare in segreteria.',
                'Lunedì prossimo posso passare in segreteria?',
                runtimeContext,
                'it'
            );
            return result && result.score === 0.0 &&
                Array.isArray(result.violations) &&
                result.violations.some(v => v.originalType === 'weekday_relative' && v.responseType === 'weekday_relative');
        });
        test('OriginalDateQualification non collega weekday con direzione opposta solo per nome giorno', results, () => {
            const runtimeContext = {
                temporal: {
                    currentDate: '2026-06-21',
                    currentTime: '10:00',
                    messageDate: '2026-06-14',
                    processingEpochMs: new Date('2026-06-21T08:00:00Z').getTime(),
                    messageEpochMs: new Date('2026-06-14T08:00:00Z').getTime(),
                    daysAgo: 7,
                    isOldMessage: true,
                    timeZone: 'Europe/Rome'
                }
            };
            const result = validator._checkOriginalDateQualification(
                'Prossimo lunedì può passare in segreteria.',
                'Lunedì scorso posso passare in segreteria?',
                runtimeContext,
                'it'
            );
            return result && result.score === 1.0 &&
                Array.isArray(result.violations) &&
                result.violations.length === 0;
        });
        test('checkTemporalConsistency intercetta data futura descritta come già conclusa', results, () => {
            const runtimeContext = {
                temporal: {
                    currentDate: '2026-06-07',
                    currentTime: '14:27',
                    messageDate: '2026-06-07',
                    timeZone: 'Europe/Rome'
                }
            };
            const result = validator._checkTemporalConsistency("L'incontro del 10 giugno 2026 si è già svolto.", 'it', runtimeContext);
            return result && result.score === 0.0 &&
                Array.isArray(result.violations) &&
                result.violations.length > 0 &&
                result.checkedDates > 0 &&
                result.skipped === false;
        });
        test('extractTemporalReferences risolve sabato prossimo con anchor differenziato', results, () => {
            const runtimeContext = {
                temporal: {
                    currentDate: '2026-06-07',
                    messageDate: '2026-06-01',
                    processingEpochMs: new Date('2026-06-07T12:00:00Z').getTime(),
                    messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
                    timeZone: 'Europe/Rome'
                }
            };
            const userRefs = validator._extractTemporalReferences_('Sabato prossimo passo.', runtimeContext, 'user');
            const responseRefs = validator._extractTemporalReferences_('Sabato prossimo può passare.', runtimeContext, 'response');
            const userSaturday = userRefs.find(ref => ref.type === 'weekday_relative');
            const responseSaturday = responseRefs.find(ref => ref.type === 'weekday_relative');
            return userSaturday && responseSaturday &&
                validator._formatDateOnly_(userSaturday.normalizedDate) === '2026-06-06' &&
                validator._formatDateOnly_(responseSaturday.normalizedDate) === '2026-06-13';
        });
        test('checkTemporalConsistency intercetta intervallo futuro descritto come già svolto', results, () => {
            const result = validator._checkTemporalConsistency(
                'La riunione della prossima settimana si è già svolta.',
                'it',
                { currentDate: '2026-06-01' }
            );
            return result && result.score === 0.0 &&
                Array.isArray(result.violations) &&
                result.violations.some(v => v.type === 'relative_interval');
        });
        test('checkTemporalConsistency intercetta data passata descritta come futura', results, () => {
            const result = validator._checkTemporalConsistency(
                'La riunione del 6 giugno 2026 si terrà alle 18.',
                'it',
                { currentDate: '2026-06-07' }
            );
            return result && result.score === 0.0 &&
                Array.isArray(result.violations) &&
                result.violations.some(v => v.direction === 'past_as_future');
        });
        test('checkTemporalConsistency intercetta forme future italiane comuni su date passate', results, () => {
            const samples = [
                'Il 6 giugno 2026 ci saranno le messe alle 18.',
                'Il 6 giugno 2026 si terranno le celebrazioni alle 18.',
                'Il 6 giugno 2026 gli incontri avranno luogo in oratorio.'
            ];
            return samples.every(sample => {
                const result = validator._checkTemporalConsistency(sample, 'it', { currentDate: '2026-06-07' });
                return result && result.score === 0.0 &&
                    Array.isArray(result.violations) &&
                    result.violations.some(v => v.direction === 'past_as_future');
            });
        });
        test('checkTemporalConsistency intercetta passato prossimo plurale su date future', results, () => {
            const result = validator._checkTemporalConsistency(
                'Le celebrazioni del 10 giugno 2026 si sono svolte alle 18.',
                'it',
                { currentDate: '2026-06-07' }
            );
            return result && result.score === 0.0 &&
                Array.isArray(result.violations) &&
                result.violations.some(v => v.direction === 'future_as_past');
        });
        test('checkTemporalConsistency non trasforma questa settimana in passato', results, () => {
            const result = validator._checkTemporalConsistency(
                'Questa settimana si terrà il corso.',
                'it',
                { currentDate: '2026-06-03' }
            );
            return result && result.score === 1.0;
        });
        test('Date esplicite uguali restano uguali con anchor diverso', results, () => {
            const runtimeContext = {
                temporal: {
                    currentDate: '2026-06-07',
                    currentTime: '16:00',
                    messageDate: '2026-06-01',
                    processingEpochMs: new Date('2026-06-07T14:00:00Z').getTime(),
                    messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
                    timeZone: 'Europe/Rome'
                }
            };
            const userDate = validator._extractTemporalReferences_('Appuntamento del 2 giugno 2026.', runtimeContext, 'user')
                .find(ref => ref.type === 'explicit_date');
            const responseDate = validator._extractTemporalReferences_('Appuntamento del 2 giugno 2026.', runtimeContext, 'response')
                .find(ref => ref.type === 'explicit_date');
            const result = validator._checkOriginalDateQualification(
                "L'appuntamento del 2 giugno 2026 si è svolto regolarmente.",
                'Appuntamento del 2 giugno 2026.',
                runtimeContext,
                'it'
            );
            return userDate && responseDate &&
                userDate.anchorRole === 'messageDate' &&
                responseDate.anchorRole === 'currentDate' &&
                validator._formatDateOnly_(userDate.normalizedDate) === '2026-06-02' &&
                validator._formatDateOnly_(responseDate.normalizedDate) === '2026-06-02' &&
                result && result.score === 1.0;
        });
        test('Intervallo relativo attraversa mese e anno', results, () => {
            const runtimeContext = {
                temporal: {
                    currentDate: '2026-12-27',
                    messageDate: '2026-12-27',
                    timeZone: 'Europe/Rome'
                }
            };
            const refs = validator._extractTemporalReferences_('La prossima settimana ci sarà il corso.', runtimeContext, 'response');
            const weekRef = refs.find(ref => ref.type === 'relative_interval');
            const result = validator._checkTemporalConsistency(
                'La prossima settimana si è già svolto il corso.',
                'it',
                runtimeContext
            );
            return weekRef &&
                validator._formatDateOnly_(weekRef.normalizedRange.start) === '2026-12-28' &&
                validator._formatDateOnly_(weekRef.normalizedRange.end) === '2027-01-03' &&
                result && result.score === 0.0;
        });
        test('OriginalDateQualification include intervalli relativi vecchi', results, () => {
            const runtimeContext = {
                temporal: {
                    currentDate: '2026-06-21',
                    currentTime: '10:00',
                    messageDate: '2026-06-01',
                    processingEpochMs: new Date('2026-06-21T08:00:00Z').getTime(),
                    messageEpochMs: new Date('2026-06-01T08:00:00Z').getTime(),
                    daysAgo: 20,
                    isOldMessage: true,
                    timeZone: 'Europe/Rome'
                }
            };
            const result = validator._checkOriginalDateQualification(
                'Confermiamo che ci vediamo la prossima settimana per il corso.',
                'Ci vediamo la prossima settimana per il corso.',
                runtimeContext,
                'it'
            );
            return result && result.score === 0.0 &&
                Array.isArray(result.violations) &&
                result.violations.some(v => v.originalType === 'relative_interval' && v.responseType === 'relative_interval');
        });
        test('extractTemporalReferences conserva ambigui senza data inventata', results, () => {
            const refs = validator._extractTemporalReferences_(
                'Lunedì passo nei prossimi giorni.',
                { currentDate: '2026-06-01', messageDate: '2026-06-01' },
                'response'
            );
            const ambiguousRefs = refs.filter(ref => ref.type === 'ambiguous_relative');
            return ambiguousRefs.length >= 2 &&
                ambiguousRefs.every(ref => !ref.normalizedDate && !ref.normalizedRange);
        });
        test('Saluto usa currentTime e non messageDate', results, () => {
            const runtimeContext = {
                temporal: {
                    currentDate: '2026-06-07',
                    currentTime: '20:30',
                    messageDate: '2026-06-01',
                    timeZone: 'Europe/Rome'
                }
            };
            const wrongGreeting = validator._checkTimeBasedGreeting('Buongiorno, le confermiamo la disponibilità.', 'it', runtimeContext);
            const correctGreeting = validator._checkTimeBasedGreeting('Buonasera, le confermiamo la disponibilità.', 'it', runtimeContext);
            return wrongGreeting && wrongGreeting.score < 1.0 &&
                wrongGreeting.expectedTimeSlot === 'evening' &&
                correctGreeting && correctGreeting.score === 1.0 &&
                correctGreeting.expectedTimeSlot === 'evening';
        });
    });

    testGroup('EmailProcessor - Business Date', results, () => {
        test('_getBusinessDateString con input nullo non usa epoch 1970 (usa data odierna)', results, () => {
            const processor = new EmailProcessor({});
            const dateStr = processor._getBusinessDateString(null);
            const currentYear = new Date().getFullYear().toString();
            return dateStr && dateStr.includes(currentYear) && !dateStr.includes('1970');
        });
        test('_getBusinessDateString fallback senza Utilities/Intl usa getter locali', results, () => {
            const originalUtilities = global.Utilities;
            const originalIntl = global.Intl;
            try {
                global.Utilities = undefined;
                global.Intl = { DateTimeFormat: function () { throw new Error('Intl unavailable'); } };
                const processor = new EmailProcessor({});
                return processor._getBusinessDateString(new Date(2026, 5, 2, 0, 30, 0)) === '2026-06-02';
            } finally {
                global.Utilities = originalUtilities;
                global.Intl = originalIntl;
            }
        });
        test('Data senza anno nel giorno stesso resta current_year', results, () => {
            const processor = new EmailProcessor({});
            const context = processor._resolveScheduleContext(
                'A che ora saranno le messe il 15 agosto?',
                '',
                '2026-08-15',
                'it'
            );
            return context.targetDate === '2026-08-15' &&
                context.yearInference === 'current_year';
        });
        test('Fallback periodo estivo gestisce 26 giugno domenica', results, () => {
            const processor = new EmailProcessor({});
            const context = processor._resolveScheduleContext(
                'Orari Messe',
                '',
                '2022-06-27',
                'it'
            );
            const previousDay = processor._resolveScheduleContext(
                'Orari Messe',
                '',
                '2022-06-26',
                'it'
            );
            return context.source === 'fallback_formula' &&
                context.summerStartDate === '2022-06-27' &&
                context.season === 'estivo' &&
                previousDay.season === 'invernale';
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

            test('_discoverByQuery non esclude label a livello thread', results, () => {
                const originalSearch = global.GmailApp.search;
                let capturedQuery = null;
                try {
                    global.GmailApp.search = (query) => {
                        capturedQuery = query;
                        return [];
                    };

                    const service = new GmailService();
                    service._discoverByQuery('IA', 'Errore', 'Verifica', 10, 5, 1, ['Saltata']);
                    return capturedQuery === 'is:unread in:inbox';
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

            test('Metadata discovery propaga messages.get non recuperabile invece di saltare silenziosamente', results, () => {
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
                try {
                    service._discoverByMetadata('IA', 'Errore', 'Verifica', 10, 5, 1);
                    return false;
                } catch (error) {
                    return String(error.message).includes('m-empty') && getCalls >= 2;
                }
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
                service._getMessageMetadataWithResilience = (messageId) => ({
                    labelIds: messageId === 'msg-read' ? ['INBOX'] : ['INBOX', 'UNREAD']
                });
                const result = service._discoverByQuery('IA', 'Errore', 'Verifica', 10, 2, 3);
                return Array.isArray(result.threads)
                    && result.threads.length === 2
                    && result.threads[0].getId() === 't-unread-1'
                    && result.threads[1].getId() === 't-unread-2'
                    && requestedMax === 30;
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
        test('removeLabelFromMessage non usa fallback a livello thread se API Avanzata fallisce per preservare granularità message-level', results, () => {
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
                return threadFallbackCalled === false;
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
            return prompt && typeof prompt === 'object' &&
                typeof prompt.toString === 'function' &&
                prompt.toString().includes('ISTRUZIONE FINALE DI OUTPUT');
        });
        test('Accetta activeConcerns come array di oggetti key/value', results, () => {
            const prompt = engine.buildPrompt(Object.assign({}, baseOptions, {
                category: 'information',
                activeConcerns: [{ key: 'formatting_risk', value: true }]
            }));
            return prompt && typeof prompt.toString === 'function' &&
                prompt.toString().includes('ESEMPI DI RISPOSTA CORRETTA');
        });

        test('Accetta activeConcerns null senza eccezioni', results, () => {
            const prompt = engine.buildPrompt(Object.assign({}, baseOptions, {
                activeConcerns: null
            }));
            return prompt && typeof prompt === 'object' &&
                typeof prompt.systemInstruction === 'string' &&
                typeof prompt.prompt === 'string' &&
                prompt.toString().length > 0;
        });
        test('Relational posture direct viene renderizzata come direttiva operativa', results, () => {
            const prompt = engine.buildPrompt(Object.assign({}, baseOptions, {
                relationalPosture: 'direct'
            })).toString();
            return prompt.includes('=== LINEE GUIDA PRAGMATICHE ===') &&
                prompt.includes('- Tono istituzionale. Rispondi ai fatti esclusivamente con i fatti.');
        });
        test('Relational posture difende da valori non allowlistati', results, () => {
            const section = engine.renderRelationalPosture('personal\nurgent');
            return section.includes('=== LINEE GUIDA PRAGMATICHE ===') &&
                section.includes('- Tono istituzionale. Rispondi ai fatti esclusivamente con i fatti.');
        });
        test('Relational posture personal espone istruzioni pastorali sobrie', results, () => {
            const section = engine.renderRelationalPosture('personal');
            return section.includes('=== LINEE GUIDA PRAGMATICHE ===') &&
                section.includes('Il mittente ha condiviso qualcosa di personale o delicato') &&
                section.includes('Non amplificare o parafrasare il vissuto del mittente') &&
                section.includes('rimani vicino a ciò che è stato scritto esplicitamente');
        });
        test('Relational posture open resta distinta da direct', results, () => {
            const section = engine.renderRelationalPosture('open');
            return section.includes('calda e propositiva') &&
                section.includes('registro leggermente più personale') &&
                section.includes('Evita di amplificare il tono positivo oltre il necessario') &&
                !section.includes('Rispondi ai fatti esclusivamente con i fatti.');
        });
        test('Relational posture hesitant non conferma imbarazzo', results, () => {
            const section = engine.renderRelationalPosture('hesitant');
            return section.includes('accoglila come legittima') &&
                section.includes('la chiarezza è già un atto di rispetto') &&
                section.includes('attribuire stati d\'animo non esplicitati') &&
                !section.includes('nessun problema') &&
                !section.includes('si figuri');
        });
        test('Relational posture urgent privilegia soluzione operativa', results, () => {
            const section = engine.renderRelationalPosture('urgent');
            return section.includes('urgenza o pressione temporale') &&
                section.includes('vai dritto alla soluzione operativa') &&
                section.includes('data imminente');
        });
        test('Relational posture complaint prescrive verbi di azione', results, () => {
            const section = engine.renderRelationalPosture('complaint');
            return section.includes('fattuale') &&
                section.includes('non difenderti') &&
                section.includes('Evita formule consolatorie') &&
                section.includes('verificheremo') &&
                section.includes('provvederemo');
        });
        test('Postura personal su requestType technical attiva AI_CORE_LITE', results, () => {
            const prompt = engine.buildPrompt(Object.assign({}, baseOptions, {
                relationalPosture: 'personal',
                requestType: { type: 'technical', needsDiscernment: false, needsDoctrine: false },
                aiCoreLite: 'PRINCIPI_LITE_PLACEHOLDER'
            })).toString();
            return prompt.includes('PRINCIPI PASTORALI FONDAMENTALI (AI_CORE_LITE)') &&
                prompt.includes('PRINCIPI_LITE_PLACEHOLDER');
        });
        test('requestType.isSbattezzo silenzia postura personal e attiva template formale', results, () => {
            const prompt = engine.buildPrompt(Object.assign({}, baseOptions, {
                relationalPosture: 'personal',
                requestType: { type: 'technical', needsDiscernment: false, needsDoctrine: false, isSbattezzo: true },
                category: 'technical',
                topic: 'procedura',
                aiCoreLite: 'AI_CORE_LITE_FORMAL_SHOULD_NOT_APPEAR'
            })).toString();
            return prompt.includes('TEMPLATE OBBLIGATORIO: RICHIESTA CANCELLAZIONE REGISTRI') &&
                prompt.includes('- Tono istituzionale. Rispondi ai fatti esclusivamente con i fatti.') &&
                !prompt.includes('Il mittente ha condiviso qualcosa di personale o delicato') &&
                !prompt.includes('AI_CORE_LITE_FORMAL_SHOULD_NOT_APPEAR');
        });
        test('category formal generica non attiva template sbattezzo ne sopprime casi speciali', results, () => {
            const prompt = engine.buildPrompt(Object.assign({}, baseOptions, {
                category: 'formal',
                topic: 'richiesta certificato',
                requestType: { type: 'formal', needsDiscernment: false, needsDoctrine: false }
            })).toString();
            return !prompt.includes('TEMPLATE OBBLIGATORIO: RICHIESTA CANCELLAZIONE REGISTRI') &&
                !prompt.includes('verificherà i propri registri per accertare se il Suo Battesimo') &&
                prompt.includes('SITUAZIONI CANONICAMENTE COMPLESSE');
        });
        test('category formal con topic sbattezzo attiva template sbattezzo', results, () => {
            const prompt = engine.buildPrompt(Object.assign({}, baseOptions, {
                category: 'formal',
                topic: 'sbattezzo',
                requestType: { type: 'formal', needsDiscernment: false, needsDoctrine: false }
            })).toString();
            return prompt.includes('TEMPLATE OBBLIGATORIO: RICHIESTA CANCELLAZIONE REGISTRI') &&
                !prompt.includes('SITUAZIONI CANONICAMENTE COMPLESSE');
        });
        test('Contesto temporale papale renderizza inizio ministero senza undefined', results, () => {
            const originalConfig = global.CONFIG;
            try {
                global.CONFIG = Object.assign({}, originalConfig, {
                    PAPAL_CONTEXT: {
                        currentName: 'Leone XIV',
                        previousName: 'Papa Francesco',
                        currentSince: '2025-05-08'
                    },
                    CURRENT_POPE_MINISTRY_START: '2025-05-18'
                });
                const prompt = engine._renderTemporalAwareness(
                    {
                        currentDate: '2026-06-08',
                        messageDate: '2026-06-08',
                        currentTime: '10:00',
                        timeZone: 'Europe/Rome'
                    },
                    'it',
                    'full',
                    '',
                    null
                );
                return prompt.includes('Leone XIV dal 2025-05-08') &&
                    prompt.includes('inizio ministero petrino: 2025-05-18') &&
                    !prompt.includes('undefined');
            } finally {
                global.CONFIG = originalConfig;
            }
        });
        test('Rafforza regola anti-infodumping nelle linee guida risposta', results, () => {
            const guidelines = engine._renderResponseGuidelines('it', 'ordinario', 'Buongiorno', 'Cordiali saluti');
            return guidelines.includes('REGOLA ANTI-INFODUMP') && guidelines.includes('ogni frase deve guadagnarsi il suo posto');
        });
        test('Profilo lite mantiene il tono umano e la formattazione sensibile nel lutto', results, () => {
            const prompt = engine.buildPrompt(Object.assign({}, baseOptions, {
                promptProfile: 'lite',
                subIntents: { bereavement: true },
                category: 'information'
            })).toString();
            return prompt.includes('TONO DI VOCE E STILE RELAZIONALE') &&
                prompt.includes('CONTESTO SENSIBILE E GERARCHIA') &&
                prompt.includes('come una lettera scritta a mano');
        });
        test('Renders newInformationProvided slots appropriately with Italian labels', results, () => {
            const prompt = engine.buildPrompt(Object.assign({}, baseOptions, {
                newInformationProvided: ['deceased_name', 'baptism_date', 'unknown_slot']
            })).toString();
            return prompt.includes('## INFORMAZIONE APPENA RICEVUTA') &&
                prompt.includes("- nome del defunto") &&
                prompt.includes("- data del battesimo") &&
                !prompt.includes("- unknown_slot") &&
                prompt.includes("Non richiedere nuovamente queste informazioni.");
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
