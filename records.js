function parseOmokRecord(text,N=15){
  const makeEngine=typeof module!=='undefined'?require('./engine').createEngine:createEngine;
  if(typeof text!=='string'||!text.trim())throw Error('기보를 입력하세요.');
  const pattern=/(\d+)\.\s*(흑|백)\s*([A-S])(\d{1,2})\b/gi;
  const matches=[...text.matchAll(pattern)];
  if(!matches.length||text.replace(pattern,'').replace(/[\s·,;]/g,''))throw Error('기보 형식은 “1. 백 H8 · 2. 흑 G9”입니다.');
  const board=Array(N*N).fill(0),moves=[];let first=null;
  for(const [k,m]of matches.entries()){
    if(Number(m[1])!==k+1)throw Error(`${k+1}번째 수 번호가 빠졌거나 순서가 맞지 않습니다.`);
    const p=m[2]==='흑'?1:2,x=m[3].toUpperCase().charCodeAt(0)-65,row=Number(m[4]),i=(N-row)*N+x;
    if(x<0||x>=N||row<1||row>N)throw Error(`${k+1}수 좌표가 ${N}×${N} 판 밖입니다.`);
    if(k===0)first=p;else if(p!==(k%2?3-first:first))throw Error(`${k+1}수 돌 색이 번갈아 놓는 순서와 맞지 않습니다.`);
    const e=makeEngine(N,board),state=e.state();if(state.winners.length||state.full)throw Error(`${k+1}수 전에 이미 대국이 종료되었습니다.`);
    const info=e.moveInfo(i,p);if(!info.legal)throw Error(`${k+1}수 ${m[3].toUpperCase()+row}: ${info.reason==='occupied'?'이미 돌이 있습니다.':'3·3 금수입니다.'}`);
    board[i]=p;moves.push({i,p});
  }
  return {board,moves,first,next:moves.length%2?3-first:first};
}
function validateOmokAnalysis(N,board,p,result){
  const makeEngine=typeof module!=='undefined'?require('./engine').createEngine:createEngine;
  if(!result||!Array.isArray(result.moves))return false;
  for(const m of result.moves){if(!Array.isArray(m.pv)||!m.pv.length||m.pv[0]!==m.i)return false;let copy=board.slice();
    for(let k=0;k<m.pv.length;k++){const e=makeEngine(N,copy),q=k%2?3-p:p,i=m.pv[k],state=e.state();if(state.winners.length||state.full||!e.legal(i,q))return false;copy[i]=q;}
  }return true;
}
if(typeof module!=='undefined')module.exports={parseOmokRecord,validateOmokAnalysis};
