'use strict';
// Public baseline build, generated positions, and native browser Workers only.
// The deliberately nominated finalist isolates the real guard from move
// ordering. Ordinary mode checks below do not inject a recommendation.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.OMOK_PLAYWRIGHT||(process.platform==='win32'?'C:/Users/jiho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright':'playwright'));
const serialize=require('../tools/counter-dag.cjs'),verify=require('../tools/verify-counter.cjs'),rules=require('../tools/counter-rules.cjs');
const idx=c=>(Number(c.slice(1))-1)*15+c.charCodeAt(0)-65,out=path.resolve(process.env.OMOK_FORBIDDEN_UI_OUT||'work/forbidden-trap-20261023/ui');
const fixture=path.resolve('work/forbidden-trap-20261023/ui-fixture');fs.mkdirSync(out,{recursive:true});
execFileSync(process.execPath,['build.cjs','--public','--baseline','--out-dir='+fixture],{stdio:'pipe'});
const html=path.join(fixture,'omok.html'),report={scope:'Public baseline HTML, generated analysis positions, native Edge Workers. A legal attacking alternative is not a proof against every actual opponent response.',steps:[]};
function board(defender){const b=Array(225).fill(0);for(const c of 'C8 D7 D9 C7 E9 H7 G7 I9'.split(' '))b[idx(c)]=defender;for(const c of 'E8 F8 K2 K3 B2 B3 M12 M13 B12 B13 H13 H14'.split(' '))b[idx(c)]=3-defender;return b;}
function verifyProof(b,p,proof){const result=verify(b,serialize(proof,{attacker:p}),{loss:false,limitMs:5000});assert(result.verified,result.error);assert(result.boardRestored);return result;}
let browser;
(async()=>{
 browser=await chromium.launch({executablePath:process.env.OMOK_BROWSER||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:980}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'hardwareConcurrency',{value:8});localStorage.setItem('omok-compute-mode','optimized');
  window.__activeWorkers=new Set();let id=0;const NativeWorker=Worker;
  window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.testId=++id;__activeWorkers.add(this.testId);}terminate(){__activeWorkers.delete(this.testId);return super.terminate();}};
 });
 await page.goto(pathToFileURL(html).href);await page.waitForFunction(()=>globalThis.omokComputeReady===true);
 if(await page.locator('#setup').evaluate(d=>d.open))await page.locator('#cancelSetup').click();
 assert.match(await page.title(),/my오목/);assert(await page.evaluate(()=>E.getModel()===null));
 for(const defender of [1,2]){
  const b=board(defender),start=Date.now();
  const native=await page.evaluate(({b,defender,bad,good})=>new Promise((resolve,reject)=>{
   stopWorker();cancelPonder();const code=document.getElementById('engineSource').textContent+'\nconst checkFinalists='+OmokParallel.checkFinalists.toString()+`;\n
    onmessage=e=>{try{const {b,p,bad,good}=e.data,copy=b.slice(),engine=createForestEngine({model:null,strategy:false,optimized:true,counterProofDetails:true});
     const checks=checkFinalists(engine,b,p,[{i:bad},{i:good}],1200);postMessage({checks,unchanged:JSON.stringify(b)===JSON.stringify(copy),
      badLegal:engine.inspect(b,bad,p).legal,goodLegal:engine.inspect(b,good,p).legal});}catch(error){postMessage({error:String(error)});}};`;
   const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));let w;try{w=new Worker(url);}finally{URL.revokeObjectURL(url);}
   const timer=setTimeout(()=>{w.terminate();reject(Error('native forbidden finalist guard timeout'));},5000);
   w.onmessage=e=>{clearTimeout(timer);w.terminate();if(e.data.error)reject(Error(e.data.error));else resolve({...e.data,workers:[...__activeWorkers]});};
   w.onerror=e=>{clearTimeout(timer);w.terminate();reject(Error(e.message));};w.postMessage({b,p:defender,bad,good});
  }),{b,defender,bad:idx('H9'),good:idx('H8')});
  const bad=native.checks.find(c=>c.i===idx('H9')),good=native.checks.find(c=>c.i===idx('H8'));
  assert(native.unchanged&&native.badLegal&&native.goodLegal);assert.deepEqual(native.workers,[]);
  assert(bad?.refuted&&bad.complete&&bad.rejection.verifiedRefutation);assert(good&&!good.refuted);
  const after=b.slice();after[idx('H9')]=defender;const trap=bad.rejection.forbiddenTrap;assert(trap.complete&&trap.proof);
  assert.equal(trap.proof.i,idx('G8'));assert.equal(trap.proof.checkedReplies,198);const checked=verifyProof(after,3-defender,trap.proof);assert.equal(checked.stats.defenses,198);
  const witness=rules(after);let p=3-defender;for(const i of trap.proof.forbiddenLine){assert(witness.legal(i,p));witness.put(i,p);p=3-p;}
  assert.equal(witness.board.join(''),trap.proof.forbiddenEnd.boardKey);assert(!witness.legal(trap.proof.forbiddenEnd.i,defender));
  report.steps.push({path:'native-finalist-guard',defender,elapsedMs:Date.now()-start,badRefuted:true,legalAttackingAlternativeRetained:true,verifiedReplies:checked.stats.defenses,workers:native.workers});
 }
 for(const mode of ['auto','deep'])for(const defender of [1,2]){
  const b=board(defender),budget=mode==='auto'?15000:25000,start=Date.now();
  const normal=await page.evaluate(({b,p,mode,budget})=>new Promise((resolve,reject)=>{
   stopWorker();cancelPonder();spawnAnalysis.memory=null;const original=b.slice();let task;
   const timer=setTimeout(()=>{task?.terminate();reject(Error('ordinary '+mode+' request timeout'));},budget+3000);
   task=spawnAnalysis(b,p,{mode,automatic:mode==='auto',ms:budget},()=>{},result=>{clearTimeout(timer);resolve({result,
    legal:result.i!=null&&E.inspect(b,result.i,p).legal,validPV:E.validPV(b,p,result.pv).length===result.pv.length,
    unchanged:JSON.stringify(b)===JSON.stringify(original),workers:[...__activeWorkers]});},error=>{clearTimeout(timer);reject(Error(error));});
  }),{b,p:defender,mode,budget});
  assert(normal.legal&&normal.validPV&&normal.unchanged);assert.notEqual(normal.result.i,idx('H9'));assert.deepEqual(normal.workers,[]);
  report.steps.push({path:'ordinary-analysis',mode,defender,elapsedMs:Date.now()-start,i:normal.result.i,pv:normal.result.pv,proofStatus:normal.result.proofStatus,
   roots:normal.result.rootWork,stopReason:normal.result.analysisWork?.stopReason,rejectedTrap:normal.result.rejected?.some(r=>r.i===idx('H9'))||false,workers:normal.workers});
  // Separate synthetic defender-to-move state: test the retained move's
  // next-own-turn VCF potential, without implying the opponent skipped a turn
  // in a real game or proving the preceding position is won.
  const tactical=b.slice();tactical[idx('H8')]=defender;const attackStart=Date.now();
  const attacking=await page.evaluate(({b,p,mode,budget})=>new Promise((resolve,reject)=>{
   spawnAnalysis.memory=null;const original=b.slice();let task;const timer=setTimeout(()=>{task?.terminate();reject(Error('preserved attack timeout'));},7000);
   task=spawnAnalysis(b,p,{mode,automatic:mode==='auto',ms:budget},()=>{},result=>{clearTimeout(timer);resolve({result,
    legal:E.inspect(b,result.i,p).legal,validPV:E.validPV(b,p,result.pv).length===result.pv.length,unchanged:JSON.stringify(b)===JSON.stringify(original),workers:[...__activeWorkers]});},error=>{clearTimeout(timer);reject(Error(error));});
  }),{b:tactical,p:defender,mode,budget});
  assert(attacking.result.proven&&!attacking.result.lossProven);assert(attacking.legal&&attacking.validPV&&attacking.unchanged);assert.deepEqual(attacking.workers,[]);
  verifyProof(tactical,defender,{type:'vcf',pv:attacking.result.pv});
  report.steps.push({path:'next-own-turn-attacking-tactic',mode,defender,elapsedMs:Date.now()-attackStart,i:attacking.result.i,pv:attacking.result.pv,proofStatus:attacking.result.proofStatus,workers:attacking.workers});
 }
 assert.deepEqual(errors,[]);report.status='passed';console.log(JSON.stringify(report));
})().catch(error=>{report.status='failed';report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(out,'forbidden-trap.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();});
