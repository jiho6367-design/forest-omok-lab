'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const S=require('../tools/learning/state.cjs'),A=require('../tools/learning/arena.cjs'),L=require('../tools/learning/trial-ledger.cjs');
const model={modelId:'powered-reservation-fixture'},checks=[];
function context(dir,file,settings={}){
 fs.mkdirSync(dir,{recursive:true});const state=S.read(path.join(dir,'state.json'),{schemaVersion:1,runId:path.basename(dir),cycle:1,trial:67,baselineCommit:S.BASELINE,rulesId:S.RULES_ID,counters:{},adoptions:[],history:[],identity:S.sourceIdentity()});
 return {dir,trialLedgerFile:file,state,settings:{...S.defaults(),pairs:8,poweredEvaluation:true,minimumUsefulImprovement:.5,targetPower:.1,maxEvaluationPairs:64,...settings}};
}
function ledgerSnapshot(file){const db=new DatabaseSync(file,{readOnly:true});try{return {highwater:Number(db.prepare("SELECT value FROM metadata WHERE key='highwater'").get().value),trials:Number(db.prepare('SELECT COUNT(*) AS n FROM trials').get().n),families:Number(db.prepare('SELECT COUNT(*) AS n FROM families').get().n)};}finally{db.close();}}
if(process.argv[2]==='--reserve-only'){const c=context(process.argv[3],process.argv[4]);A.plan(c,model);process.exit(74);}
function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
fs.mkdirSync(path.join(S.ROOT,'work'),{recursive:true});const root=fs.mkdtempSync(path.join(S.ROOT,'work/powered-evaluation-contract-'));
check('legacy fixed settings retain the previous hash and actual strength gate',()=>{
 const settings={...S.defaults(),pairs:64},legacyHash=S.hash({validationMs:settings.validationMs,pairs:64,minPairs:settings.minPairs,confidence:settings.confidence,workers:settings.workers||1,schedule:'parallel-arena-v1'});
 assert.equal(A.evaluationSettingsHash(settings),legacyHash);assert.equal(A.evaluationSettingsHash({...settings,poweredEvaluation:false,minimumUsefulImprovement:.49,targetPower:.99,maxEvaluationPairs:1}),legacyHash);assert.deepEqual(A.evaluationDesign(settings,68),{policy:'fixed',pairs:64});
 const games=Array.from({length:64},(_,n)=>[true,false].map(candidateFirst=>({completed:true,winner:n<38?1:2,candidateColor:1,candidateFirst,pairId:'pair-'+n,familyId:'family-'+n}))).flat(),stats=A.pairedStats(games,{trial:68,minPairs:32,confidence:.95});assert.equal(stats.independentFamilies,64);assert.equal(stats.meanScore,38/64);assert.equal(stats.passed,false);assert(Math.abs(stats.alpha-.05/(68*69))<1e-15);
});
check('powered design sizes for both controls at the actual ordinal without lowering the gate',()=>{
 const settings={...S.defaults(),pairs:64,poweredEvaluation:true},design=A.evaluationDesign(settings,68,2);assert.equal(design.pairs,1202);assert.equal(design.requirements.configured.games,4808);assert(design.requirements.configured.conditionalFullGatePowerLowerBound>.8);assert.equal(design.requirements.promotionGate.lowerBoundStrictlyGreaterThan,.5);assert.equal(design.requirements.minPairs,32);assert.equal(design.requirements.confidence,.95);assert.notEqual(A.evaluationSettingsHash(settings),A.evaluationSettingsHash({...settings,poweredEvaluation:false}));
 assert.notEqual(A.evaluationSettingsHash(settings),A.evaluationSettingsHash({...settings,targetPower:.9}));assert.equal(A.evaluationDesign({...settings,pairs:1500},68).pairs,1500);
});
check('resource rejection rolls back a real shared-ledger transaction before allocating trial or families',()=>{
 const file=path.join(root,'cap.sqlite'),c=context(path.join(root,'cap'),file,{pairs:64,minimumUsefulImprovement:.10,targetPower:.8,maxEvaluationPairs:100});S.save(c);L.reconcile(c);const before=ledgerSnapshot(file),settingsHash=S.hash(c.settings);
 assert.throws(()=>A.plan(c,model),error=>error.code==='EVALUATION_BUDGET'&&error.evaluationDesign.pairs===1202&&/cap 100/.test(error.message));assert.deepEqual(ledgerSnapshot(file),before);assert.equal(S.hash(c.settings),settingsHash);assert.equal(c.state.trial,67);assert(!fs.existsSync(path.join(c.dir,'arena-cycle-1.json')));
});
check('reservation uses the atomic actual trial rather than a stale run cursor and freezes effective pairs',()=>{
 const file=path.join(root,'actual.sqlite'),first=context(path.join(root,'actual-first'),file),later=context(path.join(root,'actual-later'),file),baseSettings=S.hash(first.settings),firstArena=A.plan(first,model),laterArena=A.plan(later,model);
 assert.equal(firstArena.trial,68);assert.equal(laterArena.trial,69);assert.equal(firstArena.pairs,A.evaluationDesign(first.settings,68,2).pairs);assert.equal(laterArena.pairs,A.evaluationDesign(later.settings,69,2).pairs);assert.equal(firstArena.games.length,firstArena.pairs*4);assert.equal(new Set(firstArena.games.map(g=>g.familyId)).size,firstArena.pairs);assert.equal(S.hash(first.settings),baseSettings);assert.deepEqual(firstArena.evaluationDesign,A.evaluationDesign(first.settings,68,2));assert.deepEqual(A.arenaSummary(firstArena,1).evaluationDesign,firstArena.evaluationDesign);
 const oldFamilies=new Set(firstArena.games.map(g=>g.familyId));assert(laterArena.games.every(g=>!oldFamilies.has(g.familyId)));assert.equal(S.hash(A.plan(first,model)),S.hash(firstArena));assert.equal(ledgerSnapshot(file).trials,2);
});
check('exit after durable reservation and later ledger advancement reuses the original frozen plan',()=>{
 const file=path.join(root,'crash.sqlite'),dir=path.join(root,'crash'),c=context(dir,file);S.save(c);const child=cp.spawnSync(process.execPath,[__filename,'--reserve-only',dir,file],{encoding:'utf8',windowsHide:true});assert.equal(child.status,74,child.stderr);assert.equal(S.read(path.join(dir,'state.json')).trial,67);assert(!fs.existsSync(path.join(dir,'arena-cycle-1.json')));
 const sibling=A.plan(context(path.join(root,'crash-sibling'),file),model);assert.equal(sibling.trial,69);const before=ledgerSnapshot(file),resumed=A.plan(context(dir,file),model),again=A.plan(context(dir,file),model);assert.equal(resumed.trial,68);assert.equal(resumed.pairs,A.evaluationDesign(c.settings,68,2).pairs);assert.deepEqual(again,resumed);assert.deepEqual(ledgerSnapshot(file),before);assert.equal(resumed.budget.reservation,again.budget.reservation);
});
S.atomic(path.join(root,'report.json'),{passed:checks.length,checks,scope:'Pure sizing and actual isolated durable reservations; no production gameplay, strength result or promotion was performed'});console.log(JSON.stringify({passed:checks.length,artifacts:root}));
