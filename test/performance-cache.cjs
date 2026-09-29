const assert=require('node:assert/strict'),create=require('../src/forest-engine.js');
const cached=create(),plain=create({positionCache:false});let seed=9821;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
for(let k=0;k<80;k++){
 const b=Array(225).fill(0);for(let n=0;n<5+k%60;n++){let i;do{i=Math.floor(random()*225)}while(b[i]);b[i]=n%2+1;}
 const before=b.slice();assert.deepEqual(cached.candidates(b),plain.candidates(b));
 for(const p of [1,2]){assert.deepEqual(cached.winning(b,p),plain.winning(b,p));assert.equal(cached.evaluate(b,p),plain.evaluate(b,p));
 const c=cached.winning(b,p);c.push(-1);assert.deepEqual(cached.winning(b,p),plain.winning(b,p));
 for(const i of plain.candidates(b).slice(0,8))assert.deepEqual(cached.inspect(b,i,p),plain.inspect(b,i,p));}
 const c=cached.candidates(b);c.length=0;assert.deepEqual(cached.candidates(b),plain.candidates(b));assert.deepEqual(b,before);
 const i=b.indexOf(0);if(i>=0){b[i]=1;assert.deepEqual(cached.winning(b,1),plain.winning(b,1));b[i]=0;assert.deepEqual(cached.winning(b,1),plain.winning(b,1));}
}
for(let k=0;k<2200;k++){const b=Array(225).fill(0);let n=k;for(let i=0;n;i++,n=Math.floor(n/3))b[i]=n%3;cached.candidates(b);cached.winning(b,1);cached.evaluate(b,1);}
assert(cached.getPositionCacheStats().hits>0);assert(cached.getPositionCacheStats().entries<=6144);
console.log('PASS pure position cache equivalence, color isolation, board mutation, copy isolation and bounded capacity');
