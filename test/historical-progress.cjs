const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {analyzePosition,index}=require('../src/historical-analysis.cjs');
const board=Array(225).fill(0);
for(const c of ['A1','B1','C1','D1'])board[index(c)]=2;
const snapshots=[];
const result=analyzePosition({board,moveNumber:6,actual:'F1',loser:2,ms:500,rules:{fivePriority:false},forcedCandidates:['E1']},r=>snapshots.push(r));
assert(snapshots.length>=2);
assert(snapshots.every(r=>r.complete===false));
assert.equal(result.complete,true);
assert.equal(snapshots[0].candidates.length,1,'later candidates do not mutate prior snapshots');
assert.equal(result.candidates.find(c=>c.move==='E1').level,4);

// Deterministic worker stall: a completed candidate must survive the hard timer,
// while an unreported candidate must never be invented or published as complete.
let finalMessage=false,terminated=0;
const partial={move_number:2,actual_move:'G7',actual:{move:'G7',level:0},recommended:null,
  complete:false,candidates:[{move:'G7',level:0}],search:{nodes:5,completed_depth:2}};
class FakeWorker extends EventEmitter {
  constructor(){super();queueMicrotask(()=>{this.emit('message',{type:'progress',result:partial});
    if(finalMessage)this.emit('message',{type:'result',result:{...partial,complete:true}});});}
  terminate(){terminated++;return Promise.resolve();}
}
const sandbox={module:{exports:{}},__filename:__filename,Date,console,setTimeout,clearTimeout,
  require:id=>id==='node:worker_threads'?{Worker:FakeWorker,isMainThread:true}:id==='./node-engine.cjs'?require('../src/node-engine.cjs'):require(id)};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/historical-analysis.cjs'),'utf8'),sandbox);
(async()=>{
  const start=Date.now();
  const r=await sandbox.module.exports.analyze_game(['H8','G7'],'white',160,{workers:1});
  const p=r.alternatives[0];
  assert.equal(p.timeout,true);assert.equal(p.complete,false);
  assert.equal(p.candidates.length,1);assert.equal(p.candidates[0].move,'G7');
  assert.equal(p.search.completed_depth,2);assert.equal(terminated,1);
  assert(Date.now()-start<350);
  finalMessage=true;
  const done=await sandbox.module.exports.analyze_game(['H8','G7'],'white',160,{workers:1});
  assert.equal(done.alternatives[0].complete,true);
  assert.equal(done.alternatives[0].timeout,undefined);
  assert.equal(terminated,2);
  console.log('PASS completed-candidate snapshots, stalled-worker fallback, final message, hard timer');
})().catch(e=>{console.error(e);process.exitCode=1;});
