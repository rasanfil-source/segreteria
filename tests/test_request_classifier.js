const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

const classifierPath = path.join(__dirname, '..', 'gas_request_classifier.js');
vm.runInThisContext(fs.readFileSync(classifierPath, 'utf8'), { filename: classifierPath });

console.log('--- Test RequestTypeClassifier: output pubblico senza suggestedTone ---');
{
  const classifier = new RequestTypeClassifier();
  const result = classifier.classify(
    'Orari segreteria',
    'Buongiorno, a che ora apre la segreteria?'
  );

  assert(result.type === 'technical', 'richiesta orari deve restare technical');
  assert(!Object.prototype.hasOwnProperty.call(result, 'suggestedTone'), 'suggestedTone non deve comparire nell output pubblico');
  assert(Object.prototype.hasOwnProperty.call(result, 'emotionalLoad'), 'emotionalLoad deve restare disponibile');
  assert(Object.prototype.hasOwnProperty.call(result, 'complexity'), 'complexity deve restare disponibile');
}

console.log('--- Test RequestTypeClassifier: sbattezzo formale prevale sulla dottrina ---');
{
  const classifier = new RequestTypeClassifier();
  const result = classifier.classify(
    'Sbattezzo',
    'Vorrei lo sbattezzo. Spiegami il fondamento teologico, la dottrina, il magistero e il catechismo.'
  );

  assert(result.isSbattezzo === true, 'la richiesta deve essere riconosciuta come sbattezzo');
  assert(result.type === 'formal', `sbattezzo deve restare formal, ottenuto ${result.type}`);
}

console.log('--- Test RequestTypeClassifier: confidence esterna sempre in [0..1] ---');
{
  const classifier = new RequestTypeClassifier();
  assert(classifier._normalizeConfidence(1000) === 1, 'confidence numerica enorme deve essere clampata a 1');
  assert(classifier._normalizeConfidence('150%') === 1, 'confidence percentuale >100 deve essere clampata a 1');
  assert(classifier._normalizeConfidence(-1) === 0, 'confidence negativa deve essere clampata a 0');
}

console.log('✅ Test RequestTypeClassifier passati');
