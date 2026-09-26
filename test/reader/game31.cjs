const coords='J10 I9 I11 K9 J9 J8 H10 I7 L10 I10 J12 G9 I8 H7 H6 J7 K7 G7 F7 G8 J11 J13 K13 L14 G6 G10 G11 H8 H11 F10 F11'.split(' ');
const idx=s=>(15-Number(s.slice(1)))*15+s.charCodeAt(0)-65,coord=i=>String.fromCharCode(65+i%15)+(15-Math.floor(i/15));
const position=(n=coords.length)=>{const b=Array(225).fill(0);coords.slice(0,n).forEach((s,k)=>{if(b[idx(s)])throw Error('duplicate');b[idx(s)]=k%2?2:1;});return b;};
module.exports={coords,idx,coord,position};
if(require.main===module){const {createEngine}=require('./engine');for(let n=0;n<31;n++){const e=createEngine(15,position(n)),p=n%2?2:1;if(!e.legal(idx(coords[n]),p))console.log('ILLEGAL',n+1,coords[n]);if(n%2===0&&n>0){const r=e.analyze(1,1000);console.log(JSON.stringify({n,kind:r.kind,reason:r.lossReason,moves:r.moves.map(m=>coord(m.i)),score:r.moves[0]?.score}));}}console.log('final',createEngine(15,position()).state().lines.map(l=>l.map(coord)));}
