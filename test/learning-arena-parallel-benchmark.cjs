'use strict';
// Opt-in timing of legal validation prefixes. Never add these partial jobs to
// training, adjudicate them as wins, or use them for candidate adoption.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const S=require('../tools/learning/state.cjs'),R=require('../tools/learning/replay.cjs'),A=require('../tools/learning/arena.cjs'),current=require('../src/node-engine.cjs');
const source=path.resolve(process.argv[2]||'outputs/learning/runs/run-20261007155803320-b3fd6c'),out=path.resolve(process.argv[3]||path.join(S.ROOT,'work/arena-parallel-benchmark-'+Date.now())),model=S.read(path.join(source,'candidate.json'));
if(!model)throw Error('A saved candidate is required for the matched benchmark');
const count=12,plies=10,moveMs=100,lessons=S.read(path.join(source,'lessons.json'),{lessons:[]}).lessons.filter(l=>l.active!==false);
const originals=Array.from({length:count},(_,n)=>{const start=R.opening(1707+n*1237,4+n%3),candidateFirst=n%2===0;return {id:'prefix-'+n,pairId:'pair-'+n,familyId:start.familyId,opponent:'baseline',candidateFirst,candidateColor:candidateFirst?start.firstPlayer:3-start.firstPlayer,firstPlayer:start.firstPlayer,opening:start.events,board:start.board,p:start.p,events:[],completed:false,winner:null,elapsedMs:0};});
try{os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
async function measure(workers){
 const dir=path.join(out,'workers-'+workers);fs.mkdirSync(dir,{recursive:true});const games=structuredClone(originals),context={dir,state:{runId:'prefix-benchmark',cycle:1,counters:{completedGames:0,samples:0}}},state={candidateHash:S.hash(model),incumbentHash:null,baselineCommit:S.BASELINE,rulesId:S.RULES_ID,lessonHash:S.hash(lessons),settingsHash:S.hash({moveMs,workers}),moveMs,lessons,games},start=performance.now();let pool,baseline;
 if(workers>1)pool=A.createArenaWorkerPool(workers,state,model);else baseline=S.baselineFactory(S.BASELINE);
 const play=async(game,lane)=>{const cancelBuffer=new SharedArrayBuffer(4),onMove=updated=>{if(updated!==game)Object.assign(game,updated);A.appendArenaMove(context,state,game);if(game.events.length>=plies)Atomics.store(new Int32Array(cancelBuffer),0,1);};
  if(lane)Object.assign(game,await lane.run({dir,game,deadline:Date.now()+60000,cancelBuffer},onMove));
  else await A.playArenaGame(context,state,game,{deadline:Date.now()+60000,cancelBuffer,challenger:current({firstPlayer:game.firstPlayer,optimized:true,model}),opponent:baseline.createEngine({firstPlayer:game.firstPlayer,optimized:true}),onMove});
  A.verifyArenaGame(game);
 };
 try{if(pool){let cursor=0;await Promise.all(pool.lanes.map(async lane=>{for(;;){const game=games[cursor++];if(!game)return;await play(game,lane);}}));}else for(const game of games)await play(game,null);}finally{if(pool)await pool.close();}
 const seconds=(performance.now()-start)/1000,moves=games.reduce((n,g)=>n+g.events.length,0);return {workers,seconds,moves,movesPerSecond:moves/seconds,completedPrefixes:games.length,terminalGames:games.filter(g=>g.completed).length,gameMoves:games.map(g=>g.events.length),allReplayedLegally:true};
}
(async()=>{const sequential=await measure(1),parallel=await measure(10),report={at:new Date().toISOString(),identity:S.sourceIdentity(),modelId:model.modelId,host:{cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length},workload:{games:count,maximumAdditionalPlies:plies,moveMs,fixedSeed:true,durableMoveAcknowledgements:true},sequential,parallel,wallTimeSpeedup:sequential.seconds/parallel.seconds,moveThroughputSpeedup:parallel.movesPerSecond/sequential.movesPerSecond,scope:'One local trial of matched legal validation prefixes at a reduced 100ms move budget, including startup and durable writes. Timed searches may select different ordinary moves. This does not measure full 1000ms games or establish playing strength, adoption, or guaranteed production speedup.'};S.atomic(path.join(out,'report.json'),report);console.log(JSON.stringify(report));})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
