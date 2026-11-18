Unicode true
!include "MUI2.nsh"
!define APPNAME "Arena Live OS"
!define APPVERSION "1.2.0"
Name "${APPNAME}"
OutFile "ArenaLiveOS-Setup-${APPVERSION}.exe"
InstallDir "$PROGRAMFILES64\Arena Live OS"
RequestExecutionLevel admin
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"
Section "Arena Live OS"
  SetOutPath "$INSTDIR"
  File /r "release\Arena-Live-OS\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Arena Live OS"
  CreateShortcut "$SMPROGRAMS\Arena Live OS\Arena Live OS.lnk" "$INSTDIR\Arena-Live-OS.bat"
  CreateShortcut "$DESKTOP\Arena Live OS.lnk" "$INSTDIR\Arena-Live-OS.bat"
  CreateShortcut "$SMPROGRAMS\Arena Live OS\Güncelle.lnk" "$INSTDIR\Arena-Update.bat"
  CreateShortcut "$SMPROGRAMS\Arena Live OS\Kaldır.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd
Section "Uninstall"
  RMDir /r "$INSTDIR"
  RMDir "$SMPROGRAMS\Arena Live OS"
  Delete "$DESKTOP\Arena Live OS.lnk"
SectionEnd
