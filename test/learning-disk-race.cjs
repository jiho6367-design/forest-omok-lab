'use strict';
// Reproduce the former readdir -> atomic publish -> stat race on real files,
// then exercise current and identity-checked archived budget/resume paths.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),vm=require('node:vm');
const S=require('../tools/learning/state.cjs'),B=require('../tools/learning/storage.cjs'),Archive=require('../tools/learning/archive.cjs'),runner=require('../tools/learning/run.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'omok-disk-race-')),checks=[],counts={legacyFailures:0,injectedRenames:0,stressPublications:0,stressScans:0,stressWriter:null,pipelineStarts:0,cooperativeStops:0,checkpointResumes:0,fatalFailures:0};
// Immutable before-fix fixture: this is deliberately unsafe and never used by
// production. It establishes that the filesystem mutation causes the old error.
const legacyDiskSource="function diskBytes(dir){let total=0;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);total+=e.isDirectory()?diskBytes(f):fs.statSync(f).size;}return total;}";
const legacyDisk=vm.compileFunction(legacyDiskSource+';return diskBytes;',['fs','path'])(fs,path);
const legacyWatchedSource="function watchedBytes(context){let total=0;for(const name of ['.train-cache','checkpoints']){const file=path.join(context.dir,name);if(fs.existsSync(file))total+=S.diskBytes(file);}for(const name of fs.readdirSync(context.dir))if(name.startsWith('candidate.json')||name.startsWith('train.')){const file=path.join(context.dir,name);if(fs.statSync(file).isFile())total+=fs.statSync(file).size;}return total;}";
const legacyWatched=vm.compileFunction(legacyWatchedSource+';return watchedBytes;',['fs','path','S'])(fs,path,S);
function folder(name){const dir=path.join(root,name);fs.mkdirSync(dir,{recursive:true});return dir;}
function context(dir){return {dir,state:{schemaVersion:1,runId:path.basename(dir),cycle:7,counters:{},history:[],errors:[],adoptions:[]},settings:{...S.defaults(),maxDiskBytes:1024**3}};}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
function patch(method,replacement,fn){const original=fs[method];fs[method]=replacement(original);try{return fn();}finally{fs[method]=original;}}
function moveAfterListing(dir,source,target,fn,listingNumber=1){let seen=0,moved=false;return patch('readdirSync',original=>(file,...args)=>{const entries=original(file,...args);if(path.resolve(file)===dir&&++seen===listingNumber){fs.renameSync(source,target);counts.injectedRenames++;moved=true;}return entries;},()=>{const result=fn();assert.equal(moved,true,'race boundary must execute');return result;});}
function missingFileCase(reader,name){const dir=folder(name),stable=path.join(dir,'stable.bin'),tmp=path.join(dir,'cycle-7.pt.tmp'),published=path.join(dir,'cycle-7.pt');fs.writeFileSync(stable,Buffer.alloc(23));fs.writeFileSync(tmp,Buffer.alloc(79));return {dir,published,value:()=>moveAfterListing(dir,tmp,published,()=>reader(dir))};}
function makeOldArchive(){
 const identity=structuredClone(S.sourceIdentity()),files=Object.fromEntries([...identity.sourceManifest,...identity.harnessManifest].map(row=>[row.path,fs.readFileSync(path.join(S.ROOT,row.path),'utf8')]));
 files['tools/learning/state.cjs']=files['tools/learning/state.cjs'].replace(/function diskBytes\(dir\)\{[^\n]*\}/,legacyDiskSource).replaceAll('minutes:null','minutes:60');
 files['tools/learning/storage.cjs']=files['tools/learning/storage.cjs'].replace(/function watchedBytes\(context\)\{[^\n]*\}/,legacyWatchedSource);
 for(const row of identity.harnessManifest)row.sha256=S.hash(files[row.path]);identity.harnessHash=S.hash(identity.harnessManifest);
 const snapshot={schemaVersion:2,identity,files,externalDependencies:[]},file=path.join(root,'old-runtime.json');S.atomic(file,snapshot);
 return {file,snapshot,runtime:Archive.frozenRuntime(file),fileHash:S.fileHash(file)};
}
let archived;
(async()=>{
 await check('former accounting fails deterministically when an atomic publication removes a listed temporary file',()=>{
  const fixture=missingFileCase(legacyDisk,'legacy-file');assert.throws(fixture.value,error=>error.code==='ENOENT');assert.equal(fs.statSync(fixture.published).size,79);counts.legacyFailures++;
  const c=context(folder('legacy-watched')),tmp=path.join(c.dir,'train.family.f32.tmp'),published=path.join(c.dir,'train.family.f32');fs.writeFileSync(tmp,Buffer.alloc(79));
  assert.throws(()=>moveAfterListing(c.dir,tmp,published,()=>legacyWatched(c)),error=>error.code==='ENOENT');counts.legacyFailures++;
 });
 await check('a valid older runtime keeps its preserved identity and receives current operational accounting',()=>{
  archived=makeOldArchive();assert.deepEqual(archived.runtime.load('tools/learning/state.cjs').sourceIdentity(),archived.snapshot.identity);assert.equal(archived.runtime.load('tools/learning/state.cjs').diskBytes,S.diskBytes);
  assert.equal(archived.runtime.executionPolicy.transientMissingFiles,'skip-ENOENT-only');
 });
 for(const [name,state] of [['current',S],['archived',()=>archived.runtime.load('tools/learning/state.cjs')]]){
  await check(name+' file publication survives while surviving bytes and a quiescent total are counted',()=>{
   const api=typeof state==='function'?state():state,fixture=missingFileCase(api.diskBytes,name+'-file');assert.equal(fixture.value(),23);assert.equal(api.diskBytes(fixture.dir),102);
  });
  await check(name+' temporary directory publication survives a stale parent listing',()=>{
   const api=typeof state==='function'?state():state,dir=folder(name+'-directory'),tmp=path.join(dir,'cache.tmp'),published=path.join(dir,'cache');fs.mkdirSync(tmp);fs.writeFileSync(path.join(tmp,'train.f32'),Buffer.alloc(71));fs.writeFileSync(path.join(dir,'stable.bin'),Buffer.alloc(29));
   assert.equal(moveAfterListing(dir,tmp,published,()=>api.diskBytes(dir)),29);assert.equal(api.diskBytes(dir),100);
  });
  await check(name+' inaccessible or damaged files remain fatal instead of being treated as missing',()=>{
   const api=typeof state==='function'?state():state,dir=folder(name+'-failures'),file=path.join(dir,'checkpoint.pt');fs.writeFileSync(file,'preserved evidence');
   for(const code of ['EACCES','EIO']){const injected=Object.assign(Error('injected '+code),{code,path:file});patch('statSync',original=>(target,...args)=>{if(path.resolve(target)===file)throw injected;return original(target,...args);},()=>assert.throws(()=>api.diskBytes(dir),error=>error===injected));}
   const injected=Object.assign(Error('injected unreadable directory'),{code:'EACCES'});patch('readdirSync',original=>(target,...args)=>{if(path.resolve(target)===dir)throw injected;return original(target,...args);},()=>assert.throws(()=>api.diskBytes(dir),error=>error===injected));assert.equal(fs.readFileSync(file,'utf8'),'preserved evidence');
  });
 }
 for(const [name,budget] of [['current',B],['archived',()=>archived.runtime.load('tools/learning/storage.cjs')]]){
  await check(name+' held trainer reservation survives root-level temp publication and still enforces the disk limit',()=>{
   const api=typeof budget==='function'?budget():budget,c=context(folder(name+'-budget')),checkpoint=path.join(c.dir,'checkpoints/cycle-7.pt');S.atomic(checkpoint,'good checkpoint');const release=api.reserveTraining(c,8192),tmp=path.join(c.dir,'train.family.f32.tmp'),published=path.join(c.dir,'train.family.f32');fs.writeFileSync(tmp,Buffer.alloc(512));
   try{moveAfterListing(c.dir,tmp,published,()=>api.requireBudget(c,1024,'parallel-generator'),2);assert.equal(api.remainingReservations(c),8192-512);assert.equal(c.state.disk.heldBytes,8192);
    c.settings.maxDiskBytes=S.diskBytes(c.dir)+api.remainingReservations(c)+4096;assert.throws(()=>api.requireBudget(c,8192,'too-large-write'),error=>error.code==='DISK_BUDGET');assert.equal(c.state.stopReason.kind,'disk-budget');assert.equal(fs.readFileSync(checkpoint,'utf8'),'good checkpoint');
    for(const code of ['EACCES','EIO']){const injected=Object.assign(Error('injected '+code),{code});patch('statSync',original=>(target,...args)=>{if(path.resolve(target)===published)throw injected;return original(target,...args);},()=>assert.throws(()=>api.requireBudget(c,0,'read-failure'),error=>error===injected));}
   }finally{release();}assert.equal(api.remainingReservations(c),0);
  });
 }
 await check('concurrent child writer publishes binary cache and checkpoints while both budget paths scan',async()=>{
  const dir=folder('writer-stress'),c=context(dir),other=context(dir),oldBudget=archived.runtime.load('tools/learning/storage.cjs'),release=B.reserveTraining(c,1024**2),releaseOld=oldBudget.reserveTraining(other,1024**2),publications=2000;
  const requestedPython=process.env.OMOK_TEST_PYTHON;if(requestedPython&&!fs.existsSync(requestedPython))throw Error('OMOK_TEST_PYTHON must name an existing Python runtime');const python=process.argv.includes('--node-writer')?null:requestedPython||(fs.existsSync(S.defaults().python)?S.defaults().python:null);counts.stressWriter=python?'python':'node';
  const script="import os,sys\nfrom pathlib import Path\nroot=Path(sys.argv[1]);count=int(sys.argv[2])\nfor folder,name,size in [(root/'.train-cache'/'synthetic-p4','train.family.f32',512),(root/'checkpoints','cycle-7.pt',1536)]: folder.mkdir(parents=True,exist_ok=True)\nfor i in range(count):\n folder,name,size=[(root/'.train-cache'/'synthetic-p4','train.family.f32',512),(root/'checkpoints','cycle-7.pt',1536)][i%2]\n target=folder/name;tmp=Path(str(target)+'.tmp')\n with open(tmp,'wb') as writer:\n  writer.write(bytes([i%256])*size);writer.flush();os.fsync(writer.fileno())\n os.replace(tmp,target)\nprint(count,flush=True)\n";
  const nodeScript="const fs=require('node:fs'),path=require('node:path'),root=process.argv[1],count=Number(process.argv[2]),targets=[[path.join(root,'.train-cache/synthetic-p4'),'train.family.f32',512],[path.join(root,'checkpoints'),'cycle-7.pt',1536]];for(const [dir] of targets)fs.mkdirSync(dir,{recursive:true});for(let i=0;i<count;i++){const [dir,name,size]=targets[i%2],target=path.join(dir,name),tmp=target+'.tmp',fd=fs.openSync(tmp,'w');try{fs.writeFileSync(fd,Buffer.alloc(size,i%256));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,target);}console.log(count);";
  const child=cp.spawn(python||process.execPath,python?['-c',script,dir,String(publications)]:['-e',nodeScript,dir,String(publications)],{windowsHide:true,stdio:['ignore','pipe','pipe']});let done=false,code=null,stdout='',stderr='',spawnError;child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);const ended=new Promise(resolve=>{child.once('error',error=>{spawnError=error;done=true;resolve();});child.once('close',value=>{code=value;done=true;resolve();});});const started=Date.now();
  try{while(!done){B.requireBudget(c,1024,'concurrent-current');oldBudget.requireBudget(other,1024,'concurrent-archived');counts.stressScans+=2;assert(Date.now()-started<30000,'bounded writer stress deadline');await new Promise(resolve=>setImmediate(resolve));}await ended;assert.ifError(spawnError);assert.equal(code,0,stderr);assert.equal(Number(stdout.trim()),publications);counts.stressPublications=publications;assert(counts.stressScans>0);assert.equal(fs.statSync(path.join(dir,'.train-cache/synthetic-p4/train.family.f32')).size,512);assert.equal(fs.statSync(path.join(dir,'checkpoints/cycle-7.pt')).size,1536);assert.equal(S.diskBytes(dir),archived.runtime.load('tools/learning/state.cjs').diskBytes(dir));}
  finally{if(!done){child.kill();await ended;}release();releaseOld();}
 });
 await check('three simulated backend cycles persist partial checkpoints, stop cooperatively, and resume through the public command path',async()=>{
  const dir=path.join(root,'pipeline'),T=require('../tools/learning/trial-ledger.cjs'),D=require('../tools/learning/deployment.cjs'),originalCapture=Archive.captureRuntime,originalReconcile=T.reconcile,originalRecover=D.recoverDeployment;
  // Arena/global migration and runtime capture are separate contracts. Keeping
  // them inert isolates this command-path fixture entirely in the OS temp root.
  Archive.captureRuntime=()=>({testFixture:true});T.reconcile=()=>{};D.recoverDeployment=()=>{};
  const argv=['cycle','--run='+dir,'--fresh-model','--continuous','--concurrent-training=false','--workers=1','--device=cpu','--games-per-cycle=2','--min-new-samples=1'];
  const hooks={analyze:async()=>true,generate:async(c,options)=>{c.state.counters.generatedGames=options.target;c.state.counters.completedGames=options.target;c.state.counters.samples+=4;return true;},
   train:async c=>{const file=path.join(c.dir,'checkpoints/cycle-'+c.state.cycle+'.pt'),prior=S.read(file),updates=(prior?.updates||0)+1;S.atomic(file,{fixture:'simulated-backend-only',cycle:c.state.cycle,updates});
    if(!prior){await runner.main(['stop','--run='+c.dir]);counts.cooperativeStops++;return false;}assert.equal(prior.updates,1);counts.checkpointResumes++;S.atomic(path.join(c.dir,'candidate.json'),{fixture:'simulated-backend-only',cycle:c.state.cycle,updates});c.state.lastTrainingSampleCount=c.state.counters.samples;return true;},
   validate:async()=>({complete:true,passed:false}),adopt:async c=>{await runner.main(['stop','--run='+c.dir]);counts.cooperativeStops++;return {adopted:false};}};
  try{for(let cycle=1;cycle<=3;cycle++){await runner.main(cycle===1?argv:[...argv,'--resume'],hooks);counts.pipelineStarts++;let saved=S.read(path.join(dir,'state.json'));assert.equal(saved.status,'stopped');assert.equal(saved.pipeline.stage,'train');assert.equal(saved.cycle,cycle);assert.equal(saved.lastRun.complete,false);assert.equal(fs.existsSync(path.join(dir,'runner.lock')),false);
    await runner.main([...argv,'--resume'],hooks);counts.pipelineStarts++;saved=S.read(path.join(dir,'state.json'));assert.equal(saved.status,'stopped');assert.equal(saved.pipeline.stage,'cycle-end');assert.equal(saved.cycle,cycle);assert.equal(saved.errors.length,0);assert.equal(S.read(path.join(dir,'checkpoints/cycle-'+cycle+'.pt')).updates,2);assert.equal(fs.existsSync(path.join(dir,'runner.lock')),false);}
   assert.equal(S.read(path.join(dir,'state.json')).counters.generatedGames,6);const unlock=S.lock(dir);try{assert.throws(()=>S.lock(dir),/already executing/);}finally{unlock();}
   const checkpoint=path.join(dir,'checkpoints/cycle-3.pt'),hash=S.fileHash(checkpoint),injected=Object.assign(Error('injected fatal checkpoint I/O failure'),{code:'EIO'});
   await assert.rejects(()=>runner.main([...argv,'--resume'],{...hooks,generate:async c=>{await runner.main(['stop','--run='+c.dir]);throw injected;}}),error=>error===injected);counts.fatalFailures++;const failed=S.read(path.join(dir,'state.json'));assert.equal(failed.status,'failed');assert.equal(failed.errors.at(-1).error,injected.message);assert.match(fs.readFileSync(path.join(dir,'errors.jsonl'),'utf8'),/fatal checkpoint I\/O failure/);assert.equal(S.fileHash(checkpoint),hash);assert.equal(fs.existsSync(path.join(dir,'runner.lock')),false);
  }finally{Archive.captureRuntime=originalCapture;T.reconcile=originalReconcile;D.recoverDeployment=originalRecover;}
 });
 assert.equal(S.fileHash(archived.file),archived.fileHash,'policy must not rewrite the archived source');
 assert.deepEqual(archived.runtime.load('tools/learning/state.cjs').sourceIdentity(),archived.snapshot.identity);
 const result={passed:checks.length,...counts,artifacts:root,scope:'Real atomic rename race and narrow ENOENT handling; current and identity-checked old storage budgets; bounded atomic writer stress; six public-command starts with simulated backend hooks; real optimizer checkpoint correctness is covered by test_train.py CPU contracts. This is not a long self-play or real GPU soak test.'};S.atomic(path.join(root,'result.json'),result);console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
