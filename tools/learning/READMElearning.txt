숲속 오목 로컬 분석·학습

기존 CPU 수읽기/금수 검사/검증된 반증을 유지하고, 작은 국면 가치 신경망의 제한된 평가 보정을 학습합니다. 자료 생성·변형 대국·수읽기·대국 검증은 CPU, 신경망 미니배치 학습은 GPU(CUDA)입니다. 기존 GPU 혼합의 59,049개 정적 패턴표와 신경망 학습은 서로 다른 기능입니다. 반복 실행은 Node/Python 로컬 프로그램이며 ChatGPT/Codex/외부 AI API를 호출하지 않습니다.

저장소 루트에서 사용:
  outputs/start-learning.cmd 더블클릭: 서버를 켠 뒤 기본 브라우저를 자동으로 엽니다.
  재부팅 후에도 같은 파일을 더블클릭하면 됩니다. 사용하는 동안 처음 열린 서버 창을 열어 둡니다.
  이미 실행 중이면 기존 학습 화면을 엽니다. 저장된 기보·모델·진행 상태는 유지됩니다.
  node tools/learning/run.cjs init --run=outputs/learning/my-run
  node tools/learning/run.cjs import --run=outputs/learning/my-run --input=C:/path/omok-records.json
  node tools/learning/run.cjs cycle --run=outputs/learning/my-run --games=8 --pairs=4 --workers=1
  node tools/learning/run.cjs stop --run=outputs/learning/my-run
  node tools/learning/run.cjs cycle --run=outputs/learning/my-run --resume
  node tools/learning/run.cjs status --run=outputs/learning/my-run

이전 실험 폴더가 유실되어 모델의 학습 출처를 검증하지 못할 때:
  화면에서 원본 실험을 선택하고 «대국 보존 · 모델 새로 학습»으로 이어받습니다.
  node tools/learning/run.cjs cycle --run=outputs/learning/recovered-run --from-run=outputs/learning/source-run --continuation-mode=raw-reset --fresh-model --continuous --workers=12
  완료 대국과 검증된 원자료는 보존하고 가져온 모든 계열/국면을 학습용으로 제한합니다. 이전 후보·가중치·체크포인트·학습 갱신 횟수는 가져오지 않으며 검증/평가 자료는 새 대국에서 모읍니다. 원본 실험과 실패 기록은 바꾸지 않습니다. 복구 중 중단되면 같은 새 실험을 재개합니다. 일반 이어받기는 계보를 먼저 확인하여 자료 복사를 시작하기 전에 오류를 알립니다.

