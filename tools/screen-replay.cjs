// Exhaustive legal-root VCF screen at selected historical plies.
// Survivors are unrefuted within this scope, never certified safe/winning.
const {replay}=require('../src/historical-analysis.cjs');
const createEngine=require('../src/node-engine.cjs');
function screenReplay(moves,plies,budget=25000){
  const rules={fivePriority:false},positions=replay(moves,rules).positions;
  const e=createEngine(rules),start=Date.now(),results=[];
  for(const ply of plies){
    if(!Number.isInteger(ply)||ply<1||ply>moves.length)throw Error('Invalid ply');
    const b=positions[ply-1].slice(),p=ply%2?1:2;
    const r={ply,actual:moves[ply-1],legal:0,refuted:[],unrefuted:[],incomplete:[],winning:[]};
    for(let i=0;i<225;i++){
      const shape=e.inspect(b,i,p);if(!shape.legal)continue;r.legal++;
      const move=e.coord(i),remain=budget-(Date.now()-start);
      if(shape.win.length){r.winning.push(move);continue;}
      if(remain<=0){r.incomplete.push(move);continue;}
      b[i]=p;let proof;
      try{proof=e.forcing(b,3-p,19,Math.min(500,remain));}finally{b[i]=0;}
      if(proof.proof)r.refuted.push({move,line:proof.proof.pv.map(e.coord)});
      else (proof.complete?r.unrefuted:r.incomplete).push(move);
    }
    r.actual_refutation=r.refuted.find(x=>x.move===moves[ply-1])||null;
    results.push(r);
  }
  return {rules,scope:'All legal roots; opponent VCF depth 19; no VCT safety claim',elapsed_ms:Date.now()-start,budget_ms:budget,results};
}
module.exports=screenReplay;
if(require.main===module){
  const moves=process.argv[2].split(/\s+/),plies=process.argv[3].split(',').map(Number);
  console.log(JSON.stringify(screenReplay(moves,plies,Number(process.argv[4])||25000),null,2));
}
