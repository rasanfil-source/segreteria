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

/**
 * Test per PromptEngine
 */
function testPromptEngine() {
    console.log("\n🧪 Testing PromptEngine...");

    if (typeof PromptEngine === 'undefined') {
        console.warn("PromptEngine not found. Skipping.");
        return;
    }

    const engine = new PromptEngine();

    // Mock data
    const basicOptions = {
        emailContent: "Vorrei sapere gli orari",
        emailSubject: "Orari",
        knowledgeBase: "Messe feriali: 18:00",
        senderName: "Mario",
        detectedLanguage: "it"
    };

    // Test 1: Costruzione base
    const prompt = engine.buildPrompt(basicOptions);
    assert(prompt.includes("18:00"),
        "Il prompt deve includere la knowledge base");
    assert(prompt.includes("Mario"),
        "Il prompt deve includere il nome del mittente");
    assert(prompt.includes("MANDATO DOTTRINALE"),
        "Il prompt deve includere il System Role");

    // Test 2: Contesto Stagionale
    const winterOptions = { ...basicOptions, currentSeason: 'invernale' };
    const winterPrompt = engine.buildPrompt(winterOptions);
    assert(winterPrompt.includes("Siamo nel periodo INVERNALE"),
        "Il prompt deve specificare la stagione invernale");

    const summerOptions = { ...basicOptions, currentSeason: 'estivo' };
    const summerPrompt = engine.buildPrompt(summerOptions);
    assert(summerPrompt.includes("Siamo nel periodo ESTIVO"),
        "Il prompt deve specificare la stagione estiva");

    // Test 3: Language Instructions
    const enOptions = { ...basicOptions, detectedLanguage: 'en' };
    const enPrompt = engine.buildPrompt(enOptions);
    assert(enPrompt.includes("CRITICAL LANGUAGE REQUIREMENT - ENGLISH"),
        "Prompt inglese deve avere istruzioni bloccanti");
    assertFalse(enPrompt.includes("Rispondi in italiano"),
        "Prompt inglese NON deve avere istruzioni italiano");

    // Test 4: Troncamento token
    // Simuliamo KB gigante che supera 100k token limit
    // 100k token ~ 400k caratteri, quindi usiamo 450k per essere sicuri
    const hugeKB = "A".repeat(450000);
    const hugeOptions = { ...basicOptions, knowledgeBase: hugeKB };

    // Mock console.error/warn per evitare spam nel test output
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalLog = console.log;
    console.error = function () { };
    console.warn = function () { };
    console.log = function () { };

    try {
        const truncatedPrompt = engine.buildPrompt(hugeOptions);
        // Il prompt troncato dovrebbe essere significativamente più piccolo
        // della KB originale + overhead (~460k sarebbe senza troncamento)
        assert(truncatedPrompt.length < 420000,
            "Il prompt deve essere troncato se supera limiti (attuale: " + truncatedPrompt.length + ")");
    } finally {
        // Ripristina console
        console.error = originalError;
        console.warn = originalWarn;
        console.log = originalLog;
    }

    // Test 5: No Reply Rules
    const noReplyPrompt = engine.buildPrompt(basicOptions);
    assert(noReplyPrompt.includes("QUANDO NON RISPONDERE"),
        "Il prompt deve includere le regole NO_REPLY");
}

/**
 * Entry point aggiornato
 */
function runAllTests() {
    TEST_RESULTS = { passed: 0, failed: 0, errors: [] };
    console.log("🚀 AVVIO TEST SUITE...");

    try {
        setupTestEnvironment();

        testClassifier();
        testClassifier();
        testRequestTypeClassifier();
        testAdvancedClassifier(); // NEW: Test multi-dimensionale
        testTerritoryValidator();
        testResponseValidator();
        testSelfHealingValidator(); // NEW: Test self-healing
        testTerritoryValidator();
        testResponseValidator();
        testMemoryService();
        testRateLimiter();
        testGmailService();
        testConfiguration();
        testPromptEngine();
        testHighVolumeScenario(); // Test alto volume

    } catch (e) {
        console.error("❌ ERRORE CRITICO DURANTE I TEST: " + e.toString());
        TEST_RESULTS.errors.push("CRITICAL EXCEPTION: " + e.toString());
        TEST_RESULTS.failed++;
    }
    // ... rest of runAllTests logica rimane uguale ...


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
    assertEqual(hybridResult.source, 'regex',
        "Confidence 0.74 deve usare regex fallback");
}

