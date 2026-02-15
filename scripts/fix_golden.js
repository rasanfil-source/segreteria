const fs = require('fs');

try {
    const partA = JSON.parse(fs.readFileSync('tests/golden_part_a.json', 'utf8').replace(/^\uFEFF/, ''));
    const partB = JSON.parse(fs.readFileSync('tests/golden_part_b.json', 'utf8').replace(/^\uFEFF/, ''));

    const merged = [...partA, ...partB];

    console.log(`Part A: ${partA.length} cases`);
    console.log(`Part B: ${partB.length} cases`);
    console.log(`Merged: ${merged.length} cases`);

    fs.writeFileSync('tests/golden_cases.json', JSON.stringify(merged, null, 2));
    console.log('Successfully created tests/golden_cases.json');

} catch (e) {
    console.error('Error merging golden cases:', e);
    process.exit(1);
}
