숲속 오목 로컬 분석·학습

기존 CPU 수읽기/금수 검사/검증된 반증을 유지하고, 작은 국면 가치 신경망의 제한된 평가 보정을 학습합니다. 자료 생성·변형 대국·수읽기·대국 검증은 CPU, 신경망 미니배치 학습은 GPU(CUDA)입니다. 기존 GPU 혼합의 59,049개 정적 패턴표와 신경망 학습은 서로 다른 기능입니다. 반복 실행은 Node/Python 로컬 프로그램이며 ChatGPT/Codex/외부 AI API를 호출하지 않습니다.

저장소 루트에서 사용:
  outputs/start-learning.cmd 더블클릭: 서버를 켠 뒤 기본 브라우저를 자동으로 엽니다.
  재부팅 후에도 같은 파일을 더블클릭하면 됩니다. 사용하는 동안 처음 열린 서버 창을 열어 둡니다.
  이미 실행 중이면 기존 학습 화면을 엽니다. 저장된 기보·모델·진행 상태는 유지됩니다.
  node tools/learning/run.cjs init --run=outputs/learning/my-run
  node tools/learning/run.cjs import --run=outputs/learning/my-run --input=C:/path/omok-records.json
  node tools/learning/run.cjs cycle --run=outputs/learning/my-run --games=8 --pairs=4 --minutes=3 --workers=1
  node tools/learning/run.cjs stop --run=outputs/learning/my-run
  node tools/learning/run.cjs cycle --run=outputs/learning/my-run --resume --minutes=60
  node tools/learning/run.cjs status --run=outputs/learning/my-run

입력 없이 시작하면 기존 앱 내장 기보, Reader 기보와 reports/*-loss-certificate.json의 기존 국면을 현재 규칙으로 복원하여 시작 자료로 사용합니다. 브라우저 localStorage 기보는 프로그램이 직접 읽을 수 없으므로 오목의 JSON 내보내기 후 가져옵니다. 백 선공, PASS, 흑백/내 돌 역할을 보존합니다. 숫자 위치는 앱의 A1=0 인덱스이며 화면의 좌표 방향을 뒤집어 해석하지 않습니다. 색을 쓰지 않은 텍스트 기보는 --first=1 또는 --first=2가 필요합니다.

대량 목표 예시:
  node tools/learning/run.cjs cycle --run=outputs/learning/long-run --games=100000 --games-per-cycle=100 --workers=2 --move-ms=80 --validation-ms=1000 --pairs=64 --minutes=60
같은 명령에 --resume를 더하면 부분 대국/학습/평가를 계속합니다. 60분은 한 번 실행의 예산이며 수십만 판의 실제 완료 시간을 약속하지 않습니다. 먼저 짧은 실행의 게임/초·학습 samples/초·RAM/VRAM 실측을 확인합니다. 생성과 학습은 서로 다른 병목이므로 GPU 사용률만으로 대국 처리량을 판단하지 않습니다. --max-samples/--max-disk-gb로 자료·디스크 예산을 제한할 수 있습니다. 전용 Python 기본 경로는 C:/Users/jiho/Documents/Codex/.omok-runtime/Scripts/python.exe이며 --python으로 지정할 수 있습니다. GPU 미지원은 실패 이유로 표시하고, --device=cpu를 명시한 경우에만 CPU 학습을 선택합니다.

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
수읽기 캐시는 게임별로 유지하지만 프로세스 재시작 때 양쪽 모두 새 캐시를 시작합니다. 자료·모델·실험 상태는 계속 남습니다. 실제 채택은 모델만 갱신하고 src/active-model.json 및 기존 HTML 실행본 다섯 곳을 동일하게 교체합니다. GitHub push/외부 배포는 실행하지 않습니다.
