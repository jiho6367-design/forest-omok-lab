// Both engines use the same board indices. Coordinates are a UI concern:
// index 0 is A1; never reinterpret the numeric records imported from Forest.
function createEngine(options={}) {
  const clockNow=typeof performance!=='undefined'?performance.now.bind(performance):Date.now.bind(Date);
  // Exact five takes precedence even when loading a legacy strict-rule setting.
  const normalizeFirst=value=>[1,2].includes(value)?value:null;
  const strategyVersion='initiative-1';
  const searchMemory=options.searchMemory===false?null:options.searchMemory||
    (typeof OmokSearchMemory!=='undefined'?OmokSearchMemory.create({snapshot:options.memorySnapshot}):null);
  const rules={fivePriority:true,patternTable:options.patternTable,optimized:options.optimized,
    firstPlayer:normalizeFirst(options.firstPlayer??options.context?.firstPlayer),strategy:options.strategy,searchMemory,memoryManaged:true,
    model:options.model===undefined?(typeof OmokNeural!=='undefined'?OmokNeural.getDefaultModel():null):options.model};
  rules.modelVersion=typeof OmokNeural!=='undefined'?OmokNeural.identity(rules.model):'baseline';
  let forest=createForestEngine(rules);
  const fast=b=>createReaderEngine(15,b,rules);
  const inspect=(b,i,p)=>![1,2].includes(p)?{legal:false,reason:'돌 색 오류',threes:[],fours:[],win:[]}:forest.inspect(b,i,p);
  function configure(next={}) {
    rules.fivePriority=true;
    if(Object.prototype.hasOwnProperty.call(next,'model')){
      const modelVersion=typeof OmokNeural!=='undefined'?OmokNeural.identity(next.model):'baseline';
      if(modelVersion!==rules.modelVersion){searchMemory?.clear();rules.model=next.model;rules.modelVersion=modelVersion;forest=createForestEngine(rules);}
    }
    if(Object.prototype.hasOwnProperty.call(next,'firstPlayer')||next.context){
      const firstPlayer=normalizeFirst(next.firstPlayer??next.context?.firstPlayer);
      if(firstPlayer!==rules.firstPlayer){searchMemory?.clear();rules.firstPlayer=firstPlayer;forest=createForestEngine(rules);}
    }
  }
  const getContext=()=>({firstPlayer:rules.firstPlayer,strategyVersion,strategyEnabled:rules.strategy!==false,modelVersion:rules.modelVersion});
  function validPV(board,p,pv) {
    const copy=board.slice(),out=[];
    for(const i of pv||[]){const s=inspect(copy,i,p);if(!s.legal)break;out.push(i);copy[i]=p;if(s.win.length)break;p=3-p;}
    return out;
  }
  const refutation=m=>!!(m.pv?.length||m.line?.length||m.replyTrap||m.verifiedRefutation);
  const commonScore=(board,i,p)=>{
    const after=board.slice();after[i]=p;
    return forest.evaluate(after,p)+(forest.strategicScore?.(board,i,p)||0);
  };
  // All public progress, final and watchdog results use this same evidence gate.
  // Scores from Reader and Forest are never mixed to rank a merged shortlist.
  function finalizeResult(board,p,result){
    if(!result)return result;
    let r={...result,modelVersion:rules.modelVersion,learnedEvaluation:!!rules.model},rejected=[...(r.rejected||[])];
    for(const m of forest.knownRefutations(board,p))if(!rejected.some(x=>x.i===m.i&&refutation(x)))
      rejected.push({...m,verifiedRefutation:true});
    const bad=new Set(rejected.filter(refutation).map(m=>m.i));
    let candidates=(r.candidates||[]).filter(m=>m.i!=null&&inspect(board,m.i,p).legal&&
      !bad.has(m.i)).map(m=>({...m,pv:validPV(board,p,m.pv),depth:m.depth??r.depth??0,
        comparisonComplete:m.comparisonComplete??((r.depth||0)>0&&!r.fallback)}));
    if(r.kind!=='terminal'&&(r.i==null||!inspect(board,r.i,p).legal||bad.has(r.i))){
      let chosen=candidates[0];
      if(!chosen){
        const legal=Array.from({length:225},(_,i)=>i).filter(i=>inspect(board,i,p).legal),
          unresolved=legal.filter(i=>!bad.has(i)),near=new Set(forest.candidates(board));
        const pool=unresolved.length?unresolved:legal;
        const nearby=pool.filter(i=>near.has(i)),ranked=(nearby.length?nearby:pool)
          .map(i=>({i,score:commonScore(board,i,p),pv:[i],depth:0,comparisonComplete:false}))
          .sort((a,b)=>b.score-a.score||a.i-b.i);
        chosen=ranked[0];
        if(legal.length&&!unresolved.length){r.lossProven=true;r.forcedLoss=true;r.kind='lost';}
      }
      if(chosen){
        r={...r,i:chosen.i,score:chosen.score,pv:chosen.pv?.length?chosen.pv:[chosen.i],
          depth:chosen.depth||0,proven:false,fallback:true,
          proof:r.lossProven?r.proof:null,counterVerification:null,finalGuard:null,defenseChecked:false,
          kind:r.lossProven?'lost':'incomplete',
          strategy:forest.strategicProfile?.(board,p)||{initiative:'unknown',evidence:{}},
          reason:r.lossProven?'강제패배 확인 · 합법적인 저항 수':'검증된 패배 후보 제외 · 대안의 승리·안전은 미증명'};
        if(!candidates.length)candidates=[chosen];
      }else r={...r,i:null,pv:[],depth:0,proven:false};
    }
    const originalPV=r.pv||[],pv=validPV(board,p,originalPV),claimedProof=!!r.proven;
    r.proven=!!r.proven&&pv.length>0&&pv.length===originalPV.length&&pv[0]===r.i;
    if(claimedProof&&!r.proven){r.proof=null;r.counterVerification=null;}
    if(!r.proven&&['win','forced'].includes(r.kind))r.kind='incomplete';
    if(r.i!=null&&pv[0]!==r.i)r.pv=[r.i];else r.pv=pv;
    if(r.retainedComparison&&r.retainedComparison.i!==r.i)delete r.retainedComparison;
    r.lossProven=!!r.lossProven;r.forcedLoss=r.lossProven;
    r.shape=r.i==null?null:inspect(board,r.i,p);
    if(r.i!=null){
      const at=candidates.findIndex(m=>m.i===r.i);
      if(at>0)candidates.unshift(...candidates.splice(at,1));
      else if(at<0)candidates.unshift({i:r.i,score:r.score,pv:r.pv,depth:r.depth||0,
        comparisonComplete:(r.depth||0)>0&&!r.fallback,comparisonSource:r.comparisonSource});
    }
    const seen=new Set();r.candidates=candidates.filter(m=>!seen.has(m.i)&&seen.add(m.i)).slice(0,3);
    r.rejected=rejected;
    const immediate=r.urgent||r.kind==='terminal'||r.proven||r.lossProven;
    const profile=r.strategy||(immediate?{initiative:r.proven?'own':r.kind==='terminal'?'unknown':'opponent',
      evidence:{ownWins:r.proven?[r.i]:[],enemyWins:r.threats||[],replyCoverage:'not-checked'}}:
      forest.strategicProfile?.(board,p))||{initiative:'unknown',evidence:{}};
    const feature=r.candidates.find(m=>m.i===r.i)?.strategy||
      (r.i==null||immediate?null:forest.strategicMove?.(board,r.i,p));
    r.strategy={...profile,firstPlayer:rules.firstPlayer,strategyVersion,context:getContext()};
    if(!r.proven&&!r.lossProven&&(profile.complete===false||r.analysisIncomplete||r.timedOut)&&
      !profile.evidence?.ownWins?.length&&!profile.evidence?.enemyWins?.length)r.strategy.initiative='unknown';
    r.strategy.selected=feature||null;
    r.proofStatus=r.kind==='terminal'?'TERMINAL':r.proven?'PROVEN_WIN':r.lossProven?'PROVEN_LOSS':'UNRESOLVED';
    r.unverifiedDefense=r.kind!=='terminal'&&!r.proven&&!r.lossProven;
    r.assessmentStatus=r.proofStatus!=='UNRESOLVED'?r.proofStatus:
      r.timedOut||r.analysisIncomplete||r.kind==='incomplete'?'INCOMPLETE':
      r.retainedComparison?.finalDefenseUnchecked&&!r.defenseChecked?(feature?.cut>0?'BLOCKING_UNCHECKED':'INCOMPLETE'):
      r.kind==='block'||(!(r.depth>0)&&feature?.cut>0)?'BLOCKING_UNCHECKED':
      r.depth>0&&!r.fallback?'BOUNDED_FAVORABLE':'INCOMPLETE';
    r.engineVersion='unified-'+strategyVersion;
    return r;
  }
  function convert(board,p,r,started) {
    const first=r.moves?.[0],i=first?.i??null;
    const forbiddenDefense=r.kind==='lost'?(r.danger||[]).find(j=>!inspect(board,j,p).legal):null;
    const reason=r.kind==='terminal'?'대국 종료':r.kind==='none'?'합법적인 착수 없음':
      r.kind==='win'?'정확한 5목 완성':r.kind==='forced'?'연속 위협 강제승 확인':
      r.kind==='lost'?(forbiddenDefense!=null?`상대 5목 방어점 ${forest.coord(forbiddenDefense)}은 3×3 금수 · 강제패배 확인`:'강제패배 확인 · 계속 둘 수 있는 합법 후보'):
      r.kind==='block'?'상대의 다음 5목을 막는 필수 방어':
      r.kind==='incomplete'?'임시 합법 후보 · 추가 계산 중':'공격과 방어를 비교한 추천';
    return {i,reason,depth:r.depth||0,nodes:r.nodes||0,ms:clockNow()-started,score:first?.score||0,
      pv:validPV(board,p,first?.pv),proven:['win','forced'].includes(r.kind),lossProven:r.kind==='lost',forcedLoss:r.kind==='lost',
      threats:r.danger||[],shape:i==null?null:inspect(board,i,p),urgent:r.kind==='win'||!!r.mandatoryDefense||(r.kind==='lost'&&!!r.danger?.length),
      forbiddenDefense,
      defenseChecked:first?.status==='screened',fallback:!!r.fallback,kind:r.kind,
      autoReason:r.autoReason,automatic:r.automatic,screeningComplete:r.screeningComplete,
      forcingChecksComplete:r.forcingChecksComplete,counterProof:r.counterProof,counterChecks:r.counterChecks,strategy:r.strategy,comparisonSource:'reader',
      candidates:(r.moves||[]).map(m=>{const pv=validPV(board,p,m.pv);return {...m,pv,depth:m.depth??r.depth??0,comparisonSource:'reader',
        comparisonDepthExplicit:Number.isInteger(m.depth)&&m.depth>0,
        comparisonPVComplete:Array.isArray(m.pv)&&m.pv.length>0&&pv.length===m.pv.length&&pv[0]===m.i};}),rejected:r.rejectedMoves||[],
      engineVersion:'unified-4.0',memory:0,safety:'제한 탐색이며 무패를 보장하지 않습니다.'};
  }
  function urgent(board,p) {
    const e=fast(board),s=e.state();
    if(s.full||s.winners.length)return finalizeResult(board,p,convert(board,p,e.analyze(p,'auto'),clockNow()));
    if(!e.winningMoves(p).length&&!e.winningMoves(3-p).length)return null;
    return finalizeResult(board,p,convert(board,p,e.analyze(p,'auto'),clockNow()));
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
    const started=clockNow(),automatic=budget==='auto'||budget?.automatic===true;
    const limit=automatic?(budget?.ms||8000):Math.max(30,Number(budget)||1000);
    const immediate=urgent(board,p);if(immediate)return immediate;
    const certified=forest.certifiedLoss(board,p);if(certified)return certified;
    // A historical pattern is a hint, not a proof or a replacement for comparison.
    const deep=limit>8000;
    const e=fast(board);
    const ensureLegalCandidate=result=>finalizeResult(board,p,result);
    const known=forest.knownRefutations(board,p),knownBad=new Set(known.map(m=>m.i));
    const excludeKnown=result=>{
      let best=result;
    if(known.length){
      best.rejected=[...(best.rejected||[]),...known.map(m=>({...m,verifiedRefutation:true}))];
      if(knownBad.has(best.i)){
        const compared=(best.candidates||[]).filter(m=>!knownBad.has(m.i)&&inspect(board,m.i,p).legal).sort((a,b)=>b.score-a.score);
        const fallback=forest.candidates(board).filter(i=>!knownBad.has(i)&&inspect(board,i,p).legal).map(i=>({i,score:commonScore(board,i,p),pv:[i],depth:0,comparisonComplete:false})).sort((a,b)=>b.score-a.score);
        const alternative=compared[0]||fallback[0];
        if(alternative)best={...best,i:alternative.i,score:alternative.score,depth:compared.length?best.depth:0,pv:alternative.pv||[alternative.i],shape:inspect(board,alternative.i,p),
          proven:false,proof:null,strategy:forest.strategicProfile?.(board,p),reason:'검증된 강제패배 수 제외 · 대안의 승리·안전은 미증명',unverifiedDefense:true};
      }
      best.candidates=(best.candidates||[]).filter(m=>!knownBad.has(m.i));
      if(!best.proven)best.reason=`${forest.coord(known[0].i)} 강제패배 수 제외 · `+best.reason;
    }
      return best;
    };
    // Apply the same evidence gate to interim candidates and final results.
    // Otherwise a user can play a certified losing move while deep search runs.
    let best={...excludeKnown(convert(board,p,e.analyze(p,deep?Math.min(2000,limit*.2):automatic?{automatic:true,maxMs:limit}:limit,
      r=>progress({...excludeKnown(convert(board,p,r,started)),automatic})),started)),automatic};
    const can=forest.canonical(board,p),memory=lessons.filter(l=>l.key===can.key);
    best.memory=memory.length;
    best.patternHint=forest.patternDefense(board,p)?.i??null;
    // Wide quiet-counter proofs have their own reserve only in the early/middle
    // game. Dense positions retain Forest's established final-guard time.
    const counterContextEligible=deep&&limit>=12000&&board.filter(Boolean).length>=16&&board.filter(Boolean).length<=40;
    let counterContext=counterContextEligible&&e.counterSeeds(3-p,Math.min(40,limit-(clockNow()-started)-1000)).length>0;
    // Reuse Reader's incremental windows for the complete counter-threat
    // certificate. Keep the same total move clock and reserve ordinary search
    // if this bounded proof does not cover every legal defense.
    if(deep&&!best.proven&&!best.lossProven&&best.i!=null&&limit-(clockNow()-started)>4000&&e.forcingWin(3-p,13,80)){
      counterContext=counterContextEligible;
      // Keep at least 12 seconds for the established dense-position search
      // and final guard; the new global probe may return partial evidence.
      const available=limit-(clockNow()-started),counterBudget=Math.min(7000,limit*.5,available-3000,
        counterContextEligible?Infinity:Math.max(0,available-12400));
      const check=counterBudget>0?e.counterLoss(p,counterBudget,19,1):{lossProven:false,complete:false,branches:[]};
      if(check.lossProven)return ensureLegalCandidate({...best,lossProven:true,forcedLoss:true,kind:'lost',proven:false,score:-1e8,ms:clockNow()-started,
        reason:'시간 끌기 반격을 포함한 모든 합법 응수에서 강제패배 확인',rejected:e.counterRejections(p,check),counterProof:{complete:true,checkedRoots:check.branches.length,forcing:19,quiet:1,ms:check.ms},comparisonSource:'reader',automatic});
      const completed=e.counterRejections(p,check);
      if(completed.length){
        best=ensureLegalCandidate({...best,rejected:[...(best.rejected||[]),...completed]});
        progress({...best,analysisIncomplete:true,reason:best.reason+' · 전체 패배는 미확인, 완료된 개별 반증 보존'});
        if(best.lossProven)return best;
      }

    }
    if(!deep||best.proven||best.lossProven||best.kind==='terminal'||best.i==null)return ensureLegalCandidate(best);
    // Freeze per-candidate provenance before later safety exclusions can
    // replace the selected move. A global depth is not another move's work.
    const readerComparisons=(best.candidates||[]).filter(m=>m.comparisonComplete===true&&m.depth>0&&
      m.comparisonDepthExplicit===true&&m.comparisonPVComplete===true&&Number.isFinite(m.score)).map(m=>({...m,pv:m.pv.slice()}));
    // A deeper engine must not resurrect a move already refuted by Reader.
    // Reader certificates use `line`; Forest certificates use `pv`/`replyTrap`.
    const refuted=new Set([...knownBad,...(best.rejected||[])
      .filter(m=>m.pv?.length||m.line?.length||m.replyTrap||m.verifiedRefutation).map(m=>m.i)]),counterRisk=new Map(),latentCounter=new Map();
    if(limit>=8000&&board.filter(Boolean).length<=40)for(const m of (best.candidates||[]).slice(0,3)){
      const shape=inspect(board,m.i,p);if(!shape.legal||!shape.fours.length||shape.win.length)continue;
      const after=board.slice();after[m.i]=p;const ends=forest.winning(after,p);
      if(ends.length!==1||forest.winning(after,3-p).length||!inspect(after,ends[0],3-p).legal)continue;
      // After the opponent's block it is OUR turn. A hypothetical second
      // opponent move is not a refutation; inspect every legal continuation.
      const counter=forest.forcedReplyTrap(after,p,
        Math.min(140,Math.max(1,limit-(clockNow()-started)-1000)),null,19,true);
      if(counter.complete&&counter.proof){
        const evidence={i:m.i,block:counter.proof.block??ends[0],replyTrap:counter.proof};
        counterRisk.set(m.i,evidence);refuted.add(m.i);
        best.rejected=[...(best.rejected||[]),{...evidence,reason:'강제 방어 뒤 모든 합법 후속 수의 반격 확인'}];
      }else{
        // A future opponent-first VCF is useful diagnostic evidence only.
        // Our surviving continuation retains its turn; this never changes
        // candidate ordering, the refutation set or the fallback pool.
        const hypothetical=after.slice();hypothetical[ends[0]]=3-p;
        const future=forest.forcing(hypothetical,3-p,19,
          Math.min(140,Math.max(1,limit-(clockNow()-started)-1000)));
        if(future.complete&&future.proof)latentCounter.set(m.i,{i:m.i,block:ends[0],
          riskOnly:true,actualTurn:p,hypotheticalTurn:3-p,hypotheticalPV:future.proof.pv,
          actualCheck:{complete:counter.complete,unrefutedReply:counter.unrefutedReply??null,
            replyWins:!!counter.replyWins}});
      }
    }
    if(counterRisk.has(best.i)){
      const alternative=best.candidates.find(m=>!counterRisk.has(m.i)&&inspect(board,m.i,p).legal);
      if(alternative)best={...best,i:alternative.i,score:alternative.score,pv:alternative.pv,shape:inspect(board,alternative.i,p),
        reason:'상대가 강제 방어한 뒤의 반격 위험 제외 · 대안 추가 검증',unverifiedDefense:true};
    }
    // The final incremental counter proof below replaces the earlier
    // repeated Forest quiet probes; its reserve is inside this move clock.
    // A quiet counterattack can refute a forced-looking defensive move even
    // when it creates no four. Reserve a bounded proof check before minimax
    // spends the whole 15-second budget on the same losing candidate.
    if(!counterContext&&limit>=12000&&board.filter(Boolean).length>=16&&board.filter(Boolean).length<=40&&
      forest.forcing(board,3-p,19,120).proof&&limit-(clockNow()-started)>7000){
      for(const m of (best.candidates||[]).slice(0,limit>=20000?3:2)){
        const shape=inspect(board,m.i,p);if(!shape.legal||shape.win.length||clockNow()-started>limit-6000)continue;
        const after=board.slice();after[m.i]=p;
        const direct=forest.forcing(after,3-p,19,Math.min(140,limit-(clockNow()-started)-6000));
        const trap=direct.proof?null:forest.quietTrap(after,p,Math.min(5500,limit-(clockNow()-started)-6000),10,19,true);
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
    if(limit>=20000&&limit-(clockNow()-started)>12000){
      const risky=(best.candidates||[]).find(m=>{
        const shape=inspect(board,m.i,p);if(!shape.legal||!shape.fours.length)return false;
        const after=board.slice();after[m.i]=p;
        return forest.winning(after,p).length===1&&!forest.winning(after,3-p).length;
      });
      if(risky){
        const after=board.slice();after[risky.i]=p;
        const trap=forest.forcedReplyTrap(after,p,Math.min(500,limit-(clockNow()-started)-2000),null,19,true);
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
    const counterReserve=counterContext?Math.min(5000,limit*.34):0;
    const remaining=limit-(clockNow()-started)-Math.min(400,limit*.04)-counterReserve;
    if(remaining>50){
      const extended=forest.analyze(board,p,remaining,lessons);
      if(extended.i!=null&&inspect(board,extended.i,p).legal&&!refuted.has(extended.i)&&(!counterRisk.has(extended.i)||extended.proven)){
        const opponentProof=i=>{
          if(i==null)return null;
          const shape=inspect(board,i,p);if(!shape.legal||shape.win.length)return null;
          const after=board.slice();after[i]=p;
          const proof=fast(after).forcingWin(3-p,13,Math.max(1,Math.min(200,limit-(clockNow()-started))));
          return proof?validPV(after,3-p,proof):null;
        };
        // These checks only resolve a certified-loss conflict. Quiet results
        // previously paid for two probes whose results were discarded.
        const deepProof=extended.lossProven?opponentProof(extended.i):null,
          fastProof=extended.lossProven?(extended.i===best.i?deepProof:opponentProof(best.i)):null;
        if(extended.lossProven&&deepProof&&!fastProof){
          best={...best,reason:'모든 후보의 강제패배 확인 · 즉시 패배를 늦추는 저항 수',
            rejected:[...(best.rejected||[]),{i:extended.i,reason:'착수 뒤 상대 강제승 확인',pv:deepProof}],
            deepConflict:true,lossProven:true,forcedLoss:true,kind:'lost',engineVersion:'unified-4.3-honest-loss'};
          best.ms=clockNow()-started;
          return best;
        }
        // A finite-width search score is not a proof. Only the engine's
        // separately verified forcing certificates set proven/lossProven.
        const pv=validPV(board,p,extended.pv);
        best={...extended,pv,proven:!!extended.proven&&pv.length===(extended.pv||[]).length,
          comparisonSource:'forest',
          candidates:(extended.candidates?.length?extended.candidates:[{i:extended.i,pv,score:extended.score,status:extended.lossProven?'fallback':'deep'}])
            .map(m=>({...m,pv:validPV(board,p,m.pv),depth:m.depth??extended.depth??0,comparisonSource:'forest'})),
          rejected:[...(best.rejected||[]),...(extended.rejected||[])],
          counterThreats:[...counterRisk.values(),...(extended.counterThreats||[])],
          unverifiedDefense:!!extended.unverifiedDefense||!!refuted.size&&!extended.proven,
          engineVersion:'unified-4.1-deep',automatic,autoReason:automatic?'위협 국면 심층 방어 검사 완료':extended.autoReason};
        // Forest has selected this exact fallback but may have no completed
        // comparison for it. Preserve its earlier Reader comparison as one
        // unit; never rank Reader scores against Forest static/deep scores.
        const row=readerComparisons.find(m=>m.i===extended.i),blocked=(best.rejected||[]).some(m=>m.i===extended.i&&refutation(m))||
          extended.candidateGuards?.some(c=>c.i===extended.i&&c.refuted)||
          extended.counterThreats?.some(c=>c.i===extended.i&&!c.riskOnly);
        if(row&&!blocked&&!counterRisk.has(row.i)&&!extended.proven&&!extended.lossProven&&!extended.forcedLoss&&
          !(extended.depth>0)&&!extended.candidates?.find(m=>m.i===extended.i)?.comparisonComplete){
          const retainedPV=validPV(board,p,row.pv);
          if(retainedPV.length===row.pv.length&&retainedPV[0]===row.i){
            const selectedCheck=extended.strategy?.checks?.find(c=>c.i===row.i&&c.complete)||null;
            best={...best,score:row.score,depth:row.depth,pv:retainedPV,comparisonSource:'reader',
              candidates:[{...row,pv:retainedPV,status:'comparison-retained'}],
              retainedComparison:{i:row.i,source:'reader',depth:row.depth,sameMoveOnly:true,finalDefenseUnchecked:!extended.defenseChecked},
              strategy:extended.strategy?{...extended.strategy,initiative:'unknown',selectedCheck}:extended.strategy,
              reason:extended.reason+' · 같은 대안의 완료 비교 수순 보존'};
          }
        }
      }else{
        const rejected=new Set([...refuted,...(extended.rejected||[]).map(m=>m.i)]),risky=new Set([...counterRisk.keys(),...(extended.counterThreats||[]).filter(m=>!m.riskOnly).map(m=>m.i)]);
        const alternative=best.candidates.find(m=>m.i===best.i&&!rejected.has(m.i)&&!risky.has(m.i))||
          best.candidates.find(m=>!rejected.has(m.i)&&!risky.has(m.i)&&(!refuted.size||!inspect(board,m.i,p).fours.length));
        if(alternative)best={...best,i:alternative.i,pv:alternative.pv,score:alternative.score,shape:inspect(board,alternative.i,p)};
        else if(rejected.has(best.i)||risky.has(best.i)){
          const pool=forest.candidates(board).filter(i=>!rejected.has(i)&&!risky.has(i)&&inspect(board,i,p).legal);
          pool.sort((a,c)=>commonScore(board,c,p)-commonScore(board,a,p));
          const i=pool[0]??null;best={...best,i,pv:i==null?[]:[i],shape:i==null?null:inspect(board,i,p)};
        }
        best.reason+=' · 심층 검사 미완료, 방어 미증명';best.fallback=true;best.unverifiedDefense=true;
        best.rejected=[...(best.rejected||[]),...(extended.rejected||[])];
        best.counterThreats=[...counterRisk.values(),...(extended.counterThreats||[])];
        if(extended.lossProven){best.lossProven=true;best.forcedLoss=true;best.kind='lost';}
      }
    }
    if(counterContext&&!best.proven&&!best.lossProven&&best.i!=null&&clockNow()-started<limit-80){
      const checks=[],bad=new Set((best.rejected||[]).filter(refutation).map(m=>m.i)),seen=new Set(),
        pool=[{i:best.i},...(best.candidates||[])].filter(m=>!seen.has(m.i)&&seen.add(m.i)).slice(0,3),
        proofEnd=Math.min(started+limit-80,clockNow()+counterReserve);
      for(const m of pool){
        if(clockNow()>=proofEnd)break;
        const check=e.counterMove(m.i,p,Math.max(0,proofEnd-clockNow()),19,2);
        checks.push({i:m.i,complete:check.complete,refuted:!!check.proof,ms:check.ms,forcing:19,quiet:2});
        if(!check.proof)continue;
        bad.add(m.i);best.rejected=[...(best.rejected||[]),{i:m.i,pv:check.proof.pv,reason:'공격 준비와 시간 끌기 반격을 포함한 상대 강제승 확인',counterProof:{forcing:19,quiet:2,complete:true}}];
        if(bad.has(best.i)){
          const next=(best.candidates||[]).find(c=>!bad.has(c.i)&&inspect(board,c.i,p).legal);
          best=next?{...best,i:next.i,pv:next.pv,score:next.score,depth:next.depth||0,proven:false,proof:null,finalGuard:null,counterVerification:null,retainedComparison:null,strategy:best.strategy?{...best.strategy,initiative:'unknown',selectedCheck:null}:null,defenseChecked:false,unverifiedDefense:true,kind:'search',reason:'검증된 강제패배 수 제외 · 공격 대안 비교 유지'}:
            {...best,i:null,pv:[],depth:0,proven:false,proof:null,finalGuard:null,counterVerification:null,retainedComparison:null,kind:'incomplete'};
        }
        // Publish refutations before another probe so cancel/watchdog cannot
        // return the already refuted, previously compared recommendation.
        progress({...best,counterChecks:checks.slice(),analysisIncomplete:true,reason:'증명된 패배 수 제외 · 나머지 후보 검사 중'});

      }
      best.candidates=(best.candidates||[]).filter(m=>!bad.has(m.i));
      if(bad.has(best.i)){
        const alternative=best.candidates.find(m=>inspect(board,m.i,p).legal);
        best=alternative?{...best,i:alternative.i,pv:alternative.pv,score:alternative.score,depth:alternative.depth||0,proven:false,proof:null,kind:'search',finalGuard:null,counterVerification:null,retainedComparison:null,strategy:best.strategy?{...best.strategy,initiative:'unknown',selectedCheck:null}:null,defenseChecked:false,unverifiedDefense:true,reason:'검증된 강제패배 수 제외 · 공격 대안 비교 유지'}:
          {...best,i:null,pv:[],proven:false,proof:null,finalGuard:null,counterVerification:null,retainedComparison:null,strategy:best.strategy?{...best.strategy,initiative:'unknown',selectedCheck:null}:null,kind:'incomplete',depth:0};
      }
      best.counterChecks=checks;
      best.analysisIncomplete=!!best.analysisIncomplete||best.i==null||checks.some(c=>c.i===best.i&&!c.complete);
    }
    if(known.length&&!best.proven&&!best.reason.includes('강제패배 수 제외'))
      best.reason=`${forest.coord(known[0].i)} 강제패배 수 제외 · `+best.reason+' · 대안의 전체 승리는 미증명';
    const diagnostics=new Map((best.counterThreats||[]).map(m=>[m.i,m]));
    for(const [i,evidence]of latentCounter)if(!diagnostics.has(i))diagnostics.set(i,evidence);
    best.counterThreats=[...diagnostics.values()];
    best.ms=clockNow()-started;
    return ensureLegalCandidate(best);
  }
  function analyze(board,p,budget='auto',lessons=[],progress=()=>{}) {
    searchMemory?.begin();
    const describe=r=>({...finalizeResult(board,p,r),searchMemory:searchMemory?.stats()});
    const limit=Number(budget),staged=Number.isFinite(limit)&&limit>=20000;
    if(!staged)return describe(analyzeCore(board,p,budget,lessons,r=>progress(describe(r))));
    const started=clockNow(),deadline=started+limit;
    let compared=[];
    // Keep completed comparison results. The additional time validates a small
    // shortlist with existing tactical tools; it does not widen the root tree.
    let best=analyzeCore(board,p,Math.min(15000,limit*.6),lessons,r=>{
      if(r.depth>0&&r.candidates?.length>1)compared=r.candidates.slice();
      progress(describe(r));
    });
    if(best.proven||best.lossProven||best.kind==='terminal'||best.i==null)return describe(best);
    progress(describe(best));
    const rejected=[...(best.rejected||[])],bad=new Set(rejected.filter(refutation).map(m=>m.i));
    const seeds=[{i:best.i,score:best.score,pv:best.pv,depth:best.depth,
      comparisonSource:best.comparisonSource,comparisonComplete:best.depth>0&&!best.fallback,
      strategy:best.candidates?.find(m=>m.i===best.i)?.strategy},...(best.candidates||[]),...compared];
    const seen=new Set(),shortlist=seeds.filter(m=>{
      if(seen.has(m.i)||bad.has(m.i)||!inspect(board,m.i,p).legal)return false;
      seen.add(m.i);return true;
    }).slice(0,3),checks=[];
    let extraNodes=0;
    for(let k=0;k<shortlist.length&&clockNow()<deadline-30;k++){
      const m=shortlist[k],after=board.slice();after[m.i]=p;
      const checkStarted=clockNow(),slice=(deadline-checkStarted-30)/(shortlist.length-k),end=checkStarted+slice;
      const direct=forest.forcing(after,3-p,25,Math.max(1,Math.min(1000,slice*.25)));
      const trap=direct.proof||!direct.complete||clockNow()>=end?null:
        inspect(board,m.i,p).fours.length?
          forest.forcedReplyTrap(after,p,Math.max(1,Math.min(500,end-clockNow())),null,25,true):
          forest.quietTrap(after,p,Math.max(1,end-clockNow()),14,25,true);
      extraNodes+=(direct.nodes||0)+(trap?.nodes||0);
      const proof=direct.proof||trap?.proof;
      checks.push({i:m.i,complete:!!direct.complete&&(!trap||!!trap.complete),refuted:!!proof,ms:clockNow()-checkStarted});
      if(proof){bad.add(m.i);rejected.push({i:m.i,pv:direct.proof?.pv||[],replyTrap:trap?.proof||null,reason:'상위 후보 추가 검사에서 상대 강제승 확인'});}
    }
    // A mate-like evaluation only selects work; it is never proof by itself.
    // Confirm the chosen move with the existing exhaustive legal-root screen.
    // Ordinary, unresolved evaluations keep the previous early-return policy.
    let counterVerification=null;
    if(best.score>=5e7&&!bad.has(best.i)&&clockNow()<deadline-180){
      const after=board.slice();after[best.i]=p;
      const checkStarted=clockNow(),confirmation=fast(after).analyze(3-p,Math.min(1500,deadline-checkStarted-30));
      extraNodes+=confirmation.nodes||0;
      counterVerification={i:best.i,kind:confirmation.kind,depth:confirmation.depth,nodes:confirmation.nodes,ms:clockNow()-checkStarted};
      if(confirmation.kind==='lost'){
        const defense=confirmation.moves?.[0]?.i;
        let line=confirmation.rejectedMoves?.find(m=>m.i===defense)?.line;
        if(!line&&defense!=null){const reply=after.slice();reply[defense]=3-p;
          const win=forest.winning(reply,p)[0];if(win!=null)line=[defense,win];}
        const pv=line?[best.i,...line]:best.pv;
        if(pv?.length&&validPV(board,p,pv).length===pv.length){
          best={...best,proven:true,lossProven:false,forcedLoss:false,kind:'forced',score:1e8,pv,
            reason:'추천 수 뒤 상대의 모든 합법 방어에 강제패배 확인',
            proof:{type:'opponent-complete-loss',rejected:confirmation.rejectedMoves||[],danger:confirmation.danger||[]}};
        }
      }else if(['win','forced'].includes(confirmation.kind)){
        const line=confirmation.moves?.[0]?.pv||[];
        if(line.length&&validPV(after,3-p,line).length===line.length){bad.add(best.i);
          rejected.push({i:best.i,pv:line,reason:'추가 응수 검사에서 상대 강제승 확인'});}
      }
    }
    if(bad.has(best.i)){
      counterVerification=null;
      const alternative=seeds.find(m=>!bad.has(m.i)&&inspect(board,m.i,p).legal);
      if(alternative)best={...best,i:alternative.i,score:alternative.score,pv:alternative.pv||[alternative.i],depth:alternative.depth||0,
        comparisonSource:alternative.comparisonSource,proven:false,proof:null,counterVerification:null,finalGuard:null,defenseChecked:false,
        strategy:forest.strategicProfile?.(board,p),
        kind:alternative.comparisonComplete?'search':'incomplete'};
      else{
        const alternatives=forest.candidates(board).filter(i=>!bad.has(i)&&inspect(board,i,p).legal).map(i=>{
          return {i,score:commonScore(board,i,p)};
        }).sort((a,b)=>b.score-a.score);
        const m=alternatives[0];best={...best,i:m?.i??null,score:m?.score??0,pv:m?[m.i]:[],depth:0,fallback:true,
          proven:false,proof:null,counterVerification:null,finalGuard:null,defenseChecked:false,kind:'incomplete',
          strategy:forest.strategicProfile?.(board,p)};
      }
      best.reason='검증된 패배 후보 제외 · 대안의 승리·안전은 미증명';
    }
    const completed=seeds.filter(m=>!bad.has(m.i)&&m.comparisonSource===best.comparisonSource&&m.comparisonComplete);
    return describe({...best,shape:best.i==null?null:inspect(board,best.i,p),rejected,
      candidates:best.i==null?[]:completed.length?completed:best.candidates,
      candidateChecks:checks,counterVerification,nodes:(best.nodes||0)+extraNodes,ms:clockNow()-started});
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
  // configure can rebuild context-sensitive evaluation caches. Forward public
  // Forest methods to the current instance rather than retaining stale closures.
  const api={...forest};for(const name of Object.keys(api))if(typeof api[name]==='function')api[name]=(...args)=>forest[name](...args);
  return {...api,configure,getContext,strategyVersion,finalizeResult,inspect,urgent,analyze,suggestBudget,assessMove,reviewMove,validPV,
    getModel:()=>rules.model,
    getModelInfo:()=>({active:!!rules.model,modelVersion:rules.modelVersion,featureVersion:rules.model?.featureVersion||null,scale:rules.model?.scale||0}),
    getSearchMemoryStats:()=>searchMemory?.stats()||null,
    exportSearchMemory:()=>searchMemory?.snapshot()||null,
    clearSearchMemory:()=>searchMemory?.clear()};
}
if(typeof module!=='undefined')module.exports=createEngine;
