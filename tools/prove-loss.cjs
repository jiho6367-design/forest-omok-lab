// Research tool: a sound but incomplete threat proof over every legal reply.
// Search limits affect whether proof is found, not its validity.
// Usage: node tools/prove-loss.cjs "H8 G7 ..." 2 25 "" white black-first "" wide --forcing-extensions
// A null proof means no win was found within the requested depth/candidate scope.
const engine=require('../test/engine.cjs')({fivePriority:false});
const coord=i=>engine.coord(i),idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const moves=process.argv[2]?.split(/\s+/).filter(Boolean)||[];
const depth=Math.max(0,Number(process.argv[3]??2)),seconds=Math.max(1,Number(process.argv[4]??120)),preferred=process.argv[5]||null;
const attacker=process.argv[6]==='white'?2:1,defender=3-attacker;
const first=process.argv[7]==='white-first'?2:1;
const threatOnly=process.argv[8]==='threats';
const wide=process.argv[9]==='wide';
// A forced four/block exchange need not consume a quiet preparation stage.
// Keep a separate finite cap, and include it in the transposition key.
const extensionLimit=process.argv.includes('--forcing-extensions')?8:0;
const rootChecks=[];
const board=Array(225).fill(0);moves.forEach((c,k)=>{const p=k%2?3-first:first,s=engine.inspect(board,idx(c),p);if(!s.legal||s.win.length)throw Error(`invalid move ${k+1} ${c}`);board[idx(c)]=p;});
const deadline=Date.now()+seconds*1000,cache=new Map(),proofCache=new Map(),stats={nodes:0,direct:0,unknown:0,defenderReplies:0,timedOut:0,incompleteForcing:0,cacheHits:0,forcingExtensions:0,certifiedPrunes:0};
function attackCandidates(b){
 const set=new Set(engine.candidates(b));
 if(wide)for(let i=0;i<225;i++)if(b[i]===attacker){
  const x=i%15,y=i/15|0;
  for(const [dx,dy] of engine.D)for(let step=-4;step<=4;step++){
   const xx=x+dx*step,yy=y+dy*step;
   if(step&&xx>=0&&xx<15&&yy>=0&&yy<15&&!b[yy*15+xx])set.add(yy*15+xx);
  }
 }
 return [...set];
}
function rankedAttack(b,ply){
 const rejected=new Map(engine.knownRefutations(b,attacker).map(m=>[m.i,m]));
 return attackCandidates(b).filter(i=>{
 if(rejected.has(i)){
  stats.certifiedPrunes++;
  if(ply===0)rootChecks.push({move:coord(i),status:'certified_loss',winningReply:coord(rejected.get(i).attack),defensesChecked:0,elapsed_ms:0});
  return false;
 }
 const s=engine.inspect(b,i,attacker);
 return s.legal&&(!threatOnly||s.threes.length||s.fours.length||s.win.length);
}).map(i=>{
 const s=engine.inspect(b,i,attacker);b[i]=attacker;const evalScore=engine.evaluate(b,attacker);b[i]=0;
 return {i,score:(s.win.length?1e9:0)+(s.fours.length?1e6:0)+(s.threes.length?1e4:0)+evalScore};
}).sort((a,c)=>c.score-a.score).map(x=>x.i).sort((a,c)=>preferred?(c===idx(preferred))-(a===idx(preferred)):0);}
function rankedDefenses(b){
 const near=engine.candidates(b).map(i=>{
  const own=engine.inspect(b,i,defender),block=engine.inspect(b,i,attacker);
  return {i,score:(own.win.length?1e9:0)+(block.win.length?8e8:0)+
   (own.fours.length?1e6:0)+(block.fours.length?8e5:0)+
   (own.threes.length?1e4:0)+(block.threes.length?8e3:0)};
 }).sort((a,c)=>c.score-a.score||a.i-c.i).map(x=>x.i);
 const seen=new Set(near);return [...near,...Array.from({length:225},(_,i)=>i).filter(i=>!seen.has(i))];
}
function solve(b,left,extensions=extensionLimit,ply=0){if(Date.now()>=deadline){stats.timedOut++;return null;}stats.nodes++;
 const key=b.join('')+'|'+left+'|'+extensions;if(cache.has(key)){stats.cacheHits++;return cache.get(key);}
 const incompleteBefore=stats.incompleteForcing,timeoutsBefore=stats.timedOut;
 const forcing=engine.forcing(b,attacker,25,Math.max(1,Math.min(800,deadline-Date.now())),proofCache);
 if(forcing.proof){stats.direct++;const proof={type:'forcing',pv:forcing.proof.pv.map(coord)};cache.set(key,proof);return proof;}
 if(!forcing.complete){stats.incompleteForcing++;return null;}if(left<=0&&extensions<=0){cache.set(key,null);return null;}
 for(const move of rankedAttack(b,ply)){
  if(Date.now()>=deadline){stats.timedOut++;break;}const shape=engine.inspect(b,move,attacker);b[move]=attacker;
  if(shape.win.length){b[move]=0;return {type:'five',move:coord(move)};}
  const extend=extensions>0&&shape.fours.length>0&&engine.winning(b,attacker).length>0;
  if(left<=0&&!extend){b[move]=0;continue;}
  if(extend)stats.forcingExtensions++;
  const attemptStart=Date.now(),timeoutBefore=stats.timedOut,incompleteAtStart=stats.incompleteForcing;
  let all=true,exceptions=[],count=0,unrefutedResponse=null,responseWins=false;
  for(const response of rankedDefenses(b)){
   if(Date.now()>=deadline){stats.timedOut++;all=false;break;}const shape=engine.inspect(b,response,defender);if(!shape.legal)continue;
   stats.defenderReplies++;count++;if(shape.win.length){all=false;unrefutedResponse=coord(response);responseWins=true;break;}
   b[response]=defender;const child=solve(b,left-(extend?0:1),extensions-(extend?1:0),ply+1);b[response]=0;
   if(!child){all=false;unrefutedResponse=coord(response);break;}if(child.type!=='forcing')exceptions.push({response:coord(response),proof:child});
  }
  b[move]=0;
  if(ply===0)rootChecks.push({move:coord(move),status:all&&count>0?'proved':
    stats.timedOut>timeoutBefore||stats.incompleteForcing>incompleteAtStart?'incomplete':'unproved',
    elapsed_ms:Date.now()-attemptStart,defensesChecked:count,unrefutedResponse,responseWins});
  if(all&&count>0){const proof={type:'quiet',move:coord(move),replies:count,exceptions};cache.set(key,proof);return proof;}
 }
 // Cache a negative result only for a fully explored scope. A timeout must
 // never become a reusable claim that no attack exists.
 if(stats.incompleteForcing===incompleteBefore&&stats.timedOut===timeoutsBefore)cache.set(key,null);
 stats.unknown++;return null;
}
const started=Date.now();const next=moves.length%2?3-first:first;
if(next===attacker){const proof=solve(board,depth);console.log(JSON.stringify({next:attacker===1?'black':'white',depth,forcingExtensionLimit:extensionLimit,scope:wide?'aligned-through-four':'near-two',proof,rootChecks,searchComplete:stats.timedOut===0&&stats.incompleteForcing===0,ms:Date.now()-started,stats},null,2));}
else{let legal=0,proved=0,unknown=[];for(const i of rankedDefenses(board)){
 if(Date.now()>=deadline){stats.timedOut++;break;}if(!engine.inspect(board,i,defender).legal)continue;legal++;board[i]=defender;
 const proof=solve(board,depth,extensionLimit,1);board[i]=0;if(proof)proved++;else unknown.push(coord(i));
 if(!proof)console.log('unproved',coord(i),'elapsed',Date.now()-started);
}console.log(JSON.stringify({next:defender===1?'black':'white',depth,forcingExtensionLimit:extensionLimit,scope:wide?'aligned-through-four':'near-two',legal,proved,unknown,searchComplete:stats.timedOut===0&&stats.incompleteForcing===0,ms:Date.now()-started,stats},null,2));}
