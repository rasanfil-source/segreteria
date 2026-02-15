/**
 * reproduce_civic_bug.js
 * Script Node.js per riprodurre bug civico - NON eseguire su GAS.
 * Wrappato in guard per evitare errori in ambiente GAS.
 */
if (typeof require !== 'undefined') {

    const fs = require('fs');
    const vm = require('vm');

    function loadScript(path) {
        const code = fs.readFileSync(path, 'utf8');
        const context = { console: console };
        vm.createContext(context);
        vm.runInContext(code, context, { filename: path });
        return context;
    }

    // Helper to instantiate class from context
    function createValidator(context) {
        return vm.runInContext('new TerritoryValidator()', context);
    }

    function assertCivicBug(condition, message) {
        if (!condition) {
            console.error(`❌ FAIL: ${message}`);
            process.exit(1);
        } else {
            console.log(`✅ PASS: ${message}`);
        }
    }

    console.log('--- Reproduction Test: Civic Deduplication and Normalization ---');

    const context = loadScript('gas_territory_validator.js');
    const validator = createValidator(context);

    // TEST 1: Deduplication logic
    // Expected: "Via Roma 10A" and "Via Roma 10B" should both be detected as distinct addresses.
    // Current Bug: "Via Roma 10B" is ignored because it matches base civic 10 of "Via Roma 10A".
    const text = "Abitiamo in Via Roma 10A e anche in Via Roma 10B.";
    const addresses = validator.extractAddressFromText(text);

    console.log("Extracted addresses:", JSON.stringify(addresses, null, 2));

    assertCivicBug(addresses && addresses.length === 2,
        `Expected 2 addresses, found ${addresses ? addresses.length : 0}`);

    if (addresses && addresses.length === 2) {
        assertCivicBug(addresses[0].fullCivic === '10A', 'First address should be 10A');
        assertCivicBug(addresses[1].fullCivic === '10B', 'Second address should be 10B');
    }

    // TEST 2: Whitespace Normalization
    const text2 = "Abito in Via Napoli 5   B";
    const addresses2 = validator.extractAddressFromText(text2);
    if (addresses2 && addresses2.length > 0) {
        console.log(`Via Napoli 5   B -> fullCivic: '${addresses2[0].fullCivic}'`);
        assertCivicBug(addresses2[0].fullCivic === '5B', `Expected '5B', got '${addresses2[0].fullCivic}'`);
    }

} // fine guard typeof require
