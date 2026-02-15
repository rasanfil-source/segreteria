const fs = require('fs');
const path = require('path');

const FILE = 'gas_response_validator.js';
const FULL_PATH = path.join(__dirname, '..', FILE);

if (!fs.existsSync(FULL_PATH)) {
    console.error("File not found");
    process.exit(1);
}

// Read as buffer to see raw bytes
let buffer = fs.readFileSync(FULL_PATH);

console.log("First 3 bytes:", buffer[0].toString(16), buffer[1].toString(16), buffer[2].toString(16));

// Check for UTF-8 BOM: EF BB BF
if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    console.log("BOM detected. Removing...");
    // Slice off the first 3 bytes
    const newBuffer = buffer.subarray(3);
    fs.writeFileSync(FULL_PATH, newBuffer);
    console.log("BOM removed.");
} else if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
    console.log("UTF-16 BE BOM detected? Removing...");
    const newBuffer = buffer.subarray(2);
    fs.writeFileSync(FULL_PATH, newBuffer);
} else if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    console.log("UTF-16 LE BOM detected? Removing...");
    const newBuffer = buffer.subarray(2);
    fs.writeFileSync(FULL_PATH, newBuffer);
} else {
    // Maybe it's not a BOM but a garbage char?
    // Let's check if the first char is not standard ASCII
    const text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 65279) { // 0xFEFF
        console.log("Zero Width No-Break Space detected (BOM char) at index 0. Removing...");
        fs.writeFileSync(FULL_PATH, text.substring(1), 'utf8');
    } else {
        console.log("No standard BOM bytes found.");
        // If node -c failed on \uFEFF, maybe it's literally the string "\uFEFF"?
        if (text.startsWith('\\uFEFF')) {
            console.log("Found literal string '\\uFEFF'. Removing...");
            fs.writeFileSync(FULL_PATH, text.replace(/^\\uFEFF/, ''), 'utf8');
        }
    }
}
