// Shared UI policy only; the engine's automatic planner and search are unchanged.
(function(root){
  const KEY='omok-analysis-settings',COMPUTE_KEY='omok-compute-mode';
  const MIN_MS=900,MAX_MS=25000,labels={fast:'아주 빠르게 · 약 1초',auto:'자동',deep:'심층 · 최대 25초',custom:'직접 설정'};
  const manual=ms=>Number.isFinite(ms)&&ms>=MIN_MS&&ms<=MAX_MS;
  const valid=s=>!!s&&s.version===1&&Object.hasOwn(labels,s.mode)&&manual(s.manualMs);
  const defaults=()=>({version:1,mode:'auto',manualMs:1000});
  const read=(storage,key)=>{try{return storage?.getItem(key);}catch{return null;}};
  function save(storage,state){try{storage.setItem(KEY,JSON.stringify(state));return true;}catch{return false;}}
  function load(storage,{compute='gpu',budget='auto'}={}){
    let saved;try{saved=JSON.parse(read(storage,KEY));}catch{}
    if(valid(saved))return {state:{version:1,mode:saved.mode,manualMs:saved.manualMs},saved:true,migrated:false};
    const profile=read(storage,'omok-gpu-profile'),mapped={optimized:'auto',fast:'fast',deep:'deep'};
    const state=defaults();
    if(compute==='gpu'&&Object.hasOwn(mapped,profile))state.mode=mapped[profile];
    else if(budget==='auto')state.mode='auto';
    else if(Number(budget)===900)state.mode='fast';
    else if(Number(budget)===25000)state.mode='deep';
    else if(manual(Number(budget))){state.mode='custom';state.manualMs=Number(budget);}
    return {state,saved:save(storage,state),migrated:true};
  }
  const label=s=>s.mode==='custom'?`직접 설정 · ${s.manualMs/1000}초`:labels[s.mode];
  function resolve(state,board,p,available,planner){
    state=valid(state)?state:defaults();available=Number.isFinite(available)?Math.max(0,available):40000;
    const normal=state.mode==='auto'?planner(board,p,40000):{ms:state.mode==='fast'?900:state.mode==='deep'?25000:state.manualMs,reason:'선택한 분석 모드'};
    const planned=state.mode==='auto'?planner(board,p,available):normal;
    const requested=Math.max(30,Math.min(MAX_MS,Number(normal.ms)||30));
    const ms=Math.max(30,Math.min(requested,Number(planned.ms)||30,available-3000));
    const internalMs=Math.max(30,ms-Math.min(1500,Math.max(60,ms*.06)));
    return {mode:state.mode,selectedLabel:label(state),requestedMs:requested,externalMs:ms,internalMs,clockLimited:ms<requested&&available<40000,
      reason:normal.reason||'국면별 시간 정책',budget:state.mode==='auto'?{automatic:true,ms}:ms};
  }
  root.OmokAnalysisSettings={KEY,COMPUTE_KEY,MIN_MS,MAX_MS,labels,valid,defaults,read,save,load,label,resolve};
  if(typeof module!=='undefined')module.exports=root.OmokAnalysisSettings;
})(globalThis);
