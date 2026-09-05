// Regressioni locali: nessuna API, email o quota Gemini.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const ctx = {console, CONFIG: {}};
vm.createContext(ctx);
for (const file of ['gas_response_strategy.js', 'gas_email_processor.js', 'gas_memory_service.js', 'gas_prompt_context.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, {filename: file});
}
const run = code => vm.runInContext(code, ctx);
run(`var processor = Object.create(EmailProcessor.prototype);
var memory = Object.create(MemoryService.prototype);
var now = new Date(), old = new Date(now - 86400000).toISOString();
var negative = {has_constraint:false, type:'none', confidence:0.95, visit_policy:'unknown'};
var remembered = types => ({contextualFlags: {remote_user:true, bereaved:true, canonical_complexity:true, ongoing_pastoral_process:true},
  conversationState:{physicalPresenceState:{version:1,constraints:types.map(type=>({type,status:'active',updatedAt:old,
    policy:type==='health'?'avoid_invitation':'conditional_only'}))}}});
var reconcile = (body, types=['geographic_distance'], quick=negative) =>
  processor._reconcilePhysicalPresenceConstraint_(quick,'',body,remembered(types),now);`);
for (const phrase of ['Ora sono a Roma.', 'I am currently in Rome.', 'Je suis à Rome.', 'Estoy en Roma.', 'Estou em Roma.', 'Ich bin in Rom.']) {
  ctx.phrase = phrase;
  assert.strictEqual(run('reconcile(phrase).has_constraint'), false, phrase);
  for (const type of ['health','mobility','caregiving','legal_restriction','remote_request']) {
    ctx.kind = type;
    assert.strictEqual(run("reconcile(phrase,['geographic_distance',kind]).type"), type, phrase + '/' + type);
  }
}
for (const phrase of ['Non sono a Roma.', 'Se sono a Roma vi avviso.', 'Domani sono a Roma.', 'Ieri sono a Roma.',
  '> Sono a Roma.', 'Mia sorella dice: sono a Roma.', 'Ha scritto "sono a Roma".', 'Sono a Roma?',
  'If I am in Rome I will call.', 'Tomorrow I am in Rome.', 'Si je suis à Rome, je viens.',
  'Wenn ich bin in Rom, komme ich.', 'Non è vero che sono guarito.', 'Sono guarito?']) {
  ctx.phrase = phrase;
  assert.strictEqual(run('reconcile(phrase).has_constraint'), true, phrase);
}
for (const phrase of ['Sono guarito.', 'I have recovered.', 'Je suis guéri.', 'Estoy recuperado.', 'Estou recuperado.', 'Ich bin wieder gesund.']) {
  ctx.phrase = phrase;
  assert.strictEqual(run("reconcile(phrase,['health']).has_constraint"), false, phrase);
}
assert.strictEqual(run("reconcile('Sono guarito, ma sono ancora ricoverato.', ['health']).has_constraint"), true);
assert.strictEqual(run("reconcile('Ora posso venire.', ['health','temporary_unavailability']).type"), 'health');
assert.strictEqual(run("reconcile('Grazie per gli orari.', ['health']).type"), 'health');
assert.strictEqual(run("processor._reconcilePhysicalPresenceConstraint_(negative,'','Sono a Roma.',{contextualFlags:{remote_user:true}},now).type"), 'other');
assert.strictEqual(run("processor._reconcilePhysicalPresenceConstraint_(negative,'','Sono a Roma.',{contextualFlags:{remote_user:true},conversationState:{physicalPresenceState:{version:1,constraints:[{}]}}},now).type"), 'other');
// Persistenza nel formato reale della colonna I e lettura del turno successivo.
run(`var resolved = reconcile('Sono a Roma.');
var prior = remembered(['geographic_distance']);
var flags = processor._deriveContextualFlagsUpdate_({existingFlags:prior.contextualFlags,physicalPresenceConstraint:resolved});
var summary = memory._serializeMemorySummaryState('', 'Riassunto preesistente', {physicalPresenceState:resolved.memoryState,currentRelationalPosture:'hesitant'});
var row = ['t','it','information','standard','[]',now.toISOString(),2,2,summary,JSON.stringify(flags)];
var restored = memory._rowToObject(row);
var next = processor._reconcilePhysicalPresenceConstraint_(negative,'','Grazie.',restored,now);
var prompt = new PromptContext({email:{body:'Grazie.',subject:'Orari',detectedLanguage:'it'},memory:restored,
  physicalPresenceConstraint:next,classification:{category:'information'},requestType:{type:'technical'}});`);
assert.strictEqual(run('next.has_constraint'), false);
assert.strictEqual(run('prompt.concerns.physical_presence_constraint'), false);
assert.strictEqual(run('restored.memorySummary'), 'Riassunto preesistente');
assert.strictEqual(run('restored.conversationState.currentRelationalPosture'), 'hesitant');
for (const flag of ['bereaved','canonical_complexity','ongoing_pastoral_process']) assert.strictEqual(run(`restored.contextualFlags.${flag}`), true);
assert.strictEqual(run('restored.contextualFlags.remote_user === true'), false);
run(`var focus={responseFocusHint:'answer_only_residual_question',responseFocusHintConfidence:0.9,appliesToTopic:'orari',updatedAt:old};`);
assert.strictEqual(run("isResponseFocusApplicable_(focus,'orari',now)"), true);
assert.strictEqual(run("isResponseFocusApplicable_(focus,'battesimo',now)"), false);
assert.strictEqual(run("isResponseFocusApplicable_({...focus,updatedAt:new Date(now-30*86400000).toISOString()},'orari',now)"), false);
assert.strictEqual(run("memory._mergeConversationState(focus,{physicalPresenceState:resolved.memoryState}).updatedAt"), run('old'));
// Il primo topic aggiornato sopravvive al limite; reazioni e contesto restano.
run(`var previous=Array.from({length:50},(_,i)=>({topic:'topic_'+i,timestamp:old,userReaction:i===0?'accepted':'unknown',context:{note:'preserve'}}));
var merged=memory._mergeProvidedTopics(previous,[{topic:'topic_0',timestamp:now.toISOString(),userReaction:'unknown'}, {topic:'topic_50',timestamp:now.toISOString()}]);
var capped=memory._shrinkProvidedInfoToCaps(merged,'test');`);
assert.strictEqual(run('capped.length'), 50);
assert.strictEqual(run("capped.some(t=>t.topic==='topic_0')"), true);
assert.strictEqual(run("capped.some(t=>t.topic==='topic_1')"), false);
assert.strictEqual(run("capped.find(t=>t.topic==='topic_0').userReaction"), 'accepted');
assert.strictEqual(run("capped.find(t=>t.topic==='topic_0').context.note"), 'preserve');
run(`var reacted=memory._applyInferredReactionToProvidedInfo([...previous,{topic:'topic_50',timestamp:old}],{reaction:'accepted',topics:['topic_0']},now.toISOString());
var reactionCap=memory._shrinkProvidedInfoToCaps(reacted,'test-reaction');`);
assert.strictEqual(run("reactionCap[49].topic"), 'topic_0');
assert.strictEqual(run("memory._normalizeProvidedTopics(['legacy'])[0].timestamp"), null);
assert.strictEqual(run("memory._rowToObject(['t','it','','','[\"legacy\"]',old,1,1,'','']).providedInfo[0].timestamp"), null);
assert.strictEqual(run("sortProvidedTopicsByRecency_([{topic:'invalid',timestamp:'bad'},{topic:'missing'},{topic:'valid',timestamp:old}]).map(t=>t.topic).join(',')"), 'invalid,missing,valid');
console.log('Presence reconciliation, sensitive flags, persistence and topic recency: OK');
