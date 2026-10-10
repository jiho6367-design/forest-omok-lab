'use strict';
// Raw experience stays append-only. This index and the bounded learning subset
// are derived artifacts; final-test features/targets are never inspected here.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const S=require('./state.cjs'),R=require('./replay.cjs'),M=require('./metrics.cjs');
const {performance}=require('node:perf_hooks');
const splits=['train','validation','test'],priority={train:0,validation:1,test:2};
function resolveAlias(id,lookup){
 const seen=new Set();let current=id;
 for(let depth=0;depth<256;depth++){
  if(seen.has(current))throw Error('Family alias cycle: '+current);seen.add(current);
  const next=lookup(current);if(!next||next===current)return current;current=next;
 }
 throw Error('Family alias chain exceeds256 links');
}
async function* sourceLines(source){
 let pending=Buffer.alloc(0),offset=0;
 for await(const chunk of fs.createReadStream(source)){
  pending=Buffer.concat([pending,chunk]);let start=0,end;
  while((end=pending.indexOf(10,start))>=0){if(end-start>1024*1024)throw Error('A dataset row exceeds the supported1MiB streaming bound; raw experience is preserved');yield {text:pending.toString('utf8',start,end),offset:offset+start,length:end-start+1};start=end+1;}
  offset+=start;pending=pending.subarray(start);
  if(pending.length>1024*1024)throw Error('A dataset row exceeds the supported1MiB streaming bound; raw experience is preserved');
 }
 if(pending.length)yield {text:pending.toString('utf8'),offset,length:pending.length};
}
function positionKey(row){return row.positionKey||(row.position?R.positionKey(row.position.board,row.position.p,row.position.firstPlayer):null);}
function quotas(counts,maximum){
 const total=splits.reduce((n,s)=>n+counts[s],0),cap=Math.min(maximum,total),out=Object.fromEntries(splits.map(s=>[s,0]));
 const available=splits.filter(s=>counts[s]);
 // Reserve independent holdouts before proportional allocation. Very small
 // explicit caps still reserve one row per available split when possible.
 for(const s of available){if(Object.values(out).reduce((a,b)=>a+b,0)<cap)out[s]=1;}
 if(cap>=available.reduce((n,s)=>n+Math.min(counts[s],s==='test'?1:2),0))for(const s of available)out[s]=Math.min(counts[s],s==='test'?1:2);
 while(Object.values(out).reduce((a,b)=>a+b,0)<cap){
  const left=cap-Object.values(out).reduce((a,b)=>a+b,0),room=available.filter(s=>out[s]<counts[s]),mass=room.reduce((n,s)=>n+counts[s]-out[s],0);
  let added=0;
  for(const s of room){const n=Math.min(counts[s]-out[s],Math.floor(left*(counts[s]-out[s])/mass));out[s]+=n;added+=n;}
  if(!added){room.sort((a,b)=>(counts[b]-out[b])-(counts[a]-out[a])||splits.indexOf(a)-splits.indexOf(b));out[room[0]]++;}
 }
 return out;
}
function rename(temporary,file){for(let attempt=0;;attempt++){try{fs.renameSync(temporary,file);return;}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=11)throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.min(100,10*(attempt+1)));}}}
function durableJson(file,value){S.atomic(file,value);}
const exposureName='temporal-exposures.jsonl';
function exposure(kind,key,split){return {schemaVersion:1,rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,id:kind+':'+split+':'+key,kind,key,split};}
function verifyExposure(row){if(row.schemaVersion!==1||row.rulesId!==S.RULES_ID||row.featureVersion!==S.FEATURE_VERSION||!['position','family'].includes(row.kind)||typeof row.key!=='string'||!row.key||row.key.length>256||!splits.includes(row.split)||row.id!==row.kind+':'+row.split+':'+row.key)throw Error('Invalid temporal exposure identity');return row;}
async function appendExposures(dir,rows,context=null){const J=require('./journal.cjs');let batch=[];for await(const row of rows){batch.push(verifyExposure(row));if(batch.length>=512){J.appendRows(dir,exposureName,batch,'id',context);batch=[];}}if(batch.length)J.appendRows(dir,exposureName,batch,'id',context);}
function snapshotFiles(dir){
 const datasets=path.join(dir,'datasets');if(!fs.existsSync(datasets))return [];const names=fs.readdirSync(datasets),retired=names.filter(n=>n.endsWith('.jsonl.manifest.json.retained.json'));
 if(retired.length&&!S.read(path.join(dir,'temporal-exposures-ready.json')))throw Error('Retired snapshot has no temporal exposure registry');
 for(const n of retired){const relative=path.relative(fs.realpathSync(dir),fs.realpathSync(path.join(datasets,n)));if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw Error('Historical snapshot leaves its run directory');}
 return names.filter(n=>n.endsWith('.jsonl.manifest.json')&&!names.includes(n+'.retained.json')).sort().map(n=>{const file=path.join(datasets,n.slice(0,-'.manifest.json'.length));for(const target of [file,file+'.manifest.json'])if(fs.existsSync(target)){const relative=path.relative(fs.realpathSync(dir),fs.realpathSync(target));if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative))throw Error('Historical snapshot leaves its run directory');}return file;});
}
async function* exposuresFromSnapshot(file,manifest){
 if(manifest.rulesId!==S.RULES_ID||manifest.featureVersion!==S.FEATURE_VERSION||manifest.sha256!==S.fileHash(file))throw Error('Historical snapshot changed before temporal exposure migration');
 for await(const {text} of sourceLines(file)){if(!text.trim())continue;const row=JSON.parse(text);if(!splits.includes(row.split)||typeof row.familyId!=='string'||!row.familyId)throw Error('Invalid historical snapshot family');const key=positionKey(row);if(key){if(typeof key!=='string'||!key||key.length>256)throw Error('Invalid historical snapshot position');yield exposure('position',key,row.split);}yield exposure('family',row.familyId,row.split);}
}
const lineageName='temporal-exposures-lineage.json',chainIntentName='exposure-chain-intent.json';
function checkContinuation(continuation){if(continuation.schemaVersion!==1||typeof continuation.complete!=='boolean'||typeof continuation.source!=='string'||!path.isAbsolute(continuation.source)||typeof continuation.sourceRun!=='string'||!continuation.sourceRun||!continuation.hashes||Array.isArray(continuation.hashes)||typeof continuation.hashes!=='object'||!Object.keys(continuation.hashes).length||!/^[a-f0-9]{64}$/.test(continuation.sourceId||'')||continuation.mode!=null&&!['normal','raw-reset'].includes(continuation.mode)||continuation.mode==='raw-reset'&&continuation.modelReset!==true||continuation.sourceId!==S.hash(continuation.mode==='raw-reset'?[continuation.source,continuation.hashes,'raw-reset']:[continuation.source,continuation.hashes]))throw Error('Invalid exposure continuation provenance');}
const rawRecoveryScope='Fresh model; all validated imported played positions and families are training-only. This proof does not reconstruct or authorize historical model ancestry.';
function lineageHash(proof){const parts=[proof.continuationSourceId,proof.registry,proof.sources];if(proof.mode==='raw-reset')parts.push(proof.mode,proof.modelReset,proof.scope);return S.hash(parts);}
function registryPrefix(dir){const file=path.join(dir,exposureName);return {bytes:fs.existsSync(file)?fs.statSync(file).size:0,sha256:fs.existsSync(file)?S.fileHash(file):null};}
function verifyPrefix(dir,prefix,label){
 const file=path.join(dir,exposureName);if(!Number.isSafeInteger(prefix?.bytes)||prefix.bytes<0||(prefix.sha256!==null&&!/^[a-f0-9]{64}$/.test(prefix.sha256||''))||prefix.sha256===null&&prefix.bytes!==0)throw Error('Invalid '+label+' registry prefix');
 if(prefix.sha256!==null&&(!fs.existsSync(file)||fs.statSync(file).size<prefix.bytes||prefixHash(file,prefix.bytes)!==prefix.sha256))throw Error(label+' changed the prior registry prefix');
}
function verifyLineage(dir){
 const proof=S.read(path.join(dir,lineageName));if(!proof)return null;const continuation=S.read(path.join(dir,'continuation.json'));
 if(continuation)checkContinuation(continuation);
 if(proof.schemaVersion!==1||proof.rulesId!==S.RULES_ID||proof.featureVersion!==S.FEATURE_VERSION||proof.continuationSourceId!==(continuation?.sourceId||null)||!Array.isArray(proof.sources)||proof.sources.length>64||!proof.sources.length||proof.mode!=null&&proof.mode!=='raw-reset'||(continuation?.mode==='raw-reset')!==(proof.mode==='raw-reset')||proof.mode==='raw-reset'&&(proof.modelReset!==true||proof.scope!==rawRecoveryScope)||proof.proofHash!==lineageHash(proof))throw Error('Invalid preserved temporal exposure lineage');
 verifyPrefix(dir,proof.registry,'Preserved exposure lineage');return proof;
}
function exposureChain(source,{selfDir=null,allowUnsealedSelf=false}={}){
 const C=require('./corpus.cjs'),seen=new Set(),chain=[];source=fs.realpathSync(source);
 for(let depth=0;;depth++){
  if(depth>=32)throw Error('Exposure continuation chain exceeds32 runs');if(seen.has(source))throw Error('Exposure continuation chain cycle');seen.add(source);
  const continuation=S.read(path.join(source,'continuation.json'));if(continuation){checkContinuation(continuation);if(continuation.complete!==true)throw Error('Incomplete exposure continuation provenance');}if(continuation||source!==selfDir)C.checkedSource(source,{allowRunningDir:source===selfDir?selfDir:null});
  const registry=path.join(source,exposureName),ready=S.read(path.join(source,'temporal-exposures-ready.json'));
  if(ready&&(ready.schemaVersion!==1||ready.rulesId!==S.RULES_ID||ready.featureVersion!==S.FEATURE_VERSION||(!allowUnsealedSelf||source!==selfDir)&&ready.sha256!==(fs.existsSync(registry)?S.fileHash(registry):null)))throw Error('Source temporal exposure registry changed or disappeared');
  const files=snapshotFiles(source),hashes={};for(const file of files){const manifest=S.read(file+'.manifest.json');if(!manifest||manifest.rulesId!==S.RULES_ID||manifest.featureVersion!==S.FEATURE_VERSION||!fs.existsSync(file)||manifest.sha256!==S.fileHash(file))throw Error('Historical snapshot changed before exposure lineage migration');hashes[path.relative(source,file)]=manifest.sha256;hashes[path.relative(source,file+'.manifest.json')]=S.fileHash(file+'.manifest.json');}
  for(const name of ['continuation.json',lineageName,exposureName,'temporal-exposures-ready.json'])if(fs.existsSync(path.join(source,name)))hashes[name]=S.fileHash(path.join(source,name));
  const proof=verifyLineage(source);if(continuation?.mode==='raw-reset'&&!proof)throw Error('Raw experience recovery lacks its training-only exposure proof; resume the import');chain.push({source,hashes,files,continuationSourceId:continuation?.sourceId||null,preservedSources:proof?.sources||[]});if(proof||!continuation)return chain;
  if(!fs.existsSync(continuation.source))throw Error('Missing exposure continuation ancestor: '+continuation.source);const parent=C.checkedSource(continuation.source);
  if(parent.state.runId!==continuation.sourceRun||parent.state.identity?.sourceHash!==continuation.sourceIdentity?.sourceHash||parent.state.identity?.harnessHash!==continuation.sourceIdentity?.harnessHash)throw Error('Exposure continuation ancestor identity changed');
  for(const [name,digest] of Object.entries(continuation.hashes)){let relative=name;if(name.startsWith('snapshot:'))relative='datasets/'+name.slice(9)+'.manifest.json';if(!/^[a-f0-9]{64}$/.test(digest)||relative.includes('\\')||relative.split('/').some(part=>part==='..'||part==='.'||!part)||path.isAbsolute(relative))throw Error('Invalid exposure continuation hash path');const file=path.join(parent.source,...relative.split('/'));if(!fs.existsSync(file)||!C.inside(parent.source,fs.realpathSync(file))||S.fileHash(file)!==digest)throw Error('Exposure continuation ancestor changed: '+name);}
  source=parent.source;
 }
}
async function importLocalExposures(destination,source,context=null){
 const registry=path.join(source,exposureName);if(destination!==source&&fs.existsSync(registry))await appendExposures(destination,(async function*(){for await(const {text} of sourceLines(registry)){if(text.trim())yield JSON.parse(text);}})(),context);
 // Older runs have no registry. Their immutable snapshots conservatively count
 // as exposed even if a trainer never reached the first update.
 for(const file of snapshotFiles(source))await appendExposures(destination,exposuresFromSnapshot(file,S.read(file+'.manifest.json')),context);
}
async function importExposures(destination,source,context=null){
 destination=fs.realpathSync(destination);source=fs.realpathSync(source);const intentFile=path.join(destination,chainIntentName),prior=S.read(intentFile);if(prior&&(prior.schemaVersion!==1||prior.source!==source||!Array.isArray(prior.sources)))throw Error('Exposure continuation import intent changed');if(prior)verifyPrefix(destination,prior.prior,'Exposure continuation import');
 const stable=rows=>rows.map(row=>({...row,hashes:Object.fromEntries(Object.entries(row.hashes).filter(([name])=>row.source!==destination||![exposureName,'temporal-exposures-ready.json',lineageName].includes(name)))}));
 const completed=verifyLineage(destination);if(prior&&completed&&prior.sources.every(row=>completed.sources.some(saved=>S.hash(stable([row]))===S.hash(stable([saved]))))){sealExposures(destination);fs.unlinkSync(intentFile);return completed;}
 const chain=exposureChain(source,{selfDir:destination,allowUnsealedSelf:!!prior}),sources=chain.map(({source,hashes,continuationSourceId})=>({source,hashes,continuationSourceId}));
 // The destination's own append-only registry grows during migration. Every
 // ancestor and every immutable snapshot must still match the saved intent.
 if(prior&&S.hash(stable(prior.sources))!==S.hash(stable(sources)))throw Error('Exposure continuation sources changed during import');
 const intent=prior||{schemaVersion:1,source,prior:registryPrefix(destination),sources};if(!prior)durableJson(intentFile,intent);
 for(const row of chain)await importLocalExposures(destination,row.source,context);
 for(const row of chain)if(row.source!==destination)for(const [name,digest] of Object.entries(row.hashes))if(!fs.existsSync(path.join(row.source,name))||S.fileHash(path.join(row.source,name))!==digest)throw Error('Exposure continuation source changed while importing');
 const previous=verifyLineage(destination),all=[...(previous?.sources||[]),...sources,...chain.flatMap(row=>row.preservedSources)],unique=[...new Map(all.map(row=>[row.source+':'+S.hash(row.hashes),row])).values()];if(unique.length>64)throw Error('Preserved exposure lineage exceeds64 sources');
 const proof={schemaVersion:1,rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,continuationSourceId:S.read(path.join(destination,'continuation.json'))?.sourceId||null,registry:registryPrefix(destination),sources:unique};proof.proofHash=S.hash([proof.continuationSourceId,proof.registry,proof.sources]);durableJson(path.join(destination,lineageName),proof);sealExposures(destination);fs.unlinkSync(intentFile);return proof;
}
async function importRawRecoveryExposures(context,manifest,positions){
 checkContinuation(manifest);if(manifest.mode!=='raw-reset'||context.state.freshModel!==true)throw Error('Raw recovery exposure proof requires a fresh model');
 const intentFile=path.join(context.dir,'raw-recovery-exposure-intent.json'),prior=S.read(intentFile);if(prior&&(prior.schemaVersion!==1||prior.sourceId!==manifest.sourceId))throw Error('Raw recovery exposure intent changed');if(prior)verifyPrefix(context.dir,prior.prior,'Raw recovery exposure import');
 const intent=prior||{schemaVersion:1,sourceId:manifest.sourceId,prior:registryPrefix(context.dir)};if(!prior)durableJson(intentFile,intent);
 await appendExposures(context.dir,(async function*(){for await(const row of positions)yield exposure(row.kind,row.key,'train');})(),context);
 for(const [name,digest] of Object.entries(manifest.hashes))if(!fs.existsSync(path.join(manifest.source,name))||S.fileHash(path.join(manifest.source,name))!==digest)throw Error('Raw recovery source changed while importing: '+name);
 const proof={schemaVersion:1,rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,mode:'raw-reset',modelReset:true,scope:rawRecoveryScope,continuationSourceId:manifest.sourceId,registry:registryPrefix(context.dir),sources:[{source:manifest.source,hashes:manifest.hashes,continuationSourceId:null,scope:'Validated raw experience only; historical ancestry unavailable'}]};proof.proofHash=lineageHash(proof);durableJson(path.join(context.dir,lineageName),proof);sealExposures(context.dir);fs.unlinkSync(intentFile);return proof;
}
function sealExposures(dir){const registry=path.join(dir,exposureName);durableJson(path.join(dir,'temporal-exposures-ready.json'),{schemaVersion:1,rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,sha256:fs.existsSync(registry)?S.fileHash(registry):null,scope:'Published snapshots conservatively reserve every selected split, including legacy snapshots.'});}
function modelExposureFile(reference){
 const match=typeof reference?.file==='string'&&/^models\/([A-Za-z0-9._-]{1,120})\.exposures\.jsonl$/.exec(reference.file);
 if(!match||['.','..'].includes(match[1])||typeof reference.runDir!=='string'||!path.isAbsolute(reference.runDir)||!/^[a-f0-9]{64}$/.test(reference.sha256||''))throw Error('Invalid model exposure lineage reference');
 if(!fs.existsSync(reference.runDir))throw Error('Model exposure source run is missing');const source=fs.realpathSync(reference.runDir),inside=(root,file)=>{const relative=path.relative(path.resolve(root),file);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
 if(![path.join(S.ROOT,'work'),path.join(S.ROOT,'outputs','learning')].some(root=>inside(root,source))||!fs.statSync(source).isDirectory())throw Error('Model exposure source leaves learning/work storage');
 const file=path.join(source,...reference.file.split('/'));if(!fs.existsSync(file))throw Error('Model exposure sidecar is missing');if(!inside(source,fs.realpathSync(file))||!fs.statSync(file).isFile())throw Error('Model exposure sidecar leaves its source run');if(S.fileHash(file)!==reference.sha256)throw Error('Model exposure sidecar changed');return file;
}
function prefixHash(file,length){
 const digest=require('node:crypto').createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(65536);let remaining=length;try{while(remaining){const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,remaining),null);if(!count)throw Error('Model exposure import changed the prior registry prefix');digest.update(buffer.subarray(0,count));remaining-=count;}}finally{fs.closeSync(fd);}return digest.digest('hex');
}
function sameExposure(a,b){return a?.runDir===b?.runDir&&a?.file===b?.file&&a?.sha256===b?.sha256;}
function verifyModelImportPrefix(context,intent){
 const registry=path.join(context.dir,exposureName);if(intent.schemaVersion!==1||!Number.isSafeInteger(intent.prior?.bytes)||intent.prior.bytes<0||(intent.prior.sha256!==null&&!/^[a-f0-9]{64}$/.test(intent.prior.sha256||'')))throw Error('Invalid model exposure import intent');
 if(intent.prior.sha256!==null&&(!fs.existsSync(registry)||fs.statSync(registry).size<intent.prior.bytes||prefixHash(registry,intent.prior.bytes)!==intent.prior.sha256))throw Error('Model exposure import changed the prior registry prefix');
}
async function consumeModelExposure(context){
 const pending=context.state.pendingModelExposure,intentFile=path.join(context.dir,'model-exposure-intent.json'),previous=S.read(intentFile);if(!pending){if(previous){if(!sameExposure(previous.exposure,context.state.inheritedModelExposure))throw Error('Unfinished model exposure import lost its pending state');fs.unlinkSync(intentFile);}return;}
 const source=modelExposureFile(pending),registry=path.join(context.dir,exposureName);let intent=previous;
 let hasTrainingExposure=false;for await(const {text} of sourceLines(source)){if(!text.trim())continue;const row=verifyExposure(JSON.parse(text));if(row.split==='train')hasTrainingExposure=true;}if(!hasTrainingExposure)throw Error('Model exposure sidecar lacks training exposure evidence');
 if(intent){if(!sameExposure(intent.exposure,pending))throw Error('Model exposure lineage changed during import');verifyModelImportPrefix(context,intent);}
 else{intent={schemaVersion:1,exposure:pending,prior:{sha256:fs.existsSync(registry)?S.fileHash(registry):null,bytes:fs.existsSync(registry)?fs.statSync(registry).size:0}};durableJson(intentFile,intent);}
 await appendExposures(context.dir,(async function*(){for await(const {text} of sourceLines(source)){if(text.trim())yield JSON.parse(text);}})(),context);if(S.fileHash(source)!==pending.sha256)throw Error('Model exposure sidecar changed during import');sealExposures(context.dir);context.state.inheritedModelExposure={...pending,importedAt:new Date().toISOString()};delete context.state.pendingModelExposure;S.save(context);fs.unlinkSync(intentFile);
}
async function ensureExposures(context){
 const marker=S.read(path.join(context.dir,'temporal-exposures-ready.json')),intent=S.read(path.join(context.dir,'model-exposure-intent.json')),chainIntent=S.read(path.join(context.dir,chainIntentName));require('./journal.cjs').syncFile(context.dir,exposureName,'id');
 if(!marker){if(intent)throw Error('Model exposure import lost its prior registry seal');await importExposures(context.dir,chainIntent?.source||context.dir,context);}
 else{const registry=path.join(context.dir,exposureName),changed=marker.sha256!==(fs.existsSync(registry)?S.fileHash(registry):null);if(marker.rulesId!==S.RULES_ID||marker.featureVersion!==S.FEATURE_VERSION)throw Error('Temporal exposure registry identity changed');if(changed){if(chainIntent)verifyPrefix(context.dir,chainIntent.prior,'Exposure continuation import');else{if(!intent||!sameExposure(intent.exposure,context.state.pendingModelExposure))throw Error('Temporal exposure registry changed or disappeared');verifyModelImportPrefix(context,intent);}}if(chainIntent)await importExposures(context.dir,chainIntent.source,context);else if(S.read(path.join(context.dir,'continuation.json'))&&!verifyLineage(context.dir))await importExposures(context.dir,context.dir,context);else verifyLineage(context.dir);}
 await consumeModelExposure(context);
}
async function recoverPublication(context,file){
 const intentFile=file+'.publish-intent.json',intent=S.read(intentFile);if(!intent)return;
 if(intent.schemaVersion!==1||typeof intent.transactionId!=='string'||!/^[a-f0-9]{64}$/.test(intent.transactionId)||intent.manifest?.file!==path.basename(file)||intent.manifest.rulesId!==S.RULES_ID||intent.manifest.featureVersion!==S.FEATURE_VERSION||!Array.isArray(intent.artifacts)||intent.artifacts.length!==2)throw Error('Invalid snapshot publication intent; preserve it for investigation');
 const expected=[file+'.families.jsonl',file];
 for(let n=0;n<2;n++){const item=intent.artifacts[n],target=expected[n];if(item.file!==path.basename(target)||typeof item.temporary!=='string'||!item.temporary.startsWith(path.basename(target)+'.tmp-')||path.basename(item.temporary)!==item.temporary||item.sha256!==(n===0?intent.manifest.familyManifest?.sha256:intent.manifest.sha256))throw Error('Invalid snapshot publication artifact');const pending=path.join(path.dirname(file),item.temporary);
  if(fs.existsSync(target)){if(S.fileHash(target)!==item.sha256)throw Error('Snapshot publication artifact changed; preserve it for investigation');}
  else{if(!fs.existsSync(pending)||S.fileHash(pending)!==item.sha256)throw Error('Snapshot publication artifact is missing or changed; preserve it for investigation');rename(pending,target);}
 }
 await appendExposures(context.dir,exposuresFromSnapshot(file,intent.manifest),context);
 sealExposures(context.dir);const manifestFile=file+'.manifest.json',old=S.read(manifestFile);if(old&&S.hash(old)!==S.hash(intent.manifest))throw Error('Snapshot publication manifest conflicts with intent');if(!old)durableJson(manifestFile,intent.manifest);
 if(intent.derivedIndex){if(path.basename(intent.derivedIndex)!==intent.derivedIndex||!intent.derivedIndex.startsWith(path.basename(file)+'.index-')||!intent.derivedIndex.endsWith('.sqlite'))throw Error('Invalid snapshot derived index cleanup path');for(const suffix of ['','-journal','-wal','-shm'])try{fs.unlinkSync(path.join(path.dirname(file),intent.derivedIndex+suffix));}catch(error){if(error.code!=='ENOENT')throw error;}}
 for(const item of intent.artifacts){const pending=path.join(path.dirname(file),item.temporary);if(fs.existsSync(pending)&&S.fileHash(pending)===item.sha256)fs.unlinkSync(pending);}fs.unlinkSync(intentFile);
}
function useManifest(context,file,manifest){if(manifest.rulesId!==S.RULES_ID||manifest.featureVersion!==S.FEATURE_VERSION||S.fileHash(file)!==manifest.sha256)throw Error('Fixed training snapshot changed');if(manifest.familyManifest){const family=path.join(path.dirname(file),manifest.familyManifest.file);if(path.basename(family)!==manifest.familyManifest.file||S.fileHash(family)!==manifest.familyManifest.sha256)throw Error('Fixed family manifest changed');}context.state.dataset=manifest;context.state.counters.snapshotUniquePositions=manifest.uniquePositions;S.save(context);return manifest;}
async function snapshotData(context,file){
 // A separate collector keeps the snapshot wall time independent of any
 // caller's generation/training collector. Timings never enter the manifest.
 const metrics={dir:context.dir,state:context.state};M.start(metrics,'snapshot');
 let stage='setup_ms',started=performance.now(),complete=false;
 const mark=next=>{if(stage)M.add(metrics,stage,performance.now()-started);stage=next;started=performance.now();};
 const release=S.lock(path.join(context.dir,'snapshot-build'));
 try{const result=await buildSnapshot(context,file,metrics,mark);complete=true;return result;}
 finally{release();mark(null);M.finish(metrics,{complete});}
}
async function buildSnapshot(context,file,metrics,mark){
 file=path.resolve(file||path.join(context.dir,'datasets','cycle-'+(context.state.cycle||1)+'.jsonl'));fs.mkdirSync(path.dirname(file),{recursive:true});await recoverPublication(context,file);await ensureExposures(context);const manifestFile=file+'.manifest.json',old=S.read(manifestFile);
 if(old){mark('reuse_verify_ms');if(!fs.existsSync(file))throw Error('Fixed training snapshot is missing');return useManifest(context,file,old);}
 // Legacy interrupted publications have no intent. Preserve those uncommitted
 // derived bytes under a quarantine name and rebuild the same cycle from raw.
 for(const orphan of [file,file+'.families.jsonl'])if(fs.existsSync(orphan)){const target=orphan+'.orphan-'+S.fileHash(orphan).slice(0,16)+'-'+Date.now();rename(orphan,target);S.append(path.join(context.dir,'recovery.jsonl'),{at:new Date().toISOString(),reason:'uncommitted-snapshot-without-intent',file:path.basename(orphan),preservedAs:path.basename(target)});}
 const source=path.join(context.dir,'dataset.jsonl');if(!fs.existsSync(source))throw Error('No training samples yet');
 const maximum=context.settings.maxTrainingSamples??100000;if(!Number.isSafeInteger(maximum)||maximum<1)throw Error('maxTrainingSamples must be a positive integer');
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const index=file+'.index-'+process.pid+'.sqlite',temporary=file+'.tmp-'+process.pid,familyFile=file+'.families.jsonl',familyTemporary=familyFile+'.tmp-'+process.pid;
 let database,transaction=false,published=false,dataPublished=false,familyPublished=false,dataHash=null,familyHash=null;const intentFile=file+'.publish-intent.json';
 try{
  mark('index_setup_ms');
  require('./storage.cjs').requireBudget(context,Math.ceil(fs.statSync(source).size/2)+65536,'snapshot-index');
  if(fs.existsSync(index))fs.unlinkSync(index);
  // Target about 64 MiB of SQLite pages for this temporary index; durable
  // transactions and file-backed temporary storage remain unchanged.
  database=new DatabaseSync(index);database.exec('PRAGMA cache_size=-65536; PRAGMA temp_store=FILE; PRAGMA synchronous=FULL; CREATE TABLE families(id TEXT PRIMARY KEY,split TEXT NOT NULL); CREATE TABLE positions(id TEXT PRIMARY KEY,priority INTEGER NOT NULL); CREATE TABLE aliases(id TEXT PRIMARY KEY,family TEXT NOT NULL); CREATE TABLE assignments(id TEXT PRIMARY KEY,split TEXT NOT NULL); CREATE TABLE rows(seq INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,family TEXT NOT NULL,split TEXT NOT NULL,position TEXT,rank TEXT NOT NULL,label TEXT,offset INTEGER NOT NULL,length INTEGER NOT NULL,eligible INTEGER NOT NULL DEFAULT 0,selected INTEGER NOT NULL DEFAULT 0);');
  database.exec('CREATE TABLE exposures(kind TEXT NOT NULL,id TEXT NOT NULL,split TEXT NOT NULL,PRIMARY KEY(kind,id,split));');
  const groupingFile=path.join(context.dir,'family-groups.json'),grouping=S.read(groupingFile,{aliases:{},groups:[]});
  const putAlias=database.prepare('INSERT OR REPLACE INTO aliases VALUES (?,?)'),putAssignment=database.prepare('INSERT OR REPLACE INTO assignments VALUES (?,?)'),getAssignment=database.prepare('SELECT split FROM assignments WHERE id=?');
  database.exec('BEGIN');transaction=true;
  const canonical=id=>resolveAlias(id,next=>(grouping.aliases||{})[next]);
  const putExposure=database.prepare('INSERT OR IGNORE INTO exposures VALUES(?,?,?)');
  const registry=path.join(context.dir,exposureName),exposureHash=fs.existsSync(registry)?S.fileHash(registry):null;
  if(fs.existsSync(registry))for await(const {text} of sourceLines(registry)){if(!text.trim())continue;const row=verifyExposure(JSON.parse(text));putExposure.run(row.kind,row.kind==='family'?canonical(row.key):row.key,row.split);}
  for(const id of Object.keys(grouping.aliases||{}))putAlias.run(id,canonical(id));
  const assign=(family,split)=>{if(!splits.includes(split))throw Error('Invalid family split assignment');family=canonical(family);const prior=getAssignment.get(family)?.split;putAssignment.run(family,prior&&priority[prior]<priority[split]?prior:split);};
  // Prior training/validation use of any merged alias prevents it from
  // becoming a newly independent final-test family.
  for(const g of grouping.groups||[])assign(g.familyId,g.split);
  for(const [family,split] of Object.entries(context.state.familySplits||{}))assign(family,split);
  database.exec('COMMIT');transaction=false;
  mark('source_hash_before_ms');
  const sourceHash=S.fileHash(source),groupingHash=fs.existsSync(groupingFile)?S.fileHash(groupingFile):null;
  mark('scan_index_ms');
  const alias=database.prepare('SELECT family FROM aliases WHERE id=?'),assignment=database.prepare('SELECT split FROM assignments WHERE id=?'),priorFamily=database.prepare('SELECT split FROM families WHERE id=?'),putFamily=database.prepare('INSERT INTO families VALUES (?,?)');
  const putPosition=database.prepare('INSERT INTO positions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET priority=MAX(priority,excluded.priority)'),putRow=database.prepare('INSERT OR IGNORE INTO rows(seq,id,family,split,position,rank,label,offset,length) VALUES (?,?,?,?,?,?,?,?,?)');
  const rawCounts={train:0,validation:0,test:0},counts={train:0,validation:0,test:0,deduplicated:0,overlapExcluded:0};let lines=0;
  database.exec('BEGIN');transaction=true;
  for await(const {text:line,offset,length} of sourceLines(source)){
   lines++;if(!line.trim())continue;let row;try{row=JSON.parse(line.replace(/^\uFEFF/,''));}catch{throw Error('Invalid dataset JSON at line '+lines);}
   if(!row||typeof row!=='object'||typeof row.sampleId!=='string'||!row.sampleId||(row.sampleId.length>256&&Array.from(row.sampleId).length>256)||typeof row.familyId!=='string'||!row.familyId||row.schemaVersion!==1||row.rulesId!==S.RULES_ID||row.featureVersion!==S.FEATURE_VERSION)throw Error('Invalid dataset identity at line '+lines);
   row.familyId=alias.get(row.familyId)?.family||row.familyId;row.split=assignment.get(row.familyId)?.split||row.split;
   if(!splits.includes(row.split))throw Error('Invalid dataset split at line '+lines);
   const prior=priorFamily.get(row.familyId);if(prior&&prior.split!==row.split)throw Error('Source family crosses data splits: '+row.familyId);if(!prior)putFamily.run(row.familyId,row.split);
   const key=positionKey(row);if(key!==null&&(typeof key!=='string'||!key||key.length>256))throw Error('Invalid position key at line '+lines);
   if(key)putPosition.run(key,priority[row.split]);rawCounts[row.split]++;
   if(!putRow.run(lines,row.sampleId,row.familyId,row.split,key,S.hash([context.settings.seed??1707,row.sampleId]),row.split==='test'?null:row.labelType||'terminal',offset,length).changes)counts.deduplicated++;
   if(lines%1024===0){database.exec('COMMIT; BEGIN');if(S.stopped(context.dir))throw Object.assign(Error('Snapshot stopped before publication; raw experience is preserved'),{code:'STOP_REQUESTED'});require('./storage.cjs').requireBudget(context,65536,'snapshot-index-growth');}
  }
  database.exec('COMMIT');transaction=false;
  M.count(metrics,'source_rows',Object.values(rawCounts).reduce((a,b)=>a+b,0));M.count(metrics,'source_lines',lines);
  mark('eligibility_index_ms');
  database.exec('UPDATE rows SET eligible=1 WHERE (position IS NULL OR NOT EXISTS(SELECT 1 FROM positions WHERE positions.id=rows.position AND positions.priority>CASE rows.split WHEN \'train\' THEN 0 WHEN \'validation\' THEN 1 ELSE 2 END)) AND NOT EXISTS(SELECT 1 FROM exposures WHERE ((kind=\'position\' AND exposures.id=rows.position) OR (kind=\'family\' AND exposures.id=rows.family)) AND exposures.split<>rows.split); CREATE INDEX selection ON rows(eligible,split,selected,rank); CREATE INDEX chronology ON rows(eligible,split,seq);');
  counts.overlapExcluded=database.prepare('SELECT COUNT(*) n FROM rows WHERE eligible=0').get().n;
  const temporalOverlapExcluded=database.prepare('SELECT COUNT(*) n FROM rows WHERE EXISTS(SELECT 1 FROM exposures WHERE ((kind=\'position\' AND exposures.id=rows.position) OR (kind=\'family\' AND exposures.id=rows.family)) AND exposures.split<>rows.split)').get().n;
  mark('selection_ms');
  const eligible=Object.fromEntries(splits.map(s=>[s,database.prepare('SELECT COUNT(*) n FROM rows WHERE eligible=1 AND split=?').get(s).n])),allocation=quotas(eligible,maximum),mix={};
  const choose=(split,condition,limit)=>{const used=database.prepare('SELECT COUNT(*) n FROM rows WHERE selected=1 AND split=?').get(split).n;limit=Math.min(limit,allocation[split]-used);if(limit<=0)return;database.prepare('UPDATE rows SET selected=1 WHERE seq IN (SELECT seq FROM rows WHERE eligible=1 AND selected=0 AND split=? AND '+condition+' ORDER BY rank,seq LIMIT ?)').run(split,limit);};
  for(const split of splits){
   const quota=allocation[split],pool=Math.max(1,Math.ceil(eligible[split]/4)),boundary=eligible[split]?database.prepare('SELECT seq FROM rows WHERE eligible=1 AND split=? ORDER BY seq DESC LIMIT 1 OFFSET ?').get(split,pool-1).seq:0;
   if(quota){database.prepare('UPDATE rows SET selected=1 WHERE seq IN (SELECT seq FROM (SELECT seq,rank,ROW_NUMBER() OVER (PARTITION BY family ORDER BY rank,seq) first FROM rows WHERE eligible=1 AND split=?) WHERE first=1 ORDER BY rank,seq LIMIT ?)').run(split,Math.min(quota,split==='test'?1:2));}
   const chosenRecent=()=>database.prepare('SELECT COUNT(*) n FROM rows WHERE selected=1 AND split=? AND seq>=?').get(split,boundary).n,chosenHistory=()=>database.prepare('SELECT COUNT(*) n FROM rows WHERE selected=1 AND split=? AND seq<?').get(split,boundary).n;
   choose(split,'seq>='+boundary,Math.ceil(quota/2)-chosenRecent());choose(split,'seq<'+boundary,Math.floor(quota/2)-chosenHistory());
   choose(split,'1',quota-chosenRecent()-chosenHistory());counts[split]=chosenRecent()+chosenHistory();mix[split]={recent:chosenRecent(),history:chosenHistory(),recentPoolRows:eligible[split]?pool:0,recentBoundarySourceLine:boundary};
  }
  M.count(metrics,'selected_rows',counts.train+counts.validation+counts.test);mark('data_output_ms');
  const outputEstimate=Number(database.prepare('SELECT COALESCE(SUM(length),0) n FROM rows WHERE selected=1').get().n)+(counts.train+counts.validation+counts.test)*1024+Number(database.prepare('SELECT COUNT(DISTINCT family) n FROM rows WHERE selected=1').get().n)*512+65536;
  require('./storage.cjs').requireBudget(context,outputEstimate,'snapshot-output');
  const turnCoverage=Object.fromEntries(splits.map(split=>[split,{player1:0,player2:0,firstPlayerTurn:0,secondPlayerTurn:0,unknown:0}]));
  const fd=fs.openSync(temporary,'wx'),sourceFd=fs.openSync(source,'r');try{for(const stored of database.prepare('SELECT family,split,offset,length FROM rows WHERE selected=1 ORDER BY seq').iterate()){
   const bytes=Buffer.alloc(stored.length);let received=0;while(received<bytes.length){const n=fs.readSync(sourceFd,bytes,received,bytes.length-received,stored.offset+received);if(!n)throw Error('Source dataset changed during indexed read');received+=n;}
   const row=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));row.familyId=stored.family;row.split=stored.split;const coverage=turnCoverage[row.split],player=row.position?.p,first=row.position?.firstPlayer;if([1,2].includes(player)){coverage['player'+player]++;if([1,2].includes(first))coverage[player===first?'firstPlayerTurn':'secondPlayerTurn']++;}else coverage.unknown++;fs.writeSync(fd,JSON.stringify(row)+'\n');
  }fs.fsyncSync(fd);}finally{fs.closeSync(sourceFd);fs.closeSync(fd);}
  mark('family_output_ms');
  const familyFd=fs.openSync(familyTemporary,'wx');try{for(const row of database.prepare('SELECT family familyId,split,COUNT(*) samples,SUM(CASE WHEN label=\'terminal\' THEN 1 ELSE 0 END) terminal,SUM(CASE WHEN label=\'teacher\' THEN 1 ELSE 0 END) teacher FROM rows WHERE selected=1 GROUP BY family,split ORDER BY family').iterate())fs.writeSync(familyFd,JSON.stringify(row)+'\n');fs.fsyncSync(familyFd);}finally{fs.closeSync(familyFd);}
  mark('source_recheck_ms');
  if(S.fileHash(source)!==sourceHash||(fs.existsSync(groupingFile)?S.fileHash(groupingFile):null)!==groupingHash)throw Error('Experience or family assignment changed while freezing snapshot; retry a fresh cycle');
  mark('output_hash_summary_ms');
  const uniquePositions=database.prepare('SELECT COUNT(DISTINCT position) n FROM rows WHERE selected=1').get().n,families=database.prepare('SELECT COUNT(*) n FROM families').get().n,selectedFamilies=Object.fromEntries(splits.map(split=>[split,database.prepare('SELECT COUNT(DISTINCT family) n FROM rows WHERE selected=1 AND split=?').get(split).n]));
  dataHash=S.fileHash(temporary);familyHash=S.fileHash(familyTemporary);
  const manifest={schemaVersion:1,file:path.basename(file),sha256:dataHash,rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,counts,uniquePositions,families,createdAt:new Date().toISOString(),selectedFamilies,
   selection:{version:2,maximumSamples:maximum,selectedSamples:counts.train+counts.validation+counts.test,sourceRows:Object.values(rawCounts).reduce((a,b)=>a+b,0),sourceLines:lines,sourceCounts:rawCounts,eligibleCounts:eligible,omittedEligibleSamples:splits.reduce((n,s)=>n+eligible[s]-counts[s],0),mix,turnCoverage,temporalOverlapExcluded,method:'Disk-indexed deterministic half-recent/half-history per split; reserve independent families, quarantine whole-source heldout overlap and prior published-split exposure before selection',seed:context.settings.seed??1707},
   source:{file:path.basename(source),sha256:sourceHash,familyGroupsSha256:groupingHash,familySplitRegistrySha256:S.hash(context.state.familySplits||{}),temporalExposureRegistrySha256:exposureHash,rawExperiencePreserved:true},
   familyManifest:{file:path.basename(familyFile),sha256:familyHash},scope:'Family splits are immutable; exact D4/color-equivalent overlap is excluded with test > validation > train priority within this source. Any prior published position/family exposure to another split is quarantined across cycles. Final-test features and labels are reserved and are not used to select, normalize or tune training.'};
  mark('publish_verify_ms');
  if(fs.existsSync(file)||fs.existsSync(manifestFile))throw Error('Another snapshot already owns this immutable cycle');
  durableJson(intentFile,{schemaVersion:1,transactionId:S.hash([process.pid,Date.now(),dataHash,familyHash]),derivedIndex:path.basename(index),manifest,artifacts:[{file:path.basename(familyFile),temporary:path.basename(familyTemporary),sha256:familyHash},{file:path.basename(file),temporary:path.basename(temporary),sha256:dataHash}]});
  rename(familyTemporary,familyFile);familyPublished=true;rename(temporary,file);dataPublished=true;await appendExposures(context.dir,exposuresFromSnapshot(file,manifest),context);sealExposures(context.dir);durableJson(manifestFile,manifest);published=true;
  database.close();database=null;for(const suffix of ['','-journal','-wal','-shm'])try{fs.unlinkSync(index+suffix);}catch(error){if(error.code!=='ENOENT')throw error;}fs.unlinkSync(intentFile);return useManifest(context,file,manifest);
 }finally{
  mark('cleanup_ms');
  if(database){if(transaction)try{database.exec('ROLLBACK');}catch{}database.close();}
  // Before the intent, only this process's derived outputs can be discarded.
  // Once the intent exists, verified artifacts stay available for recovery.
  if(!published&&!fs.existsSync(manifestFile)&&!fs.existsSync(intentFile))for(const [created,target,expected] of [[dataPublished,file,dataHash],[familyPublished,familyFile,familyHash]])if(created)try{if(S.fileHash(target)===expected)fs.unlinkSync(target);}catch{}
  // Only derived files with this process-specific exact name are removed.
  for(const suffix of ['', '-journal','-wal','-shm'])try{fs.unlinkSync(index+suffix);}catch{}
  if(!published&&!fs.existsSync(intentFile))for(const pending of [temporary,familyTemporary])try{fs.unlinkSync(pending);}catch{}
 }
}
module.exports={snapshotData,quotas,resolveAlias,exposureName,verifyExposure,snapshotFiles,importExposures,importRawRecoveryExposures,sealExposures,ensureExposures,lineageName,exposureChain,verifyLineage};
