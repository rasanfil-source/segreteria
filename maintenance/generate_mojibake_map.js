const fs = require('fs');

const CHARS = [
    'à', 'è', 'é', 'ì', 'ò', 'ù',
    'À', 'È', 'É', 'Ì', 'Ò', 'Ù',
    '’', '“', '”', '…', '–', '—',
    '✅', '❌', '⚠️', '🔍', '🔒', '📅', '📧',
    '🛑', '✨', '🧠', '🩺', '🚫', '🚨', 'ℹ️', '✓',
    '📦', '🗑️', '📎', '💳', '🧪', '🚀', '⏰', '⏸️',
    '👋', '🤖', '👑', '⛪', '✝️', '🕊️', '📖', '🧭', '🙌'
];

function getMojibake(char) {
    // 1. Get UTF-8 bytes of the char
    const utf8Bytes = Buffer.from(char, 'utf8');

    // 2. Interpret those bytes as CP1252 (Windows-1252) characters
    // We need a CP1252 -> Unicode mapping for the byte values
    let mojibake = '';

    for (const byte of utf8Bytes) {
        if (byte < 128) {
            mojibake += String.fromCharCode(byte);
        } else {
            // Map 0x80-0xFF using CP1252
            // Node 'latin1' handles 0xA0-0xFF 1:1 with unicode U+00A0-U+00FF
            // 0x80-0x9F are controls in latin1, but graphic chars in CP1252
            if (byte >= 0xA0) {
                mojibake += String.fromCharCode(byte);
            } else {
                // CP1252 specific range 0x80-0x9F
                const cp1252map = {
                    0x80: '€', 0x81: ' ', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
                    0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ', 0x8D: ' ', 0x8E: 'Ž', 0x8F: ' ',
                    0x90: ' ', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
                    0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ', 0x9D: ' ', 0x9E: 'ž', 0x9F: 'Ÿ'
                };
                if (cp1252map[byte]) {
                    mojibake += cp1252map[byte];
                } else {
                    // If undefined in CP1252 (e.g. 0x81, 0x8D, 0x8F, 0x90, 0x9D), 
                    // it might have been read as control char or replacement?
                    // Let's assume generic replacement or keep hex?
                    mojibake += '\\x' + byte.toString(16).toUpperCase();
                }
            }
        }
    }
    return mojibake;
}

console.log('const REPLACEMENTS = [');
CHARS.forEach(char => {
    const corrupted = getMojibake(char);
    if (corrupted !== char) {
        // Escape special chars for JS string
        const safeCorrupted = JSON.stringify(corrupted);
        console.log(`  { original: '${char}', corrupted: ${safeCorrupted} },`);
    }
});
console.log('];');
