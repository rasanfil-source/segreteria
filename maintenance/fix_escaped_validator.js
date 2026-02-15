const fs = require('fs');
const path = require('path');

const FILE = 'gas_response_validator.js';
const FULL_PATH = path.join(__dirname, '..', FILE);

if (!fs.existsSync(FULL_PATH)) {
    console.error("File not found");
    process.exit(1);
}

let content = fs.readFileSync(FULL_PATH, 'utf8');

const REPLACEMENTS = [
    // German: grüße -> grÃ¼ÃŸe -> gr\u00C3\u00BC\u00C3\u0178e
    { find: /gr\\u00C3\\u00BC\\u00C3\\u0178e/g, replace: 'grüße' },
    // möchte -> mÃ¶chte -> m\u00C3\u00B6chte
    { find: /m\\u00C3\\u00B6chte/g, replace: 'möchte' },

    // Spanish: querría -> querrÃ­a -> querr\u00C3\u00ADa
    { find: /querr\\u00C3\\u00ADa/g, replace: 'querría' },

    // Portuguese: paróquia -> parÃ³quia -> par\u00C3\u00B3quia
    { find: /par\\u00C3\\u00B3quia/g, replace: 'paróquia' },

    // Generic replacements for singular characters if found elsewhere
    { find: /\\u00C3\\u00BC/g, replace: 'ü' },
    { find: /\\u00C3\\u00B6/g, replace: 'ö' },
    { find: /\\u00C3\\u0084/g, replace: 'Ä' }, // Ã„
    { find: /\\u00C3\\u00A4/g, replace: 'ä' }, // Ã¤
    { find: /\\u00C3\\u0178/g, replace: 'ß' },
    { find: /\\u00C3\\u00B3/g, replace: 'ó' },
    { find: /\\u00C3\\u00AD/g, replace: 'í' },
    { find: /\\u00C3\\u00A1/g, replace: 'á' }, // Ã¡
    { find: /\\u00C3\\u00A7/g, replace: 'ç' }, // Ã§
    { find: /\\u00C3\\u00A3/g, replace: 'ã' }, // Ã£
    { find: /\\u00C3\\u00B5/g, replace: 'õ' }, // Ãµ
    { find: /\\u00C3\\u00B1/g, replace: 'ñ' }  // Ã±
];

let count = 0;
REPLACEMENTS.forEach(r => {
    // console.log("Checking", r.find);
    let newContent = content.replace(r.find, r.replace);
    if (newContent !== content) {
        count++;
        content = newContent;
    }
});

fs.writeFileSync(FULL_PATH, content, 'utf8');
console.log(`Validator patched (escaped sequences). Applied ${count} patterns.`);
