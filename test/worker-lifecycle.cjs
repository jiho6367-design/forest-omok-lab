const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync('src/unified-app.js','utf8');
const source=app.slice(app.indexOf('function spawnAnalysis('),app.indexOf('function acceptResult('));
let now=0,next=0,done=0,errors=0;
const intervals=new Map(),timers=new Map();
class Worker { terminate(){this.stopped=true;} postMessage(data){this.data=data;} }
const c={performance:{now:()=>now},Worker,Blob:class {},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},
 setInterval:fn=>{intervals.set(++next,fn);return next;},clearInterval:id=>intervals.delete(id),
 setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),
 $:()=>({textContent:''}),E:{inspect:()=>({legal:true})},db:{lessons:[]},g:{rules:{}},ponder:null};
c.cancelPonder=()=>{c.ponder.worker.terminate();c.ponder=null;};
vm.createContext(c);vm.runInContext(source,c);
const start=()=>c.spawnAnalysis(Array(225).fill(0),1,25000,()=>{},()=>done++,()=>errors++);
let w=start();assert.equal(w.data.ms,23500);assert.equal(intervals.size,1);assert.equal(timers.size,1);
w.terminate();assert(w.stopped);assert.equal(intervals.size,0);assert.equal(timers.size,0);
// A queued worker message after cancellation cannot complete the old request.
w.onmessage({data:{result:{i:1}}});assert.equal(done,0);assert.equal(errors,0);
w=start();c.ponder={worker:w,promoted:false};now=250;[...intervals.values()][0]();
assert(w.stopped);assert.equal(c.ponder,null);assert.equal(c.spawnAnalysis.health.blockedUntil,10250);
w=start();c.ponder={worker:w,promoted:true};now=500;[...intervals.values()][0]();
assert(!w.stopped,'foreground analysis must not be discarded on lag');
assert.equal(c.spawnAnalysis.health.healthySince,0);now=600;[...intervals.values()][0]();
assert.equal(c.spawnAnalysis.health.healthySince,600);assert.equal(c.spawnAnalysis.health.blockedUntil,10500);
w.onmessage({data:{result:{i:1}}});assert.equal(done,1);assert(w.stopped);assert.equal(intervals.size,0);assert.equal(timers.size,0);
console.log('PASS Worker cancellation cleanup, stale messages, lag cooldown and foreground preservation');
