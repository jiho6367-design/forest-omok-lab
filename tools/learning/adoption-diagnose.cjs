'use strict';
// Stored evidence only. Do not import arena/run/node-engine: their dependencies
// can reserve trials or recover production deployment state during module load.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const S=require('./state.cjs'),P=require('./experiment-plan.cjs');
const MAX_JSON_BYTES=4*1024*1024,MAX_LEDGER_BYTES=256*1024*1024;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
const finite=value=>Number.isFinite(value);
const strings=value=>Array.isArray(value)?value.filter(x=>typeof x==='string').map(x=>x.slice(0,2048)):[];
const summaryNames=dir=>fs.readdirSync(dir).filter(name=>/^arena-cycle-\d+\.summary\.json$/.test(name)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));

function inputs(){
 const rows=new Map(),values=new Map();
 function read(file,maxBytes=MAX_JSON_BYTES,json=true){
  file=path.resolve(file);if(rows.has(file))return {evidence:rows.get(file),value:values.get(file)??null};
  const row={file,available:false};rows.set(file,row);
  if(!fs.existsSync(file)){row.error='missing';return {evidence:row,value:null};}
  const stat=fs.statSync(file);Object.assign(row,{bytes:stat.size,mtimeMs:stat.mtimeMs});
  if(!stat.isFile()||stat.size>maxBytes){row.error=stat.isFile()?'size-limit-exceeded':'not-a-file';return {evidence:row,value:null};}
  if(!json){row.sha256=S.fileHash(file);row.available=true;return {evidence:row,value:null};}
  const bytes=fs.readFileSync(file);row.sha256=S.hash(bytes);row.available=true;
  try{const value=JSON.parse(bytes.toString('utf8'));values.set(file,value);return {evidence:row,value};}
  catch{row.available=false;row.error='invalid-json';return {evidence:row,value:null};}
 }
 function verify(){
  for(const row of rows.values()){
   if(row.error==='missing'){if(fs.existsSync(row.file))throw Error('Input appeared during diagnosis: '+row.file);continue;}
   if(!fs.existsSync(row.file))throw Error('Input disappeared during diagnosis: '+row.file);
   const stat=fs.statSync(row.file);
   if(stat.size!==row.bytes||stat.mtimeMs!==row.mtimeMs||(row.sha256&&S.fileHash(row.file)!==row.sha256))throw Error('Input changed during diagnosis: '+row.file);
  }
 }
 return {read,verify,rows};
}

function categories(reasons){
 const result=new Set();
 for(const reason of reasons){
  if(/threshold|strength/i.test(reason))result.add('strength-threshold');
  if(/unfinished|incomplete|missing.*control|control.*missing/i.test(reason))result.add('incomplete-evidence');
  if(/invalid|replay/i.test(reason))result.add('invalid-game');
  if(/parity/i.test(reason))result.add('model-parity');
  if(/rule|tactical/i.test(reason))result.add('rule-audit');
  if(/training|updates|dataset|finite/i.test(reason))result.add('training-evidence');
  if(/identity|changed|mismatch/i.test(reason))result.add('identity-or-input-change');
 }
 return [...result];
}

