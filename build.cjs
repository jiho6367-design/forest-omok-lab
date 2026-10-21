const fs=require('fs'),path=require('path');
const read=f=>fs.readFileSync(path.join(__dirname,'src',f),'utf8');
require('./tools/learning/deployment.cjs').recoverDeployment();
const modelArg=process.argv.find(a=>a.startsWith('--model='));
const activeModel=require('./tools/build-model.cjs').load(__dirname,{baseline:process.argv.includes('--baseline'),explicitFile:modelArg?path.resolve(__dirname,modelArg.slice(8)):null});
const neural=read('neural-evaluator.js').replace(/if\(typeof module[^\n]+/g,'')+'\nOmokNeural.setDefaultModel('+JSON.stringify(activeModel).replace(/</g,'\\u003c')+');\n';
const reader=read('reader-engine.js').replace('function createEngine(', 'function createReaderEngine(').replace(/if\(typeof module[^\n]+/g,'');
const engine=neural+read('search-memory.js').replace(/if\(typeof module[^\n]+/g,'')+'\n'+read('gpu-patterns.js')+'\n'+read('strategy-engine.js').replace(/if\(typeof module[^\n]+/g,'')+'\n'+reader+'\n'+read('search-engine.js').replace(/if\(typeof module[^\n]+/g,'')+'\n'+read('unified-engine.js');
const studies=[29,31,33,47,48,95].map(n=>({n,coords:require('./test/reader/game'+n+'.cjs').coords,first:[31,48].includes(n)?1:2}));
const app=read('unified-app.js').replace('/*READER_STUDIES*/[]',()=>JSON.stringify(studies));
const template=read('template.html').replace('/*ENGINE*/',()=>engine).replace('/*APP*/',()=>read('analysis-settings.js')+'\n'+read('parallel-analysis.js')+'\n'+read('app.js')+'\n'+app+'\n'+read('gpu-app.js')+'\n'+read('neural-app.js'));
const appearance=require('./tools/build-appearance.cjs'),publicHtml=appearance.render(template),html=process.argv.includes('--public')?publicHtml:appearance.render(template,appearance.load(__dirname));
const stage=process.argv.find(a=>a.startsWith('--out-dir='));
if(stage){const target=path.resolve(__dirname,stage.slice(10));fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'omok.html'),html);fs.writeFileSync(path.join(target,'public.html'),publicHtml);console.log('Built staged '+path.join(target,'omok.html'));return;}
fs.mkdirSync(path.join(__dirname,'outputs'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'outputs/omok.html'),html);
fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});
fs.writeFileSync(path.join(__dirname,'dist/index.html'),publicHtml);
console.log('Built dist/index.html (public) and outputs/omok.html (local, offline)');
