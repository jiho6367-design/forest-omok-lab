'use strict';
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {DatabaseSync}=require('node:sqlite');
const S=require('./state.cjs'),R=require('./replay.cjs'),J=require('./journal.cjs');
const familyReaders=new Map();
function familySplit(context,id){if(!context.state.sourceFamilyIndex)return null;let db=familyReaders.get(context.dir);if(!db){db=new DatabaseSync(path.join(context.dir,'continuation.sqlite'),{readOnly:true});familyReaders.set(context.dir,db);}return db.prepare('SELECT split FROM families WHERE id=?').get(id)?.split||null;}
function close(dir){const db=familyReaders.get(dir);if(db){db.close();familyReaders.delete(dir);}}
function inside(root,file){const p=path.relative(root,file);return p===''||(!p.startsWith('..'+path.sep)&&p!=='..'&&!path.isAbsolute(p));}
function checkedSource(source,{allowRunningDir=null}={}){
 source=fs.realpathSync(S.resolveRun(source));if(![path.join(S.ROOT,'outputs/learning'),path.join(S.ROOT,'work')].some(root=>inside(root,source)))throw Error('Experience source must be inside this project learning/work storage');
 if(!fs.statSync(source).isDirectory())throw Error('Experience source must be a run directory');
 for(const name of ['state.json','settings.json','records.json','games.jsonl','dataset.jsonl','lessons.json','candidate.json','champion.json','analysis.jsonl','family-groups.json','continuation.json','runner.lock','temporal-exposures.jsonl','temporal-exposures-ready.json','temporal-exposures-lineage.json','datasets'])if(fs.existsSync(path.join(source,name))&&!inside(source,fs.realpathSync(path.join(source,name))))throw Error('Experience source file leaves its run directory');
 const lock=S.read(path.join(source,'runner.lock'));if(Number.isSafeInteger(lock?.pid)&&lock.pid>0){let live=false;try{process.kill(lock.pid,0);live=true;}catch{}if(live&&source!==allowRunningDir)throw Error('Stop the source experiment before continuing its experience');}
 const state=S.read(path.join(source,'state.json'));if(!state||state.rulesId!==S.RULES_ID||state.featureVersion!==S.FEATURE_VERSION)throw Error('Source experience rule/feature version mismatch');
 if(state.schemaVersion!==1||typeof state.runId!=='string'||!state.runId||!/^([a-f0-9]{64})$/.test(state.identity?.sourceHash||'')||!/^([a-f0-9]{64})$/.test(state.identity?.harnessHash||''))throw Error('Source experience schema/identity provenance is missing or invalid');
 if(!fs.existsSync(path.join(source,'settings.json')))throw Error('Source experience settings are missing');const settings=S.read(path.join(source,'settings.json'));if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error('Source experience settings are invalid');return {source,state};
}
async function eachLine(file,fn){if(!fs.existsSync(file))return true;const input=fs.createReadStream(file),lines=readline.createInterface({input,crlfDelay:Infinity});let lineNo=0;try{for await(const line of lines){lineNo++;if(!line.trim())continue;try{if(await fn(JSON.parse(line))===false)return false;}catch(error){throw Object.assign(Error(path.basename(file)+' line '+lineNo+': '+error.message),error.code?{code:error.code}:{});}}return true;}finally{lines.close();input.destroy();}}
function continuationPreflight(source){const checked=checkedSource(source);require('./snapshot.cjs').exposureChain(checked.source);return checked;}
// Keep the trainer's 256-character identity bound across arbitrary continuations.
// The overflow namespace is disjoint from the legacy origin-<16hex>: prefix.
// Full source/row identities stay in the digest and unchanged provenance.
// Python len(str) counts Unicode code points, unlike JS UTF-16 string.length.
function continuationSampleId(sourceId,originalId,encodingVersion=1){
 if(typeof sourceId!=='string'||!/^[a-f0-9]{64}$/.test(sourceId)||typeof originalId!=='string'||!originalId||![0,1].includes(encodingVersion))throw Error('Invalid continuation sample identity');
 const legacy='origin-'+sourceId.slice(0,16)+':'+originalId;
 if(legacy.length<=256||Array.from(legacy).length<=256)return legacy;
 if(encodingVersion===0)throw Error('Legacy continuation sample identity exceeds trainer bound; choose a separate new run');
 return 'origin-sha256-'+S.hash(['continuation-sample-id-v1',sourceId,originalId]);
}
function requireFreshModel(context){
 if(context.state.freshModel!==true||context.state.cycle!==0||context.state.initialIncumbentHash||context.state.pendingModelExposure||context.state.inheritedModelExposure||context.state.training||context.state.validation||context.state.adoptions?.length||context.state.counters?.trainingUpdates>0||Object.keys(context.state.activeGames||{}).length)throw Error('Raw experience recovery requires a fresh model in a new run');
 for(const name of ['candidate.json','champion.json','warm-start.json','checkpoints','models']){const file=path.join(context.dir,name);if(fs.existsSync(file)&&(!fs.statSync(file).isDirectory()||fs.readdirSync(file).length))throw Error('Raw experience recovery cannot inherit model or checkpoint artifacts: '+name);}
}
async function continueFrom(context,source,{mode:requestedMode}={}){
 const checked=checkedSource(source);source=checked.source;if(source===fs.realpathSync(context.dir))throw Error('Choose a separate source run');
 const exposure=require('./snapshot.cjs'),marker=path.join(context.dir,'continuation.json'),prior=S.read(marker),mode=requestedMode||prior?.mode||'normal';if(!['normal','raw-reset'].includes(mode)||prior&&(prior.mode||'normal')!==mode)throw Error('Continuation mode changed after import began');
 if(mode==='normal')continuationPreflight(source);else if(!prior?.complete){requireFreshModel(context);if(!prior&&(context.state.counters?.samples>0||context.state.counters?.generatedGames>0||S.read(path.join(context.dir,'records.json'),[]).length))throw Error('Raw experience recovery requires an empty new run');}
 const names=mode==='raw-reset'?['state.json','settings.json','records.json','games.jsonl','dataset.jsonl','lessons.json','continuation.json']:['state.json','records.json','games.jsonl','dataset.jsonl','lessons.json','candidate.json','analysis.jsonl','continuation.json','temporal-exposures.jsonl','temporal-exposures-ready.json','temporal-exposures-lineage.json'];
 const ids=Object.fromEntries(names.filter(n=>fs.existsSync(path.join(source,n))).map(n=>[n,S.fileHash(path.join(source,n))]));
 if(mode==='normal')for(const file of exposure.snapshotFiles(source))ids['snapshot:'+path.basename(file)]=S.fileHash(file+'.manifest.json');
 const sourceId=S.hash(mode==='raw-reset'?[source,ids,mode]:[source,ids]);if(prior){if(prior.sourceId!==sourceId)throw Error('Source experience changed after continuation began');if(prior.complete){exposure.verifyLineage(context.dir);return prior;}}
 const sampleIdEncodingVersion=prior?(prior.sampleIdEncodingVersion??0):1;if(![0,1].includes(sampleIdEncodingVersion))throw Error('Unsupported continuation sample identity encoding');
 const prefix='origin-'+sourceId.slice(0,16)+':',records=S.read(path.join(source,'records.json'),[]),existing=S.read(path.join(context.dir,'records.json'),[]);R.assertRecordIds([...existing,...records]);const grouped=R.groupFamilies([...existing,...records.filter(r=>!existing.some(x=>x.id===r.id))],records);
 const recordMap=new Map(grouped.records.map(r=>[r.id,r]));
 const manifest={schemaVersion:1,source,sourceId,sourceRun:checked.state.runId,sourceIdentity:checked.state.identity,hashes:ids,createdAt:prior?.createdAt||new Date().toISOString(),complete:false,...(sampleIdEncodingVersion===1?{sampleIdEncodingVersion}:{}),...(mode==='raw-reset'?{mode,modelReset:true,scope:'Validated raw played experience only. Historical model ancestry is unavailable and no historical model or evaluation result is inherited.'}:{})};S.atomic(marker,manifest);
 // Compact disk indexes allow bounded, idempotent copying. Final family splits
 // are settled before any raw game or training row is appended.
 const db=new DatabaseSync(path.join(context.dir,'continuation.sqlite'));db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY,family TEXT,completed INTEGER,winner INTEGER,firstPlayer INTEGER); CREATE TABLE IF NOT EXISTS aliases(old TEXT PRIMARY KEY,family TEXT); CREATE TABLE IF NOT EXISTS families(id TEXT PRIMARY KEY,split TEXT);');
 db.exec('CREATE TABLE IF NOT EXISTS positions(gameId TEXT,ply INTEGER,boardHash TEXT,featureHash TEXT,PRIMARY KEY(gameId,ply));');
 db.exec('CREATE TABLE IF NOT EXISTS recovery_positions(key TEXT PRIMARY KEY);');const putRecoveryPosition=db.prepare('INSERT OR IGNORE INTO recovery_positions VALUES(?)');
 const putPosition=db.prepare('INSERT OR REPLACE INTO positions VALUES(?,?,?,?)'),getPosition=db.prepare('SELECT * FROM positions WHERE gameId=? AND ply=?');
 const indexPositions=(id,checked,first)=>{for(const p of checked.positions){putPosition.run(id,p.ply,S.hash([p.board,p.p,first]),S.hash(require('./generate.cjs').features(p.board,p.p,first)));if(mode==='raw-reset')putRecoveryPosition.run(R.positionKey(p.board,p.p,first));}};
 const getGame=db.prepare('SELECT * FROM games WHERE id=?'),putGame=db.prepare('INSERT OR REPLACE INTO games VALUES(?,?,?,?,?)'),getAlias=db.prepare('SELECT family FROM aliases WHERE old=?'),putAlias=db.prepare('INSERT OR REPLACE INTO aliases VALUES(?,?)'),getSplit=db.prepare('SELECT split FROM families WHERE id=?'),putSplit=db.prepare('INSERT OR REPLACE INTO families VALUES(?,?)');
 const family=id=>getAlias.get(id)?.family||grouped.aliases[id]||id;
 const join=(id,split)=>{if(typeof id!=='string'||!id||!['train','validation','test'].includes(split))throw Error('Invalid source family/split');if(mode==='raw-reset')split='train';const before=getSplit.get(id)?.split;putSplit.run(id,before==='train'||split==='train'?'train':before==='validation'||split==='validation'?'validation':'test');};
 const interrupted=()=>S.stopped(context.dir);
 const convertGame=game=>{const f=getGame.get(game.id).family;return {...game,id:prefix+game.id,familyId:f,split:getSplit.get(f).split,provenance:{sourceRun:checked.state.runId,sourceId,originalGameId:game.id}};};
 let batch=[],nextGenerationIndex=checked.state.generationIndex||0,transaction=false;
 // These indexes are derived and safely rebuilt on resume. Bound each durable
 // transaction instead of forcing a SQLite commit/fsync for every played ply
 // and every family assignment. No JSONL is published before validation ends.
 const begin=()=>{db.exec('BEGIN');transaction=true;},commit=()=>{db.exec('COMMIT');transaction=false;},checkpoint=()=>{commit();begin();};
 let indexed=0;
 try{
  begin();
  for(const record of grouped.records){putAlias.run(record.familyId,record.familyId);join(record.familyId,record.split);indexPositions(record.id,R.replay(record),record.first);if(++indexed%128===0)checkpoint();}
  indexed=0;
  let ok=await eachLine(path.join(source,'games.jsonl'),game=>{
   if(interrupted())return false;if(typeof game.id!=='string'||!game.id)throw Error('Source game ID is missing');if(Number.isSafeInteger(game.index)&&game.index>=0)nextGenerationIndex=Math.max(nextGenerationIndex,game.index+1);indexPositions(game.id,J.verify(game),game.firstPlayer);
   const f=game.branch?.sourceGame?recordMap.get(game.branch.sourceGame)?.familyId:'family-'+S.hash(R.familyFor((game.opening||[]).slice(0,4),game.firstPlayer)).slice(0,24);if(!f)throw Error('Missing source record family');
   const alias=getAlias.get(game.familyId);if(alias&&alias.family!==f)throw Error('Source family aliases conflict');putAlias.run(game.familyId,f);join(f,game.split);putGame.run(game.id,f,game.completed?1:0,game.winner,game.firstPlayer);if(++indexed%128===0)checkpoint();
  });commit();if(!ok)return manifest;
  const validateRow=row=>{
   continuationSampleId(sourceId,row.sampleId,sampleIdEncodingVersion);
   const p=row.position;if(row.rulesId!==S.RULES_ID||row.featureVersion!==S.FEATURE_VERSION||!p||!Array.isArray(p.board)||p.board.length!==225||!p.board.every(v=>v===0||v===1||v===2)||![1,2].includes(p.p)||![1,2].includes(p.firstPlayer)||!Array.isArray(row.features)||row.features.length!==32||!row.features.every(Number.isFinite)||!Number.isFinite(row.target)||Math.abs(row.target)>1||!Number.isFinite(row.weight)||row.weight<=0||typeof row.sampleId!=='string')throw Error('Invalid source learning row');
   if(row.positionKey!==R.positionKey(p.board,p.p,p.firstPlayer))throw Error('Source position identity differs from board');
   const played=getPosition.get(row.source?.gameId,row.source?.ply);if(!played||played.boardHash!==S.hash([p.board,p.p,p.firstPlayer]))throw Error('Source sample differs from played position/ply');if(played.featureHash!==S.hash(row.features))throw Error('Source features differ from house32 extraction');
   const g=getGame.get(row.source?.gameId),r=recordMap.get(row.source?.gameId);if(row.labelType==='terminal'){
    const outcome=g||(r?(()=>{const q=R.replay(r);return {completed:q.completed,winner:q.draw?0:q.winner};})():null);
    if(!outcome?.completed)throw Error('Unplayed terminal label');const target=outcome.winner===0?0:outcome.winner===p.p?1:-1;if(row.target!==target)throw Error('Source terminal label differs from played outcome');
   }else if(row.labelType!=='teacher')throw Error('Unknown source label type');
   return family(row.familyId);
  };
  indexed=0;begin();ok=await eachLine(path.join(source,'dataset.jsonl'),row=>{if(interrupted())return false;const f=validateRow(row);join(f,row.split);if(++indexed%2048===0)checkpoint();});commit();if(!ok)return manifest;
  if(mode==='raw-reset')await exposure.importRawRecoveryExposures(context,manifest,(async function*(){for(const row of db.prepare('SELECT key FROM recovery_positions ORDER BY key').iterate())yield {kind:'position',key:row.key};for(const row of db.prepare('SELECT id FROM families ORDER BY id').iterate())yield {kind:'family',key:row.id};})());else await exposure.importExposures(context.dir,source,context);exposure.sealExposures(context.dir);
  for(const record of grouped.records)record.split=getSplit.get(record.familyId).split;
  grouped.groups.forEach(g=>{g.split=getSplit.get(g.familyId).split;g.finalTestEligible=g.split==='test';});
  S.atomic(path.join(context.dir,'records.json'),grouped.records);S.atomic(path.join(context.dir,'family-groups.json'),{schemaVersion:1,aliases:grouped.aliases,groups:grouped.groups});
  const flush=(name,key)=>{if(batch.length){J.appendRows(context.dir,name,batch,key,context);batch=[];}};
  ok=await eachLine(path.join(source,'games.jsonl'),game=>{if(interrupted())return false;batch.push(convertGame(game));if(batch.length>=256)flush('games.jsonl','id');});flush('games.jsonl','id');if(!ok)return manifest;
  ok=await eachLine(path.join(source,'dataset.jsonl'),row=>{if(interrupted())return false;const f=family(row.familyId);batch.push({...row,sampleId:continuationSampleId(sourceId,row.sampleId,sampleIdEncodingVersion),familyId:f,split:getSplit.get(f).split,provenance:{sourceRun:checked.state.runId,sourceId,originalSampleId:row.sampleId},source:{...row.source,gameId:getGame.get(row.source?.gameId)?prefix+row.source.gameId:row.source?.gameId}});if(batch.length>=512)flush('dataset.jsonl','sampleId');});flush('dataset.jsonl','sampleId');if(!ok)return manifest;
  const lessons=S.read(path.join(source,'lessons.json'));if(lessons)S.atomic(path.join(context.dir,'lessons.json'),lessons);
  const candidate=mode==='normal'?S.read(path.join(source,'candidate.json')):null;if(candidate?.training?.updates>0){require('../../src/neural-evaluator.js').validate(candidate);S.atomic(path.join(context.dir,'warm-start.json'),candidate);}
  context.state.sourceFamilyIndex=true;context.state.familySplits=Object.fromEntries(grouped.records.map(r=>[r.familyId,r.split]));context.state.importedSampleGames=checked.state.importedSampleGames||[];context.state.importedRecordDigests=checked.state.importedRecordDigests||Object.fromEntries(records.filter(r=>context.state.importedSampleGames.includes(r.id)).map(r=>[r.id,R.recordDigest(r)]));context.state.analysisDone=checked.state.analysisDone||[];context.state.counters.analyzedPositions=checked.state.counters?.analyzedPositions||0;
  context.state.counters.importedRecords=grouped.records.length;J.counters(context);context.state.lastTrainingSampleCount=mode==='raw-reset'?0:Number.isSafeInteger(checked.state.lastTrainingSampleCount)?Math.min(context.state.counters.samples,checked.state.lastTrainingSampleCount):context.state.counters.samples;context.state.counters.trainingUpdates=mode==='raw-reset'?0:checked.state.counters?.trainingUpdates??checked.state.training?.training?.updates??0;context.state.trial=mode==='raw-reset'?(context.state.trial||0):Math.max(context.state.trial||0,checked.state.trial||0);context.state.continuation={sourceId,sourceRun:checked.state.runId,importedGames:context.state.counters.generatedGames,importedSamples:context.state.counters.samples,...(mode==='raw-reset'?{mode,modelReset:true}:{})};context.state.generationIndex=nextGenerationIndex;
  manifest.complete=true;manifest.importedGames=context.state.counters.generatedGames;manifest.importedSamples=context.state.counters.samples;manifest.completedAt=new Date().toISOString();S.save(context);S.atomic(marker,manifest);return manifest;
 }finally{if(transaction)try{db.exec('ROLLBACK');}catch{}db.close();}
}
module.exports={inside,checkedSource,continuationPreflight,continuationSampleId,eachLine,continueFrom,familySplit,close};
