const assert = require('node:assert/strict');
const vm = require('node:vm');
const { suite, loadEngines, promptOptions, buildGasHarness } = require('../scripts/prepare_operational_procedure_eval');
const engines = loadEngines();
let checked = 0;
for (const item of suite.cases) {
  for (const profile of ['lite', 'standard', 'heavy']) {
    const options = promptOptions(item, profile);
    const before = engines.baseline.buildPrompt(options);
    const after = engines.candidate.buildPrompt(options);
    const beforePolicy = engines.baseline._renderRequestPurposePolicy_(options.requestPurpose);
    const afterPolicy = engines.candidate._renderRequestPurposePolicy_(options.requestPurpose);
    // Il confronto isola la direttiva candidata e conserva tutte le altre fonti e istruzioni.
    assert.equal(after.systemInstruction, before.systemInstruction.replace(beforePolicy, afterPolicy), item.id + '/' + profile);
    assert.equal(after.prompt, before.prompt, item.id + ': fonti e richiesta inalterate');
    assert(after.length <= before.length, `${item.id}: incremento del prompt ${after.length - before.length}`);
    for (const criterion of item.criteria) assert(!after.toString().includes(criterion), 'Esiti attesi esterni al prompt');
    if (['information_request', 'status_update', 'acknowledgment'].includes(item.purpose)) {
      assert.equal(after.toString(), before.toString(), item.id + ': scopi non operativi invariati');
    }
    checked++;
  }
}
// Il collaudo usa soltanto il progetto di prova e modifica la policy sulla singola istanza.
const code = buildGasHarness(engines, 'test-project');
let calls = [];
const prototypePolicy = engines.candidate._renderRequestPurposePolicy_;
const ctx = vm.createContext({
  console: { log() {} }, ScriptApp: { getScriptId: () => 'test-project' },
  GmailApp: new Proxy({}, { get() { assert.fail('Accesso a Gmail nel collaudo di generazione'); } }),
  MailApp: new Proxy({}, { get() { assert.fail('Invio email nel collaudo di generazione'); } }),
  PromptEngine: engines.candidate.constructor,
  GeminiService: class {
    constructor() { calls.push('service'); }
    getModelNameForTask(task) { assert.equal(task, 'generation'); return 'test-model'; }
    generateResponse(payload, options) {
      calls.push({ payload, options });
      return { success: true, text: 'Risposta sintetica di prova.', modelUsed: 'test-model' };
    }
  }
});
vm.runInContext(code, ctx, { filename: 'collaudo_operativo.gs' });
ctx.ScriptApp.getScriptId = () => 'production-project';
assert.throws(() => ctx.collaudoProcedureOperative(), /progetto donRaimondo/);
assert.equal(calls.length, 0, 'Controllo progetto prima di qualsiasi chiamata');
ctx.ScriptApp.getScriptId = () => 'test-project';
for (const item of suite.cases) {
  for (const order of ['prima_dopo', 'dopo_prima']) {
    calls = [];
    ctx.COLLAUDO_OPERATIVO_CASO = item.id;
    ctx.COLLAUDO_OPERATIVO_ORDINE = order;
    const report = ctx.collaudoProcedureOperative();
    assert.equal(report.status, 'da_valutare', 'Un mock non certifica la qualità del modello');
    assert.equal(report.responses.length, 2);
    assert.equal(calls.length, 3, 'Un servizio e due generazioni');
    for (const call of calls.slice(1)) {
      for (const criterion of item.criteria) assert(!call.payload.toString().includes(criterion));
    }
    assert.equal(engines.candidate.constructor.prototype._renderRequestPurposePolicy_, prototypePolicy);
  }
}
ctx.COLLAUDO_OPERATIVO_ORDINE = 'non_valido';
assert.throws(() => ctx.collaudoProcedureOperative(), /Ordine non riconosciuto/);
ctx.COLLAUDO_OPERATIVO_ORDINE = 'prima_dopo';
ctx.GeminiService.prototype.generateResponse = () => ({ success: true, text: 'Testo', modelUsed: 'other-model' });
assert.throws(() => ctx.collaudoProcedureOperative(), /Modello diverso/);
ctx.GeminiService.prototype.generateResponse = () => ({ success: false, text: '' });
assert.throws(() => ctx.collaudoProcedureOperative(), /Generazione non completata/);
console.log(`${checked} confronti locali di prompt e 24 prove del collaudo GAS superati; nessuna generazione reale eseguita.`);
