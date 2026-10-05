'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),createForest=require('../src/forest-engine.js'),createStrategy=require('../src/strategy-engine.js');
const ix=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65,board=(mine,theirs)=>{const b=Array(225).fill(0);mine.forEach(c=>b[ix(c)]=1);theirs.forEach(c=>b[ix(c)]=2);return b;};
const rules=createForest({strategy:false}),make=()=>createStrategy(15,{inspect:rules.inspect,legal:(b,i,p)=>rules.inspect(b,i,p).legal,winning:rules.winning},{firstPlayer:2});
for(const seed of [board(['G8','H8'],['J7','J8']),board(['F8','H8','G6','G7','E10','F9'],['L4','K4'])])for(let t=0;t<8;t++)for(const swap of [false,true]){
 const b=Array(225).fill(0);seed.forEach((v,i)=>b[rules.transformed(i,t)]=swap&&v?3-v:v);const before=b.slice(),p=swap?2:1,s=make(),a=make();s.setBudget(0);const legal=Array.from({length:225},(_,i)=>i).filter(i=>rules.inspect(b,i,p).legal),rows=legal.map(i=>({i,s:0}));
 assert.deepEqual(s.searchPoints(b,p).sort((a,b)=>a-b),a.points(b,p).sort((a,b)=>a-b),'pure points match full support after budget exhaustion');
 const pure=s.searchSelect(b,p,rows,12,6),full=a.select(b,p,rows,12,6);assert.deepEqual(pure.map(m=>m.i),full.map(m=>m.i));
 for(const m of pure.slice(0,6))assert.deepEqual(s.searchMove(b,m.i,p),a.move(b,m.i,p),'point-only support preserves validated feature');
 const reverse=make();for(const m of pure.slice(0,6)){const normal=reverse.move(b,m.i,p);assert.deepEqual(reverse.searchMove(b,m.i,p),normal,'full-first shared cache');}
 assert.deepEqual(b,before);
}
console.log('PASS D4/color support, descriptor cache both call orders, pure selection after measured budget exhaustion');
const source=fs.readFileSync('src/reader-engine.js','utf8'),engine=fs.readFileSync('src/gpu-patterns.js','utf8')+'\n'+fs.readFileSync('src/strategy-engine.js','utf8')+'\n',forest=fs.readFileSync('src/forest-engine.js','utf8');
const add=`function compare(p,ids,reverse=false){nodes=0;strategy?.setBudget(options.workBudget??Infinity);deadline=Infinity;phaseDeadline=Infinity;tt.clear();tacticalCache.clear();let rs=rank(p,ids);if(reverse)rs.reverse();const out=[];for(const r of rs){set(r.i,p);let child;try{child=search(3-p,0,-Infinity,Infinity,1);}finally{set(r.i,0);}out.push({i:r.i,score:-child.score,pv:[r.i,...child.pv]});}return out;} `;
let traced=source.replace('  return {fixedWork,rank,',add+'  return {compare,fixedWork,rank,').replace('entry=tt.get(key)','entry=options.noTT?undefined:tt.get(key)').replace('quietMoves=chosen;tick();','quietMoves=chosen;options.trace?.push({board:b.slice(),p,prepared,chosen});tick();');
const ctx={performance,Date,console};vm.createContext(ctx);vm.runInContext(engine+traced.replace('function createEngine(','function createReaderEngine(')+'\n'+forest,ctx);const table=vm.runInContext('OmokGPU.cpu()',ctx),b=board(['G8','H8'],['J7','J8']),copy=b.slice(),ids=['F8','I8','I7','H9','J6','A1'].map(ix),observed=[];
const run=(budget,reverse=false,noTT=false)=>{const trace=[],e=ctx.createReaderEngine(15,b,{fixedWork:true,optimized:true,patternTable:table,workBudget:budget,noTT,trace}),r=e.compare(1,ids,reverse);observed.push(...trace);assert.deepEqual(Array.from(e.board),copy);return r.map(m=>({i:m.i,score:m.score})).sort((a,b)=>a.i-b.i);};
const expected=run(Infinity);assert.deepEqual(run(0),expected,'same tree values after measured strategy exhaustion');assert.deepEqual(run(Infinity,true),expected,'root order independent quiet values');assert.deepEqual(run(Infinity,false,true),expected,'TT off agrees on same finite work');
let cutOnly=0,dual=0;for(const q of observed){assert(q.chosen.length<=2);for(const m of q.chosen){assert(!m.strategy.tentative&&!m.strategy.incomplete&&m.strategy.legal);assert(rules.inspect(Array.from(q.board),m.i,q.p).legal);if(m.strategy.cut>0&&!m.strategy.attack)cutOnly++;if(m.strategy.dual>0)dual++;}}
assert(cutOnly>0,'pure cut survives quiet continuation without own legalExtensions');console.log('PASS branch-local quiet values match reverse roots, exhausted budget and TT-off; cut-only='+cutOnly+' dual='+dual);
// A single blocked four can have only weak cut support. A timed-out VCF
// probe must not make that real forcing move disappear at the horizon.
const withoutTactical=traced.replace('if(depth<=1&&!danger.length)', 'if(depth<=1&&!danger.length&&!options.noTactical)'),ctxFour={performance,Date,console};vm.createContext(ctxFour);vm.runInContext(engine+withoutTactical.replace('function createEngine(','function createReaderEngine(')+'\n'+forest,ctxFour);
for(const patternTable of [undefined,table]){
 const seed=board(['J4','I8','K8'],['J5','J6','J7']),saved=seed.slice(),trace=[],reader=ctxFour.createReaderEngine(15,seed,{fixedWork:true,optimized:true,patternTable,noTactical:true,trace});reader.compare(1,[ix('A1')]);
 const initial=trace.find(q=>q.p===2&&q.board[ix('A1')]===1&&q.board.filter(Boolean).length===7),four=initial?.chosen.find(m=>m.i===ix('J8'));
 assert(four?.strategy.forcing&&four.strategy.legalExtensions.length,'single-four survives without tactical shortcut, with weak dual support');assert(four.strategy.cut>0&&four.strategy.cut<120);assert.deepEqual(Array.from(reader.board),saved);
}
for(const q of observed)for(const m of q.chosen)assert(m.strategy.cut>=120||m.strategy.legalExtensions.length&&(m.strategy.forcing||m.strategy.usableThreeAxes.length||m.strategy.axes.length>1),'weak dual pair alone does not extend quiet horizon');
console.log('PASS CPU/table single-four with weak cut survives unavailable VCF; weak pair-only quiet extension excluded');
