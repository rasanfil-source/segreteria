const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({console, CONFIG: {}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas_email_processor.js'), 'utf8'), ctx);
const processor = Object.create(ctx.EmailProcessor.prototype);
const message = (id, unread = false) => ({getId: () => id, isUnread: () => unread});
const recovered = message('recovered');
const native = message('native', true);
const read = message('read');
const metadataCalls = [];
processor.gmailService = {
  _getMetadataFallbackThreadCandidates_: () => [message('native'), message('read'), message('recovered'), message('outside')],
  _getMessageMetadataWithResilience: id => {
    metadataCalls.push(id);
    return {labelIds: id === 'read' ? [] : ['UNREAD']};
  }
};
const unread = processor._getUnreadMessagesForProcessing_([recovered, read, null, {}, message(''), native], {warn() {}});
assert.deepEqual(Array.from(unread), [recovered, native], 'Preserve source instances and order when fallback returns new proxies');
assert.deepEqual(metadataCalls, ['read', 'recovered', 'outside'], 'Native unread IDs need no metadata lookup');

for (const newline of ['\n', '\r\n']) {
  for (const body of ['come già\ninviato', 'come\ninviato', 'documento\nprecedente', 'modulo già\nallegato', 'file\ndi prima']) {
    assert.equal(processor._hasPastAttachmentReference_(body.replace(/\n/g, newline)), true, body);
  }
}
for (const body of ['', 'Invio un nuovo documento', 'come ' + 'x'.repeat(26) + '\ninviato', 'file ' + 'x'.repeat(31) + '\nprecedente']) {
  assert.equal(processor._hasPastAttachmentReference_(body), false, body);
}
JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'appsscript.json'), 'utf8'));
console.log('Unread proxy, attachment newlines and manifest checks passed');
