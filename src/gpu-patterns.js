// The same exact geometric line patterns are generated on CPU or WebGPU.
const OmokGPU = (() => {
 const SIZE=59049;
 function reference(code){
  const a=new Int32Array(11);a[5]=1;
  for(let k=0;k<11;k++)if(k!==5){a[k]=code%3;code=Math.floor(code/3);}
  let result=0;
  for(let j=1;j<=9;j++)if(j!==5&&a[j]===0){
   a[j]=1;let l=j,r=j;while(l>0&&a[l-1]===1)l--;while(r<10&&a[r+1]===1)r++;
   if(l<=5&&r>=5){if(r-l+1===5)result|=1<<(j-1+9);if(r-l+1===4&&l>0&&r<10&&a[l-1]===0&&a[r+1]===0)result|=1<<(j-1);}
   a[j]=0;
  }return result;
 }
 function cpu(){const table=new Uint32Array(SIZE);for(let c=0;c<SIZE;c++)table[c]=reference(c);return table;}
 const shader=`@group(0) @binding(0) var<storage,read_write> out:array<u32>;
 @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
  if(id.x>=59049u){return;}var a:array<u32,11>;var code=id.x;a[5]=1u;
  for(var k=0u;k<11u;k++){if(k!=5u){a[k]=code%3u;code=code/3u;}}
  var result=0u;
  for(var j=1u;j<=9u;j++){if(j==5u||a[j]!=0u){continue;}a[j]=1u;var l=j;var r=j;
   loop{if(l==0u){break;}if(a[l-1u]!=1u){break;}l--;}
   loop{if(r==10u){break;}if(a[r+1u]!=1u){break;}r++;}
   if(l<=5u&&r>=5u){if(r-l+1u==5u){result=result|(1u<<(j-1u+9u));}
    if(r-l+1u==4u&&l>0u&&r<10u){if(a[l-1u]==0u&&a[r+1u]==0u){result=result|(1u<<(j-1u));}}}
   a[j]=0u;
  }out[id.x]=result;
 }`;
 async function prepare(){
  const started=performance.now();
  if(!globalThis.isSecureContext)throw Error('보안 컨텍스트가 아닙니다. localhost 또는 Edge의 로컬 파일로 여세요.');
  if(!navigator.gpu)throw Error('이 브라우저에서 WebGPU가 제공되지 않습니다. Edge/Chrome의 그래픽 가속 설정을 확인하세요.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)throw Error('WebGPU 어댑터를 찾지 못했습니다. 브라우저 그래픽 가속과 드라이버를 확인하세요.');
  const info=adapter.info||{};
  if(info.isFallbackAdapter||/swiftshader|llvmpipe|software/i.test(info.description||''))throw Error('소프트웨어 GPU는 가속 모드에서 제외합니다.');
  const device=await adapter.requestDevice();let output,readback;
  try{
   device.pushErrorScope('validation');
   const module=device.createShaderModule({code:shader});
   const compilation=await module.getCompilationInfo();const errors=compilation.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(m=>m.message).join('\n'));
   const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
   output=device.createBuffer({size:SIZE*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
   readback=device.createBuffer({size:SIZE*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:output}}]});
   const computeStart=performance.now();const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(SIZE/64));pass.end();encoder.copyBufferToBuffer(output,0,readback,0,SIZE*4);device.queue.submit([encoder.finish()]);
   await readback.mapAsync(GPUMapMode.READ);const table=new Uint32Array(readback.getMappedRange().slice(0));readback.unmap();const dispatchReadbackMs=performance.now()-computeStart;
   const error=await device.popErrorScope();if(error)throw Error(error.message);
   const gpuSetupMs=performance.now()-started;const verifyStart=performance.now();for(let i=0;i<SIZE;i++)if(table[i]!==reference(i))throw Error('GPU 패턴 검증 불일치: '+i);
   return {table,adapter:{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:info.isFallbackAdapter},gpuSetupMs,dispatchReadbackMs,validationMs:performance.now()-verifyStart,totalMs:performance.now()-started,verifiedPatterns:SIZE};
  }finally{output?.destroy();readback?.destroy();device.destroy();}
 }
 return {SIZE,reference,cpu,prepare};
})();
