// Independent, single-thread DFPN. Rules are exclusively the existing engine's.
const createEngine = require('../src/node-engine.cjs');
const INF = 1e12;
const STOP = Symbol('dfpn-stop');
const idx = c => {
  if (!/^[A-O](?:[1-9]|1[0-5])$/.test(c)) throw Error('Invalid coordinate');
  return (+c.slice(1)-1)*15+c.charCodeAt(0)-65;
};
module.exports = function createDFPN(input) {
  const rules = {...(input.rules || {fivePriority:false})};
  const E = createEngine(rules), attacker = input.attacker || 1;
  if (![1,2].includes(attacker)) throw Error('Invalid attacker');
  const board = input.board ? Array.from(input.board) : Array(225).fill(0);
  if (board.length !== 225 || board.some(p=>![0,1,2].includes(p))) throw Error('Invalid board');
  let side = input.side || input.first || 1, rootWinner = null;
  if (![1,2].includes(side)) throw Error('Invalid side');
  if (input.board && input.prefix) throw Error('Specify board or prefix');
  const moves = input.prefix?.trim().split(/\s+/).filter(Boolean) || [];
  for (const [k,c] of moves.entries()) {
    const i=idx(c), s=E.inspect(board,i,side);
    if (!s.legal || rootWinner) throw Error('Illegal or post-terminal prefix');
    board[i]=side;
    if (s.win.length) rootWinner=side;
    side=3-side;
  }
  if (input.board) {
    const winners = new Set();
    board.forEach((p,i)=>{if(p&&E.win(board,i,p).length)winners.add(p);});
    if(winners.size>1)throw Error('Both sides already won');
    rootWinner=[...winners][0]||null;
  }
  const rootSide=side, table=new Map();
  // Finite initial estimate for deferred OR alternatives. This prioritizes
  // proving one promising move, without dropping any alternative. Non-win
  // still requires exhausting them all. Zero/INF are reserved for solved facts.
  const deferredProof = input.deferredProof ?? 1000000;
  if(!Number.isFinite(deferredProof)||deferredProof<1||deferredProof>=INF)throw Error('Invalid deferred estimate');
  // Same exact board-string key used by the existing proof-session; include turn.
  const key=p=>board.join('')+'|'+p;
  const preferred=new Map();
  // Certificates supply ordering ONLY, never terminal facts or cached wins.
  if(input.orderingCertificate){
    const walk=(tree,p)=>{
      preferred.set(key(p),idx(tree.move));
      const a=idx(tree.move),s=E.inspect(board,a,p);if(!s.legal)return;
      board[a]=p;
      try{for(const [c,child] of Object.entries(tree.replies||{})){
        const j=idx(c);if(!E.inspect(board,j,3-p).legal)continue;
        board[j]=3-p;try{walk(child,p);}finally{board[j]=0;}
      }}finally{board[a]=0;}
    };walk(input.orderingCertificate,attacker);
  }
  const stats={nodes:0,expansions:0,legalEdges:0,illegalMoves:0,ttHits:0,iterations:0,tacticalTerminals:0,runs:0};
  let deadline=0,nodeLimit=Infinity,cancel=null,stopReason=null,totalMs=0;
  function check(){
    if(cancel?.aborted){stopReason='cancelled';throw STOP;}
    if(Date.now()>=deadline){stopReason='timeout';throw STOP;}
  }
  function solved(n,winner,reason){n.pn=winner===attacker?0:INF;n.dn=winner===attacker?INF:0;n.terminal=reason;}
  function node(p,winner=null){
    const k=key(p);let n=table.get(k);
    if(n){stats.ttHits++;return n;}
    check();if(stats.nodes>=nodeLimit){stopReason='node-limit';throw STOP;}
    n={key:k,p,pn:1,dn:1,children:[],cursor:0,order:null,done:false,initialized:false};
    if(winner)solved(n,winner,'exact-five');
    table.set(k,n);stats.nodes++;return n;
  }
  function init(n){
    if(n.initialized||n.terminal)return;
    check();
    // Existing winning() includes legality. A legal immediate win ends the game.
    const wins=E.winning(board,n.p);check();
    if(wins.length){solved(n,n.p,'legal-immediate-win');n.winningMove=wins[0];stats.tacticalTerminals++;return;}
    const blocks=new Set(E.winning(board,3-n.p));check();
    const near=E.candidates(board),nearSet=new Set(near),preferredMove=preferred.get(n.key);
    // Candidate region first. Every other empty point is retained lazily.
    const ordered=near.map(i=>{
      const s=E.inspect(board,i,n.p);
      return {i,priority:(i===preferredMove?1e6:0)+(blocks.has(i)?1e5:0)+s.fours.length*1000+s.threes.length*100};
    }).sort((a,b)=>b.priority-a.priority||a.i-b.i).map(x=>x.i);
    n.order=[...ordered,...board.map((v,i)=>!v&&!nearSet.has(i)?i:-1).filter(i=>i>=0)];
    n.initialized=true;stats.expansions++;
  }
  const sum=xs=>xs.reduce((a,b)=>Math.min(INF,a+b),0);
  function values(n){
    if(n.terminal)return;
    const ps=n.children.map(x=>x.n?.pn??1),ds=n.children.map(x=>x.n?.dn??1);
    // One unknown aggregate stands for all still-unexamined moves. It can
    // never be removed without exhausting the complete legal move set.
    if(!n.done){ps.push(n.p===attacker?deferredProof:1);ds.push(1);}
    if(!ps.length){
      if(n.order.length===0)solved(n,null,'full-board-draw');
      else{n.pn=1;n.dn=1;n.terminal='no-legal-move-rule-unspecified';}
      return;
    }
    if(n.p===attacker){n.pn=Math.min(...ps);n.dn=sum(ds);}
    else{n.pn=sum(ps);n.dn=Math.min(...ds);}
  }
  function add(n){
    while(n.cursor<n.order.length){
      check();const i=n.order[n.cursor],s=E.inspect(board,i,n.p);
      n.cursor++;
      if(!s.legal){stats.illegalMoves++;continue;}
      n.children.push({i,winner:s.win.length?n.p:null,n:null});stats.legalEdges++;return;
    }
    n.done=true;
  }
  function search(n,tp,td){
    check();init(n);values(n);
    while(n.pn<tp&&n.dn<td&&!n.terminal){
      check();stats.iterations++;
      const isOr=n.p===attacker;
      const options=n.children.map(x=>({x,v:isOr?(x.n?.pn??1):(x.n?.dn??1)}));
      if(!n.done)options.push({x:null,v:isOr?deferredProof:1});
      options.sort((a,b)=>a.v-b.v);
      const best=options[0];
      if(!best.x){add(n);values(n);continue;}
      const edge=best.x,second=options[1]?.v??INF;
      const cp=edge.n?.pn??1,cd=edge.n?.dn??1;
      const childTp=isOr?Math.min(tp,second+1):Math.min(INF,tp-n.pn+cp);
      const childTd=isOr?Math.min(INF,td-n.dn+cd):Math.min(td,second+1);
      board[edge.i]=n.p;
      try{if(!edge.n)edge.n=node(3-n.p,edge.winner);search(edge.n,childTp,childTd);}
      finally{board[edge.i]=0;}
      values(n);
    }
  }
  let root=null;
  return {run({ms=1000,maxNodes=100000,signal}={}){
    if(!Number.isFinite(ms)||ms<0||!Number.isInteger(maxNodes)||maxNodes<1)throw Error('Invalid limits');
    deadline=Date.now()+ms;const start=Date.now();nodeLimit=maxNodes;cancel=signal;stopReason=null;stats.runs++;
    try{check();if(!root)root=node(rootSide,rootWinner);search(root,INF,INF);}
    catch(e){if(e!==STOP)throw e;}
    totalMs+=Date.now()-start;
    const pn=root?.pn??1,dn=root?.dn??1;
    return {status:pn===0?'PROVEN_WIN':dn===0?'PROVEN_NONWIN':'UNRESOLVED',attacker,proofNumber:pn,disproofNumber:dn,
      complete:pn===0||dn===0,stopReason,elapsed_ms:Date.now()-start,total_ms:totalMs,stats:{...stats},
      scope:'All legal moves retained; region ordering only; no VCF/certificate proof oracle',
      rootMoves:root?.children.map(x=>({move:E.coord(x.i),pn:x.n?.pn??1,dn:x.n?.dn??1}))||[],
      pendingRootMoves:root?.order?root.order.length-root.cursor:null};
  }};
};
