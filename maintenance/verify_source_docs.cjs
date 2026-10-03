// Verifica commenti JavaScript e collegamenti locali della documentazione.
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('internal/deps/acorn/acorn/dist/acorn');
const root = path.resolve(__dirname, '..');
function collect(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    if (['.git','outputs','scratch','.agents','node_modules'].includes(entry.name)) return [];
    const file = path.join(dir,entry.name);
    return entry.isDirectory() ? collect(file) : [file];
  });
}
const files = collect(root), errors = [];
let commentsCount = 0, sourceCount = 0, linksCount = 0;
for (const file of files) {
  const source = fs.readFileSync(file,'utf8');
  if (/\.(?:js|cjs|mjs)$/.test(file)) {
    const comments=[];
    acorn.parse(source,{ecmaVersion:'latest',sourceType:file.endsWith('.mjs')?'module':'script',
      onComment:comments,locations:true,allowHashBang:true});
    sourceCount++; commentsCount+=comments.length;
    for (const comment of comments) {
      // Riconosce frasi inglesi e annotazioni cronologiche, senza esaminare prompt o stringhe.
      const prose = comment.value.replace(/@[a-z]+/gi, '');
      if (/\b(?:the|must|should|without|whereas|unchanged|previously|returns|preserves|regression tests|audit correction|fix architetturale|versione precedente|NUOVO:)\b/i.test(prose)) {
        errors.push(`${path.relative(root,file)}:${comment.loc.start.line}: commento da rivedere`);
      }
    }
  }
  if (file.endsWith('.md')) {
    for(const match of source.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const target=match[1].trim().replace(/^<|>$/g,'').split(/\s+"/)[0];
      if (/^(?:[a-z]+:|#|\/)/i.test(target)) continue;
      const relative=decodeURIComponent(target.split('#')[0]);
      if (!relative) continue;
      const resolved=path.resolve(path.dirname(file),relative);
      // Gli artefatti generati sono facoltativi e non fanno parte delle guide distribuite.
      if (resolved.startsWith(path.join(root,'outputs')+path.sep)) continue;
      linksCount++;
      if (!fs.existsSync(resolved)) errors.push(`${path.relative(root,file)}: collegamento assente ${target}`);
    }
  }
}
console.log(`${sourceCount} sorgenti JavaScript, ${commentsCount} commenti, ${linksCount} collegamenti locali verificati.`);
if(errors.length) {console.error(errors.join('\n'));process.exitCode=1;}
else console.log('Controllo editoriale superato. La verifica lessicale supporta la revisione umana della lingua.');
