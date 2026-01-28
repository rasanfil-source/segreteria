/**
 * gas_unit_tests.js - Test suite completa per il sistema
 * 
 * Copre:
 * 1. TerritoryValidator (inclusi range 'tutti' e 'Infinity')
 * 2. GmailService (sanificazione header, punteggiatura)
 * 3. ResponseValidator (perfezionamento multilingua, allucinazioni)
 */

// Semplice funzione assert
const assert = (condition, message) => {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        // Non lanciamo eccezione per permettere agli altri test di girare
        // throw new Error(message); 
    } else {
        console.log(`✅ PASS: ${message}`);
    }
};

/**
 * TEST SUITE: Verifica Lock Annidati (ScriptLock Re-entrancy)
 * Scopo: Verificare se acquisire due lock consecutivi nello stesso thread causa deadlock.
 * Se GAS ScriptLock è re-entrant per stesso thread, deve passare.
 */
function testNestedLockSuite() {
    console.log("\n🧪 [[[ TEST SUITE: System Locks ]]]");
    const lock1 = LockService.getScriptLock();
    const lock2 = LockService.getScriptLock(); // Nuova istanza o singleton?

    console.log("> Tentativo acquisizione Lock 1...");
    if (lock1.tryLock(2000)) {
        console.log("✅ Lock 1 acquisito.");

        console.log("> Tentativo acquisizione Lock 2 (Annidato)...");
        // Se il lock non è re-entrant, questo tryLock fallirà o attenderà il timeout
        const start = Date.now();
        if (lock2.tryLock(2000)) {
            console.log("✅ Lock 2 acquisito! (Comportamento Re-entrant confermato)");
            lock2.releaseLock();
        } else {
            console.warn("❌ Lock 2 Fallito/Timeout! (Possibile Deadlock se non re-entrant)");
        }
        console.log(`> Tempo trascorso: ${Date.now() - start}ms`);

        lock1.releaseLock();
        console.log("> Lock 1 rilasciato.");
    } else {
        console.error("❌ Impossibile acquisire Lock 1 iniziale.");
    }
}

/**
 * TEST SUITE: Verifica Sicurezza (URL Sanitization & ReDoS)
 * Scopo: Verificare che le protezioni contro XSS e ReDoS funzionino.
 */
function testSecuritySuite() {
    console.log("\n🧪 [[[ TEST SUITE: Security & Protection ]]]");

    // 1. URL Sanitization (GmailService)
    console.log("\n> Check URL Sanitization:");
    // Nota: sanitizeUrl è una funzione globale nel file gas_gmail_service.js
    assert(sanitizeUrl("https://google.com") !== null, "https:// deve passare");
    assert(sanitizeUrl("mailto:test@test.com") !== null, "mailto: deve passare");
    assert(sanitizeUrl("javascript:alert(1)") === null, "javascript: deve essere BLOCATO");
    assert(sanitizeUrl("data:text/html,base64...") === null, "data: deve essere BLOCATO");
    assert(sanitizeUrl("https://localhost/admin") === null, "SSRF (localhost) deve essere BLOCATO");
    assert(sanitizeUrl("https://127.0.0.1/test") === null, "SSRF (IP loopback) deve essere BLOCATO");

    // 2. ReDoS Protection (TerritoryValidator)
    console.log("\n> Check ReDoS Protection:");
    const validator = new TerritoryValidator();

    // Test input molto lungo (DoS protection)
    const longInput = "via " + "A".repeat(2000) + " 10";
    const start = Date.now();
    const resLong = validator.extractAddressFromText(longInput);
    const duration = Date.now() - start;
    console.log(`> Test input lungo completato in ${duration}ms`);
    assert(duration < 500, "La regex deve gestire input lungo velocemente (no backtracking catastrofico)");

    // Test pattern potenzialmente pericoloso (se la regex fosse vulnerabile)
    const maliciousInput = "via " + "rossi ".repeat(50) + "10";
    const start2 = Date.now();
    validator.extractAddressFromText(maliciousInput);
    const duration2 = Date.now() - start2;
    console.log(`> Test pattern ripetitivo completato in ${duration2}ms`);
    assert(duration2 < 500, "La regex deve gestire pattern ripetuti velocemente");
}

/**
 * TEST SUITE: Verifica Robustezza Memoria (Timestamp Validation)
 * Scopo: Verificare che i timestamp siano sempre validi e sicuri.
 */
