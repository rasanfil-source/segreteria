// Deployment remains the existing rootDir=./ + .claspignore GAS file loading.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const components = fs.readdirSync(root).filter(name => /^gas_thread_.*\.js$/.test(name)).sort();
const rules = fs.readFileSync(path.join(root, '.claspignore'), 'utf8').split(/\r?\n/)
  .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8')).runtimeVersion, 'V8');
assert.equal(components.length, 11, 'All eleven extracted component files must be present');
for (const filename of components) {
  let excluded = false;
  for (const rule of rules) {
    const negate = rule.startsWith('!');
    if (path.matchesGlob(filename, negate ? rule.slice(1) : rule)) excluded = !negate;
  }
  assert(!excluded, `${filename} would be excluded by .claspignore`);
  const source = fs.readFileSync(path.join(root, filename), 'utf8');
  assert(!/\b(?:require\s*\(|import\s|module\.exports)/.test(source), `${filename}: GAS must not depend on a Node module loader`);
  new vm.Script(source, { filename });
}
const context = vm.createContext({});
for (const filename of ['gas_email_processor.js', ...components.slice().reverse()]) {
  vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename: path.join(root, filename) });
}
assert.equal(context.EmailProcessor.prototype.processThread.length, 3, 'Public signature retains the same default-argument boundary');
console.log(`GAS loading: ${components.length} root components included, syntax valid, no Node imports or initialization-order dependency`);
