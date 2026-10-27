// Il giudizio sulla consegna attuale prevale sugli indizi lessicali, in ogni lingua.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({console, CONFIG:{}});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas_email_processor.js'), 'utf8'), ctx);
const p = Object.create(ctx.EmailProcessor.prototype);
for (const body of ['Non allego il certificato: sono in attesa di riceverlo.',
  'Appena ricevo il certificato, lo invio.', 'Please find attached my baptism certificate.',
  'Adjunto el certificado de bautismo.']) {
  const expected = body.startsWith('Please') || body.startsWith('Adjunto');
  const quickDocumentDelivery = p._resolveQuickCheckDocumentDelivery_({document_delivery:{
    expected_document:expected, delivery_channel:'attachment', missing_document_if_no_attachment:expected}});
  for (const physicalAttachmentsDetected of [false, true]) {
    const result = p._buildDocumentDeliveryModel_({subject:'Certificato', body, quickDocumentDelivery,
      physicalAttachmentsDetected, attachmentSkipped:physicalAttachmentsDetected ? [] : [{reason:'no_attachments'}]});
    assert.equal(result.expectsDocument, expected, body);
    assert.equal(result.status, expected ? (physicalAttachmentsDetected ? 'received_attachment' : 'missing')
      : (physicalAttachmentsDetected ? 'unannounced_attachment' : 'none'), body);
  }
}
const fallback = p._resolveQuickCheckDocumentDelivery_({});
const bodyDelivery = p._buildDocumentDeliveryModel_({body:'Ecco i dati richiesti.',
  quickDocumentDelivery:{expected_document:false,body_contains_filled_document:true,delivery_channel:'body'}});
assert.equal(bodyDelivery.status, 'received_body');
assert.equal(p._buildDocumentDeliveryModel_({body:'Allego il certificato.',quickDocumentDelivery:fallback,
  attachmentSkipped:[{reason:'near_deadline'}]}).status, 'unverified_attachment');
console.log('Autorità semantica della consegna: verifiche superate.');
