'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const S=require('../tools/learning/state.cjs'),P=require('../tools/learning/experiment-plan.cjs'),D=require('../tools/learning/adoption-diagnose.cjs');
fs.mkdirSync(path.join(S.ROOT,'work'),{recursive:true});
const root=fs.mkdtempSync(path.join(S.ROOT,'work/adoption-diagnose-contract-')),runDir=path.join(root,'run'),ledgerFile=path.join(root,'shared.sqlite');
fs.mkdirSync(runDir);const write=(name,value)=>fs.writeFileSync(path.join(runDir,name),JSON.stringify(value));
const checks=[];function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
const hash='a'.repeat(64),historicalHash='b'.repeat(64),lessonHash='c'.repeat(64);
const db=new DatabaseSync(ledgerFile);
db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value INTEGER NOT NULL);CREATE TABLE trials(reservation TEXT PRIMARY KEY,trial INTEGER UNIQUE NOT NULL,arena TEXT NOT NULL);CREATE TABLE families(id TEXT PRIMARY KEY,reservation TEXT NOT NULL);CREATE TABLE legacy_arenas(id TEXT PRIMARY KEY,trial INTEGER NOT NULL);');
db.prepare('INSERT INTO metadata VALUES(?,?)').run('highwater',67);db.prepare('INSERT INTO trials VALUES(?,?,?)').run('reserved',67,'{}');db.close();
const settings={pairs:64,minPairs:32,confidence:.95,workers:10,validationMs:1000,epochs:20};
write('state.json',{runId:'fixture',cycle:80,trial:67,status:'stopped'});write('settings.json',settings);
write('adoption.json',{at:'2026-10-09T15:08:07Z',cycle:80,adopted:false,decision:'kept-current',reason:'Validation did not improve; previous function retained'});
write('candidate.json.training.json',{status:'interrupted',stopReason:'time-limit',modelId:'candidate-80',checkpoint:'checkpoints/cycle-80.pt',dataset:'datasets/cycle-80.jsonl',training:{selectedBaseline:true,bestEpoch:0,epochsCompleted:8,minEpochs:10,exportUsesTrainedEpoch:false},diagnostics:{train:{maximumAbsoluteScoreChange:0},validation:{maximumAbsoluteScoreChange:0}}});
function summary(cycle,{trial=cycle,wins=68,reasons=['conservative strength threshold not met against baseline'],complete=true,passed=false,invalidGames=[]}={}){
 const planning=P.planningRequirements({trial,pairs:64}),meanScore=wins/128,lowerConfidenceBound=Math.max(0,meanScore-planning.configured.radius);
 const stats={wins,draws:0,losses:128-wins,unfinished:0,completedGames:128,completedPairs:64,independentFamilies:64,meanScore,lowerConfidenceBound,alpha:planning.alpha,minPairs:32,passed:lowerConfidenceBound>.5};
 return {schemaVersion:1,cycle,trial,candidateHash:hash,candidateModelId:'candidate-'+cycle,identity:{sourceHash:hash,harnessHash:hash,runtimeHash:hash},baselineCommit:'0c652e8',incumbentHash:null,opponents:['baseline','current-no-model'],opponentEvidence:{baseline:{sourceHash:historicalHash,modelHash:null,modelExplicitlyNull:true,lessonHash,moveMs:1000,optimized:true},'current-no-model':{sourceHash:hash,modelHash:null,modelExplicitlyNull:true,lessonHash,moveMs:1000,optimized:true}},pairs:64,moveMs:1000,stats:{baseline:stats,'current-no-model':{...stats}},planning:{confidence:.95,minPairs:32},complete,passed,controlsPresent:true,invalidGames,rejectionReasons:reasons};
}
write('arena-cycle-1.summary.json',summary(1,{wins:128,passed:true,reasons:[]}));
write('arena-cycle-2.summary.json',summary(2,{reasons:['JS/Python model parity missing or failed']}));
write('arena-cycle-3.summary.json',summary(3,{reasons:['rule/tactical audit failed']}));
write('arena-cycle-4.summary.json',summary(4,{complete:false,reasons:['evaluation games unfinished']}));
write('arena-cycle-5.summary.json',summary(5,{invalidGames:[{id:'bad',error:'invalid-terminal-replay'}],reasons:['invalid played game']}));
const missingControl=summary(6);delete missingControl.opponentEvidence['current-no-model'];write('arena-cycle-6.summary.json',missingControl);
const missingIdentity=summary(7);delete missingIdentity.identity;write('arena-cycle-7.summary.json',missingIdentity);
const malformed=summary(8);malformed.stats.baseline.meanScore=NaN;write('arena-cycle-8.summary.json',malformed);
write('arena-cycle-70.summary.json',summary(70,{trial:67}));
write('arena.summary.json',summary(70,{trial:67})); // Alias must not duplicate trial 67.
const oversized=path.join(runDir,'arena-cycle-71.summary.json');fs.writeFileSync(oversized,Buffer.alloc(D.MAX_JSON_BYTES+1,32));
fs.writeFileSync(path.join(runDir,'arena-cycle-72.summary.json'),'{');
function snapshot(){const files=fs.readdirSync(runDir).sort().map(name=>[name,S.fileHash(path.join(runDir,name))]);return {files,ledger:S.fileHash(ledgerFile),parent:fs.readdirSync(root).sort()};}
const before=snapshot();let report;
check('read all bounded cycle summaries and preserve original files and shared ledger',()=>{
 report=D.diagnoseAdoption({runDir,ledgerFile});assert.deepEqual(snapshot(),before);assert.equal(report.inputsUnchanged,true);assert.equal(report.counts.preservedSummaries,11);assert.equal(report.counts.completedAccepted,1);assert.equal(report.counts.completedRejected,7);assert.equal(report.counts.incomplete,3);assert.equal(report.counts.scoreEligible,4);assert.equal(report.counts.scoreSuppressed,7);assert.equal(P.readLedger(ledgerFile).highwater,67);assert.equal(report.ledger.nextTrial,68);assert.equal(report.nextTrialPlan.reservationCreated,false);
});
check('newer kept-current decision and baseline selection are separate from old strength result',()=>{
 assert.equal(report.currentDecision.cycle,80);assert.equal(report.latestArenaCycle,70);assert.equal(report.currentDecision.newerThanLatestArena,true);assert.equal(report.training.sameCycleAsCurrentDecision,true);assert.equal(report.training.selectedBaseline,true);assert.equal(report.training.epochsCompleted,8);assert.equal(report.training.minEpochs,10);assert.equal(report.training.configuredEpochs,20);assert.equal(report.training.reachedMinEpochs,false);assert.equal(report.training.timeLimitedBeforeMinEpochs,true);assert.equal(report.training.preservedOnDiagnosticSamples,true);assert(report.nextSteps.some(x=>/does not guarantee/.test(x)));assert.match(report.training.scope,/do not prove/);
});
check('expose separate trial/control scores and rejection reasons without pooled significance',()=>{
 assert.deepEqual(report.arenas.find(x=>x.cycle===2).rejectionCategories,['model-parity']);assert.deepEqual(report.arenas.find(x=>x.cycle===3).rejectionCategories,['rule-audit']);const latest=report.arenas.find(x=>x.cycle===70);assert.equal(latest.controls.length,2);assert.equal(latest.controls[0].meanScore,68/128);assert.equal(latest.trial,67);assert.equal(latest.candidateModelId,'candidate-70');assert.match(report.interpretation,/No pooled significance/);assert.equal(Object.hasOwn(report,'pooledScore'),false);
});
check('partial invalid missing-control/identity malformed and oversized evidence hide every score',()=>{
 for(const cycle of [4,5,6,7,8]){const row=report.arenas.find(x=>x.cycle===cycle);assert.equal(row.scoresAvailable,false);assert.deepEqual(row.controls,[]);assert.equal(Object.hasOwn(row,'meanScore'),false);assert(row.scoresSuppressedReasons.length);}
 const huge=report.arenas.find(x=>x.file===oversized);assert.equal(huge.available,false);assert.deepEqual(huge.scoresSuppressedReasons,['size-limit-exceeded']);assert.equal(huge.cycle,null);assert.equal(report.inputs.find(x=>x.file===oversized).sha256,undefined);
 assert(report.arenas.find(x=>x.file.endsWith('arena-cycle-72.summary.json')).scoresSuppressedReasons.includes('invalid-json'));
 assert.deepEqual(report.newerUnreadableArenaFiles.map(row=>row.filenameCycle),[71,72]);
});
check('historical gate uses recorded trial and next plan certifies conditional power separately',()=>{
 const latest=P.planningRequirements({trial:67,pairs:64}),next=P.planningRequirements({...settings,trial:68,moveMs:1000,minimumUsefulImprovement:.1,targetPower:.8,opponents:2});
 assert.equal(report.latestGate.requiredObservedMeanStrictlyGreaterThan,latest.configured.requiredObservedMeanStrictlyGreaterThan);assert.equal(report.latestGate.trial,67);assert.equal(report.nextTrialPlan.trial,68);assert.equal(report.nextTrialPlan.conditionalPower.families,next.conditionalPower.families);assert(report.nextTrialPlan.conditionalPower.families>report.nextTrialPlan.boundCrossing.families);assert(report.nextTrialPlan.conditionalPower.guaranteedFullGatePowerLowerBound>.8);assert.equal(report.nextTrialPlan.configured.conditionalFullGatePowerLowerBound,0);assert.equal(report.nextTrialPlan.promotionGate.lowerBoundStrictlyGreaterThan,.5);assert.match(report.nextTrialPlan.conditionalPower.scope,/not estimated actual power/);
});
check('missing shared ledger remains unavailable and never becomes trial zero or a new DB',()=>{
 const missing=path.join(root,'missing.sqlite'),diagnostic=D.diagnoseAdoption({runDir,ledgerFile:missing});assert.equal(diagnostic.ledger.available,false);assert.equal(diagnostic.ledger.nextTrial,null);assert.match(diagnostic.ledger.error,/never assume trial zero/);assert.equal(diagnostic.nextTrialPlan.available,false);assert(!fs.existsSync(missing));assert.equal(Object.hasOwn(diagnostic.ledger,'highwater'),false);assert.deepEqual(snapshot(),before);
});
check('historical confidence unavailable stays unknown rather than borrowed from current settings',()=>{
 const file=path.join(runDir,'arena-cycle-70.summary.json'),original=fs.readFileSync(file),row=JSON.parse(original);delete row.planning.confidence;fs.writeFileSync(file,JSON.stringify(row));try{const diagnostic=D.diagnoseAdoption({runDir,ledgerFile});assert.equal(diagnostic.latestGate.available,false);assert.match(diagnostic.latestGate.reason,/current settings cannot replace/);}finally{fs.writeFileSync(file,original);}
});
check('WAL-mode source without sidecars gets no files created by SQLite diagnosis',()=>{
 const fixture=path.join(root,'wal-source.sqlite');fs.copyFileSync(ledgerFile,fixture);const connection=new DatabaseSync(fixture);connection.exec('PRAGMA journal_mode=WAL');connection.close();
 assert(!fs.existsSync(fixture+'-wal'));assert(!fs.existsSync(fixture+'-shm'));const hashBefore=S.fileHash(fixture),diagnostic=D.diagnoseAdoption({runDir,ledgerFile:fixture});assert.equal(diagnostic.ledger.highwater,67);assert.equal(S.fileHash(fixture),hashBefore);assert(!fs.existsSync(fixture+'-wal'));assert(!fs.existsSync(fixture+'-shm'));assert.match(diagnostic.ledger.access,/source database never opened/);
});
check('committed WAL frames are included without changing source database or WAL/SHM bytes',()=>{
 const fixture=path.join(root,'live-wal-source.sqlite');fs.copyFileSync(ledgerFile,fixture);const connection=new DatabaseSync(fixture);connection.exec('PRAGMA journal_mode=WAL');connection.prepare("UPDATE metadata SET value=68 WHERE key='highwater'").run();
 try{const originals=['','-wal','-shm'].map(suffix=>[fixture+suffix,S.fileHash(fixture+suffix)]),diagnostic=D.diagnoseAdoption({runDir,ledgerFile:fixture});assert.equal(diagnostic.ledger.highwater,68);assert.equal(diagnostic.ledger.nextTrial,69);for(const [file,digest]of originals)assert.equal(S.fileHash(file),digest,file);}finally{connection.close();}
});
check('missing current configuration never becomes an invented next-trial plan',()=>{
 const file=path.join(runDir,'settings.json'),original=fs.readFileSync(file);fs.writeFileSync(file,'{}');try{const diagnostic=D.diagnoseAdoption({runDir,ledgerFile});assert.equal(diagnostic.ledger.available,true);assert.equal(diagnostic.nextTrialPlan.available,false);assert.match(diagnostic.nextTrialPlan.reason,/cannot invent/);}finally{fs.writeFileSync(file,original);}
});
check('recorded improvement and power guide the next sample unless explicitly overridden',()=>{
 const file=path.join(runDir,'settings.json'),original=fs.readFileSync(file);fs.writeFileSync(file,JSON.stringify({...settings,minimumUsefulImprovement:.05,targetPower:.9}));
 try{const recorded=D.diagnoseAdoption({runDir,ledgerFile});assert.equal(recorded.nextTrialPlan.minimumUsefulImprovement,.05);assert.equal(recorded.nextTrialPlan.targetPower,.9);const expected=P.planningRequirements({trial:68,pairs:64,minimumUsefulImprovement:.05,targetPower:.9});assert.equal(recorded.nextTrialPlan.conditionalPower.families,expected.conditionalPower.families);assert(recorded.nextTrialPlan.conditionalPower.families>report.nextTrialPlan.conditionalPower.families);
  const cli=path.join(S.ROOT,'tools/learning/adoption-diagnose.cjs'),explicit=JSON.parse(cp.execFileSync(process.execPath,[cli,'--run-dir='+runDir,'--ledger-file='+ledgerFile,'--minimum-useful-improvement=0.1','--target-power=0.8'],{encoding:'utf8',windowsHide:true}));assert.equal(explicit.nextTrialPlan.minimumUsefulImprovement,.1);assert.equal(explicit.nextTrialPlan.targetPower,.8);assert.equal(explicit.nextTrialPlan.conditionalPower.families,report.nextTrialPlan.conditionalPower.families);
 }finally{fs.writeFileSync(file,original);}
});
check('report writes only a new separate artifact and CLI consumes explicit arguments',()=>{
 assert.throws(()=>D.writeReport(path.join(runDir,'diagnostic.json'),report),/outside the production run/);assert(!fs.existsSync(path.join(runDir,'diagnostic.json')));assert.throws(()=>D.writeReport(ledgerFile,report),/\.json/);const output=path.join(root,'report.json');assert.equal(D.writeReport(output,report),output);assert.throws(()=>D.writeReport(output,report),/EEXIST/);const cli=path.join(S.ROOT,'tools/learning/adoption-diagnose.cjs'),result=JSON.parse(cp.execFileSync(process.execPath,[cli,'--run-dir='+runDir,'--ledger-file='+ledgerFile],{encoding:'utf8',windowsHide:true}));assert.equal(result.counts.completedAccepted,1);assert.equal(result.ledger.nextTrial,68);assert.deepEqual(fs.readdirSync(runDir).sort(),before.files.map(x=>x[0]));assert.equal(S.fileHash(ledgerFile),before.ledger);
});
console.log(JSON.stringify({passed:checks.length,artifacts:root,scope:'Read-only stored evidence and sample arithmetic; no production evaluation or promotion.'}));
