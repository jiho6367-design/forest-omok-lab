const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const {chromium}=require('playwright');
const positions=require('./positions.cjs');
const label=process.argv[2]||'baseline',repeats=Number(process.argv[3]||3),root=path.resolve(__dirname,'../..');
const out=path.join(root,'reports/performance');fs.mkdirSync(out,{recursive:true});
const source=f=>fs.readFileSync(path.join(root,'src',f),'utf8');
const app=source('unified-app.js');
const spawnSource=app.slice(app.indexOf('function spawnAnalysis('),app.indexOf('function acceptResult('));
let reader=source('reader-engine.js').replace('function createEngine(','function createReaderEngine(').replace('entry=tt.get(key)','entry=__ttGet(tt,key)');
let forest=source('forest-engine.js').replace('save=tt.get(key)','save=__ttGet(tt,key)');
const instrumentation='let __tt={lookups:0,hits:0};function __ttGet(t,k){__tt.lookups++;const v=t.get(k);if(v!==undefined)__tt.hits++;return v;}';
const baseEngine=reader+'\n'+forest+'\n'+source('unified-engine.js');
const engine=instrumentation+'\n'+baseEngine+'\nconst __baseCreate=createEngine;createEngine=function(...a){const e=__baseCreate(...a),run=e.analyze;e.analyze=(...args)=>{const r=run(...args);return {...r,benchTT:{...__tt},benchPositionCache:e.getPositionCacheStats?.()};};return e;};';
const modes=[{id:'fast',name:'빠르게',ms:900},{id:'compare',name:'비교',ms:3000},{id:'precise',name:'정밀',ms:/\['7000'/.test(app)?7000:8000},{id:'auto',name:'자동',ms:15000,automatic:true},{id:'deep15',name:'심층15',ms:15000},{id:'deep25',name:'심층25',ms:25000}];
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.OMOK_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const page=await browser.newPage();page.setDefaultTimeout(40000);
 const report={label,engineFingerprint:require('crypto').createHash('sha256').update(baseEngine+app).digest('hex'),started:new Date().toISOString(),commit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),browser:browser.version(),cpu:{model:os.cpus()[0].model,logical:os.cpus().length},repeats,modes,positions:positions.map(({id,kind})=>({id,kind})),rows:[],cancellation:[],ttScope:'alpha-beta TT lookups only; null if worker watchdog terminates before final telemetry',uiScope:'headless Edge main-thread scheduling lag during the real spawnAnalysis worker path; no external-game load synthesized'};
 const save=()=>fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(report,null,2));save();
 await page.setContent('<html><body><button id="heartbeat">UI heartbeat</button><script id="engineSource" type="text/plain"></script></body></html>');
 await page.locator('#engineSource').evaluate((el,text)=>el.textContent=text,engine);
 await page.addScriptTag({content:engine});
 await page.addScriptTag({content:`const E=createEngine({fivePriority:true}),g={rules:{fivePriority:true}},db={lessons:[]};const $=id=>document.getElementById(id);${spawnSource}
window.runJob=(spec,mode)=>new Promise(resolve=>{
 let peak=0,progressCount=0;const lags=[],start=performance.now();let expected=start+20;
 const ticker=setInterval(()=>{const now=performance.now();lags.push(Math.max(0,now-expected));expected=now+20;document.querySelector('#heartbeat').textContent=String(now);},20);
 const before=spec.board.join(''),initial=E.urgent(spec.board,spec.p);const legalCandidates=E.candidates(spec.board).filter(i=>E.inspect(spec.board,i,spec.p).legal).length;
 const plan=mode.automatic?E.suggestBudget(spec.board,spec.p,40000):{ms:mode.ms};const budget=mode.automatic?{automatic:true,ms:Math.min(15000,plan.ms)}:mode.ms;
 const done=(r,error)=>{clearInterval(ticker);lags.sort((a,b)=>a-b);const elapsed=performance.now()-start;
 let invalid=null;if(r?.i!=null&&!E.inspect(spec.board,r.i,spec.p).legal)invalid='illegal recommendation';if(before!==spec.board.join(''))invalid='board mutation';if(r?.i!=null&&E.knownRefutations(spec.board,spec.p).some(x=>x.i===r.i))invalid='known proven loss recommended';
 const pv=r?.pv||[];if(E.validPV(spec.board,spec.p,pv).length!==pv.length)invalid='illegal PV';
 resolve({position:spec.id,mode:mode.id,requested_budget_ms:mode.ms,planned_budget_ms:plan.ms,actual_elapsed_ms:elapsed,depth:r?.depth??0,nodes:r?.nodes??0,nodes_sec:(r?.nodes||0)*1000/elapsed,candidate_count:legalCandidates,returned_candidates:r?.candidates?.length||0,validated_candidates:r?.candidateChecks||[],counter_verification:r?.counterVerification||null,auto_reason:r?.autoReason||null,tt_hit_rate:r?.benchTT?.lookups?r.benchTT.hits/r.benchTT.lookups:null,tt:r?.benchTT||null,position_cache:r?.benchPositionCache||null,workers:1,best_move:r?.i==null?null:E.coord(r.i),score:r?.score??null,pv:pv.map(E.coord),top3:(r?.candidates||[]).slice(0,3).map(x=>({move:E.coord(x.i),score:x.score})),proven:!!r?.proven,lossProven:!!r?.lossProven,timeout:!!r?.timedOut,error:error||null,invalid,progress_count:progressCount,ui_lag_p95_ms:lags.length?lags[Math.floor((lags.length-1)*.95)]:0,ui_lag_max_ms:lags.at(-1)||0});};
 spawnAnalysis(spec.board,spec.p,budget,r=>{progressCount++;},r=>done(r),e=>done(null,e));
});
window.cancelJob=spec=>new Promise(resolve=>{let messages=0,after=0,cancelled=false;const w=spawnAnalysis(spec.board,spec.p,25000,()=>{messages++;if(cancelled)after++;},()=>{if(cancelled)after++;},()=>{});setTimeout(()=>{cancelled=true;const t=performance.now();w.terminate();const api=performance.now()-t;setTimeout(()=>resolve({position:spec.id,cancel_api_ms:api,observation_ms:150,messages_after_cancel:after,progress_before_cancel:messages}),150);},200);});`});
 for(let repeat=0;repeat<repeats;repeat++)for(const spec of positions)for(const mode of modes){
  const r=await page.evaluate(({spec,mode})=>runJob(spec,mode),{spec,mode});r.repeat=repeat;report.rows.push(r);save();console.log(JSON.stringify({label,repeat,position:r.position,mode:r.mode,ms:Math.round(r.actual_elapsed_ms),depth:r.depth,nps:Math.round(r.nodes_sec),move:r.best_move,invalid:r.invalid,timeout:r.timeout}));if(r.invalid||r.error)throw Error(JSON.stringify(r));
 }
 for(let k=0;k<3;k++)report.cancellation.push(await page.evaluate(s=>cancelJob(s),positions.find(p=>p.id==='sixth-move')));
 report.finished=new Date().toISOString();save();await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