function testMemoryRobustnessSuite() {
    console.log("\n🧪 [[[ TEST SUITE: Memory Robustness ]]]");
    const memService = new MemoryService();

    console.log("\n> Check Timestamp Validation:");
    const now = new Date().toISOString();

    assert(memService._validateAndNormalizeTimestamp(now) === now, "Timestamp valido deve passare");
    assert(memService._validateAndNormalizeTimestamp(null).length > 20, "Timestamp null deve tornare fallback (ISO string)");
    assert(memService._validateAndNormalizeTimestamp("invalid-date").length > 20, "Timestamp non valido deve tornare fallback");

    const futureDate = new Date(Date.now() + 1000000000).toISOString();
    assert(memService._validateAndNormalizeTimestamp(futureDate).length > 20, "Timestamp futuro deve tornare fallback");
    assert(memService._validateAndNormalizeTimestamp(futureDate) !== futureDate, "Timestamp futuro DEVE essere resettato");
}

/**
 * TEST SUITE 1: TerritoryValidator
 */
function testTerritoryValidatorSuite() {
    console.log("\n🧪 [[[ TEST SUITE: TerritoryValidator ]]]");
    const validator = new TerritoryValidator();

    // --- A. Test Base e Regex ---
    console.log("\n> Check Base:");
    const addr1 = validator.extractAddressFromText("Abito in via Cancani 10");
    assert(addr1 && addr1[0].civic === 10, "Estrazione civico base");

    const addr2 = validator.extractAddressFromText("via Bruno Buozzi 200"); // Range infinito
    assert(addr2 && addr2[0].civic === 200, "Estrazione civico alto");

    const addr3 = validator.extractAddressFromText("Abito in via Giuseppe De Notaris 15"); // Multi-parola
    assert(addr3 && addr3[0].street.toLowerCase().includes("de notaris"), "Estrazione via multi-parola corretta");

    // --- B. Test Range Avanzati (Tutti & Infinity) ---
    console.log("\n> Check Range Avanzati:");

    // Caso 1: Range 'tutti' specifico (Array) - es. Lungotevere Flaminio [16, 38]
    // Nota: Assicurarsi che 'lungotevere flaminio' sia configurato così nel DB: { tutti: [16, 38] }
    const resLungoIn = validator.verifyAddress("Lungotevere Flaminio", 20);
    assert(resLungoIn.inTerritory === true, " lungotevere flaminio 20 deve essere DENTRO (range 16-38)");

    const resLungoOut = validator.verifyAddress("Lungotevere Flaminio", 50);
    assert(resLungoOut.inTerritory === false, " lungotevere flaminio 50 deve essere FUORI (range 16-38)");

    // Caso 2: Range 'Infinity' (null) - es. Viale Bruno Buozzi dispari [109, null]
    const resBuozziIn = validator.verifyAddress("Viale Bruno Buozzi", 151); // > 109 dispari
    assert(resBuozziIn.inTerritory === true, " viale bruno buozzi 151 deve essere DENTRO (109-Infinity)");

    const resBuozziOut = validator.verifyAddress("Viale Bruno Buozzi", 80); // < 90 pari (e diverso da dispari)
    assert(resBuozziOut.inTerritory === false, " viale bruno buozzi 80 deve essere FUORI (sotto soglia 90 pari)");

    // Caso 3: Via Monti Parioli (pari 2-98)
    const resMontiOut = validator.verifyAddress("Via dei Monti Parioli", 100); // > 98 matchato esatto
    assert(resMontiOut.inTerritory === false, " via dei monti parioli 100 deve essere FUORI (range 2-98)");

    console.log("✅ TerritoryValidator Suite completata.");
}

/**
 * TEST SUITE 2: GmailService
 */
