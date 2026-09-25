const assert = require('assert');
const path = require('path');
const { runScenario } = require('./helpers/thread_scenario');
const root = path.resolve(__dirname, '..');
// Anonymized request: supporting data do not turn an action request into a receipt.
const body = 'Alla c.a. del sacerdote. A seguito della telefonata di oggi comunico le informazioni richieste: Maria Esempio, nata a Roma il 29.01.1972. Si richiede un documento che attesti che la sottoscritta è pronta per ricevere il sacramento della Cresima, alla luce del percorso triennale di catechesi e della partecipazione al seminario finale. Ringrazio della gentile attenzione.';
for (const attachment of [false, true]) {
  for (const purpose of ['operational_request', 'mixed', 'information_request', 'unknown', 'status_update', 'acknowledgment']) {
    for (const confidence of [0.99, 0.4]) {
      const output = runScenario(root, { body: attachment ? 'Invio in allegato la scheda compilata.' : body,
        attachment, ocr: 'Scheda iscrizione catechismo Nome: Mario Cognome: Rossi', repeat: true,
        quick: { request_purpose: purpose, request_purpose_confidence: confidence,
          document_delivery: { expected_document: attachment, body_contains_filled_document: !attachment,
            delivery_channel: attachment ? 'attachment' : 'body', requires_file_attachment: attachment } } });
      assert.equal(output.result.status, 'replied');
      const receipt = ['status_update', 'acknowledgment'].includes(purpose) && confidence >= 0.65;
      assert.equal(output.effects.some(([event]) => event === 'generate'), !receipt, `${attachment}/${purpose}/${confidence}: generation`);
      assert.equal(output.effects.some(([event]) => event === 'validate'), !receipt, `${attachment}/${purpose}/${confidence}: validation`);
      assert.equal(output.effects.filter(([event]) => event === 'send').length, 1);
      const response = output.effects.find(([event]) => event === 'send')[1][1];
      assert.equal(response.includes("Prima di procedere o confermare l'operazione"), receipt);
    }
  }
}
console.log('Receipt purpose: 24 body/attachment cases, AI intent/confidence, validation and idempotency pass');
