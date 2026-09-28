const assert=require('node:assert/strict'),create=require('../tools/proof-session.cjs'),verify=require('../tools/verify-attack.cjs');
const spec={prefix:'H8 G7 G6 H6 F8 I7 E8 D8 F7 H5',attacker:1,roots:['F5'],quietDepth:0,extensions:1};
const plain=create(spec).run(5000),extended=create({...spec,threeExtensions:true}).run(5000);
assert(plain.done&&plain.searchComplete&&!plain.proof);
assert(extended.done&&extended.searchComplete&&extended.proof);
assert.equal(extended.stats.threeExtensions,1);
assert.equal(extended.proof.replies,214);
const certificate={move:extended.proof.move};
const checked=verify({prefix:spec.prefix,attacker:1,certificate},5000);
assert(checked.verified);assert.equal(checked.defenses,214);
const exhausted=create({...spec,threeExtensions:true,extensions:0}).run(5000);
assert(exhausted.done&&!exhausted.proof);assert.equal(exhausted.stats.threeExtensions,0);
const defendable=create({prefix:'B8 O15 C8 O14',attacker:1,roots:['D8'],quietDepth:0,extensions:1,threeExtensions:true}).run(5000);
assert(defendable.done&&defendable.searchComplete&&!defendable.proof);
assert(defendable.stats.threeExtensions>0);
const session=create({...spec,threeExtensions:true});let resumed;
for(let k=0;k<300;k++){resumed=session.run(10);if(resumed.done)break;}
assert(resumed.done&&resumed.searchComplete);assert.deepEqual(resumed.proof,extended.proof);
console.log('PASS bounded three extension, 214 independent defenses, ordinary-three counterexample and resume');