입력 없이 시작하면 기존 앱 내장 기보, Reader 기보와 reports/*-loss-certificate.json의 기존 국면을 현재 규칙으로 복원하여 시작 자료로 사용합니다. 브라우저 localStorage 기보는 프로그램이 직접 읽을 수 없으므로 오목의 JSON 내보내기 후 가져옵니다. 백 선공, PASS, 흑백/내 돌 역할을 보존합니다. 숫자 위치는 앱의 A1=0 인덱스이며 화면의 좌표 방향을 뒤집어 해석하지 않습니다. 색을 쓰지 않은 텍스트 기보는 --first=1 또는 --first=2가 필요합니다.

연속 경험 누적 예시 (총 대국 수를 고정하지 않음):
  node tools/learning/run.cjs cycle --run=outputs/learning/my-continuous --continuous --workers=10
  node tools/learning/run.cjs cycle --run=outputs/learning/my-continuous --resume
완료된 예전 경험을 이어받아 새 실험으로 시작:
  node tools/learning/run.cjs cycle --run=outputs/learning/my-continuous --continuous --from-run=outputs/learning/runs/OLD-RUN --workers=10
OLD-RUN에는 실제 실험 폴더 이름을 넣습니다. 원본을 변경하지 않고 대국·자료·기존 평가 패턴을 보존합니다. 미채택 모델은 다음 학습 초기값으로만 사용할 수 있습니다. 새 실험에서 실제 대국은 검증된 채택판 또는 기존 엔진을 사용합니다.
화면에서 시작하는 연속 모드는 기본 CPU 작업자13개(설정 범위1~16개)와 낮은 우선순위로 실행합니다. 직접 CLI의 연속 모드 기본값은 10개이며 --workers=13으로 같은 값을 지정합니다. 검증도 같은 CPU 작업 수로 독립 대국을 병렬 처리합니다. 검증 후보·상대·시작 국면·착수 시간은 고정하며 양쪽 엔진은 한 대국 안에서 같은 작업자를 사용합니다. 매 수는 중앙 실행기가 저장을 확인한 뒤 다음 수를 허용합니다. 수동 중단·단계별 작업 예산은 부분 대국을 보존하며, 작업자 실패 시 다른 대국도 협조적으로 멈춥니다. 검증 작업 수를 바꾸면 새 검증 실행이 필요합니다. GPU 학습 중에는 시작 전에 고정한 자료만 학습하고 CPU가 다음 대국을 생성합니다. 새 자료는 다음 학습의 새 표본으로 남습니다. 학습이 끝나면 현재 수를 저장하고 생성 작업을 합류한 뒤 기존 검증·채택 기준을 적용합니다. --concurrent-training=false로 동시 생성을 끄고, --workers=1로 CPU 작업 수를 줄일 수 있습니다. --priority=normal은 일반 우선순위를 명시적으로 선택합니다. 동시 실행은 GPU의 작은 모델 학습을 CPU 생성과 겹치게 하는 기능이며 GPU 사용률100%나 화면 끊김 해소를 보장하지 않습니다.
연속 모드는 512대국마다 자료를 점검하며, 마지막 학습 이후 새 표본10,000개가 쌓이면 다시 학습합니다. 실행을 재개하거나 경험을 이어받았을 때 이미 새 표본이 충분하면 먼저 학습을 시작할 수 있습니다. --games-per-cycle / --min-new-samples로 조정합니다. 과거 자료는 새 자료로 중복 계산하지 않습니다. 기본 기보 변형 비율은0.25, 학습 반복 상한은20, 검증 흑백 교환 쌍은64입니다. 기본값은 새 실행에 적용하며 기존 실험을 재개하면 저장된 설정을 유지합니다. 기본1회 학습자료는 최대100,000표본이며 --max-training-samples로 조정합니다. 전체 기록은 지우지 않고 최근/과거 자료를 나눠 선택합니다. family 편중 완화, 초기 모델과 비교한 독립 검증 오차, 조기 종료와 제한된 변화 진단을 기록합니다. 검증된 기본판이 아닌 후보도 학습 초기값으로 계속 이어받을 수 있지만 대국 채택은 별도 기준을 통과해야 합니다.
학습 자료와 family 가중치는 여유 VRAM 범위에서 GPU에 한 번 올리고 미니배치마다 다시 복사하지 않습니다. 부족하면 기존 CPU mmap 방식으로 실행합니다. 검증 오차는 GPU에서 합산한 뒤 한 번 읽으며, FP32 학습 목표·배치 크기·학습률·CPU RNG 순서와 체크포인트는 유지합니다. GPU는 CPU 대국 생성·검증 중에는 대기합니다. 32→16→1의 작은 신경망은 GPU 연산량보다 명령 전달·전송 시간이 클 수 있어, 사용률보다 초당 학습 국면과 전체 사이클 시간을 함께 봅니다.
경험 이어받기는 기보·국면 검증 색인을 128대국/2,048표본 단위 SQLite 트랜잭션으로 저장합니다. 배치 중 오류는 미커밋 색인만 롤백하고, 원본 JSONL과 승패·family 분리 검증은 보존합니다.
자동 부팅 실행은 설정하지 않습니다. 연속 실행은 수동 중지 전까지 계속되며, 중지 후에는 같은 실험을 재개합니다. 직접 CLI 재개와 화면 재개 모두 필요한 경우 보관 실행기를 선택하고 이전 전체 실행 시간 제한을 해제합니다. 디스크8GiB 기본한도는 --max-disk-gb로 조정합니다. 자원 한도는 총 대국 목표와 다릅니다. 브라우저만 닫으면 서버/학습은 계속될 수 있으므로 중단 요청을 사용하세요. 강제 종료 후에는 마지막 저장 지점부터 복구합니다.

대국 수를 지정하는 기존 방식 예시:
  node tools/learning/run.cjs cycle --run=outputs/learning/long-run --games=100000 --games-per-cycle=100 --workers=2 --move-ms=80 --validation-ms=1000 --pairs=64
같은 명령에 --resume를 더하면 부분 대국/학습/평가를 계속합니다. 전체 실행 시간 상한은 없으며 연속 모드는 수동 중지 요청 전까지 누적합니다. 기존 저장 설정이나 예전 명령의 --minutes 값도 종료 시간으로 사용하지 않습니다. 단계별 대국 처리 예산과 학습 단계의 trainSeconds, 자료·디스크 안전장치는 유지합니다. 먼저 짧은 실행의 게임/초·학습 samples/초·RAM/VRAM 실측을 확인합니다. 생성과 학습은 서로 다른 병목이므로 GPU 사용률만으로 대국 처리량을 판단하지 않습니다. --max-samples/--max-disk-gb로 자료·디스크 예산을 제한할 수 있습니다. 전용 Python 기본 경로는 C:/Users/jiho/Documents/Codex/.omok-runtime/Scripts/python.exe이며 --python으로 지정할 수 있습니다. GPU 미지원은 실패 이유로 표시하고, --device=cpu를 명시한 경우에만 CPU 학습을 선택합니다.

각 단계도 단독 실행할 수 있습니다:
  analyze : 기존 기보의 여러 이전 국면/실제 착수/대안과 상대 강제수 검사
  generate: 이전 국면 변형, 다른 후보/응수와 새로운 합법 시작 국면에서 대국
  train   : 고정한 JSONL 데이터에서 모델 학습과 체크포인트
  validate: 고정 v5.15.0 기준 및 현재 채택 모델과 동일 시간·선후공 교환 대결
  adopt   : 규칙/전술/JS-Python 일치/독립 대결의 보수적 기준을 모두 통과해야 실제 반영

실제 승리/무승부는 합법 착수 후 정확한 5목/만판으로만 정합니다. 최댓수, 시간 제한, 합법수 없음은 미완료입니다. 높은 평가점수, 예상 수순 또는 보고서의 증명 주장은 대국 승패 라벨이 아닙니다. terminal 표본은 그 국면의 실제 최종 결과를 차례 관점에서 +1/0/-1로 기록하며 모든 패배 착수를 나쁜 행동이라고 표시하지 않습니다. teacher 표본은 제한 재분석의 약한 추정(가중치 0.15)으로 구분합니다.

원본/대칭/색 교환/기보 prefix/같은 초기 수순은 보수적인 family 그룹으로 묶고, 이미 훈련한 그룹에 연결되는 새 자료를 최종 시험으로 쓰지 않습니다. 고정 데이터 snapshot은 정확한 D4/색 교환 동일 국면의 교차 split 중복을 test > validation > train 순서로 제외합니다. 평가 시작 국면도 훈련 위치키와 겹치면 바꿉니다.
자동 채택 대결은 새로 예약한 seeded 시작 국면을 사용합니다. 보관한 최종 test 기보는 자동 대결의 시작점·학습·모델 선택에 사용하지 않으며, 현재 최종 기보 시험은 별도 확인 대상으로 남습니다. 기존 JSON의 수동 lessons와 앱의 기존 35수 lesson은 출처·규칙 문맥과 함께 보존하고 두 비교 엔진에 동일하게 적용하는 휴리스틱입니다. lesson의 verified 표시는 학습의 정답 라벨로 바꾸지 않습니다.
직전 미채택 후보도 다음 cycle 학습의 초기 가중치로 이어받을 수 있습니다. 실제 대국과 배포는 계속 채택 모델만 사용합니다. 모델·현재 데이터 hash·완료 updates·JS/Python 일치가 맞지 않으면 이전 후보를 새 학습 결과로 사용하지 않습니다.

기본 채택은 독립 원본/시작 국면 family 최소 32개의 선후공 쌍과 반복 채택의 alpha-spending Hoeffding 하한 >0.5를 요구합니다. 실제 모든 예정 대국이 종료되고, 양색 규칙/즉시 승리/필수 방어와 JS-Python 모델 일치도 통과해야 합니다. 4쌍 smoke는 연결 확인용이며 자동 채택할 수 없습니다. 기존 채택판이 있으면 그 판보다도 개선됐는지 비교합니다. 평가 미완료면 기존 엔진을 유지하면서 같은 저장 대국을 재개합니다. 개선 기준을 못 통과한 후보는 분석/모델/반례와 함께 남고 배포하지 않습니다. 결과는 해당 상대·초기 국면·착수 시간의 근거이며 보편적인 기력 우월이나 필승 증명이 아닙니다.

저장 위치(outputs/learning/<run>/):
  records.json / bootstrap.json / family-groups.json : 기존 기보와 자료 유래·분리 근거
  analysis.jsonl : 이전 수부터의 실제 착수/대안 재분석, 미확인과 반증 구분
  games.jsonl / state.json : 완료·부분 대국, 시드·진행·중단 상태
  dataset.jsonl / datasets/cycle-N.jsonl : 누적 표본과 고정 학습 snapshot
  checkpoints/cycle-N.pt : 모델/optimizer/RNG/data cursor 등 학습 재개
  candidate.json / .training.json / .parity.json : 후보와 GPU/학습/일치 측정
  arena-cycle-N.json / arena.json : 합법 실제 수순, 시간과 독립 비교
  adoption.json / champion.json / models/ : 기존 유지 또는 검증된 채택 근거
  continuation.json / warm-start.json : 원본 경험 경로·hash·가져온 규모 및 미채택 학습 초기값
  progress.json / partials/ / arena-partials-cycle-N/ : 작은 진행 상태와 매 수 복구 기록
  journal.sqlite / continuation.sqlite / arena-exclusions.sqlite : 재생성 가능한 디스크 ID·국면·자료 계열 색인
  adoptions.jsonl / timing.jsonl / errors.jsonl : 장기 실행의 채택 판단·단계 시간·오류 기록
원본 JSONL이 휴대 가능한 실제 자료입니다. SQLite 파일은 수행 중 삭제하지 마세요. 코드/자료의 의미가 달라지면 이전 결과의 버전을 바꿔 쓰지 않습니다. 알려진 v5.16 실행은 work/continuous-runtime-baseline.json에 보존한 원래 실행 코드로 재개하거나, 화면에서 새 누적 실험으로 경험을 이어받습니다. 추가 보존 실행기는 work/runtime-archives/<harnessHash>.json에서 원래 버전을 읽습니다. 새 버전의 변경 이후에는 저장된 경험을 새 실험으로 연결합니다.
수읽기 캐시는 게임별로 유지하지만 프로세스 재시작 때 양쪽 모두 새 캐시를 시작합니다. 자료·모델·실험 상태는 계속 남습니다. 실제 채택은 모델만 갱신하고 src/active-model.json 및 기존 HTML 실행본 다섯 곳을 동일하게 교체합니다. GitHub push/외부 배포는 실행하지 않습니다.

2026-10-08 프리모텀 복구 수정
- 동일 기보 ID의 다른 수열은 수입 전 거부합니다. 같은 내용 재수입은 멱등입니다.
- snapshot publish intent에는 자료/가족 manifest hash가 있습니다. process crash 뒤 같은 cycle을 검증해 완성하며, intent 없는 오래된 고아 파생 파일은 격리 보존 후 재생성합니다.
- 정상 checkpoint를 오류 상태로 덮지 않습니다. 의심 상태는 .error.pt로 남고 정상 재개에서 거부합니다.
- 배포 intent는 활성 모델, HTML 5개, run champion/models/채택/state/journal와 승인 모델의 노출 원장을 함께 게시합니다. 다음 실행에서 완성하거나 identity 변경 시 복구 정책에 따라 되돌립니다.
- canonical source/harness manifest와 Node/V8/SQLite/platform/arch identity를 검증합니다. 보관본 누락·추가 repository module과 외부 npm fallback은 거부합니다. 신규 run은 완전한 실행 코드를 자동 보관합니다.
- trial과 평가 opening family는 outputs/learning/evaluation-ledger.sqlite 한 원장에서 원자 예약합니다. 분기·저장 전 종료도 이미 소비한 번호를 재사용하지 않습니다. 과거 조정되지 않은 시행에 전역 오류 보장을 소급하지 않습니다.
- 첫 채택은 historical baseline과 같은 현재 소스의 explicit model:null을 모두 넘겨야 합니다. champion이 있으면 baseline+incumbent 비교를 유지합니다.
- temporal-exposures 원장은 이전 공개 snapshot의 위치/가족 split을 보존합니다. continuation과 새 champion 계보가 이 이력을 상속하고 미래 다른 split 노출은 격리합니다. 과거 고정 snapshot을 바꾸지는 않습니다.
- 새 연속 실험은 sample-policy=paired-v1, selection-min-delta=0.0001, loss-weight-normalization=global-mean을 사용합니다. 기존 partial과 누락 설정은 legacy입니다. 변경된 objective/설정은 새 실험에서 비교합니다.
- 공간 검사는 큰 쓰기 전 예상 bytes와 trainer의 남은 예약을 반영합니다. 예상량은 파일 시스템의 모든 최대 사용량을 보증하지 않습니다. 원본/모델/평가와 승인 snapshot은 유지하며, 노출 원장이 완성된 run의 최근 파생 snapshot과 preparation cache만 제한적으로 보관합니다. 공간 중단 이유는 시간 종료로 덮지 않습니다.
- 모든 착수 ACK 전에는 anchor/state와 intent의 파일 fsync를 수행합니다. Windows directory fsync는 지원되지 않을 수 있어 process crash 복구를 보장 범위로 삼습니다. 실제 전원 장애 내구성은 인증하지 않았습니다.
- 작은 arena summary에는 cycle/trial/candidate/source/상대/점수/독립가족/통과 문턱을 표시합니다. 큰 원본 arena는 별도 다운로드로 유지합니다.

검증 명령
  npm test                        제품/학습 Node 회귀 전체
  npm run test:learning:cpu        numpy+PyTorch가 있는 Python CPU/CUDA 회귀
  npm run test:learning:ui         Playwright Chromium 또는 OMOK_BROWSER의 실제 HTML/worker/UI
  node tools/learning/diagnose.cjs --run-dir=outputs/learning/runs/<run> --out=work/diagnose.json
  node tools/learning/diagnose.cjs --candidate=<model.json> --leaf-profile --out=work/leaf-diagnostics.json
  npm run learning:plan -- --run-dir=<run> --candidate=<model.json> --out=<new-plan.json>
  node tools/learning/experiment-plan.cjs --verify-plan=<saved-plan.json>
GitHub 기본 CI는 CPU PyTorch와 Chromium을 설치하여 세 경로를 실행합니다. CUDA는 수동 workflow_dispatch의 GPU runner에서 별도 실행합니다. 실제 GPU artifact dashboard는 환경에 파일이 있을 때 test/learning-dashboard-artifact.cjs로 읽기 검증합니다.

leaf-profile은 별도의 고정 깊이 Reader 실행에서 실제 static leaf 및 accumulator.score 호출을 측정합니다. timer 자체의 비용이 있으므로 시간제 비교에 섞지 않습니다. 실험 계획은 최소 개선폭과 통계 gate의 조건부 검정력, 두 대조군, 모든 artifact hash, shared trial, 가족 수와 자원 상한을 결과 전에 고정합니다. 계획 파일은 읽기 전용 원장 조회이며 trial 예약이나 기력 결과가 아닙니다. 원장이나 소스가 바뀌면 계획을 거부합니다. bounded-family 독립성과 실제 효과에 관한 가정 아래의 보수적 계산은 합법성/완료 등 다른 gate의 통과 확률이나 실제 기력을 보장하지 않습니다.

학습 loss 개선은 기력 증거가 아닙니다. diagnose의 fixed-work는 Reader의 동일 depth/정적 규칙 비교이며 동일 node 수가 아닙니다. spatial-rel-v1은 별칭을 구별하는 진단용 prototype이고 production trainer/model 형식이 아닙니다. 실제 새로운 representation/수집 actor/최적화 대안의 다중 seed 결과와 사전 고정된 독립 arena 비교가 남아 있습니다. 현재까지 이 수정으로 기력이 개선됐다고 주장하지 않습니다.

실험 전체 보관 정책 (2026-10-08)
- 생성 시각(state.createdAt, 없으면 dashboard.createdAt 및 실험 ID의 시각) 최신순으로 실험 3개를 유지합니다. 저장된 목록만 숨기지 않고 이전 폴더를 이동합니다.
- outputs/learning/runs/.recycle/<transaction>/run은 복구 가능한 자체 보관함입니다. manifest.json의 원위치와 체크 정보로 run-retention.cjs.restoreRetained(runsRoot, transactionId)를 호출하여 복원할 수 있습니다. 자동 영구 삭제나 보관함 비우기는 수행하지 않습니다.
- 필요한 오래된 계보 자료는 .dependencies에 별도 보존하고 원본 경로 연결을 유지합니다. 진행 중인 실험과 진행 중 가져오기의 원본·계보는 보호하며 일시적으로 3개를 초과할 수 있습니다. 보존 계보를 직접 재개하려면 먼저 복원해야 합니다.
- 이 이동은 디스크 공간을 확보하지 않습니다. 영구 삭제에는 정확한 대상과 용량을 검토한 뒤 별도 확인이 필요합니다. 단계별 파생 snapshot 보관 및 기존 디스크 예산 안전장치는 별개로 유지합니다.
- 과거 실험은 원래 실행 코드와 실험 식별자를 유지합니다. 이번 시간·정리·파일 용량 검사 운영 수정만 정확한 변경 전/후 해시를 검토한 호환성 기록으로 연결하며 엔진·학습·검증 알고리즘 또는 네이티브 실행환경이 바뀌면 새 검증을 요구합니다.

후보 미채택 진단과 표본 계획 (2026-10-10)
- node tools/learning/adoption-diagnose.cjs --run-dir=outputs/learning/runs/<run> --out=outputs/<새-진단파일>.json
  원본 실험과 원장을 변경하지 않고 최신 후보 선택, 이전 평가의 탈락 이유, 다음 평가의 표본 수를 구분합니다. 불완전하거나 식별자가 없는 평가에는 점수를 표시하지 않습니다. 기존 결과 파일을 덮어쓰지 않습니다.
- 새 연속 실험의 기본 학습률은 0.0003, 학습 호출 예산은 120초입니다. 한 고정 snapshot의 같은 warm-start 모델과 3개 seed에서 기존 0.001은 모두 초기값 유지, 0.0003은 모두 분리 검증 오차 개선을 확인했습니다. 다른 데이터나 초기 학습, 실제 대국 실력으로 일반화한 증거는 아닙니다. 명시한 설정과 기존 실험의 보관 실행기는 유지합니다.
- 화면의 기본 실행 방식은 ‘개선 후보 검증 · 표본 자동 계획’이며 CPU 작업 수는 13개입니다. ‘이 경험을 이어서 누적’도 이 설정을 준비합니다. 후보가 두 상대 모두 평균 점수 60% 이상이라고 가정하고, 통계 기준 검출 목표 80%에 맞춰 실제 예약 trial에서 표본 수를 고정합니다. 설정한 pairs는 최소값이며 maxEvaluationPairs 기본 상한은 2048입니다. CLI는 --powered-evaluation=true --minimum-useful-improvement=0.10 --target-power=0.8 --max-evaluation-pairs=2048입니다.
- 표본 계획은 규칙·모델 일치·독립 계열·반복 시험 예산과 기존 채택 문턱을 유지합니다. 조건부 검출 계산은 독립성과 가정한 실력 개선이 있을 때만 성립하며 채택을 보장하지 않습니다. 상한 초과는 trial/계열 예약 전에 멈추며, 원장 예약 후 중단되면 같은 후보·trial·표본 수를 재개합니다.
- 현재 원장 nextTrial=68에서는 위 조건에 상대별 1202계열, 총 4808대국이 필요합니다. CPU 작업 12개·수읽기 1000ms 기준 최대 설정 수읽기 배분 합계/병렬 배분은 약 300.5/25.1시간입니다. 실제 실행 시간 예측이나 엄밀한 실행 시간 상한이 아닙니다.
- 대시보드는 초기값 유지와 새 epoch 선택을 구분하고, 완료 epoch 및 자료 준비·학습 처리 시간을 표시합니다. 과거 아레나와 더 최신의 학습 미개선 결정을 혼동하지 않습니다.
- 이번 조사에서 장시간 독립 아레나와 실제 모델 채택은 실행하지 않았습니다. outputs/candidate-adoption-report-20261010.txt와 같은 날짜의 diagnosis/study JSON에 근거와 남은 검증을 기록했습니다.

새 preset을 사용하려면 기존 학습 서버 콘솔에서 Ctrl+C 후 outputs/start-learning.cmd를 다시 실행합니다. 실행 중인 서버는 이전 설정을 기억하므로 브라우저 새로고침만으로는 바뀌지 않습니다.
