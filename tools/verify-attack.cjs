// Verify a prescribed attack tree independently of the discovery move order.
// Every legal defender move is visited. Omitted branches require a fresh VCF.
const createEngine=require('../src/node-engine.cjs');
const {replay,outcome}=require('./strategy/replay.cjs');
function runVerification(spec,budget,completed){
  const E=createEngine(spec.rules||{fivePriority:false}),attacker=spec.attacker||1,defender=3-attacker;
  const idx=c=>{if(!/^[A-O](?:[1-9]|1[0-5])$/.test(c))throw Error('Invalid coordinate '+c);return (+c.slice(1)-1)*15+c.charCodeAt(0)-65;};
  const moves=spec.moves||(spec.prefix||'').trim().split(/\s+/).filter(Boolean),firstPlayer=spec.firstPlayer??1;
  const position=replay(E,{moves,firstPlayer,board:spec.board,p:spec.p});
  const b=position.board,start=Date.now();let defenses=0,vcf=0,cached=0;
  if(position.winner||outcome(E,b,position.p)?.reason==='played-exact-five')throw Error('Invalid terminal prefix');
  if(position.p!==attacker)throw Error('Wrong attacker turn');
  let failureLine=[];
  function check(tree,line=[]){
    failureLine=[...line,tree.move];
    if(Date.now()-start>=budget)throw Error('Verification timeout');
    const a=idx(tree.move),s=E.inspect(b,a,attacker);if(!s.legal)throw Error('Illegal attack '+tree.move);
    b[a]=attacker;
    try{
      if(s.win.length)return;
      let replies=0;
      for(let i=0;i<225;i++){
        if(Date.now()-start>=budget)throw Error('Verification timeout');
        const r=E.inspect(b,i,defender);if(!r.legal)continue;
        failureLine=[...line,tree.move,E.coord(i)];
        replies++;defenses++;if(r.win.length)throw Error('Defender wins at '+E.coord(i));
        b[i]=defender;
        try{
          const child=tree.replies?.[E.coord(i)];
          const key=b.join('')+'|'+JSON.stringify(child||null);
          if(completed.has(key)){cached++;continue;}
          if(child)check(child,[...line,tree.move,E.coord(i)]);
          else{vcf++;const proof=E.forcing(b,attacker,25,Math.min(1000,budget-(Date.now()-start)));
            if(!proof.proof)throw Error((proof.complete?'Unrefuted reply ':'VCF timeout at ')+E.coord(i));}
          completed.add(key);
        }finally{b[i]=0;}
      }
      if(!replies)throw Error('No defender moves is not an exact-five win');
    }finally{b[a]=0;}
  }
  try{check(spec.certificate);return {verified:true,defenses,vcf,cached,elapsed_ms:Date.now()-start};}
  catch(e){return {verified:false,reason:e.message,variation:failureLine,defenses,vcf,cached,elapsed_ms:Date.now()-start};}
}
function verifyAttack(spec,budget=25000){return runVerification(spec,budget,new Set());}
// A session owns its checked branches; callers cannot supply fabricated cache
// entries. Only complete proofs are retained. Each run still has its own cap.
verifyAttack.createSession=spec=>{
  const frozen=JSON.parse(JSON.stringify(spec)),completed=new Set();
  return {run:(budget=25000)=>runVerification(frozen,budget,completed)};
};
module.exports=verifyAttack;
if(require.main===module){const spec=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
  const r=verifyAttack(spec,Number(process.argv[3])||25000);console.log(JSON.stringify(r,null,2));if(!r.verified)process.exitCode=1;}
