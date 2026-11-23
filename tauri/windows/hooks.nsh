; OpenPres additions to the Windows installer (NSIS). Tauri includes this file at the top of
; windows/installer.nsi (bundle.windows.nsis.installerHooks in tauri.conf.json).
;
; - A page after the install folder: "Use this computer as an OpenPres server", with the
;   server's name, the admin and operator passwords and network access. It is skipped by
;   updates (passive / silent) and on computers whose server is already set up.
; - After installing: the answers go to %APPDATA%\OpenPres\Server\installer-setup.txt (the
;   server takes them on its first start, stores the passwords hashed and deletes the
;   file), the server starts with Windows, and it starts now, in Standby.
; - Uninstalling removes the start with Windows; reinstalling over it keeps it.

!include nsDialogs.nsh
!include LogicLib.nsh

!define OPENPRES_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define OPENPRES_RUN_VALUE "OpenPres Server"
!define OPENPRES_STARTUP_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

; Starts a program as the user who runs the installer (the installer may be elevated).
!macro OPENPRES_RUN PROGRAM ARGS
  !ifdef OPENPRES_TEST
    Exec '"${PROGRAM}" ${ARGS}'
  !else
    nsis_tauri_utils::RunAsUser "${PROGRAM}" "${ARGS}"
  !endif
!macroend

; Whether the server started with Windows before this install. Reinstalling by hand runs the
; old uninstaller without /UPDATE, which removes the start-up entry; it's written again after
; installing. Called from .onInit (windows/installer.nsi), before anything is uninstalled.
Var OpenPresHadStartup
!macro OPENPRES_REMEMBER_STARTUP
  ClearErrors
  ReadRegStr $OpenPresHadStartup HKCU "${OPENPRES_RUN_KEY}" "${OPENPRES_RUN_VALUE}"
  ${If} ${Errors}
    StrCpy $OpenPresHadStartup ""
  ${EndIf}
!macroend

