@echo off
setlocal

REM ============================================================
REM  VengefulRealms - launch SkyMP through Mod Organizer 2
REM  Edit the four values below to match your setup, then
REM  double-click this file to play.
REM ============================================================

REM Full path to ModOrganizer.exe
set "MO2_EXE=C:\Modding\MO2\ModOrganizer.exe"

REM MO2 instance name. Leave empty for a portable MO2 install.
set "MO2_INSTANCE="

REM MO2 profile that has the VengefulRealms SkyMP mod enabled
set "MO2_PROFILE=VengefulRealms"

REM Name of the SKSE entry in MO2's executable dropdown
set "MO2_EXECUTABLE=SKSE"

if not exist "%MO2_EXE%" (
    echo [VGR] ModOrganizer.exe not found at: %MO2_EXE%
    echo [VGR] Edit this .bat and fix the MO2_EXE path.
    pause
    exit /b 1
)

echo [VGR] Launching "%MO2_EXECUTABLE%" through MO2 profile "%MO2_PROFILE%"...
if "%MO2_INSTANCE%"=="" (
    start "" "%MO2_EXE%" -p "%MO2_PROFILE%" "moshortcut://:%MO2_EXECUTABLE%"
) else (
    start "" "%MO2_EXE%" -i "%MO2_INSTANCE%" -p "%MO2_PROFILE%" "moshortcut://%MO2_INSTANCE%:%MO2_EXECUTABLE%"
)

endlocal
