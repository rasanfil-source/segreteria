const fs = require('fs');

try {
    let raw = fs.readFileSync('tests/golden_cases.json', 'utf8');
    // Strip BOM if present
    raw = raw.replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);

    let flat = [];
    if (Array.isArray(data)) {
        data.forEach(item => {
            if (item.value && Array.isArray(item.value)) {
                flat.push(...item.value);
            } else if (Array.isArray(item)) {
                flat.push(...item);
            } else {
                flat.push(item);
            }
        });
    }

    console.log(`Read ${data.length} items/groups. Flattened to ${flat.length} cases.`);

    if (flat.length === 50) {
        fs.writeFileSync('tests/golden_cases.json', JSON.stringify(flat, null, 2));
        console.log('Fixed tests/golden_cases.json');
    } else {
        console.error('Unexpected count after flattening:', flat.length);
        // Fallback: maybe data IS the flat array?
        // Check first item.
        if (data[0] && data[0].id === 'golden-001') {
            console.log('Data seems already correct?');
        }
    }
} catch (e) {
    console.error('Error fixing golden cases:', e);
}
