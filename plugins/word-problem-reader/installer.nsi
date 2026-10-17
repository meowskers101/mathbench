; Mathbench Word Problem Reader: installs the plugin's model files where Mathbench looks for them
; (%APPDATA%\mathbench-desktop\ai\qwen). Mathbench can download and run this itself (silently, /S), or it can be run by hand.
;
; Build: makensis /DSRC=<folder with the model files> /DOUT=<installer.exe> installer.nsi
; The folder holds LICENSE, config.json, generation_config.json, tokenizer.json, tokenizer_config.json and
; model_q4.onnx, model_q4.onnx_data, model_q4.onnx_data_1, model_q4.onnx_data_2 (Qwen2.5-1.5B-Instruct, Apache 2.0,
; 4-bit ONNX from onnx-community/Qwen2.5-1.5B-Instruct revision d54957e, weights split into three pieces).

Unicode true
!include "MUI2.nsh"

!define NAME "Mathbench Word Problem Reader"
!define VERSION "1.0.0"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MathbenchWordProblemReader"

Name "${NAME}"
OutFile "${OUT}"
RequestExecutionLevel user
InstallDir "$APPDATA\mathbench-desktop\ai\qwen"
; the model's weights are already 4-bit numbers that hardly compress, and the file must stay under 2 GB
SetCompress off
BrandingText "${NAME} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${NAME}"
VIAddVersionKey "FileDescription" "${NAME} plugin installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Qwen2.5-1.5B-Instruct: Apache License 2.0"

!define MUI_ICON "..\..\assets\icon.ico"
!define MUI_UNICON "..\..\assets\icon.ico"
!define MUI_WELCOMEPAGE_TITLE "Word Problem Reader for Mathbench"
!define MUI_WELCOMEPAGE_TEXT "This adds the Word Problem Reader plugin to Mathbench. It reads a word problem and writes the equation behind it, then Mathbench solves it.$\r$\n$\r$\nIt installs about 1.8 GB into your user profile and works offline. Mathbench does not need to be closed.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_TITLE "Word Problem Reader is installed"
!define MUI_FINISHPAGE_TEXT "Type a word problem in Mathbench and press Solve.$\r$\n$\r$\nTo remove it later: Settings > Apps > Installed apps > ${NAME}."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${SRC}\LICENSE"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File "${SRC}\LICENSE"
  File "${SRC}\config.json"
  File "${SRC}\generation_config.json"
  File "${SRC}\tokenizer.json"
  File "${SRC}\tokenizer_config.json"
  SetOutPath "$INSTDIR\onnx"
  File "${SRC}\model_q4.onnx"
  File "${SRC}\model_q4.onnx_data"
  File "${SRC}\model_q4.onnx_data_1"
  File "${SRC}\model_q4.onnx_data_2"
  SetOutPath "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall Word Problem Reader.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Mathbench"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\Uninstall Word Problem Reader.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall Word Problem Reader.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall Word Problem Reader.exe" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" 1752930
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\onnx\model_q4.onnx"
  Delete "$INSTDIR\onnx\model_q4.onnx_data"
  Delete "$INSTDIR\onnx\model_q4.onnx_data_1"
  Delete "$INSTDIR\onnx\model_q4.onnx_data_2"
  RMDir "$INSTDIR\onnx"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\config.json"
  Delete "$INSTDIR\generation_config.json"
  Delete "$INSTDIR\tokenizer.json"
  Delete "$INSTDIR\tokenizer_config.json"
  Delete "$INSTDIR\Uninstall Word Problem Reader.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
