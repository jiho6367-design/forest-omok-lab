'use strict';
// Controlled search outputs exercise production integration, rules and PV gates.
// These fixtures do not certify a win or claim additional playing strength.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const A=idx('J4'),B=idx('G8'),C=idx('D6'),board=Array(225).fill(0);board[idx('H8')]=1;
const row=()=>({i:B,score:-37,pv:[B,idx('A1'),idx('F7')],depth:6,comparisonComplete:true});
function run(change={},budget={automatic:true,ms:15000}){
 let extra=0;
 const context={Date,console};vm.createContext(context);
 const read=f=>fs.readFileSync('src/'+f,'utf8');
 vm.runInContext(read('strategy-engine.js')+'\n'+read('reader-engine.js').replace('function createEngine(','function createReaderEngine(')+'\n'+read('forest-engine.js'),context);
 const forest=context.createForestEngine,reader=context.createReaderEngine;
 const r=Object.assign(row(),change.row||{}),deep={i:B,score:90123,pv:[B],depth:0,reason:'unchecked fallback',kind:'search',
   defenseChecked:false,analysisIncomplete:false,proven:false,lossProven:false,forcedLoss:false,
   candidateGuards:[{i:A,complete:true,refuted:true}],rejected:[{i:A,line:[idx('A2')]}],
   strategy:{initiative:'opponent',complete:true,checks:[{i:A,complete:true}]},...change.deep};
 context.createForestEngine=o=>{const e=forest(o);return {...e,certifiedLoss:()=>null,knownRefutations:()=>[],
   strategicMove:()=>({cut:12,attack:0}),strategicProfile:()=>({initiative:'unknown',evidence:{}}),
   forcing:(b,p,maxPlies)=>{extra++;return {complete:true,proof:change.stagedRefute&&maxPlies===25&&b[B]?{pv:[idx('A2')]}:null,nodes:1};},quietTrap:()=>({complete:true,proof:null,nodes:1}),
   forcedReplyTrap:()=>({complete:true,proof:null,nodes:1}),analyze:()=>deep};};
 context.createReaderEngine=(...args)=>{const e=reader(...args);return {...e,analyze:(p,ms,progress)=>{
   const result={kind:'search',depth:8,moves:[{i:A,score:100,pv:[A],depth:8,comparisonComplete:true},r,
     {i:C,score:-100,pv:[C],depth:2,comparisonComplete:true}]};progress?.(result);return result;}};};
 vm.runInContext(read('unified-engine.js'),context);
 const e=context.createEngine({firstPlayer:2}),input=board.slice(),updates=[];
 const result=e.analyze(input,2,budget,[],r=>updates.push(r));assert.deepEqual(input,board);
 return {result,extra,e,updates};
}
const retained=run().result;
assert.equal(retained.i,B);assert.equal(retained.depth,6);assert.equal(retained.score,-37);
assert.deepEqual(Array.from(retained.pv),row().pv);assert.equal(retained.comparisonSource,'reader');
assert(retained.retainedComparison.sameMoveOnly);assert(!retained.defenseChecked);
assert.equal(retained.assessmentStatus,'BLOCKING_UNCHECKED');assert.equal(retained.proofStatus,'UNRESOLVED');
assert(!retained.proven&&!retained.lossProven);assert.equal(retained.strategy.initiative,'unknown');
assert.equal(retained.strategy.selectedCheck,null);assert(retained.rejected.some(m=>m.i===A));
assert.equal(retained.candidateGuards[0].refuted,true);assert.equal(retained.candidates[0].comparisonComplete,true);
console.log('PASS same fallback preserves its negative score, explicit depth and full legal PV without defense/proof promotion');
for(const [name,change] of Object.entries({
 'different move':{row:{i:C,pv:[C]}},'partial row':{row:{comparisonComplete:false}},
 'global depth only':{row:{depth:undefined}},'zero row depth':{row:{depth:0}},
 'illegal raw PV':{row:{pv:[B,idx('H8')]}},'wrong PV root':{row:{pv:[C]}},
 'non-finite score':{row:{score:NaN}},'refuted guard':{deep:{candidateGuards:[{i:B,complete:true,refuted:true}]}},
 'actual counter threat':{deep:{counterThreats:[{i:B,riskOnly:false}]}},
 'completed Forest comparison':{deep:{depth:3,score:456,pv:[B,idx('A3')],candidates:[{i:B,depth:3,score:456,pv:[B,idx('A3')],comparisonComplete:true}]}},
 'Forest row marked complete':{deep:{candidates:[{i:B,depth:0,score:90123,pv:[B],comparisonComplete:true}]}},
 'proven Forest win':{deep:{proven:true,kind:'forced'}},'proven Forest loss':{deep:{lossProven:true,forcedLoss:true,kind:'lost'}}
})){
 const {result}=run(change);assert(!result.retainedComparison,name);
 if(name==='completed Forest comparison'){assert.equal(result.depth,3);assert.equal(result.score,456);assert.equal(result.comparisonSource,'forest');}
 console.log('PASS retention excluded:',name);
}
for(const proof of [{pv:[idx('A2')]},{line:[idx('A2')]},{replyTrap:{block:idx('A2')}},{verifiedRefutation:true}]){
 const {result}=run({deep:{rejected:[{i:B,...proof}]}});assert(!result.retainedComparison);
 assert.notEqual(result.i,B);assert(result.candidates.every(m=>m.i!==B));
}
const partial=run({deep:{analysisIncomplete:true}}).result;
assert.equal(partial.depth,6);assert.equal(partial.assessmentStatus,'INCOMPLETE');assert(partial.analysisIncomplete&&!partial.defenseChecked);
const diagnostic=run({deep:{counterThreats:[{i:B,riskOnly:true}]}}).result;assert(diagnostic.retainedComparison);
const manual=run({},25000);assert.equal(manual.result.i,B);assert.equal(manual.result.score,-37);
assert(manual.result.retainedComparison);assert(manual.extra>=2);assert(manual.result.candidateChecks.length>0);
assert.equal(manual.result.counterVerification,null);assert(!manual.result.proven&&!manual.result.lossProven);
const forestRetained=run({deep:{depth:3,score:456,retainedComparison:{i:B,source:'forest',depth:3,sameMoveOnly:true,finalDefenseUnchecked:true}}}).result;
assert.equal(forestRetained.depth,3);assert.equal(forestRetained.score,456);assert.equal(forestRetained.comparisonSource,'forest');
assert.equal(forestRetained.assessmentStatus,'BLOCKING_UNCHECKED');assert(!forestRetained.defenseChecked);
const stagedRejected=run({stagedRefute:true},25000).result;
assert.equal(stagedRejected.i,C);assert.equal(stagedRejected.score,-100);assert.equal(stagedRejected.depth,2);
assert.equal(stagedRejected.comparisonSource,'reader');assert(!stagedRejected.retainedComparison);
assert(stagedRejected.candidates.every(m=>m.i!==B&&m.comparisonSource==='reader'));assert(stagedRejected.rejected.some(m=>m.i===B));
const finalized=manual.e.finalizeResult(board,2,{...retained,i:A,rejected:[],candidates:[{i:A,pv:[A],score:2,depth:1,comparisonComplete:true}]});
assert(!finalized.retainedComparison,'metadata cannot follow another selected coordinate');
console.log('PASS refutation formats, partial defense, diagnostic-only threat, staged 25s with later refutation, Forest provenance and changed selected coordinate');
