// Bounded ranking only; uses existing engine analysis and tactical checks.
const fs=require('node:fs'),create=require('../src/node-engine.cjs');
const E=create({fivePriority:true}),index=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const prefix='H8 G7 G6 H6 F8',board=Array(225).fill(0);
prefix.split(' ').forEach((c,k)=>{const p=k%2?2:1;if(!E.inspect(board,index(c),p).legal)throw Error(c);board[index(c)]=p;});
const candidates=E.candidates(board).filter(i=>E.inspect(board,i,2).legal);
const known=new Map(E.knownRefutations(board,2).map(r=>[r.i,r]));
if(!known.has(index('I7')))throw Error('Missing revalidated I7 certificate');
const report={prefix,rules:{fivePriority:true},started:new Date().toISOString(),generator:'engine.candidates filtered by inspect legality',candidateCount:candidates.length,candidates:candidates.map(E.coord),ranking:'Exclude proven losses; descending white score (negative of black engine score), static white evaluation for ties. Compare within the same round only. No safety proof.',rounds:[]};
const save=()=>fs.writeFileSync('reports/sixth-five-priority-comparison.json',JSON.stringify(report,null,2));
function assess(i,budget,round){
 const e=create({fivePriority:true}),after=board.slice(),shape=e.inspect(board,i,2);after[i]=2;
 const start=Date.now(),immediate=e.winning(after,1),ownWins=e.winning(after,2);
 const vcf=e.forcing(after,1,13,Math.min(250,Math.floor(budget*.1)));
 const vct=e.quietTrap(after,2,Math.min(600,Math.floor(budget*.1)),4,13,false);
 const result=e.analyze(after,1,Math.max(30,budget-(Date.now()-start)),[]);
 const loss=known.has(i)||immediate.length>0||!!vcf.proof||!!vct.proof||result.proven;
 return {move:e.coord(i),round,budget_ms:budget,elapsed_ms:Date.now()-start,status:loss?'PROVEN_LOSS':'UNRESOLVED',known_proven_loss:known.has(i),
 evaluation:-result.score,completed_depth:result.depth,black_reply:result.i==null?null:e.coord(result.i),pv:(result.pv||[]).map(e.coord),nodes:result.nodes,
 opponent_immediate_win:immediate.map(e.coord),opponent_vcf:{found:!!vcf.proof,complete:vcf.complete,pv:(vcf.proof?.pv||[]).map(e.coord)},
 opponent_vct:{found:!!vct.proof,complete:vct.complete,scope:'quietTrap width 4 / VCF depth 13 / no recursive counter',attack:vct.proof?e.coord(vct.proof.block):null},
 own_threats:{open_threes:shape.threes.length,fours:shape.fours.length,winning_points:ownWins.map(e.coord)},mandatory_reply_count:ownWins.filter(j=>e.inspect(after,j,1).legal).length,
 static_white_evaluation:e.evaluate(after,2),engine_proven_black:result.proven,engine_loss_proven_black:result.lossProven};
}
let pool=candidates;
for(const [round,budget,nextCount] of [[1,900,5],[2,6800,3],[3,14500,0]]){
 const rows=[];report.rounds.push({round,budget_ms:budget,rows});
 for(const i of pool){const r=assess(i,budget,round);rows.push(r);save();console.log(JSON.stringify({round,move:r.move,status:r.status,score:r.evaluation,depth:r.completed_depth,reply:r.black_reply,elapsed:r.elapsed_ms}));}
 const ranked=rows.filter(r=>r.status!=='PROVEN_LOSS').sort((a,b)=>b.evaluation-a.evaluation||b.static_white_evaluation-a.static_white_evaluation||index(a.move)-index(b.move));
 report.rounds.at(-1).ranked=ranked.map(r=>r.move);save();
 if(nextCount)pool=ranked.slice(0,nextCount).map(r=>index(r.move));else report.top3=ranked.slice(0,3);
}
report.finished=new Date().toISOString();save();console.log(JSON.stringify({top3:report.top3},null,2));
