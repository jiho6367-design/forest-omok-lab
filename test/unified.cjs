const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const createEngine=require('./engine.cjs'),{createEngine:reader}=require('../src/reader-engine.js');
const blank=()=>Array(225).fill(0),idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const filter=process.env.OMOK_TEST_FILTER?new RegExp(process.env.OMOK_TEST_FILTER):null;
let count=0;const test=(name,fn)=>{if(filter&&!filter.test(name))return;fn();count++;console.log('PASS',name);};
const strict=createEngine({fivePriority:false}),priority=createEngine();
test('exact-five priority overrides legacy options in both engines',()=>{
  const b=blank();for(const c of ['D8','E8','F8','G8','H7','H9','G7','I9'])b[idx(c)]=1;b[idx('C8')]=2;
  assert(strict.inspect(b,idx('H8'),1).legal);assert(priority.inspect(b,idx('H8'),1).legal);
  assert.equal(reader(15,b,{fivePriority:false}).legal(idx('H8'),1),true);
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
test('opponent prediction stays at one second while my analysis uses the selected time',()=>{
  const source=fs.readFileSync('src/unified-app.js','utf8'),start=source.indexOf('function configuredOwnBudget'),end=source.indexOf('function spawnAnalysis',start);
  let selected='15000';const plan={textContent:''},ctx={g:{me:1,timer:false},reviewing:false,paused:false,deadline:Date.now()+40000,analysisPlan:plan,E:{suggestBudget:()=>({ms:7000,reason:'자동 분석'})},$:()=>({value:selected})};
  vm.createContext(ctx);vm.runInContext(`let activePlan='';\n${source.slice(start,end)}`,ctx);
  const board=blank();assert.equal(ctx.selectedBudget(board,2),1000);assert.equal(ctx.selectedBudget(board,2,25000),1000);assert.match(plan.textContent,/1초 고정/);
  assert.equal(ctx.selectedBudget(board,1),15000);assert.equal(ctx.configuredOwnBudget(board,1,40000).budget,15000);
  selected='25000';assert.equal(ctx.selectedBudget(board,2),1000);assert.equal(ctx.selectedBudget(board,1),25000);
  selected='auto';assert.equal(ctx.selectedBudget(board,2),1000);assert.equal(ctx.selectedBudget(board,1).ms,7000);assert.equal(ctx.configuredOwnBudget(board,1,40000).budget.ms,7000);
});
test('deep mode retains a move and validates its returned PV',()=>{
  const fixture=require('./reader/game48.cjs'),b=blank();fixture.coords.slice(0,34).forEach((c,k)=>b[idx(c)]=k%2?2:1);
  const updates=[],start=Date.now(),r=strict.analyze(b,1,9000,[],r=>updates.push(r));assert(r.i!=null);assert(strict.inspect(b,r.i,1).legal);assert.equal(strict.validPV(b,1,r.pv).length,r.pv.length);assert(updates.length);assert(Date.now()-start<11000);console.log('Deep duration',Date.now()-start,'ms');
});
test('text import validates order, pass, occupied and forbidden positions atomically',()=>{
  const text=fs.readFileSync('src/unified-app.js','utf8'),start=text.indexOf('function parseTextRecord'),end=text.indexOf('const importTextButton',start),ctx={createEngine};vm.createContext(ctx);vm.runInContext(text.slice(start,end),ctx);
  const r=ctx.parseTextRecord('1. 백 H8 · 2. 흑 G9\n3. 초록 슬라임 PASS(40초 초과)',{fivePriority:false});assert.equal(r[0].i,idx('H8'));assert.equal(r[2].type,'timeout');
  const copied=ctx.parseTextRecord('내 돌: 노란 버섯 (흑) · 후공\n1. 초록 슬라임 H8\n2. 노란 버섯 G7',{fivePriority:false});assert.equal(copied.length,2);assert.equal(copied[1].p,1);
  assert.throws(()=>ctx.parseTextRecord('흑 H8 · 백 H8',{}));assert.throws(()=>ctx.parseTextRecord('흑 H8 · 흑 G9',{}));assert.throws(()=>ctx.parseTextRecord('흑 Z19',{}));
});
test('copied text record identifies my stone and move order',()=>{
  const text=fs.readFileSync('src/app.js','utf8'),start=text.indexOf('function formatRecordText'),end=text.indexOf('const recordText',start),ctx={names:{1:'노란 버섯',2:'초록 슬라임'},E:{coord:i=>i===112?'H8':'G7'}};vm.createContext(ctx);vm.runInContext(text.slice(start,end),ctx);
  const out=ctx.formatRecordText({me:1,first:2},[{p:2,type:'move',i:112},{p:1,type:'move',i:96}]);assert(out.startsWith('내 돌: 노란 버섯 (흑) · 후공\n'));assert(out.includes('1. 초록 슬라임 H8'));assert(out.includes('2. 노란 버섯 G7'));
});
test('single-file build embeds scripts and images without external dependencies',()=>{
  const html=fs.readFileSync('outputs/omok.html','utf8');assert(html.includes('data:image/'));assert(!/<script[^>]+src=|<link[^>]+href=/.test(html));
  for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});
test('80-ply green record is legal and yellow has the verified M6 forcing line',()=>{
  const moves='H8 G7 G8 F8 E9 F7 F9 H7 E7 E8 D9 C9 G9 H9 I7 F10 J6 K5 J7 I8 G6 C8 B8 H6 J8 I5 J4 J5 H5 C7 J9 J10 C6 C10 C11 G10 H10 E12 F11 L5 M5 D11 B9 G12 H12 D10 E10 F12 G13 D12 C12 F13 G14 C13 B14 D13 D14 E13 B13 E14 H11 I6 K7 K4 L3 G11 L6 N4 L7 M7 H13 H14 B7 E15 E11 B6 B10 B11 K8 I10'.split(' '),b=blank();
  moves.forEach((c,k)=>{const p=k%2?2:1,s=strict.inspect(b,idx(c),p);assert(s.legal,`${k+1}/${c}`);b[idx(c)]=p;assert.equal(s.win.length,0);});
  const proof=strict.forcing(b,1,17,1000);assert(proof.proof);assert.equal(proof.proof.pv[0],idx('M6'));
});
test('73-ply automatic analysis excludes certified losses without hardcoding E11',()=>{
  const moves='H8 G7 G8 F8 E9 F7 F9 H7 E7 E8 D9 C9 G9 H9 I7 F10 J6 K5 J7 I8 G6 C8 B8 H6 J8 I5 J4 J5 H5 C7 J9 J10 C6 C10 C11 G10 H10 E12 F11 L5 M5 D11 B9 G12 H12 D10 E10 F12 G13 D12 C12 F13 G14 C13 B14 D13 D14 E13 B13 E14 H11 I6 K7 K4 L3 G11 L6 N4 L7 M7 H13 H14 B7'.split(' '),b=blank();
  moves.forEach((c,k)=>b[idx(c)]=k%2?2:1);
  const copy=b.slice(),plan=strict.suggestBudget(b,2,40000);assert(plan.ms>=12000);const r=strict.analyze(b,2,{automatic:true,ms:plan.ms},[]);
  // E11 is not a safe-move certificate: Reader can independently refute it.
  // Completed search depth and the best unresolved move depend on wall time.
  assert(strict.inspect(b,r.i,2).legal);assert(r.automatic);assert.deepEqual(b,copy);
  assert.equal(strict.validPV(b,2,r.pv).length,r.pv.length);
  const certified=(r.rejected||[]).filter(x=>x.pv?.length||x.line?.length||x.replyTrap||x.verifiedRefutation);
  if(!r.lossProven)assert(!certified.some(x=>x.i===r.i),'a refuted move cannot be recommended as unresolved');
  const e15=certified.find(x=>x.i===idx('E15'));assert(e15,'E15 exclusion must retain its proof');
  if(r.lossProven){assert.equal(r.proofStatus,'PROVEN_LOSS');assert(r.forcedLoss,'a refuted resistance move must retain the loss verdict');}
  else assert.notEqual(r.i,idx('E15'));
  assert(!r.proven,'no winning certificate has been established for the alternative');
});
test('30-ply green record is not lost and automatic analysis proves C8 wins',()=>{
  const moves='H8 G7 H7 H6 F8 G8 G6 H9 F7 G10 G9 I8 F11 F10 F5 F6 E8 H5 E4 D3 E7 H10 E6 E5 D9 C10 D6 C5 E10 E9'.split(' '),b=blank();
  moves.forEach((c,k)=>{const p=k%2?1:2,s=strict.inspect(b,idx(c),p);assert(s.legal,`${k+1}/${c}`);b[idx(c)]=p;assert.equal(s.win.length,0);});
  const plan=strict.suggestBudget(b,2,40000),r=strict.analyze(b,2,{automatic:true,ms:plan.ms},[]);assert(r.proven);assert.equal(r.i,idx('C8'));
  b[idx('C8')]=2;assert.equal(strict.winning(b,2).map(i=>String.fromCharCode(65+i%15)+(1+(i/15|0))).sort().join(','),'B7,G12');
});
test('UI allows provisional moves but warns before leaving a proven win',()=>{
  const app=fs.readFileSync('src/app.js','utf8');assert(!app.includes('아직 분석 중입니다'));assert(app.includes('확인된 강제승 시작점은'));
});
test('19-ply yellow loss is identified and ends with green exact five',()=>{
  const moves='H8 G7 I8 F8 H9 H6 E9 G6 H10 H7 F9 G9 G10 I5 J4 H11 J7 K6 F11'.split(' '),b=blank();
  moves.slice(0,18).forEach((c,k)=>{const p=k%2?1:2,s=strict.inspect(b,idx(c),p);assert(s.legal,`${k+1}/${c}`);b[idx(c)]=p;assert.equal(s.win.length,0);});
  const before=strict.analyze(b,2,'auto',[]);assert(before.proven);assert.equal(before.i,idx('F11'));
  const finish=strict.inspect(b,idx('F11'),2);assert(finish.legal);assert.equal(finish.win.length,5);b[idx('F11')]=2;
  const terminal=strict.analyze(b,1,'auto',[]);assert.equal(terminal.kind,'terminal');assert.equal(terminal.i,null);
  assert.equal(finish.win.map(i=>String.fromCharCode(65+i%15)+(1+(i/15|0))).sort().join(','),'F11,G10,H9,I8,J7');
});
test('deep safety guard rejects yellow H11, retains G5 resistance and keeps loss verdict',()=>{
  const moves='H8 G7 I8 F8 H9 H6 E9 G6 H10 H7 F9 G9 G10 I5 J4'.split(' '),b=blank();
  moves.forEach((c,k)=>b[idx(c)]=k%2?1:2);
  const h11=strict.reviewMove(b,1,idx('H11'),1300,[]);assert(h11.actualLossProof);assert.equal(h11.actualLossProof.pv[0],idx('J7'));
  const r=strict.analyze(b,1,{automatic:true,ms:15000},[]);assert.equal(r.i,idx('G5'));assert(r.lossProven);assert.equal(r.proofStatus,'PROVEN_LOSS');assert.equal(r.kind,'lost');
  // Either engine may establish the refutation first; do not require a later
  // conflict between them when the Reader certificate already excludes H11.
  assert((r.rejected||[]).some(x=>x.i===idx('H11')&&(x.line?.length||x.pv?.length||x.replyTrap)));
});
test('27-ply yellow record is terminal and H7 breaks the recorded diagonal trap at ply 14',()=>{
  const moves='H8 G7 H9 H6 I8 F8 I5 F7 J7 G10 I6 I7 J8 E7 H7 K8 J6 D7 C7 J9 H11 H10 J5 J4 G8 F9 K4'.split(' '),b=blank();let finish=null;
  moves.forEach((c,k)=>{const p=k%2?1:2,s=strict.inspect(b,idx(c),p);assert(s.legal,`${k+1}/${c}`);assert(!finish,`premature finish ${k+1}`);b[idx(c)]=p;if(s.win.length)finish=s;});
  assert(finish);assert.equal(finish.win.map(i=>String.fromCharCode(65+i%15)+(1+(i/15|0))).sort().join(','),'G8,H7,I6,J5,K4');
  const pre=blank();moves.slice(0,13).forEach((c,k)=>pre[idx(c)]=k%2?1:2);const pattern=strict.patternDefense(pre,1);assert(pattern);assert.equal(pattern.i,idx('H7'));assert(pattern.patternVerified);assert(!pattern.proven);
  const r=strict.patternDefense(pre,1);assert.equal(r.i,idx('H7'));assert(r.patternVerified);pre[idx('H7')]=1;assert.equal(strict.winning(pre,1).map(i=>String.fromCharCode(65+i%15)+(1+(i/15|0))).join(','),'E7');
});
test('31-ply yellow record retains D9 as an unproven pattern hint',()=>{
  const moves='H8 G9 H9 H10 F8 G8 G7 E9 F10 F9 G10 E10 H7 H6 I8 D9 C9 J7 F6 D11 C12 I9 E5 D4 F5 G6 F7 F4 E7 I7 D7'.split(' '),b=blank();let finish=null;
  moves.forEach((c,k)=>{const p=k%2?1:2,s=strict.inspect(b,idx(c),p);assert(s.legal,`${k+1}/${c}`);assert(!finish,`premature finish ${k+1}`);b[idx(c)]=p;if(s.win.length)finish=s;});
  assert(finish);assert.equal(finish.win.map(i=>String.fromCharCode(65+i%15)+(1+(i/15|0))).sort().join(','),'D7,E7,F7,G7,H7');
  const pre=blank();moves.slice(0,13).forEach((c,k)=>pre[idx(c)]=k%2?1:2);
  const quick=strict.patternDefense(pre,1);assert.equal(quick.i,idx('D9'));assert(quick.patternVerified);assert(!quick.proven);
  const failed=pre.slice();failed[idx('H6')]=1;failed[idx('I8')]=2;const proof=strict.forcing(failed,2,17,2000);assert(proof.proof);assert.equal(proof.proof.pv.map(i=>String.fromCharCode(65+i%15)+(1+(i/15|0))).join(','),'J7,K6,F11');
});
test('D9 pattern hint preserves board symmetry and color swap',()=>{
  const moves='H8 G9 H9 H10 F8 G8 G7 E9 F10 F9 G10 E10 H7'.split(' '),base=blank();moves.forEach((c,k)=>base[idx(c)]=k%2?1:2);
  for(let t=0;t<8;t++)for(const swap of [false,true]){const board=blank();base.forEach((v,i)=>{if(v)board[strict.transformed(i,t)]=swap?3-v:v;});const p=swap?2:1,r=strict.patternDefense(board,p);assert.equal(r.i,strict.transformed(idx('D9'),t),`symmetry ${t} swap ${swap}`);assert(r.patternVerified);}
});
test('26-ply record is green to move with a forcing win, and H7 prevents the recorded setup at ply 6',()=>{
  const moves='H8 G7 I8 F8 H6 G9 H7 H9 J8 G8 G6 J9 K8 L8 K9 F9 I9 G11 G10 I7 I6 E9 D9 F6 K6 J6'.split(' '),b=blank();
  moves.forEach((c,k)=>{const p=k%2?1:2,s=strict.inspect(b,idx(c),p);assert(s.legal,`${k+1}/${c}`);assert.equal(s.win.length,0,`premature finish ${k+1}`);b[idx(c)]=p;});
  const green=strict.analyze(b,2,{automatic:true,ms:100},[]);assert.equal(green.i,idx('F5'));assert(green.proven);assert.equal(green.pv.map(i=>String.fromCharCode(65+i%15)+(1+(i/15|0))).join(','),'F5,E4,K7');
  const pre=blank();moves.slice(0,5).forEach((c,k)=>pre[idx(c)]=k%2?1:2);const defense=strict.patternDefense(pre,1);assert.equal(defense.i,idx('H7'));assert(defense.patternVerified);assert(!defense.proven);
  pre[idx('H7')]=1;pre[idx('I7')]=2;const check=strict.forcing(pre,2,21,3000);assert(check.complete);assert(!check.proof);
});
test('H7 early-defense pattern applies in new games under symmetry and color swap',()=>{
  const moves='H8 G7 I8 F8 H6'.split(' '),base=blank();moves.forEach((c,k)=>base[idx(c)]=k%2?1:2);
  for(let t=0;t<8;t++)for(const swap of [false,true]){const board=blank();base.forEach((v,i)=>{if(v)board[strict.transformed(i,t)]=swap?3-v:v;});const p=swap?2:1,r=strict.patternDefense(board,p);assert.equal(r.i,strict.transformed(idx('H7'),t),`symmetry ${t} swap ${swap}`);assert(r.patternVerified);}
});
test('13-ply green loss is detected, and G11 remains an unproven pattern hint',()=>{
  const moves='H8 H6 I9 G7 H10 F8 E9 E7 G11 J8 F10 I5 J4'.split(' '),board=blank();
  moves.forEach((c,k)=>{const p=k%2?2:1,s=strict.inspect(board,idx(c),p);assert(s.legal,`${k+1}/${c}`);assert.equal(s.win.length,0);board[idx(c)]=p;});
  const loss=strict.analyze(board,2,{automatic:true,ms:1000},[]);assert(loss.lossProven);
  const pre=blank();moves.slice(0,7).forEach((c,k)=>pre[idx(c)]=k%2?2:1);
  const defense=strict.patternDefense(pre,2);assert.equal(defense.i,idx('G11'));assert(defense.patternVerified);assert(!defense.proven);
  pre[idx('G11')]=2;pre[idx('G10')]=1;const reply=strict.analyze(pre,2,{automatic:true,ms:1000},[]);assert(reply.i!=null);assert(!reply.lossProven);
});
test('G11 early defense applies to rotated, reflected and color-swapped new games',()=>{
  const moves='H8 H6 I9 G7 H10 F8 E9'.split(' '),base=blank();moves.forEach((c,k)=>base[idx(c)]=k%2?2:1);
  for(let t=0;t<8;t++)for(const swap of [false,true]){const board=blank();base.forEach((v,i)=>{if(v)board[strict.transformed(i,t)]=swap?3-v:v;});const p=swap?1:2,r=strict.patternDefense(board,p);assert.equal(r.i,strict.transformed(idx('G11'),t),`symmetry ${t} swap ${swap}`);assert(r.patternVerified);}
});
test('25-second comparison avoids I5 without claiming an unproved rejection or safe defense',()=>{
  const moves='H8 H6 I9 G7 H10 F8 E9 E7 G11 J8 F10'.split(' '),board=blank();
  moves.forEach((c,k)=>board[idx(c)]=k%2?2:1);
  const r=strict.analyze(board,2,25000,[]);assert.notEqual(r.i,idx('I5'));assert(r.unverifiedDefense);
  const rejected=(r.rejected||[]).find(x=>x.i===idx('I5'));
  if(rejected)assert(rejected.pv?.length||rejected.line?.length||rejected.replyTrap||rejected.verifiedRefutation,'rejection requires actual proof');
  assert(strict.inspect(board,r.i,2).legal);
});
test('new-game search catches the forced-block counterattack in the 15-ply green loss',()=>{
  const moves='H8 H6 H10 G7 F8 I5 G9 E7 F10 I7 G10 F7 H7 J4 K3'.split(' '),board=blank();
  moves.forEach((c,k)=>{const p=k%2?2:1,s=strict.inspect(board,idx(c),p);assert(s.legal,`${k+1}/${c}`);assert.equal(s.win.length,0);board[idx(c)]=p;});
  assert(strict.forcing(board,1,21,1000).proof);
  const pre=blank();moves.slice(0,11).forEach((c,k)=>pre[idx(c)]=k%2?2:1);
  const defense=strict.analyze(pre,2,15000,[]);
  assert.equal(defense.i,idx('E10'));
  assert((defense.counterThreats||[]).some(x=>x.i===idx('F7')&&x.block===idx('H7')));
  pre[idx('E10')]=2;assert(!strict.forcing(pre,1,21,1000).proof);
});
test('new-game search rejects the 30-ply loss setup and never reuses a refuted fallback',()=>{
  const moves='K4 K5 L5 M6 J5 J4 L3 I6 L6 L4 L7 J7 M8 K6 L8 L9 K8 J8 K3 I7 M2 N1 N8 O8 J6 H6 K9 G5 F4 G7'.split(' '),board=blank();
  moves.forEach((c,k)=>{const p=k%2?1:2,s=strict.inspect(board,idx(c),p);assert(s.legal,`${k+1}/${c}`);assert.equal(s.win.length,0);board[idx(c)]=p;});
  assert(strict.analyze(board,2,1000,[]).lossProven);
  const pre=blank();moves.slice(0,22).forEach((c,k)=>pre[idx(c)]=k%2?1:2);
  const defense=strict.analyze(pre,2,15000,[]);
  assert.equal(defense.i,idx('J6'));
  assert((defense.counterThreats||[]).some(x=>x.i===idx('N8')&&x.block===idx('O8')));
  const late=blank();moves.slice(0,24).forEach((c,k)=>late[idx(c)]=k%2?1:2);
  const result=strict.analyze(late,2,15000,[]);
  assert.notEqual(result.i,idx('J6'));
  assert((result.rejected||[]).some(x=>x.i===idx('J6')));
  assert(result.unverifiedDefense||result.lossProven);
});
test('new-game search traces the 33-ply green loss back through three forced blocks',()=>{
  const moves='H8 H6 H10 G7 F8 I5 G9 E7 F10 I7 G10 E10 F9 F7 H7 D7 C7 J4 K3 H9 I10 J10 E11 D12 F11 F12 I11 J12 H11 G11 I12 E8 J13'.split(' '),board=blank();
  moves.forEach((c,k)=>{const p=k%2?2:1,s=strict.inspect(board,idx(c),p);assert(s.legal,`${k+1}/${c}`);assert.equal(!!s.win.length,k===32,`finish ${k+1}`);board[idx(c)]=p;});
  const before=n=>{const b=blank();moves.slice(0,n-1).forEach((c,k)=>b[idx(c)]=k%2?2:1);return b;};
  const sixth=before(6),i5=sixth.slice(),i7=sixth.slice();i5[idx('I5')]=2;i7[idx('I7')]=2;
  assert(strict.evaluate(i7,2)>strict.evaluate(i5,2),'independent attack axes outrank the single line');
  // These early alternatives have no win certificate; a wall-clock search
  // may complete a different depth. Assert the contract, not a heuristic tie.
  for(const position of [before(4),sixth]){
    const r=strict.analyze(position,2,15000,[]);
    assert(strict.inspect(position,r.i,2).legal);assert.equal(r.proven,false);
  }
  const at14=strict.analyze(before(14),2,15000,[]);
  assert(strict.inspect(before(14),at14.i,2).legal);assert.notEqual(at14.i,idx('F7'));
  assert((at14.counterThreats||[]).some(x=>x.i===idx('F7')&&x.block===idx('H7')));
  const at16=strict.analyze(before(16),2,15000,[]);
  assert(strict.inspect(before(16),at16.i,2).legal);assert.notEqual(at16.i,idx('D7'));
  assert((at16.counterThreats||[]).some(x=>x.i===idx('D7')&&x.block===idx('C7')));
  const at18=strict.analyze(before(18),2,15000,[]);
  assert(at18.lossProven||(at18.i!=null&&strict.inspect(before(18),at18.i,2).legal&&!at18.proven),
    'a timed-out loss proof must retain a legal, explicitly unproven move');
});
test('new-game search keeps a legal move after the F11 defense and G8 reply',()=>{
  const moves='H8 H6 H10 G7 F8 I5 G9 E7 F10 I7 G10 E10 F9 F11 G8'.split(' '),board=blank();
  moves.forEach((c,k)=>{const p=k%2?2:1,s=strict.inspect(board,idx(c),p);assert(s.legal);assert.equal(s.win.length,0);board[idx(c)]=p;});
  const result=strict.analyze(board,2,15000,[]);
  assert.notEqual(result.i,null,'a nonterminal position needs a playable candidate');
  assert(strict.inspect(board,result.i,2).legal);
  if(result.fallback)assert.equal(result.proven,false,'a fallback is not a proven win');
});
test('22-ply green loss exposes the forbidden E10 defense and rejects the earlier C8 trap',()=>{
  const moves='H8 G7 G6 H6 F8 I7 E8 G8 F7 D9 F9 F10 F5 F6 D7 G10 E6 C8 E7 E5 E9 B7'.split(' '),board=blank();
  moves.forEach((c,k)=>{const p=k%2?2:1,s=strict.inspect(board,idx(c),p);assert(s.legal,`${k+1}/${c}`);assert.equal(s.win.length,0);board[idx(c)]=p;});
  const before22=blank();moves.slice(0,21).forEach((c,k)=>before22[idx(c)]=k%2?2:1);
  assert(!strict.inspect(before22,idx('E10'),2).legal);
  const loss=strict.analyze(before22,2,25000,[]);
  assert(loss.lossProven);assert.equal(loss.forbiddenDefense,idx('E10'));
  assert.notEqual(loss.i,idx('E10'));assert.match(loss.reason,/E10.*3×3/);
  const before18=blank();moves.slice(0,17).forEach((c,k)=>before18[idx(c)]=k%2?2:1);
  const afterC8=before18.slice();afterC8[idx('C8')]=2;
  const trap=strict.quietTrap(afterC8,2,12000,12,25,true);
  assert(trap.complete&&trap.proof);assert.equal(trap.proof.block,idx('E7'));
  const defense=strict.analyze(before18,2,25000,[]);
  assert.notEqual(defense.i,idx('C8'));
  assert((defense.rejected||[]).some(x=>x.i===idx('C8')&&(x.replyTrap||x.verifiedRefutation)));
});
test('new games exclude independently certified F6 and F10',()=>{
  const moves='H8 G7 G6 H6 F8 I7 E8 G8 F7 D9 F9'.split(' '),board=blank();
  moves.forEach((c,k)=>board[idx(c)]=k%2?2:1);
  for(let t=0;t<8;t++)for(const swap of [false,true]){
    const rotated=blank();board.forEach((p,i)=>{if(p)rotated[strict.transformed(i,t)]=swap?3-p:p;});
    const known=strict.knownRefutations(rotated,swap?1:2);
    assert.equal(known.length,2);
    assert.equal(known[0].i,strict.transformed(idx('F6'),t));
    assert.equal(known[1].i,strict.transformed(idx('F10'),t));
    assert.equal(strict.certifiedLoss(rotated,swap?1:2),null);
  }
  const recommendation=strict.analyze(board,2,25000,[]);
  assert(strict.inspect(board,recommendation.i,2).legal);
  assert(!recommendation.proven);
  assert((recommendation.rejected||[]).some(m=>m.i===idx('F6')&&m.verifiedRefutation));
  assert((recommendation.rejected||[]).some(m=>m.i===idx('F10')&&m.verifiedRefutation));
});
console.log(`${count} unified scenarios passed`);
