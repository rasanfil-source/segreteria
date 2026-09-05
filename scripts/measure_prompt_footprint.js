// Esegue solo test locali; cattura i payload renderizzati, senza chiamate API.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
if (process.env.PROMPT_MEASURE_CHILD) {
  const original = vm.runInThisContext;
  const counts = [];
  const wrap = (owner, name, kind) => {
    if (!owner || !owner[name] || owner[name]._measured) return;
    const method = owner[name];
    const replacement = function(...args) {
      const result = method.apply(this, args);
      const payload = typeof result === 'string' ? result :
        [result?.systemInstruction, result?.prompt].filter(x => typeof x === 'string').join('\n');
      // Stima conservativa locale del progetto; non è il tokenizer Gemini.
      if (payload) counts.push({kind, chars: payload.length, tokens: Math.ceil(payload.length / 3.2)});
      return result;
    };
    replacement._measured = true;
    owner[name] = replacement;
  };
  vm.runInThisContext = function(...args) {
    const result = original.apply(this, args);
    wrap(global.PromptEngine?.prototype, 'buildPrompt', 'generation');
    wrap(global.EmailQuickCheckPolicy, 'buildPrompt', 'quick_check');
    return result;
  };
  process.on('exit', () => fs.writeFileSync(process.env.PROMPT_MEASURE_CHILD, JSON.stringify(counts)));
} else {
  const os = require('os');
  const cases = ['test_physical_presence_constraint.js', 'test_prompt_response_quality.js',
    'test_prompt_envelope_full_warm.js', 'test_gemini_service.js'];
  const output = {};
  for (const test of cases) {
    const target = path.join(os.tmpdir(), `prompt-measure-${process.pid}-${test}.json`);
    const child = cp.spawnSync(process.execPath, ['--require', __filename, path.join('tests', test)], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
      env: {...process.env, PROMPT_MEASURE_CHILD: target}
    });
    if (child.status !== 0) throw new Error(`${test}: ${child.stdout}\n${child.stderr}`);
    output[test] = JSON.parse(fs.readFileSync(target));
    fs.unlinkSync(target);
  }
  if (process.argv.includes('--routing')) {
    const root = path.resolve(__dirname, '..');
    const quiet = {log(){},info(){},warn(){},error(){},debug(){}};
    const context = {console:quiet,CONFIG:{MAX_SAFE_TOKENS:100000,MAX_SAFE_PROMPT_CHARS:120000},createLogger:()=>quiet};
    vm.createContext(context);
    for (const file of ['gas_response_strategy.js','gas_prompt_engine.js']) {
      vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
    }
    output.routing = vm.runInContext(`(() => {
      const engine = new PromptEngine();
      const options = {emailSubject:'Orari',emailContent:'Vorrei gli orari della segreteria.',
        knowledgeBase:'Segreteria: lunedi e martedi dalle 10 alle 12.',detectedLanguage:'it',
        salutationMode:'full',salutation:'Buongiorno,',closing:'Cordiali saluti,',
        physicalPresenceConstraint:{has_constraint:false,type:'none'}};
      const chars = result => typeof result==='string' ? result.length :
        [result.systemInstruction,result.prompt].filter(x=>typeof x==='string').join('\\n').length;
      return ['urgent','hesitant','appreciative','direct'].map(posture => {
        const before = chars(engine.buildPrompt({...options,relationalPosture:posture,responseStrategy:'none',responseStrategyInferenceBlocked:true}));
        const after = chars(engine.buildPrompt({...options,relationalPosture:posture,
          responseStrategy:mapRelationalPostureToResponseStrategy_(posture),responseStrategyInferenceBlocked:false}));
        return {posture,before,after,deltaChars:after-before,deltaTokens:Math.ceil(after/3.2)-Math.ceil(before/3.2)};
      });
    })()`,context);
  }
  console.log(JSON.stringify(output, null, 2));
}
