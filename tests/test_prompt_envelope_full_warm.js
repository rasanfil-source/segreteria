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

const responseStrategyPath = path.join(__dirname, '..', 'gas_response_strategy.js');
vm.runInThisContext(fs.readFileSync(responseStrategyPath, 'utf8'), { filename: responseStrategyPath });

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

const warmGuidelineCases = [
  { lang: 'en', salutation: 'Dear Maria,', closing: 'Kind regards,', marker: 'WARM BUT SOBER GREETING', forbidden: 'You MUST start the email with EXACTLY' },
  { lang: 'es', salutation: 'Estimada Maria,', closing: 'Un cordial saludo,', marker: 'SALUDO CÁLIDO PERO SOBRIO', forbidden: 'Debes comenzar el correo EXACTAMENTE' },
  { lang: 'pt', salutation: 'Prezada Maria,', closing: 'Com os melhores cumprimentos,', marker: 'SAUDAÇÃO CALOROSA MAS SÓBRIA', forbidden: 'Deves começar o email EXATAMENTE' },
  { lang: 'fr', salutation: 'Chère Maria,', closing: 'Cordialement,', marker: 'SALUTATION CHALEUREUSE MAIS SOBRE', forbidden: 'Commence l\'email EXACTEMENT' },
  { lang: 'de', salutation: 'Liebe Maria,', closing: 'Mit freundlichen Grüßen,', marker: 'WARME, ABER SACHLICHE ANREDE', forbidden: 'Beginne die E-Mail EXAKT' },
  { lang: 'nl', salutation: 'Beste Maria,', closing: 'Met vriendelijke groet,', marker: 'WARM BUT SOBER GREETING IN TARGET LANGUAGE NL', forbidden: 'GREETING IN TARGET LANGUAGE REQUIRED' }
];

warmGuidelineCases.forEach(({ lang, salutation, closing, marker, forbidden }) => {
  const guidelines = engine._renderResponseGuidelines(lang, 'invernale', salutation, closing, 'full_warm');
  assert(guidelines.includes(marker), `full_warm ${lang} deve usare il ramo caldo/sobrio`);
  assert(!guidelines.includes(forbidden), `full_warm ${lang} non deve imporre il saluto standard esatto`);
});

assert(
  engine._renderExamples('information', 'it').includes('Gentile utente') &&
    engine._renderExamples('information', 'en') === null,
  'gli esempi hard-coded in italiano devono essere omessi nei prompt non italiani'
);

console.log('✅ PromptEngine output envelope tests passed');
