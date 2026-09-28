const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const createEngine=require('../src/node-engine.cjs'),mod={exports:{}};
// Force a single internal probe to be incomplete without depending on CPU speed.
vm.runInNewContext(fs.readFileSync(require.resolve('../tools/proof-session.cjs'),'utf8'),{
 module:mod,Date,require:()=>rules=>{const e=createEngine(rules);let calls=0;return {...e,forcing(...args){if(++calls===2)return {complete:false,proof:null};return e.forcing(...args);}};}
});
const spec={prefix:'H8 G7 G6 H6 F8 I7 E8 D8 F7 H5',attacker:1,quietDepth:1,extensions:0,roots:['F5']};
const session=mod.exports(spec),r=session.run(5000);
assert(r.done&&!r.searchComplete&&!r.proof);
assert.equal(r.stats.vcfIncomplete,1);assert.equal(r.incompleteVcf.length,1);
assert.equal(r.rootChecks[0].status,'incomplete');
const entry=r.incompleteVcf[0],moves=entry.prefix.split(' '),E=createEngine(entry.rules),b=Array(225).fill(0);
assert.equal(moves.length,spec.prefix.split(' ').length+2);
for(let k=0;k<moves.length;k++){const c=moves[k],i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?2:1;assert(E.inspect(b,i,p).legal);b[i]=p;}
assert.equal(entry.attacker,1);assert.equal(entry.quietLeft,0);
entry.prefix='A1';assert.notEqual(session.run(0).incompleteVcf[0].prefix,'A1');
console.log('PASS incomplete VCF path is legal, preserves unknown result and cannot mutate session');
