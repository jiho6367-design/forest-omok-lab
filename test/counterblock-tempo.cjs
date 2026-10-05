'use strict';
const assert=require('node:assert/strict'),makeForest=require('../src/forest-engine.js'),makeStrategy=require('../src/strategy-engine.js');
const ix=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65,rules=makeForest({strategy:false});
const seed=Array(225).fill(0);for(const [p,cs]of [[2,['D4','D6','B3']],[1,['B5','F5','L13','O9']]])for(const c of cs)seed[ix(c)]=p;
for(let transform=0;transform<8;transform++)for(const swap of [false,true]){
 const b=Array(225).fill(0);seed.forEach((v,i)=>b[rules.transformed(i,transform)]=swap&&v?3-v:v);const input=b.slice(),p=swap?1:2;
 const s=makeStrategy(15,{inspect:rules.inspect,legal:(b,i,p)=>rules.inspect(b,i,p).legal,winning:rules.winning},{firstPlayer:swap?2:1,clock:()=>0});
 const ids=['D3','D5','E5'].map(c=>rules.transformed(ix(c),transform)),roots=ids.map((i,k)=>({i,score:100-k,strategy:s.move(b,i,p)}));
 const out=s.probe(b,p,roots,1000);assert(out.complete);assert.deepEqual(b,input);
 const broken=out.checks.find(c=>c.i===ids[0]),open=out.checks.find(c=>c.i===ids[1]),cut=out.checks.find(c=>c.i===ids[2]);
 assert(broken.complete&&broken.tempoLosses>0);assert(broken.tempoLossReplies.some(r=>r.i===ids[1]&&r.replyAttack>=120&&r.replyCut>=120));
 assert.equal(open.tempoLosses,0,'other endpoint block without its own new three-window is not a counterblock');
 assert.equal(cut.tempoLosses,0,'precut quiet root is not penalized for lacking immediate forcing pressure');
 assert(out.checks.every(c=>!c.proven&&!c.refuted));
}
for(const kind of ['pure-block','no-legal-preparation','unrelated-three']){
 const b=seed.slice();b[ix('F5')]=0;if(kind==='unrelated-three')for(const c of ['K11','L11','M11'])b[ix(c)]=1;
 if(kind==='no-legal-preparation')b[ix('F5')]=1;
 const input=b.slice(),legal=(board,i,p)=>!(kind==='no-legal-preparation'&&p===1&&board[ix('D5')]===1&&['C5','E5'].map(ix).includes(i))&&rules.inspect(board,i,p).legal;
 const s=makeStrategy(15,{inspect:rules.inspect,legal,winning:rules.winning},{clock:()=>0}),root={i:ix('D3'),score:1,strategy:s.move(b,ix('D3'),2)},out=s.probe(b,2,[root],1000);
 assert(out.complete);assert.equal(out.checks[0].tempoLosses,0,kind);assert.deepEqual(b,input);
}
console.log('PASS real counterblock preparation/next pressure across D4 and colors; pure block, unrelated axes and forbidden future preparation excluded; board/proof preserved');
