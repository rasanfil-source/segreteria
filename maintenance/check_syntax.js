const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function collectJsFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...collectJsFiles(fullPath));
            continue;
        }

        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.js')) continue;
        files.push(fullPath);
    }

    return files;
}

const allJsFiles = collectJsFiles(ROOT);
if (allJsFiles.length === 0) {
    console.error('❌ Nessun file .js trovato');
    process.exit(1);
}

let hasBOM = false;
let hasSyntaxErrors = false;

for (const fullPath of allJsFiles) {
    const relPath = path.relative(ROOT, fullPath);
    const content = fs.readFileSync(fullPath, 'utf8');

    if (content.charCodeAt(0) === 0xFEFF) {
        hasBOM = true;
        console.error(`❌ BOM rilevato: ${relPath}`);
    }

    try {
        new vm.Script(content, { filename: relPath });
    } catch (e) {
        hasSyntaxErrors = true;
        console.error(`❌ Syntax error in ${relPath}: ${e.message}`);
    }
}

if (hasBOM || hasSyntaxErrors) {
    process.exit(1);
}

console.log(`✅ Syntax OK su ${allJsFiles.length} file .js`);
