
'use strict';
const E=createEngine(),$=id=>document.getElementById(id),names=/*PIECE_NAMES*/["","흑돌","백돌"],SOURCE=/*PIECE_SOURCE*/null,STORAGE_KEY=/*STORAGE_KEY*/"my-omok-v1";
const sprite=p=>{let a=document.createElement('span');a.className='sprite s'+p;a.setAttribute('role','img');a.setAttribute('aria-label',names[p]);if(SOURCE){let im=new Image();im.src=SOURCE;im.alt=names[p];a.append(im);}return a;};
let db={version:1,games:[],lessons:[]},g=null,b=Array(225).fill(0),turn=2,events=[],cursor=0,paused=true,remaining=40000,deadline=0,rec=null,worker=null,job=0,reviewing=false,autoplay=null,hints=true,winCells=[],resumeAfterModal=false,analysisBefore=null;
try{let saved=localStorage.getItem(STORAGE_KEY);if(saved)db=validate(JSON.parse(saved));}catch(e){$('message').textContent='저장 기록을 읽지 못했습니다. JSON 백업을 가져올 수 있습니다.';}
function persist(){try{if(g){db.activeId=g.id;let saved={...g,events,cursor:reviewing?analysisBefore.cursor:cursor,remaining:reviewing?analysisBefore.remaining:(paused?remaining:Math.max(0,deadline-Date.now())),result:reviewing?analysisBefore.result:g.result};let n=db.games.findIndex(a=>a.id===g.id);if(n<0)db.games.unshift(saved);else db.games[n]=saved;}localStorage.setItem(STORAGE_KEY,JSON.stringify(db));}catch(e){msg('브라우저 저장 공간을 사용할 수 없습니다. JSON을 내보내 주세요.');}}
function validate(d){if(!d||d.version!==1||!Array.isArray(d.games)||!Array.isArray(d.lessons)||d.games.length>300||d.lessons.length>2000)throw Error('지원하지 않는 기록 형식');for(let x of d.games){if(typeof x.id!=='string'||x.id.length>100||![1,2].includes(x.first)||![1,2].includes(x.me)||!Array.isArray(x.events)||x.events.length>3000)throw Error('게임 정보 오류');const ruleEngine=createEngine(x.rules||{});let board=Array(225).fill(0),p=x.first,ended=false;for(let v of x.events){if(ended||v.p!==p||!['move','timeout'].includes(v.type))throw Error('턴 순서 오류');if(v.type==='move'){let s=ruleEngine.inspect(board,v.i,p);if(!s.legal)throw Error('불법 착수가 포함된 기보');board[v.i]=p;if(s.win.length)ended=true;}p=3-p;}if(!Number.isInteger(x.cursor)||x.cursor<0||x.cursor>x.events.length)throw Error('기보 위치 오류');}for(let l of d.lessons)if(typeof l.key!=='string'||!/^[012]{225}$/.test(l.key)||!Number.isInteger(l.bad)||l.bad<0||l.bad>=225||!Number.isInteger(l.good)||l.good<0||l.good>=225)throw Error('학습 데이터 오류');return d;}
function msg(t){$('message').textContent=t;}
function stopWorker(){job++;if(worker){worker.terminate();worker=null;}}
function freeze(){if(!paused)remaining=Math.max(0,deadline-Date.now());paused=true;}
function resume(){if(!g||reviewing||g.result)return;paused=false;deadline=Date.now()+Math.max(1,remaining);}
function rebuild(){E.configure({...g.rules,firstPlayer:g.first});b.fill(0);turn=g.first;winCells=[];g.result=null;for(let e of events.slice(0,cursor)){if(e.type==='move'){b[e.i]=e.p;let w=E.win(b,e.i,e.p);if(w.length){winCells=w;g.result={winner:e.p};}}turn=3-e.p;}if(!b.includes(0)&&!g.result)g.result={winner:0};}
function render(){const cells=$('board').children;for(let i=0;i<225;i++){let el=cells[i];el.replaceChildren();el.className='cell';el.setAttribute('aria-label',E.coord(i)+' '+(b[i]?names[b[i]]:'빈칸'));if(b[i])el.append(sprite(b[i]));if(i===events[cursor-1]?.i)el.classList.add('last');if(hints&&rec?.i===i&&!b[i]){el.classList.add('hint');el.append(sprite(turn));}if(hints&&rec?.threats?.includes(i)&&!b[i])el.classList.add('threat');if(winCells.includes(i))el.classList.add('winner');el.disabled=!!b[i]||paused||reviewing||!!g?.result;}
 $('turnSprite').replaceChildren(sprite(turn));$('turnName').textContent=!g?'게임 준비':g.result?(g.result.winner?names[g.result.winner]+' 승리':'무승부'):names[turn]+' 차례';$('turnInfo').textContent=g?`${turn===g.me?'내 돌':'상대 돌'} · ${cursor+1}번째 턴 · ${reviewing?'복기 중':paused?'일시 정지':'직접 착수하세요'}`:'돌와 선공을 선택하세요';$('pause').textContent=paused?'재개':'일시 정지';$('undo').disabled=!g||cursor===0||reviewing;$('redo').disabled=!g||cursor>=events.length||reviewing;$('count').textContent=g?`${cursor}턴 · 내 돌 ${names[g.me]}`:cursor+'턴';$('reviewPanel').style.display=reviewing?'block':'none';$('hint').textContent=hints?'추천 켜짐':'추천 꺼짐';$('hint').setAttribute('aria-pressed',String(hints));
 $('recommend').textContent=rec?.i!=null?E.coord(rec.i):'—';$('reason').textContent=rec?.reason||'국면을 분석하면 추천과 근거가 표시됩니다.';$('metrics').textContent=rec?`${rec.depth}수 탐색 · ${rec.ms}ms · ${rec.nodes}노드 · ${rec.proven?'강제승 확인':rec.lossProven?'강제 패배 확인':'평가 '+Math.round(rec.score||0)+' (추정)'}`:'제한 탐색 · 승리 보장 아님';$('sequence').textContent=rec?.dangerLine?.length?'막아야 할 상대 강제 수순: '+rec.dangerLine.map(E.coord).join(' → '):rec?.pv?.length?(rec.proven?'확인한 공격 수순: ':'예상 진행: ')+rec.pv.map(E.coord).join(' → '):'';$('memoryWarning').textContent=rec?.memory?'과거 패배 기록과 같은 국면입니다. 회전·대칭 포함.':'';
 $('log').replaceChildren();events.forEach((e,k)=>{let el=document.createElement('button');el.className=k===cursor-1?'active':'';let a=document.createElement('span'),c=document.createElement('span'),owner=e.p===g.me?'내 돌':'상대 돌';a.textContent=`${k+1}. ${names[e.p]} ${e.type==='timeout'?'시간 초과':E.coord(e.i)} · ${owner}`;c.textContent=e.rec?.i===e.i?'추천 일치':e.type==='timeout'?'턴 넘김':'';el.append(a,c);el.onclick=()=>enterReview(k+1);$('log').append(el);});
 const e=events[cursor-1];$('reviewInfo').textContent=cursor===0?'시작 전':`${cursor}턴 · ${names[e?.p]} · ${e?.type==='timeout'?'시간 초과':E.coord(e.i)} · ${e?.remaining==null?'시간 기록 없음':'남은 '+Math.ceil(e.remaining/1000)+'초'} · 당시 추천 ${e?.rec?.i!=null?E.coord(e.rec.i):'기록 없음'}${e?.annotation?' · '+e.annotation:''}`;tickDisplay();}
