const vm=require('vm'),fs=require('fs'),path=require('path');
const read=f=>fs.readFileSync(path.join(__dirname,'../src',f),'utf8');
const sandbox={Date,console};vm.createContext(sandbox);
vm.runInContext(read('reader-engine.js').replace('function createEngine(', 'function createReaderEngine(')+'\n'+read('forest-engine.js')+'\n'+read('unified-engine.js'),sandbox);
module.exports=sandbox.createEngine;
