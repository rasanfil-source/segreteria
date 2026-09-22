// Offline migration helper. Never connects to Apps Script or prints addresses.
// Run before deployment: node maintenance/export_legacy_blacklist.js [git-ref]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const ref = process.argv[2] || 'HEAD';
if (!/^[a-zA-Z0-9_./-]+$/.test(ref) || ref.startsWith('-')) throw new Error('Invalid git ref');
const code = execFileSync('git', ['show', `${ref}:gas_config.js`], { cwd: root, encoding: 'utf8' });
const block = code.match(/IGNORE_DOMAINS\s*:\s*\[([\s\S]*?)\]/);
if (!block) throw new Error('Legacy blacklist not found');
const entries = [...new Set((block[1].match(/[a-zA-Z0-9._%+-]+@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/g) || []).map(x => x.toLowerCase()))];
if (!entries.length) throw new Error('No legacy personal entries at this ref');
const destination = path.join(root, 'outputs', 'personal-ignore-senders.local.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(entries), { flag: 'wx' });
console.log('Local migration file created under ignored outputs/. Import manually into PERSONAL_IGNORE_SENDERS; then remove the local file.');
