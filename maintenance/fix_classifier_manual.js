const fs = require('fs');
const path = require('path');

const FILE = 'gas_request_classifier.js';
const FULL_PATH = path.join(__dirname, '..', FILE);

if (!fs.existsSync(FULL_PATH)) {
    console.error("File not found");
    process.exit(1);
}

let content = fs.readFileSync(FULL_PATH, 'utf8');

const REPLACEMENTS = [
    // Box drawing heavy horizontal: ━ -> â” (0xE2 0x94 0x81)
    // The viewer showed "â” " (space?).
    // Let's replace the whole sequence of "â” â” ..." with a clean line of "━━━" or "───".
    // Since it's a separator, "━" or "─" is fine.
    { find: /(â”\s?)+/g, replace: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' },

    // Cross Mark: ❌ -> â Œ (0xE2 0x9D 0x8C)
    // 0x9D is often unmapped or ' '.
    { find: /â\s?Œ/g, replace: '❌' },
    { find: /â\u009DŒ/g, replace: '❌' }, // Just in case 0x9D is there

    // Check mark: ✅ -> âœ… (0xE2 0x9C 0x85) -> "âœ…"
    { find: /âœ…/g, replace: '✅' },

    // Target: 🎯 -> ðŸŽ¯ (0xF0 0x9F 0x8E 0xAF) -> "ðŸŽ¯"
    { find: /ðŸŽ¯/g, replace: '🎯' },

    // Scales: ⚖️ -> âš–ï¸ (0xE2 0x9A 0x96 0xEF 0xB8 0x8F)
    { find: /âš–ï¸/g, replace: '⚖️' },

    // Pencil: ✏️ -> âœ ï¸ (0xE2 0x9C 0x8F 0xEF 0xB8 0x8F)
    { find: /âœ\s?ï¸/g, replace: '✏️' }
];

let count = 0;
REPLACEMENTS.forEach(r => {
    let newContent = content.replace(r.find, r.replace);
    if (newContent !== content) {
        count++;
        content = newContent;
    }
});

fs.writeFileSync(FULL_PATH, content, 'utf8');
console.log(`Classifier patched. Applied ${count} patterns.`);
