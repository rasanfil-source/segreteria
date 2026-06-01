const fs = require('fs');
const path = require('path');

const FILE = 'gas_response_validator.js';
const FULL_PATH = path.join(__dirname, '..', FILE);

if (!fs.existsSync(FULL_PATH)) {
    console.error("File not found");
    process.exit(1);
}

// Legge come buffer per vedere i byte grezzi
let buffer = fs.readFileSync(FULL_PATH);

const firstBytes = Array.from(buffer.subarray(0, 3)).map(byte => byte.toString(16));
console.log("First bytes:", firstBytes.length ? firstBytes.join(' ') : '(empty file)');

// Controllo per UTF-8 BOM: EF BB BF
if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    console.log("BOM detected. Removing...");
    // Rimuove i primi 3 byte
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
    // Forse non è un BOM ma un carattere spazzatura?
    // Controllo se il primo carattere non è ASCII standard
    const text = buffer.toString('utf8');
    if (text && text.charCodeAt(0) === 65279) { // 0xFEFF
        console.log("Zero Width No-Break Space detected (BOM char) at index 0. Removing...");
        fs.writeFileSync(FULL_PATH, text.substring(1), 'utf8');
    } else {
        console.log("No standard BOM bytes found.");
        // Se node -c fallisce su \uFEFF, forse è letteralmente la stringa "\uFEFF"?
        if (text && text.startsWith('\\uFEFF')) {
            console.log("Found leading literal string '\\uFEFF'. Removing...");
            fs.writeFileSync(FULL_PATH, text.substring('\\uFEFF'.length), 'utf8');
        }
    }
}
