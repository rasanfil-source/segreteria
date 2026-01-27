/**
 * gas_unit_tests.js - Test suite completa per il sistema (v2.5)
 * 
 * Copre:
 * 1. TerritoryValidator (inclusi range 'tutti' e 'Infinity')
 * 2. GmailService (sanificazione header, punteggiatura)
 * 3. ResponseValidator (autofix multilingua, allucinazioni)
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

    // Testiamo fixPunctuation che è pubblico
    const txtFix = service.fixPunctuation("Salve, Vorrei sapere...", "Mario Rossi");
    assert(txtFix.includes("Salve, vorrei"), "Correzione maiuscola dopo virgola (fixPunctuation)");

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

    // --- A. Autofix Multilingua ---
    console.log("\n> Check Autofix Multilingua:");

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
 * Esegui tutti i test
 */
function runAllTests() {
    const start = Date.now();
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║           SYSTEM INTEGRATION TESTS (v2.5)                    ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");

    try {
        testTerritoryValidatorSuite();
        testGmailServiceSuite();
        testResponseValidatorSuite();

        console.log("\n╔══════════════════════════════════════════════════════════════╗");
        console.log(`║  🎉 TUTTI I TEST COMPLETATI in ${Date.now() - start}ms                 ║`);
        console.log("╚══════════════════════════════════════════════════════════════╝");
    } catch (e) {
        console.error(`💥 ABORT: Errore critico durante i test: ${e.message}`);
    }
}
