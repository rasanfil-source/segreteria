// Prepara un confronto di prompting per il progetto GAS di collaudo, senza pubblicare o chiamare API.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const suite = require('../tests/fixtures/operational_procedure_cases.json');
const baselinePolicy = require('../tests/fixtures/operational_procedure_baseline');
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };

function loadEngines() {
  const candidate = fs.readFileSync(path.join(root, 'gas_prompt_engine.js'), 'utf8');
  const create = source => {
    const ctx = vm.createContext({ console: quiet, createLogger: () => quiet });
    for (const file of ['gas_config.js', 'gas_response_strategy.js']) {
      vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
    }
    vm.runInContext(source, ctx, { filename: 'gas_prompt_engine.js' });
    return new ctx.PromptEngine();
  };
  const baseline = create(candidate);
  baseline._renderRequestPurposePolicy_ = baselinePolicy;
  return { baseline, candidate: create(candidate),
    baselinePolicyHash: crypto.createHash('sha256').update(baselinePolicy.toString()).digest('hex'),
    candidateHash: crypto.createHash('sha256').update(candidate).digest('hex') };
}

function promptOptions(item, profile = 'standard') {
  const { id, purpose, criteria, ...input } = item;
  return { ...suite.defaults, ...input, promptProfile: profile,
    requestPurpose: { type: purpose, confidence: 0.96 } };
}

function buildComparison(engines) {
  return suite.cases.map(item => {
    const options = promptOptions(item);
    const before = engines.baseline.buildPrompt(options);
    const after = engines.candidate.buildPrompt(options);
    return { id: item.id, criteria: item.criteria,
      before: { systemInstruction: before.systemInstruction, prompt: before.prompt },
      after: { systemInstruction: after.systemInstruction, prompt: after.prompt },
      deltaChars: after.length - before.length };
  });
}

function buildGasHarness(engines, testScriptId) {
  if (!testScriptId) throw new Error('Manca il progetto GAS di collaudo.');
  const before = engines.baseline._renderRequestPurposePolicy_.toString();
  const after = 'function ' + engines.candidate._renderRequestPurposePolicy_.toString();
  return `// Collaudo A/B sul progetto donRaimondo: due generazioni e valutazione dal registro.
// I casi sono sintetici e le condizioni attese restano esterne ai prompt.
var COLLAUDO_OPERATIVO_CASO = 'guadalupe_una';
var COLLAUDO_OPERATIVO_PROFILO = 'standard';
var COLLAUDO_OPERATIVO_ORDINE = 'prima_dopo';
var COLLAUDO_OPERATIVO_PROGETTO = ${JSON.stringify(testScriptId)};
var COLLAUDO_OPERATIVO_DEFAULTS = ${JSON.stringify(suite.defaults)};
var COLLAUDO_OPERATIVO_CASI = ${JSON.stringify(suite.cases, null, 2)};
var COLLAUDO_OPERATIVO_PRIMA = ${before};
var COLLAUDO_OPERATIVO_DOPO = ${after};

function collaudoProcedureOperative() {
  // Il confronto resta confinato al progetto di prova indicato nel repository.
  if (ScriptApp.getScriptId() !== COLLAUDO_OPERATIVO_PROGETTO) {
    throw new Error('Aprire il progetto donRaimondo per eseguire questo collaudo.');
  }
  var item = COLLAUDO_OPERATIVO_CASI.find(function(value) { return value.id === COLLAUDO_OPERATIVO_CASO; });
  if (!item) throw new Error('Caso di collaudo non riconosciuto.');
  if (['lite', 'standard', 'heavy'].indexOf(COLLAUDO_OPERATIVO_PROFILO) < 0) throw new Error('Profilo non riconosciuto.');
  if (['prima_dopo', 'dopo_prima'].indexOf(COLLAUDO_OPERATIVO_ORDINE) < 0) throw new Error('Ordine non riconosciuto.');
  var service = new GeminiService();
  var model = service.getModelNameForTask('generation');
  var options = Object.assign({}, COLLAUDO_OPERATIVO_DEFAULTS, {
    emailSubject: item.emailSubject, emailContent: item.emailContent, knowledgeBase: item.knowledgeBase,
    category: item.category, salutationMode: item.salutationMode || COLLAUDO_OPERATIVO_DEFAULTS.salutationMode,
    promptProfile: COLLAUDO_OPERATIVO_PROFILO, requestPurpose: { type: item.purpose, confidence: 0.96 }
  });
  var report = { caseId: item.id, status: 'da_valutare', model: model, profile: COLLAUDO_OPERATIVO_PROFILO,
    date: new Date().toISOString(), baselinePolicyHash: ${JSON.stringify(engines.baselinePolicyHash)},
    candidateHash: ${JSON.stringify(engines.candidateHash)}, criteria: item.criteria, responses: [] };
  var variants = COLLAUDO_OPERATIVO_ORDINE === 'prima_dopo' ? ['prima', 'dopo'] : ['dopo', 'prima'];
  variants.forEach(function(variant) {
    var engine = new PromptEngine();
    engine._renderRequestPurposePolicy_ = variant === 'prima' ? COLLAUDO_OPERATIVO_PRIMA : COLLAUDO_OPERATIVO_DOPO;
    var payload = engine.buildPrompt(options);
    var result = service.generateResponse(payload, { modelName: model });
    if (!result || !result.success || !result.text) throw new Error('Generazione non completata: ' + variant);
    if (result.modelUsed !== model) throw new Error('Modello diverso: confronto da ripetere sullo stesso modello.');
    var row = { variant: variant, model: result.modelUsed, promptChars: payload.length, text: result.text };
    report.responses.push(row);
    console.log(JSON.stringify({ caseId: item.id, response: row }));
  });
  console.log(JSON.stringify(report));
  return report;
}
`;
}

function prepare() {
  const engines = loadEngines();
  const ids = fs.readFileSync(path.join(root, 'ID dei due progetti.txt'), 'utf8');
  const match = ids.match(/donRaimondo\s+([\w-]+)/i);
  if (!match) throw new Error('Progetto donRaimondo non identificato.');
  const output = path.join(root, 'outputs', 'operational-procedure-eval');
  fs.mkdirSync(output, { recursive: true });
  const comparisons = buildComparison(engines);
  fs.writeFileSync(path.join(output, 'prompts.json'), JSON.stringify({ baselinePolicyHash: engines.baselinePolicyHash,
    candidateHash: engines.candidateHash, comparisons }, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'collaudo_operativo.gs'), buildGasHarness(engines, match[1]));
  console.log(JSON.stringify({ preparedCases: comparisons.length, deltaChars: comparisons.map(item => ({ id: item.id, delta: item.deltaChars })),
    remoteExecuted: false, output }, null, 2));
}

if (require.main === module) prepare();
module.exports = { suite, loadEngines, promptOptions, buildComparison, buildGasHarness };
