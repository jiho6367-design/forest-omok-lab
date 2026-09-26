const fs=require('fs');const path=require('path');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8');
let drawing=read('drawing.js').replace('if(b[v.i])return;','if(b[v.i]||k!==selected)return;').replace("$('undo').disabled=!history.length;","$('undo').disabled=!history.length;renderExtra();");
const app=read('app.js').replace('/*DRAWING*/',()=>drawing).replace('/*RECORDS*/',()=>read('records.js')).replace('/*GAME95*/',()=>JSON.stringify(require('./game95.cjs').coords)).replace('/*GAME47*/',()=>JSON.stringify(require('./game47.cjs').coords)).replace('/*GAME33*/',()=>JSON.stringify(require('./game33.cjs').coords)).replace('/*GAME31*/',()=>JSON.stringify(require('./game31.cjs').coords)).replace('/*GAME29*/',()=>JSON.stringify(require('./game29.cjs').coords)).replace('/*GAME48*/',()=>JSON.stringify(require('./game48.cjs').coords));
let html=read('template.html').replace('/*ENGINE*/',()=>read('engine.js')).replace('/*APP*/',()=>app);
fs.writeFileSync(path.join(__dirname,'dist/index.html'),html);
