'use strict';
// A single coordinator appends durable rows. SQLite indexes IDs/byte cursors;
// the original JSONL remains portable and is never replaced by the index.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const S=require('./state.cjs');
const sessions=new Map(),progressTimes=new WeakMap();
function session(dir){
 dir=path.resolve(dir);if(sessions.has(dir))return sessions.get(dir);
 fs.mkdirSync(dir,{recursive:true});const db=new DatabaseSync(path.join(dir,'journal.sqlite'));
 db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS rows(file TEXT,id TEXT,digest TEXT,family TEXT,completed INTEGER,PRIMARY KEY(file,id)); CREATE TABLE IF NOT EXISTS cursors(file TEXT PRIMARY KEY,offset INTEGER,n INTEGER,completed INTEGER);');
 const positionsExisted=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='positions'").get();
 db.exec("CREATE TABLE IF NOT EXISTS families(id TEXT PRIMARY KEY); INSERT OR IGNORE INTO families SELECT family FROM rows WHERE file='dataset.jsonl' AND family IS NOT NULL; CREATE TABLE IF NOT EXISTS positions(id TEXT PRIMARY KEY);");
 if(!positionsExisted)db.exec("UPDATE cursors SET offset=0 WHERE file='dataset.jsonl'");
 const api={db,find:db.prepare('SELECT digest FROM rows WHERE file=? AND id=?'),add:db.prepare('INSERT OR IGNORE INTO rows VALUES(?,?,?,?,?)'),addFamily:db.prepare('INSERT OR IGNORE INTO families VALUES(?)'),addPosition:db.prepare('INSERT OR IGNORE INTO positions VALUES(?)'),cursor:db.prepare('SELECT * FROM cursors WHERE file=?'),setCursor:db.prepare('INSERT INTO cursors VALUES(?,?,?,?) ON CONFLICT(file) DO UPDATE SET offset=excluded.offset,n=excluded.n,completed=excluded.completed')};sessions.set(dir,api);return api;
}
function syncFile(dir,name,key){
 const api=session(dir),file=path.join(dir,name),prior=api.cursor.get(name)||{offset:0,n:0,completed:0};
 if(!fs.existsSync(file)){if(prior.offset)throw Error('Indexed corpus file is missing: '+name);return prior;}
 const size=fs.statSync(file).size;if(size<prior.offset)throw Error('Corpus was shortened after indexing: '+name);if(size===prior.offset)return prior;
 const fd=fs.openSync(file,'r+'),buffer=Buffer.alloc(65536);let position=prior.offset,pending=Buffer.alloc(0),committed=prior.offset,n=prior.n,completed=prior.completed;
 api.db.exec('BEGIN');
 try{
  while(position<size){const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,size-position),position);if(!count)break;position+=count;pending=Buffer.concat([pending,buffer.subarray(0,count)]);let newline;
   while((newline=pending.indexOf(10))>=0){const line=pending.subarray(0,newline).toString('utf8').trim();const bytes=newline+1;pending=pending.subarray(bytes);committed+=bytes;if(!line)continue;
    const row=JSON.parse(line),id=row[key];if(typeof id!=='string'||!id)throw Error('Corpus row lacks '+key+' in '+name);const digest=S.hash(row),known=api.find.get(name,id);if(known&&known.digest!==digest)throw Error('Conflicting corpus ID '+id);
    if(name==='dataset.jsonl'){if(row.familyId)api.addFamily.run(row.familyId);if(row.positionKey)api.addPosition.run(row.positionKey);}
    if(!known){api.add.run(name,id,digest,row.familyId||null,row.completed?1:0);n++;if(row.completed)completed++;}
   }
  }
  // Only an uncommitted final fragment can be discarded; valid prior lines stay.
  if(pending.length){fs.ftruncateSync(fd,committed);fs.fsyncSync(fd);S.append(path.join(dir,'recovery.jsonl'),{at:new Date().toISOString(),file:name,discardedTailBytes:pending.length});}
  api.setCursor.run(name,committed,n,completed);api.db.exec('COMMIT');return {offset:committed,n,completed};
 }catch(error){api.db.exec('ROLLBACK');throw error;}finally{fs.closeSync(fd);}
}
function appendRows(dir,name,rows,key){
 const cursor=syncFile(dir,name,key),api=session(dir),fresh=[];const local=new Map();
 for(const row of rows){const id=row[key],digest=S.hash(row);if(typeof id!=='string'||!id)throw Error('Invalid corpus row ID');const known=api.find.get(name,id)?.digest||local.get(id);if(known&&known!==digest)throw Error('Conflicting corpus row '+id);if(!known){fresh.push(row);local.set(id,digest);}}
 if(!fresh.length)return 0;
 const file=path.join(dir,name),text=fresh.map(row=>JSON.stringify(row)+'\n').join(''),fd=fs.openSync(file,'a');try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 // A crash before indexing is recovered by scanning only this appended tail.
 syncFile(dir,name,key);return fresh.length;
}
function counters(context){
 const data=syncFile(context.dir,'dataset.jsonl','sampleId'),games=syncFile(context.dir,'games.jsonl','id'),api=session(context.dir);
 Object.assign(context.state.counters,{samples:data.n,generatedGames:games.n,completedGames:games.completed,families:Number(api.db.prepare('SELECT COUNT(*) AS n FROM families').get().n),uniquePositions:Number(api.db.prepare('SELECT COUNT(*) AS n FROM positions').get().n)});
 return context.state.counters;
}
function verify(game){
 const R=require('./replay.cjs'),checked=R.replay({id:game.id,first:game.firstPlayer,rulesId:S.RULES_ID,events:[...(game.opening||[]),...(game.events||[])]},{engine:require('../../src/node-engine.cjs')({firstPlayer:game.firstPlayer,strategy:false,model:null})});
 assert.deepEqual(Array.from(game.board),checked.board,'Saved game board differs from played events');assert.equal(game.p,checked.p);
 if(game.completed){assert(checked.completed,'Unplayed outcome cannot label training data');assert.equal(game.winner,checked.draw?0:checked.winner);}return checked;
}
function finish(context,intent){
 const {game,rows}=intent;verify(game);if(!game.completed&&rows.length)throw Error('Incomplete game cannot produce terminal labels');
 appendRows(context.dir,'dataset.jsonl',rows,'sampleId');appendRows(context.dir,'games.jsonl',[{...game,samples:undefined,model:undefined}],'id');
 delete context.state.activeGames[game.id];context.state.generationIndex=Math.max(context.state.generationIndex||0,(game.index??-1)+1);counters(context);S.save(context);
 const partial=path.join(context.dir,'partials',S.hash(game.id).slice(0,24)+'.jsonl');if(fs.existsSync(partial))fs.unlinkSync(partial);
}
function commitGame(context,game,rows){
 const file=path.join(context.dir,'generation-intent.json');S.atomic(file,{schemaVersion:1,game,rows});finish(context,{game,rows});fs.unlinkSync(file);
}
function saveMove(context,game){
 if(!game?.events?.length)return;
 const file=path.join(context.dir,'partials',S.hash(game.id).slice(0,24)+'.jsonl');fs.mkdirSync(path.dirname(file),{recursive:true});
 const ply=game.events.length,event=game.events[ply-1],sample=(game.samples||[]).find(x=>x.ply===game.opening.length+ply-1);
 const row={id:game.id,ply,event,rng:game.rng,elapsedMs:game.elapsedMs,completed:game.completed,winner:game.winner,reason:game.reason,sample};const fd=fs.openSync(file,'a');try{fs.writeFileSync(fd,JSON.stringify(row)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const last=progressTimes.get(context)||0;if(Date.now()-last>=250){S.saveSummary(context);progressTimes.set(context,Date.now());}
}
function restoreMoves(context,game){
 const file=path.join(context.dir,'partials',S.hash(game.id).slice(0,24)+'.jsonl');if(!fs.existsSync(file))return;
 const bytes=fs.readFileSync(file),end=bytes.lastIndexOf(10);if(end<bytes.length-1){const fd=fs.openSync(file,'r+');try{fs.ftruncateSync(fd,end+1);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 for(const line of bytes.subarray(0,end+1).toString('utf8').split('\n')){if(!line)continue;const row=JSON.parse(line);if(row.id!==game.id)throw Error('Partial game identity mismatch');
  if(row.ply<=game.events.length){assert.deepEqual(game.events[row.ply-1],row.event,'Conflicting saved move');continue;}
  if(row.ply!==game.events.length+1)throw Error('Missing durable move');assert.equal(row.event.p,game.p);if(row.event.type==='move'){assert.equal(game.board[row.event.i],0);game.board[row.event.i]=game.p;}game.p=3-game.p;game.events.push(row.event);
  if(row.sample&&!game.samples.some(x=>x.ply===row.sample.ply))game.samples.push(row.sample);Object.assign(game,{rng:row.rng,elapsedMs:row.elapsedMs,completed:row.completed,winner:row.winner,reason:row.reason});
 }verify(game);
}
function recoverGames(context){
 const file=path.join(context.dir,'generation-intent.json');if(fs.existsSync(file)){finish(context,S.read(file));fs.unlinkSync(file);}
 for(const game of Object.values(context.state.activeGames||{}))restoreMoves(context,game);counters(context);S.save(context);
}
function close(dir){const key=path.resolve(dir),api=sessions.get(key);if(api){api.db.close();sessions.delete(key);}}
module.exports={appendRows,syncFile,counters,verify,commitGame,saveMove,recoverGames,close};
