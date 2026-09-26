const black='L12 F10 I10 G9 F8 G8 E7 F7 G7 H7 F6 C5 G5 I5'.split(' ');
const white='K11 H10 J10 F9 I9 H8 I8 D7 I7 D6 G6 H6 I6 J6 K6'.split(' ');
const idx=s=>(15-Number(s.slice(1)))*15+s.charCodeAt(0)-65;
const coord=i=>String.fromCharCode(65+i%15)+(15-Math.floor(i/15));
let final=Array(225).fill(0);black.forEach(s=>final[idx(s)]=1);white.forEach(s=>final[idx(s)]=2);
let before=final.slice();before[idx('I5')]=0;before[idx('K6')]=0;
module.exports={black,white,idx,coord,final,before};
if(require.main===module){for(let file of ['./engine-v1.cjs','./engine.js']){let {createEngine}=require(file),e=createEngine(15,before),start=Date.now();let r=e.analyze(1,2000);console.log(file,JSON.stringify({...r,moves:r.moves.map(m=>({...m,i:coord(m.i),pv:m.pv.map(coord)}))}),Date.now()-start);console.log('K6 legal',e.legal(idx('K6'),1),'I5 legal',e.legal(idx('I5'),1));}}
