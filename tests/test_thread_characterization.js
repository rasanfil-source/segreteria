const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runScenario } = require('./helpers/thread_scenario');
const root = path.join(__dirname, '..');
const componentCalls = new Map();
const scenarios = {
  ordinary: {}, burst: { burst: true }, mixed_senders: { burst: true, otherSender: true },
  history: { history: true }, already_labeled: { labeled: true }, own_only: { ownOnly: true },
  own_last: { burst: true, ownLast: true }, stale: { stale: true }, lock_denied: { lockDenied: true },
  italian_foreign_only: { foreignOnly: true }, foreign: { foreignOnly: true, language: 'en' },
  ai_italian: { foreignOnly: true, language: 'en', quickLanguage: 'it' },
  newsletter: { newsletter: true }, auto_reply: { autoReply: true },
  out_of_office: { body: 'Sono assente, risposta automatica.' },
  classifier_reject: { classifierReject: true }, quick_reject: { burst: true, quickReject: true },
  quick_null: { quickNull: true }, quick_network: { quickError: 'Network error' },
  quick_fatal: { quickError: 'Bad request 400' },
  dry_run: { dryRun: true }, attachment: { attachment: true, body: 'Ecco il modulo compilato.' },
  ocr_formal: { attachment: true, body: 'In allegato il documento', ocr: 'Richiesta di sbattezzo e apostasia firmata dal richiedente.' },
  attachment_read_error: { attachmentReadError: true }, near_deadline: { nearDeadline: true },
  generation_network: { generationError: 'Network error' }, no_reply: { response: 'NO_REPLY' },
  truncated: { response: '<email>Risposta incompleta' }, retry: { retry: true },
  invalid: { invalid: true }, retry_network: { retry: true, retryError: 'Network error' },
  retry_permanent: { retry: true, retryError: 'Bad request 400' }, warning: { warning: true },
  send_failure: { sendError: 'Bad request 400' }, send_uncertain: { sendError: 'Network error' },
  send_reconciled: { sendError: 'Network error', reconciled: true },
  commit_failure: { commitError: true }, mark_failure: { markError: true },
  cleanup_failure: { cleanupError: true }, memory_failure: { memoryError: true },
  territory: { subject: 'Appartenenza parrocchiale', body: 'Via Roma fa parte della vostra parrocchia?' },
  crisis: { crisis: true }, already_sent: { alreadySent: true }, uncertain_marker: { uncertainMarker: true },
  confirmed_duplicate: { duplicate: true }, repeat_confirmed: { repeat: true }, throttled: { throttled: true },
  metadata_terminal: { metadataTerminal: true }, alias_sender: { sender: 'alias@example.org' },
  noreply: { sender: 'noreply@example.org' }, empty_italian_subject: { foreignOnly: true, body: '' },
  same_date_reversed: { burst: true, sameDate: true, reverse: true },
  fallback_generation: { firstGenerationError: 'Network error' }, self_healing: { selfHeal: true },
  attachment_burst_limits: { attachment: true, burst: true, body: 'In allegato il modulo', attachmentSettings: { maxFiles: 1, maxTotalChars: 12 } },
  attachment_lookback: { lookBack: true, body: 'Come da documento già inviato, quali passi devo seguire?' },
  attachment_crash: { attachment: true, attachmentProcessError: true, body: 'Ecco il modulo' },
  document_missing: { quick: { document_delivery: { expected_document: true, delivery_channel: 'attachment', expected_document_description: 'scheda di iscrizione' } } },
  semantic_mismatch: { attachment: true, mismatch: true, body: 'In allegato il programma', ocr: 'Catalogo di profumi con listino prezzi', quick: { document_delivery: { expected_document: true, delivery_channel: 'attachment', expected_document_description: 'programma del corso prematrimoniale' } } },
  taxonomy_mismatch: { attachment: true, body: 'Invio in allegato il certificato di battesimo.', ocr: 'Certificato di matrimonio degli sposi' },
  receipt_only: { attachment: true, body: 'Invio in allegato la scheda compilata.', ocr: 'Scheda iscrizione catechismo Nome: Mario Cognome: Rossi' },
  ocr_formal_routing: { attachment: true, subject: 'Modulo allegato', body: 'Allego il modulo.', ocr: 'Modulo sbattezzo - richiesta cancellazione dal registro battesimo.' },
  session_memory: { history: true, memory: { exists: true, lastUpdated: '2026-09-25T09:55:00.000Z', messageCount: 2, category: 'pastoral', memorySummary: 'Colloquio richiesto', providedInfo: ['contatti'] } }
};
const sourceRoot = process.argv.includes('--record-baseline') ? path.join(root, 'outputs', 'process-thread-baseline') : root;
const actual = Object.fromEntries(Object.entries(scenarios).map(([name, scenario]) => [name, runScenario(sourceRoot, scenario, { componentCalls })]));
const fixturePath = path.join(__dirname, 'fixtures', 'thread_baseline.json');
if (process.argv.includes('--record-baseline')) {
  assert(!fs.existsSync(fixturePath), 'Baseline is immutable; do not overwrite it after extraction');
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, JSON.stringify(actual, null, 2) + '\n');
}
const originalExpected = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const expected = JSON.parse(JSON.stringify(originalExpected));
if (!process.argv.includes('--record-baseline')) {
  // Audit correction #4: explicitly approved changes to the original immutable fixture.
  // All other results, prompts and service effects must remain byte-for-byte identical.
  const lookback = expected.attachment_lookback;
  assert.equal(lookback.effects[6][0], 'attachments.read');
  lookback.effects.splice(6, 1); // bypass the text-only guard before any file lookup
  const markerWrites = lookback.effects.filter(([event, value]) => event === 'props.set' && value[0].startsWith('duplicate_reply_v1_'));
  assert.equal(markerWrites.length, 1);
  lookback.effects = lookback.effects.filter(effect => effect !== markerWrites[0]);
  lookback.props = lookback.props.filter(([key]) => !key.startsWith('duplicate_reply_v1_'));
}
for (const [name, output] of Object.entries(actual)) {
  assert.deepStrictEqual(output, expected[name], `${name}: return value and ordered effects must match the workspace baseline`);
  assert(output.restored, `${name}: restore service loggers`);
}
const events = name => actual[name].effects.map(([event]) => event);
assert.equal(actual.ordinary.result.status, 'replied');
assert.equal(actual.dry_run.result.status, 'dry_run');
assert(!events('dry_run').includes('send'));
assert(events('ordinary').indexOf('send') < events('ordinary').indexOf('memory.update'));
assert.equal(events('retry').filter(name => name === 'generate').length, 2);
assert.equal(actual.send_uncertain.result.reason, 'gmail_send_uncertain');
assert.equal(actual.send_reconciled.result.reason, 'send_reconciled');
assert.equal(actual.commit_failure.result.status, 'replied');
assert.equal(events('commit_failure').filter(name => name === 'send').length, 1);
assert.equal(actual.memory_failure.result.status, 'replied');
assert(events('attachment').includes('attachments.process'));
assert.equal(actual.burst.effects.find(([name]) => name === 'extract')[1], 'm2');
assert.equal(events('burst').filter(name => name === 'label.processed').length, 2);
assert(!events('quick_network').includes('label.error'));
assert.equal(actual.confirmed_duplicate.result.reason, 'duplicate_already_replied');
assert(!events('confirmed_duplicate').includes('quickCheck'));
assert.equal(actual.already_sent.result.reason, 'already_sent_recently');
assert.equal(actual.uncertain_marker.result.reason, 'gmail_send_uncertain');
assert.equal(actual.crisis.result.reason, 'pastoral_crisis_human_review');
assert(!events('crisis').includes('generate'));
assert.equal(events('repeat_confirmed').filter(name => name === 'send').length, 1);
assert.equal(actual.same_date_reversed.effects.find(([name]) => name === 'extract')[1], 'm2');
assert(events('semantic_mismatch').includes('semantic.check'));
assert.equal(actual.semantic_mismatch.effects.find(([name]) => name === 'validate')[1][7].validationContext.documentMismatch.mode, 'semantic');
assert.equal(actual.ocr_formal_routing.effects.find(([name]) => name === 'prompt')[1].category, 'formal');
assert.equal(events('receipt_only').filter(name => name === 'validate').length, 0);
console.log(`Thread characterization: ${Object.keys(actual).length} deterministic scenarios match baseline plus explicit audit correction #4`);
if (!process.argv.includes('--record-baseline')) {
  assert(componentCalls.size > 0, 'Extracted components must actually load');
  assert.deepStrictEqual([...componentCalls].filter(([, count]) => count === 0), [], 'Every component entry point must be exercised');
  assert.deepStrictEqual(runScenario(root, scenarios.ordinary, { reverseLoad: true }), expected.ordinary,
    'GAS global declarations must support reverse file order');
  console.log(`Thread components: ${componentCalls.size} entry points exercised; reverse GAS loading also passes`);
}
if (process.argv.includes('--compare-workspace-baseline')) {
  const baselineRoot = path.join(root, 'outputs', 'process-thread-baseline');
  const manifest = JSON.parse(fs.readFileSync(path.join(baselineRoot, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  const crypto = require('crypto');
  for (const file of manifest) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(baselineRoot, file.Path))).digest('hex');
    assert.equal(hash.toUpperCase(), file.SHA256, `Restoration baseline changed: ${file.Path}`);
  }
  for (const [name, scenario] of Object.entries(scenarios)) {
    assert.deepStrictEqual(originalExpected[name], runScenario(baselineRoot, scenario), `${name}: immutable fixture still matches original workspace`);
  }
  console.log(`Verified ${manifest.length} restoration hashes and replayed all scenarios against the original workspace`);
}
module.exports = { scenarios };
