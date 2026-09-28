// Interactive offline driver: one JSON spec, then `run 25000` or `quit`.
// Waiting for input uses no search CPU. Keep this process alive to preserve
// the private search stack; the report is an observation, not a resumable cache.
const fs=require('node:fs'),readline=require('node:readline');
const session=require('./proof-session.cjs')(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
const output=process.argv[3];
console.log('Ready: run <0..25000> or quit');
readline.createInterface({input:process.stdin}).on('line',line=>{
 if(line.trim()==='quit')process.exit(0);
 const match=/^run (\d+)$/.exec(line.trim());
 if(!match){console.log('Expected run <0..25000> or quit');return;}
 try{
  const r=session.run(Number(match[1]));
  if(output)fs.writeFileSync(output,JSON.stringify(r,null,2));
  console.log(JSON.stringify({done:r.done,proof:r.proof,searchComplete:r.searchComplete,elapsed_ms:r.elapsed_ms,stats:r.stats,activeLine:r.activeLine,completedRoots:r.rootChecks}));
 }catch(e){console.error(e.message);}
});
