'use strict';
// Generated boards only. Neither learning runs nor stored human games are
// needed to reproduce the missed quiet preparation or verify its certificate.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{performance}=require('node:perf_hooks');
const create=require('../src/reader-engine.js').createEngine,rules=require('../tools/counter-rules.cjs'),serialize=require('../tools/counter-dag.cjs'),verify=require('../tools/verify-counter.cjs');
const createSearch=require('../src/search-engine.js'),{checkFinalists}=require('../src/parallel-analysis.js');
const idx=c=>(Number(c.slice(1))-1)*15+c.charCodeAt(0)-65,plain=v=>JSON.parse(JSON.stringify(v));
const defenderStones='C8 D7 D9 C7 E9 H7 G7 I9'.split(' '),attackerStones='E8 F8 K2 K3 B2 B3 M12 M13 B12 B13 H13 H14'.split(' ');
const options={strategy:false,optimized:true,counterProofDetails:true};
function symmetry(flip,rotation){return i=>{let x=i%15,y=Math.floor(i/15);if(flip)x=14-x;for(let k=0;k<rotation;k++){const a=x;x=14-y;y=a;}return y*15+x;};}
function fixture(defender=1,map=i=>i){const b=Array(225).fill(0);for(const s of defenderStones)b[map(idx(s))]=defender;for(const s of attackerStones)b[map(idx(s))]=3-defender;return b;}
function verifyProof(board,attacker,proof){const result=verify(board,serialize(proof,{attacker}),{loss:false,limitMs:5000});assert(result.verified,result.error);assert(result.boardRestored);return result;}
function observedForbiddenEnds(board,attacker,proof){
 const seen=new Set(),root=board.slice();root[proof.i]=attacker;
 for(const branch of proof.branches){
  assert.equal(branch.proof.type,'vcf','this fixture has a directly replayable VCF after each quiet defense');
  const copy=root.slice();copy[branch.i]=3-attacker;const R=rules(copy),pv=branch.proof.pv;
  for(let k=0;k<pv.length;){const i=pv[k++];assert(R.legal(i,attacker));R.put(i,attacker);if(R.exact(i,attacker))break;
   const ends=R.wins(attacker);if(ends.length>=2)break;assert.equal(ends.length,1);
   const j=ends[0];if(!R.legal(j,3-attacker)){seen.add(R.board.join('')+'|'+j);break;}
   assert.equal(pv[k++],j);R.put(j,3-attacker);
  }
 }
 return seen;
}
function verifyWitness(entry,attacker,proof){
 const terminal=proof.forbiddenEnd,R=rules(entry);let p=attacker;
 for(const i of proof.forbiddenLine||proof.pv){assert(R.legal(i,p));R.put(i,p);p=3-p;}
 assert.equal(R.board.join(''),terminal.boardKey,'the supplied legal witness reaches the reported forbidden board');
 assert(!R.legal(terminal.i,3-attacker));assert.deepEqual(R.wins(attacker),[terminal.i]);assert(terminal.threes.length>=2);
}
let checked=0,replies=0,maxMs=0;
for(const defender of [1,2])for(const flip of [false,true])for(let rotation=0;rotation<4;rotation++){
 const map=symmetry(flip,rotation),attacker=3-defender,before=fixture(defender,map),bad=map(idx('H9')),block=map(idx('H8')),quiet=map(idx('G8'));
 const beforeRules=rules(before);assert(beforeRules.legal(bad,defender));assert(beforeRules.legal(block,defender));
 const after=before.slice();after[bad]=defender;assert(!rules(after).legal(block,defender),'the otherwise legal move induces the later 3x3 block');
 const legacy=create(15,after,options);assert.equal(legacy.winningMoves(attacker).length,0);assert.equal(legacy.winningMoves(defender).length,0);
 assert.equal(legacy.forcingWin(attacker,13,200),null,'there is no direct VCF before the quiet preparation');
 assert.equal(legacy.forcingWin(defender,13,200),null,'the generated trap has no immediate defender forcing escape');
 assert(legacy.rank(attacker).findIndex(r=>r.i===quiet)>=12,'critical preparation is outside the old top-12 nomination');
 assert.equal(legacy.threatWin(attacker,200),null,'the existing ordinary quiet probe misses the preparation');
 const engine=create(15,after,options),start=performance.now(),result=engine.forbiddenTrap(attacker,500);
 maxMs=Math.max(maxMs,performance.now()-start);assert(result.complete&&result.proof);assert.equal(result.scope,'targeted-forbidden-preparations');
 const proof=plain(result.proof);assert.equal(proof.i,quiet);assert.equal(proof.entryBoardKey,after.join(''));assert.equal(proof.forced,false);
 const afterPreparation=after.slice();afterPreparation[quiet]=attacker;const R=rules(afterPreparation),legal=Array.from({length:225},(_,i)=>i).filter(i=>R.legal(i,defender));
 assert.equal(legal.length,198);assert.equal(proof.checkedReplies,legal.length);assert.equal(proof.branches.length,legal.length);
 assert.deepEqual(proof.branches.map(r=>r.i).sort((a,b)=>a-b),legal);assert.equal(new Set(proof.branches.map(r=>r.i)).size,legal.length);
 const verified=verifyProof(after,attacker,proof);assert.equal(verified.stats.defenses,legal.length);replies+=verified.stats.defenses;
 const terminal=proof.forbiddenEnd;assert(terminal&&terminal.threes.length>=2);const terminalBoard=Array.from(terminal.boardKey,Number),terminalRules=rules(terminalBoard);
 assert(!terminalRules.legal(terminal.i,defender));assert.deepEqual(terminalRules.wins(attacker),[terminal.i]);
 assert(observedForbiddenEnds(after,attacker,proof).has(terminal.boardKey+'|'+terminal.i),'reported forbidden end belongs to an actually verified branch');
 verifyWitness(after,attacker,proof);
 assert.deepEqual(Array.from(engine.board),after);assert.deepEqual(before,fixture(defender,map));
 // H8 is a legal attacking alternative with next-own-turn forcing potential.
 // This does not prove it wins after every actual opponent response, nor
 // prove that the whole pre-candidate position escapes a forced loss.
 const counter=before.slice();counter[block]=defender;const line=create(15,counter,options).forcingWin(defender,13,200);assert(line);
 verifyProof(counter,defender,{type:'vcf',pv:plain(line)});checked++;
}
console.log(JSON.stringify({test:'targeted-forbidden-preparation',cases:checked,independentlyVerifiedLegalReplies:replies,maxDiscoveryMs:Math.round(maxMs),scope:'Actual old top-12 miss versus targeted discovery, colors/D4, full legal defender coverage and a retained legal attacking alternative with next-own-turn forcing potential; no whole-position escape proof or wall-time acceptance threshold.'}));

