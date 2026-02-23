const fs = require('fs');
const path = require('path');

const FILES = [
    'gas_classifier.js',
    'gas_config.example.js',
    'gas_email_processor.js',
    'gas_error_types.js',
    'gas_gemini_service.js',
    'gas_gmail_service.js',
    'gas_logger.js',
    'gas_main.js',
    'gas_memory_service.js',
    'gas_prompt_context.js',
    'gas_prompt_engine.js',
    'gas_rate_limiter.js',
    'gas_request_classifier.js',
    'gas_response_validator.js',
    'gas_territory_validator.js',
    'gas_unit_tests.js'
];

const CHARS = [
    'à', 'è', 'é', 'ì', 'ò', 'ù',
    'À', 'È', 'É', 'Ì', 'Ò', 'Ù',
    'á', 'í', 'ó', 'ú', 'ñ', 'Ñ', 'ü', 'Ü', 'ß', 'ö', 'Ö', 'ä', 'Ä', 'ç', 'Ç', 'ã', 'õ',
    '’', '“', '”', '…', '–', '—',
    '✅', '❌', '⚠️', '🔍', '🔒', '🔓', '📅', '📧',
    '🛑', '✨', '🧠', '🩺', '🚫', '🚨', 'ℹ️', '✓',
    '📦', '🗑️', '📎', '💳', '🧪', '🚀', '⏰', '⏸️',
    '👋', '🤖', '👑', '⛪', '✝️', '🕊️', '📖', '🧭', '🙌',
    '🔧', '⚙️', '📈', '📊', '📉', '📑', '📝', '📂',
    '📁', '🗂️', '🗃️', '🗳️', '📫', '📪', '📬', '📭',
    '🎯', '⚖️', '✏️', '🗣️', '💭', '💡', '📢', '💬',
    '═', '║', '╔', '╗', '╚', '╝', '╠', '╣', '╦', '╩', '╬',
    '━', '┃', '┏', '┓', '┗', '┛', '┣', '┫', '┳', '┻', '╋',
    '─', '│', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼'
];

// Helper to generate CP1252-corrupted string for a char
function getMojibake(char) {
    const utf8Bytes = Buffer.from(char, 'utf8');
    let mojibake = '';

    for (const byte of utf8Bytes) {
        if (byte < 128) {
            mojibake += String.fromCharCode(byte);
        } else {
            if (byte >= 0xA0) {
                mojibake += String.fromCharCode(byte);
            } else {
                const cp1252map = {
                    0x80: '€', 0x81: ' ', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
                    0x88: 'ˆ', 0x89: '‰', 0x8A: 'Š', 0x8B: '‹', 0x8C: 'Œ', 0x8D: ' ', 0x8E: 'Ž', 0x8F: ' ',
                    0x90: ' ', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
                    0x98: '˜', 0x99: '™', 0x9A: 'š', 0x9B: '›', 0x9C: 'œ', 0x9D: ' ', 0x9E: 'ž', 0x9F: 'Ÿ'
                };
                if (cp1252map[byte]) {
                    mojibake += cp1252map[byte];
                } else {
                    // If unmapped, use hex escape to match possible literal? 
                    // Or assume it's lost. For now, skip unmappable.
                }
            }
        }
    }
    return mojibake;
}

// Generate replacements map
const REPLACEMENTS = [];
CHARS.forEach(char => {
    const corrupted = getMojibake(char);
    if (corrupted && corrupted !== char) {
        // Sort by length descending to replace longest matches first? 
        // Actually, single chars usually produce 2-4 chars mojibake.
        REPLACEMENTS.push({ original: char, corrupted: corrupted });
    }
});

// Sort replacements by length of corrupted string (descending) to avoid partial matches
REPLACEMENTS.sort((a, b) => b.corrupted.length - a.corrupted.length);

console.log(`Generated ${REPLACEMENTS.length} replacement patterns.`);

function fixFile(filePath) {
    const fullPath = path.join(__dirname, '..', filePath);
    if (!fs.existsSync(fullPath)) {
        console.log(`Skipping missing: ${filePath}`);
        return;
    }

    let content = fs.readFileSync(fullPath, 'utf8');
    let originalContent = content;
    let count = 0;

    REPLACEMENTS.forEach(r => {
        // Escape for regex? Or use simple replaceAll?
        // replaceAll matches literal string.
        let parts = content.split(r.corrupted);
        if (parts.length > 1) {
            count += parts.length - 1;
            content = parts.join(r.original);
        }
    });

    if (content !== originalContent) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`[Fixed] ${filePath}: Replaced ${count} occurrences.`);
    } else {
        console.log(`[Clean] ${filePath}`);
    }
}

console.log("Starting targeted restoration...");
FILES.forEach(fixFile);
console.log("Done.");
