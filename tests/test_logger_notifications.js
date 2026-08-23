const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

function loadLogger() {
  const loggerPath = path.join(__dirname, '..', 'gas_logger.js');
  const code = fs.readFileSync(loggerPath, 'utf8');
  vm.runInThisContext(code, { filename: loggerPath });
}

function installBaseGlobals() {
  const props = {};
  global.CONFIG = {
    PROJECT_NAME: 'TestBot',
    SCRIPT_ID: 'script-1',
    LOGGING: {
      LEVEL: 'INFO',
      STRUCTURED: false,
      SEND_ERROR_NOTIFICATIONS: true,
      ADMIN_EMAIL: 'admin@example.test'
    }
  };
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => props[key] || '',
      setProperty: (key, value) => {
        props[key] = String(value);
      }
    })
  };
  global.Utilities = {
    DigestAlgorithm: { MD5: 'MD5' },
    computeDigest: () => [1, 2, 3],
    base64EncodeWebSafe: () => 'fixedhash1234567890'
  };
  global.GmailApp = {
    sendEmail: () => {
      throw new Error('GmailApp should not be used');
    }
  };
  return props;
}

function makeLock(tryLockResult = true) {
  const state = { released: 0, tryCalls: 0 };
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        state.tryCalls += 1;
        return tryLockResult;
      },
      releaseLock: () => {
        state.released += 1;
      }
    })
  };
  return state;
}

loadLogger();

console.log('--- Test logger: metadati non possono sovrascrivere campi canonici ---');
installBaseGlobals();
global.CONFIG.LOGGING.STRUCTURED = true;
global.CONFIG.LOGGING.SEND_ERROR_NOTIFICATIONS = false;
let structuredEntry = null;
const originalConsoleInfo = console.info;
console.info = (entry) => {
  structuredEntry = entry;
};
try {
  createLogger('LoggerTest').info('Messaggio reale', {
    timestamp: 'fake',
    level: 'DEBUG',
    context: 'Spoof',
    message: 'Spoofed'
  });
} finally {
  console.info = originalConsoleInfo;
}
assert(structuredEntry && structuredEntry.level === 'INFO', 'level canonico non deve essere sovrascritto dai metadati');
assert(structuredEntry.context === 'LoggerTest', 'context canonico non deve essere sovrascritto dai metadati');
assert(structuredEntry.message === 'Messaggio reale', 'message canonico non deve essere sovrascritto dai metadati');
assert(structuredEntry.timestamp !== 'fake', 'timestamp canonico non deve essere sovrascritto dai metadati');

console.log('--- Test logger: doppio controllo cache sotto lock evita invio duplicato ---');
installBaseGlobals();
let getCount = 0;
let sends = 0;
global.CacheService = {
  getScriptCache: () => ({
    get: () => {
      getCount += 1;
      return getCount === 1 ? 'sent' : '';
    },
    put: () => {
      throw new Error('non deve scrivere cache se gia notificato');
    }
  })
};
global.MailApp = {
  sendEmail: () => {
    sends += 1;
  }
};
const lockStateDuplicate = makeLock(true);
createLogger('LoggerTest').error('Errore ripetuto', { errorClass: 'Duplicate' });

assert(sends === 0, 'non deve inviare se il marker cache risulta gia presente sotto lock');
assert(getCount === 1, 'deve controllare la cache dentro la sezione protetta');
assert(lockStateDuplicate.released === 1, 'deve rilasciare il lock dopo il controllo cache');

console.log('--- Test logger: invio singolo marca pending e sent ---');
installBaseGlobals();
const cacheStore = {};
const puts = [];
global.CacheService = {
  getScriptCache: () => ({
    get: (key) => cacheStore[key] || '',
    put: (key, value, ttl) => {
      cacheStore[key] = value;
      puts.push({ key, value, ttl });
    }
  })
};
sends = 0;
let sentSubject = '';
let sentBody = '';
global.MailApp = {
  sendEmail: (_to, subject, body) => {
    sends += 1;
    sentSubject = subject;
    sentBody = body;
  }
};
const lockStateSend = makeLock(true);
createLogger('LoggerTest').error('Errore nuovo per utente persona@example.test', {
  errorClass: 'Fresh',
  emailBody: 'Testo email sensibile da non inoltrare',
  ocrText: 'IBAN IT60X0542811101000000123456'
});

assert(sends === 1, 'deve inviare una sola email per errore nuovo');
assert(puts.some((p) => p.value === 'pending' && p.ttl === 60), 'deve marcare pending prima dell invio');
assert(puts.some((p) => p.value === 'sent' && p.ttl === 3600), 'deve marcare sent dopo invio riuscito');
assert(lockStateSend.released === 1, 'deve rilasciare il lock dopo l invio');
assert(!sentSubject.includes('persona@example.test'), 'il subject deve redigere indirizzi email');
assert(!sentBody.includes('persona@example.test'), 'il body deve redigere indirizzi email nel messaggio');
assert(!sentBody.includes('Testo email sensibile'), 'il body non deve includere payload email arbitrario');
assert(!sentBody.includes('IT60X0542811101000000123456'), 'il body non deve includere IBAN/OCR grezzi');
assert(sentBody.includes('Fresh'), 'il body deve mantenere metadati tecnici utili');

console.log('--- Test logger: destinatario risolto da Script Properties ---');
const propsWithAdmin = installBaseGlobals();
global.CONFIG.LOGGING.ADMIN_EMAIL = '';
propsWithAdmin.ADMIN_EMAIL = 'admin-from-props@example.test';
global.CacheService = {
  getScriptCache: () => ({
    get: () => '',
    put: () => {}
  })
};
sends = 0;
global.MailApp = {
  sendEmail: () => {
    sends += 1;
  }
};
makeLock(true);
createLogger('LoggerTest').error('Errore con destinatario property', { errorClass: 'FromProperty' });
assert(sends === 1, 'deve inviare usando ADMIN_EMAIL dalle Script Properties anche se CONFIG.LOGGING.ADMIN_EMAIL e vuoto');

console.log('--- Test logger: lock non disponibile evita invio concorrente ---');
installBaseGlobals();
global.CacheService = {
  getScriptCache: () => ({
    get: () => '',
    put: () => {
      throw new Error('non deve scrivere senza lock');
    }
  })
};
sends = 0;
global.MailApp = {
  sendEmail: () => {
    sends += 1;
  }
};
const lockStateBusy = makeLock(false);
createLogger('LoggerTest').error('Errore lock occupato', { errorClass: 'Busy' });

assert(sends === 0, 'non deve inviare se non acquisisce il lock');
assert(lockStateBusy.released === 0, 'non deve rilasciare un lock non acquisito');

console.log('✅ Test logger notifications OK');
