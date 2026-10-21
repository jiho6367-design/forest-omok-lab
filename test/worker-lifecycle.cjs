const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('src/unified-app.js','utf8');
const source=app.slice(app.indexOf('function spawnAnalysis('),app.indexOf('function acceptResult('));
let now=0,next=0,done=0,errors=0;
const intervals=new Map(),timers=new Map();
class Worker { terminate(){this.stopped=true;} postMessage(data){this.data=data;} }
const c={performance:{now:()=>now},Worker,Blob:class {},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},
 setInterval:fn=>{intervals.set(++next,fn);return next;},clearInterval:id=>intervals.delete(id),
 setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),
 $:()=>({textContent:''}),E:{inspect:()=>({legal:true})},db:{lessons:[]},g:{rules:{}},ponder:null};
c.cancelPonder=()=>{c.ponder.worker.terminate();c.ponder=null;};
vm.createContext(c);vm.runInContext(source,c);
const start=()=>c.spawnAnalysis(Array(225).fill(0),1,25000,()=>{},()=>done++,()=>errors++);
let w=start();assert.equal(w.data.ms,23500);assert.equal(intervals.size,1);assert.equal(timers.size,1);
w.terminate();assert(w.stopped);assert.equal(intervals.size,0);assert.equal(timers.size,0);
// A queued worker message after cancellation cannot complete the old request.
w.onmessage({data:{result:{i:1}}});assert.equal(done,0);assert.equal(errors,0);
w=start();c.ponder={worker:w,promoted:false};now=250;[...intervals.values()][0]();
assert(w.stopped);assert.equal(c.ponder,null);assert.equal(c.spawnAnalysis.health.blockedUntil,10250);
w=start();c.ponder={worker:w,promoted:true};now=500;[...intervals.values()][0]();
assert(!w.stopped,'foreground analysis must not be discarded on lag');
assert.equal(c.spawnAnalysis.health.healthySince,0);now=600;[...intervals.values()][0]();
assert.equal(c.spawnAnalysis.health.healthySince,600);assert.equal(c.spawnAnalysis.health.blockedUntil,10500);
w.onmessage({data:{result:{i:1}}});assert.equal(done,1);assert(w.stopped);assert.equal(intervals.size,0);assert.equal(timers.size,0);
console.log('PASS Worker cancellation cleanup, stale messages, lag cooldown and foreground preservation');
let incompleteResult;
w=c.spawnAnalysis(Array(225).fill(0),1,15000,()=>{},result=>{incompleteResult=result;},()=>errors++);
w.onmessage({data:{result:{i:1,pv:[1],depth:4,analysisIncomplete:true,proofStatus:'UNRESOLVED',assessmentStatus:'INCOMPLETE'}}});
assert(incompleteResult.analysisIncomplete);assert.equal(incompleteResult.proofStatus,'UNRESOLVED');assert.equal(incompleteResult.assessmentStatus,'INCOMPLETE');
assert.equal(incompleteResult.depth,4);assert(w.stopped);assert.equal(intervals.size,0);assert.equal(timers.size,0);
console.log('PASS normal Worker completion preserves incomplete finalist evidence at positive depth');
for(const refuted of [false,true]){
 let deadlineMs,result;
 c.setTimeout=(fn,ms)=>{deadlineMs=ms;timers.set(++next,fn);return next;};
 w=c.spawnAnalysis(Array(225).fill(0),1,{mode:'deep',ms:25000},()=>{},r=>{result=r;},()=>errors++);
 assert.equal(deadlineMs,25000);assert.equal(w.data.ms.mode,'deep');assert.equal(w.data.ms.ms,23500);
 w.onmessage({data:{progress:true,result:{i:4,pv:[4],depth:3,score:100}}});
 w.onmessage({data:{progress:true,result:{i:5,pv:[5],depth:4,score:50,candidates:[{i:5,score:50},{i:4,score:30}]}}});
 w.onmessage({data:{progress:true,result:{i:6,pv:[6],depth:0,score:9999,rejected:refuted?[{i:5,line:[5,8]}]:[]}}});
 [...timers.values()][0]();assert(w.stopped);assert(result.timedOut);assert.equal(result.externalBudgetMs,25000);
 assert.equal(result.i,refuted?6:5,'watchdog retains latest completed comparison; partial scores cannot replace it, verified refutations can');
 const kept=result;w.onmessage({data:{result:{i:7,pv:[7],depth:9}}});assert.equal(result,kept,'late work never replaces the deadline result');
 assert.equal(intervals.size,0);assert.equal(timers.size,0);
}
console.log('PASS explicit deep mode stops at 25 seconds; latest completed best, refutations and late-message exclusion survive the watchdog');
{
 let hooks,stopped=0,result;const observed=[];
 c.OmokParallel={start:options=>{hooks=options;return {observe:r=>observed.push(r),terminate:()=>stopped++,latest:{i:5,depth:4}};}};
 w=c.spawnAnalysis(Array(225).fill(0),1,{mode:'deep',ms:25000},()=>{},r=>result=r,()=>errors++);
 const refuted={i:5,depth:0,rejected:[{i:5,line:[5,8]}]};w.onmessage({data:{progress:true,result:refuted}});
 assert.equal(observed[0],refuted,'proof Worker rejection reaches the pool even when its own displayed candidate is already refuted');
 hooks.onDone({i:6,pv:[6],depth:4,candidates:[{i:6,score:10}]});assert.equal(result.i,6);assert(result.rejected.some(r=>r.i===5));assert.equal(stopped,1);
 delete c.OmokParallel;
}
console.log('PASS serial-to-parallel refutation propagation precedes candidate filtering; final result preserves proof and pool cancellation');
{
 let hooks,result;c.E.urgent=()=>null;
 c.OmokParallel={start:options=>{hooks=options;return {observe:()=>{},terminate:()=>{},latest:{i:5,depth:4}};}};
 w=c.spawnAnalysis(Array(225).fill(0),1,{mode:'deep',ms:25000},()=>{},r=>result=r,()=>errors++);
 hooks.onProgress({i:5,pv:[5],depth:4,candidates:[{i:5,score:10}]});
 w.onmessage({data:{result:{i:5,pv:[5],depth:3}}});
 hooks.onProgress({i:5,pv:[5],depth:4,rejected:[{i:5,pv:[8,9],verifiedRefutation:true}]});hooks.onError('all pool finalists refuted');
 assert(result&&result.i!==5);assert(result.rejected.some(r=>r.i===5));assert(result.analysisIncomplete);delete c.OmokParallel;
}
console.log('PASS all pool finalists refuted: main fallback cannot restore a newly refuted serial recommendation');
// Controlled delivery tests, not tactical proof fixtures: a certified win
// message must complete immediately, but a score/loss message must not.
for(const mode of ['fast','auto','deep']){
 let result,completions=0,stopped=0;
 c.OmokParallel={start:()=>mode==='fast'?null:{observe:()=>{},terminate:()=>stopped++,latest:{i:5,depth:4}}};
 w=c.spawnAnalysis(Array(225).fill(0),1,{mode,ms:mode==='fast'?1000:mode==='auto'?15000:25000},()=>{},r=>{result=r;completions++;},()=>errors++);
 for(const r of [{i:4,pv:[4],depth:8,score:1e8,proven:false},{i:4,pv:[4],depth:0,lossProven:true}]){
  w.onmessage({data:{progress:true,result:r}});assert.equal(completions,0,'a score or loss progress does not use the win shortcut');assert(!w.stopped);
 }
 const win={i:4,pv:[4],depth:3,proven:true,lossProven:false,proofStatus:'PROVEN_WIN'};
 w.onmessage({data:{progress:true,result:win}});assert.equal(completions,1,'win progress must not wait for final serial/pool messages');assert(result.proven);assert(w.stopped);
 assert.equal(stopped,mode==='fast'?0:1);assert.equal(timers.size,0);assert.equal(intervals.size,0);
 w.onmessage({data:{result:{i:9,pv:[9],depth:9}}});assert.equal(completions,1);assert.equal(result.i,4);
 delete c.OmokParallel;
}
{
 let result;c.E.finalizeResult=(_b,_p,r)=>({...r,proven:false,proofStatus:'UNRESOLVED'});
 w=c.spawnAnalysis(Array(225).fill(0),1,{mode:'deep',ms:25000},()=>{},r=>result=r,()=>errors++);
 w.onmessage({data:{progress:true,result:{i:4,pv:[4],proven:true}}});assert.equal(result,undefined,'a demoted proof cannot complete via the shortcut');assert(!w.stopped);
 w.terminate();delete c.E.finalizeResult;
}
console.log('PASS win-only certified progress preempts serial and pool work in all modes; scores, loss progress and demoted proofs do not');
