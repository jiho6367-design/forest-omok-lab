// Both engines use the same board indices. Coordinates are a UI concern:
// index 0 is A1; never reinterpret the numeric records imported from Forest.
function createEngine(options={}) {
  // Exact five takes precedence even when loading a legacy strict-rule setting.
  const rules={fivePriority:true};
  const forest=createForestEngine(rules);
  const fast=b=>createReaderEngine(15,b,rules);
  const inspect=(b,i,p)=>![1,2].includes(p)?{legal:false,reason:'돌 색 오류',threes:[],fours:[],win:[]}:forest.inspect(b,i,p);
  function configure(next={}) { rules.fivePriority=true; }
  function validPV(board,p,pv) {
    const copy=board.slice(),out=[];
    for(const i of pv||[]){const s=inspect(copy,i,p);if(!s.legal)break;out.push(i);copy[i]=p;if(s.win.length)break;p=3-p;}
    return out;
  }
  function convert(board,p,r,started) {
    const first=r.moves?.[0],i=first?.i??null;
    const forbiddenDefense=r.kind==='lost'?(r.danger||[]).find(j=>!inspect(board,j,p).legal):null;
    const reason=r.kind==='terminal'?'대국 종료':r.kind==='none'?'합법적인 착수 없음':
      r.kind==='win'?'정확한 5목 완성':r.kind==='forced'?'연속 위협 강제승 확인':
      r.kind==='lost'?(forbiddenDefense!=null?`상대 5목 방어점 ${forest.coord(forbiddenDefense)}은 3×3 금수 · 강제패배 확인`:'강제패배 확인 · 계속 둘 수 있는 합법 후보'):
      r.kind==='block'?'상대의 다음 5목을 막는 필수 방어':
      r.kind==='incomplete'?'임시 합법 후보 · 추가 계산 중':'공격과 방어를 비교한 추천';
    return {i,reason,depth:r.depth||0,nodes:r.nodes||0,ms:Date.now()-started,score:first?.score||0,
      pv:validPV(board,p,first?.pv),proven:['win','forced'].includes(r.kind),lossProven:r.kind==='lost',forcedLoss:r.kind==='lost',
      threats:r.danger||[],shape:i==null?null:inspect(board,i,p),urgent:r.kind==='win'||!!r.mandatoryDefense||(r.kind==='lost'&&!!r.danger?.length),
      forbiddenDefense,
      defenseChecked:first?.status==='screened',fallback:!!r.fallback,kind:r.kind,
      autoReason:r.autoReason,automatic:r.automatic,screeningComplete:r.screeningComplete,
      candidates:(r.moves||[]).map(m=>({...m,pv:validPV(board,p,m.pv)})),rejected:r.rejectedMoves||[],
      engineVersion:'unified-4.0',memory:0,safety:'제한 탐색이며 무패를 보장하지 않습니다.'};
  }
  function urgent(board,p) {
    const e=fast(board),s=e.state();
    if(s.full||s.winners.length)return convert(board,p,e.analyze(p,'auto'),Date.now());
    if(!e.winningMoves(p).length&&!e.winningMoves(3-p).length)return null;
    return convert(board,p,e.analyze(p,'auto'),Date.now());
  }
  function suggestBudget(board,p,remaining=40000) {
    if(urgent(board,p))return {ms:100,automatic:true,reason:'즉시 승리·필수 방어 우선'};
    const count=board.filter(Boolean).length,base=count<6?2500:8000,tactical=forest.suggestBudget(board,p,remaining);
    const cap=Math.max(base,Math.min(15000,tactical.ms));
    const reason=cap>8000?`위협이 얽힌 국면 · 심층 방어 최대 ${cap/1000}초`:`최대 ${cap/1000}초 · 후보 안정 시 조기 종료`;
    return {ms:Math.max(30,Math.min(cap,remaining-3000)),automatic:true,reason};
  }
  function analyzeCore(board,p,budget='auto',lessons=[],progress=()=>{}) {
    lessons=lessons.filter(l=>(l.rules?.fivePriority!==false)===rules.fivePriority);
    const started=Date.now(),automatic=budget==='auto'||budget?.automatic===true;
    const limit=automatic?(budget?.ms||8000):Math.max(30,Number(budget)||1000);
    const immediate=urgent(board,p);if(immediate)return immediate;
    const certified=forest.certifiedLoss(board,p);if(certified)return certified;
    // A historical pattern is a hint, not a proof or a replacement for comparison.
    const deep=limit>8000;
    const e=fast(board);
    const ensureLegalCandidate=result=>{
      if(result.i!=null||result.kind==='terminal')return result;
      const nearby=forest.candidates(board),near=new Set(nearby);
      const pool=[...new Set([...(result.candidates||[]).map(m=>m.i),...nearby,
        ...Array.from({length:225},(_,i)=>i)])].filter(j=>inspect(board,j,p).legal);
      const rejected=new Set((result.rejected||[]).map(m=>m.i));
      const provenRejected=new Set((result.rejected||[]).filter(m=>m.pv?.length||m.replyTrap||m.verifiedRefutation).map(m=>m.i));
      const scores=new Map(),rank=j=>{if(scores.has(j))return scores.get(j);
        const after=board.slice();after[j]=p;const shape=inspect(board,j,p);
        const value=forest.evaluate(after,p)+(near.has(j)?250:0)+shape.fours.length*5000+shape.threes.length*300;
        scores.set(j,value);return value;};
      const choose=xs=>xs.length?xs.reduce((best,j)=>rank(j)>rank(best)?j:best):null;
      const i=choose(pool.filter(j=>!rejected.has(j)))??
        choose(pool.filter(j=>!provenRejected.has(j)))??choose(pool);
      if(i==null)return result;
      return {...result,i,score:rank(i),depth:0,proven:false,pv:[i],shape:inspect(board,i,p),fallback:true,
        unverifiedDefense:!result.lossProven,
        reason:result.lossProven?'강제패배 확인 · 합법적인 저항 수':
          '방어가 증명된 수 없음 · 합법 후보 표시 (안전 미확인)'};
    };
    const known=forest.knownRefutations(board,p),knownBad=new Set(known.map(m=>m.i));
    const excludeKnown=result=>{
      let best=result;
    if(known.length){
      best.rejected=[...(best.rejected||[]),...known.map(m=>({...m,verifiedRefutation:true}))];
      if(knownBad.has(best.i)){
        const compared=(best.candidates||[]).filter(m=>!knownBad.has(m.i)&&inspect(board,m.i,p).legal).sort((a,b)=>b.score-a.score);
        const fallback=forest.candidates(board).filter(i=>!knownBad.has(i)&&inspect(board,i,p).legal).map(i=>{const after=board.slice();after[i]=p;return {i,score:forest.evaluate(after,p),pv:[i]};}).sort((a,b)=>b.score-a.score);
        const alternative=compared[0]||fallback[0];
        if(alternative)best={...best,i:alternative.i,score:alternative.score,depth:compared.length?best.depth:0,pv:alternative.pv||[alternative.i],shape:inspect(board,alternative.i,p),
          proven:false,reason:'검증된 강제패배 수 제외 · 대안의 승리·안전은 미증명',unverifiedDefense:true};
      }
      best.candidates=(best.candidates||[]).filter(m=>!knownBad.has(m.i));
      if(!best.proven)best.reason=`${forest.coord(known[0].i)} 강제패배 수 제외 · `+best.reason;
    }
      return best;
    };
    // Apply the same evidence gate to interim candidates and final results.
    // Otherwise a user can play a certified losing move while deep search runs.
    let best=excludeKnown(convert(board,p,e.analyze(p,deep?Math.min(2000,limit*.2):automatic?{automatic:true,maxMs:limit}:limit,
      r=>progress(excludeKnown(convert(board,p,r,started)))),started));
    const can=forest.canonical(board,p),memory=lessons.filter(l=>l.key===can.key);
    best.memory=memory.length;
    best.patternHint=forest.patternDefense(board,p)?.i??null;
    if(!deep||best.proven||best.lossProven||best.kind==='terminal'||best.i==null)return ensureLegalCandidate(best);
    const refuted=new Set(knownBad),counterRisk=new Map();
    if(limit>=8000&&board.filter(Boolean).length<=40)for(const m of (best.candidates||[]).slice(0,3)){
      const shape=inspect(board,m.i,p);if(!shape.legal||!shape.fours.length||shape.win.length)continue;
      const after=board.slice();after[m.i]=p;const ends=forest.winning(after,p);
      if(ends.length!==1||forest.winning(after,3-p).length||!inspect(after,ends[0],3-p).legal)continue;
      after[ends[0]]=3-p;
      const counter=forest.forcing(after,3-p,19,Math.min(140,Math.max(1,limit-(Date.now()-started)-1000)));
      if(counter.complete&&counter.proof)counterRisk.set(m.i,{i:m.i,block:ends[0],pv:counter.proof.pv});
    }
    if(counterRisk.has(best.i)){
      const alternative=best.candidates.find(m=>!counterRisk.has(m.i)&&inspect(board,m.i,p).legal);
      if(alternative)best={...best,i:alternative.i,score:alternative.score,pv:alternative.pv,shape:inspect(board,alternative.i,p),
        reason:'상대가 강제 방어한 뒤의 반격 위험 제외 · 대안 추가 검증',unverifiedDefense:true};
    }
    // A quiet counterattack can refute a forced-looking defensive move even
    // when it creates no four. Reserve a bounded proof check before minimax
    // spends the whole 15-second budget on the same losing candidate.
    if(limit>=12000&&board.filter(Boolean).length>=16&&board.filter(Boolean).length<=40&&
      forest.forcing(board,3-p,19,120).proof&&limit-(Date.now()-started)>7000){
      for(const m of (best.candidates||[]).slice(0,limit>=20000?3:2)){
        const shape=inspect(board,m.i,p);if(!shape.legal||shape.win.length||Date.now()-started>limit-6000)continue;
        const after=board.slice();after[m.i]=p;
        const direct=forest.forcing(after,3-p,19,Math.min(140,limit-(Date.now()-started)-6000));
        const trap=direct.proof?null:forest.quietTrap(after,p,Math.min(5500,limit-(Date.now()-started)-6000),10,19,true);
        if(direct.proof||trap?.proof){refuted.add(m.i);best={...best,rejected:[...(best.rejected||[]),
          {i:m.i,reason:direct.proof?'상대의 직접 강제승 확인':'상대의 조용한 준비 수 뒤 강제패배 확인',
            pv:direct.proof?.pv||[],replyTrap:trap?.proof||null}],unverifiedDefense:true};}
      }
      if(refuted.has(best.i)){
        const alternative=best.candidates.find(m=>!refuted.has(m.i)&&!counterRisk.has(m.i)&&inspect(board,m.i,p).legal);
        if(alternative)best={...best,i:alternative.i,score:alternative.score,pv:alternative.pv,shape:inspect(board,alternative.i,p),
          reason:'강제패배 후보 제외 · 대안 추가 검증',unverifiedDefense:true};
      }
    }
    if(limit>=20000&&limit-(Date.now()-started)>12000){
      const risky=(best.candidates||[]).find(m=>{
        const shape=inspect(board,m.i,p);if(!shape.legal||!shape.fours.length)return false;
        const after=board.slice();after[m.i]=p;
        return forest.winning(after,p).length===1&&!forest.winning(after,3-p).length;
      });
      if(risky){
        const after=board.slice();after[risky.i]=p;
        const trap=forest.forcedReplyTrap(after,p,Math.min(500,limit-(Date.now()-started)-2000),null,19,true);
        // Incomplete verification is not a refutation. Keep the evaluated move.
        if(trap.proof){
          refuted.add(risky.i);
          const rejected={i:risky.i,reason:trap.proof?'강제 방어 뒤 상대 승리 수순 확인':'강제 방어 뒤 응수 검사 미완료',replyTrap:trap.proof||null};
          const alternative=best.candidates.find(m=>m.i!==risky.i&&!counterRisk.has(m.i)&&inspect(board,m.i,p).legal&&
            !inspect(board,m.i,p).fours.length);
          best={...best,i:best.i===risky.i?(alternative?.i??best.i):best.i,
            score:best.i===risky.i&&alternative?alternative.score:best.score,
            pv:best.i===risky.i?(alternative?.pv||[best.i]):best.pv,
            shape:best.i===risky.i&&alternative?inspect(board,alternative.i,p):best.shape,
            reason:alternative?'위험 후보 제외 · 대안 추가 검증':'현재 후보의 방어 미증명 · 대안 추가 검증',
            rejected:[...(best.rejected||[]),rejected],unverifiedDefense:true};
        }
      }
    }
    progress({...best,reason:best.reason+' · 심층 위협 검사 중'});
    const remaining=limit-(Date.now()-started)-Math.min(400,limit*.04);
    if(remaining>50){
      const extended=forest.analyze(board,p,remaining,lessons);
      if(extended.i!=null&&inspect(board,extended.i,p).legal&&!refuted.has(extended.i)&&(!counterRisk.has(extended.i)||extended.proven)){
        const opponentProof=i=>{
          if(i==null)return null;
          const shape=inspect(board,i,p);if(!shape.legal||shape.win.length)return null;
          const after=board.slice();after[i]=p;
          const proof=fast(after).forcingWin(3-p,13,Math.max(1,Math.min(200,limit-(Date.now()-started))));
          return proof?validPV(after,3-p,proof):null;
        };
        const deepProof=opponentProof(extended.i),fastProof=opponentProof(best.i);
        if(extended.lossProven&&deepProof&&!fastProof){
          best={...best,reason:'모든 후보의 강제패배 확인 · 즉시 패배를 늦추는 저항 수',
            rejected:[...(best.rejected||[]),{i:extended.i,reason:'착수 뒤 상대 강제승 확인',pv:deepProof}],
            deepConflict:true,lossProven:true,forcedLoss:true,kind:'lost',engineVersion:'unified-4.3-honest-loss'};
          best.ms=Date.now()-started;
          return best;
        }
        // A finite-width search score is not a proof. Only the engine's
        // separately verified forcing certificates set proven/lossProven.
        const pv=validPV(board,p,extended.pv);
        best={...extended,pv,proven:!!extended.proven&&pv.length===(extended.pv||[]).length,
          candidates:[{i:extended.i,pv,score:extended.score,status:extended.lossProven?'fallback':'deep'}],
          rejected:[...(best.rejected||[]),...(extended.rejected||[])],
          counterThreats:[...counterRisk.values(),...(extended.counterThreats||[])],
          unverifiedDefense:!!extended.unverifiedDefense||!!refuted.size&&!extended.proven,
          engineVersion:'unified-4.1-deep',automatic,autoReason:automatic?'위협 국면 심층 방어 검사 완료':extended.autoReason};
      }else{
        const rejected=new Set([...refuted,...(extended.rejected||[]).map(m=>m.i)]),risky=new Set([...counterRisk.keys(),...(extended.counterThreats||[]).map(m=>m.i)]);
        const alternative=best.candidates.find(m=>m.i===best.i&&!rejected.has(m.i)&&!risky.has(m.i))||
          best.candidates.find(m=>!rejected.has(m.i)&&!risky.has(m.i)&&(!refuted.size||!inspect(board,m.i,p).fours.length));
        if(alternative)best={...best,i:alternative.i,pv:alternative.pv,score:alternative.score,shape:inspect(board,alternative.i,p)};
        else if(rejected.has(best.i)||risky.has(best.i)){
          const pool=forest.candidates(board).filter(i=>!rejected.has(i)&&!risky.has(i)&&inspect(board,i,p).legal);
          pool.sort((a,c)=>{const x=board.slice(),y=board.slice();x[a]=p;y[c]=p;return forest.evaluate(y,p)-forest.evaluate(x,p);});
          const i=pool[0]??null;best={...best,i,pv:i==null?[]:[i],shape:i==null?null:inspect(board,i,p)};
        }
        best.reason+=' · 심층 검사 미완료, 방어 미증명';best.fallback=true;best.unverifiedDefense=true;
        best.rejected=[...(best.rejected||[]),...(extended.rejected||[])];
        best.counterThreats=[...counterRisk.values(),...(extended.counterThreats||[])];
        if(extended.lossProven){best.lossProven=true;best.forcedLoss=true;best.kind='lost';}
      }
    }
    if(known.length&&!best.proven&&!best.reason.includes('강제패배 수 제외'))
      best.reason=`${forest.coord(known[0].i)} 강제패배 수 제외 · `+best.reason+' · 대안의 전체 승리는 미증명';
    best.ms=Date.now()-started;
    return ensureLegalCandidate(best);
  }
  function analyze(board,p,budget='auto',lessons=[],progress=()=>{}) {
    const describe=r=>({...r,
      proofStatus:r.kind==='terminal'?'TERMINAL':r.proven?'PROVEN_WIN':r.lossProven?'PROVEN_LOSS':'UNRESOLVED',
      unverifiedDefense:r.kind!=='terminal'&&!r.proven&&!r.lossProven});
    return describe(analyzeCore(board,p,budget,lessons,r=>progress(describe(r))));
  }
  function assessMove(board,p,i) {
    if(!inspect(board,i,p).legal)return {mustWarn:false};
    const e=fast(board);if(e.winMove(i,p))return {mustWarn:false};
    const wins=e.winningMoves(3-p),blocks=wins.filter(j=>e.legal(j,p));
    return {mustWarn:wins.length===1&&blocks.length===1&&i!==blocks[0],required:blocks[0]};
  }
  function reviewMove(board,p,i,budget=1300,lessons=[]) {
    const shape=inspect(board,i,p);if(!shape.legal)return {i:null,reason:'규칙에 맞지 않는 수',reviewLabel:'기보 규칙 오류'};
    const r=analyze(board,p,budget*.7,lessons),after=board.slice();after[i]=p;
    const proof=shape.win.length?null:fast(after).forcingWin(3-p,13,budget*.3);
    return {...r,actual:i,actualLossProof:proof?{pv:validPV(after,3-p,proof)}:null,
      reviewLabel:r.lossProven?'이미 강제패배 상태 · 더 이른 수 복기':proof?'이 착수 뒤 상대 강제승 확인':r.i===i?'추천과 일치':'대안 비교 · 제한 탐색'};
  }
  return {...forest,configure,inspect,urgent,analyze,suggestBudget,assessMove,reviewMove,validPV};
}
if(typeof module!=='undefined')module.exports=createEngine;
