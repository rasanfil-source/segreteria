const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

const setupUiPath = path.join(__dirname, '..', 'gas_setup_ui.js');
const code = fs.readFileSync(setupUiPath, 'utf8');
vm.runInThisContext(code, { filename: setupUiPath });

console.log('--- Test createNamedRanges: liste ignore usano range chiusi ---');
{
  const originalLockService = global.LockService;
  const requestedRanges = new Map();

  global.LockService = {
    getDocumentLock: () => ({
      tryLock: () => true,
      releaseLock: () => {}
    })
  };

  try {
    const ss = {
      getNamedRanges: () => [],
      removeNamedRange: () => {},
      getRange: (a1) => ({
        getA1Notation: () => a1
      }),
      setNamedRange: (name, range) => {
        requestedRanges.set(name, range.getA1Notation());
      }
    };

    createNamedRanges(ss, []);

    assert(
      requestedRanges.get('lst_ignore_domains') === "'Controllo'!E13:E120",
      'lst_ignore_domains deve puntare al range chiuso E13:E120'
    );
    assert(
      requestedRanges.get('lst_ignore_keywords') === "'Controllo'!F13:F120",
      'lst_ignore_keywords deve puntare al range chiuso F13:F120'
    );
  } finally {
    global.LockService = originalLockService;
  }
}

console.log('OK setup UI tests passed');