function tickDisplay(){let n=Math.max(0,paused?remaining:deadline-Date.now());$('timer').textContent=Math.ceil(n/1000);$('timer').classList.toggle('warn',n<=10000&&!paused);$('timebar').style.width=Math.min(100,n/400)+'%';}
function analyze(budget=+$('budget').value,onDone){stopWorker();if(!g||g.result){$('analysisState').textContent=g?.result?'종료':'준비';return;}let token=job,board=b.slice(),p=turn;$('analysisState').textContent='분석 중';
 const immediate=E.urgent(board,p);if(immediate){rec=immediate;$('analysisState').textContent=immediate.lossProven?'방어 불가':immediate.proven?'즉시 승리':'즉시 방어';render();if(onDone)onDone(rec);return;}
 try{let src=$('engineSource').textContent+'\nonmessage=e=>{try{const engine=createEngine({firstPlayer:e.data.firstPlayer});postMessage({ok:true,result:engine.analyze(e.data.b,e.data.p,e.data.ms,e.data.lessons)})}catch(x){postMessage({ok:false,error:String(x)})}}';let url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));worker=new Worker(url);URL.revokeObjectURL(url);worker.onmessage=e=>{if(token!==job)return;worker.terminate();worker=null;if(!e.data.ok){msg('분석 오류: '+e.data.error);$('analysisState').textContent='분석 실패';return;}rec=e.data.result;$('analysisState').textContent='분석 완료';render();if(onDone)onDone(rec);};worker.onerror=()=>{stopWorker();$('analysisState').textContent='분석 사용 불가';msg('이 브라우저에서 분석 Worker를 실행하지 못했습니다. Chrome 또는 Edge에서 파일을 열어 주세요.');};worker.postMessage({b:board,p,ms:budget,lessons:db.lessons,firstPlayer:g.first});}catch(e){$('analysisState').textContent='분석 사용 불가';msg(String(e));}}
