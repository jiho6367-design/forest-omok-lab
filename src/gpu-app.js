globalThis.omokAcceleration={mode:'cpu',table:null,optimized:false};
const gpuPanel=document.createElement('div');gpuPanel.className='card';gpuPanel.innerHTML=`<h2>GPU 혼합 분석 · 로컬 개선판</h2><label>연산 방식<select id="computeMode"><option value="gpu">GPU 혼합 · 패턴 사전 계산</option><option value="optimized">CPU 최적화 · 패턴 재사용</option><option value="cpu">기존 CPU</option></select></label><p id="gpuStatus" role="status">GPU 확인 중…</p><p class="muted">GPU는 패턴 59,049개를 병렬 계산합니다. 수읽기는 CPU에서 수행하며, 같은 시간에 더 깊게 탐색할 수 있습니다.</p><button id="gpuBenchmark">CPU/GPU 성능 비교</button><button id="gpuCancel" disabled>비교 중지</button><pre id="gpuResult" style="white-space:pre-wrap;font-size:12px;max-height:360px;overflow:auto"></pre>`;
document.querySelector('.sidebar').prepend(gpuPanel);
const gpuProfiles={
 optimized:{budget:'auto',description:'국면에 맞춰 자동 조절 · 최대 15초, 후보가 안정되면 조기 종료합니다.'},
 fast:{budget:'900',description:'내 수는 약 1초 안에 빠르게 추천합니다. 깊은 수읽기는 제한됩니다.'},
 deep:{budget:'25000',description:'내 수를 최대 25초 동안 더 깊게 비교합니다. 즉시 승리·필수 방어는 먼저 표시합니다.'}
};
const gpuProfilePanel=document.createElement('div');
gpuProfilePanel.innerHTML='<label>GPU 분석 모드<select id="gpuProfile"><option value="optimized">최적화 · 자동 (권장)</option><option value="fast">아주 빠르게 · 약 1초</option><option value="deep">심층 분석 · 최대 25초</option></select></label><p id="gpuProfileHelp" class="muted"></p><p class="muted">내 수와 예상 응수에 적용합니다. 상대 다음 수 예측은 1초이며, 남은 대국 시간에 따라 분석 시간이 줄어들 수 있습니다.</p>';
$('computeMode').parentElement.after(gpuProfilePanel);
try{const saved=localStorage.getItem('omok-gpu-profile');if(gpuProfiles[saved])$('gpuProfile').value=saved;}catch{}
function syncGPUProfile(apply=false){
 gpuProfilePanel.hidden=$('computeMode').value!=='gpu';
 const profile=gpuProfiles[$('gpuProfile').value];
 if(apply)$('budget').value=profile.budget;
 const custom=$('budget').value!==profile.budget;
 $('gpuProfileHelp').textContent=custom?'아래 분석 시간에서 직접 지정한 설정을 사용 중입니다. GPU 분석 모드를 다시 선택하면 해당 모드가 적용됩니다.':profile.description;
}
$('gpuProfile').onchange=()=>{
 syncGPUProfile(true);
 try{localStorage.setItem('omok-gpu-profile',$('gpuProfile').value);}catch{}
 stopWorker();if(g&&!g.result)analyze();
};
const previousBudgetChange=$('budget').onchange;
$('budget').onchange=event=>{
 const entry=Object.entries(gpuProfiles).find(([,profile])=>profile.budget===$('budget').value);
 if(entry){$('gpuProfile').value=entry[0];try{localStorage.setItem('omok-gpu-profile',entry[0]);}catch{}}
 syncGPUProfile();previousBudgetChange?.(event);
};
syncGPUProfile(true);
versionBadge.textContent='통합 v5.13.1 · GPU';
versionBadge.setAttribute('aria-label','통합 버전 5.13.1');
versionBadge.title='GPU 혼합 분석 · 분석 모드 3종 · 정확한 5목 우선 고정';
let gpuPrepared=null,cpuPatterns=null,modeRequest=0,benchmarkWorker=null,cancelBenchmark=null;
async function selectComputeMode(reanalyze=false){
 const request=++modeRequest,mode=$('computeMode').value;stopWorker();globalThis.omokAcceleration={mode:'cpu',table:null,optimized:false};
 syncGPUProfile(mode==='gpu');
 $('computeMode').disabled=true;$('gpuStatus').textContent=mode==='gpu'?'GPU 초기화와 패턴 전수 검증 중…':'CPU 모드 준비 중…';
 try{
  if(mode==='gpu')gpuPrepared ||= await OmokGPU.prepare();
  if(request!==modeRequest)return;
  if(mode==='optimized')cpuPatterns ||= OmokGPU.cpu();
  globalThis.omokAcceleration={mode,table:mode==='gpu'?gpuPrepared.table:mode==='optimized'?cpuPatterns:null,optimized:mode!=='cpu'};
  $('gpuStatus').textContent=mode==='gpu'?`GPU 정상 · ${gpuPrepared.adapter.description||[gpuPrepared.adapter.vendor,gpuPrepared.adapter.architecture].filter(Boolean).join(' ')} · ${gpuPrepared.verifiedPatterns.toLocaleString()}개 패턴 검증 완료 · 준비 ${Math.round(gpuPrepared.totalMs)}ms`:mode==='optimized'?'CPU 최적화 사용 중 · GPU 없이 같은 패턴 재사용':'기존 CPU 사용 중';
 }catch(error){$('gpuStatus').textContent='GPU 사용 불가 · 현재 CPU 실행: '+error.message;}
 finally{$('computeMode').disabled=false;if(reanalyze&&g&&!g.result)analyze();}
}
$('computeMode').onchange=()=>selectComputeMode(true);
function runBenchmark(table){return new Promise((resolve,reject)=>{
 const source=$('engineSource').textContent+`\nonmessage=e=>{try{const table=e.data.table,positions=e.data.positions,rows=[];
 const median=a=>a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];
 for(const pos of positions){const samples={cpu:[],optimized:[],gpu:[]},checks={};
 for(let repeat=0;repeat<6;repeat++){const order=repeat%2?['gpu','optimized','cpu']:['cpu','optimized','gpu'];
 for(const mode of order){const opts={fixedWork:true,optimized:mode!=='cpu',patternTable:mode==='gpu'?table:mode==='optimized'?OmokGPU.cpu():null};const start=performance.now();const engine=createReaderEngine(15,pos.board,opts);const r=engine.fixedWork(pos.p,3);const totalMs=performance.now()-start;checks[mode]={score:r.score,pv:r.pv,nodes:r.nodes};if(repeat>0)samples[mode].push({searchMs:r.ms,totalMs});}}
 const same=JSON.stringify(checks.cpu)===JSON.stringify(checks.optimized)&&JSON.stringify(checks.cpu)===JSON.stringify(checks.gpu);if(!same)throw Error('동일 작업 결과 불일치: '+pos.id+' '+JSON.stringify(checks));
 const row={position:pos.id,depth:3,verified:true,result:checks.cpu,samples,cpuMs:median(samples.cpu.map(r=>r.searchMs)),optimizedMs:median(samples.optimized.map(r=>r.searchMs)),gpuMs:median(samples.gpu.map(r=>r.searchMs))};row.speedup=row.cpuMs/row.gpuMs;row.cpuOptimizationSpeedup=row.cpuMs/row.optimizedMs;rows.push(row);postMessage({progress:rows});}
 const full=[];for(const mode of ['cpu','gpu','gpu','cpu']){const engine=createEngine({optimized:mode==='gpu',patternTable:mode==='gpu'?table:null});const pos=positions[1],start=performance.now(),r=engine.analyze(pos.board,pos.p,1000,[]);full.push({mode,elapsedMs:performance.now()-start,depth:r.depth,nodes:r.nodes,i:r.i});}
 postMessage({result:{rows,full,scope:'Depth-3 identical search, same nodes/score/PV; 1 warmup and 5 alternating samples. Search timings exclude table preparation and engine construction. Full runs use a 1000ms budget.'}});
 }catch(error){postMessage({error:error.stack||error.message});}}`;
 const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));const w=new Worker(url);URL.revokeObjectURL(url);benchmarkWorker=w;
 const positions=['H8 G7 G6 H6 F8','H8 G7 G6 H6 F8 J4 E8 G8 F7 I5 K3 H5','H8 G7 G6 H6 F8 I7 E8 G8 F7 D9 F9'].map((s,k)=>{const board=Array(225).fill(0),moves=s.split(' ');moves.forEach((c,j)=>board[(+c.slice(1)-1)*15+c.charCodeAt(0)-65]=j%2?2:1);return {id:['초반 5수','중반 12수','공격 11수'][k],board,p:moves.length%2?2:1};});
 const timer=setTimeout(()=>{w.terminate();benchmarkWorker=null;cancelBenchmark=null;reject(Error('비교 시간 한도 120초 초과'));},120000);
 cancelBenchmark=()=>{clearTimeout(timer);w.terminate();benchmarkWorker=null;cancelBenchmark=null;reject(Error('사용자가 비교를 중지했습니다.'));};
 w.onmessage=({data})=>{if(data.progress){$('gpuResult').textContent='동일 작업 비교 중… '+data.progress.length+'/3 국면 완료';return;}clearTimeout(timer);w.terminate();benchmarkWorker=null;cancelBenchmark=null;data.error?reject(Error(data.error)):resolve(data.result);};
 w.onerror=e=>{clearTimeout(timer);w.terminate();benchmarkWorker=null;reject(Error(e.message));};
 w.postMessage({table,positions});
});}
async function benchmarkGPU(){
 stopWorker();$('gpuBenchmark').disabled=true;$('computeMode').disabled=true;$('gpuCancel').disabled=false;$('gpuResult').textContent='GPU 준비 및 동일 작업량 비교 중…';
 try{gpuPrepared ||= await OmokGPU.prepare();const data=await runBenchmark(gpuPrepared.table);const report={date:new Date().toISOString(),userAgent:navigator.userAgent,gpu:{...gpuPrepared,table:undefined},...data};globalThis.omokBenchmarkReport=report;
 $('gpuResult').textContent=data.rows.map(r=>`${r.position}: 기존 CPU ${r.cpuMs.toFixed(1)}ms / 최적화 CPU ${r.optimizedMs.toFixed(1)}ms / GPU 혼합 ${r.gpuMs.toFixed(1)}ms → ${r.speedup.toFixed(2)}배\n점수·수순·노드 동일 (${r.result.nodes}노드)`).join('\n\n')+'\n\nGPU 준비 '+gpuPrepared.totalMs.toFixed(1)+'ms (첫 회 별도)\nGPU 계산·읽기 '+gpuPrepared.dispatchReadbackMs.toFixed(1)+'ms\n전체 1초 예산 분석:\n'+data.full.map(r=>`${r.mode}: ${r.elapsedMs.toFixed(0)}ms, 깊이 ${r.depth}, ${r.nodes}노드`).join('\n')+'\n\n이 배수는 동일 깊이 수읽기 비교입니다. 시간 예산 모드는 종료 시간이 비슷할 수 있습니다. CPU 최적화도 빨라지면 그 부분은 알고리즘 개선 효과입니다.';
 if(location.search.includes('diagnostics'))await fetch('/benchmark-result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});
 }catch(e){$('gpuResult').textContent='비교 실패: '+e.message;if(location.search.includes('diagnostics'))await fetch('/benchmark-result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({error:e.message})}).catch(()=>{});}
 finally{$('gpuBenchmark').disabled=false;$('computeMode').disabled=false;$('gpuCancel').disabled=true;}
}
$('gpuBenchmark').onclick=benchmarkGPU;
$('gpuCancel').onclick=()=>cancelBenchmark?.();
selectComputeMode().then(()=>{if(location.search.includes('diagnostics')){$('setup').close();benchmarkGPU();}});
