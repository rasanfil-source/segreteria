const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

const gasClassifierPath = path.join(__dirname, '..', 'gas_classifier.js');
const code = fs.readFileSync(gasClassifierPath, 'utf8');
vm.runInThisContext(code, { filename: gasClassifierPath });

console.log('--- Test Classifier: troncamento non lascia tag HTML spezzato ---');
{
  const classifier = new Classifier();
  let capturedBody = '';
  classifier._extractMainContent = (body) => {
    capturedBody = body;
    return 'vorrei informazioni sugli orari';
  };
  classifier._isGreetingOnly = () => false;
  classifier._isOutOfOfficeAutoReply = () => false;

  const body = `${'a'.repeat(9998)}<div>contenuto oltre limite`;
  classifier.classifyEmail('Richiesta informazioni', body, false);

  assert(capturedBody.length === 9998, 'il body deve essere troncato prima del tag spezzato');
  assert(!capturedBody.endsWith('<') && !capturedBody.endsWith('<d'), 'il body non deve finire con un frammento di tag HTML');
}

console.log('--- Test Classifier: normalizzazione Unicode conserva lettere non ASCII ---');
{
  const classifier = new Classifier();
  assert(classifier._isTrivialReplyBody('Re: Łódź') === true, 'le lettere Unicode devono restare token valide in risposte banali');
  assert(classifier._isGreetingOnly('Buongiorno!') === true, 'la normalizzazione Unicode deve mantenere il riconoscimento dei saluti');
}