for(const defender of [1,2]){
 const attacker=3-defender,base=fixture(defender);base[idx('H9')]=defender;
 // A counter-four is a real escape, not a harmless move outside the local
 // forbidden pattern. The quiet certificate must include and fail on it.
 const counter=base.slice();for(const c of ['N5','N6','N8'])counter[idx(c)]=defender;
 const afterQuiet=counter.slice();afterQuiet[idx('G8')]=attacker;const R=rules(afterQuiet);assert(R.legal(idx('N7'),defender));R.put(idx('N7'),defender);assert.equal(R.wins(defender).length,2);
 const counterResult=create(15,counter,options).forbiddenTrap(attacker,500);assert(counterResult.complete&&!counterResult.proof);assert.deepEqual(counter,base.map((v,i)=>['N5','N6','N8'].some(c=>idx(c)===i)?defender:v));
 const immediate=base.slice();for(const c of ['N5','N6','N7','N8'])immediate[idx(c)]=defender;
 const immediateResult=create(15,immediate,options).forbiddenTrap(attacker,200);assert(immediateResult.complete&&!immediateResult.proof,'two immediate counter-win endpoints defeat the bait');
 // Exact-five priority can turn a nominal 3x3 point into a legal winning
 // response. Never refute G8 while ignoring that actual counter-win.
 const exact=base.slice();for(const c of ['H5','H6'])exact[idx(c)]=defender;const exactQuiet=exact.slice();exactQuiet[idx('G8')]=attacker;
 const exactRules=rules(exactQuiet);assert(exactRules.legal(idx('H8'),defender));exactRules.put(idx('H8'),defender);assert(exactRules.exact(idx('H8'),defender));
 const exactResult=create(15,exact,options).forbiddenTrap(attacker,500);assert(!exactResult.proof||exactResult.proof.i!==idx('G8'));
 const empty=create(15,Array(225).fill(0),options).forbiddenTrap(attacker,50);assert(empty.complete&&!empty.proof);assert.equal(empty.scope,'targeted-forbidden-preparations');
 let ticks=0;const context={performance:{now:()=>++ticks*.1},Date};vm.createContext(context);vm.runInContext(fs.readFileSync('src/reader-engine.js','utf8'),context);
 const interrupted=context.createEngine(15,base,options),partial=interrupted.forbiddenTrap(attacker,30);
 assert(!partial.complete&&!partial.proof);assert(partial.nodes>240,'timeout occurred after nomination and entry into actual reply work');assert.deepEqual(Array.from(interrupted.board),base);
 const recovered=interrupted.forbiddenTrap(attacker,100000);assert(recovered.complete&&recovered.proof);assert.deepEqual(Array.from(interrupted.board),base);
 const noTime=create(15,base,options).forbiddenTrap(attacker,0);assert(!noTime.complete&&!noTime.proof);
}
console.log('PASS counter-four and immediate-win escapes, exact-five priority, targeted unknown scope, interrupted proof, deadline restoration and reused-board undo in both colors');

