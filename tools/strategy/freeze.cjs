'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),baseline=path.resolve(root,'../baseline'),E=require(path.join(baseline,'src/node-engine.cjs'))();
const {index,replay}=require('./replay.cjs'),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const out=path.join(__dirname,'manifest.json');if(fs.existsSync(out))throw Error('Manifest already frozen; do not overwrite evaluation identities');
const definitions=[
 ['dev-A1','A','investigated-actual-turn-retained-attack',{own:['C8','D8','E8','D6','E7'],enemy:['B8','H11','I11','J11'],p:1},1,null,'Actual current side has connected attack; compare retained attack against hypothetical opponent VCF.'],
 ['dev-A2','A','first-linked-pair-and-diagonal',{own:['F8','G8','C5','D6'],enemy:['H11','I11','J11','K10'],p:1},1,null,'First mover has two cooperating preparation routes; strongest reply must be checked.'],
 ['dev-B1','B','vertical-unique-urgent','H7 H8 A1 H9 C1 H10 E1 H11',1,{required:['H12']},'First mover must block despite attacking stones.'],
 ['dev-B2','B','horizontal-unique-urgent','E8 F8 A1 G8 C1 H8 E1 I8',1,{required:['J8']},'Unique exact-five defense overrides strategic scoring.'],
 ['dev-C1','C','second-angled-core-interception','F7 H9 G7 I9 F9 J10 H8 G11 E8',1,null,'Second mover must compare interception of angled cooperating attacker routes.'],
 ['dev-C2','C','second-spaced-vertical-cores','H7 G8 H9 I8 I10 G10 J9 F10 H11',2,null,'Second mover can disrupt spaced vertical cores while preserving a separate counter-axis.'],
 ['dev-D1','D','split-three-cross-four','H6 F8 H7 G8 H9 I8 A1',2,{probes:['H8']},'Second mover can interrupt vertical preparation while creating a horizontal four.'],
 ['dev-D2','D','unique-gap-block-counter-four','H7 F9 H8 G9 H10 I9 H11 A1 B3',2,{required:['H9']},'Second mover must block H9, simultaneously extending its own horizontal attack.'],
 ['dev-E1','E','faster-opponent-win-than-created-four','H6 C5 H7 D5 H8 F5 I7 G5',1,{required:['E5'],probes:['H9']},'An attacking four must not ignore the faster opposing exact-five.'],
 ['dev-E2','E','blocking-point-creates-counter-fork',{own:['C8','D8','E8','G9','H7','A1','A3'],enemy:['B8','G5','G6','G7','D11','E10','F9'],p:1},1,{avoid:['F8'],probes:['F8']},'F8 creates a single forced G8 reply that simultaneously creates two opposing victory points.'],
 ['dev-F1','F','investigated-illegal-immediate-extension',['F8','H8','G6','G7','E10','F9'],1,{futureIllegal:{move:'E8',extension:'G8'}},'E8 is legal but its immediate G8 extension is prohibited; later exact-five extensions remain a separate question.'],
 ['dev-F2','F','blocked-end-six-by-gap-join',{own:['D8','E8','F8','G8','I8'],enemy:['A8','J8'],p:1},1,{notWin:['H8']},'Gap join produces six with an opposing cap, legally but without victory.'],
 ['holdout-A1','A','first-two-independent-broken-axes','H8 G9 J8 F7 H10 I11 G8 K9',1,null,'Unseen first-mover preparation with two distinct incomplete axes.'],
 ['holdout-A2','A','first-edge-connected-preparation','C5 E6 D5 F6 C7 E8 D7 G7 C8 F9',2,null,'Unseen edge-side connected preparation, evaluated with strongest replies.'],
 ['holdout-B1','B','diagonal-gap-required','A1 D5 C1 E6 E1 G8 G1 H9',2,{required:['F7']},'First mover has to block a gap exact-five point.'],
 ['holdout-B2','B','edge-capped-four-required','A1 A2 D4 A3 F6 A4 H7 A5',1,{required:['A6']},'First mover must defend a four capped by the board edge.'],
 ['holdout-C1','C','second-diagonal-and-horizontal-plan','F6 I8 G7 J9 H8 K7 F8',1,null,'Unseen second-mover interception of cooperating attacking axes.'],
 ['holdout-C2','C','second-separated-extension-cores','D8 H8 F8 H6 E10 J8 G10',2,null,'Unseen second-mover separation of distinct extension cores.'],
 ['holdout-D1','D','edge-urgent-counter-diagonal','A3 B6 A4 C5 A5 D4 A6 A2 H8',2,{required:['A7']},'Second mover blocks edge four while creating a diagonal four.'],
 ['holdout-D2','D','broken-diagonal-counter-axis','E5 H7 F6 I7 H8 K7 A1',1,{probes:['G7','J7']},'Second mover can intercept diagonal preparation or continue a broken horizontal axis.'],
 ['holdout-E1','E','counterwin-overrides-four-shape','H6 B4 H7 C4 H9 D4 H10 A1 E7',1,{required:['H8'],probes:['E4']},'Second mover must prevent H8 victory even though E4 creates an attacking four.'],
 ['holdout-E2','E','competing-unique-victory-tempi','D9 C7 F9 E7 G9 F7 H9 H7 A1',1,{required:['E9'],probes:['G7']},'Second mover must stop E9 exact-five rather than assume an attacking G7 will be answered.'],
 ['holdout-F1','F','blocked-apparent-broken-double-three',{own:['F8','I8','H6','H9'],enemy:['J8','H11'],p:2},2,{legal:['H8'],notWin:['H8']},'Opposing endpoint J8 invalidates one apparent broken-three axis; H8 remains legal but is not victory.'],
 ['holdout-F2','F','overline-and-new-double-three',['C8','D8','E8','F8','H8','G7','G9','F7','H9'],2,{illegal:['G8'],notWin:['G8']},'Gap move forms an overline plus two open-three axes; remains prohibited.']
];
function stonesReplay(stones,first){
 const pool=stones.slice(),moves=[];let side=first;
 while(pool.length){if(side===first){const j=pool.findIndex(c=>{const b=replay(E,{moves,firstPlayer:first}).board;return E.inspect(b,index(c),side).legal;});if(j<0)throw Error('Unreplayable stones');moves.push(pool.splice(j,1)[0]);}else moves.push('PASS');side=3-side;}
 if(side!==first)moves.push('PASS');return moves;
}
function setupReplay(setup,first){const pools={[setup.p]:setup.own.slice(),[3-setup.p]:setup.enemy.slice()},moves=[];let turn=first;
 while(pools[1].length||pools[2].length){const pool=pools[turn],b=replay(E,{moves,firstPlayer:first}).board,j=pool.findIndex(c=>E.inspect(b,index(c),turn).legal);if(pool.length&&j<0)throw Error('Illegal setup topology');moves.push(j<0?'PASS':pool.splice(j,1)[0]);turn=3-turn;}
 if(turn!==setup.p)moves.push('PASS');return moves;}
