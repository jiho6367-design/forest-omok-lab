// User-selected weights are data, not executable code. Each change starts a new
// search context; foreground and opponent/reply Workers receive the same model.
(()=>{
 const KEY='forest-omok-learning-model-v1',embedded=OmokNeural.getDefaultModel();
 const panel=document.createElement('div');panel.className='card';
 panel.innerHTML='<h2>기존 엔진 보완 학습</h2><p id="learningModelStatus" role="status"></p><p class="muted">GPU로 학습한 작은 모델을 CPU 수읽기의 국면 평가에 사용합니다. 규칙과 전술 검증은 기존 엔진이 맡습니다.</p><div class="toolbar"><button id="loadLearningModel">채택된 모델 가져오기</button><button id="defaultLearningModel">검증된 기본 모델</button><button id="disableLearningModel">기존 평가만 사용</button></div><input id="learningModelFile" type="file" accept=".json,application/json" hidden><p class="muted"><a id="openLearningDashboard" href="http://127.0.0.1:8766" target="_blank" rel="noopener">로컬 학습 도구 열기</a> · 먼저 프로젝트의 학습 도구를 실행하세요. 저장된 기보는 기록 내보내기로 전달할 수 있습니다.</p>';
 gpuPanel.after(panel);
 function describe(){const info=E.getModelInfo();$('learningModelStatus').textContent=info.active?'CPU 학습 평가 사용 중 · '+E.getModel().modelId.slice(0,16):'기존 패턴 평가 사용 중';}
 function apply(model,persist=true,rethink=true){
  if(model){OmokNeural.validate(model);if(model.adoption?.accepted!==true)throw Error('채택되지 않은 후보 모델은 실제 대국에 적용할 수 없습니다.');}stopWorker();cancelPonder();E.configure({model});spawnAnalysis.memory?.store.clear();rec=null;lastProgress=null;
  if(persist)try{localStorage.setItem(KEY,JSON.stringify({model}));}catch{}
  describe();if(rethink&&g&&!g.result&&!reviewing&&globalThis.omokComputeReady)analyze();
 }
 try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved&&Object.prototype.hasOwnProperty.call(saved,'model'))apply(saved.model,false,false);}catch{describe();}
 describe();
 $('loadLearningModel').onclick=()=>$('learningModelFile').click();
 $('learningModelFile').onchange=async event=>{const file=event.target.files?.[0];if(!file)return;try{
  if(file.size>1024*1024)throw Error('모델 파일은 1MiB 이하이어야 합니다.');const model=JSON.parse(await file.text());OmokNeural.validate(model);
  if(model.adoption?.accepted!==true)throw Error('독립 대국 검증을 통과해 채택된 모델만 사용할 수 있습니다. 로컬 학습 도구의 채택 모델을 선택하세요.');
  apply(model);msg('채택된 학습 모델을 CPU 수읽기에 연결했습니다.');
 }catch(error){msg('학습 모델을 읽지 못했습니다: '+error.message);}finally{event.target.value='';}};
 $('defaultLearningModel').onclick=()=>{try{localStorage.removeItem(KEY);}catch{}apply(embedded,false);msg(embedded?'검증된 기본 모델을 사용합니다.':'아직 채택된 기본 모델이 없어 기존 평가를 사용합니다.');};
 $('disableLearningModel').onclick=()=>{apply(null);msg('기존 패턴 평가를 사용합니다.');};
})();
