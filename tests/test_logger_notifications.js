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
global.MailApp = {
  sendEmail: () => {
    sends += 1;
  }
};
const lockStateSend = makeLock(true);
createLogger('LoggerTest').error('Errore nuovo', { errorClass: 'Fresh' });

assert(sends === 1, 'deve inviare una sola email per errore nuovo');
assert(puts.some((p) => p.value === 'pending' && p.ttl === 60), 'deve marcare pending prima dell invio');
assert(puts.some((p) => p.value === 'sent' && p.ttl === 3600), 'deve marcare sent dopo invio riuscito');
assert(lockStateSend.released === 1, 'deve rilasciare il lock dopo l invio');

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
