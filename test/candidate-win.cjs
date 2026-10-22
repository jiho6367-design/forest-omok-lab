'use strict';
// A generated quiet winner reproduces the reported sequence: a bounded mate
// recommendation before placing it, but a complete opponent loss immediately
// after placing it. Every legal actual next-turn response is checked below.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{performance}=require('node:perf_hooks');
const reader=require('../src/reader-engine.js').createEngine,rules=require('../tools/counter-rules.cjs'),serialize=require('../tools/counter-dag.cjs'),verify=require('../tools/verify-counter.cjs');
const files=['neural-evaluator.js','search-memory.js','gpu-patterns.js','strategy-engine.js','reader-engine.js','search-engine.js','unified-engine.js'];
const texts=files.map(f=>fs.readFileSync('src/'+f,'utf8'));texts[4]=texts[4].replace('function createEngine(','function createReaderEngine(');const source=texts.join('\n');
const idx=c=>(Number(c.slice(1))-1)*15+c.charCodeAt(0)-65,plain=v=>JSON.parse(JSON.stringify(v));
const options={model:null,strategy:false,optimized:true,searchMemory:false};
function load(clock=performance){const c={performance:clock,Date};vm.createContext(c);vm.runInContext(source,c);return c;}
const native=load(),E=native.createEngine(options);
function symmetry(flip,rotation){return i=>{let x=i%15,y=Math.floor(i/15);if(flip)x=14-x;for(let k=0;k<rotation;k++){const a=x;x=14-y;y=a;}return y*15+x;};}
function fixture(attacker=2,map=i=>i){const b=Array(225).fill(0);for(const c of ['E8','F8'])b[map(idx(c))]=attacker;for(const c of 'C8 D7 D9 C7 E9 H7 G7 I9 H9'.split(' '))b[map(idx(c))]=3-attacker;return b;}
function independent(board,p,proof){
 assert.equal(proof.type,'all-legal-replies');assert(proof.complete);assert.equal(proof.attacker,p);assert.equal(proof.defender,3-p);assert.equal(proof.entryBoardKey,board.join(''));
 const after=board.slice();assert(rules(board).legal(proof.move,p));after[proof.move]=p;assert.equal(proof.replyBoardKey,after.join(''));
 const R=rules(after),legal=Array.from({length:225},(_,i)=>i).filter(i=>R.legal(i,3-p));
 assert.equal(proof.checkedReplies,legal.length);assert.equal(proof.branches.length,legal.length);assert.deepEqual(proof.branches.map(r=>r.i).sort((a,b)=>a-b),legal);
 const dag=serialize({type:'move',i:proof.move,forced:false,branches:proof.branches},{attacker:p}),checked=verify(board,dag,{loss:false,limitMs:5000});
 assert(checked.verified,checked.error);assert(checked.boardRestored);return checked;
}
let cases=0,responses=0,maxProofMs=0;
for(const p of [1,2])for(const flip of [false,true])for(let rotation=0;rotation<4;rotation++){
 const map=symmetry(flip,rotation),b=fixture(p,map),i=map(idx('G8')),after=b.slice();after[i]=p;
 const own=reader(15,b,{strategy:false,optimized:true});assert.equal(own.forcingWin(p,13,200),null,'winner requires a quiet candidate, not the initial VCF shortcut');
 const opponent=reader(15,after,{strategy:false,optimized:true}),loss=opponent.analyze(3-p,1000);
 assert.equal(loss.kind,'lost');assert(loss.lossCoverage.complete&&loss.screeningComplete&&loss.forcingChecksComplete);assert.equal(loss.lossCoverage.legalRoots,208);
 // Independently establish the fixture from the actual old after-placement
 // screen. These simple branches all carry complete VCF refutations.
 const oldCertificate={type:'move',i,forced:false,branches:loss.rejectedMoves.map(r=>({i:r.i,proof:{type:'vcf',pv:r.line.slice(1)}}))};
 const oldChecked=verify(b,serialize(oldCertificate,{attacker:p}),{loss:false,limitMs:5000});assert(oldChecked.verified,oldChecked.error);assert(oldChecked.boardRestored);
 const before=b.slice(),start=performance.now(),result=E.verifyWinningMove(b,p,i,500);maxProofMs=Math.max(maxProofMs,performance.now()-start);
 assert(result.complete&&result.proof);assert.equal(result.proof.move,i);assert.equal(result.pv[0],i);assert.equal(E.validPV(b,p,result.pv).length,result.pv.length);
 const checked=independent(b,p,plain(result.proof));responses+=checked.stats.defenses;assert.equal(checked.stats.defenses,208);assert.deepEqual(b,before);assert.deepEqual(Array.from(opponent.board),after);cases++;
}
console.log(JSON.stringify({test:'quiet-candidate-win-certificate',cases,independentlyVerifiedLegalReplies:responses,maxProofMs:Math.round(maxProofMs),scope:'Both colors and D4; complete actual opponent replies after the candidate, never a hypothetical consecutive own turn.'}));

