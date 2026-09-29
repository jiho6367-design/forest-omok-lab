// Bounded experiments only. Production recommendation and rule code is loaded unchanged.
const fs=require('node:fs'),os=require('node:os'),{chromium}=require('playwright');
const positions=require('./positions.cjs'),kind=process.argv[2]||'workers',workerLike=kind.includes('workers');
const baseline=JSON.parse(fs.readFileSync('reports/performance/phase2-baseline.json'));
if(!baseline.finished)throw Error('Wait for the fresh baseline to finish');
if(kind==='auto-gate'){
 const {autoStable}=require('../../src/reader-engine.js');
 const rounds=[200,220,210].map((score,k)=>({i:1,score,depth:k+2,pv:[1,2,3],gap:100+k*10,ranking:[1,2,3]}));
 const moves=[{i:1,score:210,status:'screened'},{i:2,score:90},{i:3,score:80}],checks={screeningComplete:true,forcingChecksComplete:true};
 const change=f=>rounds.map((r,k)=>f({...r,pv:r.pv.slice(),ranking:r.ranking.slice()},k));
 const cases=[['stable',rounds,checks,true],
  ['changing PV',change((r,k)=>({...r,pv:[1,k+10,3]})),checks,false],
  ['collapsing gap',change((r,k)=>({...r,gap:[500,250,120][k]})),checks,false],
  ['changing ranking',change((r,k)=>({...r,ranking:[1,k+10,3]})),checks,false],
  ['missing PV evidence',change(r=>({...r,pv:undefined})),checks,false],
  ['skipped depth',change((r,k)=>({...r,depth:k===0?1:k+2})),checks,false],
  ['changing best',change((r,k)=>({...r,i:k===0?2:1})),checks,false],
  ['unfinished screening',rounds,{...checks,screeningComplete:false},false],
  ['unstable evaluation',change((r,k)=>({...r,score:k===0?-500:r.score})),checks,false]];
 const rows=cases.map(([name,history,status,expected])=>({name,expected,actual:autoStable(history,4,1500,status,moves)}));
 const result={rows,incorrectStops:rows.filter(x=>!x.expected&&x.actual).length,failed:rows.filter(x=>x.expected!==x.actual).length};
 fs.writeFileSync('reports/performance/phase2-auto-gate-'+(process.argv[3]||'result')+'.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));process.exit(0);
}
const read=f=>fs.readFileSync('src/'+f,'utf8');
const source="let hits=0,lookups=0;function ttGet(t,k){lookups++;const v=t.get(k);if(v!==undefined)hits++;return v;}\n"+
 read('reader-engine.js').replace('function createEngine(','function createReaderEngine(').replace('entry=tt.get(key)','entry=ttGet(tt,key)')+'\n'+
 read('forest-engine.js').replace('save=tt.get(key)','save=ttGet(tt,key)')+'\n'+read('unified-engine.js');
const coord=i=>String.fromCharCode(65+i%15)+(1+Math.floor(i/15)),idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.OMOK_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding']});
 const page=await browser.newPage();await page.setContent('<button id="beat">responsive</button>');
 await page.addScriptTag({content:source});
 await page.evaluate(src=>{window.workerURL=URL.createObjectURL(new Blob([src+`\nonmessage=({data:d})=>{hits=0;lookups=0;const E=createEngine(),b=d.board.slice(),shape=E.inspect(b,d.i,d.p);const ownWin=shape.win.length>0;b[d.i]=d.p;
 const started=performance.now();let r;
 if(d.tactical&&!ownWin){const direct=E.forcing(b,3-d.p,25,Math.min(1000,d.ms*.25)),remaining=Math.max(1,d.ms-(performance.now()-started));
 const trap=direct.proof||!direct.complete?null:shape.fours.length?E.forcedReplyTrap(b,d.p,Math.min(500,remaining),null,25,true):E.quietTrap(b,d.p,remaining,14,25,true);
 r={i:direct.proof?.pv?.[0]??null,score:direct.proof||trap?.proof?1e8:0,pv:direct.proof?.pv||[],depth:direct.proof?.pv?.length||0,nodes:(direct.nodes||0)+(trap?.nodes||0),proven:!!(direct.proof||trap?.proof),complete:!!direct.complete&&(!trap||!!trap.complete)};
 }else r=E.analyze(b,3-d.p,d.ms,[],r=>{if(r.depth>0||r.proven||r.lossProven)postMessage({partial:true,id:d.id,r});});
 postMessage({id:d.id,r,ownWin,ms:performance.now()-started,tt:{hits,lookups},cache:E.getPositionCacheStats()});};`],{type:'text/javascript'}));},source);
 await page.addScriptTag({content:`
 window.runBatch=(spec,points,count,budget,tactical)=>new Promise(resolve=>{
 const E=createEngine(),bad=new Set(E.knownRefutations(spec.board,spec.p).map(m=>m.i));
 points=points.filter(i=>!bad.has(i)&&E.inspect(spec.board,i,spec.p).legal);
 const started=performance.now(),end=started+budget,results=[],workers=[],lags=[];let last=started,completed=0,next=0,finished=false;
 const ticker=setInterval(()=>{const now=performance.now();lags.push(Math.max(0,now-last-20));last=now;document.querySelector('#beat').textContent=String(now);},20);
 let timer;const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);clearInterval(ticker);workers.forEach(w=>w.terminate());lags.sort((a,b)=>a-b);
 const elapsed=performance.now()-started,rank=results.filter(x=>x.done).sort((a,b)=>Number(b.ownWin)-Number(a.ownWin)||Number(a.r.proven)-Number(b.r.proven)||a.r.score-b.r.score);
 resolve({elapsed,nodes:results.reduce((s,x)=>s+(x.r.nodes||0),0),nodes_sec:results.reduce((s,x)=>s+(x.r.nodes||0),0)*1000/elapsed,depth:results.filter(x=>x.done).map(x=>x.r.depth||0),best:rank[0]?.i??null,results,
 lag_p95:lags[Math.floor((lags.length-1)*.95)]||0,lag_max:lags.at(-1)||0,completed,candidates:points.length,workers:count,actualWorkers:workers.length,timedOut:completed<points.length});};
 const assign=w=>{if(next>=points.length)return;const id=next++;w.postMessage({id,tactical,board:spec.board,p:spec.p,i:points[id],ms:Math.max(30,Math.min(end-performance.now()-80,budget*.90*Math.min(count,points.length)/points.length))});};
 timer=setTimeout(finish,budget);if(!points.length)return finish();
 for(let k=0;k<Math.min(count,points.length);k++){const w=new Worker(workerURL);workers.push(w);w.onmessage=({data:d})=>{if(finished)return;if(d.partial)return;
 const after=spec.board.slice();after[points[d.id]]=spec.p;
 if(d.r.i!=null&&!E.inspect(after,d.r.i,3-spec.p).legal)d.invalid='illegal reply';
 if(E.validPV(after,3-spec.p,d.r.pv||[]).length!==(d.r.pv||[]).length)d.invalid='illegal PV';
 if(d.r.i!=null&&E.knownRefutations(after,3-spec.p).some(x=>x.i===d.r.i))d.invalid='known loss reply';
 results.push({...d,i:points[d.id],done:true});completed++;if(completed===points.length)finish();else assign(w);};w.onerror=e=>{results.push({error:e.message,r:{}});finish();};assign(w);}
 });
 window.cancelBatch=count=>new Promise(resolve=>{let after=0,cancelled=false;const ws=Array.from({length:count},()=>new Worker(workerURL));
 ws.forEach((w,k)=>{w.onmessage=()=>{if(cancelled)after++;};w.postMessage({id:k,board:Array(225).fill(0).map((_,i)=>[112,81,110].includes(i)?1:[96,82].includes(i)?2:0),p:2,i:95,ms:5000});});
 setTimeout(()=>{cancelled=true;const t=performance.now();ws.forEach(w=>w.terminate());const ms=performance.now()-t;setTimeout(()=>resolve({workers:count,api_ms:ms,observation_ms:150,messages_after:after}),150);},200);});
 `});
 const report={kind,started:new Date().toISOString(),cpu:{name:os.cpus()[0].model,logical:os.cpus().length},scope:'Independent counter-search of the same fixed shortlist; no full-tree duplication, no UI integration. Equal 3s wall budgets for worker comparison.',rows:[],cancellation:[]};
 const save=()=>fs.writeFileSync('reports/performance/phase2-'+kind+'.json',JSON.stringify(report,null,2));
 const chosen=positions.filter(p=>(workerLike?['instant-win','mandatory-block','forcing-four','quiet-middle','wide-middle','sixth-move']:['sixth-move','quiet-middle','wide-middle']).includes(p.id));
 for(let repeat=0;repeat<3;repeat++)for(const spec of chosen){
  const row=baseline.rows.find(r=>r.position===spec.id&&r.mode===(workerLike?'fast':'deep25')&&r.repeat===repeat);
  const points=workerLike?row.top3.slice(0,2).map(x=>idx(x.move)):[idx(row.best_move)];
  for(const count of workerLike?(repeat%2?[2,1]:[1,2]):[1]){
   const budget=workerLike?3000:Math.min(8000,23500-row.actual_elapsed_ms);
   const r=await page.evaluate(({spec,points,count,budget,tactical})=>runBatch(spec,points,count,budget,tactical),{spec,points,count,budget,tactical:kind==='tactical-workers'});
   const item={position:spec.id,repeat,...r,best:r.best==null?null:coord(r.best),baseline_ms:row.actual_elapsed_ms,baseline_move:row.best_move,baseline_pv:row.pv};report.rows.push(item);save();
   console.log(JSON.stringify({kind,position:spec.id,repeat,workers:count,ms:Math.round(r.elapsed),nps:Math.round(r.nodes_sec),depth:r.depth,move:item.best,lag:r.lag_p95,refuted:r.results.filter(x=>x.r.proven).length}));
   if(r.results.some(x=>x.invalid||x.error))throw Error('Invalid counter-search result');
  }
 }
 for(const count of [1,2])for(let k=0;k<3;k++)report.cancellation.push(await page.evaluate(c=>cancelBatch(c),count));
 report.finished=new Date().toISOString();save();await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
