'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex'),{replay,outcome}=require('./replay.cjs');
const root=path.resolve(__dirname,'../..'),baselineRoot=path.resolve(root,'../baseline'),manifestFile=path.join(__dirname,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
const manifestHash=sha(fs.readFileSync(manifestFile));
if(manifestHash!==fs.readFileSync(manifestFile+'.sha256','utf8').trim())throw Error('Frozen manifest changed');
const args=process.argv.slice(2),kind=args.shift()||'help',get=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
if(kind==='help'||kind==='--help'||args.includes('--help')){console.log('node tools/strategy/run.cjs fixed|arena|smoke --label NAME --minutes 60 --split development|holdout|known --repeats 2 --reply-ms 900 --modes fast,auto,deep25 --stage 1 --compute gpu|optimized|cpu');process.exit(0);}
if(!['fixed','arena','smoke'].includes(kind))throw Error('Unknown experiment kind');
const minutes=Math.max(.01,Math.min(60,Number(get('minutes',kind==='smoke'?.5:60)))),label=get('label','stage1');if(!/^[a-zA-Z0-9_-]+$/.test(label))throw Error('Invalid label');
const selectedModes=get('modes',kind==='smoke'?'fast':'fast,auto,deep25').split(','),split=get('split','development'),stage=Number(get('stage',1)),compute=get('compute','gpu'),repeats=kind==='smoke'?1:Math.max(1,Math.min(10,Number(get('repeats',2)))),replyMs=Math.max(900,Math.min(3000,Number(get('reply-ms',900))));
if(!selectedModes.every(m=>manifest.modes.some(mode=>mode.id===m)))throw Error('Unknown mode');
if(!Number.isFinite(minutes)||!Number.isFinite(replyMs)||!Number.isInteger(repeats)||!Number.isInteger(stage)||stage<1||stage>6)throw Error('Invalid finite stage/repeat/time setting');
if(!['development','holdout','known'].includes(split)||!['gpu','optimized','cpu'].includes(compute))throw Error('Invalid split or computation mode');
const {createBrowser}=require('./browser.cjs'),E=require(path.join(baselineRoot,'src/node-engine.cjs'))();
const archive=path.resolve(root,'../baseline-source.zip');if(fs.existsSync(archive)&&sha(fs.readFileSync(archive))!==manifest.baselineArchiveSha256)throw Error('Baseline archive changed');
const harnessHash=sha(['run.cjs','browser.cjs','replay.cjs'].map(f=>fs.readFileSync(path.join(__dirname,f),'utf8')).join('\n'));
const directory=path.join(root,'reports/strategy'),file=path.join(directory,label+'-'+kind+'.json');fs.mkdirSync(directory,{recursive:true});
const checkpoint=state=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(state,null,2)+'\n');fs.renameSync(temp,file);};
const acceptance=(c,r)=>{const problems=[];if(!r||r.i==null)return ['missing-recommendation'];const coord=E.coord(r.i);
 if(c.acceptance.required&&!c.acceptance.required.includes(coord))problems.push('required-defense-missed');
 if(c.acceptance.avoid?.includes(coord)&&!r.lossProven)problems.push('known-tactical-trap-selected');
 if(!E.inspect(c.board,r.i,c.p).legal)problems.push('illegal-move');return problems;};
function facts(board,p){const own=Array.from(E.winning(board,p)),enemy=Array.from(E.winning(board,3-p)),fourMoves=[],threeMoves=[];
 for(let i=0;i<225;i++){if(board[i])continue;const s=E.inspect(board,i,p);if(!s.legal||s.win.length)continue;
  if(s.fours.length)fourMoves.push({i,coord:E.coord(i),axes:Array.from(s.fours)});
  if(s.threes.length)threeMoves.push({i,coord:E.coord(i),axes:Array.from(s.threes)});
 }
 return {currentSide:p,ownWinningPoints:own.map(E.coord),opponentWinningPoints:enemy.map(E.coord),requiredBlock:!own.length&&enemy.length===1&&E.inspect(board,enemy[0],p).legal?E.coord(enemy[0]):null,
  independentLoss:!own.length&&(enemy.length>1||enemy.length===1&&!E.inspect(board,enemy[0],p).legal),legalFourMoves:fourMoves,legalThreeMoves:threeMoves,
  boundary:'Exact-five and current-move legality facts use frozen baseline house rules. Three/four axes are geometric shapes after a legal move; future extension legality is not established by this list. Shapes alone do not prove strategic validity, initiative, safety or victory.'};}
