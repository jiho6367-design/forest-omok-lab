'use strict';
// Bounded, process-local aggregates. Timings may overlap and must not be added
// together as if they were exclusive wall time. No per-move logging or fsync.
const fs=require('node:fs'),path=require('node:path');
const {monitorEventLoopDelay}=require('node:perf_hooks');
const sessions=new WeakMap(),directories=new Map(),BINS=128,MINIMUM=.01,STEPS=4;
const now=()=>performance.now();
function current(context){return (typeof context==='string'?directories.get(path.resolve(context)):context&&sessions.get(context))||null;}
function start(context,label,{eventLoop=false}={}){
 if(process.env.OMOK_LEARNING_METRICS==='0')return null;
 const prior=current(context);if(prior)return prior;
 const value={label,startedAt:new Date().toISOString(),started:now(),metrics:Object.create(null)};
 if(eventLoop){value.eventLoop=monitorEventLoopDelay({resolution:20});value.eventLoop.enable();}
 sessions.set(context,value);if(context.dir)directories.set(path.resolve(context.dir),value);return value;
}
function add(context,name,value){
 const session=current(context);if(!session||!Number.isFinite(value)||value<0)return;
 const metric=session.metrics[name]||(session.metrics[name]={count:0,total:0,min:null,max:null,bins:Array(BINS).fill(0)});
 metric.count++;metric.total+=value;metric.min=metric.min==null?value:Math.min(metric.min,value);metric.max=metric.max==null?value:Math.max(metric.max,value);
 const index=value<=MINIMUM?0:Math.min(BINS-1,Math.ceil(Math.log2(value/MINIMUM)*STEPS));metric.bins[index]++;
}
function count(context,name,value=1){add(context,name,value);}
function measure(context,name,fn){if(!current(context))return fn();const started=now();try{return fn();}finally{add(context,name,now()-started);}}
async function measureAsync(context,name,fn){if(!current(context))return await fn();const started=now();try{return await fn();}finally{add(context,name,now()-started);}}
function percentile(metric,fraction){
 if(!metric.count)return null;const rank=Math.ceil(metric.count*fraction);let n=0;
 for(let index=0;index<metric.bins.length;index++){n+=metric.bins[index];if(n>=rank)return Math.min(metric.max,MINIMUM*2**(index/STEPS));}return metric.max;
}
function snapshot(context){
 const value=current(context);if(!value)return null;const metrics={};
 for(const [name,metric]of Object.entries(value.metrics))metrics[name]={...metric,bins:metric.bins.slice(),mean:metric.count?metric.total/metric.count:0,p50Upper:percentile(metric,.5),p95Upper:percentile(metric,.95)};
 return {schemaVersion:1,label:value.label,startedAt:value.startedAt,elapsedMs:now()-value.started,histogram:{minimum:MINIMUM,bins:BINS,stepsPerPowerOfTwo:STEPS,quantiles:'upper bounds of bounded logarithmic bins'},metrics};
}
function merge(context,report,prefix=''){
 const value=current(context);if(!value||!report)return;
 if(report.histogram?.bins!==BINS||report.histogram?.minimum!==MINIMUM||report.histogram?.stepsPerPowerOfTwo!==STEPS)throw Error('Incompatible performance histogram');
 for(const [name,source]of Object.entries(report.metrics||{})){
  if(!source.count)continue;const key=prefix+name,target=value.metrics[key]||(value.metrics[key]={count:0,total:0,min:null,max:null,bins:Array(BINS).fill(0)});
  target.count+=source.count;target.total+=source.total;target.min=target.min==null?source.min:Math.min(target.min,source.min);target.max=target.max==null?source.max:Math.max(target.max,source.max);
  for(let index=0;index<BINS;index++)target.bins[index]+=source.bins[index]||0;
 }
}
function finish(context,extra={}, {persist=true}={}){
 const value=current(context);if(!value)return null;
 let eventLoop=null;if(value.eventLoop){value.eventLoop.disable();if(value.eventLoop.count)eventLoop={count:value.eventLoop.count,meanMs:value.eventLoop.mean/1e6,maxMs:value.eventLoop.max/1e6,p50Ms:value.eventLoop.percentile(50)/1e6,p95Ms:value.eventLoop.percentile(95)/1e6};}
 const report={...snapshot(context),finishedAt:new Date().toISOString(),runId:context.state?.runId,cycle:context.state?.cycle,eventLoop,...extra};sessions.delete(context);if(context.dir&&directories.get(path.resolve(context.dir))===value)directories.delete(path.resolve(context.dir));
 if(persist&&context.dir)try{fs.appendFileSync(path.join(context.dir,'perf.jsonl'),JSON.stringify(report)+'\n');}catch(error){
  // This sidecar is diagnostic only. Its failure must neither undo successful
  // durable work nor replace the recovery error from a caller's finally block.
  report.persistenceError={code:error.code||null,message:String(error.message||error)};
  console.warn('Learning performance diagnostics could not be saved: '+report.persistenceError.message);
 }
 return report;
}
module.exports={now,current,start,add,count,measure,measureAsync,snapshot,merge,finish};
