const fs=require('node:fs');
const [beforeFile,afterFile]=process.argv.slice(2);
const before=JSON.parse(fs.readFileSync(beforeFile)),after=JSON.parse(fs.readFileSync(afterFile));
const key=r=>[r.position,r.mode,r.repeat].join('/');
const old=new Map(before.rows.map(r=>[key(r),r]));
const result={before:before.label,after:after.label,rows:after.rows.length,invalid:[],proofChanges:[],moveChanges:[],depthChanges:[],unstableGroups:[],timeouts:[],budgetOverruns:[]};
for(const r of after.rows){
 const b=old.get(key(r));
 if(r.error||r.invalid)result.invalid.push({key:key(r),error:r.error,invalid:r.invalid});
 if(b&&(r.proven!==b.proven||r.lossProven!==b.lossProven))result.proofChanges.push({key:key(r),before:[b.proven,b.lossProven],after:[r.proven,r.lossProven]});
 if(b&&r.best_move!==b.best_move)result.moveChanges.push({key:key(r),before:b.best_move,after:r.best_move,depth:[b.depth,r.depth]});
 if(b&&r.depth!==b.depth)result.depthChanges.push({key:key(r),before:b.depth,after:r.depth});
 if(r.timeout)result.timeouts.push(key(r));
 if(r.actual_elapsed_ms>r.planned_budget_ms+100)result.budgetOverruns.push({key:key(r),ms:r.actual_elapsed_ms,budget:r.planned_budget_ms});
}
for(const p of after.positions)for(const m of after.modes){const rows=after.rows.filter(r=>r.position===p.id&&r.mode===m.id),moves=[...new Set(rows.map(r=>r.best_move))];if(moves.length>1)result.unstableGroups.push({position:p.id,mode:m.id,moves});}
fs.writeFileSync(afterFile.replace('.json','-comparison.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if(result.invalid.length||result.proofChanges.length)process.exitCode=1;
