const assert=require('node:assert/strict'),verify=require('../tools/verify-attack.cjs'),E=require('../src/node-engine.cjs')({fivePriority:false});
const source=require('../reports/i7-loss-certificate.json');
const spec={...source,prefix:'H8 G7 G6 H6 F8 H7'},result=verify(spec,3000);
assert.equal(result.verified,false);assert.equal(result.reason,'Unrefuted reply H3');
assert.deepEqual(result.variation,['E8','D8','F7','H5','F5','H3']);
const b=Array(225).fill(0);
for(const [k,c]of [...spec.prefix.split(' '),...result.variation].entries()){
 const i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?2:1;
 assert(E.inspect(b,i,p).legal);b[i]=p;
}
const expired=verify(spec,0);assert.equal(expired.verified,false);assert.match(expired.reason,/timeout/);
assert.deepEqual(expired.variation,['E8']);
console.log('PASS failed certificate branch path and bounded timeout context');
