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
            DigestAlgorithm: { MD5: 'MD5' }
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
        'gas_config_s.js',
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
    console.log('║' + ' '.repeat(15) + '🧪 TEST SUITE ESTESA V2.0.4' + ' '.repeat(25) + '║');
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
    });

    // 4. GeminiService
    testGroup('Punto #4: GeminiService - Language', results, () => {
        const service = new GeminiService();
        test('Rilevamento IT', results, () => service.detectEmailLanguage("Buongiorno").lang === 'it');
        test('Rilevamento PT', results, () => service.detectEmailLanguage("Bom dia").lang === 'pt');
    });

    // 5. ResponseValidator
    testGroup('Punto #5: ResponseValidator - Quality', results, () => {
        const validator = new ResponseValidator();
        test('Rileva leak "Rivedendo la KB"', results, () => {
            const res = validator.validateResponse("Rivedendo la knowledge base, ecco la risposta.", 'it', "...", "...", "...", "full");
            return res.details.exposedReasoning.score === 0.0;
        });
        test('Rileva placeholder "XXX"', results, () => {
            const res = validator.validateResponse("Gentile utente, XXX, saluti.", 'it', "...", "...", "...", "full");
            return res.details.content.score === 0.0;
        });
    });

    // 6. Gemini JSON parser recovery
    testGroup('Punto #6: Gemini JSON Parser - Recovery', results, () => {
        test('Parsa JSON in blocco markdown', results, () => {
            const parsed = parseGeminiJsonLenient('```json\n{"reply_needed":true,"language":"it","category":"MIXED"}\n```');
            return parsed.reply_needed === true && parsed.language === 'it' && parsed.category === 'MIXED';
        });
        test('Recupera campi minimi da JSON troncato', results, () => {
            const parsed = parseGeminiJsonLenient('{"reply_needed": true, "language": "it", "category": "MIXED", "dimensions": {"technical": 0.6');
            return parsed.reply_needed === true && parsed.language === 'it' && parsed.category === 'MIXED';
        });
    });

    // 7. GmailService OCR document parsing
    testGroup('Punto #7: GmailService - OCR document hints', results, () => {
        const service = new GmailService();
        test('Riconosce certificato di battesimo', results, () => {
            const t = service._detectDocumentType('certificato_battesimo.pdf', 'certificato di battesimo');
            return t === 'Certificato di battesimo';
        });
        test('Maschera codice fiscale estratto', results, () => {
            const fields = service._extractDocumentFields('Codice fiscale: RSSMRA80A01H501U', true);
            return fields.length > 0 && fields[0].includes('*') && !fields[0].includes('RSSMRA80A01H501U');
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
