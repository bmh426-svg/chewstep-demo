@echo off
REM 어린이집 점심 영상 수요조사 랜딩(/lunch/) 미리보기 런처
REM 더블클릭하면 로컬 서버를 띄우고 브라우저로 랜딩을 엽니다.
REM 서버를 멈추려면 함께 열리는 검은 창을 닫으면 됩니다.
cd /d "%~dp0"

set PY=
where py >nul 2>nul && set PY=py -3
if "%PY%"=="" where python >nul 2>nul && set PY=python
if "%PY%"=="" set PY=C:\Users\algo4\AppData\Local\Programs\Python\Python312\python.exe

start "Chewstep Server (close to stop)" cmd /k %PY% -m http.server 8099
timeout /t 2 /nobreak >nul
start "" "http://localhost:8099/lunch/"
exit
