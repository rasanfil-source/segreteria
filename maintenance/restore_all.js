const fs = require('fs');
const path = require('path');

// Target files to check and fix
const FILES = [
    'gas_email_processor.js',
    'gas_gmail_service.js',
    'gas_prompt_engine.js',
    'gas_main.js'
];

// CP1252 (Windows-1252) Reverse Mapping for 0x80-0x9F range
// These characters in the file mean the byte was in 0x80-0x9F range
const CP1252_REVERSE = {
    '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
    'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E,
    '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
    '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
    // Byte CP1252 "undefined" in 0x80-0x9F: mappati a caratteri di controllo distinti.
    '': 0x81, '': 0x8D, '': 0x8F, '': 0x90, '': 0x9D
};

function fixEncoding(filePath) {
    const fullPath = path.join(__dirname, '..', filePath);
    if (!fs.existsSync(fullPath)) {
        console.log(`Skipping missing file: ${filePath}`);
        return;
    }

    const content = fs.readFileSync(fullPath, 'utf8');

    // Heuristic: If we convert to bytes using CP1252 reverse map, 
    // and then read as UTF-8, does it look valid?

    // Qui la dimensione su content.length è voluta: ricostruiamo byte CP1252 (1 byte per code unit trattata).
    // Il buffer viene comunque tagliato con slice(0, bufIdx) prima della scrittura.
    const buffer = Buffer.alloc(content.length);
    let bufIdx = 0;

    let needsFix = false;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        const code = char.charCodeAt(0);

        if (code < 0x80) {
            buffer[bufIdx++] = code;
        } else if (Object.prototype.hasOwnProperty.call(CP1252_REVERSE, char)) {
            buffer[bufIdx++] = CP1252_REVERSE[char];
            needsFix = true;
        } else if (code >= 0xA0 && code <= 0xFF) {
            // Latin-1 Supplement 1:1 mapping in CP1252
            buffer[bufIdx++] = code;
            needsFix = true;
        } else {
            // Characters > 0xFF mean they were NOT part of a single-byte CP1252 interpretation
            // OR the file is already correct UTF-8 mixed with garbage?
            // If we see a true Unicode char (like '✅' U+2705), it wasn't formed by single-byte corruption.
            // UNLESS it was somehow double-double encoded?

            // For safety: If we encounter a char > 0xFF that isn't in our reverse map, 
            // it implies the current strategy (Reverse CP1252) might break strictly valid Unicode chars 
            // that were ADDED after corruption.

            // BUT: The corruption creates 'Ã' (U+00C3) and '¨' (U+00A8) which are < 0xFF.
            // The emoji parts 'ð' (U+00F0), 'Ÿ' (U+0178 - handled), '”' (U+201D - handled).

            // If we encounter something unmapped, we just copy the char? No, we can't put >0xFF into a byte buffer.
            // This suggests the file is MIXED (some corrupted, some valid).
            // But usually it's fully one way.

            // Let's assume strict reconstruction. If we hit a high char not in map, warn.
            console.error(`[${filePath}] ERRORE: Char '${char}' (U+${code.toString(16).toUpperCase()}) non mappabile in CP1252. File saltato per evitare corruzione.`);
            return { fixed: false, reason: `Contains high-char '${char}'` };
        }
    }

    if (!needsFix) {
        console.log(`[${filePath}] No CP1252 artifacts detected.`);
        return { fixed: false };
    }

    // Nota: convertiamo in UTF-8 (non latin1) perché stiamo ricostruendo byte CP1252 corrotti
    // che rappresentano un testo UTF-8 originario.
    // Slice buffer to actual used length
    const finalBuffer = buffer.slice(0, bufIdx);

    // Decode as UTF-8
    try {
        const fixedContent = finalBuffer.toString('utf8');

        // Sanity Check: Does it look better?
        // Check for common mojibake result patterns (Ã followed by space/supplements)
        // If the 'fixed' string STILL has 'Ã', maybe we failed? 
        // No, 'à' is 0xC3 0xA0. 
        // If we fixed it, we should see 'à'.
        // Nota: la scrittura è intenzionalmente condizionata.
        // Se non miglioriamo un indicatore semplice (lunghezza), evitiamo di riscrivere
        // file potenzialmente già sani per non introdurre corruzione silenziosa.
        if (fixedContent.length < content.length) {
            console.log(`[${filePath}] Detected CP1252 corruption. Restoring...`);
            fs.writeFileSync(fullPath, fixedContent, 'utf8');
            return { fixed: true };
        }
    } catch (e) {
        console.error(`[${filePath}] Error decoding: ${e.message}`);
    }
}

console.log("Starting restoration...");
FILES.forEach(f => {
    try {
        const result = fixEncoding(f);
    } catch (err) {
        console.error("Error processing " + f, err);
    }
});
console.log("Done.");
