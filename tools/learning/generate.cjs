'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {ROOT,RULES_ID,FEATURE_VERSION,hash,append,read,rng,save,stopped,baselineFactory,atomic}=require('./state.cjs');
const {replay,legalMoves,opening,splitFor,coord,positionKey,familyFor}=require('./replay.cjs');
const currentFactory=options=>require('../../src/node-engine.cjs')(options);
function neural(){return require('../../src/neural-evaluator.js');}
function features(board,p,first){return Array.from(neural().extractFeatures(board,p,first));}
function modelFor(context){const adopted=path.join(context.dir,'champion.json');return fs.existsSync(adopted)?read(adopted):null;}
function lessonsFor(context){return (read(path.join(context.dir,'lessons.json'),{lessons:[]}).lessons||[]).filter(l=>l.active!==false);}
function sample(context,{id,familyId,split,board,p,firstPlayer,target,weight=1,labelType='terminal',source}){
 return {schemaVersion:1,sampleId:id,rulesId:RULES_ID,featureVersion:FEATURE_VERSION,familyId,split,positionKey:positionKey(board,p,firstPlayer),features:features(board,p,firstPlayer),target,weight,labelType,position:{board,p,firstPlayer},source};
}
function rowsForGame(context,game){
 if(!game.completed)return [];const checked=verifyGame(game);return (game.samples||[]).map(item=>{const pos=checked.positions[item.ply];if(!pos||pos.p!==item.p||!Array.isArray(item.board)||item.board.length!==225||pos.board.some((stone,i)=>stone!==item.board[i]))throw Error('Stored sample does not match played position in '+game.id+' ply '+item.ply);return sample(context,{id:game.id+':'+item.ply,familyId:game.familyId,split:game.split,board:item.board,p:item.p,firstPlayer:game.firstPlayer,target:game.winner===0?0:game.winner===item.p?1:-1,source:{gameId:game.id,ply:item.ply,branch:game.branch,seed:game.seed,modelVersion:game.modelVersion,lessonHash:game.lessonHash,kind:'actual-played-terminal'}});});
}
function sampleGame(context,game){const rows=rowsForGame(context,game);for(const row of rows)append(path.join(context.dir,'dataset.jsonl'),row);return rows.length;}
function importedSamples(context,records){
 const journal=require('./journal.cjs'),seen=new Set(context.state.importedSampleGames||[]);for(const record of records){if(seen.has(record.id))continue;const r=replay(record),rows=[];if(r.completed){for(const pos of r.positions){if(pos.type!=='move')continue;rows.push(sample(context,{id:'record:'+record.id+':'+pos.ply,familyId:record.familyId,split:record.split,board:pos.board,p:pos.p,firstPlayer:record.first,target:r.draw?0:r.winner===pos.p?1:-1,source:{gameId:record.id,ply:pos.ply,kind:'record-terminal',labelMeaning:'position outcome; does not classify the played move as bad'}}));}}journal.appendRows(context.dir,'dataset.jsonl',rows,'sampleId');seen.add(record.id);context.state.importedSampleGames=[...seen];journal.counters(context);save(context);}journal.counters(context);
}
function finishAnalysis(context,intent){
 if(intent.baselineCommit!==context.state.baselineCommit||intent.runId!==context.state.runId||intent.row.rulesId!==RULES_ID||intent.sample&&intent.sample.featureVersion!==FEATURE_VERSION)throw Error('Analysis intent has incompatible run/rules/features');const journal=require('./journal.cjs');journal.appendRows(context.dir,'analysis.jsonl',[intent.row],'id');if(intent.sample)journal.appendRows(context.dir,'dataset.jsonl',[intent.sample],'sampleId');
 const done=new Set(context.state.analysisDone||[]);done.add(intent.id);context.state.analysisDone=[...done];context.state.counters.analyzedPositions=done.size;context.state.progress=intent.progress;journal.counters(context);save(context);
 const file=path.join(context.dir,'analysis-intent.json');if(fs.existsSync(file))fs.unlinkSync(file);
}
async function analyzeRecords(context,{deadline=Infinity}={}){
 const pending=read(path.join(context.dir,'analysis-intent.json'));if(pending)finishAnalysis(context,pending);
 const records=read(path.join(context.dir,'records.json'),[]),base=baselineFactory(context.state.baselineCommit),jobs=[];
 for(const record of records){const r=replay(record);for(const pos of r.positions)if(pos.type==='move')jobs.push({record,...pos});}
 importedSamples(context,records);
 const done=new Set(context.state.analysisDone||[]);
 for(const job of jobs){const id=job.record.id+':'+job.ply;if(done.has(id))continue;if(stopped(context.dir)||Date.now()>=deadline)return false;
  const lessons=lessonsFor(context),E=base.createEngine({firstPlayer:job.firstPlayer,optimized:true}),r=E.analyze(job.board,job.p,context.settings.analysisMs,lessons),shape=E.inspect(job.board,job.actual,job.p),after=job.board.slice();after[job.actual]=job.p;
  const actualProof=shape.win.length?null:E.forcing(after,3-job.p,13,Math.max(30,context.settings.analysisMs*.25));
  const row={id,gameId:job.record.id,familyId:job.record.familyId,split:job.record.split,ply:job.ply+1,p:job.p,actual:coord(job.actual),recommended:r.i==null?null:coord(r.i),score:r.score,depth:r.depth,nodes:r.nodes,ms:r.ms,lessonHash:hash(lessons),rulesId:RULES_ID,actualRefuted:!!actualProof?.proof,actualRefutation:actualProof?.proof?.pv?.map(coord)||[],positionLossProven:!!r.lossProven,proofStatus:r.proofStatus,assessmentStatus:r.assessmentStatus,alternativeWinProven:!!r.proven,candidates:(r.candidates||[]).slice(0,8).map(x=>({i:x.i,coord:coord(x.i),score:x.score,pv:x.pv?.map(coord)})),labelScope:'bounded teacher estimate; missing proof is uncertain'};
  const value=Number.isFinite(r.score)?Math.tanh(r.score/200000):0;
  const teacher=job.record.split==='train'&&context.state.counters.samples<context.settings.maxSamples?sample(context,{id:'teacher:'+id,familyId:job.record.familyId,split:job.record.split,board:job.board,p:job.p,firstPlayer:job.firstPlayer,target:value,weight:.15,labelType:'teacher',source:{gameId:job.record.id,ply:job.ply,baselineCommit:context.state.baselineCommit,kind:'deeper-bounded-reanalysis',score:r.score,depth:r.depth,actualRefuted:row.actualRefuted,proofStatus:r.proofStatus}}):null;
  const intent={schemaVersion:1,runId:context.state.runId,baselineCommit:context.state.baselineCommit,id,row,sample:teacher,progress:{completed:done.size+1,total:jobs.length,gameId:job.record.id,ply:job.ply+1}};atomic(path.join(context.dir,'analysis-intent.json'),intent);finishAnalysis(context,intent);done.add(id);await new Promise(resolve=>setImmediate(resolve));
 }
 return true;
}
function makeGame(context,index,records){
 const seed=context.settings.seed+index*7919,random=rng(seed),train=records.filter(r=>r.split==='train');let start,branch;
 const fraction=context.settings.recordBranchFraction;if(fraction!=null&&(!Number.isFinite(fraction)||fraction<0||fraction>1))throw Error('recordBranchFraction must be between 0 and 1');
 if(train.length&&(fraction==null?index%3!==2:random.next()<fraction)){const record=train[Math.floor(random.next()*train.length)],r=replay(record),available=r.positions.filter(pos=>pos.type==='move'&&pos.ply<record.events.length-2),pos=available[Math.floor(random.next()*available.length)]||r.positions[0];start={board:pos.board.slice(),p:pos.p,firstPlayer:record.first,events:record.events.slice(0,pos.ply),familyId:record.familyId,split:'train'};branch={sourceGame:record.id,prefix:pos.ply,actual:pos.actual};}
 else{start=opening(seed,4+index%3,seed%2?1:2);start.familyId='family-'+hash(familyFor(start.events.slice(0,4),start.firstPlayer)).slice(0,24);start.split=context.state.familySplits?.[start.familyId]||(context.state.sourceFamilyIndex?require('./corpus.cjs').familySplit(context,start.familyId):null)||splitFor(start.familyId,context.settings.seed);branch={sourceGame:null,prefix:start.events.length};}
 const model=modelFor(context),lessons=lessonsFor(context);return {id:'game-'+index,index,seed,rng:random.state,board:start.board,p:start.p,firstPlayer:start.firstPlayer,opening:start.events,events:[],familyId:start.familyId,split:start.split,branch,model,modelVersion:model?.modelId||'untrained-current',lessons,lessonHash:hash(lessons),rulesId:RULES_ID,samples:[],completed:false,winner:null,elapsedMs:0};
}
function choose(E,game,settings,random){
 const before=performance.now(),r=E.analyze(game.board,game.p,settings.moveMs,game.lessons||[]),shapes=new Map();
 const inspect=i=>{if(!Number.isInteger(i)||i<0||i>=225||game.board[i])return null;if(!shapes.has(i))shapes.set(i,E.inspect(game.board,i,game.p));return shapes.get(i);};
 let i=r.i;if(!inspect(i)?.legal){if(!legalMoves(E,game.board,game.p).length)return {reason:'no-legal-move',r,ms:performance.now()-before};throw Error('Engine returned an illegal or missing move in '+game.id);}
 // Immediate wins and compulsory defenses stay intact. Exploration changes
 // bounded candidates in ordinary positions, never a certified rule result.
 if(!r.urgent&&!r.proven&&!r.lossProven&&random.next()<settings.exploration){const rejected=new Set((r.rejected||[]).filter(x=>x.verifiedRefutation||x.pv?.length||x.line?.length||x.replyTrap).map(x=>x.i));const pool=(r.candidates||[]).filter(x=>!rejected.has(x.i)&&inspect(x.i)?.legal).slice(0,4);if(pool.length)i=pool[Math.floor(random.next()*pool.length)].i;else if(!r.threats?.length&&game.events.length<6){const near=E.candidates(game.board).filter(j=>!rejected.has(j)&&inspect(j)?.legal);if(near.length)i=near[Math.floor(random.next()*near.length)];}}
 return {i,r,shape:inspect(i),ms:performance.now()-before};
}
function verifyGame(game){
 const checked=replay({id:game.id,first:game.firstPlayer,rulesId:game.rulesId,events:[...(game.opening||[]),...(game.events||[])]},{engine:currentFactory({firstPlayer:game.firstPlayer,strategy:false,model:null})});
 if(!Array.isArray(game.board)||game.board.length!==225||checked.p!==game.p||checked.board.some((stone,i)=>stone!==game.board[i]))throw Error('Stored game board/turn does not match independent replay in '+game.id);
 if(game.completed&&(!checked.completed||(checked.draw?0:checked.winner)!==game.winner))throw Error('Stored terminal result does not match independent replay in '+game.id);
 return checked;
}
function cancelled(cancelBuffer){return !!cancelBuffer&&Atomics.load(new Int32Array(cancelBuffer),0)!==0;}
async function play(context,game,{deadline=Infinity,onMove=()=>{},cancelBuffer}={}){
 const model=game.model??null,E=currentFactory({firstPlayer:game.firstPlayer,optimized:true,model}),random=rng(game.rng);if((model?.modelId||'untrained-current')!==game.modelVersion)throw Error('Cannot resume a partial game with a different model');
 const checked=verifyGame(game);let empty=game.board.filter(x=>!x).length;if(checked.completed){game.completed=true;game.winner=checked.draw?0:checked.winner;game.reason=checked.draw?'full-board':'played-exact-five';}
 while(!game.completed){
  if(stopped(context.dir)||Date.now()>=deadline){game.reason=stopped(context.dir)?'user-stop':'time-limit';break;}
  if(cancelled(cancelBuffer)){game.reason='pipeline-yield';break;}
  if(game.events.length>=context.settings.maxPlies){game.reason='ply-limit';break;}
  const choice=choose(E,game,context.settings,random);game.elapsedMs+=choice.ms;if(choice.i==null){game.reason=choice.reason;break;}
  if(game.events.length%context.settings.sampleEvery===0||game.events.length<3)game.samples.push({board:game.board.slice(),p:game.p,ply:game.opening.length+game.events.length});
  const shape=choice.shape;game.events.push({type:'move',p:game.p,i:choice.i,depth:choice.r.depth,nodes:choice.r.nodes,elapsedMs:choice.ms});game.board[choice.i]=game.p;game.p=3-game.p;game.rng=random.state;empty--;
  if(shape.win.length){game.completed=true;game.winner=3-game.p;game.reason='played-exact-five';}else if(!empty){game.completed=true;game.winner=0;game.reason='full-board';}
  await onMove(game);await new Promise(resolve=>setImmediate(resolve));
 }
 if(game.completed)verifyGame(game);return game;
}
function generationQueue(context,records,target,deadline,cancelBuffer){
 const queue=Object.values(context.state.activeGames).sort((a,b)=>a.index-b.index);context.state.generationIndex=Math.max(context.state.generationIndex,...queue.map(g=>g.index+1),0);
 return ()=>{if(cancelled(cancelBuffer)||stopped(context.dir)||Date.now()>=deadline||context.state.counters.samples>=context.settings.maxSamples)return null;if(queue.length)return queue.shift();if(context.state.counters.generatedGames+Object.keys(context.state.activeGames).length>=target)return null;const game=makeGame(context,context.state.generationIndex++,records);context.state.activeGames[game.id]=game;save(context);return game;};
}
function progress(context,game,target){context.state.activeGames[game.id]=game;context.state.progress={gameId:game.id,ply:game.opening.length+game.events.length,workers:context.settings.workers,target};const storage=require('./state.cjs');(storage.saveProgress||save)(context,game);}
function commit(context,game){verifyGame(game);require('./journal.cjs').commitGame(context,game,rowsForGame(context,game));}
async function generate(context,{deadline=Infinity,target=context.settings.games,cancelBuffer}={}){
 require('./journal.cjs').recoverGames(context);
 if(context.settings.workers>1)return generateParallel(context,{deadline,target,cancelBuffer,recovered:true});
 const records=read(path.join(context.dir,'records.json'),[]);importedSamples(context,records);const next=generationQueue(context,records,target,deadline,cancelBuffer);
 for(;;){const game=next();if(!game)return context.state.counters.generatedGames>=target;
  await play(context,game,{deadline,cancelBuffer,onMove:g=>progress(context,g,target)});
  if(!game.completed&&['user-stop','time-limit','pipeline-yield'].includes(game.reason)){save(context);return false;}
  commit(context,game);
 }
}
function createWorkerPool(size){
 if(!Number.isInteger(size)||size<1||size>8)throw Error('Game worker pool size must be between 1 and 8');
 const lanes=Array.from({length:size},()=>{
  const worker=new Worker(__filename,{workerData:{learningPool:true}});let pending=null,failure=null,closing=false;
  const fail=error=>{failure=error;const task=pending;pending=null;if(task)task.reject(error);};
  worker.on('error',fail);worker.on('exit',code=>{if(!closing)fail(Error('Game worker exited unexpectedly ('+code+')'));});
  worker.on('message',message=>{if(closing)return;if(!pending||message.taskId!==pending.id){fail(Error('Unexpected worker task identity'));return;}const task=pending;try{if(message.progress){const persisted=task.onProgress(message.game),ack=()=>worker.postMessage({ack:task.id,ply:message.game.events.length});if(persisted?.then)Promise.resolve(persisted).then(ack).catch(fail);else ack();}else if(message.result){pending=null;task.resolve(message.result);}else if(message.error)fail(Error(message.error));else fail(Error('Unknown worker message'));}catch(error){fail(error);}});
  return {run(task,onProgress=()=>{}){if(failure)return Promise.reject(failure);if(closing)return Promise.reject(Error('Game worker pool is closed'));if(pending)return Promise.reject(Error('Game worker lane is already busy'));return new Promise((resolve,reject)=>{pending={id:task.game.id,resolve,reject,onProgress};try{worker.postMessage({task});}catch(error){fail(error);}});},async close(){closing=true;if(pending)fail(Error('Game worker pool closed during a task'));await worker.terminate();},get threadId(){return worker.threadId;}};
 });
 return {lanes,async close(){await Promise.allSettled(lanes.map(lane=>lane.close()));}};
}
async function generateParallel(context,{deadline=Infinity,target=context.settings.games,recovered=false,cancelBuffer}={}){
 if(!recovered)require('./journal.cjs').recoverGames(context);
 const records=read(path.join(context.dir,'records.json'),[]);importedSamples(context,records);const next=generationQueue(context,records,target,deadline,cancelBuffer),pool=createWorkerPool(context.settings.workers);let incomplete=false;
 const work=async lane=>{for(;;){const game=next();if(!game)return;const result=await lane.run({dir:context.dir,settings:context.settings,game,deadline,cancelBuffer},g=>progress(context,g,target));context.state.activeGames[game.id]=result;
  if(!result.completed&&['time-limit','user-stop','pipeline-yield'].includes(result.reason)){incomplete=true;save(context);return;}
  commit(context,result);
 }};
 try{const results=await Promise.allSettled(pool.lanes.map(async lane=>{try{return await work(lane);}catch(error){fs.writeFileSync(path.join(context.dir,'stop.flag'),'worker failure');throw error;}}));const failure=results.find(x=>x.status==='rejected');if(failure)throw failure.reason;return !incomplete&&context.state.counters.generatedGames>=target;}finally{await pool.close();}
}
if(!isMainThread&&workerData?.learningPool){let busy=false,acknowledgement=null;parentPort.on('message',message=>{if(message.ack){if(acknowledgement?.taskId===message.ack&&acknowledgement.ply===message.ply){const pending=acknowledgement;acknowledgement=null;pending.resolve();}return;}const task=message.task,taskId=task?.game?.id;if(busy||!task){parentPort.postMessage({taskId,error:'Worker received an invalid or overlapping task'});return;}busy=true;play({dir:task.dir,settings:task.settings},task.game,{deadline:task.deadline,cancelBuffer:task.cancelBuffer,onMove:game=>new Promise(resolve=>{acknowledgement={taskId,ply:game.events.length,resolve};parentPort.postMessage({taskId,progress:true,game});})}).then(game=>{busy=false;parentPort.postMessage({taskId,result:game});}).catch(error=>{busy=false;acknowledgement=null;parentPort.postMessage({taskId,error:error.stack||error.message});});});}
module.exports={features,modelFor,lessonsFor,sample,rowsForGame,sampleGame,importedSamples,finishAnalysis,analyzeRecords,makeGame,choose,verifyGame,play,createWorkerPool,generate,generateParallel};
