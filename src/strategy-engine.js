/* Shared, proof-free strategy. Rule callbacks remain the authority on legality.
 * A geometric three used by the house rule is distinct from a usable attack.
 * Bounded reply coverage is evidence for ordering, never a safety certificate. */
function createStrategyEngine(N,rules,options={}){
 const now=options.clock||(()=>typeof performance!=='undefined'?performance.now():Date.now());
 const firstPlayer=[1,2].includes(options.firstPlayer??options.context?.firstPlayer)?(options.firstPlayer??options.context.firstPlayer):null;
 const context=Object.freeze({firstPlayer}),strategyVersion='initiative-1';
 const D=[[1,0],[0,1],[1,1],[1,-1]],inside=(x,y)=>x>=0&&y>=0&&x<N&&y<N;
 const geometry=createStrategyEngine.geometry||(createStrategyEngine.geometry=new Map());
 let windows=geometry.get(N);
 if(!windows){windows=[];for(let y=0;y<N;y++)for(let x=0;x<N;x++)for(let axis=0;axis<4;axis++){
  const [dx,dy]=D[axis];if(!inside(x+4*dx,y+4*dy))continue;
  windows.push({axis,cells:Array.from({length:5},(_,k)=>(y+k*dy)*N+x+k*dx),pre:inside(x-dx,y-dy)?(y-dy)*N+x-dx:-1,post:inside(x+5*dx,y+5*dy)?(y+5*dy)*N+x+5*dx:-1});
 }geometry.set(N,windows);}
 const structures=new Map(),features=new Map();
 let workLimit=Infinity,workMs=0,skipped=0;
 const empty=i=>({i,legal:true,attack:0,cut:0,dual:0,score:0,axes:[],anchors:[],legalExtensions:[],invalidExtensions:[],invalidThreeAxes:[],usableThreeAxes:[],forcing:false,tentative:true,incomplete:true});
 const lightProfile=(board,p)=>{const ownWins=rules.winning(board,p),enemyWins=rules.winning(board,3-p);return {initiative:ownWins.length?'own':enemyWins.length?'opponent':'unknown',firstPlayer,strategyVersion,complete:false,evidence:{ownWins,enemyWins,replyCoverage:'not-checked'}};};
 const measured=(fn,fallback)=>(...args)=>{if(workMs>=workLimit){skipped++;return fallback(...args);}const start=now();try{return fn(...args);}finally{workMs+=now()-start;}};
 const keep=(cache,key,value)=>{if(cache.size>=512)cache.delete(cache.keys().next().value);cache.set(key,value);return value;};
 function structure(board,p,validate=true){
  const key=board.join('')+'|'+p+'|'+validate,cached=structures.get(key);if(cached)return cached;
  const stoneCount=board.reduce((n,v)=>n+(v===p),0),legal=new Map(),points=new Map(),nodes=[];
  const can=i=>{if(!legal.has(i))legal.set(i,!validate||stoneCount<4||rules.legal(board,i,p));return legal.get(i);};
  for(const w of windows){
   if(board[w.pre]===p||board[w.post]===p)continue;
   const stones=[],empty=[];let blocked=false;
   for(const i of w.cells){if(board[i]===3-p){blocked=true;break;}if(board[i]===p)stones.push(i);else empty.push(i);}
   if(blocked||stones.length<2||stones.length>4)continue;
   const usable=empty.filter(i=>can(i));if(!usable.length)continue;
   // A three-stone window earns attack credit only for a legal move that
   // actually creates an exact-five endpoint, including broken fours.
   const extensions=validate&&stones.length>=3?usable.filter(i=>{const s=rules.inspect(board,i,p);return s.win?.length||s.fours?.includes(w.axis);}):usable;
   if(!extensions.length)continue;
   nodes.push({axis:w.axis,stones,keys:extensions,strength:[0,0,3,35,600][stones.length]});
   for(const i of extensions){let point=points.get(i);if(!point){point={i,axisScores:[0,0,0,0],stones:new Set()};points.set(i,point);}
    point.axisScores[w.axis]=Math.max(point.axisScores[w.axis],[0,0,12,120,1800][stones.length]);for(const j of stones)point.stones.add(j);
   }
  }
  // Windows cooperate through actual shared stones or legal common anchors.
  // Overlapping copies of one axis contribute its maximum, not their count.
  const parent=nodes.map((_,i)=>i),links=new Map();
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  nodes.forEach((node,k)=>{for(const token of [...node.stones.map(i=>'s'+i),...node.keys.map(i=>'k'+i)]){if(links.has(token))parent[find(k)]=find(links.get(token));else links.set(token,k);}});
  const components=new Map();nodes.forEach((node,k)=>{const root=find(k);let group=components.get(root);if(!group){group={axes:[0,0,0,0],anchors:new Map()};components.set(root,group);}
   group.axes[node.axis]=Math.max(group.axes[node.axis],node.strength);for(const i of node.keys){if(!group.anchors.has(i))group.anchors.set(i,new Set());group.anchors.get(i).add(node.axis);}
  });
  let score=0,commonAnchors=0;for(const group of components.values()){const axes=group.axes.filter(Boolean).length;score+=group.axes.reduce((a,v)=>a+v,0)+Math.max(0,axes-1)*20;
   for(const axesAt of group.anchors.values())if(axesAt.size>1){commonAnchors++;score+=12*(axesAt.size-1);}
  }
  for(const point of points.values()){point.axes=point.axisScores.map((s,i)=>s?i:-1).filter(i=>i>=0);point.score=point.axisScores.reduce((a,v)=>a+v,0)+Math.max(0,point.axes.length-1)*40;}
  return keep(structures,key,{points,score,components:components.size,commonAnchors,axes:[...new Set(nodes.map(n=>n.axis))]});
 }
 function move(board,i,p,shape){
  const key=board.join('')+'|'+p+'|'+i,cached=features.get(key);if(cached)return cached;
  if(!Number.isInteger(i)||board[i]!==0)return {i,legal:false,score:0,attack:0,cut:0,dual:0,axes:[],legalExtensions:[],invalidExtensions:[]};
  shape=shape||rules.inspect(board,i,p);
  if(!shape.legal)return {i,legal:false,score:0,attack:0,cut:0,dual:0,axes:[],legalExtensions:[],invalidExtensions:[]};
  // The candidate itself is legal; its per-axis window support is cheap to
  // gather. The actual open-three extensions below are separately validated.
  const own=structure(board,p,false).points.get(i),enemy=rules.legal(board,i,3-p)?structure(board,3-p,false).points.get(i):null;
  const legalExtensions=new Set(),invalidExtensions=new Set(),usableThreeAxes=[];
  board[i]=p;
  try{for(const detail of shape.details||[]){const valid=[];for(const j of detail.three||[]){if(rules.legal(board,j,p)){legalExtensions.add(j);valid.push(j);}else invalidExtensions.add(j);}
    if(valid.length)usableThreeAxes.push(detail.axis);for(const j of detail.four||[])if(rules.legal(board,j,p))legalExtensions.add(j);
   }}finally{board[i]=0;}
  const axes=[...new Set([...(own?.axes||[]),...(shape.fours||[]),...usableThreeAxes])];
  const attack=(own?.score||0)+(shape.fours?.length||0)*900+usableThreeAxes.length*180+Math.max(0,axes.length-1)*45;
  const cut=enemy?.score||0,dual=attack&&cut?Math.min(attack,cut):0;
  // Opening order only breaks quiet strategic preferences. It never fixes a
  // colour to permanent defence and never participates in the position value.
  const early=board.reduce((n,v)=>n+!!v,0)<8,opening=early&&firstPlayer!=null?(firstPlayer===p?Math.min(20,attack*.08):Math.min(20,(cut+dual)*.08)):0;
  const score=Math.min(600,attack*.55+cut*.3+dual*.45+opening);
  return keep(features,key,{i,legal:true,attack,cut,dual,score,axes,anchors:own?.axes.length>1?[i]:[],legalExtensions:[...legalExtensions],invalidExtensions:[...invalidExtensions],invalidThreeAxes:(shape.threes||[]).filter(a=>!usableThreeAxes.includes(a)),usableThreeAxes,forcing:!!shape.win?.length||!!shape.fours?.length});
 }
 function profile(board,p){
  const ownWins=rules.winning(board,p),enemyWins=rules.winning(board,3-p),own=structure(board,p),enemy=structure(board,3-p);
  return {initiative:ownWins.length&&enemyWins.length?'contested':ownWins.length?'own':enemyWins.length?'opponent':'unknown',firstPlayer,strategyVersion,
   evidence:{ownWins:ownWins.slice(),enemyWins:enemyWins.slice(),forcingAxes:own.axes.slice(),opponentAxes:enemy.axes.slice(),commonAnchors:own.commonAnchors,opponentCommonAnchors:enemy.commonAnchors,replyCoverage:'not-checked'}};
 }
 // Cheap window hints only nominate work. Promoted quota candidates receive
 // the full legal-extension descriptor before they are added to the search.
 function makeHint(i,own,enemy){const attack=own?.score||0,cut=enemy?.score||0;return {i,attack,cut,dual:attack&&cut?Math.min(attack,cut):0,score:0,axes:own?.axes||[],legalExtensions:[],usableThreeAxes:[],forcing:false,tentative:true};}
 function hint(board,i,p){return makeHint(i,structure(board,p,false).points.get(i),structure(board,3-p,false).points.get(i));}
 function points(board,p){return [...new Set([...structure(board,p,false).points.keys(),...structure(board,3-p,false).points.keys()])];}
 function select(board,p,ranked,width,reserve=6,forcingSet=new Set()){
  const ownPoints=structure(board,p,false).points,enemyPoints=structure(board,3-p,false).points;
  const rows=ranked.map(m=>({...m,strategy:m.strategy||makeHint(m.i,ownPoints.get(m.i),enemyPoints.get(m.i))})),out=[],seen=new Set();
  const add=m=>{if(m&&!seen.has(m.i)){seen.add(m.i);out.push(m);}};
  for(const m of rows)if(forcingSet.has(m.i)||m.strategy.forcing)add(m);
  const capacity=Math.max(width,out.length),room=Math.max(0,capacity-out.length),q=Math.min(reserve,room),ownWins=rules.winning(board,p),enemyWins=rules.winning(board,3-p),state=ownWins.length?'own':enemyWins.length?'opponent':'unknown';
  const quota=state==='own'?[Math.ceil(q/2),Math.floor(q/6),q-Math.ceil(q/2)-Math.floor(q/6)]:state==='opponent'?[Math.floor(q/6),Math.ceil(q/2),q-Math.ceil(q/2)-Math.floor(q/6)]:[Math.ceil(q/3),Math.floor(q/3),q-Math.ceil(q/3)-Math.floor(q/3)];
  for(const [category,n] of ['attack','cut','dual'].map((category,k)=>[category,quota[k]])){let used=0,attempts=0;for(const m of rows.slice().sort((a,b)=>b.strategy[category]-a.strategy[category]||(b.score??b.s??0)-(a.score??a.s??0))){if(used>=n||out.length>=capacity||attempts>=Math.max(4,n*4))break;if(m.strategy[category]>0&&!seen.has(m.i)){attempts++;if(m.strategy.tentative)m.strategy=move(board,m.i,p,m.a);if(m.strategy.legal&&m.strategy[category]>0){add(m);used++;}}}}
  for(const m of rows){if(out.length>=capacity)break;add(m);}return out;
 }
 function evaluate(board,p){return structure(board,p).score-structure(board,3-p).score;}
 function ordered(board,p,width=6,end=Infinity){
  const pool=new Set(points(board,p));for(let i=0;i<board.length;i++)if(board[i]){const x=i%N,y=i/N|0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(inside(x+dx,y+dy)&&!board[(y+dy)*N+x+dx])pool.add((y+dy)*N+x+dx);}
  if(!pool.size&&!board.some(Boolean))pool.add((N*N-1)/2);
  const wins=rules.winning(board,p),danger=rules.winning(board,3-p),forced=wins.length?wins:danger.length===1?danger:null;
  const rows=[],ownPoints=structure(board,p,false).points,enemyPoints=structure(board,3-p,false).points;let complete=true;for(const i of forced||[...pool]){if(now()>=end){complete=false;break;}if(rules.legal(board,i,p)){const feature=makeHint(i,ownPoints.get(i),enemyPoints.get(i));rows.push({i,score:feature.attack*.55+feature.cut*.3+feature.dual*.45,strategy:feature});}}rows.sort((a,b)=>b.score-a.score||a.i-b.i);
  const selected=select(board,p,rows,width,Math.min(4,width),new Set(forced||[]));selected.complete=complete&&now()<end;return selected;
 }
 function probe(board,p,roots,budget){
  const start=now(),end=start+Math.max(0,budget),copy=board.slice(),checks=[];let complete=true;
  // Preserve the previous best and representatives of connection, cut and
  // dual-purpose play; forcing-first ordering must not consume every probe.
  const selected=[],seen=new Set(),add=m=>{if(m&&!seen.has(m.i)){seen.add(m.i);selected.push(m);}};
  add(roots.slice().sort((a,b)=>(b.score??b.s??0)-(a.score??a.s??0))[0]);
  for(const field of ['attack','cut','dual'])add(roots.slice().sort((a,b)=>(b.strategy?.[field]||0)-(a.strategy?.[field]||0))[0]);
  for(const m of roots){if(selected.length>=4)break;add(m);}
  if(!selected.length)complete=false;
  for(const root of selected.slice(0,4)){
   if(now()>=end){complete=false;break;}if(!rules.legal(copy,root.i,p))continue;
   copy[root.i]=p;let minimum=Infinity,worstPV=[root.i],continues=0,forcingReplies=0,replyCount=0,done=true,extensionPlies=0;
   try{
    const replies=ordered(copy,3-p,6,end);if(!replies.complete)done=false;
    for(const reply of replies.slice(0,6)){if(!done||now()>=end){done=false;break;}const replyShape=rules.inspect(copy,reply.i,3-p);copy[reply.i]=3-p;replyCount++;
     let best=-Infinity,bestI=null,bestSuffix=[],continuation=false;
     try{
      if(replyShape.win?.length){best=-1000000;}else{
      if(rules.winning(copy,3-p).length)forcingReplies++;
      const own=ordered(copy,p,6,end);if(!own.complete)done=false;
      for(const follow of own.slice(0,6)){if(!done||now()>=end){done=false;break;}const s=rules.inspect(copy,follow.i,p);copy[follow.i]=p;
        try{const enemyWins=rules.winning(copy,3-p),wins=rules.winning(copy,p);let value=s.win?.length?1000000:enemyWins.length?-1000000:evaluate(copy,p)+(wins.length?5000:0),retains=!!s.win?.length||!enemyWins.length&&!!wins.length,suffix=[];
         // A second forcing four can die on its mandatory quiet block. Read
         // that actual block and our next move before awarding continuation.
         if(!s.win?.length&&!enemyWins.length&&wins.length===1&&rules.legal(copy,wins[0],3-p)){
          const block=wins[0];copy[block]=3-p;extensionPlies=2;
          try{const next=ordered(copy,p,6,end);if(!next.complete)done=false;let extended=-Infinity,chosen=null,keeps=false;
           for(const m of next.slice(0,6)){if(!done||now()>=end){done=false;break;}const shape=rules.inspect(copy,m.i,p);copy[m.i]=p;
            try{const danger=rules.winning(copy,3-p),ends=rules.winning(copy,p),v=shape.win?.length?1000000:danger.length?-1000000:evaluate(copy,p)+(ends.length?1200:0);
             if(v>extended){extended=v;chosen=m.i;keeps=!!shape.win?.length||!danger.length&&!!ends.length;}
            }finally{copy[m.i]=0;}
           }value=Number.isFinite(extended)?extended:-1000000;retains=keeps;suffix=chosen==null?[block]:[block,chosen];
          }finally{copy[block]=0;}
         }
         if(value>best){best=value;bestI=follow.i;bestSuffix=suffix;continuation=retains;}
       }finally{copy[follow.i]=0;}
      }if(best===-Infinity)best=-1000000;}
     }finally{copy[reply.i]=0;}
     if(!done)break;if(continuation)continues++;if(best<minimum){minimum=best;worstPV=bestI==null?[root.i,reply.i]:[root.i,reply.i,bestI,...bestSuffix];}
    }
   }finally{copy[root.i]=0;}
   const checked=done&&replyCount>0;checks.push({i:root.i,complete:checked,score:Number.isFinite(minimum)?minimum:0,pv:worstPV,forcingReplies,continues,replies:replyCount,replyCoverage:'bounded',extensionPlies,continuationDepth:3+extensionPlies,refuted:false,proven:false});
   if(!checked){complete=false;break;}
  }
  const best=checks.filter(c=>c.complete).sort((a,b)=>b.score-a.score)[0],result=profile(board,p);
  if(complete&&best&&best.continues===best.replies)result.initiative=best.forcingReplies?'contested':'own';
  else if(complete&&best&&best.forcingReplies&&best.score<0)result.initiative='opponent';
  else if(!complete&&!result.evidence.ownWins.length&&!result.evidence.enemyWins.length)result.initiative='unknown';
  result.evidence={...result.evidence,replyCoverage:'bounded',checkedRoots:checks.filter(c=>c.complete).length,continues:best?.continues||0,forcingReplies:best?.forcingReplies||0};
  return {...result,checks,complete,ms:now()-start};
 }
 const fallbackSelect=(board,p,rows,width,reserve,forcing=new Set())=>{const forced=rows.filter(m=>forcing.has(m.i)||m.a?.fours.length),seen=new Set(forced.map(m=>m.i));return [...forced,...rows.filter(m=>!seen.has(m.i)).slice(0,Math.max(0,width-forced.length))].map(m=>({...m,strategy:m.strategy||empty(m.i)}));};
 return {context,strategyVersion,structure,move:measured(move,(board,i)=>empty(i)),hint,
  profile:measured(profile,lightProfile),points:measured(points,()=>[]),select:measured(select,fallbackSelect),evaluate:measured(evaluate,()=>0),positionValue:evaluate,
  probe:measured(probe,(board,p)=>({...lightProfile(board,p),checks:[],complete:false,ms:0})),
  setBudget(ms){workLimit=Math.max(0,ms);workMs=0;skipped=0;},remaining:()=>Math.max(0,workLimit-workMs),statistics:()=>({ms:workMs,limitMs:Number.isFinite(workLimit)?workLimit:null,skipped})};
}
if(typeof module!=='undefined')module.exports=createStrategyEngine;
