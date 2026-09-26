// Unified UI: Forest records, characters and pondering; Reader progress,
// adaptive search, legal fallback, text import and position input.
stopWorker();
const analysisPlan=document.createElement('p');analysisPlan.id='analysisPlan';analysisPlan.className='muted';$('sequence').after(analysisPlan);
const predictionNote=document.createElement('p');predictionNote.id='predictionNote';predictionNote.className='muted';analysisPlan.after(predictionNote);
const candidateList=document.createElement('div');candidateList.className='row';candidateList.id='candidates';$('reason').after(candidateList);
const ruleLabel=document.createElement('p');ruleLabel.className='muted';$('turnInfo').after(ruleLabel);
const setupOptions=document.createElement('div');
setupOptions.innerHTML='<label>5목과 3·3이 동시에 생기면<select id="fivePriority"><option value="strict">3·3 금지 우선 (수읽기 기존 규칙)</option><option value="priority">정확한 5목 우선 (숲속 기존 규칙)</option></select></label><label>좌표 표시<select id="axisChoice"><option value="descending">위 15 → 아래 1 (수읽기 방식)</option><option value="ascending">위 1 → 아래 15 (숲속 방식)</option></select></label><label><input type="checkbox" id="useTimer"> 40초 시계 사용 · 초과 시 PASS</label><p class="muted">노란 버섯 = 흑 · 초록 슬라임 = 백. 선후공은 별도로 선택합니다.</p>';
$('setup').querySelector('.modal-actions').before(setupOptions);
$('my').options[0].textContent='초록 슬라임 (백)';$('my').options[1].textContent='노란 버섯 (흑)';
versionBadge.textContent='통합 v4.0.0';versionBadge.title='숲속 기록·캐릭터 + 빠른 수읽기·방어 검사';versionBadge.setAttribute('aria-label','통합 버전 4.0.0');
document.title='숲속 오목 · 통합 수읽기';document.querySelector('h1').textContent='숲속 오목 · 통합 수읽기';
wideHelp.textContent='자동 모드를 권장합니다. 즉시 승리·필수 방어는 바로 표시하고, 일반 국면은 최대 8초 안에서 후보가 안정되면 일찍 끝냅니다. 임시 후보가 먼저 나오고 계산하며 갱신됩니다. 15·25초 모드는 숲속의 심층 위협 검사도 함께 사용합니다. 추천은 무패 보장이 아닙니다.';
$('budget').replaceChildren();
for(const [v,t] of [['auto','자동 · 최대 8초 (권장)'],['900','빠르게 · 1초'],['3000','비교 · 3초'],['8000','정밀 · 8초'],['15000','심층 · 15초'],['25000','심층 · 25초']]){const o=new Option(t,v);$('budget').append(o);}
$('budget').value='auto';
// Keep the useful study library, but collapse old per-version shortcuts.
const studyDetails=document.createElement('details'),studySummary=document.createElement('summary');studySummary.textContent='기존 숲속 기보 사례';studyDetails.append(studySummary);
const learningCard=$('learn').closest('.card');
for(const child of [...$('learn').parentElement.children])if(!['postmortem','learn','lessons'].includes(child.id))studyDetails.append(child);
learningCard.append(studyDetails);
const rulesText=learningCard.querySelector('details p');if(rulesText)rulesText.textContent='정확한 5목만 승리, 6목 이상은 승리가 아니며 4·4는 허용합니다. 양측 3·3 금지이며, 5목 우선 여부는 새 게임에서 선택하고 기보에 저장합니다. 모든 말은 초록 슬라임·노란 버섯으로 표시합니다.';