for(const defender of [1,2]){
 const before=fixture(defender),after=before.slice(),bad=idx('H9'),good=idx('H8');after[bad]=defender;
 const engine=createSearch({...options,model:null});
 const direct=engine.forcing(after,3-defender,25,100);assert(direct.complete&&!direct.proof,'the final guard needs the quiet-preparation check');
 const wrapper=engine.forbiddenTrap(after,defender,500,13,1);assert(wrapper.complete&&wrapper.proof);assert.equal(wrapper.proof.i,idx('G8'));
 verifyProof(after,3-defender,plain(wrapper.proof));assert.deepEqual(before,fixture(defender));
 const checks=checkFinalists(engine,before,defender,[{i:bad},{i:good}],1200);
 const refuted=checks.find(c=>c.i===bad),counterattack=checks.find(c=>c.i===good);
 assert(refuted?.refuted&&refuted.complete&&refuted.rejection.verifiedRefutation);assert(refuted.rejection.forbiddenTrap?.proof);
 verifyProof(after,3-defender,plain(refuted.rejection.forbiddenTrap.proof));
 assert(counterattack&&!counterattack.refuted,'the real pool guard retains H8 as a legal attacking alternative');
 assert.deepEqual(before,fixture(defender));
}
console.log('PASS real Search wrapper and parallel finalist guard reject induced H9 while preserving attacking H8 in both colors');

// Accessible historical records are separate regression evidence. The old
// engine already recognizes some of these late traps; no new-strength or
// reproduction claim about the user's unavailable recent games is implied.
{
 const record=require('./reader/game95.cjs'),before=record.position(93),after=before.slice(),candidate=record.idx('H5'),point=record.idx('I4');
 assert(rules(before).legal(candidate,1));assert(rules(before).legal(point,1));after[candidate]=1;assert(!rules(after).legal(point,1));
 const r=create(15,after,options).forbiddenTrap(2,300);assert(r.complete&&r.proof);assert.equal(r.proof.forbiddenEnd.i,point);
 verifyProof(after,2,plain(r.proof));verifyWitness(after,2,plain(r.proof));assert.deepEqual(before,record.position(93));
 const moves='H8 G7 G6 H6 F8 I7 E8 G8 F7 D9 F9 F10 F5 F6 D7 G10 E6 C8 E7 E5 E9 B7'.split(' ');
 const historical=n=>{const b=Array(225).fill(0);moves.slice(0,n).forEach((c,k)=>b[idx(c)]=k%2?2:1);return b;};
 const earlier=historical(18),trap=create(15,earlier,options).forbiddenTrap(1,300);
 assert(trap.complete&&trap.proof);assert.equal(trap.proof.i,idx('E7'));assert.equal(trap.proof.checkedReplies,205);
 verifyProof(earlier,1,plain(trap.proof));verifyWitness(earlier,1,plain(trap.proof));assert.deepEqual(earlier,historical(18));
 const later=historical(20),end=create(15,later,options).forbiddenTrap(1,300);assert(end.complete&&end.proof);assert.equal(end.proof.forbiddenEnd.i,idx('E10'));
 verifyProof(later,1,plain(end.proof));verifyWitness(later,1,plain(end.proof));assert.deepEqual(later,historical(20));
}
console.log('PASS bounded recorded H5/I4 and C8/E7/E10 trap certificates with independent reply and witness verification');
