const fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const create=require('../src/node-engine.cjs'),verify=require('./verify-attack.cjs');
const ctx={Date,console};vm.createContext(ctx);
const old=f=>cp.execFileSync('git',['show','HEAD:src/'+f],{encoding:'utf8'});
vm.runInContext(old('reader-engine.js').replace('function createEngine(','function createReaderEngine(')+'\n'+old('forest-engine.js')+'\n'+old('unified-engine.js'),ctx);
const prior=ctx.createEngine({fivePriority:false}),current=create({fivePriority:true});
const idx=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const cases=[['6.I7','i7-loss-certificate.json'],['10.F9',null],['12.F6','f6-loss-certificate.json'],['12.F10','f10-loss-certificate.json'],['20.G9','g9-move20-loss-certificate.json']];
const report={rule:'exact-five overrides double-three for both colors',started:new Date().toISOString(),results:[]};
for(const [name,file] of cases){
 const spec=file?JSON.parse(fs.readFileSync('reports/'+file,'utf8')):{prefix:'H8 G7 G6 H6 F8 I7 E8 G8 F7 F9',attacker:1,certificate:{move:'H5',replies:{I4:{move:'D9'}}}};
 spec.rules={fivePriority:true};
 let auditNodes=0;const auditErrors=[];
 const b=Array(225).fill(0);spec.prefix.split(/\s+/).forEach((c,k)=>{const r=current.inspect(b,idx(c),k%2+1);if(!r.legal||r.win.length)auditErrors.push('prefix '+c);b[idx(c)]=k%2+1;});
 function audit(tree,line=[]){const c=tree.move,i=idx(c),r=current.inspect(b,i,spec.attacker||1);auditNodes++;if(!r.legal){auditErrors.push([...line,c].join(' '));return;}b[i]=spec.attacker||1;
 if(!r.win.length)for(const [reply,child] of Object.entries(tree.replies||{})){const j=idx(reply),d=3-(spec.attacker||1),s=current.inspect(b,j,d);auditNodes++;if(!s.legal||s.win.length)auditErrors.push([...line,c,reply].join(' '));else {b[j]=d;audit(child,[...line,c,reply]);b[j]=0;}}
 b[i]=0;}
 audit(spec.certificate);
 const start=Date.now(),session=verify.createSession(spec),runs=[];let r;
 do{r=session.run(Math.min(25000,160000-(Date.now()-start)));runs.push(r);console.log(JSON.stringify({name,elapsed:Date.now()-start,...r}));if(r.verified||!/timeout/i.test(r.reason||''))break;}while(Date.now()-start<155000);
 let changedWinningDefense=false;
 if(r.reason?.startsWith('Defender wins')){const board=Array(225).fill(0);const line=spec.prefix.split(/\s+/).concat(r.variation);for(let k=0;k<line.length;k++){const p=k%2+1,i=idx(line[k]);if(k===line.length-1){const before=prior.inspect(board,i,p),after=current.inspect(board,i,p);changedWinningDefense=!before.legal&&after.legal&&!!after.win.length;r.ruleDifference={move:line[k],beforeLegal:before.legal,afterLegal:after.legal,exactFive:!!after.win.length};}board[i]=p;}}
 const result={name,source:file||'test/historical.cjs recorded H5 I4 D9 VCF line',status:r.verified?'VALID':changedWinningDefense?'INVALIDATED_BY_RULE_FIX':'NEEDS_RESEARCH',auditNodes,auditErrors,elapsed_ms:Date.now()-start,result:r,runs};
 report.results.push(result);fs.writeFileSync('reports/five-priority-revalidation.json',JSON.stringify(report,null,2));console.log('COMPLETE '+name+' '+result.status);
}
