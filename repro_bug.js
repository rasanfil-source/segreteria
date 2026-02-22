const fs = require('fs');
const vm = require('vm');

// Mock globali minimi
global.Utilities = { getUuid: () => 'mock-uuid' };

// Carica lo script
const code = fs.readFileSync('gas_prompt_context.js', 'utf8');
vm.runInThisContext(code);

// La classe PromptContext dovrebbe essere disponibile nel contesto globale ora
// Se PromptContext è definita con "class PromptContext", in vm.runInThisContext(code) 
// viene definita nel sandbox.

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

try {
    console.log('--- Test: PromptContext Temporal Risk with Object KB ---');
    const pc = new PromptContext({
        knowledgeBase: { some: 'structured_data' },
        temporal: { mentionsDates: false }
    });

    console.log('Input knowledgeBaseMeta:', JSON.stringify(pc.input.knowledgeBaseMeta));
    console.log('Concerns:', JSON.stringify(pc.concerns));

    assert(pc.input.knowledgeBaseMeta.containsDates === true, "KB oggetto deve forzare containsDates: true");
    assert(pc.concerns.temporal_risk === true, "temporal_risk deve essere true per KB oggetto");
    console.log('✅ Test passato!');
} catch (e) {
    console.error('❌ Test fallito:', e.message);
}
