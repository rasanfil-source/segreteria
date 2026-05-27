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

global.CONFIG = {
  SKIP_LABEL_NAME: '·'
};


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
assert(
  sanitizeUrl('https://example.org/search?q=<safe>') === 'https://example.org/search?q=&lt;safe&gt;',
  'URL con parentesi angolari deve essere escaped in modo sicuro'
);
assert(sanitizeUrl('www.parrocchia.it/info') === 'https://www.parrocchia.it/info', 'URL www.* legittimo deve essere normalizzato a https');
assert(sanitizeUrl('javascript:alert(1)') === null, 'URL javascript deve essere bloccato');
assert(sanitizeUrl('http://127.0.0.1/test') === null, 'URL localhost deve essere bloccato (SSRF)');
assert(sanitizeUrl('http://[::1%25lo0]/admin') === null, 'IPv6 loopback con zone-id deve essere bloccato (SSRF)');
assert(sanitizeUrl('http://[::ffff:127.0.0.1%25eth0]/admin') === null, 'IPv4-mapped IPv6 con zone-id deve essere bloccato (SSRF)');

console.log('--- Test markdownToHtml escaping/sicurezza ---');
const html = markdownToHtml('Ciao **Mondo**\n[link](https://example.org)\n<script>alert(1)</script>');
assert(html.includes('<strong>Mondo</strong>'), 'bold markdown deve essere renderizzato');
assert(html.includes('href="https://example.org"'), 'link https deve essere mantenuto');
assert(!html.includes('<script>alert(1)</script>'), 'script raw non deve passare');
assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'script deve essere escaped');
const htmlIsolated = markdownToHtml('Testo <img src=x onerror=alert(1)> finale');
assert(!htmlIsolated.includes('<img src=x onerror=alert(1)>'), 'tag HTML isolato non deve passare raw');
assert(htmlIsolated.includes('&lt;img src=x onerror=alert(1)&gt;'), 'tag HTML isolato deve essere escaped');


console.log('--- Test _extractEmailAddress supporta caratteri RFC5322 snelli nel local-part ---');
{
  const service = new GmailService();
  assert(
    service._extractEmailAddress("D'Angelo <d'angelo@example.org>") === "d'angelo@example.org",
    'indirizzi con apostrofo nel local-part devono essere estratti'
  );
  assert(
    service._extractEmailAddress('Ticket <helpdesk+parish!urgent#case=42@example.org>') === 'helpdesk+parish!urgent#case=42@example.org',
    'indirizzi con !, # e = nel local-part devono essere estratti'
  );
}

console.log('--- Test _htmlToPlainText limita rimozione script/style patologici ---');
{
  const service = new GmailService();
  const text = service._htmlToPlainText(`<p>Prima</p><script>${'x'.repeat(6000)}</script><p>Dopo</p>`);
  assert(text.includes('Prima') && text.includes('Dopo'), 'il testo esterno a script/style lunghi deve restare disponibile');
}

console.log('--- Test _htmlToPlainText converte emoji email una sola volta ---');
{
  const service = new GmailService();
  const text = service._htmlToPlainText('📧 Messaggio ricevuto');
  assert(text === '[Email] Messaggio ricevuto', 'emoji email deve diventare un solo token plain-text');
}

console.log('--- Test addLabelToMessage non degrada a label thread-level ---');
{
  const service = Object.create(GmailService.prototype);
  let fallbackCalled = false;
  service._getOptionalLabelIdByName = () => null;
  service._isLabelNotFoundError = () => false;
  service.addLabelToThread = () => { fallbackCalled = true; };

  let threw = false;
  try {
    service.addLabelToMessage('msg-1', 'IA');
  } catch (e) {
    threw = true;
  }

  assert(threw, 'addLabelToMessage deve propagare errore se il message-level non è disponibile');
  assert(!fallbackCalled, 'addLabelToMessage non deve applicare fallback a livello thread');
}


console.log('--- Test discovery: errore getThreadById non deve bloccare il batch ---');
console.log('--- Test fixPunctuation preserva newline dopo virgola ---');
const punctuationService = new GmailService();
const punctuated = punctuationService.fixPunctuation('Buongiorno,\nSiamo disponibili.');
assert(punctuated === 'Buongiorno,\nsiamo disponibili.', 'fixPunctuation deve mantenere il newline dopo la virgola');

console.log('--- Test Gmail counter fallback usa data Pacific Time ---');
{
  const originalUtilities = global.Utilities;
  const originalDateNow = Date.now;
  try {
    global.Utilities = null;
    Date.now = () => new Date('2026-05-11T03:30:00.000Z').getTime();
    const fallbackService = new GmailService();
    assert(
      fallbackService._getGmailCounterDateKey_() === 'gmail_api_calls:2026-05-10',
      'fallback counter Gmail deve usare la data Pacific Time, non UTC'
    );
  } finally {
    global.Utilities = originalUtilities;
    Date.now = originalDateNow;
  }
}

console.log('--- Test _discoverByQuery: non esclude label a livello thread ---');
{
  const originalGmailApp = global.GmailApp;
  let capturedQuery = '';
  global.GmailApp = {
    search: (query) => {
      capturedQuery = query || '';
      return [];
    }
  };

  try {
    const serviceQuery = new GmailService();
    serviceQuery._discoverByQuery('IA', 'Errore', 'Verifica', 10, 10, 1, CONFIG.SKIP_LABEL_NAME);
    assert(capturedQuery === 'is:unread in:inbox', 'query discovery non deve escludere label a livello thread');
  } finally {
    global.GmailApp = originalGmailApp;
  }
}

console.log('--- Test _discoverByQuery: staleOnlyMs esclude thread solo recenti ---');
{
  const originalGmailApp = global.GmailApp;
  const staleDate = new Date('2026-05-10T08:00:00Z');
  const recentDate = new Date('2026-05-11T08:00:00Z');
  const threshold = new Date('2026-05-10T12:00:00Z').getTime();

  const makeThread = (id, date) => ({
    getId: () => id,
    getMessages: () => [{
      isUnread: () => true,
      getId: () => `m-${id}`,
      getDate: () => date
    }]
  });

  global.GmailApp = {
    search: () => [
      makeThread('recent-only', recentDate),
      makeThread('stale-only', staleDate)
    ]
  };

  try {
    const serviceQuery = new GmailService();
    const result = serviceQuery._discoverByQuery('IA', 'Errore', 'Verifica', 10, 10, 1, [], { staleOnlyMs: threshold });
    assert(result.threads.length === 1, 'staleOnlyMs deve mantenere solo i thread con unread stale');
    assert(result.threads[0].getId() === 'stale-only', 'deve includere il thread stale');
  } finally {
    global.GmailApp = originalGmailApp;
  }
}

