'use strict';
const assert=require('node:assert/strict'),createForest=require('../src/forest-engine.js'),createStrategy=require('../src/strategy-engine.js');
const rules=createForest({strategy:false}),make=()=>createStrategy(15,{inspect:rules.inspect,legal:(b,i,p)=>rules.inspect(b,i,p).legal,winning:rules.winning});
const normal=points=>[...points.values()].map(({i,score,axes,axisScores})=>({i,score,axes,axisScores})).sort((a,b)=>a.i-b.i);
let randomState=0x193b452a;const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState;},engine=make();
// Full structure calculation is the independent existing reference. Include
// dense, mixed, edge and overline supports, and churn beyond the cache limit.
for(let k=0;k<640;k++){
 const b=Array.from({length:225},()=>{const v=random()%16;return v<(k%9)?v%2+1:0;}),before=b.slice();
 for(const p of k%2?[2,1]:[1,2])assert.deepEqual(normal(engine.structure(b,p,false,true).points),normal(engine.structure(b,p,false).points));
 assert.deepEqual(b,before);
}
const ix=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65,seed=Array(225).fill(0);for(const [p,cs] of [[1,['F8','H8','G6','G7','E10','F9']],[2,['L4','K4','I8']]])for(const c of cs)seed[ix(c)]=p;
for(let t=0;t<8;t++)for(const swap of [false,true]){
 const b=Array(225).fill(0);seed.forEach((v,i)=>b[rules.transformed(i,t)]=swap&&v?3-v:v);const p=swap?2:1,s=make(),full=make(),rows=b.flatMap((v,i)=>!v&&rules.inspect(b,i,p).legal?[{i,s:225-i}]:[]);
 s.setBudget(0);const a=s.searchSelect(b,p,rows,16,6),z=full.select(b,p,rows,16,6);assert.deepEqual(a.map(m=>m.i),z.map(m=>m.i));
 for(const m of a.slice(0,6))assert.deepEqual(s.searchMove(b,m.i,p),full.move(b,m.i,p));
}
console.log('PASS both raw maps equal full window reference on 640 boards/cache churn; D4/colour quotas and legal descriptors unchanged');
