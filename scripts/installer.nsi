Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef APPVERSION
  !define APPVERSION "1.3.0"
!endif
!ifndef PROJECTROOT
  !define PROJECTROOT "."
!endif

!define APPNAME "Arena Radar"
!define APPEXE "ArenaRadar.bat"
!define REGKEY "Software\ArenaRadar"

Name "${APPNAME}"
OutFile "${PROJECTROOT}\release\ArenaRadar-Setup-${APPVERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Arena Radar"
InstallDirRegKey HKCU "${REGKEY}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "TikTok LIVE sandık radarı.$\r$\n$\r$\nKurulum yönetici izni gerektirmez. Uygulama GitHub'daki canlı tarama verisini okur, sandık açılmadan önce bildirim gönderir ve açılışta yeni sürümü denetler."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Turkish"

Section "Arena Radar" SEC01
  SetOutPath "$INSTDIR"

  ; Çalışan uygulamayı yalnızca kendi PID dosyasından kapat.
  FileOpen $0 "$LOCALAPPDATA\ArenaRadar\radar.pid" r
  ${If} ${Errors}
    ClearErrors
  ${Else}
    FileRead $0 $1
    FileClose $0
    ${If} $1 != ""
      DetailPrint "Çalışan Arena Radar kapatılıyor (PID $1)"
      nsExec::Exec 'taskkill /F /PID $1'
      Sleep 900
    ${EndIf}
  ${EndIf}

  File /r "${PROJECTROOT}\release\radar\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "${REGKEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArenaRadar" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArenaRadar" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArenaRadar" "Publisher" "Arena Live OS"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArenaRadar" "DisplayIcon" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArenaRadar" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArenaRadar" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArenaRadar" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\Arena Radar"
  CreateShortcut "$SMPROGRAMS\Arena Radar\Arena Radar.lnk" "$INSTDIR\${APPEXE}"
  CreateShortcut "$SMPROGRAMS\Arena Radar\Durdur.lnk" "$INSTDIR\Durdur.bat"
  CreateShortcut "$SMPROGRAMS\Arena Radar\Kaldır.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Arena Radar.lnk" "$INSTDIR\${APPEXE}"
  ; Bilgisayar açılışında arka planda çalışır (tarayıcı açmaz).
  CreateShortcut "$SMSTARTUP\Arena Radar.lnk" "$INSTDIR\${APPEXE}" "--silent"

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArenaRadar" "EstimatedSize" "$0"

  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION "Arena Radar şimdi başlatılsın mı?" IDNO +2
    ExecShell "" "$INSTDIR\${APPEXE}"
  ${EndIf}
SectionEnd

Section "Uninstall"
  FileOpen $0 "$LOCALAPPDATA\ArenaRadar\radar.pid" r
  ${IfNot} ${Errors}
    FileRead $0 $1
    FileClose $0
    ${If} $1 != ""
      nsExec::Exec 'taskkill /F /PID $1'
      Sleep 500
    ${EndIf}
  ${EndIf}

  Delete "$SMSTARTUP\Arena Radar.lnk"
  Delete "$DESKTOP\Arena Radar.lnk"
  Delete "$SMPROGRAMS\Arena Radar\Arena Radar.lnk"
  Delete "$SMPROGRAMS\Arena Radar\Durdur.lnk"
  Delete "$SMPROGRAMS\Arena Radar\Kaldır.lnk"
  RMDir "$SMPROGRAMS\Arena Radar"

  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ArenaRadar"
  DeleteRegKey HKCU "${REGKEY}"

  ; Kullanıcı ayarları ve uyarı geçmişi korunur; istenirse elle silinebilir:
  ; %LOCALAPPDATA%\ArenaRadar
SectionEnd
