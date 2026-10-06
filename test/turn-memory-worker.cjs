'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync('src/unified-app.js','utf8'),source=app.slice(app.indexOf('function spawnAnalysis('),app.indexOf('function acceptResult('));
const timers=new Map(),intervals=new Map();let next=0,done=0;
class Worker{terminate(){this.stopped=true;}postMessage(data){this.data=data;}}
const c={performance:{now:()=>0},Worker,Blob:class{},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),setInterval:fn=>{intervals.set(++next,fn);return next;},clearInterval:id=>intervals.delete(id),$:()=>({textContent:''}),E:{inspect:()=>({legal:true})},g:{id:'game1',first:1,rules:{}},db:{lessons:[]},ponder:null,omokAcceleration:{mode:'cpu'}};
vm.createContext(c);vm.runInContext(fs.readFileSync('src/search-memory.js','utf8')+'\n'+source,c);
const start=()=>c.spawnAnalysis(Array(225).fill(0),1,1000,()=>{},()=>done++,e=>{throw Error(e);});
let w=start();assert.equal(w.data.searchMemory.rows.length,0);
const packet={version:1,generation:2,rows:[['test','completed',{score:20,pv:[1],bound:'exact'},4,2]]};
w.onmessage({data:{progress:true,result:{i:1,depth:1},searchMemory:packet}});w.terminate();
const oldSession=c.spawnAnalysis.memory;assert.equal(oldSession.store.get('test','completed').score,20);
w.onmessage({data:{result:{i:1},searchMemory:{...packet,rows:[['test','late',{score:99},4,3]]}}});assert.equal(done,0);assert.equal(oldSession.store.get('test','late'),undefined);
w=start();assert(w.data.searchMemory.rows.some(r=>r[1]==='completed'),'next request imports completed nodes despite cancellation');w.onmessage({data:{result:{i:1,depth:1}}});assert.equal(done,1);
c.g={id:'game2',first:1,rules:{}};w=start();assert.equal(w.data.searchMemory.rows.length,0);assert.notEqual(c.spawnAnalysis.memory,oldSession);w.terminate();
c.omokAcceleration.mode='gpu';w=start();assert.equal(w.data.searchMemory.rows.length,0);w.terminate();
c.g.first=2;w=start();assert.equal(w.data.searchMemory.rows.length,0);w.terminate();assert.equal(timers.size,0);assert.equal(intervals.size,0);
console.log('PASS session relay: completed progress survives cancellation, late packets ignored, subsequent/ponder import, new game/colour context/compute mode isolation');
