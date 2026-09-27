// Unified UI: Forest records, characters and pondering; Reader progress,
// adaptive search, legal fallback, text import and position input.
stopWorker();
const analysisPlan=document.createElement('p');analysisPlan.id='analysisPlan';analysisPlan.className='muted';$('sequence').after(analysisPlan);
const predictionNote=document.createElement('p');predictionNote.id='predictionNote';predictionNote.className='muted';analysisPlan.after(predictionNote);
const candidateList=document.createElement('div');candidateList.className='row';candidateList.id='candidates';$('reason').after(candidateList);
const ruleLabel=document.createElement('p');ruleLabel.className='muted';$('turnInfo').after(ruleLabel);
function setAnalysisStatus(label,detail,mode='ready'){
  const state=$('analysisState'),description=$('analysisDetail');
  state.textContent=label;state.dataset.mode=mode;description.textContent=detail;
}
const setupOptions=document.createElement('div');
setupOptions.innerHTML='<label>5목과 3·3이 동시에 생기면<select id="fivePriority"><option value="strict">3·3 금지 우선 (수읽기 기존 규칙)</option><option value="priority">정확한 5목 우선 (숲속 기존 규칙)</option></select></label><label>좌표 표시<select id="axisChoice"><option value="descending">위 15 → 아래 1 (수읽기 방식)</option><option value="ascending">위 1 → 아래 15 (숲속 방식)</option></select></label><label><input type="checkbox" id="useTimer"> 40초 시계 사용 · 초과 시 PASS</label><p class="muted">노란 버섯 = 흑 · 초록 슬라임 = 백. 선후공은 별도로 선택합니다.</p>';
$('setup').querySelector('.modal-actions').before(setupOptions);
$('my').options[0].textContent='초록 슬라임 (백)';$('my').options[1].textContent='노란 버섯 (흑)';
versionBadge.textContent='통합 v5.9.0';versionBadge.title='독립 공격축 평가와 강제 방어 뒤 반격 검사 · 상대 수 1초 예측';versionBadge.setAttribute('aria-label','통합 버전 5.9.0');
document.title='숲속 오목 · 통합 수읽기';document.querySelector('h1').textContent='숲속 오목 · 통합 수읽기';
wideHelp.textContent='상대 다음 수는 1초로 빠르게 예측합니다. 내 수와 예상 응수는 아래에서 선택한 시간으로 분석합니다. 자동 모드에서는 국면에 따라 시간을 정합니다. 추천은 무패 보장이 아닙니다.';
$('budget').replaceChildren();
for(const [v,t] of [['auto','자동 · 최대 8초 (권장)'],['900','빠르게 · 1초'],['3000','비교 · 3초'],['8000','정밀 · 8초'],['15000','심층 · 15초'],['25000','심층 · 25초']]){const o=new Option(t,v);$('budget').append(o);}
$('budget').parentElement.firstChild.textContent='내 수 분석 시간 ';
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
function configuredOwnBudget(board,p,available=40000,explicit){
  const choice=explicit??($('budget').value==='auto'?null:+$('budget').value);
  const plan=choice==null?E.suggestBudget(board,p,available):{ms:Math.max(30,Math.min(choice,available-3000)),reason:'직접 선택'};
  const label=(choice==null?'자동 ':'분석 ')+(plan.ms<1000?'즉시':`최대 ${(plan.ms/1000).toFixed(1)}초`)+` · ${plan.reason}`;
  return {budget:choice==null?{automatic:true,ms:plan.ms}:plan.ms,label};
}
function selectedBudget(board,p,explicit){
  if(!reviewing&&g&&p!==g.me){
    activePlan='상대 다음 수 예측 · 1초 고정';analysisPlan.textContent=activePlan;
    return 1000;
  }
  const available=reviewing||paused||g?.timer===false?40000:Math.max(0,deadline-Date.now());
  const own=configuredOwnBudget(board,p,available,explicit);
  activePlan=own.label;analysisPlan.textContent=activePlan;
  return own.budget;
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
  if(partial)setAnalysisStatus('분석 중','현재 표시는 임시 후보입니다. 계산이 끝나면 최종 추천으로 바뀝니다.','thinking');
  else if(result.proven)setAnalysisStatus('분석 완료 · 강제승','확인한 강제승 수순입니다. 추천 좌표를 두세요.','urgent');
  else if(result.lossProven)setAnalysisStatus('분석 완료 · 불리','강제패배가 확인되었지만, 계속 둘 수 있는 합법 후보를 표시합니다.','warning');
  else if(result.i==null)setAnalysisStatus('분석 완료 · 추천 없음','검사한 후보가 배제되었고 안전한 대안을 확인하지 못했습니다. 더 이른 수에서 복기하세요.','warning');
  else if(result.unverifiedDefense)setAnalysisStatus('분석 완료 · 방어 미증명','강제패배가 확인되었거나 응수 검사가 끝나지 않은 위험 후보를 제외했습니다. 현재 좌표는 합법 대안이며 무패는 확인되지 않았습니다.','warning');
  else setAnalysisStatus('분석 완료','아래 1순위가 최종 추천입니다. 해당 좌표를 두세요.','complete');
  render();return true;
}
function prepareReply(){
  cancelPonder();if(!g||g.result||reviewing||turn===g.me||rec?.i==null)return;
  const board=b.slice(),opponent=rec.i,p=3-turn;board[opponent]=turn;if(E.win(board,opponent,turn).length)return;
  const budget=configuredOwnBudget(board,p,40000).budget;
  const task={opponent,key:positionKey(board,p),sourceKey:positionKey(b,turn),started:Date.now(),worker:null,result:null,partial:null,promoted:false};ponder=task;
  predictionNote.textContent=`상대 ${E.coord(opponent)} 1초 예측 · 내 응수 ${$('budget').selectedOptions[0]?.textContent||'선택 시간'}으로 사전 계산`;
  const current=()=>ponder===task&&g&&!reviewing&&positionKey(b,turn)===(task.promoted?task.key:task.sourceKey);
  const finish=r=>{if(!current())return;task.worker=null;task.result=r;if(task.promoted){acceptResult(r);predictionNote.textContent='예측 일치 · 사전 계산 결과 사용';task.onDone?.(r);}else predictionNote.textContent=`상대 ${E.coord(opponent)} 예상 · 응수 ${r.i==null?'없음':E.coord(r.i)} 준비 완료`;};
  const immediate=E.urgent(board,p);if(immediate&&(typeof budget==='object'||immediate.proven||immediate.lossProven||immediate.kind==='terminal')){finish(immediate);return;}
  try{task.worker=spawnAnalysis(board,p,budget,r=>{if(current()){task.partial=r;if(task.promoted)acceptResult(r,true);}},finish,()=>{if(current()){cancelPonder();if(task.promoted)analyze();}});}catch(e){cancelPonder();}
}
analyze=function(explicit,onDone){
  if(!g||g.result){stopWorker();rec=null;render();const winner=g?.result?.winner,outcome=winner?(winner===g.me?'내 승리':'내 패배'):'';setAnalysisStatus(winner?`대국 종료 · ${names[winner]} 승리 · ${outcome}`:g?.result?'대국 종료 · 무승부':'분석 준비',winner?`정확한 5목 완성: ${winCells.map(E.coord).join(' → ')}`:g?.result?'빈칸 없이 종료되었습니다.':'착수 후 자동으로 추천을 계산합니다.',winner?'complete':g?.result?'stopped':'ready');return;}
  if(explicit==null&&!reviewing&&turn===g.me&&ponder?.key===positionKey(b,turn)){
    const task=ponder;task.promoted=true;task.onDone=onDone;
    analysisPlan.textContent='상대 예상 수 일치 · 선택한 내 수 분석 시간 이어받음';
    if(task.result){acceptResult(task.result);predictionNote.textContent='예측 일치 · 사전 계산 결과 사용';onDone?.(task.result);}else if(task.partial)acceptResult(task.partial,true);
    else setAnalysisStatus('분석 중','상대 예상 수가 일치했습니다. 앞서 시작한 계산을 이어서 완료합니다.','thinking');return;
  }
  stopWorker();lastProgress=null;rec=null;render();const token=job,board=b.slice(),p=turn,budget=selectedBudget(board,p,explicit);
  const immediate=E.urgent(board,p);if(immediate){acceptResult(immediate);if(typeof budget==='object'||immediate.proven||immediate.lossProven||immediate.kind==='terminal'){onDone?.(immediate);prepareReply();return;}}
  setAnalysisStatus('분석 중','임시 후보를 먼저 찾고, 공격·방어를 계속 비교하고 있습니다.','thinking');
  const failed=error=>{if(token!==job)return;worker=null;if(lastProgress){setAnalysisStatus('분석 중단 · 후보 유지','완료된 비교 결과가 없어 현재의 합법 후보를 유지합니다.','stopped');}else{const r=E.analyze(board,p,30);acceptResult(r);}msg('분석 오류: '+error+' · 다시 분석할 수 있습니다.');};
  try{worker=spawnAnalysis(board,p,budget,r=>{if(token===job)acceptResult(r,true);},r=>{if(token!==job)return;worker=null;acceptResult(r);onDone?.(r);prepareReply();},failed);}catch(e){failed(e.message);}
};
const unifiedCommit=commit;
commit=function(i,s){keepPonder=!!(g&&i!=null&&ponder?.opponent===i&&ponder.sourceKey===positionKey(b,turn));try{unifiedCommit(i,s);}finally{keepPonder=false;}};
$('budget').onchange=()=>analyze();$('rethink').onclick=()=>analyze(25000);
const stopButton=button($('budget').closest('details'),'현재 후보로 계산 종료',()=>{stopWorker();setAnalysisStatus(rec?'현재 후보 유지':'계산 종료',rec?'현재 후보는 합법적입니다. 더 깊은 비교는 멈췄습니다.':'분석할 국면이 없습니다.','stopped');if(rec){rec.reason+=' · 사용자가 계산 종료';render();}});stopButton.id='stopAnalysis';
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
  text=text.replace(/^\s*내 돌\s*:[^\r\n]*(?:\r?\n|$)/i,'');
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
const case80Id='slime-loss-2026-09-27-80';
const case80Moves='H8 G7 G8 F8 E9 F7 F9 H7 E7 E8 D9 C9 G9 H9 I7 F10 J6 K5 J7 I8 G6 C8 B8 H6 J8 I5 J4 J5 H5 C7 J9 J10 C6 C10 C11 G10 H10 E12 F11 L5 M5 D11 B9 G12 H12 D10 E10 F12 G13 D12 C12 F13 G14 C13 B14 D13 D14 E13 B13 E14 H11 I6 K7 K4 L3 G11 L6 N4 L7 M7 H13 H14 B7 E15 E11 B6 B10 B11 K8 I10'.split(' ');
const case80Notes={
  67:'68수 N4는 즉시 5목을 막는 필수 방어. 이후 노란 버섯에 연속 공격 수순이 있었음',
  69:'70수 M7도 필수 방어',
  70:'71수 H13에서 상대가 강제 수순 K8을 놓쳐 초록에게 다시 방어 기회가 생김',
  73:'74수 E15가 최종 분기점. 심층 분석 대안은 E11이며, E15 뒤 상대 E11 준비 수를 허용함',
  74:'75수 E11로 노란 버섯의 연속 위협이 시작됨. 이후 초록의 모든 합법 방어에 강제승 수순 확인',
  75:'76수 B6은 합법 후보지만 이미 강제패배 국면',
  79:'80수 I10은 즉시 방어점이지만 M6부터 시작하는 상대 강제승 수순이 남음'
};
function makeCase80(){
  const board=Array(225).fill(0),ruleEngine=createEngine({fivePriority:false}),events=case80Moves.map((c,k)=>{const i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?2:1,s=ruleEngine.inspect(board,i,p);if(!s.legal)throw Error('80수 기보 규칙 오류: '+(k+1)+'수 '+c);board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:case80Notes[k]||''};});
  return {id:case80Id,date:'2026-09-27',me:2,first:1,rules:{fivePriority:false},timer:false,axis:'ascending',events,cursor:80,remaining:40000,result:null,source:'사용자 제공 80수 기보 · 초록 슬라임 · 74수 E15 최종 분기점'};
}
const case80Game=makeCase80();
if(!db.appliedUpdates?.includes('slime-loss-80-v4.1')){if(!db.games.some(x=>x.id===case80Id))db.games.push(case80Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'slime-loss-80-v4.1'];persist();}
const case80Button=button(readerDetails,'80수 초록 패배 · 74수 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case80Id)||case80Game);enterReview(73);analyze(15000);msg('74수 직전입니다. 실제 E15와 심층 대안 E11을 비교합니다. 15초 분석이 끝날 때까지 임시 후보와 최종 추천을 구분해 확인하세요.');});
case80Button.id='case80Study';
const case30Id='slime-force-win-2026-09-27-30';
const case30Moves='H8 G7 H7 H6 F8 G8 G6 H9 F7 G10 G9 I8 F11 F10 F5 F6 E8 H5 E4 D3 E7 H10 E6 E5 D9 C10 D6 C5 E10 E9'.split(' ');
function makeCase30(){
  const board=Array(225).fill(0),ruleEngine=createEngine({fivePriority:false}),events=case30Moves.map((c,k)=>{const i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=ruleEngine.inspect(board,i,p);if(!s.legal)throw Error('30수 기보 규칙 오류: '+(k+1)+'수 '+c);board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:k===29?'30수 E9 뒤 초록 C8이 4-3 동시 위협을 만들어 B7·G12 두 승리점을 확보함':''};});
  return {id:case30Id,date:'2026-09-27',me:2,first:2,rules:{fivePriority:false},timer:false,axis:'ascending',events,cursor:30,remaining:40000,result:null,source:'사용자 제공 30수 기보 · 아직 패배 아님 · 초록 C8 강제승'};
}
const case30Game=makeCase30();
if(!db.appliedUpdates?.includes('slime-force-win-30-v5')){if(!db.games.some(x=>x.id===case30Id))db.games.push(case30Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'slime-force-win-30-v5'];persist();}
const case30Button=button(readerDetails,'30수 초록 · C8 강제승 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case30Id)||case30Game);enterReview(30);analyze();msg('30수 E9 뒤 초록 차례입니다. C8은 B7·G12 두 승리점을 동시에 만드는 확인된 강제승 시작점입니다.');});
case30Button.id='case30Study';
const case19Id='slime-win-2026-09-27-19';
const case19Moves='H8 G7 I8 F8 H9 H6 E9 G6 H10 H7 F9 G9 G10 I5 J4 H11 J7 K6 F11'.split(' ');
function makeCase19(){
  const board=Array(225).fill(0),ruleEngine=createEngine({fivePriority:false}),events=case19Moves.map((c,k)=>{const i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=ruleEngine.inspect(board,i,p);if(!s.legal)throw Error('19수 기보 규칙 오류: '+(k+1)+'수 '+c);board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:k===15?'노란 16수 H11 패착 · 초록의 강제승 허용':k===16?'초록 J7이 K6·F11 양끝 승리 위협 생성':k===17?'K6을 막아도 반대쪽 F11이 남음':k===18?'F11–G10–H9–I8–J7 정확한 5목으로 초록 승리':''};});
  return {id:case19Id,date:'2026-09-27',me:1,first:2,rules:{fivePriority:false},timer:false,axis:'ascending',events,cursor:19,remaining:40000,result:{winner:2},source:'사용자 제공 19수 기보 · 노란 버섯 16수 H11 패착 복기'};
}
const case19Game=makeCase19();
if(!db.appliedUpdates?.includes('yellow-defense-19-v5.2')){const old=db.games.findIndex(x=>x.id===case19Id);if(old>=0)db.games[old]=case19Game;else db.games.push(case19Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'yellow-defense-19-v5.2'];persist();}
const case19Button=button(readerDetails,'19수 노란 패배 · 16수 방어 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case19Id)||case19Game);enterReview(15);analyze();msg('노란 버섯의 16수 차례입니다. H11은 초록 J7–K6/F11 강제승을 즉시 허용합니다. G5는 직접 수순을 늦추는 저항 수이며 전체 강제패배 판정은 유지됩니다.');});
case19Button.id='case19Study';
const case27bId='mushroom-diagonal-loss-2026-09-27-27';
const case27bMoves='H8 G7 H9 H6 I8 F8 I5 F7 J7 G10 I6 I7 J8 E7 H7 K8 J6 D7 C7 J9 H11 H10 J5 J4 G8 F9 K4'.split(' ');
function makeCase27b(){
  const board=Array(225).fill(0),ruleEngine=createEngine({fivePriority:false}),events=case27bMoves.map((c,k)=>{const i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=ruleEngine.inspect(board,i,p);if(!s.legal)throw Error('27수 노란 기보 규칙 오류: '+(k+1)+'수 '+c);board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:k===13?'14수 E7이 초록 H7을 강제해 대각선 연결을 키운 분기점 · H7 선점 권장':k===24?'G8로 F9·K4 양끝 승리 위협 발생':k===26?'G8–H7–I6–J5–K4 정확한 5목으로 초록 승리':''};});
  return {id:case27bId,date:'2026-09-27',me:1,first:2,rules:{fivePriority:false},timer:false,axis:'ascending',events,cursor:27,remaining:40000,result:{winner:2},source:'사용자 제공 27수 기보 · 노란 버섯 · 14수 H7 선점 방어 복기'};
}
const case27bGame=makeCase27b();
if(!db.appliedUpdates?.includes('yellow-h7-defense-27-v5.3')){const old=db.games.findIndex(x=>x.id===case27bId);if(old>=0)db.games[old]=case27bGame;else db.games.push(case27bGame);db.appliedUpdates=[...(db.appliedUpdates||[]),'yellow-h7-defense-27-v5.3'];persist();}
const case27bButton=button(readerDetails,'27수 노란 패배 · 14수 H7 방어 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case27bId)||case27bGame);enterReview(13);analyze(15000);msg('노란 버섯의 14수 차례입니다. E7 대신 H7을 먼저 두면 초록 E7 방어를 강제하면서 패배 기보의 대각선 연결을 차단합니다. 전체 무패는 제한 탐색 범위에서만 평가됩니다.');});
case27bButton.id='case27bStudy';
const case31Id='mushroom-provisional-loss-2026-09-27-31';
const case31Moves='H8 G9 H9 H10 F8 G8 G7 E9 F10 F9 G10 E10 H7 H6 I8 D9 C9 J7 F6 D11 C12 I9 E5 D4 F5 G6 F7 F4 E7 I7 D7'.split(' ');
function makeCase31(){
  const board=Array(225).fill(0),ruleEngine=createEngine({fivePriority:false}),events=case31Moves.map((c,k)=>{const i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=ruleEngine.inspect(board,i,p);if(!s.legal)throw Error('31수 노란 기보 규칙 오류: '+(k+1)+'수 '+c);board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:k===13?'14수 H6은 초기 임시 후보였지만 I8 뒤 강제 수순을 허용 · D9 최종 방어':k===28?'E7로 D7·I7 양끝 승리 위협 발생':k===30?'D7–E7–F7–G7–H7 정확한 5목으로 초록 승리':''};});
  return {id:case31Id,date:'2026-09-27',me:1,first:2,rules:{fivePriority:false},timer:false,axis:'ascending',events,cursor:31,remaining:40000,result:{winner:2},source:'사용자 제공 31수 기보 · 노란 버섯 · 14수 D9 즉시 패턴 방어'};
}
const case31Game=makeCase31();
if(!db.appliedUpdates?.includes('yellow-d9-defense-31-v5.4')){const old=db.games.findIndex(x=>x.id===case31Id);if(old>=0)db.games[old]=case31Game;else db.games.push(case31Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'yellow-d9-defense-31-v5.4'];persist();}
const case31Button=button(readerDetails,'31수 노란 패배 · 14수 D9 방어 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case31Id)||case31Game);enterReview(13);analyze();msg('노란 버섯의 14수 차례입니다. 새 게임 엔진도 분석 시작 즉시 D9을 최종 패턴 방어로 표시합니다. H6 임시 후보는 더 이상 노출되지 않습니다.');});
case31Button.id='case31Study';
const case26Id='mushroom-early-defense-2026-09-27-26';
const case26Moves='H8 G7 I8 F8 H6 G9 H7 H9 J8 G8 G6 J9 K8 L8 K9 F9 I9 G11 G10 I7 I6 E9 D9 F6 K6 J6'.split(' ');
function makeCase26(){
  const board=Array(225).fill(0),ruleEngine=createEngine({fivePriority:false}),events=case26Moves.map((c,k)=>{const i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=ruleEngine.inspect(board,i,p);if(!s.legal)throw Error('26수 노란 기보 규칙 오류: '+(k+1)+'수 '+c);if(s.win.length)throw Error('26수 이전에 종료된 기보');board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:k===5?'6수 G9가 H7–J8–G6 연결을 허용한 최초 예방 분기점 · H7 선점 권장':k===14?'15수 K9 뒤 초록 연속 4 강제승 확인':k===25?'26수 J6 뒤 초록 차례 · F5–E4–K7 강제승':''};});
  return {id:case26Id,date:'2026-09-27',me:1,first:2,rules:{fivePriority:false},timer:false,axis:'ascending',events,cursor:26,remaining:40000,result:null,source:'사용자 제공 26수 기보 · 노란 버섯 · 6수 H7 선점 방어 복기'};
}
const case26Game=makeCase26();
if(!db.appliedUpdates?.includes('yellow-h7-early-defense-26-v5.5')){const old=db.games.findIndex(x=>x.id===case26Id);if(old>=0)db.games[old]=case26Game;else db.games.push(case26Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'yellow-h7-early-defense-26-v5.5'];persist();}
const case26Button=button(readerDetails,'26수 노란 패배 · 6수 H7 방어 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case26Id)||case26Game);enterReview(5);analyze();msg('노란 버섯의 6수 차례입니다. G9 대신 H7을 선점해 기록된 H7–J8–G6 연결을 막습니다. 새 게임 엔진에도 즉시 적용되며 전체 무패는 제한 탐색 범위에서만 평가됩니다.');});
case26Button.id='case26Study';
const case13Id='slime-g11-defense-2026-09-27-13';
const case13Moves='H8 H6 I9 G7 H10 F8 E9 E7 G11 J8 F10 I5 J4'.split(' ');
function makeCase13(){
  const board=Array(225).fill(0),ruleEngine=createEngine({fivePriority:false}),events=case13Moves.map((c,k)=>{const i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?2:1,s=ruleEngine.inspect(board,i,p);if(!s.legal||s.win.length)throw Error('13수 초록 기보 규칙 오류: '+(k+1)+'수 '+c);board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:k===7?'8수 E7 대신 G11 선점으로 기록된 공격 연결 차단':k===11?'12수 I5가 J4 방어를 강제하지만, 그 뒤 강제패 수순이 남음':k===12?'13수 J4 뒤 초록의 모든 합법 방어에 강제패 수순 확인':''};});
  return {id:case13Id,date:'2026-09-27',me:2,first:1,rules:{fivePriority:false},timer:false,axis:'ascending',events,cursor:13,remaining:40000,result:null,source:'사용자 제공 13수 기보 · 초록 슬라임 · 8수 G11 선점 방어'};
}
const case13Game=makeCase13();
if(!db.appliedUpdates?.includes('slime-g11-defense-13-v5.7')){const old=db.games.findIndex(x=>x.id===case13Id);if(old>=0)db.games[old]=case13Game;else db.games.push(case13Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'slime-g11-defense-13-v5.7'];persist();}
const case13Button=button(readerDetails,'13수 초록 강제패 · 8수 G11 방어 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case13Id)||case13Game);enterReview(7);analyze();msg('초록 슬라임의 8수 차례입니다. E7 대신 G11을 선점해 기록된 노랑 G11 공격을 차단합니다. 전체 무패 보장은 아니며 새 게임 엔진에도 즉시 적용됩니다.');});
case13Button.id='case13Study';
const activeGame=db.games.find(x=>x.id===db.activeId);
if(activeGame)loadGame(activeGame);else{render();$('setup').showModal();}
