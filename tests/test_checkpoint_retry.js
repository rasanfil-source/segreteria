const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

const props = new Map();
let labeledThreadIds = [];

global.CONFIG = {
  ERROR_LABEL_NAME: 'Errore',
  BATCH_CHECKPOINT_MAX_RETRIES: 3,
  BATCH_CHECKPOINT_TTL_MS: 10 * 60 * 1000
};
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => props.get(k) || '',
    setProperty: (k, v) => props.set(k, String(v)),
    deleteProperty: (k) => props.delete(k)
  })
};
global.GmailApp = {
  getThreadById: (id) => ({
    getId: () => id,
    addLabel: () => labeledThreadIds.push(id)
  }),
  getUserLabelByName: () => null,
  createLabel: () => null
};
global.GmailService = class {
  addLabelToThread(thread, labelName) {
    if (labelName === 'Errore') labeledThreadIds.push(thread.getId());
  }
};
global.console = console;

const gasMainPath = path.join(__dirname, '..', 'gas_main.js');
const code = fs.readFileSync(gasMainPath, 'utf8');
vm.runInThisContext(code, { filename: gasMainPath });

console.log('--- Test _readBatchCheckpoint_: abbandona dopo max retry senza label Errore ---');
props.set('EMAIL_BATCH_CHECKPOINT', JSON.stringify({
  version: 2,
  runId: 'retry-loop',
  createdAt: new Date().toISOString(),
  retryCount: 3,
  pendingThreadIds: ['t400', 't401']
}));
const abandoned = _readBatchCheckpoint_();
assert(abandoned === null, 'checkpoint oltre soglia deve essere abbandonato');
assert(!props.has('EMAIL_BATCH_CHECKPOINT'), 'checkpoint abbandonato deve essere cancellato');
assert(labeledThreadIds.length === 0, `checkpoint abbandonato per retryCount non deve applicare label Errore, ottenuto ${labeledThreadIds.join(',')}`);

console.log('--- Test _readBatchCheckpoint_: accetta checkpoint sotto soglia ---');
labeledThreadIds = [];
props.set('EMAIL_BATCH_CHECKPOINT', JSON.stringify({
  version: 2,
  runId: 'retry-ok',
  createdAt: new Date().toISOString(),
  retryCount: 2,
  pendingThreadIds: ['t402']
}));
const accepted = _readBatchCheckpoint_();
assert(accepted && accepted.runId === 'retry-ok', 'checkpoint sotto soglia deve essere letto');
assert(props.has('EMAIL_BATCH_CHECKPOINT'), 'checkpoint sotto soglia non deve essere cancellato');
assert(labeledThreadIds.length === 0, 'checkpoint sotto soglia non deve applicare label Errore');

console.log('--- Test _readBatchCheckpoint_: preserva checkpoint se PropertiesService non legge ---');
{
  const originalPropertiesService = global.PropertiesService;
  let deleteCalled = false;
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: () => {
        throw new Error('servizio temporaneamente non disponibile');
      },
      deleteProperty: () => {
        deleteCalled = true;
      }
    })
  };

  try {
    const unavailable = _readBatchCheckpoint_();
    assert(unavailable === null, 'lettura non disponibile deve restituire null');
    assert(deleteCalled === false, 'lettura non disponibile non deve cancellare il checkpoint');
  } finally {
    global.PropertiesService = originalPropertiesService;
  }
}

console.log('✅ Test checkpoint main passati');
