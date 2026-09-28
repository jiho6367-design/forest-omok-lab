// Load the same browser engine source in Node without changing its game rules.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const context={Date,console};vm.createContext(context);
vm.runInContext(read('reader-engine.js').replace('function createEngine(','function createReaderEngine(')+'\n'+read('forest-engine.js')+'\n'+read('unified-engine.js'),context);
module.exports=context.createEngine;
