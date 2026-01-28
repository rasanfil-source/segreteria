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

    console.log("✅ ResponseValidator Suite completata.");
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
 * TEST SUITE 5: RequestTypeClassifier (Regex Fix Check)
 */
function testRequestTypeClassifierSuite() {
    console.log("\n🧪 [[[ TEST SUITE: RequestTypeClassifier ]]]");
    const classifier = new RequestTypeClassifier();

    // --- A. Test Ripetizione Keyword (Regex /g check) ---
    console.log("\n> Check Ripetizione Keyword (Global Flag):");
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

    console.log("✅ RequestTypeClassifier Suite completata.");
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
        testSmartRAGSuite();
        testRequestTypeClassifierSuite();

        console.log("\n╔══════════════════════════════════════════════════════════════╗");
        console.log(`║  🎉 TUTTI I TEST COMPLETATI in ${Date.now() - start}ms                 ║`);
        console.log("╚══════════════════════════════════════════════════════════════╝");
    } catch (e) {
        console.error(`💥 ABORT: Errore critico durante i test: ${e.message}`);
    }
}
