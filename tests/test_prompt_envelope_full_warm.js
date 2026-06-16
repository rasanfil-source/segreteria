const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.createLogger = function createLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
};

const promptEnginePath = path.join(__dirname, '..', 'gas_prompt_engine.js');
const code = fs.readFileSync(promptEnginePath, 'utf8');
vm.runInThisContext(code, { filename: promptEnginePath });

console.log('--- Test PromptEngine: full_warm output envelope ---');
const engine = createPromptEngine();
const fullWarmPolicy = engine._renderOutputEnvelopePolicy('it', 'full_warm', 'Gentile Maria,', 'Cordiali saluti');

assert(
  fullWarmPolicy.includes('Primo contatto con contesto sensibile'),
  'full_warm deve segnalare primo contatto sensibile'
);
assert(
  fullWarmPolicy.includes('Cara/Caro [nome]') && fullWarmPolicy.includes('Gentile [nome]'),
  'full_warm deve preferire Cara/Caro a Gentile'
);
assert(
  fullWarmPolicy.includes('lingua IT'),
  'full_warm deve mantenere saluto e chiusura nella lingua rilevata'
);

console.log('✅ PromptEngine output envelope tests passed');
