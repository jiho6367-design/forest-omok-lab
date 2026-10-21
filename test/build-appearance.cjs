'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const project=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'omok-appearance-'));
try{
 // Copy only build inputs, never this machine's images, active model or runs.
 const files=cp.execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:project,encoding:'utf8'}).split('\0').filter(f=>f==='build.cjs'||f.startsWith('src/')||f.startsWith('tools/')||f.startsWith('test/reader/'));
 files.push('tools/build-appearance.cjs');
 for(const relative of new Set(files)){if(!fs.existsSync(path.join(project,relative)))continue;const target=path.join(temporary,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(project,relative),target);}
 const build=(...args)=>cp.execFileSync(process.execPath,['build.cjs','--baseline',...args],{cwd:temporary,stdio:'pipe'}),read=f=>fs.readFileSync(path.join(temporary,f),'utf8');
 build();const publicHtml=read('dist/index.html');assert.equal(read('outputs/omok.html'),publicHtml);
 assert(!/숲|슬라임|버섯|MAPLE|data:image\/png/i.test(publicHtml));assert.match(publicHtml,/<title>my오목<\/title>/);
 const theme={names:['','private-one','private-two'],source:'data:image/png;base64,iVBORw0KGgo=',css:'.sprite{opacity:.97}',storageKey:'private-game-key',modelStorageKey:'private-model-key'};
 fs.mkdirSync(path.join(temporary,'.local'));fs.writeFileSync(path.join(temporary,'.local/appearance.json'),JSON.stringify(theme));
 build();assert.equal(read('dist/index.html'),publicHtml,'private settings must never change the public bytes');
 const local=read('outputs/omok.html');for(const value of [theme.source,theme.names[1],theme.css,theme.storageKey,theme.modelStorageKey]){assert(local.includes(value));assert(!publicHtml.includes(value));}
 build('--out-dir=stage');assert.equal(read('stage/public.html'),publicHtml);assert.equal(read('stage/omok.html'),local);
 build('--public');assert.equal(read('outputs/omok.html'),publicHtml);assert.equal(read('dist/index.html'),publicHtml);
 assert.deepEqual(JSON.parse(read('.local/appearance.json')),theme,'builds preserve the original private settings');
 console.log('PASS clean checkout/default stones; private image and storage isolation; stable public bytes; separate staged outputs; explicit public build');
}finally{const target=path.resolve(temporary);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('omok-appearance-'));fs.rmSync(target,{recursive:true,force:true});}
