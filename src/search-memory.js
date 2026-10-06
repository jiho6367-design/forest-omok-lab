/* Bounded, portable completed-node memory. A Worker may be killed at any time;
 * only records published before cancellation survive in the page session. */
const OmokSearchMemory=(()=>{
 const VERSION=1,DEFAULT_ENTRIES=4096,DEFAULT_BYTES=6*1024*1024;
 const scope=(engine,N,o={})=>[engine,'node-v1',N,'exact5-both33',o.firstPlayer??o.context?.firstPlayer??'unknown',
  o.strategy!==false?'initiative-1':'no-strategy',o.optimized?1:0,!!o.patternTable,
  o.vcfPrefilter!==false,!!o.counterProofDetails,o.modelVersion||'baseline'].join('|');
 const toStored=(v,ply,mate)=>Math.abs(v)>mate-1000?v+(v>0?ply:-ply):v;
 const fromStored=(v,ply,mate)=>Math.abs(v)>mate-1000?v+(v>0?-ply:ply):v;
 function create(options={}){
  const maxEntries=Math.max(1,Math.min(DEFAULT_ENTRIES,options.maxEntries||DEFAULT_ENTRIES));
  const maxBytes=Math.max(1024,Math.min(DEFAULT_BYTES,options.maxBytes||DEFAULT_BYTES));
  const records=new Map(),pending=new Map(),heap=[];let generation=0,bytes=0;
  const counters={hits:0,reused:0,misses:0,writes:0,evictions:0,imported:0,rejected:0};
  const weight=r=>r.priority+2*r.generation;
  function swap(a,b){const r=heap[a];heap[a]=heap[b];heap[b]=r;heap[a].index=a;heap[b].index=b;}
  function repair(i){if(i&&weight(heap[i])<weight(heap[(i-1)>>1])){
    while(i){const p=(i-1)>>1;if(weight(heap[p])<=weight(heap[i]))break;swap(p,i);i=p;}
   }else for(;;){const a=i*2+1,b=a+1;let next=i;
    if(a<heap.length&&weight(heap[a])<weight(heap[next]))next=a;
    if(b<heap.length&&weight(heap[b])<weight(heap[next]))next=b;
    if(next===i)break;swap(i,next);i=next;
   }
  }
  function remove(key){const old=records.get(key);if(old){
   bytes-=old.bytes;records.delete(key);pending.delete(key);const i=old.index,last=heap.pop();
   if(i<heap.length){heap[i]=last;last.index=i;repair(i);}
  }}
  function put(ns,key,value,priority=0,age=generation,imported=false){
   if(typeof ns!=='string'||typeof key!=='string'||ns.length>200||key.length>1200||value===undefined){counters.rejected++;return;}
   let encoded;try{encoded=JSON.stringify(value);}catch{counters.rejected++;return;}
   if(encoded===undefined||encoded.length>24000){counters.rejected++;return;}
   const id=ns+'\n'+key,cost=(ns.length+key.length+encoded.length)*2+192;
   if(cost>maxBytes){counters.rejected++;return;}
   const old=records.get(id),rank=Number.isFinite(priority)?Math.max(0,Math.min(100,priority)):0;
   // A late prediction must not replace a newer, deeper/exact record.
   if(old&&old.generation>age&&old.priority>=rank)return;
   remove(id);const row={id,ns,key,value,priority:rank,generation:age,bytes:cost,index:heap.length};records.set(id,row);bytes+=cost;heap.push(row);repair(row.index);
   if(imported)counters.imported++;else{counters.writes++;pending.set(id,row);}
   while(records.size>maxEntries||bytes>maxBytes){remove(heap[0].id);counters.evictions++;}
  }
  function get(ns,key){const id=ns+'\n'+key,r=records.get(id);if(!r){counters.misses++;return undefined;}
   counters.hits++;if(r.generation<generation){counters.reused++;r.generation=generation;repair(r.index);pending.set(id,r);}
   return r.value;
  }
  function rows(source,limit){return Array.from(source.values()).sort((a,b)=>b.generation-a.generation||b.priority-a.priority)
   .slice(0,limit).map(r=>[r.ns,r.key,r.value,r.priority,r.generation]);}
  function merge(packet){
   if(!packet||packet.version!==VERSION||!Array.isArray(packet.rows))return false;
   for(const r of packet.rows.slice(0,DEFAULT_ENTRIES))if(Array.isArray(r)&&r.length===5&&Number.isInteger(r[4])&&r[4]>=0)
    put(r[0],r[1],r[2],r[3],r[4],true);
   generation=Math.max(generation,Number.isInteger(packet.generation)?packet.generation:0);return true;
  }
  const api={get,put,begin:()=>++generation,clear:()=>{records.clear();pending.clear();heap.length=0;bytes=0;generation=0;},
   merge,snapshot:()=>({version:VERSION,generation,rows:rows(records,maxEntries)}),
   delta:(limit=512)=>{const exported=rows(pending,Math.min(maxEntries,limit));for(const r of exported)pending.delete(r[0]+'\n'+r[1]);return {version:VERSION,generation,rows:exported};},
   stats:()=>({...counters,entries:records.size,estimatedBytes:bytes,maxEntries,maxBytes,generation}),
   // Preserve the original request's complete memo graph. The bounded
   // cross-turn table is a second layer, not a cap on the active proof search.
   cache:ns=>{const local=new Map();const read=key=>{if(local.has(key))return local.get(key);
     const value=get(ns,key);if(value!==undefined)local.set(key,value);return value;};
    return {get:read,has:key=>read(key)!==undefined,set:(key,value)=>{local.set(key,value);put(ns,key,value,value?12:0);},
     get size(){return local.size;},clear:()=>local.clear()};}};
  merge(options.snapshot);return api;
 }
 return {VERSION,create,scope,toStored,fromStored};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=OmokSearchMemory;
