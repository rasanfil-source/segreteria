const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'gas_response_validator.js');

function toUnicode(str) {
    return str.replace(/[^\x00-\x7F]/g, char => {
        const hex = char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
        return '\\u' + hex;
    });
}

const PRE_FIXES = [
    // Accented vowels (Double encoding fixes)
    { pattern: /Ã\u00A0/g, replacement: '\u00E0' }, // à (Ã + NBSP)
    { pattern: /Ã\u0080/g, replacement: '\u00C0' }, // À

    { pattern: /Ã¨/g, replacement: '\u00E8' }, // è
    { pattern: /Ã\u0088/g, replacement: '\u00C8' }, // È

    { pattern: /Ã©/g, replacement: '\u00E9' }, // é
    { pattern: /Ã\u0089/g, replacement: '\u00C9' }, // É

    { pattern: /Ã¬/g, replacement: '\u00EC' }, // ì
    { pattern: /Ã\u008C/g, replacement: '\u00CC' }, // Ì

    { pattern: /Ã²/g, replacement: '\u00F2' }, // ò
    { pattern: /Ã\u0092/g, replacement: '\u00D2' }, // Ò

    { pattern: /Ã¹/g, replacement: '\u00F9' }, // ù
    { pattern: /Ã\u0099/g, replacement: '\u00D9' }, // Ù

    // Already escaped sequences from previous run (fixing the fix)
    { pattern: /\\u00C3\\u00A0/g, replacement: '\u00E0' }, // à
    { pattern: /\\u00C3\\u0080/g, replacement: '\u00C0' }, // À
    { pattern: /\\u00C3\\u00A8/g, replacement: '\u00E8' }, // è
    { pattern: /\\u00C3\\u0088/g, replacement: '\u00C8' }, // È
    { pattern: /\\u00C3\\u00A9/g, replacement: '\u00E9' }, // é
    { pattern: /\\u00C3\\u0089/g, replacement: '\u00C9' }, // É
    { pattern: /\\u00C3\\u00AC/g, replacement: '\u00EC' }, // ì
    { pattern: /\\u00C3\\u008C/g, replacement: '\u00CC' }, // Ì
    { pattern: /\\u00C3\\u00B2/g, replacement: '\u00F2' }, // ò
    { pattern: /\\u00C3\\u0092/g, replacement: '\u00D2' }, // Ò
    { pattern: /\\u00C3\\u00B9/g, replacement: '\u00F9' }, // ù
    { pattern: /\\u00C3\\u0099/g, replacement: '\u00D9' }, // Ù

    // Formatting chars
    { pattern: /âœ…/g, replacement: '\u2705' }, // ✅
    { pattern: /check/g, replacement: '\u2705' }, // Fallback

    // Fix existing Unicode escapes regarding emojis if they were double-escaped or corrupted
    { pattern: /ðŸ”/g, replacement: '\uD83D\uDD0D' }, // 🔍
    { pattern: /âœ“/g, replacement: '\u2713' }, // ✓
    { pattern: /âš ï¸/g, replacement: '\u26A0\uFE0F' }, // ⚠️
    { pattern: /âš /g, replacement: '\u26A0' }, // ⚠️ (variant)
    { pattern: /ðŸ©¹/g, replacement: '\uD83E\uDE79' }, // 🩺 (tentativo perfezionamento)
    { pattern: /âœ¨/g, replacement: '\u2728' }, // ✨
    { pattern: /ðŸš«/g, replacement: '\uD83D\uDEAB' }, // 🚫
    { pattern: /ðŸ§ /g, replacement: '\uD83E\uDDE0' }, // 🧠
    { pattern: /â Œ/g, replacement: '\u274C' }, // ❌
    { pattern: /ðŸš¨/g, replacement: '\uD83D\uDEA8' }, // 🚨

    // Quotes / Punctuation
    { pattern: /â\x80\x9C/g, replacement: '"' }, // “
    { pattern: /â\x80\x9D/g, replacement: '"' }, // ”

    // Fix specific Portuguese/Other remnants from previous mojibake
    { pattern: /Ã§/g, replacement: '\u00E7' }, // ç
    { pattern: /Ã£/g, replacement: '\u00E3' }, // ã
];

console.log(`Processing ${FILE}...`);
try {
    let content = fs.readFileSync(FILE, 'utf8');
    let original = content;

    // 1. Fix known patterns
    PRE_FIXES.forEach(fix => {
        content = content.replace(fix.pattern, fix.replacement);
    });

    // 2. Convert ALL remaining non-ASCII to Unicode Escapes
    content = toUnicode(content);

    if (content !== original) {
        console.log(`  Fixed encoding and converted to Unicode escapes.`);
        fs.writeFileSync(FILE, content, 'utf8');
        console.log(`  Done.`);
    } else {
        console.log(`  No changes needed.`);
    }
} catch (err) {
    console.error(`  Error:`, err);
}
