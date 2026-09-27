// Research tool: a sound but incomplete black threat proof over every legal
// white reply. Search limits affect whether proof is found, not its validity.
const engine=require('../test/engine.cjs')({fivePriority:false});
const coord=i=>engine.coord(i),idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const moves=process.argv[2]?.split(/\s+/).filter(Boolean)||[];
const depth=Math.max(0,Number(process.argv[3])||2),seconds=Math.max(1,Number(process.argv[4])||120),preferred=process.argv[5]||null;
const board=Array(225).fill(0);moves.forEach((c,k)=>{const p=k%2?2:1,s=engine.inspect(board,idx(c),p);if(!s.legal||s.win.length)throw Error(`invalid move ${k+1} ${c}`);board[idx(c)]=p;});
const deadline=Date.now()+seconds*1000,cache=new Map(),proofCache=new Map(),stats={nodes:0,direct:0,unknown:0,whiteReplies:0};
function rankedBlack(b){return engine.candidates(b).filter(i=>engine.inspect(b,i,1).legal).map(i=>{
 const s=engine.inspect(b,i,1);b[i]=1;const evalScore=engine.evaluate(b,1);b[i]=0;
 return {i,score:(s.win.length?1e9:0)+(s.fours.length?1e6:0)+(s.threes.length?1e4:0)+evalScore};
}).sort((a,c)=>c.score-a.score).map(x=>x.i).sort((a,c)=>preferred?(c===idx(preferred))-(a===idx(preferred)):0);}
function solve(b,left){if(Date.now()>=deadline)return null;stats.nodes++;
 const key=b.join('')+'|'+left;if(cache.has(key))return cache.get(key);
 const forcing=engine.forcing(b,1,25,Math.max(1,Math.min(800,deadline-Date.now())),proofCache);
 if(forcing.proof){stats.direct++;const proof={type:'forcing',pv:forcing.proof.pv.map(coord)};cache.set(key,proof);return proof;}
 if(!forcing.complete||left<=0)return null;
 for(const black of rankedBlack(b)){
  if(Date.now()>=deadline)break;const shape=engine.inspect(b,black,1);b[black]=1;
  if(shape.win.length){b[black]=0;return {type:'five',move:coord(black)};}
  let all=true,exceptions=[],count=0;
  for(let white=0;white<225;white++){
   if(Date.now()>=deadline){all=false;break;}const shape=engine.inspect(b,white,2);if(!shape.legal)continue;
   stats.whiteReplies++;count++;if(shape.win.length){all=false;break;}
   b[white]=2;const child=solve(b,left-1);b[white]=0;
   if(!child){all=false;break;}if(child.type!=='forcing')exceptions.push({white:coord(white),proof:child});
  }
  b[black]=0;
  if(all){const proof={type:'quiet',move:coord(black),replies:count,exceptions};cache.set(key,proof);return proof;}
 }
 stats.unknown++;return null;
}
const started=Date.now();const next=moves.length%2?2:1;
if(next===1){const proof=solve(board,depth);console.log(JSON.stringify({next:'black',proof,ms:Date.now()-started,stats},null,2));}
else{let legal=0,proved=0,unknown=[];for(let i=0;i<225;i++){
 if(Date.now()>=deadline)break;if(!engine.inspect(board,i,2).legal)continue;legal++;board[i]=2;
 const proof=solve(board,depth);board[i]=0;if(proof)proved++;else unknown.push(coord(i));
 if(!proof)console.log('unproved',coord(i),'elapsed',Date.now()-started);
}console.log(JSON.stringify({next:'white',legal,proved,unknown,ms:Date.now()-started,stats},null,2));}
