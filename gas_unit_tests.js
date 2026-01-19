/**
 * UnitTests.gs - Suite di test unitari
 * 
 * Eseguire la funzione `runAllTests()` per avviare la suite.
 * Verifica la logica core di tutti i componenti del sistema.
 */

var TEST_RESULTS = {
    passed: 0,
    failed: 0,
    errors: []
};

/**
 * Entry point per l'esecuzione di tutti i test
 */
function runAllTests() {
    TEST_RESULTS = { passed: 0, failed: 0, errors: [] };
    console.log("🚀 AVVIO TEST SUITE...");

    try {
        setupTestEnvironment();

        testClassifier();
        testRequestTypeClassifier();
        testTerritoryValidator();
        testResponseValidator();
        testMemoryService();
        testRateLimiter();
        testGmailService();
        testConfiguration();

    } catch (e) {
        console.error("❌ ERRORE CRITICO DURANTE I TEST: " + e.toString());
        TEST_RESULTS.errors.push("CRITICAL EXCEPTION: " + e.toString());
        TEST_RESULTS.failed++;
    }

    console.log("\n📊 RIEPILOGO TEST:");
    console.log("✅ Passed: " + TEST_RESULTS.passed);
    console.log("❌ Failed: " + TEST_RESULTS.failed);

    if (TEST_RESULTS.failed > 0 || TEST_RESULTS.errors.length > 0) {
        console.error("❌ TEST FALLITI. Dettagli Errori:");
        TEST_RESULTS.errors.forEach(function (err) {
            console.error("- " + err);
        });
    } else {
        console.log("🎉 TUTTI I TEST PASSATI CON SUCCESSO!");
    }

    return TEST_RESULTS;
}

/**
 * Preparazione ambiente di test
 */
function setupTestEnvironment() {
    if (typeof CONFIG === 'undefined') {
        console.warn("⚠️ CONFIG non definito. Uso mock per i test.");
        CONFIG = {
            VALIDATION_STRICT_MODE: true,
            VALIDATION_MIN_SCORE: 0.6,
            CACHE_LOCK_TTL: 30,
            CACHE_RACE_SLEEP_MS: 50,
            GMAIL_LABEL_CACHE_TTL: 3600000,
            MAX_HISTORY_MESSAGES: 10
        };
    }

    if (typeof GLOBAL_CACHE === 'undefined') {
        GLOBAL_CACHE = {
            replacements: {},
            knowledgeBase: ''
        };
    }
}

// ==========================================
// ASSERTION HELPERS
// ==========================================

function assert(condition, message) {
    if (condition) {
        TEST_RESULTS.passed++;
    } else {
        TEST_RESULTS.failed++;
        TEST_RESULTS.errors.push("FAIL: " + message);
        console.error("❌ FAIL: " + message);
    }
}

function assertEqual(actual, expected, message) {
    assert(actual === expected, message + " (Atteso: " + expected + ", Ottenuto: " + actual + ")");
}

function assertTrue(actual, message) {
    assertEqual(actual, true, message);
}

function assertFalse(actual, message) {
    assertEqual(actual, false, message);
}

// ==========================================
// TEST MODULES
// ==========================================

/**
 * Test per Classifier
 */
function testClassifier() {
    console.log("\n🧪 Testing Classifier...");

    if (typeof Classifier === 'undefined') {
        TEST_RESULTS.errors.push("Classifier class not found!");
        TEST_RESULTS.failed++;
        return;
    }

    const classifier = new Classifier();

    // Test riconoscimento acknowledgment semplice
    assertFalse(classifier.classifyEmail("Grazie mille", "Re: Info").shouldReply,
        "Grazie mille non dovrebbe richiedere risposta");
    assertFalse(classifier.classifyEmail("Ok va bene", "Re: Info").shouldReply,
        "Ok va bene non dovrebbe richiedere risposta");

    // Test saluto solo
    assertFalse(classifier.classifyEmail("Buongiorno don", "Buongiorno don").shouldReply,
        "Saluto solo non dovrebbe richiedere risposta");

    // Test domande reali
    assertTrue(classifier.classifyEmail("A che ora è la messa?", "Orari").shouldReply,
        "Domanda sulle messe DEVE richiedere risposta");

    // Test contenuto misto
    assertTrue(classifier.classifyEmail("Grazie, ma volevo chiedere anche quando scade l'iscrizione.", "Re: Iscrizione").shouldReply,
        "Contenuto misto con domanda DEVE richiedere risposta");

    // Test body vuoto con subject valido
    const emptyBody = classifier.classifyEmail("Re: Orari messe", "", true);
    assertEqual(emptyBody.reason, 'empty_body_generic_subject',
        "Body vuoto con subject valido deve essere processato");
}

/**
 * Test per RequestTypeClassifier
 */
