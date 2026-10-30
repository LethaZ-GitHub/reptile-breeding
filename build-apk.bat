@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
REM ============================================================
REM  Reptile Breeding - One-click APK build script (Debug)
REM  Usage: double-click, or run build-apk.bat in project dir
REM  JDK / Android SDK are auto-detected in this order:
REM    JAVA_HOME / ANDROID_HOME  ->  user-local installs
REM    (%LOCALAPPDATA%\Programs\jdk-*, %LOCALAPPDATA%\Android\Sdk)
REM    ->  legacy C:/rb-build layout.
REM  The Gradle build itself runs in an ASCII-path mirror
REM  (C:/rb-build/project) because Gradle 8.2.1 + this JDK mangle
REM  non-ASCII project paths (sun.jnu.encoding) and break input
REM  snapshotting / script cache. GRADLE_USER_HOME defaults to
REM  %USERPROFILE%\.gradle (warm dependency cache).
REM  This .bat file MUST stay pure ASCII (no Chinese literals),
REM  otherwise cmd.exe misparses it under GBK codepage.
REM ============================================================
set PROJ=%~dp0
set PROJ=%PROJ:~0,-1%
set BUILD_ROOT=C:\rb-build

REM ---- locate JDK 17 ----
set JDKDIR=
if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" set JDKDIR=%JAVA_HOME%
if not defined JDKDIR (
  for /d %%D in ("%LOCALAPPDATA%\Programs\jdk-*") do if exist "%%~D\bin\java.exe" set JDKDIR=%%~D
)
if not defined JDKDIR if exist "C:/rb-build/jdk/bin/java.exe" set JDKDIR=C:/rb-build/jdk
if not defined JDKDIR (
  echo [ERROR] JDK 17 not found. Set JAVA_HOME or install a JDK 17.
  exit /b 1
)

REM ---- locate Android SDK with platform android-35 ----
set SDKIR=
if defined ANDROID_HOME if exist "%ANDROID_HOME%\platforms\android-35" set SDKIR=%ANDROID_HOME%
if not defined SDKIR if exist "%LOCALAPPDATA%\Android\Sdk\platforms\android-35" set SDKIR=%LOCALAPPDATA%\Android\Sdk
if not defined SDKIR if exist "C:/rb-build/android-sdk/platforms/android-35" set SDKIR=C:/rb-build/android-sdk
if not defined SDKIR (
  echo [ERROR] Android SDK ^(platform android-35^) not found. Set ANDROID_HOME.
  exit /b 1
)

echo [1/5] Syncing web assets to www/ ...
cd /d "%PROJ%"
if not exist node_modules (
  echo [ERROR] node_modules not found. Run: npm install
  exit /b 1
)
call node tools/sync-web.mjs
if errorlevel 1 exit /b 1

echo [2/5] Capacitor sync (www -^> android assets) ...
call npx cap sync android
if errorlevel 1 (
    echo [WARN] cap sync failed - falling back to robocopy mirror.
    robocopy "%PROJ%\www" "%PROJ%\android\app\src\main\assets\public" /MIR /NFL /NDL /NJH /NJS /NC /NS /NP >nul
    if errorlevel 8 (
        echo [ERROR] web asset mirror failed.
        exit /b 1
    )
)

echo [3/5] Syncing project to %BUILD_ROOT%\project ...
if not exist "%BUILD_ROOT%\project" mkdir "%BUILD_ROOT%\project"
REM /XD excludes .gradle and build: they cache ABSOLUTE paths,
REM syncing from the Chinese-path project pollutes the ASCII-path build
robocopy "%PROJ%\android" "%BUILD_ROOT%\project\android" /MIR /XD .gradle build .cxx /NFL /NDL /NJH /NJS /NC /NS /NP >nul
if errorlevel 8 (
    echo [ERROR] android mirror failed.
    exit /b 1
)
robocopy "%PROJ%\node_modules" "%BUILD_ROOT%\project\node_modules" /MIR /NFL /NDL /NJH /NJS /NC /NS /NP >nul
if errorlevel 8 (
    echo [ERROR] node_modules mirror failed.
    exit /b 1
)
REM local.properties is java.util.Properties format: write forward slashes
echo sdk.dir=%SDKIR:\=/%> "%BUILD_ROOT%\project\android\local.properties"

echo [4/5] Building APK ...
set JAVA_HOME=%JDKDIR%
set ANDROID_HOME=%SDKIR%
cd /d "%BUILD_ROOT%\project\android"
call gradlew.bat assembleDebug --no-daemon --console=plain -Dorg.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
if errorlevel 1 (
    echo [ERROR] Build failed.
    exit /b 1
)

echo [5/5] Copying APK to project root ...
REM cmd's copy needs BACKSLASHES in the source path (forward slashes fail)
copy /y "%BUILD_ROOT%\project\android\app\build\outputs\apk\debug\app-debug.apk" "%PROJ%\app-debug.apk" >nul
if errorlevel 1 (
    echo [ERROR] APK copy failed.
    exit /b 1
)
echo.
echo [DONE] APK: %PROJ%/app-debug.apk
exit /b 0
