const fs = require('fs');
const path = require('path');

const FILE = 'gas_request_classifier.js';
const FULL_PATH = path.join(__dirname, '..', FILE);

if (!fs.existsSync(FULL_PATH)) {
    console.error("File not found");
    process.exit(1);
}

let content = fs.readFileSync(FULL_PATH, 'utf8');

// Replace any sequence of ━ (heavy) or ─ (light) longer than 5 chars (with spaces)
// with a standard single line.
const CLEAN_LINE = '────────────────────────────────────────────────────────';

// Regex: match (━|─|\s)+ ensuring at least 5 dashes
// simpler: match lines containing mostly dashes
const lines = content.split('\n');
const newLines = lines.map(line => {
    // If line is mostly dashes (heavy or light)
    if (/^[ \t]*(━|─|\s){5,}[ \t]*$/.test(line)) {
        return CLEAN_LINE;
    }
    // Also fix the case where the dashes are embedded in a return string but might have been messed up
    // But checking line 606 in viewer: it was on its own line (mostly).
    // Actually in the viewer it was part of a template literal.
    // "â” â” ..." was inside backticks.

    // Let's target the specific excessive sequences inside the string
    return line.replace(/(━[\s━]*){10,}/g, CLEAN_LINE)
        .replace(/(─[\s─]*){10,}/g, CLEAN_LINE);
});

content = newLines.join('\n');

fs.writeFileSync(FULL_PATH, content, 'utf8');
console.log(`Classifier cleanup done.`);
