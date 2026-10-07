'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),verify=require('../tools/verify-attack.cjs'),ix=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const coords='H8 G7 I7 G9 I8 G8 G6 F9 H7 J9 H9 H6'.split(' '),board=Array(225).fill(0);coords.forEach((c,k)=>board[ix(c)]=k%2?1:2);
const original=fs.readFileSync('src/forest-engine.js','utf8'),anchor='function solve(left){if(clockNow()>=end)throw TIME;nodes++;';assert.equal(original.split(anchor).length,2);
let work=0;const ctx={Date,performance:{now:()=>work},testStep:()=>work++};vm.createContext(ctx);vm.runInContext(original.replace(anchor,'function solve(left){if(clockNow()>=end)throw TIME;testStep();nodes++;'),ctx);const E=ctx.createForestEngine({strategy:false}),shared=new Map();
const partial=E.forcedReplyTrap(board,1,80,ix('G10'),19,true,shared);assert(!partial.complete&&!partial.proof);assert(shared.size>0);const partialSize=shared.size;
const resumed=E.forcedReplyTrap(board,1,100000,ix('G10'),19,true,shared);assert(resumed.complete&&resumed.proof);const retainedEntries=shared.size;
const begin=work,warm=E.forcedReplyTrap(board,1,100000,ix('G10'),19,true,shared),warmWork=work-begin,beginFresh=work,fresh=E.forcedReplyTrap(board,1,100000,ix('G10'),19,true),freshWork=work-beginFresh;
const compare=r=>({complete:r.complete,scopeComplete:r.scopeComplete,proof:r.proof});assert.deepEqual(JSON.parse(JSON.stringify(compare(warm))),JSON.parse(JSON.stringify(compare(fresh))));assert(warmWork<freshWork);const placed=board.slice();placed[ix('G10')]=2;assert.equal(warm.proof.branches.length,placed.filter((v,i)=>!v&&E.inspect(placed,i,1).legal).length);
const none=E.forcedReplyTrap(board,1,0,ix('G10'),19,true,shared);assert(!none.complete&&!none.proof,'even cached scope honors zero budget');
const after=board.slice();after[ix('G10')]=2;for(const p of [1,2])for(const depth of [1,3,19]){const a=E.forcing(after,p,depth,100000,shared),b=E.forcing(after,p,depth,100000);assert.equal(a.complete,b.complete);assert.deepEqual(JSON.parse(JSON.stringify(a.proof)),JSON.parse(JSON.stringify(b.proof)));}assert.deepEqual(board,coords.reduce((b,c,k)=>(b[ix(c)]=k%2?1:2,b),Array(225).fill(0)));
for(const value of shared.values())assert(value===null||Array.isArray(value.pv),'only complete forcing subproblems, no aggregate timeout/trap entry');
function fromPV(pv,k=0){const tree={move:E.coord(pv[k])};if(k+2<pv.length)tree.replies={[E.coord(pv[k+1])]:fromPV(pv,k+2)};return tree;}
function fromTrap(proof){return {move:E.coord(proof.block),replies:Object.fromEntries(proof.branches.map(b=>[E.coord(b.i),b.proof?fromPV(b.proof.pv):fromTrap(b.quietProof)]))};}
const specification={moves:coords,firstPlayer:2,attacker:2,certificate:fromTrap(warm.proof)},checked=verify(specification,25000);assert(checked.verified,JSON.stringify(checked));
console.log('PASS partial trap is unresolved; same-request complete child cache resumes without changing proof, budget, side/depth or board');console.log(JSON.stringify({warmWork,freshWork,partialSize,retainedEntries,independentVerification:checked}));
