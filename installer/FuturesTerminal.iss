; Inno Setup — 期界 PyWebView 桌面版安装包
; 需安装 Inno Setup 6: https://jrsoftware.org/isinfo.php
; 先运行 build_desktop_exe.bat 生成 dist\FuturesTerminal\

#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif

#define MyAppName "期界期货交易终端"
#define MyAppPublisher "Futures Gateway"
#define MyAppExeName "FuturesTerminal.exe"

#ifexist "..\assets\icon.ico"
#define MyAppIcon "..\assets\icon.ico"
#endif

[Languages]
Name: "chinesesimp"; MessagesFile: "languages\ChineseSimplified.isl"

[Setup]
AppId={{A7B3C9E1-4F2D-4A8B-9C1E-Desktop-PyWebView}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\FuturesTerminal
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist\installer
OutputBaseFilename=FuturesTerminal-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
#ifdef MyAppIcon
SetupIconFile={#MyAppIcon}
UninstallDisplayIcon={app}\{#MyAppExeName}
#endif

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标:"; Flags: unchecked

[Files]
Source: "..\dist\FuturesTerminal\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\config.json.example"; DestDir: "{app}"; Flags: ignoreversion
; 不覆盖用户已有 config.json / flow
Source: "..\config.json.example"; DestDir: "{app}"; DestName: "config.json"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\账号配置"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--setup"
Name: "{group}\检查更新"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--check-update"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\flow"
Type: files; Name: "{app}\gateway.log"
