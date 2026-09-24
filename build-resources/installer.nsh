; SellQuanta installer additions.
; Business data lives in %APPDATA%\SellQuanta Data and is never removed by the uninstaller (updates never touch it either).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_OK|MB_ICONINFORMATION "SellQuanta has been removed.$\r$\n$\r$\nYour business data was kept in:$\r$\n$APPDATA\SellQuanta Data$\r$\n$\r$\nIf you install SellQuanta again it will use this data automatically. Delete that folder yourself only if you are sure you no longer need it." /SD IDOK
  ${endIf}
!macroend
