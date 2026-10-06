function createEngine(N, board, options={}) {
  const clockNow=typeof performance!=='undefined'?performance.now.bind(performance):Date.now.bind(Date);
  if(![15,19].includes(N)||board.length!==N*N||board.some(v=>![0,1,2].includes(v)))throw Error('Invalid board');
  const b=Array.from(board),dirs=[[1,0],[0,1],[1,1],[1,-1]],M=10000000;
  const neuralFactory=options.model?(typeof OmokNeural!=='undefined'?OmokNeural:typeof require==='function'?require('./neural-evaluator.js'):null):null;
  if(options.model&&!neuralFactory)throw Error('Learning evaluator is required for this model');
  const neural=options.model?neuralFactory.createEvaluator(options.model,N,options.firstPlayer):null;
  let neuralPosition=null;
  const memory=options.searchMemory||null,memScope=memory?OmokSearchMemory.scope('reader',N,{...options,modelVersion:neural?.modelId||options.modelVersion}):'';
  const inside=(x,y)=>x>=0&&y>=0&&x<N&&y<N, at=(x,y)=>inside(x,y)?b[y*N+x]:3;
  const strategyFactory=typeof createStrategyEngine==='function'?createStrategyEngine:typeof require==='function'?require('./strategy-engine.js'):null;
  const forestFactory=typeof createForestEngine==='function'?createForestEngine:typeof require==='function'?require('./forest-engine.js'):null;
  const ruleAdapter=options.strategy!==false&&N===15&&strategyFactory&&forestFactory?forestFactory({strategy:false,patternTable:options.patternTable}):null;
  const strategy=ruleAdapter?strategyFactory(N,{inspect:ruleAdapter.inspect,legal:(board,i,p)=>ruleAdapter.inspect(board,i,p).legal,winning:ruleAdapter.winning},options):null;

 const patternIndices=options.patternTable?Array.from({length:N*N},(_,i)=>dirs.map(([dx,dy])=>Array.from({length:11},(_,k)=>{const x=i%N+(k-5)*dx,y=(i/N|0)+(k-5)*dy;return x>=0&&y>=0&&x<N&&y<N?y*N+x:-1;}))):null;
 function patternCode(board,indices,p){let code=0,mul=1;for(let k=0;k<11;k++)if(k!==5){const j=indices[k],v=j<0?2:board[j]===p?1:board[j]===0?0:2;code+=v*mul;mul*=3;}return code;}

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
  for(let y=0;y<N;y++)for(let x=0;x<N;x++)for(let [axis,[dx,dy]]of dirs.entries()){
    if(!inside(x+4*dx,y+4*dy))continue;
    const cells=Array.from({length:5},(_,k)=>(y+k*dy)*N+x+k*dx);
    const pre=inside(x-dx,y-dy)?(y-dy)*N+x-dx:-1,post=inside(x+5*dx,y+5*dy)?(y+5*dy)*N+x+5*dx:-1;
    const id=windows.length;windows.push({id,cells,pre,post,axis});counts1.push(cells.filter(i=>b[i]===1).length);counts2.push(cells.filter(i=>b[i]===2).length);for(let i of cells)cellAffected[i].push(id);for(let i of [...cells,pre,post])if(i>=0)affected[i].push(id);
  }
  const fourWindows=[null,new Set(),new Set()],forcingWindows=[null,new Set(),new Set()];
  function indexWindow(id,old1=-1,old2=-1){const a=counts1[id],c=counts2[id];if((a===4&&!c)!==(old1===4&&!old2)){if(a===4&&!c)fourWindows[1].add(id);else fourWindows[1].delete(id);}if((c===4&&!a)!==(old2===4&&!old1)){if(c===4&&!a)fourWindows[2].add(id);else fourWindows[2].delete(id);}if((a>=3&&!c)!==(old1>=3&&!old2)){if(a>=3&&!c)forcingWindows[1].add(id);else forcingWindows[1].delete(id);}if((c>=3&&!a)!==(old2>=3&&!old1)){if(c>=3&&!a)forcingWindows[2].add(id);else forcingWindows[2].delete(id);}}
  windows.forEach(w=>indexWindow(w.id));
  function value(w){const n1=counts1[w.id],n2=counts2[w.id];if(n1&&n2||!n1&&!n2)return 0;let p=n1?1:2,n=n1||n2;if(b[w.pre]===p||b[w.post]===p)return 0;let v=[0,2,25,420,24000,2000000][n];return p===1?v:-v;}
  windows.forEach((w,k)=>{contributions[k]=value(w);total+=contributions[k];});
  function set(i,p){const before=b[i];for(const id of cellAffected[i]){const old1=counts1[id],old2=counts2[id];counts1[id]+=(p===1)-(before===1);counts2[id]+=(p===2)-(before===2);indexWindow(id,old1,old2);}b[i]=p;neuralPosition?.set(i,p);for(let id of affected[i]){const v=value(windows[id]);total+=v-contributions[id];contributions[id]=v;}}
  function tick(){nodes++;if(clockNow()>Math.min(deadline,phaseDeadline))throw Error('timeout');}
  function run(i,p,dx,dy){let x=i%N,y=Math.floor(i/N),len=1;for(let s of [-1,1]){let k=1;while(at(x+s*k*dx,y+s*k*dy)===p){len++;k++;}}return len;}
  function exact(i,p){return dirs.some(([dx,dy])=>run(i,p,dx,dy)===5);}
  // House-rule threes depend on geometric OPEN ends, not whether both future
  // endpoints would win by exact five. Stones beyond an empty endpoint do NOT
  // close it. Exact-five/overline restrictions belong only in winningMoves.
  function openThrees(i,p,explain=false){
    if(!explain&&patternIndices){let count=0;for(const indices of patternIndices[i])if(options.patternTable[patternCode(b,indices,p)]&511){if(++count===2)break;}return count;}
    if(!explain){let count=0;for(const patterns of threePatterns[i]){for(const w of patterns){if(b[w[0]]||b[w[1]])continue;let own=0,empty=0;for(let k=2;k<6;k++){const v=b[w[k]];if(v===p)own++;else if(v===0)empty++;else break;}if(own===3&&empty===1){count++;break;}}if(count===2)return count;}return count;}
    let count=0,details=[],x=i%N,y=Math.floor(i/N);for(const [dx,dy]of dirs){let found=false;for(let off=-3;off<=3&&!found;off++){
    if(!off||at(x+off*dx,y+off*dy)!==0)continue;let j=(y+off*dy)*N+x+off*dx;b[j]=p;
    for(let start=-3;start<=0&&!found;start++){if(off<start||off>start+3)continue;let good=true;for(let k=start;k<start+4;k++)if(at(x+k*dx,y+k*dy)!==p)good=false;
      if(good&&at(x+(start-1)*dx,y+(start-1)*dy)===0&&at(x+(start+4)*dx,y+(start+4)*dy)===0){found=true;if(explain){const index=k=>(y+k*dy)*N+x+k*dx,four=Array.from({length:4},(_,k)=>index(start+k));details.push({direction:dx===0?'세로':dy===0?'가로':dy===1?'↘ 대각선':'↗ 대각선',stones:four.filter(v=>v!==j),extension:j,four,ends:[index(start-1),index(start+4)]});}}
    }b[j]=0;
  }if(found&&++count>=2&&!explain)return count;}return explain?details:count;}
  const threes=(i,p)=>openThrees(i,p,false);
  function moveInfo(i,p){if(!Number.isInteger(i)||i<0||i>=b.length||![1,2].includes(p))return {i,legal:false,reason:'invalid',threes:[]};if(b[i])return {i,legal:false,reason:'occupied',threes:[]};b[i]=p;let details,priority;try{priority=exact(i,p);details=openThrees(i,p,true);}finally{b[i]=0;}const ok=priority||details.length<2;return {i,legal:ok,reason:ok?'legal':'double-three',threes:details};}
  function legal(i,p){if(!Number.isInteger(i)||i<0||i>=b.length||![1,2].includes(p)||b[i])return false;b[i]=p;let ok=(exact(i,p))||threes(i,p)<2;b[i]=0;return ok;}
  function winMove(i,p){if(!legal(i,p))return false;b[i]=p;let yes=exact(i,p);b[i]=0;return yes;}
  function wins(p){const res=new Set(),own=p===1?counts1:counts2,enemy=p===1?counts2:counts1;for(const id of [...fourWindows[p]].sort((a,c)=>a-c)){const w=windows[id];if(b[w.pre]===p||b[w.post]===p)continue;const empty=w.cells.find(i=>!b[i]);if(legal(empty,p))res.add(empty);}return [...res];}
  function forcingCandidates(p){const res=new Set(),own=p===1?counts1:counts2,enemy=p===1?counts2:counts1;for(const id of [...forcingWindows[p]].sort((a,c)=>a-c)){const w=windows[id];if(b[w.pre]===p||b[w.post]===p)continue;for(const i of w.cells)if(!b[i])res.add(i);}return [...res].filter(i=>legal(i,p));}
  function candidates(){const s=new Set();for(let i=0;i<b.length;i++)if(b[i]){const x=i%N,y=Math.floor(i/N);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){let xx=x+dx,yy=y+dy;if(inside(xx,yy)&&!b[yy*N+xx])s.add(yy*N+xx);}}if(strategy)for(const i of strategy.searchPoints(b,1))s.add(i);if(!s.size&&!b.some(Boolean))s.add(Math.floor(N/2)*(N+1));return [...s];}
  const localWindows=options.optimized?affected.map((ids,i)=>ids.map(id=>({w:windows[id],increment:cellAffected[i].includes(id)?1:0}))):null;
  function localFast(i,p){let sum=0;for(const {w,increment} of localWindows[i]){if(w.pre===i||w.post===i||b[w.pre]===p||b[w.post]===p)continue;const enemy=p===1?counts2[w.id]:counts1[w.id];if(!enemy)sum+=[0,1,20,400,25000,2000000][(p===1?counts1[w.id]:counts2[w.id])+increment];}return sum;}
  function local(i,p){if(options.optimized)return localFast(i,p);b[i]=p;let sum=0;for(let id of affected[i]){let w=windows[id];if(b[w.pre]===p||b[w.post]===p)continue;let count=0,blocked=false;for(let j of w.cells){if(b[j]===p)count++;else if(b[j]){blocked=true;break;}}if(!blocked)sum+=[0,1,20,400,25000,2000000][count];}b[i]=0;return sum;}
  function strategicLocal(i,p,feature){if(!feature?.invalidThreeAxes?.length)return local(i,p);b[i]=p;let sum=0;try{for(const id of affected[i]){const w=windows[id];if(b[w.pre]===p||b[w.post]===p)continue;let count=0,blocked=false;for(const j of w.cells){if(b[j]===p)count++;else if(b[j]){blocked=true;break;}}if(!blocked&&!(count===3&&feature.invalidThreeAxes.includes(w.axis)))sum+=[0,1,20,400,25000,2000000][count];}}finally{b[i]=0;}return sum;}
  function rank(p,cs=candidates(),rich=false){let center=(N-1)/2;return cs.filter(i=>legal(i,p)).map(i=>{const feature=rich?strategy?.move(b,i,p):null;return {i,s:strategicLocal(i,p,feature)+(rich&&strategy&&!legal(i,3-p)?0:local(i,3-p)*1.1)-.05*(Math.abs(i%N-center)+Math.abs(Math.floor(i/N)-center))+(feature?.score||0),...(feature?{strategy:feature}:{})};}).sort((a,c)=>c.s-a.s);}
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

  const counterMemo=memory?memory.cache(memScope+'|counter'):new Map();
  // Wider preparation probes admit a voluntary four followed by a quiet
  // attack. Narrow one-setup loss checks retain their cheaper discovery path.
  // This affects OR discovery; both modes prove every required defense.
  function counterSolve(p,left,quietLeft,optionalFours=false){
    tick();const key=b.join('')+'|'+p+'|'+left+'|'+quietLeft+'|'+(optionalFours?1:0),known=counterMemo.get(key);if(known!==undefined)return known;
    const own=wins(p);if(own.length)return {pv:[own[0]],type:'vcf'};if(left<1)return null;
    const danger=wins(3-p);if(danger.length>1||danger.length===1&&!legal(danger[0],p))return null;
    const direct=vcf(p,Math.min(7,left));if(direct){const proof={pv:direct,type:'vcf'};counterMemo.set(key,proof);return proof;}
    if(left<3)return null;
    const attacks=danger.length?[danger[0]]:quietLeft>0?rank(p).map(m=>m.i):[];
    for(const i of attacks){tick();set(i,p);try{
      if(exact(i,p))return {pv:[i],type:'vcf'};if(wins(3-p).length)continue;
      const ends=wins(p);if(!danger.length&&ends.length&&(!optionalFours||quietLeft<=0))continue;const forced=ends.length===1,remainingQuiet=quietLeft-(danger.length||forced?0:1);
      if(!danger.length&&!forced&&!cellAffected[i].some(id=>{const w=windows[id];return (p===1?counts1[id]:counts2[id])>=3&&!(p===1?counts2[id]:counts1[id])&&b[w.pre]!==p&&b[w.post]!==p;}))continue;
      if(ends.length>=2)return {pv:[i],type:'vcf'};
      const replies=forced?[ends[0]]:rank(3-p,b.flatMap((v,j)=>v?[]:[j])).map(m=>m.i),branches=[];let all=true;
      for(const j of replies){tick();if(!legal(j,3-p)){if(forced)return {pv:[i],type:'vcf'};continue;}set(j,3-p);let child;try{if(exact(j,3-p)){all=false;break;}child=counterSolve(p,left-2,remainingQuiet,optionalFours);}finally{set(j,0);}if(!child){all=false;break;}branches.push({i:j,proof:child});}
      if(all&&branches.length){const proof={type:'move',i,forced,checkedReplies:branches.length,...(options.counterProofDetails?{branches}:{}),pv:[i,branches[0].i,...branches[0].proof.pv]};counterMemo.set(key,proof);return proof;}
    }finally{set(i,0);}}
    counterMemo.set(key,null);return null;
  }
  function counterCertificate(p,ms=1000,left=19,quiet=1){const savedDeadline=deadline,savedPhase=phaseDeadline;deadline=Math.min(savedDeadline,clockNow()+Math.max(0,ms));phaseDeadline=Math.min(savedPhase,deadline);const start=clockNow();try{let direct=null;if(left>7){const phase=phaseDeadline;try{phaseDeadline=Math.min(deadline,clockNow()+Math.min(120,Math.max(0,ms*.12)));direct=vcf(p,left);}catch(error){if(error.message!=='timeout')throw error;}finally{phaseDeadline=phase;}}return {proof:direct?{type:'vcf',pv:direct,bound:left,quietNeeded:0}:counterSolve(p,left,quiet,quiet>=2),complete:true,ms:clockNow()-start,nodes,memo:counterMemo.size};}catch(e){if(e.message!=='timeout')throw e;return {proof:null,complete:false,ms:clockNow()-start,nodes,memo:counterMemo.size};}finally{deadline=savedDeadline;phaseDeadline=savedPhase;}}


  function counterLoss(p,ms=1000,left=19,quiet=1){const savedDeadline=deadline,savedPhase=phaseDeadline;deadline=Math.min(savedDeadline,clockNow()+Math.max(0,ms));phaseDeadline=Math.min(savedPhase,deadline);const start=clockNow(),branches=[];try{if(wins(p).length)return {lossProven:false,complete:true,ownImmediateWin:true};const danger=wins(3-p),ordered=rank(p,b.flatMap((v,i)=>v?[]:[i]));const critical=new Set(forcingCandidates(3-p));ordered.sort((a,c)=>(critical.has(c.i)?1:0)-(critical.has(a.i)?1:0));for(const {i}of ordered){tick();set(i,p);let proof;try{if(exact(i,p))return {lossProven:false,complete:true,ownImmediateWin:true};proof=counterSolve(3-p,left,quiet,quiet>=2);}finally{set(i,0);}if(!proof)return {lossProven:false,complete:true,unrefuted:i,branches,ms:clockNow()-start,memo:counterMemo.size};branches.push({i,proof});}return {lossProven:branches.length>0,complete:true,branches,ms:clockNow()-start,memo:counterMemo.size,nodes};}catch(e){if(e.message!=='timeout')throw e;return {lossProven:false,complete:false,branches,ms:clockNow()-start,memo:counterMemo.size,nodes};}finally{deadline=savedDeadline;phaseDeadline=savedPhase;}}

  // Expose a representative legal line for each completed AND root while
  // keeping the complete proof coverage and historical diagnostic categories.
  function counterRejections(p,check){
    if(!Array.isArray(check?.branches))return [];
    return check.branches.map(root=>{let reason='forcing-line';set(root.i,p);try{
      const proof=root.proof;if(proof.type!=='vcf'){
        const own=wins(p);
        if(own.length===1&&proof.i===own[0])reason='forced-reply-trap';
        else{set(proof.i,3-p);try{reason=openThrees(proof.i,3-p)?'three-threat':'counter-threat';}finally{set(proof.i,0);}}
      }
    }finally{set(root.i,0);}return {i:root.i,reason,line:[root.i,...root.proof.pv],verifiedRefutation:true,counterProof:{complete:true,forcing:19,quiet:1}};});
  }

  function counterMove(i,p,ms=1000,left=19,quiet=2){if(!legal(i,p)||winMove(i,p))return {proof:null,complete:true,ownWin:winMove(i,p)};set(i,p);try{return counterCertificate(3-p,ms,left,quiet);}finally{set(i,0);}}

  function search(p,depth,alpha,beta,ply,extension=6,quietExtension=1){
    tick();const own=wins(p);if(own.length)return {score:M-ply,pv:[own[0]]};const danger=wins(3-p);
    if(danger.length>1||danger.length===1&&!legal(danger[0],p))return {score:-M+ply+1,pv:[]};
    // Do not replace a forcing win just beyond the horizon with a positional
    // score. A bounded proof probe is sound when found; a timeout proves nothing.
    if(depth<=1&&!danger.length){const tacticalKey=b.join('')+p;let proof=tacticalCache.get(tacticalKey);if(proof===undefined&&memory)proof=memory.get(memScope+'|vcf9',tacticalKey);if(proof===undefined){const previous=phaseDeadline;try{phaseDeadline=options.fixedWork?Infinity:Math.min(previous,deadline,clockNow()+5);proof=vcf(p,9);if(tacticalCache.size<30000)tacticalCache.set(tacticalKey,proof);memory?.put(memScope+'|vcf9',tacticalKey,proof,proof?12:1);}catch(e){if(e.message!=='timeout')throw e;proof=null;}finally{phaseDeadline=previous;}}if(proof)return {score:M-ply-proof.length,pv:proof};}
    const staticScore=()=> {if(neural&&!neuralPosition)neuralPosition=neural.accumulator(b);return (p===1?total:-total)+(neuralPosition?.score(p)||0);};
    let quietMoves=null;
    // Quiet extensions are branch-local. A global work cap used to change
    // the value of the same leaf after earlier candidates consumed it.
    if(depth<=0&&!danger.length&&strategy&&quietExtension>0&&ply<=4){
      // Quiet leaves read actual threats. Weak pair preparation remains in
      // ordinary search; extending it here can consume the next full round.
      // Window hints nominate fours/cuts, while geometric threes include
      // shapes omitted by exact-five windows. Full descriptors decide below.
      const potential=m=>{if(m.strategy.attack>=120||m.strategy.cut>=120)return true;b[m.i]=p;try{return openThrees(m.i,p)>0;}finally{b[m.i]=0;}};
      const all=rank(p),prepared=strategy.searchSelect(b,p,all,4,4,new Set(),'unknown',potential).map(m=>({...m,strategy:strategy.searchMove(b,m.i,p)}));
      const attack=m=>m.strategy.legalExtensions.length&&(m.strategy.forcing||m.strategy.usableThreeAxes.length||m.strategy.axes.length>1),
        cut=m=>m.strategy.cut>=120;
      const eligible=prepared.filter(m=>m.strategy.legal&&(attack(m)||cut(m))),chosen=[];
      // Keep one attack and one cut representative within a small, fixed
      // branch width. A dual-purpose move may satisfy both categories.
      for(const [accept,field] of [[attack,'attack'],[cut,'cut']]){
        const m=eligible.filter(accept).sort((a,c)=>c.strategy[field]-a.strategy[field]||c.s-a.s||a.i-c.i)[0];
        if(m&&!chosen.some(x=>x.i===m.i))chosen.push(m);
      }
      for(const m of eligible)if(chosen.length<2&&!chosen.some(x=>x.i===m.i))chosen.push(m);
      quietMoves=chosen;tick();
    }
    if(depth<=0&&!danger.length&&!quietMoves?.length)return {score:staticScore(),pv:[]};
    if(depth<=0&&extension<=0)return {score:staticScore(),pv:[]};
    const key=b.join('')+p,entry=tt.get(key),a0=alpha,b0=beta;
    // The quiet extension model depends on distance from the root. Reuse an
    // exact matching subproblem; normalize mate distance when the root moves.
    const memoryKey=memory?key+'|'+depth+'|'+extension+'|'+quietExtension+'|'+Math.max(0,4-ply):'';
    const saved=memory?.get(memScope+'|search',memoryKey);
    if(saved){const score=OmokSearchMemory.fromStored(saved.score,ply,M);
      if(saved.bound==='exact')return {score,pv:saved.pv};
      if(saved.bound==='lower')alpha=Math.max(alpha,score);else beta=Math.min(beta,score);
      if(alpha>=beta)return {score,pv:saved.pv};}
    if(entry&&entry.depth>=depth&&entry.extension>=extension&&entry.quietExtension>=quietExtension){if(entry.bound==='exact')return {score:entry.score,pv:entry.pv};if(entry.bound==='lower')alpha=Math.max(alpha,entry.score);else beta=Math.min(beta,entry.score);if(alpha>=beta)return {score:entry.score,pv:entry.pv};}
    let moves;if(danger.length)moves=[{i:danger[0],s:M}];else{
      if(quietMoves?.length)moves=quietMoves;
      else{const all=rank(p),forcing=new Set(forcingCandidates(p));moves=strategy?strategy.searchSelect(b,p,all,16,4,forcing,'unknown'):all.filter((m,k)=>k<16||forcing.has(m.i));tick();}
      if(entry?.pv.length){let k=moves.findIndex(m=>m.i===entry.pv[0]);if(k>0)moves.unshift(...moves.splice(k,1));}
    }
    if(!moves.length)return {score:b.every(Boolean)?0:-M+ply,pv:[]};let best={score:-Infinity,pv:[]};
    for(let {i}of moves){set(i,p);let child;try{child=search(3-p,depth-1,-beta,-alpha,ply+1,depth<=0?extension-1:extension,quietMoves?.length?quietExtension-1:quietExtension);}finally{set(i,0);}const score=-child.score;if(score>best.score)best={score,pv:[i,...child.pv]};alpha=Math.max(alpha,score);if(alpha>=beta)break;}
    const bound=best.score<=a0?'upper':best.score>=b0?'lower':'exact';
    if(tt.size>50000)tt.clear();tt.set(key,{...best,depth,extension,quietExtension,bound});
    memory?.put(memScope+'|search',memoryKey,{score:OmokSearchMemory.toStored(best.score,ply,M),pv:best.pv,bound},Math.max(0,depth)*2+(bound==='exact'?4:0));return best;
  }
  function state(){let winners=[],lines=[];for(let w of windows){let p=b[w.cells[0]];if(p&&w.cells.every(i=>b[i]===p)&&b[w.pre]!==p&&b[w.post]!==p){if(!winners.includes(p))winners.push(p);lines.push(w.cells);}}return {winners,lines,full:b.every(Boolean)};}
  function analyzeInternal(p,ms=5000,onProgress=()=>{}){
    const automatic=ms==='auto'||(typeof ms==='object'&&ms.automatic===true);if(automatic)ms=typeof ms==='object'?Math.max(30,Math.min(8000,Number(ms.maxMs)||8000)):8000;
    if(![1,2].includes(p))throw Error('Invalid player');nodes=0;tt.clear();tacticalCache.clear();if(!memory)counterMemo.clear();if(memory&&!options.memoryManaged)memory.begin();const start=clockNow();deadline=start+Math.max(30,ms);phaseDeadline=Infinity;
    strategy?.setBudget(Math.min(ms*.12,ms<=1000?100:ms>15000?2500:1000));
    const terminal=state();if(terminal.winners.length||terminal.full)return {kind:'terminal',...terminal,moves:[],depth:0,nodes,danger:[],automatic,autoReason:automatic?'대국 종료':null};
    const own=wins(p),danger=wins(3-p);
    let strategicSummary=null;
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
      const summary=strategy?(strategicSummary||(strategicSummary=(own.length||danger.length)?{initiative:own.length?'own':'opponent',firstPlayer:strategy.context.firstPlayer,strategyVersion:strategy.strategyVersion,evidence:{ownWins:own,enemyWins:danger,replyCoverage:'not-checked'}}:strategy.profile(b,p))):null;
      const selectedCheck=summary?.checks?.find(c=>c.i===moves[0]?.i&&c.complete),bounded=summary?.evidence?.replyCoverage==='bounded';
      const initiative=['win','forced'].includes(kind)?'own':bounded?(selectedCheck?.replies>0&&selectedCheck.continues===selectedCheck.replies?(selectedCheck.forcingReplies?'contested':'own'):selectedCheck?.forcingReplies&&selectedCheck.score<0?'opponent':'unknown'):summary?.initiative;
      return {kind,moves,depth,nodes,danger,immediateThreats,...extra,...(summary?{strategy:{...summary,work:strategy.statistics(),initiative,selectedCheck:selectedCheck||null}}:{}),fallback,mandatoryDefense:!own.length&&danger.length===1&&legal(danger[0],p),automatic,autoReason:automatic?(extra.autoReason||(['win','forced'].includes(kind)?'승리 경로 확인':kind==='lost'?'강제 위협 확인':'복잡한 판 · 추가 비교 중')):null};
    };
    if(own.length)return output('win',own.map(i=>({i,score:M,pv:[i],status:'win'})),1);
    if(danger.length>1||danger.length===1&&!legal(danger[0],p))return output('lost',[],1,{lossReason:danger.length===1?'forbidden-defense':'immediate',forbiddenDefenses:danger.filter(i=>!legal(i,p)).map(i=>moveInfo(i,p))});
    if(automatic&&danger.length===1)return output('block',[{i:danger[0],score:0,pv:[danger[0]],status:'mandatory'}],1,{autoReason:'유일한 즉시 방어점 · 이후 판세 미검사'});
    if(automatic&&!b.some(Boolean)){const i=Math.floor(N/2)*(N+1);return output('search',[{i,score:0,pv:[i],status:'opening'}],0,{autoReason:'빈 판 · 중앙 시작 후보'});}
    // Screen every legal board point before heuristic pruning. Far-away moves
    // may be poor, but are still legal defenses and cannot be omitted in a loss claim.
    let roots=danger.length?[{i:danger[0],s:M}]:rank(p,b.some(Boolean)?b.flatMap((v,i)=>v?[]:[i]):candidates(),true);
    if(!roots.length)return output('none',[]);
    onProgress(output('incomplete',[],0,{screeningComplete:false}));
    try{phaseDeadline=start+Math.min(ms*.22,2200);const proof=vcf(p,13);if(proof)return output('forced',[{i:proof[0],score:M-1,pv:proof,status:'proven'}],proof.length,{proof:'forcing-four'});}catch(e){if(e.message!=='timeout')throw e;}finally{phaseDeadline=Infinity;}
    // Counter fours can delay a quiet win without escaping it. This separate
    // proof checks every legal root and every quiet-setup defense. Its bounded
    // discovery failures remain unknown; it never labels a move safe.
    let counterCheck=null;
    if(ms>=3000&&clockNow()<deadline-1000){
      const savedPhase=phaseDeadline;
      let virtual=null;try{phaseDeadline=Math.min(deadline,clockNow()+80);virtual=vcf(3-p,13);}catch(err){if(err.message!=='timeout')throw err;}finally{phaseDeadline=savedPhase;}
      if(virtual){
        counterCheck=counterLoss(p,Math.min(6500,ms*.82,deadline-clockNow()-600),19,1);
        if(counterCheck.lossProven){const rejectedMoves=counterRejections(p,counterCheck);return output('lost',[],0,{lossReason:rejectedMoves.some(m=>m.reason==='counter-threat')?'counter-threat':'forcing-line',counterProof:{complete:true,checkedRoots:counterCheck.branches.length,forcing:19,quiet:1,ms:counterCheck.ms},screened:rejectedMoves.length,rejectedMoves,screeningComplete:true,forcingChecksComplete:true});}
      }
    }
    const counterRejected=counterCheck?counterRejections(p,counterCheck):[],counterBad=new Set(counterRejected.map(m=>m.i));
    roots=roots.filter(r=>!counterBad.has(r.i));
    if(!roots.length)return output('lost',[],0,{lossReason:'counter-threat',screened:counterRejected.length,rejectedMoves:counterRejected,screeningComplete:true,forcingChecksComplete:true});
    const screeningDeadline=Math.min(deadline,start+(automatic?2200:Math.max(10,ms*.45)));
    const screened=[];let screeningComplete=true,forcingChecksComplete=true;
    for(let r of roots){if(clockNow()>screeningDeadline){screeningComplete=false;break;}phaseDeadline=screeningDeadline;let status='screened',refutation=[],lossReason=null;try{tick();set(r.i,p);try{const threats=wins(3-p);if(threats.length){status='loss';refutation=[threats[0]];lossReason='immediate';}else{const f=fork(3-p);if(f){status='loss';refutation=[f.i];lossReason=f.forbiddenBlock?'forbidden-defense':'fork';}
        else{try{phaseDeadline=Math.min(screeningDeadline,clockNow()+Math.max(20,Math.min(200,ms*.035)));const line=vcf(3-p,13);if(line){status='loss';refutation=line;lossReason='forcing-line';}
          else{phaseDeadline=Math.min(screeningDeadline,clockNow()+Math.max(60,Math.min(650,ms*.15)));const trap=forcedReplyTrap(p);if(trap){status='loss';refutation=trap.line;lossReason='forced-reply-trap';}
            else{phaseDeadline=Math.min(screeningDeadline,clockNow()+Math.max(50,Math.min(4000,ms*.15)));const quiet=threatWin(3-p);if(quiet){status='loss';refutation=quiet;lossReason='three-threat';}}}
        }catch(e){if(e.message!=='timeout')throw e;status='unverified';forcingChecksComplete=false;}finally{phaseDeadline=Infinity;}}
      }}finally{set(r.i,0);}}catch(e){if(e.message!=='timeout')throw e;screeningComplete=false;break;}
      screened.push({...r,score:status==='loss'?-M+3:r.s,pv:[r.i],status,refutation,lossReason});
    }
    phaseDeadline=Infinity;
    const rejectedMoves=[...counterRejected,...screened.filter(r=>r.status==='loss').map(r=>({i:r.i,reason:r.lossReason,line:[r.i,...r.refutation]}))];
    // Unexamined points remain candidates; a partial screen cannot prove loss.
    const checked=new Set(screened.map(r=>r.i));
    const pending=roots.filter(r=>!checked.has(r.i)).map(r=>({...r,score:r.s,pv:[r.i],status:'unverified'}));
    if(pending.length){screeningComplete=false;forcingChecksComplete=false;}
    let safe=[...screened.filter(r=>r.status!=='loss'),...pending];if(!safe.length){
      if(screeningComplete)return output('lost',[],3,{lossReason:'forcing-line',screened:screened.length+counterRejected.length,rejectedMoves});
      return output('incomplete',[],0,{screened:screened.length+counterRejected.length,rejected:rejectedMoves.length,rejectedMoves,screeningComplete:false,forcingChecksComplete:false});
    }
    let best=safe.slice(0,3),depth=0;const rejected=rejectedMoves.length;
    const kind=danger.length?'block':'search',extra={screeningComplete,forcingChecksComplete,screened:screened.length+counterRejected.length,rejected,rejectedMoves};
    onProgress(output(kind,best,depth,extra));
    const forceSet=new Set(forcingCandidates(p));let frontier=strategy?strategy.searchSelect(b,p,safe,24,6,forceSet,own.length?'own':danger.length?'opponent':'unknown'):safe.filter((r,k)=>k<24||forceSet.has(r.i));
    const strategicAdjust=new Map(),pressureChecks=new Map(),tempoChecks=new Map();
    if(strategy&&clockNow()<deadline){strategicSummary=strategy.probe(b,p,frontier,Math.min(strategy.remaining(),Math.max(0,deadline-clockNow())));for(const c of strategicSummary.checks)if(c.complete){strategicAdjust.set(c.i,Math.max(-250,Math.min(250,c.score*.04)));if(strategicSummary.complete&&c.replies>=2){if(c.continues===c.replies)pressureChecks.set(c.i,c);if(Number.isInteger(c.tempoLosses)&&c.tempoLosses>0&&c.tempoLosses<=c.replies-c.continues&&Array.isArray(c.tempoLossReplies)&&c.tempoLossReplies.length===c.tempoLosses&&new Set(c.tempoLossReplies.map(x=>x.i)).size===c.tempoLosses&&c.tempoLossReplies.every(x=>Number.isInteger(x.i)&&x.i>=0&&x.i<b.length&&Number.isInteger(x.follow)&&x.follow>=0&&x.follow<b.length&&x.i!==c.i&&x.follow!==c.i&&x.follow!==x.i&&x.replyAttack>=120&&x.replyCut>=120))tempoChecks.set(c.i,c);}}}
    const rounds=[];let stopReason='최대 탐색 깊이 도달';
    for(let d=1;d<=10;d++){
      const round=[];
      try{for(let r of frontier){tick();set(r.i,p);let child;try{child=search(3-p,d-1,-Infinity,Infinity,1);}finally{set(r.i,0);}
        // One existing static-three unit rewards a forcing continuation that
        // survived every sampled actual reply, including a mandatory block.
        // This is a soft ordering preference, never a safety or win proof.
        const positional=Math.abs(child.score)<M/2,check=positional&&r.status==='screened'?pressureChecks.get(r.i):null,pressureBonus=check?420:0,probeAdjust=positional?(strategicAdjust.get(r.i)||0):0,baseSearchScore=-child.score;
        const tempo=positional&&r.status==='screened'?tempoChecks.get(r.i):null,tempoPenalty=tempo?420:0;
        const score=baseSearchScore+probeAdjust+pressureBonus-tempoPenalty;round.push({...r,score,pv:[r.i,...child.pv],depth:d,comparisonComplete:true,baseSearchScore,probeAdjust,pressureBonus,tempoPenalty,tempoEvidence:tempo?{replyCoverage:'bounded',replies:tempo.replies,tempoLosses:tempo.tempoLosses,counterBlocks:tempo.tempoLossReplies,probeComplete:strategicSummary.complete,proven:false}:null,pressureEvidence:check?{replyCoverage:'bounded',replies:check.replies,continues:check.continues,pv:check.pv.slice(),probeComplete:strategicSummary.complete,proven:false}:null});}
        round.sort((a,c)=>c.score-a.score);best=round.slice(0,3);depth=d;frontier=round;
        onProgress(output(kind,best,depth,extra));
        rounds.push({i:best[0].i,score:best[0].score,depth,
          pv:(best[0].pv||[]).slice(0,3),ranking:best.map(m=>m.i),
          gap:best.length>1?best[0].score-best[1].score:null});
        if(automatic&&autoStable(rounds,depth,clockNow()-start,extra,best)){stopReason='연속 3개 완료 깊이에서 후보·평가 격차·PV가 안정됨';break;}
      }catch(e){if(e.message!=='timeout')throw e;stopReason=(ms/1000)+'초 상한 도달 · 완료된 비교 결과';break;}
      if(!automatic&&Math.abs(best[0].score)>M-1000){stopReason='제한 탐색에서 승패 경로 발견';break;}
    }
    return output(kind,best,depth,{...extra,autoReason:automatic?stopReason:null});
  }
  function analyze(p,ms=5000,onProgress=()=>{}){const oldDeadline=deadline,oldPhase=phaseDeadline;try{return analyzeInternal(p,ms,onProgress);}finally{deadline=oldDeadline;phaseDeadline=oldPhase;}}
  // A closed or broken three can connect a second attack axis even when it
  // is absent from geometric open-three descriptors. This only schedules
  // bounded proof work; it is never itself a threat or a loss certificate.
  function counterSeeds(p,ms=40){const oldDeadline=deadline,oldPhase=phaseDeadline;deadline=Math.min(oldDeadline,clockNow()+Math.max(0,ms));phaseDeadline=Math.min(oldPhase,deadline);const found=[];try{for(const {i}of rank(p)){tick();set(i,p);try{if(wins(p).length||threes(i,p))continue;const axes=new Set(),three=[];for(const id of cellAffected[i]){const w=windows[id],own=p===1?counts1[id]:counts2[id],enemy=p===1?counts2[id]:counts1[id];if(enemy||b[w.pre]===p||b[w.post]===p)continue;if(own>=2)axes.add(w.axis);if(own>=3)three.push(id);}if(three.length&&axes.size>=2)found.push(i);}finally{set(i,0);}}}catch(error){if(error.message!=='timeout')throw error;}finally{deadline=oldDeadline;phaseDeadline=oldPhase;}return found;}
  function fixedWork(p,depth=3){nodes=0;strategy?.setBudget(Infinity);deadline=Infinity;phaseDeadline=Infinity;tt.clear();tacticalCache.clear();if(memory&&!options.memoryManaged)memory.begin();const start=clockNow(),result=search(p,depth,-Infinity,Infinity,0);return {...result,nodes,depth,ms:clockNow()-start,searchMemory:memory?.stats()};}
  return {fixedWork,rank,counterRejections,counterSeeds,counterMove,counterLoss,counterCertificate,legal,moveInfo,winMove,threes,analyze,state,board:b,winningMoves:wins,threatWin:(p,ms=1000)=>{deadline=clockNow()+ms;try{return threatWin(p);}catch(e){if(e.message==='timeout')return null;throw e;}finally{deadline=Infinity;}},forcingWin:(p,depth=13,ms=1000)=>{deadline=clockNow()+ms;try{return vcf(p,depth);}catch(e){if(e.message==='timeout')return null;throw e;}finally{deadline=Infinity;}}};
}
function autoStable(rounds,depth,elapsed,checks,moves){
  if(elapsed<1000||depth<4||rounds.length<3||!checks.screeningComplete||!checks.forcingChecksComplete||!moves.length||moves[0].status==='unverified')return false;
  const tail=rounds.slice(-3),scores=tail.map(r=>r.score);
  // Missing history is not evidence of stability. Compare only completed
  // consecutive depths, including the first three PV plies and top rankings.
  if(!tail.every((r,k)=>r.depth===depth-2+k&&r.i===moves[0].i&&
    Array.isArray(r.pv)&&r.pv.length>=3&&Array.isArray(r.ranking)&&r.ranking[0]===r.i))return false;
  const pv=tail[0].pv.slice(0,3).join(','),ranking=tail[0].ranking.join(',');
  if(!tail.every(r=>r.pv.slice(0,3).join(',')===pv&&r.ranking.join(',')===ranking))return false;
  if(moves.length>1){const gaps=tail.map(r=>r.gap);
    if(!gaps.every(Number.isFinite)||Math.min(...gaps)<80||
      Math.max(...gaps)-Math.min(...gaps)>Math.max(120,Math.min(...gaps)*.5))return false;
  }else if(!tail.every(r=>r.ranking.length===1))return false;
  return Math.max(...scores)-Math.min(...scores)<=120&&Math.abs(scores[0])<9000000&&
    (moves.length===1||moves[0].score-moves[1].score>=80);
}
if(typeof module!=='undefined')module.exports={createEngine,autoStable};
