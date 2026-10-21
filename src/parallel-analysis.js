// CPU root parallelism. Only a complete equal-depth round may replace the
// recommendation. The ordinary engine continues to discover forcing proofs.
const OmokParallel=(()=>{
 // Reader's plan may finish with a forcing certificate before it ever builds
 // a comparison frontier. Preserve that proof instead of treating it as an
 // empty plan. A bounded mate-like score alone never enters this path.
 function readerVictory(result){
  const first=result?.moves?.[0],kind=result?.kind;
  if(!first||!(kind==='win'&&first.status==='win'||kind==='forced'&&first.status==='proven'&&result.proof==='forcing-four')||
    !Number.isInteger(first.i)||!Array.isArray(first.pv)||first.pv[0]!==first.i||!first.pv.every(i=>Number.isInteger(i)&&i>=0&&i<225))return null;
  return {i:first.i,pv:first.pv,score:first.score,depth:result.depth||0,nodes:result.nodes||0,
   kind,proven:true,lossProven:false,forcedLoss:false,urgent:kind==='win',comparisonSource:'reader',
   proof:{type:kind==='win'?'exact-five':'forcing-four',source:'parallel-plan'},
   reason:kind==='win'?'정확한 5목 완성':'연속 위협 강제승 확인',
   candidates:result.moves.map(m=>({...m,depth:result.depth||0,comparisonSource:'reader'})),
   rejected:result.rejectedMoves||[],rootWork:result.rootWork};
 }
 function checkFinalists(engine,board,p,rows,ms,onCheck=()=>{}){
  const deadline=performance.now()+Math.max(1,ms),checks=[];
  for(let k=0;k<rows.length&&performance.now()<deadline-20;k++){
   const m=rows[k],after=board.slice();if(!engine.inspect(board,m.i,p).legal)continue;after[m.i]=p;
   const start=performance.now(),slice=(deadline-start-20)/(rows.length-k),end=start+slice;
   const direct=engine.forcing(after,3-p,25,Math.max(1,Math.min(500,slice*.3)));
   const trap=direct.proof||!direct.complete||performance.now()>=end?null:engine.inspect(board,m.i,p).fours.length?
    engine.forcedReplyTrap(after,p,Math.max(1,end-performance.now()),null,25,true):engine.quietTrap(after,p,Math.max(1,end-performance.now()),14,25,true);
   const proof=direct.proof||trap?.proof,check={i:m.i,complete:!!proof||!!direct.complete&&!!trap?.complete,refuted:!!proof,ms:performance.now()-start,
    ...(proof?{rejection:{i:m.i,pv:direct.proof?.pv||[],replyTrap:trap?.proof||null,verifiedRefutation:true,reason:'병렬 후보 최종 응수 검사에서 상대 강제승 확인'}}:{})};
   checks.push(check);onCheck(check);
  }
  return checks;
 }
 function mergeRound(roots,parts,depth,bad=new Set()){
  const expected=new Set(roots.map(r=>r.i)),seen=new Set(),rows=[];
  if(parts.some(p=>!p.complete))return null;
  for(const part of parts)for(const row of part.rows){
   if(!expected.has(row.i)||seen.has(row.i)||row.depth!==depth||!row.comparisonComplete||!Number.isFinite(row.score)||row.pv?.[0]!==row.i)return null;
   seen.add(row.i);if(!bad.has(row.i))rows.push(row);
  }
  if(seen.size!==expected.size||!rows.length)return null;
  const order=new Map(roots.map((r,k)=>[r.i,k]));return rows.sort((a,b)=>b.score-a.score||order.get(a.i)-order.get(b.i));
 }
 const workerCode=`
 const checkFinalists=${checkFinalists.toString()};
 let reader=null,memory=null;
 onmessage=e=>{const m=e.data;try{
  if(m.type==='guard'){const engine=createEngine(m.base.options);const checks=checkFinalists(engine,m.base.b,m.base.p,m.roots,m.ms,check=>postMessage({type:'guard-progress',check}));postMessage({type:'guard',checks});return;}
  if(!reader){memory=typeof OmokSearchMemory!=='undefined'?OmokSearchMemory.create({snapshot:m.base.searchMemory}):null;
   reader=createReaderEngine(15,m.base.b,{...m.base.options,searchMemory:memory,memoryManaged:true,exportRootFrontier:true});}
  if(m.type==='plan'){const result=reader.analyze(m.base.p,700);postMessage({type:'plan',result});}
  else{const result=reader.compareRoots(m.base.p,m.roots,m.depth,m.ms);postMessage({type:'round',round:m.round,result,searchMemory:memory?.delta(1024)});}
 }catch(error){postMessage({error:String(error)});}};`;
 function start({source,base,budget,mode,onProgress,onDone,onError,hardware=globalThis.navigator?.hardwareConcurrency||1}){
  if(!['auto','deep'].includes(mode)||budget<3000||hardware<6||typeof Worker==='undefined')return null;
  base={...base,options:{...base.options,rootWidth:mode==='deep'?32:24}};
  const started=performance.now(),guardDeadline=started+Math.max(30,budget-100),deadline=guardDeadline-Math.min(1200,budget*.12),count=Math.min(3,hardware-2),workers=[],bad=new Set(),rounds=[];
  let stopped=false,guarding=false,guardReason=null,roots=null,seed=null,round=0,depth=1,parts=[],latest=null,lastRows=[],timer,serial=null;const checks=[];
  const close=()=>{if(stopped)return;stopped=true;clearTimeout(timer);for(const w of workers)w.terminate();};
  const fail=error=>{if(stopped)return;close();onError(error,serial);};
  const finish=reason=>{if(stopped)return;const rows=lastRows.filter(r=>!bad.has(r.i)),first=rows[0],result=latest&&first?{...latest,i:first.i,score:first.score,pv:first.pv,candidates:rows.slice(0,3),candidateChecks:checks,rejected:checks.filter(c=>c.rejection).map(c=>c.rejection)}:null;close();if(result)onDone({...result,parallel:{...result.parallel,elapsedMs:Math.round(performance.now()-started),stopReason:reason},analysisWork:{...result.analysisWork,elapsedMs:Math.round(performance.now()-started),checkedCandidates:checks.filter(c=>c.complete).length,stopReason:reason},analysisIncomplete:reason==='time-limit'||reason==='incomplete-round'||reason==='guard-time-limit'||!checks.some(c=>c.i===result.i&&c.complete)});else onError('병렬 비교 깊이 미완료',serial);};
  const done=reason=>{if(stopped||guarding)return;guarding=true;guardReason=reason;clearTimeout(timer);for(const w of workers)w.terminate();
   const finalDeadline=Math.min(guardDeadline,performance.now()+1200),remaining=finalDeadline-performance.now()-30,candidates=lastRows.filter(r=>!bad.has(r.i)).slice(0,3);if(!candidates.length||remaining<=0){finish(reason);return;}
   try{const url=URL.createObjectURL(new Blob([source+'\n'+workerCode],{type:'text/javascript'}));let w;try{w=new Worker(url);workers.push(w);}finally{URL.revokeObjectURL(url);}w.onmessage=e=>receive(-1,e.data);w.onerror=e=>{if(!stopped)finish('guard-time-limit');};timer=setTimeout(()=>finish('guard-time-limit'),Math.max(1,finalDeadline-performance.now()));w.postMessage({type:'guard',base,roots:candidates,ms:remaining});}catch{finish('guard-time-limit');}
  };
  const dispatch=()=>{
   const ms=deadline-performance.now()-30;if(ms<=0){done('time-limit');return;}
   const groups=Array.from({length:Math.min(count,roots.length)},()=>[]);roots.forEach((r,k)=>groups[k%groups.length].push(r));parts=Array(groups.length).fill(null);round++;
   for(let k=0;k<groups.length;k++)workers[k].postMessage({type:'compare',base,roots:groups[k],depth,round,ms});
  };
  const receive=(k,data)=>{
   if(stopped)return;if(data.error){if(guarding)finish('guard-time-limit');else fail(data.error);return;}
   if(data.type==='guard-progress'){if(!checks.some(c=>c.i===data.check.i))checks.push(data.check);if(data.check.refuted){bad.add(data.check.i);onProgress({...latest,rejected:checks.filter(c=>c.rejection).map(c=>c.rejection)});}return;}
   if(data.type==='guard'){finish(guardReason);return;}if(guarding)return;
   if(data.type==='plan'){
    seed=data.result;const victory=readerVictory(seed);
    if(victory&&!bad.has(victory.i)){
     close();onDone({...victory,modelVersion:base.modelInfo?.modelVersion,learnedEvaluation:!!base.modelInfo?.active,automatic:mode==='auto',
      analysisWork:{mode,budgetMs:budget,elapsedMs:Math.round(performance.now()-started),completedDepth:victory.depth,
       nodes:victory.nodes,source:'parallel-plan',stopReason:'verified-win'}});return;
    }
    roots=seed.rootFrontier?.filter(r=>!bad.has(r.i));
    if(!roots?.length){fail('병렬 비교 후보 없음');return;}dispatch();return;
   }
   if(data.round!==round||parts[k])return;parts[k]=data.result;
   if(parts.some(p=>!p))return;
   const compared=mergeRound(roots,parts,depth,bad);if(!compared){done('incomplete-round');return;}
   lastRows=compared;const best=compared[0],info=base.modelInfo||{};
   latest={i:best.i,score:best.score,depth,nodes:parts.reduce((n,p)=>n+p.nodes,0),pv:best.pv,
    kind:'search',comparisonSource:'reader',candidates:compared.slice(0,3),rejected:[],proven:false,lossProven:false,automatic:mode==='auto',
    modelVersion:info.modelVersion,learnedEvaluation:!!info.active,
    reason:'CPU 병렬 후보 비교 · 완료 깊이 '+depth,screeningComplete:seed.screeningComplete,forcingChecksComplete:seed.forcingChecksComplete,
    rootWork:{generated:seed.rootWork?.generated||roots.length,compared:roots.length,screened:seed.rootWork?.screened||0},
    parallel:{workers:parts.length,depth,completedRoots:roots.length,elapsedMs:Math.round(performance.now()-started),stopReason:'searching'},
    analysisWork:{mode,budgetMs:budget,elapsedMs:Math.round(performance.now()-started),completedDepth:depth,source:'parallel-reader',roots:{compared:roots.length},stopReason:'searching'}};
   onProgress(latest,data.searchMemory);
   rounds.push({i:best.i,score:best.score,depth,pv:best.pv.slice(0,3),ranking:compared.slice(0,3).map(m=>m.i),gap:compared.length>1?best.score-compared[1].score:null});
   if(mode==='auto'&&typeof autoStable==='function'&&autoStable(rounds,depth,performance.now()-started,seed,compared)){done('stable-completed-rounds');return;}
   if(depth>=10){done('depth-limit');return;}depth++;dispatch();
  };
  try{
   const url=URL.createObjectURL(new Blob([source+'\n'+workerCode],{type:'text/javascript'}));
   try{for(let k=0;k<count;k++){const w=new Worker(url);w.onmessage=e=>receive(k,e.data);w.onerror=e=>fail(e.message||'병렬 Worker 오류');workers.push(w);}}finally{URL.revokeObjectURL(url);}
   timer=setTimeout(()=>done('time-limit'),Math.max(1,deadline-performance.now()));workers[0].postMessage({type:'plan',base});
  }catch(error){fail(String(error));return null;}
  return {terminate:close,observe(result){serial=result;for(const m of result?.rejected||[])if(!m.riskOnly&&(m.verifiedRefutation||m.pv?.length||m.line?.length||m.replyTrap))bad.add(m.i);},get latest(){return latest;}};
 }
 return {start,mergeRound,checkFinalists,readerVictory};
})();
if(typeof module!=='undefined')module.exports=OmokParallel;
