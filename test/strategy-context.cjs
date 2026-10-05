const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const create=require('../src/node-engine.cjs'),blank=()=>Array(225).fill(0);
const first=create({firstPlayer:2}),alias=create({context:{firstPlayer:1}}),unknown=create();
assert.equal(first.getContext().firstPlayer,2);assert.equal(alias.getContext().firstPlayer,1);
assert.equal(unknown.getContext().firstPlayer,null,'missing context must not imply black first');
first.configure({firstPlayer:1});assert.equal(first.getContext().firstPlayer,1);
assert.equal(first.strategicProfile(blank(),2).firstPlayer,1,'public diagnostics must forward to the reconfigured Forest instance');
first.configure({firstPlayer:null});assert.equal(first.getContext().firstPlayer,null);
assert.equal(first.strategicProfile(blank(),2).firstPlayer,null);
const board=blank();board[112]=1;
for(const p of [1,2]){
 const r=create({firstPlayer:2}).finalizeResult(board,p,{i:111,kind:'search',depth:2,score:1,pv:[111]});
 assert.equal(r.strategy.firstPlayer,2,'current color and occupied count must not redefine first player');
 assert.equal(r.strategy.context.firstPlayer,2);assert.equal(r.pv[0],111);
}
console.log('PASS optional first-player constructor/configure, alias and unknown context');

const app=fs.readFileSync('src/app.js','utf8'),rebuild=app.slice(app.indexOf('function rebuild('),app.indexOf('function render('));
let configured;
const replay={g:{first:2,rules:{fivePriority:true}},b:blank(),turn:1,winCells:[],cursor:2,
 events:[{type:'timeout',p:2,i:null},{type:'move',p:1,i:112}],
 E:{configure:options=>{configured=options;},win:()=>[]}};
vm.createContext(replay);vm.runInContext(rebuild,replay);replay.rebuild();
assert.equal(configured.firstPlayer,2);assert.equal(replay.turn,2);assert.equal(replay.b[112],1);
replay.cursor=1;replay.rebuild();assert.equal(replay.turn,1);assert.equal(replay.b[112],0);
replay.cursor=0;replay.rebuild();assert.equal(replay.turn,2);
console.log('PASS PASS, undo/replay and first player remain independent of stone-count parity');

const unified=fs.readFileSync('src/unified-app.js','utf8');
const keySource=unified.slice(unified.indexOf('const positionKey='),unified.indexOf('function configuredOwnBudget('));
const identity={g:{id:'same-game',first:2,rules:{fivePriority:true}},E:{strategyVersion:'initiative-1'},omokAcceleration:{mode:'gpu'}};
vm.createContext(identity);vm.runInContext(keySource+'\nglobalThis.key=positionKey;',identity);
const key=identity.key(blank(),1);identity.g.first=1;assert.notEqual(identity.key(blank(),1),key);
identity.g.first=2;identity.omokAcceleration.mode='cpu';assert.notEqual(identity.key(blank(),1),key);
identity.omokAcceleration.mode='gpu';identity.E.strategyVersion='initiative-2';assert.notEqual(identity.key(blank(),1),key);
assert.notEqual(identity.key(blank(),2),key);
console.log('PASS ponder identity isolates first player, current color, acceleration and strategy version');

const spawn=unified.slice(unified.indexOf('function spawnAnalysis('),unified.indexOf('function acceptResult('));
let next=0,done;const timers=new Map(),intervals=new Map();
class Worker{postMessage(data){this.data=data;}terminate(){this.stopped=true;}}
const workerContext={performance:{now:()=>0},Worker,Blob:class{},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},
 setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:i=>timers.delete(i),
 setInterval:fn=>{intervals.set(++next,fn);return next;},clearInterval:i=>intervals.delete(i),
 $:()=>({textContent:''}),g:{first:2,rules:{fivePriority:true}},db:{lessons:[]},
 E:create({firstPlayer:2}),ponder:null,omokAcceleration:{mode:'optimized',optimized:true,table:null}};
vm.createContext(workerContext);vm.runInContext(spawn,workerContext);
const w=workerContext.spawnAnalysis(blank(),1,900,()=>{},r=>{done=r;},e=>{throw Error(e);});
assert.equal(w.data.firstPlayer,2);assert.equal(w.data.p,1);assert.equal(w.data.ms,840);assert(w.data.optimized);
w.onmessage({data:{progress:true,result:{i:112,kind:'search',depth:4,score:10,pv:[112],nodes:13}}});
[...timers.values()][0]();
assert.equal(done.depth,4);assert.equal(done.nodes,13);assert(done.timedOut);assert(done.analysisIncomplete);
assert.equal(done.assessmentStatus,'INCOMPLETE');assert.equal(done.proofStatus,'UNRESOLVED');
assert.equal(done.strategy.context.firstPlayer,2);assert(w.stopped);assert.equal(intervals.size,0);
console.log('PASS Worker context, unchanged fast reserve and watchdog completion/evidence preservation');
