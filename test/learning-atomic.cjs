'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../tools/learning/state.cjs'),'utf8'),dir=fs.mkdtempSync(path.join(__dirname,'../work/atomic-save-')),file=path.join(dir,'state.json');
function withRename(renameSync){const context={require:id=>id==='node:fs'?{...fs,renameSync}:require(id),__dirname:path.join(__dirname,'../tools/learning'),module:{exports:{}},process,Atomics,SharedArrayBuffer,Int32Array,console};vm.runInNewContext(source,context);return context.module.exports;}
fs.writeFileSync(file,JSON.stringify({checkpoint:'old'}));let attempts=0;
withRename((from,to)=>{attempts++;assert.equal(JSON.parse(fs.readFileSync(to)).checkpoint,'old');if(attempts<3)throw Object.assign(Error('temporary Windows sharing violation'),{code:'EPERM'});fs.renameSync(from,to);}).atomic(file,{checkpoint:'new'});
assert.equal(attempts,3);assert.equal(JSON.parse(fs.readFileSync(file)).checkpoint,'new');
for(const code of ['EIO','EPERM']){attempts=0;const S=withRename(()=>{attempts++;throw Object.assign(Error('injected save failure'),{code});});assert.throws(()=>S.atomic(file,{checkpoint:'pending'}),/injected save failure/);assert.equal(attempts,code==='EIO'?1:12);assert.equal(JSON.parse(fs.readFileSync(file)).checkpoint,'new');assert.equal(JSON.parse(fs.readFileSync(file+'.tmp-'+process.pid)).checkpoint,'pending');}
console.log('PASS transient file locks retry without removing the prior checkpoint; permanent failures retain both prior and pending data with bounded retries');
