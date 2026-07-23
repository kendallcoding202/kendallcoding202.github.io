; Inno Setup script for the Kovyr Vault Windows installer.
; Built in CI: ISCC /DAppVersion=<version> windows-installer.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{7E1B7C1E-6C1A-4C6E-9B7D-2A41F0C89D53}
AppName=Kovyr Vault
AppVersion={#AppVersion}
AppPublisher=Kovyr
DefaultDirName={autopf}\Kovyr
DefaultGroupName=Kovyr
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=KovyrVaultSetup
SetupIconFile=kovyr.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequiredOverridesAllowed=dialog

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"

[Files]
Source: "..\dist\kovyr-vault-app.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\kovyr-vault.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Kovyr Vault"; Filename: "{app}\kovyr-vault-app.exe"
Name: "{autodesktop}\Kovyr Vault"; Filename: "{app}\kovyr-vault-app.exe"; Tasks: desktopicon

[Registry]
; Double-clicking a .kovyr receipt opens the app targeting that file.
Root: HKA; Subkey: "Software\Classes\.kovyr"; ValueType: string; ValueName: ""; ValueData: "KovyrVaultReceipt"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\KovyrVaultReceipt"; ValueType: string; ValueName: ""; ValueData: "Kovyr Vault Receipt"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\KovyrVaultReceipt\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\kovyr-vault-app.exe,0"
Root: HKA; Subkey: "Software\Classes\KovyrVaultReceipt\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\kovyr-vault-app.exe"" ""%1"""

[Run]
Filename: "{app}\kovyr-vault-app.exe"; Description: "Launch Kovyr Vault"; Flags: nowait postinstall skipifsilent
