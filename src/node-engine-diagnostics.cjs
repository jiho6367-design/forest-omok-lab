'use strict';
// Host-only observation. No browser source, search clock, argument, callback or
// proof routine is changed. Records are emitted only by the test after run().
const crypto=require('node:crypto'),os=require('node:os'),{performance}=require('node:perf_hooks');
const HARD_RECORD_LIMIT=512,MAX_REPORT_BYTES=128*1024,MAX_TEXT=160,MAX_PV=8;
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const boolean=value=>typeof value==='boolean'?value:null;
const text=value=>typeof value==='string'?value.slice(0,MAX_TEXT):null;
const coordinate=i=>Number.isInteger(i)&&i>=0&&i<225?String.fromCharCode(65+i%15)+(1+(i/15|0)):null;
const indices=value=>Array.isArray(value)?value.slice(0,MAX_PV).filter(i=>Number.isInteger(i)&&i>=0&&i<225):[];
function moveSummary(move){return {i:finite(move?.i),coordinate:coordinate(move?.i),score:finite(move?.score),depth:finite(move?.depth),status:text(move?.status),pv:indices(move?.pv)};}
function threatSummary(threat){return {i:finite(threat?.i),coordinate:coordinate(threat?.i),block:finite(threat?.block),blockCoordinate:coordinate(threat?.block),riskOnly:boolean(threat?.riskOnly),actualTurn:finite(threat?.actualTurn),hypotheticalTurn:finite(threat?.hypotheticalTurn),actualCheck:threat?.actualCheck?{complete:boolean(threat.actualCheck.complete),unrefutedReply:finite(threat.actualCheck.unrefutedReply),proof:Object.hasOwn(threat.actualCheck,'proof')?!!threat.actualCheck.proof:null}:null};}
function classification(result,error){if(error)return 'error';if(result?.lossProven===true)return 'proven-loss';if(result?.proven===true)return 'proven-win';if(result?.proof)return 'proof';if(result?.complete===false)return 'incomplete';if(result?.complete===true)return 'complete-no-proof';return 'status-not-exposed';}
function resultSummary(result,kind){
 const moves=kind==='reader.analyze'?result?.moves:result?.candidates;
 const rejected=kind==='reader.analyze'?result?.rejectedMoves:result?.rejected,d7Threat=Array.isArray(result?.counterThreats)?result.counterThreats.find(threat=>threat.i===93):null,d7Rejected=Array.isArray(rejected)?rejected.find(move=>move.i===93):null;
 return {kind:text(result?.kind),i:finite(result?.i),coordinate:coordinate(result?.i),depth:finite(result?.depth),nodes:finite(result?.nodes),reportedMs:finite(result?.ms),complete:boolean(result?.complete),scopeComplete:boolean(result?.scopeComplete),proof:Object.hasOwn(result||{},'proof')?!!result.proof:null,proofBlock:finite(result?.proof?.block),proofBlockCoordinate:coordinate(result?.proof?.block),proven:boolean(result?.proven),lossProven:boolean(result?.lossProven),proofStatus:text(result?.proofStatus),exitClassification:classification(result),reason:text(result?.reason)||text(result?.lossReason)||text(result?.autoReason),stopReason:text(result?.stopReason),unrefutedReply:finite(result?.unrefutedReply),unrefuted:finite(result?.unrefuted),branchCount:Array.isArray(result?.branches)?result.branches.length:null,screeningComplete:boolean(result?.screeningComplete),forcingChecksComplete:boolean(result?.forcingChecksComplete),screened:finite(result?.screened),rejectionCount:Array.isArray(rejected)?rejected.length:finite(result?.rejected),pv:indices(result?.pv||result?.proof?.pv),rawMovesSource:kind==='reader.analyze'?'moves':null,top3:Array.isArray(moves)?moves.slice(0,3).map(moveSummary):[],d7InTop3:kind==='reader.analyze'&&Array.isArray(moves)?moves.slice(0,3).some(move=>move.i===93):null,d7InRawMoves:kind==='reader.analyze'&&Array.isArray(moves)?moves.some(move=>move.i===93):null,counterThreats:kind==='unified.stage-result'&&Array.isArray(result?.counterThreats)?result.counterThreats.slice(0,8).map(threatSummary):[],d7CounterThreat:kind==='unified.stage-result'&&d7Threat?threatSummary(d7Threat):null,d7Rejected:Array.isArray(rejected)?!!d7Rejected:null,d7CertifiedRejected:Array.isArray(rejected)?!!(d7Rejected&&(d7Rejected.pv?.length||d7Rejected.line?.length||d7Rejected.replyTrap||d7Rejected.verifiedRefutation||d7Rejected.proofTree)):null,d7RejectionEvidence:d7Rejected?{reason:text(d7Rejected.reason),hasLine:!!d7Rejected.line?.length,hasPV:!!d7Rejected.pv?.length,hasProofTree:!!d7Rejected.proofTree,verifiedRefutation:boolean(d7Rejected.verifiedRefutation)}:null,counterProof:result?.counterProof?{complete:boolean(result.counterProof.complete),checkedRoots:finite(result.counterProof.checkedRoots),ms:finite(result.counterProof.ms)}:null};
}
function createDiagnostics(context){
 let running=null;
 function replace(object,key,value,restores){const descriptor=Object.getOwnPropertyDescriptor(object,key);if(!descriptor||typeof descriptor.value!=='function')throw Error('Diagnostic boundary is unavailable: '+key);Object.defineProperty(object,key,{...descriptor,value});restores.push(()=>Object.defineProperty(object,key,descriptor));}
 function createCapture({maxRecords=HARD_RECORD_LIMIT}={}){
  if(!Number.isSafeInteger(maxRecords)||maxRecords<1||maxRecords>HARD_RECORD_LIMIT)throw Error('Diagnostic record limit must be between 1 and '+HARD_RECORD_LIMIT);
  const forests=new Set(),records=[];let stage=null,lastStage=null,stageBoard=null,lastStageBoard=null,origin=0,dropped=0,errors=0,session=null,nextInstance=0,projectionOverheadMs=0,stagePreparationMs=0;
  const add=record=>{if(records.length<maxRecords)records.push(record);else if(record.boundary==='unified.stage-result'){const index=records.findIndex(row=>row.boundary!=='unified.stage-result');records.splice(index<0?0:index,1);records.push(record);dropped++;}else dropped++;};
  function inputSummary(board,result){const base=stageBoard||lastStageBoard,position=stage||lastStage,delta=[];let changed=0;if(Array.isArray(board)&&Array.isArray(base)&&board.length===225&&base.length===225)for(let i=0;i<225;i++)if(board[i]!==base[i]){changed++;if(delta.length<4)delta.push({i,coordinate:coordinate(i),before:finite(base[i]),after:finite(board[i])});}const own=delta.filter(cell=>cell.before===0&&cell.after===position?.player),enemy=delta.filter(cell=>cell.before===0&&cell.after===3-position?.player);return {delta,changedCells:base?changed:null,truncated:changed>4,root:changed<=4&&own.length===1?own[0].i:null,rootCoordinate:changed<=4&&own.length===1?own[0].coordinate:null,observedOpponentAddition:changed<=4&&enemy.length===1?enemy[0].i:null,observedOpponentCoordinate:changed<=4&&enemy.length===1?enemy[0].coordinate:null,proofBlock:finite(result?.proof?.block),attribution:'Added cells relative to the private scenario-stage board; root is inferred only for a single added scenario-player stone. Opponent additions are not independently certified mandatory blocks.'};}
  function observe(object,method,kind,instance,restores){
   const original=object[method];replace(object,method,function(...args){
    const begin=performance.now(),wallStart=Date.now();let result,error;
    try{result=Reflect.apply(original,this,args);return result;}catch(thrown){error=thrown;throw thrown;}finally{
     const end=performance.now(),wallEnd=Date.now();
     // Diagnostic projection failure must never replace a returned value/error.
     try{const budgetArgument=kind.startsWith('forest.')?args[kind==='forest.forcing'?3:2]:args[1],budget=typeof budgetArgument==='object'?{automatic:boolean(budgetArgument?.automatic),ms:finite(budgetArgument?.ms),maxMs:finite(budgetArgument?.maxMs)}:finite(budgetArgument);
      add({sequence:records.length+dropped+1,boundary:kind,instance,stage:stage||lastStage,player:finite(kind.startsWith('forest.')?args[1]:args[0]),requestedBudget:budget,defaultBudgetMs:budgetArgument===undefined?(kind==='forest.forcing'?100:kind==='forest.forcedReplyTrap'?200:kind==='reader.analyze'?5000:1000):null,maxPlies:kind==='forest.forcing'?finite(args[2]??11):kind==='forest.forcedReplyTrap'?finite(args[4]??11):kind==='reader.counterLoss'?finite(args[2]??19):null,quiet:kind==='reader.counterLoss'?finite(args[3]??1):null,includeQuiet:kind==='forest.forcedReplyTrap'?boolean(args[5]??false):null,setup:kind==='forest.forcedReplyTrap'?finite(args[3]):null,input:inputSummary(kind.startsWith('forest.')?args[0]:object.board,result),startedMs:begin-origin,finishedMs:end-origin,elapsedMs:end-begin,wallStartedEpochMs:wallStart,wallFinishedEpochMs:wallEnd,threw:!!error,exitClassification:classification(result,error),error:error?{name:text(error?.name),code:text(error?.code)}:null,result:error?null:resultSummary(result,kind)});
     }catch{errors++;}finally{projectionOverheadMs+=performance.now()-end;}
    }
   },restores);
  }
  function observeForest(forest,restores){const instance=++nextInstance;observe(forest,'forcing','forest.forcing',instance,restores);observe(forest,'forcedReplyTrap','forest.forcedReplyTrap',instance,restores);}
  function createEngine(...args){
   if(running)throw Error('Register a diagnostic engine before starting capture');const restores=[],original=context.createForestEngine;
   try{replace(context,'createForestEngine',function(...factoryArgs){const forest=Reflect.apply(original,this,factoryArgs);forests.add(forest);return forest;},restores);return Reflect.apply(context.createEngine,context,args);}finally{for(const restore of restores.reverse())restore();}
  }
  function run(label,fn){
   if(running)throw Error('Nested diagnostic captures are not supported');if(typeof fn!=='function')throw Error('Diagnostic run needs a synchronous callback');
   records.length=0;dropped=0;errors=0;projectionOverheadMs=0;stagePreparationMs=0;stage=null;lastStage=null;stageBoard=null;lastStageBoard=null;nextInstance=0;origin=performance.now();const wallStart=Date.now(),cpuStart=process.cpuUsage(),restores=[];running=capture;let thrown=false;
   try{
    for(const forest of forests)observeForest(forest,restores);
    const originalForest=context.createForestEngine,originalReader=context.createReaderEngine;
    replace(context,'createForestEngine',function(...args){const forest=Reflect.apply(originalForest,this,args);forests.add(forest);observeForest(forest,restores);return forest;},restores);
    replace(context,'createReaderEngine',function(...args){const reader=Reflect.apply(originalReader,this,args),instance=++nextInstance;observe(reader,'analyze','reader.analyze',instance,restores);observe(reader,'counterLoss','reader.counterLoss',instance,restores);return reader;},restores);
    return fn();
   }catch(error){thrown=true;throw error;}finally{
    for(const restore of restores.reverse())restore();running=null;const cpu=process.cpuUsage(cpuStart);
    session={label:text(label),startedEpochMs:wallStart,finishedEpochMs:Date.now(),elapsedMs:performance.now()-origin,cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000,threw:thrown};
   }
  }
  function withStage(label,board,player,fn){
   if(running!==capture)throw Error('Diagnostic stage must be inside its capture');const previous=stage,previousBoard=stageBoard,preparationStart=performance.now();
   // This work precedes the original analyze() call and its existing deadline.
   stage={label:text(label),positionSha256:crypto.createHash('sha256').update(JSON.stringify(board)).digest('hex'),stones:Array.isArray(board)?board.filter(Boolean).length:null,player:finite(player)};lastStage=stage;stageBoard=Array.isArray(board)?board.slice():null;lastStageBoard=stageBoard;
   const begin=performance.now();stagePreparationMs+=begin-preparationStart;let result,error;
   try{result=fn();return result;}catch(thrown){error=thrown;throw thrown;}finally{const end=performance.now();try{add({sequence:records.length+dropped+1,boundary:'unified.stage-result',stage,startedMs:begin-origin,finishedMs:end-origin,elapsedMs:end-begin,threw:!!error,error:error?{name:text(error?.name),code:text(error?.code)}:null,result:error?null:resultSummary(result,'unified.stage-result')});}catch{errors++;}finally{projectionOverheadMs+=performance.now()-end;}stage=previous;stageBoard=previousBoard;}
  }
  function report(){const value={schemaVersion:1,kind:'forest-omok-node-boundary-diagnostics',runtime:{node:process.versions.node,platform:process.platform,arch:process.arch,availableParallelism:typeof os.availableParallelism==='function'?os.availableParallelism():os.cpus().length},session,maxRecords,hardRecordLimit:HARD_RECORD_LIMIT,hardReportByteLimit:MAX_REPORT_BYTES,droppedRecords:dropped,outputDroppedRecords:0,projectionErrors:errors,projectionOverheadMs,stagePreparationMs,coverage:{enabledOnlyInsideRun:true,forest:'Public forcing/forcedReplyTrap calls on registered shared-engine instances',reader:'Public analyze/counterLoss calls on fresh Reader instances created by the shared Node VM',unobserved:'Recursive/lexical calls inside search functions and separately imported Reader engines are not hooked',nodes:'Actual return.nodes only; null means not exposed',timing:'Projection overhead measures post-boundary record work; stage preparation precedes analyze deadlines. Other wrapper overhead is not measured. Wall-clock searches are not timing invariant.'},records:JSON.parse(JSON.stringify(records))};while(Buffer.byteLength(JSON.stringify(value))>MAX_REPORT_BYTES&&value.records.length){const index=value.records.findIndex(row=>row.boundary!=='unified.stage-result');value.records.splice(index<0?0:index,1);value.outputDroppedRecords++;}return value;}
  function serializeReport(){
   // Called only after capture. ASCII JSON survives legacy native-shell decoding
   // while JSON.parse restores every original Unicode code unit and quote.
   const value=report(),serialize=()=>JSON.stringify(value).replace(/[\u0080-\uffff]/g,character=>'\\u'+character.charCodeAt(0).toString(16).padStart(4,'0'));
   let serialized=serialize();while(Buffer.byteLength(serialized,'ascii')>MAX_REPORT_BYTES&&value.records.length){const index=value.records.findIndex(row=>row.boundary!=='unified.stage-result');value.records.splice(index<0?0:index,1);value.outputDroppedRecords++;serialized=serialize();}return serialized;
  }
  const capture={createEngine,run,stage:withStage,report,serializeReport};return capture;
 }
 return {createCapture,HARD_RECORD_LIMIT};
}
module.exports={createDiagnostics,HARD_RECORD_LIMIT,MAX_REPORT_BYTES};