function arenaRow(value,evidence){
 const row={file:evidence.file,available:evidence.available,cycle:value?.cycle??null,trial:value?.trial??null,
  candidateHash:value?.candidateHash??null,candidateModelId:value?.candidateModelId??null,
  complete:value?.complete===true,passed:typeof value?.passed==='boolean'?value.passed:null,
  rejectionReasons:strings(value?.rejectionReasons),scoresAvailable:false,scoresSuppressedReasons:[],controls:[]};
 const errors=row.scoresSuppressedReasons;
 if(!value||typeof value!=='object'){errors.push(evidence.error||'missing-summary');return row;}
 if(!count(value.cycle)||value.cycle<1||!count(value.trial)||value.trial<1||!sha(value.candidateHash)||typeof value.candidateModelId!=='string'||!value.candidateModelId||!['sourceHash','harnessHash','runtimeHash'].every(key=>sha(value.identity?.[key])))errors.push('missing-or-invalid-evaluation-identity');
 if(!row.complete)errors.push('evaluation-incomplete');
 if(!count(value.pairs)||value.pairs<1||!finite(value.moveMs)||value.moveMs<=0)errors.push('evaluation-settings-invalid');
 const confidence=value.planning?.confidence??value.requirements?.confidence,minPairs=value.planning?.minPairs??value.requirements?.minPairs;
 if(!finite(confidence)||confidence<.5||confidence>=1||!count(minPairs)||minPairs<1||typeof value.passed!=='boolean')errors.push('recorded-gate-identity-unavailable');
 if(!Array.isArray(value.invalidGames)||value.invalidGames.length)errors.push('invalid-games-or-validation-unavailable');
 const expected=['baseline',value.incumbentHash?'incumbent':'current-no-model'];
 if(!Object.hasOwn(value,'incumbentHash')||(value.incumbentHash!==null&&!sha(value.incumbentHash)))errors.push('missing-or-invalid-incumbent-identity');
 if(value.controlsPresent!==true||!Array.isArray(value.opponents)||value.opponents.length!==expected.length||expected.some(name=>!value.opponents.includes(name))||!/^([a-f0-9]{7}|[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value.baselineCommit||''))errors.push('required-controls-or-baseline-identity-missing');
 for(const name of expected){
  const control=value.opponentEvidence?.[name],stats=value.stats?.[name];
  if(!control||!sha(control.sourceHash)||!sha(control.lessonHash)||control.moveMs!==value.moveMs||control.optimized!==true||(name==='incumbent'?control.modelHash!==value.incumbentHash:control.modelHash!==null||control.modelExplicitlyNull!==true)||(name!=='baseline'&&control.sourceHash!==value.identity?.sourceHash))errors.push('control-identity-unavailable:'+name);
  if(!stats||!['wins','draws','losses','completedGames','completedPairs','independentFamilies','minPairs'].every(key=>count(stats[key]))||stats.unfinished!==0||stats.completedGames!==value.pairs*2||stats.completedGames!==stats.wins+stats.draws+stats.losses||stats.completedPairs!==value.pairs||stats.independentFamilies!==value.pairs||!finite(stats.meanScore)||stats.meanScore<0||stats.meanScore>1||!finite(stats.lowerConfidenceBound)||stats.lowerConfidenceBound<0||stats.lowerConfidenceBound>1||!finite(stats.alpha)||stats.alpha<=0||stats.alpha>=1||typeof stats.passed!=='boolean')errors.push('incomplete-or-invalid-paired-statistics:'+name);
  else if(stats.minPairs!==minPairs||Math.abs(stats.alpha-(1-confidence)/(value.trial*(value.trial+1)))>1e-15||Math.abs(stats.meanScore-(stats.wins+.5*stats.draws)/stats.completedGames)>1e-10||Math.abs(stats.lowerConfidenceBound-Math.max(0,stats.meanScore-Math.sqrt(Math.log(1/stats.alpha)/(2*stats.independentFamilies))))>1e-10||stats.passed!==(stats.independentFamilies>=stats.minPairs&&stats.lowerConfidenceBound>.5))errors.push('paired-statistics-inconsistent:'+name);
 }
 row.rejectionCategories=categories(row.rejectionReasons);
 if(errors.length)return row;
 row.scoresAvailable=true;row.moveMs=value.moveMs;row.pairs=value.pairs;
 row.controls=expected.map(name=>{
  const s=value.stats[name];return {name,sourceHash:value.opponentEvidence[name].sourceHash,modelHash:value.opponentEvidence[name].modelHash,
   wins:s.wins,draws:s.draws,losses:s.losses,completedGames:s.completedGames,independentFamilies:s.independentFamilies,
   meanScore:s.meanScore,lowerConfidenceBound:s.lowerConfidenceBound,alpha:s.alpha,minPairs:s.minPairs,passed:s.passed};
 });
 return row;
}

function trainingRow(value,evidence,settings){
 if(!value||typeof value!=='object')return {available:false,source:evidence,error:evidence.error||'invalid-training-report'};
 const t=value.training||{},cycles=[value.checkpoint,value.dataset].filter(x=>typeof x==='string').map(x=>/cycle-(\d+)/.exec(x)?.[1]).filter(Boolean).map(Number),cycle=cycles.length&&cycles.every(x=>x===cycles[0])?cycles[0]:null;
 const diagnosticChanges=Object.fromEntries(['train','validation'].map(key=>[key,finite(value.diagnostics?.[key]?.maximumAbsoluteScoreChange)?value.diagnostics[key].maximumAbsoluteScoreChange:null]));
 const epochs=count(t.epochsCompleted)?t.epochsCompleted:null,minEpochs=count(t.minEpochs)?t.minEpochs:null;
 return {available:true,source:evidence,cycle,modelId:value.modelId??null,selectedBaseline:t.selectedBaseline===true,bestEpoch:t.bestEpoch??null,
  exportUsesTrainedEpoch:typeof t.exportUsesTrainedEpoch==='boolean'?t.exportUsesTrainedEpoch:null,
  epochsCompleted:epochs,configuredEpochs:settings.epochs??null,minEpochs,reachedMinEpochs:epochs!==null&&minEpochs!==null?epochs>=minEpochs:null,
  status:value.status??t.status??null,stopReason:value.stopReason??t.stopReason??null,
  timeLimitedBeforeMinEpochs:(value.stopReason??t.stopReason)==='time-limit'&&epochs!==null&&minEpochs!==null&&epochs<minEpochs,
  diagnosticMaximumAbsoluteScoreChange:diagnosticChanges,preservedOnDiagnosticSamples:t.selectedBaseline===true&&Object.values(diagnosticChanges).every(x=>x!==null&&x<.0001),
  scope:'Selected baseline means the exported candidate retained the initialization on validation selection. Bounded score samples and optimizer loss do not prove playing strength or feature/objective causality.'};
}

function ledgerSnapshot(file,hasWal){
 // Even SQLite readOnly may create WAL/SHM sidecars on a WAL-mode database.
 // Open only a disposable byte snapshot, including committed WAL frames.
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'omok-adoption-ledger-')),copy=path.join(temp,'ledger.sqlite');
 try{
  fs.copyFileSync(file,copy);if(hasWal)fs.copyFileSync(file+'-wal',copy+'-wal');
  const ledger=P.readLedger(copy);return {...ledger,file,access:'Read-only disposable byte snapshot; source database never opened by SQLite; no reservations or allocations'};
 }finally{
  // Remove only our exact temporary SQLite filenames, never source data.
  for(const name of ['ledger.sqlite','ledger.sqlite-wal','ledger.sqlite-shm','ledger.sqlite-journal']){const target=path.join(temp,name);if(fs.existsSync(target))fs.unlinkSync(target);}
  fs.rmdirSync(temp);
 }
}

