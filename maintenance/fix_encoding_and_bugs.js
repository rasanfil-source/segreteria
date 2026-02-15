const fs = require('fs');
const path = require('path');

const FILES = [
    path.join(__dirname, '..', 'gas_prompt_engine.js'),
    path.join(__dirname, '..', 'gas_email_processor.js')
];

const REPLACEMENTS = [
    // Common UTF-8 interpreted as Latin-1/Windows-1252
    { pattern: /Ã¨/g, replacement: 'è' },
    { pattern: /Ã©/g, replacement: 'é' },
    { pattern: /Ã /g, replacement: 'à' }, // C3 A0 -> Ã + nbsp/space
    { pattern: /Ã¬/g, replacement: 'ì' },
    { pattern: /Ã²/g, replacement: 'ò' },
    { pattern: /Ã¹/g, replacement: 'ù' },
    { pattern: /Ã/g, replacement: 'à' }, // Fallback for bare Ã related to à if not matched above (risky but often C3 A0 becomes Ã + char)

    // Symbols
    { pattern: /â€™/g, replacement: '’' },
    { pattern: /â€œ/g, replacement: '“' },
    { pattern: /â€\u009D/g, replacement: '”' }, // E2 80 9D
    { pattern: /â€¢/g, replacement: '•' },
    { pattern: /â€“/g, replacement: '–' },
    { pattern: /â€”/g, replacement: '—' },

    // Specific broken words seen in logs
    { pattern: /PERCHÃ/g, replacement: 'PERCHÉ' },
    { pattern: /PERCHÃ‰/g, replacement: 'PERCHÉ' },
    { pattern: /Ã‰/g, replacement: 'É' },
    { pattern: /CISÃ’/g, replacement: 'CISÒ' }, // If any
    { pattern: /piÃ¹/g, replacement: 'più' },
    { pattern: /giÃ /g, replacement: 'già' },
    { pattern: /giÃ/g, replacement: 'già' },

    // Box drawing characters (approximate detection, might need specific sequences)
    // ══ -> E2 95 90 
    // If interpreted as Latin1: â•
    { pattern: /â•/g, replacement: '═' },
];

function fixFile(filePath) {
    console.log(`Processing ${filePath}...`);
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let original = content;

        // 1. General Mojibake Fix
        REPLACEMENTS.forEach(r => {
            content = content.replace(r.pattern, r.replacement);
        });

        // 2. Specific Fixes for gas_email_processor.js
        if (filePath.endsWith('gas_email_processor.js')) {
            // Regex Fix: marÃ§o -> mar\u00E7o
            content = content.replace(/marÃ§o/g, 'mar\\u00E7o');
            content = content.replace(/março/g, 'mar\\u00E7o'); // Safety: unify to unicode escape

            // SalutationMode Contract Fix
            content = content.replace(
                /\* - Salutation mode \(full\/soft\/none_or_continuity\)/g,
                '* - Salutation mode (full/soft/none_or_continuity/session)'
            );
        }

        if (content !== original) {
            console.log(`  Writing changes to ${filePath}...`);
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`  Done.`);
        } else {
            console.log(`  No changes needed for ${filePath}.`);
        }
    } catch (err) {
        console.error(`  Error processing ${filePath}:`, err);
    }
}

FILES.forEach(fixFile);
