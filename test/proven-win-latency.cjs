'use strict';
// Generated tactical boards only. Proof replay below does not call either
// engine's forcing solver; every legal defender response is checked directly.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{performance}=require('node:perf_hooks');
const files=['neural-evaluator.js','search-memory.js','gpu-patterns.js','strategy-engine.js','reader-engine.js','search-engine.js','unified-engine.js'];
const texts=files.map(name=>fs.readFileSync('src/'+name,'utf8'));
texts[4]=texts[4].replace('function createEngine(','function createReaderEngine(');
const source=texts.join('\n'),idx=c=>(Number(c.slice(1))-1)*15+c.charCodeAt(0)-65;
function load(clock=performance){const context={performance:clock,Date};vm.createContext(context);vm.runInContext(source,context);return context;}
const native=load(),options={model:null,optimized:true,searchMemory:false};
const inspector=native.createEngine({...options,strategy:false});
function board(own,enemy=[],p=1,map=i=>i){const b=Array(225).fill(0);for(const c of own)b[map(idx(c))]=p;for(const c of enemy)b[map(idx(c))]=3-p;return b;}
function symmetry(flip,turns){return i=>{let x=i%15,y=Math.floor(i/15);if(flip)x=14-x;for(let k=0;k<turns;k++){const a=x;x=14-y;y=a;}return y*15+x;};}
const legal=(b,p)=>Array.from({length:225},(_,i)=>i).filter(i=>inspector.inspect(b,i,p).legal);
const wins=(b,p)=>legal(b,p).filter(i=>inspector.inspect(b,i,p).win.length);
let checkedReplies=0,proofs=0,maxElapsed=0;
function replayProof(initial,p,pv){
 assert(Array.isArray(pv)&&pv.length);const b=initial.slice();
 for(let k=0;k<pv.length;k+=2){
  const attack=pv[k],shape=inspector.inspect(b,attack,p);assert(shape.legal,'proof attack must be legal');b[attack]=p;
  if(shape.win.length){assert.equal(k,pv.length-1,'proof stops at exact five');return;}
  const ends=wins(b,p);assert(ends.length,'each VCF attack must threaten exact five');
  const replies=legal(b,3-p),forced=[];
  for(const j of replies){
   checkedReplies++;const response=inspector.inspect(b,j,3-p);assert(!response.win.length,'defender has no immediate counter-win');
   const after=b.slice();after[j]=3-p;
   const survives=ends.some(i=>inspector.inspect(after,i,p).win.length);
   if(!survives)forced.push(j);
  }
  if(!forced.length){assert.equal(k,pv.length-1,'all legal defenses lose immediately');return;}
  assert.equal(forced.length,1,'a forcing-four proof has at most one nonlosing immediate response');
  assert.equal(pv[k+1],forced[0]);assert(k+2<pv.length,'unique block needs a proved continuation');b[forced[0]]=3-p;
 }
 assert.fail('proof did not reach exact five or an unavoidable exact-five threat');
}
const fixtures=[
 {id:'open-three',own:['G8','H8','I8'],enemy:['A1','C1','E1']},
 {id:'multi-step-four',own:['F8','G8','H8','H7','G6'],enemy:['E8']}
];
for(const fixture of fixtures)for(const p of [1,2])for(const flip of [false,true])for(let rotation=0;rotation<4;rotation++){
 const input=board(fixture.own,fixture.enemy,p,symmetry(flip,rotation));assert.equal(wins(input,p).length,0,'fixture requires a non-immediate forcing proof');
 const reader=native.createReaderEngine(15,input,{...options,strategy:false}),start=performance.now(),r=reader.analyze(p,1000);
 assert.equal(r.kind,'forced');assert(r.moves.length);replayProof(input,p,Array.from(r.moves[0].pv));
 assert.deepEqual(Array.from(reader.board),input);if(fixture.id==='multi-step-four')assert(r.moves[0].pv.length>=3);
 for(const mode of ['auto','deep']){
  let ticks=0;const clock={now:()=>ticks++*.01},factories=load(clock),engine=factories.createEngine(options),copy=input.slice();
  const budget=mode==='auto'?15000:25000,result=engine.analyze(copy,p,{mode,automatic:mode==='auto',ms:budget});
  assert(result.proven&&!result.lossProven);assert.equal(result.proofStatus,'PROVEN_WIN');assert.equal(result.analysisWork.stopReason,'verified-win');
  assert(result.analysisWork.elapsedMs<1000,'certified win must return without using the long analysis budget');
  replayProof(input,p,Array.from(result.pv));assert.deepEqual(copy,input);proofs++;
 }
 maxElapsed=Math.max(maxElapsed,performance.now()-start);
}
console.log(JSON.stringify({test:'generated-proven-win-early-return',proofs,checkedLegalDefenderReplies:checkedReplies,maxCaseWallMs:Math.round(maxElapsed),scope:'Both colors, all eight symmetries, actual Reader and Unified auto/deep; wall time is diagnostic, assertions use a bounded logical clock.'}));

for(const p of [1,2]){
 const counter=board(['G8','H8','I8'],['D4','E4','F4','G4'],p),e=native.createEngine({...options,strategy:false});
 const result=e.analyze(counter.slice(),p,{mode:'fast',ms:1000});assert(!result.proven,'opponent immediate exact-five threats defeat an unsupported own attack');
 const forbidden=board(['G8','I8','H7','H9'],[],p);assert(!inspector.inspect(forbidden,idx('H8'),p).legal,'double three cannot be a proof root');
 const overline=board(['C8','D8','E8','F8','H8'],['B8'],p);assert.equal(inspector.inspect(overline,idx('G8'),p).win.length,0,'six in a row is not exact five');
 for(const input of [forbidden,overline]){
  let ticks=0;const factories=load({now:()=>++ticks*20}),engine=factories.createEngine({...options,strategy:false}),copy=input.slice();
  const r=engine.analyze(copy,p,{mode:'fast',ms:30});assert(!r.proven);assert.deepEqual(copy,input);
 }
 let ticks=0;const factories=load({now:()=>++ticks*20}),input=board(fixtures[1].own,fixtures[1].enemy,p),reader=factories.createReaderEngine(15,input,{...options,strategy:false}),before=input.slice();
 const incomplete=reader.analyze(p,30);assert.notEqual(incomplete.kind,'forced','interrupted proof search does not certify a PV');assert.deepEqual(Array.from(reader.board),before);
}
console.log('PASS immediate opponent counter-win, forbidden double-three, exact-five overline distinction and interrupted proof restoration in both colors');