function diagnoseAdoption(options={}){
 if(!options.runDir)throw Error('Supply --run-dir=<existing-run>');
 const runDir=path.resolve(options.runDir);if(!fs.existsSync(runDir)||!fs.statSync(runDir).isDirectory())throw Error('Run directory is missing');
 const I=inputs(),stateInput=I.read(path.join(runDir,'state.json')),settingsInput=I.read(path.join(runDir,'settings.json')),decisionInput=I.read(path.join(runDir,'adoption.json')),trainingInput=I.read(path.join(runDir,'candidate.json.training.json'));
 const state=stateInput.value||{},settings=settingsInput.value||{},decision=decisionInput.value;
 const names=summaryNames(runDir),selected=names.length?names:fs.existsSync(path.join(runDir,'arena.summary.json'))?['arena.summary.json']:[];
 const arenas=selected.map(name=>{const input=I.read(path.join(runDir,name)),row=arenaRow(input.value,input.evidence),match=/^arena-cycle-(\d+)\./.exec(name);row.filenameCycle=match?Number(match[1]):null;if(match&&input.value&&input.value.cycle!==Number(match[1])){row.scoresAvailable=false;row.controls=[];row.scoresSuppressedReasons.push('cycle-filename-identity-mismatch');}return row;});
 const latestArena=arenas.filter(x=>count(x.cycle)).sort((a,b)=>a.cycle-b.cycle).at(-1)||null;
 const currentDecision=decision&&typeof decision==='object'?{available:true,source:decisionInput.evidence,at:decision.at??null,cycle:decision.cycle??null,adopted:typeof decision.adopted==='boolean'?decision.adopted:null,decision:decision.decision??null,reason:typeof decision.reason==='string'?decision.reason.slice(0,4096):null,
  newerThanLatestArena:count(decision.cycle)&&latestArena?decision.cycle>latestArena.cycle:null}: {available:false,source:decisionInput.evidence};
 const training=trainingRow(trainingInput.value,trainingInput.evidence,settings);
 training.sameCycleAsCurrentDecision=count(training.cycle)&&count(currentDecision.cycle)?training.cycle===currentDecision.cycle:null;
 const ledgerFile=path.resolve(options.ledgerFile||path.join(S.ROOT,'outputs/learning/evaluation-ledger.sqlite'));
 const ledgerInputs=['','-wal','-shm'].map(suffix=>I.read(ledgerFile+suffix,MAX_LEDGER_BYTES,false));let ledger,nextTrialPlan,latestGate;
 try{if(!ledgerInputs[0].evidence.available)throw Error(ledgerInputs[0].evidence.error==='missing'?'Shared evaluation ledger missing; never assume trial zero.':'Shared evaluation ledger unavailable: '+ledgerInputs[0].evidence.error);if(ledgerInputs.slice(1).some(x=>!x.evidence.available&&x.evidence.error!=='missing'))throw Error('Shared ledger sidecar unavailable or exceeds the read-size limit');ledger={available:true,...ledgerSnapshot(ledgerFile,ledgerInputs[1].evidence.available)};if(count(state.trial)&&state.trial>ledger.highwater)throw Error('Run trial exceeds shared ledger highwater; reconcile without resetting history');}
 catch(error){ledger={available:false,file:ledgerFile,error:error.message,nextTrial:null};}
 const planningOptions={confidence:settings.confidence,minPairs:settings.minPairs,pairs:settings.pairs,
  opponents:2,workers:settings.workers,moveMs:settings.validationMs,
  minimumUsefulImprovement:options.minimumUsefulImprovement??settings.minimumUsefulImprovement??.10,targetPower:options.targetPower??settings.targetPower??.8};
 try{if(!settingsInput.evidence.available||!['confidence','minPairs','pairs','workers','validationMs'].every(key=>finite(settings[key])))throw Error('Recorded run settings unavailable; cannot invent the next trial configuration');nextTrialPlan=ledger.available?{available:true,...P.planningRequirements({...planningOptions,trial:ledger.nextTrial}),reservationCreated:false}:{available:false,reason:ledger.error};}
 catch(error){nextTrialPlan={available:false,reason:error.message};}
 if(latestArena){
  const input=I.read(latestArena.file),value=input.value,confidence=value?.planning?.confidence??value?.requirements?.confidence;
  try{const minPairs=value.planning?.minPairs??value.stats?.baseline?.minPairs;if(!finite(confidence)||!count(minPairs)||minPairs<1)throw Error('Recorded confidence/minPairs unavailable; current settings cannot replace historical gate settings');const p=P.planningRequirements({...planningOptions,confidence,pairs:value.pairs,minPairs,trial:value.trial,moveMs:value.moveMs});latestGate={available:true,cycle:value.cycle,trial:value.trial,confidence,minPairs:p.minPairs,pairs:value.pairs,alpha:p.alpha,requiredObservedMeanStrictlyGreaterThan:p.configured.requiredObservedMeanStrictlyGreaterThan,boundCrossingPossible:p.configured.boundCrossingPossible,scope:'Historical gate arithmetic only; this is not a score or a fresh promotion authorization.'};}
  catch(error){latestGate={available:false,cycle:latestArena.cycle,reason:error.message};}
 }else latestGate={available:false,reason:'No preserved arena summaries'};
 const counts={basis:'Stored arena gate flags, not actual model deployment/adoption records.',preservedSummaries:arenas.length,completedAccepted:arenas.filter(x=>x.complete&&x.passed===true).length,
  completedRejected:arenas.filter(x=>x.complete&&x.passed===false).length,incomplete:arenas.filter(x=>!x.complete).length,
  scoreEligible:arenas.filter(x=>x.scoresAvailable).length,scoreSuppressed:arenas.filter(x=>!x.scoresAvailable).length};
 const nextSteps=[];
 if(currentDecision.newerThanLatestArena)nextSteps.push('Read the current decision and same-cycle training report first; the older arena result does not describe the current candidate.');
 if(training.selectedBaseline)nextSteps.push('Freeze the current dataset and initialization; compare completed validation epochs and selectedBaseline before spending another arena trial. Do not force-export a worse epoch to obtain an adoption.');
 if(training.timeLimitedBeforeMinEpochs)nextSteps.push('The time limit stopped training before minEpochs. Test a separate bounded run with enough startup/data preparation and epoch time; reaching minEpochs still does not guarantee validation improvement or promotion.');
 if(arenas.some(x=>!x.scoresAvailable))nextSteps.push('Preserve and resolve incomplete games, invalid records, identities or controls; suppressed summaries cannot support a strength conclusion.');
 if(nextTrialPlan.available)nextSteps.push('Preregister one fixed candidate and fresh paired families with the shared nextTrial sample plan, then check resources. Keep the existing gate; do not pool adaptive trials, resize after scores or reset the ledger.');
 else nextSteps.push('Reconcile the unavailable shared ledger before planning an evaluation; no trial zero or fresh false-promotion budget is assumed.');
 nextSteps.push('Investigate search/value transmission, data coverage and representation/objective alternatives in separate controlled diagnostics. These stored reports do not establish which mechanism causes the plateau.');
 I.verify();if(JSON.stringify(summaryNames(runDir))!==JSON.stringify(names))throw Error('Arena summary list changed during diagnosis');
 return {schemaVersion:1,kind:'omok-learning-adoption-diagnostic',createdAt:new Date().toISOString(),run:{dir:runDir,runId:state.runId??null,cycle:state.cycle??null,status:state.status??null},
  currentDecision,training,counts,arenas,latestArenaCycle:latestArena?.cycle??null,
  newerUnreadableArenaFiles:arenas.filter(row=>!row.available&&count(row.filenameCycle)&&(!latestArena||row.filenameCycle>latestArena.cycle)).map(row=>({file:row.file,filenameCycle:row.filenameCycle,reasons:row.scoresSuppressedReasons})),
  latestGate,ledger,nextTrialPlan,nextSteps,
  interpretation:'Scores remain separate for each candidate/trial/control. No pooled significance or strength claim is made across adaptive trials. Stored passed statuses are not independently replayed adoption evidence.',
  limitations:['No new training, gameplay, reservations or model adoption were performed.','Completed summary identities and counts are checked, but original moves are not replayed by this report.','Feature, optimizer, data and search causality remains unknown until controlled comparisons are completed.'],
  inputsUnchanged:true,inputVerification:'SHA-256 plus size/mtime for all read inputs; metadata only for skipped oversized files.',inputs:[...I.rows.values()]};
}

