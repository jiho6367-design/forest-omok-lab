'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const S=require('../tools/learning/state.cjs'),snapshot=require('../tools/learning/snapshot.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'omok-snapshot-'));let passed=0;
function context(name,maximum=100000){const dir=path.join(root,name);fs.mkdirSync(dir,{recursive:true});return {dir,settings:{seed:71,maxTrainingSamples:maximum},state:{schemaVersion:1,runId:name,counters:{samples:0},history:[]}};}
function row(id,family,split,key=id){return {schemaVersion:1,rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,sampleId:id,familyId:family,split,positionKey:key,features:Array(32).fill(0),target:1,weight:1,labelType:'terminal',source:{gameId:id,ply:17},provenance:{origin:'synthetic-contract-fixture'}};}
function write(c,rows){S.atomic(path.join(c.dir,'dataset.jsonl'),rows.map(r=>JSON.stringify(r)+'\n').join(''));}
function read(file){return fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}
function file(c,name){return path.join(c.dir,'datasets',name+'.jsonl');}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await check('legacy deduplication and test>validation>train overlap counts remain compatible',async()=>{
  const c=context('legacy'),rows=[row('train-overlap','a','train','empty'),row('validation-overlap','b','validation','empty'),row('test-final','c','test','empty'),row('train-good','a','train','other')];rows.push(rows[3]);write(c,rows);
  const manifest=await snapshot.snapshotData(c,file(c,'one'));
  assert.deepEqual(manifest.counts,{train:1,validation:0,test:1,deduplicated:1,overlapExcluded:2});assert.equal(manifest.uniquePositions,2);assert.equal(manifest.families,3);assert.equal(manifest.selection.sourceRows,5);
 });
 await check('bounded selection includes historical and recent experience and independent holdout families',async()=>{
  const c=context('bounded',8),rows=[];for(let i=0;i<160;i++){const r=row('train-'+i,'train-family-'+Math.floor(i/4),'train');r.provenance.age=i<120?'history':'recent';rows.push(r);}for(const split of ['validation','test'])for(let i=0;i<20;i++)rows.push(row(split+'-'+i,split+'-family-'+i,split));write(c,rows);const original=S.fileHash(path.join(c.dir,'dataset.jsonl'));
  const a=await snapshot.snapshotData(c,file(c,'a')),b=await snapshot.snapshotData(c,file(c,'b')),selected=read(file(c,'a'));
  assert.equal(selected.length,8);assert.equal(a.sha256,b.sha256);assert.equal(a.selection.selectedSamples,8);assert.equal(a.selection.sourceRows,200);assert.equal(a.selection.omittedEligibleSamples,192);
  assert.ok(a.selection.mix.train.recent>0&&a.selection.mix.train.history>0);assert.ok(a.selectedFamilies.train>=2&&a.selectedFamilies.validation>=2&&a.selectedFamilies.test>=1);
  assert.ok(selected.some(r=>r.split==='train'&&r.provenance.age==='history'));assert.ok(selected.some(r=>r.split==='train'&&r.provenance.age==='recent'));
  const byId=new Map(rows.map(r=>[r.sampleId,r]));for(const r of selected)assert.deepEqual(r,byId.get(r.sampleId));assert.equal(S.fileHash(path.join(c.dir,'dataset.jsonl')),original);
  const families=read(path.join(path.dirname(file(c,'a')),a.familyManifest.file));assert.equal(families.reduce((n,f)=>n+f.samples,0),8);assert.equal(a.familyManifest.sha256,S.fileHash(path.join(path.dirname(file(c,'a')),a.familyManifest.file)));
 });
 await check('a completed snapshot stays immutable after new archived experience arrives',async()=>{
  const c=context('immutable',4);write(c,[row('t1','train1','train'),row('t2','train2','train'),row('v1','val1','validation'),row('f1','test1','test')]);const destination=file(c,'one'),first=await snapshot.snapshotData(c,destination);
  S.append(path.join(c.dir,'dataset.jsonl'),row('t3','train3','train'));const again=await snapshot.snapshotData(c,destination);assert.equal(again.sha256,first.sha256);assert.equal(again.selection.sourceRows,4);assert.equal(read(destination).length,4);
  const next=await snapshot.snapshotData(c,file(c,'two'));assert.equal(next.selection.sourceRows,5);assert.equal(next.selection.selectedSamples,4);
  fs.appendFileSync(destination,'tamper');await assert.rejects(()=>snapshot.snapshotData(c,destination),/Fixed training snapshot changed/);
 });
 await check('holdouts excluded from the bounded subset still quarantine source-wide training overlap',async()=>{
  const c=context('quarantine',8),rows=[];for(let i=0;i<20;i++)rows.push(row('train-'+i,'train-'+i,'train'));for(let i=0;i<10;i++)rows.push(row('val-'+i,'val-'+i,'validation'));for(let i=0;i<100;i++)rows.push(row('test-'+i,'test-'+i,'test'));write(c,rows);
  await snapshot.snapshotData(c,file(c,'first'));const used=new Set(read(file(c,'first')).filter(r=>r.split==='test').map(r=>r.sampleId)),reserved=rows.find(r=>r.split==='test'&&!used.has(r.sampleId));assert.ok(reserved);
  S.append(path.join(c.dir,'dataset.jsonl'),row('forbidden-new-train','new-train-family','train',reserved.positionKey));const next=await snapshot.snapshotData(c,file(c,'next')),selected=read(file(c,'next'));
  assert.equal(next.counts.overlapExcluded,1);assert.equal(next.selection.eligibleCounts.train,20);assert.ok(!selected.some(r=>r.sampleId==='forbidden-new-train'));assert.ok(!selected.some(r=>r.sampleId===reserved.sampleId));
 });
 await check('test targets and features remain reserved while aliases preserve original-family split assignment',async()=>{
  const c=context('reserved',8),final=row('reserved','test-family','test');final.features=final.target='intentionally unopened';write(c,[row('train','old-alias','validation'),row('validation','validation-family','validation'),final]);S.atomic(path.join(c.dir,'family-groups.json'),{aliases:{'old-alias':'original-family'},groups:[{familyId:'original-family',split:'train'}]});
  const report=await snapshot.snapshotData(c,file(c,'one')),selected=read(file(c,'one'));assert.equal(report.counts.train,1);assert.equal(report.counts.test,1);assert.equal(selected.find(r=>r.sampleId==='train').familyId,'original-family');assert.equal(selected.find(r=>r.sampleId==='reserved').features,'intentionally unopened');
 });
 await check('family leakage is rejected before publishing and raw experience is preserved',async()=>{
  const c=context('leak');write(c,[row('one','same-family','train'),row('two','same-family','validation')]);const before=S.fileHash(path.join(c.dir,'dataset.jsonl'));
  await assert.rejects(()=>snapshot.snapshotData(c,file(c,'one')),/Source family crosses data splits/);assert.equal(fs.existsSync(file(c,'one')),false);assert.equal(S.fileHash(path.join(c.dir,'dataset.jsonl')),before);assert.equal(fs.existsSync(path.join(c.dir,'snapshot-build','runner.lock')),false);
 });
 await check('successive family aliases resolve canonically and prior training cannot become final test',async()=>{
  const c=context('alias-chain');c.state.familySplits={'old-family':'train'};S.atomic(path.join(c.dir,'family-groups.json'),{aliases:{'old-family':'middle-family','middle-family':'canonical-family','canonical-family':'canonical-family'},groups:[{familyId:'canonical-family',split:'test'}]});
  write(c,[row('old','old-family','train'),row('middle','middle-family','test'),row('val','val','validation'),row('test','test','test')]);const manifest=await snapshot.snapshotData(c,file(c,'one')),selected=read(file(c,'one'));
  assert.equal(manifest.counts.train,2);assert.ok(selected.filter(r=>['old','middle'].includes(r.sampleId)).every(r=>r.familyId==='canonical-family'&&r.split==='train'));
  const cycle=context('alias-cycle');S.atomic(path.join(cycle.dir,'family-groups.json'),{aliases:{a:'b',b:'a'},groups:[]});write(cycle,[row('one','a','train')]);await assert.rejects(()=>snapshot.snapshotData(cycle,file(cycle,'one')),/Family alias cycle/);assert.equal(fs.existsSync(file(cycle,'one')),false);
  assert.throws(()=>snapshot.resolveAlias('0',n=>String(Number(n)+1)),/exceeds256 links/);
 });
 await check('disk byte offsets preserve Korean UTF-8, BOM, CRLF and an unterminated final row',async()=>{
  const c=context('unicode'),rows=[row('train','train','train'),row('validation','validation','validation'),row('test','test','test')];rows.forEach(r=>r.source.description='패배 기보와 주도권 회복 🌲');
  S.atomic(path.join(c.dir,'dataset.jsonl'),'\uFEFF'+rows.map(JSON.stringify).join('\r\n'));const manifest=await snapshot.snapshotData(c,file(c,'one'));assert.equal(manifest.selection.sourceRows,3);assert.deepEqual(read(file(c,'one')),rows);
 });
 await check('interrupted publication rolls back only derived outputs and can be retried',async()=>{
  const c=context('publication'),destination=file(c,'one');write(c,[row('train','train','train'),row('validation','validation','validation'),row('test','test','test')]);const before=S.fileHash(path.join(c.dir,'dataset.jsonl')),original=S.atomic;
  try{S.atomic=(target,value)=>{if(target===destination+'.manifest.json')throw Error('injected manifest-save failure');return original(target,value);};await assert.rejects(()=>snapshot.snapshotData(c,destination),/injected manifest-save failure/);}finally{S.atomic=original;}
  assert.equal(fs.existsSync(destination),false);assert.equal(fs.existsSync(destination+'.families.jsonl'),false);assert.equal(fs.existsSync(path.join(c.dir,'snapshot-build','runner.lock')),false);assert.equal(S.fileHash(path.join(c.dir,'dataset.jsonl')),before);assert.equal((await snapshot.snapshotData(c,destination)).selection.selectedSamples,3);
 });
 for(let cap=1;cap<=20;cap++){const q=snapshot.quotas({train:10,validation:3,test:2},cap);assert.equal(Object.values(q).reduce((a,b)=>a+b,0),Math.min(cap,15));assert.ok(q.train<=10&&q.validation<=3&&q.test<=2);}
 console.log(JSON.stringify({passed,quotaBoundsChecked:20,artifacts:root}));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
