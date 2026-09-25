// Deterministic decision tables: every row has an oracle independent of validator output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = path.resolve(__dirname, '../gas_response_validator.js');
const sandbox = vm.createContext({
  console: { log() {}, warn() {}, error() {} },
  CONFIG: { SEMANTIC_VALIDATION: { enabled: false } }
});
vm.runInContext(fs.readFileSync(source, 'utf8'), sandbox, { filename: source });
const { ResponseValidator, SemanticValidator, normalizeValidationScore } = sandbox;
const v = new ResponseValidator();
let cases = 0;
function row(name, check) {
  try { check(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}
const bools = [false, true];

for (const [input, expected] of [[undefined, 0], [null, 0], [NaN, 0], [Infinity, 0], [-1, 0], [0, 0], [0.6, 0.6], [1, 1], [60, 0.6], [100, 1], [101, 1], ['60', 0.6], ['bad', 0]]) {
  row(`score ${input}`, () => assert.equal(normalizeValidationScore(input), expected));
}
for (const [length, score, errors, warnings] of [
  [0, 0, 1, 0], [24, 0, 1, 0], [25, 0.85, 0, 1], [26, 0.85, 0, 1],
  [79, 0.85, 0, 1], [80, 1, 0, 0], [81, 1, 0, 0],
  [4499, 1, 0, 0], [4500, 1, 0, 0], [4501, 0.85 - 0.25 / 1500, 0, 1],
  [5999, 0.65, 0, 1], [6000, 0.65, 0, 1], [6001, 0, 1, 0]
]) for (const pad of ['', ' \n ']) row(`length ${length}, padding=${!!pad}`, () => {
  const result = v._checkLength(pad + 'a'.repeat(length) + pad);
  assert.equal(result.length, length);
  assert.equal(result.score, score);
  assert.equal(result.errors.length, errors);
  assert.equal(result.warnings.length, warnings);
});

const signatures = ["Segreteria Parrocchia Sant'Eugenio", "Parish secretariat of Sant'Eugenio", 'Secretaría parroquial', "Secretaria paroquial Sant'Eugenio", "Secrétariat paroissial Sant'Eugenio", "Pfarrsekretariat Sant'Eugenio"];
for (const mode of ['full', 'soft', 'session', 'none_or_continuity']) for (const signature of ['', ...signatures]) row(`signature ${mode}/${signature}`, () => {
  const expected = signature || ['session', 'none_or_continuity'].includes(mode) ? 1 : 0.95;
  assert.equal(v._checkSignature(signature, mode).score, expected);
});

for (const [token, blocked] of [['XXX', true], ['TODO', true], ['todo', false], ['xxx', false], ['[NOME]', true], ['[DATA]', true], ['[PARROCCHIA]', false], ['[RIENTRA]', false], ['[NON RIENTRA]', false], ['[...]', true], ['...', false], ['<insert>', true], ['tbd', true], ['placeholder', true], ['myplaceholderword', false]]) {
  for (const forbidden of bools) for (const prudent of bools) row(`content ${token}/${forbidden}/${prudent}`, () => {
    const result = v._checkForbiddenContent(`${token}. ${forbidden ? 'Non posso rispondere.' : ''} ${prudent ? 'Forse domani.' : ''}`);
    assert.equal(result.score, blocked ? 0 : forbidden ? 0.5 : 1);
    assert.equal(result.errors.length, Number(blocked) + Number(forbidden));
    assert.equal(result.warnings.length, Number(prudent));
  });
}

const greetings = {
  it: ['Buongiorno', 'Buon pomeriggio', 'Buonasera'],
  en: ['Good morning', 'Good afternoon', 'Good evening'],
  es: ['Buenos días', 'Buenas tardes', 'Buenas noches'],
  fr: ['Bonjour', 'Bon après-midi', 'Bonsoir'],
  de: ['Guten Morgen', 'Guten Tag', 'Guten Abend'],
  pt: ['Bom dia', 'Boa tarde', 'Boa noite']
};
for (const [language, texts] of Object.entries(greetings)) for (let hour = 0; hour < 24; hour++) for (let slot = 0; slot < 3; slot++) row(`greeting ${language}/${hour}/${slot}`, () => {
  const expectedSlot = hour < 5 || hour >= 19 ? 2 : hour < 13 ? 0 : 1;
  const result = v._checkTimeBasedGreeting(texts[slot] + ', grazie.', language, { currentTime: `${hour}:00` });
  assert.equal(result.score, slot === expectedSlot ? 1 : 0.97);
  assert.equal(result.warnings.length, Number(slot !== expectedSlot));
});
for (const invalid of ['24:00', '-1', '12:60', 'noon']) row(`invalid time ${invalid}`, () => {
  const result = v._checkTimeBasedGreeting('Buongiorno', 'it', { currentTime: invalid });
  assert.equal(result.skipped, true);
  assert.equal(result.score, 1);
});

const invitations = [
  ['Può venire in segreteria', 'Qualora le fosse possibile, '],
  ['Please visit the parish office', 'If possible, '],
  ['Puede venir a la parroquia', 'Si es posible, '],
  ['Vous pouvez venir au secretariat', 'Si possible, '],
  ['Sie konnen zum Pfarrburo kommen', 'Falls moglich, '],
  ['Pode vir a secretaria', 'Se possivel, ']
];
for (const key of ['physicalPresenceConstraint', 'physical_presence_constraint']) for (const active of bools) for (const policy of ['avoid_invitation', 'conditional_only']) for (const conditional of bools) for (const invite of bools) for (const [text, prefix] of invitations) row(`presence ${key}/${active}/${policy}/${conditional}/${invite}/${text}`, () => {
  const result = v._checkPhysicalPresenceConstraint(invite ? (conditional ? prefix : '') + text : 'Grazie, rispondiamo via email.', { [key]: { has_constraint: active, visit_policy: policy } });
  const blocked = active && invite && (policy === 'avoid_invitation' || !conditional);
  assert.equal(result.active, active);
  assert.equal(result.score, blocked ? 0 : 1);
  assert.equal(result.errors.length, Number(blocked));
});

// Exhaust every term of the attachment-template conjunctions, plus activation and prohibition.
for (const active of bools) for (const first of bools) for (const second of bools) for (const forbidden of bools) {
  for (const kind of ['documentMismatch', 'expectedDocumentMissing']) row(`document ${kind}/${active}/${first}/${second}/${forbidden}`, () => {
    const text = kind === 'documentMismatch'
      ? `${first ? "L'allegato ricevuto sembra non corrispondere." : ''} ${second ? 'Verificare e reinviare il documento corretto.' : ''} ${forbidden ? 'Con la dovuta prudenza.' : ''}`
      : `${first ? 'Non troviamo allegato né riportato nel testo.' : ''} ${second ? 'Reinviare o inserirne i dati nel corpo del messaggio.' : ''} ${forbidden ? 'Abbiamo ricevuto la documentazione.' : ''}`;
    const result = kind === 'documentMismatch'
      ? v._checkDocumentMismatchTemplate(text, { validationContext: { [kind]: { active } } })
      : v._checkExpectedDocumentMissingTemplate(text, { validationContext: { [kind]: { active } } });
    assert.equal(result.checked, active);
    assert.equal(result.score, active && (forbidden || !first || !second) ? 0 : 1);
    assert.equal(result.errors.length, active ? Number(forbidden) + Number(!first || !second) : 0);
  });
}
for (const received of bools) for (const uncertain of bools) for (const resend of bools) for (const falseMismatch of bools) for (const forbidden of bools) row(`unverified ${received}/${uncertain}/${resend}/${falseMismatch}/${forbidden}`, () => {
  const result = v._checkDocumentMismatchTemplate([
    received ? "Abbiamo ricevuto l'allegato." : '',
    uncertain ? 'Non possiamo confermare con certezza che corrisponda.' : '',
    resend ? 'Verificare e reinviare il file corretto.' : '',
    falseMismatch ? 'Il documento non corrisponde.' : '',
    forbidden ? 'Con la dovuta prudenza.' : ''
  ].join(' '), { validationContext: { documentMismatch: { active: true, mode: 'unverified_attachment' } } });
  assert.equal(result.score, (received && uncertain && resend) || falseMismatch || forbidden ? 0 : 1);
});

for (const active of bools) for (const formal of bools) for (const human of bools) for (const pastoral of bools) row(`sensitive ${active}/${formal}/${human}/${pastoral}`, () => {
  const result = v._checkSensitiveContinuityQuality(`La informiamo che deve presentare il documento. ${human ? 'Grazie.' : ''} ${pastoral ? 'Preghiamo per lei.' : ''}`, '', {
    validationContext: { activeConcerns: { relational_warmth: active }, responseRegister: formal ? 'formal_institutional' : '' }
  });
  assert.equal(result.active, active);
  assert.equal(result.errors.length, Number(active && formal && pastoral));
  assert.equal(result.warnings.length, Number(active && !formal && !human));
  assert.equal(result.score, !active ? 1 : formal && pastoral ? 0.5 : !formal && !human ? 0.85 : 1);
});

// Explicit semantic validity must never override evidence of an error.
const semantic = new SemanticValidator();
for (const explicit of [undefined, false, true]) for (const leak of bools) for (const examples of bools) for (const hallucination of bools) for (const irrelevant of bools) row(`semantic payload ${explicit}/${leak}/${examples}/${hallucination}/${irrelevant}`, () => {
  const result = semantic._normalizeSemanticPayload({ isValid: explicit, thinkingLeakDetected: leak, examples: examples ? ['leak'] : [], hallucinations: { dates: hallucination ? ['invented'] : [] }, irrelevantDetails: irrelevant ? ['off topic'] : [], confidence: 95 });
  assert.equal(result.isValid, explicit !== false && !leak && !examples && !hallucination && !irrelevant);
  assert.equal(result.confidence, 0.95);
});
for (const enabled of bools) for (const threshold of [0, 0.6, 0.9, 1]) for (const score of [0, 0.59, 0.6, 0.85, 0.89, 0.9, 1]) row(`semantic activation ${enabled}/${threshold}/${score}`, () => {
  semantic.enabled = enabled;
  semantic.activationThreshold = threshold;
  assert.equal(semantic.shouldRun(score), enabled && score < threshold);
});
for (const available of bools) for (const required of bools) for (const fallback of bools) for (const score of [0.59, 0.6, 0.84, 0.85, 0.9, 1]) row(`semantic outage ${available}/${required}/${fallback}/${score}`, () => {
  const s = new SemanticValidator();
  s.enabled = true;
  s.activationThreshold = 1;
  s.runtimeSemanticAvailable = available;
  s.fallbackOnError = fallback;
  s._generateSemantic = () => { throw new Error('simulated outage'); };
  // Errors force hallucination review even at score=1; thinking uses its threshold.
  const call = () => s.validateHallucinations('Response', 'KB', { score, errors: ['review'] }, 'Email', { forceRelevanceReview: required });
  if (available && !fallback) assert.throws(call, /simulated outage/);
  else assert.equal(call().isValid, !required && score >= 0.6);
  const thinking = () => s.validateThinkingLeak('Response', { score, errors: [] });
  if (available && !fallback && score < 1) assert.throws(thinking, /simulated outage/);
  else assert.equal(thinking().isValid, score >= 0.85);
});

console.log(`Validator decision matrices: ${cases} cases passed`);