function move(i){if(!g||paused||reviewing||g.result)return;if(g.timer!==false&&Date.now()>=deadline){commit(null);return;}let s=E.inspect(b,i,turn);if(!s.legal){msg(s.reason+(s.threes?.length?' · '+s.threes.map(a=>['가로','세로','↘ 대각선','↗ 대각선'][a]).join(', '):''));let el=$('board').children[i];el.classList.add('illegal');setTimeout(()=>el.classList.remove('illegal'),1000);return;}commit(i,s);}
function commit(i,s){stopWorker();remaining=Math.max(0,deadline-Date.now());if(cursor<events.length)events=events.slice(0,cursor);let ev={type:i==null?'timeout':'move',p:turn,i,time:new Date().toISOString(),remaining,rec:rec?JSON.parse(JSON.stringify(rec)):null,legal:true,shape:s?{threes:s.threes,fours:s.fours,fork43:s.fork43}:null};if(s?.fork43)ev.annotation='4-3 공격 생성';events.push(ev);cursor++;rec=null;rebuild();remaining=40000;deadline=Date.now()+40000;if(g.result)paused=true;persist();render();msg(i==null?'40초가 지나 상대에게 턴을 넘겼습니다.':g.result?'게임 종료. 패배 복기에서 중요한 수를 살펴보세요.':`${names[ev.p]} ${E.coord(i)} 착수`);if(!g.result)analyze();}
function navigate(n){stopWorker();cursor=Math.max(0,Math.min(events.length,n));rec=null;rebuild();remaining=40000;render();if(reviewing){let e=events[cursor];rec=e?.rec||null;render();}else{paused=!!g.result;deadline=Date.now()+40000;persist();analyze();}}
function enterReview(n=cursor){if(!g)return;freeze();stopWorker();if(!reviewing)analysisBefore={cursor,remaining,result:g.result};reviewing=true;navigate(n);render();}
function leaveReview(){clearInterval(autoplay);autoplay=null;$('play').textContent='▶ 재생';reviewing=false;cursor=analysisBefore?.cursor??events.length;remaining=analysisBefore?.remaining??40000;rebuild();rec=null;paused=true;render();analyze();msg('복기를 마쳤습니다. 재개를 누르면 남은 시간으로 계속합니다.');}
function openModal(title){freeze();stopWorker();$('modalTitle').textContent=title;$('modalBody').replaceChildren();$('modal').showModal();render();return $('modalBody');}
function paragraph(parent,t){let p=document.createElement('p');p.textContent=t;parent.append(p);return p;}
function button(parent,t,fn){let z=document.createElement('button');z.textContent=t;z.onclick=fn;parent.append(z);return z;}
function loadGame(x){stopWorker();clearInterval(autoplay);autoplay=null;g=JSON.parse(JSON.stringify(x));events=g.events;cursor=g.cursor;remaining=Number.isFinite(g.remaining)?Math.max(0,Math.min(40000,g.remaining)):40000;paused=true;reviewing=false;rec=null;rebuild();render();analyze();}
function exportDB(){persist();let blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='omok-records-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);msg('JSON 기록을 내보냈습니다.');}
function learn(){if(!g||!cursor){msg('복기에서 기록할 수를 선택하세요.');return;}let ev=events[cursor-1];if(ev.type!=='move'){msg('시간 초과 대신 실제 착수 턴을 선택하세요.');return;}let pre=Array(225).fill(0);for(let v of events.slice(0,cursor-1))if(v.type==='move')pre[v.i]=v.p;let can=E.canonical(pre,ev.p);let body=openModal('패배 방지 기록 추가');paragraph(body,`${cursor}턴 ${E.coord(ev.i)}를 위험 수로 기록합니다. 검증한 대안을 입력하세요.`);let input=document.createElement('input');input.placeholder='대안 좌표 예: H8';input.value=ev.review?.i!=null?E.coord(ev.review.i):ev.rec?.i!=null?E.coord(ev.rec.i):'';input.setAttribute('aria-label','안전한 대안 좌표');body.append(input);button(body,'대안 검증 후 저장',()=>{let m=/^([A-O])(1[0-5]|[1-9])$/i.exec(input.value.trim()),i=m?(+m[2]-1)*15+m[1].toUpperCase().charCodeAt(0)-65:-1;if(i===ev.i||!E.inspect(pre,i,ev.p).legal){paragraph(body,'실제 수와 다른 합법적인 좌표를 입력하세요.');return;}db.lessons.push({key:can.key,bad:E.transformed(ev.i,can.t),good:E.transformed(i,can.t),game:g.id,turn:cursor,date:new Date().toISOString(),type:ev.annotation||'사용자 복기',verified:false});persist();$('modal').close();msg('패배 방지 기록을 저장했습니다. 동일 국면에서 다시 탐색해 참고합니다.');});}
async function postmortem(){
 if(!g||!events.length)return;freeze();stopWorker();
 let body=openModal('패배 복기 · 주요 수 재분석'),info=paragraph(body,'실제 착수 뒤의 상대 강제 수순을 함께 검사합니다. 대안의 무패를 보장하지는 않습니다.'),bar=document.createElement('progress');bar.max=events.length;body.append(bar);
 let board=Array(225).fill(0),cancelled=false,work=null;
 $('modal').addEventListener('close',()=>{cancelled=true;work?.terminate();},{once:true});
 let endBoard=Array(225).fill(0),winner=0;for(let e of events)if(e.type==='move'){endBoard[e.i]=e.p;if(E.win(endBoard,e.i,e.p).length)winner=e.p;}
 let target=winner?3-winner:g.me,found=0;
 for(let k=0;k<events.length;k++){
  if(cancelled)break;let ev=events[k];bar.value=k+1;
  if(ev.p===target&&ev.type==='move'){
   let result=await new Promise(resolve=>{
    let src=$('engineSource').textContent+'\nonmessage=e=>{try{postMessage(createEngine({...e.data.rules,firstPlayer:e.data.firstPlayer,model:e.data.model}).reviewMove(e.data.b,e.data.p,e.data.i,1300,[]))}catch(x){postMessage(null)}}';
    let url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));work=new Worker(url);URL.revokeObjectURL(url);
    let done=false;const finish=r=>{if(done)return;done=true;clearTimeout(timeout);work?.terminate();resolve(r);};
    let timeout=setTimeout(()=>finish(null),4500);work.onmessage=e=>finish(e.data);work.onerror=()=>finish(null);work.postMessage({b:board.slice(),p:ev.p,i:ev.i,rules:g.rules||{},firstPlayer:g.first,model:E.getModel()});
   });
   if(result&&!cancelled){ev.review=result;if(result.i!==ev.i||result.actualLossProof||result.lossProven){found++;ev.annotation=result.reviewLabel;
    let item=document.createElement('div');item.className='entry';
    paragraph(item,(k+1)+'턴: '+E.coord(ev.i)+' · '+result.reviewLabel);
    if(result.i!==ev.i&&!result.lossProven)paragraph(item,'대안 '+(result.i==null?'없음':E.coord(result.i))+' · '+result.reason);
    if(result.actualLossProof)paragraph(item,'착수 후 상대 강제 수순: '+result.actualLossProof.pv.map(E.coord).join(' → '));
    button(item,'이 수 복기',()=>{$('modal').close();enterReview(k+1);});body.append(item);
   }}
  }
  if(ev.type==='move')board[ev.i]=ev.p;
 }
 if(!cancelled){info.textContent=names[target]+' 관점 · '+found+'개 검토 항목. 강제 수순이 확인된 항목과 추정 대안을 구분합니다.';persist();}work?.terminate();
}
for(let i=0;i<225;i++){let el=document.createElement('button');el.className='cell';if([48,56,112,168,176].includes(i))el.dataset.star='true';el.onclick=()=>move(i);$('board').append(el);}for(let i=0;i<15;i++){let x=document.createElement('span');x.textContent=String.fromCharCode(65+i);$('axisx').append(x);let y=document.createElement('span');y.textContent=i+1;$('axisy').append(y);}
$('new').onclick=()=>{freeze();stopWorker();$('setup').showModal();render();};$('cancelSetup').onclick=()=>$('setup').close();$('setup').addEventListener('close',()=>{render();if(g&&!g.result)analyze();});$('start').onclick=()=>{persist();clearInterval(autoplay);reviewing=false;let me=+$('my').value,first=$('starter').value==='me'?me:3-me;g={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),date:new Date().toISOString(),me,first,rules:{fivePriority:true},timer:$('useTimer').checked,axis:$('axisChoice').value,events:[],cursor:0,result:null};events=[];cursor=0;remaining=40000;rec=null;rebuild();paused=false;deadline=Date.now()+40000;$('setup').close();persist();render();msg('두 돌 모두 직접 놓으세요. 나의 다음 수를 추천합니다.');};
$('pause').onclick=()=>{if(reviewing||g?.result)return;paused?resume():freeze();render();persist();};$('undo').onclick=()=>navigate(cursor-1);$('redo').onclick=()=>navigate(cursor+1);$('hint').onclick=()=>{hints=!hints;render();};$('review').onclick=()=>enterReview();$('leaveReview').onclick=leaveReview;$('first').onclick=()=>navigate(0);$('prev').onclick=()=>navigate(cursor-1);$('next').onclick=()=>navigate(cursor+1);$('last').onclick=()=>navigate(events.length);$('rethink').onclick=()=>analyze(7000);$('budget').onchange=()=>analyze();$('play').onclick=()=>{if(autoplay){clearInterval(autoplay);autoplay=null;$('play').textContent='▶ 재생';return;}if(cursor===events.length)navigate(0);$('play').textContent='■ 정지';autoplay=setInterval(()=>{if(cursor>=events.length){clearInterval(autoplay);autoplay=null;$('play').textContent='▶ 재생';}else navigate(cursor+1);},+$('speed').value);};
$('closeModal').onclick=()=>$('modal').close();$('modal').addEventListener('close',()=>{render();if(g&&!g.result&&!reviewing)analyze();});$('history').onclick=()=>{persist();let body=openModal('저장된 게임');if(!db.games.length)paragraph(body,'저장된 게임이 없습니다.');for(let x of db.games){let item=document.createElement('div');item.className='entry';paragraph(item,new Date(x.date).toLocaleString()+' · '+x.events.length+'턴');button(item,'불러오기',()=>{loadGame(x);$('modal').close();});button(item,'삭제',()=>{if(confirm('이 게임 기록을 삭제할까요? JSON 백업이 없다면 복구할 수 없습니다.')){db.games=db.games.filter(a=>a.id!==x.id);if(g?.id===x.id){g=null;events=[];cursor=0;b.fill(0);paused=true;rec=null;}persist();item.remove();render();}});body.append(item);}};
$('lessons').onclick=()=>{let body=openModal('패배 방지 기록');paragraph(body,db.lessons.length+'개 · 대칭/회전 포함 전체 판 일치 방식');for(let l of db.lessons){let item=document.createElement('div');item.className='entry';paragraph(item,`${l.turn}턴 · ${l.type} · ${new Date(l.date).toLocaleDateString()}`);button(item,'원본 기보',()=>{let x=db.games.find(a=>a.id===l.game);if(x){loadGame(x);$('modal').close();enterReview(l.turn);}else paragraph(item,'원본 기보가 삭제되었습니다.');});button(item,'삭제',()=>{if(confirm('이 학습 기록을 삭제할까요?')){db.lessons=db.lessons.filter(a=>a!==l);persist();item.remove();}});body.append(item);}};
$('export').onclick=exportDB;$('import').onclick=()=>{freeze();render();$('file').click();};$('file').onchange=async()=>{try{let f=$('file').files[0];if(!f)return;if(f.size>10000000)throw Error('10MB 이하 JSON만 지원합니다');let x=validate(JSON.parse(await f.text()));for(let a of x.games)if(!db.games.some(v=>v.id===a.id))db.games.push(a);for(let a of x.lessons)if(!db.lessons.some(v=>v.key===a.key&&v.bad===a.bad&&v.good===a.good))db.lessons.push(a);persist();msg('기록을 가져왔습니다. 기존 기록은 유지했습니다.');}catch(e){msg('가져오기 실패: '+e.message);}finally{$('file').value='';}};
$('copy').onclick=()=>{let body=openModal('기보 텍스트 · 선택하여 복사'),area=document.createElement('textarea');area.readOnly=true;area.value=events.map((e,k)=>`${k+1}. ${names[e.p]} ${e.type==='timeout'?'PASS(40초 초과)':E.coord(e.i)}`).join('\n');body.append(area);area.select();};$('learn').onclick=learn;$('postmortem').onclick=postmortem;
setInterval(()=>{if(g&&g.timer!==false&&!paused&&!reviewing&&!g.result&&Date.now()>=deadline)commit(null);tickDisplay();},100);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!paused&&g&&g.timer!==false&&!g.result&&Date.now()>=deadline)commit(null);});window.addEventListener('beforeunload',()=>{freeze();persist();});
// 상대 4-3 생성 시 바로 앞 수를 복기 대상으로 남긴다.
const originalCommit=commit;commit=function(i,s){if(s?.fork43&&cursor&&events[cursor-1].type==='move'){events[cursor-1].annotation='4-3 방어 실패 · 다음 턴 상대 위협 형성';}originalCommit(i,s);};
// 새 게임 시작 시 이전 게임의 분석 완료 배지가 잠깐 남지 않도록 한다.
$('start').addEventListener('click',()=>{$('analysisState').textContent='분석 중';});
const originalRender=render;render=function(){document.querySelector('.threat-lines')?.remove();originalRender();if(!hints||!rec?.threats?.length)return;let ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 1500 1500');svg.setAttribute('aria-hidden','true');svg.classList.add('threat-lines');for(let i of rec.threats.slice(0,3)){let s=E.inspect(b,i,3-turn);if(!s.legal)continue;for(let axis of [...new Set([...s.threes,...s.fours])]){let d=E.D[axis],pts=[i];for(let k=-4;k<=4;k++){let x=i%15+d[0]*k,y=(i/15|0)+d[1]*k;if(x>=0&&x<15&&y>=0&&y<15&&b[y*15+x]===3-turn)pts.push(y*15+x);}pts.sort((a,c)=>axis===3?a%15-c%15:a-c);if(pts.length<2)continue;let a=pts[0],z=pts[pts.length-1],line=document.createElementNS(ns,'line');for(let [key,v]of Object.entries({x1:a%15*100+50,y1:(a/15|0)*100+50,x2:z%15*100+50,y2:(z/15|0)*100+50}))line.setAttribute(key,v);svg.append(line);}}$('board').append(svg);};
// 사용자가 제공한 실제 기보. 시각/남은 시간/당시 추천은 제공되지 않아 null로 기록.
const studyId='slime-loss-2026-09-25-42',studyMoves='H8 I8 H7 H9 H6 G8 H4 H5 G7 F7 I10 J7 G10 I6 G4 G6 I4 F4 K4 J4 E8 I7 I9 F6 K11 J10 F5 E6 D5 K6 L5 K8 L9 K7 L7 L8 K9 J8 M8 J9 J11 J6'.split(' ');
function makeStudy(){let board=Array(225).fill(0),lesson=null,notes={18:'놓친 강제승: K4 대신 J4 → 상대 K4 → I5. K3·F8 두 승리점 생성.',24:'놓친 강제승: K11 대신 J10 → 상대 K11 → H10. F10·K10 두 승리점 생성.',34:'핵심 분기점: L7 대신 K9 선제 방어. L7 뒤 흑돌의 연속 4 강제승 수순 확인.',36:'이미 모든 합법적 방어에서 흑돌 연속 4 강제승 확인. 이 수만의 실수 아님.',37:'J8로 가로 4와 세로 열린 3 동시 위협',39:'J6·J11 두 승리점 생성',41:'J6~J10 정확한 5목으로 흑돌 승리'};
 let evs=studyMoves.map((c,k)=>{let i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=E.inspect(board,i,p);if(k===34){let can=E.canonical(board,p);lesson={key:can.key,bad:E.transformed(i,can.t),good:E.transformed(130,can.t),game:studyId,turn:35,date:'2026-09-25',type:'35수 L7 이후 강제패배 수순 · K9 선제 방어',verified:true,scope:'11수 이내 연속 4 방어 검사',updateId:'loss-v2'};}board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:s.legal,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:notes[k]||''};});
 return {game:{id:studyId,date:'2026-09-25',me:2,first:2,events:evs,cursor:42,remaining:40000,result:{winner:1},source:'사용자 제공 42수 기보'},lesson};}
