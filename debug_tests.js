const { execSync } = require('child_process');
console.log("Running tests...");
try {
    const output = execSync('node scripts/ci_smoke_tests.js', { encoding: 'utf8', stdio: 'pipe' });
    console.log(output);
} catch (e) {
    console.log("--- STDOUT ---");
    console.log(e.stdout);
    console.log("--- STDERR ---");
    console.log(e.stderr);
}
