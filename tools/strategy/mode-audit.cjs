'use strict';
// Local, bounded diagnostic. Does not touch learning runs, ledgers or models.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),root=path.resolve(__dirname,'../..');
const sources=['neural-evaluator.js','search-memory.js','gpu-patterns.js','strategy-engine.js','reader-engine.js','forest-engine.js','unified-engine.js'];
function load(directory,model){
 const manifests=sources.map(name=>({path:'src/'+name,sha256:sha(fs.readFileSync(path.join(directory,'src',name)))}));
 const ctx={Date,console,performance};vm.createContext(ctx);vm.runInContext(sources.map(name=>{const text=fs.readFileSync(path.join(directory,'src',name),'utf8');return name==='reader-engine.js'?text.replace('function createEngine(','function createReaderEngine('):text;}).join('\n'),ctx);
 if(model)vm.runInContext('OmokNeural',ctx).validate(model);
 return {create:options=>ctx.createEngine({...options,model}),identity:sha(JSON.stringify(manifests)),manifests};
}
const ix=c=>(+c.slice(1)-1)*15+c.charCodeAt(0)-65;
const coord=i=>String.fromCharCode(65+i%15)+(15-Math.floor(i/15));
function cases(){
 const record=require('../../test/reader/game33.cjs'),make=(id,p,own,enemy,first)=>{const b=Array(225).fill(0);own.forEach(c=>b[ix(c)]=p);enemy.forEach(c=>b[ix(c)]=3-p);return {id,board:b,p,first};};
 return [
  {id:'record33-ply6',board:record.position(6),p:2,first:2,provenance:'test/reader/game33.cjs; stored historical prefix, not the recent user experiment'},
  {id:'record33-ply7',board:record.position(7),p:1,first:2,provenance:'test/reader/game33.cjs; stored historical prefix'},
  make('single-four-attack',2,['J5','J6','J7'],['J4','I8','K8'],2),
  make('pure-cut-defense',2,['A1','O13'],['D4','D5','D6'],1),
  make('counterblock-tempo',2,['D4','D6','B3'],['B5','F5','L13','O9'],1),
  make('retained-pressure',1,['F8','H8','B3','G9'],['E2','J5','M12','E8'],1)
 ];
}
function run({directory=root,model,selected=['fast','auto','deep'],ids,checkpoint=()=>{}}={}){
 if(!selected.length||selected.some(mode=>!['fast','auto','deep'].includes(mode)))throw Error('Unknown analysis mode');
 if(ids?.some(id=>!cases().some(c=>c.id===id)))throw Error('Unknown fixed position');
 const engine=load(directory,model),policy=require('../../src/analysis-settings.js'),rows=[];
 const result={schemaVersion:1,startedAt:new Date().toISOString(),coordinateSystem:'UI descending rows: index 0 = A15',sourceHash:engine.identity,sourceManifest:engine.manifests,modelHash:model?sha(JSON.stringify(model)):null,modelId:model?.modelId||null,
  scope:'Fixed positions and bounded actual response sequences; not a strength/adoption test. Same frozen weights; fresh engine and cache per request.',rows};
 for(const c of cases().filter(c=>!ids||ids.includes(c.id)))for(const mode of selected){
  const e=engine.create({firstPlayer:c.first,optimized:true}),plan=policy.resolve({...policy.defaults(),mode},c.board,c.p,40000,e.suggestBudget),budget=plan.internalMs;
  const start=performance.now(),progress=[],request=e.strategyVersion==='initiative-2'?{mode,automatic:mode==='auto',ms:budget}:mode==='auto'?{automatic:true,ms:budget}:budget;
  const r=e.analyze(c.board,c.p,request,[],v=>progress.push({ms:Math.round(performance.now()-start),move:v.i,depth:v.depth,source:v.comparisonSource}));
  if(r.i!=null&&!e.inspect(c.board,r.i,c.p).legal)throw Error('Illegal recommendation '+c.id+'/'+mode);
  const pv=e.validPV?Array.from(e.validPV(c.board,c.p,r.pv)):r.pv;
  if(pv.length!==(r.pv||[]).length)throw Error('Invalid PV '+c.id+'/'+mode);
  const feature=r.i==null?null:e.strategicMove?.(c.board,r.i,c.p),row={case:c.id,provenance:c.provenance||'generated legal tactical position',mode,p:c.p,firstPlayer:c.first,board:c.board,externalBudgetMs:plan.externalMs,internalBudgetMs:budget,
   elapsedMs:Math.round(performance.now()-start),result:{...r,shape:undefined,searchMemory:undefined},move:r.i==null?null:coord(r.i),feature,progress};
  rows.push(row);checkpoint(result);console.log(JSON.stringify({case:c.id,mode,move:row.move,ms:row.elapsedMs,depth:r.depth,source:r.comparisonSource,proof:r.proofStatus}));
 }
 result.completedAt=new Date().toISOString();checkpoint(result);return result;
}
function responses(data,{directory=root,opponentDirectory=directory,model,ids,checkpoint=()=>{}}={}){
 const own=load(directory,model),opponent=load(opponentDirectory,model);
 if(data.sourceHash!==own.identity||data.modelHash!==(model?sha(JSON.stringify(model)):null))throw Error('Root source/model changed before response audit');
 data.responseAudit={opponentSourceHash:opponent.identity,replyMs:940,followMs:940,scope:'Actual three-ply continuation with fixed fast responses; not a complete game, safety certificate or human-strength estimate.'};
 for(const row of data.rows.filter(r=>!ids||ids.includes(r.case))){
  const b=row.board.slice(),line=[],engine=own.create({firstPlayer:row.firstPlayer,optimized:true});let p=row.p,terminal=false;
  const place=(i,source)=>{if(i==null){terminal=true;return;}const s=engine.inspect(b,i,p);if(!s.legal)throw Error('Illegal actual continuation');line.push({p,i,coord:coord(i),source,win:!!s.win.length});b[i]=p;terminal=!!s.win.length||b.every(Boolean);p=3-p;};
  place(row.result.i,'root-'+row.mode);
  if(!terminal){const e=opponent.create({firstPlayer:row.firstPlayer,optimized:true}),r=e.analyze(b,p,940);place(r.i,'frozen-opponent-fast');}
  if(!terminal){const r=engine.analyze(b,p,940);place(r.i,'candidate-follow-fast');}
  row.actualContinuation={line,terminal,winner:line.at(-1)?.win?line.at(-1).p:null};checkpoint(data);
 }
 data.responseAudit.completedAt=new Date().toISOString();checkpoint(data);return data;
}
if(require.main===module){
 const args=Object.fromEntries(process.argv.slice(2).map(s=>{const at=s.indexOf('=');if(!s.startsWith('--')||at<0)throw Error('Use --name=value');return [s.slice(2,at),s.slice(at+1)];}));
 if(!args.out)throw Error('An explicit local --out=path is required');
 const file=path.resolve(root,args.out),directory=path.resolve(root,args.source||'.'),modelPath=path.resolve(root,args.model||'src/active-model.json');
 const model=args.model==='none'?null:JSON.parse(fs.readFileSync(modelPath,'utf8'));
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const options={directory,model,ids:args.cases?.split(','),checkpoint:data=>{fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2)+'\n');fs.renameSync(file+'.tmp',file);}};
 if(args['responses-from'])responses(JSON.parse(fs.readFileSync(path.resolve(root,args['responses-from']),'utf8')),{...options,opponentDirectory:path.resolve(root,args['opponent-source']||args.source||'.')});
 else run({...options,selected:(args.modes||'fast,auto,deep').split(',')});
}
module.exports={load,cases,run,responses};