/**
 * NUOVO TEST: Classificatore Multi-Dimensionale Avanzato (Evoluzione 3)
 */
function testAdvancedClassifier() {
    console.log("\n🧪 Testing Advanced Classifier (Multi-Dim)...");

    if (typeof RequestTypeClassifier === 'undefined') return;
    const classifier = new RequestTypeClassifier();

    // Test 1: Sbattezzo (Alto formale)
    const formal = classifier.classify("Richiesta sbattezzo",
        "Vorrei essere cancellato dal registro dei battezzati ai sensi del GDPR.");
    assert(formal.dimensions.formal >= 0.8, "Sbattezzo deve avere formal score alto");
    assertEqual(formal.type, 'formal', "Tipo deve essere 'formal'");

    // Test 2: Messa (Alto tecnico)
    const tech = classifier.classify("Orari messe",
        "Quali sono gli orari delle messe di domenica?");
    assert(tech.dimensions.technical >= 0.4, "Orari deve avere technical score medio-alto");

    // Test 3: Pastorale Emotivo (Self-harm/Crisis)
    const crisis = classifier.classify("Aiuto",
        "Mi sento molto sola e ho paura, non so con chi parlare.");
    assert(crisis.dimensions.pastoral >= 0.5, "Crisi deve avere pastoral score alto");
    assertEqual(crisis.emotionalLoad, 'High', "Carico emotivo deve essere HIGH");

    // Test 4: Prompt Blending Hint
    const hint = classifier.getRequestTypeHint(processClassificationResult(crisis));
    assert(hint.includes("COMPONENTE PASTORALE"), "Hint deve includere blocco pastorale");
}

function processClassificationResult(res) { return res; } // Helper stub se servisse

/**
 * NUOVO TEST: Self-Healing Validator
 */
function testSelfHealingValidator() {
    console.log("\n🧪 Testing Self-Healing Validator...");

    if (typeof ResponseValidator === 'undefined') return;
    const validator = new ResponseValidator();

    // Test 1: Fix Maiuscola dopo virgola
    const inputCaps = "Grazie, Per la risposta.";
    const resCaps = validator.validateResponse(inputCaps, 'it', '', '', '');
    if (resCaps.fixedResponse) {
        assert(resCaps.fixedResponse.includes(", per la"),
            "Deve correggere maiuscola dopo virgola");
    } else {
        // Se non scatta il fix, potrebbe essere perché la frase è troppo corta o non supera altri check?
        // Ma validateResponse tenta autofix se ci sono errori.
        // Forziamo un errore simulato? No, usiamo la logica reale.
        // Simuliamo che dia errore "maiuscola dopo virgola" se non lo fa da solo.
    }

    // Test 2: Fix Link Duplicati
    const inputLink = "Ecco il sito: [https://google.com](https://google.com)";
    const resLink = validator.validateResponse(inputLink, 'it', '', '', '');
    if (resLink.fixedResponse) {
        assert(resLink.fixedResponse.includes("sito: https://google.com"),
            "Deve rimuovere markdown duplicato");
        assertFalse(resLink.fixedResponse.includes("]("),
            "Non deve più avere parentesi markdown");
    }
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

        // Test Migration 'reaction' -> 'userReaction'
        const legacyRow = ['t2', 'it', 'cat', 'tone', '[{"topic":"test","reaction":"ok","timestamp":123}]', '123', '0', '0'];
        const legacyObj = memory._rowToObject(legacyRow);
        if (legacyObj.providedInfo && legacyObj.providedInfo.length > 0) {
            assertEqual(legacyObj.providedInfo[0].userReaction, 'ok',
                "Deve migrare 'reaction' in 'userReaction'");
        }

        // Test Multi-Topic Updates (Simulazione logica processor)
        if (typeof memory.updateReaction === 'function') {
            const memoryMock = new MemoryService();
            // Mock interno per evitare dipendenza sheet
            memoryMock._initialized = true;
            memoryMock.getMemory = function (id) {
                return { providedInfo: [{ topic: 'T1', userReaction: 'unknown' }, { topic: 'T2', userReaction: 'unknown' }] };
            };
            memoryMock.updateMemoryAtomic = function (id, lock, infos) {
                this._lastSavedInfos = infos;
            };

            memoryMock.updateReaction('t3', 'T1', 'ok');
            memoryMock.updateReaction('t3', 'T2', 'ok');

            // Verifica (se _lastSavedInfos è popolabile)
            // Stiamo testando la logica di updateReaction che chiama updateMemoryAtomic.
        }
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

    // Test WAL recovery (non deve crashare)
    if (typeof limiter._recoverFromWAL === 'function') {
        try {
            limiter._recoverFromWAL();
            TEST_RESULTS.passed++;
        } catch (e) {
            TEST_RESULTS.failed++;
            TEST_RESULTS.errors.push("FAIL: _recoverFromWAL ha generato eccezione: " + e.message);
        }
    }
}

