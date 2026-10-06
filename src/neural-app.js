// User-selected weights are data, not executable code. Each change starts a new
// search context; foreground and opponent/reply Workers receive the same model.
(()=>{
 const KEY='forest-omok-learning-model-v1',embedded=OmokNeural.getDefaultModel();let manual=false;
 const panel=document.createElement('div');panel.className='card';panel.id='learningModelPanel';
 panel.innerHTML='<h2>학습 모델 자동 적용</h2><p id="learningModelStatus" role="status"></p><p id="learningModelExplanation" class="muted"></p><div class="toolbar"><button id="openLearningDashboard" class="primary">학습 화면 열기</button></div><p class="muted">바탕화면의 「숲속 오목 학습」을 실행하면 학습 화면이 열립니다. 내 경기 기보는 기록 내보내기 후 학습 화면에서 선택하세요.</p><details id="learningModelAdvanced"><summary>고급 설정 · 수동 모델 관리</summary><p class="muted">일반 사용에서는 변경할 필요가 없습니다. 별도 모델을 가져오거나 학습 보정을 비교할 때 사용하세요. 수동 선택은 다음 실행에도 유지됩니다.</p><div class="toolbar"><button id="loadLearningModel">별도 채택 모델 가져오기</button><button id="defaultLearningModel">자동 적용 설정으로 돌아가기</button><button id="disableLearningModel">학습 모델 보정 끄기</button></div><p id="learningModelNotice" class="muted" role="status"></p><input id="learningModelFile" type="file" accept=".json,application/json" hidden></details>';
 gpuPanel.after(panel);
 function describe(){const info=E.getModelInfo();$('learningModelStatus').textContent=info.active?(manual?'수동 선택 · ':'자동 적용 · ')+'CPU 학습 평가 사용 중':manual?'수동 설정 · 학습 모델 보정을 꺼둔 상태입니다.':'자동 적용 대기 · 아직 채택된 학습 모델이 없습니다.';$('learningModelExplanation').textContent=manual?'수읽기와 규칙 검사는 그대로 사용합니다. 자동 적용으로 돌아가려면 고급 설정에서 「자동 적용 설정으로 돌아가기」를 누르세요.':info.active?'검증을 통과한 학습 모델이 적용되어 있습니다. 일반 대국에서는 설정을 바꾸지 않아도 됩니다.':'현재는 기존 수읽기와 패턴 평가로 대국합니다. 검증을 통과한 모델이 HTML에 반영되면 오목 파일을 다시 열어 적용하세요.';$('defaultLearningModel').disabled=!manual;$('disableLearningModel').disabled=!info.active;}
 function notify(text){$('learningModelNotice').textContent=text;msg(text);}
 function apply(model,persist=true,rethink=true){
  if(model){OmokNeural.validate(model);if(model.adoption?.accepted!==true)throw Error('채택되지 않은 후보 모델은 실제 대국에 적용할 수 없습니다.');}stopWorker();cancelPonder();E.configure({model});spawnAnalysis.memory?.store.clear();rec=null;lastProgress=null;
  if(persist){manual=true;try{localStorage.setItem(KEY,JSON.stringify({model}));}catch{}}
  describe();if(rethink&&g&&!g.result&&!reviewing&&globalThis.omokComputeReady)analyze();
 }
 try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved&&Object.prototype.hasOwnProperty.call(saved,'model')){if(saved.model){OmokNeural.validate(saved.model);if(saved.model.adoption?.accepted!==true)throw Error('미채택 모델');}manual=true;apply(saved.model,false,false);}}catch{manual=false;describe();}
 describe();
 $('openLearningDashboard').onclick=()=>window.open('http://127.0.0.1:8766','_blank','noopener');
 $('loadLearningModel').onclick=()=>$('learningModelFile').click();
 $('learningModelFile').onchange=async event=>{const file=event.target.files?.[0];if(!file)return;try{
  if(file.size>1024*1024)throw Error('모델 파일은 1MiB 이하이어야 합니다.');const model=JSON.parse(await file.text());OmokNeural.validate(model);
  if(model.adoption?.accepted!==true)throw Error('독립 대국 검증을 통과해 채택된 모델만 사용할 수 있습니다. 로컬 학습 도구의 채택 모델을 선택하세요.');
  apply(model);notify('채택된 학습 모델을 CPU 수읽기에 연결했습니다.');
 }catch(error){notify('학습 모델을 읽지 못했습니다: '+error.message);}finally{event.target.value='';}};
 $('defaultLearningModel').onclick=()=>{try{localStorage.removeItem(KEY);}catch{}manual=false;apply(embedded,false);notify(embedded?'자동 적용으로 돌아왔습니다. 기본 채택 모델을 사용합니다.':'자동 적용으로 돌아왔습니다. 아직 채택된 모델이 없어 기존 패턴 평가를 사용합니다.');};
 $('disableLearningModel').onclick=()=>{apply(null);notify('학습 모델 보정을 껐습니다. 수읽기 엔진은 그대로 사용합니다.');};
})();
