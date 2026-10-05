'use strict';
const index=c=>{if(!/^[A-O](?:[1-9]|1[0-5])$/.test(c))throw Error('Invalid coordinate '+c);return (+c.slice(1)-1)*15+c.charCodeAt(0)-65;};
function replay(engine,{moves=[],firstPlayer=1,p,board}={}){
 if(![1,2].includes(firstPlayer))throw Error('Invalid firstPlayer');
 let b=Array(225).fill(0),turn=firstPlayer,winner=null,history=[];
 if(board&&!moves.length){if(board.length!==225||board.some(q=>![0,1,2].includes(q)))throw Error('Invalid board');b=board.slice();turn=p;if(![1,2].includes(turn))throw Error('Board requires current p');}
 for(const raw of moves){
  if(winner)throw Error('Moves after exact-five victory');
  const move=typeof raw==='string'?{coord:raw}:raw;
  if(move.p!=null&&move.p!==turn)throw Error('Wrong move color');
  if(move.coord==='PASS'||move.type==='timeout'||move.type==='pass'){history.push({p:turn,type:'pass',coord:'PASS'});turn=3-turn;continue;}
  const i=move.i??index(move.coord),shape=engine.inspect(b,i,turn);
  if(!shape.legal)throw Error('Illegal prefix '+(move.coord||engine.coord(i))+' '+shape.reason);
  b[i]=turn;history.push({p:turn,type:'move',i,coord:engine.coord(i)});if(shape.win.length)winner=turn;turn=3-turn;
 }
 if(p!=null&&turn!==p)throw Error('Wrong current side');
 return {board:b,p:turn,firstPlayer,winner,history};
}
function outcome(engine,board,p){
 for(let i=0;i<225;i++)if(board[i]){const b=board.slice(),q=b[i];b[i]=0;const s=engine.inspect(b,i,q);if(s.legal&&s.win.length)return {status:'completed',winner:q,reason:'played-exact-five'};}
 if(board.every(Boolean))return {status:'completed',winner:null,reason:'full-board'};
 if(!board.some((v,i)=>!v&&engine.inspect(board,i,p).legal))return {status:'unfinished',winner:null,reason:'no-legal-move'};
 return null;
}
module.exports={index,replay,outcome};
