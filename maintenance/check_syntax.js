const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = 'gas_response_validator.js';
const FULL_PATH = path.join(__dirname, '..', FILE);

if (!fs.existsSync(FULL_PATH)) {
    console.error("File not found");
    process.exit(1);
}

const content = fs.readFileSync(FULL_PATH, 'utf8');

// Check for BOM
if (content.charCodeAt(0) === 0xFEFF) {
    console.log("⚠️ BOM detected at start of file.");
} else {
    console.log("No BOM detected.");
}

// Check syntax
try {
    new vm.Script(content);
    console.log("✅ Syntax OK");
} catch (e) {
    console.error("❌ Syntax Error detected:");
    console.error(e.message);
}
