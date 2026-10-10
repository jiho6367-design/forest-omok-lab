'use strict';
// Small generated boards only: no learning runs, real training positions,
// adopted model, deployment recovery, final arena, or elapsed-time selection.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=process.env.OMOK_LOSS_SOURCE_ROOT||path.resolve(__dirname,'../src');
const base=process.env.OMOK_LOSS_BASE_SOURCE||null;
const names=['neural-evaluator.js','search-memory.js','gpu-patterns.js','strategy-engine.js','reader-engine.js','forest-engine.js','unified-engine.js'];
const idx=c=>(Number(c.slice(1))-1)*15+c.charCodeAt(0)-65,blank=()=>Array(225).fill(0),plain=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
function fixture(black,white=[]){const b=blank();for(const c of black)b[idx(c)]=1;for(const c of white)b[idx(c)]=2;return b;}
function load(directory,clock){const context={Date,console,performance:clock||require('node:perf_hooks').performance};vm.createContext(context);
 const texts=names.map(name=>fs.readFileSync(path.join(directory,name),'utf8'));texts[4]=texts[4].replace('function createEngine(','function createReaderEngine(');
 vm.runInContext(texts.join('\n'),context);return {unified:context.createEngine,reader:context.createReaderEngine,context};}
const factories=load(source),baseline=base?load(base):null;let checks=0;
function test(name,fn){fn();checks++;console.log('PASS',name);}
function readerResult(b,p,ms){const e=factories.reader(15,b,{strategy:false,optimized:true}),copy=b.slice(),r=e.analyze(p,ms);assert.deepEqual(Array.from(e.board),copy);return {e,r};}
function coverage(e,r,p){const legal=Array.from({length:225},(_,i)=>i).filter(i=>e.legal(i,p));assert.equal(r.lossCoverage.scope,'all-legal-roots');assert(r.lossCoverage.complete);assert.equal(r.lossCoverage.legalRoots,legal.length);
 assert.equal(r.lossCoverage.explicitlyRefutedRoots+r.lossCoverage.implicitImmediateRoots,legal.length);assert.equal(r.screeningComplete,true);assert.equal(r.forcingChecksComplete,true);return legal;}