console.log('--- Test _discoverByQuery: fallback metadata su cache unread incoerente ---');
{
  const originalGmailApp = global.GmailApp;
  const staleMessage = {
    isUnread: () => false,
    getId: () => 'm-metadata-unread',
    getDate: () => new Date('2026-05-10T08:00:00Z')
  };
  const staleThread = {
    getId: () => 't-metadata-unread',
    getMessages: () => [staleMessage]
  };
  let refreshCalled = 0;

  global.GmailApp = {
    refreshThread: () => {
      refreshCalled++;
    },
    search: () => [staleThread]
  };

  try {
    const serviceQuery = new GmailService();
    serviceQuery._getMessageMetadataWithResilience = (messageId) => ({
      id: messageId,
      labelIds: ['INBOX', 'UNREAD']
    });
    const result = serviceQuery._discoverByQuery('IA', 'Errore', 'Verifica', 10, 10, 1, []);
    assert(refreshCalled === 1, 'query discovery deve rinfrescare il thread prima di leggere isUnread');
    assert(result.threads.length === 1, 'metadata fallback deve recuperare thread con label UNREAD/INBOX');
    assert(result.messageIds.has('m-metadata-unread'), 'metadata fallback deve registrare il messaggio unread recuperato');
  } finally {
    global.GmailApp = originalGmailApp;
  }
}

console.log('--- Test _discoverByQuery: fallback automatico a metadata discovery ---');
{
  const originalGmailApp = global.GmailApp;
  const queryThread = {
    getId: () => 't-query-empty',
    getMessages: () => [{
      isUnread: () => false,
      getId: () => 'm-query-empty',
      getDate: () => new Date('2026-05-10T08:00:00Z')
    }]
  };
  const metadataThread = {
    getId: () => 't-metadata-fallback',
    getMessages: () => [{
      isUnread: () => false,
      getId: () => 'm-metadata-fallback',
      getDate: () => new Date('2026-05-10T08:00:00Z')
    }]
  };

  global.GmailApp = {
    refreshThread: () => {},
    search: () => [queryThread],
    getThreadById: (threadId) => threadId === 't-metadata-fallback' ? metadataThread : null
  };

  try {
    const serviceQuery = new GmailService();
    serviceQuery._listMessagesWithResilience = () => ({
      messages: [{ id: 'm-metadata-fallback', threadId: 't-metadata-fallback' }],
      nextPageToken: null
    });
    serviceQuery._getOptionalLabelIdByName = () => null;
    serviceQuery._getMessageMetadataWithResilience = (messageId) => ({
      id: messageId,
      labelIds: messageId === 'm-metadata-fallback' ? ['INBOX', 'UNREAD'] : ['INBOX']
    });
    const result = serviceQuery._discoverByQuery('IA', 'Errore', 'Verifica', 10, 10, 1, []);
    assert(result.threads.length === 1, 'query discovery deve cadere su metadata discovery se i candidati query sono incoerenti');
    assert(result.threads[0].getId() === 't-metadata-fallback', 'fallback metadata deve restituire il thread recuperato da Messages.list');
  } finally {
    global.GmailApp = originalGmailApp;
  }
}

const service = new GmailService();

console.log('--- Test _stripHtmlTags: pattern lineare su tag malformati ---');
{
  const malformedHtml = '<div' + ' '.repeat(20000) + 'testo senza chiusura';
  const start = Date.now();
  const stripped = service._stripHtmlTags(malformedHtml);
  const elapsedMs = Date.now() - start;

  assert(elapsedMs < 1000, `_stripHtmlTags deve gestire tag malformati senza ReDoS (elapsed=${elapsedMs}ms)`);
  assert(stripped.includes('testo senza chiusura'), '_stripHtmlTags deve preservare testo dopo tag malformato non chiuso');
}

service._getOptionalLabelIdByName = () => null;
service._listMessagesWithResilience = () => ({
  messages: [
    { id: 'm1', threadId: 't-missing' },
    { id: 'm2', threadId: 't-ok' }
  ],
  nextPageToken: null
});

global.GmailApp = {
  getThreadById: (threadId) => {
    if (threadId === 't-missing') {
      throw new Error('Thread gone');
    }
    return { getId: () => threadId };
  },
  search: () => [{
    getId: () => 't-ok',
    getMessages: () => [{ isUnread: () => true, getId: () => 'm2' }]
  }]
};

const metadataResult = service._discoverByMetadata('IA', 'Errore', 'Verifica', 10, 10, 1);
assert(metadataResult.threads.length === 1, 'metadata mode deve continuare dopo errore getThreadById');
assert(metadataResult.threads[0].getId() === 't-ok', 'metadata mode deve includere thread valido');

const queryResult = service._discoverByQuery('IA', 'Errore', 'Verifica', 10, 10, 1);
assert(queryResult.threads.length === 1, 'query mode deve includere thread valido restituito da GmailApp.search');
assert(queryResult.threads[0].getId() === 't-ok', 'query mode deve includere thread valido');

