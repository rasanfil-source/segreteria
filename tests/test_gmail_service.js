const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.Utilities = {
  getUuid: () => 'uuid-test',
  sleep: () => {}
};

global.CacheService = {
  getScriptCache: () => ({
    get: () => null,
    put: () => {},
    remove: () => {}
  })
};

global.CONFIG = {};

global.Gmail = {
  Users: {
    Messages: {
      list: () => ({ messages: [] }),
      get: () => ({})
    }
  }
};

const gasGmailServicePath = path.join(__dirname, '..', 'gas_gmail_service.js');
const code = fs.readFileSync(gasGmailServicePath, 'utf8');
vm.runInThisContext(code, { filename: gasGmailServicePath });

console.log('--- Test sanitizeUrl ---');
assert(sanitizeUrl('https://example.org/path?q=1') === 'https://example.org/path?q=1', 'URL https valido deve passare');
assert(sanitizeUrl('javascript:alert(1)') === null, 'URL javascript deve essere bloccato');
assert(sanitizeUrl('http://127.0.0.1/test') === null, 'URL localhost deve essere bloccato (SSRF)');

console.log('--- Test markdownToHtml escaping/sicurezza ---');
const html = markdownToHtml('Ciao **Mondo**\n[link](https://example.org)\n<script>alert(1)</script>');
assert(html.includes('<strong>Mondo</strong>'), 'bold markdown deve essere renderizzato');
assert(html.includes('href="https://example.org"'), 'link https deve essere mantenuto');
assert(!html.includes('<script>alert(1)</script>'), 'script raw non deve passare');
assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'script deve essere escaped');

console.log('--- Test discovery: errore getThreadById non deve bloccare il batch ---');
const service = new GmailService();

service._getOptionalLabelIdByName = () => null;
service._listMessagesWithResilience = () => ({
  messages: [
    { id: 'm1', threadId: 't-missing' },
    { id: 'm2', threadId: 't-ok' }
  ],
  nextPageToken: null
});
service._getMessageMetadataWithResilience = () => ({ labelIds: [] });

global.GmailApp = {
  getThreadById: (threadId) => {
    if (threadId === 't-missing') {
      throw new Error('Thread gone');
    }
    return { getId: () => threadId };
  }
};

const metadataResult = service._discoverByMetadata('IA', 'Errore', 'Verifica', 10, 10, 1);
assert(metadataResult.threads.length === 1, 'metadata mode deve continuare dopo errore getThreadById');
assert(metadataResult.threads[0].getId() === 't-ok', 'metadata mode deve includere thread valido');

const queryResult = service._discoverByQuery('IA', 'Errore', 'Verifica', 10, 10, 1);
assert(queryResult.threads.length === 1, 'query mode deve continuare dopo errore getThreadById');
assert(queryResult.threads[0].getId() === 't-ok', 'query mode deve includere thread valido');

console.log('✅ Test sanitizzazione Gmail/HTML passati');
