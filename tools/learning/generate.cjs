'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {ROOT,RULES_ID,FEATURE_VERSION,hash,append,read,rng,save,stopped,baselineFactory}=require('./state.cjs');
const {replay,outcome,legalMoves,opening,splitFor,coord,positionKey}=require('./replay.cjs');
const currentFactory=options=>require('../../src/node-engine.cjs')(options);
function neural(){return require('../../src/neural-evaluator.js');}
function features(board,p,first){return Array.from(neural().extractFeatures(board,p,first));}
function modelFor(context){const adopted=path.join(context.dir,'champion.json');return fs.existsSync(adopted)?read(adopted):null;}
function lessonsFor(context){return (read(path.join(context.dir,'lessons.json'),{lessons:[]}).lessons||[]).filter(l=>l.active!==false);}
function sample(context,{id,familyId,split,board,p,firstPlayer,target,weight=1,labelType='terminal',source}){
 return {schemaVersion:1,sampleId:id,rulesId:RULES_ID,featureVersion:FEATURE_VERSION,familyId,split,positionKey:positionKey(board,p,firstPlayer),features:features(board,p,firstPlayer),target,weight,labelType,position:{board,p,firstPlayer},source};
}
function sampleGame(context,game){
 if(!game.completed)return 0;let n=0;for(const item of game.samples||[]){append(path.join(context.dir,'dataset.jsonl'),sample(context,{id:game.id+':'+item.ply,familyId:game.familyId,split:game.split,board:item.board,p:item.p,firstPlayer:game.firstPlayer,target:game.winner===0?0:game.winner===item.p?1:-1,source:{gameId:game.id,ply:item.ply,branch:game.branch,seed:game.seed,modelVersion:game.modelVersion,lessonHash:game.lessonHash,kind:'actual-played-terminal'}}));n++;}return n;
}
function importedSamples(context,records){
 const seen=new Set(context.state.importedSampleGames||[]);for(const record of records){if(seen.has(record.id))continue;const r=replay(record);if(r.completed){for(const pos of r.positions){if(pos.type!=='move')continue;append(path.join(context.dir,'dataset.jsonl'),sample(context,{id:'record:'+record.id+':'+pos.ply,familyId:record.familyId,split:record.split,board:pos.board,p:pos.p,firstPlayer:record.first,target:r.draw?0:r.winner===pos.p?1:-1,source:{gameId:record.id,ply:pos.ply,kind:'record-terminal',labelMeaning:'position outcome; does not classify the played move as bad'}}));context.state.counters.samples++;}}seen.add(record.id);context.state.importedSampleGames=[...seen];save(context);}
}
async function analyzeRecords(context,{deadline=Infinity}={}){
 const records=read(path.join(context.dir,'records.json'),[]),base=baselineFactory(context.state.baselineCommit),jobs=[];
 for(const record of records){const r=replay(record);for(const pos of r.positions)if(pos.type==='move')jobs.push({record,...pos});}
 importedSamples(context,records);
 const done=new Set(context.state.analysisDone||[]);
 for(const job of jobs){const id=job.record.id+':'+job.ply;if(done.has(id))continue;if(stopped(context.dir)||Date.now()>=deadline)return false;
  const lessons=lessonsFor(context),E=base.createEngine({firstPlayer:job.firstPlayer,optimized:true}),r=E.analyze(job.board,job.p,context.settings.analysisMs,lessons),shape=E.inspect(job.board,job.actual,job.p),after=job.board.slice();after[job.actual]=job.p;
  const actualProof=shape.win.length?null:E.forcing(after,3-job.p,13,Math.max(30,context.settings.analysisMs*.25));
  const row={id,gameId:job.record.id,familyId:job.record.familyId,split:job.record.split,ply:job.ply+1,p:job.p,actual:coord(job.actual),recommended:r.i==null?null:coord(r.i),score:r.score,depth:r.depth,nodes:r.nodes,ms:r.ms,lessonHash:hash(lessons),rulesId:RULES_ID,actualRefuted:!!actualProof?.proof,actualRefutation:actualProof?.proof?.pv?.map(coord)||[],positionLossProven:!!r.lossProven,proofStatus:r.proofStatus,assessmentStatus:r.assessmentStatus,alternativeWinProven:!!r.proven,candidates:(r.candidates||[]).slice(0,8).map(x=>({i:x.i,coord:coord(x.i),score:x.score,pv:x.pv?.map(coord)})),labelScope:'bounded teacher estimate; missing proof is uncertain'};
  append(path.join(context.dir,'analysis.jsonl'),row);
  const value=Number.isFinite(r.score)?Math.tanh(r.score/200000):0;
  if(job.record.split==='train'&&context.state.counters.samples<context.settings.maxSamples){append(path.join(context.dir,'dataset.jsonl'),sample(context,{id:'teacher:'+id,familyId:job.record.familyId,split:job.record.split,board:job.board,p:job.p,firstPlayer:job.firstPlayer,target:value,weight:.15,labelType:'teacher',source:{gameId:job.record.id,ply:job.ply,baselineCommit:context.state.baselineCommit,kind:'deeper-bounded-reanalysis',score:r.score,depth:r.depth,actualRefuted:row.actualRefuted,proofStatus:r.proofStatus}}));context.state.counters.samples++;}
  done.add(id);context.state.analysisDone=[...done];context.state.counters.analyzedPositions++;context.state.progress={completed:done.size,total:jobs.length,gameId:job.record.id,ply:job.ply+1};save(context);await new Promise(resolve=>setImmediate(resolve));
 }
 return true;
}
function makeGame(context,index,records){
 const seed=context.settings.seed+index*7919,random=rng(seed),train=records.filter(r=>r.split==='train');let start,branch;
 if(train.length&&index%3!==2){const record=train[Math.floor(random.next()*train.length)],r=replay(record),available=r.positions.filter(pos=>pos.type==='move'&&pos.ply<record.events.length-2),pos=available[Math.floor(random.next()*available.length)]||r.positions[0];start={board:pos.board.slice(),p:pos.p,firstPlayer:record.first,events:record.events.slice(0,pos.ply),familyId:record.familyId,split:'train'};branch={sourceGame:record.id,prefix:pos.ply,actual:pos.actual};}
 else{start=opening(seed,4+index%3,seed%2?1:2);start.split=splitFor(start.familyId,context.settings.seed);branch={sourceGame:null,prefix:start.events.length};}
 const model=modelFor(context),lessons=lessonsFor(context);return {id:'game-'+index,index,seed,rng:random.state,board:start.board,p:start.p,firstPlayer:start.firstPlayer,opening:start.events,events:[],familyId:start.familyId,split:start.split,branch,model,modelVersion:model?.modelId||'untrained-current',lessons,lessonHash:hash(lessons),rulesId:RULES_ID,samples:[],completed:false,winner:null,elapsedMs:0};
}
function choose(E,game,settings,random){
 const before=performance.now(),r=E.analyze(game.board,game.p,settings.moveMs,game.lessons||[]),legal=legalMoves(E,game.board,game.p);
 if(!legal.length)return {reason:'no-legal-move',r,ms:performance.now()-before};
 let i=r.i;if(i==null||!E.inspect(game.board,i,game.p).legal)throw Error('Engine returned an illegal or missing move in '+game.id);
 // Immediate wins and compulsory defenses stay intact. Exploration changes
 // bounded candidates in ordinary positions, never a certified rule result.
 if(!r.urgent&&!r.proven&&!r.lossProven&&random.next()<settings.exploration){const rejected=new Set((r.rejected||[]).filter(x=>x.verifiedRefutation||x.pv?.length||x.line?.length||x.replyTrap).map(x=>x.i));const pool=(r.candidates||[]).filter(x=>x.i!=null&&!rejected.has(x.i)&&legal.includes(x.i)).slice(0,4);if(pool.length)i=pool[Math.floor(random.next()*pool.length)].i;else if(!r.threats?.length&&game.events.length<6){const near=E.candidates(game.board).filter(j=>legal.includes(j)&&!rejected.has(j));if(near.length)i=near[Math.floor(random.next()*near.length)];}}
 return {i,r,ms:performance.now()-before};
}
async function play(context,game,{deadline=Infinity,onMove=()=>{}}={}){
 const model=game.model??null,E=currentFactory({firstPlayer:game.firstPlayer,optimized:true,model}),random=rng(game.rng);if((model?.modelId||'untrained-current')!==game.modelVersion)throw Error('Cannot resume a partial game with a different model');
 while(!game.completed){const terminal=outcome(E,game.board);if(terminal){Object.assign(game,terminal);break;}
  if(stopped(context.dir)||Date.now()>=deadline){game.reason=stopped(context.dir)?'user-stop':'time-limit';break;}
  if(game.events.length>=context.settings.maxPlies){game.reason='ply-limit';break;}
  const choice=choose(E,game,context.settings,random);game.elapsedMs+=choice.ms;if(choice.i==null){game.reason=choice.reason;break;}
  if(game.events.length%context.settings.sampleEvery===0||game.events.length<3)game.samples.push({board:game.board.slice(),p:game.p,ply:game.opening.length+game.events.length});
  const shape=E.inspect(game.board,choice.i,game.p);game.events.push({type:'move',p:game.p,i:choice.i,depth:choice.r.depth,nodes:choice.r.nodes,elapsedMs:choice.ms});game.board[choice.i]=game.p;game.p=3-game.p;game.rng=random.state;
  if(shape.win.length){game.completed=true;game.winner=3-game.p;game.reason='played-exact-five';}
  onMove(game);await new Promise(resolve=>setImmediate(resolve));
 }
 return game;
}
async function generate(context,{deadline=Infinity,target=context.settings.games}={}){
 if(context.settings.workers>1)return generateParallel(context,{deadline,target});
 const records=read(path.join(context.dir,'records.json'),[]);importedSamples(context,records);
 while(context.state.counters.generatedGames<target){if(stopped(context.dir)||Date.now()>=deadline||context.state.counters.samples>=context.settings.maxSamples)return false;
  const id='game-'+context.state.generationIndex,game=context.state.activeGames[id]||makeGame(context,context.state.generationIndex,records);context.state.activeGames[id]=game;save(context);
  await play(context,game,{deadline,onMove:g=>{context.state.activeGames[id]=g;context.state.progress={gameId:id,ply:g.opening.length+g.events.length,target};save(context);}});
  if(!game.completed&&['user-stop','time-limit'].includes(game.reason)){save(context);return false;}
  const n=sampleGame(context,game);append(path.join(context.dir,'games.jsonl'),{...game,samples:undefined,model:undefined});context.state.counters.generatedGames++;if(game.completed)context.state.counters.completedGames++;context.state.counters.samples+=n;delete context.state.activeGames[id];context.state.generationIndex++;save(context);
 }
 return true;
}
async function generateParallel(context,{deadline,target}){
 const records=read(path.join(context.dir,'records.json'),[]);importedSamples(context,records);
 const queue=Object.values(context.state.activeGames).sort((a,b)=>a.index-b.index);context.state.generationIndex=Math.max(context.state.generationIndex,...queue.map(g=>g.index+1),0);let incomplete=false;
 function next(){if(stopped(context.dir)||Date.now()>=deadline||context.state.counters.samples>=context.settings.maxSamples)return null;if(queue.length)return queue.shift();if(context.state.counters.generatedGames+Object.keys(context.state.activeGames).length>=target)return null;const game=makeGame(context,context.state.generationIndex++,records);context.state.activeGames[game.id]=game;save(context);return game;}
 const work=async()=>{for(;;){const game=next();if(!game)return;
  const result=await new Promise((resolve,reject)=>{const worker=new Worker(__filename,{workerData:{dir:context.dir,settings:context.settings,game,deadline}});let done=false;worker.on('message',message=>{if(message.progress){context.state.activeGames[game.id]=message.game;context.state.progress={gameId:game.id,ply:message.game.events.length,workers:context.settings.workers,target};save(context);}else if(message.result){done=true;resolve(message.result);}else if(message.error){done=true;reject(Error(message.error));}});worker.on('error',reject);worker.on('exit',code=>{if(!done)reject(Error('Game worker exited without a result ('+code+')'));});});
  context.state.activeGames[game.id]=result;
  if(!result.completed&&['time-limit','user-stop'].includes(result.reason)){incomplete=true;save(context);return;}
  const n=sampleGame(context,result);append(path.join(context.dir,'games.jsonl'),{...result,samples:undefined,model:undefined});context.state.counters.generatedGames++;if(result.completed)context.state.counters.completedGames++;context.state.counters.samples+=n;delete context.state.activeGames[game.id];save(context);
 }};
 const results=await Promise.allSettled(Array.from({length:context.settings.workers},async()=>{try{return await work();}catch(e){fs.writeFileSync(path.join(context.dir,'stop.flag'),'worker failure');throw e;}}));const failure=results.find(x=>x.status==='rejected');if(failure)throw failure.reason;return !incomplete&&context.state.counters.generatedGames>=target;
}
if(!isMainThread&&workerData?.game)play({dir:workerData.dir,settings:workerData.settings},workerData.game,{deadline:workerData.deadline,onMove:game=>parentPort.postMessage({progress:true,game})}).then(game=>parentPort.postMessage({result:game})).catch(e=>parentPort.postMessage({error:e.stack||e.message}));
module.exports={features,modelFor,lessonsFor,sample,sampleGame,importedSamples,analyzeRecords,makeGame,choose,play,generate,generateParallel};
