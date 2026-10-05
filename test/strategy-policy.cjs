const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const create=require('../src/node-engine.cjs'),idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const blank=()=>Array(225).fill(0),candidate=(c,score,depth=4)=>({i:idx(c),score,pv:[idx(c)],depth,comparisonComplete:true});
function controlled(wrapForest=f=>f,wrapReader=r=>r){
 const c={Date,console};vm.createContext(c);
 const read=f=>fs.readFileSync('src/'+f,'utf8');
 vm.runInContext(read('strategy-engine.js')+'\n'+read('reader-engine.js').replace('function createEngine(','function createReaderEngine(')+'\n'+read('forest-engine.js'),c);
 const f=c.createForestEngine,r=c.createReaderEngine;
 c.createForestEngine=o=>wrapForest(f(o));c.createReaderEngine=(...args)=>wrapReader(r(...args));
 vm.runInContext(read('unified-engine.js'),c);return c.createEngine({firstPlayer:2});
}
const e=create({firstPlayer:2}),board=blank(),before=board.slice();board[idx('H8')]=1;
const favorable=e.finalizeResult(board,2,{i:idx('G8'),kind:'search',depth:4,score:30,pv:[idx('G8')]});
assert.equal(favorable.assessmentStatus,'BOUNDED_FAVORABLE');assert.equal(favorable.proofStatus,'UNRESOLVED');assert(!favorable.proven);
const incomplete=e.finalizeResult(board,2,{...favorable,timedOut:true});
assert.equal(incomplete.assessmentStatus,'INCOMPLETE');assert.equal(incomplete.depth,4);assert(incomplete.timedOut);
const unfinishedProbe=e.finalizeResult(board,2,{...favorable,strategy:{initiative:'own',complete:false,evidence:{ownWins:[],enemyWins:[]}}});
assert.equal(unfinishedProbe.strategy.initiative,'unknown');assert(!unfinishedProbe.proven);
const block=blank();for(const c of ['A1','A2','A3','A4'])block[idx(c)]=1;
const blocked=e.urgent(block,2);assert.equal(blocked.assessmentStatus,'BLOCKING_UNCHECKED');assert(!blocked.proven);
const winning=e.urgent(block,1);assert.equal(winning.assessmentStatus,'PROVEN_WIN');assert(winning.proven);
block[idx('A1')]=0;for(const c of ['F8','G8','H8','I8'])block[idx(c)]=1;
const lost=e.urgent(block,2);assert.equal(lost.assessmentStatus,'PROVEN_LOSS');assert(lost.lossProven);
assert.deepEqual(before,blank());
console.log('PASS proof, bounded comparison, blocking and incomplete assessments stay distinct');

for(const evidence of [{line:[idx('E8')]},{pv:[idx('E8')]},{replyTrap:{block:idx('E8')}},{verifiedRefutation:true}]){
 const rejected={i:idx('J4'),...evidence};
 const result=e.finalizeResult(board,2,{i:idx('J4'),kind:'search',depth:4,score:900,pv:[idx('J4')],
   rejected:[rejected],candidates:[candidate('J4',900),candidate('G8',40)]});
 assert.equal(result.i,idx('G8'));assert.equal(result.pv[0],result.i);assert(!result.proven);assert(!result.lossProven);
 assert(result.candidates.every(m=>m.i!==idx('J4')));
}
const updateEngine=controlled(f=>({...f,forcing:()=>({complete:false,proof:null}),
 analyze:()=>({i:idx('J4'),score:100,depth:6,pv:[idx('J4')],reason:'deep comparison',rejected:[]})}),
 reader=>({...reader,analyze:(p,ms,progress)=>{const result={kind:'search',depth:4,
  moves:[candidate('J4',999),candidate('G8',30)],rejectedMoves:[{i:idx('J4'),line:[idx('J4'),idx('E8')]}]};progress(result);return result;}}));
const updates=[],out=updateEngine.analyze(board,2,{automatic:true,ms:15000},[],r=>updates.push(r));
assert.equal(out.i,idx('G8'));assert(updates.length);assert(updates.every(r=>r.i!==idx('J4')));
assert(updates.every(r=>r.strategy.context.firstPlayer===2));
console.log('PASS every progress/deep/final path uses identical refutation and context gates');
const replaced=e.finalizeResult(board,2,{i:idx('J4'),kind:'forced',proven:true,proof:{type:'old-move-certificate'},
 counterVerification:{i:idx('J4'),kind:'lost'},depth:4,pv:[idx('J4')],
 rejected:[{i:idx('J4'),line:[idx('J4'),idx('E8')]}],candidates:[candidate('G8',40)]});
