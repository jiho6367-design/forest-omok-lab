'use strict';
const $=id=>document.getElementById(id);
let session=null,selectedId='',record=null,recordName='',busy=false;
const phases={ready:'실험 준비',import:'기보 복원',analyze:'취약 국면과 대안 분석',analysis:'취약 국면과 대안 분석',generate:'변형 대국과 학습 자료 생성',train:'GPU 모델 학습',validate:'흑백 교환 대국으로 성능 검증',adopt:'채택 기준 확인',created:'실험 준비',complete:'실험 완료'};
const statuses={created:'준비',running:'진행 중',stopped:'중단됨',complete:'완료',completed:'완료',failed:'오류',pending:'대기'};
function notice(text){$('notice').textContent=text||'';}
async function api(route,body){const response=await fetch(route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Omok-Session':session.token}:{},body:body?JSON.stringify(body):undefined});const value=await response.json();if(!response.ok)throw Error(value.error||'요청에 실패했습니다.');return value;}
function setPreset(){const preset=session?.presets[$('preset').value];if(!preset)return;for(const key of ['minutes','games','pairs','epochs'])$(key).value=preset[key];}
function download(id,kind,available){const element=$(kind+'Download');element.hidden=!available;element.href='/api/download?id='+encodeURIComponent(id)+'&kind='+kind;}
function number(value){return Number.isFinite(Number(value))?Number(value).toLocaleString('ko-KR'):'—';}
function lastAdoption(state){const history=[...(state?.adoptions||[]),...(state?.adoptionHistory||[]),...(state?.decisions||[])];return history.sort((a,b)=>String(a.at||'').localeCompare(String(b.at||''))).at(-1)||state?.adoption||null;}
function renderSelected(run){
  const state=run?.state||{},count=state.counters||{},training=run?.training||state.training||{},metadata=run?.candidate?.training||{},gpu=training.gpuMetrics||training.gpu||training.metrics||(typeof training.device==='object'?training.device:training),arena=run?.arena||{},selected=!!run;
  const running=!!run?.active,status=running?'running':state.status||'created';$('stateBadge').textContent=selected?statuses[status]||status:'대기';$('stateBadge').className='badge '+status;
  $('phase').textContent=selected?(phases[state.phase]||state.phase||'실험 준비'):'기보를 넣으면 분석부터 검증까지 이어서 실행합니다.';
  $('message').textContent=state.message||state.error||state.errors?.at?.(-1)?.message||'';
  $('completedGames').textContent=number(count.completedGames??0);$('samples').textContent=number(count.samples??metadata.trainSamples??0);$('updates').textContent=number(metadata.updates??gpu.updates??0);
  $('uniquePositions').textContent=Number.isFinite(count.uniquePositions)?'고유 국면 '+number(count.uniquePositions)+'개':'고유 국면 집계 전';
  const elapsedMs=state.lastRun?.elapsedMs??state.timing?.elapsedMs??state.timing?.totalElapsedMs??state.elapsedMs??(Array.isArray(state.timing)?state.timing.reduce((sum,row)=>sum+(row.elapsedMs||0),0):Array.isArray(state.timings)?state.timings.reduce((sum,row)=>sum+(row.elapsedMs||0),0):undefined);$('elapsed').textContent=Number.isFinite(elapsedMs)?Math.round(elapsedMs/1000)+'초':'—';
  $('stopButton').disabled=!running||run.stopRequested;$('resumeButton').disabled=!selected||!!session.activeId||running;$('startButton').disabled=busy||!!session.activeId;$('stopping').hidden=!run?.stopRequested||!running;
  const trainedOnCuda=gpu.trainedOnCuda??training.trainedOnCuda??metadata.device?.startsWith?.('cuda');
  $('gpu').textContent=run?.candidate?(trainedOnCuda?'GPU 학습 완료':'학습 모델 생성 · GPU 실행 여부는 기록에서 확인')+(gpu.name?' · '+gpu.name:''):'학습 결과가 아직 없습니다.';
  $('training').textContent=run?.candidate?['학습 국면 '+number(metadata.trainSamples??training.trainSamples),metadata.validationMse!=null?'분리 검증 오차 '+Number(metadata.validationMse).toFixed(5):'',gpu.elapsedSeconds!=null?'학습 '+Number(gpu.elapsedSeconds).toFixed(1)+'초':'',gpu.samplesPerSecond!=null?'초당 '+number(Math.round(gpu.samplesPerSecond))+'국면':''].filter(Boolean).join(' · '):'';
  const adoption=lastAdoption(state)||run?.adoption,accepted=!!run?.champion;
  $('adoption').textContent=adoption?.decision==='insufficient-evidence'?'검증이 충분하지 않아 이번 후보를 채택하지 않았습니다. 기존 엔진을 유지합니다.':adoption&&(adoption.adopted===false||adoption.accepted===false)?'새 후보가 채택 기준에 미달하여 기존 엔진을 유지합니다.':accepted?'검증을 통과한 모델이 저장됐습니다.':adoption?'채택 기준에 미달하여 기존 엔진을 유지합니다.':'검증 전입니다. 기존 엔진을 유지합니다.';
  const result=arena.summary||arena.stats?.baseline||arena.results||arena;const details=[];
  if(result.wins!=null)details.push('승 '+number(result.wins));if(result.losses!=null)details.push('패 '+number(result.losses));if(result.draws!=null)details.push('무 '+number(result.draws));if(result.unfinished!=null)details.push('미완료 '+number(result.unfinished));if(result.completedGames!=null)details.push('완료 '+number(result.completedGames)+'대국');if(result.completedPairs!=null)details.push('흑백 '+number(result.completedPairs)+'쌍');if(result.lowerConfidenceBound!=null)details.push('점수 신뢰하한 '+(100*result.lowerConfidenceBound).toFixed(1)+'%');if(arena.reason||adoption?.reason)details.push(arena.reason||adoption.reason);
  $('validation').textContent=details.join(' · ');for(const kind of ['champion','candidate','arena'])download(run?.id||'',kind,kind==='champion'?accepted:kind==='candidate'?!!run?.candidate:!!run?.arena);
  $('log').textContent=run?.log||'기록이 아직 없습니다.';
}
async function refresh(){if(!session)return;try{const result=await api('/api/status'+(selectedId?'?id='+encodeURIComponent(selectedId):''));session.activeId=result.activeId;
  if(!selectedId)selectedId=result.activeId||result.runs[0]?.id||'';
  const old=$('runs').value;$('runs').replaceChildren();if(!result.runs.length){const option=document.createElement('option');option.value='';option.textContent='아직 실험이 없습니다';$('runs').append(option);}for(const run of result.runs){const option=document.createElement('option');option.value=run.id;option.textContent=run.id+' · '+(statuses[run.state?.status]||run.state?.status||'준비');$('runs').append(option);}$('runs').value=selectedId||old;
  if(result.selected?.id===selectedId)renderSelected(result.selected);else if(selectedId){const detail=await api('/api/status?id='+encodeURIComponent(selectedId));renderSelected(detail.selected);}else renderSelected(null);
  }catch(error){notice(error.message);}}
$('preset').addEventListener('change',setPreset);
$('runs').addEventListener('change',()=>{selectedId=$('runs').value;refresh();});
$('recordFile').addEventListener('change',async()=>{const file=$('recordFile').files[0];if(!file){record=null;recordName='';return;}try{if(file.size>2*1024*1024)throw Error('2 MiB 이하의 기보를 선택해 주세요.');const text=await file.text();const parsed=JSON.parse(text);if(!parsed||typeof parsed!=='object')throw Error('기보는 JSON 객체 또는 배열이어야 합니다.');record=parsed;recordName=file.name;$('recordInfo').textContent=file.name+' · '+number(file.size)+'바이트';notice('');}catch(error){record=null;$('recordInfo').textContent='기보를 읽지 못했습니다.';notice(error.message);}});
$('startForm').addEventListener('submit',async event=>{event.preventDefault();if(busy||!session)return;busy=true;$('startButton').disabled=true;notice('');try{let input=record;if($('recordText').value.trim())input=JSON.parse($('recordText').value);const config={};for(const key of ['minutes','games','pairs','epochs'])config[key]=Number($(key).value);const result=await api('/api/start',{record:input,recordName:recordName||'붙여넣은 기보.json',preset:$('preset').value,config});selectedId=result.id;session.activeId=result.id;notice('기존 기보를 바탕으로 분석과 학습을 시작했습니다.');await refresh();}catch(error){notice(error.message);}finally{busy=false;$('startButton').disabled=!!session.activeId;}});
$('stopButton').addEventListener('click',async()=>{if(!selectedId)return;try{await api('/api/stop',{id:selectedId});notice('중단을 요청했습니다. 현재 작업을 마치고 저장한 뒤 멈춥니다.');await refresh();}catch(error){notice(error.message);}});
$('resumeButton').addEventListener('click',async()=>{if(!selectedId)return;try{await api('/api/resume',{id:selectedId});session.activeId=selectedId;notice('저장한 진행 상태에서 재개했습니다.');await refresh();}catch(error){notice(error.message);}});
api('/api/session').then(value=>{session=value;setPreset();return refresh();}).catch(error=>notice(error.message));
setInterval(refresh,2000);
