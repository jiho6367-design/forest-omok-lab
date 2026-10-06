@echo off
setlocal
pushd "%~dp0..\.."
echo Forest Omok local learning: http://127.0.0.1:8766
echo Leave this window open. Press Ctrl+C to close the local server.
node "%~dp0dashboard.cjs" --open
if errorlevel 1 pause
popd
