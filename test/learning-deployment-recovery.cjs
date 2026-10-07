'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const S=require('../tools/learning/state.cjs'),D=require('../tools/learning/deployment.cjs'),N=require('../src/neural-evaluator.js');
const identityKeys=['sourceHash','harnessHash','runtimeHash'],baseIdentity=Object.fromEntries(identityKeys.map(key=>[key,S.hash('deployment-fixture-'+key)]));
const identityFile=root=>path.join(root,'execution-identity.json'),identityProvider=root=>()=>S.read(identityFile(root)),transactionFile=root=>path.join(root,'work/local-learning-20261007/deployment/transaction.json');
const accepted={schemaVersion:1,kind:'forest-value-mlp',rulesId:N.RULES_ID,featureVersion:N.FEATURE_VERSION,inputSize:32,hiddenSize:1,activation:'relu',outputActivation:'tanh',normalization:{mean:Array(32).fill(0),scale:Array(32).fill(1)},layers:[{weights:[Array(32).fill(0)],bias:[0]},{weights:[[0]],bias:[0]}],modelId:'crash-fixture',scale:80,adoption:{accepted:true,...baseIdentity}};
function context(root){return {dir:path.join(root,'run'),state:S.read(path.join(root,'run/state.json'))};}
function htmlFiles(root){const delivery=path.resolve(root,'../../outputs');return [path.join(root,'outputs/omok.html'),path.join(root,'outputs/omok-gpu.html'),path.join(root,'dist/index.html'),path.join(delivery,'omok.html'),path.join(delivery,'omok-gpu.html')];}
function targetFiles(root,exposure=false){return [path.join(root,'src/active-model.json'),...htmlFiles(root),...['champion.json','models/'+accepted.modelId+'.json','adoption.json','state.json','adoptions.jsonl',...(exposure?['models/'+accepted.modelId+'.exposures.jsonl']:[])].map(name=>path.join(root,'run',name))];}
const bytes=file=>fs.existsSync(file)?fs.readFileSync(file):null;
function before(root,exposure=false){return new Map(targetFiles(root,exposure).map(file=>[file,bytes(file)]));}
function assertBytes(expected){for(const [file,value] of expected)assert.deepEqual(bytes(file),value,file);}
function stagedBuild({stage,accepted:model}){S.atomic(path.join(stage,'omok.html'),'synthetic accepted '+model.modelId);}
function deployOptions(root){const prior=S.read(path.join(root,'src/active-model.json'));return {root,stageId:'isolated-fixture',incumbentHash:prior?S.hash(prior):null,identityProvider:identityProvider(root),context:context(root),entry:{adopted:true,cycle:1,modelId:accepted.modelId},build:stagedBuild};}
if(process.argv[2]==='crash'){
 const root=process.argv[3],boundary=Number(process.argv[4]),model=S.read(path.join(root,'accepted.json'));D.deploy(model,{...deployOptions(root),onPublish:(_file,n)=>{if(n===boundary)process.exit(73);}});throw Error('Fault boundary did not terminate');
}
if(process.argv[2]==='rollback-crash'){
 const root=process.argv[3],boundary=Number(process.argv[4]);D.recoverDeployment({root,identityProvider:identityProvider(root),onRollback:(_file,n)=>{if(n===boundary)process.exit(74);}});throw Error('Rollback fault boundary did not terminate');
}
const temporary=path.join(S.ROOT,'work/deployment-crash-'+Date.now());
function setup(name,{exposure=false,noActive=false}={}){
 const root=path.join(temporary,name,'project/work/repo'),cdir=path.join(root,'run'),prior={...accepted,modelId:'previous-model'},priorAdoption={adopted:true,cycle:0,modelId:prior.modelId},model={...accepted,adoption:{...accepted.adoption}};
 S.atomic(identityFile(root),baseIdentity);for(const html of htmlFiles(root))S.atomic(html,'old artifact');if(!noActive)S.atomic(path.join(root,'src/active-model.json'),prior);
 S.atomic(path.join(cdir,'champion.json'),prior);S.atomic(path.join(cdir,'adoption.json'),priorAdoption);S.atomic(path.join(cdir,'state.json'),{cycle:1,adoptions:[priorAdoption],history:[],counters:{}});S.atomic(path.join(cdir,'adoptions.jsonl'),JSON.stringify(priorAdoption)+'\n');
 if(exposure){const source=path.join(cdir,'temporal-exposures.jsonl');S.atomic(source,'{"id":"position:train:reserved-before-deployment","kind":"position","split":"train"}\n');model.adoption.exposure={runDir:cdir,file:'models/'+model.modelId+'.exposures.jsonl',sha256:S.fileHash(source)};}
 S.atomic(path.join(root,'accepted.json'),model);return root;
}
function crash(root,boundary,mode='crash'){
 const child=cp.spawnSync(process.execPath,[__filename,mode,root,String(boundary)],{encoding:'utf8',windowsHide:true});assert.equal(child.status,mode==='crash'?73:74,child.stderr||child.stdout);return S.read(transactionFile(root));
}
function drift(root,key){S.atomic(identityFile(root),{...baseIdentity,[key]:S.hash('changed-'+key)});}
function recover(root){return D.recoverDeployment({root,identityProvider:identityProvider(root)});}
function assertCommitted(root,{exposure=false}={}){
 const model=S.read(path.join(root,'accepted.json'));assert.deepEqual(S.read(path.join(root,'src/active-model.json')),model);for(const html of htmlFiles(root))assert.equal(fs.readFileSync(html,'utf8'),'synthetic accepted '+model.modelId);
 assert.equal(S.read(path.join(root,'run/champion.json')).modelId,model.modelId);assert.equal(S.read(path.join(root,'run/adoption.json')).adopted,true);assert.equal(S.read(path.join(root,'run/state.json')).adoptions.length,2);assert.equal(fs.readFileSync(path.join(root,'run/adoptions.jsonl'),'utf8').trim().split('\n').length,2);assert.equal(S.read(transactionFile(root)).status,'committed');
 if(exposure)assert.equal(S.fileHash(path.join(root,'run',model.adoption.exposure.file)),model.adoption.exposure.sha256);assert.equal(recover(root),null);
}
// Every active/HTML/champion/model/decision/state/journal publication boundary.
for(let boundary=-1;boundary<=9;boundary++){const root=setup('publish-'+boundary,{noActive:boundary===-1});assert.equal(crash(root,boundary).status,'prepared');recover(root);assertCommitted(root);}
for(const key of identityKeys){
 const root=setup('build-drift-'+key),expected=before(root);assert.throws(()=>D.deploy(S.read(path.join(root,'accepted.json')),{...deployOptions(root),build:arg=>{stagedBuild(arg);drift(root,key);}}),/changed while building/);assertBytes(expected);assert.equal(fs.existsSync(transactionFile(root)),false);
 const pending=setup('recovery-drift-'+key),prior=before(pending);crash(pending,0);drift(pending,key);assert.throws(()=>recover(pending),/engine\/harness\/runtime changed/);assertBytes(prior);assert.equal(S.read(transactionFile(pending)).status,'rolled-back');assert.equal(recover(pending),null);
 const direct=setup('adoption-drift-'+key),directPrior=before(direct);drift(direct,key);assert.throws(()=>D.deploy(S.read(path.join(direct,'accepted.json')),deployOptions(direct)),/differs from deployment execution/);assertBytes(directPrior);
}
{
 const root=setup('source-change-mid-publish'),prior=before(root);assert.throws(()=>D.deploy(S.read(path.join(root,'accepted.json')),{...deployOptions(root),onPublish:(_file,n)=>{if(n===1)drift(root,'sourceHash');}}),/changed after evaluation or staging/);assertBytes(prior);assert.equal(S.read(transactionFile(root)).status,'rolled-back');
}
{
 const root=setup('source-dependency-unavailable'),prior=before(root);crash(root,0);assert.throws(()=>D.recoverDeployment({root,identityProvider:()=>{throw Error('source dependency missing');}}),/execution identity is unavailable/);assertBytes(prior);assert.equal(S.read(transactionFile(root)).status,'rolled-back');
}
// A rollback is durable before its first restore. Every restore can itself crash.
for(let boundary=0;boundary<=10;boundary++){const root=setup('rollback-'+boundary),prior=before(root);crash(root,9);drift(root,'runtimeHash');assert.equal(crash(root,boundary,'rollback-crash').status,'rolling-back');assert.equal(recover(root).rolledBack,true);assertBytes(prior);assert.equal(S.read(transactionFile(root)).status,'rolled-back');assert.equal(recover(root),null);}
{
 const root=setup('damaged-backup'),intent=crash(root,0),published=before(root);fs.appendFileSync(intent.targets[0].backup,'damaged');drift(root,'harnessHash');assert.throws(()=>recover(root),/rollback backup is missing or changed/);assertBytes(published);assert.equal(S.read(transactionFile(root)).status,'prepared');
 const staged=setup('damaged-staging'),prior=before(staged),pending=crash(staged,0);fs.appendFileSync(pending.targets[1].staged,'damaged');assert.throws(()=>recover(staged),/staged bytes are missing or changed/);assertBytes(prior);assert.equal(S.read(transactionFile(staged)).status,'rolled-back');
}
// Accepted exposure provenance is immutable, delivered and rolled back with the model.
for(const boundary of [-1,9,10]){const root=setup('exposure-publish-'+boundary,{exposure:true}),source=path.join(root,'run/temporal-exposures.jsonl'),hash=S.fileHash(source);assert.equal(crash(root,boundary).targets.length,12);recover(root);assertCommitted(root,{exposure:true});assert.equal(S.fileHash(source),hash);}
{
 const root=setup('exposure-rollback',{exposure:true}),prior=before(root,true);crash(root,10);drift(root,'sourceHash');assert.throws(()=>recover(root),/engine\/harness\/runtime changed/);assertBytes(prior);
 const invalid=setup('exposure-changed',{exposure:true}),expected=before(invalid,true);fs.appendFileSync(path.join(invalid,'run/temporal-exposures.jsonl'),'unbound bytes');assert.throws(()=>D.deploy(S.read(path.join(invalid,'accepted.json')),deployOptions(invalid)),/temporal exposure provenance changed/);assertBytes(expected);
}
console.log(JSON.stringify({passed:true,publishBoundaries:11,rollbackBoundaries:11,identityDimensions:identityKeys,acceptedExposureTargets:12,scope:'Abrupt publication/rollback recovery; source/harness/native-runtime drift; verified backup refusal; immutable accepted temporal exposure provenance',artifacts:temporary}));
