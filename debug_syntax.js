const { execSync } = require('child_process');

function check(file) {
    console.log(`Checking ${file}...`);
    try {
        execSync(`node -c ${file}`, { encoding: 'utf8', stdio: 'pipe' });
        console.log("OK");
    } catch (e) {
        console.log("FAIL");
        console.log(e.stderr);
    }
}

check('gas_email_processor.js');
check('gas_prompt_engine.js');
