'use strict';
// Resume known historical runs with the exact preserved code. Never rewrite
// an old run's identity to pretend a new algorithm produced its old results.
// Whole-run scheduling and transient file accounting are host operational policy.
// They are applied after immutable source identity verification, without changing
// archived files, game logic, checkpoints, evaluation or delivery checks.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process'),threads=require('node:worker_threads');
const {builtinModules}=require('node:module'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),SNAPSHOT=path.join(ROOT,'work/continuous-runtime-baseline.json');
const COMPATIBILITY_DIRECTORY=path.join(ROOT,'work/operational-compatibility-receipts');
const operationalScopes={
 'tools/learning/state.cjs':'whole-run scheduling and transient filesystem accounting',
 'tools/learning/run.cjs':'whole-run scheduling and historical resume dispatch',
 'tools/learning/archive.cjs':'host operational overrides and audited delivery compatibility',
 'tools/learning/storage.cjs':'transient filesystem accounting and recoverable retention policy',
 'tools/learning/run-retention.cjs':'recoverable experiment retention',
 'tools/learning/deployment.cjs':'audited operational compatibility during interrupted delivery recovery'
};
const identityKeys=['sourceHash','harnessHash','runtimeHash'];
const digest=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const identityBinding=identity=>Object.fromEntries(identityKeys.map(key=>[key,identity?.[key]]));
function canonicalIdentity(identity){
 if(identity?.version!==2||!identity.runtimeManifest||typeof identity.runtimeManifest!=='object')throw Error('Operational compatibility requires canonical version 2 identities');
 for(const name of ['sourceManifest','harnessManifest']){
  const rows=identity[name];if(!Array.isArray(rows)||!rows.length)throw Error('Operational compatibility manifest is missing');let previous='';
  for(const row of rows){if(!row||Object.keys(row).sort().join(',')!=='path,sha256'||typeof row.path!=='string'||!row.path||row.path<=previous||row.path.includes('\\')||row.path.startsWith('/')||row.path.split('/').some(part=>part==='.'||part==='..'||!part)||!/^[a-f0-9]{64}$/.test(row.sha256||''))throw Error('Operational compatibility manifest is not canonical');previous=row.path;}
 }
 if(identity.sourceHash!==digest(identity.sourceManifest)||identity.harnessHash!==digest(identity.harnessManifest)||identity.runtimeHash!==digest(identity.runtimeManifest))throw Error('Operational compatibility identity hashes do not bind their manifests');
 return identity;
}
function operationalChanges(before,after){
 canonicalIdentity(before);canonicalIdentity(after);
 if(before.sourceHash!==after.sourceHash||digest(before.sourceManifest)!==digest(after.sourceManifest)||before.runtimeHash!==after.runtimeHash||digest(before.runtimeManifest)!==digest(after.runtimeManifest))throw Error('Operational compatibility cannot change engine source or native runtime');
 const a=new Map(before.harnessManifest.map(row=>[row.path,row.sha256])),b=new Map(after.harnessManifest.map(row=>[row.path,row.sha256]));
 const changed=[...new Set([...a.keys(),...b.keys()])].sort().filter(file=>a.get(file)!==b.get(file)).map(file=>({path:file,beforeSha256:a.get(file)||null,afterSha256:b.get(file)||null,scope:operationalScopes[file]}));
 if(!changed.length)throw Error('Operational compatibility receipt requires an explicitly reviewed operational change');
 for(const row of changed)if(!row.scope||!row.afterSha256||!row.beforeSha256&&row.path!=='tools/learning/run-retention.cjs')throw Error('Operational compatibility cannot change algorithm dependencies: '+row.path);
 return changed;
}
function compatibilityId(before,after){return digest([identityBinding(before),identityBinding(after)]);}
function validateOperationalReceipt(receipt,before,after){
 const expected=operationalChanges(before,after),payload=receipt&&{schemaVersion:receipt.schemaVersion,kind:receipt.kind,receiptId:receipt.receiptId,createdAt:receipt.createdAt,reason:receipt.reason,fromIdentity:receipt.fromIdentity,toIdentity:receipt.toIdentity,changes:receipt.changes};
 if(receipt?.schemaVersion!==1||receipt.kind!=='forest-omok-reviewed-operational-compatibility'||receipt.receiptId!==compatibilityId(before,after)||typeof receipt.createdAt!=='string'||!Number.isFinite(Date.parse(receipt.createdAt))||typeof receipt.reason!=='string'||!receipt.reason.trim()||receipt.payloadSha256!==digest(payload)||digest(receipt.fromIdentity)!==digest(before)||digest(receipt.toIdentity)!==digest(after)||digest(receipt.changes)!==digest(expected))throw Error('Operational compatibility receipt is missing, changed or does not bind this exact reviewed update');
 return receipt;
}
function registerOperationalCompatibility({beforeIdentity,afterIdentity=require('./state.cjs').sourceIdentity(),changes,reason},{directory=COMPATIBILITY_DIRECTORY}={}){
 const expected=operationalChanges(beforeIdentity,afterIdentity);
 if(digest(afterIdentity)!==digest(require('./state.cjs').sourceIdentity()))throw Error('Operational compatibility registration must review the exact current host identity');
 if(digest(changes)!==digest(expected)||typeof reason!=='string'||!reason.trim())throw Error('Every operational compatibility change must be explicitly reviewed with its exact before and after SHA-256 and approved scope');
 const receiptId=compatibilityId(beforeIdentity,afterIdentity),file=path.join(directory,receiptId+'.json');
 if(fs.existsSync(file)){const receipt=JSON.parse(fs.readFileSync(file,'utf8'));validateOperationalReceipt(receipt,beforeIdentity,afterIdentity);return {receiptId,file,receipt};}
 const payload={schemaVersion:1,kind:'forest-omok-reviewed-operational-compatibility',receiptId,createdAt:new Date().toISOString(),reason,fromIdentity:beforeIdentity,toIdentity:afterIdentity,changes};
 const receipt={...payload,payloadSha256:digest(payload)};require('./state.cjs').atomic(file,receipt);return {receiptId,file,receipt};
}
function assertDeliverySource(snapshot,{identityProvider=()=>require('./state.cjs').sourceIdentity(),receiptDirectory=COMPATIBILITY_DIRECTORY}={}){
 const now=identityProvider(),before=snapshot?.identity;
 if(before?.version===2){try{canonicalIdentity(before);canonicalIdentity(now);}catch(error){throw Error('The production engine changed: operational compatibility verification failed: '+error.message);}}
 if(before&&now.sourceHash===before.sourceHash&&(!(before.version>=2)||now.harnessHash===before.harnessHash&&now.runtimeHash===before.runtimeHash))return null;
 if(before?.version===2&&before.sourceHash===now.sourceHash&&before.runtimeHash===now.runtimeHash){
  try{const file=path.join(receiptDirectory,compatibilityId(before,now)+'.json');if(fs.existsSync(file)){const receipt=validateOperationalReceipt(JSON.parse(fs.readFileSync(file,'utf8')),before,now);return {receiptId:receipt.receiptId,receiptFile:path.relative(ROOT,file).split(path.sep).join('/'),receiptSha256:digest(fs.readFileSync(file,'utf8')),evaluationIdentity:identityBinding(before),deliveryIdentity:identityBinding(now),changes:receipt.changes};}}
  catch(error){throw Error('The production engine changed: operational compatibility verification failed: '+error.message);}
 }
 throw Error('The production engine changed: archived evaluation cannot publish a model into a different engine or runtime without an exact reviewed operational compatibility receipt. Continue experience in a new run and evaluate again.');
}
function wrapDeliveryPolicy(snapshot,deployment,{identityProvider=()=>require('./state.cjs').sourceIdentity(),receiptDirectory=COMPATIBILITY_DIRECTORY}={}){
 const check=()=>assertDeliverySource(snapshot,{identityProvider,receiptDirectory}),bind=provider=>()=>{check();const preserved=provider?provider():snapshot.identity;if(identityKeys.some(key=>preserved?.[key]!==snapshot.identity?.[key]))throw Error('Operational compatibility cannot substitute evaluation identity');return preserved;},deploy=deployment.deploy,recover=deployment.recoverDeployment;
 deployment.deploy=(accepted,options={})=>{const audit=check();if(identityKeys.some(key=>accepted.adoption?.[key]!==snapshot.identity?.[key]))throw Error('Operational compatibility cannot substitute accepted evaluation identity');if(audit){accepted={...accepted,adoption:{...accepted.adoption,operationalCompatibilityAudit:audit}};options={...options,entry:options.entry?{...options.entry,operationalCompatibilityAudit:audit}:options.entry};}return deploy(accepted,{...options,identityProvider:bind(options.identityProvider)});};
 deployment.recoverDeployment=(options={})=>recover({...options,identityProvider:bind(options.identityProvider)});
 return deployment;
}
function recoveryExecutionIdentity(intent,{root=ROOT,identityProvider=()=>require('./state.cjs').sourceIdentity(),receiptDirectory=COMPATIBILITY_DIRECTORY}={}){
 const now=identityProvider();if(identityKeys.every(key=>intent.identity?.[key]===now[key]))return now;
 const modelTarget=intent.targets?.find(row=>row.file===path.join(root,'src/active-model.json'));
 if(!modelTarget||!/^[a-f0-9]{64}$/.test(modelTarget.sha256||''))throw Error('Interrupted operational deployment lacks verified staged model bytes');const modelBytes=fs.readFileSync(modelTarget.staged);if(digest(modelBytes)!==modelTarget.sha256)throw Error('Interrupted operational deployment lacks verified staged model bytes');
 const accepted=JSON.parse(modelBytes.toString('utf8')),audit=accepted.adoption?.operationalCompatibilityAudit;
 if(accepted.adoption?.accepted!==true||!audit||identityKeys.some(key=>accepted.adoption[key]!==intent.identity?.[key]||audit.evaluationIdentity?.[key]!==intent.identity?.[key]||audit.deliveryIdentity?.[key]!==now[key])||!/^[a-f0-9]{64}$/.test(audit.receiptId||''))throw Error('Interrupted operational deployment lacks an exact evaluation/delivery audit binding');
 const file=path.join(receiptDirectory,audit.receiptId+'.json'),receipt=JSON.parse(fs.readFileSync(file,'utf8'));
 const checked=assertDeliverySource({identity:receipt.fromIdentity},{identityProvider,receiptDirectory});
 if(!checked||digest(checked)!==digest(audit))throw Error('Interrupted operational deployment audit or receipt changed');
 return intent.identity;
}
function wrapArchivedStartupPolicy(runner,stateModule){
 // New captures already own their creation/retention gate. Older immutable code
 // gets an early runner lock inside the host gate, without editing its source.
 if(typeof runner.waitForRetentionGate==='function'&&typeof runner.directRunRetentionRoot==='function')return runner;
 const host=require('./run.cjs'),retention=require('./run-retention.cjs'),main=runner.main,init=stateModule.init,lock=stateModule.lock;
 const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;let activeCall=null;
 stateModule.init=(...args)=>{
  const dir=stateModule.resolveRun(args[0]),call=activeCall;if(!call||!same(dir,call.dir))return init(...args);
  const initialize=lease=>{
   let entry;try{entry=fs.lstatSync(dir);}catch(error){if(error.code!=='ENOENT')throw error;}if(entry?.isSymbolicLink())throw Error('This experiment is a preserved dependency alias. Restore it as a retained experiment before resuming; its immutable continuation state must remain unchanged.');
   const context=init(...args),rawRelease=lock(context.dir),owned={claimed:false,released:false,releaseRequested:false,release(){owned.releaseRequested=true;},releaseNow(){if(!owned.released){rawRelease();owned.released=true;}}};call.context=context;call.owned=owned;
   if(call.args['from-run']){context.state.pendingContinuationSource=stateModule.resolveRun(call.args['from-run']);stateModule.save(context);}
   const source=call.args['from-run']&&stateModule.resolveRun(call.args['from-run']),protectedIds=source&&host.directRunRetentionRoot(source,call.hooks.retentionRunsRoot)?[path.basename(source)]:[];
   const result=retention.enforceRetention(call.root,{lease,repo:ROOT,protectedIds});context.state.runRetention=host.retentionMessage('start',result);stateModule.save(context);console.log(JSON.stringify(context.state.runRetention));return context;
  };
  return retention.withRetentionLock(call.root,initialize);
 };
 stateModule.lock=dir=>{const call=activeCall,owned=call?.owned;if(call&&same(path.resolve(dir),call.dir)&&owned&&!owned.claimed&&!owned.released){owned.claimed=true;return owned.release;}return lock(dir);};
 runner.main=async(argv=process.argv.slice(2),hooks={})=>{
  const args=runner.parse(argv),dir=stateModule.resolveRun(args.run),root=host.directRunRetentionRoot(dir,hooks.retentionRunsRoot);
  if(!root||['help','--help','status','stop'].includes(args.command))return main(argv,hooks);
  if(activeCall)throw Error('This archived runner is already executing in this process');
  const waitMs=hooks.retentionWaitMs??30000;if(!Number.isSafeInteger(waitMs)||waitMs<0||waitMs>30000)throw Error('Invalid retention gate wait budget');
  const clock=require('node:perf_hooks').performance,started=clock.now(),call={args,dir,root,hooks,context:null,owned:null};activeCall=call;
  try{
   fs.mkdirSync(root,{recursive:true});
   for(;;){
    // No asynchronous work starts inside a maintenance callback. Synchronous
    // init reacquires the gate for all first writes and the early runner lock.
    await host.waitForRetentionGate(root,()=>{},Math.max(0,Math.ceil(waitMs-(clock.now()-started))));
    try{return await main(argv,hooks);}catch(error){if(error.code!=='RUN_RETENTION_BUSY'||call.context||clock.now()-started>=waitMs)throw error;await new Promise(resolve=>setTimeout(resolve,100));}
   }
  }finally{
   if(call.context){
    try{const continuation=stateModule.read(path.join(dir,'continuation.json'));if(call.context.state.pendingContinuationSource&&continuation?.complete===true){delete call.context.state.pendingContinuationSource;stateModule.save(call.context);}}catch(error){console.error(JSON.stringify({runRetention:'deferred-source-pin',run:dir,error:error.message,scope:'Original learning result and checkpoints are preserved'}));}
   }
   try{call.owned?.releaseNow();}finally{activeCall=null;}
   if(call.context){
    try{console.log(JSON.stringify(host.retentionMessage('finish',retention.enforceRetention(root,{repo:ROOT}))));}catch(error){console.error(JSON.stringify({runRetention:'deferred',error:error.message,code:error.code||null,run:dir,scope:'Original learning result and checkpoints are preserved; retry recoverable retention at the next lifecycle boundary'}));}
   }
  }
 };
 return runner;
}
function archiveId(identity){return crypto.createHash('sha256').update(JSON.stringify([identity.sourceHash,identity.harnessHash,identity.runtimeHash||null])).digest('hex');}
function captureRuntime(identity=require('./state.cjs').sourceIdentity()){
 if(identity.version!==2||!Array.isArray(identity.sourceManifest)||!Array.isArray(identity.harnessManifest))throw Error('Full runtime capture requires canonical dependency manifests');
 const S=require('./state.cjs'),id=archiveId(identity),file=path.join(ROOT,'work/runtime-archives',id+'.json'),files={};for(const row of [...identity.sourceManifest,...identity.harnessManifest]){const source=fs.readFileSync(path.join(ROOT,row.path),'utf8');if(S.hash(source)!==row.sha256)throw Error('Runtime dependency changed during capture: '+row.path);files[row.path]=source;}
 const prior=S.read(file);if(prior){if(prior.identity?.sourceHash!==identity.sourceHash||prior.identity?.harnessHash!==identity.harnessHash||prior.identity?.runtimeHash!==identity.runtimeHash||S.hash(prior.files)!==S.hash(files))throw Error('Existing preserved runtime conflicts with its immutable identity');return {archiveId:id,file};}
 S.atomic(file,{schemaVersion:2,archiveId:id,createdAt:new Date().toISOString(),identity,externalDependencies:[],files});return {archiveId:id,file};
}
function selectResumeRunner(run,{repo=ROOT}={}){
 run=path.resolve(run);let runEntry;try{runEntry=fs.lstatSync(run);}catch(error){if(error.code!=='ENOENT')throw error;}if(runEntry?.isSymbolicLink())throw Error('This experiment is a preserved dependency alias. Restore it as a retained experiment before resuming; its immutable continuation state must remain unchanged.');
 repo=path.resolve(repo);const S=require(path.join(repo,'tools/learning/state.cjs')),state=S.read(path.join(run,'state.json')),normal={runner:path.join(repo,'tools/learning/run.cjs'),argsPrefix:[],cwd:repo};if(!state)return normal;
 const now=S.sourceIdentity();if(state.identity?.version>=2&&state.identity.runtimeHash!==now.runtimeHash)throw Error('The preserved native Node/V8/SQLite runtime differs from this host. Continue experience in a new run and evaluate again.');if(state.identity?.sourceHash===now.sourceHash&&state.identity?.harnessHash===now.harnessHash&&(!(state.identity?.version>=2)||state.identity.runtimeHash===now.runtimeHash))return normal;
 if(state.identity?.version>=2){const id=archiveId(state.identity),saved=S.read(path.join(repo,'work/runtime-archives',id+'.json'));if(saved&&saved.identity.sourceHash===state.identity.sourceHash&&saved.identity.harnessHash===state.identity.harnessHash&&saved.identity.runtimeHash===state.identity.runtimeHash)return {runner:path.join(repo,'tools/learning/archive.cjs'),argsPrefix:['--archived-run','--runtime='+id],snapshotFile:path.join(repo,'work/runtime-archives',id+'.json'),cwd:repo};}
 const file=path.join(repo,'work/continuous-runtime-baseline.json'),snapshot=S.read(file);if(snapshot&&state.identity?.sourceHash===snapshot.identity.sourceHash&&state.identity?.harnessHash===snapshot.identity.harnessHash)return {runner:path.join(repo,'tools/learning/archive.cjs'),argsPrefix:['--archived-run'],snapshotFile:file,cwd:repo};
 const archived=state.identity?.harnessHash;if(/^[a-f0-9]{64}$/.test(archived||'')){const saved=S.read(path.join(repo,'work/runtime-archives',archived+'.json'));if(saved&&saved.identity.sourceHash===state.identity.sourceHash&&saved.identity.harnessHash===archived)return {runner:path.join(repo,'tools/learning/archive.cjs'),argsPrefix:['--archived-run','--runtime='+archived],snapshotFile:path.join(repo,'work/runtime-archives',archived+'.json'),cwd:repo};}
 throw Error('이 실험의 실행 버전을 찾을 수 없습니다. 저장된 경험을 새 누적 실험으로 이어 주세요.');
}
function applyExecutionPolicy(stateModule,storageModule){
 const init=stateModule.init,defaults=stateModule.defaults,save=stateModule.save;
 stateModule.save=context=>{if(context.state.status==='stopped'&&/^(?:이번 실행 시간을 마쳤습니다\.|Time\/resource budget reached)/.test(context.state.message||''))context.state.message='현재 작업을 저장했습니다. 경험을 계속 누적하려면 같은 실험을 재개하세요.';return save(context);};
 stateModule.defaults=()=>({...defaults(),minutes:Infinity});
 stateModule.init=(...args)=>{const context=init(...args);context.settings.minutes=Infinity;context.state.executionPolicy={wholeRunTimeLimit:'none',archivedRuntime:true,storageAccounting:'host-budgeting-ENOENT-only',stageMinutes:context.settings.stageMinutes,trainSeconds:context.settings.trainSeconds};return context;};
 stateModule.diskBytes=require('./state.cjs').diskBytes;
 // Keep snapshot retirement and gameplay frozen; use the host's narrow fix for
 // budget reads and one shared reservation map while trainers rename temp files.
 if(storageModule){const current=require('./storage.cjs');for(const key of ['checkBudget','requireBudget','reserveTraining','remainingReservations'])storageModule[key]=current[key];}
 return {wholeRunTimeLimit:'none',archivedRuntime:true,storageAccounting:'host-budgeting-ENOENT-only',transientMissingFiles:'skip-ENOENT-only'};
}
function frozenRuntime(snapshotFile=SNAPSHOT){
 const snapshot=JSON.parse(fs.readFileSync(snapshotFile,'utf8')),sources=snapshot.files,cache=new Map(),relative=file=>path.relative(ROOT,path.resolve(file)).split(path.sep).join('/');
 if(snapshot.identity?.version>=2&&snapshot.identity.runtimeHash!==require('./state.cjs').sourceIdentity().runtimeHash)throw Error('Preserved native runtime mismatch; continue experience in a new run');
 const inside=key=>key!== '..'&&!key.startsWith('../')&&!path.isAbsolute(key),code=key=>inside(key)&&(key==='build.cjs'||/^(?:src|tools\/learning)\/.*\.(?:js|cjs|py|html)$/.test(key)||/^test\/reader\/game(?:29|31|33|47|48|95)\.cjs$/.test(key));
 if(!sources||typeof sources!=='object'||Array.isArray(sources))throw Error('Archived runtime files are missing');
 const mandatory=['src/node-engine.cjs','build.cjs','src/neural-app.js'];for(const name of mandatory)if(typeof sources[name]!=='string')throw Error('Archived repository dependency missing: '+name);
 for(const row of [...(snapshot.identity?.sourceManifest||[]),...(snapshot.identity?.harnessManifest||[])])if(typeof sources[row.path]!=='string'||crypto.createHash('sha256').update(sources[row.path]).digest('hex')!==row.sha256)throw Error('Archived dependency manifest mismatch: '+row.path);
 const manifested=new Set([...(snapshot.identity?.sourceManifest||[]),...(snapshot.identity?.harnessManifest||[])].map(row=>row.path));
 const requireSource=key=>{if(!inside(key)||typeof sources[key]!=='string'||snapshot.identity?.version>=2&&!manifested.has(key))throw Error('Archived repository dependency missing from files or canonical manifest: '+key);return sources[key];},virtualFds=new Map();let nextFd=-100000;
 const sourceKey=file=>typeof file==='string'?relative(file):file instanceof URL&&file.protocol==='file:'?relative(require('node:url').fileURLToPath(file)):null;
 const frozenFs={...fs,existsSync(file){const key=sourceKey(file);if(key&&Object.hasOwn(sources,key))return true;if(key&&code(key))requireSource(key);return fs.existsSync(file);},readFileSync(file,options){const key=sourceKey(file);if(key&&(Object.hasOwn(sources,key)||code(key))){const bytes=Buffer.from(requireSource(key));return typeof options==='string'||options?.encoding?bytes.toString(typeof options==='string'?options:options.encoding):bytes;}return fs.readFileSync(file,options);},openSync(file,flags,...args){const key=sourceKey(file);if(key&&(Object.hasOwn(sources,key)||code(key))){if(flags!=='r')throw Error('Archived repository dependencies are immutable: '+key);const fd=nextFd--;virtualFds.set(fd,{bytes:Buffer.from(requireSource(key)),cursor:0});return fd;}return fs.openSync(file,flags,...args);},readSync(fd,buffer,offset,length,position){const row=virtualFds.get(fd);if(!row)return fs.readSync(fd,buffer,offset,length,position);const start=position==null?row.cursor:position,n=row.bytes.copy(buffer,offset,start,Math.min(row.bytes.length,start+length));if(position==null)row.cursor+=n;return n;},closeSync(fd){if(virtualFds.has(fd)){virtualFds.delete(fd);return;}return fs.closeSync(fd);}};
 const frozenCp={...cp,execFileSync(command,args,options){if(args?.[0]===path.join(ROOT,'build.cjs'))assertDeliverySource(snapshot);return cp.execFileSync(command,args,options);},spawn(command,args,options){if(args?.[0]===path.join(ROOT,'tools/learning/train.py')){const target=path.join(ROOT,'work/archived-trainer-'+snapshot.identity.harnessHash+'.py'),source=sources['tools/learning/train.py'];if(fs.existsSync(target)){if(fs.readFileSync(target,'utf8')!==source)throw Error('Archived trainer content changed');}else fs.writeFileSync(target,source);args=[target,...args.slice(1)];}return cp.spawn(command,args,options);}};
 class ArchivedWorker extends threads.Worker{constructor(file,options={}){const key=sourceKey(file);if(key&&inside(key)){requireSource(key);super(__filename,{...options,workerData:{archivedWorkerModule:key,snapshotFile,original:options.workerData}});}else throw Error('Archived worker dependency is outside its preserved repository');}}
 const frozenThreads={...threads,Worker:ArchivedWorker,workerData:threads.workerData?.archivedWorkerModule?threads.workerData.original:threads.workerData};
 function load(key){key=relative(path.join(ROOT,key));if(cache.has(key))return cache.get(key).exports;requireSource(key);const module={exports:{}};cache.set(key,module);const filename=path.join(ROOT,key),directory=path.dirname(filename);
  const localRequire=id=>{if(id==='node:fs'||id==='fs')return frozenFs;if(id==='node:child_process'||id==='child_process')return frozenCp;if(id==='node:worker_threads'||id==='worker_threads')return frozenThreads;if(id.startsWith('.')||path.isAbsolute(id)){let name=relative(path.resolve(directory,id));if(!Object.hasOwn(sources,name))for(const suffix of ['.js','.cjs','.json','/index.js','/index.cjs'])if(Object.hasOwn(sources,name+suffix)){name+=suffix;break;}return load(name);}if(!builtinModules.includes(id)&&!builtinModules.includes(id.replace(/^node:/,'')))throw Error('Archived external dependency is not allowlisted (only native Node built-ins are allowed): '+id);return require(id);};
  if(key.endsWith('.json'))module.exports=JSON.parse(sources[key]);else vm.compileFunction(sources[key],['module','exports','require','__filename','__dirname'],{filename})(module,module.exports,localRequire,filename,directory);return module.exports;
 }
 const identity=load('tools/learning/state.cjs').sourceIdentity();if(identity.sourceHash!==snapshot.identity.sourceHash||identity.harnessHash!==snapshot.identity.harnessHash||snapshot.identity.version>=2&&identity.runtimeHash!==snapshot.identity.runtimeHash)throw Error('Preserved runtime identity mismatch');const executionPolicy=applyExecutionPolicy(load('tools/learning/state.cjs'),Object.hasOwn(sources,'tools/learning/storage.cjs')?load('tools/learning/storage.cjs'):null);if(Object.hasOwn(sources,'tools/learning/deployment.cjs'))wrapDeliveryPolicy(snapshot,load('tools/learning/deployment.cjs'));let startupWrapped=false;const operationalLoad=key=>{const exports=load(key);if(relative(path.join(ROOT,key))==='tools/learning/run.cjs'&&!startupWrapped){startupWrapped=true;wrapArchivedStartupPolicy(exports,load('tools/learning/state.cjs'));}return exports;};return {snapshot,load:operationalLoad,executionPolicy};
}
if(!threads.isMainThread&&threads.workerData?.archivedWorkerModule)frozenRuntime(threads.workerData.snapshotFile).load(threads.workerData.archivedWorkerModule);
else if(require.main===module){if(process.argv[2]!=='--archived-run')throw Error('Archive runner requires a trusted archived-run selection');const args=process.argv.slice(3);let snapshotFile=SNAPSHOT;if(args[0]?.startsWith('--runtime=')){const id=args.shift().slice(10);if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid archived runtime identity');snapshotFile=path.join(ROOT,'work/runtime-archives',id+'.json');}const runtime=frozenRuntime(snapshotFile);console.log(JSON.stringify({archive:'execution-policy',...runtime.executionPolicy,preservedIdentity:runtime.snapshot.identity.harnessHash}));runtime.load('tools/learning/run.cjs').main(args).catch(error=>{console.error(error.stack||error);process.exitCode=1;});}
module.exports={selectResumeRunner,frozenRuntime,assertDeliverySource,archiveId,captureRuntime,applyExecutionPolicy};

Object.assign(module.exports,{operationalScopes,operationalChanges,registerOperationalCompatibility,validateOperationalReceipt,wrapDeliveryPolicy,recoveryExecutionIdentity});

Object.assign(module.exports,{wrapArchivedStartupPolicy});
