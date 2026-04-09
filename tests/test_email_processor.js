const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.createLogger = () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} });
global.GeminiService = class {};
global.Classifier = class {};
global.RequestTypeClassifier = class {};
global.ResponseValidator = class {};
global.GmailService = class {};
global.PromptEngine = class {};
global.MemoryService = class {};
global.TerritoryValidator = class {};

global.CONFIG = {
  IGNORE_DOMAINS: ['newsletter.com'],
  IGNORE_KEYWORDS: ['unsubscribe', 'annulla iscrizione'],
  ATTACHMENT_CONTEXT: {
    ocrTriggerKeywords: ['iban', 'bonifico']
  }
};

global.GLOBAL_CACHE = {
  languageMode: 'all',
  ignoreDomains: ['mailchimp.com'],
  ignoreKeywords: ['newsletter']
};

const gasEmailProcessorPath = path.join(__dirname, '..', 'gas_email_processor.js');
const code = fs.readFileSync(gasEmailProcessorPath, 'utf8');
vm.runInThisContext(code, { filename: gasEmailProcessorPath });

const processor = new EmailProcessor();

console.log('--- Test _shouldIgnoreEmail (dominio blacklist) ---');
assert(
  processor._shouldIgnoreEmail({
    senderEmail: 'promo@mailchimp.com',
    subject: 'offerta',
    body: 'contenuto'
  }) === true,
  'deve ignorare email da dominio blacklist'
);

console.log('--- Test _shouldIgnoreEmail (keyword blacklist) ---');
assert(
  processor._shouldIgnoreEmail({
    senderEmail: 'utente@example.com',
    subject: 'Newsletter settimanale',
    body: 'ciao'
  }) === true,
  'deve ignorare email con keyword blacklist'
);

console.log('--- Test _shouldIgnoreEmail (email valida) ---');
assert(
  processor._shouldIgnoreEmail({
    senderEmail: 'mario.rossi@example.com',
    subject: 'Richiesta orari battesimo',
    body: 'Buongiorno, vorrei informazioni.'
  }) === false,
  'non deve ignorare email normale utente'
);

console.log('--- Test _shouldTryOcr (keyword presente) ---');
assert(
  processor._shouldTryOcr('In allegato iban per bonifico', 'Documentazione', null) === true,
  'deve attivare OCR con keyword trigger'
);

console.log('--- Test _shouldTryOcr (nessuna keyword, testo presente) ---');
assert(
  processor._shouldTryOcr('Richiesta informazioni generica', 'Oggetto', null) === false,
  'non deve attivare OCR senza keyword se c’è testo'
);

console.log('--- Test modalità lingua (foreign_only) ---');
global.GLOBAL_CACHE.languageMode = 'foreign_only';
assert(
  processor._getLanguageProcessingMode_() === 'foreign_only',
  'deve leggere foreign_only da GLOBAL_CACHE'
);
assert(
  processor._shouldSkipByLanguageMode_('it', 'foreign_only') === true,
  'in foreign_only deve saltare email italiane'
);
assert(
  processor._shouldSkipByLanguageMode_('en', 'foreign_only') === false,
  'in foreign_only non deve saltare email straniere'
);

console.log('✅ Test filtri EmailProcessor passati');
