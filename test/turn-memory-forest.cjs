'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),Memory=require('../src/search-memory.js');
const source=fs.readFileSync('src/forest-engine.js','utf8'),anchor='let best=options[0],pv=[best.i],score=best.score;';
assert.equal(source.split(anchor).length,2);
const code=source.replace(anchor,'return {run:(d,ply=1)=>{nodes=0;const result=search(p,d,-Infinity,Infinity,ply);return {...result,nodes};},board:()=>b.slice()};');
const ctx={performance:{now:()=>0},Date,console};vm.createContext(ctx);for(const f of ['search-memory.js','strategy-engine.js'])vm.runInContext(fs.readFileSync('src/'+f,'utf8'),ctx);vm.runInContext(code,ctx);
const ix=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65,rows=[];
for(const reply of ['H2','L6'])for(const colour of [1,2]){
 const b=Array(225).fill(0);('J4 I5 K5 I7 A10 O11 I3 '+reply+' K4 I6').split(' ').forEach((c,k)=>b[ix(c)]=k%2?3-colour:colour);
 const memory=Memory.create(),opts={firstPlayer:colour,searchMemory:memory};memory.begin();
 const plain=ctx.createForestEngine({firstPlayer:colour}).analyze(b,colour,15000).run(1);
 const first=ctx.createForestEngine(opts).analyze(b,colour,15000).run(1);
 const restored=Memory.create({snapshot:JSON.parse(JSON.stringify(memory.snapshot()))});restored.begin();
 const api=ctx.createForestEngine({...opts,searchMemory:restored}).analyze(b,colour,15000),warm=api.run(1);
 assert.equal(first.score,plain.score);assert.equal(warm.score,plain.score);assert.deepEqual(Array.from(warm.pv),Array.from(plain.pv));assert.deepEqual(Array.from(api.board()),b);assert.equal(warm.nodes,1);assert(restored.stats().reused>0);
 // A different starting distance changes the extension/forced horizon model;
 // it may reuse pure evaluations, but not this node's exact search verdict.
 const shifted=api.run(1,3),fresh=ctx.createForestEngine({firstPlayer:colour}).analyze(b,colour,15000).run(1,3);
 assert.equal(shifted.score,fresh.score);assert(shifted.nodes>1);
 const narrow=ctx.createForestEngine({...opts,searchMemory:restored}).analyze(b,colour,1000).run(1);
 const freshNarrow=ctx.createForestEngine({firstPlayer:colour}).analyze(b,colour,1000).run(1);
 assert.equal(narrow.score,freshNarrow.score);assert(narrow.nodes>1);
 rows.push({reply,colour,freshNodes:plain.nodes,warmNodes:warm.nodes,shiftedNodes:shifted.nodes,reused:restored.stats().reused});
}
console.log(JSON.stringify({passed:true,scope:'real Forest fixed tree, root/horizon/width compatibility and portable cache',rows}));
