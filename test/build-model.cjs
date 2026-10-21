'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict'),B=require('../tools/build-model.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),root=fs.mkdtempSync(path.join(os.tmpdir(),'omok-portable-build-'));
try{
 const model={schemaVersion:1,kind:'forest-value-mlp',rulesId:'15x15-exact5-both33-v1',featureVersion:'house32-v1',inputSize:32,hiddenSize:1,activation:'relu',outputActivation:'tanh',modelId:'synthetic-build-fixture',scale:40,normalization:{mean:Array(32).fill(0),scale:Array(32).fill(1)},layers:[{weights:[Array(32).fill(.01)],bias:[0]},{weights:[[.1]],bias:[0]}]};
 const text=JSON.stringify(model)+'\n',artifact=hash(text),directory=path.join(root,'artifacts/adopted-models',artifact);fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(path.join(root,'src'));
 const evidence={kind:'forest-omok-verified-adoption',accepted:true,modelId:model.modelId,adoptedAt:'2026-01-01T00:00:00Z',settings:{baselineCommit:'a'.repeat(40)},code:{evaluation:{sourceHash:'a'.repeat(64),harnessHash:'b'.repeat(64),runtimeHash:'c'.repeat(64)}},hashes:{artifactSha256:artifact,arenaSemanticHash:'d'.repeat(64)}};
 const evidenceText=JSON.stringify(evidence)+'\n';fs.writeFileSync(path.join(directory,'model.json'),text);fs.writeFileSync(path.join(directory,'evidence.json'),evidenceText);
 fs.writeFileSync(path.join(root,'src/default-model-reference.json'),JSON.stringify({artifactSha256:artifact,evidenceSha256:hash(evidenceText)}));
 const clean=B.load(root),local={...model,training:{privatePath:'do-not-embed'},adoption:{accepted:true,at:evidence.adoptedAt,sourceHash:'a'.repeat(64),exposure:{runDir:'do-not-embed'}}};
 const active=path.join(root,'src/active-model.json'),activeText=JSON.stringify(local);fs.writeFileSync(active,activeText);
 assert.deepEqual(B.load(root),clean,'ignored local metadata must not change the distributable with identical adopted weights');assert.equal(fs.readFileSync(active,'utf8'),activeText);
 assert(!JSON.stringify(B.load(root,{explicitFile:active})).includes('do-not-embed'));assert.equal(B.load(root,{baseline:true}),null);
 fs.appendFileSync(path.join(directory,'evidence.json'),' ');assert.throws(()=>B.load(root),/bytes changed/);
 console.log('PASS generated clean-build fixture: pinned public bytes, same adopted inference with/without ignored local model, no private metadata, historical identity retained and tamper rejection');
}finally{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('omok-portable-build-'));fs.rmSync(resolved,{recursive:true,force:true});}