function testGmailServiceSuite() {
    console.log("\n🧪 [[[ TEST SUITE: GmailService ]]]");
    const service = new GmailService();

    // --- A. Sanificazione Header ---
    console.log("\n> Check Sanificazione:");
    const dirty1 = "Parroccchia S.Eugenio <info@parrocchiasanteugenio.it>";
    // Simulo logica _sanitizeHeaders o sendHtmlReply logic (che è privata/interna, 
    // quindi testo i metodi pubblici di utility se esposti o logica simile)

    // Testiamo la correzione automatica della punteggiatura
    const txtFix = service.fixPunctuation("Salve, Vorrei sapere...", "Mario Rossi");
    assert(txtFix.includes("Salve, vorrei"), "Correzione maiuscola dopo virgola");

    // --- B. Pulizia HTML ---
    const htmlText = "Ciao **mondo** questo è un [link](http://test)";
    const strip = service._stripHtmlTags(htmlText);
    assert(strip.includes("mondo") && !strip.includes("**"), "Rimozione markdown bold");
    assert(strip.includes("link") && !strip.includes("http"), "Rimozione link markdown"); // _stripHtmlTags keep label?

    console.log("✅ GmailService Suite completata.");
}

/**
 * TEST SUITE 3: ResponseValidator
 */
function testResponseValidatorSuite() {
    console.log("\n🧪 [[[ TEST SUITE: ResponseValidator ]]]");
    const validator = new ResponseValidator();

    // --- A. Perfezionamento Multilingua ---
    console.log("\n> Check Perfezionamento Multilingua:");

    // IT: Deve correggere
    const itText = "Ciao, Sono Mario";
    const itFixed = validator._fixCapitalAfterComma(itText, 'it');
    assert(itFixed === "Ciao, sono Mario", "IT: deve correggere 'Sono' dopo virgola");

    // EN: NON deve correggere parole comuni inglesi se non in lista nera
    // 'I' non è in lista nera (targets), 'The' lo è.
    const enText1 = "Hello, I am Mario";
    const enFixed1 = validator._fixCapitalAfterComma(enText1, 'en');
    assert(enFixed1 === "Hello, I am Mario", "EN: 'I' non deve essere toccato");

    const enText2 = "Hello, The world";
    const enFixed2 = validator._fixCapitalAfterComma(enText2, 'en');
    assert(enFixed2 === "Hello, the world", "EN: 'The' deve essere corretto");

    // ES:
    const esText = "Hola, Estamos bien";
    const esFixed = validator._fixCapitalAfterComma(esText, 'es');
    assert(esFixed === "Hola, estamos bien", "ES: 'Estamos' deve essere corretto");

    // --- B. Hallucinations (Thinking Leak) ---
    console.log("\n> Check Thinking Leaks:");
    // Pattern sicuro: RE: "knowledge base" + (dice|afferma|contiene|riporta|indica)
    const leakText = "La knowledge base o kb contiene indicazioni...";
    const resLeak = validator._checkExposedReasoning(leakText);
    assert(resLeak.score === 0.0, "Deve rilevare thinking leak 'kb contiene'");

    // --- C. checkHallucinations (Regex File Path Bug) ---
    console.log("\n> Check Regex File Path (Bug Fix):");
    // Se la regex è errata ([\\w-] invece di [\\w-]), "documento.10.30.pdf" 
    // non viene riconosciuto come file e "10.30" diventa orario 10:30.
    const fileText = "Allego il file documento.10.30.pdf per revisione.";
    const resFile = validator._checkHallucinations(fileText, ""); // KB vuota

    // Se il fix funziona, "10.30" viene ignorato perché parte di un file path.
    // Quindi non deve esserci 'times' nei warnings o hallucinations.
    const foundTimes = resFile.hallucinations && resFile.hallucinations.times ? resFile.hallucinations.times : [];
    assert(foundTimes.length === 0, `Non deve rilevare orari in file path (Trovati: ${foundTimes.join(', ')})`);

    console.log("✅ ResponseValidator Suite completata.");
}

/**
 * TEST SUITE 3B: SemanticValidator (richiede API Gemini configurata)
 */
