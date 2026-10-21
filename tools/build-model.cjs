'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),N=require('../src/neural-evaluator.js');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const keys=['schemaVersion','kind','rulesId','featureVersion','inputSize','hiddenSize','activation','outputActivation','modelId','scale','normalization','layers'];
const inference=model=>Object.fromEntries(keys.map(k=>[k,model[k]]));
const weights=model=>JSON.stringify(inference(model));
function portable(model){
 N.validate(model);if(model.adoption?.accepted!==true)throw Error('Only verified adopted models may be embedded as the default.');
 const metadata=['accepted','at','baselineCommit','validationHash','sourceHash','harnessHash','runtimeHash'];
 return {...inference(model),adoption:Object.fromEntries(metadata.filter(k=>model.adoption[k]!==undefined).map(k=>[k,model.adoption[k]]))};
}
function load(root,{baseline=false,explicitFile=null}={}){
 if(baseline){if(explicitFile)throw Error('Choose baseline or an explicit model');return null;}
 const active=explicitFile||path.join(root,'src/active-model.json'),local=fs.existsSync(active)?JSON.parse(fs.readFileSync(active,'utf8')):null;
 if(explicitFile){if(!local)throw Error('Requested learning model does not exist');return portable(local);}
 if(local){N.validate(local);if(local.adoption?.accepted!==true)throw Error('Default model lacks verified adoption');}
 const refFile=path.join(root,'src/default-model-reference.json');if(!fs.existsSync(refFile))return local?portable(local):null;
 const ref=JSON.parse(fs.readFileSync(refFile,'utf8'));if(!/^[a-f0-9]{64}$/.test(ref.artifactSha256||'')||!/^[a-f0-9]{64}$/.test(ref.evidenceSha256||''))throw Error('Invalid published default reference');
 const relative='artifacts/adopted-models/'+ref.artifactSha256,dir=path.join(root,relative),modelBytes=fs.readFileSync(path.join(dir,'model.json')),evidenceBytes=fs.readFileSync(path.join(dir,'evidence.json'));
 if(sha(modelBytes)!==ref.artifactSha256||sha(evidenceBytes)!==ref.evidenceSha256)throw Error('Published default model/evidence bytes changed');
 const model=N.validate(JSON.parse(modelBytes)),e=JSON.parse(evidenceBytes);
 if(e.accepted!==true||e.kind!=='forest-omok-verified-adoption'||e.modelId!==model.modelId||e.hashes?.artifactSha256!==ref.artifactSha256)throw Error('Published default evidence mismatch');
 if(local&&weights(local)!==weights(model))return portable(local);
 // Carry the recorded historical identity; never assign current engine hashes
 // or treat use of existing weights as a new adoption on the changed engine.
 return {...inference(model),adoption:{accepted:true,at:e.adoptedAt,baselineCommit:e.settings?.baselineCommit,
  validationHash:e.hashes.arenaSemanticHash,sourceHash:e.code?.evaluation?.sourceHash,harnessHash:e.code?.evaluation?.harnessHash,runtimeHash:e.code?.evaluation?.runtimeHash}};
}
module.exports={load,portable};
