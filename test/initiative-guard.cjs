'use strict';
// Control-only proofs and clock; exercises production finalist selection.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const roots=['G8','H9','G7','I9','I8','H7'].map(idx),[A,D,E,F,B,C]=roots;
const input=Array(225).fill(0);input[idx('H8')]=1;
const neuralSource=fs.readFileSync('src/neural-evaluator.js','utf8'),zeroModel={schemaVersion:1,kind:'forest-value-mlp',rulesId:'15x15-exact5-both33-v1',featureVersion:'house32-v1',inputSize:32,hiddenSize:1,activation:'relu',outputActivation:'tanh',normalization:{mean:Array(32).fill(0),scale:Array(32).fill(1)},layers:[{weights:[Array(32).fill(0)],bias:[0]},{weights:[[0]],bias:[0]}],modelId:'initiative-guard-zero',scale:600};
for(const learningMode of ['disabled','zero'])for(const scenario of ['sub12-complete','ranked-reselection','incomplete-outside-width','attempt-cap','deadline-after-refutation']){
 let source=fs.readFileSync('src/forest-engine.js','utf8'),now=0,calls=[],reservation=null;
 const put=(from,to)=>{assert.equal(source.split(from).length-1,1,'fixture anchor '+from.slice(0,50));source=source.replace(from,to);};
 put('limits=limitsFor(budget)',`limits={...limitsFor(budget),depth:1,root:${scenario==='incomplete-outside-width'?3:6}}`);
 const staticScores=roots.map((_,k)=>scenario==='ranked-reselection'&&k===1?1000:10000-k*500);
 if(scenario==='ranked-reselection')assert(staticScores[2]>staticScores[1],'static order prefers E over D');
 put('let roots=ranked(b,p,true).filter','let roots=testRoots.map((i,k)=>({i,a:inspect(b,i,p),score:testStaticScores[k]})).filter');
 put('const timedProof=(q,ms)=>{let r=forcing(b,q,limits.forcing,Math.max(1,Math.min(ms,deadline-clockNow())),proofCache);nodes+=r.nodes;return r;};','const timedProof=(q,ms)=>testScreen(b);');
 put('function quietTrap(board,p,budget=300,width=4,maxPlies=11,includeCounter=false,cache=new Map()){','function quietTrap(board,p,budget=300,width=4,maxPlies=11,includeCounter=false,cache=new Map()){return {complete:true,proof:null};');
 put('const staticEval=q=>strategy?memoPosition(\'evaluation\',b,q+\'|base\',()=>evaluateUncached(b,q)+(neural?.evaluate(b,q)||0)):evaluate(b,q)','const staticEval=q=>testEval(b)');
 put('let finalGuard=null,avoidedTrap=false;','testReserve(rootGuardReserve,deadline-start,budget);let finalGuard=null,avoidedTrap=false;');
 put('const direct=forcing(b,3-p,limits.forcing,Math.max(1,(totalDeadline-clockNow())*.5),proofCache);','const direct=testGuard(best.i,budget);');
 const added=b=>b.findIndex((v,i)=>v&&!input[i]);
 const context={Date,console,performance:{now:()=>now},testRoots:roots,testStaticScores:staticScores,
  testScreen:b=>{const i=added(b);return {complete:i<0||i===B||i===C,proof:i===C?{pv:[idx('A1')]}:null,nodes:0};},
  testEval:b=>-(100-roots.indexOf(added(b))*10),
  testReserve:(reserve,main,budget)=>{reservation={reserve,main,budget};now=budget-reserve;},
  testGuard:(i,budget)=>{calls.push(i);const proof=scenario==='ranked-reselection'?calls.length===1:scenario==='attempt-cap'?calls.length<=3:scenario==='deadline-after-refutation';if(scenario==='deadline-after-refutation')now=budget;return {complete:scenario!=='incomplete-outside-width',proof:proof?{pv:[idx('A1')]}:null,nodes:0};}
 };
 vm.createContext(context);vm.runInContext(neuralSource,context);vm.runInContext(source,context);const board=input.slice(),r=context.createForestEngine({strategy:false,model:learningMode==='zero'?zeroModel:null}).analyze(board,1,6000);
 assert.deepEqual(board,input);assert.equal(reservation.reserve,1320);assert.equal(reservation.main,4680);assert(!r.proven&&!r.lossProven);assert(!r.defenseChecked);assert(!r.rejected.some(m=>m.i===r.i));assert.equal(r.pv[0],r.i);
 if(scenario==='sub12-complete'){assert.deepEqual(calls,[A]);assert.equal(r.i,A);assert.equal(r.depth,1);assert.equal(r.analysisIncomplete,false);}
 if(scenario==='ranked-reselection'){assert.deepEqual(calls,[A,D]);assert.equal(r.i,D);assert.equal(r.depth,1);assert(r.rejected.some(m=>m.i===A));assert(r.candidates[0].comparisonComplete);assert.equal(r.candidates[0].i,D);assert.equal(r.score,90);}
 if(scenario==='incomplete-outside-width'){assert.deepEqual(calls,[A]);assert.equal(r.i,B,'screened root outside comparison width remains fallback');assert.equal(r.depth,0);assert(r.analysisIncomplete);}
 if(scenario==='attempt-cap'){assert.deepEqual(calls,[A,D,E]);assert.equal(r.i,B,'cap cannot expose an unguarded replacement over a checked root');assert(r.analysisIncomplete);assert.equal(r.depth,1);assert.equal(r.candidates[0].i,B);assert(r.candidates[0].comparisonComplete);}
 if(scenario==='deadline-after-refutation'){assert.deepEqual(calls,[A]);assert.equal(r.i,B);assert(r.analysisIncomplete);assert.equal(r.depth,1);assert.equal(r.candidates[0].i,B);assert(r.candidates[0].comparisonComplete);}
 if(['ranked-reselection','attempt-cap','deadline-after-refutation'].includes(scenario)){assert.equal(r.retainedComparison.i,r.i);assert.equal(r.retainedComparison.source,'forest');assert.equal(r.retainedComparison.finalDefenseUnchecked,true);}
 if(scenario==='incomplete-outside-width')assert.equal(r.retainedComparison,null);
 console.log('PASS',scenario,JSON.stringify({learningMode,calls,chosen:r.i,reservation,incomplete:r.analysisIncomplete,proofFixture:'control only'}));
}
