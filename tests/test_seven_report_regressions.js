const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({console: {log(){}, warn(){}, error(){}}, CONFIG: {}, GLOBAL_CACHE: {}});
for (const file of ['gas_classifier.js', 'gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx);
}
const p = Object.create(ctx.EmailProcessor.prototype), c = new ctx.Classifier();
const cache = new Map();
ctx.CacheService = {getScriptCache: () => ({get: k => cache.get(k), put: (k,v) => cache.set(k,v)})};
assert.equal(p._acquireThreadLock('a').ok, true);
assert.equal(p._acquireThreadLock('a').reason, 'thread_locked');
ctx.LockService = {getScriptLock: () => ({tryLock: () => false})};
assert.equal(p._acquireThreadLock('b').reason, 'global_lock_unavailable');
assert.equal(cache.has('thread_lock_b'), false);

p._getPersonalIgnoreSenders_ = () => [];
ctx.CONFIG.IGNORE_DOMAINS = ['marketing', 'blocked.example', 'marketing@explicit.example'];
for (const [senderEmail, expected] of [['marketing@example.org', false], ['info@example.org', false],
  ['newsletter@example.org', true], ['marketing@explicit.example', true], ['a@sub.blocked.example', true]]) {
  assert.equal(p._shouldIgnoreEmail({senderEmail, subject: 'Richiesta', body: 'Vorrei informazioni sugli orari'}), expected, senderEmail);
}
const unrelated = 'Iscrizioni Grest: dal 15 maggio al 30 giugno\nCampo estivo: dal 5 luglio al 12 luglio\nChiusura segreteria: dal 10 agosto al 20 agosto';
assert.equal(p._extractSummerScheduleRange_(unrelated, 2026), null);
for (const title of ['Orario estivo delle S. Messe', 'Orario Messe (estivo)', 'Messe estive', 'Periodo estivo']) {
  const range = p._extractSummerScheduleRange_(unrelated + '\n' + title + '\n\nDal 29 giugno al 30 settembre', 2026);
  assert.equal(range.start.getMonth(), 5, title);
  assert.equal(range.start.getDate(), 29, title);
}
p._getBusinessDateString = () => '2026-10-03';
for (const responseText of ['La segreteria di S. Eugenio è aperta dalle 16:00 alle 19:00. Chiamare il tel. 0612345678 per informazioni.',
  'Don G. Rossi celebra la S. Messa alle 18.30. Mons. Bianchi incontra la Sig.ra Rossi alle 19.00.']) {
  assert.equal(p._buildMemorySummary({responseText}), '• [2026-10-03] ' + responseText);
}
const now = Date.now(), day = 86400000;
p._getSendIdempotencyBackupTtlMs_ = () => day;
const values = new Map([
  ['send_uncertain_old', String(now - 8 * day)], ['send_uncertain_recent', String(now - day)],
  ['send_uncertain_boundary', String(now - 7 * day)], ['send_uncertain_bad', 'broken'],
  ['send_uncertain_confirmed', String(now)], ['sent_backup_confirmed', JSON.stringify({ts: now, expiresAt: now + day})]
]);
const props = {getProperties: () => Object.fromEntries(values), deleteProperty: k => values.delete(k),
  getProperty: k => values.get(k), setProperty: (k,v) => values.set(k,v)};
p._pruneExpiredSendIdempotencyBackups_(props, now);
assert.equal(values.has('send_uncertain_old'), true);
assert.equal(values.has('send_uncertain_bad'), true);
assert.equal(values.has('send_uncertain_confirmed'), false);
assert.equal(values.has('send_uncertain_recent'), true);
assert.equal(values.has('send_uncertain_boundary'), true);
// Il limite di manutenzione resta valido sui backup confermati scaduti.
for (let i = 0; i < 25; i++) values.set('sent_backup_expired' + i, JSON.stringify({ts: now - 2 * day, expiresAt: now - day}));
const sizeBefore = values.size;
p._pruneExpiredSendIdempotencyBackups_(props, now);
assert.equal(sizeBefore - values.size, 20);

let created = 0;
ctx.CONFIG.BATCH_CHECKPOINT_MAX_RETRIES = 3;
p._getProperties_ = () => props;
ctx.ScriptApp = {getProjectTriggers: () => [], deleteTrigger(){}, newTrigger: () => ({timeBased(){return this;}, after(){return this;}, create(){created++; return {};}})};
const threads = [{getId: () => 'pending'}];
p._storeBatchCheckpointAndScheduleContinuation_(threads, 0, 5000);
p._storeBatchCheckpointAndScheduleContinuation_(threads, 0, 5000);
assert.equal(created, 2);
p._storeBatchCheckpointAndScheduleContinuation_(threads, 0, 5000);
assert.equal(created, 3);
assert.equal(values.has('EMAIL_BATCH_CHECKPOINT'), true);
p._storeBatchCheckpointAndScheduleContinuation_(threads, 0, 5000);
assert.equal(created, 3);
assert.equal(values.has('EMAIL_BATCH_CHECKPOINT'), false);
values.set('EMAIL_BATCH_CHECKPOINT', JSON.stringify({pendingThreadIds:['old'], pendingCount:1, retryCount:30}));
p._storeBatchCheckpointAndScheduleContinuation_(threads, 0, 5000);
assert.equal(JSON.parse(values.get('EMAIL_BATCH_CHECKPOINT')).retryCount, 1);

for (const prefix of ['Re', 'Rif', 'AW', 'FW', 'Fwd', 'TR', 'I', 'WG', 'INC']) {
  const subject = prefix + ': Certificato di battesimo';
  const inferred = /^(Re|Rif|AW)$/.test(prefix);
  const expected = JSON.stringify(c.classifyEmail(subject, '', inferred, 'person@example.org'));
  for (const args of [[subject, ''], [subject, '', 'person@example.org'], [subject, '', undefined, 'person@example.org'], [subject, '', null, 'person@example.org']]) {
    assert.equal(JSON.stringify(c.classifyEmail(...args)), expected, prefix);
  }
}
for (const header of ['il giorno 3 ottobre 2026 Mario <mario@example.org>\nha scritto:',
  'ON October 3, 2026 Mario\n<mario@example.org>\nWROTE:',
  'LE 3 octobre 2026 Mario <mario@example.org>\nA ÉCRIT:']) {
  for (const newline of ['\n', '\r\n']) {
    const body = ('Quando posso venire?\n\n' + header + '\nVecchio contenuto').replace(/\n/g, newline);
    assert.equal(c._extractMainContent(body).trim(), 'Quando posso venire?');
  }
}
assert.equal(c._extractMainContent('Il giorno seguente\nvorrei venire in segreteria.'), 'Il giorno seguente\nvorrei venire in segreteria.');
console.log('Seven reported regressions: OK');
