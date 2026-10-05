'use strict';
const assert=require('node:assert/strict'),{replay,outcome}=require('../tools/strategy/replay.cjs'),E=require('../src/node-engine.cjs')({strategy:false});
const sequence={firstPlayer:2,moves:['H8','PASS','H9','PASS','H10','PASS','H11','PASS']};
const partial=replay(E,sequence);assert.equal(partial.p,2);assert.equal(outcome(E,partial.board,2),null);
const ended=replay(E,{...sequence,moves:[...sequence.moves,'H12']});assert.deepEqual(outcome(E,ended.board,ended.p),{status:'completed',winner:2,reason:'played-exact-five'});
assert.throws(()=>replay(E,{...sequence,moves:[...sequence.moves,'H12','A1']}),/Moves after exact-five victory/);
const full=Array.from({length:225},(_,i)=>i%15%3===0?2:1);assert.deepEqual(outcome(E,full,1),{status:'completed',winner:null,reason:'full-board'});
const noLegal={inspect:()=>({legal:false,win:[]})};assert.deepEqual(outcome(noLegal,Array(225).fill(0),1),{status:'unfinished',winner:null,reason:'no-legal-move'});
console.log('PASS actual played victory, PASS/current side, full-board-only draw and unresolved no-legal-move');
