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
// Expected: "Via Milano 20  A" -> "20A"
// Current Bug: "Via Milano 20  A" -> "20 A" (only first whitespace removed if implementation is incomplete) -> ACTUALLY logic was replace(/\s+/, '') so it removes ONE sequence.
// If input is "20 A", replace(/\s+/, '') -> "20A".
// If input is "20  A", replace(/\s+/, '') -> "20A".
// Wait, replace(/\s+/, '') removes THE FIRST MATCH of one or more spaces.
// So "20   A" becomes "20A". Correct.
// But "20 A B" would become "20AB"? No, "20AB".
// Let's test deeper: "20 A  B" -> "20A  B".
// The user report says: "replace(/\s+/, '') non usa flag globale".
// So if civic pattern catches "10 A B", it becomes "10AB" only if global flag is used?
// Let's try to feed a civic with multiple separate spaces if the regex allows it.
// The regex usually is like \d+\s*[a-zA-Z]* or something similar.
// If the regex captures "10 A B", then we have a problem.

// Let's assume the capture group 3 is the civic.
// We need to see what the regex is in `_addressPatterns` (which is compiled in constructor).
// But we can test `fullCivic` logic indirectly via extraction.

const text2 = "Abito in Via Napoli 5   B";
const addresses2 = validator.extractAddressFromText(text2);
if (addresses2 && addresses2.length > 0) {
    console.log(`Via Napoli 5   B -> fullCivic: '${addresses2[0].fullCivic}'`);
    assertCivicBug(addresses2[0].fullCivic === '5B', `Expected '5B', got '${addresses2[0].fullCivic}'`);
}

// Case with multiple space groups if possible?
// E.g. "10 A B" - if regex allows it.
// Assuming simple case first.
