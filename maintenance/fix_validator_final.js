const fs = require('fs');
const path = require('path');

const FILE = 'gas_response_validator.js';
const FULL_PATH = path.join(__dirname, '..', FILE);

if (!fs.existsSync(FULL_PATH)) {
    console.error("File not found");
    process.exit(1);
}

let content = fs.readFileSync(FULL_PATH, 'utf8');

// Manual mapping based on view_file output
const REPLACEMENTS = [
    // German
    { corrupted: /grÃ¼ÃŸe/g, original: 'grüße' }, // Ã¼ -> ü, ÃŸ -> ß
    { corrupted: /mÃ¶chte/g, original: 'möchte' }, // Ã¶ -> ö

    // Spanish
    { corrupted: /querrÃ­a/g, original: 'querría' }, // Ã­ (0xAD = Soft Hyphen?)
    // Note: The previous view_file showed \u00AD. UTF-8 C3 AD. AD is Soft Hyphen.
    // In regex literal, 'Ã\xAD' might work if we match bytes.
    // Let's rely on the string "querr" + anything + "a" if unsafe, but better be precise.
    // "querr" + \u00C3\u00AD + "a"

    // Portuguese
    { corrupted: /parÃ³quia/g, original: 'paróquia' }, // Ã³ -> ó

    // Catch-all for common ones if missed
    { corrupted: /Ã¼/g, original: 'ü' },
    { corrupted: /Ã¶/g, original: 'ö' },
    { corrupted: /Ã¤/g, original: 'ä' },
    { corrupted: /ÃŸ/g, original: 'ß' },
    { corrupted: /Ã³n/g, original: 'ón' },
    { corrupted: /Ã³/g, original: 'ó' },
    { corrupted: /Ã­/g, original: 'í' }, // Ã + Soft Hyphen
    { corrupted: /Ã\xAD/g, original: 'í' }
];

let count = 0;
REPLACEMENTS.forEach(r => {
    let newContent = content.replace(r.corrupted, r.original);
    if (newContent !== content) {
        // Count rough occurrences
        // simple replace with regex /g already did all
        // check diff length?
        count++;
        content = newContent;
    }
});

fs.writeFileSync(FULL_PATH, content, 'utf8');
console.log(`Validator patched. Applied ${count} patterns.`);
