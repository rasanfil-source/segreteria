const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'gas_response_validator.js');

const REPLACEMENTS = [
    // Emojis (double-slash needed because it matches the literal '\u' in the file string)
    { pattern: /\\u2705/g, replacement: '✅' },
    { pattern: /\\uD83D\\uDD0D/g, replacement: '🔍' },
    { pattern: /\\u2713/g, replacement: '✓' },
    { pattern: /\\u26A0\\uFE0F/g, replacement: '⚠️' },
    { pattern: /\\u26A0/g, replacement: '⚠️' },
    { pattern: /\\uD83E\\uDE79/g, replacement: '🩺' },
    { pattern: /\\u2728/g, replacement: '✨' },
    { pattern: /\\uD83D\\uDEAB/g, replacement: '🚫' },
    { pattern: /\\uD83E\\uDDE0/g, replacement: '🧠' },
    { pattern: /\\u274C/g, replacement: '❌' },
    { pattern: /\\uD83D\\uDEA8/g, replacement: '🚨' },

    // Accented Vowels (LowerCase)
    { pattern: /\\u00E0/g, replacement: 'à' },
    { pattern: /\\u00E8/g, replacement: 'è' },
    { pattern: /\\u00E9/g, replacement: 'é' },
    { pattern: /\\u00EC/g, replacement: 'ì' },
    { pattern: /\\u00F2/g, replacement: 'ò' },
    { pattern: /\\u00F9/g, replacement: 'ù' },

    // Accented Vowels (UpperCase)
    { pattern: /\\u00C0/g, replacement: 'À' },
    { pattern: /\\u00C8/g, replacement: 'È' },
    { pattern: /\\u00C9/g, replacement: 'É' },
    { pattern: /\\u00CC/g, replacement: 'Ì' },
    { pattern: /\\u00D2/g, replacement: 'Ò' },
    { pattern: /\\u00D9/g, replacement: 'Ù' },

    // Other
    { pattern: /\\u00E7/g, replacement: 'ç' },
    { pattern: /\\u00E3/g, replacement: 'ã' }
];

console.log(`Restoring visuals in ${FILE}...`);
try {
    let content = fs.readFileSync(FILE, 'utf8');
    let original = content;

    REPLACEMENTS.forEach(fix => {
        content = content.replace(fix.pattern, fix.replacement);
    });

    if (content !== original) {
        fs.writeFileSync(FILE, content, 'utf8');
        console.log(`  Restored emojis and accents.`);
    } else {
        console.log(`  No changes needed.`);
    }
} catch (err) {
    console.error(`  Error:`, err);
}
