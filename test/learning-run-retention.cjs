'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const R=require('../tools/learning/run-retention.cjs');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'omok-run-retention-')),roots=[];
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const options={activeModel:null},cases=[];
function root(){const dir=path.join(base,'fixture-'+roots.length);fs.mkdirSync(dir);roots.push(dir);return dir;}
function write(file,value){fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}
function run(storage,id,day,{state={},dashboard=null,lock=null}={}){const dir=path.join(storage,id);fs.mkdirSync(dir);write(path.join(dir,'state.json'),{schemaVersion:1,runId:id,status:'complete',phase:'complete',createdAt:'2026-10-'+String(day).padStart(2,'0')+'T00:00:00.000Z',rulesId:'15x15-exact5-both33-v1',featureVersion:'house32-v1',identity:{sourceHash:'1'.repeat(64),harnessHash:'2'.repeat(64)},...state});write(path.join(dir,'settings.json'),{continuous:true,minutes:60});write(path.join(dir,'dataset.jsonl'),'kept raw training experience\n');if(dashboard)write(path.join(dir,'dashboard.json'),dashboard);if(lock)write(path.join(dir,'runner.lock'),lock);return dir;}
function sourceMarker(destination,source,complete){const hashes={'state.json':hash(fs.readFileSync(path.join(source,'state.json')))},value={schemaVersion:1,source,sourceRun:path.basename(source),sourceIdentity:{sourceHash:'1'.repeat(64),harnessHash:'2'.repeat(64)},hashes,sourceId:hash([source,hashes]),complete};write(path.join(destination,'continuation.json'),value);return value;}
function seal(destination,marker){const registry={bytes:0,sha256:null},sources=[{source:marker.source,hashes:marker.hashes,continuationSourceId:null}],proof={schemaVersion:1,rulesId:'15x15-exact5-both33-v1',featureVersion:'house32-v1',continuationSourceId:marker.sourceId,registry,sources};proof.proofHash=hash([proof.continuationSourceId,registry,sources]);write(path.join(destination,'temporal-exposures-lineage.json'),proof);}
function fixture(count=5){const storage=root();for(let n=1;n<=count;n++)run(storage,'run-'+n,n);return storage;}
function test(name,callback){callback();cases.push(name);}
async function main(){try{
 test('chronology uses saved creation timestamps, not lexical ID or update time',()=>{
  const storage=root();run(storage,'z-old',1,{dashboard:{createdAt:'2026-10-09T00:00:00Z'},state:{updatedAt:'2099-01-01T00:00:00Z'}});run(storage,'a-new',9);run(storage,'middle',5);
  const plan=R.planRetention(storage,options);assert.deepEqual(plan.latestIds,['a-new','middle','z-old']);assert.equal(plan.runs[2].createdAtSource,'state.createdAt');
 });
 test('dashboard timestamps and strict ID timestamps precede undated ID fallback',()=>{
  const storage=root();run(storage,'dashboard',1,{state:{createdAt:'invalid'},dashboard:{createdAt:'2026-10-08T06:00:00.000Z'}});run(storage,'run-20261008050000000-abc',1,{state:{createdAt:null}});run(storage,'z-undated',1,{state:{createdAt:null}});run(storage,'a-undated',1,{state:{createdAt:null}});
  const rows=R.inventory(storage,options).runs;assert.deepEqual(rows.map(row=>row.id),['dashboard','run-20261008050000000-abc','z-undated','a-undated']);assert.deepEqual(rows.map(row=>row.createdAtSource),['dashboard.createdAt','run-id-timestamp','run-id-lexical','run-id-lexical']);
 });
 test('exactly newest three are retained; retired bytes remain recoverable',()=>{
  const storage=fixture(),oldState=fs.readFileSync(path.join(storage,'run-1','state.json')),oldLock={pid:2147483647,startedAt:'old'};write(path.join(storage,'run-1','runner.lock'),oldLock);const expectedBytes=R.planRetention(storage,options).toRecycle.reduce((n,row)=>n+fs.readdirSync(row.dir).reduce((m,name)=>m+fs.statSync(path.join(row.dir,name)).size,0),0),result=R.enforceRetention(storage,options);
  assert.equal(result.remainingCount,3);assert.deepEqual(result.remainingIds,['run-5','run-4','run-3']);assert.equal(result.recycled.length,2);assert.equal(result.recycledBytes,expectedBytes);assert.equal(result.freedBytes,0);assert(!fs.existsSync(path.join(storage,'run-1')));
  const retired=result.recycled.find(row=>row.id==='run-1'),manifest=JSON.parse(fs.readFileSync(retired.manifest));assert.equal(manifest.status,'completed');assert.equal(manifest.originalPath,path.join(storage,'run-1'));assert.equal(manifest.bytes,retired.bytes);assert(fs.readFileSync(path.join(retired.destination,'state.json')).equals(oldState));assert.deepEqual(JSON.parse(fs.readFileSync(path.join(retired.destination,'runner.lock'))),oldLock);
  R.restoreRetained(storage,retired.transactionId,options);assert(fs.readFileSync(path.join(storage,'run-1','state.json')).equals(oldState));assert.equal(JSON.parse(fs.readFileSync(retired.manifest)).status,'restored');assert.equal(R.enforceRetention(storage,options).remainingCount,3);
 });
 test('new experiment creation automatically retires the fourth newest',()=>{
  const storage=fixture(3);R.withRetentionLock(storage,lease=>{run(storage,'run-4',4);const result=R.enforceRetention(storage,{...options,lease,activeIds:['run-4']});assert.equal(result.remainingCount,3);assert.deepEqual(result.remainingIds,['run-4','run-3','run-2']);});
 });
 test('live runner locks and explicit active IDs cannot be relocated',()=>{
  const storage=fixture();write(path.join(storage,'run-1','runner.lock'),{pid:process.pid});const result=R.enforceRetention(storage,{...options,activeIds:['run-2']});assert.equal(result.remainingCount,5);assert.deepEqual(result.extraProtectedIds,['run-2','run-1']);assert.equal(result.recycled.length,0);assert(fs.existsSync(path.join(storage,'run-1','dataset.jsonl')));
 });
 test('late active protection is rechecked immediately before the move',()=>{
  const storage=fixture(4),active=[];const result=R.enforceRetention(storage,{...options,getActiveIds:()=>active,beforeMove:row=>active.push(row.id)});assert.equal(result.remainingCount,4);assert.equal(result.recycled.length,0);assert.equal(result.skipped.length,1);assert(!fs.existsSync(path.join(storage,'run-1','runner.lock')));
 });
 test('a new run appearing during cleanup changes the retained set',()=>{
  const storage=fixture(4);let created=false;const result=R.enforceRetention(storage,{...options,beforeMove:()=>{if(!created){created=true;run(storage,'new-run',9);}}});assert.deepEqual(result.remainingIds,['new-run','run-4','run-3']);assert.equal(result.recycled.length,2);
 });
 test('continuation ancestors are separated with registered original-path bridges',()=>{
  const storage=fixture(6),ancestor=path.join(storage,'run-1'),parent=path.join(storage,'run-2'),latest=path.join(storage,'run-6');sourceMarker(parent,ancestor,true);sourceMarker(latest,parent,true);const stateBytes=fs.readFileSync(path.join(parent,'state.json')),continuationBytes=fs.readFileSync(path.join(parent,'continuation.json')),plan=R.planRetention(storage,options);assert.deepEqual(plan.toPreserve.map(row=>row.id),['run-2','run-1']);
  const result=R.enforceRetention(storage,options);assert.equal(result.remainingCount,3);assert.equal(result.preservedDependencies.length,2);assert.equal(result.recycled.length,1);assert(result.preservedDependencyBytes>0);assert.equal(result.freedBytes,0);
  for(const id of ['run-1','run-2'])assert(fs.lstatSync(path.join(storage,id)).isSymbolicLink());assert(fs.readFileSync(path.join(parent,'state.json')).equals(stateBytes));assert(fs.readFileSync(path.join(parent,'continuation.json')).equals(continuationBytes));assert.equal(R.inventory(storage,options).warnings.length,0);assert.deepEqual(R.inventory(storage,options).runs.map(row=>row.id),['run-6','run-5','run-4']);assert.equal(R.enforceRetention(storage,options).preservedDependencies.length,0);
  const retired=result.preservedDependencies.find(row=>row.id==='run-2');R.restoreRetained(storage,retired.transactionId,options);assert(fs.lstatSync(parent).isDirectory());assert(fs.readFileSync(path.join(parent,'continuation.json')).equals(continuationBytes));
 });
 test('verified complete exposure lineage no longer requires its ancestor directory',()=>{
  const storage=fixture(4),latest=path.join(storage,'run-4'),ancestor=path.join(storage,'run-1'),marker=sourceMarker(latest,ancestor,true);seal(latest,marker);const plan=R.planRetention(storage,options);assert.equal(plan.toPreserve.length,0);assert.deepEqual(plan.toRecycle.map(row=>row.id),['run-1']);const result=R.enforceRetention(storage,options);assert.equal(result.remainingCount,3);assert.equal(result.preservedDependencies.length,0);
 });
 test('unfinished continuation sources stay at the original real path',()=>{
  const storage=fixture(4);sourceMarker(path.join(storage,'run-4'),path.join(storage,'run-1'),false);const result=R.enforceRetention(storage,options);assert.equal(result.remainingCount,4);assert.deepEqual(result.extraProtectedIds,['run-1']);assert.equal(result.preservedDependencies.length,0);assert(fs.lstatSync(path.join(storage,'run-1')).isDirectory());
 });
 test('pending import reservation protects its source before the continuation manifest exists',()=>{
  const storage=fixture(4),latest=path.join(storage,'run-4'),state=JSON.parse(fs.readFileSync(path.join(latest,'state.json')));state.pendingContinuationSource=path.join(storage,'run-1');write(path.join(latest,'state.json'),state);const result=R.enforceRetention(storage,options);assert.equal(result.remainingCount,4);assert.deepEqual(result.extraProtectedIds,['run-1']);assert.equal(result.preservedDependencies.length,0);assert(fs.lstatSync(path.join(storage,'run-1')).isDirectory());assert(!fs.existsSync(path.join(latest,'continuation.json')));
 });
 test('dashboard-only pending imports protect their source before runner initialization',()=>{
  const storage=fixture(4),latest=path.join(storage,'run-4');fs.unlinkSync(path.join(latest,'state.json'));write(path.join(latest,'dashboard.json'),{createdAt:'2026-10-04T00:00:00.000Z',fromRun:'run-1'});const result=R.enforceRetention(storage,options);assert.equal(result.remainingCount,4);assert.deepEqual(result.extraProtectedIds,['run-1']);assert.equal(result.preservedDependencies.length,0);assert(fs.lstatSync(path.join(storage,'run-1')).isDirectory());
 });
 test('stopped unfinished imports pin their source but allow completed ancestors to bridge',()=>{
  const storage=fixture(6);sourceMarker(path.join(storage,'run-6'),path.join(storage,'run-5'),false);sourceMarker(path.join(storage,'run-5'),path.join(storage,'run-1'),true);sourceMarker(path.join(storage,'run-1'),path.join(storage,'run-2'),true);const result=R.enforceRetention(storage,options);assert.equal(result.remainingCount,3);assert.equal(result.preservedDependencies.length,2);assert(fs.lstatSync(path.join(storage,'run-5')).isDirectory());for(const id of ['run-1','run-2'])assert(fs.lstatSync(path.join(storage,id)).isSymbolicLink());
 });
 test('active experiments also protect their transitive source dependencies from moves',()=>{
  const storage=fixture(5);sourceMarker(path.join(storage,'run-1'),path.join(storage,'run-2'),true);const result=R.enforceRetention(storage,{...options,activeIds:['run-1']});assert.equal(result.remainingCount,5);assert.equal(result.preservedDependencies.length,0);assert.deepEqual(result.extraProtectedIds,['run-2','run-1']);
 });
 test('active model and pending/inherited model exposure sidecars retain dependency paths',()=>{
  const storage=fixture(6),latest=path.join(storage,'run-6'),state=JSON.parse(fs.readFileSync(path.join(latest,'state.json')));state.pendingModelExposure={runDir:path.join(storage,'run-1')};state.inheritedModelExposure={runDir:path.join(storage,'run-2')};write(path.join(latest,'state.json'),state);const result=R.enforceRetention(storage,{activeModel:{adoption:{exposure:{runDir:path.join(storage,'run-3')}}}});assert.equal(result.remainingCount,3);assert.equal(result.preservedDependencies.length,3);for(const id of ['run-1','run-2','run-3'])assert(fs.lstatSync(path.join(storage,id)).isSymbolicLink());
 });
 test('dependency rename interruption recovers the bridge and removes only its own claim',()=>{
  const storage=fixture(4);sourceMarker(path.join(storage,'run-4'),path.join(storage,'run-1'),true);assert.throws(()=>R.enforceRetention(storage,{...options,afterRename:()=>{throw Error('simulated crash');}}),/simulated crash/);assert(!fs.existsSync(path.join(storage,'run-1')));const recovered=R.recoverRetention(storage,options);assert.equal(recovered.length,1);assert.equal(recovered[0].status,'dependency-preserved');assert(fs.lstatSync(path.join(storage,'run-1')).isSymbolicLink());assert(!fs.existsSync(path.join(storage,'run-1','runner.lock')));assert.equal(R.inventory(storage,options).runs.length,3);assert.equal(R.recoverRetention(storage,options).length,0);
 });
 test('recycle rename interruption recovers its receipt without deleting data',()=>{
  const storage=fixture(4);assert.throws(()=>R.enforceRetention(storage,{...options,afterRename:()=>{throw Error('simulated crash');}}),/simulated crash/);const recovered=R.recoverRetention(storage,options);assert.equal(recovered.length,1);assert.equal(recovered[0].status,'recycled');const tx=fs.readdirSync(path.join(storage,'.recycle'))[0];assert(fs.existsSync(path.join(storage,'.recycle',tx,'run','dataset.jsonl')));assert(!fs.existsSync(path.join(storage,'.recycle',tx,'run','runner.lock')));
 });
 test('metadata changes during relocation fail safely before rename',()=>{
  const storage=fixture(4);assert.throws(()=>R.enforceRetention(storage,{...options,beforeMove:row=>{const value=JSON.parse(fs.readFileSync(path.join(row.dir,'state.json')));value.edited=true;write(path.join(row.dir,'state.json'),value);}}),/metadata changed/);assert(fs.existsSync(path.join(storage,'run-1')));assert(!fs.existsSync(path.join(storage,'run-1','runner.lock')));assert.equal(R.recoverRetention(storage,options)[0].status,'cancelled-before-move');
 });
 test('arbitrary external junctions are never traversed or relocated',()=>{
  const storage=fixture(3),external=path.join(base,'outside-junction');fs.mkdirSync(external);write(path.join(external,'state.json'),{secret:'outside'});fs.symlinkSync(external,path.join(storage,'run-external'),'junction');const result=R.enforceRetention(storage,options);assert.equal(result.remainingCount,3);assert(result.warnings.some(text=>text.includes('Unregistered linked experiment')));assert.equal(JSON.parse(fs.readFileSync(path.join(external,'state.json'))).secret,'outside');
 });
 test('linked run contents are preserved without following the link',()=>{
  const storage=fixture(4),external=path.join(base,'outside-contents');fs.mkdirSync(external);write(path.join(external,'payload'),'outside');fs.symlinkSync(external,path.join(storage,'run-1','linked'),'junction');const result=R.enforceRetention(storage,options);assert.equal(result.remainingCount,4);assert.equal(result.skipped.length,1);assert.match(result.skipped[0].reason,/linked run contents/);assert.equal(fs.readFileSync(path.join(external,'payload'),'utf8'),'outside');
 });
 test('live maintenance locks prevent overlapping creation or cleanup',()=>{
  const storage=fixture(4);R.withRetentionLock(storage,()=>{assert.throws(()=>R.enforceRetention(storage,options),/already in progress/);assert.throws(()=>R.withRetentionLock(storage,()=>{}),/already in progress/);});assert(!fs.existsSync(path.join(storage,'.run-retention.lock')));write(path.join(storage,'.run-retention.lock'),{pid:2147483647,token:'stale'});assert.equal(R.enforceRetention(storage,options).remainingCount,3);
 });
 test('corrupted experiment metadata fails closed with a protected exception',()=>{
  const storage=fixture(4);write(path.join(storage,'run-1','state.json'),'invalid json');const result=R.enforceRetention(storage,options);assert.equal(result.remainingCount,4);assert.deepEqual(result.extraProtectedIds,['run-1']);assert.equal(result.recycled.length,0);assert.throws(()=>R.planRetention(storage,{...options,keep:0}),/positive integer/);
 });
 test('tampered retention receipt boundaries reject recovery',()=>{
  const storage=fixture(4),result=R.enforceRetention(storage,options),retired=result.recycled[0],manifest=JSON.parse(fs.readFileSync(retired.manifest));manifest.destination=path.join(base,'outside');write(retired.manifest,manifest);assert.throws(()=>R.recoverRetention(storage,options),/escaped storage/);assert(fs.existsSync(path.join(retired.destination,'dataset.jsonl')));
 });
 {
  const storage=fixture(6),children=[],{EventEmitter}=require('node:events'),{createDashboard}=require('../tools/learning/dashboard.cjs');sourceMarker(path.join(storage,'run-6'),path.join(storage,'run-1'),true);
  const app=createDashboard({repo:storage,runsRoot:storage,runner:path.resolve(__dirname,'../tools/learning/run.cjs'),continuationPreflight:()=>{},spawnChild:(_executable,args)=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();children.push(child);const dir=args.find(arg=>arg.startsWith('--run=')).slice(6);write(path.join(dir,'state.json'),{schemaVersion:1,runId:path.basename(dir),createdAt:new Date().toISOString(),status:'running',phase:'import',counters:{completedGames:0,samples:0}});return child;}});
  try{
   const {url}=await app.listen(0),session=await(await fetch(url+'/api/session')).json(),get=async()=>await(await fetch(url+'/api/status')).json();let status=await get();assert.equal(status.runs.length,3);assert.deepEqual(status.runs.map(row=>row.id),['run-6','run-5','run-4']);assert(!status.retention.error);assert.equal(status.retention.preservedDependencies.length,1);assert(!status.runs.some(row=>row.id==='run-1'));const aliasResume=await fetch(url+'/api/resume',{method:'POST',headers:{'Content-Type':'application/json','X-Omok-Session':session.token},body:JSON.stringify({id:'run-1'})});assert.equal(aliasResume.status,409);assert.equal(children.length,0);
   const response=await fetch(url+'/api/start',{method:'POST',headers:{'Content-Type':'application/json','X-Omok-Session':session.token},body:JSON.stringify({preset:'continuous',fromRun:'run-6'})});assert.equal(response.status,201);const started=await response.json();status=await get();assert.equal(status.runs.length,3);assert.equal(status.activeId,started.id);assert.equal(status.retention.remainingCount,3);assert(fs.existsSync(path.join(storage,started.id,'state.json')));
   for(const [id,day] of [['future-1',10],['future-2',11],['future-3',12],['future-4',13]])run(storage,id,day,{state:{createdAt:new Date(Date.now()+(day-9)*86400000).toISOString()}});const held=R.enforceRetention(storage,{...options,activeIds:[started.id],protectedIds:['run-6']});assert.equal(held.remainingCount,5);assert(held.remainingIds.includes(started.id));assert(held.remainingIds.includes('run-6'));
   children[0].emit('exit',0,null);status=await get();assert.equal(status.activeId,null);assert.equal(status.runs.length,3);assert.deepEqual(status.runs.map(row=>row.id),['future-4','future-3','future-2']);assert.equal(status.retention.remainingCount,3);assert(!status.retention.error);assert(!fs.existsSync(path.join(storage,started.id)));cases.push('dashboard startup, fake launch and child exit apply retention and exclude registered aliases');
  }finally{await app.close({stopRuns:false});}
 }
 console.log(JSON.stringify({passed:cases.length,scope:'Whole-run chronology, newest three, recoverable bytes and restore, original-path dependency bridges and crash recovery, live and late-active protection, incomplete imports, model provenance, metadata changes, cross-boundary links, and overlapping maintenance'}));
}finally{
 const resolved=path.resolve(base);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});
}}
main().catch(error=>{console.error(error);process.exitCode=1;});
