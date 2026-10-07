'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),S=require('../tools/learning/state.cjs'),B=require('../tools/learning/storage.cjs');
function context(dir){return {dir,state:{cycle:6,counters:{},adoptions:[{adopted:true,cycle:1}]},settings:{maxDiskBytes:1e8,maxDerivedCycles:2}};}
if(process.argv[2]==='--crash'){const c=context(process.argv[3]),phase=process.argv[4];B.pruneDerived(c,{onPrune:(current,cycle)=>{if(cycle===2&&current===phase)process.exit(73);}});throw Error('Retention crash boundary was not reached');}
const root=path.join(S.ROOT,'work/storage-test-'+Date.now()),checks=[];
function seal(c){const file=path.join(c.dir,'temporal-exposures.jsonl');S.atomic(path.join(c.dir,'temporal-exposures-ready.json'),{schemaVersion:1,rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,sha256:S.fileHash(file)});}
function setup(name){
 const c=context(path.join(root,name));fs.mkdirSync(c.dir,{recursive:true});S.atomic(path.join(c.dir,'dataset.jsonl'),'raw source original\n');S.atomic(path.join(c.dir,'games.jsonl'),'played games original\n');let registry='';
 for(let cycle=1;cycle<=6;cycle++){
  const data=path.join(c.dir,'datasets/cycle-'+cycle+'.jsonl'),row={schemaVersion:1,sampleId:'retention-fixture-'+cycle,rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,familyId:'family-'+cycle,split:'train',positionKey:'position-'+cycle,features:Array(32).fill(0),target:0,weight:1,labelType:'terminal'};S.atomic(data,JSON.stringify(row)+'\n');
  const family=data+'.families.jsonl';S.atomic(family,JSON.stringify({familyId:row.familyId,split:'train',rows:1})+'\n');const manifest={schemaVersion:1,file:path.basename(data),rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,sha256:S.fileHash(data),familyManifest:{file:path.basename(family),sha256:S.fileHash(family)},counts:{train:1,validation:0,test:0}};S.atomic(data+'.manifest.json',manifest);
  const cache=path.join(c.dir,'.train-cache',manifest.sha256.slice(0,24)+'-p4');S.atomic(path.join(cache,'manifest.json'),{datasetHash:manifest.sha256});S.atomic(path.join(cache,'train.f32'),'prepared derivative');
  registry+=JSON.stringify({schemaVersion:1,rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,id:'family:train:'+row.familyId,kind:'family',key:row.familyId,split:'train'})+'\n';
 }
 S.atomic(path.join(c.dir,'temporal-exposures.jsonl'),registry);seal(c);
 const approved=S.read(path.join(c.dir,'datasets/cycle-4.jsonl.manifest.json'));S.atomic(path.join(c.dir,'models/approved.json'),{adoption:{accepted:true},training:{datasetHash:approved.sha256}});return c;
}
function originals(c){return new Map(['dataset.jsonl','games.jsonl','temporal-exposures.jsonl'].map(name=>[path.join(c.dir,name),S.fileHash(path.join(c.dir,name))]));}
function assertOriginals(expected){for(const [file,hash] of expected)assert.equal(S.fileHash(file),hash,file);}
function assertRetained(c){
 for(const cycle of [1,4,5,6]){const data=path.join(c.dir,'datasets/cycle-'+cycle+'.jsonl');assert(fs.existsSync(data));assert(fs.existsSync(data+'.families.jsonl'));assert(fs.existsSync(data+'.manifest.json'));}
 for(const cycle of [2,3]){const data=path.join(c.dir,'datasets/cycle-'+cycle+'.jsonl'),retained=S.read(data+'.manifest.json.retained.json');assert.equal(retained.status,'completed');assert.equal(retained.manifest.file,path.basename(data));for(const suffix of ['','.families.jsonl','.manifest.json'])assert.equal(fs.existsSync(data+suffix),false,data+suffix);assert.equal(fs.existsSync(path.join(c.dir,'.train-cache',retained.manifest.sha256.slice(0,24)+'-p4')),false);}
}
function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
check('preflight stops explicitly and concurrent generation cannot consume held trainer bytes',()=>{
 const c=setup('reservation');c.settings.maxDiskBytes=1024;assert.equal(B.checkBudget(c,2048,'fixture'),false);assert.equal(c.state.stopReason.kind,'disk-budget');assert.throws(()=>B.requireBudget(c,2048,'fixture'),error=>error.code==='DISK_BUDGET');
 c.settings.maxDiskBytes=S.diskBytes(c.dir)+16384;const release=B.reserveTraining(c,8192);assert.equal(B.checkBudget(c,12000,'parallel-generator'),false);assert.equal(B.remainingReservations(c),8192);S.atomic(path.join(c.dir,'candidate.json'),'x'.repeat(4096));assert.equal(B.remainingReservations(c),4096);release();assert.equal(B.remainingReservations(c),0);
});
check('retention preserves raw originals, latest/current/adopted cycles and accepted model dataset provenance',()=>{
 const c=setup('normal'),hashes=originals(c);B.pruneDerived(c);assertOriginals(hashes);assertRetained(c);const count=fs.readFileSync(path.join(c.dir,'retention.jsonl'),'utf8').trim().split('\n').length;assert.equal(B.pruneDerived(c).length,0);assert.equal(fs.readFileSync(path.join(c.dir,'retention.jsonl'),'utf8').trim().split('\n').length,count);
});
check('missing/mismatched temporal seals refuse deletion before any immutable derivative is lost',()=>{
 for(const variant of ['missing-ready','wrong-rules','wrong-feature','wrong-hash','missing-registry','changed-registry']){
  const c=setup(variant),marker=path.join(c.dir,'temporal-exposures-ready.json'),value=S.read(marker),registry=path.join(c.dir,'temporal-exposures.jsonl'),hashes=new Map([1,2,3,4,5,6].map(cycle=>{const file=path.join(c.dir,'datasets/cycle-'+cycle+'.jsonl');return [file,S.fileHash(file)];}));
  if(variant==='missing-ready')fs.unlinkSync(marker);if(variant==='wrong-rules')S.atomic(marker,{...value,rulesId:'foreign-rules'});if(variant==='wrong-feature')S.atomic(marker,{...value,featureVersion:'foreign-feature'});if(variant==='wrong-hash')S.atomic(marker,{...value,sha256:S.hash('foreign')});if(variant==='missing-registry')fs.unlinkSync(registry);if(variant==='changed-registry')fs.appendFileSync(registry,'unsealed bytes');
  if(variant==='missing-ready')assert.deepEqual(B.pruneDerived(c),[]);else assert.throws(()=>B.pruneDerived(c),/temporal exposure registry seal/);assertOriginals(hashes);assert(!fs.readdirSync(path.join(c.dir,'datasets')).some(name=>name.endsWith('.retained.json')));
 }
});
const boundaries=['prepared','data','families','manifest','cache','completed'];
for(const phase of boundaries)check('abrupt exit after '+phase+' resumes the same immutable retention transaction',()=>{
 const c=setup('crash-'+phase),hashes=originals(c),child=cp.spawnSync(process.execPath,[__filename,'--crash',c.dir,phase],{encoding:'utf8',windowsHide:true});assert.equal(child.status,73,child.stderr);B.pruneDerived(context(c.dir));assertRetained(c);assertOriginals(hashes);assert.deepEqual(B.pruneDerived(context(c.dir)),[]);
});
check('legacy interruption after data deletion completes surviving sidecar/manifest/cache cleanup',()=>{
 const c=setup('legacy-partial'),data=path.join(c.dir,'datasets/cycle-2.jsonl'),manifest=S.read(data+'.manifest.json'),hashes=originals(c);S.atomic(data+'.manifest.json.retained.json',{schemaVersion:1,manifest,prunedAt:'legacy-fixture',reason:'legacy interrupted cleanup'});fs.unlinkSync(data);B.pruneDerived(c);assertRetained(c);assertOriginals(hashes);assert.equal(S.read(data+'.manifest.json.retained.json').prunedAt,'legacy-fixture');
});
check('pruning an older copy preserves a prepared cache shared by the current immutable snapshot',()=>{
 const c=setup('shared-current-cache'),old=path.join(c.dir,'datasets/cycle-2.jsonl'),current=path.join(c.dir,'datasets/cycle-6.jsonl'),manifest=S.read(current+'.manifest.json');fs.copyFileSync(old,current);fs.copyFileSync(old+'.families.jsonl',current+'.families.jsonl');manifest.sha256=S.fileHash(current);manifest.familyManifest.sha256=S.fileHash(current+'.families.jsonl');S.atomic(current+'.manifest.json',manifest);B.pruneDerived(c);assert.equal(fs.existsSync(old),false);assert.equal(fs.existsSync(current),true);const name=manifest.sha256.slice(0,24)+'-p4';assert.equal(fs.existsSync(path.join(c.dir,'.train-cache',name)),true);assert.deepEqual(S.read(old+'.manifest.json.retained.json').retainedCaches,[name]);
});
check('tampered pending derivative bytes refuse recovery and preserve the remaining evidence',()=>{
 const c=setup('corrupt-pending'),child=cp.spawnSync(process.execPath,[__filename,'--crash',c.dir,'prepared'],{encoding:'utf8',windowsHide:true});assert.equal(child.status,73,child.stderr);const data=path.join(c.dir,'datasets/cycle-2.jsonl'),family=data+'.families.jsonl';fs.appendFileSync(family,'changed');const hashes=originals(c);hashes.set(data,S.fileHash(data));hashes.set(family,S.fileHash(family));assert.throws(()=>B.pruneDerived(c),/Retained snapshot artifact changed/);assertOriginals(hashes);assert.equal(S.read(data+'.manifest.json.retained.json').status,'prepared');
});
console.log(JSON.stringify({passed:checks.length,retentionCrashBoundaries:boundaries.length,scope:'Verified registry seal; immutable provenance; actual child-process exit and idempotent retention cleanup; trainer reservation preflight is a conservative estimate, not a hard bound on external writers',artifacts:root}));
