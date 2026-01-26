/**
 * gas_unit_tests.js - Test suite completa per TerritoryValidator
 * 
 * Contiene test per:
 * - Protezione ReDoS
 * - Matching fuzzy e consecutività
 * - Espansione abbreviazioni
 * - Validazione civici
 */

// Semplice funzione assert
const assert = (condition, message) => {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        throw new Error(message);
    } else {
        console.log(`✅ PASS: ${message}`);
    }
};

/**
 * Test completo casi limite TerritoryValidator
 */
function testTerritoryValidatorEdgeCases() {
    console.log("\n🧪 Test Casi Limite TerritoryValidator...");

    const validator = new TerritoryValidator();

    // ========================================
    // TEST 1: Regex cattura civico correttamente
    // ========================================
    console.log("\n--- Test 1: Cattura civico ---");
    const addr1 = validator.extractAddressFromText("Abito in via Cancani 10");
    assert(addr1 !== null, "Deve estrarre indirizzo");
    assert(addr1.length > 0, "Array indirizzi non vuoto");
    assert(addr1[0].civic === 10, `Civico deve essere 10, trovato ${addr1[0].civic}`);

    // Test pattern 1: "via Rossi 10"
    const addr2 = validator.extractAddressFromText("Mio indirizzo: via Aldrovandi 3");
    assert(addr2 !== null && addr2[0].civic === 3, "Pattern 1 deve catturare civico");

    // Test pattern 2: "abito in via Rossi 10"
    const addr3 = validator.extractAddressFromText("Abito in via del Sarto 15");
    assert(addr3 !== null && addr3[0].civic === 15, "Pattern 2 deve catturare civico");

    // ========================================
    // TEST 2a: Protezione ReDoS extractAddressFromText
    // ========================================
    console.log("\n--- Test 2a: ReDoS extractAddressFromText ---");
    const start1 = Date.now();
    const attack1 = "abito in via " + "a ".repeat(100) + "10";
    validator.extractAddressFromText(attack1);
    const elapsed1 = Date.now() - start1;
    assert(elapsed1 < 500, `extractAddressFromText ReDoS deve completare <500ms (attuale: ${elapsed1}ms)`);

    // ========================================
    // TEST 2b: Protezione ReDoS extractStreetOnlyFromText
    // ========================================
    console.log("\n--- Test 2b: ReDoS extractStreetOnlyFromText ---");
    const start2 = Date.now();
    const attack2 = "abito in via " + "a ".repeat(100); // senza civico
    validator.extractStreetOnlyFromText(attack2);
    const elapsed2 = Date.now() - start2;
    assert(elapsed2 < 500, `extractStreetOnlyFromText ReDoS deve completare <500ms (attuale: ${elapsed2}ms)`);

    // ========================================
    // TEST 3: Matching Fuzzy non aggressivo
    // ========================================
    console.log("\n--- Test 3: Fuzzy match consecutività ---");

    // Caso 1: "via monti" NON deve matchare "largo dei monti parioli"
    const match1 = validator.findTerritoryMatch("via monti");
    if (match1) {
        assert(match1.key.startsWith('via'),
            `Match 'via monti' non deve trovare 'largo dei monti parioli' (trovato: ${match1.key})`);
    } else {
        console.log("✅ PASS: 'via monti' non ha trovato falsi positivi");
    }

    // Caso 2: "via dei monti parioli" DEVE matchare "via dei monti parioli"
    const match2 = validator.findTerritoryMatch("via dei monti parioli");
    assert(match2 !== null, "Match esatto deve funzionare");
    assert(match2.key === 'via dei monti parioli',
        `Match esatto deve tornare chiave corretta (trovato: ${match2.key})`);

    // Caso 3: "via monti parioli" DEVE matchare "via dei monti parioli" (coppia consecutiva "monti parioli")
    const match3 = validator.findTerritoryMatch("via monti parioli");
    assert(match3 !== null, "Fuzzy match con coppia consecutiva deve funzionare");
    assert(match3.key === 'via dei monti parioli',
        `Fuzzy match deve trovare 'via dei monti parioli' (trovato: ${match3 ? match3.key : 'null'})`);

    // ========================================
    // TEST 4: Espansione abbreviazioni
    // ========================================
    console.log("\n--- Test 4: Espansione abbreviazioni ---");

    const normalized1 = validator.normalizeStreetName("via G. Cancani");
    assert(normalized1.includes('giovanni'),
        `Abbreviazione 'G.' deve espandersi in 'giovanni' (trovato: ${normalized1})`);

    const normalized2 = validator.normalizeStreetName("via U. Aldrovandi");
    assert(normalized2.includes('ulisse'),
        `Abbreviazione 'U.' deve espandersi in 'ulisse' (trovato: ${normalized2})`);

    const normalized3 = validator.normalizeStreetName("P. San Pietro");
    assert(normalized3.includes('piazza'),
        `Abbreviazione 'P.' deve espandersi in 'piazza' (trovato: ${normalized3})`);

    // ========================================
    // TEST 5: Limiti e validità civico
    // ========================================
    console.log("\n--- Test 5: Validazione civico ---");

    // Civico troppo grande (>9999)
    const invalid1 = validator.extractAddressFromText("via Roma 99999");
    assert(invalid1 === null || invalid1.length === 0,
        "Civico >9999 deve essere rifiutato");

    // Civico negativo
    const invalid2 = validator.extractAddressFromText("via Roma -5");
    assert(invalid2 === null || invalid2.length === 0,
        "Civico negativo deve essere rifiutato");

    // Civico zero
    const invalid3 = validator.extractAddressFromText("via Roma 0");
    assert(invalid3 === null || invalid3.length === 0,
        "Civico 0 deve essere rifiutato");

    // Civico valido (1-9999)
    const valid1 = validator.extractAddressFromText("via Roma 1");
    assert(valid1 !== null && valid1[0].civic === 1,
        "Civico 1 deve essere accettato");

    const valid2 = validator.extractAddressFromText("via Roma 9999");
    assert(valid2 !== null && valid2[0].civic === 9999,
        "Civico 9999 deve essere accettato");

    // ========================================
    // TEST 6: Via senza civico
    // ========================================
    console.log("\n--- Test 6: Estrazione via senza civico ---");

    const streets1 = validator.extractStreetOnlyFromText("Abito in via Cancani");
    assert(streets1 !== null && streets1.length > 0,
        "Deve estrarre via senza civico");
    assert(streets1[0].toLowerCase().includes('cancani'),
        `Via estratta deve contenere 'cancani' (trovato: ${streets1[0]})`);

    const streets2 = validator.extractStreetOnlyFromText("Zona via Aldrovandi e via del Sarto");
    assert(streets2 !== null && streets2.length === 2,
        "Deve estrarre multiple vie senza civico");

    // ========================================
    // TEST 7: Verifica territorio
    // ========================================
    console.log("\n--- Test 7: Verifica appartenenza territorio ---");

    // Via con tutti i civici
    const verify1 = validator.verifyAddress("via Cancani", 50);
    assert(verify1.inTerritory === true,
        "via Cancani 50 deve essere nel territorio (tutti i civici)");

    // Via con civico dispari in range
    const verify2 = validator.verifyAddress("via Aldrovandi", 15);
    assert(verify2.inTerritory === true,
        "via Aldrovandi 15 (dispari) deve essere nel territorio");

    // Via con civico pari FUORI range
    const verify3 = validator.verifyAddress("via Aldrovandi", 10);
    assert(verify3.inTerritory === false,
        "via Aldrovandi 10 (pari) NON deve essere nel territorio (solo dispari)");

    // Via con civico in range pari
    const verify4 = validator.verifyAddress("via del Sarto", 20);
    assert(verify4.inTerritory === true,
        "via del Sarto 20 (pari) deve essere nel territorio");

    // ========================================
    // TEST 8: Casi input limite
    // ========================================
    console.log("\n--- Test 8: Input edge cases ---");

    // Input vuoto
    const empty1 = validator.extractAddressFromText("");
    assert(empty1 === null, "Input vuoto deve tornare null");

    const empty2 = validator.extractStreetOnlyFromText("");
    assert(empty2 === null, "Input vuoto (street only) deve tornare null");

    // Input senza indirizzi
    const noaddr = validator.extractAddressFromText("Ciao come stai?");
    assert(noaddr === null, "Testo senza indirizzi deve tornare null");

    // Input molto lungo (>1000 caratteri)
    const longText = "Abito in via Cancani 10. " + "Lorem ipsum ".repeat(200);
    const addr4 = validator.extractAddressFromText(longText);
    assert(addr4 !== null, "Input lungo deve essere troncato e processato");
    assert(addr4[0].civic === 10, "Indirizzo all'inizio di input lungo deve essere estratto");

    console.log("\n✅ TUTTI I TEST TerritoryValidator PASSATI!");
}