let ponder=null,keepPonder=false,lastProgress=null,activePlan='';
const persistWithRules=persist;
persist=function(){
  for(const lesson of db.lessons)if(!lesson.rules){const game=lesson.game===g?.id?g:db.games.find(x=>x.id===lesson.game);if(game?.rules)lesson.rules={...game.rules};}
  persistWithRules();
};
const baseStopWorker=stopWorker;
function cancelPonder(){ponder?.worker?.terminate();ponder=null;predictionNote.textContent='';}
stopWorker=function(){if(!keepPonder)cancelPonder();baseStopWorker();};
const positionKey=(board,p)=>[g?.id,p,g?.rules?.fivePriority!==false,board.join('')].join('|');
function selectedBudget(board,p,explicit){
  const available=reviewing||paused||g?.timer===false?40000:Math.max(0,deadline-Date.now());
  const choice=explicit??($('budget').value==='auto'?null:+$('budget').value);
  const plan=choice==null?E.suggestBudget(board,p,available):{ms:Math.max(30,Math.min(choice,available-3000)),reason:'직접 선택'};
  activePlan=(choice==null?'자동 ':'분석 ')+(plan.ms<1000?'즉시':`최대 ${(plan.ms/1000).toFixed(1)}초`)+` · ${plan.reason}`;analysisPlan.textContent=activePlan;
  return choice==null?{automatic:true,ms:plan.ms}:plan.ms;
}
function spawnAnalysis(board,p,budget,onProgress,onDone,onError){
  const src=$('engineSource').textContent+'\nonmessage=e=>{try{const E=createEngine(e.data.rules);const r=E.analyze(e.data.b,e.data.p,e.data.ms,e.data.lessons,r=>postMessage({progress:true,result:r}));postMessage({result:r})}catch(x){postMessage({error:String(x)})}}';
  const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));let w;
  try{w=new Worker(url);}finally{URL.revokeObjectURL(url);}
  w.onmessage=e=>{if(e.data.error){w.terminate();onError(e.data.error);}else if(e.data.progress)onProgress(e.data.result);else{w.terminate();onDone(e.data.result);}};
  w.onerror=e=>{w.terminate();onError(e.message||'Worker 오류');};
  w.postMessage({b:board,p,ms:budget,lessons:db.lessons,rules:g?.rules||{}});return w;
}
function acceptResult(result,partial=false){
  if(!result||(result.i!=null&&!E.inspect(b,result.i,turn).legal))return false;
  rec=result;lastProgress=result;
  $('analysisState').textContent=partial?'임시 후보 · 분석 중':result.proven?'강제승 확인':result.lossProven?'불리 · 합법 후보':result.i==null?'추천 없음':'분석 완료';
  render();return true;
}
function prepareReply(){
  cancelPonder();if(!g||g.result||reviewing||turn===g.me||rec?.i==null)return;
  const board=b.slice(),opponent=rec.i,p=3-turn;board[opponent]=turn;if(E.win(board,opponent,turn).length)return;
  const budget=$('budget').value==='auto'?{automatic:true,ms:E.suggestBudget(board,p,40000).ms}:+$('budget').value;
  const task={opponent,key:positionKey(board,p),sourceKey:positionKey(b,turn),started:Date.now(),worker:null,result:null,partial:null,promoted:false};ponder=task;
  predictionNote.textContent=`상대 ${E.coord(opponent)} 예상 · 내 응수 사전 계산`;
  const current=()=>ponder===task&&g&&!reviewing&&positionKey(b,turn)===(task.promoted?task.key:task.sourceKey);
  const finish=r=>{if(!current())return;task.worker=null;task.result=r;if(task.promoted){acceptResult(r);predictionNote.textContent='예측 일치 · 사전 계산 결과 사용';task.onDone?.(r);}else predictionNote.textContent=`상대 ${E.coord(opponent)} 예상 · 응수 ${r.i==null?'없음':E.coord(r.i)} 준비 완료`;};
  const immediate=E.urgent(board,p);if(immediate&&(typeof budget==='object'||immediate.proven||immediate.lossProven||immediate.kind==='terminal')){finish(immediate);return;}
  try{task.worker=spawnAnalysis(board,p,budget,r=>{if(current()){task.partial=r;if(task.promoted)acceptResult(r,true);}},finish,()=>{if(current()){cancelPonder();if(task.promoted)analyze();}});}catch(e){cancelPonder();}
}
analyze=function(explicit,onDone){
  if(!g||g.result){stopWorker();rec=null;render();$('analysisState').textContent=g?.result?'종료':'준비';return;}
  if(explicit==null&&!reviewing&&turn===g.me&&ponder?.key===positionKey(b,turn)){
    const task=ponder;task.promoted=true;task.onDone=onDone;
    analysisPlan.textContent='상대 예상 수 일치 · 기존 계산 이어받음';
    if(task.result){acceptResult(task.result);predictionNote.textContent='예측 일치 · 사전 계산 결과 사용';onDone?.(task.result);}else if(task.partial)acceptResult(task.partial,true);
    else $('analysisState').textContent='사전 계산 이어받음';return;
  }
  stopWorker();lastProgress=null;rec=null;render();const token=job,board=b.slice(),p=turn,budget=selectedBudget(board,p,explicit);
  const immediate=E.urgent(board,p);if(immediate){acceptResult(immediate);if(typeof budget==='object'||immediate.proven||immediate.lossProven||immediate.kind==='terminal'){onDone?.(immediate);prepareReply();return;}}
  $('analysisState').textContent='분석 중';
  const failed=error=>{if(token!==job)return;worker=null;$('analysisState').textContent='계산 중단 · 후보 유지';if(lastProgress)acceptResult(lastProgress);else{const r=E.analyze(board,p,30);acceptResult(r);}msg('분석 오류: '+error+' · 다시 분석할 수 있습니다.');};
  try{worker=spawnAnalysis(board,p,budget,r=>{if(token===job)acceptResult(r,true);},r=>{if(token!==job)return;worker=null;acceptResult(r);onDone?.(r);prepareReply();},failed);}catch(e){failed(e.message);}
};
const unifiedCommit=commit;
commit=function(i,s){keepPonder=!!(g&&i!=null&&ponder?.opponent===i&&ponder.sourceKey===positionKey(b,turn));try{unifiedCommit(i,s);}finally{keepPonder=false;}};
$('budget').onchange=()=>analyze();$('rethink').onclick=()=>analyze(25000);
const stopButton=button($('budget').closest('details'),'현재 후보로 계산 종료',()=>{stopWorker();$('analysisState').textContent=rec?'현재 후보 유지':'계산 종료';if(rec){rec.reason+=' · 사용자가 계산 종료';render();}});stopButton.id='stopAnalysis';
const recalc=button($('budget').closest('details'),'다시 분석',()=>analyze());recalc.id='analyzeAgain';
const baseTickDisplay=tickDisplay;tickDisplay=function(){baseTickDisplay();if(g?.timer===false){$('timer').textContent='∞';$('timer').classList.remove('warn');$('timebar').style.width='100%';}};
const unifiedRender=render;
render=function(){unifiedRender();
  const descending=g?.axis==='descending';
  for(let i=0;i<225;i++)$('board').children[i].style.order=descending?(14-Math.floor(i/15))*15+i%15:i;
  [...$('axisy').children].forEach((el,i)=>el.textContent=descending?15-i:i+1);
  const lines=document.querySelector('.threat-lines');if(lines)lines.style.transform=descending?'scaleY(-1)':'';
  ruleLabel.textContent=g?`${g.rules?.fivePriority===false?'3·3 금지 우선':'정확한 5목 우선'} · ${g.timer===false?'시간 제한 없음':'40초 초과 PASS'}`:'';
  candidateList.replaceChildren();
  for(const [k,m] of (rec?.candidates||[]).slice(0,3).entries()){
    const el=document.createElement('span');el.className='badge';el.textContent=`${k+1}순위 ${E.coord(m.i)}`;candidateList.append(el);
  }
  analysisPlan.textContent=rec?.autoReason?'자동 분석 · '+rec.autoReason:activePlan;
  if(rec?.lossProven||rec?.proven)$('metrics').textContent=(rec.proven?'강제승 확인':'강제패배 확인 · 합법 후보 유지')+` · ${rec.ms||0}ms`;
  if(rec?.i!=null&&!rec.proven&&!rec.lossProven)$('metrics').textContent=`완료 깊이 ${rec.depth||0}반수 · ${rec.ms||0}ms · ${(rec.nodes||0).toLocaleString()}노드 · 제한 탐색`;
};

