const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execFileSync } = require('child_process');

// --baseline measures the same scenarios against HEAD without altering the checkout.
const baseline = process.argv.includes('--baseline');
const root = path.join(__dirname, '..');
const sandbox = {
  console: { log() {}, warn() {}, error() {}, info() {} },
  CONFIG: { MAX_SAFE_TOKENS: 100000, MAX_SAFE_PROMPT_CHARS: 120000,
    KB_TOKEN_BUDGET_RATIO: 0.5, PROMPT_ENGINE: { OVERHEAD_TOKENS: 1000 } },
  createLogger: () => ({ info() {}, warn() {}, debug() {}, error() {} }),
  estimateTokenCount: text => Math.ceil(String(text || '').length / 4),
  Utilities: { formatDate: () => '2026-09-16' }
};
vm.createContext(sandbox);
for (const file of ['gas_response_strategy.js', 'gas_prompt_context.js', 'gas_prompt_engine.js',
  'gas_memory_service.js', 'gas_email_processor.js', 'gas_response_validator.js', 'gas_gemini_service.js']) {
  const code = baseline ? execFileSync('git', ['show', `HEAD:${file}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}
const api = vm.runInContext(`({
  context: input => createPromptContext(input), engine: new PromptEngine(),
  processor: Object.create(EmailProcessor.prototype), memory: Object.create(MemoryService.prototype),
  validator: new ResponseValidator(), quickMemory: input => EmailQuickCheckPolicy.renderQuickMemoryContext(input)
})`, sandbox);
const check = (ok, message) => { if (!baseline) assert.ok(ok, message); };
const report = [];
const longBody = 'Confermo di avere raccolto i documenti della pratica. '.repeat(20) +
  'Quali documenti devo inviare? Quando posso consegnarli? Serve un appuntamento?';
const variants = [
  ['short', 'Confermo l’orario delle 17.'],
  ['long', longBody],
  ['questions', 'Quali documenti servono? Quando posso ritirarli?'],
  ['remote', longBody, { physicalPresenceConstraint: { has_constraint: true, reconciled: true,
    type: 'mobility', visit_policy: 'avoid_invitation' } }],
  ['territory', longBody, { territory: { addressFound: true } }],
  ['en', 'Which documents should I send? When can I collect them?', { emailLanguage: 'en' }],
  ['fr', 'Quels documents dois-je envoyer ? Quand puis-je les retirer ?', { emailLanguage: 'fr' }]
];
for (const [name, body, extra = {}] of variants) {
  const input = {
    email: { subject: 'Documenti', body, isReply: true, detectedLanguage: extra.emailLanguage || 'it' },
    requestType: { type: 'technical' }, classification: { category: 'information', confidence: 1 },
    relationalPosture: 'direct', relationalPostureConfidence: 0.95,
    memory: { exists: true, contextualFlags: { bereaved: true }, memorySummary: 'Precedente lutto familiare.' },
    salutationMode: 'none_or_continuity', ...extra
  };
  const ctx = api.context(input);
  const prompt = String(api.engine.buildPrompt({
    emailSubject: input.email.subject, emailContent: body, detectedLanguage: input.email.detectedLanguage,
    knowledgeBase: 'Inviare i documenti via email. La segreteria confermerà la ricezione.',
    currentDate: new Date('2026-09-16T10:00:00Z'),
    requestType: input.requestType, category: 'information', relationalPosture: 'direct',
    memoryContext: input.memory, physicalPresenceConstraint: extra.physicalPresenceConstraint,
    activeConcerns: ctx.concerns, promptProfile: ctx.profile, ...ctx.meta
  }));
  // meta.activeConcerns is an array, as accepted by the renderer.
  check(ctx.concerns.residual_sensitivity, `${name}: residual sensitivity preserved`);
  check(ctx.meta.responseRegister === 'warm_institutional', `${name}: operational register`);
  check(ctx.meta.responseMode === 'longitudinal_tone_only', `${name}: implicit continuity`);
  check(ctx.meta.salutationMode === 'none_or_continuity', `${name}: no emotional salutation escalation`);
  check(!prompt.includes('Il mittente ha condiviso qualcosa di personale o delicato'), `${name}: no personal posture`);
  check(!prompt.includes('Riconosci la situazione prima'), `${name}: no demand to recognise past situation`);
  check(prompt.includes('senza richiamare né nominare'), `${name}: residual guard retained`);
  check(ctx.meta.continuityPolicy.doNotReopenPastContext, `${name}: continuity policy retained`);
  if (name === 'long') {
    check(ctx.concerns.multi_question && ctx.concerns.user_overload, 'complexity still recognised');
    check(ctx.meta.concernSynthesis.directive.includes('prosa breve e ben sequenziata'), 'overload guidance retained');
  }
  if (name === 'remote') check(ctx.meta.operationalConstraints.some(x => x.includes('presenza fisica')), 'mobility retained');
  report.push({ name, register: ctx.meta.responseRegister, mode: ctx.meta.responseMode,
    personal: prompt.includes('Il mittente ha condiviso qualcosa di personale o delicato'), chars: prompt.length });
}

// Current signals remain independent from historical sensitivity.
for (const [name, fields, expectedRegister, expectedMode] of [
  ['current bereavement', { classification: { category: 'information', subIntents: { bereavement: true } } }, 'pastoral_supportive', 'bereavement'],
  ['personal', { relationalPosture: 'personal', relationalPostureConfidence: 0.95 }, 'pastoral_supportive', 'pastoral_longitudinal'],
  ['formal', { requestType: { type: 'formal' } }, 'formal_institutional', 'formal_sensitive'],
  ['canonical', { requestType: { type: 'formal', isSbattezzo: true } }, 'formal_institutional', 'sensitive_canonical'],
  ['pastoral', { requestType: { type: 'pastoral' } }, 'pastoral_supportive', 'pastoral_longitudinal'],
  ['crisis', { email: { body: 'Sono in crisi, non so come andare avanti.', detectedLanguage: 'it' },
    classification: { category: 'emotional_support', subIntents: { emotional_distress: true } } }, 'pastoral_crisis', 'pastoral_longitudinal']
]) {
  const ctx = api.context({ email: { body: 'Desidero parlare della mia situazione.', detectedLanguage: 'it' },
    requestType: { type: 'technical' }, classification: { category: 'information' },
    memory: { contextualFlags: { bereaved: true } }, ...fields });
  check(ctx.meta.responseRegister === expectedRegister, `${name}: register preserved`);
  check(ctx.meta.responseMode === expectedMode, `${name}: mode preserved`);
}

// Repeated administrative turns must not turn bereavement history into an ongoing pastoral process.
let flags = { bereaved: true, remote_user: true, canonical_complexity: true };
for (let turn = 0; turn < 3; turn++) {
  const next = api.processor._deriveContextualFlagsUpdate_({ existingFlags: flags,
    classification: { category: 'information', subIntents: {} }, requestType: { type: 'technical' },
    activeConcerns: { longitudinal_sensitivity: true } });
  flags = api.memory._normalizeContextualFlags_(JSON.parse(api.memory._serializeContextualFlagsForSheet(
    api.memory._mergeContextualFlags_(flags, next))));
  check(flags.bereaved && flags.remote_user && flags.canonical_complexity, 'independent historical flags preserved');
  check(!flags.ongoing_pastoral_process, 'memory alone must not create another sensitive flag');
}
const pastoralFlags = api.processor._deriveContextualFlagsUpdate_({ requestType: { type: 'pastoral' } });
check(pastoralFlags.ongoing_pastoral_process, 'current pastoral request can still establish continuity');

const validationContext = { validationContext: { activeConcerns: { longitudinal_sensitivity: true, residual_sensitivity: true },
  continuityCase: { key: 'bereavement_continuity' }, responseRegister: 'warm_institutional' } };
const normal = api.validator._checkSensitiveContinuityQuality('Grazie, può inviare i documenti via email.', 'Quali documenti invio?', validationContext);
const reopened = api.validator._checkSensitiveContinuityQuality('Ci dispiace per il lutto. Invii i documenti.', 'Quali documenti invio?', validationContext);
check(normal.errors.length === 0, 'ordinary operational response passes sensitive check');
check(reopened.violations.includes('reopened_bereavement_context'), 'validator still detects improper reopening');
const quickMemory = api.quickMemory({ quickMemoryContext: {
  summary: 'Precedente lutto familiare.', contextualFlags: { bereaved: true }
} });
check(quickMemory.includes('Flag storici (non provano bisogni attuali): bereaved'), 'QuickCheck distinguishes historical flags');
check(quickMemory.includes('postura e subIntents sensibili vanno ricavati dal messaggio attuale'), 'QuickCheck anchors current sensitivity');
report.push({ name: 'quickMemory', chars: quickMemory.length });
console.log(JSON.stringify({ baseline, cases: report, finalFlags: flags }, null, 2));
console.log('Residual sensitivity regression checks complete.');