const cases=definitions.map(([id,category,family,prefix,firstPlayer,acceptance,note])=>{
 const moves=Array.isArray(prefix)?stonesReplay(prefix,firstPlayer):typeof prefix==='object'?setupReplay(prefix,firstPlayer):prefix.split(' '),position=replay(E,{moves,firstPlayer});
 if(position.winner)throw Error('Terminal fixture '+id);
 const row={id,split:id.startsWith('dev')?'development':'holdout',category,family,firstPlayer,p:position.p,moves,board:position.board,acceptance:acceptance||{},note,claim:'Probe classification; no winning or safe answer assumed beyond explicit tactical acceptance.'};
 for(const c of row.acceptance.illegal||[])if(E.inspect(row.board,index(c),row.p).legal)throw Error(id+' not illegal '+c);
 for(const c of row.acceptance.legal||[])if(!E.inspect(row.board,index(c),row.p).legal)throw Error(id+' unexpectedly illegal '+c);
 for(const c of row.acceptance.notWin||[])if(E.inspect(row.board,index(c),row.p).win.length)throw Error(id+' unexpectedly wins '+c);
 if(row.acceptance.futureIllegal){const a=row.acceptance.futureIllegal,b=row.board.slice(),i=index(a.move);if(!E.inspect(b,i,row.p).legal)throw Error(id+' initial move illegal');b[i]=row.p;if(E.inspect(b,index(a.extension),row.p).legal)throw Error(id+' extension unexpectedly legal');}
 if(row.acceptance.required){const enemy=E.winning(row.board,3-row.p).map(E.coord);if(enemy.length!==1||enemy[0]!==row.acceptance.required[0])throw Error(id+' invalid unique-defense fixture '+enemy);}
 row.positionSha256=hash(JSON.stringify({board:row.board,p:row.p,firstPlayer}));return row;
});
const openings=[['O1','H8 G8 H9 F9 I8',1],['O2','H8 G9 I8 H10 G7',2],['O3','H8 H9 G7 I9 F8',1],['O4','H8 F8 I9 G8 J10',2],['O5','H8 I9 F8 I7 G7',1],['O6','H8 G7 H10 I9 F8',2]].map(([id,prefix,firstPlayer])=>({id,firstPlayer,moves:prefix.split(' '),...replay(E,{moves:prefix.split(' '),firstPlayer})}));
const modes=[{id:'fast',ms:900,automatic:false,sliceMs:90000},{id:'auto',ms:15000,automatic:true,sliceMs:360000},{id:'deep25',ms:25000,automatic:false,sliceMs:900000}];
const games=openings.flatMap((o,k)=>modes.flatMap(m=>[0,1].map(pair=>({id:o.id+'-'+m.id+'-'+pair,opening:o.id,mode:m.id,stage:k+1,improvedFirst:!!(pair^(k%2)),firstPlayer:o.firstPlayer}))));
const sourceFiles=['gpu-patterns.js','reader-engine.js','forest-engine.js','unified-engine.js','app.js','unified-app.js','gpu-app.js','template.html'];
const baselineSources=Object.fromEntries(sourceFiles.map(f=>[f,hash(fs.readFileSync(path.join(baseline,'src',f)))]));
const knownReplays=[{id:'known-sixth',firstPlayer:1,prefix:'H8 G7 G6 H6 F8'},{id:'known-H7',firstPlayer:2,prefix:'H8 G7 I8 F8 H6'},{id:'known19',firstPlayer:2,prefix:'H8 G7 I8 F8 H9 H6 E9 G6 H10 H7 F9 G9'},{id:'known30-first',firstPlayer:2,prefix:'H8 G7 H7 H6 F8 G8 G6 H9'},{id:'known15-trap',firstPlayer:1,prefix:'H8 H6 H10 G7 F8 I5 G9 E7 F10 I7 G10'},{id:'known30-trap',firstPlayer:2,prefix:'K4 K5 L5 M6 J5 J4 L3 I6 L6 L4 L7 J7 M8 K6 L8 L9 K8 J8 K3 I7 M2 N1'}].map(x=>({...x,moves:x.prefix.split(' '),...replay(E,{moves:x.prefix.split(' '),firstPlayer:x.firstPlayer})}));
const manifest={version:1,frozenAt:new Date().toISOString(),baselineCommit:'72a11f7fd3bd7b4c922d337b9cfdc036ee0030ed',baselineArchiveSha256:hash(fs.readFileSync(path.resolve(root,'../baseline-source.zip'))),baselineSources,rules:{fivePriority:true,doubleThree:'both-colors',doubleFour:'allowed',overline:'legal-unless-double-three;not-win'},stageCapMs:3600000,cases,knownReplays,openings,modes,games,successPolicy:'No tactical regressions; compare actual legal continuations and strongest replies. Strategy scores and unresolved proof are not improvement evidence. Exact-five played on board alone scores victory; stopped games remain unfinished.'};
const serialized=JSON.stringify(manifest,null,2)+'\n';fs.writeFileSync(out,serialized);fs.writeFileSync(out+'.sha256',hash(serialized)+'\n');console.log('FROZEN '+hash(serialized)+' '+cases.length+' cases / '+games.length+' games');
