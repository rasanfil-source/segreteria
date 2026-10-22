// GAS carica tutti i file .js nella cartella principale; il caricatore dei test Node riproduce questo comportamento.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');
module.exports = function loadThreadComponents(context) {
  for (const filename of fs.readdirSync(root).filter(name => /^gas_thread_.*\.js$/.test(name)).sort()) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    const absolutePath = path.join(root, filename);
    if (context) vm.runInContext(source, context, { filename: absolutePath });
    else vm.runInThisContext(source, { filename: absolutePath });
  }
};