/**
 * Test performance regex pattern
 */
function testRegexPerformance() {
    console.log("\n🚀 Testing Performance Regex...");

    const validator = new TerritoryValidator();

    // Test 1: Input normale (caso comune)
    const start1 = Date.now();
    for (let i = 0; i < 100; i++) {
        validator.extractAddressFromText("Abito in via Cancani 10 a Roma");
    }
    const elapsed1 = Date.now() - start1;
    console.log(`✅ 100 iterazioni input normale: ${elapsed1}ms (media: ${elapsed1 / 100}ms)`);
    assert(elapsed1 < 1000, "100 iterazioni devono completare in <1s");

    // Test 2: Input con molte vie
    const start2 = Date.now();
    const multiStreet = "Le vie sono: via Roma 1, via Milano 2, via Torino 3, via Napoli 4, via Palermo 5";
    for (let i = 0; i < 50; i++) {
        validator.extractAddressFromText(multiStreet);
    }
    const elapsed2 = Date.now() - start2;
    console.log(`✅ 50 iterazioni multi-street: ${elapsed2}ms (media: ${elapsed2 / 50}ms)`);
    assert(elapsed2 < 1000, "50 iterazioni multi-street devono completare in <1s");

    console.log("\n✅ Performance test PASSED!");
}

/**
 * Esegui tutti i test
 */
