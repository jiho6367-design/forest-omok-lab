'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const S=require('../tools/learning/state.cjs'),R=require('../tools/learning/replay.cjs'),A=require('../tools/learning/arena.cjs');
const root=path.join(S.ROOT,'work/learning-arena-parallel-test-'+Date.now()),checks=[];
const record=R.normalizeRecords({first:2,moves:'D8 A1 E8 C1 F8 E1 G8 G1 H8'.split(' ')})[0];
function game(index,terminal=true){
 const firstPlayer=Math.floor(index/2)%2?1:2,candidateFirst=index%2===0,opening=terminal?record.events.slice(0,8).map(e=>({...e,p:firstPlayer===2?e.p:3-e.p})):[],played=R.replay({first:firstPlayer,events:opening});
 return {id:'fixture-'+index,pairId:'pair-'+Math.floor(index/2),familyId:'family-'+Math.floor(index/2),opponent:Math.floor(index/2)%2?'incumbent':'baseline',candidateFirst,candidateColor:candidateFirst?firstPlayer:3-firstPlayer,firstPlayer,opening,board:played.board,p:played.p,events:[],completed:false,winner:null,elapsedMs:0};
}
function fixture(name,workers,count=16,terminal=true){
 const context=S.init(path.join(root,name),{workers,validationMs:30,pairs:count/2});context.trialLedgerFile=path.join(context.dir,'trial-ledger.sqlite');Object.assign(context.state,{cycle:1,status:'running',phase:'validate'});
 const state={schemaVersion:1,candidateHash:'fixture-null',candidateModelId:'fixture-null',incumbentHash:null,incumbent:null,baselineCommit:S.BASELINE,rulesId:S.RULES_ID,lessonHash:S.hash([]),settingsHash:A.evaluationSettingsHash(context.settings),moveMs:30,lessons:[],trial:1,games:Array.from({length:count},(_,i)=>game(i,terminal))};
 return {context,state};
}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
(async()=>{
 await check('ten real workers reuse lanes, preserve both sides and leave learning counters untouched',async()=>{
  const {context,state}=fixture('ten-workers',10);let pool,active=0,maximum=0;const uses=[];
  const workerPool=(size,s,m)=>{pool=A.createArenaWorkerPool(size,s,m);pool.lanes.forEach((lane,i)=>{uses[i]=0;const run=lane.run.bind(lane);lane.run=async(task,progress)=>{uses[i]++;active++;maximum=Math.max(maximum,active);try{return await run(task,async update=>{await new Promise(resolve=>setTimeout(resolve,10));return progress(update);});}finally{active--;}};});return pool;};
  await A.evaluateGames(context,state,null,{deadline:Date.now()+20000,workerPool});
  assert.equal(maximum,10);assert(uses.some(n=>n>1));assert(pool.lanes.every(lane=>lane.threadId===-1));assert.equal(state.execution.configuredWorkers,10);assert.equal(context.state.progress.activeGames,0);assert.equal(context.state.progress.completed,16);
  state.games.forEach(g=>{assert.equal(g.events.length,1);assert.equal(g.winner,g.firstPlayer);assert.equal(A.verifyArenaGame(g).completed,true);});const stats=A.pairedStats(state.games);assert.equal(stats.wins,8);assert.equal(stats.losses,8);assert.equal(stats.completedPairs,8);assert.equal(context.state.counters.completedGames,0);assert.equal(context.state.counters.samples,0);
  assert.deepEqual(S.read(path.join(context.dir,'arena-cycle-1.json')).games,state.games);assert.equal(fs.readdirSync(path.join(context.dir,'arena-partials-cycle-1')).length,0);
 });
 await check('durable acknowledgement failure recovers the terminal move exactly once',async()=>{
  const {context,state}=fixture('ack-failure',1,2),pool=A.createArenaWorkerPool(1,state,null),snapshot=structuredClone(state.games[0]);
  try{await assert.rejects(pool.lanes[0].run({dir:context.dir,game:snapshot,deadline:Date.now()+10000},update=>{Object.assign(state.games[0],update);A.appendArenaMove(context,state,state.games[0]);throw Error('injected durable acknowledgement failure');}),/acknowledgement failure/);}finally{await pool.close();}
  const recovered=structuredClone(snapshot);A.restoreArenaMoves(context,state,recovered);A.restoreArenaMoves(context,state,recovered);assert.equal(recovered.events.length,1);assert.equal(recovered.completed,true);assert.equal(recovered.winner,recovered.firstPlayer);A.verifyArenaGame(recovered);assert.equal(pool.lanes[0].threadId,-1);
 });
 await check('cooperative stop and deadline preserve multiple partial games for duplicate-free resume',async()=>{
  const {context,state}=fixture('stop-resume',4,8,false);let requested=false;
  const workerPool=(size,s,m)=>{const pool=A.createArenaWorkerPool(size,s,m);for(const lane of pool.lanes){const run=lane.run.bind(lane);lane.run=(task,progress)=>run(task,update=>{progress(update);if(!requested){requested=true;S.atomic(path.join(context.dir,'stop.flag'),'test');}});}return pool;};
  await A.evaluateGames(context,state,null,{deadline:Date.now()+10000,workerPool});assert(requested);assert(state.games.some(g=>g.events.length>0));assert(state.games.every(g=>!g.completed&&!g.exhausted&&g.winner===null));assert.equal(context.state.progress.activeGames,0);
  const saved=S.read(path.join(context.dir,'arena-cycle-1.json')),prefixes=saved.games.map(g=>structuredClone(g.events));for(const g of saved.games)A.restoreArenaMoves(context,saved,g);fs.unlinkSync(path.join(context.dir,'stop.flag'));
  const before=saved.games.reduce((n,g)=>n+g.events.length,0);await A.evaluateGames(context,saved,null,{deadline:Date.now()+1800});const after=saved.games.reduce((n,g)=>n+g.events.length,0);assert(after>before);
  saved.games.forEach((g,i)=>{assert.deepEqual(g.events.slice(0,prefixes[i].length),prefixes[i]);const count=g.events.length;A.restoreArenaMoves(context,saved,g);A.restoreArenaMoves(context,saved,g);assert.equal(g.events.length,count);A.verifyArenaGame(g);});assert.equal(context.state.progress.activeGames,0);assert.equal(context.state.counters.samples,0);
 });
 await check('a lost worker cancels its peers, persists their partial turns and closes all threads',async()=>{
  const {context,state}=fixture('worker-failure',2,4,false);let pool;
  const workerPool=(size,s,m)=>{pool=A.createArenaWorkerPool(size,s,m);const lane=pool.lanes[0],run=lane.run.bind(lane);lane.run=(task,progress)=>run(task,update=>{progress(update);return lane.close();});return pool;};
  await assert.rejects(A.evaluateGames(context,state,null,{deadline:Date.now()+10000,workerPool}),/closed during a task/);assert(pool.lanes.every(lane=>lane.threadId===-1));assert.equal(context.state.progress.activeGames,0);assert(state.games.every(g=>!g.completed&&!g.exhausted));assert(state.games.some(g=>g.events.length>0));
  const saved=S.read(path.join(context.dir,'arena-cycle-1.json'));for(const g of saved.games){A.restoreArenaMoves(context,saved,g);A.verifyArenaGame(g);}assert.equal(context.state.counters.completedGames,0);
 });
 await check('worker count is fixed in the evaluation identity and pool bounds reject unsupported sizes',()=>{
  const settings=S.defaults();assert.notEqual(A.evaluationSettingsHash({...settings,workers:1}),A.evaluationSettingsHash({...settings,workers:10}));for(const size of [0,17,1.5])assert.throws(()=>A.createArenaWorkerPool(size,{},null),/between 1 and 16/);
 });
 await check('full validator keeps parity, training evidence and paired-family adoption requirements',async()=>{
  const {context,state}=fixture('full-validator',4),dataHash=S.hash('fixture-data');context.state.dataset={sha256:dataHash};
  const model={schemaVersion:1,kind:'forest-value-mlp',rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,inputSize:32,hiddenSize:16,activation:'relu',outputActivation:'tanh',normalization:{mean:Array(32).fill(0),scale:Array(32).fill(1)},layers:[{weights:Array.from({length:16},()=>Array(32).fill(0)),bias:Array(16).fill(0)},{weights:[Array(16).fill(0)],bias:[0]}],modelId:'arena-test-zero',scale:600,training:{updates:1,datasetHash:dataHash}};
  Object.assign(state,{candidateHash:S.hash(model),candidateModelId:model.modelId,datasetSha256:dataHash,identity:S.sourceIdentity(),pairs:context.settings.pairs});for(const game of state.games)if(game.opponent==='incumbent')game.opponent='current-no-model';const candidate=path.join(context.dir,'candidate.json');
  S.atomic(candidate,model);S.atomic(candidate+'.parity.json',{passed:true,modelId:model.modelId,featureVersion:model.featureVersion,cases:[{features:Array(32).fill(0),expectedValue:0,expectedEffectiveValue:0}]});S.atomic(candidate+'.training.json',{modelExported:true,modelId:model.modelId,datasetHash:dataHash,training:{updates:1},device:{finite:true}});S.atomic(path.join(context.dir,'arena-cycle-1.json'),state);
  const result=await A.validate(context,{deadline:Date.now()+20000});assert.equal(result.complete,true);assert.equal(result.passed,false);assert.equal(result.rules.passed,true);assert.equal(result.parity.passed,true);assert.equal(result.trainingCheck.passed,true);assert.equal(result.stats.baseline.completedGames,8);assert.equal(result.stats['current-no-model'].completedGames,8);assert.equal(context.state.validation.complete,true);assert(result.rejectionReasons.every(reason=>reason.startsWith('conservative strength threshold')));const summary=S.read(path.join(context.dir,'arena.summary.json'));assert.equal(summary.trial,result.trial);assert.equal(summary.cycle,context.state.cycle);assert.equal(summary.candidateHash,result.candidateHash);assert.equal(summary.games,undefined);assert.deepEqual(S.read(path.join(context.dir,'arena-cycle-1.summary.json')),summary);
  context.settings.workers=2;await assert.rejects(A.validate(context),/evaluation settings changed/);
 });
 S.atomic(path.join(root,'report.json'),{passed:checks.length,checks});console.log(JSON.stringify({passed:checks.length,artifacts:root,scope:'Actual multi-threaded legal validation, unchanged paired scores, durable acknowledgement, cooperative stop/deadline, worker failure and fixed resource identity; no adoption or strength claim.'}));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
