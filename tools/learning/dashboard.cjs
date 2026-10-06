'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const REPO=path.resolve(__dirname,'../..');
const MAX_UPLOAD=2*1024*1024;
const MAX_LOG=256*1024;
const PRESETS={
  check:{minutes:3,games:8,pairs:4,minPairs:32,moveMs:80,analysisMs:600,validationMs:1000,workers:1,epochs:3},
  standard:{minutes:60,games:128,pairs:32,minPairs:32,moveMs:80,analysisMs:600,validationMs:1000,workers:1,epochs:10},
  extended:{minutes:180,games:1024,pairs:64,minPairs:32,moveMs:80,analysisMs:600,validationMs:1000,workers:1,epochs:20}
};
const LIMITS={minutes:[1,1440],games:[1,1000000],pairs:[1,2048],minPairs:[32,2048],moveMs:[20,10000],analysisMs:[50,30000],validationMs:[50,30000],workers:[1,16],epochs:[1,1000]};
function inside(root,target){const relative=path.relative(root,target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}
function fail(status,message){const error=new Error(message);error.status=status;return error;}
function configuration(body){
  const preset=body.preset||'check';if(!Object.hasOwn(PRESETS,preset))throw fail(400,'실행 설정이 올바르지 않습니다.');
  const config={...PRESETS[preset]};
  if(body.config!=null){if(typeof body.config!=='object'||Array.isArray(body.config))throw fail(400,'설정은 객체여야 합니다.');
    for(const [key,value] of Object.entries(body.config)){
      if(!Object.hasOwn(LIMITS,key))throw fail(400,'지원하지 않는 설정: '+key);
      const [min,max]=LIMITS[key];if(!Number.isInteger(value)||value<min||value>max)throw fail(400,`${key}는 ${min}~${max}의 정수여야 합니다.`);config[key]=value;
    }
  }
  if(config.pairs<config.minPairs)config.validationNote='검증 대국이 부족하면 후보를 채택하지 않습니다.';
  return config;
}
function createDashboard(options={}){
  const repo=path.resolve(options.repo||REPO);
  const runsRoot=path.resolve(options.runsRoot||path.join(repo,'outputs','learning','runs'));
  fs.mkdirSync(runsRoot,{recursive:true});
  const realRoot=fs.realpathSync(runsRoot);
  const runner=path.resolve(options.runner||path.join(repo,'tools','learning','run.cjs'));
  const python=options.python||path.join(require('node:os').homedir(),'Documents','Codex','.omok-runtime','Scripts','python.exe');
  const spawnChild=options.spawnChild||spawn;
  const sessionToken=crypto.randomBytes(32).toString('hex');
  let active=null,port=null;
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'};
  function resolveRun(id){
    if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id))throw fail(400,'실험 ID가 올바르지 않습니다.');
    const target=path.resolve(realRoot,id);if(!inside(realRoot,target))throw fail(400,'허용되지 않은 경로입니다.');
    if(!fs.existsSync(target)||!fs.statSync(target).isDirectory())throw fail(404,'실험을 찾을 수 없습니다.');
    const real=fs.realpathSync(target);if(!inside(realRoot,real))throw fail(403,'실험 폴더가 저장 영역 밖을 가리킵니다.');return real;
  }
  function checkedFile(run,name){const target=path.join(run,name);if(!fs.existsSync(target))return null;const real=fs.realpathSync(target);if(!inside(realRoot,real)||!inside(run,real))throw fail(403,'허용되지 않은 파일입니다.');return real;}
  function readJSON(run,name){try{const file=checkedFile(run,name);if(!file)return null;if(fs.statSync(file).size>MAX_UPLOAD) return {unavailable:'파일이 커서 요약을 읽지 못했습니다.'};return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.status)throw error;return null;}}
  function runnerAlive(run){const lock=readJSON(run,'runner.lock');if(!Number.isSafeInteger(lock?.pid)||lock.pid<1)return false;try{process.kill(lock.pid,0);return true;}catch{return false;}}
  function describe(id,withDetails=true){
    const run=resolveRun(id),state=readJSON(run,'state.json'),summary={id,state,active:active?.id===id||runnerAlive(run),stopRequested:!!checkedFile(run,'stop.flag')};
    if(withDetails){const model=readJSON(run,'candidate.json'),champion=readJSON(run,'champion.json');summary.settings=readJSON(run,'settings.json');summary.training=readJSON(run,'candidate.json.training.json');summary.parity=readJSON(run,'candidate.json.parity.json');summary.arena=readJSON(run,'arena.json');summary.adoption=readJSON(run,'adoption.json');summary.candidate=model?{modelId:model.modelId,kind:model.kind,training:model.training}:null;summary.champion=champion?{modelId:champion.modelId,kind:champion.kind,training:champion.training}:null;
      const logFile=checkedFile(run,'dashboard.log');if(logFile){const size=fs.statSync(logFile).size,fd=fs.openSync(logFile,'r');try{const buffer=Buffer.alloc(Math.min(size,MAX_LOG));fs.readSync(fd,buffer,0,buffer.length,Math.max(0,size-buffer.length));summary.log=buffer.toString('utf8');}finally{fs.closeSync(fd);}}
    }return summary;
  }
  function listRuns(){return fs.readdirSync(realRoot,{withFileTypes:true}).filter(entry=>entry.isDirectory()&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(entry.name)).map(entry=>{try{const run=resolveRun(entry.name);return checkedFile(run,'state.json')||checkedFile(run,'dashboard.json')?describe(entry.name,false):null;}catch{return null;}}).filter(Boolean).sort((a,b)=>Number(b.active)-Number(a.active)||b.id.localeCompare(a.id)).slice(0,100);}
  function activeId(){return active?.id||listRuns().find(run=>run.active)?.id||null;}
  function log(run,text){const target=path.join(run,'dashboard.log');if(fs.existsSync(target))checkedFile(run,'dashboard.log');fs.appendFileSync(target,String(text));}
  function launch(id,config,resume){
    if(activeId())throw fail(409,'진행 중인 실험을 중단한 후 시작해 주세요.');
    const run=resolveRun(id),args=[runner,'cycle','--run='+run,'--python='+python,'--device=cuda'];
    if(resume)args.push('--resume');else{
      if(checkedFile(run,'uploaded-records.json'))args.push('--input='+path.join(run,'uploaded-records.json'));
      const keys={minutes:'minutes',games:'games',pairs:'pairs',minPairs:'min-pairs',moveMs:'move-ms',analysisMs:'analysis-ms',validationMs:'validation-ms',workers:'workers',epochs:'epochs'};
      for(const [key,flag] of Object.entries(keys))args.push('--'+flag+'='+config[key]);
    }
    const child=spawnChild(process.execPath,args,{cwd:repo,stdio:['ignore','pipe','pipe'],windowsHide:true,shell:false});
    active={id,child,startedAt:new Date().toISOString()};log(run,JSON.stringify({dashboard:'start',resume,at:active.startedAt})+'\n');
    child.stdout?.on('data',data=>log(run,data));child.stderr?.on('data',data=>log(run,data));
    child.once('error',error=>{log(run,JSON.stringify({dashboard:'launch-error',message:error.message})+'\n');if(active?.child===child)active=null;});
    child.once('exit',(code,signal)=>{log(run,JSON.stringify({dashboard:'exit',code,signal,at:new Date().toISOString()})+'\n');if(active?.child===child)active=null;});
    return describe(id);
  }
  function stop(id){const run=resolveRun(id);const flag=path.join(run,'stop.flag');if(fs.existsSync(flag))checkedFile(run,'stop.flag');fs.writeFileSync(flag,new Date().toISOString()+'\n');return describe(id);}
  async function body(req){let total=0,chunks=[];for await(const chunk of req){total+=chunk.length;if(total>MAX_UPLOAD)throw fail(413,'기보 파일은 2 MiB 이하로 입력해 주세요.');chunks.push(chunk);}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw fail(400,'JSON 요청 형식이 올바르지 않습니다.');}}
  const server=http.createServer(async(req,res)=>{
    function respond(status,value,type='application/json; charset=utf-8',extra={}){res.writeHead(status,{...headers,'Content-Type':type,...extra});res.end(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));}
    try{
      const host=req.headers.host;if(!port||![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))throw fail(403,'localhost 접속만 허용합니다.');
      if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))throw fail(403,'다른 사이트의 요청을 허용하지 않습니다.');
      const url=new URL(req.url,'http://'+host);
      if(req.method==='POST'){
        if(req.headers['x-omok-session']!==sessionToken)throw fail(403,'페이지를 새로 열고 다시 시도해 주세요.');
        if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'JSON 요청만 허용합니다.');
        const data=await body(req);
        if(url.pathname==='/api/start'){
          if(activeId())throw fail(409,'진행 중인 실험을 중단한 후 시작해 주세요.');
          const config=configuration(data);let records=null;
          if(typeof data.record==='string'){if(Buffer.byteLength(data.record)>MAX_UPLOAD)throw fail(413,'기보 파일이 너무 큽니다.');try{records=JSON.parse(data.record);}catch{throw fail(400,'기보 JSON을 읽을 수 없습니다.');}}
          else if(data.record&&typeof data.record==='object')records=data.record;
          else if(data.record!=null)throw fail(400,'기보는 JSON 객체 또는 배열이어야 합니다.');
          if(records!==null&&(!records||typeof records!=='object'))throw fail(400,'기보는 JSON 객체 또는 배열이어야 합니다.');
          const id='run-'+new Date().toISOString().replace(/[-:.TZ]/g,'')+'-'+crypto.randomBytes(3).toString('hex');
          const run=path.join(realRoot,id);fs.mkdirSync(run);if(records!==null)fs.writeFileSync(path.join(run,'uploaded-records.json'),JSON.stringify(records,null,2)+'\n');
          fs.writeFileSync(path.join(run,'dashboard.json'),JSON.stringify({createdAt:new Date().toISOString(),preset:data.preset||'check',config,recordName:records===null?'기존 내장 기보':path.basename(String(data.recordName||'records.json'))},null,2)+'\n');
          return respond(201,launch(id,config,false));
        }
        if(url.pathname==='/api/stop')return respond(200,stop(data.id));
        if(url.pathname==='/api/resume')return respond(200,launch(data.id,null,true));
        throw fail(404,'요청을 찾을 수 없습니다.');
      }
      if(req.method!=='GET')throw fail(405,'지원하지 않는 요청입니다.');
      if(url.pathname==='/api/session')return respond(200,{token:sessionToken,presets:PRESETS,limits:LIMITS,activeId:activeId()});
      if(url.pathname==='/api/status'){const running=activeId();return respond(200,{activeId:running,runs:listRuns(),selected:url.searchParams.has('id')?describe(url.searchParams.get('id')):running?describe(running):null});}
      if(url.pathname==='/api/download'){
        const run=resolveRun(url.searchParams.get('id'));const kind=url.searchParams.get('kind')||'champion';
        const names={champion:'champion.json',candidate:'candidate.json',arena:'arena.json',training:'candidate.json.training.json'};
        if(!Object.hasOwn(names,kind))throw fail(400,'지원하지 않는 다운로드입니다.');
        const file=checkedFile(run,names[kind]);if(!file)throw fail(404,kind==='champion'?'이 실험에서 채택된 모델이 아직 없습니다.':'결과가 아직 없습니다.');
        return respond(200,fs.readFileSync(file),'application/json; charset=utf-8',{'Content-Disposition':`attachment; filename="omok-${kind}-${path.basename(run)}.json"`});
      }
      if(url.pathname==='/'||url.pathname==='/dashboard.html')return respond(200,fs.readFileSync(path.join(__dirname,'dashboard.html'),'utf8'),'text/html; charset=utf-8',{'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
      const assets={'/dashboard.js':['dashboard.js','text/javascript; charset=utf-8'],'/dashboard.css':['dashboard.css','text/css; charset=utf-8']};
      if(Object.hasOwn(assets,url.pathname)){const [name,type]=assets[url.pathname];return respond(200,fs.readFileSync(path.join(__dirname,name),'utf8'),type);}
      throw fail(404,'요청을 찾을 수 없습니다.');
    }catch(error){respond(error.status||500,{error:error.status?error.message:'요청 처리 중 오류가 발생했습니다.'});}
  });
  return {server,runsRoot:realRoot,listen:async(requestedPort=8766)=>{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(requestedPort,'127.0.0.1',()=>{server.removeListener('error',reject);port=server.address().port;resolve();});});return {port,url:'http://127.0.0.1:'+port};},close:async()=>{for(const run of listRuns())if(run.active)stop(run.id);await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));},getActive:()=>active?{id:active.id,startedAt:active.startedAt}:null};
}
if(require.main===module){
  const opts={};let requestedPort=8766,openBrowser=false;for(const arg of process.argv.slice(2)){if(arg==='--open'){openBrowser=true;continue;}const match=/^--(port|runs-root|python)=(.+)$/.exec(arg);if(!match)throw Error('지원하지 않는 옵션: '+arg);if(match[1]==='port'){requestedPort=Number(match[2]);if(!Number.isInteger(requestedPort)||requestedPort<1||requestedPort>65535)throw Error('port는 1~65535 정수여야 합니다.');}else if(match[1]==='runs-root')opts.runsRoot=match[2];else opts.python=match[2];}
  const show=url=>{console.log('로컬 오목 학습: '+url);if(openBrowser){const child=spawn(process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open',process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url],{windowsHide:true,stdio:'ignore'});child.on('error',()=>console.error('브라우저를 자동으로 열지 못했습니다. 위 주소를 열어 주세요.'));child.unref();}};
  const app=createDashboard(opts);app.listen(requestedPort).then(info=>show(info.url)).catch(async error=>{if(openBrowser&&error.code==='EADDRINUSE'){try{const url='http://127.0.0.1:'+requestedPort,response=await fetch(url,{signal:AbortSignal.timeout(2000)});if(response.ok&&(await response.text()).includes('기존 엔진 보완 학습')){console.log('이미 실행 중인 학습 화면을 엽니다.');show(url);return;}}catch{}}console.error(error.message);process.exitCode=1;});
  let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(closing)return;closing=true;app.close().then(()=>process.exit(0),error=>{console.error(error.message);process.exit(1);});});
}
module.exports={createDashboard,configuration,PRESETS,LIMITS,inside};
