// Native V8 function/block coverage: byte ranges, not Istanbul branch or MC/DC coverage.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

function summarizeCoverage(directory, rootDir) {
  const scripts = new Map();
  for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const payload = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    for (const script of payload.result || []) {
      let filename = script.url;
      if (filename.startsWith('file://')) filename = fileURLToPath(filename);
      if (!path.isAbsolute(filename)) continue; // Unattributed VM scripts cannot be measured safely.
      filename = path.resolve(filename);
      if (path.dirname(filename) !== rootDir || !/^gas_.*\.js$/.test(path.basename(filename)) || path.basename(filename) === 'gas_unit_tests.js') continue;
      const entries = scripts.get(filename) || [];
      entries.push(script);
      scripts.set(filename, entries);
    }
  }
  const files = {};
  const metric = entries => ({ covered: entries.filter(Boolean).length, total: entries.length, percent: entries.length ? 100 * entries.filter(Boolean).length / entries.length : 0 });
  for (const [filename, runs] of scripts) {
    const source = fs.readFileSync(filename, 'utf8');
    const lineAt = offset => source.slice(0, offset).split('\n').length;
    const functions = new Map();
    for (const run of runs) for (const fn of run.functions) {
      const root = fn.ranges[0];
      const key = `${root.startOffset}:${root.endOffset}`;
      const item = functions.get(key) || { name: fn.functionName || '(anonymous)', start: root.startOffset, runs: [], ranges: new Map() };
      item.runs.push(fn.ranges);
      for (const range of fn.ranges) item.ranges.set(`${range.startOffset}:${range.endOffset}`, range);
      functions.set(key, item);
    }
    const details = [];
    for (const fn of functions.values()) {
      // V8 elides inner ranges with the same count as the enclosing range.
      // Evaluate union ranges against the smallest enclosing range in EACH run
      // before OR-merging. Summing only identical offsets undercounts coverage.
      const ranges = [...fn.ranges.values()].map(range => {
        const covered = fn.runs.some(run => {
          const enclosing = run.filter(r => r.startOffset <= range.startOffset && r.endOffset >= range.endOffset)
            .sort((a, b) => (a.endOffset - a.startOffset) - (b.endOffset - b.startOffset))[0];
          return enclosing && enclosing.count > 0;
        });
        return { line: lineAt(range.startOffset), covered };
      });
      details.push({ name: fn.name, line: lineAt(fn.start), called: fn.runs.some(run => run[0].count > 0), blocks: metric(ranges.map(r => r.covered)), uncoveredLines: [...new Set(ranges.filter(r => !r.covered).map(r => r.line))] });
    }
    files[path.basename(filename)] = {
      functions: metric(details.map(fn => fn.called)),
      blocks: { covered: details.reduce((sum, fn) => sum + fn.blocks.covered, 0), total: details.reduce((sum, fn) => sum + fn.blocks.total, 0) },
      details
    };
    const blocks = files[path.basename(filename)].blocks;
    blocks.percent = 100 * blocks.covered / blocks.total;
  }
  return files;
}

function enforceCoverage(files, policy) {
  const failures = [];
  for (const [filename, limits] of Object.entries(policy)) {
    const file = files[filename];
    if (!file) { failures.push(`${filename}: no attributed coverage collected`); continue; }
    for (const metric of ['functions', 'blocks']) {
      if (file[metric].percent < limits[metric]) failures.push(`${filename}: ${metric} ${file[metric].percent.toFixed(2)}% < ${limits[metric]}%`);
    }
    for (const [name, minimum] of Object.entries(limits.methods || {})) {
      const matches = file.details.filter(fn => fn.name === name);
      if (!matches.length || matches.some(fn => fn.blocks.percent < minimum)) failures.push(`${filename} ${name}: block coverage below ${minimum}% or missing`);
    }
  }
  return failures;
}

module.exports = { summarizeCoverage, enforceCoverage };
