'use strict';
// Isolated real-record write-volume comparison; no original run is modified.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const S=require('../tools/learning/state.cjs'),R=require('../tools/learning/replay.cjs'),A=require('../tools/learning/arena.cjs');
const source=path.resolve(process.argv[2]||path.join(S.ROOT,'outputs/learning/runs/run-20261006211359833-0ab1d3'));
const arena=JSON.parse(fs.readFileSync(path.join(source,'arena.json'),'utf8')),saved=JSON.parse(fs.readFileSync(path.join(source,'state.json'),'utf8')),baseline=S.read(path.join(S.ROOT,'work/continuous-runtime-baseline.json'));
const origin=path.join(S.ROOT,'tools/learning/state.cjs'),retained=new Module(origin,module);retained.filename=origin;retained.paths=Module._nodeModulePaths(path.dirname(origin));retained._compile(baseline.files['tools/learning/state.cjs'],origin);const old=retained.exports;
const actual=arena.games.find(g=>g.events.length>=12);if(!actual)throw Error('Expected a saved game with at least 12 real moves');
const dir=path.join(S.ROOT,'work/learning-arena-io-benchmark-'+Date.now());fs.mkdirSync(dir,{recursive:true});const snapshots=[];
for(let n=1;n<=12;n++){const game=structuredClone(actual),events=game.events.slice(0,n),r=R.replay({id:game.id,first:game.firstPlayer,events:[...game.opening,...events]});Object.assign(game,{events,board:r.board,p:r.p,completed:r.completed,winner:r.draw?0:r.winner,elapsedMs:events.reduce((sum,e)=>sum+e.elapsedMs,0),reason:r.completed?(r.draw?'full-board':'played-exact-five'):undefined});snapshots.push(game);}
const rows=[];
for(let repeat=0;repeat<3;repeat++)for(const name of repeat%2?['new','old']:['old','new']){
 const trial=path.join(dir,name+'-'+repeat),context={dir:trial,state:structuredClone(saved)},state=structuredClone(arena);fs.mkdirSync(trial,{recursive:true});context.state.cycle=saved.cycle;let bytes=0,calls=0;const write=fs.writeFileSync;fs.writeFileSync=function(file,data,...rest){bytes+=Buffer.byteLength(data);calls++;return write.call(this,file,data,...rest);};const start=performance.now();
 try{for(const snapshot of snapshots){const game=structuredClone(snapshot),i=state.games.findIndex(g=>g.id===game.id);state.games[i]=game;if(name==='old'){old.atomic(path.join(trial,'arena-cycle-'+context.state.cycle+'.json'),state);old.save(context);}else A.appendArenaMove(context,state,game);}}finally{fs.writeFileSync=write;}
 rows.push({repeat,name,wallMs:performance.now()-start,writtenBytes:bytes,writeCalls:calls,moves:snapshots.length});
}
const median=values=>values.slice().sort((a,b)=>a-b)[1],summary=Object.fromEntries(['old','new'].map(name=>[name,{medianWallMs:median(rows.filter(r=>r.name===name).map(r=>r.wallMs)),medianWrittenBytes:median(rows.filter(r=>r.name===name).map(r=>r.writtenBytes)),medianWriteCalls:median(rows.filter(r=>r.name===name).map(r=>r.writeCalls))}]));
const report={source,baselineCommit:baseline.head,arenaGames:arena.games.length,moves:12,rows,summary,scope:'Twelve recorded actual arena moves persisted under old full-snapshot writes versus new fsynced move journal and throttled compact progress. Excludes search and game-boundary snapshots; no full-match speedup or playing-strength claim.'};S.atomic(path.join(dir,'report.json'),report);console.log(JSON.stringify({artifacts:dir,summary,scope:report.scope}));
