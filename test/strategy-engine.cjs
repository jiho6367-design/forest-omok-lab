const assert=require('node:assert/strict'),createForest=require('../src/forest-engine.js'),createStrategy=require('../src/strategy-engine.js'),{createEngine:createReader}=require('../src/reader-engine.js');
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const board=(mine,theirs=[])=>{const b=Array(225).fill(0);for(const c of mine)b[idx(c)]=1;for(const c of theirs)b[idx(c)]=2;return b;};
const rules=createForest({strategy:false});
const helper=options=>createStrategy(15,{inspect:rules.inspect,legal:(b,i,p)=>rules.inspect(b,i,p).legal,winning:rules.winning},options);
// Explicit setup positions: the current colour is supplied independently of
// stone-count parity. They are development mechanisms, not holdout samples.
let b=board(['F8','H8','G6','G7','E10','F9']),copy=b.slice(),s=helper(),feature=s.move(b,idx('E8'),1);
assert(rules.inspect(b,idx('E8'),1).legal);assert.deepEqual(feature.usableThreeAxes,[]);assert.deepEqual(feature.invalidThreeAxes,[0]);
assert(feature.invalidExtensions.includes(idx('G8')));assert(!feature.legalExtensions.includes(idx('G8')));assert.deepEqual(b,copy);
const rich=createReader(15,b).rank(1,[idx('E8')],true)[0],old=createReader(15,b,{strategy:false}).rank(1,[idx('E8')])[0];
assert(rich.s<old.s-700,'remove unusable immediate-three window credit instead of adding a small bonus');
console.log('PASS geometric house-rule three preserved while its forbidden extension receives no attack credit');

for(let t=0;t<8;t++)for(const swap of [false,true]){const transformed=Array(225).fill(0);b.forEach((v,i)=>transformed[rules.transformed(i,t)]=swap&&v?3-v:v);
 const m=helper().move(transformed,rules.transformed(idx('E8'),t),swap?2:1);assert(m.legal);assert.equal(m.usableThreeAxes.length,0);assert(m.invalidExtensions.includes(rules.transformed(idx('G8'),t)));
}
console.log('PASS extension legality through D4 transforms and colour exchange');

b=board(['G8','H8'],['J7','J8']);copy=b.slice();s=helper();const candidatePool=Array.from({length:225},(_,i)=>i).filter(i=>rules.inspect(b,i,1).legal).map(i=>({i,score:i===idx('A1')?10000:0}));
const selected=s.select(b,1,candidatePool,12,6,new Set([idx('I8')]));
assert.equal(selected.length,12);assert.equal(new Set(selected.map(m=>m.i)).size,12);assert.equal(selected[0].i,idx('I8'));assert(selected.some(m=>m.i===idx('A1')));
assert(selected.some(m=>m.strategy.cut>0));assert(selected.some(m=>m.strategy.attack>0));assert.deepEqual(b,copy);
console.log('PASS fixed-width strategic quotas retain tactics, connection, cut and the existing high-ranked candidate');

b=board(['C8','D8','E8','D6','E7'],['B8','H11','I11','J11']);copy=b.slice();s=helper({firstPlayer:2});
feature=s.move(b,idx('F8'),1);const result=s.probe(b,1,[{i:idx('F8'),score:100,strategy:feature}],500);
assert(result.complete,JSON.stringify(result));assert.equal(result.checks.length,1);const check=result.checks[0];assert.equal(check.pv[1],idx('G8'));
assert(check.complete&&check.continues===check.replies);assert.equal(result.initiative,'own');assert.equal(check.proven,false);assert.equal(check.refuted,false);
const after=b.slice();after[idx('F8')]=1;after[idx('G8')]=2;assert(rules.forcing(after,2,19,100).proof);assert(rules.forcing(after,1,19,100).proof);
assert.deepEqual(b,copy);assert.equal(result.firstPlayer,2);
console.log('PASS actual-turn continuation retains attack despite an opponent hypothetical future VCF; bounded checks are not proofs');

const incomplete=helper().probe(b,1,[{i:idx('F8'),score:100,strategy:feature}],0);assert.equal(incomplete.complete,false);assert.equal(incomplete.initiative,'unknown');assert(incomplete.checks.every(c=>!c.proven&&!c.refuted));
const empty=helper().probe(b,1,[],100);assert.equal(empty.complete,false);
s=helper();s.setBudget(0);assert.equal(s.move(b,idx('F8'),1).incomplete,true);assert.equal(s.profile(b,1).initiative,'unknown');assert.equal(s.probe(b,1,[{i:idx('F8')}],100).complete,false);assert.equal(s.remaining(),0);
console.log('PASS timeout, missing roots and shared work-budget exhaustion remain incomplete');

const stepRules={legal:(b,i,p)=>{const n=b.filter(Boolean).length;return n<5&&i===n&&p===n%2+1;},inspect:(b,i,p)=>({legal:stepRules.legal(b,i,p),win:[],threes:[],fours:i===2?[0]:[],details:[]}),winning:(b,p)=>p===1&&b[0]&&!b[1]?[1]:p===1&&b[2]&&!b[3]?[3]:[]};
const steps=Array(225).fill(0),extended=createStrategy(15,stepRules).probe(steps,1,[{i:0,score:1}],100);
assert(extended.complete);assert.deepEqual(extended.checks[0].pv,[0,1,2,3,4]);assert.equal(extended.checks[0].continues,0);assert.equal(extended.checks[0].extensionPlies,2);assert.equal(extended.initiative,'unknown');assert(steps.every(v=>v===0));
console.log('PASS mandatory second block is played before crediting a retained attack');

const first=helper({firstPlayer:1}),second=helper({firstPlayer:2});assert.equal(first.positionValue(b,1),second.positionValue(b,1));assert.equal(first.profile(b,1).initiative,second.profile(b,1).initiative);
assert.equal(first.profile(b,1).initiative,'unknown');assert.equal(first.context.firstPlayer,1);assert(Object.isFrozen(first.context));
const a=createForest(),plain=createForest({positionCache:false});assert.equal(a.evaluate(b,1),plain.evaluate(b,1));a.analyze(b,1,30);assert.equal(a.evaluate(b,1),plain.evaluate(b,1));
assert.equal(a.inspect(b,idx('F8'),1).legal,createForest({strategy:false}).inspect(b,idx('F8'),1).legal);
console.log('PASS first-player context is independent of colour and initiative; pure evaluation cache survives budget exhaustion');

const opening=board(['H8','G6','F8'],['G7','H6']);
const cpu=createReader(15,opening,{strategy:true,optimized:false}).fixedWork(2,3),optimized=createReader(15,opening,{strategy:true,optimized:true}).fixedWork(2,3);
assert.equal(cpu.nodes,optimized.nodes);assert.equal(cpu.score,optimized.score);assert.deepEqual(cpu.pv,optimized.pv);
const off=createReader(15,opening,{strategy:false}).analyze(2,50);assert.equal(off.strategy,undefined);
console.log('PASS deterministic fixed-work CPU equivalence and full strategy ablation');
