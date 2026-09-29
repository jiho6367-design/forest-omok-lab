const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),create=require('../src/node-engine.cjs');
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const boardOf=coords=>{const b=Array(225).fill(0);coords.split(' ').forEach((c,k)=>b[idx(c)]=k%2?2:1);return b;};
const prefix='H8 G7 G6 H6 F8';
function controlled(wrapForest,wrapReader){
 const c={Date,console};vm.createContext(c);
 vm.runInContext(fs.readFileSync('src/reader-engine.js','utf8').replace('function createEngine(','function createReaderEngine(')+'\n'+fs.readFileSync('src/forest-engine.js','utf8'),c);
 const f=c.createForestEngine,r=c.createReaderEngine;c.createForestEngine=o=>wrapForest(f(o));c.createReaderEngine=(...args)=>wrapReader(r(...args));
 vm.runInContext(fs.readFileSync('src/unified-engine.js','utf8'),c);return c.createEngine();
}
let b=Array(225).fill(0);for(const c of ['D8','E8','F8','G8'])b[idx(c)]=2;for(const c of ['A1','B1','C1','D1'])b[idx(c)]=1;
let e=create(),r=e.analyze(b,2,200);assert(r.proven);assert.equal(r.proofStatus,'PROVEN_WIN');assert(e.inspect(b,r.i,2).win.length);console.log('PASS immediate proved win takes priority over opponent threats');
for(const winner of ['J4','G8']){
 const high=idx(winner),engine=controlled(f=>({...f,patternDefense:()=>({i:idx('F7'),proven:false,pv:[idx('F7')],score:0})}),reader=>({...reader,analyze:()=>({kind:'search',depth:5,moves:[{i:idx('I7'),score:999,pv:[idx('I7')]},{i:idx('F7'),score:20,pv:[idx('F7')]},{i:high,score:30,pv:[high]}]})}));
 const out=engine.analyze(boardOf(prefix),2,900);assert.equal(out.i,high);assert.equal(out.score,30);assert.equal(out.depth,5);assert.equal(out.proven,false);assert.equal(out.pv[0],high);
}
console.log('PASS highest evaluated non-refuted candidate wins; pattern does not bypass comparison; no J4 hardcode');
let trapBudget;
e=controlled(f=>({...f,forcing:()=>({complete:true,proof:null}),forcedReplyTrap:(b,p,ms)=>{trapBudget=ms;return {complete:false,proof:null};},analyze:()=>({i:idx('A4'),score:120,depth:4,pv:[idx('A4')],proven:false,lossProven:false,rejected:[],reason:'limited comparison'})}),reader=>({...reader,analyze:()=>({kind:'search',depth:3,moves:[{i:idx('A4'),score:100,pv:[idx('A4')]},{i:idx('B3'),score:50,pv:[idx('B3')]}]})}));
b=Array(225).fill(0);for(const c of ['A1','A2','A3'])b[idx(c)]=1;r=e.analyze(b,1,25000);assert.equal(r.i,idx('A4'));assert.equal(r.score,120);assert(!r.proven);assert(!(r.rejected||[]).some(m=>m.i===idx('A4')));assert(trapBudget<=500);console.log('PASS proof timeout preserves evaluated move and quick proof cap');
b=boardOf(prefix);const copy=b.slice(),start=Date.now(),updates=[];r=create().analyze(b,2,900,[],x=>updates.push(x));assert.deepEqual(b,copy);assert.notEqual(r.i,idx('I7'));assert(create().inspect(b,r.i,2).legal);assert(!r.proven);assert.equal(r.proofStatus,'UNRESOLVED');assert(r.unverifiedDefense);assert(Date.now()-start<1600);for(const x of updates)assert.notEqual(x.i,idx('I7'));console.log('PASS live new-game fallback, certificate exclusion, timing, board preservation');
console.log('4 recommendation-policy groups passed');
