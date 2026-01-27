
function debugTerritoryLogic() {
    const validator = new TerritoryValidator();

    console.log("=== TEST VALIDAZIONE TERRITORIO ===");

    // Test Case 1: Range aperto (Viale Bruno Buozzi dispari: 109+)
    // 150 è > 109, deve essere TRUE
    const test1 = "Viale Bruno Buozzi 150";
    console.log(`\n🧪 Test 1: '${test1}' (Range atteso: 109-Infinity)`);
    const result1 = validator.analyzeEmailForAddress(test1, "Test");
    console.log(`Risultato: ${result1.verification ? (result1.verification.inParish ? "✅ DENTRO" : "❌ FUORI") : "⚠️  NON TROVATO"}`);
    console.log(`Dettagli: ${JSON.stringify(result1.verification)}`);

    // Test Case 2: Range aperto (Limit)
    // 108 è < 109, deve essere FALSE
    const test2 = "Viale Bruno Buozzi 108";
    console.log(`\n🧪 Test 2: '${test2}' (Range atteso: fuori)`);
    const result2 = validator.analyzeEmailForAddress(test2, "Test");
    console.log(`Risultato: ${result2.verification ? (result2.verification.inParish ? "✅ DENTRO" : "❌ FUORI") : "⚠️  NON TROVATO"}`);


    // Test Case 3: Via Cesare Fracassini (dispari 1+)
    const test3 = "Via Cesare Fracassini 3";
    console.log(`\n🧪 Test 3: '${test3}' (Range atteso: 1-Infinity)`);
    const result3 = validator.analyzeEmailForAddress(test3, "Test");
    console.log(`Risultato: ${result3.verification ? (result3.verification.inParish ? "✅ DENTRO" : "❌ FUORI") : "⚠️  NON TROVATO"}`);

    // Test Case 5: Via Monti Parioli (pari 2-98) - Chiuso
    const test5 = "Via dei Monti Parioli 100";
    console.log(`\n🧪 Test 5: '${test5}' (Range atteso: 2-98, quindi FUORI)`);
    const result5 = validator.analyzeEmailForAddress(test5, "Test");
    console.log(`Risultato: ${result5.verification ? (result5.verification.inParish ? "✅ DENTRO" : "❌ FUORI") : "⚠️  NON TROVATO"}`);
}
