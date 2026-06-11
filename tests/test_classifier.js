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

console.log('--- Test Classifier: inline reply Unicode riapre il blocco dopo citazione ---');
{
  const classifier = new Classifier();
  const extracted = classifier._extractMainContent([
    'Il giorno lun 1 giu 2026 alle 10:00 Segreteria ha scritto:',
    '> Vecchio messaggio quotato',
    'Žádost nuova con lettera Unicode fuori Latin-1.',
    '',
    'Secondo paragrafo da conservare.'
  ].join('\n'));

  assert(
    extracted.includes('Žádost nuova con lettera Unicode fuori Latin-1.\n\nSecondo paragrafo da conservare.'),
    'una risposta che inizia con lettera Unicode deve chiudere il blocco citato e preservare i paragrafi'
  );
}

console.log('--- Test Classifier: documenti informativi non diventano consegna documentale ---');
{
  const classifier = new Classifier();
  const infoResult = classifier.classifyEmail(
    'Documenti matrimonio',
    'Vorrei sapere quali documenti di matrimonio devo preparare per la pratica.',
    false
  );
  assert(infoResult.category !== 'document_submission', 'documento di senza verbo di invio non deve suggerire document_submission');

  const genericCertificateCategory = classifier._categorizeContent('Vorrei informazioni sul certificato storico.');
  assert(genericCertificateCategory !== 'sacrament', 'certificato generico non deve forzare la categoria sacrament');

  const visitCertificateResult = classifier.classifyEmail(
    'Certificato di battesimo',
    'Buongiorno, posso passare domani in segreteria per un certificato di battesimo?',
    false
  );
  assert(
    visitCertificateResult.category === 'appointment',
    'una richiesta di passaggio in segreteria deve restare logistica anche se cita il battesimo'
  );

  const submissionResult = classifier.classifyEmail(
    'Certificato battesimo',
    'Buongiorno, in allegato invio il certificato di battesimo richiesto.',
    false
  );
  assert(submissionResult.category === 'document_submission', 'invio esplicito in allegato deve restare document_submission');
}

console.log('--- Test Classifier: contatto telefonico pregresso diventa sub-intent ---');
{
  const classifier = new Classifier();
  const result = classifier.classifyEmail(
    'Rinnovo voti matrimoniali',
    [
      'Gentili,',
      'è stato un piacere avere un primo riscontro telefonico con voi questa mattina.',
      'Vi scrivo per confermare la possibilità di celebrare il rinnovo dei voti matrimoniali.',
      'Vorrei quindi chiedervi conferma della possibilità di procedere.'
    ].join('\n'),
    false
  );
  const prior = result.subIntents && result.subIntents.prior_oral_communication;

  assert(prior && prior.detected === true, 'il riscontro telefonico deve essere rilevato');
  assert(prior.strength === 'strong', 'riscontro telefonico deve essere un segnale forte');
  assert(
    Array.isArray(prior.signals) && prior.signals.some(signal => /riscontro\s+telefonico/i.test(signal)),
    'il sub-intent deve conservare il segnale rilevato'
  );

  const neutralResult = classifier.classifyEmail(
    'Informazioni',
    'Buongiorno, resto in attesa di un vostro gentile riscontro.',
    false
  );
  assert(
    !(neutralResult.subIntents && neutralResult.subIntents.prior_oral_communication),
    'una formula generica di attesa non deve simulare un contatto pregresso'
  );
}
