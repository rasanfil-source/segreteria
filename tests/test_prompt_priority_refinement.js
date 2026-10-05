const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const ctx = vm.createContext({ console: quiet, createLogger: () => quiet });
for (const file of ['gas_config.js', 'gas_response_strategy.js', 'gas_prompt_engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
const engine = vm.runInContext('new PromptEngine()', ctx);
const base = { emailSubject: 'Informazioni', emailContent: 'Quali documenti servono?',
  knowledgeBase: 'La segreteria riceve il lunedì.', detectedLanguage: 'it', currentDate: '2026-10-05' };
const grief = engine.buildPrompt({ ...base, category: 'bereavement', topic: 'lutto',
  subIntents: { bereavement: true }, emailContent: 'È morto mio padre. Avete uno streaming per il funerale?' });
assert(!grief.toString().includes('si informerà e darà seguito'));
assert(!grief.toString().includes('si impegna a procurare'));
assert(grief.systemInstruction.includes('Sul piano stilistico'));
assert(grief.toString().includes('solo se autorizzato dalla KB'));
for (const [kbSize, coreSize] of [[40000, 65000], [55000, 50000]]) {
  const kb = 'KB_SENTINEL La segreteria riceve il lunedì.\n' + 'Informazioni parrocchiali verificate.\n'.repeat(Math.ceil(kbSize / 37));
  const prompt = engine.buildPrompt({ ...base, knowledgeBase: kb, category: 'pastoral',
    requestType: { type: 'mixed', needsDiscernment: true },
    aiCore: 'CORE_SENTINEL\n' + 'Principi pastorali di ascolto e rispetto.\n'.repeat(Math.ceil(coreSize / 41)),
    emailContent: 'Quali documenti servono? ' + 'Informazioni personali. '.repeat(330) });
  assert(prompt.length <= 120000);
  assert(prompt.prompt.includes('Quali documenti servono?'));
  // Il reducer legacy può tagliare un modulo: non dichiararlo integralmente caricato.
  assert(!prompt.systemInstruction.includes('aiCore=true'));
}
const nominal = engine.buildPrompt({ ...base, requestType: { type: 'pastoral', needsDiscernment: true }, aiCore: 'CORE_SENTINEL ascolto.' });
assert(nominal.prompt.includes('CORE_SENTINEL'));
assert(nominal.systemInstruction.includes('aiCore=true'));
const oversized = engine.buildPrompt({ ...base, requestType: { type: 'pastoral', needsDiscernment: true }, aiCore: 'CORE_SENTINEL '.repeat(15000) });
assert(!oversized.prompt.includes('CORE_SENTINEL'));
assert(!oversized.systemInstruction.includes('aiCore=true'));
const state = { responseFocusHint: 'answer_only_residual_question', responseFocusHintConfidence: .95,
  updatedAt: new Date().toISOString(), appliesToTopic: 'matrimonio' };
for (const [topic, updatedAt, applies] of [['catechismo', state.updatedAt, false], ['matrimonio', '2020-01-01T12:00:00Z', false], ['matrimonio', state.updatedAt, true]]) {
  const prompt = engine.buildPrompt({ ...base, topic, memoryContext: { conversationState: { ...state, updatedAt } } });
  assert.equal(prompt.systemInstruction.includes('thread_focus_guidance'), applies);
  assert.equal(prompt.systemInstruction.includes('memory_response_focus_hint'), applies);
  assert.equal(prompt.systemInstruction.includes('## CONTINUITÀ DEL THREAD'), applies);
}
console.log('Conditional commitments and actual decision-frame contents passed');