console.log('--- Test discovery: skipLabel esclude i messaggi marcati come ignorati ---');
{
  const serviceWithSkip = new GmailService();
  serviceWithSkip._listMessagesWithResilience = () => ({
    messages: [
      { id: 'm-skip', threadId: 't-skip' },
      { id: 'm-keep', threadId: 't-keep' }
    ],
    nextPageToken: null
  });
  serviceWithSkip._getOptionalLabelIdByName = (labelName) => {
    if (labelName === CONFIG.SKIP_LABEL_NAME) return 'skip-id';
    return null;
  };
  serviceWithSkip._getMessageMetadataWithResilience = (messageId) => ({
    labelIds: messageId === 'm-skip' ? ['skip-id'] : []
  });

  global.GmailApp = {
    getThreadById: (threadId) => ({ getId: () => threadId }),
    search: () => []
  };

  const metadataSkipResult = serviceWithSkip._discoverByMetadata('IA', 'Errore', 'Verifica', 10, 10, 1, CONFIG.SKIP_LABEL_NAME);
  assert(metadataSkipResult.threads.length === 1, 'metadata mode deve escludere i messaggi con skipLabel');
  assert(metadataSkipResult.threads[0].getId() === 't-keep', 'metadata mode deve mantenere solo il thread senza skipLabel');

  let capturedQuery = '';
  global.GmailApp.search = (query) => {
    capturedQuery = query || '';
    return [];
  };
  serviceWithSkip._discoverByQuery('IA', 'Errore', 'Verifica', 10, 10, 1, CONFIG.SKIP_LABEL_NAME);
  assert(capturedQuery === 'is:unread in:inbox', 'query mode non deve escludere la skipLabel dalla query Gmail');

  const normalizedSkipLabels = serviceWithSkip._normalizeSkipLabels_(['', '  ', ` ${CONFIG.SKIP_LABEL_NAME} `, null]);
  assert(normalizedSkipLabels.length === 1 && normalizedSkipLabels[0] === CONFIG.SKIP_LABEL_NAME, 'skipLabel deve ignorare stringhe vuote/spazi e trimare i nomi validi');
}

console.log('--- Test discovery metadata: label terminale message-level esclude il messaggio ---');
{
  const serviceInheritedLabel = new GmailService();
  serviceInheritedLabel._listMessagesWithResilience = () => ({
    messages: [{ id: 'm-inherited-label', threadId: 't-inherited-label' }],
    nextPageToken: null
  });
  serviceInheritedLabel._getOptionalLabelIdByName = (labelName) => {
    if (labelName === 'IA') return 'label-ia';
    return null;
  };
  serviceInheritedLabel._getMessageMetadataWithResilience = () => ({
    labelIds: ['INBOX', 'UNREAD', 'label-ia']
  });

  global.GmailApp = {
    getThreadById: (threadId) => ({ getId: () => threadId }),
    search: () => []
  };

  const inheritedResult = serviceInheritedLabel._discoverByMetadata('IA', 'Errore', 'Verifica', 10, 10, 1);
  assert(inheritedResult.threads.length === 0, 'label IA a livello messaggio deve chiudere il messaggio anche se resta unread');
}

console.log('--- Test metadata fallback unread: limita scansione ai messaggi recenti ---');
{
  const serviceBoundedThread = new GmailService();
  serviceBoundedThread._metadataFallbackMaxPerThread = 3;
  const metadataCalls = [];
  const messages = Array.from({ length: 8 }, (_, index) => ({
    getId: () => `m-thread-${index}`,
    isUnread: () => false,
    getDate: () => new Date('2026-04-01T10:00:00Z')
  }));
  serviceBoundedThread._getMessageMetadataWithResilience = (messageId) => {
    metadataCalls.push(messageId);
    return { labelIds: messageId === 'm-thread-7' ? ['INBOX', 'UNREAD'] : ['INBOX'] };
  };

  const unread = serviceBoundedThread._filterUnreadMessagesForDiscovery_(messages);
  assert(metadataCalls.length === 3, 'metadata unread fallback deve controllare solo gli ultimi N messaggi del thread');
  assert(metadataCalls[0] === 'm-thread-5' && metadataCalls[2] === 'm-thread-7', 'metadata unread fallback deve partire dalla coda recente del thread');
  assert(unread.length === 1 && unread[0].getId() === 'm-thread-7', 'metadata unread fallback deve recuperare il non letto recente');
}

console.log('--- Test discovery metadata: limite massimo messages.get per run ---');
{
  const serviceBoundedDiscovery = new GmailService();
  serviceBoundedDiscovery._metadataDiscoveryMaxGets = 2;
  const metadataCalls = [];
  serviceBoundedDiscovery._listMessagesWithResilience = () => ({
    messages: [
      { id: 'm-bound-1', threadId: 't-bound-1' },
      { id: 'm-bound-2', threadId: 't-bound-2' },
      { id: 'm-bound-3', threadId: 't-bound-3' }
    ],
    nextPageToken: null
  });
  serviceBoundedDiscovery._getOptionalLabelIdByName = () => null;
  serviceBoundedDiscovery._getMessageMetadataWithResilience = (messageId) => {
    metadataCalls.push(messageId);
    return { labelIds: ['INBOX', 'UNREAD'] };
  };
  global.GmailApp = {
    getThreadById: (threadId) => ({ getId: () => threadId }),
    search: () => []
  };

  const boundedResult = serviceBoundedDiscovery._discoverByMetadata('IA', 'Errore', 'Verifica', 10, 10, 1);
  assert(metadataCalls.length === 2, 'metadata discovery deve rispettare il limite esplicito di messages.get');
  assert(boundedResult.threads.length === 2, 'metadata discovery deve restituire i thread già raccolti quando raggiunge il limite');
}

console.log('--- Test getMessageIdsWithLabel: fallback data senza Utilities.formatDate/Session ---');
{
  const serviceWithLookback = new GmailService();
  global.CONFIG.GMAIL_LABEL_LOOKBACK_DAYS = 7;

  serviceWithLookback._getOptionalLabelIdByName = () => 'label-ia';
  serviceWithLookback._listMessagesWithResilience = (params) => {
    assert(typeof params.q === 'string' && params.q.includes('after:'), 'query deve includere filtro after quando lookback è attivo');
    assert(/\bafter:\d{4}\/\d{2}\/\d{2}\b/.test(params.q), 'filtro after deve usare formato yyyy/MM/dd anche in fallback');
    return { messages: [], nextPageToken: null };
  };

  const originalSession = global.Session;
  const originalFormatDate = global.Utilities.formatDate;
  delete global.Session;
  delete global.Utilities.formatDate;

  const ids = serviceWithLookback.getMessageIdsWithLabel('IA', true, {});
  assert(ids instanceof Set, 'getMessageIdsWithLabel deve restituire Set anche senza Session/Utilities.formatDate');

  global.Session = originalSession;
  if (typeof originalFormatDate !== 'undefined') {
    global.Utilities.formatDate = originalFormatDate;
  }
  delete global.CONFIG.GMAIL_LABEL_LOOKBACK_DAYS;
}

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

