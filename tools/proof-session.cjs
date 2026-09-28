// Resumable offline threat search. The private generator retains the current
// AND/OR branch across time slices; interruption never becomes a negative fact.
const createEngine=require('../src/node-engine.cjs');
module.exports=function createProofSession(input){
 const spec=JSON.parse(JSON.stringify(input)),E=createEngine(spec.rules||{fivePriority:false});
 const attacker=spec.attacker||2,defender=3-attacker,first=spec.first||1;
 const quiet=spec.quietDepth??2,extensions=spec.extensions??8;
 if(![1,2].includes(attacker)||![1,2].includes(first)||!Number.isInteger(quiet)||quiet<0||!Number.isInteger(extensions)||extensions<0||extensions>16)throw Error('Invalid search settings');
 const index=c=>{if(!/^[A-O](?:[1-9]|1[0-5])$/.test(c))throw Error('Invalid coordinate');return (+c.slice(1)-1)*15+c.charCodeAt(0)-65;};
 const b=Array(225).fill(0),moves=spec.prefix.trim().split(/\s+/).filter(Boolean);
 moves.forEach((c,k)=>{const p=k%2?3-first:first,i=index(c),s=E.inspect(b,i,p);if(!s.legal||s.win.length)throw Error('Invalid prefix');b[i]=p;});
 if((moves.length%2?3-first:first)!==attacker)throw Error('Attacker must move next');
 const roots=spec.roots?new Set(spec.roots.map(index)):null;
 if(roots&&(!roots.size||[...roots].some(i=>!E.inspect(b,i,attacker).legal)))throw Error('Invalid root selection');
 const cache=new Map(),vcfCache=new Map(),rootChecks=[],activeLine=[],counterAudit=[],incompleteVcf=[];
 const stats={nodes:0,defenses:0,cacheHits:0,vcfChecks:0,vcfRetries:0,vcfIncomplete:0,forcingExtensions:0,defenseExtensions:0,threeExtensions:0,immediatePrunes:0,counterVcfChecks:0,counterVcfPrunes:0,counterVcfIncomplete:0,certifiedPrunes:0,slices:0};
 let deadline=0,done=false,proof=null;
 function candidates(){
  const out=new Set(E.candidates(b));
  for(let i=0;i<225;i++)if(b[i]===attacker)for(const [dx,dy]of E.D)for(let step=-4;step<=4;step++){
   const x=i%15+dx*step,y=(i/15|0)+dy*step;
   if(step&&x>=0&&x<15&&y>=0&&y<15&&!b[y*15+x])out.add(y*15+x);
  }
  return [...out];
 }
 function* attacks(ply,left,ext,mandatory){
  const bad=new Map(E.knownRefutations(b,attacker).map(m=>[m.i,m])),rank=[];
  const threats=spec.immediatePruning===false?[]:E.winning(b,defender);
  for(const i of ply===0&&roots?[...roots]:candidates()){
   yield;
   if(bad.has(i)){stats.certifiedPrunes++;if(ply===0)rootChecks.push({move:E.coord(i),status:'certified_loss'});continue;}
   const s=E.inspect(b,i,attacker);if(!s.legal)continue;
   // At the quiet horizon solve() only explores wins or enabled extensions.
   // Other moves cannot be searched, so do not evaluate them.
   // A four still passes the existing legal winning-point check in solve().
   if(spec.horizonPruning!==false&&left<=0&&!s.win.length&&!(ext>0&&(i===mandatory||s.fours.length||spec.threeExtensions&&s.threes.length)))continue;
   b[i]=attacker;let score,reply;try{
    if(!s.win.length)reply=threats.find(j=>{if(b[j])return false;const t=E.inspect(b,j,defender);return t.legal&&t.win.length;});
    if(reply===undefined)score=E.evaluate(b,attacker);
   }finally{b[i]=0;}
   if(reply!==undefined){stats.immediatePrunes++;if(ply===0)rootChecks.push({move:E.coord(i),status:'unproved',unrefutedResponse:E.coord(reply),responseWins:true});continue;}
   rank.push({i,score:(s.win.length?1e9:0)+(s.fours.length?1e6:0)+(s.threes.length?1e4:0)+score});
  }
  return rank.sort((a,c)=>c.score-a.score||a.i-c.i).map(m=>m.i);
 }
 function* defenses(ply){
  const near=E.candidates(b),rank=[];
  for(const i of near){
   yield;
   const s=E.inspect(b,i,defender),t=E.inspect(b,i,attacker);let positional=0;
   if(ply===0&&s.legal){b[i]=defender;try{positional=Math.max(-3000,Math.min(3000,E.evaluate(b,defender)));}finally{b[i]=0;}}
   rank.push({i,score:(s.win.length?1e9:0)+(t.win.length?8e8:0)+(s.fours.length?1e6:0)+(t.fours.length?8e5:0)+(s.threes.length?1e4:0)+(t.threes.length?8e3:0)+positional});
  }
  const seen=new Set(near);
  return [...rank.sort((a,c)=>c.score-a.score||a.i-c.i).map(m=>m.i),...Array.from({length:225},(_,i)=>i).filter(i=>!seen.has(i))];
 }
 function* solve(left,ext,ply){
  yield;stats.nodes++;
  const key=b.join('')+'|'+left+'|'+ext;
  if(cache.has(key)){stats.cacheHits++;return cache.get(key);}
  const incompleteBefore=stats.vcfIncomplete;
  if(ply===0&&roots){const win=E.winning(b,attacker).find(i=>roots.has(i));if(win!==undefined)return {type:'five',move:E.coord(win)};}
  let forcing,probeMs=800;
  for(;;){
   yield;
   if(Date.now()>=deadline)continue;
   stats.vcfChecks++;
   forcing=E.forcing(b,attacker,25,Math.max(1,Math.min(probeMs,deadline-Date.now())),vcfCache);
   if(forcing.complete)break;
   if(Date.now()>=deadline)continue; // Retry only this interrupted leaf next slice.
   if(spec.retryIncompleteVcf&&probeMs===800){probeMs=1600;stats.vcfRetries++;continue;}
   stats.vcfIncomplete++;
   incompleteVcf.push({prefix:[...moves,...activeLine].join(' '),attacker,first,rules:spec.rules||{fivePriority:false},vcfDepth:25,quietLeft:left,extensionsLeft:ext});
   return null; // Internal VCF cap, never cache as refuted.
  }
  if(forcing.proof&&!(ply===0&&roots&&!roots.has(forcing.proof.pv[0]))){
   const result={type:'forcing',pv:forcing.proof.pv.map(E.coord)};cache.set(key,result);return result;
  }
  if(left<=0&&ext<=0){cache.set(key,null);return null;}
  const threats=spec.forcedDefenseExtensions&&ext>0?E.winning(b,defender):[];
  const mandatory=threats.length===1?threats[0]:null;
  for(const move of yield* attacks(ply,left,ext,mandatory)){
   yield;
   const shape=E.inspect(b,move,attacker),before=stats.vcfIncomplete;
   b[move]=attacker;activeLine.push(E.coord(move));
   try{
    if(shape.win.length)return {type:'five',move:E.coord(move)};
    const defense=ext>0&&move===mandatory;
    // A legal open three is an optional bounded extension, not a forced
    // opponent reply. Every legal defense still goes through the AND loop.
    const three=!!spec.threeExtensions&&ext>0&&shape.threes.length>0;
    const extend=defense||three||ext>0&&shape.fours.length>0&&E.winning(b,attacker).length>0;
    if(left<=0&&!extend)continue;
    if(spec.counterVcfPruning){
     yield;
     stats.counterVcfChecks++;
     const counter=E.forcing(b,defender,19,Math.max(1,Math.min(20,deadline-Date.now())),vcfCache);
     if(counter.proof){
      stats.counterVcfPrunes++;
      if(spec.auditCounterPrunes)counterAudit.push({prefix:[...moves,...activeLine].join(' '),attacker:defender,rules:spec.rules||{fivePriority:false},certificate:{move:E.coord(counter.proof.pv[0])}});
      if(ply===0)rootChecks.push({move:E.coord(move),status:'certified_loss',winningReply:E.coord(counter.proof.pv[0]),counterLine:counter.proof.pv.map(E.coord)});
      continue;
     }
     // Optional shortcut only: an interrupted counterprobe never prunes or
     // changes the completeness of the exhaustive search below.
     if(!counter.complete)stats.counterVcfIncomplete++;
    }
    if(extend)stats.forcingExtensions++;
    if(defense)stats.defenseExtensions++;
    if(three)stats.threeExtensions++;
    let all=true,count=0,response=null,exceptions=[];
    for(const i of yield* defenses(ply)){
     yield;
     const s=E.inspect(b,i,defender);if(!s.legal)continue;count++;stats.defenses++;
     if(s.win.length){all=false;response=E.coord(i);break;}
     b[i]=defender;activeLine.push(E.coord(i));let child;
     try{child=yield* solve(left-(extend?0:1),ext-(extend?1:0),ply+1);}finally{b[i]=0;activeLine.pop();}
     if(!child){all=false;response=E.coord(i);break;}
     if(child.type!=='forcing')exceptions.push({response:E.coord(i),proof:child});
    }
    if(ply===0)rootChecks.push({move:E.coord(move),status:all&&count?'proved':stats.vcfIncomplete===before?'unproved':'incomplete',unrefutedResponse:response});
    if(all&&count){const result={type:'quiet',move:E.coord(move),replies:count,exceptions};cache.set(key,result);return result;}
   }finally{b[move]=0;activeLine.pop();}
  }
  if(stats.vcfIncomplete===incompleteBefore)cache.set(key,null);
  return null;
 }
 const iterator=solve(quiet,extensions,0);
 return {run(ms=25000){
  if(!Number.isFinite(ms)||ms<0||ms>25000)throw Error('Slice must be 0..25000 ms');
  const start=Date.now();deadline=start+ms;if(ms>0&&!done)stats.slices++;
  while(!done&&Date.now()<deadline){const result=iterator.next();if(result.done){done=true;proof=result.value;}}
  return JSON.parse(JSON.stringify({done,proof:done?proof:null,searchComplete:done&&stats.vcfIncomplete===0,elapsed_ms:Date.now()-start,stats,rootChecks,incompleteVcf,activeLine:done?[]:activeLine,...(spec.auditCounterPrunes?{counterAudit}:{}),
   scope:{prefix:spec.prefix,attacker,quietDepth:quiet,extensions,forcedDefenseExtensions:!!spec.forcedDefenseExtensions,threeExtensions:!!spec.threeExtensions,retryIncompleteVcf:!!spec.retryIncompleteVcf,counterVcfPruning:!!spec.counterVcfPruning,horizonPruning:spec.horizonPruning!==false,roots:spec.roots||null,vcfDepth:25}}));
 }};
};
