const fs = require('fs');

const PROCESSOR = 'gas_email_processor.js';
const PROMPT = 'gas_prompt_engine.js';

function fixProcessor() {
    console.log(`Fixing ${PROCESSOR}...`);
    let content = fs.readFileSync(PROCESSOR, 'utf8');

    // Strip BOM
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

    // Fix regex marÃ§o / março --> mar\u00E7o
    // We use a regex that matches both if possible, or just replace exact strings
    content = content.replace(/marÃ§o/g, 'mar\\u00E7o');
    content = content.replace(/março/g, 'mar\\u00E7o');

    // Fix JSDoc
    const oldDoc = '* - Salutation mode (full/soft/none_or_continuity)';
    const newDoc = '* - Salutation mode (full/soft/none_or_continuity/session)';
    if (content.includes(oldDoc)) {
        content = content.replace(oldDoc, newDoc);
    } else {
        console.log("  Warning: JSDoc string not found.");
    }

    fs.writeFileSync(PROCESSOR, content, 'utf8');
}

function fixPrompt() {
    console.log(`Fixing ${PROMPT}...`);
    let content = fs.readFileSync(PROMPT, 'utf8');

    // Strip BOM
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

    // Fix PRIORITÀ
    // Cover various mojibake forms
    content = content.replace(/PRIORITÃ€/g, 'PRIORIT\\u00C0');
    content = content.replace(/PRIORITÀ/g, 'PRIORIT\\u00C0');

    // Fix già
    content = content.replace(/giÃ /g, 'gi\\u00E0');
    content = content.replace(/già/g, 'gi\\u00E0');

    // Fix NON / NÃO
    content = content.replace(/NÃ O/g, 'N\\u00C3O');
    content = content.replace(/NàO/g, 'N\\u00C3O');
    content = content.replace(/NÃO/g, 'N\\u00C3O');

    // Fix è
    content = content.replace(/Ã¨/g, '\\u00E8');

    // Fix é
    content = content.replace(/Ã©/g, '\\u00E9');

    // Fix ì
    content = content.replace(/Ã¬/g, '\\u00EC');

    // Fix ò
    content = content.replace(/Ã²/g, '\\u00F2');

    // Fix ù
    content = content.replace(/Ã¹/g, '\\u00F9');

    // Fix dots ...
    content = content.replace(/â€¦/g, '...');

    // Fix bullet
    content = content.replace(/â€¢/g, '\\u2022');

    fs.writeFileSync(PROMPT, content, 'utf8');
}

fixProcessor();
fixPrompt();
