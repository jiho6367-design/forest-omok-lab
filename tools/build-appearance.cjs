'use strict';
const fs=require('node:fs'),path=require('node:path');
const defaults={names:['','흑돌','백돌'],source:null,css:'',storageKey:'my-omok-v1',modelStorageKey:'my-omok-learning-model-v1'};
function load(root){
 const file=path.join(root,'.local/appearance.json');if(!fs.existsSync(file))return null;
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Array.isArray(value.names)||value.names.length!==3||value.names.some(n=>typeof n!=='string'||n.length>40)||typeof value.source!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.source)||typeof value.css!=='string'||/[<>]/.test(value.css)||['storageKey','modelStorageKey'].some(k=>typeof value[k]!=='string'||value[k].length>100))throw Error('Invalid private appearance configuration');
 return value;
}
function render(html,appearance=null){
 const value=appearance||defaults,json=v=>JSON.stringify(v).replace(/</g,'\\u003c');
 for(const [marker,key,fallback] of [['PIECE_NAMES','names',defaults.names],['PIECE_SOURCE','source',null],['STORAGE_KEY','storageKey',defaults.storageKey],['MODEL_STORAGE_KEY','modelStorageKey',defaults.modelStorageKey]]){
  const token='/*'+marker+'*/'+JSON.stringify(fallback);if(!html.includes(token))throw Error('Missing appearance marker '+marker);
  html=html.replace(token,()=>json(value[key]));
 }
 return html.replace('/*LOCAL_PIECE_STYLE*/',()=>value.css);
}
module.exports={load,render};