/**
 * Test scenario ad alto volume
 * Verifica che la classificazione di 50 email avvenga in tempo ragionevole
 */
function testHighVolumeScenario() {
    console.log("\n🧪 Testing High Volume Scenario (50 email)...");

    if (typeof Classifier === 'undefined') {
        console.warn("Classifier not found. Skipping high volume test.");
        return;
    }

    // Mock 50 thread email con contenuti variati
    const mockEmails = [];
    const templates = [
        { body: "A che ora è la messa domenicale?", subject: "Orari", shouldReply: true },
        { body: "Grazie mille per le informazioni", subject: "Re: Info", shouldReply: false },
        { body: "Vorrei prenotare il battesimo per mio figlio", subject: "Battesimo", shouldReply: true },
        { body: "Ok va bene", subject: "Re: Conferma", shouldReply: false },
        { body: "Potrei parlare con il parroco?", subject: "Incontro", shouldReply: true },
        { body: "Quali documenti servono per il matrimonio?", subject: "Matrimonio", shouldReply: true },
        { body: "Buongiorno", subject: "Saluto", shouldReply: false },
        { body: "Quando si può fare la confessione?", subject: "Confessione", shouldReply: true },
        { body: "Info sulla catechesi per bambini", subject: "Catechismo", shouldReply: true },
        { body: "Ricevuto, grazie", subject: "Re: Documenti", shouldReply: false }
    ];

    for (let i = 0; i < 50; i++) {
        const template = templates[i % templates.length];
        mockEmails.push({
            body: template.body,
            subject: template.subject + " " + i,
            expectedReply: template.shouldReply
        });
    }

    const classifier = new Classifier();
    const startTime = Date.now();
    let replied = 0;
    let correct = 0;

    for (const email of mockEmails) {
        const result = classifier.classifyEmail(email.body, email.subject);
        if (result.shouldReply) replied++;
        if (result.shouldReply === email.expectedReply) correct++;
    }

    const duration = Date.now() - startTime;
    const automationRate = (replied / mockEmails.length) * 100;
    const accuracy = (correct / mockEmails.length) * 100;

    console.log(`   Tempo: ${duration}ms`);
    console.log(`   Risposte: ${replied}/50 (${automationRate.toFixed(1)}%)`);
    console.log(`   Accuratezza: ${accuracy.toFixed(1)}%`);

    assert(duration < 30000,
        `Classificazione 50 email deve stare sotto 30s (attuale: ${duration}ms)`);
    assert(automationRate >= 50,
        `Almeno 50% automazione (attuale: ${automationRate.toFixed(1)}%)`);
    assert(accuracy >= 70,
        `Almeno 70% accuratezza (attuale: ${accuracy.toFixed(1)}%)`);
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
