'use strict';
const fs=require('node:fs'),path=require('node:path');
const readline=require('node:readline');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {DatabaseSync}=require('node:sqlite');
const {ROOT,hash,fileHash,read,atomic,baselineFactory,save,stopped,sourceIdentity}=require('./state.cjs');
const {blank,index,coord,replay,opening,legalMoves,positionKey,familyFor}=require('./replay.cjs');
const neural=()=>require('../../src/neural-evaluator.js');
const current=options=>require('../../src/node-engine.cjs')(options);
const ledger=require('./trial-ledger.cjs');
const storage=require('./storage.cjs'),arenaDiskSessions=new WeakMap(),arenaWriteHeadroom=65536;
const fileBytes=file=>fs.existsSync(file)?fs.statSync(file).size:0;
function arenaBudget(context,bytes,stage){
 const requested=bytes+arenaWriteHeadroom,now=Date.now(),limit=context.settings.maxDiskBytes??Infinity;let cached=arenaDiskSessions.get(context);
 // Serialize writes in the parent. Account their exact size deltas between
 // scans, rather than walking all historical data on every move. A held
 // trainer quota remains conservative until the next refresh.
 if(!cached||now-cached.checkedAt>=1000||cached.writtenBytes>=1024*1024||cached.usedBytes+cached.heldBytes+requested>limit||cached.heldBytes+requested>cached.availableBytes){
  try{storage.requireBudget(context,requested,stage);}catch(error){arenaDiskSessions.delete(context);throw error;}cached={...context.state.disk,checkedAt:now,writtenBytes:0};arenaDiskSessions.set(context,cached);
 }
 return cached;
}
function accountArenaWrite(context,before,after){const cached=arenaDiskSessions.get(context);if(cached){const delta=after-before;cached.usedBytes+=delta;cached.availableBytes-=delta;cached.writtenBytes+=Math.max(0,after);}}
function writeArenaJSON(context,file,value,stage='arena-result'){
 const rel=path.relative(context.dir,file);if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Arena output left run storage');
 const text=typeof value==='string'?value:JSON.stringify(value,null,2),bytes=Buffer.byteLength(text);arenaBudget(context,bytes,stage);const before=fileBytes(file);
 try{atomic(file,text);accountArenaWrite(context,before,fileBytes(file));}catch(error){arenaDiskSessions.delete(context);throw error;}
}
function saveArenaContext(context,progressOnly=false){
 const files=(progressOnly?['progress.json']:['state.json','progress.json']).map(name=>path.join(context.dir,name));arenaBudget(context,Buffer.byteLength(JSON.stringify(context.state,null,2))*(progressOnly?1:2),'arena-progress');const before=files.reduce((sum,file)=>sum+fileBytes(file),0);
 try{const S=require('./state.cjs');if(progressOnly)S.saveProgress(context);else save(context);accountArenaWrite(context,before,files.reduce((sum,file)=>sum+fileBytes(file),0));}catch(error){arenaDiskSessions.delete(context);throw error;}
}
function assertExecutionIdentity(state){if(!state.identity)return;const now=sourceIdentity();for(const key of ['sourceHash','harnessHash','runtimeHash'])if(state.identity[key]!==now[key])throw Error('Arena engine, runner or runtime identity changed ('+key+'); preserve the recorded trial and use a new run');}
function parity(model,report){
 neural().validate(model);if(!report?.passed||report.modelId!==model.modelId||report.featureVersion!==model.featureVersion||!Array.isArray(report.cases)||!report.cases.length)return {passed:false,reason:'Missing or mismatched Python parity fixtures/model identity'};
 const E=neural().createEvaluator(model),rows=report.cases.map(c=>({expected:c.expectedValue,actual:E.raw(c.features),error:Math.abs(E.raw(c.features)-c.expectedValue)})),maximum=Math.max(...rows.map(x=>x.error));
 let effectiveError=0;for(const c of report.cases)if(Number.isFinite(c.expectedEffectiveValue)){const f=c.features,swapped=[...f.slice(12,24),...f.slice(0,12),f[25],f[24],f[27],f[26],-f[28],f[29],f[31],f[30]],actual=(E.raw(f)-E.raw(swapped))/2;effectiveError=Math.max(effectiveError,Math.abs(actual-c.expectedEffectiveValue));}
 return {passed:rows.every(x=>Number.isFinite(x.error))&&maximum<=Math.min(1e-5,report.tolerance||1e-5)&&effectiveError<=1e-5,maxAbsoluteError:maximum,effectiveMaxAbsoluteError:effectiveError,cases:rows.length,modelId:model.modelId};
}
function trainingEvidence(model,report,datasetHash){const errors=[];if(report?.modelExported!==true)errors.push('No model exported by the current training invocation');if(report?.modelId!==model?.modelId)errors.push('Candidate/training model identity mismatch');if(!datasetHash||report?.datasetHash!==datasetHash||model?.training?.datasetHash!==datasetHash)errors.push('Candidate/training/current dataset identity mismatch');if(!(model?.training?.updates>0)||report?.training?.updates!==model.training.updates)errors.push('Missing or mismatched completed training updates');if(report?.device?.finite!==true)errors.push('Training finiteness evidence missing');return {passed:!errors.length,errors,modelId:model?.modelId,datasetHash,updates:model?.training?.updates||0,trainedOnCuda:!!model?.training?.trainedOnCuda,actualUpdatesThisRun:report?.device?.updatesThisRun||0,scope:'Current snapshot and exported model consistency; optimizer loss is not playing strength'};}
function rulesAudit(candidate,base){
 const fixtures=[['five','D8 E8 F8 G8',true,true],['five+33','E8 F8 G8 I8 H7 H9 G7 I9',true,true],['33','G8 I8 H7 H9',false,false],['44','F8 G8 I8 H6 H7 H9',true,false],['overline','C8 D8 E8 F8 G8',true,false],['overline+33','C8 D8 E8 F8 G8 H7 H9 G7 I9',false,false]],errors=[];let checks=0;
 for(const p of [1,2])for(const [name,stones,legal,win]of fixtures){const b=blank();stones.split(' ').forEach(c=>b[index(c)]=p);for(const make of [base,current]){const E=make({firstPlayer:3-p,optimized:true,model:make===current?candidate:null}),copy=b.slice(),r=E.inspect(b,index('H8'),p);if(r.legal!==legal||!!r.win.length!==win||JSON.stringify(copy)!==JSON.stringify(b))errors.push(name+' color '+p);checks++;}}
 for(const p of [1,2]){const b=blank();'D8 E8 F8 G8'.split(' ').forEach(c=>b[index(c)]=p);b[index('C8')]=3-p;for(const make of [base,current]){const E=make({firstPlayer:p,optimized:true,model:make===current?candidate:null}),win=E.analyze(b,p,30,[]);if(win.i!==index('H8')||!E.inspect(b,win.i,p).win.length)errors.push('missed own immediate five');const block=E.analyze(b,3-p,30,[]);if(block.i!==index('H8'))errors.push('missed compulsory defense');checks+=2;}}
 return {passed:!errors.length,checks,errors,scope:'Both-color house-rule fixtures, winning priority, board restoration and compulsory immediate defense. Broader repository regressions remain separate.'};
}
function pairedStats(games,{minPairs=32,confidence=.95,trial=1}={}){
 const families=new Map(),groups=new Map();let wins=0,draws=0,losses=0,unfinished=0;
 for(const g of games){if(!g.completed){unfinished++;continue;}const value=g.winner===0?.5:g.winner===g.candidateColor?1:0;if(value===1)wins++;else if(value===0)losses++;else draws++;const key=g.pairId;const rows=groups.get(key)||[];rows.push({game:g,value});groups.set(key,rows);}
 for(const rows of groups.values()){if(rows.length!==2||new Set(rows.map(x=>x.game.candidateFirst)).size!==2)continue;const family=rows[0].game.familyId,a=families.get(family)||[];a.push((rows[0].value+rows[1].value)/2);families.set(family,a);}
 const values=[...families.values()].map(a=>a.reduce((x,y)=>x+y,0)/a.length),n=values.length,mean=n?values.reduce((x,y)=>x+y,0)/n:null;
 // Independent source/opening families, not games or symmetry variants, are
 // the bounded observations. Alpha spending protects repeated promotions.
 const alpha=(1-confidence)/(Math.max(1,trial)*(Math.max(1,trial)+1)),radius=n?Math.sqrt(Math.log(1/alpha)/(2*n)):1,lower=n?Math.max(0,mean-radius):0;
 return {wins,draws,losses,unfinished,completedGames:wins+draws+losses,completedPairs:[...groups.values()].filter(a=>a.length===2&&new Set(a.map(x=>x.game.candidateFirst)).size===2).length,independentFamilies:n,meanScore:mean,lowerConfidenceBound:lower,alpha,minPairs,passed:n>=minPairs&&lower>.5,method:'one-sided Hoeffding bound on family-averaged paired scores with alpha spending',scope:'Improvement only against the recorded opponent, openings and move budget; not a universal strength claim'};
}
const openingFamily=start=>'family-'+hash(familyFor(start.events.slice(0,4),start.firstPlayer)).slice(0,24);
const evaluationSettingsHash=settings=>hash({validationMs:settings.validationMs,pairs:settings.pairs,minPairs:settings.minPairs,confidence:settings.confidence,workers:settings.workers||1,schedule:'parallel-arena-v1',...(settings.poweredEvaluation===true?{poweredEvaluation:true,minimumUsefulImprovement:settings.minimumUsefulImprovement??.10,targetPower:settings.targetPower??.8,maxEvaluationPairs:settings.maxEvaluationPairs??2048}:{})});
function evaluationDesign(settings,trial,opponents=2){
 if(settings.poweredEvaluation!==true)return {policy:'fixed',pairs:settings.pairs};
 const minimumUsefulImprovement=settings.minimumUsefulImprovement??.10,targetPower=settings.targetPower??.8,maxEvaluationPairs=settings.maxEvaluationPairs??2048;
 if(!Number.isSafeInteger(maxEvaluationPairs)||maxEvaluationPairs<1)throw Error('maxEvaluationPairs must be a positive safe integer');
 const requirements=require('./experiment-plan.cjs').planningRequirements({trial,confidence:settings.confidence,minPairs:settings.minPairs,pairs:settings.pairs,minimumUsefulImprovement,targetPower,opponents,workers:settings.workers||1,moveMs:settings.validationMs});
 const pairs=Math.max(settings.pairs,requirements.conditionalPower.families),design={policy:'powered',trial,configuredPairs:settings.pairs,pairs,minimumUsefulImprovement,targetPower,maxEvaluationPairs,requirements:require('./experiment-plan.cjs').planningRequirements({trial,confidence:settings.confidence,minPairs:settings.minPairs,pairs,minimumUsefulImprovement,targetPower,opponents,workers:settings.workers||1,moveMs:settings.validationMs})};
 if(pairs>maxEvaluationPairs){const error=Error('Powered evaluation requires '+pairs+' independent families per opponent, exceeding the configured cap '+maxEvaluationPairs+'. No evaluation trial or families were reserved.');error.code='EVALUATION_BUDGET';error.evaluationDesign=design;throw error;}
 return design;
}
function planningDiagnostics({pairs=64,minPairs=32,confidence=.95,trial=1,moveMs=1000,opponents=2}={}){
 const alpha=(1-confidence)/(Math.max(1,trial)*(Math.max(1,trial)+1)),radius=Math.sqrt(Math.log(1/alpha)/(2*pairs));
 return {trial,confidence,alpha,independentFamilies:pairs,minPairs,requiredMeanStrictlyGreaterThan:.5+radius,possible:pairs>=minPairs&&.5+radius<1,minimumNondrawWins:Math.floor((.5+radius)*2*pairs)+1,games:2*pairs*opponents,maximumMoveBudgetMs:2*pairs*opponents*225*moveMs,familiesForMean:Object.fromEntries([.55,.6,.65,.7].map(score=>[score,Math.max(minPairs,Math.floor(Math.log(1/alpha)/(2*(score-.5)**2))+1)])),scope:'Algebraic bound crossing requirements, not statistical power, expected wall time, or predicted future strength. Promotion criteria are unchanged.'};
}
function familyExclusions(context){
 const db=new DatabaseSync(path.join(context.dir,'arena-exclusions.sqlite'));try{db.exec('PRAGMA journal_mode=WAL; PRAGMA cache_size=-16384; PRAGMA temp_store=FILE; CREATE TABLE IF NOT EXISTS families(id TEXT PRIMARY KEY NOT NULL); CREATE TABLE IF NOT EXISTS positions(id TEXT PRIMARY KEY NOT NULL); DELETE FROM families; DELETE FROM positions;');
 const add=db.prepare('INSERT OR IGNORE INTO families(id) VALUES(?)'),has=db.prepare('SELECT 1 FROM families WHERE id=?'),count=db.prepare('SELECT COUNT(*) AS n FROM families');
 const addPosition=db.prepare('INSERT OR IGNORE INTO positions(id) VALUES(?)'),hasPosition=db.prepare('SELECT 1 FROM positions WHERE id=?'),positionCount=db.prepare('SELECT COUNT(*) AS n FROM positions');
 return {add(id){if(typeof id!=='string'||!id||id.length>256)throw Error('Missing or invalid excluded source family');add.run(id);},has:id=>!!has.get(id),get size(){return Number(count.get().n);},positions:{add(id){if(typeof id!=='string'||!id||id.length>256)throw Error('Missing or invalid excluded position');addPosition.run(id);},has:id=>!!hasPosition.get(id),get size(){return Number(positionCount.get().n);}},db,close:()=>db.close()};}catch(error){try{db.close();}catch{}throw error;}
}
function exclusionSources(context){
 const snapshot=require('./snapshot.cjs'),files=[snapshot.exposureName,'temporal-exposures-ready.json',snapshot.lineageName,'continuation.json','family-groups.json','games.jsonl','datasets/cycle-'+(context.state.cycle||1)+'.jsonl'];
 return {files:Object.fromEntries(files.map(name=>[name,fs.existsSync(path.join(context.dir,name))?fileHash(path.join(context.dir,name)):null])),familySplitRegistrySha256:hash(context.state.familySplits||{})};
}
async function loadExclusions(context){
 const snapshot=require('./snapshot.cjs');await snapshot.ensureExposures(context);const sources=exclusionSources(context),inputBytes=Object.keys(sources.files).reduce((sum,name)=>sum+fileBytes(path.join(context.dir,name)),0)+Buffer.byteLength(JSON.stringify(context.state.familySplits||{})),estimate=inputBytes*2+16*1024*1024,indexFile=path.join(context.dir,'arena-exclusions.sqlite'),indexBytes=()=>['','-wal','-shm'].reduce((sum,suffix)=>sum+fileBytes(indexFile+suffix),0),initialIndexBytes=indexBytes();
 storage.requireBudget(context,estimate,'arena-exclusion-index');arenaDiskSessions.delete(context);const excluded=familyExclusions(context),grouping=read(path.join(context.dir,'family-groups.json'),{aliases:{},groups:[]});let transaction=false,insertions=0;
 const checkGrowth=()=>{if(stopped(context.dir))throw Object.assign(Error('Arena stopped before reserving independent openings'),{code:'STOP_REQUESTED'});storage.requireBudget(context,Math.max(arenaWriteHeadroom,estimate-Math.max(0,indexBytes()-initialIndexBytes)),'arena-exclusion-index-growth');};
 const tick=()=>{if(++insertions%1024===0)checkGrowth();};
 const canonical=id=>snapshot.resolveAlias(id,next=>(grouping.aliases||{})[next]),addFamily=id=>{excluded.add(id);tick();excluded.add(canonical(id));tick();},addPosition=id=>{excluded.positions.add(id);tick();};
 const lines=async(file,visit)=>{if(!fs.existsSync(file))return;const input=readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity});for await(const line of input)if(line.trim())visit(JSON.parse(line.replace(/^\uFEFF/,'')));};
 try{
  excluded.db.exec('BEGIN');transaction=true;
  const exposureCounts={train:0,validation:0,test:0};await lines(path.join(context.dir,snapshot.exposureName),row=>{snapshot.verifyExposure(row);if(row.kind==='family')addFamily(row.key);else addPosition(row.key);exposureCounts[row.split]++;});
  for(const [id,split] of Object.entries(context.state.familySplits||{})){if(!['train','validation','test'].includes(split))throw Error('Invalid reserved source family split');addFamily(id);}
  for(const group of grouping.groups||[]){if(!['train','validation','test'].includes(group.split))throw Error('Invalid reserved group split');addFamily(group.familyId);}
  for(const id of Object.keys(grouping.aliases||{}))addFamily(id);
  const data=path.join(context.dir,'datasets/cycle-'+(context.state.cycle||1)+'.jsonl');if(fs.existsSync(data)&&context.state.dataset?.sha256&&fileHash(data)!==context.state.dataset.sha256)throw Error('Current arena snapshot changed');
  await lines(data,row=>{if(!['train','validation','test'].includes(row.split))throw Error('Invalid arena snapshot split');addFamily(row.familyId);const key=row.positionKey||(row.position?positionKey(row.position.board,row.position.p,row.position.firstPlayer):null);if(key)addPosition(key);});
  await lines(path.join(context.dir,'games.jsonl'),game=>{if(!['train','validation','test'].includes(game.split))throw Error('Invalid arena source game split');if(game.familyId)addFamily(game.familyId);if(game.opening?.length>=4)addFamily(openingFamily({events:game.opening,firstPlayer:game.firstPlayer}));});
  if(hash(exclusionSources(context))!==hash(sources))throw Error('Arena exclusion inputs changed while selecting independent openings');checkGrowth();excluded.db.exec('COMMIT');transaction=false;storage.requireBudget(context,arenaWriteHeadroom,'arena-exclusion-index-complete');arenaDiskSessions.delete(context);
  excluded.evidence={version:2,sources,exposureCounts,excludedPositions:excluded.positions.size,excludedFamilies:excluded.size,scope:'Cumulative published training, validation and final-test positions/families, plus all current snapshot and reserved source families, are excluded from independent arena openings.'};return excluded;
 }catch(error){if(transaction)try{excluded.db.exec('ROLLBACK');}catch{}excluded.close();throw error;}
}
function plan(context,model,trained=new Set(),trainedFamilies=new Set()){
 assertExecutionIdentity(context.state);
 const prior=read(path.join(context.dir,'champion.json')),identity=sourceIdentity(),settingsHash=evaluationSettingsHash(context.settings),lessons=require('./generate.cjs').lessonsFor(context);
 const reserved=ledger.reserve(context,{candidateHash:hash(model),settingsHash,identity,datasetSha256:context.state.dataset?.sha256||null,lessonHash:hash(lessons),incumbentHash:prior?hash(prior):null},({trial,hasFamily})=>{
 const opponents=prior?['baseline','incumbent']:['baseline','current-no-model'],design=evaluationDesign(context.settings,trial,opponents.length),pairs=design.pairs;
 const seen=new Set(),positions=[];let serial=0;
 while(positions.length<pairs){let start;
  start=opening(context.settings.seed+100000003+context.state.cycle*100003+serial*1237,4+serial%3);start.source='reserved-evaluation-opening';
  serial++;if(serial>1000000)throw Error('Unable to find independent evaluation openings');const stem=openingFamily(start);if(seen.has(stem)||hasFamily(stem)||trainedFamilies.has(stem)||trainedFamilies.has(start.familyId)||trained.has(positionKey(start.board,start.p,start.firstPlayer)))continue;start.familyId=stem;seen.add(stem);positions.push(start);
 }
 const games=[];for(const opponent of opponents)positions.forEach((pos,k)=>{for(const candidateFirst of [true,false])games.push({id:opponent+'-'+k+'-'+(candidateFirst?'first':'second'),pairId:opponent+'-'+k,familyId:pos.familyId,source:pos.source,opponent,candidateFirst,candidateColor:candidateFirst?pos.firstPlayer:3-pos.firstPlayer,firstPlayer:pos.firstPlayer,board:pos.board.slice(),p:pos.p,opening:pos.events,events:[],completed:false,winner:null,elapsedMs:0});});
 return {schemaVersion:1,candidateHash:hash(model),candidateModelId:model.modelId,baselineCommit:context.state.baselineCommit,incumbentHash:prior?hash(prior):null,incumbent:prior,identity,rulesId:context.state.rulesId,lessons,lessonHash:hash(lessons),datasetSha256:context.state.dataset?.sha256,settingsHash,moveMs:context.settings.validationMs,pairs,...(context.settings.poweredEvaluation===true?{evaluationDesign:design}:{}),trial,games,planning:planningDiagnostics({pairs,minPairs:context.settings.minPairs,confidence:context.settings.confidence,trial,moveMs:context.settings.validationMs,opponents:opponents.length}),opponentEvidence:Object.fromEntries(opponents.map(name=>[name,{sourceHash:name==='baseline'?context.state.baselineSourceHash:identity.sourceHash,modelHash:name==='incumbent'?hash(prior):null,modelExplicitlyNull:name!=='incumbent',firstPlayer:'same paired first player',moveMs:context.settings.validationMs,optimized:true,lessonHash:hash(lessons)}])),startedAt:new Date().toISOString()};
 });
 if(reserved.games.some(g=>trainedFamilies.has(g.familyId)||trained.has(positionKey(g.board,g.p,g.firstPlayer))))throw Error('Reserved evaluation openings conflict with current training exclusions; use a new cycle');return reserved;
}
function opponentEngine(game,state,baseline){if(game.opponent==='baseline')return baseline.createEngine({firstPlayer:game.firstPlayer,optimized:true});if(game.opponent==='current-no-model')return current({firstPlayer:game.firstPlayer,optimized:true,model:null});if(game.opponent==='incumbent')return current({firstPlayer:game.firstPlayer,optimized:true,model:state.incumbent});throw Error('Unknown arena opponent: '+game.opponent);}
function arenaSummary(state,cycle){return {schemaVersion:1,cycle,trial:state.trial,candidateHash:state.candidateHash,candidateModelId:state.candidateModelId,identity:state.identity,sourceHash:state.identity?.sourceHash,harnessHash:state.identity?.harnessHash,baselineCommit:state.baselineCommit,incumbentHash:state.incumbentHash,opponents:[...new Set(state.games.map(g=>g.opponent))],opponentEvidence:state.opponentEvidence,exclusions:state.exclusions,moveMs:state.moveMs,pairs:state.pairs,...(state.evaluationDesign?{evaluationDesign:state.evaluationDesign}:{}),stats:state.stats,summary:state.summary,planning:state.planning,requirements:state.planning,budget:state.budget,complete:state.complete,passed:state.passed,controlsPresent:state.controlsPresent,rejectionReasons:state.rejectionReasons,startedAt:state.startedAt,finishedAt:state.finishedAt,invalidGames:state.invalidGames,trainingCheck:state.trainingCheck,parity:state.parity,rules:state.rules,execution:state.execution};}
function verifyArenaGame(game){
 const checked=replay({id:game.id,first:game.firstPlayer,events:[...game.opening,...game.events]},{engine:current({firstPlayer:game.firstPlayer,strategy:false,model:null})});
 if(checked.p!==game.p||!Array.isArray(game.board)||game.board.length!==225||checked.board.some((stone,i)=>stone!==game.board[i]))throw Error('arena-board-replay-mismatch');
 if(game.completed&&(!checked.completed||(checked.draw?0:checked.winner)!==game.winner))throw Error('terminal-replay-mismatch');return checked;
}
function selectArenaMove(E,game,state){
 const started=performance.now(),r=E.analyze(game.board,game.p,state.moveMs,state.lessons||[]),elapsed=performance.now()-started;
 const shape=Number.isInteger(r.i)&&r.i>=0&&r.i<225&&!game.board[r.i]?E.inspect(game.board,r.i,game.p):null;
 if(!shape?.legal){if(!legalMoves(E,game.board,game.p).length)return {reason:'no-legal-move',r,elapsed};return {reason:'illegal-or-missing-recommendation',invalid:'illegal-or-missing-recommendation',r,elapsed};}
 return {r,shape,elapsed};
}
const arenaProgressTimes=new WeakMap();
const arenaJournalFile=(context,game)=>path.join(context.dir,'arena-partials-cycle-'+context.state.cycle,hash(game.id).slice(0,24)+'.jsonl');
const arenaJournalIdentity=state=>hash([state.candidateHash,state.incumbentHash,state.baselineCommit,state.rulesId,state.lessonHash,state.moveMs,state.settingsHash]);
function appendArenaMove(context,state,game){
 const file=arenaJournalFile(context,game),row={identity:arenaJournalIdentity(state),gameId:game.id,ply:game.events.length,event:game.events.at(-1),elapsedMs:game.elapsedMs,completed:game.completed,winner:game.winner,reason:game.reason},text=JSON.stringify(row)+'\n';arenaBudget(context,Buffer.byteLength(text),'arena-move-journal');fs.mkdirSync(path.dirname(file),{recursive:true});const before=fileBytes(file),fd=fs.openSync(file,'a');try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);accountArenaWrite(context,before,fileBytes(file));}catch(error){arenaDiskSessions.delete(context);throw error;}finally{fs.closeSync(fd);}
 context.state.progress={...context.state.progress,gameId:game.id,ply:game.events.length,completed:state.games.filter(x=>x.completed).length,total:state.games.length};const last=arenaProgressTimes.get(context)||0;if(Date.now()-last>=250){saveArenaContext(context,true);arenaProgressTimes.set(context,Date.now());}
}
function restoreArenaMoves(context,state,game){
 const file=arenaJournalFile(context,game);if(!fs.existsSync(file))return;const bytes=fs.readFileSync(file),end=bytes.lastIndexOf(10);if(end<bytes.length-1){const fd=fs.openSync(file,'r+');try{fs.ftruncateSync(fd,end+1);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 const identity=arenaJournalIdentity(state);for(const line of bytes.subarray(0,end+1).toString('utf8').split('\n')){if(!line)continue;const row=JSON.parse(line);if(row.identity!==identity||row.gameId!==game.id)throw Error('Arena journal candidate/game context mismatch');if(!Number.isInteger(row.ply)||row.ply<1)throw Error('Invalid durable arena ply');
  if(row.ply<=game.events.length){if(hash(game.events[row.ply-1])!==hash(row.event))throw Error('Conflicting durable arena move');continue;}
  if(row.ply!==game.events.length+1||row.event.type!=='move'||row.event.p!==game.p||!Number.isInteger(row.event.i)||row.event.i<0||row.event.i>=225||game.board[row.event.i])throw Error('Missing or invalid durable arena move');
  game.board[row.event.i]=game.p;game.p=3-game.p;game.events.push(row.event);Object.assign(game,{elapsedMs:row.elapsedMs,completed:row.completed,winner:row.winner,reason:row.reason});
 }verifyArenaGame(game);
}
async function playArenaGame(context,state,game,{deadline=Infinity,challenger,opponent,cancelBuffer,onMove=g=>appendArenaMove(context,state,g)}={}){
 const checked=verifyArenaGame(game);let empty=game.board.filter(x=>!x).length;if(checked.completed){game.completed=true;game.winner=checked.draw?0:checked.winner;game.reason=checked.draw?'full-board':'played-exact-five';}
 while(!game.completed){if(cancelBuffer&&Atomics.load(new Int32Array(cancelBuffer),0)){game.reason='pipeline-yield';break;}if(stopped(context.dir)||Date.now()+state.moveMs>=deadline){game.reason=stopped(context.dir)?'user-stop':'time-limit';break;}if(game.events.length>=225){game.reason='ply-limit';break;}
  const E=game.p===game.candidateColor?challenger:opponent,choice=selectArenaMove(E,game,state);if(choice.reason){game.reason=choice.reason;if(choice.invalid)game.invalid=choice.invalid;break;}
  const {r,shape,elapsed}=choice;game.events.push({type:'move',p:game.p,i:r.i,coord:coord(r.i),engine:game.p===game.candidateColor?'candidate':game.opponent,elapsedMs:elapsed,depth:r.depth,nodes:r.nodes,proofStatus:r.proofStatus});game.elapsedMs+=elapsed;game.board[r.i]=game.p;game.p=3-game.p;empty--;
  if(shape.win.length){game.completed=true;game.winner=3-game.p;game.reason='played-exact-five';}else if(!empty){game.completed=true;game.winner=0;game.reason='full-board';}
  await onMove(game);await new Promise(resolve=>setImmediate(resolve));
 }verifyArenaGame(game);return game;
}
function createArenaWorkerPool(size,state,model){
 if(!Number.isInteger(size)||size<1||size>16)throw Error('Arena worker pool size must be between 1 and 16');
 const lanes=Array.from({length:size},()=>{
  const worker=new Worker(__filename,{workerData:{arenaPool:true,baselineCommit:state.baselineCommit,state:{identity:state.identity,moveMs:state.moveMs,lessons:state.lessons||[],incumbent:state.incumbent},model}});let pending=null,failure=null,closing=false;
  const fail=error=>{failure=error;const task=pending;pending=null;if(task)task.reject(error);};
  worker.on('error',fail);worker.on('exit',code=>{if(!closing)fail(Error('Arena worker exited unexpectedly ('+code+')'));});
  worker.on('message',message=>{if(closing)return;if(!pending||message.taskId!==pending.id){fail(Error('Unexpected arena worker task identity'));return;}const task=pending;try{
   if(message.progress){const persisted=task.onProgress(message.game),ack=()=>{if(!closing&&pending===task)worker.postMessage({ack:task.id,ply:message.game.events.length});};if(persisted?.then)Promise.resolve(persisted).then(ack).catch(fail);else ack();}
   else if(message.result){pending=null;task.resolve(message.result);}else if(message.error)fail(Error(message.error));else fail(Error('Unknown arena worker message'));
  }catch(error){fail(error);}});
  return {run(task,onProgress=()=>{}){if(failure)return Promise.reject(failure);if(closing)return Promise.reject(Error('Arena worker pool is closed'));if(pending)return Promise.reject(Error('Arena worker lane is already busy'));return new Promise((resolve,reject)=>{pending={id:task.game.id,resolve,reject,onProgress};try{worker.postMessage({task});}catch(error){fail(error);}});},async close(){closing=true;if(pending)fail(Error('Arena worker pool closed during a task'));await worker.terminate();},get threadId(){return worker.threadId;}};
 });
 return {lanes,async close(){await Promise.allSettled(lanes.map(lane=>lane.close()));}};
}
async function evaluateGames(context,state,model,{deadline=Infinity,baseline,workerPool=createArenaWorkerPool}={}){
 assertExecutionIdentity(state);const file=path.join(context.dir,'arena-cycle-'+context.state.cycle+'.json'),queued=state.games.filter(game=>!game.completed&&!game.exhausted),configured=context.settings.workers||1,workers=Math.min(configured,queued.length),active=new Set(),cancelBuffer=new SharedArrayBuffer(4);let cursor=0,pool,failure;
 state.execution={schedule:'parallel-arena-v1',configuredWorkers:configured,workers,moveMs:state.moveMs,scope:'Same immutable candidate, opponent, openings and wall-clock move budget on both sides; concurrent scheduling may change search depth and ordinary moves.'};
 const progress=()=>{context.state.progress={...context.state.progress,workers,activeGames:active.size,completed:state.games.filter(game=>game.completed).length,total:state.games.length};};
 const immutable=game=>[game.id,game.pairId,game.familyId,game.candidateFirst,game.candidateColor,game.firstPlayer,game.opponent,game.opening];
 const merge=(game,updated)=>{if(hash(immutable(updated))!==hash(immutable(game)))throw Error('Arena worker changed immutable game context');if(updated.events.length<game.events.length||hash(updated.events.slice(0,game.events.length))!==hash(game.events))throw Error('Arena worker changed played move history');Object.assign(game,updated);};
 const finish=game=>{assertExecutionIdentity(state);try{verifyArenaGame(game);}catch(error){game.invalid=error.message;}if(['no-legal-move','ply-limit','illegal-or-missing-recommendation'].includes(game.reason)||game.invalid)game.exhausted=true;progress();writeArenaJSON(context,file,state);saveArenaContext(context);if(game.completed||game.exhausted){const partial=arenaJournalFile(context,game);if(fs.existsSync(partial)){const before=fileBytes(partial);fs.unlinkSync(partial);accountArenaWrite(context,before,0);}}};
 progress();saveArenaContext(context);if(!queued.length)return;
 const next=()=>stopped(context.dir)||Date.now()>=deadline||Atomics.load(new Int32Array(cancelBuffer),0)?null:queued[cursor++]||null;
 const work=async lane=>{for(;;){const game=next();if(!game)return;active.add(game.id);progress();try{
  if(lane){const result=await lane.run({dir:context.dir,game,deadline,cancelBuffer},updated=>{merge(game,updated);progress();appendArenaMove(context,state,game);});merge(game,result);}
  else{const challenger=current({firstPlayer:game.firstPlayer,optimized:true,model}),opponent=opponentEngine(game,state,baseline);await playArenaGame(context,state,game,{deadline,challenger,opponent,cancelBuffer});}
  active.delete(game.id);finish(game);
 }catch(error){failure??=error;Atomics.store(new Int32Array(cancelBuffer),0,1);active.delete(game.id);progress();throw error;}}};
 try{
  if(workers>1){pool=workerPool(workers,state,model);const results=await Promise.allSettled(pool.lanes.map(work)),failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;}
  else{baseline??=baselineFactory(state.baselineCommit);await work(null);}
 }catch(error){failure??=error;throw error;}finally{if(pool)await pool.close();active.clear();progress();if(!failure)saveArenaContext(context);}
}
async function validate(context,{deadline=Infinity,modelPath=path.join(context.dir,'candidate.json')}={}){
 const model=read(modelPath);if(!model)throw Error('No candidate model; run training first');neural().validate(model);const file=path.join(context.dir,'arena-cycle-'+context.state.cycle+'.json');let state=read(file);
 assertExecutionIdentity(context.state);if(state){assertExecutionIdentity(state);const design=evaluationDesign(context.settings,state.trial,new Set(state.games.map(g=>g.opponent)).size);if(state.candidateHash!==hash(model)||state.moveMs!==context.settings.validationMs||state.pairs!==design.pairs||state.settingsHash!==evaluationSettingsHash(context.settings)||context.settings.poweredEvaluation===true&&(!state.evaluationDesign||hash(state.evaluationDesign)!==hash(design)))throw Error('Candidate or evaluation settings changed; use a new cycle/run');if(state.exclusions?.version===2&&hash(exclusionSources(context))!==hash(state.exclusions.sources))throw Error('Cumulative arena exclusion inputs changed; use a new cycle/run');ledger.reconcile(context,state);saveArenaContext(context);}
 else{const excluded=await loadExclusions(context);try{state=plan(context,model,excluded.positions,excluded);state.trainingPositionCount=excluded.positions.size;state.trainingFamilyCount=excluded.size;state.startPositionsDisjointFromTraining=true;state.startPositionsDisjointFromPriorExposure=true;state.exclusions=excluded.evidence;writeArenaJSON(context,file,state);saveArenaContext(context);}finally{excluded.close();}}
 const baseline=baselineFactory(context.state.baselineCommit);state.rules=rulesAudit(model,baseline.createEngine);state.parity=parity(model,read(modelPath+'.parity.json'));
 for(const game of state.games){restoreArenaMoves(context,state,game);try{verifyArenaGame(game);}catch(error){game.invalid=error.message;game.exhausted=true;}}writeArenaJSON(context,file,state);
 for(const game of state.games)if(game.completed||game.exhausted){const partial=arenaJournalFile(context,game);if(fs.existsSync(partial))fs.unlinkSync(partial);}
 await evaluateGames(context,state,model,{deadline,baseline});
 const stats={};for(const opponent of [...new Set(state.games.map(g=>g.opponent))])stats[opponent]=pairedStats(state.games.filter(g=>g.opponent===opponent),{minPairs:context.settings.minPairs,confidence:context.settings.confidence,trial:state.trial});
 const training=read(modelPath+'.training.json'),trainingCheck=trainingEvidence(model,training,state.datasetSha256),invalid=state.games.filter(g=>g.invalid),complete=state.games.every(g=>g.completed||g.exhausted),controlsPresent=!!stats.baseline&&!!stats[state.incumbentHash?'incumbent':'current-no-model'],passed=complete&&state.games.every(g=>g.completed)&&!invalid.length&&controlsPresent&&state.rules.passed&&state.parity.passed&&trainingCheck.passed&&Object.values(stats).every(x=>x.passed);
 assertExecutionIdentity(state);Object.assign(state,{stats,summary:stats.baseline,complete,passed,controlsPresent,planning:planningDiagnostics({pairs:state.pairs,minPairs:context.settings.minPairs,confidence:context.settings.confidence,trial:state.trial,moveMs:state.moveMs,opponents:Object.keys(stats).length}),invalidGames:invalid.map(g=>({id:g.id,error:g.invalid})),trainingEvidence:training,trainingCheck,finishedAt:complete?new Date().toISOString():null,rejectionReasons:[...(!controlsPresent?['required historical baseline or current incumbent/no-model control missing']:[]),...(!state.games.every(g=>g.completed)?['evaluation games unfinished']:[]),...(!state.rules.passed?['rule/tactical audit failed']:[]),...(!state.parity.passed?['JS/Python model parity missing or failed']:[]),...trainingCheck.errors,...(invalid.length?['invalid played game']:[]),...Object.entries(stats).filter(([,s])=>!s.passed).map(([name])=>'conservative strength threshold not met against '+name)]});writeArenaJSON(context,file,state);writeArenaJSON(context,path.join(context.dir,'arena.json'),state);const summary=arenaSummary(state,context.state.cycle);writeArenaJSON(context,path.join(context.dir,'arena-cycle-'+context.state.cycle+'.summary.json'),summary);writeArenaJSON(context,path.join(context.dir,'arena.summary.json'),summary);context.state.validation={cycle:context.state.cycle,candidateHash:state.candidateHash,trial:state.trial,passed,complete,stats,planning:state.planning,budget:state.budget,rejectionReasons:state.rejectionReasons};saveArenaContext(context);return state;
}
if(!isMainThread&&workerData?.arenaPool){
 const state=workerData.state,model=workerData.model;assertExecutionIdentity(state);const baseline=baselineFactory(workerData.baselineCommit);let busy=false,acknowledgement=null;
 parentPort.on('message',message=>{
  if(message.ack){if(acknowledgement?.taskId===message.ack&&acknowledgement.ply===message.ply){const pending=acknowledgement;acknowledgement=null;pending.resolve();}return;}
  const task=message.task,taskId=task?.game?.id;if(busy||!task){parentPort.postMessage({taskId,error:'Arena worker received an invalid or overlapping task'});return;}busy=true;
  const game=task.game,challenger=current({firstPlayer:game.firstPlayer,optimized:true,model}),opponent=opponentEngine(game,state,baseline);
  playArenaGame({dir:task.dir},state,game,{deadline:task.deadline,challenger,opponent,cancelBuffer:task.cancelBuffer,onMove:g=>new Promise(resolve=>{acknowledgement={taskId,ply:g.events.length,resolve};parentPort.postMessage({taskId,progress:true,game:g});})}).then(result=>{busy=false;parentPort.postMessage({taskId,result});}).catch(error=>{busy=false;acknowledgement=null;parentPort.postMessage({taskId,error:error.stack||error.message});});
 });
}
module.exports={parity,trainingEvidence,rulesAudit,pairedStats,openingFamily,evaluationSettingsHash,evaluationDesign,planningDiagnostics,familyExclusions,exclusionSources,loadExclusions,plan,opponentEngine,arenaSummary,verifyArenaGame,selectArenaMove,arenaJournalFile,appendArenaMove,restoreArenaMoves,playArenaGame,createArenaWorkerPool,evaluateGames,validate,writeArenaJSON,assertExecutionIdentity};
