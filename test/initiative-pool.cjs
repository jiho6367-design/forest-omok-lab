'use strict';
// Synthetic tactical outcomes exercise the production pool/search/status path.
// These stubs are control-flow evidence, never game-winning certificates.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const A=idx('G8'),B=idx('I8'),C=idx('H7'),board=Array(225).fill(0);board[idx('H8')]=1;
function run(mode){
 let source=fs.readFileSync('src/forest-engine.js','utf8');
 const replace=(from,to)=>{assert.equal(source.split(from).length-1,1,'fixture anchor '+from.slice(0,50));source=source.replace(from,to);};
 replace('limits=limitsFor(budget)','limits={...limitsFor(budget),depth:1}');
 replace('let roots=ranked(b,p,true).filter',"let roots=testRoots.map((i,k)=>({i,a:inspect(b,i,p),score:k===0?10000:k===1?0:20000})).filter");
 replace('const timedProof=(q,ms)=>{let r=forcing(b,q,limits.forcing,Math.max(1,Math.min(ms,deadline-clockNow())),proofCache);nodes+=r.nodes;return r;};','const timedProof=(q,ms)=>testProof(b,q);');
 replace('function quietTrap(board,p,budget=300,width=4,maxPlies=11,includeCounter=false,cache=new Map()){','function quietTrap(board,p,budget=300,width=4,maxPlies=11,includeCounter=false,cache=new Map()){return {complete:true,proof:null};');
 replace('for(let m of rootOptions){check();b[m.i]=p;','for(let m of rootOptions){check();testEntered(m.i);b[m.i]=p;');
 const entered=[];
 const context={Date,performance,console,testRoots:[A,B,C],testEntered:i=>entered.push(i),testProof:b=>{
  const added=b.findIndex((v,i)=>v&&!board[i]);
  if(added<0)return {complete:true,proof:null,nodes:0};
  if(added===C)return {complete:true,proof:{pv:[idx('A1')]},nodes:0};
  return {complete:mode==='mixed'?added!==A:false,proof:null,nodes:0};
 }};
 vm.createContext(context);vm.runInContext(source,context);
 const before=board.slice(),r=context.createForestEngine({strategy:false}).analyze(board,1,1000);
 assert.deepEqual(board,before);assert.equal(new Set(entered).size,2);assert(entered.includes(A),'uncompleted unrefuted root is actually compared');assert(entered.includes(B),'completed root still compared');assert(!entered.includes(C),'synthetic refuted root excluded');
 assert.equal(r.depth,1);assert(!r.proven&&!r.lossProven);assert(r.rejected.some(m=>m.i===C));assert(r.candidates.every(m=>m.i!==C&&m.comparisonComplete));
 if(r.i===A||mode==='all-incomplete')assert.equal(r.defenseChecked,false,'comparison completion does not complete tactical verification');
 assert.equal(r.pv[0],r.i);
 return {mode,entered,chosen:r.i,defenseChecked:r.defenseChecked};
}
console.log('PASS mixed completed/uncompleted roots are compared; refuted root excluded; proof/status and board preserved',JSON.stringify(run('mixed')));
console.log('PASS all-uncompleted roots remain unresolved after completed comparison',JSON.stringify(run('all-incomplete')));