const study=makeStudy();
// 기존 게임/현재 선택을 덮어쓰지 않고 새 사례만 한 번 추가한다.
if(!db.appliedUpdates?.includes('loss-v2-final')){let prior=db.games.find(x=>x.id===studyId);if(!prior)db.games.push(study.game);else for(let k of [18,24,34,36,37,39,41])if(prior.events[k]?.i===study.game.events[k].i)prior.events[k].annotation=study.game.events[k].annotation;if(!db.lessons.some(l=>l.updateId==='loss-v2'))db.lessons.push(study.lesson);db.appliedUpdates=[...(db.appliedUpdates||[]),'loss-v2-final'];persist();}
const studyButton=button($('learn').parentElement,'이번 패배 · 35수 복기',()=>{persist();loadGame(db.games.find(x=>x.id===studyId)||study.game);enterReview(34);analyze(5000);msg('35수 직전입니다. 약 5초간 방어를 검증합니다. 기존 L7과 대안 K9을 비교하세요. 제한 탐색으로 무패를 보장하지는 않습니다.');});
studyButton.id='lossStudy';
// 두 번째 제공 기보: 사용자는 흑돌. 추정 대안은 검증된 학습값으로 넣지 않는다.
const mushroomStudyId='mushroom-loss-2026-09-25-21';
function makeMushroomStudy(){
 const moves='H8 G7 H9 H6 F8 I5 G8 I8 F7 J4 K3 I10 F9 F10 F5 F6 E9 E6 G9 I9 D9'.split(' '),board=Array(225).fill(0);
 const notes={11:'복기 대안: I10 대신 E6 비교 (제한 탐색의 추정, 생존·승리 보장 아님)',15:'F6은 상대의 즉시 5목을 차단하는 수',17:'이 수 직전 이미 모든 합법적 방어에 연속 4 강제패배 확인. E6만의 실수로 판단하지 않음',18:'G9로 E9–H9 열린 4 완성. D9·I9 두 승리점',19:'I9을 막아도 D9이 남음. 마지막 수만 바꿔서는 방어 불가',20:'D9–H9 정확한 5목. 백돌 승리, 사용자 흑돌 패배'};
 const events=moves.map((c,k)=>{const i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=E.inspect(board,i,p);if(!s.legal)throw Error('흑돌 복기 기보 불법 수');board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:notes[k]||''};});
 return {id:mushroomStudyId,date:'2026-09-25',me:1,first:2,events,cursor:21,remaining:40000,result:{winner:2},source:'사용자 제공 21수 기보 · 사용자 흑돌'};
}
const mushroomStudy=makeMushroomStudy();
if(!db.appliedUpdates?.includes('mushroom-loss-v2.2')){if(!db.games.some(x=>x.id===mushroomStudyId))db.games.push(mushroomStudy);db.appliedUpdates=[...(db.appliedUpdates||[]),'mushroom-loss-v2.2'];persist();}
const mushroomStudyButton=button($('learn').parentElement,'흑돌 패배 · 12수 복기',()=>{persist();loadGame(db.games.find(x=>x.id===mushroomStudyId)||mushroomStudy);enterReview(11);analyze(7000);msg('사용자는 흑돌입니다. I10과 추정 대안 E6을 비교하세요. 대안의 생존·승리는 보장하지 않습니다.');});
mushroomStudyButton.id='mushroomLossStudy';
const versionBadge=document.querySelector('.app-version');
versionBadge.textContent='v2.3.0';versionBadge.setAttribute('aria-label','앱 버전 2.3.0');versionBadge.title='4목 즉시 방어 · 열린 4 방어 불가 경고 · 53턴 패배 복기';
const timeoutStudyId='mushroom-loss-2026-09-25-53';
function makeTimeoutStudy(){
 const moves='H8 G7 I7 G9 G8 H9 F8 J8 I9 I8 J7 G10 F11 F9 E8 D8 K7 L7 J6 K5 E9 J5 I5 L8 H4 G3 M8 L6 L5 L9 L10 J10 H5 I10 H10 K9 M7 I11 H12 H7 G6 F7 I4 E7 D7 K2 J4 G4 I6 I3 H6 PASS F6'.split(' '),board=Array(225).fill(0);
 const notes={15:'D8: 상대 4목의 유일한 승리점 즉시 방어',25:'G3: 대각선 4목 즉시 방어',47:'이미 모든 합법적 방어에 연속 4 강제패배 확인. G4만의 실수로 판단하지 않음',49:'I3: 상대 세로 4목 즉시 방어',50:'H6: G6–J6 열린 4. F6·K6 두 승리점이므로 한 수 방어 불가',51:'40초 초과 PASS. 시간 초과 이전부터 F6·K6 동시 위협으로 방어 불가',52:'F6–J6 정확한 5목. 사용자 흑돌 패배'};
 const events=moves.map((c,k)=>{let p=k%2?1:2;if(c==='PASS')return {type:'timeout',i:null,p,time:null,remaining:0,rec:null,legal:true,shape:null,annotation:notes[k]||''};let i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,s=E.inspect(board,i,p);if(!s.legal)throw Error('53턴 기보 불법 착수');board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:notes[k]||''};});
 return {id:timeoutStudyId,date:'2026-09-25',me:1,first:2,events,cursor:53,remaining:40000,result:{winner:2},source:'사용자 제공 53턴 기보 · 52턴 시간 초과'};
}
const timeoutStudy=makeTimeoutStudy();
if(!db.appliedUpdates?.includes('timeout-loss-v2.3')){if(!db.games.some(x=>x.id===timeoutStudyId))db.games.push(timeoutStudy);db.appliedUpdates=[...(db.appliedUpdates||[]),'timeout-loss-v2.3'];persist();}
button($('learn').parentElement,'53턴 패배 · 열린 4 복기',()=>{persist();loadGame(db.games.find(x=>x.id===timeoutStudyId)||timeoutStudy);enterReview(51);analyze();msg('52턴 직전: F6·K6 두 승리점. PASS가 아니어도 한 수로 모두 막을 수 없습니다. 이전 수로 이동해 복기하세요.');}).id='timeoutLossStudy';

