const coords='H9 G8 H7 H8 I8 E8 J7 G10 K6 L5 I7 G7 G6 F8 D8 G9 G11 J9 F5 E4 I6 I9 I4 I5 L7 K7 J5 H3 M8'.split(' ');
const idx=s=>(15-Number(s.slice(1)))*15+s.charCodeAt(0)-65,coord=i=>String.fromCharCode(65+i%15)+(15-Math.floor(i/15));
const position=(n=coords.length)=>{const b=Array(225).fill(0);coords.slice(0,n).forEach((s,k)=>b[idx(s)]=k%2?1:2);return b;};
module.exports={coords,idx,coord,position};
if(require.main===module){const {createEngine}=require('./engine');for(let n=0;n<29;n++){const e=createEngine(15,position(n));if(!e.legal(idx(coords[n]),n%2?1:2))console.log('ILLEGAL',n+1,coords[n]);}for(const n of [19,21,23,25,27,29]){let e=createEngine(15,position(n)),r=e.analyze(1,3000);console.log(JSON.stringify({n,kind:r.kind,danger:r.danger.map(coord),fallback:r.fallback,moves:r.moves.map(m=>({i:coord(m.i),pv:m.pv.map(coord),score:m.score})),rejected:r.rejectedMoves?.slice(0,3).map(m=>({...m,i:coord(m.i),line:m.line.map(coord)}))}));}}
