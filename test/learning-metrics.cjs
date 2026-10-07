'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../tools/learning/metrics.cjs');
const parent=path.resolve(__dirname,'../work');fs.mkdirSync(parent,{recursive:true});
const dir=fs.mkdtempSync(path.join(parent,'metrics-test-')),context={dir,state:{runId:'metrics-contract',cycle:1}};
const originalAppend=fs.appendFileSync,originalWarn=console.warn,warnings=[];
const denied=Object.assign(Error('injected diagnostic sidecar lock'),{code:'EACCES'});
let attempts=0;
try{
 fs.appendFileSync=(file,...args)=>{if(file===path.join(dir,'perf.jsonl')){attempts++;throw denied;}return originalAppend(file,...args);};
 console.warn=message=>warnings.push(message);
 M.start(context,'successful-work');M.add(context,'work_ms',12);
 const report=M.finish(context,{complete:true});
 assert.equal(report.complete,true);assert.equal(report.metrics.work_ms.total,12);
 assert.deepEqual(report.persistenceError,{code:'EACCES',message:denied.message});
 assert.equal(M.current(context),null);assert.equal(M.current(dir),null);
 assert.equal(attempts,1);assert.equal(warnings.length,1);
 // A diagnostic write in finally must preserve the actual recovery failure.
 const recoveryError=Error('primary recovery verification failed');
 assert.throws(()=>{M.start(context,'failed-work');try{throw recoveryError;}finally{M.finish(context,{complete:false});}},error=>error===recoveryError);
 assert.equal(attempts,2);assert.equal(warnings.length,2);assert.equal(M.current(context),null);
 // A later stage remains usable after the diagnostic path becomes writable.
 fs.appendFileSync=originalAppend;
 M.start(context,'next-work');M.count(context,'completed_games',3);
 const next=M.finish(context,{complete:true}),stored=JSON.parse(fs.readFileSync(path.join(dir,'perf.jsonl'),'utf8'));
 assert.deepEqual(stored,next);assert.equal(next.metrics.completed_games.total,3);assert.equal(next.persistenceError,undefined);
 console.log(JSON.stringify({passed:3,scope:'Diagnostic write failure preserves success, original failure, and later collection',artifacts:dir}));
}finally{fs.appendFileSync=originalAppend;console.warn=originalWarn;}
