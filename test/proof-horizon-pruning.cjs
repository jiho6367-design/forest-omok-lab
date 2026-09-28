const assert=require('node:assert/strict'),create=require('../tools/proof-session.cjs');
const fixtures=[
 {prefix:'H8 G7 G6 F7 H7 F5 H6 H9 H4 H5 F6 I6 E6',attacker:2,roots:['D6'],quietDepth:2,extensions:8,forcedDefenseExtensions:true,counterVcfPruning:true},
 {prefix:'H8 G7 G6 H6 F8 I7 E8 D8 F7 H5',attacker:1,roots:['F5'],quietDepth:1,extensions:0},
 {prefix:'H8 A1 H9 B1 H10 C1 H11 D1',attacker:1,roots:['H12'],quietDepth:0,extensions:0}
];
for(const spec of fixtures){
 const plain=create({...spec,horizonPruning:false}).run(25000);
 const fast=create({...spec,horizonPruning:true}).run(25000);
 assert(plain.done&&fast.done&&plain.searchComplete&&fast.searchComplete);
 assert.deepEqual(fast.proof,plain.proof);
 assert.deepEqual(fast.rootChecks,plain.rootChecks);
 assert.equal(fast.stats.nodes,plain.stats.nodes);
 assert.equal(fast.stats.defenses,plain.stats.defenses);
 console.log(JSON.stringify({prefix:spec.prefix,baseline_ms:plain.elapsed_ms,optimized_ms:fast.elapsed_ms,nodes:fast.stats.nodes}));
}
console.log('PASS horizon eligibility preserves proofs, root results and explored tree');
