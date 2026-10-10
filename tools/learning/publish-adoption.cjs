'use strict';
// Publishing is a read-only verification of a completed local adoption. It does
// not train, adopt, deploy, enumerate raw experience, stage Git files or push.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const S=require('./state.cjs'),A=require('./arena.cjs'),N=require('../../src/neural-evaluator.js');
const HASH=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/,ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const KEYS=['sourceHash','harnessHash','runtimeHash'];
const OUTPUT='artifacts/adopted-models',FILES=['model.json','evidence.json'];
const MAX_MODEL_BYTES=1024*1024,MAX_EVIDENCE_BYTES=64*1024;
const SETTINGS=['baselineCommit','rulesId','featureVersion','seed','moveMs','analysisMs','validationMs','workers','priority','concurrentTraining','games','pairs','minPairs','epochs','batchSize','minutes','stageMinutes','trainSeconds','maxSamples','maxDiskBytes','maxPlies','sampleEvery','exploration','device','autoAdopt','confidence','continuous','gamesPerCycle','minNewSamples','maxTrainingSamples','hiddenSize','scale','learningRate','familyBalance','earlyStopPatience','earlyStopMinDelta','minEpochs','diagnosticSamples','samplePolicy','selectionMinDelta','lossWeightNormalization','maxDerivedCycles','freshModel','poweredEvaluation','minimumUsefulImprovement','targetPower','maxEvaluationPairs'];
function inside(base,file){const relative=path.relative(base,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
function safePath(root,relative,{optional=false,directory=false}={}){
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe publication input/output path');
 const target=path.resolve(root,relative);if(!inside(root,target))throw Error('Publication path left repository');
 // Reject every existing link, including a parent junction and dangling links.
 let current=root;for(const part of relative.split(/[\\/]/)){current=path.join(current,part);let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT'&&optional)continue;throw error;}if(stat.isSymbolicLink())throw Error('Publication refuses symbolic links or junctions: '+relative);}
 if(!optional){const stat=fs.statSync(target);if(directory?!stat.isDirectory():!stat.isFile())throw Error('Publication input is not a regular '+(directory?'directory':'file'));}
 return target;
}
function read(root,relative,{optional=false,maxBytes=2*1024*1024}={}){
 const file=safePath(root,relative,{optional});if(!fs.existsSync(file))return null;
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>maxBytes)throw Error('Publication evidence file is not regular or exceeds read bound: '+relative);
 const bytes=fs.readFileSync(file);if(bytes.length>maxBytes)throw Error('Publication evidence grew beyond read bound');
 return {file,bytes,sha256:S.hash(bytes),value:JSON.parse(bytes.toString('utf8'))};
}
function assertHash(value,label){if(!HASH.test(value||''))throw Error('Missing or invalid '+label+' SHA-256');return value;}
function identity(value){
 if(value?.version!==2)throw Error('Publication requires complete version-2 execution identity');
 for(const key of KEYS)assertHash(value[key],key);
 const result={version:2,...Object.fromEntries(KEYS.map(key=>[key,value[key]]))};
 for(const key of ['sourceManifest','harnessManifest']){
  if(!Array.isArray(value[key])||!value[key].length)throw Error('Missing execution source manifest');
  const names=new Set();result[key]=value[key].map(row=>{if(typeof row.path!=='string'||!row.path.match(/^(?:src|tools|test)\/[A-Za-z0-9/._-]+$|^build\.cjs$/)||row.path.split('/').some(p=>p==='.'||p==='..')||names.has(row.path))throw Error('Unsafe or duplicate execution manifest path');names.add(row.path);return {path:row.path,sha256:assertHash(row.sha256,'manifest')};});
  if(S.hash(result[key])!==value[key==='sourceManifest'?'sourceHash':'harnessHash'])throw Error('Execution source manifest hash mismatch');
 }
 const runtime=value.runtimeManifest;if(!runtime||Object.keys(runtime).sort().join(',')!=='arch,node,platform,sqlite,v8'||Object.values(runtime).some(x=>x!==null&&(typeof x!=='string'||!x.match(/^[A-Za-z0-9._+-]{1,80}$/))))throw Error('Invalid native runtime manifest');
 result.runtimeManifest={...runtime};if(S.hash(runtime)!==value.runtimeHash)throw Error('Native runtime manifest hash mismatch');return result;
}
function sameIdentity(a,b){return KEYS.every(key=>a[key]===b[key]);}
function currentGitCommit(root){try{const head=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();return COMMIT.test(head)?head:null;}catch{return null;}}
function verifiedGitCommit(root,evaluation,head){
 if(!COMMIT.test(head||''))return null;
 try{for(const row of [...evaluation.sourceManifest,...evaluation.harnessManifest]){const bytes=cp.execFileSync('git',['show',head+':'+row.path],{cwd:root,windowsHide:true,maxBuffer:16*1024*1024,stdio:['ignore','pipe','ignore']});if(S.hash(bytes)!==row.sha256)return null;}return head;}catch{return null;}
}
function stableEvaluationCommit(root,evaluation,head){
 // A claimed code commit must contain the exact evaluated bytes. Documentation
 // and artifact-only commits do not create a different evaluation code version.
 if(!verifiedGitCommit(root,evaluation,head))throw Error('Evaluated engine/harness is not exactly reproducible from repository HEAD');
 const names=[...evaluation.sourceManifest,...evaluation.harnessManifest].map(row=>row.path);
 const revisions=cp.execFileSync('git',['log','-n','256','--format=%H','HEAD','--',...names],{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim().split('\n').filter(Boolean);
 for(const commit of revisions)if(verifiedGitCommit(root,evaluation,commit))return commit;
 throw Error('No exact evaluated source commit was found');
}
function baselineSourceHash(root,commit){
 const names=['search-memory','gpu-patterns','strategy-engine','reader-engine','forest-engine','unified-engine'];
 const sources=names.map(name=>cp.execFileSync('git',['show',commit+':src/'+name+'.js'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,stdio:['ignore','pipe','ignore']}));
 sources[3]=sources[3].replace('function createEngine(','function createReaderEngine(');return S.hash(sources.join('\n'));
}
function publicSettings(settings){
 const result={};for(const key of SETTINGS)if(Object.hasOwn(settings,key)){const value=settings[key];if(value!==null&&!['number','string','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&!/^[A-Za-z0-9._-]{1,120}$/.test(value))throw Error('Unsafe or non-reproducible setting: '+key);result[key]=value;}
 // Paths, credentials, arbitrary free text and raw import inputs are never exported.
 if(!Number.isSafeInteger(result.pairs)||result.pairs<1||!Number.isSafeInteger(result.minPairs)||result.minPairs<1||!(result.confidence>0&&result.confidence<1)||!(result.validationMs>0)||!Number.isSafeInteger(result.workers)||result.workers<1||result.workers>16)throw Error('Invalid evaluation settings');return result;
}
function publicModel(model){
 N.validate(model);const keys=['schemaVersion','kind','rulesId','featureVersion','inputSize','hiddenSize','activation','outputActivation','modelId','scale'];
 const result=Object.fromEntries(keys.map(key=>[key,model[key]]));result.normalization={mean:model.normalization.mean.slice(),scale:model.normalization.scale.slice()};result.layers=model.layers.map(layer=>({weights:layer.weights.map(row=>row.slice()),bias:layer.bias.slice()}));N.validate(result);return result;
}
function adoptionRun(root,logicalDir){
 const runs=path.join(root,'outputs/learning/runs'),runId=path.basename(logicalDir),relative=path.relative(root,logicalDir).split(path.sep).join('/');
 if(!inside(path.join(root,'outputs/learning'),logicalDir)||!ID.test(runId))throw Error('Adoption run is outside local experiment storage');
 const stat=fs.lstatSync(logicalDir);if(!stat.isSymbolicLink()){safePath(root,relative,{directory:true});return {logicalDir,dir:logicalDir,relative,runId};}
 if(path.dirname(logicalDir)!==runs)throw Error('Adoption dependency bridge is outside registered experiment storage');
 // Retention bridges preserve recorded provenance paths. No other link is a
 // publication input: registration, completed receipt, bounds and bytes agree.
 const registry=read(root,'outputs/learning/runs/.run-retention-aliases.json'),value=registry.value;
 if(value.schemaVersion!==1||!value.aliases||!Object.hasOwn(value.aliases,runId))throw Error('Adoption dependency bridge is not registered');
 const receipt=value.aliases[runId],tx=receipt?.transactionId;
 if(typeof tx!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(tx))throw Error('Invalid registered adoption dependency transaction');
 const physical=path.join(runs,'.dependencies',tx,'run'),manifestFile=path.join(runs,'.dependencies',tx,'manifest.json');
 if(receipt.destination!==physical||receipt.manifest!==manifestFile)throw Error('Registered adoption dependency escaped storage');
 const manifest=read(root,path.relative(root,manifestFile).split(path.sep).join('/')),m=manifest.value;
 if(m.schemaVersion!==1||m.kind!=='dependency'||m.status!=='completed'||m.transactionId!==tx||m.id!==runId||m.runsRoot!==runs||m.originalPath!==logicalDir||m.destination!==physical||!Number.isSafeInteger(m.bytes)||m.bytes<0)throw Error('Invalid or unfinished adopted dependency retention manifest');
 const physicalRelative=path.relative(root,physical).split(path.sep).join('/');safePath(root,physicalRelative,{directory:true});
 if(fs.realpathSync(logicalDir)!==physical)throw Error('Adoption dependency bridge target changed');
 const identityFiles={};for(const name of ['state.json','settings.json','dashboard.json','continuation.json','temporal-exposures-lineage.json']){const file=safePath(root,physicalRelative+'/'+name,{optional:true});if(fs.existsSync(file))identityFiles[name]=S.fileHash(file);}
 if(S.hash(identityFiles)!==S.hash(m.identityFiles))throw Error('Preserved adopted dependency metadata hashes changed');
 return {logicalDir,dir:physical,relative:physicalRelative,runId,alias:{registrySha256:registry.sha256,manifestSha256:manifest.sha256,registryFile:registry.file,manifestFile:manifest.file}};
}
function immutableArena(arena){return [arena.candidateHash,arena.settingsHash,arena.identity,arena.baselineCommit,arena.rulesId,arena.incumbentHash,arena.lessonHash,arena.datasetSha256,arena.moveMs,arena.pairs,arena.games.map(g=>[g.id,g.pairId,g.familyId,g.candidateFirst,g.candidateColor,g.firstPlayer,g.opponent,g.source,g.opening])];}
function verifyTrial(root,arena){
 if(!HASH.test(arena.budget?.reservation||'')||!Number.isSafeInteger(arena.trial)||arena.trial<1)throw Error('Missing durable adoption trial reservation');
 const file=safePath(root,'outputs/learning/evaluation-ledger.sqlite');if(path.resolve(arena.budget.ledger||'')!==file)throw Error('Adoption trial ledger path differs from the shared local ledger');
 const db=new DatabaseSync(file,{readOnly:true});try{const row=db.prepare('SELECT trial,arena FROM trials WHERE reservation=?').get(arena.budget.reservation);if(!row||Number(row.trial)!==arena.trial||S.hash(immutableArena(JSON.parse(row.arena)))!==S.hash(immutableArena(arena)))throw Error('Adoption durable reservation/context mismatch');}finally{db.close();}
}
function verifyExecution(accepted,evaluation,{identityProvider=S.sourceIdentity,receiptDirectory}={}){
 const now=identity(identityProvider());let audit=null;
 if(!sameIdentity(evaluation,now)){
  const original=accepted.adoption.operationalCompatibilityAudit;
  if(!original||!sameIdentity(original.evaluationIdentity||{},evaluation)||!sameIdentity(original.deliveryIdentity||{},now))throw Error('Adoption engine/harness/native runtime changed; publication requires fresh verified adoption');
  audit=require('./archive.cjs').assertDeliverySource({identity:evaluation},{identityProvider:()=>now,...(receiptDirectory?{receiptDirectory}:{})});
  if(!audit||S.hash(audit)!==S.hash(original))throw Error('Adoption operational compatibility receipt changed');
 }
 return {now,audit};
}
function verify({root=S.ROOT,identityProvider=S.sourceIdentity,receiptDirectory}={}){
 root=path.resolve(root);if(fs.realpathSync(root)!==root)throw Error('Publication repository root must be a real directory');
 const active=read(root,'src/active-model.json',{optional:true});
 if(!active)return {skipped:true,reason:'no-adopted-model',files:[]};
 const accepted=active.value;if(accepted.adoption?.accepted!==true)throw Error('Active model is not a verified adopted candidate');N.validate(accepted);
 const adoption=accepted.adoption,logicalRunDir=path.resolve(adoption.exposure?.runDir||''),resolvedRun=adoptionRun(root,logicalRunDir),runDir=resolvedRun.dir,runRelative=resolvedRun.relative;
 const state=read(root,runRelative+'/state.json'),settingsInput=read(root,runRelative+'/settings.json');
 if(!ID.test(state.value.runId||'')||state.value.runId!==resolvedRun.runId)throw Error('Adoption run identifier mismatch');
 const settings=publicSettings(settingsInput.value),storedModel=read(root,runRelative+'/models/'+accepted.modelId+'.json');if(storedModel.sha256!==active.sha256)throw Error('Active and preserved adopted model bytes differ');
 const journalPath=safePath(root,runRelative+'/adoptions.jsonl'),journalBytes=fs.readFileSync(journalPath);if(journalBytes.length>2*1024*1024)throw Error('Adoption decision journal exceeds read bound');
 const entries=journalBytes.toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const matching=entry=>entry.adopted===true&&entry.decision==='accepted'&&entry.at===adoption.at&&entry.modelId===accepted.modelId&&entry.candidateHash===S.hash(Object.fromEntries(Object.entries(accepted).filter(([key])=>key!=='adoption')));
 const found=entries.filter(matching),persisted=(state.value.adoptions||[]).filter(matching);if(found.length!==1||persisted.length!==1||S.hash(found[0])!==S.hash(persisted[0]))throw Error('Adopted candidate decision is missing, ambiguous or differs between durable records');
 const entry=found[0];if(!Number.isSafeInteger(entry.cycle)||entry.cycle<1||entry.arena!=='arena-cycle-'+entry.cycle+'.json'||!Number.isFinite(Date.parse(entry.at)))throw Error('Invalid adopted cycle or timestamp');
 const arenaInput=read(root,runRelative+'/'+entry.arena,{maxBytes:256*1024*1024}),arena=arenaInput.value;
 if(adoption.validationHash!==S.hash(arena)||arena.candidateHash!==entry.candidateHash||arena.candidateModelId!==accepted.modelId||arena.complete!==true||arena.passed!==true||arena.controlsPresent!==true||!Array.isArray(arena.rejectionReasons)||arena.rejectionReasons.length||!Array.isArray(arena.invalidGames)||arena.invalidGames.length)throw Error('Adoption evaluation is missing, changed, rejected or incomplete');
 const evaluation=identity(arena.identity);if(!sameIdentity(evaluation,adoption)||!sameIdentity(evaluation,state.value.identity||{}))throw Error('Adoption/run/evaluation identities differ');
 const execution=verifyExecution(accepted,evaluation,{identityProvider,receiptDirectory});
 if(arena.rulesId!==accepted.rulesId||arena.rulesId!==settings.rulesId||!COMMIT.test(arena.baselineCommit||'')||arena.baselineCommit!==state.value.baselineCommit||arena.baselineCommit!==adoption.baselineCommit||arena.baselineCommit!==settings.baselineCommit)throw Error('Adoption rules or comparison baseline mismatch');
 if(baselineSourceHash(root,arena.baselineCommit)!==state.value.baselineSourceHash)throw Error('Historical baseline source is not reproducible from its comparison commit');
 if(arena.settingsHash!==A.evaluationSettingsHash(settings)||arena.moveMs!==settings.validationMs)throw Error('Adoption evaluation settings changed');
 const opponents=arena.incumbentHash?['baseline','incumbent']:['baseline','current-no-model'];if(arena.incumbentHash)assertHash(arena.incumbentHash,'incumbent');
 const design=A.evaluationDesign(settings,arena.trial,opponents.length);if(arena.pairs!==design.pairs||settings.poweredEvaluation&&S.hash(arena.evaluationDesign)!==S.hash(design)||!Array.isArray(arena.games)||arena.games.length!==design.pairs*2*opponents.length)throw Error('Adoption paired evaluation sample design/count mismatch');
 const gameIds=new Set();for(const game of arena.games){if(!ID.test(game.id||'')||gameIds.has(game.id)||!game.completed||game.invalid||!opponents.includes(game.opponent)||typeof game.candidateFirst!=='boolean'||![1,2].includes(game.candidateColor)||game.candidateColor!==(game.candidateFirst?game.firstPlayer:3-game.firstPlayer))throw Error('Adoption evaluation game is duplicate, invalid or incomplete');gameIds.add(game.id);A.verifyArenaGame(game);}
 const families=new Map();for(const game of arena.games){if(!ID.test(game.familyId||'')||!ID.test(game.pairId||''))throw Error('Invalid paired opening identity');const rows=families.get(game.familyId)||[];rows.push(game);families.set(game.familyId,rows);}
 if(families.size!==design.pairs)throw Error('Adoption opening-family count differs from its sample design');
 for(const rows of families.values()){
  if(rows.length!==opponents.length*2||rows.some(game=>game.firstPlayer!==rows[0].firstPlayer||S.hash(game.opening)!==S.hash(rows[0].opening)))throw Error('Adoption paired controls do not use identical openings/first player');
  for(const opponent of opponents){const paired=rows.filter(game=>game.opponent===opponent);if(paired.length!==2||new Set(paired.map(game=>game.candidateFirst)).size!==2||paired[0].pairId!==paired[1].pairId)throw Error('Adoption paired control color swap is missing or mismatched');}
 }
 const stats={};for(const opponent of opponents){const games=arena.games.filter(game=>game.opponent===opponent),computed=A.pairedStats(games,{minPairs:settings.minPairs,confidence:settings.confidence,trial:arena.trial});if(games.length!==design.pairs*2||computed.independentFamilies!==design.pairs||!computed.passed||S.hash(computed)!==S.hash(arena.stats?.[opponent])||S.hash(computed)!==S.hash(adoption.stats?.[opponent]))throw Error('Recomputed adoption strength evidence failed against '+opponent);stats[opponent]=computed;}
 if(Object.keys(arena.stats||{}).sort().join(',')!==opponents.slice().sort().join(',')||S.hash(adoption.criteria)!==S.hash({minPairs:settings.minPairs,confidence:settings.confidence,method:stats.baseline.method}))throw Error('Adoption decision criteria/control set changed');
 verifyTrial(root,arena);
 const candidate=Object.fromEntries(Object.entries(accepted).filter(([key])=>key!=='adoption')),training=A.trainingEvidence(candidate,arena.trainingEvidence,arena.datasetSha256);
 if(!training.passed||S.hash(arena.trainingCheck)!==S.hash(training)||arena.rules?.passed!==true||!(arena.rules.checks>0)||!Array.isArray(arena.rules.errors)||arena.rules.errors.length||arena.parity?.passed!==true||!(arena.parity.cases>0)||!Number.isFinite(arena.parity.maxAbsoluteError)||arena.parity.maxAbsoluteError<0||arena.parity.maxAbsoluteError>1e-5||!Number.isFinite(arena.parity.effectiveMaxAbsoluteError)||arena.parity.effectiveMaxAbsoluteError<0||arena.parity.effectiveMaxAbsoluteError>1e-5||arena.parity.modelId!==accepted.modelId||arena.exclusions?.version!==2)throw Error('Adoption training, rules, parity or cumulative-exclusion evidence failed');
 if(arena.execution?.schedule!=='parallel-arena-v1'||arena.execution.configuredWorkers!==settings.workers||arena.execution.moveMs!==settings.validationMs)throw Error('Adoption evaluation execution settings mismatch');
 for(const opponent of opponents){const row=arena.opponentEvidence?.[opponent];if(row?.sourceHash!==(opponent==='baseline'?state.value.baselineSourceHash:evaluation.sourceHash)||row.modelHash!==(opponent==='incumbent'?arena.incumbentHash:null)||row.modelExplicitlyNull!==(opponent!=='incumbent')||row.moveMs!==arena.moveMs||row.optimized!==true||row.lessonHash!==arena.lessonHash)throw Error('Adoption comparator source/model evidence mismatch');}
 if(arena.incumbentHash&&S.hash(arena.incumbent)!==arena.incumbentHash)throw Error('Adoption incumbent comparison model changed');
 const dataset=safePath(root,runRelative+'/datasets/cycle-'+entry.cycle+'.jsonl');if(S.fileHash(dataset)!==assertHash(arena.datasetSha256,'dataset')||adoption.datasetSha256!==arena.datasetSha256)throw Error('Adoption training dataset bytes changed');
 if(adoption.exposure.file!=='models/'+accepted.modelId+'.exposures.jsonl'||S.fileHash(safePath(root,runRelative+'/'+adoption.exposure.file))!==assertHash(adoption.exposure.sha256,'exposure'))throw Error('Preserved adopted exposure lineage bytes changed');
 const transaction=read(root,'work/local-learning-20261007/deployment/transaction.json').value;
 if(transaction.schemaVersion!==2||transaction.status!=='committed'||transaction.root!==root||transaction.transactionId!==entry.transactionId||entry.delivery?.transactionId!==entry.transactionId||!HASH.test(entry.transactionId||'')||!sameIdentity(transaction.identity||{},evaluation)||!sameIdentity(entry.delivery?.identity||{},evaluation))throw Error('Adoption deployment did not durably commit or changed');
 for(const [file,sha256]of [[active.file,active.sha256],[path.join(logicalRunDir,'models/'+accepted.modelId+'.json'),storedModel.sha256],[path.join(logicalRunDir,'adoption.json'),S.hash(JSON.stringify(entry,null,2))]]){const targets=(transaction.targets||[]).filter(row=>row.file===file);if(targets.length!==1||targets[0].sha256!==sha256)throw Error('Adoption committed deployment target/hash mismatch');}
 const model=publicModel(accepted),modelText=JSON.stringify(model,null,2)+'\n',artifactHash=S.hash(modelText),head=currentGitCommit(root),evaluationCommit=stableEvaluationCommit(root,evaluation,head);
 const evidence={schemaVersion:1,kind:'forest-omok-verified-adoption',runId:state.value.runId,cycle:entry.cycle,adoptedAt:entry.at,modelId:accepted.modelId,accepted:true,transactionId:entry.transactionId,code:{evaluation,publication:execution.now,verifiedEvaluationGitCommit:evaluationCommit,...(execution.audit?{operationalCompatibility:{receiptId:execution.audit.receiptId,receiptSha256:execution.audit.receiptSha256,changes:execution.audit.changes}}:{})},settings,settingsHash:arena.settingsHash,comparison:{baselineCommit:arena.baselineCommit,baselineSourceHash:assertHash(state.value.baselineSourceHash,'historical baseline'),incumbentHash:arena.incumbentHash,opponents,moveMs:arena.moveMs,schedule:arena.execution.schedule},validation:{trial:arena.trial,completedGames:arena.games.length,independentFamiliesPerOpponent:arena.pairs,stats,criteria:{...adoption.criteria,lowerConfidenceBoundStrictlyGreaterThan:.5},complete:true,passed:true,rules:{passed:true,checks:arena.rules.checks},parity:{passed:true,cases:arena.parity.cases,maxAbsoluteError:arena.parity.maxAbsoluteError,effectiveMaxAbsoluteError:arena.parity.effectiveMaxAbsoluteError},training:{passed:true,updates:training.updates,trainedOnCuda:training.trainedOnCuda},exclusions:{version:2,sha256:S.hash(arena.exclusions)},reservationHash:arena.budget.reservation},hashes:{artifactSha256:artifactHash,localAcceptedModelSha256:active.sha256,candidateSemanticHash:entry.candidateHash,arenaSemanticHash:adoption.validationHash,arenaFileSha256:arenaInput.sha256,settingsFileSha256:settingsInput.sha256,datasetSha256:arena.datasetSha256,exposureSha256:adoption.exposure.sha256},scope:'Only the adopted inference model and bounded validation summary are published. Local games, experience databases, checkpoints, candidate history and raw exposure records remain local.'};
 const evidenceText=JSON.stringify(evidence,null,2)+'\n';if(Buffer.byteLength(modelText)>MAX_MODEL_BYTES||Buffer.byteLength(evidenceText)>MAX_EVIDENCE_BYTES)throw Error('Adoption publication exceeds lightweight artifact/evidence bound');
 // Check an immutable binding once more after potentially long replay/hash reads.
 if(S.fileHash(active.file)!==active.sha256||S.fileHash(storedModel.file)!==storedModel.sha256||S.fileHash(arenaInput.file)!==arenaInput.sha256||!sameIdentity(execution.now,identity(identityProvider())))throw Error('Adoption evidence or execution identity changed while preparing publication');
 if(resolvedRun.alias&&(S.fileHash(resolvedRun.alias.registryFile)!==resolvedRun.alias.registrySha256||S.fileHash(resolvedRun.alias.manifestFile)!==resolvedRun.alias.manifestSha256||adoptionRun(root,logicalRunDir).dir!==runDir))throw Error('Registered adoption dependency changed while preparing publication');
 return {skipped:false,root,artifactHash,modelSha256:artifactHash,evidenceSha256:S.hash(evidenceText),modelText,evidenceText,runId:evidence.runId,modelId:accepted.modelId,relativeDirectory:OUTPUT+'/'+artifactHash,files:FILES.map(name=>OUTPUT+'/'+artifactHash+'/'+name),evidence};
}
function verifyBundle(root,relativeDirectory,expected){
 const dir=safePath(root,relativeDirectory,{directory:true}),names=fs.readdirSync(dir).sort();if(names.join(',')!==FILES.slice().sort().join(','))throw Error('Adoption publication directory contains unexpected files');
 const model=read(root,relativeDirectory+'/model.json'),evidence=read(root,relativeDirectory+'/evidence.json',{maxBytes:64*1024});
 if(model.sha256!==(expected?.artifactHash||path.basename(dir))||evidence.value.hashes?.artifactSha256!==model.sha256||evidence.value.accepted!==true||evidence.value.kind!=='forest-omok-verified-adoption')throw Error('Adoption publication model/evidence hash mismatch');
 if(expected&&(model.bytes.toString('utf8')!==expected.modelText||evidence.bytes.toString('utf8')!==expected.evidenceText))throw Error('Existing adoption publication is stale or changed');return {modelSha256:model.sha256,evidenceSha256:evidence.sha256};
}
function prepare(options={}){
 const checked=verify(options);if(checked.skipped)return checked;const root=checked.root,directory=safePath(root,checked.relativeDirectory,{optional:true});
 if(fs.existsSync(directory)){const hashes=verifyBundle(root,checked.relativeDirectory,checked);return {skipped:true,reason:'adoption-already-prepared',artifactHash:checked.artifactHash,runId:checked.runId,modelId:checked.modelId,files:checked.files,...hashes};}
 const parent=safePath(root,OUTPUT,{optional:true});fs.mkdirSync(parent,{recursive:true});safePath(root,OUTPUT,{directory:true});
 const temporary=fs.mkdtempSync(path.join(parent,'.prepare-'));try{for(const [name,text]of [['model.json',checked.modelText],['evidence.json',checked.evidenceText]]){const fd=fs.openSync(path.join(temporary,name),'wx');try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  verifyBundle(root,path.relative(root,temporary).split(path.sep).join('/'),checked);
  // Source verification is repeated immediately before the atomic publication.
  const again=verify(options);if(again.skipped||again.modelText!==checked.modelText||again.evidenceText!==checked.evidenceText)throw Error('Adoption changed before publication');
  try{fs.renameSync(temporary,directory);}catch(error){if(!fs.existsSync(directory))throw error;verifyBundle(root,checked.relativeDirectory,checked);}
 }finally{if(fs.existsSync(temporary)){for(const name of FILES){const file=path.join(temporary,name);if(fs.existsSync(file)){if(!fs.lstatSync(file).isFile())throw Error('Publication temporary file is unsafe; preserve for investigation');fs.unlinkSync(file);}}fs.rmdirSync(temporary);}}
 const hashes=verifyBundle(root,checked.relativeDirectory,checked);return {skipped:false,reason:'verified-adoption-prepared',artifactHash:checked.artifactHash,runId:checked.runId,modelId:checked.modelId,files:checked.files,...hashes};
}
function check(options={}){const checked=verify(options);if(checked.skipped)return checked;const hashes=verifyBundle(checked.root,checked.relativeDirectory,checked);return {skipped:false,reason:'verified-adoption-publication',artifactHash:checked.artifactHash,runId:checked.runId,modelId:checked.modelId,files:checked.files,...hashes};}
if(require.main===module){try{const mode=process.argv[2]||'prepare';if(process.argv.length>3||!['prepare','check'].includes(mode))throw Error('Usage: node tools/learning/publish-adoption.cjs prepare|check');console.log(JSON.stringify(mode==='prepare'?prepare():check()));}catch(error){console.error(error.stack||error);process.exitCode=1;}}
module.exports={OUTPUT,FILES,SETTINGS,MAX_MODEL_BYTES,MAX_EVIDENCE_BYTES,verify,prepare,check,verifyBundle};