console.log('--- Test getProcessableAttachments: limiti testo a zero significano nessun limite ---');
{
  const longText = 'Riga allegato '.repeat(400);
  const textBlob = {
    getName: () => 'note.txt',
    getSize: () => 1024,
    getContentType: () => 'text/plain',
    getDataAsString: () => longText
  };
  const message = {
    getAttachments: () => [textBlob]
  };

  const out = service.getProcessableAttachments(message, { maxCharsPerFile: 0, maxTotalChars: 0 });

  assert(out.textContext.includes(longText), 'maxCharsPerFile=0 e maxTotalChars=0 non devono troncare il testo');
  assert(!out.skipped.some((s) => s.reason === 'text_truncated' || s.reason === 'max_total_chars'), 'zero non deve produrre skip di troncamento');
  assert(out.processedCount === 1, 'deve riportare il numero di allegati processati');
}

console.log('--- Test extractAttachmentContext: limiti testo a zero significano nessun limite ---');
{
  const ocrService = new GmailService();
  ocrService._cleanupOrphanedOcrFilesIfNeeded = () => {};
  const longText = 'Contenuto OCR allegato '.repeat(400);
  const textBlob = {
    getName: () => 'documento.txt',
    getSize: () => 1024,
    getContentType: () => 'text/plain',
    getDataAsString: () => longText
  };
  const message = {
    getAttachments: () => [textBlob]
  };

  const out = ocrService.extractAttachmentContext(message, { maxCharsPerFile: 0, maxTotalChars: 0 });

  assert(out.text.includes(longText.trim()), 'maxCharsPerFile=0 e maxTotalChars=0 non devono svuotare/troncare extractAttachmentContext');
  assert(!out.skipped.some((s) => s.reason === 'empty_after_clip' || s.reason === 'total_limit'), 'zero non deve produrre skip da limite testo OCR');
}

console.log('--- Test extractAttachmentContext: soglia OCR zero resta zero ---');
{
  const ocrService = new GmailService();
  ocrService._cleanupOrphanedOcrFilesIfNeeded = () => {};
  ocrService._extractOcrTextFromAttachment = () => 'Testo OCR leggibile con dati sufficienti per il contesto parrocchiale.';
  ocrService._estimateOcrConfidence = () => 0.4;
  ocrService._isMeaningfulOCR = () => true;
  const imageBlob = {
    getName: () => 'documento.png',
    getSize: () => 12000,
    getContentType: () => 'image/png'
  };
  const message = {
    getAttachments: () => [imageBlob]
  };

  const out = ocrService.extractAttachmentContext(message, {
    ocrConfidenceWarningThreshold: 0,
    maxCharsPerFile: 500,
    maxTotalChars: 1000
  });

  assert(out.ocrConfidence === 0.4, 'il test deve esercitare una confidenza OCR bassa ma valida');
  assert(out.ocrConfidenceLow === false, 'ocrConfidenceWarningThreshold=0 non deve ricadere al default 0.8');
}

console.log('--- Test _extractOcrTextFromAttachment: cleanup preferisce delete definitivo a trash ---');
{
  const originalDrive = global.Drive;
  const originalDocumentApp = global.DocumentApp;
  const cleanupCalls = [];

  global.Drive = {
    Files: {
      create: () => ({ id: 'ocr-temp-1', mimeType: 'application/vnd.google-apps.document' }),
      remove: (id) => cleanupCalls.push(`remove:${id}`),
      delete: (id) => cleanupCalls.push(`delete:${id}`),
      trash: (id) => cleanupCalls.push(`trash:${id}`)
    }
  };
  global.DocumentApp = {
    openById: () => ({
      getBody: () => ({ getText: () => 'Testo OCR valido estratto dal documento temporaneo.' })
    })
  };

  try {
    const ocrCleanupService = new GmailService();
    ocrCleanupService._rememberTemporaryDriveFile_ = () => {};
    ocrCleanupService._forgetTemporaryDriveFile_ = () => {};
    const text = ocrCleanupService._extractOcrTextFromAttachment({
      copyBlob: () => ({ getContentType: () => 'application/pdf' }),
      getName: () => 'documento.pdf'
    }, { ocrLanguage: 'it' });

    assert(text.includes('Testo OCR valido'), 'OCR deve restituire il testo estratto');
    assert(cleanupCalls.length === 1 && cleanupCalls[0] === 'remove:ocr-temp-1', 'cleanup OCR deve preferire remove/delete definitivo prima di trash');
  } finally {
    global.Drive = originalDrive;
    global.DocumentApp = originalDocumentApp;
  }
}

console.log('--- Test _isMeaningfulOCR: CF/IBAN dentro testo OCR completo ---');
{
  const ocrService = new GmailService();
  assert(
    ocrService._isMeaningfulOCR('Codice fiscale: RSSMRA80A01H501U', true) === true,
    'OCR con codice fiscale preceduto da etichetta deve essere significativo'
  );
  assert(
    ocrService._isMeaningfulOCR('Coordinate IBAN IT60X0542811101000000123456 intestato alla parrocchia', true) === true,
    'OCR con IBAN dentro testo più ampio deve essere significativo'
  );
  assert(
    ocrService._isMeaningfulOCR('Modulo con conto estero DE89370400440532013000 per rimborso', true) === true,
    'OCR con IBAN non italiano dentro testo più ampio deve essere significativo'
  );
}



console.log('--- Test extractMainReply: firma breve deve essere rimossa ---');
{
  const shortWithSignature = 'Ciao, a che ora è la messa?\n\nSaluti,\nDonato';
  const extracted = service.extractMainReply(shortWithSignature);
  assert(!/saluti/i.test(extracted), 'La firma in email breve deve essere rimossa');
  assert(extracted.includes('a che ora è la messa?'), 'Il contenuto utile deve rimanere nel testo principale');
}

console.log('--- Test _chunkBase64: linee max 76 caratteri RFC 2045 ---');
{
  const base64 = 'A'.repeat(190);
  const chunked = service._chunkBase64(base64);
  const lines = chunked.split('\r\n');
  assert(lines.every((line) => line.length <= 76), 'Chunk base64 deve rispettare 76 caratteri per riga');
  assert(lines.join('') === base64, 'Chunk base64 non deve alterare il contenuto');
}


