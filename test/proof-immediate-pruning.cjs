const assert=require('node:assert/strict'),create=require('../tools/proof-session.cjs'),E=require('../src/node-engine.cjs')({fivePriority:false});
const prefix='H8 G7 G6 H6 F8 F7 E7 G9 G8 I8 D8 E8 F6 G5 C9';
const spec={prefix,attacker:2,quietDepth:1,extensions:0,roots:['I7','F4','J8','B10']};
const run=immediatePruning=>create({...spec,immediatePruning}).run(5000);
const before=run(false),after=run(true);assert(before.done&&after.done);assert.equal(before.proof,null);assert.equal(after.proof,null);
assert(after.stats.immediatePrunes>=3);assert(after.stats.defenses<before.stats.defenses);
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65,b=Array(225).fill(0);prefix.split(' ').forEach((c,k)=>b[idx(c)]=k%2?2:1);
for(const r of after.rootChecks.filter(x=>x.responseWins)){const board=b.slice();board[idx(r.move)]=2;const s=E.inspect(board,idx(r.unrefutedResponse),1);assert(s.legal&&s.win.length);}
const own={prefix:'H8 A1 H9 B1 H10 C1 H11 D1',attacker:1,quietDepth:0,extensions:0,roots:['H12']};
const win=create(own).run(1000);assert(win.proof,'own immediate five takes precedence over opposing four');
console.log(JSON.stringify({before:{ms:before.elapsed_ms,defenses:before.stats.defenses},after:{ms:after.elapsed_ms,defenses:after.stats.defenses,prunes:after.stats.immediatePrunes}}));
console.log('PASS immediate counterwin pruning, legal recheck, winning move priority');
