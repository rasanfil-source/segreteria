// Regressioni audit: nessuna chiamata a Gmail reale.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const properties = new Map();
const context = {
  console,
  CONFIG: {},
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, value)
  }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'bot@example.org' }) },
  GmailApp: { getAliases: () => [], getThreadById: id => ({ getId: () => id }) }
};
vm.createContext(context);
for (const name of ['gas_gmail_service.js', 'gas_error_types.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), context);
}
vm.runInContext(`
  const service = new GmailService();
  service._getOptionalLabelIdByName = name => name ? 'Label_' + name : null;
  const oldPending = { id: 'pending', threadId: 'pending-thread' };
  const pages = [0, 1, 2].map(page => Array.from({length: 150}, (_, i) => ({
    id: 'handled-' + (page * 150 + i), threadId: 'handled-thread-' + (page * 150 + i)
  })));
  pages.push([oldPending]);
  let requestedPages = [];
  service._listMessagesWithResilience = params => {
    const page = Number(params.pageToken || 0);
    requestedPages.push(page);
    return { messages: pages[page], nextPageToken: page < 3 ? String(page + 1) : null };
  };
  const blacklist = new Set(pages.slice(0, 3).flat().map(message => message.id));
  const discover = () => service.getUnprocessedUnreadThreads('IA', 'Errore', 'Verifica', 150, 50, 3, null, {
    blacklistMessageIds: blacklist, blacklistPreloaded: true, blacklistComplete: true
  });
  globalThis.discoveryResults = [discover().length, discover().length];
  globalThis.requestedPages = requestedPages;

  service._base64EncodeUtf8_ = () => 'dGVzdA==';
  service._base64UrlEncodeUtf8_ = () => 'dGVzdA';
  service._incrementGmailCallCounterOrThrow_ = () => {};
  let apiAttempts = 0;
  let nativeAttempts = 0;
  globalThis.Gmail = { Users: { Messages: { send: () => {
    apiAttempts++;
    throw new Error('Service unavailable');
  } } } };
  const message = {
    getId: () => 'm1', getThread: () => ({ getId: () => 't1' }),
    reply: () => { nativeAttempts++; }
  };
  let sendError = null;
  try { service.sendHtmlReply(message, 'Risposta di prova', {
    rfc2822MessageId: '<original@example.org>', subject: 'Informazioni',
    senderEmail: 'sender@example.org', recipientEmail: 'bot@example.org'
  }); } catch (error) { sendError = error.message; }
  globalThis.sendResults = { apiAttempts, nativeAttempts,
    sendError, classification: classifyError(new Error('Service unavailable')).type };
`, context);
assert.deepStrictEqual(Array.from(context.discoveryResults), [0, 1]);
assert.deepStrictEqual(Array.from(context.requestedPages), [0, 1, 2, 3]);
assert.strictEqual(context.sendResults.nativeAttempts, 0);
assert.match(context.sendResults.sendError, /ambiguo/);
assert.strictEqual(context.sendResults.classification, 'NETWORK');
console.log('REPRO 1:', JSON.stringify({ results: context.discoveryResults, pages: context.requestedPages,
  pendingOnPage4: true }));
console.log('REPRO 2:', JSON.stringify(context.sendResults));

properties.clear();
vm.runInContext(`
  // Il tetto metadata interrompe la prima pagina prima del messaggio pendente.
  service._getMetadataDiscoveryGetLimit_ = () => 2;
  service._listMessagesWithResilience = () => ({ messages: [
    {id: 'a', threadId: 'ta'}, {id: 'b', threadId: 'tb'}, {id: 'c', threadId: 'tc'}
  ] });
  service._getMessageMetadataWithResilience = id => ({ labelIds: id === 'c' ? ['UNREAD'] : ['UNREAD', 'Label_IA'] });
  globalThis.partialResults = [
    service.getUnprocessedUnreadThreads('IA', 'Errore', 'Verifica', 150, 50, 3).length,
    service.getUnprocessedUnreadThreads('IA', 'Errore', 'Verifica', 150, 50, 3).length
  ];
  globalThis.finalCursor = JSON.parse(PropertiesService.getScriptProperties().getProperty('gmail_discovery_cursor_metadata'));
  for (const text of ['Service unavailable', 'backend error', 'internal error', 'connection reset', '503']) {
    Gmail.Users.Messages.send = () => { throw new Error(text); };
    try { service.sendHtmlReply(message, 'Risposta', {rfc2822MessageId: '<m@example.org>', senderEmail: 'user@example.org'}); }
    catch (_) {}
  }
  globalThis.nativeAfterErrors = nativeAttempts;
`, context);
assert.deepStrictEqual(Array.from(context.partialResults), [0, 1]);
assert.strictEqual(context.finalCursor.pageToken, null);
assert.strictEqual(context.nativeAfterErrors, 0);
console.log('OK: avanzamento pagina parziale, reset a fine scansione, blocco fallback per errori ambigui');

properties.clear();
vm.runInContext(`
  // Limite thread: nessun salto dei candidati nella pagina parzialmente visitata.
  service._getMetadataDiscoveryGetLimit_ = () => 120;
  service._getMessageMetadataWithResilience = () => ({labelIds: ['UNREAD']});
  globalThis.targetLimited = [0, 1, 2].map(() =>
    service.getUnprocessedUnreadThreads('IA', 'Errore', 'Verifica', 150, 1, 3)[0].getId());

  CONFIG.MESSAGE_DISCOVERY_MODE = 'query';
  const offsets = [];
  GmailApp.search = (query, offset, size) => {
    offsets.push(offset);
    return ['q0', 'q1', 'q2'].slice(offset, offset + size).map(id => ({
      getId: () => id, getMessages: () => [{getId: () => id, isUnread: () => true}]
    }));
  };
  service._refreshThreadForUnreadDiscovery_ = () => {};
  service._filterUnreadMessagesForDiscovery_ = messages => messages;
  globalThis.queryResults = [0, 1, 2].map(() =>
    service.getUnprocessedUnreadThreads('IA', 'Errore', 'Verifica', 150, 1, 3)[0].getId());
  globalThis.queryOffsets = offsets;
  globalThis.queryCursor = JSON.parse(PropertiesService.getScriptProperties().getProperty('gmail_discovery_cursor_query'));
  CONFIG.MESSAGE_DISCOVERY_MODE = 'metadata';

  // Il fallback resta disponibile per rifiuti espliciti, senza esito ambiguo.
  Gmail.Users.Messages.send = () => { throw new Error('Invalid argument: malformed header'); };
  service.sendHtmlReply(message, 'Risposta', {rfc2822MessageId: '<m@example.org>', senderEmail: 'user@example.org'});
  globalThis.nativeAfterDefiniteFailure = nativeAttempts;
`, context);
assert.deepStrictEqual(Array.from(context.targetLimited), ['ta', 'tb', 'tc']);
assert.deepStrictEqual(Array.from(context.queryResults), ['q0', 'q1', 'q2']);
assert.deepStrictEqual(Array.from(context.queryOffsets), [0, 1, 2]);
assert.strictEqual(context.queryCursor.offset, 0);
assert.strictEqual(context.nativeAfterDefiniteFailure, 1);
console.log('OK: limite thread, avanzamento query e fallback per rifiuto definitivo');
