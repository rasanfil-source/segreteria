const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.Utilities = {
  getUuid: () => 'uuid-test'
};

const gasGmailServicePath = path.join(__dirname, '..', 'gas_gmail_service.js');
const code = fs.readFileSync(gasGmailServicePath, 'utf8');
vm.runInThisContext(code, { filename: gasGmailServicePath });

console.log('--- Test sanitizeUrl ---');
assert(sanitizeUrl('https://example.org/path?q=1') === 'https://example.org/path?q=1', 'URL https valido deve passare');
assert(sanitizeUrl('javascript:alert(1)') === null, 'URL javascript deve essere bloccato');
assert(sanitizeUrl('http://127.0.0.1/test') === null, 'URL localhost deve essere bloccato (SSRF)');

console.log('--- Test markdownToHtml escaping/sicurezza ---');
const html = markdownToHtml('Ciao **Mondo**\n[link](https://example.org)\n<script>alert(1)</script>');
assert(html.includes('<strong>Mondo</strong>'), 'bold markdown deve essere renderizzato');
assert(html.includes('href="https://example.org"'), 'link https deve essere mantenuto');
assert(!html.includes('<script>alert(1)</script>'), 'script raw non deve passare');
assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'script deve essere escaped');

console.log('✅ Test sanitizzazione Gmail/HTML passati');
