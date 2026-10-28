; Instalador do BEATMAX Training (NSIS) — instala só pro usuário atual, sem administrador.
Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!define APPNAME "BEATMAX Training"
!define APPVER "1.25.1"
!define PORT "8791"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\DJMAXTraining"

Name "${APPNAME}"
OutFile "Instalar-BEATMAX-Training.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\DJMAXTraining" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "BEATMAX Training ${APPVER}"
VIProductVersion "1.25.1.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "Instalador do ${APPNAME}"
VIAddVersionKey "FileVersion" "${APPVER}"
VIAddVersionKey "LegalCopyright" "Uso pessoal"

!define MUI_ICON "payload\assets\icone.ico"
!define MUI_UNICON "payload\assets\icone.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Instalar o ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "Este assistente instala o ${APPNAME} neste computador.$\r$\n$\r$\nEle verifica o que falta e instala sozinho: baixa o Python portátil (só para o jogo, uns 11 MB, precisa de internet na primeira vez), copia o jogo, cria os atalhos e, se quiser, deixa o servidor ligando junto com o Windows.$\r$\n$\r$\nSuas músicas, recordes e replays ficam no navegador e continuam aparecendo.$\r$\n$\r$\nNão precisa de administrador."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o ${APPNAME} agora"
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirJogo
!define MUI_COMPONENTSPAGE_SMALLDESC

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Function AbrirJogo
  SetOutPath "$INSTDIR"
  Exec '"$INSTDIR\python\pythonw.exe" "$INSTDIR\servidor.py" ${PORT} --abrir-app'
FunctionEnd

Section "Jogo (obrigatório)" SecJogo
  SectionIn RO
  SetOutPath "$INSTDIR"
  DetailPrint "Copiando os arquivos do jogo..."
  File /r "payload\*.*"

  ; aproveita a configuração do osu! de uma instalação antiga na Área de Trabalho
  ${IfNot} ${FileExists} "$INSTDIR\osu-config.json"
    ${If} ${FileExists} "$DESKTOP\DJMAX Training\osu-config.json"
      CopyFiles /SILENT "$DESKTOP\DJMAX Training\osu-config.json" "$INSTDIR"
      DetailPrint "Configuração do osu! copiada da pasta antiga."
    ${EndIf}
  ${EndIf}

  ; dependência: Python portátil só pra pasta do jogo
  ${IfNot} ${FileExists} "$INSTDIR\python\pythonw.exe"
    DetailPrint "Verificando o Python do jogo (baixa se precisar)..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\instalador\python.ps1" -Dest "$INSTDIR\python"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "Não deu pra baixar o Python do jogo (código $0).$\r$\n$\r$\nConfira a internet e rode o instalador de novo."
      Abort
    ${EndIf}
  ${Else}
    DetailPrint "Python do jogo: já instalado."
  ${EndIf}

  ; atalho antigo (abria no navegador) dá lugar ao novo
  Delete "$DESKTOP\DJMAX Trainer.url"
  ; nome antigo (antes de virar BEATMAX): tira os atalhos velhos pra não ficar duplicado
  Delete "$DESKTOP\DJMAX Training.lnk"
  RMDir /r "$SMPROGRAMS\DJMAX Training"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\python\pythonw.exe" '"$INSTDIR\servidor.py" ${PORT} --abrir-app' "$INSTDIR\assets\icone.ico" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"

  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKCU "Software\DJMAXTraining" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${APPVER}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Uso pessoal"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\assets\icone.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Atalho na Área de Trabalho" SecAtalho
  SetOutPath "$INSTDIR"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\python\pythonw.exe" '"$INSTDIR\servidor.py" ${PORT} --abrir-app' "$INSTDIR\assets\icone.ico" 0
SectionEnd

Section "Ligar junto com o Windows" SecInicio
  SetOutPath "$INSTDIR"
  DetailPrint "Configurando o servidor pra ligar junto com o Windows..."
  nsExec::ExecToLog '"$INSTDIR\python\python.exe" "$INSTDIR\servidor.py" ${PORT} --instalar-inicio --sem-atalho --sem-abrir'
  Pop $0
SectionEnd

LangString DESC_JOGO ${LANG_PORTUGUESEBR} "O jogo, o Python portátil (baixado na hora, só pra pasta do jogo) e o atalho no menu Iniciar."
LangString DESC_ATALHO ${LANG_PORTUGUESEBR} "Ícone do BEATMAX Training na Área de Trabalho."
LangString DESC_INICIO ${LANG_PORTUGUESEBR} "Deixa o servidor do jogo ligado (escondido) desde que o Windows inicia — o jogo abre na hora. Recomendado."
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecJogo} $(DESC_JOGO)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecAtalho} $(DESC_ATALHO)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecInicio} $(DESC_INICIO)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  ${If} ${FileExists} "$INSTDIR\python\python.exe"
    nsExec::ExecToLog '"$INSTDIR\python\python.exe" "$INSTDIR\servidor.py" ${PORT} --remover-inicio'
    Pop $0
  ${EndIf}
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\DJMAXTraining"
  Sleep 1500
  RMDir /r "$INSTDIR"
  MessageBox MB_ICONINFORMATION "O ${APPNAME} foi removido.$\r$\n$\r$\nSuas músicas, recordes e replays continuam guardados no navegador — se instalar de novo, eles voltam a aparecer."
SectionEnd
