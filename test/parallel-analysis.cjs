'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{Worker}=require('node:worker_threads');
const {mergeRound,checkFinalists,readerVictory}=require('../src/parallel-analysis.js'),{createEngine}=require('../src/reader-engine.js');
const fixture=require('./reader/game33.cjs');
const workerSource=`const {parentPort,workerData}=require('node:worker_threads');const {createEngine}=require(workerData.module);const e=createEngine(15,workerData.board,workerData.options);parentPort.postMessage(e.compareRoots(workerData.p,workerData.roots,workerData.depth,30000));`;
const compute=data=>new Promise((resolve,reject)=>{const w=new Worker(workerSource,{eval:true,workerData:data});w.once('message',resolve);w.once('error',reject);w.once('exit',code=>{if(code)reject(Error('Worker exit '+code));});});
(async()=>{
 for(const color of [1,2]){
  const board=fixture.position(6).map(v=>v&&color===1?3-v:v),p=color;
  const initial=createEngine(15,board,{exportRootFrontier:true,optimized:true,firstPlayer:color}).analyze(p,500),roots=initial.rootFrontier;
  assert(roots?.length>3);const options={fixedWork:true,optimized:true,firstPlayer:color},serial=createEngine(15,board,options).compareRoots(p,roots,2,30000);assert(serial.complete);
  const groups=Array.from({length:3},()=>[]);roots.forEach((r,k)=>groups[k%3].push(r));
  const parts=await Promise.all(groups.map(part=>compute({module:path.resolve('src/reader-engine.js'),board,p,roots:part,options,depth:2})));
  const merged=mergeRound(roots,parts,2);assert(merged);const sorted=serial.rows.slice().sort((a,b)=>b.score-a.score||roots.findIndex(r=>r.i===a.i)-roots.findIndex(r=>r.i===b.i));
  assert.deepEqual(merged.map(r=>[r.i,r.score,r.pv]),sorted.map(r=>[r.i,r.score,r.pv]),'same complete tree, root scores and PVs across physical Workers');
  assert.equal(mergeRound(roots,[...parts.slice(0,2),{complete:false,rows:parts[2].rows}],2),null);
  assert.equal(mergeRound(roots,[...parts,parts[0]],2),null);assert.equal(mergeRound(roots,parts,3),null);
  const excluded=mergeRound(roots,parts,2,new Set([merged[0].i]));assert.notEqual(excluded[0].i,merged[0].i);
 }
 console.log('PASS real Worker threads: same finite-tree root scores and legal PVs in both colors; incomplete, duplicate, mixed-depth rounds rejected');
 const workers=[],timers=new Map(),events=[];let id=0,finished=null;
 class BrowserWorker{constructor(){workers.push(this);}postMessage(m){this.job=m;}terminate(){this.stopped=true;}}
 const ctx={module:{exports:{}},performance:{now:()=>0},Worker:BrowserWorker,Blob:class{},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},setTimeout:(fn)=>{timers.set(++id,fn);return id;},clearTimeout:n=>timers.delete(n)};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('src/parallel-analysis.js','utf8'),ctx);
 const rootRows=[{i:1},{i:2},{i:3}],pool=ctx.module.exports.start({source:'',base:{p:1,b:[],modelInfo:{}},budget:23500,mode:'deep',hardware:16,onProgress:r=>events.push(r),onDone:r=>finished=r,onError:e=>{throw Error(e);}});
 workers[0].onmessage({data:{type:'plan',result:{rootFrontier:rootRows,screeningComplete:true,forcingChecksComplete:true}}});
 const result=(k,score,complete=true)=>({type:'round',round:workers[k].job.round,result:{complete,nodes:1,rows:[{i:k+1,score,pv:[k+1],depth:workers[k].job.depth,comparisonComplete:true}]}});
 workers[0].onmessage({data:result(0,30)});workers[1].onmessage({data:result(1,20)});assert.equal(events.length,0);
 workers[2].onmessage({data:result(2,10)});assert.equal(events.length,1);assert.equal(events[0].i,1);
 workers[0].onmessage({data:result(0,9999)});pool.observe({rejected:[{i:1,line:[1,4]}]});
 [...timers.values()][0]();assert.equal(finished,null,'reserve final checks for actual parallel shortlist');const guard=workers.at(-1);assert.equal(guard.job.type,'guard');assert(guard.job.ms>0);
 guard.onmessage({data:{type:'guard-progress',check:{i:2,complete:true,refuted:true,rejection:{i:2,pv:[3,4],verifiedRefutation:true}}}});
 guard.onmessage({data:{type:'guard-progress',check:{i:3,complete:false,refuted:false}}});guard.onmessage({data:{type:'guard'}});
 assert.equal(finished.i,3);assert.equal(finished.depth,1);assert(finished.analysisIncomplete);assert(finished.rejected.some(r=>r.i===2));assert(workers.every(w=>w.stopped));
 assert(events.at(-1).rejected.some(r=>r.i===2),'new guard proof reaches the main watchdog even if no pool finalist survives');const delivered=events.length;
 workers[2].onmessage({data:result(2,99999)});assert.equal(events.length,delivered);assert.equal(finished.i,3);
 console.log('PASS browser scheduler: complete equal-depth rounds, final guard rejects actual pool finalist, retain proof at deadline and ignore late messages');
 const board=Array(225).fill(0),checked=[],engine={inspect:()=>({legal:true,fours:[]}),forcing:(after)=>{const i=after.findIndex(Boolean);return i===1?{proof:{pv:[5,6]},complete:true}:i===2?{complete:false}:{complete:true};},quietTrap:()=>({complete:true}),forcedReplyTrap:()=>{throw Error('wrong guard');}};
 const checks=checkFinalists(engine,board,1,[{i:1},{i:2},{i:3}],1000,c=>checked.push(c));
 assert(checks[0].refuted&&checks[0].rejection.verifiedRefutation);assert(!checks[1].complete);assert(checks[2].complete&&!checks[2].refuted);assert.equal(checked.length,3);assert(board.every(v=>v===0));
 console.log('PASS final shortlist guard preserves opponent proofs and distinguishes incomplete checks from bounded complete checks');
 for(const color of [1,2])for(const mode of ['auto','deep']){
  const b=Array(225).fill(0);for(const i of [111,112,113])b[i]=color;
  const proof=createEngine(15,b,{optimized:true}).analyze(color,700);assert.equal(proof.kind,'forced');assert(!proof.rootFrontier);
  const startAt=workers.length;let win,failed=0;
  ctx.module.exports.start({source:'',base:{p:color,b,modelInfo:{}},budget:mode==='auto'?14100:23500,mode,hardware:8,
   onProgress:()=>{},onDone:r=>win=r,onError:()=>failed++});
  const planWorker=workers[startAt];planWorker.onmessage({data:{type:'plan',result:proof}});
  assert(win?.proven&&!win.lossProven,'a planner certificate is a result even without a root frontier');assert.equal(win.i,proof.moves[0].i);
  assert.equal(win.analysisWork.stopReason,'verified-win');assert.equal(failed,0);assert(workers.slice(startAt).every(w=>w.stopped));assert.equal(timers.size,0);
  planWorker.onmessage({data:{type:'plan',result:{kind:'search',rootFrontier:[{i:0}]}}});assert.equal(win.i,proof.moves[0].i,'late plans cannot replace a win');
  for(const changed of [{...proof,kind:'search'},{...proof,kind:'lost'},{...proof,proof:null},{...proof,moves:[{...proof.moves[0],status:'unverified'}]}])assert.equal(readerVictory(changed),null);
 }
 console.log('PASS real Reader plan wins in both colors preempt auto/deep comparison without a frontier; scores, losses and partial claims cannot');
})().catch(error=>{console.error(error);process.exitCode=1;});
