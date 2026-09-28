const assert=require('node:assert/strict'),create=require('../tools/proof-session.cjs'),verify=require('../tools/verify-attack.cjs');
const spec={prefix:'H8 G7 G6 H6 F8 I7 E8 D8 F7 H5',attacker:1,quietDepth:1,extensions:0,roots:['F5']};
const session=create(spec),zero=session.run(0);assert.equal(zero.done,false);assert.equal(zero.proof,null);
const E=require('../src/node-engine.cjs')({fivePriority:false}),idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const original=Array(225).fill(0);spec.prefix.split(' ').forEach((c,k)=>original[idx(c)]=k%2?2:1);
spec.roots[0]='A1'; // The live session must not adopt caller mutations.
let resumed,interruptions=0,lastNodes=0;
for(let k=0;k<300;k++){
 resumed=session.run(10);assert(resumed.elapsed_ms<150);
 const board=original.slice();for(const [k,c]of resumed.activeLine.entries()){
  const p=k%2?2:1;assert(E.inspect(board,idx(c),p).legal,'suspended branch must be legal');board[idx(c)]=p;
 }
 assert(resumed.stats.nodes>=lastNodes,'node state cannot reset between slices');lastNodes=resumed.stats.nodes;
 if(resumed.done)break;
 interruptions++;assert.equal(resumed.proof,null);assert.equal(resumed.searchComplete,false);
}
assert(interruptions>0);assert(resumed.done,JSON.stringify(resumed));assert(resumed.proof);
const uninterrupted=create({...spec,roots:['F5']}).run(5000);
assert(uninterrupted.done);assert.deepEqual(resumed.proof,uninterrupted.proof);
const tree=p=>({move:p.move||p.pv[0],replies:Object.fromEntries((p.exceptions||[]).map(e=>[e.response,tree(e.proof)]))});
assert(verify({prefix:spec.prefix,attacker:1,certificate:tree(resumed.proof)},5000).verified);
resumed.proof.move='A1';assert.notEqual(session.run(0).proof.move,'A1','snapshots cannot mutate private proof');
const win=create({prefix:'H8 A1 H9 B1 H10 C1 H11 D2',attacker:1,roots:['H12'],quietDepth:0,extensions:0}).run(1000);
assert.equal(win.proof.move,'H12');
const counter=create({prefix:'H8 A1 H9 B1 H10 C1 F5 D1',attacker:1,roots:['H7'],quietDepth:1,extensions:2}).run(2000);
assert(counter.done);assert.equal(counter.proof,null);
assert.throws(()=>session.run(25001));
console.log('PASS resumed proof equals uninterrupted proof, independent verification, deadline and state isolation');