function testSemanticValidator() {
    console.log("\n🧪 [[[ TEST SUITE: SemanticValidator ]]]");
    const validator = new SemanticValidator();

    if (!validator.enabled) {
        console.warn("⚠️ SemanticValidator disabilitato da CONFIG, skip test.");
        return;
    }

    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') ||
        (typeof CONFIG !== 'undefined' ? CONFIG.GEMINI_API_KEY : null);

    if (!apiKey || apiKey.includes('YOUR_GEMINI_API_KEY_HERE')) {
        console.warn("⚠️ API key Gemini non configurata, skip test SemanticValidator.");
        return;
    }

    const kb = "Messa domenicale: 10:00 e 18:00. Tel: 06-1234567";
    const responseOk = "La messa domenicale è alle 10:00 e 18:00.";
    const responseBad = "La messa è alle 11:30 e potete chiamare il 06-9999999.";
    const regexUncertain = { errors: [], score: 0.85 };

    const semOk = validator.validateHallucinations(responseOk, kb, regexUncertain);
    assert(semOk.isValid === true, "Semantic dovrebbe validare risposta corretta");

    const semBad = validator.validateHallucinations(responseBad, kb, regexUncertain);
    assert(semBad.isValid === false, "Semantic dovrebbe rilevare orario inventato");

    const cleanResponse = "Ecco le informazioni richieste: ...";
    const leakyResponse = "Consultando la knowledge base, vedo che...";

    const semClean = validator.validateThinkingLeak(cleanResponse, regexUncertain);
    assert(semClean.isValid === true, "Risposta pulita dovrebbe passare");

    const semLeaky = validator.validateThinkingLeak(leakyResponse, regexUncertain);
    assert(semLeaky.isValid === false, "Thinking leak dovrebbe essere rilevato");

    console.log("✅ SemanticValidator test completati.");
}

/**
 * TEST SUITE 4: PromptEngine (Smart RAG Unificato)
 */
function testSmartRAGSuite() {
    console.log("\n🧪 [[[ TEST SUITE: Smart RAG Unificato ]]]");
    const engine = new PromptEngine();

    // Force Mock GLOBAL_CACHE for testing
    // Sovrascriviamo temporaneamente per garantire dati di test coerenti
    const originalCache = typeof GLOBAL_CACHE !== 'undefined' ? GLOBAL_CACHE : undefined;
    GLOBAL_CACHE = {
        doctrineStructured: [
            {
                'Categoria': 'Sacramenti',
                'Sotto-tema': 'Confessione e perdono',
                'Principio dottrinale': 'Dio perdona sempre chi è pentito',
                'Tono consigliato': 'Istruttivo e Chiaro',
                'Indicazioni operative AI': 'Spiega la differenza tra contrizione e attrizione'
            },
            {
                'Categoria': 'Morale cristiana',
                'Sotto-tema': 'Peccato mortale',
                'Principio dottrinale': 'Rottura grave della relazione con Dio',
                'Tono consigliato': 'Serio e Dottrinale',
                'Indicazioni operative AI': 'Non banalizzare, invita alla confessione'
            },
            {
                'Categoria': 'Pastorale matrimoniale',
                'Sotto-tema': 'Divorziati risposati',
                'Principio dottrinale': 'Non possono accedere alla comunione sacramentale',
                'Criterio pastorale': 'Accogliere con amore, non escludere dalla vita comunitaria',
                'Tono consigliato': 'Empatico e Accogliente',
                'Indicazioni operative AI': 'Evita toni giudicanti, focus su cammino spirituale'
            },
            {
                'Categoria': 'Pastorale matrimoniale',
                'Sotto-tema': 'Battesimo figli coppie irregolari',
                'Principio dottrinale': 'Il battesimo è diritto del bambino',
                'Criterio pastorale': 'Richiede fondata speranza di educazione cristiana',
                'Tono consigliato': 'Accogliente ma Chiaro'
            },
            {
                'Categoria': 'Amministrativo',
                'Sotto-tema': 'Sbattezzo',
                'Tono consigliato': 'Istituzionale e Neutro'
            }
        ],
        doctrineBase: "DUMP COMPLETO DOTTRINA (FALLBACK)"
    };


    // --- TEST 1: Caso DOTTRINALE puro ---
    console.log("\n> check 1: Dottrinale Puro (Teologico)");
    const req1 = {
        type: 'doctrinal',
        dimensions: { doctoral: 0.9, pastoral: 0.2 },
        suggestedTone: 'Istruttivo e Chiaro'
    };
    const out1 = engine._renderSelectiveDoctrine(req1, 'Confessione', 'Cos’è la confessione?', 'Domanda', 'standard');
    assert(out1 !== null, "Deve restituire contenuto");
    if (out1) {
        assert(out1.includes("Principio"), "Deve includere il principio");
        assert(out1.includes("CONFESSIONE"), "Deve selezionare tema Confessione");
    }

    // --- TEST 2: Caso PASTORALE (Empatico) ---
    console.log("\n> check 2: Pastorale (Divorziati)");
    const req2 = {
        type: 'pastoral',
        dimensions: { pastoral: 0.9, doctrinal: 0.3 },
        suggestedTone: 'Empatico e Accogliente'
    };
    const out2 = engine._renderSelectiveDoctrine(req2, 'Divorziati', 'Sono divorziato...', 'Aiuto', 'standard');
    if (out2) {
        assert(out2.includes("Accogliere con amore") || out2.includes("Leva Pastorale"), "Deve includere criterio pastorale accogliente");
        assert(out2.includes("Empatico"), "Deve mostrare tono consigliato empatico");
    }

    // --- TEST 3: Caso TECNICO (Orari) ---
    console.log("\n> check 3: Tecnico (Orari)");
    const req3 = {
        type: 'technical',
        dimensions: { technical: 0.9, pastoral: 0.1 },
        suggestedTone: 'Professionale'
    };
    // Non dovrebbe matchare nulla di dottrinale specifico se non c'è topic pertinente
    const out3 = engine._renderSelectiveDoctrine(req3, '', 'Quali sono gli orari?', 'Orari', 'standard');
    assert(out3 === null, "Non deve iniettare dottrina se non pertinente");

    // --- TEST 4: Caso MISTO (Battesimo irregolare) ---
    console.log("\n> check 4: Misto (Battesimo)");
    const req4 = {
        type: 'mixed',
        dimensions: { pastoral: 0.7, technical: 0.5 },
        suggestedTone: 'Accogliente ma Chiaro'
    };
    const out4 = engine._renderSelectiveDoctrine(req4, 'Battesimo', 'Vorrei battezzare...', 'Info', 'standard');
    if (out4) {
        assert(out4.includes("BATTESIMO"), "Deve trovare tema battesimo");
        assert(out4.includes("speranza") || out4.includes("Leva Pastorale"), "Deve includere criteri specifici");
    }

    // --- TEST 5: Fallback ---
    console.log("\n> check 5: Fallback su Cache Vuota");
    // Salviamo la strutturata corrente (che è il nostro mock)
    const mockStructured = GLOBAL_CACHE.doctrineStructured;
    GLOBAL_CACHE.doctrineStructured = []; // Svuota

    const out5 = engine._renderSelectiveDoctrine(req1, 'Confessione', '...', '...', 'standard');
    assert(out5 === null, "Deve tornare null per triggerare fallback al dump completo");

    // Restore Mock per coerenza (opzionale qui, ma buona pratica)
    GLOBAL_CACHE.doctrineStructured = mockStructured;

    // Restore Original Global Cache (se esisteva)
    if (originalCache) {
        GLOBAL_CACHE = originalCache;
    } else {
        // Se non esisteva, possiamo lasciarla o cancellarla, dipende dall'ambiente.
        // In GAS meglio non cancellare globali se possibile, ma qui stiamo solo testando.
    }

    console.log("✅ Smart RAG Unificato Suite completata.");
}

