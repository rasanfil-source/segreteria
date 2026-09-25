const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { summarizeCoverage, enforceCoverage } = require('./validator_coverage');

const rootDir = path.join(__dirname, '..');
// Fresh profiles prevent stale runs from concealing a coverage regression.
const outputDir = path.join(rootDir, 'outputs', 'coverage');
fs.mkdirSync(outputDir, { recursive: true });
const coverageDir = fs.mkdtempSync(path.join(outputDir, 'v8-'));
const childEnv = { ...process.env, TZ: 'Europe/Rome', NODE_V8_COVERAGE: coverageDir };

function runNode(label, args) {
  console.log(label);
  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: childEnv
  });

  if (result.error) {
    console.error(`Errore esecuzione ${label}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('==> [1/3] Smoke tests');
runNode('', [path.join('scripts', 'ci_smoke_tests.js')]);

console.log('==> [2/3] Unit test suite');
runNode('', ['gas_unit_tests.js']);

console.log('==> [3/3] Modular Node tests (tests/test_*.js)');
const testsDir = path.join(rootDir, 'tests');
const testFiles = fs.readdirSync(testsDir)
  .filter(name => /^test_.*\.js$/.test(name))
  .sort()
  .map(name => path.join('tests', name));

if (testFiles.length === 0) {
  console.error('Nessun file tests/test_*.js trovato');
  process.exit(1);
}

let passed = 0;
let failed = 0;

for (const testFile of testFiles) {
  console.log(`---- RUN ${testFile}`);
  const result = spawnSync(process.execPath, [testFile], {
    cwd: rootDir,
    stdio: 'inherit',
    env: childEnv
  });

  if (result.status === 0) {
    passed++;
  } else {
    failed++;
  }
}

console.log(`==> Modular tests summary: passed=${passed}, failed=${failed}, total=${testFiles.length}`);
const coverage = summarizeCoverage(coverageDir, rootDir);
const reportPath = path.join(outputDir, 'summary.json');
fs.writeFileSync(reportPath, JSON.stringify(coverage, null, 2) + '\n');
const policy = JSON.parse(fs.readFileSync(path.join(rootDir, 'tests', 'validator_coverage_policy.json'), 'utf8'));
for (const filename of Object.keys(policy)) {
  const file = coverage[filename];
  if (file) console.log(`Coverage ${filename}: functions=${file.functions.percent.toFixed(2)}%, V8 blocks=${file.blocks.percent.toFixed(2)}%`);
}
console.log(`Coverage report: ${reportPath}`);
const coverageFailures = enforceCoverage(coverage, policy);
if (coverageFailures.length) {
  console.error(coverageFailures.join('\n'));
  process.exitCode = 1;
}
if (failed !== 0) {
  console.error('Alcuni test modulari sono falliti');
  process.exit(1);
}

if (!process.exitCode) console.log('CI Node suite completata con successo');
