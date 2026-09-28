// Offline historical analysis. Reuses the exact browser engine and rule set.
// Every worker owns an independent position; no tiny tree nodes are dispatched.
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const os=require('node:os');
const createEngine=require('./node-engine.cjs');
const MODES={fast:900,compare:3000,precise:8000,auto:8000,deep15:15000,deep25:25000};
const index=c=>{const m=/^([A-O])(1[0-5]|[1-9])$/.exec(c);if(!m)throw Error('Invalid coordinate: '+c);return (Number(m[2])-1)*15+m[1].charCodeAt(0)-65;};
const cpuCount=()=>os.availableParallelism?.()||os.cpus().length||1;
let measuredGain=null;
async function benchmarkWorkers(){
  if(measuredGain!=null)return measuredGain;
  const board=Array(225).fill(0);for(const [k,c] of 'H8 G7 G6 H6 F8 I7 E8 G8 F7'.split(' ').entries())board[index(c)]=k%2?2:1;
  const sample=async count=>{const start=Date.now(),jobs=Array.from({length:count},()=>new Promise(resolve=>{
    const w=new Worker(__filename,{workerData:{benchmark:{board,p:2,ms:100}}});let settled=false;
    const done=n=>{if(settled)return;settled=true;clearTimeout(timer);w.terminate();resolve(n);};
    const timer=setTimeout(()=>done(0),250);w.once('message',r=>done(r.nodes||0));w.once('error',()=>done(0));
  }));const nodes=(await Promise.all(jobs)).reduce((a,b)=>a+b,0);return nodes*1000/Math.max(1,Date.now()-start);};
  const one=await sample(1),two=await sample(2);measuredGain=one?two/one:0;return measuredGain;
}
function workerPolicy({logical=cpuCount(),load=null,throughputGain=0,requested}={}){
  if(requested===1||logical<=2)return 1;
  const reserve=logical<=4?2:Math.max(2,Math.ceil(logical/3));
  const ceiling=Math.min(2,Math.max(1,logical-reserve));
  // Parallel historical positions are used only after a measured benefit.
  return ceiling>1&&throughputGain>=1.25&&(load==null||load<0.7)?2:1;
}
function replay(moves,options={fivePriority:false}){
  const engine=createEngine(options),board=Array(225).fill(0),positions=[];
  for(let k=0;k<moves.length;k++){
    const c=typeof moves[k]==='string'?moves[k]:moves[k].coord;
    const p=k%2?2:1,i=index(c),shape=engine.inspect(board,i,p);
    if(!shape.legal)throw Error(`Illegal move ${k+1}: ${c} (${shape.reason})`);
    positions.push(board.slice());board[i]=p;
    if(shape.win.length&&k<moves.length-1)throw Error(`Moves after game end: ${k+1}`);
  }
  return {board,positions};
}
function analyzePosition({board,moveNumber,actual,loser,ms,rules,forcedCandidates=[]}){
  const engine=createEngine(rules),p=loser,started=Date.now();
  const knownRefutations=new Map(engine.knownRefutations(board,p).map(x=>[x.i,x]));
  const legal=i=>engine.inspect(board,i,p).legal;
  const names=new Set([actual,...forcedCandidates]);
  const searchMs=Math.max(30,Math.floor(ms*.2));
  let completed=null;
  const search=engine.analyze(board,p,searchMs,[],r=>{if(r.depth>0||r.proven||r.lossProven)completed=r;});
  completed=search;
  for(const m of (search.candidates||[]).slice(0,2))names.add(engine.coord(m.i));
  if(search.i!=null)names.add(engine.coord(search.i));
  const candidates=[];
  for(const c of names){
    const i=index(c),shape=engine.inspect(board,i,p);
    if(!shape.legal){candidates.push({move:c,legal:false,level:null,reason:shape.reason});continue;}
    // The game ends at this move. Do not let a hypothetical opponent turn
    // override an already completed legal five.
    if(shape.win.length){candidates.push({move:c,legal:true,level:4,reason:'합법적인 정확한 5목 완성',
      black_vcf_complete:true,black_vcf_nodes:0,black_line:[],white_line:[],
      strongest_reply:null,reply_forcing:false,reply_scope:'대국 종료',
      counter_vcf_if_unanswered:null,evaluation:1e8});continue;}
    const after=board.slice();after[i]=p;
    const known=knownRefutations.get(i);
    const remain=()=>Math.max(1,ms-(Date.now()-started)-12);
    const proof=engine.forcing(after,3-p,19,Math.min(240,remain()));
    const whiteWins=engine.winning(after,p),blackWins=engine.winning(after,3-p);
    const legalBlocks=whiteWins.filter(j=>engine.inspect(after,j,3-p).legal);
    // The opponent moves next. A white VCF starting on this board is only an
    // attack opportunity; it is not a forced win unless every reply is covered.
    const forcedWin=!blackWins.length&&(whiteWins.length>=2||whiteWins.length===1&&!legalBlocks.length);
    let reply=null,followup=null;
    if(whiteWins.length===1&&legalBlocks.length===1){
      reply=legalBlocks[0];const defended=after.slice();defended[reply]=3-p;
      followup=engine.forcing(defended,p,13,Math.min(120,remain()));
    }else if(known)reply=known.attack;
    else if(!proof.proof&&!forcedWin&&remain()>80){
      const counter=engine.analyze(after,3-p,Math.min(100,remain()-20));
      reply=counter.i;
    }
    let counterRisk=null,defenseCandidate=null;
    if(reply!=null&&!known&&!proof.proof&&remain()>35){
      const replied=after.slice();replied[reply]=3-p;
      const probe=engine.forcing(replied,3-p,13,Math.min(90,remain()));
      if(probe.proof){counterRisk=probe.proof.pv.map(engine.coord);
        if(remain()>35){const rebuttal=engine.forcedReplyTrap(after,p,Math.min(120,remain()),reply,13,false);
          if(rebuttal.complete&&rebuttal.unrefutedReply!=null)defenseCandidate=engine.coord(rebuttal.unrefutedReply);}
      }
    }
    // A missing proof is never a global safety certificate.
    const blackLine=proof.proof?.pv.map(engine.coord)||(known?[engine.coord(known.attack)]:[]);
    const whiteLine=followup?.proof?.pv.map(engine.coord)||[];
    const level=proof.proof||known?0:forcedWin||(!blackWins.length&&followup?.proof)?4:1;
    candidates.push({move:c,legal:true,level,reason:proof.proof?'상대의 연속 4 강제승 증명':known?known.reason:forcedWin?'상대의 모든 합법 방어를 넘는 즉시 승리':level===4?'상대의 유일 방어 뒤 연속 4 강제승 증명':
      whiteWins.length?'백의 위협 생성 · 흑의 방어 뒤 전체 승리 미증명':counterRisk?'흑 응수 뒤 추가 연속 4 위협 · 방어 미증명':'즉시 강제승 미발견 · 전체 무패 미증명',
      black_vcf_complete:proof.complete,black_vcf_nodes:proof.nodes,black_line:blackLine,white_line:whiteLine,
      strongest_reply:reply==null?null:engine.coord(reply),reply_forcing:!!followup?.proof,
      reply_scope:whiteWins.length===1?'필수 방어':known?'검증된 반증 시작':reply==null?'미검증':'제한 탐색 후보',
      counter_vcf_if_unanswered:counterRisk,
      defense_candidate:defenseCandidate,defense_scope:defenseCandidate?'검사한 연속 4 반증이 없는 합법 응수 · 무패 미증명':null,
      evaluation:engine.evaluate(after,p)});
  }
  candidates.sort((a,b)=>(b.level??-1)-(a.level??-1)||b.evaluation-a.evaluation);
  const actualResult=candidates.find(x=>x.move===actual);
  const alternate=candidates.find(x=>x.move!==actual&&x.legal)||null;
  return {move_number:moveNumber,actual_move:actual,actual:actualResult,recommended:alternate,
    position_loss_proven:!!engine.certifiedLoss(board,p),
    candidates,search:{elapsed_ms:Date.now()-started,completed_depth:completed.depth||0,
      nodes:completed.nodes||0,nodes_per_second:Math.round((completed.nodes||0)*1000/Math.max(1,Date.now()-started)),
      candidate_count:candidates.length,best_move:completed.i==null?null:engine.coord(completed.i),
      method:'VCF + limited alpha-beta',tt_hit_rate:completed.ttHitRate??null,vcf_checks:candidates.length,workers:1}};
}
async function analyze_game(moves,loser='white',mode='auto',opts={}){
  const player=loser==='white'?2:loser==='black'?1:loser;
  if(![1,2].includes(player))throw Error('Invalid loser');
  const ms=typeof mode==='number'?mode:MODES[mode];if(!ms)throw Error('Unknown mode');
  const rules=opts.rules||{fivePriority:false},start=Date.now();
  const {positions}=replay(moves,rules),list=[];
  for(let k=0;k<moves.length;k++)if((k%2?2:1)===player){
    const actual=typeof moves[k]==='string'?moves[k]:moves[k].coord;
    list.push({board:positions[k],moveNumber:k+1,actual,loser:player,rules,
      forcedCandidates:k===9?['F9']:k===19?['G9']:k===11?['F6']:[]});
  }
  const logical=opts.logicalProcessors||cpuCount();
  const gain=opts.throughputGain??(opts.workers===1||ms<8000||logical<6?0:await benchmarkWorkers());
  const workers=workerPolicy({logical,load:opts.load,throughputGain:gain,requested:opts.workers});
  const perTask=Math.max(40,Math.floor((ms-(Date.now()-start)-200)*workers/list.length));
  const results=new Array(list.length),order=[...list.keys()].sort((a,b)=>{
    const priority=n=>n===4?-3:n===9?-2:n===5?-1:n;
    return priority(a)-priority(b);
  });let cursor=0;
  async function run(){while(cursor<order.length){const n=order[cursor++],job=list[n],remaining=ms-(Date.now()-start)-30;
    if(remaining<=50){results[n]={move_number:job.moveNumber,actual_move:job.actual,timeout:true,candidates:[]};continue;}
    const taskMs=Math.min(perTask,Math.max(30,remaining-30));
    const w=new Worker(__filename,{workerData:{job:{...job,ms:taskMs}}});
    const result=await new Promise(resolve=>{let settled=false;const end=x=>{if(settled)return;settled=true;clearTimeout(timer);w.terminate();resolve(x);};
      const timer=setTimeout(()=>end({move_number:job.moveNumber,actual_move:job.actual,timeout:true,candidates:[]}),Math.min(taskMs+30,remaining));
      w.once('message',end);w.once('error',e=>end({move_number:job.moveNumber,error:String(e),candidates:[]}));});results[n]=result;
  }}
  await Promise.all(Array.from({length:workers},run));
  const verified=results.filter(r=>r?.recommended&&r.actual?.level===0&&r.recommended.level>0);
  const critical=results.find(r=>r?.recommended?.level===4)||verified[0]||results.find(r=>r?.recommended&&r.recommended.level>r.actual?.level)||null;
  const rec=critical?.recommended;
  return {critical_move_number:critical?.move_number??null,actual_move:critical?.actual_move??null,
    earliest_proven_lost_position:results.find(r=>r?.position_loss_proven)?.move_number??null,
    recommended_move:rec?.move??null,level:rec?.level??null,
    reason:critical?`${critical.actual?.reason}; ${rec.reason}`:'검증된 반증 대안 없음',
    main_line:rec?[`${critical.move_number}.${player===2?'W':'B'} ${rec.move}`,...(rec.strongest_reply?[`${critical.move_number+1}.${player===2?'B':'W'} ${rec.strongest_reply}`]:[]),
      ...(rec.white_line.length?rec.white_line:rec.defense_candidate?[rec.defense_candidate]:[]).map((c,k)=>`${critical.move_number+k+2}.${k%2?(player===2?'B':'W'):(player===2?'W':'B')} ${c}`)]:[],
    alternatives:results,search:{elapsed_ms:Date.now()-start,mode,budget_ms:ms,workers,
      completed_depth:Math.max(0,...results.map(r=>r.search?.completed_depth||0)),nodes:results.reduce((a,r)=>a+(r.search?.nodes||0),0),
      nodes_per_second:Math.round(results.reduce((a,r)=>a+(r.search?.nodes||0),0)*1000/Math.max(1,Date.now()-start)),
      method:'VCF + limited alpha-beta',tt_hit_rate:null}};
}
if(isMainThread)module.exports={analyze_game,analyzePosition,replay,workerPolicy,benchmarkWorkers,MODES,index};
else if(workerData.benchmark){const {board,p,ms}=workerData.benchmark;parentPort.postMessage({nodes:createEngine({fivePriority:false}).analyze(board,p,ms).nodes||0});}
else parentPort.postMessage(analyzePosition(workerData.job));