function testRequestTypeClassifier() {
    console.log("\n🧪 Testing RequestTypeClassifier...");

    if (typeof RequestTypeClassifier === 'undefined') {
        console.warn("RequestTypeClassifier not found. Skipping.");
        return;
    }

    const classifier = new RequestTypeClassifier();

    // Test richiesta tecnica
    const techResult = classifier.classify("Certificato di battesimo",
        "Vorrei richiedere il certificato di battesimo per mio figlio.");
    assert(techResult.technicalScore > techResult.pastoralScore,
        "Richiesta certificato deve essere TECNICA");

    // Test richiesta pastorale
    const pastResult = classifier.classify("Problema personale",
        "Mi sento molto solo in questo periodo e avrei bisogno di parlare con qualcuno.");
    assert(pastResult.pastoralScore > pastResult.technicalScore,
        "Richiesta emotiva deve essere PASTORALE");
    assertTrue(pastResult.needsDiscernment,
        "Richiesta pastorale deve avere flag needsDiscernment");

    // Test richiesta dottrinale
    const docResult = classifier.classify("Dubbio di fede",
        "Perché la Chiesa dice che la domenica bisogna andare a messa?");
    assert(docResult.doctrineScore > 0,
        "Domanda dottrinale deve avere doctrineScore > 0");

    // Test soglia confidence per approccio ibrido
    const lowConfHint = { category: 'PASTORAL', confidence: 0.74 };
    const hybridResult = classifier.classify("Subj", "Body", lowConfHint);
    assertEqual(hybridResult.source, 'regex',
        "Confidence 0.74 deve usare regex fallback");
}

/**
 * Test per TerritoryValidator
 */
function testTerritoryValidator() {
    console.log("\n🧪 Testing TerritoryValidator...");

    if (typeof TerritoryValidator === 'undefined') {
        console.warn("TerritoryValidator not found. Skipping.");
        return;
    }

    const validator = new TerritoryValidator();

    // Test estrazione indirizzo
    const addresses = validator.extractAddressFromText("Abito in Via Roma 10, posso iscrivermi?");
    assert(addresses !== null && addresses.length > 0,
        "Deve estrarre Via Roma 10");
    if (addresses && addresses.length > 0) {
        assertEqual(addresses[0].civic, 10,
            "Numero civico deve essere 10");
    }

    // Test indirizzo non esistente
    const invalidAddr = validator.verifyAddress("Via Di Prova Inesistente", 999);
    assertFalse(invalidAddr.inParish,
        "Indirizzo inesistente deve restituire false");

    // Test protezione ReDoS
    const start = new Date().getTime();
    const longString = "Abito in via " + "a ".repeat(50) + " 10";
    validator.extractAddressFromText(longString);
    const elapsed = new Date().getTime() - start;
    assert(elapsed < 500,
        "Regex non deve bloccarsi su input lunghi (tempo: " + elapsed + "ms)");
}

/**
 * Test per ResponseValidator
 */
function testResponseValidator() {
    console.log("\n🧪 Testing ResponseValidator...");

    if (typeof ResponseValidator === 'undefined') {
        console.warn("ResponseValidator not found. Skipping.");
        return;
    }

    const validator = new ResponseValidator();
    const mockKB = "Orari messe: 10:00, 18:00. Email: info@parrocchia.it. Tel: 0612345678";

    // Test risposta troppo corta
    const shortRes = validator.validateResponse("Ciao.", "it", mockKB, "body", "subject");
    assertFalse(shortRes.isValid,
        "Risposta troppo corta deve essere invalida");

    // Test allucinazione email
    const fakeEmailRes = validator.validateResponse(
        "Scrivi a prova@emailfinta.com per info.", "it", mockKB, "body", "subject");
    assertFalse(fakeEmailRes.isValid,
        "Risposta con email sconosciuta deve essere invalida");

    // Test allucinazione telefono
    const fakePhoneRes = validator.validateResponse(
        "Chiama il 333 12345678.", "it", mockKB, "body", "subject");
    assertFalse(fakePhoneRes.isValid,
        "Risposta con telefono sconosciuto deve essere invalida");

    // Test filename non deve essere trattato come orario
    const resFilename = validator.validateResponse(
        "Per maggiori dettagli vedi il file page.19.html allegato.",
        "it", mockKB, "body", "subject");
    assertTrue(resFilename.isValid,
        "Filename page.19.html non deve causare errore allucinazione orario");
}

/**
 * Test per MemoryService
 */
function testMemoryService() {
    console.log("\n🧪 Testing MemoryService...");

    if (typeof MemoryService === 'undefined') {
        console.warn("MemoryService not found. Skipping.");
        return;
    }

    // Test validazione timestamp invalido
    const memory = new MemoryService();
    if (typeof memory._rowToObject === 'function') {
        const invalidRow = ['t1', 'it', 'cat', 'tone', '[]', 'INVALID_DATE', '0', '0'];
        const obj = memory._rowToObject(invalidRow);
        assertEqual(obj.lastUpdated, null,
            "Timestamp invalido deve essere convertito in null");
    }
}

