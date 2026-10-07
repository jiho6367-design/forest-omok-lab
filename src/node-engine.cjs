// Load the same browser engine source in Node without changing its game rules.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
require('../tools/learning/deployment.cjs').recoverDeployment();
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const context={Date,console,performance:require('node:perf_hooks').performance};vm.createContext(context);
vm.runInContext(read('neural-evaluator.js')+'\n'+read('search-memory.js')+'\n'+read('gpu-patterns.js')+'\n'+read('strategy-engine.js')+'\n'+read('reader-engine.js').replace('function createEngine(','function createReaderEngine(')+'\n'+read('forest-engine.js')+'\n'+read('unified-engine.js'),context);
const active=path.join(__dirname,'active-model.json');
if(fs.existsSync(active)){context.activeModel=JSON.parse(fs.readFileSync(active,'utf8'));if(context.activeModel.adoption?.accepted!==true)throw Error('The default model has no accepted validation record');vm.runInContext('OmokNeural.setDefaultModel(activeModel)',context);}
module.exports=context.createEngine;
module.exports.neural=vm.runInContext('OmokNeural',context);
