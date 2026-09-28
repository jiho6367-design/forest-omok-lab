let create=require('../src/forest-engine.js');
const vmMode=process.argv.includes('--vm');
if(vmMode){const vm=require('node:vm'),fs=require('node:fs'),context={Date,console};vm.createContext(context);create=vm.runInContext(fs.readFileSync(require.resolve('../src/forest-engine.js'),'utf8')+'\ncreateForestEngine;',context);}
const positions=['H8 G7 G6 H6 F8','H8 G7 G6 H6 F8 I5 K3','H8 G7 G6 H6 F8 I5 K3 G8 G9'];
const boards=positions.map(prefix=>{const b=Array(225).fill(0);prefix.split(' ').forEach((c,k)=>b[(+c.slice(1)-1)*15+c.charCodeAt(0)-65]=k%2?2:1);return b;});
for(const enabled of [false,true]){
 const engine=create({fivePriority:false,vcfPrefilter:enabled});
 for(const b of boards)engine.forcing(b,2,25,1000);
 const start=performance.now();let calls=0,skipped=0;
 for(let k=0;k<100;k++)for(const b of boards){const r=engine.forcing(b,2,25,1000);if(!r.complete)throw Error('Benchmark timeout');calls++;skipped+=r.prefiltered?1:0;}
 console.log(JSON.stringify({runtime:vmMode?'vm':'native',enabled,calls,skipped,elapsed_ms:Math.round((performance.now()-start)*100)/100}));
}