console.log('--- Test getOrCreateLabel: cache persistente non usa GmailLabel.getId ---');
{
  const originalGmailApp = global.GmailApp;
  const putCalls = [];
  global.GmailApp = {
    getUserLabels: () => [],
    getUserLabelByName: () => null,
    createLabel: (name) => ({ getName: () => name })
  };

  const labelCacheService = new GmailService();
  labelCacheService._scriptCache = {
    get: () => null,
    put: (key, value, ttl) => putCalls.push({ key, value, ttl }),
    remove: () => {}
  };

  const label = labelCacheService.getOrCreateLabel('IA');
  assert(label && label.getName() === 'IA', 'getOrCreateLabel deve restituire la label creata anche senza getId');
  assert(putCalls.length === 1, 'getOrCreateLabel deve valorizzare la cache persistente di esistenza');
  assert(putCalls[0].value === '1', 'la cache persistente deve usare un sentinel di esistenza, non un ID API inesistente');

  global.GmailApp = originalGmailApp;
}

console.log('--- Test _getOptionalLabelIdByName: negative caching evita chiamate ripetute ---');

{
  const serviceWithNegativeCache = new GmailService();
  serviceWithNegativeCache._cacheTTL = 60 * 1000;
  let getUserLabelByNameCalls = 0;

  global.GmailApp = {
    getUserLabelByName: () => {
      getUserLabelByNameCalls += 1;
      return null;
    }
  };

  const first = serviceWithNegativeCache._getOptionalLabelIdByName('Verifica');
  const second = serviceWithNegativeCache._getOptionalLabelIdByName('Verifica');

  assert(first === null && second === null, 'lookup opzionale deve restituire null quando label non esiste');
  assert(getUserLabelByNameCalls === 1, 'negative caching deve evitare chiamata GmailApp ripetuta per label assente');
}


console.log('--- Test _getOptionalLabelIdByName: fallback GmailApp non usa getName come falso ID Advanced ---');
{
  const serviceWithNativeLabel = new GmailService();
  serviceWithNativeLabel._cacheTTL = 60 * 1000;
  let getUserLabelByNameCalls = 0;

  const originalGmail = global.Gmail;
  global.Gmail = undefined;
  global.GmailApp = {
    getUserLabelByName: () => {
      getUserLabelByNameCalls += 1;
      return { getName: () => 'Verifica' };
    }
  };

  const first = serviceWithNativeLabel._getOptionalLabelIdByName('Verifica');
  const second = serviceWithNativeLabel._getOptionalLabelIdByName('Verifica');
  const cachedEntry = serviceWithNativeLabel._labelCache.get('Verifica');

  assert(first === null && second === null, 'fallback GmailApp deve restituire null perché non conosce Label_123');
  assert(cachedEntry && cachedEntry.labelId === null, 'cache fallback GmailApp deve contenere labelId null, non il display name');
  assert(cachedEntry && cachedEntry.existsInGmailApp === true, 'cache fallback GmailApp deve registrare solo esistenza nativa');
  assert(getUserLabelByNameCalls === 1, 'cache fallback GmailApp deve evitare lookup ripetuti');

  global.Gmail = originalGmail;
}

console.log('--- Test _getOptionalLabelIdByName: Advanced Gmail conta labels.list e popola cache bulk ---');

{
  const serviceWithApiLabel = new GmailService();
  const counterOps = [];
  serviceWithApiLabel._incrementGmailCallCounterOrThrow_ = (opName) => counterOps.push(opName);

  const originalLabels = global.Gmail.Users.Labels;
  global.Gmail.Users.Labels = {
    list: () => ({ labels: [
      { id: 'Label_123', name: 'Verifica' },
      { id: 'Label_456', name: 'Da inviare' }
    ] })
  };

  const labelId = serviceWithApiLabel._getOptionalLabelIdByName('Verifica');
  const cachedSecondLabelId = serviceWithApiLabel._getOptionalLabelIdByName('Da inviare');

  assert(labelId === 'Label_123', 'lookup Advanced Gmail deve restituire id label trovato');
  assert(cachedSecondLabelId === 'Label_456', 'lookup successivo deve usare la cache bulk popolata da labels.list');
  assert(counterOps.length === 1 && counterOps[0] === 'labels.list', 'lookup Advanced Gmail deve incrementare il counter locale labels.list una sola volta');

  if (typeof originalLabels === 'undefined') {
    delete global.Gmail.Users.Labels;
  } else {
    global.Gmail.Users.Labels = originalLabels;
  }
}

console.log('--- Test _getMessageMetadataWithResilience: fallback su errore API ---');
const originalGetMetadata = service._getMessageMetadataWithResilience.bind(service);
service._getMessageMetadataWithResilience = () => ({ labelIds: [] });

const thread = { 
  getId: () => 't1', 
  getMessages: () => [{ 
    id: 'm1',
    getSubject: () => 'Test',
    getFrom: () => 'sender@example.com',
    getDate: () => new Date(),
    getPlainBody: () => 'Body',
    getBody: () => '<html>Body</html>',
    getId: () => 'm1'
  }] 
};
const details = service.extractMessageDetails(thread.getMessages()[0]);
assert(details.headersFound === false, 'headersFound deve essere false su fallback');
assert(details.rfc2822MessageId === null, 'rfc2822MessageId deve essere null su fallback');

service._getMessageMetadataWithResilience = originalGetMetadata;

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

console.log('--- Test getThreadHistory: alias interni restano Segreteria ---');
{
  const originalExtractMessageDetails = service.extractMessageDetails;
  const originalGmailApp = global.GmailApp;
  const originalKnownAliases = global.CONFIG.KNOWN_ALIASES;

  service.extractMessageDetails = (message) => message;
  global.GmailApp = Object.assign({}, originalGmailApp || {}, {
    getAliases: () => ['segreteria@example.org']
  });
  global.CONFIG.KNOWN_ALIASES = ['archivio@example.org'];

  const historyFromGmailAlias = service.getThreadHistory(
    [{ senderEmail: 'segreteria@example.org', senderName: 'Segreteria', body: 'Risposta interna' }],
    10,
    'info@example.org'
  );
  assert(
    historyFromGmailAlias.startsWith('Segreteria: Risposta interna'),
    'alias Gmail deve essere classificato come messaggio interno'
  );

  const historyFromKnownAlias = service.getThreadHistory(
    [{ senderEmail: 'archivio@example.org', senderName: 'Archivio', body: 'Messaggio da alias noto' }],
    10,
    'info@example.org'
  );
  assert(
    historyFromKnownAlias.startsWith('Segreteria: Messaggio da alias noto'),
    'CONFIG.KNOWN_ALIASES deve essere classificato come messaggio interno'
  );

  service.extractMessageDetails = originalExtractMessageDetails;
  global.GmailApp = originalGmailApp;
  global.CONFIG.KNOWN_ALIASES = originalKnownAliases;
}

