'use strict';
// Raw experience stays append-only. This index and the bounded learning subset
// are derived artifacts; final-test features/targets are never inspected here.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const S=require('./state.cjs'),R=require('./replay.cjs');
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
function useManifest(context,file,manifest){if(manifest.rulesId!==S.RULES_ID||manifest.featureVersion!==S.FEATURE_VERSION||S.fileHash(file)!==manifest.sha256)throw Error('Fixed training snapshot changed');if(manifest.familyManifest){const family=path.join(path.dirname(file),manifest.familyManifest.file);if(path.basename(family)!==manifest.familyManifest.file||S.fileHash(family)!==manifest.familyManifest.sha256)throw Error('Fixed family manifest changed');}context.state.dataset=manifest;context.state.counters.snapshotUniquePositions=manifest.uniquePositions;S.save(context);return manifest;}
async function snapshotData(context,file){
 file=path.resolve(file||path.join(context.dir,'datasets','cycle-'+(context.state.cycle||1)+'.jsonl'));const manifestFile=file+'.manifest.json',old=S.read(manifestFile);
 if(old){if(!fs.existsSync(file))throw Error('Fixed training snapshot is missing');return useManifest(context,file,old);}
 if(fs.existsSync(file))throw Error('Snapshot exists without an immutable manifest; preserve it and choose a new cycle');
 const source=path.join(context.dir,'dataset.jsonl');if(!fs.existsSync(source))throw Error('No training samples yet');
 const maximum=context.settings.maxTrainingSamples??100000;if(!Number.isSafeInteger(maximum)||maximum<1)throw Error('maxTrainingSamples must be a positive integer');
 fs.mkdirSync(path.dirname(file),{recursive:true});const release=S.lock(path.join(context.dir,'snapshot-build'));
 const index=file+'.index-'+process.pid+'.sqlite',temporary=file+'.tmp-'+process.pid,familyFile=file+'.families.jsonl',familyTemporary=familyFile+'.tmp-'+process.pid;
 let database,transaction=false,published=false,dataPublished=false,familyPublished=false,dataHash=null,familyHash=null;
 try{
  if(fs.existsSync(index))fs.unlinkSync(index);
  database=new DatabaseSync(index);database.exec('PRAGMA cache_size=-8192; PRAGMA temp_store=FILE; PRAGMA synchronous=FULL; CREATE TABLE families(id TEXT PRIMARY KEY,split TEXT NOT NULL); CREATE TABLE positions(id TEXT PRIMARY KEY,priority INTEGER NOT NULL); CREATE TABLE aliases(id TEXT PRIMARY KEY,family TEXT NOT NULL); CREATE TABLE assignments(id TEXT PRIMARY KEY,split TEXT NOT NULL); CREATE TABLE rows(seq INTEGER PRIMARY KEY,id TEXT UNIQUE NOT NULL,family TEXT NOT NULL,split TEXT NOT NULL,position TEXT,rank TEXT NOT NULL,label TEXT,offset INTEGER NOT NULL,length INTEGER NOT NULL,eligible INTEGER NOT NULL DEFAULT 0,selected INTEGER NOT NULL DEFAULT 0);');
  const groupingFile=path.join(context.dir,'family-groups.json'),grouping=S.read(groupingFile,{aliases:{},groups:[]});
  const putAlias=database.prepare('INSERT OR REPLACE INTO aliases VALUES (?,?)'),putAssignment=database.prepare('INSERT OR REPLACE INTO assignments VALUES (?,?)'),getAssignment=database.prepare('SELECT split FROM assignments WHERE id=?');
  database.exec('BEGIN');transaction=true;
  const canonical=id=>resolveAlias(id,next=>(grouping.aliases||{})[next]);
  for(const id of Object.keys(grouping.aliases||{}))putAlias.run(id,canonical(id));
  const assign=(family,split)=>{if(!splits.includes(split))throw Error('Invalid family split assignment');family=canonical(family);const prior=getAssignment.get(family)?.split;putAssignment.run(family,prior&&priority[prior]<priority[split]?prior:split);};
  // Prior training/validation use of any merged alias prevents it from
  // becoming a newly independent final-test family.
  for(const g of grouping.groups||[])assign(g.familyId,g.split);
  for(const [family,split] of Object.entries(context.state.familySplits||{}))assign(family,split);
  database.exec('COMMIT');transaction=false;
  const sourceHash=S.fileHash(source),groupingHash=fs.existsSync(groupingFile)?S.fileHash(groupingFile):null;
  const alias=database.prepare('SELECT family FROM aliases WHERE id=?'),assignment=database.prepare('SELECT split FROM assignments WHERE id=?'),priorFamily=database.prepare('SELECT split FROM families WHERE id=?'),putFamily=database.prepare('INSERT INTO families VALUES (?,?)');
  const putPosition=database.prepare('INSERT INTO positions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET priority=MAX(priority,excluded.priority)'),putRow=database.prepare('INSERT OR IGNORE INTO rows(seq,id,family,split,position,rank,label,offset,length) VALUES (?,?,?,?,?,?,?,?,?)');
  const rawCounts={train:0,validation:0,test:0},counts={train:0,validation:0,test:0,deduplicated:0,overlapExcluded:0};let lines=0;
  database.exec('BEGIN');transaction=true;
  for await(const {text:line,offset,length} of sourceLines(source)){
   lines++;if(!line.trim())continue;let row;try{row=JSON.parse(line.replace(/^\uFEFF/,''));}catch{throw Error('Invalid dataset JSON at line '+lines);}
   if(!row||typeof row!=='object'||typeof row.sampleId!=='string'||!row.sampleId||typeof row.familyId!=='string'||!row.familyId||row.schemaVersion!==1||row.rulesId!==S.RULES_ID||row.featureVersion!==S.FEATURE_VERSION)throw Error('Invalid dataset identity at line '+lines);
   row.familyId=alias.get(row.familyId)?.family||row.familyId;row.split=assignment.get(row.familyId)?.split||row.split;
   if(!splits.includes(row.split))throw Error('Invalid dataset split at line '+lines);
   const prior=priorFamily.get(row.familyId);if(prior&&prior.split!==row.split)throw Error('Source family crosses data splits: '+row.familyId);if(!prior)putFamily.run(row.familyId,row.split);
   const key=positionKey(row);if(key!==null&&(typeof key!=='string'||!key||key.length>256))throw Error('Invalid position key at line '+lines);
   if(key)putPosition.run(key,priority[row.split]);rawCounts[row.split]++;
   if(!putRow.run(lines,row.sampleId,row.familyId,row.split,key,S.hash([context.settings.seed??1707,row.sampleId]),row.split==='test'?null:row.labelType||'terminal',offset,length).changes)counts.deduplicated++;
   if(lines%1024===0){database.exec('COMMIT; BEGIN');if(S.stopped(context.dir))throw Error('Snapshot stopped before publication; raw experience is preserved');}
  }
  database.exec('COMMIT');transaction=false;
  database.exec('UPDATE rows SET eligible=1 WHERE position IS NULL OR NOT EXISTS(SELECT 1 FROM positions WHERE positions.id=rows.position AND positions.priority>CASE rows.split WHEN \'train\' THEN 0 WHEN \'validation\' THEN 1 ELSE 2 END); CREATE INDEX selection ON rows(eligible,split,selected,rank); CREATE INDEX chronology ON rows(eligible,split,seq);');
  counts.overlapExcluded=database.prepare('SELECT COUNT(*) n FROM rows WHERE eligible=0').get().n;
  const eligible=Object.fromEntries(splits.map(s=>[s,database.prepare('SELECT COUNT(*) n FROM rows WHERE eligible=1 AND split=?').get(s).n])),allocation=quotas(eligible,maximum),mix={};
  const choose=(split,condition,limit)=>{const used=database.prepare('SELECT COUNT(*) n FROM rows WHERE selected=1 AND split=?').get(split).n;limit=Math.min(limit,allocation[split]-used);if(limit<=0)return;database.prepare('UPDATE rows SET selected=1 WHERE seq IN (SELECT seq FROM rows WHERE eligible=1 AND selected=0 AND split=? AND '+condition+' ORDER BY rank,seq LIMIT ?)').run(split,limit);};
  for(const split of splits){
   const quota=allocation[split],pool=Math.max(1,Math.ceil(eligible[split]/4)),boundary=eligible[split]?database.prepare('SELECT seq FROM rows WHERE eligible=1 AND split=? ORDER BY seq DESC LIMIT 1 OFFSET ?').get(split,pool-1).seq:0;
   if(quota){database.prepare('UPDATE rows SET selected=1 WHERE seq IN (SELECT seq FROM (SELECT seq,rank,ROW_NUMBER() OVER (PARTITION BY family ORDER BY rank,seq) first FROM rows WHERE eligible=1 AND split=?) WHERE first=1 ORDER BY rank,seq LIMIT ?)').run(split,Math.min(quota,split==='test'?1:2));}
   const chosenRecent=()=>database.prepare('SELECT COUNT(*) n FROM rows WHERE selected=1 AND split=? AND seq>=?').get(split,boundary).n,chosenHistory=()=>database.prepare('SELECT COUNT(*) n FROM rows WHERE selected=1 AND split=? AND seq<?').get(split,boundary).n;
   choose(split,'seq>='+boundary,Math.ceil(quota/2)-chosenRecent());choose(split,'seq<'+boundary,Math.floor(quota/2)-chosenHistory());
   choose(split,'1',quota-chosenRecent()-chosenHistory());counts[split]=chosenRecent()+chosenHistory();mix[split]={recent:chosenRecent(),history:chosenHistory(),recentPoolRows:eligible[split]?pool:0,recentBoundarySourceLine:boundary};
  }
  const fd=fs.openSync(temporary,'wx'),sourceFd=fs.openSync(source,'r');try{for(const stored of database.prepare('SELECT family,split,offset,length FROM rows WHERE selected=1 ORDER BY seq').iterate()){
   const bytes=Buffer.alloc(stored.length);let received=0;while(received<bytes.length){const n=fs.readSync(sourceFd,bytes,received,bytes.length-received,stored.offset+received);if(!n)throw Error('Source dataset changed during indexed read');received+=n;}
   const row=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));row.familyId=stored.family;row.split=stored.split;fs.writeSync(fd,JSON.stringify(row)+'\n');
  }fs.fsyncSync(fd);}finally{fs.closeSync(sourceFd);fs.closeSync(fd);}
  const familyFd=fs.openSync(familyTemporary,'wx');try{for(const row of database.prepare('SELECT family familyId,split,COUNT(*) samples,SUM(CASE WHEN label=\'terminal\' THEN 1 ELSE 0 END) terminal,SUM(CASE WHEN label=\'teacher\' THEN 1 ELSE 0 END) teacher FROM rows WHERE selected=1 GROUP BY family,split ORDER BY family').iterate())fs.writeSync(familyFd,JSON.stringify(row)+'\n');fs.fsyncSync(familyFd);}finally{fs.closeSync(familyFd);}
  if(S.fileHash(source)!==sourceHash||(fs.existsSync(groupingFile)?S.fileHash(groupingFile):null)!==groupingHash)throw Error('Experience or family assignment changed while freezing snapshot; retry a fresh cycle');
  const uniquePositions=database.prepare('SELECT COUNT(DISTINCT position) n FROM rows WHERE selected=1').get().n,families=database.prepare('SELECT COUNT(*) n FROM families').get().n,selectedFamilies=Object.fromEntries(splits.map(split=>[split,database.prepare('SELECT COUNT(DISTINCT family) n FROM rows WHERE selected=1 AND split=?').get(split).n]));
  dataHash=S.fileHash(temporary);familyHash=S.fileHash(familyTemporary);
  const manifest={schemaVersion:1,file:path.basename(file),sha256:dataHash,rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,counts,uniquePositions,families,createdAt:new Date().toISOString(),selectedFamilies,
   selection:{version:1,maximumSamples:maximum,selectedSamples:counts.train+counts.validation+counts.test,sourceRows:Object.values(rawCounts).reduce((a,b)=>a+b,0),sourceLines:lines,sourceCounts:rawCounts,eligibleCounts:eligible,omittedEligibleSamples:splits.reduce((n,s)=>n+eligible[s]-counts[s],0),mix,method:'Disk-indexed deterministic half-recent/half-history per split; reserve independent families and quarantine whole-source heldout overlap before selection',seed:context.settings.seed??1707},
   source:{file:path.basename(source),sha256:sourceHash,familyGroupsSha256:groupingHash,familySplitRegistrySha256:S.hash(context.state.familySplits||{}),rawExperiencePreserved:true},
   familyManifest:{file:path.basename(familyFile),sha256:familyHash},scope:'Family splits are immutable; exact D4/color-equivalent overlap is excluded with test > validation > train priority. Final-test features and labels are reserved and are not used to select, normalize or tune training.'};
  if(fs.existsSync(file)||fs.existsSync(manifestFile))throw Error('Another snapshot already owns this immutable cycle');
  rename(familyTemporary,familyFile);familyPublished=true;rename(temporary,file);dataPublished=true;S.atomic(manifestFile,manifest);published=true;return useManifest(context,file,manifest);
 }finally{
  try{if(database){if(transaction)try{database.exec('ROLLBACK');}catch{}database.close();}}finally{release();}
  // A publication failure rolls back only the new, hash-matched derived
  // artifacts. A committed immutable snapshot and all raw data stay intact.
  if(!published&&!fs.existsSync(manifestFile))for(const [created,target,expected] of [[dataPublished,file,dataHash],[familyPublished,familyFile,familyHash]])if(created)try{if(S.fileHash(target)===expected)fs.unlinkSync(target);}catch{}
  // Only derived files with this process-specific exact name are removed.
  for(const suffix of ['', '-journal','-wal','-shm'])try{fs.unlinkSync(index+suffix);}catch{}
  if(!published)for(const pending of [temporary,familyTemporary])try{fs.unlinkSync(pending);}catch{}
 }
}
module.exports={snapshotData,quotas,resolveAlias};
