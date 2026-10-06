param([int]$Port = 8766, [string]$Python = '')
$ErrorActionPreference = 'Stop'
$learningRepo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$learningArgs = @((Join-Path $PSScriptRoot 'dashboard.cjs'), "--port=$Port", '--open')
if ($Python) { $learningArgs += "--python=$Python" }
Write-Host "로컬 오목 학습 화면: http://127.0.0.1:$Port"
Write-Host '서버를 닫으려면 Ctrl+C를 누르세요. 진행 중인 작업에는 중단을 요청합니다.'
Push-Location -LiteralPath $learningRepo
try { & node @learningArgs } finally { Pop-Location }
