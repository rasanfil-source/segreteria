
function debugTerritoryLogic() {
    const validator = new TerritoryValidator();
    const text = "Via cancani 2 e via aldrovandi 8 appartengono alla parrocchia?";
    console.log("Input:", text);
    const result = validator.analyzeEmailForAddress(text, "Domanda");
    console.log("Result:", JSON.stringify(result, null, 2));

    // Logica attuale per capire perché fallisce
    const street1 = "Via cancani";
    const normalized1 = validator.normalizeStreetName(street1);
    console.log(`Normalized '${street1}': '${normalized1}'`);
    console.log(`Exists in DB?`, validator.territory[normalized1] ? "YES" : "NO");
}