/**
 * TEST SUITE 5: RequestTypeClassifier (Verifica Logica Avanzata)
 */
function testRequestTypeClassifierSuite() {
    console.log("\n🧪 [[[ TEST SUITE: RequestTypeClassifier ]]]");
    const classifier = new RequestTypeClassifier();

    // --- A. Verifica Ripetizione Keyword (Conteggio Multiplo) ---
    console.log("\n> Verifica Ripetizione Keyword (Flag Globale):");
    const repeatText = "vorrei sapere gli orari, anche gli orari della messa, e gli orari ufficio";
    // 'orari' ha peso 2. Appare 3 volte.
    // Senza /g: score = 2 * 1 = 2
    // Con /g: score = 2 * 3 = 6

    // Accediamo a _calculateScore che è 'private' ma testabile in JS
    // Usiamo TECHNICAL_INDICATORS dove 'orari' è presente
    const result = classifier._calculateScore(repeatText, classifier.TECHNICAL_INDICATORS);

    // Cerchiamo specifico match su 'orari' per debug preciso se fallisce
    const orariMatches = result.matched.filter(m => m.includes("orari"));

    // Se la logica è corretta, il punteggio deve riflettere tutte le occorrenze
    // Nota: 'orari' peso 2. Ci sono 3 occorrenze -> 6 punti solo per questo.
    // Potrebbero esserci altri match (es 'sapere' non è in lista, ma controlliamo).

    // Verifica che matchCount sia almeno 3 (o esattamente 3 se non ci sono altre keyword)
    // Nel testo "vorrei sapere gli orari..."
    // "vorrei" -> no
    // "sapere" -> no
    // "orari" -> si (2)
    // "messa" -> no
    // "ufficio" -> no

    console.log(`   Text: "${repeatText}"`);
    console.log(`   Score: ${result.score}, Matches: ${result.matchCount}`);

    assert(result.matchCount >= 3, "Deve contare tutte le 3 occorrenze di 'orari'");
    assert(result.score >= 6, "Il punteggio deve riflettere 3 occorrenze (3 * 2 = 6)");

    // --- B. Verifica Tipo Misto (Logica Dimensionale) ---
    console.log("\n> Verifica Tipo Misto (Soglia > 0.4):");
    const mixedHint = {
        dimensions: { technical: 0.5, pastoral: 0.5 },
        confidence: 0.8
    };
    const mixedRes = classifier.classify("Testo generico", "", mixedHint);

    console.log(`   Dimensions: T=${mixedRes.dimensions.technical}, P=${mixedRes.dimensions.pastoral}`);
    console.log(`   Type: ${mixedRes.type}`);

    assert(mixedRes.type === 'mixed', "Deve essere classificato come 'mixed' (0.5/0.5 > 0.4)");

    console.log("✅ RequestTypeClassifier Suite completata.");
}

