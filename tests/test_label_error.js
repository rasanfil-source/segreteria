const fs = require('fs');
const vm = require('vm');

// Mock environments for EmailProcessor
global.createLogger = (name) => ({
    info: (...args) => console.log(`[INF] ${name}:`, ...args),
    warn: (...args) => console.warn(`[WRN] ${name}:`, ...args),
    error: (...args) => console.error(`[ERR] ${name}:`, ...args),
    debug: (...args) => console.log(`[DBG] ${name}:`, ...args),
});

global.LockService = {
    getScriptLock: () => ({
        tryLock: () => true,
        releaseLock: () => {}
    })
};

global.GmailApp = {
    search: () => [{}, {}] // Mock 2 threads
};

global.GeminiService = class {};
global.Classifier = class {};
global.RequestTypeClassifier = class {};
global.ResponseValidator = class {};
global.PromptEngine = class {};
global.MemoryService = class {};
global.TerritoryValidator = class {};
global.classifyError = () => ({ type: 'UNKNOWN', retryable: false, message: 'fake' });

global.CONFIG = {
    LABEL_NAME: 'IA',
    MAX_EMAILS_PER_RUN: 10,
    MAX_EXECUTION_TIME_MS: 300000,
    SEARCH_PAGE_SIZE: 50
};

// Load dependencies
const scriptsToLoad = [
    'gas_error_types.js',
    'gas_email_processor.js'
];

scriptsToLoad.forEach(file => {
    const code = fs.readFileSync(file, 'utf8');
    vm.runInThisContext(code);
});

async function runTest() {
    console.log('--- Testing EmailProcessor.processUnreadEmails with failing GmailService ---');

    const failingGmailService = {
        getUnprocessedUnreadThreads: () => {
            throw new Error('API Quota Exceeded');
        }
    };

    const processor = new EmailProcessor({
        gmailService: failingGmailService
    });

    processor._trackEmptyInboxStreak = () => 0;

    const result = processor.processUnreadEmails('Some knowledge base');

    console.log('Result:', JSON.stringify(result, null, 2));

    if (result.reason === 'thread_discovery_failed' && result.errors === 1) {
        console.log('✅ TEST PASSED: Error correctly handled and batch interrupted.');
    } else {
        console.log('❌ TEST FAILED: Unexpected result.');
        process.exit(1);
    }
}

runTest();
