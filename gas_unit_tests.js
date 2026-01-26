/**
 * gas_unit_tests.js - Test suite per moduli GAS (non caricato in produzione)
 */

// Aggiungi a gas_unit_tests.js

function testTerritoryValidatorEdgeCases() {
    console.log("\n🧪 Testing TerritoryValidator Edge Cases...");

    // Semplice funzione assert
    const assert = (condition, message) => {
        if (!condition) {
            console.error(`❌ FAIL: ${message}`);
            throw new Error(message);
        } else {
            console.log(`✅ PASS: ${message}`);
        }
    };

    const validator = new TerritoryValidator();

    // Test 1: Regex cattura civico correttamente
    const addr1 = validator.extractAddressFromText("Abito in via Cancani 10");
    assert(addr1 !== null, "Deve estrarre indirizzo");
    assert(addr1[0].civic === 10, `Civico deve essere 10, trovato ${addr1[0].civic}`);

    // Test 2: ReDoS protection Pattern 2
    const start = Date.now();
    const attack = "abito in via " + "a ".repeat(100) + "10";
    validator.extractAddressFromText(attack);
    const elapsed = Date.now() - start;
    assert(elapsed < 500, `ReDoS attack deve completare <500ms (attuale: ${elapsed}ms)`);

    // Test 3: Fuzzy match non troppo aggressivo
    // Questo test verifica che "via monti" NON matchi "largo dei monti parioli"
    const match1 = validator.findTerritoryMatch("via monti");
    if (match1) {
        // Se trova qualcosa, assicuriamoci che non sia "largo dei monti parioli"
        assert(match1.key.startsWith('via'),
            `Match 'via monti' non deve trovare 'largo dei monti parioli'`);
    } else {
        console.log("✅ PASS: 'via monti' non ha trovato falsi positivi");
    }

    // Test 4: Abbreviazioni espanse
    const normalized = validator.normalizeStreetName("via G. Cancani");
    assert(normalized.includes('giovanni'),
        "Abbreviazione 'G.' deve espandersi in 'giovanni'");

    // Test 5: Limiti civico
    const invalid = validator.extractAddressFromText("via Roma 99999");
    assert(invalid === null || invalid.length === 0,
        "Civico >9999 deve essere rifiutato");

    // Test 6: Via senza civico
    const streets = validator.extractStreetOnlyFromText("Abito in via Cancani");
    assert(streets !== null && streets.length > 0,
        "Deve estrarre via senza civico");

    console.log("✅ TerritoryValidator edge cases test passed");
}

function runAllTests() {
    try {
        testTerritoryValidatorEdgeCases();
        console.log("\n🎉 TUTTI I TEST PASSATI!");
    } catch (e) {
        console.error("\n💥 TEST FALLITI");
    }
}