const case58Id='slime-loss-2026-09-25-58',case58Moves='H8 H9 G9 I7 G7 I9 G8 G6 G11 G10 I8 J8 F10 K7 F8 E8 E11 D12 L6 F9 H11 F11 H6 E12 D13 E9 E7 D6 H10 I11 C6 J10 I5 J4 J9 I10 H12 K9 I13 J14 H14 H13 K6 J6 J7 K11 M4 L5 K10 L12 M13 L8 M7 L10 M11 M9 N10 N8'.split(' ');
const case58Board=Array(225).fill(0),case58Events=case58Moves.map((c,k)=>{let i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=E.inspect(case58Board,i,p);if(!s.legal)throw Error('58수 기보 규칙 오류');case58Board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:({46:'M4 공격 → L5 강제 방어 뒤 역공 함정. 깊은 분석에서 위험 후보 제외',48:'이미 연속 4 강제패배 상태. 마지막 방어만의 실수 아님',57:'N8로 J12·O7 두 승리점. 아직 5목은 아니지만 다음 수 한 수 방어 불가'})[k]||''};});
const case58Game={id:case58Id,date:'2026-09-25',me:2,first:2,events:case58Events,cursor:58,remaining:40000,result:null,source:'사용자 백돌 패배 신고 · 기보는 58수 열린 4에서 종료, 최종 5목 미제공'};
if(!db.appliedUpdates?.includes('loss-58-v2.4')){if(!db.games.some(x=>x.id===case58Id))db.games.push(case58Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'loss-58-v2.4'];persist();}
button($('learn').parentElement,'58수 패배 · 역공 함정 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case58Id)||case58Game);enterReview(46);analyze(7000);msg('47수 직전: M4 공격을 L5로 막은 뒤의 역공을 검사합니다. 제외된 수가 있어도 다른 수의 생존을 보장하지 않습니다.');}).id='case58Study';
versionBadge.textContent='v2.4.0';versionBadge.setAttribute('aria-label','앱 버전 2.4.0');versionBadge.title='강제 방어 뒤 역공 검사 · 즉시 4목 방어 유지 · 58수 복기';

// Restore only after all bundled examples have been constructed using their
// original rules. A fresh installation opens setup, not a finished example.
const case17Id='mushroom-loss-2026-09-26-17',case17Moves='H8 G7 I7 G9 I8 G8 G6 F9 H7 J9 H9 G10 G11 H10 I6 H6 I5'.split(' ');
const case17Board=Array(225).fill(0),case17Events=case17Moves.map((c,k)=>{let i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=E.inspect(case17Board,i,p);if(!s.legal)throw Error('17수 기보 규칙 오류');case17Board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:({13:'H10 뒤 상대 I6 준비 수가 강제승을 만듦. 이 수 직전에도 깊은 분석에서 모든 방어의 패배 확인',14:'I6: 당장은 4목이 아닌 준비 수. 다음 강제 공격까지 검사 필요',15:'H6만의 실수가 아님. 이미 강제패배 국면',16:'I5–I8 열린 4, I4·I9 동시 승리점. 아직 5목 아님'})[k]||''};});
const case17Game={id:case17Id,date:'2026-09-26',me:1,first:2,events:case17Events,cursor:17,remaining:40000,result:null,source:'사용자 흑돌 패배 신고 · 기보는 열린 4에서 종료, 최종 5목 미제공'};
if(!db.appliedUpdates?.includes('loss-17-v2.5')){if(!db.games.some(x=>x.id===case17Id))db.games.push(case17Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'loss-17-v2.5'];persist();}
button($('learn').parentElement,'17수 흑돌 패배 · 준비 수 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case17Id)||case17Game);enterReview(13);analyze(7000);msg('14수 직전입니다. 열린 3 준비 수 뒤의 강제 공격을 검사합니다. 이전 수로 이동하여 더 이른 대안을 비교하세요.');}).id='case17Study';
versionBadge.textContent='v2.5.0';versionBadge.setAttribute('aria-label','앱 버전 2.5.0');versionBadge.title='열린 3 준비 수 뒤 강제 공격 검사 · 17수 흑돌 복기';

const case41Id='slime-loss-2026-09-26-41',case41Moves='K12 J11 L11 J13 L13 M12 L12 L10 M10 J12 J10 K11 L14 L15 M9 I13 H14 H13 N9 O8 K13 G13 F13 I12 G14 H11 K14 I11 G11 L9 K10 I9 I10 G10 F9 I15 I14 J15 J14 K15 H15'.split(' ');
const case41Board=Array(225).fill(0),case41Events=case41Moves.map((c,k)=>{let i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=E.inspect(case41Board,i,p);if(!s.legal)throw Error('41수 기보 규칙 오류');case41Board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:({20:'21수 직전 제한 탐색에서 모든 합법 방어의 강제패배 확인. 이 수만의 실수로 판단하지 않음',26:'K14 즉시 방어 뒤에도 상대 연속 4 강제승 수순 확인',34:'F9 즉시 방어',36:'I14 즉시 방어',38:'J14 즉시 방어',39:'I15–K15에 더해 J15 등이 연결된 가로 4: H15·M15 동시 승리점',40:'H15를 막아도 M15가 남음. 아직 실제 5목은 기보에 없음'})[k]||''};});
const case41Game={id:case41Id,date:'2026-09-26',me:2,first:2,events:case41Events,cursor:41,remaining:40000,result:null,source:'백돌 패배 신고 · 41수 이후 M15 승리 가능, 최종 착수 미제공'};
if(!db.appliedUpdates?.includes('loss-41-v2.6')){if(!db.games.some(x=>x.id===case41Id))db.games.push(case41Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'loss-41-v2.6'];persist();}
button($('learn').parentElement,'41수 백돌 패배 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case41Id)||case41Game);enterReview(40);analyze(7000);msg('41수 직전: H15·M15 두 승리점. 이전 수로 이동해 연속 공격이 시작된 국면을 비교하세요.');}).id='case41Study';
versionBadge.textContent='v2.6.0';versionBadge.setAttribute('aria-label','앱 버전 2.6.0');versionBadge.title='예상 상대 수와 내 응수 사전 계산 · 41수 백돌 복기';

const case70Id='slime-loss-2026-09-26-70',case70Moves='K12 J11 L11 M10 J13 I14 L12 J12 L10 L13 L9 L8 M12 O12 K10 J9 J10 I10 M8 H11 K8 G12 F13 K11 I11 H12 H10 F12 I12 H13 N7 O6 F11 E12 D12 G13 H14 G11 G10 K7 J7 I8 I6 H5 F10 E11 G9 D10 C9 F8 E9 E13 N13 O14 D9 F9 E14 J6 M9 I5 H4 F5 G5 G6 H7 F7 F6 G8 H8 H9'.split(' ');
const case70Board=Array(225).fill(0),case70Events=case70Moves.map((c,k)=>{let i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=E.inspect(case70Board,i,p);if(!s.legal)throw Error('70수 기보 규칙 오류');case70Board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:({62:'63수 직전 이미 연속 4 강제패배 확인. 마지막 방어 실수만의 문제가 아님',64:'H7: 필수 즉시 방어',66:'F6: 필수 즉시 방어',68:'H8 대신 H9가 필수 방어점. 다만 H9로 막아도 이후 강제패배 수순은 남음',69:'F7–G8–H9–I10–J11 정확한 5목으로 흑돌 승리'})[k]||''};});
const case70Game={id:case70Id,date:'2026-09-26',me:2,first:2,events:case70Events,cursor:70,remaining:40000,result:{winner:1},source:'사용자 백돌 패배 · 70수 실제 5목'};
if(!db.appliedUpdates?.includes('loss-70-v2.7')){if(!db.games.some(x=>x.id===case70Id))db.games.push(case70Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'loss-70-v2.7'];persist();}
button($('learn').parentElement,'70수 패배 · 필수 방어 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case70Id)||case70Game);enterReview(68);analyze();msg('69수 직전: H8이 아니라 H9가 즉시 방어점입니다. 더 이전의 강제패배 국면도 함께 복기하세요.');}).id='case70Study';
versionBadge.textContent='v2.7.0';versionBadge.setAttribute('aria-label','앱 버전 2.7.0');versionBadge.title='필수 방어 이탈 경고 · 검사 시간 초과 구분 · 70수 복기';

const case27Id='mushroom-loss-2026-09-26-27',case27Moves='C9 C8 F10 D7 E9 E6 B9 F9 D10 E8 G10 F5 G4 E10 E11 B8 D8 C7 A9 D9 G11 H12 G13 F12 G12 G9 G14'.split(' ');
const case27Board=Array(225).fill(0),case27Events=case27Moves.map((c,k)=>{let i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=E.inspect(case27Board,i,p);if(!s.legal)throw Error('27수 기보 규칙 오류');case27Board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:({17:'18수 직전부터 제한 탐색에서 모든 방어의 강제패배 확인. 더 이른 국면 검토 필요',19:'D9 이후 G11→H12→G13→F12→G12→G9→G14 연속 강제승 수순',24:'G12로 G9·G14 두 승리점 발생',25:'G9를 막아도 G14가 남음',26:'G10–G14 정확한 세로 5목으로 백돌 승리'})[k]||''};});
const case27Game={id:case27Id,date:'2026-09-26',me:1,first:2,events:case27Events,cursor:27,remaining:40000,result:{winner:2},source:'사용자 흑돌 패배 · 27수 실제 5목'};
if(!db.appliedUpdates?.includes('loss-27-v2.8')){if(!db.games.some(x=>x.id===case27Id))db.games.push(case27Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'loss-27-v2.8'];persist();}
button($('learn').parentElement,'27수 흑돌 패배 · 조기 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case27Id)||case27Game);enterReview(15);analyze(20000);msg('16수 직전부터 넓게 검사합니다. 강제패배가 나온 뒤가 아니라 이전 국면부터 대안을 비교하세요.');}).id='case27Study';
versionBadge.textContent='v2.8.0';versionBadge.setAttribute('aria-label','앱 버전 2.8.0');versionBadge.title='15초 기본 넓은 탐색 · 19반수 연속 공격 검사 · 준비 수 범위 확대';

const case23Id='mushroom-loss-2026-09-26-23',case23Moves='H8 G7 H9 H6 F8 H10 G8 I8 F7 E6 F9 F6 G6 E8 G9 F10 D9 E9 J9 I9 J11 C4 I10'.split(' ');
const case23Board=Array(225).fill(0),case23Events=case23Moves.map((c,k)=>{let i=(+c.slice(1)-1)*15+c.charCodeAt(0)-65,p=k%2?1:2,s=E.inspect(case23Board,i,p);if(!s.legal)throw Error('23수 기보 규칙 오류');case23Board[i]=p;return {type:'move',i,p,time:null,remaining:null,rec:null,legal:true,shape:{threes:s.threes,fours:s.fours,fork43:s.fork43},annotation:({13:'확대 탐색에서 14수 직전부터 모든 합법 방어의 강제패배 확인. 이전 국면부터 대안 검토 필요',14:'G9 준비 수 뒤 연속 공격. E8 국면의 모든 대응에 강제승 수순 확인',20:'J11로 I10 방어 강요. 흑돌 I10은 가로·세로 3×3 금수',21:'C4가 직접 원인이라기보다 유일 방어점 I10이 금수인 상태. 합법적 즉시 방어 없음',22:'F7–G8–H9–I10–J11 정확한 5목으로 백돌 승리'})[k]||''};});
const case23Game={id:case23Id,date:'2026-09-26',me:1,first:2,events:case23Events,cursor:23,remaining:40000,result:{winner:2},source:'사용자 흑돌 패배 · 금수 유도 뒤 23수 실제 5목'};
if(!db.appliedUpdates?.includes('loss-23-v2.9')){if(!db.games.some(x=>x.id===case23Id))db.games.push(case23Game);db.appliedUpdates=[...(db.appliedUpdates||[]),'loss-23-v2.9'];persist();}
button($('learn').parentElement,'23수 흑돌 패배 · 금수 유도 복기',()=>{persist();loadGame(db.games.find(x=>x.id===case23Id)||case23Game);enterReview(13);analyze(30000);msg('14수 직전부터 최대 탐색합니다. 더 이전으로 이동해 금수 유도 공격이 시작되기 전 국면을 검토하세요.');}).id='case23Study';
versionBadge.textContent='v2.9.0';versionBadge.setAttribute('aria-label','앱 버전 2.9.0');versionBadge.title='금수 방어 불가 명시 · 25초 최대 탐색 · 최종 추천 재검사';

const wideOption=document.createElement('option');wideOption.value='15000';wideOption.textContent='넓고 길게 · 최대 약 15초 (권장)';$('budget').append(wideOption);$('budget').value='15000';
const maximumOption=document.createElement('option');maximumOption.value='25000';maximumOption.textContent='최대 탐색 · 약 25초 (착수 시간 주의)';$('budget').append(maximumOption);$('budget').value='25000';
const automaticOption=document.createElement('option');automaticOption.value='auto';automaticOption.textContent='자동 · 위협/남은 시간에 맞춤';$('budget').append(automaticOption);$('budget').value='auto';
$('rethink').onclick=()=>analyze(30000);
const wideHelp=document.createElement('p');wideHelp.className='muted';wideHelp.textContent='기본 15초: 후보 최대 28개, 연속 4 최대 19반수, 준비 수 후보 최대 10개를 제한 시간 안에서 검사합니다. 깊은 복기는 최대 약 20초입니다. 실제 완료 깊이는 결과에 표시되며 설정 상한 도달을 보장하지 않습니다. 40초 착수 시계는 계속 진행합니다.';$('budget').closest('details').append(wideHelp);
wideHelp.textContent='기본 자동: 초반·상대 위협·남은 시간에 따라 약 3~25초를 선택합니다. 즉시 승리/방어는 바로 판정합니다. 최대 모드는 후보 32개·연속 공격 25반수 상한입니다. 예측 일치 시 같은 계산을 이어받습니다. 깊은 복기는 약 30초이며 모든 상한 깊이 도달을 보장하지 않습니다. 40초 착수 시계는 별도로 진행합니다.';

// Guard only the user's side; never automatically place a stone or alter the timer.
const unguardedMove=move;
move=function(i){
  if(g&&!paused&&!reviewing&&!g.result&&turn===g.me&&(g.timer===false||Date.now()<deadline)){
   if(rec?.proven&&rec.i!=null&&rec.i!==i&&!confirm('확인된 강제승 시작점은 '+E.coord(rec.i)+'입니다. '+E.coord(i)+'에 두면 확인된 승리 수순을 놓칩니다.\n그래도 이 위치에 두시겠습니까?')){msg(E.coord(rec.i)+'에 두면 확인된 강제승 수순을 시작합니다.');return;}
   const warning=E.assessMove(b,turn,i);
  if(warning.mustWarn&&!confirm('필수 방어점은 '+E.coord(warning.required)+'입니다. '+E.coord(i)+'에 두면 상대가 다음 수에 5목으로 승리할 수 있습니다.\n그래도 이 위치에 두시겠습니까?')){msg(E.coord(warning.required)+'에 즉시 방어하세요.');return;}
 }
 unguardedMove(i);
};

// Remove the learning panel, including the previously appended study shortcuts.
// Saved games and lessons remain intact; this is a UI change, not data deletion.
// Learning and postmortem tools are retained in the unified app.
$('copy').textContent='착수기록 텍스트 복사';
function formatRecordText(game,items){
 const me=game?.me,role=me===1?'흑':'백',order=game?.first===me?'선공':'후공';
 const header=me?`내 돌: ${names[me]} (${role}) · ${order}`:'내 돌: 설정되지 않음';
 return [header,...items.map((e,k)=>`${k+1}. ${names[e.p]} ${e.type==='timeout'?'PASS(40초 초과)':E.coord(e.i)}`)].join('\n');
}
const recordText=()=>formatRecordText(g,events);
$('copy').onclick=async()=>{
 const text=recordText();
 try{if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');await navigator.clipboard.writeText(text);msg('착수기록을 클립보드에 복사했습니다.');}
 catch(e){const body=openModal('착수기록 텍스트 · Ctrl+C로 복사');const area=document.createElement('textarea');area.readOnly=true;area.value=text;area.setAttribute('aria-label','착수기록 복사');body.append(area);area.focus();area.select();msg('브라우저가 자동 복사를 허용하지 않아 텍스트를 선택했습니다. Ctrl+C를 누르세요.');}
};
const compactRender=render;
render=function(){compactRender();if(!rec)return;const lead=rec.patternVerified?'기보 패턴 방어 확인 · 전체 무패 미증명':rec.urgent?'즉시 전술 판정':rec.proven?'검증한 승리 수순 '+rec.pv.length+'반수':rec.lossProven?'강제패배 수순 확인':'일반 탐색 완료 '+rec.depth+'반수';$('metrics').textContent=lead+(rec.limits?' · 위협검사 상한 '+rec.limits.forcing+'반수':'')+' · '+rec.ms+'ms';if(rec.patternVerified)$('analysisState').textContent='패턴 방어 확인';};
versionBadge.textContent='v3.3.0';versionBadge.setAttribute('aria-label','앱 버전 3.3.0');versionBadge.title='검증한 F12 패턴 방어 · 전체 무패와 구분';
render();