function extensionWitnesses(before,i,p){const shape=E.inspect(before,i,p),after=before.slice();after[i]=p;
 return Array.from(shape.details||[],d=>({axis:d.axis,three:Array.from(d.three||[],j=>{const s=E.inspect(after,j,p);return {coord:E.coord(j),legal:s.legal,reason:s.reason,exactFive:!!s.win.length};}),four:Array.from(d.four||[],j=>{const s=E.inspect(after,j,p);return {coord:E.coord(j),legal:s.legal,reason:s.reason,exactFive:!!s.win.length};})}));}
async function auditRow(row,c,spec,session,deadline,replyMs,save=()=>{}){
 const after=c.board.slice();after[row.result.i]=c.p;row.continuation=[{p:c.p,i:row.result.i,coord:E.coord(row.result.i)}];row.factsAfter=facts(after,3-c.p);
 row.initialMoveExtensionWitnesses=extensionWitnesses(c.board,row.result.i,c.p);row.extensionBoundary='Each listed extension was checked after the initial move under frozen rules. These are hypothetical same-player extensions, without assuming the opponent must cooperate.';
 const ended=outcome(E,after,3-c.p);if(ended){row.continuationStatus=ended.reason;row.auditComplete=true;return;}
 row.replyBranches=row.replyBranches||[];
 for(const replyVersion of ['baseline','improved']){
  let branch=row.replyBranches.find(b=>b.engine===replyVersion);
  if(branch&&branch.status&&branch.status!=='followup-stage-time-limit')continue;
  if(!branch){
   if(deadline-Date.now()<replyMs+600){row.continuationStatus='stage-time-limit';break;}
   const next=await session.analyze(replyVersion,{board:after,p:3-c.p,firstPlayer:c.firstPlayer,history:[...spec.history,...row.continuation]},replyMs);
   branch={engine:replyVersion,externalBudgetMs:replyMs,elapsedMs:next.elapsedMs,error:next.error,invalid:next.invalid,response:next.result,line:[...row.continuation]};row.replyBranches.push(branch);
   save();
  }
  if(branch.response?.i==null||branch.error||branch.invalid){branch.status='reply-unresolved';save();continue;}
  const move=branch.response.i,board=after.slice();board[move]=3-c.p;branch.line=[...row.continuation,{p:3-c.p,i:move,coord:E.coord(move)}];branch.factsAfterReply=facts(board,c.p);
  const replyEnd=outcome(E,board,c.p);if(replyEnd){branch.status=replyEnd.reason;branch.winner=replyEnd.winner;save();continue;}
  if(deadline-Date.now()<replyMs+600){branch.status='followup-stage-time-limit';save();continue;}
  const follow=await session.analyze('baseline',{board,p:c.p,firstPlayer:c.firstPlayer,history:[...spec.history,...branch.line]},replyMs),followMove=follow.result?.i;
  branch.followup={engine:'baseline',externalBudgetMs:replyMs,elapsedMs:follow.elapsedMs,result:follow.result,error:follow.error,invalid:follow.invalid};
  if(followMove==null||follow.error||follow.invalid){branch.status='followup-unresolved';save();continue;}
  board[followMove]=c.p;branch.line.push({p:c.p,i:followMove,coord:E.coord(followMove)});branch.factsAfterFollowup=facts(board,3-c.p);
  const followEnd=outcome(E,board,3-c.p);branch.status=followEnd?followEnd.reason:'bounded-three-plies-played';if(followEnd)branch.winner=followEnd.winner;save();
 }
 row.auditComplete=row.replyBranches.length===2&&row.replyBranches.every(b=>b.status&&b.status!=='followup-stage-time-limit');
 row.continuationStatus=row.auditComplete?'bounded-response-branches-recorded':'response-audit-incomplete';
}
function summarize(state){const games=state.games||[],completed=games.filter(g=>g.status==='completed'),result={scheduled:games.length,completed:completed.length,unfinished:games.filter(g=>g.status==='unfinished').length,pending:games.filter(g=>g.status==='pending').length,first:{wins:0,draws:0,losses:0},second:{wins:0,draws:0,losses:0}};
 for(const g of completed){const role=g.improvedFirst?'first':'second',improvedColor=g.improvedFirst?g.firstPlayer:3-g.firstPlayer;if(g.winner==null)result[role].draws++;else if(g.winner===improvedColor)result[role].wins++;else result[role].losses++;}return result;}
