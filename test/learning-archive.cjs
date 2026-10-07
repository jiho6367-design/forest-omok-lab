'use strict';
const assert=require('node:assert/strict'),S=require('../tools/learning/state.cjs'),archive=require('../tools/learning/archive.cjs');
archive.assertDeliverySource({identity:S.sourceIdentity()});
assert.throws(()=>archive.assertDeliverySource({identity:{sourceHash:'0'.repeat(64)}}),/production engine changed/);
const path=require('node:path'),fs=require('node:fs'),baseline=path.join(S.ROOT,'work/continuous-runtime-baseline.json');
if(fs.existsSync(baseline)){const original=S.read(baseline);assert.deepEqual(archive.frozenRuntime().load('tools/learning/state.cjs').sourceIdentity(),original.identity);}
console.log(JSON.stringify({passed:true,scope:'Archived runtime identity and deployment blocked after a production-engine change'}));
