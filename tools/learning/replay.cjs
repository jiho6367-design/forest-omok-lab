'use strict';
const fs=require('node:fs'),path=require('node:path');
const {hash,RULES_ID,rng,ROOT}=require('./state.cjs');
const createEngine=require('../../src/node-engine.cjs');
const blank=()=>Array(225).fill(0),coord=i=>String.fromCharCode(65+i%15)+(1+(i/15|0));
function index(value){if(Number.isInteger(value)&&value>=0&&value<225)return value;const m=/^([A-O])(1[0-5]|[1-9])$/i.exec(String(value));if(!m)throw Error('Invalid coordinate: '+value);return (+m[2]-1)*15+m[1].toUpperCase().charCodeAt(0)-65;}
function eventsFromText(text,firstPlayer){
 const header=/내\s*돌\s*:\s*(흑|백|노란\s*버섯|초록\s*슬라임)[^\n\r]*(선공|후공)/i.exec(text);let me=header?(/흑|버섯/.test(header[1])?1:2):null;
 if(header)firstPlayer=header[2]==='선공'?me:3-me;
 text=text.replace(/^\s*내\s*돌\s*:[^\r\n]*(?:\r?\n|$)/im,'');const parts=text.split(/[·\n\r;]+/).map(x=>x.trim()).filter(Boolean),events=[];let p=firstPlayer;
 for(const entry of parts){const m=/^(?:\d+\s*[.)]\s*)?(?:(흑|백|노란\s*버섯|초록\s*슬라임)\s*)?([A-O](?:1[0-5]|[1-9])|PASS(?:\([^)]*\))?)$/i.exec(entry);if(!m)throw Error('Cannot read record item '+(events.length+1)+': '+entry);const q=m[1]?(/흑|버섯/.test(m[1])?1:2):p;if(![1,2].includes(q))throw Error('First player is required for a record without color labels.');if(!events.length&&p==null)p=q;if(q!==p)throw Error('Wrong player at move '+(events.length+1));events.push({type:/^PASS/i.test(m[2])?'timeout':'move',p:q,i:/^PASS/i.test(m[2])?null:index(m[2])});p=3-q;}
 return {first:events[0]?.p||firstPlayer,me,events};
}
function familyFor(events,first){const E=positionEngine||(positionEngine=createEngine({strategy:false,model:null}));let best=null;for(let t=0;t<8;t++){const encoded=events.map(e=>(e.p===first?1:2)+':'+(e.type==='timeout'?'PASS':E.transformed(e.i,t))).join(',');if(best===null||encoded<best)best=encoded;}return 'record-'+hash(best).slice(0,24);}
let positionEngine;
function positionKey(board,p,firstPlayer){const E=positionEngine||(positionEngine=createEngine({strategy:false,model:null}));return hash(RULES_ID+'|'+E.canonical(board,p).key+'|'+(firstPlayer==null?'unknown':firstPlayer===p?'first':'second'));}
function groupFamilies(records,prior=[]){
 const roots=records.map((_,i)=>i),find=i=>roots[i]===i?i:(roots[i]=find(roots[i])),join=(a,b)=>{a=find(a);b=find(b);if(a!==b)roots[b]=a;};
 const stems=records.map(r=>familyFor(r.events.slice(0,4),r.first)),prefix=(a,b)=>{if(a.events.length>b.events.length)[a,b]=[b,a];return a.events.length>=4&&familyFor(a.events,a.first)===familyFor(b.events.slice(0,a.events.length),b.first);};
 for(let a=0;a<records.length;a++)for(let b=a+1;b<records.length;b++)if(stems[a]===stems[b]||records[a].id===records[b].id||prefix(records[a],records[b]))join(a,b);
 const groups=new Map();records.forEach((r,i)=>{const k=find(i),rows=groups.get(k)||[];rows.push(r);groups.set(k,rows);});const aliases={},manifest=[];
 for(const rows of groups.values()){
  const priorRows=prior.filter(p=>rows.some(r=>r.id===p.id||r.contentId===p.contentId||r.familyId===p.familyId)),anchors=rows.map(r=>familyFor(r.events.slice(0,4),r.first)).sort(),familyId='family-'+hash(anchors[0]).slice(0,24),wasTrain=priorRows.some(r=>r.split==='train'),priorSplit=priorRows.some(r=>r.split==='validation')?'validation':priorRows[0]?.split,split=wasTrain?'train':priorSplit||rows[0].split,conflicts=[...new Set(priorRows.map(r=>r.split))];
  for(const r of rows){aliases[r.familyId]=familyId;r.familyId=familyId;r.split=split;}
  manifest.push({familyId,split,records:rows.map(r=>({id:r.id,contentId:r.contentId,source:r.source,turns:r.events.length})),priorSplitConflicts:conflicts.length>1?conflicts:[],finalTestEligible:split==='test'&&!wasTrain,reason:wasTrain?'Linked to an existing training family':'Conservative canonical first-four/prefix/source grouping'});
 }
 return {records,aliases,groups:manifest};
}
function splitFor(family,seed=1707){const n=parseInt(hash(seed+'|'+family).slice(0,8),16)%100;return n<70?'train':n<85?'validation':'test';}
function normalizeRecords(payload,options={}){
 if(typeof payload==='string'){const trim=payload.trim();if(trim[0]==='{'||trim[0]==='['){try{return normalizeRecords(JSON.parse(trim),options);}catch(e){if(e instanceof SyntaxError)throw Error('Invalid JSON record: '+e.message);throw e;}}payload={...eventsFromText(payload,options.firstPlayer),source:options.source||'text import'};}
 if(payload?.version===1&&Array.isArray(payload.games))payload=payload.games;
 if(!Array.isArray(payload))payload=[payload];
 return payload.map((game,n)=>{
  if(typeof game==='string'||Array.isArray(game))game=typeof game==='string'?eventsFromText(game,options.firstPlayer):{first:options.firstPlayer,events:game.map(c=>({coord:c}))};
  if(!game||typeof game!=='object')throw Error('Invalid game '+(n+1));
  const raw=game.events||game.moves;if(!Array.isArray(raw)||!raw.length)throw Error('Game '+(n+1)+' has no moves');if(raw.length>3000)throw Error('Game record exceeds 3000 turns');
  const first=game.first??game.firstPlayer??options.firstPlayer??raw[0]?.p;if(![1,2].includes(first))throw Error('Game '+(n+1)+': first player (1 or 2) required');
  let p=first;const events=raw.map((v,k)=>{if(typeof v==='string')v=/^PASS/i.test(v)?{type:'timeout'}:{coord:v};const q=v.p??p;if(q!==p)throw Error('Game '+(n+1)+' move '+(k+1)+': wrong player');const pass=v.type==='timeout'||v.type==='pass'||v.coord==='PASS';const out={type:pass?'timeout':'move',p:q,i:pass?null:index(v.i??v.coord)};p=3-p;return out;});
  const contentId=familyFor(events,first),familyId='family-'+hash(familyFor(events.slice(0,4),first)).slice(0,24),record={schemaVersion:1,rulesId:RULES_ID,id:game.id||'import-'+hash(events).slice(0,20),contentId,first,me:[1,2].includes(game.me)?game.me:null,source:game.source||options.source||'import',events,familyId,reportedResult:game.result||null};record.split=game.split||splitFor(record.familyId,options.seed);if(!['train','validation','test'].includes(record.split))throw Error('Invalid data split');replay(record);return record;
 });
}
function replay(record,options={}){
 const E=options.engine||createEngine({firstPlayer:record.first,strategy:false}),board=blank(),positions=[];let p=record.first,winner=null,full=false;
 if(record.rulesId&&record.rulesId!==RULES_ID)throw Error('Rule version mismatch in '+record.id);
 for(let k=0;k<record.events.length;k++){
  const e=record.events[k];if(winner!=null||full)throw Error(record.id+' move '+(k+1)+': move after game end');if(e.p!==p)throw Error(record.id+' move '+(k+1)+': wrong player');positions.push({board:board.slice(),p,firstPlayer:record.first,ply:k,actual:e.i,type:e.type});
  if(e.type==='move'){const s=E.inspect(board,e.i,p);if(!s.legal)throw Error(record.id+' move '+(k+1)+' '+coord(e.i)+': '+s.reason);board[e.i]=p;if(s.win.length)winner=p;full=!board.includes(0);}else if(e.type!=='timeout')throw Error(record.id+' move '+(k+1)+': unsupported event');p=3-p;
 }
 return {board,p,firstPlayer:record.first,positions,winner,completed:winner!=null||full,draw:winner==null&&full};
}
function outcome(E,board){const winners=new Set();for(let i=0;i<225;i++)if(board[i]&&E.win(board,i,board[i]).length)winners.add(board[i]);if(winners.size>1)throw Error('Both colors have winning lines');if(winners.size)return {completed:true,winner:[...winners][0],reason:'played-exact-five'};if(!board.includes(0))return {completed:true,winner:0,reason:'full-board'};return null;}
function legalMoves(E,board,p){return Array.from({length:225},(_,i)=>i).filter(i=>!board[i]&&E.inspect(board,i,p).legal);}
function opening(seed,count=4,first=seed%2?1:2){const random=rng(seed),E=createEngine({firstPlayer:first,strategy:false}),board=blank(),events=[];let p=first;for(let k=0;k<count;k++){const pool=legalMoves(E,board,p).filter(i=>Math.abs(i%15-7)<=4&&Math.abs((i/15|0)-7)<=4),i=pool[Math.floor(random.next()*pool.length)];if(i==null)break;board[i]=p;events.push({type:'move',p,i});p=3-p;}return {board,p,firstPlayer:first,events,familyId:'opening-'+hash(E.canonical(board,p).key).slice(0,24)};}
function bootstrap(options={}){
 const records=[],evidence=[],errors=[],seen=new Set();
 const add=(game,origin)=>{try{for(const r of normalizeRecords(game,{seed:options.seed,source:origin})){if(!seen.has(r.contentId)){seen.add(r.contentId);records.push(r);}evidence.push({source:origin,recordId:r.id,contentId:r.contentId,familyId:r.familyId,split:r.split,moves:r.events.length,completed:replay(r).completed,labelScope:'actual replay only; report proof claims are not terminal labels'});}}catch(e){errors.push({source:origin,error:e.message});}};
 for(const n of [29,31,33,47,48,95]){const file=path.join(ROOT,'test/reader/game'+n+'.cjs');if(fs.existsSync(file))add({id:'builtin-reader-'+n,first:[31,48].includes(n)?1:2,moves:require(file).coords},'test/reader/game'+n+'.cjs (app mapping)');}
 for(const file of ['app.js','unified-app.js']){
  const source=fs.readFileSync(path.join(ROOT,'src',file),'utf8');const expression=/(['"])([A-O](?:1[0-5]|[1-9])(?: (?:[A-O](?:1[0-5]|[1-9])|PASS)){3,})\1\.split\(['"] ['"]\)/g;let m;
  while((m=expression.exec(source))){const next=source.slice(expression.lastIndex,expression.lastIndex+7000),colors=/p\s*=\s*k\s*%\s*2\s*\?\s*([12])\s*:\s*([12])/.exec(next);if(!colors){errors.push({source:'src/'+file+':'+m.index,error:'Cannot infer source-declared first player; skipped'});continue;}add({id:'builtin-'+hash(file+'|'+m[2]).slice(0,20),first:+colors[2],moves:m[2].split(' ')},'src/'+file+' literal at '+m.index);}
 }
 for(const name of fs.readdirSync(path.join(ROOT,'reports')).filter(x=>x.endsWith('-loss-certificate.json'))){const file=path.join(ROOT,'reports',name),r=JSON.parse(fs.readFileSync(file,'utf8'));if(typeof r.prefix==='string')add({id:'certificate-prefix-'+name,first:r.firstPlayer||1,moves:r.prefix.split(' ')},'reports/'+name+' legacy black-first prefix; certificate remains unverified teacher evidence');}
 const grouped=groupFamilies(records);return {records:grouped.records,familyGroups:grouped.groups,evidence,errors,scope:'Existing source records and report prefixes replayed with the authoritative current house rules. Claims in annotations/certificates never become ground truth.'};
}
module.exports={blank,coord,index,eventsFromText,familyFor,positionKey,groupFamilies,splitFor,normalizeRecords,replay,outcome,legalMoves,opening,bootstrap};