// Text records are parsed before changing the current game. Forest JSON stays
// compatible; Reader coordinate strings are converted, not numeric indices.
function parseTextRecord(text,rule,first=1){
  if(text.length>100000)throw Error('기보가 너무 깁니다');
  const entries=text.split(/[·\n\r;]+/).map(s=>s.trim()).filter(Boolean),board=Array(225).fill(0),evs=[],engine=createEngine(rule);
  let p=first,ended=false;
  for(const entry of entries){
    const match=/^(?:\d+\s*[.)]\s*)?(?:(흑|백|노란\s*버섯|초록\s*슬라임)\s*)?([A-O](?:1[0-5]|[1-9])|PASS(?:\([^)]*\))?)$/i.exec(entry);
    if(!match)throw Error('읽을 수 없는 항목: '+entry);
    const color=match[1],q=color?(/흑|버섯/.test(color)?1:2):p;
    if(evs.length===0)p=q;if(q!==p)throw Error((evs.length+1)+'수: 차례가 맞지 않습니다');if(ended)throw Error('5목 완성 이후 수가 있습니다');
    const pass=/^PASS/i.test(match[2]);let i=null,s=null;
    if(!pass){const c=match[2].toUpperCase();i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65;s=engine.inspect(board,i,p);if(!s.legal)throw Error(`${evs.length+1}수 ${c}: ${s.reason}`);board[i]=p;ended=!!s.win.length;}
    evs.push({type:pass?'timeout':'move',i,p,remaining:null,time:null,rec:null,legal:true});p=3-p;
  }
  if(!evs.length)throw Error('기보를 입력하세요');return evs;
}
const importTextButton=button($('copy').parentElement,'텍스트 기보 가져오기',()=>{
  const body=openModal('텍스트 기보 가져오기');paragraph(body,'예: 1. 백 H8 · 2. 흑 G9. 슬라임·버섯 이름과 PASS도 지원합니다. 기존 게임은 보존합니다.');
  const area=document.createElement('textarea');area.setAttribute('aria-label','가져올 텍스트 기보');body.append(area);
  const rule=document.createElement('select');rule.setAttribute('aria-label','기보 규칙');rule.append(new Option('3·3 금지 우선','strict'),new Option('정확한 5목 우선','priority'));body.append(rule);
  const me=document.createElement('select');me.setAttribute('aria-label','기보 내 캐릭터');me.append(new Option('나는 노란 버섯 (흑)','1'),new Option('나는 초록 슬라임 (백)','2'));body.append(me);
  const error=paragraph(body,'');button(body,'검사 후 불러오기',()=>{try{
    const rules={fivePriority:rule.value==='priority'},evs=parseTextRecord(area.value,rules);
    persist();const game={id:crypto.randomUUID(),date:new Date().toISOString(),me:+me.value,first:evs[0].p,rules,timer:false,axis:'descending',events:evs,cursor:evs.length,remaining:40000,result:null};
    db.games.unshift(game);loadGame(game);persist();$('modal').close();msg('기보를 불러왔습니다. 재개 후 다음 수를 입력하거나 복기하세요.');
  }catch(e){error.textContent=e.message;}});
});importTextButton.id='importText';
// Manual reference image: local object URL only, never uploaded or claimed OCR.
const referenceDetails=document.createElement('details'),referenceSummary=document.createElement('summary');referenceSummary.textContent='오목판 사진 참고';referenceDetails.append(referenceSummary);
paragraph(referenceDetails,'사진을 보며 양쪽 착수를 직접 입력하세요. 자동 돌 인식은 하지 않습니다.');
const referenceInput=document.createElement('input');referenceInput.type='file';referenceInput.accept='image/*';referenceInput.setAttribute('aria-label','참고 오목판 사진');referenceDetails.append(referenceInput);
const referenceImage=document.createElement('img');referenceImage.style.cssText='max-width:100%;height:auto;display:none';referenceImage.alt='사용자가 선택한 참고 오목판';referenceDetails.append(referenceImage);
let referenceURL=null;referenceInput.onchange=()=>{if(referenceURL)URL.revokeObjectURL(referenceURL);const f=referenceInput.files[0];referenceURL=f?URL.createObjectURL(f):null;referenceImage.src=referenceURL||'';referenceImage.style.display=f?'block':'none';};
$('board').closest('.card').append(referenceDetails);
// Preserve the character-name copy handler and the original JSON storage key.
const readerStudies=/*READER_STUDIES*/[];
const readerDetails=document.createElement('details'),readerSummary=document.createElement('summary');readerSummary.textContent='기존 수읽기 기보 사례';readerDetails.append(readerSummary);learningCard.append(readerDetails);
for(const study of readerStudies){button(readerDetails,study.n+'수 기보 복기',()=>{
  persist();const evs=study.coords.map((c,k)=>({type:'move',i:(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p:k%2?3-study.first:study.first,remaining:null,rec:null,time:null,legal:true}));
  const game={id:'reader-study-'+study.n,date:'2026-09-23',me:1,first:study.first,rules:{fivePriority:false},timer:false,axis:'descending',events:evs,cursor:evs.length,remaining:40000,result:null,source:'수읽기 기존 사용자 기보'};
  loadGame(db.games.find(x=>x.id===game.id)||game);persist();enterReview(({29:25,31:24,33:26,47:37,48:44,95:93})[study.n]);analyze();
});}
const activeGame=db.games.find(x=>x.id===db.activeId);
if(activeGame)loadGame(activeGame);else{render();$('setup').showModal();}
