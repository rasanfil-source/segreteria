const fs = require('fs');

const FILE = path.join(__dirname, '..', 'tests', 'golden_cases.json');

const REPLACEMENTS = [
    { pattern: /Ã¨/g, replacement: 'è' },
    { pattern: /Ã©/g, replacement: 'é' },
    { pattern: /Ã¬/g, replacement: 'ì' },
    { pattern: /Ã²/g, replacement: 'ò' },
    { pattern: /Ã¹/g, replacement: 'ù' },
    { pattern: /NàO/g, replacement: 'NÃO' },
    { pattern: /NÃO/g, replacement: 'NÃO' }, // Ensure normalized
    { pattern: /PRIORITÃ€/g, replacement: 'PRIORITÀ' },
    { pattern: /PRIORITà€/g, replacement: 'PRIORITÀ' },
    { pattern: /PRIORITÃ/g, replacement: 'PRIORITÀ' },
    { pattern: /marÃ§o/g, replacement: 'março' },
    { pattern: /março/g, replacement: 'março' },
    { pattern: /â€¢/g, replacement: '•' },
    { pattern: /â€“/g, replacement: '–' },
    { pattern: /â€”/g, replacement: '—' },
    { pattern: /Ã/g, replacement: 'à' }, // Catch-all for bare Ã -> à (often correct for 'sarÃ ' -> 'sarà ')
    { pattern: /à€/g, replacement: 'À' }  // Fix artifact if Ã€ -> à€
];

console.log(`Processing ${FILE}...`);
try {
    let content = fs.readFileSync(FILE, 'utf8');
    let original = content;

    REPLACEMENTS.forEach(r => {
        content = content.replace(r.pattern, r.replacement);
    });

    // Also unicode escape everything non-ASCII in JSON strings to be safe?
    // JSON handles unicode fine, but let's stick to UTF-8 characters if possible, 
    // or escapes if we want to be super safe. 
    // For readability, UTF-8 'à' is better than '\u00E0' in JSON.
    // But since my source code now uses '\u00E0', the `prompt` string will contain 'à' (because JS string literal `\u00E0` evaluates to `à`).
    // So golden json should contain `à`.

    if (content !== original) {
        console.log(`Writing changes...`);
        fs.writeFileSync(FILE, content, 'utf8');
        console.log(`Done.`);
    } else {
        console.log(`No changes needed.`);
    }

} catch (err) {
    console.error(err);
}