console.log('--- Test getThreadHistory: gmail/googlemail e dots equivalenti restano Segreteria ---');
{
  const originalExtractMessageDetails = service.extractMessageDetails;

  service.extractMessageDetails = (message) => message;

  const history = service.getThreadHistory(
    [{ senderEmail: 'info.parrocchia@gmail.com', senderName: 'Info', body: 'Risposta con account Gmail equivalente' }],
    10,
    'infoparrocchia@googlemail.com'
  );

  assert(
    history.startsWith('Segreteria: Risposta con account Gmail equivalente'),
    'gmail/googlemail con local-part puntato devono restare messaggi interni'
  );

  service.extractMessageDetails = originalExtractMessageDetails;
}

console.log('--- Test sendHtmlReply: References lunghe vengono foldate e limitate ---');
{
  const originalUtilities = global.Utilities;
  const originalSession = global.Session;
  const originalGmail = global.Gmail;
  const originalGlobalCache = global.GLOBAL_CACHE;
  let rawPayload = '';

  try {
    global.Utilities = Object.assign({}, originalUtilities, {
      Charset: { UTF_8: 'utf8' },
      base64Encode: (input) => Buffer.from(String(input || ''), 'utf8').toString('base64'),
      base64EncodeWebSafe: (input) => Buffer.from(String(input || ''), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    });
    global.Session = {
      getEffectiveUser: () => ({ getEmail: () => 'parrocchia@example.org' }),
      getActiveUser: () => ({ getEmail: () => 'parrocchia@example.org' })
    };
    global.GLOBAL_CACHE = { replacements: {} };
    global.Gmail = {
      Users: {
        Messages: {
          send: ({ raw }) => {
            const normalized = String(raw || '').replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
            rawPayload = Buffer.from(padded, 'base64').toString('utf8');
          }
        }
      }
    };

    const longReferences = Array.from({ length: 30 }, (_, i) => `<ref${i}@example.org>`).join(' ');
    service.sendHtmlReply(
      { getThread: () => ({ getId: () => 'thread-refs' }) },
      'Risposta di test',
      {
        subject: 'Oggetto di test',
        senderEmail: 'utente@example.org',
        senderName: 'Utente',
        rfc2822MessageId: '<current@example.org>',
        existingReferences: longReferences,
        recipientEmail: 'parrocchia@example.org',
        recipientCc: ''
      }
    );

    const lines = rawPayload.split('\r\n');
    const refStart = lines.findIndex((line) => line.startsWith('References:'));
    assert(refStart >= 0, 'Il messaggio RAW deve contenere l\'header References');

    const refLines = [];
    for (let i = refStart; i < lines.length; i++) {
       if (i === refStart || lines[i].startsWith(' ')) refLines.push(lines[i]);
       else break;
    }

    const refIds = refLines.join(' ').match(/<[^<>\s]+>/g) || [];
    assert(refLines.length > 1, 'Una catena References lunga deve essere foldata su più righe');
    assert(refLines.every((line) => line.length <= 76), 'Ogni riga dell\'header References deve restare entro 76 caratteri');
    assert(refIds.length === 20, `La catena References deve essere limitata agli ultimi 20 Message-ID, ottenuti ${refIds.length}`);
    assert(refIds[0] === '<ref11@example.org>', `La finestra References deve conservare gli ID più recenti, ottenuto primo ID ${refIds[0]}`);
    assert(refIds[refIds.length - 1] === '<current@example.org>', 'L\'ultimo elemento References deve essere il Message-ID corrente');
  } finally {
    global.Utilities = originalUtilities;
    global.Session = originalSession;
    global.Gmail = originalGmail;
    global.GLOBAL_CACHE = originalGlobalCache;
  }
}


console.log('--- Test sendHtmlReply: non duplica Re su prefissi localizzati ---');
{
  const originalUtilities = global.Utilities;
  const originalSession = global.Session;
  const originalGmail = global.Gmail;
  let rawPayload = '';

  try {
    global.Utilities = Object.assign({}, originalUtilities, {
      Charset: { UTF_8: 'utf8' },
      base64Encode: (input) => Buffer.from(String(input || ''), 'utf8').toString('base64'),
      base64EncodeWebSafe: (input) => Buffer.from(String(input || ''), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
    });
    global.Session = {
      getEffectiveUser: () => ({ getEmail: () => 'parrocchia@example.org' }),
      getActiveUser: () => ({ getEmail: () => 'parrocchia@example.org' })
    };
    global.Gmail = {
      Users: {
        Messages: {
          send: ({ raw }) => {
            const normalized = String(raw || '').replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
            rawPayload = Buffer.from(padded, 'base64').toString('utf8');
          }
        }
      }
    };

    service.sendHtmlReply(
      { getThread: () => ({ getId: () => 'thread-local-prefix' }) },
      'Risposta test',
      {
        subject: 'Rif: Informazioni',
        senderEmail: 'utente@example.org',
        senderName: 'Utente',
        rfc2822MessageId: '<local-prefix@example.org>',
        existingReferences: '',
        recipientEmail: 'parrocchia@example.org',
        recipientCc: ''
      }
    );

    const subjectHeader = rawPayload.match(/Subject: ([^\r\n]+)/);
    const decodedSubject = subjectHeader && subjectHeader[1].startsWith('=?UTF-8?B?')
      ? Buffer.from(subjectHeader[1].replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, ''), 'base64').toString('utf8')
      : (subjectHeader ? subjectHeader[1] : '');
    assert(decodedSubject === 'Rif: Informazioni', `un prefisso Rif: esistente non deve diventare Re: Rif: (ottenuto ${decodedSubject})`);
  } finally {
    global.Utilities = originalUtilities;
    global.Session = originalSession;
    global.Gmail = originalGmail;
  }
}

console.log('--- Test sendHtmlReply: doppio fallback fallito rilancia errore ---');
{
  const originalAddLabelToThread = service.addLabelToThread;
  const labels = [];
  let replyCalls = 0;

  try {
    service.addLabelToThread = (_thread, label) => labels.push(label);

    const thread = {
      getId: () => 'thread-send-fail',
      getMessages: () => []
    };
    const message = {
      getThread: () => thread,
      reply: () => {
        replyCalls += 1;
        throw new Error(`reply-fail-${replyCalls}`);
      }
    };

    let threw = false;
    try {
      service.sendHtmlReply(message, 'Risposta test', {
        subject: 'Oggetto',
        senderEmail: 'utente@example.org',
        rfc2822MessageId: '<msg@example.org>',
        existingReferences: '',
        recipientEmail: 'parrocchia@example.org',
        recipientCc: ''
      });
    } catch (e) {
      threw = /Fallback nativo: reply-fail-2/.test(e.message);
    }

    assert(threw, 'se API e fallback nativi falliscono, sendHtmlReply deve rilanciare');
    assert(replyCalls === 2, 'deve tentare fallback HTML e poi plain text');
    assert(labels.includes('Errore'), 'deve applicare la label Errore prima di rilanciare');
  } finally {
    service.addLabelToThread = originalAddLabelToThread;
  }
}

console.log('--- Test sendHtmlReply: MIME UTF-8 robusto senza Utilities.Charset ---');
{
  const originalUtilities = global.Utilities;
  const originalSession = global.Session;
  const originalGmail = global.Gmail;
  let rawPayload = '';

  const toBuffer = (input) => {
    if (Array.isArray(input)) return Buffer.from(input);
    if (Buffer.isBuffer(input)) return input;
    return Buffer.from(String(input || ''), 'utf8');
  };

  try {
    global.Utilities = {
      base64Encode: (input) => toBuffer(input).toString('base64'),
      base64EncodeWebSafe: (input) => toBuffer(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, ''),
      newBlob: (input) => ({
        getBytes: () => Array.from(toBuffer(input))
      })
    };
    global.Session = {
      getEffectiveUser: () => ({ getEmail: () => 'parrocchia@example.org' }),
      getActiveUser: () => ({ getEmail: () => 'parrocchia@example.org' })
    };
    global.Gmail = {
      Users: {
        Messages: {
          send: ({ raw }) => {
            const normalized = String(raw || '').replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
            rawPayload = Buffer.from(padded, 'base64').toString('utf8');
          }
        }
      }
    };

    service.sendHtmlReply(
      { getThread: () => ({ getId: () => 'thread-no-charset' }) },
      'Café e comunità',
      {
        subject: 'Oggetto con accento è',
        senderEmail: 'utente@example.org',
        senderName: 'Utente',
        rfc2822MessageId: '<charset@example.org>',
        existingReferences: '',
        recipientEmail: 'parrocchia@example.org',
        recipientCc: ''
      }
    );

    const plainPart = rawPayload.match(/Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/);
    const decodedPlainText = plainPart
      ? Buffer.from(plainPart[1].replace(/\s+/g, ''), 'base64').toString('utf8')
      : '';
    assert(rawPayload.includes('Subject:'), 'il RAW deve essere generato anche senza Utilities.Charset');
    assert(decodedPlainText.includes('Café e comunità'), 'il corpo UTF-8 deve essere codificato in base64 senza perdita');
  } finally {
    global.Utilities = originalUtilities;
    global.Session = originalSession;
    global.Gmail = originalGmail;
  }
}

console.log('--- Test sendHtmlReply: From fallback usa email estratta dal To ---');
{
  const originalUtilities = global.Utilities;
  const originalSession = global.Session;
  const originalGmail = global.Gmail;
  let rawPayload = '';

  try {
    global.Utilities = Object.assign({}, originalUtilities, {
      Charset: { UTF_8: 'utf8' },
      base64Encode: (input) => Buffer.from(String(input || ''), 'utf8').toString('base64'),
      base64EncodeWebSafe: (input) => Buffer.from(String(input || ''), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
    });
    global.Session = {
      getEffectiveUser: () => ({ getEmail: () => '' }),
      getActiveUser: () => ({ getEmail: () => '' })
    };
    global.Gmail = {
      Users: {
        Messages: {
          send: ({ raw }) => {
            const normalized = String(raw || '').replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
            rawPayload = Buffer.from(padded, 'base64').toString('utf8');
          }
        }
      }
    };

    service.sendHtmlReply(
      { getThread: () => ({ getId: () => 'thread-from-fallback' }) },
      'Risposta test',
      {
        subject: 'Oggetto',
        senderEmail: 'utente@example.org',
        rfc2822MessageId: '<msg@example.org>',
        existingReferences: '',
        recipientEmail: 'Parrocchia <parrocchia@example.org>, copia@example.org',
        recipientCc: ''
      }
    );

    assert(rawPayload.includes('From: parrocchia@example.org\r\n'), 'From deve usare una singola email valida estratta dal To');
  } finally {
    global.Utilities = originalUtilities;
    global.Session = originalSession;
    global.Gmail = originalGmail;
  }
}


console.log('--- Test sendHtmlReply: fallback nativo usa from alias stabile ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  let replyOptions = null;

  try {
    global.Session = {
      getEffectiveUser: () => ({ getEmail: () => 'admin@example.org' }),
      getActiveUser: () => ({ getEmail: () => 'admin@example.org' })
    };
    global.GmailApp = {
      getAliases: () => ['parrocchia@example.org']
    };

    const message = {
      getThread: () => ({ getId: () => 'thread-native-from' }),
      reply: (_body, options) => { replyOptions = options || {}; }
    };

    service.sendHtmlReply(message, 'Risposta test', {
      subject: 'Oggetto',
      senderEmail: 'utente@example.org',
      recipientEmail: 'Parrocchia <parrocchia@example.org>',
      recipientCc: ''
    });

    assert(replyOptions && replyOptions.from === 'parrocchia@example.org', 'fallback nativo deve impostare from con alias stabile autorizzato');
    assert(replyOptions && replyOptions.htmlBody, 'fallback nativo deve preservare htmlBody insieme a from');
  } finally {
    global.Session = originalSession;
    global.GmailApp = originalGmailApp;
  }
}

console.log('✅ Test extractMessageDetails robustezza passati');

console.log('--- Test Gmail counter: non usa ScriptLock per ogni chiamata e accorpa incrementi ---');
{
  const originalLockService = global.LockService;
  const originalPropertiesService = global.PropertiesService;
  let storedValue = null;
  let cacheGets = 0;
  let cachePuts = 0;

  try {
    global.LockService = {
      getScriptLock: () => ({
        tryLock: () => { throw new Error('lock contention'); },
        releaseLock: () => { throw new Error('release non atteso'); }
      })
    };
    delete global.PropertiesService;

    const counterService = new GmailService();
    counterService._scriptCache = {
      get: () => {
        cacheGets += 1;
        return storedValue || '41';
      },
      put: (_key, value) => {
        cachePuts += 1;
        storedValue = value;
      }
    };
    counterService._gmailDailyCallLimit = 100;
    counterService._gmailDailyCounterWarnAt = 90;

    counterService._incrementGmailCallCounterOrThrow_('messages.get');
    counterService._incrementGmailCallCounterOrThrow_('messages.get');
    counterService._incrementGmailCallCounterOrThrow_('messages.get');
    counterService._incrementGmailCallCounterOrThrow_('messages.get');

    assert(storedValue === '42', 'counter Gmail deve persistere subito la baseline iniziale');
    assert(cacheGets === 1 && cachePuts === 1, 'counter Gmail deve accorpare in memoria gli incrementi successivi alla baseline');
  } finally {
    global.LockService = originalLockService;
    global.PropertiesService = originalPropertiesService;
  }
}

console.log('--- Test cleanup Drive: coda persistente file temporanei ---');
{
  const originalPropertiesService = global.PropertiesService;
  const originalDrive = global.Drive;
  const props = {};
  const removed = [];

  try {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: (key) => Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null,
        setProperty: (key, value) => { props[key] = value; },
        deleteProperty: (key) => { delete props[key]; }
      })
    };
    global.Drive = {
      Files: {
        remove: (id) => { removed.push(id); }
      }
    };

    const cleanupService = new GmailService();
    cleanupService._rememberTemporaryDriveFile_('tmp-1');
    cleanupService._rememberTemporaryDriveFile_('tmp-2');
    cleanupService._forgetTemporaryDriveFile_('tmp-1');

    const queue = JSON.parse(props.TEMP_DRIVE_FILE_QUEUE_V1);
    assert(queue.length === 1 && queue[0].id === 'tmp-2', 'la coda deve mantenere solo il file non cancellato');

    cleanupService._cleanupQueuedTemporaryDriveFiles_();

    assert(removed.length === 1 && removed[0] === 'tmp-2', 'cleanup deve rimuovere il file temporaneo rimasto in coda');
    assert(!Object.prototype.hasOwnProperty.call(props, 'TEMP_DRIVE_FILE_QUEUE_V1'), 'la coda deve essere svuotata dopo cleanup riuscito');
  } finally {
    global.PropertiesService = originalPropertiesService;
    global.Drive = originalDrive;
  }
}

