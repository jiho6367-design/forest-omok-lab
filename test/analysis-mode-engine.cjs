'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
let clock=0;const ctx={Date,console,performance:{now:()=>++clock}};vm.createContext(ctx);
const files=['search-memory.js','strategy-engine.js','reader-engine.js','forest-engine.js','unified-engine.js'];
vm.runInContext(files.map(f=>{const text=fs.readFileSync('src/'+f,'utf8');return f==='reader-engine.js'?text.replace('function createEngine(','function createReaderEngine('):text;}).join('\n'),ctx);
const seed=Array(225).fill(0);seed[112]=1;seed[96]=2;
for(const [budget,mode,limit]of [[{mode:'fast',ms:50000,automatic:true},'fast',1000],[{mode:'auto',ms:50000},'auto',15000],[{mode:'deep',ms:50000},'deep',25000],[900,'custom',900],[30000,'deep',25000],['auto','auto',8000],[{automatic:true,ms:50000},'auto',15000],[{automatic:true,ms:1200},'auto',1200]]){
 clock=0;const before=seed.slice(),e=ctx.createEngine({firstPlayer:1,model:null}),progress=[];
 const r=e.analyze(seed,1,budget,[],v=>progress.push(v));assert.deepEqual(seed,before);assert(e.inspect(seed,r.i,1).legal);
 assert.equal(r.analysisWork.mode,mode);assert.equal(r.analysisWork.budgetMs,limit);assert.equal(r.automatic,mode==='auto');
 assert.equal(r.analysisWork.completedDepth,r.depth||0);assert.equal(r.analysisWork.nodes,r.nodes||0);
 for(const p of progress){assert.equal(p.analysisWork.mode,mode);assert.equal(p.analysisWork.budgetMs,limit);}
 if(mode==='deep'){assert(r.analysisWork.comparisonBudgetMs>15000,'extra deep time reaches the comparison, beyond the old cap');assert(r.analysisWork.guardBudgetMs>0);}
 assert(!r.proven&&!r.lossProven,'budget completion alone proves neither win nor loss');
}
console.log('PASS actual engine under a deterministic advancing clock: named/legacy modes, cap, deep comparison reserve, progress, board and unresolved proof contract');
