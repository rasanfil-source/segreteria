const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.CONFIG = {
  MAX_SAFE_TOKENS: 35000,
  KB_TOKEN_BUDGET_RATIO: 0.5
};

global.createLogger = () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} });

const codePath = path.join(__dirname, '..', 'gas_prompt_engine.js');
const code = fs.readFileSync(codePath, 'utf8');
vm.runInThisContext(code, { filename: codePath });

console.log('--- Test KB semantic truncation budget usage ---');
const engine = new PromptEngine();

const longKb = [
  'PARAGRAFO 1: '.padEnd(340, 'A'),
  'PARAGRAFO 2: '.padEnd(220, 'B'),
  'PARAGRAFO 3: '.padEnd(220, 'C'),
  'PARAGRAFO 4: '.padEnd(220, 'D')
].join('\n\n');

const limit = 400;
const truncated = engine._truncateKbSemantically(longKb, limit);

assert(truncated.length <= limit, `La KB troncata supera il limite: ${truncated.length} > ${limit}`);
assert(
  truncated.length >= Math.floor(limit * 0.85),
  `La KB troncata usa troppo poco budget (${truncated.length}/${limit})`
);
assert(
  truncated.includes('[SEZIONI OMESSE') || truncated.includes('...[omesso]') || truncated.endsWith('…'),
  'Manca indicatore di troncamento nel risultato'
);


console.log('--- Test KB semantic truncation preserves paragraph separators ---');
const crlfKb = [
  'PARAGRAFO ALFA: '.padEnd(90, 'A'),
  'PARAGRAFO BETA: '.padEnd(90, 'B'),
  'PARAGRAFO GAMMA: '.padEnd(90, 'C')
].join('\r\n\r\n');
const separated = engine._truncateKbSemantically(crlfKb, 260);

assert(separated.length <= 260, `La KB CRLF troncata supera il limite: ${separated.length} > 260`);
assert(
  separated.includes('PARAGRAFO ALFA') && separated.includes('PARAGRAFO BETA'),
  'La KB troncata dovrebbe mantenere i paragrafi completi quando entrano nel budget'
);
assert(
  separated.includes('A\n\nPARAGRAFO BETA') || separated.includes('A\n\n...'),
  'I paragrafi mantenuti non devono essere collassati senza separatore semantico'
);

console.log('--- Test KB semantic truncation marks first-paragraph cuts ---');
const singleHugeParagraph = 'PARAGRAFO UNICO: ' + 'X'.repeat(1000);
const singleTruncated = engine._truncateKbSemantically(singleHugeParagraph, 180);

assert(singleTruncated.length <= 180, `La KB mono-paragrafo supera il limite: ${singleTruncated.length} > 180`);
assert(
  singleTruncated.includes('[SEZIONI OMESSE') || singleTruncated.includes('...[omesso]') || singleTruncated.endsWith('…'),
  'Il taglio del primo paragrafo deve includere un indicatore di troncamento'
);

console.log('--- Test KB semantic truncation marks ultra-tight cuts ---');
const tinyTruncated = engine._truncateKbSemantically(singleHugeParagraph, 1);

assert(tinyTruncated.length <= 1, `La KB ultra-stretta supera il limite: ${tinyTruncated.length} > 1`);
assert(tinyTruncated === '…', 'Anche con budget minimo deve restare un indicatore di troncamento');

console.log('✅ Test KB truncation passati');
