'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/reader-engine.js'),'utf8'),neuralSource=fs.readFileSync(path.join(__dirname,'../src/neural-evaluator.js'),'utf8');
const idx=c=>(Number(c.slice(1))-1)*15+c.charCodeAt(0)-65,blank=()=>Array(225).fill(0);
const weights=Array.from({length:32},(_,i)=>((i*7)%13-6)/17);
const model={schemaVersion:1,kind:'forest-value-mlp',rulesId:'15x15-exact5-both33-v1',featureVersion:'house32-v1',inputSize:32,hiddenSize:2,activation:'relu',outputActivation:'tanh',normalization:{mean:Array(32).fill(.13),scale:Array(32).fill(1.7)},layers:[{weights:[weights,weights.map(v=>-v/2)],bias:[.4,-.2]},{weights:[[.7,-.5]],bias:[.1]}],modelId:'reader-sync-regression',scale:600};
let checkedScores=0,checkedFeatureVectors=0,unchangedLeafSequences=0,colorReplacements=0,timeoutRestorations=0;
for(const firstPlayer of [null,1,2]){
 const observations={board:null,scoreCalls:0,featureVectors:0,updates:0,changedUpdates:0,accumulators:0,clock:0,onSet:null,onClock:null};
 const performance={now:()=>{observations.onClock?.();return observations.clock;}};
 const context={Date,performance,observations,assert,model};vm.createContext(context);vm.runInContext(neuralSource,context);
 vm.runInContext(`const originalEvaluator=OmokNeural.createEvaluator;
 OmokNeural.createEvaluator=(...args)=>{const evaluator=originalEvaluator(...args),originalAccumulator=evaluator.accumulator;
  evaluator.accumulator=board=>{observations.accumulators++;const acc=originalAccumulator(board),score=acc.score,set=acc.set,mirror=Array.from(board);
   acc.set=(i,p)=>{observations.updates++;if(mirror[i]!==p)observations.changedUpdates++;mirror[i]=p;return set(i,p);};
   acc.score=p=>{observations.scoreCalls++;for(const color of [p,3-p]){const actualFeatures=Array.from(acc.features(color,args[2])),freshFeatures=OmokNeural.extractFeatures(observations.board,color,args[2]);assert.equal(actualFeatures.length,32);assert.deepEqual(actualFeatures,freshFeatures,'Every feature must match the live board for both colors');observations.featureVectors++;}const actual=score(p),fresh=evaluator.evaluate(observations.board,p,args[2]);assert(Math.abs(actual-fresh)<1e-10,'Dirty features must match a fresh evaluation of the live board');return actual;};return acc;};return evaluator;};`,context);
 assert(source.includes('return {fixedWork,rank,'));assert(source.includes('b[i]=p;if(neuralPosition'));
 const instrumented=source.replace('return {fixedWork,rank,','return {probeSet:set,fixedWork,rank,').replace('b[i]=p;if(neuralPosition','b[i]=p;observations.onSet?.(i,p,before);if(neuralPosition');
 vm.runInContext(instrumented,context);
 const board=blank();board[idx('G8')]=1;board[idx('F6')]=2;
 const engine=context.createEngine(15,board,{model,firstPlayer,strategy:false,optimized:true,fixedWork:true});observations.board=engine.board;
 const leaf=p=>{const before=engine.board.slice(),result=engine.fixedWork(p,0);assert.equal(result.pv.length,0);assert.deepEqual(Array.from(engine.board),Array.from(before));return result.score;};
 assert.equal(observations.accumulators,0,'Features remain unallocated until a static value is requested');
 const base=leaf(1);assert.equal(observations.accumulators,1);assert(observations.scoreCalls>0);
 const changes=observations.changedUpdates,calls=observations.scoreCalls;
 // A proof-style branch visits several positions, then returns to the same
 // leaf. The position evaluator must not process those discarded states.
 for(const [i,p]of [[idx('H8'),1],[idx('I7'),2],[idx('I7'),0],[idx('H8'),0]])engine.probeSet(i,p);
 assert.equal(leaf(1),base);assert.equal(observations.changedUpdates,changes);assert(observations.scoreCalls>calls);unchangedLeafSequences++;
 engine.probeSet(idx('H8'),1);const firstBranch=leaf(2);
 engine.probeSet(idx('I7'),2);leaf(1);
 engine.probeSet(idx('I7'),0);assert.equal(leaf(2),firstBranch,'Rewinding a branch restores its prior value');
 engine.probeSet(idx('H8'),0);assert.equal(leaf(1),base);
 // Replacing a stone at one coordinate must remove the previous color's
 // counts, windows and center features before adding the other color.
 const replacement=idx('H8');engine.probeSet(replacement,1);const blackScores=[leaf(1),leaf(2)];
 engine.probeSet(replacement,2);const whiteScores=[leaf(1),leaf(2)];assert.notEqual(whiteScores[0],blackScores[0]);
 engine.probeSet(replacement,1);assert.equal(leaf(1),blackScores[0]);assert.equal(leaf(2),blackScores[1]);
 engine.probeSet(replacement,0);assert.equal(leaf(1),base);colorReplacements++;
 // Reusing one Reader across both perspectives and repeated fixed searches
 // exercises dirty indices left by search undo operations.
 const fixedResults=new Map();
 for(const p of [1,2,1]){const before=Array.from(engine.board),first=engine.fixedWork(p,1),second=engine.fixedWork(p,1);assert.equal(second.score,first.score);assert.deepEqual(Array.from(second.pv),Array.from(first.pv));assert.equal(second.nodes,first.nodes);assert.deepEqual(Array.from(engine.board),before);fixedResults.set(p,first);}
 const beforeTimeout=Array.from(engine.board);
 const interruptNextPlacement=()=>{
  let placed=null,restored=false,checksWhilePlaced=0;
  observations.onSet=(i,p,before)=>{if(!placed&&p&&before===0){placed={i,p};observations.clock=1000;}else if(placed&&i===placed.i&&p===0&&before===placed.p)restored=true;};
  observations.onClock=()=>{if(placed&&engine.board[placed.i]===placed.p)checksWhilePlaced++;};
  return ()=>{assert(placed,'Timeout must occur after a real branch placement');assert(checksWhilePlaced>0,'The injected clock must be checked while the branch is live');assert(restored,'The interrupted placement must be undone by finally');assert.deepEqual(Array.from(engine.board),beforeTimeout);observations.onSet=null;observations.onClock=null;observations.clock=0;timeoutRestorations++;};
 };
 const verifyReuse=()=>{const calls=observations.scoreCalls;assert.equal(leaf(1),base);for(const p of [1,2]){const result=engine.fixedWork(p,1),prior=fixedResults.get(p);assert.equal(result.score,prior.score);assert.deepEqual(Array.from(result.pv),Array.from(prior.pv));assert.equal(result.nodes,prior.nodes);assert.deepEqual(Array.from(engine.board),beforeTimeout);}assert(observations.scoreCalls>calls,'Reused search must score fresh synchronized leaves');};
 // A timeout inside a proof recurses after a placement. Its finally must
 // cancel the temporary stone even though no static leaf was reached.
 let finishTimeout=interruptNextPlacement();const proof=engine.counterLoss(1,30,5,1);assert.equal(proof.complete,false);finishTimeout();verifyReuse();
 // Arm only after screening, so the next placement belongs to the ordinary
 // search round rather than an earlier proof or ranking probe.
 finishTimeout=null;const interrupted=engine.analyze(1,30,result=>{if(result.kind==='search'&&result.depth===0&&!finishTimeout){assert.equal(result.screeningComplete,true);finishTimeout=interruptNextPlacement();}});
 assert(finishTimeout,'Analyze must reach a search round');assert.equal(interrupted.depth,0);finishTimeout();verifyReuse();
 checkedScores+=observations.scoreCalls;checkedFeatureVectors+=observations.featureVectors;assert.equal(observations.accumulators,1);
 const noModel=context.createEngine(15,board,{model:null,firstPlayer,strategy:false,fixedWork:true}),beforeNoModel=observations.accumulators;noModel.fixedWork(1,1);assert.equal(observations.accumulators,beforeNoModel,'The disabled model path never allocates neural features');
}
console.log(JSON.stringify({passed:true,checkedScores,checkedFeatureVectors,unchangedLeafSequences,colorReplacements,timeoutRestorations,scope:'All 32 fresh-board features and scores across colors and first-player contexts, color replacement, canceled branches, deterministic proof/search timeouts, undo, reused searches and disabled model; no wall-clock threshold or strength claim'}));
