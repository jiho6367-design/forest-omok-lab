const assert=require('node:assert/strict'),create=require('../src/node-engine.cjs');
const E=create({fivePriority:false}),index=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const cases=[['i7','I7','E8'],['h5','H5','F9'],['f6','F6','G10'],['f10','F10','F5'],['c6','C6','E6']];
for(const [file,bad,attack] of cases){
  const spec=require(`../reports/${file}-loss-certificate.json`),coords=spec.prefix.split(' ');
  assert.equal(coords.pop(),bad);
  const board=Array(225).fill(0);coords.forEach((c,k)=>board[index(c)]=k%2?2:1);
  for(let t=0;t<8;t++)for(const swap of [false,true]){
    const b=Array(225).fill(0),p=swap?1:2;
    board.forEach((q,i)=>{if(q)b[E.transformed(i,t)]=swap?3-q:q;});
    const known=E.knownRefutations(b,p),entry=known.find(x=>x.i===E.transformed(index(bad),t));
    assert(entry);assert.equal(entry.attack,E.transformed(index(attack),t));
    assert.equal(create({fivePriority:true}).knownRefutations(b,p).length,0);
  }
  if(file==='i7'){
    const updates=[],r=E.analyze(board,2,500,[],x=>updates.push(x));
    assert(updates.length,'exercise interim results');
    for(const result of [...updates,r]){
      assert.notEqual(result.i,index('I7'),'certified loss must not escape in progress');
      assert(E.inspect(board,result.i,2).legal);
      assert(result.rejected.some(m=>m.i===index('I7')&&m.verifiedRefutation));
    }
  }
}
console.log('PASS verified certificate mappings, 80 symmetries/colors, rule isolation and interim exclusion');
