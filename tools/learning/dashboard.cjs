'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const REPO=path.resolve(__dirname,'../..');
const MAX_UPLOAD=2*1024*1024;
const MAX_LOG=256*1024;
const MAX_HISTORY=8,MAX_HISTORY_BYTES=128*1024,MAX_RETENTION=24;
const hashPattern=/^[a-f0-9]{64}$/;
function modelHash(model){return crypto.createHash('sha256').update(JSON.stringify(model)).digest('hex');}
function compactIdentity(value){return {sourceHash:value?.sourceHash||null,harnessHash:value?.harnessHash||null,runtimeHash:value?.runtimeHash||null};}
function exactArenaIdentity(value){return Number.isSafeInteger(value?.cycle)&&value.cycle>0&&Number.isSafeInteger(value?.trial)&&value.trial>0&&typeof value?.candidateModelId==='string'&&value.candidateModelId.length>0&&value.candidateModelId.length<=160&&hashPattern.test(value.candidateHash||'')&&Object.values(compactIdentity(value.identity)).every(hash=>hashPattern.test(hash||''));}
function arenaView(value){
 if(!value)return null;if(value.unavailable)return {unavailable:value.unavailable,status:'pending',complete:false};
 const evaluationClosed=value.complete===true,unfinished=Object.values(value.stats||{}).some(stats=>Number.isFinite(stats?.unfinished)&&stats.unfinished>0),evaluationInvalid=Array.isArray(value.invalidGames)&&value.invalidGames.length>0,complete=evaluationClosed&&!unfinished&&!evaluationInvalid,identityVerified=exactArenaIdentity(value),result={cycle:value.cycle??null,trial:value.trial??null,candidateModelId:value.candidateModelId??null,candidateHash:value.candidateHash??null,identity:compactIdentity(value.identity),sourceHash:value.identity?.sourceHash||null,harnessHash:value.identity?.harnessHash||null,complete,evaluationClosed,evaluationInvalid,status:evaluationInvalid?'invalid':!complete?'pending':identityVerified?'complete':'identity-unavailable',identityVerified,finishedAt:complete?value.finishedAt||null:null,moveMs:value.moveMs??null,baselineCommit:value.baselineCommit||null,incumbentHash:value.incumbentHash||null,datasetSha256:value.datasetSha256||value.trainingCheck?.datasetHash||null,passed:complete&&identityVerified?value.passed===true:false};
 const planned=value.planning||value.requirements||{},planningKeys=['trial','confidence','alpha','independentFamilies','minPairs','requiredMeanStrictlyGreaterThan','minimumNondrawWins','games','maximumMoveBudgetMs'];result.planning=Object.fromEntries(planningKeys.filter(key=>Number.isFinite(planned[key])).map(key=>[key,planned[key]]));result.requirements=result.planning;result.pairs=Number.isSafeInteger(value.pairs)?value.pairs:null;
 // Partial observations are never exposed by status polling, even when the
 // arena writer has saved intermediate statistics or a small raw game file.
 if(complete&&identityVerified){result.stats={};result.controlIdentity={};for(const name of ['baseline','current-no-model','incumbent']){const stats=value.stats?.[name];if(!stats||!Number.isFinite(stats.meanScore)||stats.meanScore<0||stats.meanScore>1||stats.unfinished>0)continue;result.stats[name]=Object.fromEntries(['meanScore','lowerConfidenceBound','independentFamilies','wins','draws','losses','unfinished','completedGames','completedPairs'].filter(key=>Number.isFinite(stats[key])).map(key=>[key,stats[key]]));const control=value.opponentEvidence?.[name];result.controlIdentity[name]=control?.sourceHash&&control?.lessonHash?modelHash(Object.fromEntries(['sourceHash','modelHash','modelExplicitlyNull','moveMs','lessonHash'].map(key=>[key,control[key]??null]))):null;}result.summary=result.stats.baseline||null;result.reason=typeof value.reason==='string'?value.reason.slice(0,600):null;}
 return result;
}
const PRESETS={
  planned:{continuous:true,concurrentTraining:true,poweredEvaluation:true,minimumUsefulImprovement:.10,targetPower:.8,maxEvaluationPairs:2048,trainSeconds:120,learningRate:.0003,minutes:null,games:256,gamesPerCycle:512,minNewSamples:10000,recordBranchFraction:.25,maxTrainingSamples:100000,pairs:64,minPairs:32,moveMs:80,analysisMs:600,validationMs:1000,workers:13,epochs:20},
  continuous:{continuous:true,concurrentTraining:true,minutes:null,games:256,gamesPerCycle:512,minNewSamples:10000,recordBranchFraction:.25,maxTrainingSamples:100000,pairs:64,minPairs:32,moveMs:80,analysisMs:600,validationMs:1000,workers:13,epochs:20},
  check:{minutes:null,games:8,pairs:4,minPairs:32,moveMs:80,analysisMs:600,validationMs:1000,workers:1,epochs:3},
  standard:{minutes:null,games:128,pairs:32,minPairs:32,moveMs:80,analysisMs:600,validationMs:1000,workers:1,epochs:10},
  extended:{minutes:null,games:1024,pairs:64,minPairs:32,moveMs:80,analysisMs:600,validationMs:1000,workers:1,epochs:20}
};
const LIMITS={games:[1,1000000],gamesPerCycle:[1,10000],minNewSamples:[1,1000000],maxTrainingSamples:[100,1000000],pairs:[1,2048],minPairs:[32,2048],moveMs:[30,10000],analysisMs:[50,30000],validationMs:[50,30000],workers:[1,16],epochs:[1,1000]};
function inside(root,target){const relative=path.relative(root,target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
function fail(status,message){const error=new Error(message);error.status=status;return error;}
function configuration(body){
  const preset=body.preset||'check';if(!Object.hasOwn(PRESETS,preset))throw fail(400,'실행 설정이 올바르지 않습니다.');
  const config={...PRESETS[preset]};
  if(body.config!=null){if(typeof body.config!=='object'||Array.isArray(body.config))throw fail(400,'설정은 객체여야 합니다.');
    for(const [key,value] of Object.entries(body.config)){
      // Old open dashboards may still submit minutes; it no longer schedules a stop.
      if(key==='minutes'){if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)))throw fail(400,'이전 실행 시간 설정은 숫자여야 합니다.');continue;}
      if(key==='continuous'||key==='concurrentTraining'){if(typeof value!=='boolean')throw fail(400,key+'는 true 또는 false여야 합니다.');config[key]=value;continue;}
      if(key==='recordBranchFraction'){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw fail(400,'기존 기보 변형 비율은 0~1이어야 합니다.');config[key]=value;continue;}
      if(!Object.hasOwn(LIMITS,key))throw fail(400,'지원하지 않는 설정: '+key);
      const [min,max]=LIMITS[key];if(!Number.isInteger(value)||value<min||value>max)throw fail(400,`${key}는 ${min}~${max}의 정수여야 합니다.`);config[key]=value;
    }
  }
  if(config.pairs<config.minPairs)config.validationNote='검증 대국이 부족하면 후보를 채택하지 않습니다.';
  return config;
}
function createDashboard(options={}){
  const repo=path.resolve(options.repo||REPO);
  const runsRoot=path.resolve(options.runsRoot||path.join(repo,'outputs','learning','runs'));
  fs.mkdirSync(runsRoot,{recursive:true});
  const realRoot=fs.realpathSync(runsRoot);
  const runner=path.resolve(options.runner||path.join(repo,'tools','learning','run.cjs'));
  const python=options.python||path.join(require('node:os').homedir(),'Documents','Codex','.omok-runtime','Scripts','python.exe');
  const spawnChild=options.spawnChild||spawn;
  const continuationPreflight=options.continuationPreflight||((source)=>require('./corpus.cjs').continuationPreflight(source));
  const sessionToken=crypto.randomBytes(32).toString('hex');
  let active=null,port=null;
  const Retention=require('./run-retention.cjs'),retentionEnabled=options.retention!==false;
  let retentionStatus={enabled:retentionEnabled,keep:3,freedBytes:0};
  function enforceRetention(lease=null,protect=[]){
    if(!retentionEnabled)return retentionStatus;
    try{retentionStatus={enabled:true,...Retention.enforceRetention(realRoot,{repo,lease,activeIds:active?[active.id]:[],protectedIds:[...protect,...(active?.fromRun?[active.fromRun]:[])]})};}
    catch(error){retentionStatus={enabled:true,keep:3,freedBytes:0,error:error.message};if(active)log(resolveRun(active.id),JSON.stringify({dashboard:'retention-error',message:error.message,at:new Date().toISOString()})+'\n');}
    return retentionStatus;
  }
  enforceRetention();
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'};
  function resolveRun(id){
    if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id))throw fail(400,'실험 ID가 올바르지 않습니다.');
    const target=path.resolve(realRoot,id);if(!inside(realRoot,target))throw fail(400,'허용되지 않은 경로입니다.');
    if(!fs.existsSync(target)||!fs.statSync(target).isDirectory())throw fail(404,'실험을 찾을 수 없습니다.');
    const real=fs.realpathSync(target);if(!inside(realRoot,real))throw fail(403,'실험 폴더가 저장 영역 밖을 가리킵니다.');if(fs.lstatSync(target).isSymbolicLink())throw fail(409,'계보 보존 위치에 있는 실험입니다. 복원한 뒤 재개해 주세요.');return real;
  }
  function checkedFile(run,name){const target=path.join(run,name);if(!fs.existsSync(target))return null;const real=fs.realpathSync(target);if(!inside(realRoot,real)||!inside(run,real))throw fail(403,'허용되지 않은 파일입니다.');return real;}
  function readJSON(run,name,maximum=MAX_UPLOAD){try{const file=checkedFile(run,name);if(!file)return null;if(fs.statSync(file).size>maximum) return {unavailable:'파일이 커서 요약을 읽지 못했습니다.'};return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.status)throw error;return null;}}
  function metric(model,arena=null,accepted=false){
    if(!model||model.unavailable||typeof model.modelId!=='string'||model.modelId.length>160)return null;
    const original=accepted?Object.fromEntries(Object.entries(model).filter(([key])=>key!=='adoption')):model,hash=modelHash(original);
    if(accepted&&model.adoption?.accepted!==true)return null;
    if(arena&&(model.modelId!==arena.candidateModelId||hash!==arena.candidateHash||arena.datasetSha256&&model.training?.datasetHash!==arena.datasetSha256))return null;
    const mse=model.training?.validationMse;return {modelId:model.modelId,candidateHash:hash,validationMse:Number.isFinite(mse)&&mse>=0?mse:null,datasetSha256:model.training?.datasetHash||null,provenance:accepted?'preserved-accepted-model':'current-candidate'};
  }
  function candidateHistory(run,state,model,currentArena){
    const files=fs.readdirSync(run).map(name=>({name,match:/^arena-cycle-(\d+)\.summary\.json$/.exec(name)})).filter(row=>row.match&&Number.isSafeInteger(Number(row.match[1]))).sort((a,b)=>Number(b.match[1])-Number(a.match[1])),rows=[],seen=new Set();
    const add=arena=>{if(!arena||arena.unavailable)return;const key=JSON.stringify([arena.cycle,arena.trial,arena.candidateHash]);if(seen.has(key))return;seen.add(key);
      let training=metric(model,arena);if(!training&&typeof arena.candidateModelId==='string'&&/^[A-Za-z0-9._-]{1,120}$/.test(arena.candidateModelId)&&!['.','..'].includes(arena.candidateModelId))training=metric(readJSON(run,'models/'+arena.candidateModelId+'.json',MAX_HISTORY_BYTES),arena,true);
      rows.push({...arena,validationMse:training?.validationMse??null,trainingProvenance:training?.provenance||'not-preserved'});
    };
    for(const row of files.slice(0,MAX_HISTORY)){const value=readJSON(run,row.name,MAX_HISTORY_BYTES);if(value&&!value.unavailable&&value.cycle===Number(row.match[1]))add(arenaView(value));else rows.push({cycle:Number(row.match[1]),trial:null,candidateModelId:null,candidateHash:null,identity:compactIdentity(null),complete:false,status:'summary-unavailable',validationMse:null,trainingProvenance:'not-preserved'});}
    add(currentArena);const training=metric(model);
    if(training&&!rows.some(row=>row.candidateHash===training.candidateHash&&row.candidateModelId===training.modelId)){
      const match=/^cycle-(\d+)\.jsonl$/.exec(state?.dataset?.file||''),matchesSnapshot=!!training.datasetSha256&&training.datasetSha256===state?.dataset?.sha256,cycle=matchesSnapshot&&match?Number(match[1]):null;
      rows.unshift({cycle,trial:null,candidateModelId:training.modelId,candidateHash:training.candidateHash,identity:compactIdentity(state?.identity),complete:false,status:'pending',stats:null,validationMse:training.validationMse,trainingProvenance:training.provenance,datasetSha256:training.datasetSha256});
    }
    rows.sort((a,b)=>(b.cycle??Infinity)-(a.cycle??Infinity)||(b.trial??Infinity)-(a.trial??Infinity));return {limit:MAX_HISTORY,truncated:files.length>MAX_HISTORY||rows.length>MAX_HISTORY,rows:rows.slice(0,MAX_HISTORY),scope:'Model identity maps each preserved MSE to its own candidate. Only completed evaluations with recorded cycle/trial/model/source identity expose control scores. Missing historical MSE is not reconstructed.'};
  }
  function storageView(run,state,settings){
    const disk=state?.disk||{},safe=value=>Number.isFinite(value)&&value>=0?value:null,directory=checkedFile(run,'datasets'),files=directory?fs.readdirSync(directory).filter(name=>/^cycle-\d+\.jsonl\.manifest\.json\.retained\.json$/.test(name)).sort((a,b)=>Number(b.match(/cycle-(\d+)/)[1])-Number(a.match(/cycle-(\d+)/)[1])):[],records=[];
    for(const name of files.slice(0,MAX_RETENTION)){const value=readJSON(run,'datasets/'+name,MAX_HISTORY_BYTES);if(!value||value.unavailable)continue;records.push({cycle:Number(name.match(/cycle-(\d+)/)[1]),status:['prepared','completed'].includes(value.status)?value.status:'legacy',at:value.completedAt||value.prunedAt||null,retainedCaches:Array.isArray(value.retainedCaches)?value.retainedCaches.length:0});}
    return {source:'saved-storage-budget',checkedAt:disk.checkedAt||null,stage:disk.stage||null,usedBytes:safe(disk.usedBytes),reservedBytes:safe(disk.reservedBytes),heldBytes:safe(disk.heldBytes),limitBytes:safe(disk.limitBytes??settings?.maxDiskBytes),availableBytes:safe(disk.availableBytes),stoppedForBudget:state?.stopReason?.kind==='disk-budget',retention:{maxDerivedCycles:settings?.maxDerivedCycles??3,records,examinedLimit:MAX_RETENTION,truncated:files.length>MAX_RETENTION,pending:records.filter(row=>row.status==='prepared').length,completed:records.filter(row=>row.status==='completed').length,scope:'Derived snapshot/cache retirement metadata; raw experience and model files are not read or removed by this display.'}};
  }
  function runnerAlive(run){const lock=readJSON(run,'runner.lock');if(!Number.isSafeInteger(lock?.pid)||lock.pid<1)return false;try{process.kill(lock.pid,0);return true;}catch{return false;}}
  function describe(id,withDetails=true){
    const run=resolveRun(id),fullState=readJSON(run,'state.json'),progress=readJSON(run,'progress.json'),state=fullState?.unavailable?progress||fullState:progress&&(!fullState||progress.updatedAt>fullState.updatedAt)?{...fullState,...progress}:fullState,visibleState=state?.validation?{...state,validation:{...state.validation,stats:undefined,pending:state.validation.complete!==true||Object.values(state.validation.stats||{}).some(stats=>Number.isFinite(stats?.unfinished)&&stats.unfinished>0)||state.validation.rejectionReasons?.includes('invalid played game')===true}}:state,summary={id,state:visibleState,active:active?.id===id||runnerAlive(run),stopRequested:!!checkedFile(run,'stop.flag')};
    summary.settings=readJSON(run,'settings.json');
    if(withDetails){const model=readJSON(run,'candidate.json'),champion=readJSON(run,'champion.json');summary.continuation=readJSON(run,'continuation.json');summary.training=readJSON(run,'candidate.json.training.json');summary.parity=readJSON(run,'candidate.json.parity.json');summary.arena=arenaView(readJSON(run,'arena.summary.json',MAX_HISTORY_BYTES)||readJSON(run,'arena.json'));summary.adoption=readJSON(run,'adoption.json');summary.candidate=model&&!model.unavailable?{modelId:model.modelId,hash:modelHash(model),kind:model.kind,training:model.training}:null;summary.champion=champion&&!champion.unavailable?{modelId:champion.modelId,kind:champion.kind,training:champion.training}:null;summary.candidateHistory=candidateHistory(run,state,model,summary.arena);summary.storage=storageView(run,state,summary.settings);
      const logFile=checkedFile(run,'dashboard.log');if(logFile){const size=fs.statSync(logFile).size,fd=fs.openSync(logFile,'r');try{const buffer=Buffer.alloc(Math.min(size,MAX_LOG));fs.readSync(fd,buffer,0,buffer.length,Math.max(0,size-buffer.length));summary.log=buffer.toString('utf8');}finally{fs.closeSync(fd);}}
    }return summary;
  }
  function listRuns(){return fs.readdirSync(realRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(entry.name)).map(entry=>{try{const run=resolveRun(entry.name);return checkedFile(run,'state.json')||checkedFile(run,'dashboard.json')?describe(entry.name,false):null;}catch{return null;}}).filter(Boolean).sort((a,b)=>Number(b.active)-Number(a.active)||(Date.parse(b.state?.createdAt)||0)-(Date.parse(a.state?.createdAt)||0)||b.id.localeCompare(a.id)).slice(0,100);}
  function activeId(){return active?.id||listRuns().find(run=>run.active)?.id||null;}
  function log(run,text){const target=path.join(run,'dashboard.log');if(fs.existsSync(target))checkedFile(run,'dashboard.log');fs.appendFileSync(target,String(text));}
  function accumulationSource(id){
    const source=resolveRun(id);if(runnerAlive(source)||active?.id===id)throw fail(409,'진행 중인 실험은 먼저 중단한 후 이어받아 주세요.');
    const stateFile=checkedFile(source,'state.json'),settingsFile=checkedFile(source,'settings.json');if(!stateFile||!settingsFile)throw fail(400,'이어받을 실험의 상태와 설정이 없습니다.');
    let state;try{state=JSON.parse(fs.readFileSync(stateFile,'utf8'));JSON.parse(fs.readFileSync(settingsFile,'utf8'));}catch{throw fail(400,'이어받을 실험의 저장 상태를 읽을 수 없습니다.');}
    if(state.schemaVersion!==1||state.rulesId!=='15x15-exact5-both33-v1'||!state.identity?.sourceHash||!state.identity?.harnessHash)throw fail(400,'이어받을 실험의 규칙·버전 기록이 올바르지 않습니다.');
    if(!['complete','completed','stopped','failed','created'].includes(state.status))throw fail(409,'실험이 저장 후 중단된 상태인지 확인해 주세요.');
    for(const name of ['records.json','games.jsonl','dataset.jsonl','family-groups.json','lessons.json','candidate.json','champion.json','continuation.json'])checkedFile(source,name);
    return source;
  }
  function preflight(source){try{continuationPreflight(source);}catch(error){throw fail(400,'이전 모델의 학습 출처를 확인할 수 없습니다. 남은 완료 대국은 보존되어 있습니다. 이어받기 방식에서 «대국 보존 · 모델 새로 학습»을 선택해 주세요. 원인: '+error.message);}}
  function launch(id,config,resume,fromRun=null,continuationMode='verified'){
    if(!retentionEnabled)return launchInternal(id,config,resume,fromRun,continuationMode);
    return Retention.withRetentionLock(realRoot,lease=>{Retention.recoverRetention(realRoot,{lease});const result=launchInternal(id,config,resume,fromRun,continuationMode);enforceRetention(lease,fromRun?[path.basename(fromRun)]:[]);return result;});
  }
  function launchInternal(id,config,resume,fromRun=null,continuationMode='verified'){
    if(activeId())throw fail(409,'진행 중인 실험을 중단한 후 시작해 주세요.');
    if(resume){const pending=readJSON(resolveRun(id),'continuation.json');if(pending&&!pending.complete&&pending.mode!=='raw-reset')preflight(pending.source);}
    require('./deployment.cjs').recoverDeployment({root:repo});const run=resolveRun(id);let selected={runner,argsPrefix:[],cwd:repo};if(resume&&!options.runner){try{selected=require('./archive.cjs').selectResumeRunner(run,{repo});}catch(error){throw fail(400,error.message);}}
    const args=[selected.runner,...(selected.argsPrefix||[]),'cycle','--run='+run,'--python='+python,'--device=cuda'];
    if(resume)args.push('--resume');else{
      if(checkedFile(run,'uploaded-records.json'))args.push('--input='+path.join(run,'uploaded-records.json'));
      const keys={games:'games',gamesPerCycle:'games-per-cycle',minNewSamples:'min-new-samples',recordBranchFraction:'record-branch-fraction',maxTrainingSamples:'max-training-samples',pairs:'pairs',minPairs:'min-pairs',moveMs:'move-ms',analysisMs:'analysis-ms',validationMs:'validation-ms',workers:'workers',epochs:'epochs',trainSeconds:'train-seconds',learningRate:'learning-rate',minimumUsefulImprovement:'minimum-useful-improvement',targetPower:'target-power',maxEvaluationPairs:'max-evaluation-pairs'};
      for(const [key,flag] of Object.entries(keys))if(config[key]!=null)args.push('--'+flag+'='+config[key]);
      if(config.continuous)args.push('--continuous');if(fromRun)args.push('--from-run='+fromRun);
      if(fromRun&&continuationMode==='raw-reset')args.push('--continuation-mode=raw-reset','--fresh-model');
      if(config.concurrentTraining!=null)args.push('--concurrent-training='+config.concurrentTraining);
      if(config.poweredEvaluation!=null)args.push('--powered-evaluation='+config.poweredEvaluation);
    }
    const child=spawnChild(process.execPath,args,{cwd:selected.cwd||repo,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});
    active={id,child,fromRun:fromRun?path.basename(fromRun):null,startedAt:new Date().toISOString()};log(run,JSON.stringify({dashboard:'start',resume,wholeRunTimeLimit:'none',at:active.startedAt})+'\n');
    child.stdout?.on('data',data=>log(run,data));child.stderr?.on('data',data=>log(run,data));
    child.once('error',error=>{log(run,JSON.stringify({dashboard:'launch-error',message:error.message})+'\n');if(active?.child===child)active=null;});
    child.once('exit',(code,signal)=>{log(run,JSON.stringify({dashboard:'exit',code,signal,at:new Date().toISOString()})+'\n');if(active?.child===child)active=null;enforceRetention();});
    return describe(id);
  }
  function stop(id){const run=resolveRun(id);const flag=path.join(run,'stop.flag');if(fs.existsSync(flag))checkedFile(run,'stop.flag');fs.writeFileSync(flag,new Date().toISOString()+'\n');return describe(id);}
  async function body(req){let total=0,chunks=[];for await(const chunk of req){total+=chunk.length;if(total>MAX_UPLOAD)throw fail(413,'기보 파일은 2 MiB 이하로 입력해 주세요.');chunks.push(chunk);}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw fail(400,'JSON 요청 형식이 올바르지 않습니다.');}}
  const server=http.createServer(async(req,res)=>{
    function respond(status,value,type='application/json; charset=utf-8',extra={}){res.writeHead(status,{...headers,'Content-Type':type,...extra});res.end(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));}
    try{
      const host=req.headers.host;if(!port||![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))throw fail(403,'localhost 접속만 허용합니다.');
      if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))throw fail(403,'다른 사이트의 요청을 허용하지 않습니다.');
      const url=new URL(req.url,'http://'+host);
      if(req.method==='POST'){
        if(req.headers['x-omok-session']!==sessionToken)throw fail(403,'페이지를 새로 열고 다시 시도해 주세요.');
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'JSON 요청만 허용합니다.');
        const data=await body(req);
        if(url.pathname==='/api/start'){
          if(activeId())throw fail(409,'진행 중인 실험을 중단한 후 시작해 주세요.');
          const continuationMode=data.continuationMode??'verified';if(!['verified','raw-reset'].includes(continuationMode))throw fail(400,'이어받기 방식이 올바르지 않습니다.');
          const config=configuration(data);let source=data.fromRun==null||data.fromRun===''?null:accumulationSource(data.fromRun);let records=null;
          if(source&&continuationMode==='raw-reset'){const state=readJSON(source,'state.json'),pending=readJSON(source,'continuation.json');if(state?.phase==='import'&&state?.counters?.generatedGames===0&&state?.counters?.samples===0&&pending&&!pending.complete){const intended=accumulationSource(path.basename(pending.source));if(intended!==path.resolve(pending.source))throw fail(400,'복구할 원본 실험 경로가 올바르지 않습니다.');source=intended;}}
          if(source&&continuationMode==='verified')preflight(source);
          if(typeof data.record==='string'){if(Buffer.byteLength(data.record)>MAX_UPLOAD)throw fail(413,'기보 파일이 너무 큽니다.');try{records=JSON.parse(data.record);}catch{throw fail(400,'기보 JSON을 읽을 수 없습니다.');}}
          else if(data.record&&typeof data.record==='object')records=data.record;
          else if(data.record!=null)throw fail(400,'기보는 JSON 객체 또는 배열이어야 합니다.');
          if(records!==null&&(!records||typeof records!=='object'))throw fail(400,'기보는 JSON 객체 또는 배열이어야 합니다.');
          const id='run-'+new Date().toISOString().replace(/[-:.TZ]/g,'')+'-'+crypto.randomBytes(3).toString('hex');
          const run=path.join(realRoot,id);fs.mkdirSync(run);if(records!==null)fs.writeFileSync(path.join(run,'uploaded-records.json'),JSON.stringify(records,null,2)+'\n');
          fs.writeFileSync(path.join(run,'dashboard.json'),JSON.stringify({createdAt:new Date().toISOString(),preset:data.preset||'check',config,fromRun:source?path.basename(source):null,continuationMode,recordName:records===null?'기존 내장 기보':path.basename(String(data.recordName||'records.json'))},null,2)+'\n');
          return respond(201,launch(id,config,false,source,continuationMode));
        }
        if(url.pathname==='/api/stop')return respond(200,stop(data.id));
        if(url.pathname==='/api/resume')return respond(200,launch(data.id,null,true));
        throw fail(404,'요청을 찾을 수 없습니다.');
      }
      if(req.method!=='GET')throw fail(405,'지원하지 않는 요청입니다.');
      if(url.pathname==='/api/session')return respond(200,{token:sessionToken,presets:PRESETS,limits:LIMITS,activeId:activeId()});
      if(url.pathname==='/api/status'){const running=activeId();return respond(200,{activeId:running,runs:listRuns(),retention:retentionStatus,selected:url.searchParams.has('id')?describe(url.searchParams.get('id')):running?describe(running):null});}
      if(url.pathname==='/api/download'){
        const run=resolveRun(url.searchParams.get('id'));const kind=url.searchParams.get('kind')||'champion';
        const names={champion:'champion.json',candidate:'candidate.json',arena:'arena.json',training:'candidate.json.training.json'};
        if(!Object.hasOwn(names,kind))throw fail(400,'지원하지 않는 다운로드입니다.');
        const file=checkedFile(run,names[kind]);if(!file)throw fail(404,kind==='champion'?'이 실험에서 채택된 모델이 아직 없습니다.':'결과가 아직 없습니다.');
        return respond(200,fs.readFileSync(file),'application/json; charset=utf-8',{'Content-Disposition':`attachment; filename="omok-${kind}-${path.basename(run)}.json"`});
      }
      if(url.pathname==='/'||url.pathname==='/dashboard.html')return respond(200,fs.readFileSync(path.join(__dirname,'dashboard.html'),'utf8'),'text/html; charset=utf-8',{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
      const assets={'/dashboard.js':['dashboard.js','text/javascript; charset=utf-8'],'/dashboard.css':['dashboard.css','text/css; charset=utf-8']};
      if(Object.hasOwn(assets,url.pathname)){const [name,type]=assets[url.pathname];return respond(200,fs.readFileSync(path.join(__dirname,name),'utf8'),type);}
      throw fail(404,'요청을 찾을 수 없습니다.');
    }catch(error){respond(error.status||500,{error:error.status?error.message:'요청 처리 중 오류가 발생했습니다.'});}
  });
  return {server,runsRoot:realRoot,listen:async(requestedPort=8766)=>{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(requestedPort,'127.0.0.1',()=>{server.removeListener('error',reject);port=server.address().port;resolve();});});return {port,url:'http://127.0.0.1:'+port};},close:async({stopRuns=true}={})=>{if(stopRuns)for(const run of listRuns())if(run.active)stop(run.id);await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));},getActive:()=>active?{id:active.id,startedAt:active.startedAt}:null};
}
if(require.main===module){
  const opts={};let requestedPort=8766,openBrowser=false;for(const arg of process.argv.slice(2)){if(arg==='--open'){openBrowser=true;continue;}const match=/^--(port|runs-root|python)=(.+)$/.exec(arg);if(!match)throw Error('지원하지 않는 옵션: '+arg);if(match[1]==='port'){requestedPort=Number(match[2]);if(!Number.isInteger(requestedPort)||requestedPort<1||requestedPort>65535)throw Error('port는 1~65535 정수여야 합니다.');}else if(match[1]==='runs-root')opts.runsRoot=match[2];else opts.python=match[2];}
  const show=url=>{console.log('로컬 오목 학습: '+url);if(openBrowser){const child=spawn(process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open',process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url],{windowsHide:true,stdio:'ignore'});child.on('error',()=>console.error('브라우저를 자동으로 열지 못했습니다. 위 주소를 열어 주세요.'));child.unref();}};
  const app=createDashboard(opts);app.listen(requestedPort).then(info=>show(info.url)).catch(async error=>{if(openBrowser&&error.code==='EADDRINUSE'){try{const url='http://127.0.0.1:'+requestedPort,response=await fetch(url,{signal:AbortSignal.timeout(2000)});if(response.ok&&(await response.text()).includes('기존 엔진 보완 학습')){console.log('이미 실행 중인 학습 화면을 엽니다.');show(url);return;}}catch{}}console.error(error.message);process.exitCode=1;});
  let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(closing)return;closing=true;app.close().then(()=>process.exit(0),error=>{console.error(error.message);process.exit(1);});});
}
module.exports={createDashboard,configuration,PRESETS,LIMITS,inside};
