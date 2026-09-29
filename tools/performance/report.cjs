const fs=require('node:fs');
const read=f=>JSON.parse(fs.readFileSync('reports/performance/'+f));
const before=read('baseline-summary.json'),after=read('cycle2-summary.json'),raw=read('cycle2.json'),quality=read('cycle2-comparison.json');
if(!raw.finished||raw.rows.length!==180)throw Error('Final repeated benchmark is incomplete');
const fixed=(x,n=2)=>Number(x).toFixed(n),names={fast:'빠르게 1초',compare:'비교 3초',precise:'정밀',auto:'자동 최대15초',deep15:'심층15초',deep25:'심층25초'};
const table=rows=>['|모드|실제시간(s)|완료 깊이|nodes/sec|Workers|추천|평가|','|---|---:|---:|---:|---:|---|---:|',...rows.map(r=>`|${names[r.mode]}|${fixed(r.elapsed_ms/1000)}|${r.depth}|${fixed(r.nodes_sec,0)}|${r.workers}|${[...new Set(r.moves)].join('/')}|${r.score}|`)].join('\n');
const lines=['# 성능 측정 결과','',`완료: ${raw.finished}`,`환경: ${raw.cpu.model}, 논리 CPU ${raw.cpu.logical}, Edge ${raw.browser}.`,'',
'10개 고정 국면 × 6개 모드 × 3회. 아래 대표 표는 H8 G7 G6 H6 F8 이후 백 차례의 중앙값이다. 기존 정밀 모드는 8초, 수정 후는 요청대로 7초다. 모든 국면별 수치는 아래에 별도로 기재한다.','',
'## Baseline','',table(before.filter(r=>r.position==='sixth-move')),'','## 최적화 후','',table(after.filter(r=>r.position==='sixth-move')),'',
'## 검증','',
`- 최종 180건: 잘못된 추천/오류 ${quality.invalid.length}, 승패 플래그 변경 ${quality.proofChanges.length}, 반복 간 추천 변동 그룹 ${quality.unstableGroups.length}.`,
`- 강제 시간종료 ${quality.timeouts.length}, 계획 예산을 100ms 넘긴 요청 ${quality.budgetOverruns.length}.`,
'- 전체 npm test: baseline, cycle1, cycle2 모두 PASS. 캐시 동등성, five-priority, 기존 증명 및 추천 정책 포함.',
'- Worker 종료/지연/전경 작업 보존: test/worker-lifecycle.cjs PASS.',
'- 별도 강제승패 탐색, Rapfi/DFPN 연구, commit/push 없음.',
'- 알려진 패배 I7 제외 유지. J4/F7 등 미증명 후보를 WIN/SAFE로 승격하지 않음.',
'- 후보별 깊은 비교에서 얻었던 J4 순위와 이번 모드별 전체 국면 검색은 다른 실험이다.',
'',
'## 25초 추가 검증','',
'아래 complete는 해당 제한된 전술 검사 범위의 완료 여부이며, 전체 게임의 무패/강제승 증명이 아니다.','',
'|국면|반복|검사 후보 수|완료 검사 수|반박 수|', '|---|---:|---:|---:|---:|',
...raw.rows.filter(r=>r.mode==='deep25').map(r=>`|${r.position}|${r.repeat+1}|${r.validated_candidates.length}|${r.validated_candidates.filter(x=>x.complete).length}|${r.validated_candidates.filter(x=>x.refuted).length}|`),'',
'## 전체 국면별 비교','',
'|국면|모드|이전→이후(s)|이전→이후 깊이|이전→이후 nodes/sec|이전→이후 추천|', '|---|---|---:|---:|---:|---|',
...after.map((r,i)=>{const b=before[i];return `|${r.position}|${names[r.mode]}|${fixed(b.elapsed_ms/1000)} → ${fixed(r.elapsed_ms/1000)}|${b.depth} → ${r.depth}|${fixed(b.nodes_sec,0)} → ${fixed(r.nodes_sec,0)}|${[...new Set(b.moves)].join('/')} → ${[...new Set(r.moves)].join('/')}|`;}),'',
'## 한계와 구현 설명','',
'캐시·시간 배분의 결합 효과다. 자동/15초는 기존 내부 탐색폭 경계를 지나므로 깊이 증가를 캐시 단독 효과로 해석할 수 없다. 실제 게임을 함께 실행한 부하는 재현하지 않았다. 전체 UI smoke 결과와 원시 PV/TT/지연/취소 측정은 같은 폴더의 JSON 및 로그를 참고한다. 세부 방식과 재현 명령은 [README](README.md)에 있다.',''];
fs.writeFileSync('reports/performance/results.md',lines.join('\n'));
console.log('Wrote reports/performance/results.md');