; The page. Inserted by windows/installer.nsi right after the install folder page.
; (The inner page is 300 x 140 dialog units.)
!macro OPENPRES_SERVER_PAGE
  Var OpenPresShown        ; the page was shown before (keep what was typed)
  Var OpenPresServer       ; 1: this computer is set up as a server by this install
  Var OpenPresRemote       ; 1: other computers and tablets may connect
  Var OpenPresName
  Var OpenPresAdmin
  Var OpenPresOperator
  Var OpenPresCheck
  Var OpenPresNameBox
  Var OpenPresAdminBox
  Var OpenPresAdminRepeatBox
  Var OpenPresOperatorBox
  Var OpenPresOperatorRepeatBox
  Var OpenPresRemoteBox
  Var OpenPresLabel1
  Var OpenPresLabel2
  Var OpenPresLabel3
  Var OpenPresLabel4
  Var OpenPresLabel5
  Var OpenPresLabel6

  Page custom OpenPresServerPage OpenPresServerPageLeave

  Function OpenPresServerPage
    ; Updates and passive / silent installs keep things as they are.
    ${If} $PassiveMode = 1
    ${OrIf} $UpdateMode = 1
    ${OrIf} ${Silent}
      Abort
    ${EndIf}
    ; Already a server that is set up (its passwords exist, also from before 0.4): it keeps
    ; its settings. Settings without passwords (versions before servers had them) are set
    ; up here, like a new server; otherwise the server would ask in its own window.
    Push "$APPDATA\OpenPres\Server\config.json"
    Call OpenPresConfigSetUp
    Pop $0
    ${If} $0 = 1
      Abort
    ${EndIf}
    Push "$APPDATA\OpenPres\config.json"
    Call OpenPresConfigSetUp
    Pop $0
    ${If} $0 = 1
      Abort
    ${EndIf}
    ${If} $OpenPresShown != 1
      StrCpy $OpenPresShown 1
      StrCpy $OpenPresServer 0
      StrCpy $OpenPresRemote 1
      ReadEnvStr $OpenPresName COMPUTERNAME
    ${EndIf}

    !insertmacro MUI_HEADER_TEXT "OpenPres Server" "The computer that shows the screens and runs the stream."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 0 300u 12u "Use this computer as an OpenPres server"
    Pop $OpenPresCheck
    ${NSD_OnClick} $OpenPresCheck OpenPresServerToggle
    CreateFont $1 "$(^Font)" "$(^FontSize)" 700
    SendMessage $OpenPresCheck ${WM_SETFONT} $1 1

    ${NSD_CreateLabel} 12u 13u 288u 18u "It runs in the background, starts with Windows and has an icon next to the clock. Managers on this and other computers connect to it."
    Pop $OpenPresLabel1

    ${NSD_CreateLabel} 12u 38u 78u 10u "Server name"
    Pop $OpenPresLabel2
    ${NSD_CreateText} 92u 36u 208u 12u "$OpenPresName"
    Pop $OpenPresNameBox

    ${NSD_CreateLabel} 12u 54u 78u 10u "Admin password"
    Pop $OpenPresLabel3
    ${NSD_CreatePassword} 92u 52u 102u 12u "$OpenPresAdmin"
    Pop $OpenPresAdminBox
    ${NSD_Edit_SetCueBannerText} $OpenPresAdminBox 0 "Password"
    ${NSD_CreatePassword} 198u 52u 102u 12u "$OpenPresAdmin"
    Pop $OpenPresAdminRepeatBox
    ${NSD_Edit_SetCueBannerText} $OpenPresAdminRepeatBox 0 "Repeat"

    ${NSD_CreateLabel} 12u 70u 78u 10u "Operator password"
    Pop $OpenPresLabel4
    ${NSD_CreatePassword} 92u 68u 102u 12u "$OpenPresOperator"
    Pop $OpenPresOperatorBox
    ${NSD_Edit_SetCueBannerText} $OpenPresOperatorBox 0 "Password"
    ${NSD_CreatePassword} 198u 68u 102u 12u "$OpenPresOperator"
    Pop $OpenPresOperatorRepeatBox
    ${NSD_Edit_SetCueBannerText} $OpenPresOperatorRepeatBox 0 "Repeat"

    ${NSD_CreateLabel} 92u 83u 208u 18u "Admin: the general settings. Operator: everything else. At least 4 characters each, and different."
    Pop $OpenPresLabel5

    ${NSD_CreateCheckbox} 12u 104u 288u 12u "Let managers on other computers and tablets connect"
    Pop $OpenPresRemoteBox
    ${If} $OpenPresRemote = 1
      ${NSD_Check} $OpenPresRemoteBox
    ${EndIf}

    ${NSD_CreateLabel} 12u 120u 288u 18u "It starts in Standby: nothing is shown until you switch it on from a manager or from its icon."
    Pop $OpenPresLabel6

    ${If} $OpenPresServer = 1
      ${NSD_Check} $OpenPresCheck
    ${EndIf}
    Call OpenPresServerFields

    nsDialogs::Show
  FunctionEnd

  ; 1 if the server settings at the path on the stack are set up: both password hashes have a
  ; value (what the server calls set up). The file is pretty-printed JSON, one key per line:
  ;   "admin_password_hash": "…",   or   "admin_password_hash": null,
  Function OpenPresConfigSetUp
    Exch $0 ; path
    Push $1 ; file
    Push $2 ; line
    Push $3 ; admin password found
    Push $4 ; operator password found
    Push $5
    StrCpy $3 0
    StrCpy $4 0
    ClearErrors
    FileOpen $1 $0 r
    ${IfNot} ${Errors}
      ${Do}
        ClearErrors
        FileRead $1 $2
        ${If} ${Errors}
          ${ExitDo}
        ${EndIf}
        ${StrLoc} $5 $2 ": null" ">"
        ${If} $5 == ""
          ${StrLoc} $5 $2 '"admin_password_hash":' ">"
          ${If} $5 != ""
            StrCpy $3 1
          ${EndIf}
          ${StrLoc} $5 $2 '"password_hash":' ">"
          ${If} $5 != ""
            StrCpy $4 1
          ${EndIf}
        ${EndIf}
      ${Loop}
      FileClose $1
    ${EndIf}
    ${If} $3 = 1
    ${AndIf} $4 = 1
      StrCpy $0 1
    ${Else}
      StrCpy $0 0
    ${EndIf}
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
  FunctionEnd

  Function OpenPresServerToggle
    Pop $0
    Call OpenPresServerFields
  FunctionEnd

  ; The fields work only with the check box ticked.
  Function OpenPresServerFields
    ${NSD_GetState} $OpenPresCheck $1
    ${If} $1 == ${BST_CHECKED}
      StrCpy $1 1
    ${Else}
      StrCpy $1 0
    ${EndIf}
    EnableWindow $OpenPresLabel1 $1
    EnableWindow $OpenPresLabel2 $1
    EnableWindow $OpenPresNameBox $1
    EnableWindow $OpenPresLabel3 $1
    EnableWindow $OpenPresAdminBox $1
    EnableWindow $OpenPresAdminRepeatBox $1
    EnableWindow $OpenPresLabel4 $1
    EnableWindow $OpenPresOperatorBox $1
    EnableWindow $OpenPresOperatorRepeatBox $1
    EnableWindow $OpenPresLabel5 $1
    EnableWindow $OpenPresRemoteBox $1
    EnableWindow $OpenPresLabel6 $1
  FunctionEnd

  Function OpenPresServerPageLeave
    ${NSD_GetState} $OpenPresCheck $0
    ${NSD_GetText} $OpenPresNameBox $OpenPresName
    ${NSD_GetText} $OpenPresAdminBox $OpenPresAdmin
    ${NSD_GetText} $OpenPresOperatorBox $OpenPresOperator
    ${NSD_GetState} $OpenPresRemoteBox $1
    ${If} $1 == ${BST_CHECKED}
      StrCpy $OpenPresRemote 1
    ${Else}
      StrCpy $OpenPresRemote 0
    ${EndIf}
    ${If} $0 != ${BST_CHECKED}
      StrCpy $OpenPresServer 0
      Return
    ${EndIf}

    ; The same rules as the server's own setup (exact comparisons: S== / S!=).
    StrLen $1 $OpenPresAdmin
    ${If} $1 < 4
      MessageBox MB_ICONEXCLAMATION|MB_OK "Use an admin password of at least 4 characters."
      Abort
    ${EndIf}
    ${NSD_GetText} $OpenPresAdminRepeatBox $1
    ${If} $1 S!= $OpenPresAdmin
      MessageBox MB_ICONEXCLAMATION|MB_OK "The two admin passwords are different."
      Abort
    ${EndIf}
    StrLen $1 $OpenPresOperator
    ${If} $1 < 4
      MessageBox MB_ICONEXCLAMATION|MB_OK "Use an operator password of at least 4 characters."
      Abort
    ${EndIf}
    ${NSD_GetText} $OpenPresOperatorRepeatBox $1
    ${If} $1 S!= $OpenPresOperator
      MessageBox MB_ICONEXCLAMATION|MB_OK "The two operator passwords are different."
      Abort
    ${EndIf}
    ${If} $OpenPresAdmin S== $OpenPresOperator
      MessageBox MB_ICONEXCLAMATION|MB_OK "Use different admin and operator passwords."
      Abort
    ${EndIf}
    StrCpy $OpenPresServer 1
  FunctionEnd
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $OpenPresServer = 1
    DetailPrint "Setting up the OpenPres server"
    CreateDirectory "$APPDATA\OpenPres\Server"
    FileOpen $0 "$APPDATA\OpenPres\Server\installer-setup.txt" w
    ${If} $0 != ""
      FileWriteUTF16LE /BOM $0 "name=$OpenPresName$\r$\n"
      FileWriteUTF16LE $0 "admin_password=$OpenPresAdmin$\r$\n"
      FileWriteUTF16LE $0 "operator_password=$OpenPresOperator$\r$\n"
      FileWriteUTF16LE $0 "remote_access=$OpenPresRemote$\r$\n"
      FileWriteUTF16LE $0 "power=standby$\r$\n"
      FileClose $0
    ${Else}
      DetailPrint "Could not write the server's setup; it asks for it when it starts."
    ${EndIf}
    ; Not kept in memory longer than needed.
    StrCpy $OpenPresAdmin ""
    StrCpy $OpenPresOperator ""
    WriteRegStr HKCU "${OPENPRES_RUN_KEY}" "${OPENPRES_RUN_VALUE}" '"$INSTDIR\${MAINBINARYNAME}.exe" --server'
  ${ElseIf} $OpenPresHadStartup != ""
    ; It started with Windows before: still does (the old uninstaller may have removed it).
    ClearErrors
    ReadRegStr $0 HKCU "${OPENPRES_RUN_KEY}" "${OPENPRES_RUN_VALUE}"
    ${If} ${Errors}
    ${OrIf} $0 == ""
      DetailPrint "Keeping the OpenPres server's start with Windows"
      WriteRegStr HKCU "${OPENPRES_RUN_KEY}" "${OPENPRES_RUN_VALUE}" '"$INSTDIR\${MAINBINARYNAME}.exe" --server'
    ${EndIf}
  ${EndIf}

  ; A server on this computer (new, or one that starts with Windows) starts again now. After
  ; an update, the updater starts the program again by itself.
  ${If} $UpdateMode <> 1
    ClearErrors
    ReadRegStr $0 HKCU "${OPENPRES_RUN_KEY}" "${OPENPRES_RUN_VALUE}"
    ${IfNot} ${Errors}
    ${AndIf} $0 != ""
      DetailPrint "Starting the OpenPres server"
      !insertmacro OPENPRES_RUN "$INSTDIR\${MAINBINARYNAME}.exe" "--server"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "${OPENPRES_RUN_KEY}" "${OPENPRES_RUN_VALUE}"
    DeleteRegValue HKCU "${OPENPRES_STARTUP_APPROVED_KEY}" "${OPENPRES_RUN_VALUE}"
  ${EndIf}
!macroend
