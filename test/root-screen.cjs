const assert=require('node:assert/strict'),screen=require('../tools/screen-replay.cjs');
const moves='H8 G7 G6 H6 F8 I7 E8 G8 F7 D9 F9 F10 F5 F6 D7 G10 E6 C8 E7 E5 E9 B7'.split(' ');
const stopped=screen(moves,[14],0).results[0];
assert.equal(stopped.legal,212);assert.equal(stopped.incomplete.length,212);
assert.equal(stopped.refuted.length,0);assert.equal(stopped.unrefuted.length,0);
const result=screen(moves,[14,16,18,20,22]);
assert(result.elapsed_ms<25300);
for(const [k,expected] of ['F6','C6 G10','G4 C8 G9 G11','G9 G11',''].entries()){
  const r=result.results[k];
  assert.equal(r.incomplete.length,0);
  assert.equal(r.unrefuted.join(' '),expected);
  assert.equal(r.refuted.length+r.unrefuted.length+r.winning.length,r.legal);
  assert.equal(new Set([...r.refuted.map(x=>x.move),...r.unrefuted,...r.winning]).size,r.legal);
}
assert.equal(result.results[4].actual_refutation.line.join(' '),'E10');
assert.throws(()=>screen(moves,[0]));
const E=require('../src/node-engine.cjs')({fivePriority:false});
const {positions}=require('../src/historical-analysis.cjs').replay(moves);
const index=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
for(let t=0;t<8;t++)for(const swap of [false,true]){
  const b=Array(225).fill(0);positions[15].forEach((p,i)=>{if(p)b[E.transformed(i,t)]=swap?3-p:p;});
  const known=E.knownRefutations(b,swap?1:2);
  assert.equal(known.length,1);assert.equal(known[0].i,E.transformed(index('C6'),t));
  assert.equal(known[0].attack,E.transformed(index('E6'),t));
  assert.equal(E.certifiedLoss(b,swap?1:2),null,'rejecting C6 does not refute every root');
}
console.log('PASS exhaustive later roots, complete partition, timeout does not certify survivors');
