'use strict';
// Tiny generated train-stage fixtures. execute injects subprocess results;
// no Python, arena search, adoption or production model is invoked.
// One tiny Node child with deliberately paused parent pipes exercise the actual close event.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const S=require('../tools/learning/state.cjs'),runner=require('../tools/learning/run.cjs'),J=require('../tools/learning/journal.cjs'),N=require('../src/neural-evaluator.js');
const parent=path.join(S.ROOT,'work');fs.mkdirSync(parent,{recursive:true});const base=fs.mkdtempSync(path.join(parent,'te-'));let checks=0,serial=0;
function context(name){
 const dir=path.join(base,String(++serial)),settings={...S.defaults(),python:process.execPath},state={schemaVersion:1,runId:'generated-'+name,baselineCommit:S.BASELINE,rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,identity:S.sourceIdentity(),cycle:1,trial:0,counters:{generatedGames:0,completedGames:0,samples:2,trainingUpdates:0,analyzedPositions:0},activeGames:{},adoptions:[],errors:[],history:[]};
 const c={dir,settings,state};S.save(c);
 const data=path.join(dir,'datasets/cycle-1.jsonl');S.atomic(data,[{split:'train',familyId:'train-'+name,positionKey:'train-'+name},{split:'validation',familyId:'dev-'+name,positionKey:'dev-'+name}].map(r=>JSON.stringify(r)).join('\n')+'\n');
 const hash=S.fileHash(data);S.atomic(data+'.manifest.json',{schemaVersion:1,file:'cycle-1.jsonl',rulesId:S.RULES_ID,featureVersion:S.FEATURE_VERSION,counts:{train:1,validation:1,test:0},sha256:hash});return {c,data,hash};
}
function model(hash,updates=1){return {schemaVersion:1,kind:'forest-value-mlp',rulesId:N.RULES_ID,featureVersion:N.FEATURE_VERSION,inputSize:32,hiddenSize:1,activation:'relu',outputActivation:'tanh',normalization:{mean:Array(32).fill(0),scale:Array(32).fill(1)},layers:[{weights:[Array(32).fill(0)],bias:[0]},{weights:[[0]],bias:[0]}],modelId:'generated-value',scale:80,training:{updates,datasetHash:hash}};}
async function failure(name,result,expected,{stale=false}={}){
 const {c,data,hash}=context(name),before=S.fileHash(data),candidate=path.join(c.dir,'candidate.json');
 if(stale){S.atomic(candidate,model('prior-snapshot',9));S.atomic(candidate+'.training.json',{status:'error',error:'Stale report must not replace actual current process error',modelExported:false});}
 const candidateBefore=fs.existsSync(candidate)?S.fileHash(candidate):null;
 try{await assert.rejects(runner.train(c,{execute:async()=>({...result,elapsedMs:1})}),error=>{assert.equal(error.message,expected);return true;});assert.equal(c.state.training.process.exitCode,result.code);assert.equal(c.state.lastTrainingSampleCount,undefined);assert.equal(fs.existsSync(candidate)?S.fileHash(candidate):null,candidateBefore);assert.equal(S.fileHash(data),before);checks++;console.log('PASS '+name);}finally{J.close(c.dir);}
}
(async()=>{
 const error={status:'error',type:'ValueError',error:'Invalid data at line 1: Invalid sampleId',command:'train',modelExported:false};
 await failure('actual-json-valueerror',{code:2,stdout:JSON.stringify({event:'prepare',lines:0})+'\n'+JSON.stringify(error)+'\n',stderr:''},'Training failed: ValueError: Invalid data at line 1: Invalid sampleId');
 await failure('structured-cause-and-stderr-both-preserved',{code:2,stdout:JSON.stringify(error)+'\n',stderr:'CUDA runtime: benign warning'},'Training failed: ValueError: Invalid data at line 1: Invalid sampleId\nTrainer stderr: CUDA runtime: benign warning');
 await failure('stderr-only-retains-existing-message',{code:2,stdout:'not a structured error\n',stderr:'argparse: the actual current stderr'},'Training failed: argparse: the actual current stderr');
 await failure('stale-report-never-substitutes-current-json',{code:2,stdout:JSON.stringify(error)+'\n',stderr:''},'Training failed: ValueError: Invalid data at line 1: Invalid sampleId',{stale:true});
 await failure('malformed-stdout-does-not-use-stale-report',{code:2,stdout:'progress\n{"status":"error","error":\n',stderr:''},'Training failed: process exited with code 2',{stale:true});
 await failure('last-current-error-json-and-crlf',{code:2,stdout:JSON.stringify({...error,error:'earlier current failure'})+'\r\nnot-json\r\n'+JSON.stringify(error)+'\r\n',stderr:''},'Training failed: ValueError: Invalid data at line 1: Invalid sampleId');
 await failure('invalid-error-shape-refused',{code:3,stdout:JSON.stringify({status:'error',type:'ValueError',error:{nested:'must not stringify untrusted objects'}})+'\n',stderr:''},'Training failed: process exited with code 3');
 await failure('signal-fallback',{code:null,signal:'SIGTERM',stdout:'',stderr:''},'Training failed: process exited with code unknown; signal SIGTERM');
 await failure('only-bounded-tail-used',{code:2,stdout:JSON.stringify(error)+'\n'+'x'.repeat(21000),stderr:''},'Training failed: process exited with code 2');
 await failure('bounded-diagnostic-length',{code:2,stdout:JSON.stringify({...error,error:'x'.repeat(1800)})+'\n',stderr:''},'Training failed: '+('ValueError: '+'x'.repeat(1800)).slice(-1000));
 const {c,data,hash}=context('success'),before=S.fileHash(data);
 try{const good=model(hash);assert.equal(await runner.train(c,{execute:async({output})=>{S.atomic(output,good);S.atomic(output+'.training.json',{status:'completed',modelExported:true,modelId:good.modelId,datasetHash:hash,training:good.training,device:{finite:true,updatesThisRun:1}});return {code:0,stdout:JSON.stringify(error)+'\n',stderr:'nonfatal diagnostic',elapsedMs:1};}}),true);assert.equal(c.state.lastTrainingSampleCount,2);assert.equal(c.state.training.verification.passed,true);assert.equal(S.fileHash(data),before);checks++;console.log('PASS zero-exit-success-keeps-evidence-and-cutoff');}finally{J.close(c.dir);}
 const interrupted=context('zero-update-interrupted');
 try{S.atomic(path.join(interrupted.c.dir,'candidate.json'),model('prior-snapshot',9));assert.equal(await runner.train(interrupted.c,{execute:async({output})=>{S.atomic(output+'.training.json',{status:'interrupted',modelExported:false,updates:0,datasetHash:interrupted.hash});return {code:0,stdout:JSON.stringify(error)+'\n',stderr:'',elapsedMs:1};}}),false);assert.equal(interrupted.c.state.training.verification.passed,false);assert.equal(interrupted.c.state.lastTrainingSampleCount,undefined);checks++;console.log('PASS zero-exit-interrupted-still-rejects-stale-candidate');}finally{J.close(interrupted.c.dir);}


 // Real child with deliberately paused parent pipes: redirect only the trainer
 // argv to a tiny generated Node script. No ChildProcess event is mocked.
 // It writes a small final JSON+stderr and exits2 while data delivery is paused.
 // Exit observes unread pipes; close follows their genuine drain and closure.
 const real=context('real-child-pipe-close'),script=path.join(base,'pipe-tail.cjs');
 const finalError={status:'error',type:'ValueError',error:'Invalid data at line 1: Invalid sampleId'},finalStderr='benign delayed-pipe runtime warning';
 fs.writeFileSync(script,"'use strict';process.stdout.write("+JSON.stringify(JSON.stringify(finalError)+'\n')+");process.stderr.write("+JSON.stringify(finalStderr)+");process.exitCode=2;\n");
 const originalSpawn=cp.spawn,events=[];let actualChild,settled=false,exitObservation,seenStdout='',seenStderr='';
 cp.spawn=(command,args,options)=>{assert.equal(command,process.execPath);assert.equal(args[0],path.join(S.ROOT,'tools/learning/train.py'));assert.equal(args[1],'train');assert.equal(options.windowsHide,true);actualChild=originalSpawn(process.execPath,[script],options);actualChild.stdout.pause();actualChild.stderr.pause();actualChild.stdout.on('data',d=>{seenStdout+=d;events.push('stdout');});actualChild.stderr.on('data',d=>{seenStderr+=d;events.push('stderr');});actualChild.once('exit',(code,signal)=>{events.push('exit');exitObservation={code,signal,settled,stdout:seenStdout,stderr:seenStderr};setImmediate(()=>{actualChild.stdout.resume();actualChild.stderr.resume();});});actualChild.once('close',()=>events.push('close'));return actualChild;};
 try{
  const expected='Training failed: ValueError: Invalid data at line 1: Invalid sampleId\nTrainer stderr: '+finalStderr;
  const running=runner.train(real.c).then(value=>{settled=true;return value;},error=>{settled=true;throw error;});
  let watchdog;const timeout=new Promise((_,reject)=>{watchdog=setTimeout(()=>{actualChild?.stdout.resume();actualChild?.stderr.resume();actualChild?.kill();reject(Error('Tiny real-child pipe fixture exceeded5sec'));},5000);});
  try{await assert.rejects(Promise.race([running,timeout]),error=>{assert.equal(error.message,expected);return true;});}finally{clearTimeout(watchdog);}
  assert.deepEqual(exitObservation,{code:2,signal:null,settled:false,stdout:'',stderr:''});
  assert(events.indexOf('exit')<events.indexOf('stdout'));assert(events.indexOf('exit')<events.indexOf('stderr'));assert(events.indexOf('stdout')<events.indexOf('close'));assert(events.indexOf('stderr')<events.indexOf('close'));
  assert.equal(real.c.state.training.process.exitCode,2);assert.equal(real.c.state.lastTrainingSampleCount,undefined);assert.equal(fs.existsSync(path.join(real.c.dir,'candidate.json')),false);
  assert.equal(fs.readFileSync(path.join(real.c.dir,'train.stdout.log'),'utf8'),JSON.stringify(finalError)+'\n');assert.equal(fs.readFileSync(path.join(real.c.dir,'train.stderr.log'),'utf8'),finalStderr);assert.equal(S.fileHash(real.data),real.hash);
  checks++;console.log('PASS real-child-waits-for-pipe-close-and-final-diagnostic');
 }finally{cp.spawn=originalSpawn;J.close(real.c.dir);}
 console.log(JSON.stringify({passed:checks,scope:'Generated actual train-stage execute hooks; exact subprocess diagnostic propagation with stale candidate/report refusal and unchanged success evidence gate; no Python or search; one tiny generated real-child delayed-pipe contract',artifacts:base}));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
