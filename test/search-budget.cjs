'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/forest-engine.js'),'utf8');
// Observe the actual analyze initialization, before any expensive tree work.
const anchor='const check=()=>{nodes++;if(clockNow()>=deadline)throw TIME;};';
assert.equal(source.split(anchor).length,2);
const c={performance:{now:()=>0},Date,console};vm.createContext(c);
vm.runInContext(source.replace('let immediate=urgent(board,p);','let immediate=null;').replace(anchor,'return {mainMs:deadline-start,totalMs:totalDeadline-start,limits};'),c);
const e=c.createForestEngine({strategy:false}),board=Array(225).fill(0);
const allocation=b=>e.analyze(board,1,b);
const rows=[10999,11000,11001,11999,12000,12001,13000,15000,15277.7777778,16000,24000,25000].map(b=>({budget:b,...allocation(b)}));
for(let b=30,last=0;b<=25000;b++){const a=allocation(b);assert(a.mainMs>=last-1e-8,'main time cannot decrease at '+b);assert(a.mainMs<=b);if(b>=12000)assert(b-a.mainMs>=1000-1e-8,'guard reserve must remain positive');if(b>=16000)assert(Math.abs(a.mainMs-.72*b)<1e-8);last=a.mainMs;}
for(const b of [11999,12000,12001])assert.equal(allocation(b).mainMs,11000);
assert.deepEqual(JSON.parse(JSON.stringify(allocation(12000).limits)),{forcing:19,quiet:10,screen:12,root:28,branch:16,depth:10});
console.log(JSON.stringify({test:'search-budget-allocation',passed:true,rows}));
// Drive the production final-guard and incomplete-result branches with a
// controlled clock and tactical result. No real-time search is duplicated.
const guardStart='let finalGuard=null,avoidedTrap=false;';
// Exercise the fresh verifier path even when root screening completed the
// same bounded scope. Reuse itself has independent scope-mismatch controls.
const freshGuard='delete best.guardScreenScope;'+guardStart;
const finalDirect='const direct=forcing(b,3-p,limits.forcing,Math.max(1,(totalDeadline-clockNow())*.5),proofCache);';
const finalTrap='else finalGuard=best.a.fours.length?forcedReplyTrap(b,p,Math.max(1,totalDeadline-clockNow()),null,limits.forcing,true,proofCache):quietTrap(b,p,Math.max(1,totalDeadline-clockNow()),limits.quiet,limits.forcing,true,proofCache);';
for(const complete of [false,true]){
 let now=0,entered=0;
 const controlled=source.replace(anchor,'const check=()=>{nodes++;testClock(deadline);throw TIME;};').replace(guardStart,'testClock(11000);'+freshGuard).replace(finalDirect,'testEntered();const direct={complete:true,proof:null,nodes:0};').replace(finalTrap,'else finalGuard={complete:testComplete,proof:null};');
 const context={Date,console,performance:{now:()=>now},testClock:x=>now=x,testEntered:()=>entered++,testComplete:complete};vm.createContext(context);vm.runInContext(controlled,context);
 const original=Array(225).fill(0),engine=context.createForestEngine({strategy:false}),result=engine.analyze(original,1,12000);
 assert.equal(entered,1,'final guard must actually enter at the boundary');assert(!result.proven);assert(!result.lossProven);assert.deepEqual(original,Array(225).fill(0));
 if(!complete){assert.equal(result.defenseChecked,false);assert(result.reason.includes('최종 방어 증명 없음'));}
 console.log(JSON.stringify({test:'final-guard-contract',complete,entered,defenseChecked:result.defenseChecked,passed:true}));
}
for(const scenario of ['direct-incomplete','direct-refutation-alternative','trap-incomplete','trap-refutation-alternative','refutation-no-alternative','overshoot-skip','below-threshold']){
 let now=0,entered=0,traps=0,target=null;
 const directIncomplete=scenario==='direct-incomplete',directProof=scenario.startsWith('direct-refutation')||scenario==='refutation-no-alternative',trapProof=scenario==='trap-refutation-alternative';
 let controlled=source.replace(anchor,'const check=()=>{nodes++;testClock(deadline);throw TIME;};')
  .replace(guardStart,(scenario==='overshoot-skip'?'testClock(totalDeadline);':'')+freshGuard)
  .replace(finalDirect,'testEntered(best.i);const direct={complete:!testDirectIncomplete,proof:testDirectProof?{pv:[0]}:null,nodes:0};')
  .replace(finalTrap,'else {testTrap();finalGuard={complete:!testTrapIncomplete,proof:testTrapProof?{block:0,branches:[]}:null};}');
 const context={Date,console,performance:{now:()=>now},testClock:x=>now=x,testEntered:i=>{entered++;target=i;},testTrap:()=>traps++,testDirectIncomplete:directIncomplete,testDirectProof:directProof,testTrapIncomplete:scenario==='trap-incomplete',testTrapProof:trapProof};vm.createContext(context);vm.runInContext(controlled,context);
 const input=Array(225).fill(0);if(scenario!=='refutation-no-alternative')input[112]=1;
 const original=input.slice(),engine=context.createForestEngine({strategy:false}),result=engine.analyze(input,2,scenario==='below-threshold'?11999:12000);
 assert.deepEqual(input,original);assert(!result.proven);assert(!result.lossProven);
 if(scenario==='overshoot-skip'||scenario==='below-threshold')assert.equal(entered,0);
 else {
  assert.equal(entered,1);
  if(directIncomplete||directProof)assert.equal(traps,0);
  if(directIncomplete||scenario==='trap-incomplete'){assert.equal(result.defenseChecked,false);assert(result.reason.includes('최종 방어 증명 없음'));assert(!result.rejected.some(x=>x.i===target));}
  if(directProof||trapProof){assert.notEqual(result.i,target);assert.equal(result.depth,0);const rejection=result.rejected.find(x=>x.i===target);assert(rejection);if(directProof)assert.equal(rejection.pv[0],0);if(trapProof)assert.equal(rejection.replyTrap.block,0);if(result.i!=null){assert.deepEqual(Array.from(result.pv),[result.i]);assert.equal(result.defenseChecked,false);}else {assert.equal(scenario,'refutation-no-alternative');assert.equal(result.finalGuard.directProof.pv[0],0);}}
 }
 console.log(JSON.stringify({test:'guard-result-flow',scenario,entered,traps,target,recommendation:result.i,depth:result.depth,passed:true,proofFixture:'controlled branch only, not tactical evidence'}));
}
