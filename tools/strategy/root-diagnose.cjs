'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),project=path.resolve(root,'../..'),baseline=path.join(project,'work/baseline'),out=path.join(root,'outputs');
const {instrument}=require('./root-instrument.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const snap=()=>Object.fromEntries([...fs.readdirSync(path.join(root,'src')).map(f=>'src/'+f),'package.json','outputs/omok.html','outputs/omok-gpu.html','dist/index.html'].filter(f=>fs.statSync(path.join(root,f)).isFile()).map(f=>[f,sha(fs.readFileSync(path.join(root,f)))]));
const output=path.join(out,'strategy-root-diagnosis-results.json');
if(fs.existsSync(output))throw Error('Preserve existing diagnosis file');
const original=require('./browser.cjs'),overlay=instrument(original.sources(root).engine);
new vm.Script(overlay.source);
let browserSource=fs.readFileSync(path.join(__dirname,'browser.cjs'),'utf8').replace('const versions={baseline:sources(baselineRoot),improved:sources(candidateRoot)};',"const versions={baseline:sources(baselineRoot),improved:sources(candidateRoot)};versions.improved.engine=require('./root-instrument.cjs').instrument(versions.improved.engine).source;").replace('rules:{fivePriority:true},moves:spec.history','rules:{fivePriority:true,rootDiagnostics:spec.diagnosticConfig},moves:spec.history');
const m=new Module(path.join(__dirname,'root-browser-runtime.cjs'),module);m.filename=path.join(__dirname,'root-browser-runtime.cjs');m.paths=module.paths;m._compile(browserSource,m.filename);
const selection=JSON.parse(fs.readFileSync(path.join(out,'strategy-influence-selection.json'),'utf8')).selected.find(x=>x.id==='P-C2-prefix7');
const state={taskStartedAt:'2026-10-05T04:10:15Z',calculationCutoff:'2026-10-05T04:22:15Z',startedAt:new Date().toISOString(),originalEvidence:'strategy-influence-results.json',caseId:selection.id,spec:selection.spec,sourceHashes:snap(),overlayHash:sha(overlay.source),overlayAnchors:overlay.edits,diagnosticsDefault:false,requests:JSON.parse(fs.readFileSync(path.join(out,'strategy-root-diagnosis-attempt1.json'),'utf8')).requests,actualAnalysisStarts:1,errors:[],limits:{verificationMs:120000,starts:4,perRequestMs:15000}};
const save=()=>fs.writeFileSync(output,JSON.stringify(state,null,2));
(async()=>{let session;save();try{session=await m.exports.createBrowser({baselineRoot:baseline,candidateRoot:root,compute:'gpu',manifest:require('./manifest.json')});state.metadata=session.metadata;save();
 const conditions=[{id:'instrumentation-off',enabled:false},{id:'instrumentation-on',enabled:true},{id:'branch-only-12',enabled:true,widthProfile:{branch:12}}];
 for(const config of conditions){if(Date.now()+16000>=Date.parse(state.calculationCutoff)||state.actualAnalysisStarts>=4)throw Error('task-cutoff');const request={id:config.id,config,startedAt:new Date().toISOString(),status:'started',externalBudgetMs:15000,internalBudgetMs:14100};state.requests.push(request);state.actualAnalysisStarts++;save();console.log(JSON.stringify({start:request.id,count:state.actualAnalysisStarts}));Object.assign(request,await session.analyze('improved',{...selection.spec,diagnosticConfig:config},{automatic:true,ms:15000}));request.status=request.error||request.invalid?'failed':'completed';request.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({id:request.id,depth:request.result?.depth,nodes:request.result?.nodes,elapsedMs:request.elapsedMs,roots:request.result?.rootDiagnostics?.forest?.actualRootCount,error:request.error}));if(request.status==='failed')break;}
 }catch(error){state.errors.push(error.stack);process.exitCode=1;}finally{if(session)await session.close();state.finishedAt=new Date().toISOString();state.finalSourceHashes=snap();state.productSourceUnchanged=JSON.stringify(state.sourceHashes)===JSON.stringify(state.finalSourceHashes);save();console.log(JSON.stringify({finished:true,count:state.actualAnalysisStarts,preserved:state.productSourceUnchanged}));}})();