/**
 * TEST SUITE 6: Logger Robustness (Partial/Missing Config)
 */
function testLoggerRobustnessSuite() {
    console.log("\n🧪 [[[ TEST SUITE: Logger Robustness ]]]");

    // 1. Test con Config Vuoto
    console.log("> Check 1: Logger con Config Vuoto");
    const safeLogger = new Logger("SafeTest");
    // Simuliamo config vuoto (sovrascrivendo temporaneamente this.config se accessibile, 
    // ma dato che è nel costruttore, creiamo una istanza e forziamo la proprietà se necessario,
    // oppure ci affidiamo al fatto che il test runner potrebbe non avere CONFIG completo)

    // Per testare veramente, forziamo 'config' interno a {}
    safeLogger.config = {};

    try {
        safeLogger.info("Test messaggio info (No Config)");
        safeLogger.error("Test messaggio error (No Config)");
        console.log("✅ Logger gestisce config vuoto senza errori.");
    } catch (e) {
        console.error(`❌ FAIL: Logger crashato con config vuoto: ${e.message}`);
    }

    // 2. Test con Config Parziale (LOGGING esiste ma vuoto)
    console.log("\n> Check 2: Logger con Config Parziale");
    safeLogger.config = { LOGGING: {} };
    try {
        safeLogger.warn("Test warning (Partial Config)");
        console.log("✅ Logger gestisce config parziale senza errori.");
    } catch (e) {
        console.error(`❌ FAIL: Logger crashato con config parziale: ${e.message}`);
    }

    console.log("✅ Logger Robustness Suite completata.");
}

/**
 * Miglioramento #3: Protezione ReDoS (TerritoryValidator)
 */
function testTerritoryValidatorReDoS() {
    console.log("\n🧪 [[[ TEST: TerritoryValidator - Protezione ReDoS ]]]");
    const validator = new TerritoryValidator();

    // Test 1: Input normale (veloce)
    console.log("> Check 1: Performance input normale");
    const start1 = Date.now();
    const normal = "via Roma 10";
    validator.extractAddressFromText(normal);
    const duration1 = Date.now() - start1;
    assert(duration1 < 100, `Input normale deve essere veloce (<100ms), attuale: ${duration1}ms`);

    // Test 2: Payload ReDoS (non deve andare in timeout)
    console.log("> Check 2: Protezione payload ReDoS");
    const start2 = Date.now();
    const malicious = "via " + "parola ".repeat(10) + " n";
    try {
        validator.extractAddressFromText(malicious);
        const duration2 = Date.now() - start2;
        assert(duration2 < 1000, `Il payload ReDoS deve terminare in <1s (era >30s), attuale: ${duration2}ms`);
    } catch (e) {
        assert(false, `Errore durante test ReDoS: ${e.message}`);
    }

    // Test 3: Troncamento input lungo
    console.log("> Check 3: Troncamento input eccessivo");
    const long = "via Roma ".repeat(200) + "10";
    const result3 = validator.extractAddressFromText(long);
    assert(result3 !== undefined, "Input lungo gestito senza errori");

    // Test 4: Limite iterazioni massime
    console.log("> Check 4: Limite iterazioni regex");
    const many = "via Roma 1, via Milano 2, via Torino 3, ".repeat(50);
    try {
        validator.extractAddressFromText(many);
        assert(true, "Limite iterazioni applicato senza crash");
    } catch (e) {
        assert(false, `Errore durante test iterazioni: ${e.message}`);
    }
}

