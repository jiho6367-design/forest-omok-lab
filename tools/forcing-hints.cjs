// Recheck a previous VCF attack order under the current board and unchanged
// rules. Failure is only a missed hint, never evidence that no win exists.
function replay(E,board,p,line,maxPlies,deadline){
 const b=board.slice(),pv=[];
 for(let k=0;k<line.length;k+=2){
  if(Date.now()>=deadline)return null;
  const own=E.winning(b,p);
  if(own.length&&pv.length+1<=maxPlies)return {pv:[...pv,own[0]],finish:'five'};
  if(maxPlies-pv.length<3)return null;
  const i=line[k],shape=E.inspect(b,i,p);
  if(!shape.legal||!shape.fours.length)return null;
  b[i]=p;
  if(E.winning(b,3-p).length)return null;
  const threats=E.winning(b,p);
  if(threats.length>1){
   const block=threats.find(j=>E.inspect(b,j,3-p).legal);
   return {pv:[...pv,...(block==null?[i,threats[0]]:[i,block,threats.find(j=>j!==block)])],finish:'double',endpoints:threats};
  }
  if(threats.length!==1)return null;
  const block=threats[0];
  if(!E.inspect(b,block,3-p).legal)return {pv:[...pv,i,block],finish:'forbidden-block',endpoints:threats};
  b[block]=3-p;pv.push(i,block);
 }
 return null;
}
module.exports=function createForcingHints(E,cache=new Map()){
 const hints=[[],[],[]],stats={attempts:0,hits:0};
 function forcing(b,p,depth,budget){
  const start=Date.now(),end=start+budget,key=b.join('')+p+':'+depth;
  // Respect exact-board cache results before trying related-board hints.
  if(budget>=40&&!cache.has(key)){
   const hintEnd=Math.min(end,start+Math.min(20,budget*.1));
   for(const line of hints[p]){
    if(Date.now()>=hintEnd)break;
    stats.attempts++;
    const proof=replay(E,b,p,line,depth,hintEnd);
    if(proof){stats.hits++;return {proof,complete:true,nodes:0,hinted:true};}
   }
  }
  const remaining=end-Date.now();
  if(remaining<=0)return {proof:null,complete:false,nodes:0};
  const r=E.forcing(b,p,depth,remaining,cache);
  if(r.proof){
   const line=r.proof.pv.slice(),id=line.join(',');
   hints[p]=[line,...hints[p].filter(x=>x.join(',')!==id)].slice(0,4);
  }
  return r;
 }
 return {forcing,stats};
};
module.exports.replay=replay;