console.log('--- Test cleanup OCR orfani: rispetta limite runtime ---');
{
  const originalDrive = global.Drive;
  const originalConfig = global.CONFIG;
  const originalDateNow = Date.now;
  const removed = [];
  let listCalls = 0;
  const nowValues = [0, 0, 100, 200, 2000];

  try {
    global.CONFIG = Object.assign({}, originalConfig, {
      OCR_ORPHAN_MAX_AGE_HOURS: 6,
      OCR_CLEANUP_MAX_RUNTIME_MS: 1000
    });
    Date.now = () => nowValues.length ? nowValues.shift() : 2000;
    global.Drive = {
      Files: {
        list: () => {
          listCalls++;
          return {
            items: [{ id: 'ocr-1' }, { id: 'ocr-2' }],
            nextPageToken: 'next-page'
          };
        },
        remove: (id) => { removed.push(id); }
      }
    };

    const service = new GmailService();
    service._cleanupOrphanedOcrFiles();

    assert(listCalls === 1, 'cleanup OCR deve fermarsi prima di richiedere pagine ulteriori se supera il limite runtime');
    assert(removed.length === 1 && removed[0] === 'ocr-1', 'cleanup OCR deve interrompersi durante la pagina rispettando il limite runtime');
  } finally {
    global.Drive = originalDrive;
    global.CONFIG = originalConfig;
    Date.now = originalDateNow;
  }
}


