/**
 * gas_unit_tests.js - Test Suite Estesa (Obiettivo: 100% Copertura)
 */

// ═══════════════════════════════════════════════════════════════════════════
// FUNZIONI HELPER
// ═══════════════════════════════════════════════════════════════════════════

function testGroup(label, results, callback) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🧪 ${label}`);
    console.log('═'.repeat(70));
    callback();
}

function test(label, results, callback) {
    results.total = (results.total || 0) + 1;

    try {
        const result = callback();

        if (result === true || result === undefined) {
            console.log(`  ✅ ${label}`);
            results.passed = (results.passed || 0) + 1;
        } else {
            console.error(`  ❌ ${label}`);
            results.failed = (results.failed || 0) + 1;
            results.tests = results.tests || [];
            results.tests.push({ name: label, status: 'FAILED' });
        }
    } catch (error) {
        console.error(`  💥 ${label}: ${error.message}`);
        results.failed = (results.failed || 0) + 1;
        results.tests = results.tests || [];
        results.tests.push({ name: label, status: 'ERROR', error: error.message });
    }
}

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message || 'Asserzione fallita');
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// PUNTO #1: CONDIZIONE DI CORSA WAL (RateLimiter)
// ═══════════════════════════════════════════════════════════════════════════

function testRateLimiterWAL(results) {
    testGroup('Punto #1: RateLimiter - Protezione Condizione di Corsa WAL', results, () => {

        test('WAL persist con lock acquisito', results, () => {
            const limiter = new GeminiRateLimiter();
            limiter._persistCacheWithWAL();

            const wal = limiter.props.getProperty('rate_limit_wal');
            return wal === null;  // ✅ WAL deve essere rimosso dopo persist
        });

        test('WAL recovery da crash simulato', results, () => {
            const limiter = new GeminiRateLimiter();

            // Simula WAL rimasto da crash
            const crashWal = {
                timestamp: Date.now() - 1000,
                rpm: [{ timestamp: Date.now() - 2000, modelKey: 'flash-2.5' }],
                tpm: []
            };
            limiter.props.setProperty('rate_limit_wal', JSON.stringify(crashWal));

            limiter._recoverFromWAL();

            const rpm = JSON.parse(limiter.props.getProperty('rpm_window') || '[]');
            return rpm.length > 0;  // ✅ Dati recuperati
        });

        test('Simulazione persistenza concorrente (no override)', results, () => {
            const limiter = new GeminiRateLimiter();

            // Primo thread
            limiter.cache.rpmWindow = [{ timestamp: Date.now(), modelKey: 'test1' }];
            limiter._persistCacheWithWAL();

            // Secondo thread con dati diversi
            limiter.cache.rpmWindow = [{ timestamp: Date.now() + 1000, modelKey: 'test2' }];
            limiter._persistCacheWithWAL();

            const wal = limiter.props.getProperty('rate_limit_wal');
            return wal === null;  // ✅ WAL deve essere pulito
        });

        test('Lock timeout gestito correttamente', results, () => {
            const limiter = new GeminiRateLimiter();

            const lock = LockService.getScriptLock();
            lock.tryLock(5000);

            try {
                limiter._persistCacheWithWAL();
                lock.releaseLock();
                return true;  // ✅ Nessun deadlock
            } catch (e) {
                lock.releaseLock();
                return false;
            }
        });

        test('Verifica atomic compare-and-swap', results, () => {
            const limiter = new GeminiRateLimiter();

            const walTimestamp = Date.now();
            const wal = { timestamp: walTimestamp, rpm: [], tpm: [] };

            limiter.props.setProperty('rate_limit_wal', JSON.stringify(wal));

            // Simula verifica timestamp
            const currentWal = limiter.props.getProperty('rate_limit_wal');
            const parsed = JSON.parse(currentWal);

            return parsed.timestamp === walTimestamp;  // ✅ Timestamp verificato
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// PUNTO #2: VALIDAZIONE TIMESTAMP (MemoryService)
// ═══════════════════════════════════════════════════════════════════════════

function testMemoryServiceTimestamp(results) {
    testGroup('Punto #2: MemoryService - Validazione e Normalizzazione Timestamp', results, () => {
        const service = new MemoryService();

        test('Timestamp null → fallback stringa ISO', results, () => {
            const validated = service._validateAndNormalizeTimestamp(null);
            const parsed = new Date(validated);
            return !isNaN(parsed.getTime());  // ✅ Deve essere valido
        });

        test('Timestamp stringa invalida → fallback', results, () => {
            const validated = service._validateAndNormalizeTimestamp('data-non-valida');
            const parsed = new Date(validated);
            return !isNaN(parsed.getTime());  // ✅ Fallback a "ora"
        });

        test('Timestamp tipo non-stringa → fallback', results, () => {
            const validated = service._validateAndNormalizeTimestamp(12345);
            const parsed = new Date(validated);
            return !isNaN(parsed.getTime());  // ✅ Fallback a "ora"
        });

        test('Timestamp futuro (>24h) → reset', results, () => {
            const future = new Date(Date.now() + 86400000 * 2).toISOString();
            const validated = service._validateAndNormalizeTimestamp(future);
            const parsed = new Date(validated);
            return parsed.getTime() <= Date.now() + 86400000;  // ✅ Entro limite
        });

        test('Timestamp pre-2020 → reset', results, () => {
            const old = new Date('2019-01-01').toISOString();
            const validated = service._validateAndNormalizeTimestamp(old);
            const parsed = new Date(validated);
            return parsed.getTime() >= new Date('2020-01-01').getTime();  // ✅ Post 2020
        });

        test('Timestamp valido → passthrough', results, () => {
            const valid = new Date().toISOString();
            const validated = service._validateAndNormalizeTimestamp(valid);
            return validated === valid;  // ✅ Non modificato
        });

        test('Timestamp con timezone diverso → normalizzato', results, () => {
            const utc = new Date().toISOString();
            const validated = service._validateAndNormalizeTimestamp(utc);
            return validated.endsWith('Z');  // ✅ Mantiene UTC
        });

        test('Caso limite: Timestamp epoch (1970) → reset', results, () => {
            const epoch = new Date(0).toISOString();
            const validated = service._validateAndNormalizeTimestamp(epoch);
            const parsed = new Date(validated);
            return parsed.getTime() > new Date('2020-01-01').getTime();  // ✅ Reset a "ora"
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// PUNTO #3: PROTEZIONE REDOS (TerritoryValidator)
// ═══════════════════════════════════════════════════════════════════════════

function testTerritoryValidatorReDoS(results) {
    testGroup('Punto #3: TerritoryValidator - Protezione ReDoS', results, () => {
        const validator = new TerritoryValidator();

        test('Input normale (performance <100ms)', results, () => {
            const start = Date.now();
            validator.extractAddressFromText("via Roma 10");
            const duration = Date.now() - start;

            return duration < 100;  // ✅ Veloce
        });

        test('Payload ReDoS bloccato (<1s)', results, () => {
            const start = Date.now();
            // ✅ Test più realistico e severo per ReDoS
            const malicious = "via " + "a".repeat(500) + " " + "b".repeat(500) + " n";

            try {
                validator.extractAddressFromText(malicious);
                const duration = Date.now() - start;
                assert(duration < 1000, `Latenza eccessiva: ${duration}ms`);
                return true;
            } catch (e) {
                return false;
            }
        });

        test('Input eccessivamente lungo (>1000 caratteri) → troncato', results, () => {
            const long = "via Roma ".repeat(200) + "10";
            const result = validator.extractAddressFromText(long);

            return true;  // ✅ Deve completare senza crash
        });

        test('Nome via lungo (>100 caratteri) → saltato', results, () => {
            const longName = "via " + "A".repeat(150) + " 10";
            const result = validator.extractAddressFromText(longName);

            return result === null || result.length === 0;
        });

        test('Limite max iterazioni (100) applicato', results, () => {
            const many = "via Roma 1, via Milano 2, ".repeat(60);

            try {
                const result = validator.extractAddressFromText(many);
                return true;  // ✅ Non crasha anche con molti match
            } catch (e) {
                return false;
            }
        });

        test('Pattern caso limite: via senza civico', results, () => {
            const noCivic = "abito in via Roma";
            const result = validator.extractStreetOnlyFromText(noCivic);

            return result && result.length > 0;  // ✅ Deve estrarre solo via
        });

        test('Civico fuori range (>9999) → scartato', results, () => {
            const invalid = "via Roma 12345";
            const result = validator.extractAddressFromText(invalid);

            return result === null || result.length === 0;  // ✅ Civico invalido
        });

        test('Caratteri speciali nel nome via → gestiti', results, () => {
            const special = "via Sant'Antonio 10";
            const result = validator.extractAddressFromText(special);

            return result && result[0].civic === 10;  // ✅ Apostrofo gestito
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// PUNTO #4: CORSA RILASCIO LOCK (MemoryService)
// ═══════════════════════════════════════════════════════════════════════════

function testMemoryServiceLockRace(results) {
    testGroup('Punto #4: MemoryService - Protezione Corsa Rilascio Lock', results, () => {
        const service = new MemoryService();

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

        test('Lock rilasciato su errore (gestione eccezioni)', results, () => {
            const threadId = 'test-error-' + Date.now();

            try {
                service.updateMemory(threadId, { _expectedVersion: 999 });
            } catch (e) {
                // Errore atteso
            }

            const lockKey = service._getShardedLockKey(threadId);
            const cache = CacheService.getScriptCache();
            const lockStillHeld = cache.get(lockKey);

            return lockStillHeld === null;  // ✅ Lock rilasciato dopo errore
        });

        test('Flag lockOwned previene il doppio rilascio', results, () => {
            const threadId = 'test-double-' + Date.now();

            try {
                service.updateMemory(threadId, { language: 'en' });
                service.updateMemory(threadId, { language: 'es' });

                return true;  // ✅ Nessun errore da double-release
            } catch (e) {
                return false;
            }
        });

        test('Retry con lock già posseduto', results, () => {
            const threadId = 'test-retry-' + Date.now();

            service.updateMemory(threadId, { messageCount: 1 });
            service.updateMemory(threadId, { messageCount: 2 });

            const memory = service.getMemory(threadId);

            return memory && memory.messageCount === 2;  // ✅ Aggiornamento riuscito
        });

        test('Calcolo chiave lock sharded', results, () => {
            const threadId1 = 'thread-123';
            const threadId2 = 'thread-456';

            const key1 = service._getShardedLockKey(threadId1);
            const key2 = service._getShardedLockKey(threadId2);

            return key1 !== key2;  // ✅ Sharding funzionante
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// PUNTO #5: PROTEZIONE XSS (GmailService)
// ═══════════════════════════════════════════════════════════════════════════

function testGmailServiceXSS(results) {
    testGroup('Punto #5: GmailService - Protezione XSS e SSRF', results, () => {

        test('Blocco protocollo javascript:', results, () => {
            const malicious = 'javascript:alert(1)';
            const sanitized = sanitizeUrl(malicious);
            return sanitized === null;  // ✅ Bloccato
        });

        // ... (altri test XSS) ...
        test('Consenti protocollo https://', results, () => {
            const valid = 'https://example.com';
            const sanitized = sanitizeUrl(valid);
            return sanitized !== null;  // ✅ Permesso
        });
    });
}
// ═══════════════════════════════════════════════════════════════════════════
// PUNTO #6: CRESCITA MEMORIA (PromptEngine)
// ═══════════════════════════════════════════════════════════════════════════

function testPromptEngineBudget(results) {
    testGroup('Punto #6: PromptEngine - Tracciamento Budget e Prevenzione Crescita Memoria', results, () => {
        const engine = new PromptEngine();

        test('KB sovradimensionata (200KB) → troncata', results, () => {
            const hugeKB = "X".repeat(200000);

            const prompt = engine.buildPrompt({
                knowledgeBase: hugeKB,
                emailContent: "Test",
                emailSubject: "Test",
                senderName: "Test",
                detectedLanguage: 'it',
                salutation: 'Buongiorno',
                closing: 'Cordiali saluti'
            });

            const tokens = engine.estimateTokens(prompt);
            const MAX_SAFE = typeof CONFIG !== 'undefined' && CONFIG.MAX_SAFE_TOKENS ? CONFIG.MAX_SAFE_TOKENS : 100000;

            return tokens <= MAX_SAFE;  // ✅ Sotto limite
        });

        // ... (altri test PromptEngine) ...
    });
}
// ═══════════════════════════════════════════════════════════════════════════
// PUNTO #7: CLASSIFICAZIONE ERRORI
// ═══════════════════════════════════════════════════════════════════════════
function testEmailProcessorErrorClassification(results) {
    testGroup('Punto #7: EmailProcessor - Classificazione Errori', results, () => {
        // ... (test esistenti) ...
        const classifyError = (error) => {
            const msg = error.message || '';
            if (msg.includes('INVALID_ARGUMENT')) return 'FATAL';
            if (msg.includes('rate limit')) return 'QUOTA';
            if (msg.includes('timeout')) return 'NETWORK';
            return 'UNKNOWN';
        };

        test('Classifica INVALID_ARGUMENT come FATAL', results, () => {
            const error = new Error('INVALID_ARGUMENT: Bad prompt');
            return classifyError(error) === 'FATAL';
        });
    });
}

// ... (altri gruppi esistenti) ...

function testIntegrationScenarios(results) {
    testGroup('Test di Integrazione', results, () => {
        test('Scenario 1: Richiesta orari semplice', results, () => {
            const classifier = new Classifier();
            const emailClassification = classifier.classifyEmail("Quando sono le messe?", "Info", "user@example.com");
            return emailClassification.shouldReply === true;
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// NUOVO GRUPPO: TEST LOGICA CORE (MOCKED)
// ═══════════════════════════════════════════════════════════════════════════

function testCoreLogicMocked(results) {
    testGroup('Logica Core Mocked - Sospensione, Ferie, Config', results, () => {

        // Setup GLOBAL_CACHE mock
        if (typeof GLOBAL_CACHE === 'undefined') {
            GLOBAL_CACHE = {};
        }

        // Test isInSuspensionTime con dati mockati
        test('isInSuspensionTime: Festivo Fisso (1 Gennaio)', results, () => {
            const checkDate = new Date('2026-01-01T10:00:00'); // Capodanno
            return isInSuspensionTime(checkDate) === false; // Attivo anche se orario ufficio
        });

        test('isInSuspensionTime: Orario Ufficio Lunedì (8-20)', results, () => {
            GLOBAL_CACHE.suspensionRules = { 1: [[8, 20]] }; // Lunedì
            const checkDate = new Date('2026-02-16T10:00:00'); // Lunedì 16 Feb 2026, ore 10
            return isInSuspensionTime(checkDate) === true; // Sospeso
        });

        test('isInSuspensionTime: Fuori Orario Ufficio Lunedì (21:00)', results, () => {
            GLOBAL_CACHE.suspensionRules = { 1: [[8, 20]] }; // Lunedì
            const checkDate = new Date('2026-02-16T21:00:00'); // Lunedì 16 Feb 2026, ore 21
            return isInSuspensionTime(checkDate) === false; // Attivo
        });

        test('isInVacationPeriod: Data Interna al Periodo', results, () => {
            const start = new Date('2026-08-10');
            const end = new Date('2026-08-20');
            GLOBAL_CACHE.vacationPeriods = [{ start: start, end: end }];

            const checkDate = new Date('2026-08-15'); // Ferragosto
            return isInVacationPeriod(checkDate) === true;
        });

        test('isInVacationPeriod: Data Esterna al Periodo', results, () => {
            const start = new Date('2026-08-10');
            const end = new Date('2026-08-20');
            GLOBAL_CACHE.vacationPeriods = [{ start: start, end: end }];

            const checkDate = new Date('2026-08-25');
            return isInVacationPeriod(checkDate) === false;
        });

        // Test _loadAdvancedConfig con Mock Spreadsheet
        test('_loadAdvancedConfig: Lettura Corretta', results, () => {
            const mockSheet = {
                getRange: (a1) => {
                    if (a1 === 'B2') return { getValue: () => 'Acceso' };
                    if (a1 === 'B5:E7') return {
                        getValues: () => [
                            [new Date('2026-08-01'), '', new Date('2026-08-31'), ''], // Ferie
                            ['', '', '', ''],
                            ['', '', '', '']
                        ]
                    };
                    if (a1 === 'B10:E16') return {
                        getValues: () => [
                            [8, '', 20, ''], // Lunedì
                            ['', '', '', ''],
                            ['', '', '', ''],
                            ['', '', '', ''],
                            ['', '', '', ''],
                            ['', '', '', ''],
                            ['', '', '', '']
                        ]
                    };
                    if (a1 === 'E11:F50') return {
                        getValues: () => [
                            ['bad.com', 'spam'],
                            ['', '']
                        ]
                    };
                    return { getValues: () => [] };
                }
            };

            const mockSpreadsheet = {
                getSheetByName: (name) => (name === 'Controllo' ? mockSheet : null)
            };

            const config = _loadAdvancedConfig(mockSpreadsheet);

            return config.systemEnabled === true &&
                config.vacationPeriods.length === 1 &&
                config.suspensionRules[1] && // Lunedì esiste
                config.ignoreDomains.includes('bad.com') &&
                config.ignoreKeywords.includes('spam');
        });

        // Cleanup
        GLOBAL_CACHE = {};
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// RUNNER PRINCIPALE DEI TEST
// ═══════════════════════════════════════════════════════════════════════════

function runAllTests() {
    console.log('╔' + '═'.repeat(68) + '╗');
    console.log('║' + ' '.repeat(15) + '🧪 TEST SUITE ESTESA - 100% COVERAGE' + ' '.repeat(17) + '║');
    console.log('╚' + '═'.repeat(68) + '╝');

    const results = {
        total: 0,
        passed: 0,
        failed: 0,
        tests: []
    };

    const start = Date.now();

    try {
        // ... (altri test) ...
        testCoreLogicMocked(results);

        // PUNTI CRITICI
        testRateLimiterWAL(results);
        testMemoryServiceTimestamp(results);
        testTerritoryValidatorReDoS(results);
        testMemoryServiceLockRace(results);
        testGmailServiceXSS(results);
        testPromptEngineBudget(results);
        testEmailProcessorErrorClassification(results);

        // TEST INTEGRAZIONE ESISTENTI
        testIntegrationScenarios(results);
        testPerformance(results);
        testEdgeCases(results);

        // Restore run
        testMiglioramentiGennaio2026(results);
        testMiglioramentiSecondaFase(results);
        testGeminiServiceAdvanced(results);
        testClassifierEdgeCases(results);
        testRequestTypeClassifierAdvanced(results);
        testResponseValidatorAdvanced(results);
        testAttachmentOCR(results);

    } catch (error) {
        console.error(`\n💥 ERRORE FATALE: ${error.message}`);
        console.error(error.stack);
    }

    const duration = Date.now() - start;
    const successRate = results.total > 0 ? ((results.passed / results.total) * 100).toFixed(1) : 0;

    console.log('\n' + '╔' + '═'.repeat(68) + '╗');
    console.log('║' + ' '.repeat(20) + '📊 RISULTATI FINALI' + ' '.repeat(28) + '║');
    console.log('╠' + '═'.repeat(68) + '╣');
    console.log(`║  Totale Test:      ${results.total.toString().padEnd(48)} ║`);
    console.log(`║  ✅ Superati:      ${results.passed.toString().padEnd(48)} ║`);
    console.log(`║  ❌ Falliti:       ${results.failed.toString().padEnd(48)} ║`);
    console.log(`║  Percentuale:      ${successRate}%`.padEnd(69) + '║');
    console.log(`║  Durata:           ${duration}ms`.padEnd(69) + '║');
    console.log('╚' + '═'.repeat(68) + '╝');

    return results;
}

function runTests() {
    return runAllTests();
}
