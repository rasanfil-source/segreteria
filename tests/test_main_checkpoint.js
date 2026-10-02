const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

const gasMainPath = path.join(__dirname, '..', 'gas_main.js');
const code = fs.readFileSync(gasMainPath, 'utf8');

const sandbox = {
  console,
  Date,
  Intl,
  JSON,
  Math,
  Set,
  Map,
  CONFIG: {}
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: gasMainPath });

console.log('--- Test _clearBatchCheckpoint_: elimina checkpoint e trigger resume globali ---');
{
  const props = new Map([['EMAIL_BATCH_CHECKPOINT', '{"version":2}']]);
  const resumeTrigger = { id: 'resume-old', getHandlerFunction: () => 'resumeEmailBatchFromCheckpoint' };
  const otherTrigger = { id: 'daily-main', getHandlerFunction: () => 'dailyMain' };
  const deleted = [];

  sandbox.PropertiesService = {
    getScriptProperties: () => ({
      deleteProperty: (key) => props.delete(key)
    })
  };
  sandbox.ScriptApp = {
    getProjectTriggers: () => [resumeTrigger, otherTrigger],
    deleteTrigger: (trigger) => deleted.push(trigger.id)
  };

  sandbox._clearBatchCheckpoint_();

  assert(!props.has('EMAIL_BATCH_CHECKPOINT'), 'deve cancellare il payload EMAIL_BATCH_CHECKPOINT');
  assert(deleted.length === 1 && deleted[0] === 'resume-old', 'deve eliminare solo i trigger globali di resume batch');
}

console.log('--- Test main: EXECUTION_LOCK_WAIT_MS=0 resta valore valido ---');
{
  const originalConfig = sandbox.CONFIG;
  const originalGmail = sandbox.Gmail;
  const originalUtilities = sandbox.Utilities;
  const originalLockService = sandbox.LockService;
  let observedWaitMs = null;

  sandbox.CONFIG = { EXECUTION_LOCK_WAIT_MS: 0 };
  sandbox.Gmail = {
    Users: {
      getProfile: () => ({ emailAddress: 'me@parrocchia.it' })
    }
  };
  sandbox.Utilities = { sleep: () => {} };
  sandbox.LockService = {
    getScriptLock: () => ({
      tryLock: (waitMs) => {
        observedWaitMs = waitMs;
        return false;
      },
      releaseLock: () => {
        assert(false, 'releaseLock non deve essere chiamato se tryLock fallisce');
      }
    })
  };

  try {
    sandbox.main();
    assert(observedWaitMs === 0, `main deve passare 0 a tryLock quando configurato, ottenuto ${observedWaitMs}`);
  } finally {
    sandbox.CONFIG = originalConfig;
    sandbox.Gmail = originalGmail;
    sandbox.Utilities = originalUtilities;
    sandbox.LockService = originalLockService;
  }
}

console.log('--- Test main: risorse non caricate falliscono senza auto-ripristino ---');
{
  const originalGmail = sandbox.Gmail;
  const originalUtilities = sandbox.Utilities;
  const originalLockService = sandbox.LockService;
  const originalCacheService = sandbox.CacheService;
  const originalLoadResources = sandbox.loadResources;
  const originalEmailProcessor = sandbox.EmailProcessor;
  const originalValidateConfigOrThrow = sandbox.validateConfigOrThrow;
  const originalGlobalCache = sandbox.GLOBAL_CACHE;

  let loadCalls = 0;
  let processorConstructed = false;

  sandbox.Gmail = {
    Users: {
      getProfile: () => ({ emailAddress: 'me@parrocchia.it' })
    }
  };
  sandbox.Utilities = { sleep: () => {} };
  sandbox.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {}
    })
  };
  sandbox.CacheService = {
    getScriptCache: () => ({
      get: () => null,
      put: () => {},
      remove: () => {}
    })
  };
  sandbox.GLOBAL_CACHE = {
    loaded: false,
    systemEnabled: true,
    knowledgeBase: '',
    doctrineBase: '',
    suspensionRules: {}
  };
  sandbox.validateConfigOrThrow = () => {};
  sandbox.loadResources = () => {
    loadCalls += 1;
    sandbox.GLOBAL_CACHE.loaded = false;
  };
  sandbox.EmailProcessor = class {
    constructor() {
      processorConstructed = true;
    }
  };

  try {
    sandbox.main();
    assert(loadCalls === 1, `main deve chiamare loadResources una sola volta, chiamate=${loadCalls}`);
    assert(processorConstructed === false, 'main non deve avviare la pipeline se GLOBAL_CACHE.loaded resta false');
  } finally {
    sandbox.Gmail = originalGmail;
    sandbox.Utilities = originalUtilities;
    sandbox.LockService = originalLockService;
    sandbox.CacheService = originalCacheService;
    sandbox.loadResources = originalLoadResources;
    sandbox.EmailProcessor = originalEmailProcessor;
    sandbox.validateConfigOrThrow = originalValidateConfigOrThrow;
    sandbox.GLOBAL_CACHE = originalGlobalCache;
  }
}

console.log('--- Test resume e main: confini temporali notBefore con clock simulato ---');
for (const remaining of [5001, 5000, 2000, 0, -1000]) {
  let now = 1800000000000;
  const initialNow = now;
  const events = [];
  class FakeDate extends Date { static now() { return now; } }
  const timing = vm.createContext({
    console: {log(){},warn(){},error(message){throw new Error(message);}},
    CONFIG: {}, Date: FakeDate, Math: Object.assign(Object.create(Math), {random:()=>0})
  });
  vm.runInContext(code, timing, {filename:gasMainPath});
  const checkpoint = {runId:'timing', pendingThreadIds:['pending'],notBefore:new Date(now+remaining).toISOString()};
  Object.assign(timing, {
    _readBatchCheckpoint_:()=>checkpoint,
    _acquireCheckpointResumeLock_:()=>{events.push('resume-lock');return true;},
    Utilities:{sleep(ms){if(ms) events.push(['sleep',ms]);now+=ms;}},
    Gmail:{Users:{getProfile:()=>({})}},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    validateConfigOrThrow(){}, withSheetsRetry:fn=>fn(),loadResources(){},
    isInSuspensionTime:()=>false,
    GLOBAL_CACHE:{loaded:true,systemEnabled:true},
    EmailProcessor:class {processUnreadEmails(kb,db,a,b,options){
      events.push('processed');
      assert(now >= initialNow + remaining,'non processare prima di notBefore');
      assert(options.threadIds[0]==='pending','riprendere il thread del checkpoint');
      return {};
    }}
  });
  timing.resumeEmailBatchFromCheckpoint();
  if(remaining>5000) {
    assert(events.length===0,'resume troppo anticipato non acquisisce lock né avvia main');
    timing.main();
    assert(events.length===0,'anche main deve rispettare notBefore oltre tolleranza');
  } else {
    assert(events[0]==='resume-lock','acquisire lock prima della ripresa');
    assert(events.at(-1)==='processed','completare la ripresa entro tolleranza');
    const sleeps=events.filter(Array.isArray);
    assert(sleeps.length===(remaining>0?1:0),'attesa solo se necessaria');
    if(remaining>0) assert(sleeps[0][1]===remaining,'attendere esattamente il tempo mancante');
  }
}
console.log('OK main checkpoint tests passed');