console.log('--- Test extractMessageDetails normalizza chiavi header preservando valori ---');
{
  const serviceWithHeaders = new GmailService();
  serviceWithHeaders._getMessageMetadataWithResilience = () => ({
    payload: {
      headers: [
        { name: ' Auto-Submitted ', value: 'Auto-Replied' },
        { name: 'Message-ID', value: '<Msg.MixedCase@example.org>' },
        { name: 'References', value: '<Prev.One@example.org>' }
      ]
    }
  });
  const message = {
    getSubject: () => 'Oggetto',
    getFrom: () => 'Utente <utente@example.org>',
    getDate: () => new Date('2026-05-13T10:00:00Z'),
    getPlainBody: () => 'Corpo',
    getBody: () => '<p>Corpo</p>',
    getId: () => 'msg-header-test',
    getReplyTo: () => '',
    getTo: () => 'bot@example.org',
    getCc: () => ''
  };
  const details = serviceWithHeaders.extractMessageDetails(message);
  assert(details.headers['auto-submitted'] === 'Auto-Replied', 'chiave Auto-Submitted deve essere normalizzata e valore preservato');
  assert(details.rfc2822MessageId === '<Msg.MixedCase@example.org>', 'Message-ID deve preservare il casing del valore');
  assert(details.existingReferences === '<Prev.One@example.org>', 'References deve preservare il casing del valore');
  assert(details.isNewsletter === true, 'Auto-Replied deve continuare a essere rilevato in modo case-insensitive');
}

console.log('✅ Tutti i test di GmailService sono passati');
