const old=require('./engine-v9-before-speed.cjs').createEngine,now=require('./engine').createEngine,assert=require('assert'),g=require('./game48.cjs');
let seed=20260924;function rand(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
const boards=[g.position(34)];for(let n=0;n<40;n++)boards.push(Array.from({length:225},()=>{const r=rand();return r<.12?1:r<.24?2:0;}));
for(const b of boards){const a=old(15,b),c=now(15,b);for(let p of [1,2])for(let i=0;i<225;i++)assert.equal(c.legal(i,p),a.legal(i,p));assert.deepEqual(c.board,b);}
for(const [name,make]of [['v9',old],['v10',now]]){const e=make(15,g.position(34));let start=performance.now(),count=0;for(let n=0;n<100;n++)for(let p of [1,2])for(let i=0;i<225;i++)count+=e.legal(i,p);console.log(name,'legal scan',Math.round(performance.now()-start),'ms',count);start=performance.now();const r=e.analyze(1,3000);console.log(name,'3s search',r.depth,'depth',r.nodes,'nodes',r.moves[0]?.i);}
console.log('41 boards x 450 legal decisions matched');
