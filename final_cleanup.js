const fs = require('fs');

const FILES = [
    'c:\\Users\\romolo\\OneDrive\\Documenti\\SCRIPT\\GMAIL AUTOMATICA\\GMAIL PARROCCHIA\\exnovoGAS\\gas_prompt_engine.js',
    'c:\\Users\\romolo\\OneDrive\\Documenti\\SCRIPT\\GMAIL AUTOMATICA\\GMAIL PARROCCHIA\\exnovoGAS\\gas_email_processor.js'
];

function toUnicode(str) {
    return str.replace(/[^\x00-\x7F]/g, char => {
        const hex = char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
        return '\\u' + hex;
    });
}

// Special fixes for damaged patterns from previous attempt
const PRE_FIXES = [
    { pattern: /NàO/g, replacement: 'NÃO' },
    { pattern: /à€/g, replacement: 'À' },
    { pattern: /àˆ/g, replacement: 'È' },
    { pattern: /PRIORITà€/g, replacement: 'PRIORITÀ' }
];

function processFile(filePath) {
    console.log(`Processing ${filePath}...`);
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let original = content;

        // 1. Fix damage from previous script
        PRE_FIXES.forEach(fix => {
            content = content.replace(fix.pattern, fix.replacement);
        });

        // 2. Convert ALL non-ASCII to Unicode Escapes
        // This ensures text is pure ASCII and robust against encoding shifts
        content = toUnicode(content);

        if (content !== original) {
            console.log(`  Converting non-ASCII to Unicode escapes...`);
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`  Done.`);
        } else {
            console.log(`  No changes needed.`);
        }
    } catch (err) {
        console.error(`  Error:`, err);
    }
}

FILES.forEach(processFile);
