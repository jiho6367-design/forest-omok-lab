function createEngine(N, board) {
  if(![15,19].includes(N)||board.length!==N*N||board.some(v=>![0,1,2].includes(v)))throw Error('Invalid board');
  const b=Array.from(board),dirs=[[1,0],[0,1],[1,1],[1,-1]],M=10000000;
  const inside=(x,y)=>x>=0&&y>=0&&x<N&&y<N, at=(x,y)=>inside(x,y)?b[y*N+x]:3;
  const windows=[],affected=Array.from({length:N*N},()=>[]),cellAffected=Array.from({length:N*N},()=>[]),counts1=[],counts2=[],contributions=[];
  const threePatterns=Array.from({length:N*N},(_,i)=>dirs.map(([dx,dy])=>{
    const x=i%N,y=Math.floor(i/N),patterns=[];
    for(let start=-3;start<=0;start++){
      if(!inside(x+(start-1)*dx,y+(start-1)*dy)||!inside(x+(start+4)*dx,y+(start+4)*dy))continue;
      const atIndex=k=>(y+k*dy)*N+x+k*dx;
      patterns.push([atIndex(start-1),atIndex(start+4),...Array.from({length:4},(_,k)=>atIndex(start+k))]);
    }return patterns;
  }));
  let total=0,nodes=0,deadline=Infinity,phaseDeadline=Infinity,tt=new Map(),tacticalCache=new Map();
  for(let y=0;y<N;y++)for(let x=0;x<N;x++)for(let [dx,dy]of dirs){
    if(!inside(x+4*dx,y+4*dy))continue;
    const cells=Array.from({length:5},(_,k)=>(y+k*dy)*N+x+k*dx);
    const pre=inside(x-dx,y-dy)?(y-dy)*N+x-dx:-1,post=inside(x+5*dx,y+5*dy)?(y+5*dy)*N+x+5*dx:-1;
    const id=windows.length;windows.push({id,cells,pre,post});counts1.push(cells.filter(i=>b[i]===1).length);counts2.push(cells.filter(i=>b[i]===2).length);for(let i of cells)cellAffected[i].push(id);for(let i of [...cells,pre,post])if(i>=0)affected[i].push(id);
  }
  function value(w){const n1=counts1[w.id],n2=counts2[w.id];if(n1&&n2||!n1&&!n2)return 0;let p=n1?1:2,n=n1||n2;if(b[w.pre]===p||b[w.post]===p)return 0;let v=[0,2,25,420,24000,2000000][n];return p===1?v:-v;}
  windows.forEach((w,k)=>{contributions[k]=value(w);total+=contributions[k];});
  function set(i,p){const before=b[i];for(const id of cellAffected[i]){counts1[id]+=(p===1)-(before===1);counts2[id]+=(p===2)-(before===2);}b[i]=p;for(let id of affected[i]){const v=value(windows[id]);total+=v-contributions[id];contributions[id]=v;}}
  function tick(){nodes++;if(Date.now()>Math.min(deadline,phaseDeadline))throw Error('timeout');}
  function run(i,p,dx,dy){let x=i%N,y=Math.floor(i/N),len=1;for(let s of [-1,1]){let k=1;while(at(x+s*k*dx,y+s*k*dy)===p){len++;k++;}}return len;}
  function exact(i,p){return dirs.some(([dx,dy])=>run(i,p,dx,dy)===5);}
  // House-rule threes depend on geometric OPEN ends, not whether both future
  // endpoints would win by exact five. Stones beyond an empty endpoint do NOT
  // close it. Exact-five/overline restrictions belong only in winningMoves.
  function openThrees(i,p,explain=false){
    if(!explain){let count=0;for(const patterns of threePatterns[i]){for(const w of patterns){if(b[w[0]]||b[w[1]])continue;let own=0,empty=0;for(let k=2;k<6;k++){const v=b[w[k]];if(v===p)own++;else if(v===0)empty++;else break;}if(own===3&&empty===1){count++;break;}}if(count===2)return count;}return count;}
    let count=0,details=[],x=i%N,y=Math.floor(i/N);for(const [dx,dy]of dirs){let found=false;for(let off=-3;off<=3&&!found;off++){
    if(!off||at(x+off*dx,y+off*dy)!==0)continue;let j=(y+off*dy)*N+x+off*dx;b[j]=p;
    for(let start=-3;start<=0&&!found;start++){if(off<start||off>start+3)continue;let good=true;for(let k=start;k<start+4;k++)if(at(x+k*dx,y+k*dy)!==p)good=false;
      if(good&&at(x+(start-1)*dx,y+(start-1)*dy)===0&&at(x+(start+4)*dx,y+(start+4)*dy)===0){found=true;if(explain){const index=k=>(y+k*dy)*N+x+k*dx,four=Array.from({length:4},(_,k)=>index(start+k));details.push({direction:dx===0?'세로':dy===0?'가로':dy===1?'↘ 대각선':'↗ 대각선',stones:four.filter(v=>v!==j),extension:j,four,ends:[index(start-1),index(start+4)]});}}
    }b[j]=0;
  }if(found&&++count>=2&&!explain)return count;}return explain?details:count;}
  const threes=(i,p)=>openThrees(i,p,false);
  function moveInfo(i,p){if(!Number.isInteger(i)||i<0||i>=b.length||![1,2].includes(p))return {i,legal:false,reason:'invalid',threes:[]};if(b[i])return {i,legal:false,reason:'occupied',threes:[]};b[i]=p;let details;try{details=openThrees(i,p,true);}finally{b[i]=0;}return {i,legal:details.length<2,reason:details.length>=2?'double-three':'legal',threes:details};}
  function legal(i,p){if(!Number.isInteger(i)||i<0||i>=b.length||![1,2].includes(p)||b[i])return false;b[i]=p;let ok=threes(i,p)<2;b[i]=0;return ok;}
  function winMove(i,p){if(!legal(i,p))return false;b[i]=p;let yes=exact(i,p);b[i]=0;return yes;}
  function wins(p){const res=new Set(),own=p===1?counts1:counts2,enemy=p===1?counts2:counts1;for(let id=0;id<windows.length;id++){if(own[id]!==4||enemy[id])continue;const w=windows[id];if(b[w.pre]===p||b[w.post]===p)continue;const empty=w.cells.find(i=>!b[i]);if(legal(empty,p))res.add(empty);}return [...res];}
  function forcingCandidates(p){const res=new Set(),own=p===1?counts1:counts2,enemy=p===1?counts2:counts1;for(let id=0;id<windows.length;id++){if(own[id]<3||enemy[id])continue;const w=windows[id];if(b[w.pre]===p||b[w.post]===p)continue;for(const i of w.cells)if(!b[i])res.add(i);}return [...res].filter(i=>legal(i,p));}
  function candidates(){const s=new Set();for(let i=0;i<b.length;i++)if(b[i]){const x=i%N,y=Math.floor(i/N);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){let xx=x+dx,yy=y+dy;if(inside(xx,yy)&&!b[yy*N+xx])s.add(yy*N+xx);}}if(!s.size&&!b.some(Boolean))s.add(Math.floor(N/2)*(N+1));return [...s];}
  function local(i,p){b[i]=p;let sum=0;for(let id of affected[i]){let w=windows[id];if(b[w.pre]===p||b[w.post]===p)continue;let count=0,blocked=false;for(let j of w.cells){if(b[j]===p)count++;else if(b[j]){blocked=true;break;}}if(!blocked)sum+=[0,1,20,400,25000,2000000][count];}b[i]=0;return sum;}
  function rank(p,cs=candidates()){let center=(N-1)/2;return cs.filter(i=>legal(i,p)).map(i=>({i,s:local(i,p)+local(i,3-p)*1.1-.05*(Math.abs(i%N-center)+Math.abs(Math.floor(i/N)-center))})).sort((a,c)=>c.s-a.s);}
  function fork(p){for(let i of forcingCandidates(p)){tick();set(i,p);let ws,enemy,forbiddenBlock;try{ws=wins(p);enemy=wins(3-p);forbiddenBlock=ws.length===1&&!legal(ws[0],3-p);}finally{set(i,0);}if((ws.length>=2||forbiddenBlock)&&!enemy.length)return {i,ends:ws,forbiddenBlock};}return null;}
  // A forcing-four proof checks every relevant defense: a legal win, or the
  // unique block. Any other defense loses immediately to exact five.
  function vcf(p,remaining,seen=new Set()){
    tick();const own=wins(p);if(own.length)return [own[0]];if(remaining<3)return null;
    const danger=wins(3-p);if(danger.length>1)return null;
    let attacks=danger.length?[danger[0]].filter(i=>legal(i,p)):rank(p,forcingCandidates(p)).map(v=>v.i);
    const key=b.join('')+p;if(seen.has(key))return null;seen.add(key);
    try{for(let i of attacks){tick();set(i,p);try{
      if(wins(3-p).length)continue;const threats=wins(p);if(!threats.length)continue;
      if(threats.length>=2||!legal(threats[0],3-p))return [i];
      const block=threats[0];set(block,3-p);try{const rest=vcf(p,remaining-2,seen);if(rest)return [i,block,...rest];}finally{set(block,0);}
    }finally{set(i,0);}}return null;}finally{seen.delete(key);}
  }
  // A forced blocking reply can end our apparent attack and leave a lost
  // position. Prove this only after checking EVERY legal reply, without a beam.
  function forcedReplyTrap(p){
    tick();const threats=wins(p);if(threats.length!==1||!legal(threats[0],3-p))return null;
    const block=threats[0];set(block,3-p);
    try{if(wins(p).length)return null;const replies=rank(p,b.flatMap((v,i)=>v?[]:[i]));if(!replies.length)return null;let example=null;
      for(const r of replies){tick();set(r.i,p);let proof;try{if(exact(r.i,p))return null;proof=vcf(3-p,13);}finally{set(r.i,0);}if(!proof)return null;if(!example)example=[r.i,...proof];}
      return {line:[block,...example],checkedReplies:replies.length};
    }finally{set(block,0);}
  }
  // A quiet three is a proof only when EVERY legal defense is refuted.
  // Candidate pruning affects discovery, never the completeness of defenses.
  function threatWin(p){
    tick();if(wins(3-p).length)return null;
    const attacks=rank(p).slice(0,12);
    for(const {i} of attacks){tick();set(i,p);try{
      if(wins(3-p).length||!openThrees(i,p))continue;
      const defenses=rank(3-p,b.flatMap((v,j)=>v?[]:[j]));
      if(!defenses.length)continue;let example=null,proven=true;
      for(const {i:j} of defenses){tick();set(j,3-p);let proof;try{
        if(exact(j,3-p)){proven=false;break;}
        proof=vcf(p,13);
      }finally{set(j,0);}
      if(!proof){proven=false;break;}if(!example)example=[j,...proof];}
      if(proven)return [i,...example];
    }finally{set(i,0);}}
    return null;
  }
  function search(p,depth,alpha,beta,ply,extension=6){
    tick();const own=wins(p);if(own.length)return {score:M-ply,pv:[own[0]]};const danger=wins(3-p);
    if(danger.length>1||danger.length===1&&!legal(danger[0],p))return {score:-M+ply+1,pv:[]};
    // Do not replace a forcing win just beyond the horizon with a positional
    // score. A bounded proof probe is sound when found; a timeout proves nothing.
    if(depth<=1&&!danger.length){const tacticalKey=b.join('')+p;let proof=tacticalCache.get(tacticalKey);if(proof===undefined){const previous=phaseDeadline;try{phaseDeadline=Math.min(previous,deadline,Date.now()+5);proof=vcf(p,9);if(tacticalCache.size<30000)tacticalCache.set(tacticalKey,proof);}catch(e){if(e.message!=='timeout')throw e;proof=null;}finally{phaseDeadline=previous;}}if(proof)return {score:M-ply-proof.length,pv:proof};}
    if(depth<=0&&!danger.length)return {score:(p===1?total:-total),pv:[]};
    if(depth<=0&&extension<=0)return {score:(p===1?total:-total),pv:[]};
    const key=b.join('')+p,entry=tt.get(key),a0=alpha,b0=beta;
    if(entry&&entry.depth>=depth&&entry.extension>=extension){if(entry.bound==='exact')return {score:entry.score,pv:entry.pv};if(entry.bound==='lower')alpha=Math.max(alpha,entry.score);else beta=Math.min(beta,entry.score);if(alpha>=beta)return {score:entry.score,pv:entry.pv};}
    let moves;if(danger.length)moves=[{i:danger[0],s:M}];else{
      let all=rank(p),forcing=new Set(forcingCandidates(p));moves=all.filter((m,k)=>k<16||forcing.has(m.i));
      if(entry?.pv.length){let k=moves.findIndex(m=>m.i===entry.pv[0]);if(k>0)moves.unshift(...moves.splice(k,1));}
    }
    if(!moves.length)return {score:b.every(Boolean)?0:-M+ply,pv:[]};let best={score:-Infinity,pv:[]};
    for(let {i}of moves){set(i,p);let child;try{child=search(3-p,depth-1,-beta,-alpha,ply+1,depth<=0?extension-1:extension);}finally{set(i,0);}const score=-child.score;if(score>best.score)best={score,pv:[i,...child.pv]};alpha=Math.max(alpha,score);if(alpha>=beta)break;}
    if(tt.size>50000)tt.clear();tt.set(key,{...best,depth,extension,bound:best.score<=a0?'upper':best.score>=b0?'lower':'exact'});return best;
  }
  function state(){let winners=[],lines=[];for(let w of windows){let p=b[w.cells[0]];if(p&&w.cells.every(i=>b[i]===p)&&b[w.pre]!==p&&b[w.post]!==p){if(!winners.includes(p))winners.push(p);lines.push(w.cells);}}return {winners,lines,full:b.every(Boolean)};}
  function analyze(p,ms=5000,onProgress=()=>{}){
    const automatic=ms==='auto';if(automatic)ms=8000;
    if(![1,2].includes(p))throw Error('Invalid player');nodes=0;tt.clear();tacticalCache.clear();const start=Date.now();deadline=start+Math.max(30,ms);phaseDeadline=Infinity;
    const terminal=state();if(terminal.winners.length||terminal.full)return {kind:'terminal',...terminal,moves:[],depth:0,nodes,danger:[],automatic,autoReason:automatic?'대국 종료':null};
    const own=wins(p),danger=wins(3-p);
    const immediateThreats=danger.map(i=>{b[i]=3-p;try{return {i,lines:state().lines.filter(line=>line.includes(i))};}finally{b[i]=0;}});
    // A risk verdict is not a terminal game state. Keep a legal practical move
    // available even when every screened continuation loses or time runs out.
    const output=(kind,moves,depth=0,extra={})=>{
      let fallback=false;
      if(!moves.length&&['lost','incomplete'].includes(kind)){
        const rejected=new Map((extra.rejectedMoves||[]).map(r=>[r.i,r.reason]));
        const legalBlocks=danger.filter(i=>legal(i,p));
        const options=rank(p,legalBlocks.length?legalBlocks:b.flatMap((v,i)=>v?[]:[i])).map(r=>({...r,
          practical:r.s+(danger.includes(r.i)?M:0)-(rejected.get(r.i)==='immediate'?M:0)}));
        options.sort((a,c)=>c.practical-a.practical);
        moves=options.slice(0,3).map(r=>({i:r.i,score:kind==='lost'?-M:0,pv:[r.i],status:'fallback'}));
        fallback=!!moves.length;
      }
      return {kind,moves,depth,nodes,danger,immediateThreats,...extra,fallback,mandatoryDefense:!own.length&&danger.length===1&&legal(danger[0],p),automatic,autoReason:automatic?(extra.autoReason||(['win','forced'].includes(kind)?'승리 경로 확인':kind==='lost'?'강제 위협 확인':'복잡한 판 · 추가 비교 중')):null};
    };
    if(own.length)return output('win',own.map(i=>({i,score:M,pv:[i],status:'win'})),1);
    if(danger.length>1||danger.length===1&&!legal(danger[0],p))return output('lost',[],1,{lossReason:danger.length===1?'forbidden-defense':'immediate',forbiddenDefenses:danger.filter(i=>!legal(i,p)).map(i=>moveInfo(i,p))});
    if(automatic&&danger.length===1)return output('block',[{i:danger[0],score:0,pv:[danger[0]],status:'mandatory'}],1,{autoReason:'유일한 즉시 방어점 · 이후 판세 미검사'});
    if(automatic&&!b.some(Boolean)){const i=Math.floor(N/2)*(N+1);return output('search',[{i,score:0,pv:[i],status:'opening'}],0,{autoReason:'빈 판 · 중앙 시작 후보'});}
    // Screen every legal board point before heuristic pruning. Far-away moves
    // may be poor, but are still legal defenses and cannot be omitted in a loss claim.
    let roots=danger.length?[{i:danger[0],s:M}]:rank(p,b.some(Boolean)?b.flatMap((v,i)=>v?[]:[i]):candidates());
    if(!roots.length)return output('none',[]);
    onProgress(output('incomplete',[],0,{screeningComplete:false}));
    try{phaseDeadline=start+Math.min(ms*.22,2200);const proof=vcf(p,13);if(proof)return output('forced',[{i:proof[0],score:M-1,pv:proof,status:'proven'}],proof.length,{proof:'forcing-four'});}catch(e){if(e.message!=='timeout')throw e;}finally{phaseDeadline=Infinity;}
    const screeningDeadline=Math.min(deadline,start+(automatic?2200:Math.max(10,ms*.45)));
    const screened=[];let screeningComplete=true,forcingChecksComplete=true;
    for(let r of roots){if(Date.now()>screeningDeadline){screeningComplete=false;break;}phaseDeadline=screeningDeadline;let status='screened',refutation=[],lossReason=null;try{tick();set(r.i,p);try{const threats=wins(3-p);if(threats.length){status='loss';refutation=[threats[0]];lossReason='immediate';}else{const f=fork(3-p);if(f){status='loss';refutation=[f.i];lossReason=f.forbiddenBlock?'forbidden-defense':'fork';}
        else{try{phaseDeadline=Math.min(screeningDeadline,Date.now()+Math.max(20,Math.min(200,ms*.035)));const line=vcf(3-p,13);if(line){status='loss';refutation=line;lossReason='forcing-line';}
          else{phaseDeadline=Math.min(screeningDeadline,Date.now()+Math.max(60,Math.min(650,ms*.15)));const trap=forcedReplyTrap(p);if(trap){status='loss';refutation=trap.line;lossReason='forced-reply-trap';}
            else{phaseDeadline=Math.min(screeningDeadline,Date.now()+Math.max(50,Math.min(4000,ms*.15)));const quiet=threatWin(3-p);if(quiet){status='loss';refutation=quiet;lossReason='three-threat';}}}
        }catch(e){if(e.message!=='timeout')throw e;status='unverified';forcingChecksComplete=false;}finally{phaseDeadline=Infinity;}}
      }}finally{set(r.i,0);}}catch(e){if(e.message!=='timeout')throw e;screeningComplete=false;break;}
      screened.push({...r,score:status==='loss'?-M+3:r.s,pv:[r.i],status,refutation,lossReason});
    }
    phaseDeadline=Infinity;
    const rejectedMoves=screened.filter(r=>r.status==='loss').map(r=>({i:r.i,reason:r.lossReason,line:[r.i,...r.refutation]}));
    // Unexamined points remain candidates; a partial screen cannot prove loss.
    const checked=new Set(screened.map(r=>r.i));
    const pending=roots.filter(r=>!checked.has(r.i)).map(r=>({...r,score:r.s,pv:[r.i],status:'unverified'}));
    if(pending.length){screeningComplete=false;forcingChecksComplete=false;}
    let safe=[...screened.filter(r=>r.status!=='loss'),...pending];if(!safe.length){
      if(screeningComplete)return output('lost',[],3,{lossReason:'forcing-line',screened:screened.length,rejectedMoves});
      return output('incomplete',[],0,{screened:screened.length});
    }
    let best=safe.slice(0,3),depth=0;const rejected=screened.filter(r=>r.status==='loss').length;
    const kind=danger.length?'block':'search',extra={screeningComplete,forcingChecksComplete,screened:screened.length,rejected,rejectedMoves};
    onProgress(output(kind,best,depth,extra));
    const forceSet=new Set(forcingCandidates(p));let frontier=safe.filter((r,k)=>k<24||forceSet.has(r.i));
    const rounds=[];let stopReason='최대 탐색 깊이 도달';
    for(let d=1;d<=10;d++){
      const round=[];
      try{for(let r of frontier){tick();set(r.i,p);let child;try{child=search(3-p,d-1,-Infinity,Infinity,1);}finally{set(r.i,0);}const score=-child.score;round.push({...r,score,pv:[r.i,...child.pv]});}
        round.sort((a,c)=>c.score-a.score);best=round.slice(0,3);depth=d;frontier=round;
        onProgress(output(kind,best,depth,extra));
        rounds.push({i:best[0].i,score:best[0].score});
        if(automatic&&autoStable(rounds,depth,Date.now()-start,extra,best)){stopReason='연속 깊이에서 후보와 평가가 안정됨';break;}
      }catch(e){if(e.message!=='timeout')throw e;stopReason=(ms/1000)+'초 상한 도달 · 완료된 비교 결과';break;}
      if(Math.abs(best[0].score)>M-1000){stopReason='제한 탐색에서 승패 경로 발견';break;}
    }
    return output(kind,best,depth,{...extra,autoReason:automatic?stopReason:null});
  }
  return {legal,moveInfo,winMove,threes,analyze,state,board:b,winningMoves:wins,threatWin:(p,ms=1000)=>{deadline=Date.now()+ms;try{return threatWin(p);}catch(e){if(e.message==='timeout')return null;throw e;}finally{deadline=Infinity;}},forcingWin:(p,depth=13,ms=1000)=>{deadline=Date.now()+ms;try{return vcf(p,depth);}catch(e){if(e.message==='timeout')return null;throw e;}finally{deadline=Infinity;}}};
}
function autoStable(rounds,depth,elapsed,checks,moves){
  if(elapsed<1000||depth<4||rounds.length<3||!checks.screeningComplete||!checks.forcingChecksComplete||!moves.length||moves[0].status==='unverified')return false;
  const tail=rounds.slice(-3),scores=tail.map(r=>r.score);
  return tail.every(r=>r.i===tail[0].i)&&Math.max(...scores)-Math.min(...scores)<=120&&Math.abs(scores[0])<9000000&&(moves.length===1||moves[0].score-moves[1].score>=80);
}
if(typeof module!=='undefined')module.exports={createEngine,autoStable};
