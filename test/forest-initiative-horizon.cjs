'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),makeForest=require('../src/forest-engine.js');
const file=process.env.FOREST_TEST_SOURCE||'src/forest-engine.js',source=fs.readFileSync(file,'utf8');
const anchor='let best=options[0],pv=[best.i],score=best.score;';
assert.equal(source.split(anchor).length,2);
// Expose the actual production horizon, with a frozen clock and a node cap.
// Record entered continuations rather than supplying canned search scores.
let code=source.replace('const check=()=>{nodes++;if(clockNow()>=deadline)throw TIME;};','const check=()=>{nodes++;if(nodes>20000)throw TIME;};')
 .replace('if(!moves.length)return {score:staticEval(q),pv:[]};quiet=true;',"testTrace.push({p:q,board:b.slice(),moves:moves.map(m=>({i:m.i,strategy:m.strategy}))});if(!moves.length)return {score:staticEval(q),pv:[]};quiet=true;")
 .replace(anchor,'return {run:()=>search(p,0,-Infinity,Infinity,4),snapshot:()=>b.slice()};');
const rules=makeForest({strategy:false}),ix=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const seeds=[
 {id:'single-four-attack',p:2,own:['J5','J6','J7'],enemy:['J4','I8','K8'],required:'J8',field:'forcing'},
 {id:'pure-cut-defense',p:2,own:['A1','O13'],enemy:['D4','D5','D6'],required:null,field:'cut'}
];
for(const seed of seeds)for(let t=0;t<8;t++)for(const swap of [false,true])for(const ownFirst of [false,true]){
 const b=Array(225).fill(0),p=swap?3-seed.p:seed.p;
 for(const [color,cells]of [[p,seed.own],[3-p,seed.enemy]])for(const c of cells)b[rules.transformed(ix(c),t)]=color;
 const trace=[],ctx={Date,console,testTrace:trace,performance:{now:()=>0}};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync('src/strategy-engine.js','utf8')+'\n'+code,ctx);
 const before=b.slice(),engine=ctx.createForestEngine({firstPlayer:ownFirst?p:3-p,trace}),api=engine.analyze(b,p,15000),r=api.run();
 const root=trace.find(q=>q.p===p&&q.board.every((v,i)=>v===b[i]));assert(root,seed.id+' entered actual horizon');
 if(seed.field==='forcing'){
  const move=root.moves.find(m=>m.i===rules.transformed(ix(seed.required),t));assert(move?.strategy.forcing,'single legal four survives at the horizon');
 }else assert(root.moves.some(m=>m.strategy.cut>=120&&m.strategy.attack===0),'pure defensive cut survives without own attacking extensions');
 assert.deepEqual(Array.from(api.snapshot()),before);assert.deepEqual(b,before);
 const pv=b.slice();let q=p;for(const i of r.pv){assert(engine.inspect(pv,i,q).legal);pv[i]=q;q=3-q;}
 assert(root.moves.length<=2,'bounded attack/cut extension width');
}
console.log('PASS 64 real Forest horizon cases: single-four attacks and pure defensive cuts across D4, colors and both first-player roles; legal PV and board restoration');

// A completed loss at one position must never suppress a later opponent error.
const load=fs.readFileSync('src/reader-engine.js','utf8').replace('function createEngine(','function createReaderEngine('),ctx={Date,console,performance};vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/search-memory.js','utf8')+'\n'+fs.readFileSync('src/strategy-engine.js','utf8')+'\n'+load+'\n'+source+'\n'+fs.readFileSync('src/unified-engine.js','utf8'),ctx);
for(const color of [1,2]){
 const e=ctx.createEngine({firstPlayer:3-color}),b=Array(225).fill(0);
 for(const c of ['D8','E8','F8','G8','C5'])b[ix(c)]=3-color;
 for(const c of ['D5','E5','F5','A1'])b[ix(c)]=color;
 const loss=e.analyze(b,color,{mode:'fast',ms:1000});assert(loss.lossProven);assert(e.inspect(b,loss.i,color).legal);
 // Alternate two actual legal moves: resist with a four; opponent misses its win.
 for(const [c,p]of [['G5',color],['O15',3-color]]){assert(e.inspect(b,ix(c),p).legal);b[ix(c)]=p;}
 const won=e.analyze(b,color,{mode:'deep',ms:30000});assert(won.proven&&!won.lossProven);assert.equal(won.analysisWork.stopReason,'verified-win');
 assert(e.inspect(b,won.i,color).win.length);assert.equal(won.analysisWork.mode,'deep');
 const defense=Array(225).fill(0);
 for(const c of ['D4','D5','D6','D7','N15'])defense[ix(c)]=3-color;
 for(const c of ['D3','A8','B8','C8'])defense[ix(c)]=color;
 const block=e.analyze(defense,color,{mode:'fast',ms:1000});assert.equal(block.i,ix('D8'));assert(!block.lossProven);
 defense[block.i]=color;assert(e.inspect(defense,ix('L14'),3-color).legal);defense[ix('L14')]=3-color;
 const counter=e.analyze(defense,color,{mode:'auto',ms:15000});assert(counter.proven);assert.equal(counter.i,ix('E8'));
}
console.log('PASS both colors: actual alternating moves after prior loss and mandatory defense preserve counter-wins when opponent errs');
