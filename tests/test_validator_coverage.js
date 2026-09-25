const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { summarizeCoverage, enforceCoverage } = require('../scripts/validator_coverage');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-coverage-'));
try {
  const profiles = path.join(root, 'profiles');
  fs.mkdirSync(profiles);
  const file = path.join(root, 'gas_fixture.js');
  fs.writeFileSync(file, 'a'.repeat(100));
  const range = (startOffset, endOffset, count) => ({ startOffset, endOffset, count });
  const write = (name, ranges) => fs.writeFileSync(path.join(profiles, name), JSON.stringify({ result: [{ url: pathToFileURL(file).href, functions: [{ functionName: 'check', ranges }] }] }));
  write('one.json', [range(0, 100, 1), range(10, 50, 0)]);
  let report = summarizeCoverage(profiles, root);
  assert.equal(report['gas_fixture.js'].blocks.percent, 50);
  assert.equal(enforceCoverage(report, { 'gas_fixture.js': { blocks: 100, functions: 100 } }).length, 1);
  // A second run enters part of the previously missed block, but not its child.
  write('two.json', [range(0, 100, 1), range(20, 30, 0)]);
  report = summarizeCoverage(profiles, root);
  assert.equal(report['gas_fixture.js'].blocks.covered, 2);
  assert.equal(report['gas_fixture.js'].blocks.total, 3);
  // V8 omits equal-count children: root coverage here covers all union ranges.
  write('three.json', [range(0, 100, 1)]);
  report = summarizeCoverage(profiles, root);
  assert.equal(report['gas_fixture.js'].blocks.percent, 100);
  assert.equal(enforceCoverage(report, { 'gas_fixture.js': { blocks: 100, functions: 100, methods: { check: 100 } } }).length, 0);
  assert.equal(enforceCoverage(report, { 'gas_missing.js': { blocks: 1 } }).length, 1);
  assert.equal(enforceCoverage(report, { 'gas_fixture.js': { methods: { missing: 100 } } }).length, 1);
  console.log('Coverage merge and failure gates passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