function runAllTests() {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║        TEST SUITE TERRITORY VALIDATOR                        ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");

    try {
        testTerritoryValidatorEdgeCases();
        testRegexPerformance();

        console.log("\n╔══════════════════════════════════════════════════════════════╗");
        console.log("║  🎉 TUTTI I TEST PASSATI! Sistema pronto                     ║");
        console.log("╚══════════════════════════════════════════════════════════════╝");

    } catch (e) {
        console.error("\n╔══════════════════════════════════════════════════════════════╗");
        console.error("║  💥 TEST FALLITI - Verifica errori sopra                    ║");
        console.error("╚══════════════════════════════════════════════════════════════╝");
        console.error(`\nErrore: ${e.message}`);
        console.error(e.stack);
        throw e;
    }
}

/**
 * Test manuale interattivo
 */
function testManually() {
    console.log("\n🔧 Test Manuale TerritoryValidator");

    const validator = new TerritoryValidator();

    const testCases = [
        {
            text: "Abito in via Cancani 5",
            expected: { street: 'via adolfo cancani', civic: 5, inTerritory: true }
        },
        {
            text: "via U. Aldrovandi 3",
            expected: { street: 'via ulisse aldrovandi', civic: 3, inTerritory: true }
        },
        {
            text: "Zona via del Sarto",
            expected: { hasStreetOnly: true }
        },
        {
            text: "via " + "a ".repeat(50) + "10",
            expected: { shouldComplete: true, maxTime: 500 }
        }
    ];

    testCases.forEach((test, i) => {
        console.log(`\n--- Test Manuale ${i + 1} ---`);
        console.log(`Input: ${test.text.substring(0, 100)}${test.text.length > 100 ? '...' : ''}`);

        const start = Date.now();
        const addresses = validator.extractAddressFromText(test.text);
        const elapsed = Date.now() - start;

        console.log(`Tempo: ${elapsed}ms`);
        console.log(`Risultato:`, JSON.stringify(addresses, null, 2));

        if (test.expected.shouldComplete) {
            console.log(`✅ Completato in ${elapsed}ms (limite: ${test.expected.maxTime}ms)`);
        }

        if (addresses && addresses.length > 0) {
            const verify = validator.verifyAddress(addresses[0].street, addresses[0].civic);
            console.log(`Verifica territorio:`, verify);
        }
    });
}
