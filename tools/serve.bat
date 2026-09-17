@echo off
chcp 65001 >nul
setlocal

REM ---------------------------------------------------------------------
REM  ESPS3-32 I/O 테스트 콘솔 - 윈도우 실행기
REM  탐색기에서 이 파일을 더블클릭해도 된다.
REM  파이썬이 있으면 serve.py 를, 없으면 PowerShell 판(serve.ps1)을 쓴다.
REM ---------------------------------------------------------------------

REM 1) py 런처 (python.org 설치본에 함께 들어온다)
py -3 -c "import sys" >nul 2>nul
if not errorlevel 1 (
  py -3 "%~dp0serve.py" %*
  goto :end
)

REM 2) PATH 의 python.exe
REM    윈도우에 기본으로 깔린 '마이크로소프트 스토어 껍데기'는 실행하면
REM    스토어 창만 뜨고 아무 일도 일어나지 않으므로 경로로 걸러낸다.
set "PYEXE="
for /f "delims=" %%i in ('where python 2^>nul ^| findstr /v /i "WindowsApps"') do (
  if not defined PYEXE set "PYEXE=%%i"
)
if defined PYEXE (
  "%PYEXE%" "%~dp0serve.py" %*
  goto :end
)

REM 3) 파이썬이 없다 - 윈도우에 기본 탑재된 PowerShell 로 실행
echo.
echo   파이썬을 찾지 못했습니다. PowerShell 로 실행합니다.
echo   (파이썬을 설치하면 더 빠릅니다: https://www.python.org/downloads/)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*

:end
if errorlevel 1 (
  echo.
  echo   창을 닫으려면 아무 키나 누르세요.
  pause >nul
)
endlocal
