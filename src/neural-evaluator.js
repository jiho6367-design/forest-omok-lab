/* One feature definition for CPU search, local data generation and GPU training.
 * This model estimates position value. It never changes legality or proves wins. */
const OmokNeural=(()=>{
 const RULES_ID='15x15-exact5-both33-v1',FEATURE_VERSION='house32-v1',INPUT_SIZE=32;
 const layouts=new Map();let defaultModel=null;
 function layout(N=15){
  if(N!==15)throw Error('학습 모델은 현재 15×15 규칙만 지원합니다.');
  if(layouts.has(N))return layouts.get(N);
  const windows=[],affected=Array.from({length:N*N},()=>[]),dirs=[[1,0],[0,1],[1,1],[1,-1]];
  const inside=(x,y)=>x>=0&&y>=0&&x<N&&y<N;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++)for(const [dx,dy]of dirs){
   if(!inside(x+4*dx,y+4*dy))continue;
   const cells=Array.from({length:5},(_,k)=>(y+k*dy)*N+x+k*dx),
    pre=inside(x-dx,y-dy)?(y-dy)*N+x-dx:-1,
    post=inside(x+5*dx,y+5*dy)?(y+5*dy)*N+x+5*dx:-1,id=windows.length;
   windows.push({cells,pre,post});for(const i of [...cells,pre,post])if(i>=0)affected[i].push(id);
  }
  const result={windows,affected};layouts.set(N,result);return result;
 }
 function assertBoard(board){if(!Array.isArray(board)&&!ArrayBuffer.isView(board)||board.length!==225||Array.from(board).some(v=>![0,1,2].includes(v)))throw Error('학습 국면의 돌 배열이 잘못되었습니다.');}
 function createAccumulator(board,N=15){
  assertBoard(board);const b=Array.from(board),{windows,affected}=layout(N),buckets=[null,new Float64Array(12),new Float64Array(12)],
   counts=[0,0,0],center=[0,0,0],central=[0,0,0];
  const centerWeight=i=>14-Math.abs(i%15-7)-Math.abs((i/15|0)-7);
  const isCentral=i=>Math.abs(i%15-7)<=2&&Math.abs((i/15|0)-7)<=2;
  function bucket(w,p){let own=0,enemy=0;for(const i of w.cells){own+=b[i]===p;enemy+=b[i]===3-p;}
   if(enemy||own<1||own>4||b[w.pre]===p||b[w.post]===p)return -1;
   const open=(w.pre>=0&&b[w.pre]===0?1:0)+(w.post>=0&&b[w.post]===0?1:0);return (own-1)*3+open;
  }
  function adjust(id,sign){for(const p of [1,2]){const k=bucket(windows[id],p);if(k>=0)buckets[p][k]+=sign;}}
  for(let i=0;i<b.length;i++)if(b[i]){const p=b[i];counts[p]++;center[p]+=centerWeight(i);central[p]+=isCentral(i);}
  for(let id=0;id<windows.length;id++)adjust(id,1);
  function set(i,p){const before=b[i];if(before===p)return;if(!Number.isInteger(i)||i<0||i>=225||![0,1,2].includes(p))throw Error('학습 특징 갱신 오류');
   for(const id of affected[i])adjust(id,-1);
   if(before){counts[before]--;center[before]-=centerWeight(i);central[before]-=isCentral(i);}
   b[i]=p;if(p){counts[p]++;center[p]+=centerWeight(i);central[p]+=isCentral(i);}
   for(const id of affected[i])adjust(id,1);
  }
  function features(p,firstPlayer=null,out=new Float64Array(INPUT_SIZE)){
   if(![1,2].includes(p))throw Error('학습 국면의 현재 색이 잘못되었습니다.');
   out.set(buckets[p],0);out.set(buckets[3-p],12);out[24]=counts[p]/225;out[25]=counts[3-p]/225;
   out[26]=center[p]/420;out[27]=center[3-p]/420;out[28]=[1,2].includes(firstPlayer)?(firstPlayer===p?1:-1):0;
   out[29]=(counts[1]+counts[2])/225;out[30]=central[p]/25;out[31]=central[3-p]/25;return out;
  }
  return {set,features};
 }
 const extractFeatures=(board,p,firstPlayer=null)=>Array.from(createAccumulator(board).features(p,firstPlayer));
 function validate(model){
  if(!model||model.schemaVersion!==1||model.kind!=='forest-value-mlp'||model.rulesId!==RULES_ID||model.featureVersion!==FEATURE_VERSION||model.inputSize!==INPUT_SIZE)throw Error('학습 모델의 형식·규칙·특징 버전이 맞지 않습니다.');
  const H=model.hiddenSize;if(!Number.isInteger(H)||H<1||H>64||model.activation!=='relu'||model.outputActivation!=='tanh')throw Error('학습 모델의 신경망 구조가 잘못되었습니다.');
  const vector=(x,n)=>Array.isArray(x)&&x.length===n&&x.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e8);
  const layers=model.layers,norm=model.normalization;
  if(!norm||!vector(norm.mean,INPUT_SIZE)||!vector(norm.scale,INPUT_SIZE)||norm.scale.some(x=>x<=0)||!Array.isArray(layers)||layers.length!==2||
   !Array.isArray(layers[0].weights)||layers[0].weights.length!==H||!layers[0].weights.every(row=>vector(row,INPUT_SIZE))||!vector(layers[0].bias,H)||
   !Array.isArray(layers[1].weights)||layers[1].weights.length!==1||!vector(layers[1].weights[0],H)||!vector(layers[1].bias,1))throw Error('학습 모델의 가중치·정규화 값이 잘못되었습니다.');
  if(typeof model.modelId!=='string'||!/^[A-Za-z0-9._-]{1,96}$/.test(model.modelId)||!Number.isFinite(model.scale)||model.scale<0||model.scale>600)throw Error('학습 모델 식별자·평가 크기가 잘못되었습니다.');
  return model;
 }
 function identity(model){if(!model)return 'baseline';validate(model);const s=JSON.stringify([model.normalization,model.layers,model.scale]);let a=2166136261;
  for(let i=0;i<s.length;i++)a=Math.imul(a^s.charCodeAt(i),16777619);return model.modelId.slice(0,64)+'-'+(a>>>0).toString(16);
 }
 function createEvaluator(model,N=15,firstPlayer=null){
  if(!model)return null;layout(N);validate(model);const H=model.hiddenSize,mean=Float64Array.from(model.normalization.mean),
   inv=Float64Array.from(model.normalization.scale,v=>1/v),weights=model.layers[0].weights.map(row=>Float64Array.from(row)),
   biases=Float64Array.from(model.layers[0].bias),output=Float64Array.from(model.layers[1].weights[0]),outBias=model.layers[1].bias[0],scratch=new Float64Array(INPUT_SIZE);
  function raw(features){let value=outBias;for(let k=0;k<INPUT_SIZE;k++)scratch[k]=(features[k]-mean[k])*inv[k];
   for(let h=0;h<H;h++){let v=biases[h];const row=weights[h];for(let k=0;k<INPUT_SIZE;k++)v+=row[k]*scratch[k];if(v>0)value+=v*output[h];}return Math.tanh(value);
  }
  const scoreFeatures=features=>raw(features)*model.scale;
  return {model,modelId:identity(model),raw,scoreFeatures,
   evaluate:(board,p,first=firstPlayer)=>{const acc=createAccumulator(board,N);return (scoreFeatures(acc.features(p,first))-scoreFeatures(acc.features(3-p,first)))/2;},
   accumulator:board=>{const acc=createAccumulator(board,N),features=new Float64Array(INPUT_SIZE);return {set:acc.set,score:p=>{const own=scoreFeatures(acc.features(p,firstPlayer,features));return (own-scoreFeatures(acc.features(3-p,firstPlayer,features)))/2;},features:acc.features};}};
 }
 const setDefaultModel=model=>{defaultModel=model?validate(model):null;return defaultModel;};
 return {RULES_ID,FEATURE_VERSION,INPUT_SIZE,extractFeatures,createAccumulator,validate,identity,createEvaluator,setDefaultModel,getDefaultModel:()=>defaultModel};
})();
if(typeof module!=='undefined')module.exports=OmokNeural;
