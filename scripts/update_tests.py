import os

test_file = r"c:\Users\romolo\OneDrive\Documenti\SCRIPT\GMAIL AUTOMATICA\GMAIL PARROCCHIA\Google Script\AG\tests\test_gmail_service.js"

with open(test_file, 'rb') as f:
    content = f.read()

# Normalize to LF
content = content.replace(b"\r\n", b"\n")

# Replacement 1: _extractEmailAddress
target1 = b"""{
  const service = new GmailService();
  assert(
    service._extractEmailAddress("D'Angelo <d'angelo@example.org>") === "d'angelo@example.org",
    'indirizzi con apostrofo nel local-part devono essere estratti'
  );
}"""
replacement1 = b"""{
  const service = new GmailService();
  assert(
    service._extractEmailAddress("D'Angelo <d'angelo@example.org>") === "d'angelo@example.org",
    'indirizzi con apostrofo nel local-part devono essere estratti'
  );
  assert(
    service._extractEmailAddress('Ticket <helpdesk+parish!urgent#case=42@example.org>') === 'helpdesk+parish!urgent#case=42@example.org',
    'indirizzi con !, # e = nel local-part devono essere estratti'
  );
}"""

# Replacement 2: _getOptionalLabelIdByName Advanced Gmail
target2 = b"""console.log('--- Test _getOptionalLabelIdByName: Advanced Gmail conta labels.list ---');
{
  const serviceWithApiLabel = new GmailService();
  const counterOps = [];
  serviceWithApiLabel._incrementGmailCallCounterOrThrow_ = (opName) => counterOps.push(opName);

  const originalLabels = global.Gmail.Users.Labels;
  global.Gmail.Users.Labels = {
    list: () => ({ labels: [{ id: 'Label_123', name: 'Verifica' }] })
  };

  const labelId = serviceWithApiLabel._getOptionalLabelIdByName('Verifica');

  assert(labelId === 'Label_123', 'lookup Advanced Gmail deve restituire id label trovato');
  assert(counterOps.length === 1 && counterOps[0] === 'labels.list', 'lookup Advanced Gmail deve incrementare le counter locale labels.list');"""
# Note: I noticed a typo in target content from user's diff? No, the user's diff said "incrementare il counter locale".
# Wait, let's check what I have in my file.

content_str = content.decode('utf-8', errors='ignore')
if "--- Test _getOptionalLabelIdByName: Advanced Gmail conta labels.list ---" in content_str:
    content = content.replace(
        b"console.log('--- Test _getOptionalLabelIdByName: Advanced Gmail conta labels.list ---');",
        b"console.log('--- Test _getOptionalLabelIdByName: Advanced Gmail conta labels.list e popola cache bulk ---');"
    )

target2 = b"""  global.Gmail.Users.Labels = {
    list: () => ({ labels: [{ id: 'Label_123', name: 'Verifica' }] })
  };

  const labelId = serviceWithApiLabel._getOptionalLabelIdByName('Verifica');

  assert(labelId === 'Label_123', 'lookup Advanced Gmail deve restituire id label trovato');
  assert(counterOps.length === 1 && counterOps[0] === 'labels.list', 'lookup Advanced Gmail deve incrementare il counter locale labels.list');"""

replacement2 = b"""  global.Gmail.Users.Labels = {
    list: () => ({ labels: [
      { id: 'Label_123', name: 'Verifica' },
      { id: 'Label_456', name: 'Da inviare' }
    ] })
  };

  const labelId = serviceWithApiLabel._getOptionalLabelIdByName('Verifica');
  const cachedSecondLabelId = serviceWithApiLabel._getOptionalLabelIdByName('Da inviare');

  assert(labelId === 'Label_123', 'lookup Advanced Gmail deve restituire id label trovato');
  assert(cachedSecondLabelId === 'Label_456', 'lookup successivo deve usare la cache bulk popolata da labels.list');
  assert(counterOps.length === 1 && counterOps[0] === 'labels.list', 'lookup Advanced Gmail deve incrementare il counter locale labels.list una sola volta');"""

# Replacement 3: Gmail counter
target3 = b"""console.log('--- Test Gmail counter: non usa ScriptLock per ogni chiamata ---');
{
  const originalLockService = global.LockService;
  const originalPropertiesService = global.PropertiesService;
  let storedValue = null;

  try {
    global.LockService = {
      getScriptLock: () => ({
        tryLock: () => { throw new Error('lock contention'); },
        releaseLock: () => { throw new Error('release non atteso'); }
      })
    };
    delete global.PropertiesService;

    const counterService = new GmailService();
    counterService._scriptCache = {
      get: () => '41',
      put: (_key, value) => { storedValue = value; }
    };
    counterService._gmailDailyCallLimit = 100;
    counterService._gmailDailyCounterWarnAt = 90;

    counterService._incrementGmailCallCounterOrThrow_('messages.get');

    assert(storedValue === '42', 'counter Gmail deve incrementare senza acquisire ScriptLock');"""

replacement3 = b"""console.log('--- Test Gmail counter: non usa ScriptLock per ogni chiamata e accorpa incrementi ---');
{
  const originalLockService = global.LockService;
  const originalPropertiesService = global.PropertiesService;
  let storedValue = null;
  let cacheGets = 0;
  let cachePuts = 0;

  try {
    global.LockService = {
      getScriptLock: () => ({
        tryLock: () => { throw new Error('lock contention'); },
        releaseLock: () => { throw new Error('release non atteso'); }
      })
    };
    delete global.PropertiesService;

    const counterService = new GmailService();
    counterService._scriptCache = {
      get: () => {
        cacheGets += 1;
        return storedValue || '41';
      },
      put: (_key, value) => {
        cachePuts += 1;
        storedValue = value;
      }
    };
    counterService._gmailDailyCallLimit = 100;
    counterService._gmailDailyCounterWarnAt = 90;

    counterService._incrementGmailCallCounterOrThrow_('messages.get');
    counterService._incrementGmailCallCounterOrThrow_('messages.get');
    counterService._incrementGmailCallCounterOrThrow_('messages.get');
    counterService._incrementGmailCallCounterOrThrow_('messages.get');

    assert(storedValue === '42', 'counter Gmail deve persistere subito la baseline iniziale');
    assert(cacheGets === 1 && cachePuts === 1, 'counter Gmail deve accorpare in memoria gli incrementi successivi alla baseline');"""

content = content.replace(target1, replacement1)
content = content.replace(target2, replacement2)
content = content.replace(target3, replacement3)

# Restore CRLF
content = content.replace(b"\n", b"\r\n")

with open(test_file, 'wb') as f:
    f.write(content)

print("Tests updated successfully.")
