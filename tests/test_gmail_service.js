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

console.log('--- Test getProcessableAttachments: ramo .xlsx come contesto testuale ---');
{
  const xlsxBlob = {
    getName: () => 'registro.xlsx',
    getSize: () => 1024,
    getContentType: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    copyBlob: () => xlsxBlob
  };
  const message = {
    getAttachments: () => [xlsxBlob]
  };

  service._extractOfficeText = () => 'Nome,Data\nMario Rossi,2026-03-28';
  const out = service.getProcessableAttachments(message, { maxCharsPerFile: 500, maxTotalChars: 1000 });
  assert(out.blobs.length === 0, 'xlsx non deve entrare nei blob visuali');
  assert(out.textContext.includes('registro.xlsx'), 'xlsx deve essere incluso nel contesto testuale');
  assert(out.textContext.includes('Mario Rossi'), 'testo estratto xlsx deve essere presente');
  assert(out.skipped.length === 0, 'xlsx con testo non deve finire tra skipped');
}

console.log('--- Test getProcessableAttachments: MIME con parametri deve essere processato ---');
{
  const pdfBlobWithParams = {
    getName: () => 'preventivo.pdf',
    getSize: () => 1024,
    getContentType: () => 'application/pdf; charset=UTF-8',
    copyBlob: () => pdfBlobWithParams
  };
  const xlsxBlobWithParams = {
    getName: () => 'contabilita.xlsx',
    getSize: () => 1024,
    getContentType: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="contabilita.xlsx"',
    copyBlob: () => xlsxBlobWithParams
  };
  const message = {
    getAttachments: () => [pdfBlobWithParams, xlsxBlobWithParams]
  };

  service._extractOfficeText = () => 'Contenuto documento office';
  const out = service.getProcessableAttachments(message, { maxCharsPerFile: 500, maxTotalChars: 1000, maxFiles: 5 });

  assert(out.blobs.length === 1, 'PDF con parametri MIME deve entrare nei blob visuali');
  assert(out.textContext.includes('contabilita.xlsx'), 'XLSX con parametri MIME deve essere processato come testo');
  assert(out.textContext.includes('Contenuto documento office'), 'testo estratto XLSX deve essere presente');
  assert(!out.skipped.some((s) => s.reason === 'unsupported_type'), 'MIME parametrizzati validi non devono risultare unsupported_type');
}

console.log('✅ Test sanitizzazione Gmail/HTML passati');

console.log('--- Test extractMessageDetails: headers malformati non devono rompere parsing metadata ---');
{
  global.Gmail.Users.Messages.get = () => ({
    payload: {
      headers: [
        null,
        { foo: 'bar' },
        { name: 'Message-ID', value: '<id@example.org>' },
        { name: 'References', value: '<prev@example.org>' }
      ]
    }
  });

  const message = {
    getSubject: () => 'Oggetto',
    getFrom: () => 'Utente <utente@example.org>',
    getDate: () => new Date('2026-04-01T10:00:00Z'),
    getPlainBody: () => 'Corpo',
    getBody: () => '<p>Corpo</p>',
    getId: () => 'msg-1',
    getReplyTo: () => 'reply@example.org',
    getTo: () => 'parrocchia@example.org',
    getCc: () => ''
  };

  const details = service.extractMessageDetails(message);
  assert(details.rfc2822MessageId === '<id@example.org>', 'Message-ID deve essere letto anche con header malformati nel payload');
  assert(details.existingReferences === '<prev@example.org>', 'References deve essere letto anche con header malformati nel payload');
}

console.log('--- Test extractMessageDetails: getReplyTo in errore non deve bloccare elaborazione ---');
{
  global.Gmail.Users.Messages.get = () => ({ payload: { headers: [] } });
  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'parrocchia@example.org' }),
    getActiveUser: () => ({ getEmail: () => '' })
  };

  const message = {
    getSubject: () => 'Oggetto 2',
    getFrom: () => 'Utente <utente2@example.org>',
    getDate: () => new Date('2026-04-01T11:00:00Z'),
    getPlainBody: () => 'Corpo 2',
    getBody: () => '<p>Corpo 2</p>',
    getId: () => 'msg-2',
    getReplyTo: () => {
      throw new Error('header unavailable');
    },
    getTo: () => 'parrocchia@example.org',
    getCc: () => ''
  };

  const details = service.extractMessageDetails(message);
  assert(details.sender === 'Utente <utente2@example.org>', 'se getReplyTo fallisce deve usare il sender originale');
  assert(details.hasReplyTo === false, 'se getReplyTo fallisce non deve impostare hasReplyTo=true');
}

console.log('✅ Test extractMessageDetails robustezza passati');
