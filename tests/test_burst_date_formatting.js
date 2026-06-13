const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

const gasEmailProcessorPath = path.join(__dirname, '..', 'gas_email_processor.js');
vm.runInThisContext(fs.readFileSync(gasEmailProcessorPath, 'utf8'), { filename: gasEmailProcessorPath });

console.log('--- Test burst aggregation date formatting: Invalid Date non esplode ---');
{
  const originalUtilities = global.Utilities;
  delete global.Utilities;

  try {
    const processor = Object.create(EmailProcessor.prototype);
    const invalidDate = new Date('not-a-date');
    const formatted = processor._formatBurstMessageDate_(invalidDate);

    assert(formatted === 'data non disponibile', 'Invalid Date deve essere trattata come data assente');
  } finally {
    global.Utilities = originalUtilities;
  }
}

console.log('--- Test burst aggregation date formatting: fallback ISO valido ---');
{
  const originalUtilities = global.Utilities;
  delete global.Utilities;

  try {
    const processor = Object.create(EmailProcessor.prototype);
    const formatted = processor._formatBurstMessageDate_(new Date('2026-06-09T18:31:00.000Z'));

    assert(formatted === '2026-06-09', `fallback ISO inatteso: ${formatted}`);
  } finally {
    global.Utilities = originalUtilities;
  }
}

console.log('OK burst date formatting tests passed');
