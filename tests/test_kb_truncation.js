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

console.log('✅ Test KB truncation passati');
