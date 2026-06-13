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

console.log('✅ Test RequestTypeClassifier passati');
