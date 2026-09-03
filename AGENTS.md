# futures-gateway · Agent 说明

## 桌面版发版

用户说 **发版 / 发布 / release / 教你发版** 时，必须先阅读并执行：

**`skills/desktop-release/SKILL.md`**

不要让用户自己记命令；按 skill 里的四步流程自动完成（升版本 → 打包 → OSS → GitHub Release）。

## 敏感文件

- 勿提交 `config.json`、`oss_release.env`

## 开发时重启桌面客户端

改完 **web/** 前端：用户点 **刷新** 或 **F5** 即可，不必重启。

需要重启整程序时（改了 **gateway/**、**desktop/** 等 Python），**必须**用：

```bat
restart_desktop.bat
```

或 `powershell -File scripts/restart_desktop.ps1`

**禁止**手动 taskkill 后再 Start-Process，也**禁止**按路径误杀「非 .venv」的 python 进程（Windows 下 venv 常会显示两条 pythonw，实为同一实例；误杀会导致只关不启）。
