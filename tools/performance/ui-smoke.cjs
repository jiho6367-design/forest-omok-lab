const {chromium}=require('playwright'),{pathToFileURL}=require('node:url'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.OMOK_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(pathToFileURL(path.resolve('outputs/omok.html')).href);
 await page.waitForFunction(()=>typeof loadGame==='function');
 await page.waitForFunction(()=>!document.querySelector('#computeMode').disabled);
 await page.selectOption('#computeMode','optimized');
 await page.waitForFunction(()=>!document.querySelector('#computeMode').disabled);
 await page.evaluate(()=>{
  $('budget').value='900';$('setup').close();
  const moves='H8 G7 G6 H6 F8'.split(' ');
  loadGame({id:'isolated-performance-smoke',date:'2026-09-29',me:2,first:1,rules:{fivePriority:true},timer:false,axis:'ascending',remaining:40000,cursor:5,result:null,
    events:moves.map((c,k)=>({type:'move',i:(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p:k%2?2:1,time:null,remaining:null}))});
 });
 await page.waitForFunction(()=>document.querySelector('#analysisState').textContent.startsWith('분석 완료'),{},{timeout:10000});
 const result=await page.evaluate(()=>({version:versionBadge.textContent,state:$('analysisState').textContent,move:rec?.i==null?null:E.coord(rec.i),legal:rec?.i!=null&&E.inspect(b,rec.i,turn).legal,proof:rec?.proofStatus,options:[...$('budget').options].map(o=>o.textContent)}));
 assert(result.legal);assert.notEqual(result.move,'I7');assert.equal(result.proof,'UNRESOLVED');assert.equal(errors.length,0,errors.join('\n'));
 assert(result.options.some(x=>x.includes('7초')));assert(result.options[0].includes('15초'));
 assert.equal(result.version,'통합 v'+require('../../package.json').version+' · GPU');
 await page.screenshot({path:'reports/performance/ui-smoke.png',fullPage:true});
 fs.writeFileSync('reports/performance/ui-smoke.json',JSON.stringify({...result,errors},null,2));
 await browser.close();console.log('PASS offline full UI, live Worker recommendation, known-loss exclusion, final status, mode labels');
})().catch(e=>{console.error(e);process.exit(1);});