/**
 * Miglioramento #6: Gestione Memory Growth (PromptEngine)
 */
function testPromptEngineBudget() {
    console.log("\n🧪 [[[ TEST: PromptEngine - Budget Tracking ]]]");
    const engine = new PromptEngine();

    // Test 1: Troncamento KB se troppo grande
    console.log("> Check 1: Troncamento KB sovradimensionata");
    const hugeKB = "X".repeat(200000); // 200KB
    const prompt1 = engine.buildPrompt({
        knowledgeBase: hugeKB,
        emailContent: "Test",
        emailSubject: "Test",
        senderName: "Test",
        detectedLanguage: 'it',
        salutation: 'Buongiorno',
        closing: 'Cordiali saluti'
    });
    const tokens1 = engine.estimateTokens(prompt1);
    const MAX_SAFE = typeof CONFIG !== 'undefined' && CONFIG.MAX_SAFE_TOKENS ? CONFIG.MAX_SAFE_TOKENS : 100000;
    assert(tokens1 <= MAX_SAFE, `Prompt con KB enorme deve stare sotto ${MAX_SAFE} token, attuale: ${tokens1}`);

    // Test 2: Il tracking del budget previene l'overflow
    console.log("> Check 2: Prevenzione overflow budget");
    const largeKB = "Y".repeat(150000);
    const longHistory = "Z".repeat(50000);
    const prompt2 = engine.buildPrompt({
        knowledgeBase: largeKB,
        conversationHistory: longHistory,
        emailContent: "Test",
        emailSubject: "Test",
        senderName: "Test",
        detectedLanguage: 'it',
        salutation: 'Buongiorno',
        closing: 'Cordiali saluti'
    });
    const tokens2 = engine.estimateTokens(prompt2);
    assert(tokens2 <= MAX_SAFE, `Budget rispettato con KB+history grandi, attuale: ${tokens2}`);

    // Test 3: Sezioni saltate se budget esaurito
    console.log("> Check 3: Sezioni saltate a budget esaurito");
    const massiveKB = "W".repeat(500000);
    const prompt3 = engine.buildPrompt({
        knowledgeBase: massiveKB,
        emailContent: "Test",
        emailSubject: "Test",
        senderName: "Test",
        detectedLanguage: 'it',
        salutation: 'Buongiorno',
        closing: 'Cordiali saluti',
        promptProfile: 'heavy' // Forza inclusione sezioni
    });
    // Verifica se sezioni non critiche (es. ESEMPI) sono state saltate
    const hasExamples = prompt3.includes('📚 ESEMPI');
    const tokens3 = engine.estimateTokens(prompt3);
    assert(!hasExamples && tokens3 <= MAX_SAFE, "Esempi saltati correttamente per restare nel budget");
}

/**
 * Esegui tutti i test
 */
function runAllTests() {
    const start = Date.now();
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║           SYSTEM INTEGRATION TESTS                           ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");

    try {
        testTerritoryValidatorSuite();
        testGmailServiceSuite();
        testResponseValidatorSuite();
        testSecuritySuite();
        testMemoryRobustnessSuite();
        testSemanticValidator();
        testSmartRAGSuite();
        testRequestTypeClassifierSuite();
        testLoggerRobustnessSuite();

        // Nuovi test per miglioramenti recenti
        testTerritoryValidatorReDoS();
        testPromptEngineBudget();

        console.log("\n╔══════════════════════════════════════════════════════════════╗");
        console.log(`║  🎉 TUTTI I TEST COMPLETATI in ${Date.now() - start}ms                 ║`);
        console.log("╚══════════════════════════════════════════════════════════════╝");
    } catch (e) {
        console.error(`💥 ABORT: Errore critico durante i test: ${e.message}`);
    }
}
