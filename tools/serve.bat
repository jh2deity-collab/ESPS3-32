@echo off
chcp 65001 >nul
REM 윈도우에서 파이썬을 찾아 웹 콘솔 서버를 띄운다.
REM 탐색기에서 이 파일을 더블클릭해도 된다.
setlocal

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0serve.py" %*
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  python "%~dp0serve.py" %*
  goto :eof
)

echo.
echo [오류] 파이썬을 찾을 수 없습니다.
echo        https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행하세요.
echo        설치할 때 "Add Python to PATH" 를 반드시 체크하세요.
echo.
pause