/**
 * Test per GeminiRateLimiter
 */
function testRateLimiter() {
    console.log("\n🧪 Testing GeminiRateLimiter...");

    if (typeof GeminiRateLimiter === 'undefined') {
        console.warn("GeminiRateLimiter not found. Skipping.");
        return;
    }

    const limiter = new GeminiRateLimiter();

    // Test formato data Pacific
    if (typeof limiter._getPacificDate === 'function') {
        const pacificDate = limiter._getPacificDate();
        assert(typeof pacificDate === 'string' && pacificDate.match(/^\d{4}-\d{2}-\d{2}$/),
            "_getPacificDate deve restituire formato YYYY-MM-DD");
    }
}

/**
 * Test per GmailService
 */
function testGmailService() {
    console.log("\n🧪 Testing GmailService...");

    if (typeof GmailService === 'undefined') {
        console.warn("GmailService not found. Skipping.");
        return;
    }

    const service = new GmailService();

    // Test sanitizzazione header injection
    if (typeof service._sanitizeHeaders === 'function') {
        const attack1 = "To: victim@example.com\nSubject: Spam";
        const clean1 = service._sanitizeHeaders(attack1);
        assert(clean1.startsWith("[To]:"),
            "Regex deve catturare 'To:' a inizio stringa");

        const attack2 = "Hello\nBcc: spy@example.com";
        const clean2 = service._sanitizeHeaders(attack2);
        assert(clean2.includes("\n[Bcc]:"),
            "Regex deve catturare 'Bcc:' dopo newline");

        const legit = "This is a Topic: about something";
        const clean3 = service._sanitizeHeaders(legit);
        assertEqual(legit, clean3,
            "Regex NON deve sanitizzare testo legittimo");
    }

    // Test markdown XSS
    if (typeof markdownToHtml === 'function') {
        const maliciousMd = "[Click me](javascript:alert(1))";
        const html = markdownToHtml(maliciousMd);
        assertFalse(html.includes('href="javascript:alert(1)"'),
            "Markdown XSS deve essere sanitizzato");

        // Test SSRF
        const internalLink = "[Link](http://192.168.1.1/admin)";
        const htmlInternal = markdownToHtml(internalLink);
        assertFalse(htmlInternal.includes('<a href'),
            "Link IP interno deve essere rimosso");

        const localhostLink = "[Link](http://localhost:3000)";
        const htmlLocal = markdownToHtml(localhostLink);
        assertFalse(htmlLocal.includes('<a href'),
            "Link localhost deve essere rimosso");
    }
}

/**
 * Test per configurazione
 */
function testConfiguration() {
    console.log("\n🧪 Testing Configuration...");

    if (typeof CONFIG === 'undefined') {
        TEST_RESULTS.failed++;
        TEST_RESULTS.errors.push("FAIL: CONFIG object mancante");
        return;
    }

    // Verifica parametri cache
    assertEqual(CONFIG.CACHE_LOCK_TTL, 30,
        "CACHE_LOCK_TTL deve essere 30 secondi");
    assertEqual(CONFIG.CACHE_RACE_SLEEP_MS, 50,
        "CACHE_RACE_SLEEP_MS deve essere 50ms");
    assertEqual(CONFIG.GMAIL_LABEL_CACHE_TTL, 3600000,
        "GMAIL_LABEL_CACHE_TTL deve essere 3600000ms (1h)");
    assertEqual(CONFIG.MAX_HISTORY_MESSAGES, 10,
        "MAX_HISTORY_MESSAGES deve essere 10");

    // Verifica modelli Gemini
    if (CONFIG.GEMINI_MODELS) {
        const flashRef = CONFIG.GEMINI_MODELS['flash-2.5'];
        if (flashRef) {
            assert(flashRef.rpd >= 250,
                "RPD flash-2.5 deve essere almeno 250 (attuale: " + flashRef.rpd + ")");
        }
    }

    // Test cache lock funzionamento
    const cache = CacheService.getScriptCache();
    const testKey = 'unit_test_lock_check';

    cache.put(testKey, 'LOCKED', 10);
    if (cache.get(testKey) === 'LOCKED') {
        cache.remove(testKey);
        assert(!cache.get(testKey),
            "Cache remove deve funzionare");
    } else {
        TEST_RESULTS.failed++;
        TEST_RESULTS.errors.push("FAIL: Cache put fallito");
    }

    // Test double-check locking
    const myLockVal = "TEST_" + new Date().getTime();
    cache.put(testKey, myLockVal, 10);
    Utilities.sleep(50);
    assert(cache.get(testKey) === myLockVal,
        "Double check locking deve funzionare");
    cache.remove(testKey);
}
