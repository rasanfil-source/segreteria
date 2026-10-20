// Importa il campione fornito e rende esplicite le correzioni del criterio di accettazione.
const fs = require('node:fs');
const path = require('node:path');
const text = fs.readFileSync(process.argv[2], 'utf8');
const original = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
const target = path.resolve(__dirname, '../tests/fixtures');
fs.writeFileSync(path.join(target, 'coverage_cases_original.json'), JSON.stringify(original,null,2)+'\n');
const data = structuredClone(original);
data.schemaVersion = 'coverage-tests-v3';
data.phase = 'enforce';
data.defaults.blocksSend = true;
data.reviewNotes = [
  'I codici di errore usano i nomi effettivi del codice di produzione.',
  'C06c resta undeterminable: il corpo tagliato potrebbe contenere altre richieste, esplicitamente annunciate.',
  'C04a omette il requisito aggiunto sui dati del battesimo: la sua KB non lo prescrive.',
  'C04a/b/c dichiarano non confermati i tempi di venerdì: la KB non autorizza una garanzia sulla scadenza.',
  'I casi di troncamento usano riempimento prima e dopo la domanda per collocarla davvero nella zona centrale.',
  'C08a-d invertono la KB mantenendo la domanda e, nei primi tre casi, la medesima risposta negativa.'
];
for (const item of data.cases) {
  const expected=item.expected;
  const codes={semantic_unsupportedclaim:'semantic_unsupported_claim',semantic_irrelevantdetail:'semantic_irrelevant_detail',semantic_undeterminable:'semantic_context_insufficient'};
  expected.reasonCode=codes[expected.reasonCode]||expected.reasonCode;
  if(item.id==='C04a') item.response='Buongiorno, possiamo inviarle il certificato via email in PDF. Per venerdì non possiamo confermare i tempi. Segreteria Parrocchia';
  if(['C04b','C04c'].includes(item.id)) item.response=item.response.replace('Segreteria Parrocchia','Per venerdì non possiamo confermare i tempi. Segreteria Parrocchia');
  if(item.id==='C06c') {expected.state='undeterminable';expected.reasonCode='semantic_context_insufficient';expected.mustNotApprove=true;delete expected.note;}
  if(expected.state==='undeterminable') {delete expected.mustNotBlockSend;expected.requiresReview=true;}
}
for (const item of data.cases.filter(({id}) => ['C04a','C04b','C04c'].includes(id))) {
  item.openRequests = [
    {id:'r1',need:'ricevere il certificato via email',evidence:'Potete mandarmelo via email',role:'primary'},
    {id:'r2',need:'sapere se il certificato può arrivare entro venerdì',evidence:'Mi serve il certificato entro venerdì',role:'primary'},
    {id:'r3',need:'ritiro del certificato da parte della sorella',evidence:'può ritirarlo mia sorella',role:'conditional',appliesWhen:'solo se l’invio via email non è consentito o il richiedente dichiara che non risolve la scadenza'}
  ];
  item.expected.statuses = item.id === 'C04a'
    ? {r1:'addressed',r2:'explicit_limit_info',r3:'not_applicable'}
    : item.id === 'C04b'
      ? {r1:'explicit_limit_service',r2:'explicit_limit_info',r3:'missing'}
      : {r1:'explicit_limit_service',r2:'explicit_limit_info',r3:'addressed'};
}
const c03a = data.cases.find(({id}) => id === 'C03a');
if (c03a) c03a.response = 'Buongiorno, per il certificato di cresima non abbiamo qui indicazioni sui documenti richiesti. Segreteria Parrocchia';
const c03c = data.cases.find(({id}) => id === 'C03c');
if (c03c) c03c.expected.statuses.r1 = 'explicit_limit_info';
const c04a = data.cases.find(({id}) => id === 'C04a');
if (c04a) {
  c04a.message.body = 'Preferirei ricevere il certificato via email. Se non fosse possibile, può ritirarlo mia sorella?';
  c04a.response = 'Buongiorno, possiamo inviarle il certificato via email in PDF. Segreteria Parrocchia';
  c04a.openRequests = [
    {id:'r1',need:'ricevere il certificato via email',evidence:'Preferirei ricevere il certificato via email',role:'primary'},
    {id:'r3',need:'ritiro del certificato da parte della sorella',evidence:'può ritirarlo mia sorella',role:'conditional',appliesWhen:'solo se l’invio via email non è possibile'}
  ];
  c04a.expected.statuses = {r1:'addressed',r3:'not_applicable'};
}
const shared={group:'limiti_solo_da_kb',message:{subject:'Attestato Zeta',body:'Posso ricevere l’attestato Zeta via email?',history:''},
  sourceCompleteness:{bodyComplete:true,historyComplete:true,classifierSawFullBody:true},
  openRequests:[{id:'r1',need:'invio email dell’attestato Zeta',evidence:'Posso ricevere l’attestato Zeta via email',role:'primary'}],
  response:'Buongiorno, l’attestato Zeta non può essere inviato via email. Segreteria Parrocchia'};
for(const [suffix,kb,state,status] of [
  ['a','L’attestato Zeta non può essere inviato via email.','approved','explicit_limit_service'],
  ['b','L’attestato Zeta può essere inviato via email.','rejected','missing'],
  ['c','L’attestato Zeta è disponibile. Non sono indicate modalità di consegna.','rejected','missing']]) {
  data.cases.push({...structuredClone(shared),id:'C08'+suffix,label:'Limite con KB '+suffix,kb,
    expected:{state,reasonCode:state==='approved'?null:'semantic_unsupported_claim',statuses:{r1:status}}});
}
data.cases.push({...structuredClone(shared),id:'C08d',label:'Canale consentito dalla sola KB',
  kb:'L’attestato Zeta può essere inviato via email.',
  response:'Buongiorno, è possibile ricevere l’attestato Zeta via email. Segreteria Parrocchia',
  expected:{state:'approved',reasonCode:null,statuses:{r1:'addressed'}}});
fs.writeFileSync(path.join(target,'coverage_cases.json'),JSON.stringify(data,null,2)+'\n');
console.log(`Salvati ${original.cases.length} casi originali e ${data.cases.length} casi revisionati.`);
