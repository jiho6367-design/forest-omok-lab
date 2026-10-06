// Load the same browser engine source in Node without changing its game rules.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const context={Date,console,performance:require('node:perf_hooks').performance};vm.createContext(context);
vm.runInContext(read('search-memory.js')+'\n'+read('gpu-patterns.js')+'\n'+read('strategy-engine.js')+'\n'+read('reader-engine.js').replace('function createEngine(','function createReaderEngine(')+'\n'+read('forest-engine.js')+'\n'+read('unified-engine.js'),context);
module.exports=context.createEngine;
