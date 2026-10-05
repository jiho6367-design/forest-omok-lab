'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(process.env.FOREST_TEST_SOURCE||path.join(__dirname,'../src/forest-engine.js'),'utf8');
const strategySource=fs.readFileSync(path.join(__dirname,'../src/strategy-engine.js'),'utf8');
const anchor='let best=options[0],pv=[best.i],score=best.score;',tick='const check=()=>{nodes++;if(clockNow()>=deadline)throw TIME;};';
assert.equal(source.split(anchor).length,2);assert.equal(source.split(tick).length,2);
// Expose the actual inner search at fixed depth, after production initialization.
// A frozen clock isolates tree semantics; this is not a timing/strength test.
const code=source.replace(tick,'const check=()=>{nodes++;if(nodes>4000)throw TIME;};').replace(anchor,`return {snapshot:()=>b.slice(),compare:(ids,cache)=>{tt.clear();rankCache.clear();tt.get=cache?function(k){return Map.prototype.get.call(this,k);}:()=>undefined;tt.set=cache?function(k,v){Map.prototype.set.call(this,k,v);return this;}:()=>tt;const out=[];for(const i of ids){nodes=0;b[i]=p;let r;try{r=search(3-p,1,-Infinity,Infinity,1);}finally{b[i]=0;}out.push({i,score:-r.score,pv:[i,...r.pv]});}return out;}};`);
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
for(const reply of ['H2','L6'])for(const swap of [false,true]){
 const c={performance:{now:()=>0},Date,console};vm.createContext(c);vm.runInContext(strategySource,c);vm.runInContext(code,c);
 const history=('J4 I5 K5 I7 A10 O11 I3 '+reply).split(' '),b=Array(225).fill(0),p=swap?2:1;
 history.forEach((m,k)=>b[idx(m)]=k%2?3-p:p);const original=b.slice(),e=c.createForestEngine({firstPlayer:p}),api=e.analyze(b,p,15000);
 const roots=(reply==='H2'?['K4','L6','M7','I4']:['K4','H2','I4','H4']).map(idx);
 let cached=null;for(const cache of [true,false]){
  const forward=api.compare(roots,cache),reverse=api.compare(roots.slice().reverse(),cache);
  for(const r of forward){assert.equal(r.score,reverse.find(x=>x.i===r.i).score,'same complete tree value must not depend on unrelated root order');const q=original.slice();let colour=p;for(const i of r.pv){assert(e.inspect(q,i,colour).legal,'legal alternating PV');q[i]=colour;colour=3-colour;}}
  assert.deepEqual(Array.from(api.snapshot()),original,'inner search restores its actual working board');
  assert.deepEqual(b,original,'analyze preserves caller board');
  if(cache)cached=forward;else for(const r of forward)assert.equal(r.score,cached.find(x=>x.i===r.i).score,'TT enabled and disabled complete values must agree');
 }
 console.log('PASS Forest complete quiet tree root-order/cache consistency '+reply+' colour '+p);
}
