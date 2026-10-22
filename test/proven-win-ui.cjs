'use strict';
// Native browser Workers compute every certificate. Two controlled message
// delivery cases isolate the planner and progress paths from the final path.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.OMOK_PLAYWRIGHT||(process.platform==='win32'?'C:/Users/jiho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright':'playwright'));
const out=path.resolve(process.env.OMOK_WIN_UI_OUT||'work/proven-win-20261021/ui');fs.mkdirSync(out,{recursive:true});
if(!process.env.OMOK_TEST_HTML)execFileSync(process.execPath,['build.cjs','--public','--baseline','--out-dir='+path.join(out,'fixture')],{stdio:'pipe'});
const html=process.env.OMOK_TEST_HTML||path.join(out,'fixture/omok.html'),report={scope:'Generated legal game, native engine Workers; controlled delivery isolates only the indicated transport path.',steps:[]};let browser;
(async()=>{
 browser=await chromium.launch({executablePath:process.env.OMOK_BROWSER||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:980}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'hardwareConcurrency',{value:8});localStorage.setItem('omok-compute-mode','optimized');
  window.__delivery='native';window.__winMessages=[];window.__activeWorkers=new Set();let id=0;const NativeWorker=Worker;
  window.Worker=class extends NativeWorker{
   constructor(...args){super(...args);this.testId=++id;__activeWorkers.add(this.testId);this.addEventListener('message',event=>{
    if(event.data.__forwardedWin)return;
    if(__delivery==='pool-only'&&this.role==='serial'){event.stopImmediatePropagation();return;}
    if(__delivery==='serial-progress'){
     if(this.role!=='serial'){event.stopImmediatePropagation();return;}
     if(event.data.result?.proven){__winMessages.push('serial-progress');
      if(!event.data.progress){event.stopImmediatePropagation();this.dispatchEvent(new MessageEvent('message',{data:{...event.data,progress:true,__forwardedWin:true}}));return;}}
    }
    if(event.data.type==='plan'&&['win','forced'].includes(event.data.result?.kind))__winMessages.push('planner-win');
   });}
   postMessage(data,...args){if(!this.role)this.role=data.type?'pool':'serial';return super.postMessage(data,...args);}
   terminate(){__activeWorkers.delete(this.testId);return super.terminate();}
  };
 });
 await page.goto(pathToFileURL(path.resolve(html)).href);await page.waitForFunction(()=>globalThis.omokComputeReady===true);
 await page.evaluate(()=>new Promise(resolve=>{const d=document.getElementById('setup');if(!d.open){resolve();return;}d.addEventListener('close',resolve,{once:true});d.close();}));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 for(const delivery of ['native','serial-progress','pool-only'])for(const mode of ['fast','auto','deep']){
  if(delivery==='pool-only'&&mode==='fast')continue;
  for(const p of [1,2]){
   const start=Date.now();await page.evaluate(({delivery,mode,p})=>{
    stopWorker();cancelPonder();__delivery=delivery;__winMessages=[];analysisSettings={version:1,mode,manualMs:1000};
    const cells=[111,0,112,2,113,4],game={id:'win-ui-'+delivery+'-'+mode+'-'+p,first:p,me:p,timer:false,rules:{fivePriority:true},axis:'descending',
     events:cells.map((i,k)=>({type:'move',i,p:k%2?3-p:p,legal:true,remaining:40000,time:new Date().toISOString()})),cursor:6,result:null};loadGame(game);
   },{delivery,mode,p});
   await page.waitForFunction(()=>rec?.proven===true&&!worker,undefined,{timeout:7000});
   const result=await page.evaluate(()=>({i:rec.i,pv:rec.pv,status:document.getElementById('analysisState').textContent,
    proven:rec.proven,proofStatus:rec.proofStatus,mode:rec.analysisPolicy.mode,stopReason:rec.analysisWork?.stopReason,
    legal:E.inspect(b,rec.i,turn).legal,validPV:E.validPV(b,turn,rec.pv).length===rec.pv.length,workers:[...__activeWorkers],messages:[...__winMessages]}));
   assert(result.proven&&result.legal&&result.validPV);assert.equal(result.proofStatus,'PROVEN_WIN');assert.equal(result.mode,mode);assert.deepEqual(result.workers,[]);
   assert.match(result.status,/완료.*강제승/);if(delivery==='pool-only')assert(result.messages.includes('planner-win'));
   if(delivery==='serial-progress')assert(result.messages.includes('serial-progress'));
   report.steps.push({delivery,mode,p,elapsedMs:Date.now()-start,...result});
  }
 }
 assert.deepEqual(errors,[]);report.status='passed';await page.screenshot({path:path.join(out,'proven-win.png'),fullPage:true});console.log(JSON.stringify(report));
})().catch(error=>{report.status='failed';report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(out,'proven-win.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();});
