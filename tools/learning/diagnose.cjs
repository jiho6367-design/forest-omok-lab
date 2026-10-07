'use strict';
// Read-only ablations. Loading src/node-engine.cjs would invoke deployment
// recovery, so this tool evaluates the browser sources in an isolated VM.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),cp=require('node:child_process');
const {performance}=require('node:perf_hooks'),{Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const ROOT=path.resolve(__dirname,'../..'),Neural=require('../../src/neural-evaluator.js');
const NAMES=['neural-evaluator.js','search-memory.js','gpu-patterns.js','strategy-engine.js','reader-engine.js','forest-engine.js','unified-engine.js'];
const hash=value=>crypto.createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
const index=coord=>{if(Number.isInteger(coord)&&coord>=0&&coord<225)return coord;const match=/^([A-O])(1[0-5]|[1-9])$/i.exec(String(coord));if(!match)throw Error('Invalid coordinate '+coord);return (+match[2]-1)*15+match[1].toUpperCase().charCodeAt(0)-65;};
const coord=i=>i==null?null:String.fromCharCode(65+i%15)+(1+(i/15|0));

function sources(ref=null){
 const commit=ref?cp.execFileSync('git',['rev-parse',ref+'^{commit}'],{cwd:ROOT,encoding:'utf8',windowsHide:true}).trim():null,files=[];
 for(const name of NAMES){let text;if(commit){try{text=cp.execFileSync('git',['show',commit+':src/'+name],{cwd:ROOT,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});}catch(error){if(name==='neural-evaluator.js')continue;throw error;}}else text=fs.readFileSync(path.join(ROOT,'src',name),'utf8');files.push({name,text,sha256:hash(text)});}
 return {files,commit,sourceHash:hash(files.map(row=>[row.name,row.sha256]))};
}
function runtime(bundle,{profileLeaves=false}={}){
 const profile={staticLeafCalls:0,staticLeafTotalMs:0,neuralScoreCalls:0,neuralScoreTotalMs:0},context={Date,console,performance};
 const timed=(calls,total)=>fn=>{const start=performance.now();try{return fn();}finally{profile[calls]++;profile[total]+=performance.now()-start;}};
 if(profileLeaves){context.__profileLeaf=timed('staticLeafCalls','staticLeafTotalMs');context.__profileNeural=timed('neuralScoreCalls','neuralScoreTotalMs');}
 vm.createContext(context);
 for(const row of bundle.files){let text=row.text;if(row.name==='reader-engine.js'){
  text=text.replace('function createEngine(','function createReaderEngine(');
  if(profileLeaves){if(!text.includes('score:staticScore()'))throw Error('Reader leaf profiling anchor is unavailable');text=text.replaceAll('score:staticScore()','score:__profileLeaf(staticScore)');text=text.replace('neuralPosition?.score(p)||0','neuralPosition?__profileNeural(()=>neuralPosition.score(p)):0');}
 }vm.runInContext(text,context,{filename:row.name});}
 return {createEngine:context.createEngine,createReader:context.createReaderEngine,profile};
}
function transform(board,t){const result=Array(225).fill(0);for(let i=0;i<225;i++){let x=i%15,y=i/15|0;if(t>=4)x=14-x;for(let turn=0;turn<t%4;turn++)[x,y]=[14-y,x];result[y*15+x]=board[i];}return result;}
function spatialFeatures(board,p,firstPlayer){
 // Diagnostic prototype only. The directional histogram retains every
 // opponent-minus-own offset; it is not a complete board representation,
 // rotation invariant, or accepted by the house32 trainer/engine.
 const values=Neural.extractFeatures(board,p,firstPlayer).concat(Array(29*29).fill(0)),own=[],enemy=[];
 board.forEach((stone,i)=>{if(stone===p)own.push(i);else if(stone===3-p)enemy.push(i);});
 for(const a of own)for(const b of enemy){const dx=b%15-a%15,dy=(b/15|0)-(a/15|0);values[32+(dy+14)*29+dx+14]+=1/(225*225);}
 return values;
}
function aliasWitness(){
 const board=white=>{const result=Array(225).fill(0);result[index('G8')]=1;result[index(white)]=2;return result;},a=board('F6'),b=board('J6');
 const oldA=Neural.extractFeatures(a,1,1),oldB=Neural.extractFeatures(b,1,1),newA=spatialFeatures(a,1,1),newB=spatialFeatures(b,1,1);
 return {positions:[{moves:['G8','F6'],squaredStoneDistance:5},{moves:['G8','J6'],squaredStoneDistance:13}],house32Identical:oldA.every((value,i)=>value===oldB[i]),sameD4Position:Array.from({length:8},(_,t)=>transform(a,t)).some(value=>value.every((stone,i)=>stone===b[i])),
  experimental:{featureVersion:'spatial-rel-v1',inputSize:newA.length,distinguishesPair:newA.some((value,i)=>value!==newB[i]),relativeOffsets:[[-1,-2],[3,-2]],productionCompatible:false,scope:'Representation proof only; preserves relative offsets in this pair. No claim about true value, playing strength or optimal representation.'}};
}
function replayPosition(id,moves,firstPlayer=1,metadata={}){
 const current=runtime(sources()).createEngine({firstPlayer,model:null,strategy:false,searchMemory:false}),board=Array(225).fill(0);let p=firstPlayer;
 for(const move of moves){const i=index(move),shape=current.inspect(board,i,p);if(!shape.legal)throw Error('Illegal diagnostic prefix '+id+' '+coord(i));if(shape.win.length)throw Error('Diagnostic prefixes must stop before game end');board[i]=p;p=3-p;}
 return {...metadata,id,board,p,firstPlayer};
}
function defaultPositions(){
 const failure=JSON.parse(fs.readFileSync(path.join(ROOT,'reports/i7-loss-certificate.json'),'utf8')),api=JSON.parse(fs.readFileSync(path.join(ROOT,'reports/current-api-result.json'),'utf8'));
 const prefix=failure.prefix.split(' ');if(prefix.at(-1)==='I7')prefix.pop();
 return [replayPosition('reported-sixth-move-I7-failure',prefix,failure.firstPlayer||1,{knownLossMoves:[index('I7')],referenceMoves:[index(api.recommended_move)],evidence:['reports/i7-loss-certificate.json','reports/current-api-result.json'],referenceScope:'Historical bounded recommendation, not a winning/safe-move label; legacy loss certificate not revalidated by this tool.'}),
  replayPosition('house32-alias-opening',['G8','F6'],1,{referenceMoves:[],knownLossMoves:[],evidence:['premortem PM10'],referenceScope:'Representation witness; no known best move.'})];
}
function checkedPositions(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>16)throw Error('Supply 1..16 diagnostic positions');
 return rows.map((row,n)=>{if(!row||typeof row!=='object')throw Error('Invalid diagnostic position');let value=row.moves?replayPosition(row.id||'position-'+n,row.moves,row.firstPlayer||1,row):row;
  if(!Array.isArray(value.board)||value.board.length!==225||value.board.some(stone=>![0,1,2].includes(stone))||![1,2].includes(value.p)||![1,2].includes(value.firstPlayer))throw Error('Invalid board/player in diagnostic position');
  return {...value,referenceMoves:(value.referenceMoves||[]).map(index),knownLossMoves:(value.knownLossMoves||[]).map(index)};});
}
function probe(payload){
 const {bundle,position,model,mode,clockMs,depth,lessons=[]}=payload,isWork=mode==='fixed-work'||mode==='leaf-profile',{createEngine,createReader,profile}=runtime(bundle,{profileLeaves:mode==='leaf-profile'}),options={model,firstPlayer:position.firstPlayer,optimized:true,searchMemory:false};
 const engine=createEngine(options),reader=createReader(15,position.board,{...options,fixedWork:isWork}),ranked=Array.from(reader.rank(position.p),row=>row.i),boardHash=hash(position.board);
 const started=performance.now(),result=isWork?reader.fixedWork(position.p,depth):engine.analyze(position.board,position.p,clockMs,lessons),elapsedMs=performance.now()-started;
 const selected=result.i??result.moves?.[0]?.i??result.pv?.[0]??null,candidates=Array.from(result.candidates||result.moves||[],row=>row.i),nodes=result.nodes??null;
 if(hash(position.board)!==boardHash||hash(Array.from(reader.board))!==boardHash)throw Error('Engine changed diagnostic input board');
 const references=position.referenceMoves.map(i=>({move:coord(i),legal:engine.inspect(position.board,i,position.p).legal,inGeneratedRankPool:ranked.includes(i),generatedRank:ranked.indexOf(i)>=0?ranked.indexOf(i)+1:null,inReturnedCandidates:isWork?null:candidates.includes(i),selected:selected===i}));
 let inference=null;if(model){const evaluator=Neural.createEvaluator(model,15,position.firstPlayer),acc=evaluator.accumulator(position.board),count=1000;let checksum=0;const start=performance.now();for(let n=0;n<count;n++)checksum+=acc.score(position.p);const ms=performance.now()-start;inference={calls:count,totalMs:ms,microsecondsPerEffectiveScore:ms*1000/count,score:checksum/count,scope:'Repeated unchanged accumulator score only, after search; excludes updates, setup and other leaf work. It does not time real search leaves.'};}
 const leafProfile=mode==='leaf-profile'?{...profile,scope:'Separate instrumented fixed-depth Reader run. Timers add overhead; static leaves exclude tactical terminal/proof returns. Neural timing includes real accumulator.score calls at these leaves, excluding accumulator.set/setup. Do not use this run for wall-clock strength comparisons.'}:null;
 return {status:'completed',mode,searchApi:isWork?'Reader.fixedWork':'unified.analyze',configuredMs:mode==='fixed-time'?clockMs:null,configuredDepth:isWork?depth:null,selected:coord(selected),score:result.score??result.moves?.[0]?.score??null,completedDepth:result.depth??0,nodes,elapsedMs,msPerReportedNode:nodes?elapsedMs/nodes:null,leafEvaluations:leafProfile?profile.staticLeafCalls:null,leafCostMs:profile.staticLeafCalls?profile.staticLeafTotalMs/profile.staticLeafCalls:null,leafProfile,leafMetricAvailability:leafProfile?'Explicit isolated Reader static-leaf instrumentation.': 'Engine public APIs do not expose actual leaf counts/cost; use a separate leaf-profile probe.',inference,generatedRankPool:ranked.map(coord),returnedCandidates:candidates.map(coord),references,selectedKnownLoss:position.knownLossMoves.includes(selected),proofStatus:result.proofStatus||result.kind||null,boardPreserved:true,fixedWorkScope:isWork?'Same requested Reader depth and static search policy, with no wall deadline; node count may differ and unified guards/lessons are not part of this API.':null};
}
function boundedProbe(payload,timeoutMs){return new Promise(resolve=>{
 const worker=new Worker(__filename,{workerData:{diagnosticProbe:payload}}),timer=setTimeout(()=>{worker.terminate();resolve({status:'incomplete',mode:payload.mode,searchApi:payload.mode==='fixed-work'?'Reader.fixedWork':'unified.analyze',reason:'diagnostic-worker-watchdog',timeoutMs,scope:'Unfinished probe; no move or strength conclusion.'});},timeoutMs);
 worker.once('message',result=>{clearTimeout(timer);resolve(result);});worker.once('error',error=>{clearTimeout(timer);resolve({status:'error',mode:payload.mode,error:error.message});});worker.once('exit',code=>{if(code!==0){clearTimeout(timer);resolve({status:'error',mode:payload.mode,error:'Diagnostic worker exited '+code});}});
});}
async function diagnose(options={}){
 const positions=checkedPositions(options.positions||defaultPositions()),current=sources(),historical=sources(options.baseline||'0c652e8'),inputFiles=[];
 const readModel=(file,role)=>{if(!file||!fs.existsSync(file))return {role,available:false,reason:'No model file supplied or present'};const text=fs.readFileSync(file,'utf8'),model=Neural.validate(JSON.parse(text));inputFiles.push({file:path.resolve(file),sha256:hash(text)});return {role,available:true,model,modelFile:path.resolve(file),modelHash:hash(text),modelId:model.modelId,modelTraining:model.training||null};};
 const actors=[{role:'historical-no-model',available:true,bundle:historical,model:null},{role:'current-no-model',available:true,bundle:current,model:null},readModel(options.candidate,'candidate'),readModel(options.champion,'champion')];
 for(const actor of actors)if(!actor.bundle)actor.bundle=current;
 const clocks=options.clocks||[80,1000],depth=options.depth??1,watchdogMs=options.watchdogMs??5000;
 if(!Array.isArray(clocks)||!clocks.length||clocks.length>4||clocks.some(ms=>!Number.isFinite(ms)||ms<30||ms>10000)||!Number.isInteger(depth)||depth<0||depth>3||!Number.isFinite(watchdogMs)||watchdogMs<1000||watchdogMs>30000)throw Error('Invalid diagnostic clock/depth/watchdog');
 const results=[];for(const position of positions)for(const actor of actors){if(!actor.available){results.push({position:position.id,actor:actor.role,status:'unavailable',reason:actor.reason});continue;}
  for(const clockMs of clocks)results.push({position:position.id,actor:actor.role,sourceHash:actor.bundle.sourceHash,modelHash:actor.modelHash||null,...await boundedProbe({bundle:actor.bundle,position,model:actor.model||null,mode:'fixed-time',clockMs,depth,lessons:options.lessons||[]},Math.max(watchdogMs,clockMs+2000))});
  if(options.fixedWork!==false)results.push({position:position.id,actor:actor.role,sourceHash:actor.bundle.sourceHash,modelHash:actor.modelHash||null,...await boundedProbe({bundle:actor.bundle,position,model:actor.model||null,mode:'fixed-work',depth},watchdogMs)});
  if(options.profileLeaves)results.push({position:position.id,actor:actor.role,sourceHash:actor.bundle.sourceHash,modelHash:actor.modelHash||null,...await boundedProbe({bundle:actor.bundle,position,model:actor.model||null,mode:'leaf-profile',depth},watchdogMs)});
 }
 for(const input of inputFiles)if(hash(fs.readFileSync(input.file))!==input.sha256)throw Error('Input model changed while diagnosing: '+input.file);
 const actorAgreement=[];for(const position of positions){const shallow=results.find(row=>row.position===position.id&&row.actor==='current-no-model'&&row.mode==='fixed-time'&&row.configuredMs===clocks[0]),deep=results.find(row=>row.position===position.id&&row.actor==='current-no-model'&&row.mode==='fixed-time'&&row.configuredMs===clocks.at(-1));actorAgreement.push({position:position.id,collectionClockMs:clocks[0],evaluationClockMs:clocks.at(-1),selectedMoveAgrees:shallow?.status==='completed'&&deep?.status==='completed'?shallow.selected===deep.selected:null,scope:'One bounded deterministic position comparison; no corpus distribution or return outcome estimate.'});}
 return {schemaVersion:1,createdAt:new Date().toISOString(),scope:'Read-only bounded diagnostics for PM08/PM10/TRAIN-06. No training, promotion, dataset mutation, or playing-strength claim. References retain their historical evidence limits.',alias:aliasWitness(),configuration:{clocks,depth,watchdogMs,positionsReservedBeforeProbes:true,lessonsHash:hash(options.lessons||[]),lessonsApplied:'Identical to all fixed-time actors; Reader fixed-work API has no lesson argument.'},actors:actors.map(({bundle,model,...actor})=>({...actor,sourceHash:bundle.sourceHash,commit:bundle.commit,sourceManifest:bundle.files.map(({name,sha256})=>({name,sha256}))})),positions:positions.map(row=>({...row,positionHash:hash([row.board,row.p,row.firstPlayer])})),actorAgreement,results,inputModelsPreserved:true};
}
async function main(argv){const options={};for(const arg of argv){const match=/^--([^=]+)(?:=(.*))?$/.exec(arg);if(!match)throw Error('Use --name=value diagnostic arguments');const [,key,value]=match;if(key==='alias-only'){console.log(JSON.stringify(aliasWitness(),null,2));return;}if(key==='leaf-profile')options.profileLeaves=true;else if(key==='no-fixed-work')options.fixedWork=false;else if(key==='candidate'||key==='champion'||key==='baseline')options[key]=value;else if(key==='positions')options.positions=JSON.parse(fs.readFileSync(value,'utf8'));else if(key==='clocks')options.clocks=value.split(',').map(Number);else if(key==='depth')options.depth=Number(value);else if(key==='watchdog-ms')options.watchdogMs=Number(value);else if(key==='out')options.out=value;else if(key==='run-dir'){const dir=path.resolve(value);options.candidate=path.join(dir,'candidate.json');options.champion=path.join(dir,'champion.json');const lessonFile=path.join(dir,'lessons.json');if(fs.existsSync(lessonFile))options.lessons=JSON.parse(fs.readFileSync(lessonFile,'utf8')).lessons||[];}else throw Error('Unknown diagnostic option '+key);}
 const report=await diagnose(options);if(options.out){const file=path.resolve(options.out);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:file,probes:report.results.length,completed:report.results.filter(row=>row.status==='completed').length,alias:report.alias,inputModelsPreserved:report.inputModelsPreserved}));}else console.log(JSON.stringify(report,null,2));}
if(!isMainThread&&workerData?.diagnosticProbe){try{parentPort.postMessage(probe(workerData.diagnosticProbe));}catch(error){parentPort.postMessage({status:'error',mode:workerData.diagnosticProbe.mode,error:error.stack});}}
else if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.stack);process.exitCode=1;});
module.exports={spatialFeatures,aliasWitness,transform,replayPosition,checkedPositions,sources,runtime,probe,boundedProbe,diagnose};
