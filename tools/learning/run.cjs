'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),readline=require('node:readline');
const S=require('./state.cjs'),R=require('./replay.cjs'),G=require('./generate.cjs'),A=require('./arena.cjs'),C=require('./corpus.cjs'),J=require('./journal.cjs');
const timingScopes=new WeakMap();
function parse(args){const out={command:args[0]||'status'};for(let n=1;n<args.length;n++){const a=args[n];if(!a.startsWith('--'))throw Error('Unknown argument '+a);const k=a.slice(2).split('=')[0],v=a.includes('=')?a.slice(a.indexOf('=')+1):args[n+1]&&!args[n+1].startsWith('--')?args[++n]:true;out[k]=v;}return out;}
function options(args){
 const map={'move-ms':'moveMs','analysis-ms':'analysisMs','validation-ms':'validationMs','min-pairs':'minPairs','batch-size':'batchSize','train-seconds':'trainSeconds','max-plies':'maxPlies','sample-every':'sampleEvery','max-samples':'maxSamples','stage-minutes':'stageMinutes','games-per-cycle':'gamesPerCycle','min-new-samples':'minNewSamples','max-training-samples':'maxTrainingSamples','record-branch-fraction':'recordBranchFraction','hidden-size':'hiddenSize','scale':'scale','learning-rate':'learningRate','family-balance':'familyBalance','early-stop-patience':'earlyStopPatience','early-stop-min-delta':'earlyStopMinDelta','min-epochs':'minEpochs','diagnostic-samples':'diagnosticSamples','selection-min-delta':'selectionMinDelta','max-derived-cycles':'maxDerivedCycles'},out={};
 for(const key of ['seed','games','pairs','workers','epochs','minutes','exploration','confidence',...Object.keys(map)])if(args[key]!==undefined){const n=Number(args[key]);if(!Number.isFinite(n))throw Error('Invalid number for --'+key);out[map[key]||key]=n;}
 for(const key of ['python','device','priority','sample-policy','loss-weight-normalization'])if(args[key])out[{'sample-policy':'samplePolicy','loss-weight-normalization':'lossWeightNormalization'}[key]||key]=String(args[key]);
 if(args.continuous!==undefined){if(![true,false,'true','false'].includes(args.continuous))throw Error('--continuous must be true or false');out.continuous=args.continuous===true||args.continuous==='true';}
 if(args['concurrent-training']!==undefined){const v=args['concurrent-training'];if(![true,false,'true','false'].includes(v))throw Error('--concurrent-training must be true or false');out.concurrentTraining=v===true||v==='true';}
 if(args['no-adopt'])out.autoAdopt=false;if(args['max-disk-gb'])out.maxDiskBytes=Number(args['max-disk-gb'])*1024**3;return out;
}
function validateSettings(x){
 if(!['legacy','paired-v1'].includes(x.samplePolicy)||!['batch','global-mean'].includes(x.lossWeightNormalization)||!Number.isFinite(x.selectionMinDelta)||x.selectionMinDelta<0||x.selectionMinDelta>1||!Number.isSafeInteger(x.maxDerivedCycles)||x.maxDerivedCycles<1)throw Error('Invalid experimental learning/retention settings');
 if(!['normal','below-normal'].includes(x.priority)||typeof x.concurrentTraining!=='boolean')throw Error('Invalid resource scheduling settings');
 for(const k of ['games','pairs','minPairs','workers','epochs','batchSize','sampleEvery','maxSamples','maxPlies','gamesPerCycle','minNewSamples','maxTrainingSamples','hiddenSize','minEpochs','diagnosticSamples'])if(!Number.isSafeInteger(x[k])||x[k]<1)throw Error(k+' must be a positive integer');
 if(!Number.isSafeInteger(x.earlyStopPatience)||x.earlyStopPatience<0||x.minEpochs>x.epochs)throw Error('Invalid epoch/early-stop settings');
 if(x.workers>16)throw Error('At most 16 game workers are supported');
 if(x.moveMs<30||x.analysisMs<30||x.validationMs<30)throw Error('Search budgets must be at least 30ms');
 if(x.confidence<.9||x.confidence>=1||x.minPairs<32)throw Error('Promotion requires confidence >=90% and at least 32 independent paired families');
 if(x.exploration<0||x.exploration>1||x.minutes<=0||x.stageMinutes<=0||x.trainSeconds<=0||!Number.isFinite(x.maxDiskBytes)||x.maxDiskBytes<=0||x.familyBalance<0||x.familyBalance>1||x.earlyStopMinDelta<0||x.learningRate<=0||x.scale<=0||x.scale>600||x.hiddenSize>64||x.diagnosticSamples>4096||x.recordBranchFraction!=null&&(x.recordBranchFraction<0||x.recordBranchFraction>1))throw Error('Invalid resource/learning settings');
}
function continuousProfile(options){
 if(!options.continuous)return options;
 return {samplePolicy:'paired-v1',selectionMinDelta:.0001,lossWeightNormalization:'global-mean',workers:10,priority:'below-normal',concurrentTraining:true,gamesPerCycle:512,minNewSamples:10000,maxTrainingSamples:100000,pairs:64,epochs:20,batchSize:256,familyBalance:1,earlyStopPatience:10,earlyStopMinDelta:.0001,minEpochs:Math.min(10,options.epochs||20),recordBranchFraction:.25,maxSamples:Number.MAX_SAFE_INTEGER,...options};
}
function normalizeLesson(l,source){if(!l||typeof l.key!=='string'||!/^[012]{225}$/.test(l.key)||!Number.isInteger(l.bad)||l.bad<0||l.bad>=225||!Number.isInteger(l.good)||l.good<0||l.good>=225||l.bad===l.good||l.key[l.bad]!=='0'||l.key[l.good]!=='0')throw Error('Invalid existing lesson in '+source);return {...l,active:l.rules?.fivePriority!==false&&(!l.rulesId||l.rulesId===S.RULES_ID),labelRole:'existing heuristic only; never ground-truth training label',provenance:[...(l.provenance||[]),source]};}
function importLessons(context,payload,records,source){
 const doc=S.read(path.join(context.dir,'lessons.json'),{lessons:[]}),lessons=doc.lessons||[],incoming=Array.isArray(payload?.lessons)?payload.lessons:[];
 const study=records.find(r=>r.first===2&&r.events.length===42&&r.events[34]?.i===R.index('L7')&&r.events[0]?.i===R.index('H8')&&r.events[1]?.i===R.index('I8'));
 if(study){const E=require('../../src/node-engine.cjs')({model:null}),pre=R.replay({...study,events:study.events.slice(0,34)}).board,can=E.canonical(pre,2);incoming.push({key:can.key,bad:E.transformed(R.index('L7'),can.t),good:E.transformed(R.index('K9'),can.t),game:study.id,turn:35,type:'Preserved app 35th-move lesson',verified:true,scope:'Historical bounded VCF defense check; universal safety unproved',provenance:['src/app.js makeStudy k=34']});}
 const seen=new Set(lessons.map(l=>S.hash([l.key,l.bad,l.good,l.rules])));for(const raw of incoming){const l=normalizeLesson(raw,source),id=S.hash([l.key,l.bad,l.good,l.rules]);if(!seen.has(id)){lessons.push(l);seen.add(id);}}
 if(lessons.length>2000)throw Error('Existing lesson limit exceeded (2000)');S.atomic(path.join(context.dir,'lessons.json'),{schemaVersion:1,rulesId:S.RULES_ID,baselineCommit:context.state.baselineCommit,modelVersion:G.modelFor(context)?.modelId||'baseline',lessons,lessonHash:S.hash(lessons.filter(l=>l.active!==false)),scope:'Existing symmetric whole-position heuristics applied identically to both comparison engines; claims are not learning labels'});context.state.counters.existingLessons=lessons.filter(l=>l.active!==false).length;
}
function importRecords(context,input,args={}){
 const existing=S.read(path.join(context.dir,'records.json'),[]),text=input?fs.readFileSync(path.resolve(S.ROOT,input),'utf8'):null,payload=text&&/^[\s]*[{[]/.test(text)?JSON.parse(text):null,incoming=input?R.normalizeRecords(text,{firstPlayer:args.first?Number(args.first):undefined,seed:context.settings.seed,source:path.basename(input)}):[],built=R.bootstrap({seed:context.settings.seed}),all=[...existing],seen=new Set(existing.map(r=>r.contentId||R.familyFor(r.events,r.first)));
 R.assertRecordIds([...existing,...built.records,...incoming]);
 for(const record of [...built.records,...incoming])if(!seen.has(record.contentId)){all.push(record);seen.add(record.contentId);}
 const grouped=R.groupFamilies(all,existing),priorGroups=S.read(path.join(context.dir,'family-groups.json'),{aliases:{}}),aliases={...priorGroups.aliases,...grouped.aliases};for(const id of Object.keys(aliases))aliases[id]=require('./snapshot.cjs').resolveAlias(id,x=>aliases[x]);
 for(const r of all){const known=context.state.familySplits?.[r.familyId]||C.familySplit(context,r.familyId);if(known)r.split=known;}for(const group of grouped.groups){group.split=all.find(r=>r.familyId===group.familyId).split;group.finalTestEligible=group.split==='test';}
 S.atomic(path.join(context.dir,'family-groups.json'),{schemaVersion:1,aliases,groups:grouped.groups,scope:'Canonical opening-stem/prefix families; links to existing training/validation data cannot become final test data.'});
 // Existing split assignments remain immutable on repeated imports. Report
 // prefixes are seeds/teacher evidence, never silently accepted proof labels.
 importLessons(context,payload,all,input?path.basename(input):'existing app source bootstrap');S.atomic(path.join(context.dir,'records.json'),all);S.atomic(path.join(context.dir,'bootstrap.json'),{...built,records:undefined,importedCount:incoming.length,totalRecords:all.length,splitCounts:Object.fromEntries(['train','validation','test'].map(s=>[s,all.filter(r=>r.split===s).length]))});context.state.counters.importedRecords=all.length;context.state.progress={records:all.length,added:all.length-existing.length,bootstrapErrors:built.errors.length};S.save(context);return all;
}
async function snapshotData(context,file){return timed(context,'snapshot',()=>require('./snapshot.cjs').snapshotData(context,file));}
async function train(context,{deadline=Infinity,execute,trainedThroughSamples}={}){
 await require('./snapshot.cjs').ensureExposures(context);
 const cycle=context.state.cycle||1,data=path.join(context.dir,'datasets/cycle-'+cycle+'.jsonl'),output=path.join(context.dir,'candidate.json'),checkpoint=path.join(context.dir,'checkpoints/cycle-'+cycle+'.pt');
 if(!fs.existsSync(data)){await snapshotData(context,data);S.setPhase(context,'train','train in local CPU/GPU pipeline');}const manifest=S.read(data+'.manifest.json');if(!manifest?.counts.train||!manifest?.counts.validation)throw Error('Training requires independent train and validation families. Generate more seeded games or import additional records.');if(S.fileHash(data)!==manifest.sha256)throw Error('Fixed training snapshot changed');
 const sampleCutoff=trainedThroughSamples??context.state.pipeline?.trainingSampleCount??manifest.selection?.sourceRows??context.state.counters.samples;
 const storage=require('./storage.cjs'),releaseStorage=storage.reserveTraining(context,fs.statSync(data).size*4+(manifest.counts.train+manifest.counts.validation)*160+16*1024*1024);try{
 if(!fs.existsSync(context.settings.python))throw Error('Local Python runtime is missing: '+context.settings.python);
 const maximum=Math.max(1,Math.min(context.settings.trainSeconds,(deadline-Date.now())/1000));const args=[path.join(__dirname,'train.py'),'train','--data',data,'--output',output,'--checkpoint',checkpoint,'--device',context.settings.device,'--epochs',String(context.settings.epochs),'--batch-size',String(context.settings.batchSize),'--max-seconds',String(maximum),'--stop-file',path.join(context.dir,'stop.flag')];for(const [flag,key] of [['hidden-size','hiddenSize'],['scale','scale'],['learning-rate','learningRate'],['family-balance','familyBalance'],['early-stop-patience','earlyStopPatience'],['early-stop-min-delta','earlyStopMinDelta'],['min-epochs','minEpochs'],['diagnostic-samples','diagnosticSamples'],['selection-min-delta','selectionMinDelta'],['loss-weight-normalization','lossWeightNormalization']])args.push('--'+flag,String(context.settings[key]));if(fs.existsSync(checkpoint))args.push('--resume');const champion=path.join(context.dir,'champion.json');if(!fs.existsSync(checkpoint)){let priorCandidate=null;try{const prior=S.read(output);if(prior?.training?.updates>0)priorCandidate=require('../../src/neural-evaluator.js').validate(prior);}catch{}if(priorCandidate)args.push('--init-model',output);else if(fs.existsSync(champion))args.push('--init-model',champion);else if(fs.existsSync(path.join(context.dir,'warm-start.json')))args.push('--init-model',path.join(context.dir,'warm-start.json'));}
 const start=Date.now();const result=execute?await execute({python:context.settings.python,args,output,data,checkpoint}):await new Promise((resolve,reject)=>{const child=cp.spawn(context.settings.python,args,{cwd:S.ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});let last='',stdout='',stderr='';try{require('node:os').setPriority(child.pid,context.settings.priority==='below-normal'?10:0);context.state.trainingProcess={pid:child.pid,priority:context.settings.priority};S.save(context);}catch(error){context.state.trainingProcess={pid:child.pid,priorityError:error.message};}child.stdout.on('data',d=>{const s=d.toString();stdout+=s;last=(last+s).split('\n').slice(-1)[0];fs.appendFileSync(path.join(context.dir,'train.stdout.log'),s);process.stdout.write(s);});child.stderr.on('data',d=>{stderr=(stderr+d.toString()).slice(-12000);fs.appendFileSync(path.join(context.dir,'train.stderr.log'),d);});child.once('error',reject);child.once('exit',code=>resolve({code,stdout:stdout.slice(-20000),stderr,elapsedMs:Date.now()-start}));});
 context.state.training=S.read(output+'.training.json',{status:'unverified',process:result});context.state.training.process={exitCode:result.code,elapsedMs:result.elapsedMs};
 const reported=context.state.training.training?.updates||context.state.training.updates||0,key=cycle+':'+manifest.sha256,prior=context.state.trainingUpdateCursor;
 if(context.state.training.datasetHash===manifest.sha256&&Number.isSafeInteger(reported)&&reported>=0){const before=prior?.key===key?prior.updates:0;context.state.counters.trainingUpdates=(context.state.counters.trainingUpdates||0)+Math.max(0,reported-before);context.state.trainingUpdateCursor={key,updates:reported};}
 S.save(context);if(result.code!==0)throw Error('Training failed: '+(result.stderr||'').slice(-1000));const model=S.read(output),evidence=A.trainingEvidence(model,context.state.training,manifest.sha256);context.state.training.verification=evidence;context.state.training.trainedThroughSamples=sampleCutoff;S.save(context);if(!evidence.passed){context.state.message='현재 데이터의 새 학습 모델이 검증되지 않아 이전 후보를 새 결과로 사용하지 않습니다.';S.save(context);return false;}require('../../src/neural-evaluator.js').validate(model);context.state.lastTrainingSampleCount=sampleCutoff;S.save(context);return true;
 }finally{releaseStorage();}
}
function deployModel(accepted,options){return require('./deployment.cjs').deploy(accepted,options);}

function adopt(context){
 const candidate=path.join(context.dir,'candidate.json'),arena=S.read(path.join(context.dir,'arena.json')),model=S.read(candidate);if(!model)throw Error('No candidate model');const reasons=[...(arena?.rejectionReasons||['No completed independent evaluation'])],now=S.sourceIdentity(),settingsHash=A.evaluationSettingsHash(context.settings),data=path.join(context.dir,'datasets/cycle-'+context.state.cycle+'.jsonl'),active=path.join(S.ROOT,'src/active-model.json'),current=S.read(active),incumbentHash=current?S.hash(current):null;
 if(arena?.identity?.sourceHash!==now.sourceHash||arena?.identity?.harnessHash!==now.harnessHash||arena?.identity?.runtimeHash!==now.runtimeHash)reasons.push('Engine/harness changed after evaluation');if(arena?.rulesId!==S.RULES_ID||arena?.settingsHash!==settingsHash)reasons.push('Rules/evaluation configuration changed');if(!fs.existsSync(data)||arena?.datasetSha256!==S.fileHash(data))reasons.push('Dataset changed after evaluation');if(arena?.incumbentHash!==incumbentHash)reasons.push('Active incumbent changed; fresh evaluation required');if(arena?.lessonHash!==S.hash(G.lessonsFor(context)))reasons.push('Existing lesson context changed after evaluation');const trainingCheck=A.trainingEvidence(model,S.read(candidate+'.training.json'),arena?.datasetSha256);if(!trainingCheck.passed)reasons.push(...trainingCheck.errors);const parityCheck=A.parity(model,S.read(candidate+'.parity.json'));if(!parityCheck.passed)reasons.push('Candidate parity identity/result changed');
 if(arena?.exclusions?.version!==2)reasons.push('Verified cumulative training/holdout exposure exclusions are missing');
 else if(S.hash(A.exclusionSources(context))!==S.hash(arena.exclusions.sources))reasons.push('Training/holdout exposure or reserved source families changed after evaluation');
 if(arena?.passed){
  try{
   if(!arena.budget?.reservation)throw Error('Durable independent family/trial reservation is missing');require('./trial-ledger.cjs').reconcile(context,arena);
   const opponents=arena.incumbentHash?['baseline','incumbent']:['baseline','current-no-model'];if(!Array.isArray(arena.games)||arena.games.length!==context.settings.pairs*2*opponents.length)throw Error('Full paired evaluation game count changed');
   for(const game of arena.games){if(!game.completed||game.invalid)throw Error('Evaluation has an incomplete or invalid game');A.verifyArenaGame(game);}
   for(const opponent of opponents){const games=arena.games.filter(game=>game.opponent===opponent),stats=A.pairedStats(games,{minPairs:context.settings.minPairs,confidence:context.settings.confidence,trial:arena.trial});if(games.length!==context.settings.pairs*2||stats.independentFamilies!==context.settings.pairs||!stats.passed)throw Error('Recomputed conservative strength threshold failed against '+opponent);if(S.hash(stats)!==S.hash(arena.stats?.[opponent]))throw Error('Stored paired statistics changed against '+opponent);}
   if(!A.rulesAudit(model,S.baselineFactory(context.state.baselineCommit).createEngine).passed)throw Error('Current rule/tactical audit failed');
  }catch(error){reasons.push('Adoption evidence verification failed: '+error.message);}
 }
 const allowed=!!arena?.passed&&arena.complete&&arena.candidateHash===S.hash(model)&&!reasons.length,entry={at:new Date().toISOString(),cycle:context.state.cycle,modelId:model.modelId,candidateHash:S.hash(model),adopted:allowed,decision:allowed?'accepted':arena?.complete?'kept-current':'insufficient-evidence',reason:allowed?'Passed rule/parity checks and conservative independent paired strength thresholds':reasons.join('; '),arena:'arena-cycle-'+context.state.cycle+'.json'};
 if(allowed){
  require('./storage.cjs').requireBudget(context,fs.statSync(path.join(context.dir,'temporal-exposures.jsonl')).size*3+2*1024*1024,'adoption-lineage');
  const accepted={...model,adoption:{accepted:true,at:entry.at,baselineCommit:context.state.baselineCommit,validationHash:S.hash(arena),sourceHash:now.sourceHash,harnessHash:now.harnessHash,runtimeHash:now.runtimeHash,exposure:{runDir:context.dir,file:'models/'+model.modelId+'.exposures.jsonl',sha256:S.fileHash(path.join(context.dir,'temporal-exposures.jsonl'))},datasetSha256:arena.datasetSha256,criteria:{minPairs:context.settings.minPairs,confidence:context.settings.confidence,method:arena.stats.baseline.method},stats:arena.stats}};
  entry.delivery=deployModel(accepted,{stageId:context.state.runId+'-'+context.state.cycle,incumbentHash:arena.incumbentHash,context,entry});S.saveSummary(context);return S.read(path.join(context.dir,'adoption.json'));
 }
 context.state.adoptions.push(entry);context.state.adoptions=context.state.adoptions.slice(-100);S.append(path.join(context.dir,'adoptions.jsonl'),entry);S.save(context);S.atomic(path.join(context.dir,'adoption.json'),entry);return entry;
}
async function timed(context,phase,fn){const start=Date.now(),parent=timingScopes.get(context);timingScopes.set(context,phase);S.setPhase(context,phase,phase+' in local CPU/GPU pipeline');try{return await fn();}finally{if(parent)timingScopes.set(context,parent);else timingScopes.delete(context);context.state.timing=context.state.timing||[];const row={phase,cycle:context.state.cycle,elapsedMs:Date.now()-start,at:new Date().toISOString(),...(parent?{includedInPhase:parent}:{})};S.append(path.join(context.dir,'timing.jsonl'),row);context.state.timing.push(row);context.state.timing=context.state.timing.slice(-100);S.save(context);}}
async function trainWithGeneration(context,{deadline,trainStage=train,generate=G.generate}={}){
 const cancelBuffer=new SharedArrayBuffer(4),started=Date.now(),cutoff=context.state.pipeline.trainingSampleCount;
 const target=context.state.counters.generatedGames+context.settings.gamesPerCycle;
 context.state.concurrency={training:true,generation:true,workers:context.settings.workers,target,trainedThroughSamples:cutoff};S.save(context);
 const training=Promise.resolve().then(()=>trainStage(context,{deadline,trainedThroughSamples:cutoff})).finally(()=>Atomics.store(new Int32Array(cancelBuffer),0,1));
 const generating=Promise.resolve().then(()=>generate(context,{deadline,target,cancelBuffer})).catch(error=>{S.atomic(path.join(context.dir,'stop.flag'),'Background generation failed: '+error.message);throw error;});
 try{const results=await Promise.allSettled([training,generating]);const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;return results[0].value;}
 finally{context.state.concurrency={...context.state.concurrency,training:false,generation:false,elapsedMs:Date.now()-started};S.append(path.join(context.dir,'timing.jsonl'),{phase:'generate-during-train',includedInPhase:'train',cycle:context.state.cycle,elapsedMs:Date.now()-started,at:new Date().toISOString()});S.save(context);}
}
async function cycle(context,args,deadline,hooks={}){
 const analyze=hooks.analyze||G.analyzeRecords,generate=hooks.generate||G.generate,trainStage=hooks.train||train,validate=hooks.validate||A.validate,adoptStage=hooks.adopt||adopt;
 importRecords(context,args.input,args);const continuous=context.settings.continuous,total=continuous?Infinity:context.settings.games;
 const nextTarget=()=>Math.min(total,context.state.counters.generatedGames+context.settings.gamesPerCycle);
 context.state.pipeline=context.state.pipeline||{stage:'analyze',target:nextTarget()};if(context.state.cycle===0)context.state.cycle=1;S.save(context);
 while(Date.now()<deadline&&!S.stopped(context.dir)){
  if(!require('./storage.cjs').checkBudget(context,0,'cycle'))return false;
  const pipeline=context.state.pipeline,remaining=deadline-Date.now();
  if(pipeline.stage==='analyze'){
   const done=await timed(context,'analyze',()=>analyze(context,{deadline:Math.min(deadline,Date.now()+Math.min(context.settings.stageMinutes*60000,remaining*.15))}));
   if(S.stopped(context.dir))return false;
   // A bounded analysis pass may continue later; self-play is still useful.
   pipeline.analysisComplete=!!done;pipeline.stage='generate';S.save(context);
  }else if(pipeline.stage==='generate'){
   const waitingSamples=Math.max(0,context.state.counters.samples-(context.state.lastTrainingSampleCount||0));
   if(continuous&&context.settings.concurrentTraining&&waitingSamples>=context.settings.minNewSamples){context.state.trainingGate={newSamples:waitingSamples,minNewSamples:context.settings.minNewSamples,ready:true};pipeline.stage='train';S.save(context);continue;}
   const done=await timed(context,'generate',()=>generate(context,{target:pipeline.target,deadline:Math.min(deadline,Date.now()+Math.min(context.settings.stageMinutes*60000,remaining*.6))}));
   if(S.stopped(context.dir))return false;
   if(!done){S.save(context);if(context.state.counters.samples>=context.settings.maxSamples||Date.now()>=deadline)return false;continue;}
   const fresh=Math.max(0,context.state.counters.samples-(context.state.lastTrainingSampleCount||0));
   context.state.trainingGate={newSamples:fresh,minNewSamples:context.settings.minNewSamples,ready:!continuous||fresh>=context.settings.minNewSamples};
   if(!context.state.trainingGate.ready){pipeline.target=nextTarget();context.state.message='새 대국 자료를 누적 중입니다. 충분한 새 자료가 쌓이면 다시 학습합니다.';S.save(context);continue;}
   pipeline.stage='train';S.save(context);
  }else if(pipeline.stage==='train'){
   if(deadline-Date.now()<2000)return false;
   if(continuous&&trainStage===train){const file=path.join(context.dir,'datasets/cycle-'+context.state.cycle+'.jsonl'),manifest=await snapshotData(context,file);if(!manifest.counts.train||!manifest.counts.validation){context.state.training={status:'waiting-data',modelExported:false,reason:'학습과 검증을 나눌 독립 자료가 더 필요합니다.'};context.state.cycle++;context.state.pipeline={stage:'generate',target:nextTarget()};S.save(context);continue;}}
   pipeline.trainingSampleCount??=context.state.dataset?.selection?.sourceRows??context.state.counters.samples;S.save(context);
   const trainDeadline=Math.min(deadline,Date.now()+context.settings.trainSeconds*1000);
   const overlap=continuous&&context.settings.concurrentTraining&&(trainStage===train||hooks.overlap===true);
   const ok=await timed(context,'train',()=>overlap?trainWithGeneration(context,{deadline:trainDeadline,trainStage,generate}):trainStage(context,{deadline:trainDeadline,trainedThroughSamples:pipeline.trainingSampleCount}));
   if(S.stopped(context.dir)||!ok)return false;
   const t=context.state.training;
   const unchanged=continuous&&t?.training?.selectedBaseline&&t?.training?.warmStartModelId&&t.training.initEvaluationScale===S.read(path.join(context.dir,'candidate.json'))?.scale&&['train','validation'].every(k=>Number.isFinite(t.diagnostics?.[k]?.maximumAbsoluteScoreChange)&&t.diagnostics[k].maximumAbsoluteScoreChange<.0001);
   if(unchanged){pipeline.stage='cycle-end';const decision={at:new Date().toISOString(),cycle:context.state.cycle,adopted:false,decision:'kept-current',reason:'독립 검증 오차가 개선되지 않아 이전 후보 함수를 유지하고 새 자료를 모읍니다. 대국 실력 향상은 확인되지 않았습니다.'};S.atomic(path.join(context.dir,'adoption.json'),decision);S.append(path.join(context.dir,'adoptions.jsonl'),decision);context.state.message=decision.reason;}
   else pipeline.stage='validate';S.save(context);
  }else if(pipeline.stage==='validate'){
   const result=await timed(context,'validate',()=>validate(context,{deadline}));
   if(S.stopped(context.dir)||!result.complete){const decision={at:new Date().toISOString(),cycle:context.state.cycle,modelId:result.candidateModelId,candidateHash:result.candidateHash,adopted:false,decision:'insufficient-evidence',reason:'평가가 미완료여서 기존 엔진을 유지합니다. 저장된 같은 대국을 재개합니다.',rejectionReasons:result.rejectionReasons};context.state.decisions=(context.state.decisions||[]).concat(decision).slice(-100);context.state.message=decision.reason;S.atomic(path.join(context.dir,'adoption.json'),decision);S.save(context);return false;}
   pipeline.stage='adopt';S.save(context);
  }else if(pipeline.stage==='adopt'){
   if(context.settings.autoAdopt)await timed(context,'adopt',()=>adoptStage(context));else{context.state.message='자동 채택을 끈 상태로 검증 결과를 보관합니다.';S.save(context);}
   pipeline.stage='cycle-end';S.save(context);
  }else if(pipeline.stage==='cycle-end'){
   if(!continuous&&context.state.counters.generatedGames>=total)return true;
   require('./storage.cjs').pruneDerived(context);context.state.cycle++;context.state.pipeline={stage:'analyze',target:nextTarget()};context.state.message='검증 결과를 보관하고 다음 새 경험을 누적합니다.';S.save(context);
  }else throw Error('Unknown pipeline stage '+pipeline.stage);
 }
 return false;
}
async function main(argv=process.argv.slice(2)){
 const args=parse(argv),dir=S.resolveRun(args.run),command=args.command;
 if(command==='help'||command==='--help'){console.log('Local no-API learning: init|import|analyze|generate|train|validate|adopt|cycle|stop|status --run=outputs/learning/default [--input=records.json] [--resume] [--games=100000 --workers=2 --minutes=60]. Search/data/games use CPU; neural training uses --device=cuda. Resume by re-running cycle --resume.');return;}
 if(command==='stop'){fs.mkdirSync(dir,{recursive:true});S.atomic(path.join(dir,'stop.flag'),'requested '+new Date().toISOString());console.log(JSON.stringify({status:'stop-requested',run:dir}));return;}
 if(command==='status'){console.log(JSON.stringify({run:dir,state:S.read(path.join(dir,'state.json')),settings:S.read(path.join(dir,'settings.json'))}));return;}
 require('./deployment.cjs').recoverDeployment();
 const fresh=!fs.existsSync(path.join(dir,'state.json')),given=options(args),context=S.init(dir,fresh?continuousProfile(given):given);validateSettings(context.settings);S.checkIdentity(context);require('./trial-ledger.cjs').reconcile(context);const release=S.lock(dir);if(args.resume&&fs.existsSync(path.join(dir,'stop.flag')))fs.unlinkSync(path.join(dir,'stop.flag'));if(args.resume)delete context.state.stopReason;S.atomic(path.join(dir,'settings.json'),context.settings);
 const os=require('node:os');try{os.setPriority(0,context.settings.priority==='below-normal'?os.constants.priority.PRIORITY_BELOW_NORMAL:os.constants.priority.PRIORITY_NORMAL);context.state.resources={priority:context.settings.priority,applied:true,workers:context.settings.workers,concurrentTraining:context.settings.concurrentTraining};}catch(error){context.state.resources={priority:context.settings.priority,applied:false,error:error.message};}S.save(context);
 const started=Date.now(),deadline=started+context.settings.minutes*60000;let complete=false;
 try{if(S.stopped(dir)){context.state.status='stopped';context.state.message='Stop requested; use --resume to continue';S.save(context);return;}
  const pending=S.read(path.join(dir,'continuation.json'));if(args['from-run']||pending&&!pending.complete){const continued=await timed(context,'import',()=>C.continueFrom(context,args['from-run']||pending.source));if(!continued.complete){context.state.status='stopped';context.state.message='경험 가져오기를 중단했습니다. 같은 실행을 재개하면 이어집니다.';S.save(context);return;}}
  if(command==='init'){importRecords(context,args.input,args);complete=true;}
  else if(command==='import'){importRecords(context,args.input,args);complete=true;}
  else if(command==='analyze'){importRecords(context,args.input,args);complete=await timed(context,'analyze',()=>G.analyzeRecords(context,{deadline}));}
  else if(command==='generate'){importRecords(context,args.input,args);complete=await timed(context,'generate',()=>G.generate(context,{deadline,target:context.settings.continuous?context.state.counters.generatedGames+context.settings.gamesPerCycle:context.settings.games}));}
  else if(command==='train'){if(!context.state.cycle)context.state.cycle=1;complete=await timed(context,'train',()=>train(context,{deadline}));}
  else if(command==='validate'){const r=await timed(context,'validate',()=>A.validate(context,{deadline}));complete=r.complete;}
  else if(command==='adopt'){await timed(context,'adopt',()=>adopt(context));complete=true;}
  else if(command==='cycle')complete=await cycle(context,args,deadline);
  else throw Error('Unknown command '+command);
  context.state.status=complete?'complete':'stopped';context.state.message=context.state.stopReason?.kind==='disk-budget'?context.state.stopReason.message:complete?'요청한 로컬 작업을 완료했습니다.':S.stopped(dir)?'Stopped by user; checkpoints retained':context.state.validation&&!context.state.validation.complete?'평가가 미완료라 기존 엔진을 유지합니다. 같은 run으로 저장된 평가를 재개하세요.':context.settings.continuous?'이번 실행 시간을 마쳤습니다. 경험은 누적 저장되어 같은 실행을 재개할 수 있습니다.':'Time/resource budget reached; resume with the same run';context.state.lastRun={command,startedAt:new Date(started).toISOString(),elapsedMs:Date.now()-started,complete};S.save(context);console.log(JSON.stringify({run:dir,status:context.state.status,phase:context.state.phase,counters:context.state.counters,validation:context.state.validation,adoption:context.state.adoptions.at(-1),elapsedMs:Date.now()-started}));
 }catch(e){if(e.code==='STOP_REQUESTED'||e.code==='DISK_BUDGET'){context.state.status='stopped';context.state.message=e.code==='DISK_BUDGET'?context.state.stopReason.message:'저장 후 중단했습니다. 같은 실험을 재개할 수 있습니다.';context.state.lastRun={command,startedAt:new Date(started).toISOString(),elapsedMs:Date.now()-started,complete:false};S.save(context);return;}context.state.status='failed';context.state.message=e.message;context.state.errors.push({at:new Date().toISOString(),phase:context.state.phase,error:e.message});context.state.errors=context.state.errors.slice(-100);S.append(path.join(dir,'errors.jsonl'),context.state.errors.at(-1));S.save(context);throw e;}finally{C.close(dir);J.close(dir);release();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
module.exports={parse,options,continuousProfile,validateSettings,normalizeLesson,importLessons,importRecords,snapshotData,train,trainWithGeneration,deployModel,adopt,cycle,main};