function sameChoices(before,after){for(const key of ['kind','depth','nodes','danger','fallback','mandatoryDefense','lossReason','rejectedMoves','moves'])assert.deepEqual(plain(after[key]),plain(before[key]),'Reader search/move evidence changed: '+key);}
const forks=fixture(['D4','E4','F4','J11','K11','L11']);
test('completed ordinary loss screen publishes complete all-legal-root coverage',()=>{
 const {e,r}=readerResult(forks,2,1000),legal=coverage(e,r,2);assert.equal(r.kind,'lost');assert.equal(r.depth,3);assert.equal(r.counterProof,null);
 assert.equal(r.screened,legal.length);assert.equal(r.rejectedMoves.length,legal.length);assert.equal(r.lossCoverage.explicitlyRefutedRoots,legal.length);assert.equal(r.lossCoverage.implicitImmediateRoots,0);
 assert(r.moves.length&&r.moves.every(m=>m.score<0&&e.legal(m.i,2)));if(baseline)sameChoices(baseline.reader(15,forks,{strategy:false,optimized:true}).analyze(2,1000),r);
});
test('completed real counter routine retains its actual certificate and every legal root',()=>{
 const {e,r}=readerResult(forks,2,3000),legal=coverage(e,r,2);assert.equal(r.kind,'lost');assert.equal(r.depth,0);assert(r.counterProof.complete);assert.equal(r.counterProof.checkedRoots,legal.length);
 assert.equal(r.counterProof.forcing,19);assert.equal(r.counterProof.quiet,1);assert.equal(r.lossCoverage.explicitlyRefutedRoots,legal.length);assert.equal(r.lossCoverage.implicitImmediateRoots,0);
 if(baseline){const old=baseline.reader(15,forks,{strategy:false,optimized:true}).analyze(2,3000);sameChoices(old,r);for(const key of ['complete','checkedRoots','forcing','quiet'])assert.equal(r.counterProof[key],old.counterProof[key]);}
});
test('single mandatory block plus implicit immediate losses covers the whole board',()=>{
 const b=fixture(['D4','E4','F4','G4','J11','K11','L11'],['C4']),{e,r}=readerResult(b,2,1000),legal=coverage(e,r,2);
 assert.equal(r.kind,'lost');assert.deepEqual(Array.from(r.danger),[idx('H4')]);assert.deepEqual(Array.from(r.moves,m=>m.i),[idx('H4')]);assert(r.mandatoryDefense);
 assert.equal(r.lossCoverage.mandatoryBlock,idx('H4'));assert.equal(r.lossCoverage.explicitlyRefutedRoots,1);assert.equal(r.lossCoverage.implicitImmediateRoots,legal.length-1);assert.equal(r.counterProof,null);
 for(const i of legal.filter(i=>i!==idx('H4'))){const c=b.slice();c[i]=2;assert(factories.reader(15,c,{strategy:false}).winMove(idx('H4'),1));}
 if(baseline)sameChoices(baseline.reader(15,b,{strategy:false,optimized:true}).analyze(2,1000),r);
});
test('two immediate winning points cover all legal resistance without invented counter work',()=>{
 const b=fixture(['D8','E8','F8','G8']),{e,r}=readerResult(b,2,30),legal=coverage(e,r,2);assert.equal(r.kind,'lost');assert.equal(r.danger.length,2);assert.equal(r.counterProof,null);
 assert.equal(r.lossCoverage.explicitlyRefutedRoots,0);assert.equal(r.lossCoverage.implicitImmediateRoots,legal.length);assert.equal(r.lossCoverage.mandatoryBlock,null);
 if(baseline)sameChoices(baseline.reader(15,b,{strategy:false,optimized:true}).analyze(2,30),r);
});
test('forbidden unique block is complete immediate loss and never offered as resistance',()=>{
 const b=fixture(['D8','E8','F8','G8'],['C8','H6','H7','I9','J10']),{e,r}=readerResult(b,2,30),legal=coverage(e,r,2);
 assert.equal(r.kind,'lost');assert.equal(r.lossReason,'forbidden-defense');assert(!e.legal(idx('H8'),2));assert(r.moves.every(m=>m.i!==idx('H8')&&e.legal(m.i,2)));
 assert.equal(r.lossCoverage.mandatoryBlock,null);assert.equal(r.lossCoverage.explicitlyRefutedRoots,0);assert.equal(r.lossCoverage.implicitImmediateRoots,legal.length);assert.equal(r.counterProof,null);
 if(baseline)sameChoices(baseline.reader(15,b,{strategy:false,optimized:true}).analyze(2,30),r);
});
test('interrupted real screening stays unresolved and gets no completed loss certificate',()=>{
 const clock=()=>{let n=0;return {now:()=>++n};},F=load(source,clock()),e=F.reader(15,forks,{strategy:false,optimized:true}),r=e.analyze(2,30);
 assert.notEqual(r.kind,'lost');assert.equal(r.screeningComplete,false);assert.equal(r.forcingChecksComplete,false);assert(!r.lossCoverage);assert.deepEqual(Array.from(e.board),forks);
 if(base){const old=load(base,clock()).reader(15,forks,{strategy:false,optimized:true}).analyze(2,30);sameChoices(old,r);}
});
test('fixed search work is identical; ordinary evaluations are not converted to mate values',()=>{
 const b=fixture(['H8','I9'],['G8']),e=factories.reader(15,b,{strategy:false,optimized:true}),r=e.fixedWork(2,1);assert.deepEqual(Array.from(e.board),b);assert(Number.isFinite(r.score));
 if(baseline){const old=baseline.reader(15,b,{strategy:false,optimized:true}).fixedWork(2,1);for(const key of ['score','pv','nodes','depth'])assert.deepEqual(plain(r[key]),plain(old[key]));}
});
test('public lost position preserves negative proof score and unchanged practical candidate ordering',()=>{
 const E=factories.unified({model:null,strategy:false}),input=forks.slice(),r=E.analyze(input,2,1000);assert(r.lossProven&&!r.proven);assert(r.fallback);assert.equal(r.score,-10000000);assert(r.lossCoverage.complete);
 assert(E.inspect(input,r.i,2).legal);assert.deepEqual(input,forks);assert(Number.isFinite(r.candidates[0].score));assert.notEqual(r.candidates[0].score,r.score,'practical candidate heuristic is separate from negative position score');assert.equal(Math.tanh(r.score/200000),-1,'existing analysis teacher scalar maps proven loss negative');
 if(baseline){const old=baseline.unified({model:null,strategy:false}).analyze(forks.slice(),2,1000);for(const key of ['i','pv','depth','nodes','candidates','rejected','kind','fallback','lossProven'])assert.deepEqual(plain(r[key]),plain(old[key]),'Public practical choice changed: '+key);assert.notEqual(old.score,r.score);}
});
test('public loss branches and the existing urgent mandatory answer retain candidate scores and choices',()=>{
 const cases=[{b:forks,ms:1000},{b:forks,ms:3000},
  {b:fixture(['D4','E4','F4','G4','J11','K11','L11'],['C4']),ms:1000,urgentBlock:true},
  {b:fixture(['D8','E8','F8','G8']),ms:30},
  {b:fixture(['D8','E8','F8','G8'],['C8','H6','H7','I9','J10']),ms:30}];
 for(const {b,ms,urgentBlock} of cases){const E=factories.unified({model:null,strategy:false}),copy=b.slice(),r=E.analyze(copy,2,ms);
  if(urgentBlock){assert(!r.lossProven&&!r.proven);assert.equal(r.kind,'block');assert.equal(r.i,idx('H4'));assert.equal(r.score,0);assert(!r.lossCoverage);}
  else {assert(r.lossProven&&!r.proven);assert(r.score<0);assert(r.lossCoverage.complete);}assert(E.inspect(copy,r.i,2).legal);assert.deepEqual(copy,b);
  if(baseline){const old=baseline.unified({model:null,strategy:false}).analyze(b.slice(),2,ms);for(const key of ['i','pv','depth','nodes','candidates','rejected','kind','fallback','lossProven','mandatoryDefense'])assert.deepEqual(plain(r[key]),plain(old[key]),'Practical public loss branch changed: '+key);}
 }
});
test('public conversion forwards real completed mandatory-root loss coverage and keeps resistance unchanged',()=>{
 const b=fixture(['D4','E4','F4','G4','J11','K11','L11'],['C4']);
 function completed(directory){const F=load(directory),real=F.reader;
  // Supply a genuine completed Reader result to the public conversion gate;
  // native urgent() ordinarily returns the unsearched mandatory block first.
  F.context.createReaderEngine=(...args)=>{const E=real(...args);return {...E,analyze:(p,ms,progress)=>E.analyze(p,1000,progress)};};
  return F.unified({model:null,strategy:false}).analyze(b.slice(),2,1000);
 }
 const r=completed(source);assert(r.lossProven&&!r.proven);assert(r.score<0);assert(r.lossCoverage.complete);assert.equal(r.lossCoverage.mandatoryBlock,idx('H4'));assert.equal(r.counterProof,null);
 if(base){const old=completed(base);for(const key of ['i','pv','depth','nodes','candidates','rejected','kind','fallback','lossProven','mandatoryDefense'])assert.deepEqual(plain(r[key]),plain(old[key]));}
});
test('finite negative proof values survive positive selected resistance heuristics',()=>{
 const E=factories.unified({model:null,strategy:false}),b=fixture([],['H8']),legal=Array.from({length:225},(_,i)=>i).filter(i=>E.inspect(b,i,2).legal),rejected=legal.map(i=>({i,line:[i,0]}));
 // Controlled all-root evidence tests public integration, not proof discovery.
 const r=E.finalizeResult(b,2,{kind:'lost',i:legal[0],score:-87654321,depth:3,lossProven:true,pv:[legal[0]],rejected,candidates:[{i:legal[0],score:-10000000,pv:[legal[0]],depth:3}]});
 assert.equal(r.score,-87654321);assert(r.lossProven&&r.fallback&&!r.proven);assert(E.inspect(b,r.i,2).legal);assert(r.candidates[0].score>0);assert.equal(r.pv[0],r.i);
});
test('missing, zero, positive and nonfinite claimed-loss scalars use the existing negative Reader mate convention',()=>{
 const E=factories.unified({model:null,strategy:false}),b=fixture(['H8']);
 for(const score of [undefined,0,17,NaN,Infinity,-Infinity]){const r=E.finalizeResult(b,2,{kind:'lost',i:0,score,depth:0,lossProven:true,pv:[0],candidates:[{i:0,score:99,pv:[0],depth:0}]});assert.equal(r.score,-10000000);assert(r.lossProven);assert.equal(r.candidates[0].score,99);}
});
test('new whole-position loss promotion also gets negative position value while unresolved fallback remains ordinary',()=>{
 const E=factories.unified({model:null,strategy:false}),b=fixture(['H8']),legal=Array.from({length:225},(_,i)=>i).filter(i=>E.inspect(b,i,2).legal);
 const row={kind:'search',i:0,score:999,depth:1,pv:[0],candidates:[{i:0,score:999,pv:[0],depth:1}]};
 const lost=E.finalizeResult(b,2,{...row,rejected:legal.map(i=>({i,line:[i,1]}))});assert(lost.lossProven);assert.equal(lost.score,-10000000);
 const unresolved=E.finalizeResult(b,2,{...row,rejected:[{i:0,line:[0,1]}]});assert(!unresolved.lossProven&&!unresolved.proven);assert(Number.isFinite(unresolved.score));assert.notEqual(unresolved.score,-10000000);
});
test('proved wins keep their signed value; ordinary candidate scores and terminal API remain intact',()=>{
 const E=factories.unified({model:null,strategy:false}),b=fixture(['D8','E8','F8','G8'],['C8']),r=E.analyze(b,1,'auto');assert(r.proven&&!r.lossProven);assert(r.score>0);assert(E.inspect(b,r.i,1).win.length);
 const again=E.finalizeResult(b,1,{...r,score:12345678});assert.equal(again.score,12345678);assert(again.proven&&!again.lossProven);
 const ordinary=E.finalizeResult(blank(),2,{i:112,score:-37,depth:2,pv:[112],kind:'search',candidates:[{i:112,score:-37,depth:2,pv:[112]}]});assert.equal(ordinary.score,-37);assert(!ordinary.proven&&!ordinary.lossProven);
 const done=b.slice();done[r.i]=1;const terminal=E.analyze(done,2,'auto');assert.equal(terminal.kind,'terminal');assert.equal(terminal.i,null);assert(!terminal.lossProven);
 if(baseline){const old=baseline.unified({model:null,strategy:false}).analyze(b,1,'auto');for(const key of ['i','score','pv','depth','candidates','kind','proven','lossProven'])assert.deepEqual(plain(r[key]),plain(old[key]));}
});
console.log(JSON.stringify({passed:true,checks,baselineCompared:!!baseline,kind:'small generated loss metadata/position scalar regression fixtures; no strength claim'}));
