// Both engines use the same board indices. Coordinates are a UI concern:
// index 0 is A1; never reinterpret the numeric records imported from Forest.
function createEngine(options={}) {
  const rules={fivePriority:options.fivePriority!==false};
  const forest=createForestEngine(rules);
  const fast=b=>createReaderEngine(15,b,rules);
  const inspect=(b,i,p)=>![1,2].includes(p)?{legal:false,reason:'돌 색 오류',threes:[],fours:[],win:[]}:forest.inspect(b,i,p);
  function configure(next={}) { rules.fivePriority=next.fivePriority!==false; }
  function validPV(board,p,pv) {
    const copy=board.slice(),out=[];
    for(const i of pv||[]){const s=inspect(copy,i,p);if(!s.legal)break;out.push(i);copy[i]=p;if(s.win.length)break;p=3-p;}
    return out;
  }
  function convert(board,p,r,started) {
    const first=r.moves?.[0],i=first?.i??null;
    const reason=r.kind==='terminal'?'대국 종료':r.kind==='none'?'합법적인 착수 없음':
      r.kind==='win'?'정확한 5목 완성':r.kind==='forced'?'연속 위협 강제승 확인':
      r.kind==='lost'?'강제패배 확인 · 계속 둘 수 있는 합법 후보':
      r.kind==='block'?'상대의 다음 5목을 막는 필수 방어':
      r.kind==='incomplete'?'임시 합법 후보 · 추가 계산 중':'공격과 방어를 비교한 추천';
    return {i,reason,depth:r.depth||0,nodes:r.nodes||0,ms:Date.now()-started,score:first?.score||0,
      pv:validPV(board,p,first?.pv),proven:['win','forced'].includes(r.kind),lossProven:r.kind==='lost',forcedLoss:r.kind==='lost',
      threats:r.danger||[],shape:i==null?null:inspect(board,i,p),urgent:r.kind==='win'||!!r.mandatoryDefense||(r.kind==='lost'&&!!r.danger?.length),
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
    const count=board.filter(Boolean).length,cap=count<6?2500:8000;
    return {ms:Math.max(30,Math.min(cap,remaining-3000)),automatic:true,reason:'최대 '+cap/1000+'초 · 후보 안정 시 조기 종료'};
  }
  function analyze(board,p,budget='auto',lessons=[],progress=()=>{}) {
    lessons=lessons.filter(l=>(l.rules?.fivePriority!==false)===rules.fivePriority);
    const started=Date.now(),automatic=budget==='auto'||budget?.automatic===true;
    const limit=automatic?(budget?.ms||8000):Math.max(30,Number(budget)||1000);
    const deep=!automatic&&limit>8000;
    const e=fast(board);
    let best=convert(board,p,e.analyze(p,automatic?{automatic:true,maxMs:limit}:deep?Math.min(2000,limit*.2):limit,
      r=>progress(convert(board,p,r,started))),started);
    const can=forest.canonical(board,p),memory=lessons.filter(l=>l.key===can.key);
    best.memory=memory.length;
    best.patternHint=forest.patternDefense(board,p)?.i??null;
    if(!deep||best.proven||best.lossProven||best.kind==='terminal'||best.i==null)return best;
    progress({...best,reason:best.reason+' · 심층 위협 검사 중'});
    const remaining=limit-(Date.now()-started);
    if(remaining>50){
      const extended=forest.analyze(board,p,remaining,lessons);
      if(extended.i!=null&&inspect(board,extended.i,p).legal){
        // A finite-width search score is not a proof. Only the engine's
        // separately verified forcing certificates set proven/lossProven.
        const pv=validPV(board,p,extended.pv);
        best={...extended,pv,proven:!!extended.proven&&pv.length===(extended.pv||[]).length,
          candidates:[{i:extended.i,pv,score:extended.score,status:extended.lossProven?'fallback':'deep'}],
          engineVersion:'unified-4.0-deep',automatic:false};
      }else{
        const rejected=new Set((extended.rejected||[]).map(m=>m.i));
        const alternative=best.candidates.find(m=>!rejected.has(m.i));
        if(alternative)best={...best,i:alternative.i,pv:alternative.pv,score:alternative.score};
        best.reason+=' · 심층 검사 미완료, 합법 후보 유지';best.fallback=true;
        best.rejected=[...(best.rejected||[]),...(extended.rejected||[])];
      }
    }
    best.ms=Date.now()-started;
    return best;
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
