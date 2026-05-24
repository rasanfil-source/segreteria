const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.Utilities = { sleep: () => {} };
global.CONFIG = {};

const gasMainPath = path.join(__dirname, '..', 'gas_main.js');
const code = fs.readFileSync(gasMainPath, 'utf8');
vm.runInThisContext(code, { filename: gasMainPath });

console.log('--- Test _getSpreadsheetModifiedTimeMs ignora Drive modifiedTime ---');

(function testDriveIsNotPolled() {
  let driveCalled = false;
  global.Drive = {
    Files: {
      get: () => {
        driveCalled = true;
        throw new Error('Drive non deve essere interrogato per invalidare la cache KB');
      }
    }
  };

  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: () => null
    })
  };

  const result = _getSpreadsheetModifiedTimeMs('sheet-id-drive-ignored');
  assert(result === 0, 'senza timestamp custom deve restituire 0 e lasciare agire il TTL cache');
  assert(driveCalled === false, 'non deve interrogare Drive modifiedTime');

  delete global.PropertiesService;
})();

(function testCustomModifiedTimeWins() {
  let driveCalled = false;
  const customTs = Date.parse('2026-03-30T22:00:00.000Z');

  global.Drive = {
    Files: {
      get: () => {
        driveCalled = true;
        return { modifiedTime: '2026-03-31T22:00:00.000Z' };
      }
    }
  };

  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key) => key === 'KB_CUSTOM_MODIFIED_TIME' ? String(customTs) : null,
      setProperty: () => {
        throw new Error('polling cache non deve scrivere KB_CUSTOM_MODIFIED_TIME');
      }
    })
  };

  const result = _getSpreadsheetModifiedTimeMs('sheet-id-custom-only');
  assert(result === customTs, 'deve usare solo KB_CUSTOM_MODIFIED_TIME come invalidazione mirata');
  assert(driveCalled === false, 'non deve confrontare il timestamp custom con Drive modifiedTime');

  delete global.PropertiesService;
})();

console.log('✅ Test policy cache Drive ignorato passati');
