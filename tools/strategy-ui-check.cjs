'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
let playwright;try{playwright=require('playwright');}catch(e){playwright=require('C:/Users/jiho/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');}
const {chromium}=playwright;
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const root=path.resolve(__dirname,'..'),out=path.join(root,'reports/strategy');
const game=(id,first=2,pass=false)=>{const coords='H8 G8 H9 F9 I8'.split(' '),events=coords.map((c,k)=>({type:'move',i:idx(c),p:k%2?3-first:first,time:null,remaining:null,legal:true}));if(pass)events.push({type:'timeout',i:null,p:3-first,time:null,remaining:null});return {id,date:'2026-10-05',me:1,first,rules:{fivePriority:true},timer:false,axis:'ascending',remaining:40000,cursor:events.length,result:null,events};};
async function waitFinal(page){await page.waitForFunction(()=>rec?.i!=null&&(!$('analysisState').textContent.includes('분석 중')&&!$('analysisState').textContent.includes('추가 계산')),{},{timeout:40000});}
async function snapshot(page){return page.evaluate(()=>({version:versionBadge.textContent,first:g.first,me:g.me,turn,context:E.getContext?.(),cursor,events:events.map(e=>({p:e.p,type:e.type,i:e.i})),board:b.slice(),move:rec?.i==null?null:E.coord(rec.i),legal:rec?.i!=null&&E.inspect(b,rec.i,turn).legal,proofStatus:rec?.proofStatus,assessmentStatus:rec?.assessmentStatus,ms:rec?.ms,gpuStatus:$('gpuStatus').textContent,computeMode:globalThis.omokAcceleration?.mode}));}
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.OMOK_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const report={recordedAt:new Date().toISOString(),browser:browser.version(),checks:[],errors:[]};
 try{
  const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(pathToFileURL(path.join(root,'outputs/omok.html')).href);
  await page.waitForFunction(()=>typeof loadGame==='function'&&!$('computeMode').disabled);
  await page.evaluate(()=>{$('setup').close();$('budget').value='900';});
  report.gpu=await page.evaluate(async()=>{const r=await OmokGPU.prepare();return {...r,table:undefined};});
  assert.equal(report.gpu.verifiedPatterns,59049);
  await page.evaluate(x=>loadGame(x),game('strategy-ui-black-second',2));await waitFinal(page);
  let s=await snapshot(page);assert.equal(s.first,2);assert.equal(s.me,1);assert.equal(s.turn,1);assert.equal(s.context?.firstPlayer,2);assert(s.legal);assert.equal(s.version,'통합 v'+require('../package.json').version+' · GPU');report.checks.push({name:'GPU live Worker black second',...s});
  await page.evaluate(()=>stopWorker());
  await page.evaluate(x=>loadGame(x),game('strategy-ui-pass',2,true));await waitFinal(page);s=await snapshot(page);assert.equal(s.first,2);assert.equal(s.turn,2);assert.equal(s.context?.firstPlayer,2);assert(s.legal);const savedBoard=s.board.slice();report.checks.push({name:'PASS preserves first player and toggles current side',...s});
  await page.evaluate(()=>{stopWorker();persist();navigate(cursor-1);});await waitFinal(page);s=await snapshot(page);assert.equal(s.cursor,5);assert.equal(s.turn,1);assert.deepEqual(s.board,savedBoard);report.checks.push({name:'undo PASS',first:s.first,turn:s.turn,cursor:s.cursor});
  await page.evaluate(()=>{stopWorker();navigate(events.length);persist();});await waitFinal(page);s=await snapshot(page);assert.equal(s.cursor,6);assert.equal(s.turn,2);assert.deepEqual(s.board,savedBoard);report.checks.push({name:'redo PASS',first:s.first,turn:s.turn,cursor:s.cursor});
  const saved=await page.evaluate(()=>{stopWorker();persist();return JSON.parse(JSON.stringify(db));});assert(saved.games.some(x=>x.id==='strategy-ui-pass'));await page.reload();await page.waitForFunction(()=>g?.id==='strategy-ui-pass'&&!$('computeMode').disabled);await waitFinal(page);s=await snapshot(page);assert.equal(s.first,2);assert.equal(s.cursor,6);assert.equal(s.turn,2);assert.deepEqual(s.board,savedBoard);assert(s.legal);report.checks.push({name:'save and reload active game resumes analysis',...s});
  const imported=await page.evaluate(()=>{stopWorker();return parseTextRecord('1. 백 H8 · 2. 흑 G8 · 3. 백 PASS · 4. 흑 I8',{firstPlayer:2,fivePriority:true},2);});assert(imported.length===4);report.checks.push({name:'text import white first with PASS',events:imported.length});
  await page.evaluate(()=>{stopWorker();});
  await page.evaluate(()=>{const original=acceptResult;globalThis.strategyUiResults=[];acceptResult=function(result,partial=false){const accepted=original(result,partial);if(accepted)globalThis.strategyUiResults.push({partial,i:rec?.i,legal:rec?.i!=null&&E.inspect(b,rec.i,turn).legal,proofStatus:rec?.proofStatus,assessmentStatus:rec?.assessmentStatus,firstPlayer:E.getContext?.().firstPlayer,depth:rec?.depth,ms:rec?.ms});return accepted;};});
  for(const profile of ['fast','optimized','deep']){
   await page.selectOption('#gpuProfile',profile);
   const expected={fast:'900',optimized:'auto',deep:'25000'}[profile];assert.equal(await page.locator('#budget').inputValue(),expected);
   await page.evaluate(x=>{stopWorker();globalThis.strategyUiResults=[];loadGame(x);},game('strategy-ui-mode-'+profile,2));await waitFinal(page);
   s=await snapshot(page);const displays=await page.evaluate(()=>globalThis.strategyUiResults);assert(s.legal);assert.equal(s.turn,1);assert.equal(s.context?.firstPlayer,2);assert(displays.some(x=>!x.partial&&x.legal));assert(displays.every(x=>x.legal&&x.firstPlayer===2));
   report.checks.push({name:'GPU preset actual Worker temporary and final recommendations',profile,budget:expected,displays,...s});await page.evaluate(()=>stopWorker());
  }
  await page.selectOption('#gpuProfile','fast');await page.evaluate(x=>{stopWorker();loadGame(x);},game('strategy-ui-ponder',2,true));await waitFinal(page);
  await page.waitForFunction(()=>ponder?.result?.i!=null,{},{timeout:12000});
  const prediction=await page.evaluate(()=>({opponent:ponder.opponent,key:ponder.key,result:ponder.result}));
  await page.evaluate(()=>{resume();move(ponder.opponent);});await waitFinal(page);s=await snapshot(page);assert.equal(s.turn,1);assert.equal(s.first,2);assert(s.legal);assert.equal(s.move,String.fromCharCode(65+prediction.result.i%15)+(Math.floor(prediction.result.i/15)+1));assert((await page.locator('#predictionNote').textContent()).includes('사전 계산 결과 사용'));
  report.checks.push({name:'actual opponent prediction promotes same finalized reply with white-first context',prediction,...s});await page.evaluate(()=>stopWorker());
  await page.evaluate(x=>{$('budget').value='900';loadGame(x);},game('strategy-ui-final',2));await waitFinal(page);await page.evaluate(()=>stopWorker());
  await page.screenshot({path:path.join(out,'ui-validation.png'),fullPage:true});
  const fallbackContext=await browser.newContext();await fallbackContext.addInitScript(()=>Object.defineProperty(navigator,'gpu',{get:()=>undefined,configurable:true}));const fallback=await fallbackContext.newPage();fallback.on('pageerror',e=>report.errors.push(String(e)));
  await fallback.goto(pathToFileURL(path.join(root,'outputs/omok.html')).href);await fallback.waitForFunction(()=>!$('computeMode').disabled);await fallback.evaluate(x=>{$('setup').close();$('budget').value='900';loadGame(x);},game('strategy-ui-fallback',2));await waitFinal(fallback);s=await snapshot(fallback);assert.equal(s.computeMode,'cpu');assert(s.gpuStatus.includes('GPU 사용 불가'));assert(s.legal);assert.equal(s.context?.firstPlayer,2);report.checks.push({name:'unavailable WebGPU falls back to CPU',...s});await fallback.evaluate(()=>stopWorker());await fallbackContext.close();
  assert.equal(report.errors.length,0,report.errors.join('\n'));report.passed=true;
 }catch(e){report.passed=false;report.failure=e.stack;process.exitCode=1;console.error(e.stack);}finally{fs.writeFileSync(path.join(out,'ui-validation.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,gpu:report.gpu?.adapter,errors:report.errors,failure:report.failure}));
})();
