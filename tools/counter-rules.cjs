'use strict';module.exports=board=>{const b=board.slice(),D=[[1,0],[0,1],[1,1],[1,-1]];
 const at=(x,y)=>x>=0&&x<15&&y>=0&&y<15?b[y*15+x]:3,check=()=>{};
 const exact=(i,p)=>D.some(([dx,dy])=>{let n=1;for(const sign of [-1,1])for(let k=1;at(i%15+sign*k*dx,(i/15|0)+sign*k*dy)===p;k++)n++;return n===5;});
 function legal(i,p){if(!Number.isInteger(i)||i<0||i>=225||b[i])return false;b[i]=p;try{if(exact(i,p))return true;let axes=0;for(const [dx,dy]of D){let three=false;for(let start=-3;start<=0&&!three;start++){const pre=at(i%15+(start-1)*dx,(i/15|0)+(start-1)*dy),post=at(i%15+(start+4)*dx,(i/15|0)+(start+4)*dy);if(pre||post)continue;let own=0,empty=0,blocked=false;for(let k=start;k<start+4;k++){const v=at(i%15+k*dx,(i/15|0)+k*dy);if(v===p)own++;else if(v===0)empty++;else blocked=true;}if(!blocked&&own===3&&empty===1)three=true;}if(three&&++axes>=2)return false;}return true;}finally{b[i]=0;}}
 function wins(p){const out=[];for(let i=0;i<225;i++)if(!b[i]){b[i]=p;if(exact(i,p))out.push(i);b[i]=0;}return out;}
return{legal,wins,exact,board:b,put:(i,p)=>{b[i]=p;},clear:i=>{b[i]=0;}};};
