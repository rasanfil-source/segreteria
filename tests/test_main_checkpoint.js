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

console.log('OK main checkpoint tests passed');
