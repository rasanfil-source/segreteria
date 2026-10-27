const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({ CONFIG: {}, console });
const sourceFile = process.env.RETRY_PROMPT_BASELINE_SOURCE || path.join(root, 'gas_email_processor.js');
vm.runInContext(fs.readFileSync(sourceFile, 'utf8') + '\nthis.processor = Object.create(EmailProcessor.prototype);', context);
const processor = context.processor;
const source = '<knowledge_base>KB_SENTINEL: ritiro su appuntamento; disponibilità da confermare.</knowledge_base>\n' +
  '<conversation_history>HISTORY_SENTINEL: richiesta precedente.</conversation_history>\n' +
  '<user_email>EMAIL_SENTINEL: posso ritirare il documento?</user_email>';
const runtime = Object.freeze({
  temporal: Object.freeze({ currentDate: '2026-10-14', messageDate: '2026-10-10',
    currentTime: '12:34', messageTime: '09:17', messageDateSource: 'processing_fallback', isOldMessage: true }),
  papal: Object.freeze({ currentName: 'Pontefice runtime', previousName: 'Pontefice precedente' })
});
const profiles = [
  { language: 'it', mode: 'full', runtime: null, source: 'Istruzioni non strutturate' },
  { language: 'en', mode: 'soft', runtime, source },
  { language: 'fr', mode: 'none_or_continuity', runtime, source },
  { language: 'es', mode: 'session', runtime, source, complete: true }
];
const cases = {
  generic: {},
  thinking: { thinking_leak: true },
  papal: { papal_reference: true, hallucination: true },
  hallucination: { hallucination: true },
  contacts: { hallucination: true, hallucinations: { emails: ['errata@example.org'], phones: ['0612345678'] } },
  technical: { hallucination: true, hallucinations: { technicalTimes: ['12:34'] } },
  relevance: { kb_relevance: true, kbRelevanceIssues: [{ text: 'alternativa superflua' }] },
  language: { language: true },
  placeholder: { placeholder: true, foundPlaceholders: ['[NOME]', '[TELEFONO]'] },
  temporal: { temporal: true },
  remote: { physical_presence: true, physicalPresencePolicy: 'avoid_invitation' },
  conditional: { physical_presence: true, physicalPresencePolicy: 'conditional_only' },
  sensitive: { sensitive_quality: true, sensitiveQualityErrors: ['vissuto non ripreso'] },
  short: { length: true, lengthErrors: ['troppo corta'] },
  long: { length: true, lengthErrors: ['troppo lunga'] }
};
cases.combined = { ...Object.assign({}, ...Object.values(cases)), hasDirectHallucination: true,
  hallucinations: { emails: ['errata@example.org'], phones: ['0612345678'], times: ['18:30'],
    dates: ['2026-12-24'], technicalTimes: ['12:34'] }, lengthErrors: ['troppo corta', 'troppo lunga'] };

function render(flags, profile = profiles[1], details = {}) {
  processor._classifyValidationForRetry = () => ({ hallucinations: {}, ...flags });
  processor.promptEngine = profile.complete
    ? { _renderTemporalAwareness: () => 'REGOLE_COMPLETE_SENTINEL\n' + 'regola temporale\n'.repeat(280) }
    : null;
  return processor._buildCorrectionPrompt(profile.source, 'BOZZA_SENTINEL\nSeconda riga.',
    { score: 0.4, details }, profile.language, profile.mode, profile.runtime);
}

const prompts = Object.fromEntries(Object.entries(cases).map(([name, flags]) =>
  [name, profiles.map(profile => render(flags, profile))]));
