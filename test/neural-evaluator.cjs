'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Neural=require('../src/neural-evaluator.js'),Memory=require('../src/search-memory.js');
const createEngine=require('../src/node-engine.cjs');
const blank=()=>Array(225).fill(0),idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
function model(id='test-central',scale=600){const w=Array(32).fill(0);w[30]=3;w[31]=-3;return {schemaVersion:1,kind:'forest-value-mlp',rulesId:Neural.RULES_ID,featureVersion:Neural.FEATURE_VERSION,inputSize:32,hiddenSize:1,activation:'relu',outputActivation:'tanh',normalization:{mean:Array(32).fill(0),scale:Array(32).fill(1)},layers:[{weights:[w],bias:[0]},{weights:[[1]],bias:[0]}],modelId:id,scale};}
const m=model(),b=blank(),acc=Neural.createAccumulator(b);let seed=42;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(let k=0;k<120;k++){const i=random()%225,p=random()%3;b[i]=p;acc.set(i,p);for(const side of [1,2])for(const first of [1,2,null]){
 const actual=Array.from(acc.features(side,first)),fresh=Neural.extractFeatures(b,side,first);actual.forEach((v,j)=>assert(Math.abs(v-fresh[j])<1e-10));
}}
const evaluator=Neural.createEvaluator(m,15,2);assert(Math.abs(evaluator.evaluate(b,1)+evaluator.evaluate(b,2))<1e-10);
const rotated=blank(),swapped=b.map(v=>v?3-v:0);for(let i=0;i<225;i++)rotated[(i%15)*15+14-(i/15|0)]=b[i];
assert.deepEqual(Neural.extractFeatures(rotated,1,2),Neural.extractFeatures(b,1,2));
assert.deepEqual(Neural.extractFeatures(swapped,2,1),Neural.extractFeatures(b,1,2));
for(const broken of [{...m,rulesId:'renju'},{...m,featureVersion:'old'},{...m,inputSize:450},{...m,scale:Infinity},{...m,layers:[{weights:[[NaN]],bias:[0]},m.layers[1]]}])assert.throws(()=>Neural.validate(broken));
const position=blank();position[idx('H8')]=1;position[idx('G8')]=2;position[idx('H9')]=1;
const baseline=createEngine({model:null,strategy:false}),learned=createEngine({model:m,strategy:false});
const delta=learned.evaluate(position,1)-baseline.evaluate(position,1);assert(Math.abs(delta)>1);assert(Math.abs(delta)<=600);
const memory=Memory.create(),engine=createEngine({model:m,searchMemory:memory});engine.analyze(position,2,80);
assert(memory.stats().entries>0);engine.configure({model:null});assert.equal(memory.stats().entries,0);assert.equal(engine.getContext().modelVersion,'baseline');
engine.configure({model:m});const oldId=engine.getContext().modelVersion;const altered=JSON.parse(JSON.stringify(m));altered.layers[1].weights[0][0]=2;engine.configure({model:altered});assert.notEqual(engine.getContext().modelVersion,oldId);
const context={Date,performance,console};vm.createContext(context);for(const f of ['neural-evaluator.js','search-memory.js','gpu-patterns.js','strategy-engine.js','reader-engine.js','forest-engine.js','unified-engine.js']){
 let source=fs.readFileSync('src/'+f,'utf8');if(f==='reader-engine.js')source=source.replace('function createEngine(','function createReaderEngine(');vm.runInContext(source,context);
}
for(const p of [1,2]){const win=blank();for(const c of ['D5','F5','G5','H5'])win[idx(c)]=p;
 const a=context.createEngine({model:null}).analyze(win,p,100),z=context.createEngine({model:m}).analyze(win,p,100);assert.equal(a.i,z.i);assert(z.proven);assert(z.shape.legal);
}
const fixture=process.argv.find(x=>x.startsWith('--parity='));if(fixture){const modelArg=process.argv.find(x=>x.startsWith('--model='));assert(modelArg,'--model is required with --parity');const rows=JSON.parse(fs.readFileSync(fixture.slice(9),'utf8')),trained=Neural.validate(JSON.parse(fs.readFileSync(modelArg.slice(8),'utf8'))),e=Neural.createEvaluator(trained);
 assert(rows.passed);assert(rows.cases.length>0);for(const r of rows.cases){const raw=e.raw(r.features);assert(Math.abs(raw-r.expectedValue)<1e-5);const swapped=r.features.slice();for(let k=0;k<12;k++)[swapped[k],swapped[k+12]]=[swapped[k+12],swapped[k]];for(const [a,b] of [[24,25],[26,27],[30,31]])[swapped[a],swapped[b]]=[swapped[b],swapped[a]];swapped[28]=-swapped[28];if(r.expectedEffectiveValue!==undefined)assert(Math.abs((raw-e.raw(swapped))/2-r.expectedEffectiveValue)<1e-5);}
}
console.log(JSON.stringify({passed:true,incrementalUpdates:120,symmetry:true,colourSwap:true,antisymmetric:true,actualEvaluationDelta:delta,modelCacheIsolation:true,immediateWinGuard:true}));
module.exports={model};
