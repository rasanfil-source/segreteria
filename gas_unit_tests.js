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
            base64Encode: (data) => Buffer.from(data).toString('base64')
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
    testGroup('Punto #1: RateLimiter - WAL Protection', results, () => {
        test('WAL persist elimini log se riuscito', results, () => {
            const limiter = new GeminiRateLimiter();
            limiter._persistCacheWithWAL();
            return limiter.props.getProperty('rate_limit_wal') === null;
        });
        test('WAL recovery ripristini finestre', results, () => {
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
    testGroup('Punto #3: TerritoryValidator - ReDoS', results, () => {
        const validator = new TerritoryValidator();
        test('Input ReDoS non blocchi processo', results, () => {
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
        test('Non lancia errori su rilevazione topic territorio', results, () => {
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
        test('Usa formulazione non minimizzante per scarti orari ampi', results, () => {
            const response = "Buonasera.\n\nL'incontro inizierà alle ore 16:30.\n\nCordiali saluti.";
            const messageDetails = { subject: 'Incontro', body: 'Io avevo capito 20:00.' };
            const adjusted = processor._addTimeDiscrepancyNoteIfNeeded(response, messageDetails, 'it', { topic: 'incontro' }, { type: 'technical' });
            return adjusted.includes('in un orario differente da quanto indicato da Lei');
        });
    });

    // 5. GeminiService
    testGroup('Punto #5: GeminiService - Language', results, () => {
        const service = new GeminiService();
        test('Rilevamento IT', results, () => service.detectEmailLanguage("Buongiorno").lang === 'it');
        test('Rilevamento PT', results, () => service.detectEmailLanguage("Bom dia").lang === 'pt');
    });

    // 6. ResponseValidator
    testGroup('Punto #6: ResponseValidator - Quality', results, () => {
        const validator = new ResponseValidator();
        test('Rileva leak "Rivedendo la KB"', results, () => {
            const res = validator.validateResponse("Rivedendo la knowledge base, ecco la risposta.", 'it', "...", "...", "...", "full");
            return res.details.exposedReasoning.score === 0.0;
        });
        test('Rileva placeholder "XXX"', results, () => {
            const res = validator.validateResponse("Gentile utente, XXX, saluti.", 'it', "...", "...", "...", "full");
            return res.details.content.score === 0.0;
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