function writeReport(file,report){
 file=path.resolve(file);const relative=path.relative(report.run.dir,file);
 if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Write diagnostic output outside the production run directory');
 if(path.extname(file)!=='.json')throw Error('Diagnostic output must be a separate .json file');
 if(report.inputs.some(row=>row.file===file))throw Error('Diagnostic output cannot overwrite an input');
 fs.mkdirSync(path.dirname(file),{recursive:true});const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return file;
}
function main(argv){
 const options={},map={'run-dir':'runDir','ledger-file':'ledgerFile',out:'out','minimum-useful-improvement':'minimumUsefulImprovement','target-power':'targetPower'};
 for(const arg of argv){if(arg==='--help'){console.log('node tools/learning/adoption-diagnose.cjs --run-dir=<existing-run> [--out=<new-separate-report.json>] [--ledger-file=<shared.sqlite>] [--minimum-useful-improvement=0.10] [--target-power=0.8]\nRead-only stored adoption/training/arena diagnostic. Never reserves trials, pools strength scores, changes gates or writes production run files.');return;}const match=/^--([^=]+)=(.+)$/.exec(arg);if(!match||!map[match[1]])throw Error('Use recognized --name=value diagnostic arguments');options[map[match[1]]]=['minimum-useful-improvement','target-power'].includes(match[1])?Number(match[2]):match[2];}
 const report=diagnoseAdoption(options);if(options.out)console.log(JSON.stringify({file:writeReport(options.out,report),counts:report.counts,latestDecisionCycle:report.currentDecision.cycle,latestArenaCycle:report.latestArenaCycle,nextTrial:report.ledger.nextTrial??null,inputsUnchanged:report.inputsUnchanged}));else console.log(JSON.stringify(report,null,2));
}
if(require.main===module){try{main(process.argv.slice(2));}catch(error){console.error(error.stack||error);process.exitCode=1;}}
module.exports={MAX_JSON_BYTES,arenaRow,diagnoseAdoption,writeReport};
