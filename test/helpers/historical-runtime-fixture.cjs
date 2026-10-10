'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

// Build a native-runtime-bound, immutable historical startup fixture exclusively
// from tracked source. No local runs, checkpoints or runtime archives are inputs.
function createHistoricalRuntimeFixture(directory){
 const S=require('../../tools/learning/state.cjs'),identity=S.sourceIdentity();
 const files=Object.fromEntries([...identity.sourceManifest,...identity.harnessManifest].map(row=>[row.path,fs.readFileSync(path.join(S.ROOT,row.path),'utf8')]));
 const stateFile='tools/learning/state.cjs',runFile='tools/learning/run.cjs';
 const replace=(source,before,after)=>{assert(source.includes(before),'Historical fixture source anchor changed: '+before);return source.replace(before,after);};
 files[stateFile]=replace(files[stateFile],'minutes:null,stageMinutes:5','minutes:60,stageMinutes:5');
 files[stateFile]=replace(files[stateFile],'...options,minutes:null,baselineCommit:baseline.commit','...options,baselineCommit:baseline.commit');
 files[stateFile]=replace(files[stateFile],'...options,minutes:null}','...options}');
 const mainStart=files[runFile].indexOf('async function main(');assert(mainStart>=0,'Current runner main source anchor changed');
 const historicalMain=fs.readFileSync(path.join(__dirname,'../fixtures/learning-historical-main.cjs'),'utf8');
 files[runFile]=files[runFile].slice(0,mainStart)+historicalMain+"\nmodule.exports={parse,options,continuousProfile,validateSettings,normalizeLesson,importLessons,importRecords,snapshotData,train,trainWithGeneration,deployModel,adopt,cycle,main};\n";
 for(const row of identity.harnessManifest)row.sha256=S.hash(files[row.path]);identity.harnessHash=S.hash(identity.harnessManifest);
 const file=path.join(directory,'historical-runtime.json');S.atomic(file,{schemaVersion:2,identity,files,externalDependencies:[]});
 return {file,identity};
}
module.exports={createHistoricalRuntimeFixture};
