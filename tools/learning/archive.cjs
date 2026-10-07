'use strict';
// Resume known historical runs with the exact preserved code. Never rewrite
// an old run's identity to pretend a new algorithm produced its old results.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process'),threads=require('node:worker_threads');
const ROOT=path.resolve(__dirname,'../..'),SNAPSHOT=path.join(ROOT,'work/continuous-runtime-baseline.json');
function assertDeliverySource(snapshot){if(require('./state.cjs').sourceIdentity().sourceHash!==snapshot.identity.sourceHash)throw Error('The production engine changed: archived evaluation cannot publish a model into a different engine. Continue experience in a new run and evaluate again.');}
function selectResumeRunner(run,{repo=ROOT}={}){
 repo=path.resolve(repo);const S=require(path.join(repo,'tools/learning/state.cjs')),state=S.read(path.join(run,'state.json')),normal={runner:path.join(repo,'tools/learning/run.cjs'),argsPrefix:[],cwd:repo};if(!state)return normal;
 const now=S.sourceIdentity();if(state.identity?.sourceHash===now.sourceHash&&state.identity?.harnessHash===now.harnessHash)return normal;
 const file=path.join(repo,'work/continuous-runtime-baseline.json'),snapshot=S.read(file);if(snapshot&&state.identity?.sourceHash===snapshot.identity.sourceHash&&state.identity?.harnessHash===snapshot.identity.harnessHash)return {runner:path.join(repo,'tools/learning/archive.cjs'),argsPrefix:['--archived-run'],cwd:repo};
 throw Error('이 실험의 실행 버전을 찾을 수 없습니다. 저장된 경험을 새 누적 실험으로 이어 주세요.');
}
function frozenRuntime(){
 const snapshot=JSON.parse(fs.readFileSync(SNAPSHOT,'utf8')),sources=snapshot.files,cache=new Map(),relative=file=>path.relative(ROOT,path.resolve(file)).split(path.sep).join('/');
 const frozenFs={...fs,readFileSync(file,options){const key=typeof file==='string'?relative(file):null;if(key&&Object.hasOwn(sources,key)){const bytes=Buffer.from(sources[key]);return typeof options==='string'||options?.encoding?bytes.toString(typeof options==='string'?options:options.encoding):bytes;}return fs.readFileSync(file,options);}};
 const frozenCp={...cp,execFileSync(command,args,options){if(args?.[0]===path.join(ROOT,'build.cjs'))assertDeliverySource(snapshot);return cp.execFileSync(command,args,options);},spawn(command,args,options){if(args?.[0]===path.join(ROOT,'tools/learning/train.py')){const target=path.join(ROOT,'work/archived-trainer-baseline.py'),source=sources['tools/learning/train.py'];if(fs.existsSync(target)){if(fs.readFileSync(target,'utf8')!==source)throw Error('Archived trainer content changed');}else fs.writeFileSync(target,source);args=[target,...args.slice(1)];}return cp.spawn(command,args,options);}};
 class ArchivedWorker extends threads.Worker{constructor(file,options={}){const key=relative(file);if(Object.hasOwn(sources,key))super(__filename,{...options,workerData:{archivedWorkerModule:key,original:options.workerData}});else super(file,options);}}
 const frozenThreads={...threads,Worker:ArchivedWorker,workerData:threads.workerData?.archivedWorkerModule?threads.workerData.original:threads.workerData};
 function load(key){if(cache.has(key))return cache.get(key).exports;if(!Object.hasOwn(sources,key))return require(path.join(ROOT,key));const module={exports:{}};cache.set(key,module);const filename=path.join(ROOT,key),directory=path.dirname(filename);
  const localRequire=id=>{if(id==='node:fs'||id==='fs')return frozenFs;if(id==='node:child_process'||id==='child_process')return frozenCp;if(id==='node:worker_threads'||id==='worker_threads')return frozenThreads;if(id.startsWith('.')){let name=relative(path.resolve(directory,id));if(!Object.hasOwn(sources,name)&&Object.hasOwn(sources,name+'.js'))name+='.js';if(!Object.hasOwn(sources,name)&&Object.hasOwn(sources,name+'.cjs'))name+='.cjs';return load(name);}return require(id);};
  if(key.endsWith('.json'))module.exports=JSON.parse(sources[key]);else vm.compileFunction(sources[key],['module','exports','require','__filename','__dirname'],{filename})(module,module.exports,localRequire,filename,directory);return module.exports;
 }
 const identity=load('tools/learning/state.cjs').sourceIdentity();if(identity.sourceHash!==snapshot.identity.sourceHash||identity.harnessHash!==snapshot.identity.harnessHash)throw Error('Preserved runtime identity mismatch');return {snapshot,load};
}
if(!threads.isMainThread&&threads.workerData?.archivedWorkerModule)frozenRuntime().load(threads.workerData.archivedWorkerModule);
else if(require.main===module){if(process.argv[2]!=='--archived-run')throw Error('Archive runner requires a trusted archived-run selection');frozenRuntime().load('tools/learning/run.cjs').main(process.argv.slice(3)).catch(error=>{console.error(error.stack||error);process.exitCode=1;});}
module.exports={selectResumeRunner,frozenRuntime,assertDeliverySource};
