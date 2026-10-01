/**
 * Collaudo UNA TANTUM (dry-run locale, non invia email).
 * Esegui da editor Apps Script -> Controlla i log.
 * Poi CANCELLA questa funzione dal progetto.
 */
function COLLAUDO_PERSONAL_IGNORE_SENDERS_UNA_TANTUM() {
  var KEY = 'PERSONAL_IGNORE_SENDERS';
  var props = PropertiesService.getScriptProperties();
  if (typeof EmailProcessor !== 'function') throw new Error('EmailProcessor non disponibile');
  // Use the real prototype without constructing Google/AI service dependencies.
  var processor = Object.create(EmailProcessor.prototype);
  processor.props = props;
  var list = processor._getPersonalIgnoreSenders_();
  if (!list.length) throw new Error(KEY + ' assente o vuota');
  var allowed = 'collaudo.consentito.' + Date.now() + '@example.com';

  // Exercise the production filter; malformed properties must fail identically.
  function wouldIgnore_(senderEmail) {
    return processor._shouldIgnoreEmail({ senderEmail: senderEmail, subject: 'Collaudo', body: 'Test' }) === true;
  }

  var blockedOk = list.every(function (email) { return wouldIgnore_(email); });
  var allowedOk = wouldIgnore_(allowed) === false;

  Logger.log('Collaudo PERSONAL_IGNORE_SENDERS');
  Logger.log('Voci in proprieta: ' + list.length);
  Logger.log('Mittente escluso (match lista): ' + (blockedOk ? 'PASS' : 'FAIL'));
  Logger.log('Mittente consentito (fuori lista): ' + (allowedOk ? 'PASS' : 'FAIL'));
  Logger.log('Risultato: ' + (blockedOk && allowedOk ? 'OK' : 'KO'));
  if (!(blockedOk && allowedOk)) {
    throw new Error('Collaudo fallito');
  }
}
