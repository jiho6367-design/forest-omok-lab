'use strict';
// One durable budget for every production run and continuation branch. A
// committed reservation consumes its ordinal even if no arena file is saved.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const S=require('./state.cjs');
const DEFAULT_FILE=path.join(S.ROOT,'outputs/learning/evaluation-ledger.sqlite');
const SCOPE='Shared post-migration trial budget and reserved opening families; legacy evaluations were not globally coordinated and unique family IDs do not prove statistical independence.';
function ledgerFile(context){
 const file=path.resolve(context.trialLedgerFile||DEFAULT_FILE);
 if(context.trialLedgerFile){const relative=path.relative(path.join(S.ROOT,'work'),file);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Isolated trial ledger must stay inside repository work storage');}
 return file;
}
function open(context){
 const file=ledgerFile(context);fs.mkdirSync(path.dirname(file),{recursive:true});const db=new DatabaseSync(file);
 db.exec('PRAGMA busy_timeout=30000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value INTEGER NOT NULL); INSERT OR IGNORE INTO metadata VALUES(\'highwater\',0); CREATE TABLE IF NOT EXISTS trials(reservation TEXT PRIMARY KEY,trial INTEGER UNIQUE NOT NULL,arena TEXT NOT NULL); CREATE TABLE IF NOT EXISTS families(id TEXT PRIMARY KEY,reservation TEXT NOT NULL); CREATE TABLE IF NOT EXISTS legacy_arenas(id TEXT PRIMARY KEY,trial INTEGER NOT NULL);');
 return {db,file};
}
function highwater(db){return Number(db.prepare('SELECT value FROM metadata WHERE key=\'highwater\'').get().value);}
function raise(db,trial){if(Number.isSafeInteger(trial)&&trial>=0)db.prepare('UPDATE metadata SET value=MAX(value,?) WHERE key=\'highwater\'').run(trial);}
function runDirectories(root,result=new Set()){
 if(!fs.existsSync(root))return result;if(fs.existsSync(path.join(root,'state.json'))){result.add(path.resolve(root));return result;}
 for(const row of fs.readdirSync(root,{withFileTypes:true}))if(row.isDirectory()&&!row.isSymbolicLink())runDirectories(path.join(root,row.name),result);return result;
}
function importArena(db,dir,arena){
 if(!arena||!Number.isSafeInteger(arena.trial)||arena.trial<1||typeof arena.candidateHash!=='string'||!Array.isArray(arena.games))throw Error('Cannot reconcile an invalid arena trial record');
 const recorded=arena.budget?.reservation;if(recorded){const known=db.prepare('SELECT trial,arena FROM trials WHERE reservation=?').get(recorded);if(!known||Number(known.trial)!==arena.trial)throw Error('Arena durable trial reservation is missing or mismatched');const original=JSON.parse(known.arena),immutable=value=>[value.candidateHash,value.settingsHash,value.identity,value.baselineCommit,value.rulesId,value.incumbentHash,value.lessonHash,value.datasetSha256,value.moveMs,value.pairs,value.games.map(g=>[g.id,g.pairId,g.familyId,g.candidateFirst,g.candidateColor,g.firstPlayer,g.opponent,g.source,g.opening])];if(S.hash(immutable(original))!==S.hash(immutable(arena)))throw Error('Arena durable trial reservation context changed');}
 else{const id=S.hash([path.resolve(dir),arena.trial,arena.candidateHash,arena.startedAt||null]),put=db.prepare('INSERT OR IGNORE INTO families VALUES(?,?)');db.prepare('INSERT OR IGNORE INTO legacy_arenas VALUES(?,?)').run(id,arena.trial);for(const family of new Set(arena.games.map(g=>g.familyId))){if(typeof family!=='string'||!family)throw Error('Cannot reconcile an arena with missing opening families');put.run(family,'legacy-'+id);}}
 raise(db,arena.trial);
}
function importRuns(db,context){
 const dirs=context.trialLedgerFile?new Set():runDirectories(path.join(S.ROOT,'outputs/learning'));dirs.add(path.resolve(context.dir));
 const continuation=S.read(path.join(context.dir,'continuation.json'));if(continuation?.source)dirs.add(path.resolve(continuation.source));
 for(const dir of dirs){if(!fs.existsSync(dir))continue;raise(db,S.read(path.join(dir,'state.json'))?.trial);for(const name of fs.readdirSync(dir))if(/^arena-cycle-\d+\.json$/.test(name))importArena(db,dir,S.read(path.join(dir,name)));}
 raise(db,context.state.trial);
}
function reflect(context,file,db){context.state.trial=Math.max(context.state.trial||0,highwater(db));context.state.evaluationBudget={ledger:file,highwater:highwater(db),reservedFamilies:Number(db.prepare('SELECT COUNT(*) AS n FROM families').get().n),scope:SCOPE};return context.state.evaluationBudget;}
function reconcile(context,arena){
 const {db,file}=open(context);try{db.exec('BEGIN IMMEDIATE');importRuns(db,context);if(arena)importArena(db,context.dir,arena);db.exec('COMMIT');return reflect(context,file,db);}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
}
function reserve(context,details,build){
 const {db,file}=open(context),reservation=S.hash([path.resolve(context.dir),context.state.runId||null,context.state.cycle,details]);
 try{db.exec('BEGIN IMMEDIATE');importRuns(db,context);const prior=db.prepare('SELECT arena FROM trials WHERE reservation=?').get(reservation);if(prior){const arena=JSON.parse(prior.arena);db.exec('COMMIT');reflect(context,file,db);return arena;}
  const trial=highwater(db)+1;if(!Number.isSafeInteger(trial))throw Error('Trial ordinal exceeds exact integer range');const has=db.prepare('SELECT 1 FROM families WHERE id=?'),arena=build({trial,hasFamily:id=>!!has.get(id)}),families=[...new Set(arena.games.map(g=>g.familyId))];
  if(arena.trial!==trial||!families.length)throw Error('Arena reservation has no trial or opening families');arena.budget={reservation,ledger:file,scope:SCOPE};const put=db.prepare('INSERT INTO families VALUES(?,?)');for(const id of families){if(typeof id!=='string'||!id)throw Error('Missing reserved opening family');put.run(id,reservation);}db.prepare('INSERT INTO trials VALUES(?,?,?)').run(reservation,trial,JSON.stringify(arena));raise(db,trial);db.exec('COMMIT');reflect(context,file,db);return arena;
 }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
}
module.exports={DEFAULT_FILE,SCOPE,ledgerFile,reconcile,reserve};
