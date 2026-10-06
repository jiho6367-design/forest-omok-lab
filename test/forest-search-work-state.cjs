'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(process.env.FOREST_TEST_SOURCE||path.join(__dirname,'../src/forest-engine.js'),'utf8'),anchor='let best=options[0],pv=[best.i],score=best.score;',tick='const check=()=>{nodes++;if(clockNow()>=deadline)throw TIME;};';
assert.equal(source.split(anchor).length,2);assert.equal(source.split(tick).length,2);
// Isolate both horizon and ordinary search rules from wall-clock completion.
const code=source.replace(tick,'const check=()=>{nodes++;if(nodes>4000)throw TIME;};').replace(anchor,'return {snapshot:()=>b.slice(),run:(work,clear,depth)=>{strategy.setBudget(work);if(clear){tt.clear();rankCache.clear();}nodes=0;return search(p,depth,-Infinity,Infinity,1);}};');
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
for(const reply of ['H2','L6'])for(const colour of [1,2]){
 const c={performance:{now:()=>0},Date,console};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/strategy-engine.js'),'utf8'),c);vm.runInContext(code,c);
 const b=Array(225).fill(0);('J4 I5 K5 I7 A10 O11 I3 '+reply+' K4 I6').split(' ').forEach((m,k)=>b[idx(m)]=k%2?3-colour:colour);
 const original=b.slice(),e=c.createForestEngine({firstPlayer:colour}),api=e.analyze(b,colour,15000);
 for(const depth of [0,1]){
  const run=(work,clear)=>{const r=api.run(work,clear,depth);assert.deepEqual(Array.from(api.snapshot()),original);assert.deepEqual(b,original);const pv=original.slice();let p=colour;for(const i of r.pv){assert(e.inspect(pv,i,p).legal);pv[i]=p;p=3-p;}return r;};
  const full=run(5000,true),cached=run(0,false),fresh=run(0,true);
  assert.equal(cached.score,full.score);assert.equal(fresh.score,full.score,'same search value must not depend on earlier strategy work');assert.deepEqual(Array.from(cached.pv),Array.from(full.pv));assert.deepEqual(Array.from(fresh.pv),Array.from(full.pv));
  console.log('PASS Forest search work-state/cache/PV/undo '+reply+' colour '+colour+' depth '+depth);
 }
}
