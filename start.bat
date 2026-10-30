@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal enabledelayedexpansion

REM ============================================================
REM  爬宠繁育管理系统 一键启动（Web 端本地服务）
REM  数据保存在浏览器本地 IndexedDB，关闭/重开不丢失
REM ============================================================

echo.
echo [爬宠繁育管理系统] 正在启动...
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  node server.js %*
  goto end
)

REM PATH 里没有 Node：尝试 WorkBuddy 托管版本
set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if exist "%NODE_EXE%" (
  "%NODE_EXE%" server.js %*
  goto end
)

echo.
echo [错误] 未找到 Node.js 运行时。
echo   请安装 Node.js 22+（https://nodejs.org ），或把 node.exe 放到本目录后重试。
echo.
pause
:end
endlocal
