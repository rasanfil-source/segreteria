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

console.log('--- Test _getSpreadsheetModifiedTimeMs compatibilità v2/v3 ---');

(function testDriveV3() {
  let calledWith = null;
  global.Drive = {
    Files: {
      get: (_id, options) => {
        calledWith = options && options.fields;
        if (calledWith !== 'modifiedTime') {
          throw new Error('Campo inatteso');
        }
        return { modifiedTime: '2026-03-30T20:00:00.000Z' };
      }
    }
  };

  const result = _getSpreadsheetModifiedTimeMs('sheet-id-v3');
  assert(calledWith === 'modifiedTime', 'deve interrogare modifiedTime in v3');
  assert(result === Date.parse('2026-03-30T20:00:00.000Z'), 'deve convertire modifiedTime in ms');
})();

(function testDriveV2Fallback() {
  const calls = [];
  global.Drive = {
    Files: {
      get: (_id, options) => {
        calls.push(options && options.fields);
        if (options.fields === 'modifiedTime') {
          throw new Error('Invalid field selection modifiedTime');
        }
        if (options.fields === 'modifiedDate') {
          return { modifiedDate: '2026-03-30T21:00:00.000Z' };
        }
        throw new Error('Campo non gestito');
      }
    }
  };

  const result = _getSpreadsheetModifiedTimeMs('sheet-id-v2');
  assert(calls.length === 2, 'deve tentare fallback da modifiedTime a modifiedDate');
  assert(calls[0] === 'modifiedTime' && calls[1] === 'modifiedDate', 'ordine fallback non corretto');
  assert(result === Date.parse('2026-03-30T21:00:00.000Z'), 'deve leggere modifiedDate nel fallback v2');
})();

console.log('✅ Test compatibilità Drive API passati');
