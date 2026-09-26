const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const createEngine=require('./engine.cjs'),{createEngine:reader}=require('../src/reader-engine.js');
const blank=()=>Array(225).fill(0),idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS',name);};
const strict=createEngine({fivePriority:false}),priority=createEngine();
test('exact-five priority is an explicit rule shared by both engines',()=>{
  const b=blank();for(const c of ['D8','E8','F8','G8','H7','H9','G7','I9'])b[idx(c)]=1;b[idx('C8')]=2;
  assert(!strict.inspect(b,idx('H8'),1).legal);assert(priority.inspect(b,idx('H8'),1).legal);
  assert.equal(reader(15,b,{fivePriority:false}).legal(idx('H8'),1),false);
  assert.equal(priority.analyze(b,1,'auto').i,idx('H8'));
});
test('both colors reject broken double threes and permit six without a win',()=>{
  for(const p of [1,2]){const b=blank();for(const c of ['F8','I8','H6','H9'])b[idx(c)]=p;assert(!priority.inspect(b,idx('H8'),p).legal);}
  const b=blank();for(const c of ['C8','D8','E8','F8','G8'])b[idx(c)]=1;assert(priority.inspect(b,idx('H8'),1).legal);assert.equal(priority.inspect(b,idx('H8'),1).win.length,0);
});
test('rule implementations agree across deterministic random boards',()=>{
  let seed=817;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  for(const fivePriority of [false,true])for(let k=0;k<12;k++){
    const b=blank().map(()=>{const n=rand();return n<.16?1:n<.32?2:0;}),f=createEngine({fivePriority}),r=reader(15,b,{fivePriority});
    for(let i=0;i<225;i++)for(const p of [1,2])assert.equal(f.inspect(b,i,p).legal,r.legal(i,p),`${k}/${i}/${p}`);
  }
});
test('all Reader fixtures retain coordinates, legality and terminal status',()=>{
  for(const n of [29,31,33,47,48,95]){
    const fixture=require(`./reader/game${n}.cjs`),b=blank(),first=[31,48].includes(n)?1:2;let ended=false;
    fixture.coords.forEach((c,k)=>{assert(!ended,`premature finish ${n}/${k}`);const p=k%2?3-first:first,s=strict.inspect(b,idx(c),p);assert(s.legal,`${n}/${k+1}/${c}`);b[idx(c)]=p;ended=!!s.win.length;});
    assert.equal(ended,[29,31,47,48].includes(n));
  }
});
test('Forest example records retain original priority-five rules',()=>{
  const app=fs.readFileSync('src/app.js','utf8');
  const records=[...app.matchAll(/(?:studyMoves|case\d+Moves)='([^']+)'\.split/g)];assert(records.length>=6);
  for(const m of records){const b=blank();m[1].split(' ').forEach((c,k)=>{const p=k%2?1:2,s=priority.inspect(b,idx(c),p);assert(s.legal,c);b[idx(c)]=p;});}
});
test('forced defense is instant and lost positions retain legal endpoints',()=>{
  const b=blank();for(const c of ['F8','G8','H8','I8'])b[idx(c)]=2;b[idx('E8')]=1;
  const r=strict.analyze(b,1,'auto');assert.equal(r.i,idx('J8'));assert(r.urgent);assert(r.ms<500);
  b[idx('E8')]=0;const lost=strict.analyze(b,1,'auto');assert(lost.lossProven);assert(lost.i!=null);assert(strict.inspect(b,lost.i,1).legal);assert(lost.candidates.every(m=>['E8','J8'].map(idx).includes(m.i)));
});
test('a forbidden mandatory block is never a recommendation',()=>{
  const c=require('./reader/game95.cjs'),b=blank();c.coords.forEach((x,k)=>b[idx(x)]=k%2?1:2);
  const r=strict.analyze(b,1,'auto');assert(r.lossProven);assert.notEqual(r.i,idx('I4'));assert(strict.inspect(b,r.i,1).legal);
});
test('short search streams legal fallback before completion and preserves input',()=>{
  const b=blank();['H8','G9','F9','F8','H10','H9','G11','I9'].forEach((x,k)=>b[idx(x)]=k%2?1:2);
  const copy=b.slice(),updates=[],r=strict.analyze(b,2,200,[],r=>updates.push(r));assert(updates.length);assert(updates[0].i!=null);
  for(const result of [...updates,r]){assert(strict.inspect(b,result.i,2).legal);assert.equal(strict.validPV(b,2,result.pv).length,result.pv.length);}
  assert.deepEqual(b,copy);
});
test('terminal states do not show fallback moves',()=>{
  const b=blank();for(const c of ['F8','G8','H8','I8','J8'])b[idx(c)]=2;
  const r=priority.analyze(b,1,'auto');assert.equal(r.kind,'terminal');assert.equal(r.i,null);
});
test('adaptive budget respects remaining turn time',()=>{
  const b=blank();b[112]=1;const small=priority.suggestBudget(b,2,3200);assert(small.ms<=200);
  assert(priority.suggestBudget(b,2,40000).ms<=8000);
  const start=Date.now(),r=priority.analyze(b,2,{automatic:true,ms:100});assert(r.i!=null);assert(Date.now()-start<1200);
});
test('deep mode retains a move and validates its returned PV',()=>{
  const fixture=require('./reader/game48.cjs'),b=blank();fixture.coords.slice(0,34).forEach((c,k)=>b[idx(c)]=k%2?2:1);
  const updates=[],start=Date.now(),r=strict.analyze(b,1,9000,[],r=>updates.push(r));assert(r.i!=null);assert(strict.inspect(b,r.i,1).legal);assert.equal(strict.validPV(b,1,r.pv).length,r.pv.length);assert(updates.length);assert(Date.now()-start<11000);console.log('Deep duration',Date.now()-start,'ms');
});
test('text import validates order, pass, occupied and forbidden positions atomically',()=>{
  const text=fs.readFileSync('src/unified-app.js','utf8'),start=text.indexOf('function parseTextRecord'),end=text.indexOf('const importTextButton',start),ctx={createEngine};vm.createContext(ctx);vm.runInContext(text.slice(start,end),ctx);
  const r=ctx.parseTextRecord('1. 백 H8 · 2. 흑 G9\n3. 초록 슬라임 PASS(40초 초과)',{fivePriority:false});assert.equal(r[0].i,idx('H8'));assert.equal(r[2].type,'timeout');
  assert.throws(()=>ctx.parseTextRecord('흑 H8 · 백 H8',{}));assert.throws(()=>ctx.parseTextRecord('흑 H8 · 흑 G9',{}));assert.throws(()=>ctx.parseTextRecord('흑 Z19',{}));
});
test('single-file build embeds scripts and images without external dependencies',()=>{
  const html=fs.readFileSync('outputs/omok.html','utf8');assert(html.includes('data:image/'));assert(!/<script[^>]+src=|<link[^>]+href=/.test(html));
  for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});
console.log(`${count} unified scenarios passed`);
