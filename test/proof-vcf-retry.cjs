const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const createEngine=require('../src/node-engine.cjs'),verify=require('../tools/verify-attack.cjs');
function load(fail){const mod={exports:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../tools/proof-session.cjs'),'utf8'),{
 module:mod,Date,require:()=>rules=>{const e=createEngine(rules);let calls=0;return {...e,forcing(...args){if(fail(++calls))return {complete:false,proof:null};return e.forcing(...args);}};}
});return mod.exports;}
const spec={prefix:'H8 G7 G6 H6 F8 I7 E8 D8 F7 H5',attacker:1,quietDepth:1,extensions:0,roots:['F5'],retryIncompleteVcf:true};
const recovered=load(n=>n===2)(spec).run(5000);
assert(recovered.done&&recovered.searchComplete&&recovered.proof);
assert.equal(recovered.stats.vcfRetries,1);assert.equal(recovered.incompleteVcf.length,0);
assert(verify({prefix:spec.prefix,attacker:1,certificate:{move:recovered.proof.move}},5000).verified);
const exhausted=load(n=>n===2||n===3)(spec).run(5000);
assert(exhausted.done&&!exhausted.searchComplete&&!exhausted.proof);
assert.equal(exhausted.stats.vcfRetries,1);assert.equal(exhausted.incompleteVcf.length,1);
assert.equal(exhausted.rootChecks[0].status,'incomplete');
const disabled=load(n=>n===2)({...spec,retryIncompleteVcf:false}).run(5000);
assert(disabled.done&&!disabled.searchComplete&&!disabled.proof);assert.equal(disabled.stats.vcfRetries,0);
console.log('PASS one bounded VCF retry recovers verified proof and preserves exhausted unknowns');
