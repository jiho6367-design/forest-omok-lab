'use strict';
// Isolated saved-run fixtures and mocked processes. No production run is opened
// or resumed, and the API must leave its saved settings and evidence untouched.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{EventEmitter}=require('node:events');
const {createDashboard}=require('../tools/learning/dashboard.cjs'),archive=require('../tools/learning/archive.cjs');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'omok-resume-budget-test-')),runsRoot=path.join(temporary,'runs'),GiB=1024**3;
const runner=path.resolve(__dirname,'../tools/learning/run.cjs'),python='C:\\trusted runtime\\python.exe',calls=[],children=[];
const originalSelectResumeRunner=archive.selectResumeRunner;
let app,port,token;
fs.mkdirSync(runsRoot);
function write(run,name,value){fs.writeFileSync(path.join(run,name),JSON.stringify(value,null,2)+'\n');}
function fixture(id,state={},settings={}){
  const run=path.join(runsRoot,id);fs.mkdirSync(run);
  write(run,'state.json',{schemaVersion:1,runId:id,status:'stopped',phase:'generate',cycle:3,trial:69,stopReason:{kind:'disk-budget',message:'Saved budget stop'},counters:{completedGames:2408,samples:10001},...state});
  write(run,'settings.json',{maxDiskBytes:16*GiB,workers:13,epochs:20,continuous:true,seed:1707,pairs:64,minPairs:32,validationMs:1000,learningRate:.0003,...settings});
  write(run,'arena.summary.json',{complete:true,cycle:2,trial:69,candidateModelId:'preserved',candidateHash:'d'.repeat(64),identity:{sourceHash:'a'.repeat(64),harnessHash:'b'.repeat(64),runtimeHash:'c'.repeat(64)},passed:false});
  fs.writeFileSync(path.join(run,'stop.flag'),'preserved stop\n');
  return run;
}
const savedFiles=run=>Object.fromEntries(['state.json','settings.json','arena.summary.json','stop.flag'].map(name=>[name,fs.readFileSync(path.join(run,name),'utf8')]));
function fakeSpawn(executable,args,options){const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();calls.push({executable,args,options});children.push(child);return child;}
function request(method,route,value){const payload=value==null?'':JSON.stringify(value);return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:method==='POST'?{'Content-Type':'application/json','X-Omok-Session':token}:{}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,data:JSON.parse(text)});});});req.on('error',reject);if(payload)req.write(payload);req.end();});}
async function listen(options={}){app=createDashboard({repo:temporary,runsRoot,retention:false,spawnChild:fakeSpawn,python,...options});({port}=await app.listen(0));token=(await request('GET','/api/session')).data.token;}
async function rejected(body,status,run){const beforeCalls=calls.length,before=run?savedFiles(run):null,result=await request('POST','/api/resume',body);assert.equal(result.status,status,JSON.stringify(body));assert.match(result.data.error,/[가-힣]/);assert.equal(calls.length,beforeCalls,'Rejected resume must not spawn a runner');if(run)assert.deepEqual(savedFiles(run),before,'Rejected resume must preserve saved evidence and settings');}
function expectedArgs(run,budget,prefix=[]){return [runner,...prefix,'cycle','--run='+run,'--python='+python,'--device=cuda','--resume',...(budget===undefined?[]:['--max-disk-gb='+budget])];}
(async()=>{
  const stopped=fixture('budget-stopped'),before=savedFiles(stopped),id=path.basename(stopped);
  await listen({runner});
  for(const invalidId of [undefined,null,'','..','../budget-stopped','a/b',42])await rejected({id:invalidId,maxDiskGiB:24},400,stopped);
  await rejected({id:'absent',maxDiskGiB:24},404,stopped);
  for(const maxDiskGiB of [null,false,true,0,-1,1.5,'24',{},[],Number.MAX_SAFE_INTEGER,8388608])await rejected({id,maxDiskGiB},400,stopped);
  for(const maxDiskGiB of [1,15,16])await rejected({id,maxDiskGiB},400,stopped);
  for(const extra of [{config:{workers:16}},{workers:16},{python:'untrusted'},{device:'cpu'},{pairs:2048},{learningRate:1}])await rejected({id,maxDiskGiB:24,...extra},400,stopped);
  for(const [suffix,state] of [['running',{status:'running'}],['failed',{status:'failed'}],['complete',{status:'complete'}],['user-stop',{stopReason:{kind:'user'}}],['no-reason',{stopReason:null}]]){const run=fixture('invalid-'+suffix,state);await rejected({id:path.basename(run),maxDiskGiB:24},409,run);}
  for(const [suffix,maxDiskBytes] of [['missing',undefined],['null',null],['zero',0],['negative',-1],['string','17179869184']]){const run=fixture('invalid-budget-'+suffix,{}, {maxDiskBytes});await rejected({id:path.basename(run),maxDiskGiB:24},400,run);}
  const omitted=await request('POST','/api/resume',{id});assert.equal(omitted.status,200);assert.deepEqual(calls.at(-1).args,expectedArgs(stopped));assert.deepEqual(savedFiles(stopped),before);assert.equal(calls.at(-1).options.shell,false);assert.equal(calls.at(-1).options.windowsHide,true);assert.equal(calls.at(-1).options.cwd,temporary);
  await rejected({id,maxDiskGiB:24},409,stopped);children.at(-1).emit('exit',0,null);
  const raised=await request('POST','/api/resume',{id,maxDiskGiB:24});assert.equal(raised.status,200);assert.deepEqual(calls.at(-1).args,expectedArgs(stopped,24),'Only the explicit storage budget may be added to a resume');assert.equal(calls.at(-1).executable,process.execPath);assert.deepEqual(savedFiles(stopped),before,'The runner owns saving its new storage budget');children.at(-1).emit('exit',0,null);
  fs.writeFileSync(path.join(stopped,'runner.lock'),JSON.stringify({pid:process.pid}));await rejected({id,maxDiskGiB:24},409,stopped);fs.unlinkSync(path.join(stopped,'runner.lock'));
  const fractional=fixture('fractional-saved-budget',{}, {maxDiskBytes:16.5*GiB});assert.equal((await request('POST','/api/resume',{id:path.basename(fractional),maxDiskGiB:17})).status,200);assert.deepEqual(calls.at(-1).args,expectedArgs(fractional,17));children.at(-1).emit('exit',0,null);
  const large=fixture('compact-saved-status',{padding:'x'.repeat(2*1024*1024)}),largeBefore=savedFiles(large);write(large,'progress.json',{status:'stopped',stopReason:{kind:'disk-budget'},updatedAt:'2026-10-10T00:00:00.000Z'});assert.equal((await request('POST','/api/resume',{id:path.basename(large),maxDiskGiB:24})).status,200);assert.deepEqual(calls.at(-1).args,expectedArgs(large,24));assert.deepEqual(savedFiles(large),largeBefore);children.at(-1).emit('exit',0,null);
  const latest=fixture('newer-running-progress',{updatedAt:'2026-10-10T00:00:00.000Z'});write(latest,'progress.json',{status:'running',updatedAt:'2026-10-10T00:00:01.000Z'});await rejected({id:path.basename(latest),maxDiskGiB:24},409,latest);
  const maximum=await request('POST','/api/resume',{id,maxDiskGiB:8388607});assert.equal(maximum.status,200);assert.deepEqual(calls.at(-1).args,expectedArgs(stopped,8388607));assert(Number.isSafeInteger(8388607*GiB));children.at(-1).emit('exit',0,null);
  await app.close({stopRuns:false});app=null;
  const archivedRunner=path.join(temporary,'tools','learning','archive.cjs'),runtime='e'.repeat(64),archiveCalls=[];
  archive.selectResumeRunner=(run,options)=>{archiveCalls.push({run,options});return {runner:archivedRunner,argsPrefix:['--archived-run','--runtime='+runtime],cwd:temporary};};
  await listen();const archived=await request('POST','/api/resume',{id,maxDiskGiB:24});assert.equal(archived.status,200);assert.deepEqual(archiveCalls,[{run:stopped,options:{repo:temporary}}]);assert.deepEqual(calls.at(-1).args,[archivedRunner,'--archived-run','--runtime='+runtime,...expectedArgs(stopped,24).slice(1)]);assert.deepEqual(savedFiles(stopped),before);children.at(-1).emit('exit',0,null);
  console.log('learning-dashboard-resume-budget: explicit positive GiB increase, unchanged saved settings, stopped disk-budget restriction, pre-spawn rejection and archived dispatch passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{archive.selectResumeRunner=originalSelectResumeRunner;if(app)await app.close({stopRuns:false});const absolute=path.resolve(temporary),tempRoot=path.resolve(os.tmpdir());if(path.dirname(absolute)!==tempRoot||!path.basename(absolute).startsWith('omok-resume-budget-test-'))throw Error('Unsafe resume fixture cleanup target');fs.rmSync(absolute,{recursive:true,force:true});});
