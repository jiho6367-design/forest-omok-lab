const assert=require('node:assert/strict');
const forest=require('../src/forest-engine.js');
const reader=require('../src/reader-engine.js').createEngine;
const unified=require('../src/node-engine.cjs');
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const cases=[
 ['A exact five','D8 E8 F8 G8',true,true],
 ['B exact five + double three','E8 F8 G8 I8 H7 H9 G7 I9',true,true,2,0],
 ['C exact five + multiple fours','E8 F8 G8 I8 H6 H7 H9 F6 G7 I9',true,true,0,2],
 ['D double three','G8 I8 H7 H9',false,false,2,0],
 ['E double four','F8 G8 I8 H6 H7 H9',true,false,0,2],
 ['F overline','C8 D8 E8 F8 G8',true,false],
 ['G overline + double three','C8 D8 E8 F8 G8 H7 H9 G7 I9',false,false,2,0]
];
let checks=0;
for(const [name,stones,legal,win,min3=0,min4=0] of cases) {
 for(const p of [1,2]) for(const options of [{},{fivePriority:false},{fivePriority:true}]) {
 const b=Array(225).fill(0);for(const c of stones.split(' '))b[idx(c)]=p;
 const original=b.slice(),i=idx('H8');
 for(const factory of [forest,unified]) {
 const e=factory(options);if(e.configure)e.configure({fivePriority:false});
 const r=e.inspect(b,i,p);
 assert.equal(r.legal,legal,name);assert.equal(!!r.win.length,win,name);
 assert.ok(r.threes.length>=min3,name+' three fixture');assert.ok(r.fours.length>=min4,name+' four fixture');
 assert.equal(e.winning(b,p).includes(i),win,name+' winning');
 if(legal)assert.equal(r.reason,'',name+' reason');
 assert.deepEqual(b,original);checks++;
 }
 const e=reader(15,b.slice(),options);
 assert.equal(e.legal(i,p),legal,name+' reader');assert.equal(e.moveInfo(i,p).legal,legal,name+' moveInfo');
 assert.equal(e.winMove(i,p),win,name+' winMove');assert.equal(e.winningMoves(p).includes(i),win,name+' reader wins');
 assert.deepEqual(e.board,original);checks++;
 }
 console.log('PASS '+name+' (both colors; default, legacy false, true)');
}
console.log('PASS '+checks+' engine/fixture combinations');
// Rule changes must not reuse unverified strict-rule refutations.
const verified=new Set(['i7','h5','f6','f10','c6','c8','g9-move20','g11-move20']);
for(const file of ['i7','h5','f6','f10','c6','c8','g9-move20','g11-move20']) {
 const spec=require('../reports/'+file+'-loss-certificate.json'),coords=spec.prefix.split(' '),bad=coords.pop();
 const original=Array(225).fill(0);coords.forEach((c,k)=>original[idx(c)]=k%2?2:1);
 for(const options of [{fivePriority:false},{fivePriority:true}])for(let t=0;t<8;t++)for(const swap of [false,true]){
 const e=unified(options),b=Array(225).fill(0);original.forEach((p,i)=>{if(p)b[e.transformed(i,t)]=swap?3-p:p;});
 const found=e.knownRefutations(b,swap?1:2).some(x=>x.i===e.transformed(idx(bad),t));
 assert.equal(found,verified.has(file),'rule-version cache '+file);
 }
}
console.log('PASS verified-only refutation cache (256 rule/symmetry/color combinations)');
