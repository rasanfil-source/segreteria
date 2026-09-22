/**
 * Collaudo UNA TANTUM (dry-run locale, non invia email).
 * Esegui da editor Apps Script -> Controlla i log.
 * Poi CANCELLA questa funzione dal progetto.
 */
function COLLAUDO_PERSONAL_IGNORE_SENDERS_UNA_TANTUM() {
  var KEY = 'PERSONAL_IGNORE_SENDERS';
  var props = PropertiesService.getScriptProperties();
  var raw = String(props.getProperty(KEY) || '').trim();
  if (!raw) throw new Error('PERSONAL_IGNORE_SENDERS assente o vuota');

  var list = raw.charAt(0) === '[' ? JSON.parse(raw) : raw.split(/[\n,;]+/);
  if (!Array.isArray(list) || !list.length) throw new Error('Lista personale vuota/non valida');
  list = list.map(function (v) { return String(v || '').trim().toLowerCase(); }).filter(Boolean);

  var blocked = list[0];
  var allowed = 'collaudo.consentito.' + Date.now() + '@example.com';

  // Usa lo stesso criterio di gas_email_processor._shouldIgnoreEmail (match esatto email)
  function wouldIgnore_(senderEmail) {
    var email = String(senderEmail || '').trim().toLowerCase();
    return list.indexOf(email) !== -1;
  }

  var blockedOk = wouldIgnore_(blocked) === true;
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
