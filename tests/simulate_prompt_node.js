const fs = require('fs');
const path = require('path');

// MOCKS
global.Utilities = {
    formatDate: (date, tz, format) => new Date(date).toISOString().split('T')[0]
};

global.createLogger = (name) => ({
    info: (msg, meta) => { },
    warn: (msg, meta) => console.log(`[WARN] ${msg}`, meta || ''),
    error: (msg, meta) => console.error(`[ERROR] ${msg}`, meta || '')
});

global.CONFIG = {
    MAX_SAFE_TOKENS: 100000
};

console.log("--- STARTING PROMPT SIMULATION v2 ---");

try {
    const gasScriptPath = path.join(__dirname, '../gas_prompt_engine.js');
    if (!fs.existsSync(gasScriptPath)) {
        throw new Error(`File not found: ${gasScriptPath}`);
    }

    let scriptContent = fs.readFileSync(gasScriptPath, 'utf8');

    // Inject Export to Global to ensure visibility
    scriptContent += "\n; global.PromptEngine = PromptEngine;";

    console.log("Files loaded. Executing Eval...");

    // EXECUTE
    eval(scriptContent);

    if (typeof global.PromptEngine === 'undefined') {
        throw new Error("PromptEngine class is UNDEFINED after eval!");
    }

    console.log("Instantiating PromptEngine...");
    const engine = new global.PromptEngine();

    console.log("Building Prompt...");
    const prompt = engine.buildPrompt({
        emailContent: "Salve, vorrei sapere se ci sono ancora posti per il pellegrinaggio a Santiago 2026. Michela",
        emailSubject: "Info Santiago",
        senderName: "Michela",
        knowledgeBase: "Il pellegrinaggio a Santiago 2026 è completo. Lista d'attesa aperta.",
        promptProfile: 'heavy',
        salutationMode: 'full'
    });

    console.log("---------------------------------------------------");
    console.log("VERIFICATION RESULTS:");
    console.log("---------------------------------------------------");

    let success = true;
    const rules = [
        { id: 1, text: "RISPONDI SOLO A QUANTO CHIESTO", strict: true },
        { id: 2, text: "DIVIETO DI INFODUMPING", strict: true },
        { id: 3, text: "LOOP \"CONTATTACI\"", strict: true },
        { id: 4, text: "INTEGRAZIONE, NON ECO", strict: true }
    ];

    rules.forEach(rule => {
        if (prompt.includes(rule.text)) {
            console.log(`✅ CHECK ${rule.id} PASS: ${rule.text}`);
        } else {
            console.log(`❌ CHECK ${rule.id} FAIL: ${rule.text}`);
            success = false;
        }
    });

    if (success) {
        console.log("\n✨ ALL CHECKS PASSED");
    } else {
        console.log("\n💀 SOME CHECKS FAILED");
        process.exit(1);
    }

} catch (e) {
    console.error("\n\nAAAAAAAAAAAAAAAA CRITICAL ERROR AAAAAAAAAAAAAAAA");
    console.error(e.message);
    console.error(e.stack);
    console.error("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n\n");
    process.exit(1);
}
