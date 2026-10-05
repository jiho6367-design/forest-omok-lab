'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const runtime='C:/Users/jiho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const {chromium}=require(process.env.OMOK_PLAYWRIGHT||runtime);
const sourceFiles=['gpu-patterns.js','strategy-engine.js','reader-engine.js','forest-engine.js','unified-engine.js'];
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function sources(root){
 const files=sourceFiles.filter(f=>fs.existsSync(path.join(root,'src',f))),text=Object.fromEntries([...files,'app.js','unified-app.js','gpu-app.js','template.html'].map(f=>[f,fs.readFileSync(path.join(root,'src',f),'utf8')]));
 const engine=files.map(f=>f==='reader-engine.js'?text[f].replace('function createEngine(','function createReaderEngine('):text[f]).join('\n');
 const app=text['unified-app.js'],start=app.indexOf('function spawnAnalysis('),end=app.indexOf('function acceptResult(',start);
 if(start<0||end<0)throw Error('Cannot extract actual application Worker path');
 return {engine,spawn:app.slice(start,end),app,text,fingerprint:sha(JSON.stringify(text))};
}
async function createBrowser({baselineRoot,candidateRoot,compute='gpu',manifest}){
 const versions={baseline:sources(baselineRoot),improved:sources(candidateRoot)};
 for(const [f,expected] of Object.entries(manifest.baselineSources))if(sha(versions.baseline.text[f])!==expected)throw Error('Baseline changed: '+f);
 const browser=await chromium.launch({executablePath:process.env.OMOK_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const pages={};let preparation;
 try{
  for(const version of ['baseline','improved']){
   const page=await browser.newPage();pages[version]=page;page.setDefaultTimeout(40000);
   await page.goto(pathToFileURL(path.join(baselineRoot,'src/template.html')).href);
   await page.setContent('<html><body><script id="engineSource" type="text/plain"></script></body></html>');
   await page.locator('#engineSource').evaluate((el,text)=>el.textContent=text,versions[version].engine);
   await page.addScriptTag({content:versions[version].engine});
   if(version==='baseline')preparation=await page.evaluate(async requested=>{
    const start=performance.now();if(requested==='cpu')return {mode:'cpu',table:null,totalMs:performance.now()-start};
    if(requested==='optimized')return {mode:'optimized',table:Array.from(OmokGPU.cpu()),totalMs:performance.now()-start,verifiedPatterns:OmokGPU.SIZE};
    try{const prepared=await OmokGPU.prepare();return {...prepared,table:Array.from(prepared.table),mode:'gpu'};}
    catch(error){return {mode:'cpu',table:null,totalMs:performance.now()-start,fallbackReason:String(error)};}
   },compute);
   await page.evaluate(data=>globalThis.omokAcceleration={mode:data.mode,table:data.table?new Uint32Array(data.table):null,optimized:data.mode!=='cpu'},preparation);
   // The actual app's Worker function remains unchanged. Its game context is
   // populated per request; pondering and clocks are absent in this harness.
   await page.addScriptTag({content:`let E=createEngine({fivePriority:true,patternTable:omokAcceleration.table,optimized:omokAcceleration.optimized});let g={first:1,firstPlayer:1,rules:{fivePriority:true},moves:[]};const db={lessons:[]},$=id=>document.getElementById(id);let ponder=null;${versions[version].spawn}
window.strategyPlan=spec=>createEngine({firstPlayer:spec.firstPlayer,fivePriority:true,patternTable:omokAcceleration.table,optimized:omokAcceleration.optimized}).suggestBudget(spec.board,spec.p,40000);
window.strategyJob=(spec,budget)=>new Promise(resolve=>{
 g={first:spec.firstPlayer,firstPlayer:spec.firstPlayer,rules:{fivePriority:true},moves:spec.history||spec.moves||[]};
 E=createEngine({firstPlayer:spec.firstPlayer,fivePriority:true,patternTable:omokAcceleration.table,optimized:omokAcceleration.optimized});
 const progress=[],start=performance.now(),before=spec.board.join('');let worker,finished=false,outer,observedWorkerFailure=null;
 const done=(r,error)=>{if(finished)return;finished=true;clearTimeout(outer);let invalid=null;
  if(before!==spec.board.join(''))invalid='board-mutation';
  if(r?.i!=null&&!E.inspect(spec.board,r.i,spec.p).legal)invalid='illegal-recommendation';
  if(r?.pv&&E.validPV(spec.board,spec.p,r.pv).length!==r.pv.length)invalid='illegal-pv';
  if(progress.some(x=>!x.legal))invalid='illegal-progress-recommendation';
  if(r?.i!=null&&!r.lossProven&&E.knownRefutations(spec.board,spec.p).some(m=>m.i===r.i))invalid='verified-refutation-recommended';
  resolve({result:r||null,error:error||observedWorkerFailure||null,invalid,elapsedMs:performance.now()-start,progress});};
 const limit=typeof budget==='object'?budget.ms:budget;
 outer=setTimeout(()=>{worker?.terminate();done(null,'outer-worker-timeout');},limit+500);
 try{worker=spawnAnalysis(spec.board,spec.p,budget,r=>{const legal=r?.i==null||E.inspect(spec.board,r.i,spec.p).legal;progress.push({i:r?.i,depth:r?.depth,kind:r?.kind,proven:!!r?.proven,lossProven:!!r?.lossProven,legal,proofStatus:r?.proofStatus});},r=>done(r),error=>done(null,error));const onerror=worker.onerror,onmessage=worker.onmessage;worker.onerror=e=>{observedWorkerFailure=e.message||'worker-error';onerror?.(e);};worker.onmessage=e=>{if(e.data.error)observedWorkerFailure=e.data.error;onmessage?.(e);};}catch(error){done(null,String(error));}
});`});
  }
 }catch(error){await browser.close();throw error;}
 const {table,...gpu}=preparation;
 return {metadata:{browser:browser.version(),gpu,computeRequested:compute,versions:Object.fromEntries(Object.entries(versions).map(([k,v])=>[k,{fingerprint:v.fingerprint}]))},
  async budget(spec,mode){if(!mode.automatic)return mode.ms;const plan=await pages.baseline.evaluate(spec=>strategyPlan(spec),spec);return {automatic:true,ms:Math.max(30,Math.min(15000,plan.ms))};},
  async analyze(version,spec,budget){return pages[version].evaluate(({spec,budget})=>strategyJob(spec,budget),{spec,budget});},
  close:()=>browser.close()};
}
module.exports={createBrowser,sources,sha};
