'use strict';
const fs=require('node:fs'),path=require('node:path'),S=require('./state.cjs');
const reservations=new WeakMap();
function watchedBytes(context){let total=0;for(const name of ['.train-cache','checkpoints']){const file=path.join(context.dir,name);if(fs.existsSync(file))total+=S.diskBytes(file);}for(const name of fs.readdirSync(context.dir))if(name.startsWith('candidate.json')||name.startsWith('train.')){const file=path.join(context.dir,name);try{const stat=fs.statSync(file);if(stat.isFile())total+=stat.size;}catch(error){if(error.code!=='ENOENT')throw error;}}return total;}
function remainingReservations(context){return (reservations.get(context)||[]).reduce((sum,row)=>sum+Math.max(0,row.bytes-Math.max(0,watchedBytes(context)-row.baseline)),0);}
function reserveTraining(context,bytes){requireBudget(context,bytes,'trainer-reservation');const row={stage:'trainer',bytes,baseline:watchedBytes(context)},rows=reservations.get(context)||[];rows.push(row);reservations.set(context,rows);context.state.storageReservations=rows.map(({stage,bytes})=>({stage,bytes}));S.save(context);return ()=>{reservations.set(context,rows.filter(value=>value!==row));context.state.storageReservations=(reservations.get(context)||[]).map(({stage,bytes})=>({stage,bytes}));S.save(context);};}
function checkBudget(context,reserveBytes=0,stage='write'){
 if(!Number.isFinite(reserveBytes)||reserveBytes<0)throw Error('Invalid storage reservation');
 const used=S.diskBytes(context.dir),limit=context.settings.maxDiskBytes??Infinity;let available=Infinity;try{const v=fs.statfsSync(context.dir);available=v.bavail*v.bsize;}catch(error){if(error.code!=='ENOSYS')throw error;}
 const heldBytes=remainingReservations(context);
 context.state.disk={usedBytes:used,reservedBytes:Math.ceil(reserveBytes),heldBytes,limitBytes:limit,availableBytes:available,stage,checkedAt:new Date().toISOString()};
 if(used+heldBytes+reserveBytes>limit||heldBytes+reserveBytes>available){const message='저장 공간 예산으로 중단했습니다 ('+stage+'). 사용 '+used+' bytes, 병렬 작업 예약 '+heldBytes+' bytes, 다음 저장 예약 '+Math.ceil(reserveBytes)+' bytes, 한도 '+limit+' bytes. 원본 자료를 보존했습니다.';context.state.stopReason={kind:'disk-budget',stage,message,...context.state.disk};context.state.message=message;S.save(context);return false;}return true;
}
function requireBudget(context,reserveBytes,stage){if(!checkBudget(context,reserveBytes,stage))throw Object.assign(Error(context.state.stopReason.message),{code:'DISK_BUDGET'});}
function verifyExposureSeal(context){
 const marker=S.read(path.join(context.dir,'temporal-exposures-ready.json'));if(!marker)return false;const registry=path.join(context.dir,'temporal-exposures.jsonl'),actual=fs.existsSync(registry)?S.fileHash(registry):null;
 if(marker.schemaVersion!==1||marker.rulesId!==S.RULES_ID||marker.featureVersion!==S.FEATURE_VERSION||marker.sha256!==actual)throw Error('Retention requires a valid immutable temporal exposure registry seal; source derivatives preserved');return actual!==null;
}
function cacheNames(context,sha256){const dir=path.join(context.dir,'.train-cache');return fs.existsSync(dir)?fs.readdirSync(dir).filter(name=>/^[a-f0-9]{24}-p\d+$/.test(name)&&name.startsWith(sha256.slice(0,24)+'-p')):[];}
function checkedCache(context,name){if(!/^[a-f0-9]{24}-p\d+$/.test(name))throw Error('Invalid retained cache name');const root=path.join(context.dir,'.train-cache'),file=path.resolve(root,name);if(path.dirname(file)!==root)throw Error('Retention cache left run storage');if(fs.existsSync(file)){const rel=path.relative(fs.realpathSync(root),fs.realpathSync(file));if(rel===''||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Prepared cache left run');}return file;}
function manifestIdentity(manifest,dataName){if(!manifest||manifest.rulesId!==S.RULES_ID||manifest.featureVersion!==S.FEATURE_VERSION||!/^[a-f0-9]{64}$/.test(manifest.sha256||'')||manifest.file!==dataName)throw Error('Retention snapshot manifest identity changed; preserve derivatives');}
function prepareRetention(context,file,prior=null){
 const manifestName=path.basename(file),match=/^cycle-(\d+)\.jsonl\.manifest\.json$/.exec(manifestName);if(!match)throw Error('Invalid retention manifest name');const dataName=manifestName.slice(0,-14),manifest=prior?.manifest||S.read(file);manifestIdentity(manifest,dataName);
 if(fs.existsSync(file)&&S.hash(S.read(file))!==S.hash(manifest))throw Error('Retained snapshot manifest changed');
 const data=path.join(path.dirname(file),dataName),family=data+'.families.jsonl';if(fs.existsSync(data)&&S.fileHash(data)!==manifest.sha256)throw Error('Retention snapshot data changed; preserve derivatives');
 if(fs.existsSync(family)&&(!manifest.familyManifest||manifest.familyManifest.file!==path.basename(family)||S.fileHash(family)!==manifest.familyManifest.sha256))throw Error('Retention family manifest changed or has no immutable hash; preserve derivatives');
 const artifacts=[{name:dataName,sha256:manifest.sha256,bytes:fs.existsSync(data)?fs.statSync(data).size:0},{name:path.basename(family),sha256:manifest.familyManifest?.sha256||null,bytes:fs.existsSync(family)?fs.statSync(family).size:0},{name:manifestName,sha256:fs.existsSync(file)?S.fileHash(file):null,bytes:fs.existsSync(file)?fs.statSync(file).size:0}],caches=cacheNames(context,manifest.sha256);for(const name of caches)checkedCache(context,name);
 return {...prior,schemaVersion:2,status:'prepared',transactionId:S.hash([manifestName,manifest.sha256]),cycle:Number(match[1]),manifest,artifacts,caches,prunedAt:prior?.prunedAt||new Date().toISOString(),reason:'bounded derived retention; raw source and immutable manifest preserved'};
}
function completeRetention(context,retainedFile,intent,onPrune,protectedCacheHashes){
 const dir=path.join(context.dir,'datasets'),expected='cycle-'+intent.cycle+'.jsonl';manifestIdentity(intent.manifest,expected);
 if(intent.schemaVersion!==2||intent.status!=='prepared'||path.basename(retainedFile)!==expected+'.manifest.json.retained.json'||intent.transactionId!==S.hash([expected+'.manifest.json',intent.manifest.sha256])||!Array.isArray(intent.artifacts)||intent.artifacts.length!==3||!Array.isArray(intent.caches))throw Error('Invalid retained snapshot cleanup intent');
 const expectedNames=[expected,expected+'.families.jsonl',expected+'.manifest.json'];
 for(const [n,row] of intent.artifacts.entries()){if(row.name!==expectedNames[n]||row.sha256!==null&&!/^[a-f0-9]{64}$/.test(row.sha256||''))throw Error('Invalid retained snapshot artifact identity');const file=path.resolve(dir,row.name);if(path.dirname(file)!==dir)throw Error('Retention target left datasets');if(fs.existsSync(file)&&(!row.sha256||S.fileHash(file)!==row.sha256))throw Error('Retained snapshot artifact changed; preserve it for investigation');}
 for(const name of intent.caches){if(!name.startsWith(intent.manifest.sha256.slice(0,24)+'-p'))throw Error('Retained cache belongs to another dataset');checkedCache(context,name);}
 const removed=[];
 for(const [n,row] of intent.artifacts.entries()){const file=path.join(dir,row.name);if(fs.existsSync(file)){removed.push({file:row.name,bytes:fs.statSync(file).size});fs.unlinkSync(file);S.syncDirectory(dir);}onPrune(['data','families','manifest'][n],intent.cycle,n);}
 intent.retainedCaches=[];for(const [n,name] of intent.caches.entries()){const file=checkedCache(context,name);if(protectedCacheHashes.has(intent.manifest.sha256))intent.retainedCaches.push(name);else if(fs.existsSync(file)){removed.push({file:'.train-cache/'+name,bytes:S.diskBytes(file)});fs.rmSync(file,{recursive:true});S.syncDirectory(path.dirname(file));}onPrune('cache',intent.cycle,n);}
 intent.status='completed';intent.completedAt=new Date().toISOString();S.atomic(retainedFile,intent);onPrune('completed',intent.cycle,0);S.append(path.join(context.dir,'retention.jsonl'),{at:intent.completedAt,transactionId:intent.transactionId,cycle:intent.cycle,artifacts:intent.artifacts,caches:intent.caches,scope:'Idempotent cleanup; bytes already removed before a crash are represented by immutable retained metadata'});return removed;
}
function pruneDerived(context,{onPrune=()=>{}}={}){
 if(!verifyExposureSeal(context))return [];const keep=context.settings.maxDerivedCycles??3,dir=path.join(context.dir,'datasets');if(!fs.existsSync(dir))return [];
 const protectedCycles=new Set([context.state.cycle]);for(const adoption of context.state.adoptions||[])if(adoption.adopted)protectedCycles.add(adoption.cycle);const champion=S.read(path.join(context.dir,'champion.json')),modelDatasets=new Set([champion?.training?.datasetHash]),models=path.join(context.dir,'models');if(fs.existsSync(models))for(const name of fs.readdirSync(models).filter(n=>n.endsWith('.json'))){const model=S.read(path.join(models,name));if(model?.adoption?.accepted)modelDatasets.add(model.training?.datasetHash);}
 const manifests=fs.readdirSync(dir).filter(name=>/^cycle-\d+\.jsonl\.manifest\.json$/.test(name)).map(name=>({file:path.join(dir,name),cycle:Number(name.match(/cycle-(\d+)/)[1])})).sort((a,b)=>b.cycle-a.cycle);for(const row of manifests.slice(0,keep))protectedCycles.add(row.cycle);
 const protectedCacheHashes=new Set(modelDatasets);for(const row of manifests)if(protectedCycles.has(row.cycle))protectedCacheHashes.add(S.read(row.file).sha256);
 const removed=[];for(const name of fs.readdirSync(dir).filter(name=>/^cycle-\d+\.jsonl\.manifest\.json\.retained\.json$/.test(name))){
  const retainedFile=path.join(dir,name),prior=S.read(retainedFile);if(prior.schemaVersion===2&&prior.status==='completed')continue;const cycle=Number(name.match(/cycle-(\d+)/)[1]);if(protectedCycles.has(cycle)||modelDatasets.has(prior.manifest?.sha256))throw Error('Pending retention cleanup became protected; preserve it for investigation');
  const intent=prior.schemaVersion===2?prior:prepareRetention(context,retainedFile.slice(0,-14),prior);if(prior.schemaVersion!==2)S.atomic(retainedFile,intent);removed.push(...completeRetention(context,retainedFile,intent,onPrune,protectedCacheHashes));
 }
 for(const row of manifests){if(protectedCycles.has(row.cycle)||!fs.existsSync(row.file))continue;const manifest=S.read(row.file);if(modelDatasets.has(manifest.sha256))continue;const retainedFile=row.file+'.retained.json';if(fs.existsSync(retainedFile))continue;const intent=prepareRetention(context,row.file);S.atomic(retainedFile,intent);onPrune('prepared',row.cycle,0);removed.push(...completeRetention(context,retainedFile,intent,onPrune,protectedCacheHashes));}
 return removed;
}
// The replay pool is mutable experience, unlike published training snapshots.
// This policy lives outside scientific settings so archived evaluations keep
// their exact identity. Only the coordinator at a quiescent boundary may apply it.
const DEFAULT_POLICY={schemaVersion:1,enabled:true,maxReplaySamples:500000,maxReplayBytes:1024**3,maxDerivedCycles:3};
function storagePolicy(context){
 const policy=S.read(path.join(context.dir,'storage-policy.json'));if(!policy)return null;
 if(policy.schemaVersion!==1||typeof policy.enabled!=='boolean'||!Number.isSafeInteger(policy.maxReplaySamples)||policy.maxReplaySamples<1||policy.maxReplaySamples>5000000||!Number.isSafeInteger(policy.maxReplayBytes)||policy.maxReplayBytes<1024||!Number.isSafeInteger(policy.maxDerivedCycles)||policy.maxDerivedCycles<1)throw Error('Invalid bounded experience storage policy; preserve data');return policy;
}
function configureStorage(context,{enable=false}={}){
 let policy=storagePolicy(context);if(!policy&&enable){policy={...DEFAULT_POLICY,createdAt:new Date().toISOString()};S.atomic(path.join(context.dir,'storage-policy.json'),policy);}return policy;
}
function ownedBoundary(context){
 const root=path.resolve(context.dir),real=fs.realpathSync(root),inside=base=>{const relative=path.relative(path.resolve(base),real);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};if(root!==real||![path.join(S.ROOT,'work'),path.join(S.ROOT,'outputs'),require('node:os').tmpdir()].some(inside))throw Error('Retention requires real project or temporary run storage');
 const lock=S.read(path.join(context.dir,'runner.lock'));if(lock?.pid!==process.pid)throw Error('Experience retention requires the coordinator runner lock');
 if(context.state.concurrency?.training||context.state.trainingProcess?.pid&&isAlive(context.state.trainingProcess.pid)||context.state.storageReservations?.length||fs.existsSync(path.join(context.dir,'generation-intent.json')))throw Error('Experience retention requires an idle training/generation boundary');
}
function isAlive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
function localFile(context,name){
 if(path.basename(name)!==name)throw Error('Retention target left run storage');const file=path.resolve(context.dir,name);
 if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('Retention refuses linked storage files');return file;
}
function recordRetention(context,row){
 const file=path.join(context.dir,'experience-retention.jsonl'),prior=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split('\n').slice(-99):[];
 if(!prior.some(line=>JSON.parse(line).transactionId===row.transactionId))S.atomic(file,[...prior,JSON.stringify(row)].join('\n')+'\n');
 context.state.experienceRetention={...context.state.experienceRetention,lastCleanupAt:row.at,lastAction:row.kind,freedBytes:(context.state.experienceRetention?.freedBytes||0)+(context.state.experienceRetention?.lastTransactionId===row.transactionId?0:row.freedBytes),lastTransactionId:row.transactionId,...(row.kind==='replay-pool'?{retainedSamples:row.retainedSamples,retainedBytes:row.afterBytes,cumulativeSamples:row.cumulativeSamples}:{}),policy:storagePolicy(context)};S.atomic(localFile(context,'experience-retention.json'),context.state.experienceRetention);S.save(context);
}
function resumeReplayRetention(context,{onBoundary=()=>{}}={}){
 const intentFile=localFile(context,'replay-retention-intent.json'),intent=S.read(intentFile);if(!intent)return null;ownedBoundary(context);
 if(intent.schemaVersion!==1||intent.kind!=='replay-pool'||intent.transactionId!==S.hash([intent.beforeSha256,intent.afterSha256,intent.cumulativeSamples])||!/^dataset\.jsonl\.retain-[a-f0-9]{24}$/.test(intent.temporary||'')||![intent.beforeSha256,intent.afterSha256].every(value=>/^[a-f0-9]{64}$/.test(value||''))||![intent.beforeBytes,intent.afterBytes,intent.retainedSamples,intent.cumulativeSamples].every(value=>Number.isSafeInteger(value)&&value>=0)||intent.afterBytes>intent.beforeBytes)throw Error('Invalid replay retention intent; preserve data');
 const file=localFile(context,'dataset.jsonl'),temporary=localFile(context,intent.temporary),actual=S.fileHash(file);
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(localFile(context,'journal.sqlite'));
 try{
  const cursor=db.prepare("SELECT * FROM cursors WHERE file='dataset.jsonl'").get();if(!cursor||cursor.n!==intent.cumulativeSamples||![intent.beforeBytes,intent.afterBytes].includes(cursor.offset)||actual===intent.beforeSha256&&cursor.offset!==intent.beforeBytes)throw Error('Replay retention journal changed; preserve data');
  if(actual!==intent.afterSha256){if(actual!==intent.beforeSha256||fs.statSync(file).size!==intent.beforeBytes||!fs.existsSync(temporary)||S.fileHash(temporary)!==intent.afterSha256||fs.statSync(temporary).size!==intent.afterBytes)throw Error('Replay retention source changed; preserve data');fs.renameSync(temporary,file);S.syncDirectory(context.dir);}
  if(fs.statSync(file).size!==intent.afterBytes)throw Error('Replay retention byte count changed');onBoundary('replaced');db.prepare("UPDATE cursors SET offset=? WHERE file='dataset.jsonl'").run(intent.afterBytes);
 }finally{db.close();}
 onBoundary('indexed');recordRetention(context,{...intent,at:intent.at,freedBytes:intent.beforeBytes-intent.afterBytes});onBoundary('recorded');
 if(fs.existsSync(temporary)){if(S.fileHash(temporary)!==intent.afterSha256)throw Error('Replay retention temporary changed');fs.unlinkSync(temporary);}fs.unlinkSync(intentFile);S.syncDirectory(context.dir);return intent;
}
function boundReplay(context,{onBoundary=()=>{}}={}){
 const policy=storagePolicy(context);if(!policy?.enabled)return null;ownedBoundary(context);
 // Pending evaluations and generation/training are never maintenance windows.
 if(!['cycle-end','analyze'].includes(context.state.pipeline?.stage))return null;
 if(fs.existsSync(localFile(context,'replay-retention-intent.json')))return resumeReplayRetention(context,{onBoundary});
 const file=localFile(context,'dataset.jsonl');if(!fs.existsSync(file))return null;
 // Scan delimiters, not targets or final-test features. The ring is <=4 MiB
 // for the default 500k rows; source and destination use 64 KiB buffers.
 const beforeBytes=fs.statSync(file).size,ring=new Float64Array(policy.maxReplaySamples+1),buffer=Buffer.alloc(65536),fd=fs.openSync(file,'r');let count=0,position=0,last=0,byteStart=0;
 try{for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;for(let i=0;i<n;i++)if(buffer[i]===10){last=position+i+1;ring[count++%ring.length]=last;if(last<=beforeBytes-policy.maxReplayBytes)byteStart=last;}position+=n;}}finally{fs.closeSync(fd);}
 if(last!==beforeBytes)throw Error('Replay retention refuses an uncommitted JSONL tail');
 const countStart=count>policy.maxReplaySamples?ring[(count-policy.maxReplaySamples-1)%ring.length]:0;
 // A byte limit must start on the NEXT row boundary after its threshold.
 let start=Math.max(countStart,byteStart);if(beforeBytes-start>policy.maxReplayBytes){const input=fs.openSync(file,'r');try{let offset=start;outer:for(;;){const n=fs.readSync(input,buffer,0,buffer.length,offset);if(!n)throw Error('Replay row exceeds byte retention budget');for(let i=0;i<n;i++)if(buffer[i]===10){start=offset+i+1;break outer;}offset+=n;}}finally{fs.closeSync(input);}}
 if(!start){context.state.experienceRetention={...context.state.experienceRetention,retainedSamples:count,retainedBytes:beforeBytes,cumulativeSamples:context.state.counters.samples,policy};S.atomic(localFile(context,'experience-retention.json'),context.state.experienceRetention);S.save(context);return null;}
 if(start===beforeBytes)throw Error('Replay pool cannot retain a complete row within its byte budget');
 requireBudget(context,beforeBytes-start+65536,'replay-retention-staging');
 const beforeSha256=S.fileHash(file),temporary='dataset.jsonl.retain-'+S.hash([beforeSha256,start]).slice(0,24),target=localFile(context,temporary),input=fs.openSync(file,'r'),output=fs.openSync(target,'w');let offset=start,retainedSamples=0;
 try{for(;;){const n=fs.readSync(input,buffer,0,buffer.length,offset);if(!n)break;for(let i=0;i<n;i++)if(buffer[i]===10)retainedSamples++;fs.writeFileSync(output,buffer.subarray(0,n));offset+=n;}fs.fsyncSync(output);}finally{fs.closeSync(input);fs.closeSync(output);}
 if(S.fileHash(file)!==beforeSha256)throw Error('Replay source changed while preparing retention');
 const afterSha256=S.fileHash(target),intent={schemaVersion:1,kind:'replay-pool',transactionId:S.hash([beforeSha256,afterSha256,context.state.counters.samples]),at:new Date().toISOString(),cycle:context.state.cycle,beforeSha256,afterSha256,beforeBytes,afterBytes:fs.statSync(target).size,retainedSamples,cumulativeSamples:context.state.counters.samples,temporary,policy,scope:'Old replay rows retired; cumulative ID journal, played games, immutable snapshots, exposure and adoption evidence preserved'};
 S.atomic(localFile(context,'replay-retention-intent.json'),intent);onBoundary('prepared');return resumeReplayRetention(context,{onBoundary});
}
function compactImportedIndex(context){
 if(!storagePolicy(context)?.enabled)return null;ownedBoundary(context);const continuation=S.read(localFile(context,'continuation.json')),file=localFile(context,'continuation.sqlite');
 if(!continuation?.complete||!fs.existsSync(file))return null;
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(file);let result;
 try{
  const names=['positions','games','aliases','recovery_positions'],present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
  const marker=localFile(context,'import-index-retention.json'),prior=S.read(marker);if(!names.some(name=>present.has(name))&&!prior?.pending)return null;
  if(!present.has('families'))throw Error('Completed import has no preserved family split index');
  const familyHash=()=>{const hash=require('node:crypto').createHash('sha256');for(const row of db.prepare('SELECT id,split FROM families ORDER BY id').iterate())hash.update(JSON.stringify(row)+'\n');return hash.digest('hex');};
  const beforeBytes=fs.statSync(file).size+(fs.existsSync(file+'-wal')?fs.statSync(file+'-wal').size:0),familiesSha256=familyHash();if(prior?.pending&&prior.familiesSha256!==familiesSha256)throw Error('Pending import index retention changed family splits');
  requireBudget(context,beforeBytes+65536,'import-index-vacuum');const intent=prior?.pending?prior:{schemaVersion:1,pending:true,transactionId:S.hash(['import-index',continuation.sourceId,familiesSha256]),at:new Date().toISOString(),kind:'import-index',beforeBytes,familiesSha256,sourceId:continuation.sourceId};S.atomic(marker,intent);
  db.exec('BEGIN');try{for(const name of names)db.exec('DROP TABLE IF EXISTS '+name);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');if(familyHash()!==familiesSha256)throw Error('Import index retention changed family splits');
  result={...intent,pending:false,afterBytes:fs.statSync(file).size,freedBytes:Math.max(0,intent.beforeBytes-fs.statSync(file).size),scope:'Completed import validation indexes retired; exact family split lookup and source manifest retained'};S.atomic(marker,result);
 }finally{db.close();}recordRetention(context,result);return result;
}
function pruneUnusedDerived(context){
 const policy=storagePolicy(context);if(!policy?.enabled)return [];ownedBoundary(context);
 const cycles=new Set([context.state.cycle]),hashes=new Set(),dir=path.join(context.dir,'datasets'),models=path.join(context.dir,'models');
 for(const adoption of context.state.adoptions||[])if(adoption.adopted)cycles.add(adoption.cycle);
 for(const model of [S.read(path.join(context.dir,'champion.json')),...(fs.existsSync(models)?fs.readdirSync(models).filter(name=>name.endsWith('.json')).map(name=>S.read(path.join(models,name))):[])])if(model?.adoption?.accepted)hashes.add(model.training?.datasetHash);
 const manifests=fs.existsSync(dir)?fs.readdirSync(dir).filter(name=>/^cycle-\d+\.jsonl\.manifest\.json$/.test(name)).map(name=>({cycle:Number(name.match(/cycle-(\d+)/)[1]),manifest:S.read(path.join(dir,name))})).sort((a,b)=>b.cycle-a.cycle):[];
 for(const row of manifests.slice(0,policy.maxDerivedCycles))cycles.add(row.cycle);
 for(const row of manifests)if(cycles.has(row.cycle)||hashes.has(row.manifest?.sha256)){cycles.add(row.cycle);hashes.add(row.manifest?.sha256);}
 // Current/pending training artifacts remain protected even on startup.
 hashes.add(context.state.dataset?.sha256);hashes.add(S.read(path.join(context.dir,'candidate.json'))?.training?.datasetHash);
 const removed=[],cacheRoot=path.join(context.dir,'.train-cache');
 const noLinks=file=>{if(fs.lstatSync(file).isSymbolicLink())throw Error('Derived retention refuses linked artifacts');if(fs.statSync(file).isDirectory())for(const name of fs.readdirSync(file))noLinks(path.join(file,name));};
 if(fs.existsSync(cacheRoot)){
  if(fs.lstatSync(cacheRoot).isSymbolicLink())throw Error('Derived cache root is linked');
  for(const name of fs.readdirSync(cacheRoot).filter(name=>/^[a-f0-9]{24}-p\d+$/.test(name))){const file=checkedCache(context,name),manifest=S.read(path.join(file,'manifest.json'));if(!manifest||manifest.rulesId!==S.RULES_ID||manifest.featureVersion!==S.FEATURE_VERSION||!/^[a-f0-9]{64}$/.test(manifest.datasetHash||'')||!name.startsWith(manifest.datasetHash.slice(0,24)+'-p')||hashes.has(manifest.datasetHash))continue;noLinks(file);const bytes=S.diskBytes(file);fs.rmSync(file,{recursive:true});removed.push({file:'.train-cache/'+name,bytes});}
 }
 const checkpoints=path.join(context.dir,'checkpoints');if(fs.existsSync(checkpoints)){
  if(fs.lstatSync(checkpoints).isSymbolicLink())throw Error('Checkpoint root is linked');const names=fs.readdirSync(checkpoints).filter(name=>/^cycle-\d+\.pt$/.test(name)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));for(const name of names.slice(0,policy.maxDerivedCycles))cycles.add(Number(name.match(/\d+/)[0]));
  for(const name of names)if(!cycles.has(Number(name.match(/\d+/)[0]))){const file=path.join(checkpoints,name);noLinks(file);const bytes=fs.statSync(file).size;fs.unlinkSync(file);removed.push({file:'checkpoints/'+name,bytes});}
 }
 if(removed.length)recordRetention(context,{kind:'unused-derived',transactionId:S.hash(removed),at:new Date().toISOString(),freedBytes:removed.reduce((sum,row)=>sum+row.bytes,0),removed,scope:'Rebuildable unused caches and old non-adopted optimizer checkpoints; current/recent/adopted snapshots and verification proof preserved'});return removed;
}
function maintainExperience(context,{closeJournal=()=>require('./journal.cjs').close(context.dir),closeCorpus=()=>require('./corpus.cjs').close(context.dir),onBoundary=()=>{}}={}){
 if(!storagePolicy(context)?.enabled&&!fs.existsSync(path.join(context.dir,'replay-retention-intent.json')))return [];
 // Startup can contain a crashed generation intent or transient trainer state.
 // Let the original coordinator recover it first; maintenance never blocks that.
 if(!fs.existsSync(path.join(context.dir,'replay-retention-intent.json'))&&(context.state.concurrency?.training||context.state.trainingProcess?.pid&&isAlive(context.state.trainingProcess.pid)||context.state.storageReservations?.length||fs.existsSync(path.join(context.dir,'generation-intent.json'))))return [];
 ownedBoundary(context);closeJournal();closeCorpus();const results=[];
 const recovered=resumeReplayRetention(context,{onBoundary});if(recovered)results.push(recovered);
 const imported=compactImportedIndex(context);if(imported)results.push(imported);
 const replay=boundReplay(context,{onBoundary});if(replay)results.push(replay);results.push(...pruneUnusedDerived(context));checkBudget(context,0,'retention-complete');S.save(context);return results;
}
module.exports={checkBudget,requireBudget,reserveTraining,remainingReservations,pruneDerived,DEFAULT_POLICY,storagePolicy,configureStorage,maintainExperience,resumeReplayRetention,boundReplay,compactImportedIndex,pruneUnusedDerived};
