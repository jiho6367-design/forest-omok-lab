/* Google 검색으로 확인한 연구: Allis et al., Go-Moku Solved by New Search Techniques
 https://aaai.org/papers/0001-fs93-02-001-go-moku-solved-by-new-search-techniques/
 위협 우선 탐색을 참고하되, 이 앱의 양측 33 금지/정확한 5목 규칙으로 별도 구현.
 제한 깊이 negamax 결과는 증명이 아니다. */
function createForestEngine(options={}){
 const N=15,D=[[1,0],[0,1],[1,1],[1,-1]],inside=(x,y)=>x>=0&&y>=0&&x<N&&y<N;
 const at=(b,x,y)=>inside(x,y)?b[y*N+x]:-1;
 function line(b,i,p,d){let x=i%N,y=i/N|0,a=[i];for(const s of [-1,1]){let k=1;while(at(b,x+d[0]*k*s,y+d[1]*k*s)===p){let j=(y+d[1]*k*s)*N+x+d[0]*k*s;s<0?a.unshift(j):a.push(j);k++;}}return a;}
 function win(b,i,p){if(b[i]!==p)return [];return D.flatMap(d=>{let a=line(b,i,p,d);return a.length===5?a:[];});}
 // 열린 3의 구조 정의: 새 돌을 포함하여 한 수로 열린 연속 4가 되는 축.
 // 추가 금수 예외를 가진 렌주 규칙을 임의로 적용하지 않는다.
 function shapes(b,i,p){let x=i%N,y=i/N|0,threes=[],fours=[],details=[];
  D.forEach((d,axis)=>{let t=[],f=[];for(let k=-4;k<=4;k++){if(!k)continue;let xx=x+d[0]*k,yy=y+d[1]*k;if(at(b,xx,yy)!==0)continue;let j=yy*N+xx;b[j]=p;let a=line(b,j,p,d);
   if(a.includes(i)){if(a.length===5)f.push(j);if(a.length===4){let l=a[0],r=a[a.length-1];if(at(b,l%N-d[0],(l/N|0)-d[1])===0&&at(b,r%N+d[0],(r/N|0)+d[1])===0)t.push(j);}}
   b[j]=0;}
   if(t.length)threes.push(axis);if(f.length)fours.push(axis);details.push({axis,three:t,four:f});
  });return {threes,fours,details};
 }
 function inspect(b,i,p){if(!Number.isInteger(i)||i<0||i>=225||b[i])return {legal:false,reason:'이미 돌이 있거나 판 밖입니다',threes:[],fours:[],details:[],win:[]};b[i]=p;let w=win(b,i,p),s=shapes(b,i,p);b[i]=0;return {...s,win:w,legal:(options.fivePriority!==false&&!!w.length)||s.threes.length<2,reason:s.threes.length>=2?'3×3 금지 착수입니다':'',fork43:s.fours.some(a=>s.threes.some(c=>c!==a))};}
 function candidates(b){let s=new Set();for(let i=0;i<225;i++)if(b[i]){let x=i%15,y=i/15|0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(inside(x+dx,y+dy)&&!b[(y+dy)*15+x+dx])s.add((y+dy)*15+x+dx);}return s.size?[...s]:b.every(v=>!v)?[112]:[];}
 function positional(b,i,p){let score=0,x=i%15,y=i/15|0;b[i]=p;for(let d of D){let a=line(b,i,p,d),l=a[0],r=a[a.length-1],open=(at(b,l%15-d[0],(l/15|0)-d[1])===0?1:0)+(at(b,r%15+d[0],(r/15|0)+d[1])===0?1:0);score+=(a.length>=6?0:[0,2,25,150,1500,100000][a.length])*open;}b[i]=0;return score+14-Math.abs(x-7)-Math.abs(y-7);}
 function value(s){return s.win.length?1e8:s.fours.length>=2?7e5:s.fork43?4e5:s.fours.length?5e4:s.threes.length?2500:0;}
 function ranked(b,p){return candidates(b).map(i=>{let a=inspect(b,i,p),o=inspect(b,i,3-p);return {i,a,o,score:value(a)+(o.legal?value(o)*1.1:0)+positional(b,i,p)+positional(b,i,3-p)*.9};}).filter(m=>m.a.legal).sort((a,b)=>b.score-a.score||a.i-b.i);}
 function winning(b,p){let r=[];for(let i of candidates(b)){b[i]=p;if(win(b,i,p).length&&(options.fivePriority!==false||shapes(b,i,p).threes.length<2))r.push(i);b[i]=0;}return r;}
 const coord=i=>String.fromCharCode(65+i%15)+(1+(i/15|0));
 function transformed(i,t){let x=i%15,y=i/15|0;if(t>=4)x=14-x;for(let k=0;k<t%4;k++)[x,y]=[14-y,x];return y*15+x;}
 function canonical(b,p){let best=null,tr=0;for(let t=0;t<8;t++){let a=Array(225).fill('0');for(let i=0;i<225;i++)a[transformed(i,t)]=b[i]?(b[i]===p?'1':'2'):'0';let s=a.join('');if(best===null||s<best){best=s;tr=t;}}return {key:best,t:tr};}
 function untransform(i,t){for(let j=0;j<225;j++)if(transformed(j,t)===i)return j;return -1;}
 // 연속 4 강제승 증명: 매 공격 뒤 상대의 즉시승리를 먼저 확인하고,
 // 유일 방어가 있으면 실제로 착수한다. 반격/금수/장목을 모두 같은 규칙으로 검사.
 // proof 없음은 안전의 증명이 아니다. 시간 초과는 unknown으로 구분한다.
 function forcing(board,p,maxPlies=11,budget=100,cache=new Map()){
  let b=board.slice(),end=Date.now()+budget,nodes=0,TIME={};
  function solve(left){if(Date.now()>=end)throw TIME;nodes++;let key=b.join('')+p+':'+left;if(cache.has(key))return cache.get(key);
   let wins=winning(b,p);if(wins.length)return {pv:[wins[0]],finish:'five'};
   if(left<3)return null;
   let enemy=winning(b,3-p);if(enemy.length>1)return null;
   let attacks=candidates(b).map(i=>({i,s:inspect(b,i,p)})).filter(m=>m.s.legal&&m.s.fours.length&&(!enemy.length||enemy.includes(m.i))).sort((a,c)=>value(c.s)-value(a.s));
   for(let {i}of attacks){if(Date.now()>=end)throw TIME;b[i]=p;try{
     // 방어자가 먼저 끝낼 수 있다면 이 공격은 강제승이 아니다.
     if(winning(b,3-p).length)continue;
     let threats=winning(b,p);if(threats.length>1){let block=threats.find(j=>inspect(b,j,3-p).legal);return {pv:block==null?[i,threats[0]]:[i,block,threats.find(j=>j!==block)],finish:'double',endpoints:threats};}
     if(threats.length===1){let j=threats[0];if(!inspect(b,j,3-p).legal)return {pv:[i,j],finish:'forbidden-block',endpoints:threats};b[j]=3-p;let r;try{r=solve(left-2);}finally{b[j]=0;}if(r){let result={...r,pv:[i,j,...r.pv]};cache.set(key,result);return result;}}
    }finally{b[i]=0;}}
   cache.set(key,null);return null;
  }
  try{let proof=solve(maxPlies);return {proof,complete:true,nodes};}catch(e){if(e!==TIME)throw e;return {proof:null,complete:false,nodes};}
 }
 // Search-independent exact-five guard, also usable before starting a Worker.
 function urgent(board,p){
  let b=board.slice(),start=Date.now(),own=winning(b,p),threats=winning(b,3-p);
  if(!own.length&&!threats.length)return null;
  let blocks=threats.filter(i=>inspect(b,i,p).legal),i=own[0]??blocks[0]??null;
  let lost=!own.length&&(threats.length>1||!blocks.length);
  return {i,reason:own.length?'정확한 5목으로 즉시 승리':lost?(threats.length===1&&!blocks.length?'방어 불가 · 유일 방어점 '+coord(threats[0])+'은 3×3 금수':'상대 5목 승리점 방어 불가 · 한 수로 모두 막을 수 없음'):'긴급 방어 · 상대 4목의 승리점을 즉시 차단',depth:0,nodes:0,ms:Date.now()-start,score:own.length?1e8:lost?-1e8:0,pv:i==null?[]:[i],proven:!!own.length,forcedLoss:lost,lossProven:lost,threats,memory:0,bad:[],shape:i==null?null:inspect(b,i,p),defenseChecked:!lost,urgent:true,engineVersion:'2.9-immediate'};
 }
 // After our forcing four, check the opponent's mandatory quiet block too.
 // A certificate requires a winning reply against EVERY legal continuation.
 function forcedReplyTrap(board,p,budget=200,setup=null,maxPlies=11,includeQuiet=false){
  let b=board.slice(),end=Date.now()+budget,threats=winning(b,p),branches=[],cache=new Map();
  if(setup==null&&(threats.length!==1||winning(b,3-p).length))return {complete:true,proof:null};
  let block=setup??threats[0];if(!inspect(b,block,3-p).legal)return {complete:true,proof:null};b[block]=3-p;
  const near=ranked(b,p).map(m=>m.i),seen=new Set(near),defenses=[...near,...Array.from({length:225},(_,i)=>i).filter(i=>!seen.has(i))];
  for(const i of defenses){if(Date.now()>=end)return {complete:false,proof:null};if(!inspect(b,i,p).legal)continue;
   b[i]=p;if(win(b,i,p).length){b[i]=0;return {complete:true,proof:null};}
   let r=forcing(b,3-p,maxPlies,Math.max(1,end-Date.now()),cache),quiet=null;
   if(r.complete&&!r.proof&&includeQuiet&&Date.now()<end){quiet=winning(b,p).length===1?forcedReplyTrap(b,p,end-Date.now(),null,maxPlies,false):quietTrap(b,p,end-Date.now(),10,maxPlies);}
   b[i]=0;
   if(!r.complete||quiet&&!quiet.complete)return {complete:false,proof:null};if(!r.proof&&!quiet?.proof)return {complete:true,proof:null};branches.push({i,proof:r.proof,quietProof:quiet?.proof});
  }
  branches.sort((a,c)=>a.i-c.i);return {complete:true,proof:branches.length?{block,branches}:null};
 }
 function quietTrap(board,p,budget=300,width=4,maxPlies=11,includeCounter=false){
  const end=Date.now()+budget,moves=ranked(board,3-p).filter(m=>m.a.threes.length&&!m.a.fours.length).slice(0,width);
  for(const m of moves){if(Date.now()>=end)return {complete:false,proof:null};const r=forcedReplyTrap(board,p,end-Date.now(),m.i,maxPlies,includeCounter);if(r.proof)return r;if(!r.complete)return r;}
  return {complete:true,proof:null};
 }
 function assessMove(board,p,i){
  const s=inspect(board,i,p);if(!s.legal||s.win.length)return {mustWarn:false};
  const r=urgent(board,p);
  return r&&!r.proven&&!r.lossProven&&r.i!==i?{mustWarn:true,required:r.i,reason:'상대가 다음 수에 정확한 5목을 완성합니다.'}:{mustWarn:false};
 }
 const limitsFor=budget=>budget>=24000?{forcing:25,quiet:14,screen:16,root:32,branch:18,depth:12}:budget>=12000?{forcing:19,quiet:10,screen:12,root:28,branch:16,depth:10}:budget>=7000?{forcing:15,quiet:6,screen:8,root:22,branch:12,depth:8}:{forcing:11,quiet:4,screen:4,root:16,branch:9,depth:6};
 const windows=[];
 for(let y=0;y<15;y++)for(let x=0;x<15;x++)for(let [dx,dy]of D){if(!inside(x+4*dx,y+4*dy))continue;windows.push({cells:Array.from({length:5},(_,k)=>(y+k*dy)*15+x+k*dx),before:inside(x-dx,y-dy)?(y-dy)*15+x-dx:-1,after:inside(x+5*dx,y+5*dy)?(y+5*dy)*15+x+5*dx:-1});}
 function evaluate(b,p){
  let score=0,weights=[0,2,18,160,3500,0];
  for(const w of windows){let mine=0,theirs=0;for(const i of w.cells){mine+=b[i]===p?1:0;theirs+=b[i]===3-p?1:0;}
   if(!theirs&&b[w.before]!==p&&b[w.after]!==p)score+=weights[mine];
   if(!mine&&b[w.before]!==3-p&&b[w.after]!==3-p)score-=weights[theirs];
  }return Math.max(-1e6,Math.min(1e6,score));
 }
 function suggestBudget(board,p,remaining=40000){
  const immediate=urgent(board,p);if(immediate)return {ms:100,reason:'즉시 승리·필수 방어'};
  const stones=board.filter(Boolean).length;
  const threats=ranked(board,3-p).filter(m=>m.a.fours.length||m.a.threes.length).length;
  const desired=threats>=4?25000:threats?15000:stones<8?3000:stones<20?7000:15000;
  return {ms:Math.max(100,Math.min(desired,remaining-3000)),reason:threats?'상대 위협 '+threats+'개 검사':stones<8?'초반 빠른 탐색':'중반 후보 탐색'};
 }
 // A replay-verified pattern defense, NOT a global win/nonloss certificate.
 // Only the exact seven-stone reference position (including D4 symmetries/color
 // swap) matches. Occupying F12 makes the recorded F12 invasion impossible.
 function patternDefense(board,p){
  if(board.filter(Boolean).length!==7)return null;
  const ref=Array(225).fill(0);['H8','G7','G10','I7','F9','H7','F7'].forEach((c,k)=>{ref[(+c.slice(1)-1)*15+c.charCodeAt(0)-65]=k%2?1:2;});
  const source=canonical(ref,1),current=canonical(board,p);if(source.key!==current.key)return null;
  const i=untransform(transformed(170,source.t),current.t);if(!inspect(board,i,p).legal)return null;
  return {i,reason:'패턴 방어 확인 · '+coord(i)+' 선점으로 기록된 침투 차단 (다른 공격·전체 무패는 미증명)',depth:0,nodes:0,ms:0,pv:[i],score:0,proven:false,lossProven:false,forcedLoss:false,threats:[],memory:0,bad:[],shape:inspect(board,i,p),patternVerified:true,verificationScope:'21수 기보의 F12 침투 패턴만 차단',engineVersion:'3.3-pattern-defense'};
 }
 function analyze(board,p,budget=1000,lessons=[]){
  let immediate=urgent(board,p);if(immediate)return immediate;
  const pattern=patternDefense(board,p);if(pattern)return pattern;
  let b=board.slice(),start=Date.now(),totalDeadline=start+budget,deadline=start+budget*(budget>=12000?.72:1),nodes=0,depth=0,tt=new Map(),proofCache=new Map(),TIME={},MATE=1e8,limits=limitsFor(budget);
  const check=()=>{nodes++;if(Date.now()>=deadline)throw TIME;};
  const timedProof=(q,ms)=>{let r=forcing(b,q,limits.forcing,Math.max(1,Math.min(ms,deadline-Date.now())),proofCache);nodes+=r.nodes;return r;};
  let roots=ranked(b,p),can=canonical(b,p),memory=lessons.filter(l=>l.key===can.key),bad=memory.map(l=>untransform(l.bad,can.t)),good=memory.map(l=>untransform(l.good,can.t));
  function finish(m,reason,extra={}){return {i:m?.i??null,reason,depth,score:m?.score||0,pv:m?[m.i]:[],ms:Date.now()-start,nodes,proven:false,forcedLoss:false,threats:[],memory:memory.length,bad,shape:m?.a,limits,engineVersion:'3.0-cached-search',...extra};}
  if(!roots.length)return finish(null,'합법적인 후보 없음');
  let w=roots.find(m=>m.a.win.length);if(w)return finish(w,'정확한 5목으로 즉시 승리',{proven:true,depth:1,score:MATE});
  let enemyWins=winning(b,3-p),blocking=roots.filter(m=>enemyWins.includes(m.i));
  if(enemyWins.length>1||(enemyWins.length===1&&!blocking.length))return finish(blocking[0]||roots[0],'상대 즉시 승리점 방어 불가 · 패배 확정',{forcedLoss:true,lossProven:true,threats:enemyWins,score:-MATE});
  if(enemyWins.length===1)roots=blocking;
  let ownProof=timedProof(p,Math.min(500,budget*.1));
  if(ownProof.proof){let proof=ownProof.proof,m=roots.find(m=>m.i===proof.pv[0]);if(m)return finish(m,'필승 수 발견 · 연속 4 강제 수순 확인',{proven:true,pv:proof.pv,depth:proof.pv.length,score:MATE,proof});}
  let danger=timedProof(3-p,Math.min(700,budget*.14)),enemy43=ranked(b,3-p).filter(m=>m.a.fork43).map(m=>m.i),dangerLine=danger.proof?.pv||[];
  // 위협 수순의 방어점은 정적 상위 14개 밖에 있어도 탐색 후보에서 보존한다.
  for(let m of roots)m.order=m.score+(m.a.fours.length?1600000:0)+(dangerLine.includes(m.i)?800000:0)+(good.includes(m.i)?1000:0)-(bad.includes(m.i)?12000:0);
  roots.sort((a,c)=>c.order-a.order);
  let screenEnd=Math.min(deadline,start+budget*.64),checked=[],unknown=[],screenSlice=Math.max(22,budget*.04);
  for(let m of roots){if(Date.now()>=screenEnd){unknown.push(m);continue;}b[m.i]=p;let r;try{r=timedProof(3-p,Math.min(screenSlice,screenEnd-Date.now()));if(!r.proof&&r.complete&&m.a.fours.length){let trap=forcedReplyTrap(b,p,Math.max(1,Math.min(budget*.3,screenEnd-Date.now())),null,limits.forcing,true);m.replyTrap=trap.proof;r.complete=trap.complete;}else if(!r.proof&&r.complete&&checked.length<limits.screen){let trap=quietTrap(b,p,Math.max(1,Math.min(budget*.12,screenEnd-Date.now())),limits.quiet,limits.forcing,true);m.replyTrap=trap.proof;m.quietChecked=trap.complete;r.complete=trap.complete;}}finally{b[m.i]=0;}m.lossProof=r.proof;m.screened=r.complete;checked.push(m);}
  // 전체 패배를 선언할 때만 주변 후보 밖의 합법적인 빈칸까지 확인한다.
  // 근처 후보만 모두 졌다고 전역 패배를 확정하면 안 된다.
  if(!enemyWins.length&&!unknown.length&&checked.every(m=>m.lossProof||m.replyTrap))for(let i=0;i<225;i++){
   if(b[i]||roots.some(m=>m.i===i))continue;let a=inspect(b,i,p);if(!a.legal)continue;let m={i,a,score:0,order:0};roots.push(m);
   if(Date.now()>=deadline){unknown.push(m);continue;}b[i]=p;let r;try{r=timedProof(3-p,screenSlice);}finally{b[i]=0;}m.lossProof=r.proof;m.screened=r.complete;checked.push(m);
  }
  let safe=checked.filter(m=>m.screened&&!m.lossProof&&!m.replyTrap),undecided=[...checked.filter(m=>!m.screened&&!m.lossProof&&!m.replyTrap),...unknown],losing=checked.filter(m=>m.lossProof||m.replyTrap);
  // 증명된 패배 수는 평가점수나 기억 보너스로 다시 추천하지 않는다.
  let options=safe.length?safe:undecided.length?undecided:losing;
  let lossProven=!safe.length&&!undecided.length&&losing.length===roots.length;
  options.sort((a,c)=>(c.score-(bad.includes(c.i)?12000:0))-(a.score-(bad.includes(a.i)?12000:0)));
  const staticEval=q=>evaluate(b,q),rankCache=new Map();
  const searchMoves=q=>{const key=b.join('')+q;let r=rankCache.get(key);if(!r){r=ranked(b,q);if(rankCache.size<10000)rankCache.set(key,r);}return r;};
  function search(q,d,alpha,beta,ply){check();let key=b.join('')+q+':'+d+':'+ply,save=tt.get(key),a0=alpha,b0=beta;if(save){if(save.bound==='exact')return save;if(save.bound==='lower')alpha=Math.max(alpha,save.score);else beta=Math.min(beta,save.score);if(alpha>=beta)return save;}
   let wins=winning(b,q);if(wins.length)return {score:MATE-ply,pv:[wins[0]]};let threats=winning(b,3-q);
   if(threats.length>1)return {score:-MATE+ply+1,pv:[]};
   let moves;if(threats.length){let i=threats[0];if(!inspect(b,i,q).legal)return {score:-MATE+ply+1,pv:[]};moves=[{i}];}else if(d<=0||ply>=limits.forcing)return {score:staticEval(q),pv:[]};else moves=searchMoves(q).slice(0,ply<2?limits.root:limits.branch);
   // 탐색 끝에서도 강제 방어를 연장한다. 일반 평가와 확정 승패는 구분한다.
   if(ply>=Math.max(19,limits.forcing))return {score:staticEval(q),pv:[]};if(!moves.length)return {score:0,pv:[]};
   let best={score:-Infinity,pv:[]};for(let m of moves){b[m.i]=q;let r;try{r=search(3-q,d-1,-beta,-alpha,ply+1);}finally{b[m.i]=0;}let score=-r.score;if(score>best.score)best={score,pv:[m.i,...r.pv]};alpha=Math.max(alpha,score);if(alpha>=beta)break;}
   tt.set(key,{...best,bound:best.score<=a0?'upper':best.score>=b0?'lower':'exact'});return best;
  }
  let best=options[0],pv=[best.i],score=best.score;
  if(!lossProven)for(let d=1;d<=limits.depth;d++){let round=null;try{for(let m of options.slice(0,limits.root)){check();b[m.i]=p;let r;try{r=search(3-p,d-1,-Infinity,round?-round.score+(bad.includes(m.i)?12000:0):Infinity,1);}finally{b[m.i]=0;}let v=-r.score-(bad.includes(m.i)&&Math.abs(r.score)<MATE/2?12000:0);if(!round||v>round.score)round={m,score:v,pv:[m.i,...r.pv]};}if(round){best=round.m;pv=round.pv;score=round.score;depth=d;options.sort((a,c)=>(c===best)-(a===best));}}catch(e){if(e!==TIME)throw e;break;}}
  // Reserve time for the actual chosen move; top-N screening alone can miss it.
  let finalGuard=null,avoidedTrap=false;
  if(!lossProven&&budget>=12000&&Date.now()<totalDeadline){b[best.i]=p;try{
    const direct=forcing(b,3-p,limits.forcing,Math.max(1,(totalDeadline-Date.now())*.5),proofCache);nodes+=direct.nodes;
    if(direct.proof||!direct.complete)finalGuard={complete:direct.complete,proof:null,directProof:direct.proof};
    else finalGuard=best.a.fours.length?forcedReplyTrap(b,p,Math.max(1,totalDeadline-Date.now()),null,limits.forcing,true):quietTrap(b,p,Math.max(1,totalDeadline-Date.now()),limits.quiet,limits.forcing,true);
   }finally{b[best.i]=0;}
   if(finalGuard.proof||finalGuard.directProof){best.replyTrap=finalGuard.proof;best.lossProof=finalGuard.directProof||best.lossProof;if(!losing.includes(best))losing.push(best);let alternative=options.find(m=>m!==best&&!m.lossProof&&!m.replyTrap);
    if(!alternative)return finish(null,'검사한 추천 후보에서 강제패배 발견 · 더 이른 국면 복기 필요',{rejected:losing.map(m=>({i:m.i,pv:m.lossProof?.pv||[],replyTrap:m.replyTrap})),finalGuard,limits});
    best=alternative;pv=[best.i];score=best.score;depth=0;best.screened=false;avoidedTrap=true;
   }
  }
  let reason=enemyWins.length?'상대의 다음 5목 차단':dangerLine.length?'4-3·연속 4 강제 공격 선제 방어':enemy43.length?'상대 4-3 위협 대응 후보':best.a.fork43?'4-3 동시 위협 생성':'공격과 수비를 함께 고려한 추천';
  if(lossProven)reason='모든 방어 후보에서 연속 4 강제 패배 확인';else if(!safe.length)reason='계산 완료 (제한 탐색) · 방어 증명은 아직 없음';
  if(avoidedTrap)reason=(finalGuard.directProof?'연속 4':'준비 수 뒤')+' 강제패배 후보 제외 · 대안은 추가 검증 필요';else if(finalGuard&&!finalGuard.complete){best.screened=false;reason+=' · 계산 종료, 최종 방어 증명 없음';}
  return finish(best,reason,{depth,pv,score:lossProven?-MATE:score,forcedLoss:lossProven,lossProven,threats:[...new Set([...enemyWins,...enemy43,...dangerLine.slice(0,1)])],dangerLine,rejected:losing.map(m=>({i:m.i,pv:m.lossProof?.pv||[],replyTrap:m.replyTrap})),defenseChecked:!!best.screened,safety:'연속 4 및 강제 방어 뒤 역공 제한 탐색 · 무패 보장 아님'});
 }
 function reviewMove(board,p,i,budget=1300,lessons=[]){
  let s=inspect(board,i,p);if(!s.legal)return {i:null,reason:'불법 착수',reviewLabel:'기보 규칙 오류'};
  let r=analyze(board,p,Math.floor(budget*.7),lessons),after=board.slice();after[i]=p;
  let loss=s.win.length?{proof:null,complete:true}:forcing(after,3-p,11,Math.floor(budget*.3));
  return {...r,actual:i,actualLossProof:loss.proof,reviewLabel:r.lossProven?'이미 강제 패배 상태 · 이 수만의 실수 아님':loss.proof?'이 착수 뒤 상대 연속 4 강제승 확인':r.i!==i?'대안 후보 비교 (추정)':'추천 수와 일치'};
 }
 return {N,D,win,inspect,shapes,candidates,analyze,urgent,assessMove,limitsFor,suggestBudget,evaluate,patternDefense,forcing,forcedReplyTrap,quietTrap,reviewMove,canonical,transformed,untransform,coord,winning};
}
if(typeof module!=='undefined')module.exports=createForestEngine;