(async()=>{
 const started=Date.now(),deadline=started+minutes*60000,session=await createBrowser({baselineRoot,candidateRoot:root,compute,manifest});
 let state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,kind,label,manifestHash,harnessHash,createdAt:new Date().toISOString(),metadata:session.metadata,cacheConditions:'One verified shared pattern table prepared before timings; every analysis starts a fresh actual application Worker and fresh validation engine; no pondering or cross-request search cache.',cpu:{model:os.cpus()[0].model,logical:os.cpus().length},rows:[],games:manifest.games.map(g=>({...g,status:'pending',moves:[],interruptions:[],totalElapsedMs:0})),runs:[]};
 if(state.manifestHash!==manifestHash||state.harnessHash!==harnessHash||state.metadata.gpu.mode!==session.metadata.gpu.mode||state.metadata.browser!==session.metadata.browser||state.cpu.model!==os.cpus()[0].model||JSON.stringify(state.metadata.gpu.adapter||null)!==JSON.stringify(session.metadata.gpu.adapter||null)||JSON.stringify(state.metadata.versions)!==JSON.stringify(session.metadata.versions)){await session.close();throw Error('Engine/manifest/harness/browser/hardware/computation mode changed; use a new experiment label');}
 const run={startedAt:new Date().toISOString(),minutes,stage,selectedModes,split,repeats,replyMs,gpuPreparation:session.metadata.gpu,browser:session.metadata.browser,completedJobs:0,resumedAudits:0,stopReason:null};state.runs.push(run);checkpoint(state);
 try{
 if(kind==='fixed'||kind==='smoke'){
  const early=manifest.knownReplays.find(c=>c.id==='known-sixth');
  const known=[...manifest.knownReplays,{...early,id:'known-second',moves:early.moves.slice(0,1)},{...early,id:'known-fourth',moves:early.moves.slice(0,3)}].map(c=>{const position=replay(E,{moves:c.moves,firstPlayer:c.firstPlayer});return {...c,board:position.board,p:position.p,split:'known',category:'known',family:c.id==='known-second'||c.id==='known-fourth'?'known-sixth-early-prefixes':c.id,acceptance:{}};});
  const cases=kind==='smoke'?[manifest.cases.find(c=>c.id==='dev-B1')]:split==='known'?known:manifest.cases.filter(c=>c.split===split);
  const filter=get('cases',null);const chosen=filter?cases.filter(c=>filter.split(',').includes(c.id)):cases;
  state.scheduledFixed=state.scheduledFixed||[];for(const c of chosen)for(const mode of manifest.modes.filter(m=>selectedModes.includes(m.id)))for(let repeat=0;repeat<repeats;repeat++)for(const version of ['baseline','improved']){const id=c.id+'/'+mode.id+'/'+repeat+'/'+version;if(!state.scheduledFixed.includes(id))state.scheduledFixed.push(id);}checkpoint(state);
  for(const mode of manifest.modes.filter(m=>selectedModes.includes(m.id)))for(const [caseNumber,c] of chosen.entries())for(let repeat=0;repeat<repeats;repeat++){
   const spec={board:c.board,p:c.p,firstPlayer:c.firstPlayer,history:replay(E,c).history},budget=await session.budget(spec,mode),limit=typeof budget==='object'?budget.ms:budget;
   for(const version of ((caseNumber+repeat)%2?['improved','baseline']:['baseline','improved'])){
    const id=c.id+'/'+mode.id+'/'+repeat+'/'+version,existing=state.rows.find(r=>r.id===id);if(existing){if(!existing.auditComplete&&existing.result?.i!=null&&!existing.invalid&&!existing.error){await auditRow(existing,c,spec,session,deadline,replyMs,()=>checkpoint(state));run.resumedAudits++;checkpoint(state);}continue;}
    if(deadline-Date.now()<limit+600){run.stopReason='stage-time-limit';break;}
    const job=await session.analyze(version,spec,budget),r=job.result;
    const row={id,case:c.id,split:c.split,category:c.category,family:c.family,repeat,mode:mode.id,version,firstPlayer:c.firstPlayer,currentSide:c.p,externalBudgetMs:limit,workerInternalBudgetMs:Math.max(30,limit-Math.min(1500,Math.max(60,limit*.06))),requestedPresetMs:mode.ms,automatic:mode.automatic,...job,acceptanceProblems:acceptance(c,r),independentProofStatus:r?.proven?(E.inspect(c.board,r.i,c.p).win.length?'played-exact-five-verified':'full-certificate-not-audited'):'not-claimed',continuation:[],replyBranches:[],continuationStatus:'not-started',factsBefore:facts(c.board,c.p),replyAuditBoundary:'Two engine responses under identical bounded budgets are preserved; neither response is certified strongest among every legal response.'};
    state.rows.push(row);run.completedJobs++;checkpoint(state);
    if(r?.i!=null&&!job.invalid&&!job.error)await auditRow(row,c,spec,session,deadline,replyMs,()=>checkpoint(state));else{row.auditComplete=true;row.continuationStatus='recommendation-unavailable';}
    checkpoint(state);console.log(JSON.stringify({id,move:r?.i==null?null:E.coord(r.i),depth:r?.depth,ms:Math.round(job.elapsedMs),invalid:job.invalid,acceptance:row.acceptanceProblems,branches:row.replyBranches.map(b=>b.line.map(m=>m.coord))}));
   }
  }
 }else{
  const selected=state.games.filter(g=>g.stage===stage&&selectedModes.includes(g.mode));
  for(const game of selected){if(game.status==='completed')continue;const opening=manifest.openings.find(o=>o.id===game.opening),mode=manifest.modes.find(m=>m.id===game.mode),position=replay(E,{firstPlayer:opening.firstPlayer,moves:[...opening.moves,...game.moves]});
   let board=position.board,p=position.p,history=position.history;const sliceStart=Date.now(),sliceEnd=Math.min(deadline,sliceStart+mode.sliceMs);game.status='unfinished';checkpoint(state);
   while(true){const ended=outcome(E,board,p);if(ended){game.status=ended.status;game.winner=ended.winner;game.reason=ended.reason;if(ended.status!=='completed')game.interruptions.push({at:new Date().toISOString(),reason:ended.reason,ply:history.length});break;}
    const spec={board,p,firstPlayer:opening.firstPlayer,history},budget=await session.budget(spec,mode),limit=typeof budget==='object'?budget.ms:budget;
    if(sliceEnd-Date.now()<limit+600){game.reason=sliceEnd===deadline?'stage-time-limit':'game-slice-limit';game.interruptions.push({at:new Date().toISOString(),reason:game.reason,ply:history.length});break;}
    const improvedColor=game.improvedFirst?opening.firstPlayer:3-opening.firstPlayer,version=p===improvedColor?'improved':'baseline',job=await session.analyze(version,spec,budget),r=job.result;
    if(!r||r.i==null||job.error||job.invalid){game.reason=job.invalid||job.error||'missing-recommendation';game.interruptions.push({at:new Date().toISOString(),reason:game.reason,ply:history.length});break;}
    const shape=E.inspect(board,r.i,p);if(!shape.legal){game.reason='illegal-recommendation';break;}
    const move={p,i:r.i,coord:E.coord(r.i),type:'move',engine:version,externalBudgetMs:limit,elapsedMs:job.elapsedMs,depth:r.depth,nodes:r.nodes,score:r.score,proven:!!r.proven,lossProven:!!r.lossProven,timedOut:!!r.timedOut,proofStatus:r.proofStatus,progressInvalid:job.progress.some(x=>!x.legal)};
    board[r.i]=p;game.moves.push(move);history.push(move);p=3-p;game.lastBoard=board.slice();game.currentSide=p;run.completedJobs++;checkpoint(state);
    if(shape.win.length){game.status='completed';game.winner=move.p;game.reason='played-exact-five';break;}
   }
   game.totalElapsedMs+=Date.now()-sliceStart;state.summary=summarize(state);checkpoint(state);console.log(JSON.stringify({game:game.id,status:game.status,reason:game.reason,plies:game.moves.length,winner:game.winner??null,summary:state.summary}));
   if(deadline-Date.now()<1000){run.stopReason='stage-time-limit';break;}
  }
 }
 }finally{run.finishedAt=new Date().toISOString();run.elapsedMs=Date.now()-started;state.arenaSummary=summarize(state);state.fixedSummary={scheduled:state.scheduledFixed?.length||0,completed:state.rows.length,pending:(state.scheduledFixed||[]).filter(id=>!state.rows.some(r=>r.id===id)).length,incompleteAudits:state.rows.filter(r=>!r.auditComplete).length,invalid:state.rows.filter(r=>r.invalid).length,errors:state.rows.filter(r=>r.error).length,tacticalAcceptanceFailures:state.rows.filter(r=>r.acceptanceProblems.length).length,unverifiedProofs:state.rows.filter(r=>r.independentProofStatus==='full-certificate-not-audited').length};state.summary=kind==='arena'?state.arenaSummary:state.fixedSummary;checkpoint(state);await session.close();}
 console.log(JSON.stringify({report:file,run,summary:state.summary}));
})().catch(error=>{console.error(error);process.exitCode=1;});
