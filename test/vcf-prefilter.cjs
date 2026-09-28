const assert=require('node:assert/strict'),create=require('../src/forest-engine.js');
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65,boards=[];
for(const prefix of ['H8 G7 G6 H6 F8','H8 G7 G6 H6 F8 I5 K3','H8 A1 H9 B1 H10 C1','H8 A1 H9 B1 H10 C1 H11 D2']){
 const b=Array(225).fill(0);prefix.split(' ').forEach((c,k)=>b[idx(c)]=k%2?2:1);boards.push(b);
}
let seed=9283;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
for(let k=0;k<24;k++){
 const b=Array(225).fill(0);for(let j=0;j<6+k%12;j++){let i;do{i=Math.floor(rand()*225);}while(b[i]);b[i]=j%2?2:1;}boards.push(b);
}
let skipped=0,retainedWins=0;
for(const fivePriority of [false,true]){
 const old=create({fivePriority,vcfPrefilter:false}),fast=create({fivePriority});
 for(const b of boards)for(const p of [1,2]){
  const before=b.join(''),a=old.forcing(b,p,11,1000),c=fast.forcing(b,p,11,1000);
  assert(a.complete&&c.complete);assert.deepEqual(c.proof,a.proof);
  assert.equal(b.join(''),before);
  if(c.proof)retainedWins++;
  if(c.prefiltered){
   skipped++;assert.equal(c.proof,null);
   // Exhaustive rule-based oracle: no legal move can start a four or win.
   for(let i=0;i<225;i++){const s=fast.inspect(b,i,p);assert(!(s.legal&&(s.win.length||s.fours.length)));}
  }
 }
 assert.equal(fast.forcing(boards[0],2,11,0).complete,false);
 const cache=new Map();fast.forcing(boards[0],2,11,1000,cache);assert(cache.size>0);
 const reused=fast.forcing(boards[0],2,11,1000,cache);
 assert.equal(reused.proof,null);assert(reused.complete);assert.equal(reused.prefiltered,false,'completed negative result is reused before rescanning');
}
assert(skipped>0&&retainedWins>0);
console.log(`PASS VCF prefilter: ${skipped} certified skips, ${retainedWins} preserved wins, both rule modes/colors`);