const sizes = Object.fromEntries(Object.entries(prompts).map(([name, values]) => [name, values.map(text => text.length)]));
// La misurazione usa una copia esplicita del sorgente precedente, senza chiamate al modello.
if (process.env.RETRY_PROMPT_BASELINE_SOURCE) {
  console.log(JSON.stringify(sizes, null, 2));
} else {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'retry_prompt_size_baseline.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(sizes), Object.keys(baseline));
  let before = 0;
  let after = 0;
  for (const [name, values] of Object.entries(prompts)) {
    values.forEach((text, index) => {
      assert(text.length <= baseline[name][index], `${name}/${index}: dimensione oltre il prompt precedente`);
      before += baseline[name][index];
      after += text.length;
      assert(text.includes('BOZZA_SENTINEL\nSeconda riga.'), 'La bozza conserva le righe');
      assert.match(text, /prima riga deve essere esattamente <email>; l'ultima esattamente <\/email>/);
      if (index > 0) {
        for (const marker of ['KB_SENTINEL', 'HISTORY_SENTINEL', 'EMAIL_SENTINEL']) assert(text.includes(marker));
      }
    });
  }
  const thinking = prompts.thinking[1];
  assert.match(thinking, /direttamente al mittente in inglese/);
  assert(!thinking.includes('Non abbiamo informazioni in proposito'));
  assert.match(thinking, /solo recapiti documentati/);
  assert.match(prompts.placeholder[1], /\[NOME\].*\[TELEFONO\].*solo con dati disponibili nelle fonti; altrimenti riformula/);
  assert.match(prompts.short[1], /soli dati utili supportati dal contesto/);
  assert.match(prompts.short[2], /senza saluti formali o firme/);
  assert.match(prompts.short[3], /senza saluti formali o firme/);
  assert.match(prompts.long[1], /domande poste in massimo 4-5 frasi/);
  assert.match(prompts.hallucination[1], /Conserva o correggi solo dati supportati dalle fonti pertinenti e procedure autorizzate dalla KB; elimina gli altri/);
  assert.match(prompts.contacts[1], /errata@example.org.*0612345678/);
  assert.match(prompts.technical[1], /Ometti l'ora tecnica di sistema o di ricezione senza sostituirla con altri orari/);
  assert.match(prompts.remote[1], /distinguendo mittente e delegato/);
  assert.match(prompts.conditional[1], /Mantieni eventuale un viaggio ipotetico e acquisita una presenza dichiarata/);
  assert.match(prompts.sensitive[1], /senza nominare memoria, lutto o vissuti non ripresi dall'utente/);
  assert.match(prompts.sensitive[1], /procedurale e non persuasivo/);
  assert.match(prompts.sensitive[1], /nei casi pastorale-tecnici mantieni una frase umana breve/);
  assert.match(prompts.relevance[1], /Mantieni esatti dati e condizioni necessari/);
  assert.match(prompts.temporal[1], /Confronta le date con currentDate risposta/);
  assert.match(prompts.temporal[1], /Se data o anno sono incerti, mantieni l'incertezza/);
  assert.match(prompts.temporal[1], /currentDate risposta: 2026-10-14/);
  assert.match(prompts.temporal[1], /messageDate email originale: 2026-10-10/);
  assert.match(prompts.temporal[1], /fallback tecnico e l'anno è ambiguo, mantieni l'incertezza/);
  assert(!prompts.temporal[1].includes('12:34') && !prompts.temporal[1].includes('09:17'));
  assert(!prompts.temporal[3].includes('REGOLE_COMPLETE_SENTINEL'));
  assert.match(prompts.temporal[3], /messageDate per interpretare i relativi/);
  assert.match(prompts.papal[1], /Il Papa regnante è Pontefice runtime/);
  assert(!prompts.papal[1].includes('ADERENZA ALLE FONTI:'), 'Il solo riferimento papale evita la correzione generica delle allucinazioni');
  const override = render(cases.papal, profiles[1], { currentPopeReference: { currentPope: 'Pontefice validatore' } });
  assert.match(override, /Il Papa regnante è Pontefice validatore/);
  assert.match(prompts.papal[0], /il Papa regnante indicato nelle istruzioni/);
  assert.match(prompts.combined[1], /ADERENZA ALLE FONTI:/);
  assert.match(prompts.combined[1], /2026-12-24/);
  console.log(`Retry: ${Object.keys(cases).length * profiles.length} prompt entro la baseline; caratteri ${before} -> ${after} (${((1 - after / before) * 100).toFixed(1)}% in meno).`);
}
