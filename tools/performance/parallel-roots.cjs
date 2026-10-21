'use strict';
const fs=require('node:fs'),path=require('node:path'),{Worker}=require('node:worker_threads'),{performance}=require('node:perf_hooks'),assert=require('node:assert/strict');
const {createEngine}=require('../../src/reader-engine.js'),{mergeRound}=require('../../src/parallel-analysis.js'),fixture=require('../../test/reader/game33.cjs');
const depth=Number(process.argv.find(s=>s.startsWith('--depth='))?.slice(8)||3),board=fixture.position(6),p=2,options={fixedWork:true,optimized:true,firstPlayer:2};
const modelArg=process.argv.find(s=>s.startsWith('--model='));if(modelArg)options.model=JSON.parse(fs.readFileSync(path.resolve(modelArg.slice(8)),'utf8'));
const roots=createEngine(15,board,{...options,exportRootFrontier:true}).analyze(p,1000).rootFrontier;
const code=`const {parentPort,workerData}=require('node:worker_threads');const e=require(workerData.module).createEngine(15,workerData.board,workerData.options);parentPort.on('message',m=>parentPort.postMessage(e.compareRoots(workerData.p,m.roots,m.depth,120000)));`;
(async()=>{
 const workers=[],start=performance.now(),groups=Array.from({length:3},()=>[]);roots.forEach((r,k)=>groups[k%3].push(r));
 try{
  for(let k=0;k<3;k++)workers.push(new Worker(code,{eval:true,workerData:{module:path.resolve(__dirname,'../../src/reader-engine.js'),board,p,options}}));
  const t=performance.now(),parts=await Promise.all(workers.map((w,k)=>new Promise((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);w.postMessage({roots:groups[k],depth});}))),parallelMs=performance.now()-t,parallel=mergeRound(roots,parts,depth);
  const serialStart=performance.now(),serial=createEngine(15,board,options).compareRoots(p,roots,depth,120000),serialMs=performance.now()-serialStart;
  assert(parallel&&serial.complete);const byId=rows=>rows.slice().sort((a,b)=>a.i-b.i).map(r=>[r.i,r.score,r.pv]);assert.deepEqual(byId(parallel),byId(serial.rows));
  const result={at:new Date().toISOString(),scope:'One fixed Reader tree with identical optional weights; startup included. Hardware-specific throughput, not playing-strength evidence.',modelId:options.model?.modelId||null,readerSha256:require('crypto').createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../../src/reader-engine.js'))).digest('hex'),logicalCPUs:require('os').cpus().length,workers:3,depth,roots:roots.length,parallelMs,serialMs,speedup:serialMs/parallelMs,totalMs:performance.now()-start,identicalScoresAndPV:true};
  const out=path.resolve(__dirname,'../../work/engine-improvement-20261021/parallel-benchmark.json');fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await Promise.all(workers.map(w=>w.terminate()));}
})().catch(error=>{console.error(error);process.exitCode=1;});
