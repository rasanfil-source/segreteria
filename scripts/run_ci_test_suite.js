const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.join(__dirname, '..');

function runNode(label, args) {
  console.log(label);
  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    stdio: 'inherit'
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
    stdio: 'inherit'
  });

  if (result.status === 0) {
    passed++;
  } else {
    failed++;
  }
}

console.log(`==> Modular tests summary: passed=${passed}, failed=${failed}, total=${testFiles.length}`);
if (failed !== 0) {
  console.error('Alcuni test modulari sono falliti');
  process.exit(1);
}

console.log('CI Node suite completata con successo');