for(const p of [1,2]){
 const b=fixture(p),i=idx('G8'),defender=3-p;
 for(const extra of [['N5','N6','N8'],['N5','N6','N7','N8']]){
  const counter=b.slice();for(const c of extra)counter[idx(c)]=defender;const before=counter.slice(),r=E.verifyWinningMove(counter,p,i,500);
  assert(r.complete&&!r.proof,'a counter-four or immediate exact-five escape must defeat the claimed candidate win');assert.deepEqual(counter,before);
 }
 const forbidden=Array(225).fill(0);for(const c of ['G8','I8','H7','H9'])forbidden[idx(c)]=p;
 assert(!rules(forbidden).legal(idx('H8'),p));assert(!E.verifyWinningMove(forbidden,p,idx('H8'),100).proof);
 const overline=Array(225).fill(0);for(const c of ['C8','D8','E8','F8','H8'])overline[idx(c)]=p;overline[idx('B8')]=defender;
 assert(!E.inspect(overline,idx('G8'),p).win.length);assert(!E.verifyWinningMove(overline,p,idx('G8'),200).proof,'six stones do not prove exact five');
 const exact=Array(225).fill(0);for(const c of ['C8','D8','E8','F8','G6','G7','E6','F7'])exact[idx(c)]=p;
 assert(rules(exact).legal(idx('G8'),p));const instant=E.verifyWinningMove(exact,p,idx('G8'),100);assert(instant.complete&&instant.proof);const ended=exact.slice();ended[idx('G8')]=p;assert(rules(ended).exact(idx('G8'),p));
 const unknown=E.verifyWinningMove(Array(225).fill(0),p,idx('H8'),100);assert(!unknown.proof,'an ordinary legal move is not a certified winner');
 assert(unknown.nodes>0,'an unsuccessful candidate check still reports its actual search work');
 let ticks=0;const timed=load({now:()=>++ticks}),timedEngine=timed.createEngine(options),copy=b.slice(),partial=timedEngine.verifyWinningMove(copy,p,i,20);
 assert(!partial.complete&&!partial.proof);assert.deepEqual(copy,b);const reused=timedEngine.verifyWinningMove(copy,p,i,100000);assert(reused.complete&&reused.proof);independent(copy,p,plain(reused.proof));assert.deepEqual(copy,b);
 const after=b.slice();after[i]=p;const lossEvents=[],loss=native.createEngine(options).analyze(after,defender,{mode:'fast',ms:1000},[],r=>lossEvents.push(r));
 assert(loss.lossProven&&!loss.proven);assert.equal(loss.proofStatus,'PROVEN_LOSS');assert(loss.lossCoverage.complete);assert.equal(loss.lossCoverage.legalRoots,208);
 assert(lossEvents.every(r=>!r.proven),'the own-win shortcut must not manufacture a win during defensive loss analysis');assert.deepEqual(after,copy.map((v,j)=>j===i?p:v));
}
console.log('PASS counter-four and counter-win escapes, illegal double three, overline, exact-five priority, unresolved ordinary move and interrupted/reused certificate checks');

for(const p of [1,2])for(const mode of ['fast','auto','deep']){
 const b=fixture(p),before=b.slice(),budget=mode==='fast'?1000:3000,events=[],start=performance.now();
 const engine=native.createEngine(options),r=engine.analyze(b,p,{mode,automatic:mode==='auto',ms:budget},[],e=>events.push(plain(e)));
 assert(r.proven&&!r.lossProven);assert.equal(r.proofStatus,'PROVEN_WIN');assert.equal(r.analysisWork.stopReason,'verified-win');assert.equal(r.i,idx('G8'));
 assert(!r.analysisIncomplete&&!r.timedOut);assert.equal(r.analysisWork.budgetMs,budget);
 assert.equal(r.pv[0],r.i);assert.equal(engine.validPV(b,p,r.pv).length,r.pv.length);assert.deepEqual(b,before);
 const certified=events.find(e=>e.proven);assert(certified,'the completed candidate certificate must reach progress before the result');
 assert.equal(certified.i,r.i);assert.equal(certified.proofStatus,'PROVEN_WIN');
 console.log(JSON.stringify({test:'actual-mode-candidate-early-win',p,mode,ms:Math.round(performance.now()-start),budget,i:r.i,depth:r.depth,progressEvents:events.length}));
}
