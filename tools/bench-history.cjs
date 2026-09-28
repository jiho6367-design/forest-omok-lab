// Reproducible old HEAD vs working-tree comparison on white move 10.
const fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const read=(f,old)=>old?cp.execFileSync('git',['show',`HEAD:src/${f}`],{encoding:'utf8'}):fs.readFileSync(`src/${f}`,'utf8');
function engine(old){const context={Date,console};vm.createContext(context);
  vm.runInContext(read('reader-engine.js',old).replace('function createEngine(','function createReaderEngine(')+'\n'+read('forest-engine.js',old)+'\n'+read('unified-engine.js',old),context);
  return context.createEngine({fivePriority:false});}
const coords='H8 G7 G6 H6 F8 I7 E8 G8 F7'.split(' ');
const board=Array(225).fill(0);coords.forEach((c,k)=>board[(+c.slice(1)-1)*15+c.charCodeAt(0)-65]=k%2?2:1);
const modes=process.argv.slice(2).map(Number).filter(Boolean);if(!modes.length)modes.push(900,3000,8000,15000,25000);
for(const ms of modes)for(const old of [true,false]){
  const e=engine(old),cpu0=process.cpuUsage(),t=performance.now(),r=e.analyze(board,2,ms),elapsed=performance.now()-t,cpu=process.cpuUsage(cpu0);
  console.log(JSON.stringify({version:old?'before':'after',budget_ms:ms,elapsed_ms:Math.round(elapsed),
    cpu_percent:Math.round((cpu.user+cpu.system)/1000/elapsed*100),nodes:r.nodes||0,
    nodes_per_second:Math.round((r.nodes||0)*1000/elapsed),tt_hit_rate:r.ttHitRate??null,
    candidate_count:r.candidates?.length??null,completed_depth:r.depth||0,workers:1,
    vcf_checks:null,best_move:r.i==null?null:e.coord(r.i)}));
}
