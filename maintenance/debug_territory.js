
function debugTerritoryLogic() {
    const validator = new TerritoryValidator();

    console.log("=== TEST VALIDAZIONE TERRITORIO (Range & Tutti) ===");

    // Test Case 1: Range aperto (Viale Bruno Buozzi dispari: 109+)
    const test1 = "Viale Bruno Buozzi 150";
    console.log(`\n🧪 Test 1: '${test1}' (Range atteso: 109-Infinity)`);
    const result1 = validator.analyzeEmailForAddress(test1, "Test");
    console.log(`Risultato: ${result1.verification ? (result1.verification.inParish ? "✅ DENTRO" : "❌ FUORI") : "⚠️  NON TROVATO"}`);
    console.log(`Dettagli: ${JSON.stringify(result1.verification)}`);

    // Test Case 2: Range 'tutti' specifico (Lungotevere Flaminio: 16-38)
    // Nota: Lungotevere Flaminio nel DB attuale è definito come { tutti: [16, 38] }
    const test2a = "Lungotevere Flaminio 20";
    console.log(`\n🧪 Test 2a: '${test2a}' (Range atteso: 16-38 inclusi)`);
    const result2a = validator.analyzeEmailForAddress(test2a, "Test");
    console.log(`Risultato: ${result2a.verification ? (result2a.verification.inParish ? "✅ DENTRO" : "❌ FUORI") : "⚠️  NON TROVATO"}`);

    const test2b = "Lungotevere Flaminio 50";
    console.log(`\n🧪 Test 2b: '${test2b}' (Fuori range 16-38)`);
    const result2b = validator.analyzeEmailForAddress(test2b, "Test");
    console.log(`Risultato: ${result2b.verification ? (result2b.verification.inParish ? "✅ DENTRO" : "❌ FUORI") : "⚠️  NON TROVATO"}`);

    // Test Case 3: Via Monti Parioli (pari 2-98) - Chiuso
    const test3 = "Via dei Monti Parioli 100";
    console.log(`\n🧪 Test 3: '${test3}' (Range atteso: 2-98, quindi FUORI)`);
    const result3 = validator.analyzeEmailForAddress(test3, "Test");
    console.log(`Risultato: ${result3.verification ? (result3.verification.inParish ? "✅ DENTRO" : "❌ FUORI") : "⚠️  NON TROVATO"}`);
}
