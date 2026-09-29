const assert=require('node:assert/strict');
const create=require('../tools/dfpn.cjs'),E=require('../src/node-engine.cjs')({fivePriority:false});
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
function board(black='',white=''){const b=Array(225).fill(0);for(const [text,p]of[[black,1],[white,2]])for(const c of text.split(' ').filter(Boolean))b[idx(c)]=p;return b;}
for(const attacker of [1,2]){
 const b=board(attacker===1?'D8 E8 F8 G8':'',attacker===2?'D8 E8 F8 G8':'');
 const result=create({board:b,side:attacker,attacker}).run({ms:2000});
 assert.equal(result.status,'PROVEN_WIN');
 assert.equal(create({board:b,side:attacker,attacker:3-attacker}).run({ms:2000}).status,'PROVEN_NONWIN');
}
const strict=board('E8 F8 G8 I8 H7 H9 G7 I9');
assert(!E.inspect(strict,idx('H8'),1).legal);
const forbidden=create({board:strict,side:1,attacker:1}).run({ms:100,maxNodes:1000});
assert(!forbidden.rootMoves.some(x=>x.move==='H8'));
const overline=board('C8 D8 E8 F8 G8');
assert(E.inspect(overline,idx('H8'),1).legal&&!E.inspect(overline,idx('H8'),1).win.length);
// Small finite games: independently enumerate EVERY legal move with existing
// rule functions. This oracle uses no DFPN, candidate generator or old proof.
function brute(b,p,a){
 let any=false;
 for(let i=0;i<225;i++){
  const s=E.inspect(b,i,p);if(!s.legal)continue;any=true;b[i]=p;
  const win=s.win.length?p===a:brute(b,3-p,a);b[i]=0;
  if(p===a&&win)return true;if(p!==a&&!win)return false;
 }
 return any&&p!==a;
}
const full=Array.from({length:225},(_,i)=>((i%15+2*Math.floor(i/15))%4<2?1:2));
assert(full.every((p,i)=>!E.win(full,i,p).length));
let checked=0;
for(const holes of [[],[112],[112,113],[96,112,113],[96,112,113,128]])for(const side of [1,2])for(const attacker of [1,2]){
 const b=full.slice();holes.forEach(i=>b[i]=0);const expected=brute(b.slice(),side,attacker);
 const session=create({board:b,side,attacker});
 assert.equal(session.run({ms:0}).status,'UNRESOLVED');
 let r;for(let k=0;k<20;k++){r=session.run({ms:500,maxNodes:10000});if(r.complete)break;}
 assert(r.complete,JSON.stringify(r));assert.equal(r.status==='PROVEN_WIN',expected);checked++;
 assert.deepEqual(b,full.map((p,i)=>holes.includes(i)?0:p));
}
const s=create({prefix:'H8 G7 G6 H6 F8 F7',attacker:1});
const limited=s.run({ms:500,maxNodes:1});assert.equal(limited.status,'UNRESOLVED');assert.equal(limited.stopReason,'node-limit');
const aborted=s.run({ms:1000,signal:{aborted:true}});assert.equal(aborted.stopReason,'cancelled');
const resumed=s.run({ms:100,maxNodes:1000});assert(resumed.stats.nodes>1);
const interrupted=create({prefix:'H8 G7 G6 H6 F8 F7',attacker:1});let checks=0;
assert.equal(interrupted.run({ms:1000,signal:{get aborted(){return ++checks>30;}}}).stopReason,'cancelled');
assert.equal(interrupted.run({ms:50,maxNodes:500}).status,'UNRESOLVED');
assert.throws(()=>create({side:3}),/Invalid side/);
console.log('PASS DFPN terminals, strict rules, exhaustive finite games '+checked+', lazy moves, cancellation, limits and resume');
