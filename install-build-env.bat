@echo off
chcp 65001 >nul
REM ============================================================
REM  Reptile Breeding - Build environment installer
REM  Installs JDK 17 + Android SDK into C:/rb-build (ASCII path)
REM  Idempotent: existing components are skipped.
REM  This .bat file MUST stay pure ASCII (no Chinese literals),
REM  otherwise cmd.exe misparses it under GBK codepage.
REM ============================================================
setlocal
set ROOT=C:/rb-build
set JDKDIR=%ROOT%/jdk
set SDKIR=%ROOT%/android-sdk

if not exist "%ROOT%" mkdir "%ROOT%"

if not exist "%JDKDIR%/bin/java.exe" (
    echo [1/3] Downloading JDK 17 Temurin ...
    curl -sL -o "%ROOT%/jdk17.zip" "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"
    if not exist "%ROOT%/jdktmp" mkdir "%ROOT%/jdktmp"
    tar -xf "%ROOT%/jdk17.zip" -C "%ROOT%/jdktmp"
    for /d %%D in ("%ROOT%/jdktmp/*") do move "%%~D" "%JDKDIR%"
    rmdir /s /q "%ROOT%/jdktmp"
    del "%ROOT%/jdk17.zip"
) else (
    echo [1/3] JDK already installed, skip.
)

if not exist "%SDKIR%/cmdline-tools/latest/bin/sdkmanager.bat" (
    echo [2/3] Downloading Android command-line tools ...
    curl -sL -o "%ROOT%/cmdt.zip" "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
    if not exist "%SDKIR%/cmdline-tools" mkdir "%SDKIR%/cmdline-tools"
    tar -xf "%ROOT%/cmdt.zip" -C "%SDKIR%/cmdline-tools"
    move "%SDKIR%/cmdline-tools/cmdline-tools" "%SDKIR%/cmdline-tools/latest" >nul
    del "%ROOT%/cmdt.zip"
) else (
    echo [2/3] cmdline-tools already installed, skip.
)

echo [3/3] Installing SDK packages ...
set JAVA_HOME=%JDKDIR%
echo y| "%SDKIR%/cmdline-tools/latest/bin/sdkmanager.bat" --sdk_root="%SDKIR%" "platform-tools" "platforms;android-35" "build-tools;35.0.0"

echo.
echo [DONE] Build env ready at %ROOT%
echo Now run build-apk.bat to package the APK.
exit /b 0
