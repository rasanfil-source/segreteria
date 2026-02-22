const fs = require('fs');
const vm = require('vm');

function loadScript(path) {
    const code = fs.readFileSync(path, 'utf8');
    vm.runInThisContext(code, { filename: path });
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

loadScript('gas_main.js');

const rows = [
    [' Categoria ', ' Dettaglio ', ''],
    ['', '   ', null],
    ['Orari Messe Festive', 'Sabato 18:00', undefined],
    ['Contatti', 12345, false]
];

const text = _sheetRowsToText(rows);
const expected = [
    'Categoria | Dettaglio',
    'Orari Messe Festive | Sabato 18:00',
    'Contatti | 12345 | false'
].join('\n');

console.log('OBTAINED:');
console.log(JSON.stringify(text));
console.log('EXPECTED:');
console.log(JSON.stringify(expected));

if (text === expected) {
    console.log('PASS');
} else {
    console.log('FAIL');
    process.exit(1);
}
