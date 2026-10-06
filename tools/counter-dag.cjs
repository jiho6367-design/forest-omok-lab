'use strict';
// Shared object references are retained as DAG references, without trusting
// a score or a suggested line as evidence for unvisited legal defenses.
module.exports=function serialize(proof,{attacker=1,roots=null}={}){
 const ids=new Map(),nodes=[];function visit(n){if(ids.has(n))return ids.get(n);const id=nodes.length;ids.set(n,id);nodes.push(null);nodes[id]=n.type==='vcf'?{id,type:'vcf',pv:n.pv}:{id,type:'move',i:n.i,forced:n.forced,branches:n.branches.map(v=>({i:v.i,child:visit(v.proof)}))};return id;}
 return roots?{attacker,roots:roots.map(v=>({i:v.i,child:visit(v.proof)})),nodes}:{attacker,entry:visit(proof),nodes};
};
