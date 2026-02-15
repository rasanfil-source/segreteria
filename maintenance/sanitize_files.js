const fs = require('fs');

const FILES = [
    'gas_email_processor.js',
    'gas_prompt_engine.js'
];

FILES.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');

    // Strip BOM
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }

    // Remove weird control chars \u0090
    content = content.replace(/\u0090/g, '');

    // Replace unicode box drawings with ASCII to avoid long comment issues or artifacts
    content = content.replace(/\\u2550+/g, '==================================================');
    content = content.replace(/\u2550+/g, '==================================================');

    // Fix specific mojibake escapes
    content = content.replace(/\\u00F0\\u0178\\u201D\\u2019/g, '[LOCK]'); // \u00F0\u0178\u201D\u2019
    content = content.replace(/\\u00F0\\u0178\\u201D\\u201C/g, '[UNLOCK]');

    fs.writeFileSync(file, content, 'utf8');
    console.log(`Sanitized ${file}`);
});
