'use strict';
// Native serial and pool Workers analyze a generated quiet winner. Holding
// serial transport isolates the pool's actual all-replies win check; no result,
// score, candidate, certificate, or engine computation is fabricated.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.OMOK_PLAYWRIGHT||(process.platform==='win32'?'C:/Users/jiho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright':'playwright'));
const rules=require('../tools/counter-rules.cjs'),serialize=require('../tools/counter-dag.cjs'),verify=require('../tools/verify-counter.cjs');
const idx=c=>(Number(c.slice(1))-1)*15+c.charCodeAt(0)-65,out=path.resolve(process.env.OMOK_CANDIDATE_WIN_UI_OUT||'work/candidate-win-20261023/ui'),fixture=path.join(out,'fixture');
fs.mkdirSync(out,{recursive:true});execFileSync(process.execPath,['build.cjs','--public','--baseline','--out-dir='+fixture],{stdio:'pipe'});
const report={scope:'Public baseline build; generated quiet G8 winner; native Workers with ordinary delivery and separately held serial messages. All actual opponent replies independently verified.',steps:[]};let browser;
function board(attacker){const b=Array(225).fill(0);for(const c of ['E8','F8'])b[idx(c)]=attacker;for(const c of 'C8 D7 D9 C7 E9 H7 G7 I9 H9'.split(' '))b[idx(c)]=3-attacker;return b;}
function independent(b,p,proof){
 assert.equal(proof.type,'all-legal-replies');assert(proof.complete);assert.equal(proof.move,idx('G8'));assert.equal(proof.attacker,p);assert.equal(proof.defender,3-p);assert.equal(proof.entryBoardKey,b.join(''));
 const after=b.slice();after[proof.move]=p;assert.equal(proof.replyBoardKey,after.join(''));const R=rules(after),legal=Array.from({length:225},(_,i)=>i).filter(i=>R.legal(i,3-p));
 assert.equal(legal.length,208);assert.equal(proof.checkedReplies,legal.length);assert.deepEqual(proof.branches.map(r=>r.i).sort((a,b)=>a-b),legal);
 const checked=verify(b,serialize({type:'move',i:proof.move,forced:false,branches:proof.branches},{attacker:p}),{loss:false,limitMs:5000});
 assert(checked.verified,checked.error);assert(checked.boardRestored);assert.equal(checked.stats.defenses,208);return checked;
}
(async()=>{
 browser=await chromium.launch({executablePath:process.env.OMOK_BROWSER||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:980}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'hardwareConcurrency',{value:8});localStorage.setItem('omok-compute-mode','optimized');
  window.__delivery='native';window.__workerTrace=[];window.__activeWorkers=new Set();let id=0;const NativeWorker=Worker;
  window.Worker=class extends NativeWorker{
   constructor(...args){super(...args);this.testId=++id;__activeWorkers.add(this.testId);this.addEventListener('message',event=>{
    const d=event.data,held=__delivery==='pool-only'&&this.role==='serial';
    __workerTrace.push({event:'message',id:this.testId,role:this.role,held,type:d.type||null,progress:!!d.progress,proven:!!d.result?.proven,i:d.result?.i??d.i??null,score:d.result?.score??null,depth:d.result?.depth??null,candidateWinChecks:d.result?.candidateWinChecks||null,
     checkProven:!!d.check?.proof,checkReplies:d.check?.proof?.checkedReplies||null});
    if(held)event.stopImmediatePropagation();
   });}
   postMessage(data,...args){if(!this.role)this.role=data.type?'pool':'serial';__workerTrace.push({event:'request',id:this.testId,role:this.role,type:data.type||'analyze'});return super.postMessage(data,...args);}
   terminate(){__activeWorkers.delete(this.testId);__workerTrace.push({event:'terminate',id:this.testId,role:this.role});return super.terminate();}
  };
 });
 await page.goto(pathToFileURL(path.join(fixture,'omok.html')).href);await page.waitForFunction(()=>globalThis.omokComputeReady===true);
 // dialog.close queues an application close handler which can start another
 // analysis. Drain that event while no generated game exists, before owning a
 // foreground Worker; otherwise it can cancel the test request mid-proof.
 await page.evaluate(()=>new Promise(resolve=>{const d=document.getElementById('setup');if(!d.open){resolve();return;}d.addEventListener('close',resolve,{once:true});d.close();}));
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.match(await page.title(),/my오목/);assert(await page.evaluate(()=>E.getModel()===null));
 for(const delivery of ['native','pool-only'])for(const mode of ['auto','deep'])for(const attacker of [1,2]){
  const input=board(attacker),budget=mode==='auto'?15000:25000,start=Date.now();
  const observed=await page.evaluate(({input,p,mode,budget,delivery})=>new Promise((resolve,reject)=>{
   stopWorker();cancelPonder();spawnAnalysis.memory=null;__delivery=delivery;__workerTrace=[];
   // This is an explicit generated analysis state, not an imported legal game
   // history. The engine evaluates the supplied actual side to move.
   b=input.slice();turn=p;g={id:'candidate-win-'+delivery+'-'+mode+'-'+p,me:p,first:p,rules:{fivePriority:true},result:null};
   events=[];cursor=0;paused=true;reviewing=false;rec=null;E.configure({firstPlayer:p,model:null});
   analysisSettings={version:1,mode,manualMs:1000};syncAnalysisSettingsUI();currentAnalysisPolicy={mode,externalMs:budget,role:'own'};
   const original=b.slice(),provisional=[];let completions=0,task;
   const timer=setTimeout(()=>{const diagnostic={timeout:true,delivery,mode,p,provisional,trace:[...__workerTrace],workersBeforeCancel:[...__activeWorkers]};task?.terminate();worker=null;resolve(diagnostic);},8000);
   task=spawnAnalysis(b,p,{mode,automatic:mode==='auto',ms:budget},r=>{
    acceptResult(r,true);provisional.push({i:r.i,depth:r.depth,score:r.score,proven:!!r.proven,status:document.getElementById('analysisState').textContent});
   },result=>{
    completions++;clearTimeout(timer);worker=null;acceptResult(result);const proof=result.proof;
    setTimeout(()=>resolve({result,provisional,completions,status:document.getElementById('analysisState').textContent,
     legal:E.inspect(b,result.i,p).legal,validPV:E.validPV(b,p,result.pv).length===result.pv.length,
     unchanged:JSON.stringify(b)===JSON.stringify(original),workers:[...__activeWorkers],trace:[...__workerTrace],
     checkedReplies:proof?.checkedReplies||null}),50);
   },error=>{clearTimeout(timer);worker=null;reject(Error(error));});worker=task;
  }),{input,p:attacker,mode,budget,delivery});
  if(observed.timeout){report.failedObservation=observed;assert.fail('quiet candidate '+delivery+'/'+mode+' did not complete early: '+JSON.stringify(observed));}
  const r=observed.result;assert(r.proven&&!r.lossProven);assert.equal(r.i,idx('G8'));assert.equal(r.proofStatus,'PROVEN_WIN');assert.equal(r.analysisWork.stopReason,'verified-win');
  assert(!r.timedOut&&!r.analysisIncomplete);assert(observed.legal&&observed.validPV&&observed.unchanged);assert.equal(observed.completions,1);assert.deepEqual(observed.workers,[]);assert.match(observed.status,/완료.*강제승/);
  const checked=independent(input,attacker,r.proof),requested=new Set(observed.trace.filter(t=>t.event==='request').map(t=>t.id)),terminated=new Set(observed.trace.filter(t=>t.event==='terminate').map(t=>t.id));
  assert(requested.size>=4,'serial and three pool Workers must actually run');for(const id of requested)assert(terminated.has(id),'every request Worker must be terminated');
  if(delivery==='pool-only'){
   assert(observed.trace.some(t=>t.event==='message'&&t.role==='serial'&&t.held),'serial messages really were held');
   assert(observed.trace.some(t=>t.event==='request'&&t.type==='win-check'),'pool schedules a candidate certificate');
   assert(observed.trace.some(t=>t.event==='message'&&t.type==='win-check'&&t.checkProven&&t.checkReplies===208),'the pool itself computed the complete quiet-win certificate');
   assert.equal(r.parallel.stopReason,'verified-win');assert(observed.provisional.some(v=>v.i===idx('G8')&&v.score>=5e6&&!v.proven),'a real mate-like G8 comparison precedes its proof');
  }
  report.steps.push({delivery,mode,attacker,elapsedMs:Date.now()-start,i:r.i,pv:r.pv,proofStatus:r.proofStatus,verifiedReplies:checked.stats.defenses,
   source:r.analysisWork.source,stopReason:r.analysisWork.stopReason,poolCertificate:observed.trace.some(t=>t.type==='win-check'&&t.checkProven),
   provisionalMate:observed.provisional.some(v=>v.i===idx('G8')&&v.score>=5e6&&!v.proven),heldSerialMessages:observed.trace.filter(t=>t.held).length,
   workersRequested:requested.size,workersRemaining:observed.workers.length,status:observed.status});
 }
 assert.deepEqual(errors,[]);report.status='passed';console.log(JSON.stringify(report));
})().catch(error=>{report.status='failed';report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(out,'candidate-win.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();});
