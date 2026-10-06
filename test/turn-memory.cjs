'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Memory=require('../src/search-memory.js');
const context={performance,Date,console};vm.createContext(context);
for(const f of ['search-memory.js','gpu-patterns.js','strategy-engine.js','reader-engine.js','forest-engine.js','unified-engine.js']){
 let text=fs.readFileSync('src/'+f,'utf8');
 if(f==='reader-engine.js')text=text.replace('function createEngine(','function createReaderEngine(').replace('return {fixedWork,rank,',
  'return {probe:(p,d,ply)=>{nodes=0;deadline=Infinity;strategy?.setBudget(Infinity);const r=search(p,d,-Infinity,Infinity,ply,6,0);return {...r,nodes};},fixedWork,rank,');
 vm.runInContext(text,context);
}
const plain=v=>JSON.parse(JSON.stringify(v)),table=vm.runInContext('OmokGPU.cpu()',context),rows=[];
for(const pos of require('../tools/performance/positions.cjs').filter(p=>['sixth-move','quiet-middle','forcing-four','mandatory-block'].includes(p.id))){
 const memory=Memory.create(),options={searchMemory:memory,optimized:true,patternTable:table},original=pos.board.join('');
 const cold=context.createReaderEngine(15,pos.board,{...options,searchMemory:false}).fixedWork(pos.p,3);
 const first=context.createReaderEngine(15,pos.board,options).fixedWork(pos.p,3);
 const restored=Memory.create({snapshot:plain(memory.snapshot())});
 const warm=context.createReaderEngine(15,pos.board,{...options,searchMemory:restored}).fixedWork(pos.p,3);
 assert.equal(first.score,cold.score);assert.equal(warm.score,cold.score);assert.deepEqual(plain(first.pv),plain(cold.pv));assert.deepEqual(plain(warm.pv),plain(cold.pv));
 assert.equal(pos.board.join(''),original);assert(restored.stats().reused>0||warm.nodes===1);
 // Play actual PV stones and compare the ensuing root against a fresh engine.
 if(first.pv.length>=2){const after=pos.board.slice();after[first.pv[0]]=pos.p;after[first.pv[1]]=3-pos.p;
  const fresh=context.createReaderEngine(15,after,{...options,searchMemory:false}).fixedWork(pos.p,3);
  const continued=context.createReaderEngine(15,after,{...options,searchMemory:restored}).fixedWork(pos.p,3);
  assert.equal(continued.score,fresh.score);assert.deepEqual(plain(continued.pv),plain(fresh.pv));
  rows.push({id:pos.id,phase:'next-turn',freshNodes:fresh.nodes,warmNodes:continued.nodes,reused:restored.stats().reused});
 }
 rows.push({id:pos.id,phase:'same-root',freshNodes:cold.nodes,warmNodes:warm.nodes,reused:restored.stats().reused});
}
// Re-root a real forced-win search at a different ply: score distance must move.
const force=require('../tools/performance/positions.cjs').find(p=>p.id==='forcing-four'),memory=Memory.create();memory.begin();
const first=context.createReaderEngine(15,force.board,{strategy:false,searchMemory:memory}).probe(force.p,3,5);
memory.begin();const shifted=context.createReaderEngine(15,force.board,{strategy:false,searchMemory:memory}).probe(force.p,3,7);
const fresh=context.createReaderEngine(15,force.board,{strategy:false}).probe(force.p,3,7);
assert(first.score>9999000);assert.equal(shifted.score,first.score-2);assert.equal(shifted.score,fresh.score);assert.equal(shifted.nodes,1);
assert.equal(Memory.fromStored(Memory.toStored(-9999995,3,10000000),1,10000000),-9999997);
// Scope and horizon mismatches must not use the stored exact result.
memory.begin();const other=context.createReaderEngine(15,force.board,{strategy:false,firstPlayer:2,searchMemory:memory}).probe(force.p,3,7);
assert.equal(other.score,fresh.score);assert(other.nodes>1);
const shallow=context.createReaderEngine(15,force.board,{strategy:false,searchMemory:memory}).probe(force.p,2,7);
assert(shallow.nodes>1,'depth is part of the reusable subproblem');
// Completed proof data survives a portable snapshot; incomplete probes do not
// publish a negative verdict for the unfinished root.
const counterMemory=Memory.create();counterMemory.begin();
const proof=context.createReaderEngine(15,force.board,{strategy:false,searchMemory:counterMemory}).counterCertificate(force.p,1000,7,1);
assert(proof.complete&&proof.proof);const restored=Memory.create({snapshot:plain(counterMemory.snapshot())});restored.begin();
const again=context.createReaderEngine(15,force.board,{strategy:false,searchMemory:restored}).counterCertificate(force.p,1000,7,1);
assert(again.complete);assert.deepEqual(plain(again.proof),plain(proof.proof));assert(restored.stats().reused>0);
const tiny=Memory.create({maxEntries:12,maxBytes:8000});for(let i=0;i<200;i++){tiny.begin();tiny.put('scope','position-'+i,{score:i,pv:[i%225],bound:'exact'},i%5);}
assert(tiny.stats().entries<=12);assert(tiny.stats().estimatedBytes<=8000);assert(tiny.stats().evictions>0);
assert.equal(tiny.merge({version:99,rows:[]}),false);assert.equal(tiny.get('other-scope','position-199'),undefined);
// Import order must not evict the most useful old nodes first. Reproduce a
// deep-first Worker snapshot followed by a stream of cheap new leaf records.
const ranked=Memory.create({maxEntries:12});ranked.begin();ranked.put('scope','deep',{score:1},20);
for(let i=0;i<11;i++)ranked.put('scope','old-leaf-'+i,null,0);
const imported=Memory.create({maxEntries:12,snapshot:JSON.parse(JSON.stringify(ranked.snapshot()))});imported.begin();
for(let i=0;i<30;i++)imported.put('scope','new-leaf-'+i,null,0);
assert.equal(imported.get('scope','deep').score,1);
// Keeping a bounded portable cache must never shrink the active proof graph.
const layered=Memory.create({maxEntries:2}),active=layered.cache('proof');
for(let i=0;i<30;i++)active.set('node-'+i,null);
assert.equal(active.size,30);assert.equal(active.get('node-0'),null);assert(layered.stats().entries<=2);
console.log(JSON.stringify({passed:true,rows,mate:{first:first.score,shifted:shifted.score,warmNodes:shifted.nodes},bounded:tiny.stats()}));