assert.equal(replaced.i,idx('G8'));assert.equal(replaced.proof,null);assert.equal(replaced.counterVerification,null);
assert(!replaced.proven);assert.equal(replaced.kind,'incomplete');assert.equal(replaced.pv[0],replaced.i);
const lostFallback=e.finalizeResult(board,2,{i:idx('J4'),kind:'lost',lossProven:true,
 depth:4,pv:[idx('J4')],rejected:[{i:idx('J4'),line:[idx('J4'),idx('E8')]}],candidates:[candidate('J4',40)]});
assert.notEqual(lostFallback.i,idx('J4'));assert(lostFallback.lossProven);
assert(lostFallback.candidates.every(m=>m.i!==idx('J4')));
let urgentFeatures=0;
const quick=controlled(f=>({...f,strategicProfile:()=>{urgentFeatures++;throw Error('whole-board profile on urgent result');},
 strategicMove:()=>{urgentFeatures++;throw Error('whole-board features on urgent result');}}));
quick.finalizeResult(block,1,{i:idx('E8'),pv:[idx('E8')],kind:'win',proven:true,urgent:true,depth:1});
assert.equal(urgentFeatures,0);
console.log('PASS candidate replacement clears stale certificates and urgent finalization bypasses strategic scans');

const ranked=[candidate('J4',90,6),candidate('G8',80,6),candidate('I5',70,6)];
const shortlist=controlled(f=>({...f,forcing:()=>({complete:true,proof:null,nodes:1}),
 forcedReplyTrap:()=>({complete:true,proof:null}),quietTrap:()=>({complete:true,proof:null}),
 analyze:()=>({i:idx('J4'),score:90,depth:6,pv:[idx('J4')],candidates:ranked,reason:'completed Forest comparison',rejected:[]})}),
 reader=>({...reader,analyze:(p,ms,progress)=>{const result={kind:'search',depth:4,
  moves:[candidate('I5',999999),candidate('G8',999998),candidate('F7',999997)]};progress(result);return result;}}));
const selected=shortlist.analyze(board,2,25000);
assert.deepEqual(Array.from(selected.candidates,m=>m.i),ranked.map(m=>m.i));
assert(selected.candidates.every(m=>m.comparisonComplete&&m.depth===6));
assert.equal(selected.candidateChecks.length,3);assert(!selected.proven);assert(!selected.lossProven);
console.log('PASS three completed Forest candidates survive deep validation without cross-engine score sorting');

let wrongTurnCalls=0,trapCalls=0;
const actualTurn=controlled(f=>({...f,forcing:()=>{wrongTurnCalls++;return {complete:true,proof:{pv:[idx('A8')]}};},
 forcedReplyTrap:()=>{trapCalls++;return {complete:false,proof:null};},
 analyze:()=>({i:idx('A4'),score:120,depth:4,pv:[idx('A4')],reason:'comparison',rejected:[]})}),
 reader=>({...reader,forcingWin:()=>null,analyze:()=>({kind:'search',depth:3,moves:[candidate('A4',100,3)]})}));
const four=blank();for(const c of ['A1','A2','A3'])four[idx(c)]=1;
const actual=actualTurn.analyze(four,1,{automatic:true,ms:9000});
assert.equal(actual.i,idx('A4'));assert(trapCalls>0);assert(wrongTurnCalls>0);
assert(!(actual.rejected||[]).some(m=>m.i===idx('A4')));assert(!actual.proven);
const latent=actual.counterThreats.find(m=>m.i===idx('A4'));
assert(latent.riskOnly);assert.equal(latent.actualTurn,1);assert.equal(latent.hypotheticalTurn,2);
assert.equal(latent.actualCheck.complete,false);assert.equal(latent.actualCheck.unrefutedReply,null);
console.log('PASS opponent hypothetical extra turn cannot refute an attack; incomplete all-reply check preserves it');

const actualProof=controlled(f=>({...f,forcing:()=>({complete:true,proof:null}),
 forcedReplyTrap:()=>({complete:true,proof:{block:idx('A5'),branches:[{i:idx('B4'),proof:{pv:[idx('B5')]}}]}}),
 analyze:()=>({i:idx('A4'),score:120,depth:4,pv:[idx('A4')],candidates:[candidate('A4',120),candidate('B4',80)],reason:'comparison',rejected:[]})}),
 reader=>({...reader,forcingWin:()=>null,analyze:()=>({kind:'search',depth:3,moves:[candidate('A4',100,3),candidate('B4',80,3)]})}));
const certified=actualProof.analyze(four,1,{automatic:true,ms:9000});
assert.equal(certified.i,idx('B4'));assert(certified.rejected.some(m=>m.i===idx('A4')&&m.replyTrap));
assert(!certified.proven);assert(!certified.lossProven);assert(certified.candidates.every(m=>m.i!==idx('A4')));
console.log('PASS completed actual-turn all-continuation proof excludes the refuted attack');
