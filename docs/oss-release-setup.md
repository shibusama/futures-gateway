# 阿里云 OSS 发版配置（国内加速下载）

GitHub Release 作版本记录；安装包与自动更新走 OSS。

## 一、你需要在阿里云控制台做的（约 10 分钟）

### 1. 开通 OSS

1. 登录 https://www.aliyun.com ，完成实名认证
2. 控制台搜索 **对象存储 OSS** → **立即开通** → 计费选 **按量付费**

### 2. 创建 Bucket

| 项 | 建议值 |
|----|--------|
| Bucket 名称 | 全局唯一，如 `shibusama-futures`（记下此名） |
| 地域 | **华东1（杭州）** 或离用户近的 |
| 存储类型 | 标准存储 |
| 读写权限 | **公共读**（仅放安装包） |
| 其他 | 默认 |

创建后在 Bucket **概览** 复制 **外网访问 Endpoint**，形如：
`oss-cn-hangzhou.aliyuncs.com`

### 3. 创建 RAM 子账号 AccessKey（推荐，勿用主账号）

1. 控制台 → **访问控制 RAM** → **用户** → **创建用户**
2. 勾选 **OpenAPI 调用访问**，创建后保存 **AccessKey ID** 和 **Secret**
3. 给用户授权：**AliyunOSSFullAccess**（或自定义仅该 Bucket 的 PutObject/GetObject）

把 AccessKey 发给我或自行填入 `oss_release.env`（**不要提交 git**）。

### 4. 告诉我这 5 项

```
AccessKey ID:     LTAI...
AccessKey Secret: （私密，仅填 env 文件）
Bucket 名:        例如 shibusama-futures
Endpoint:         例如 oss-cn-hangzhou.aliyuncs.com
地域:             例如 华东1杭州
```

## 二、本地发版流程（配置好后）

```bat
build_desktop_release.bat
pip install oss2
python scripts/publish_oss_release.py --notes "1.0.8 修复行情崩溃"
```

脚本会上传 zip + `update_manifest.json`，并提示把 `UPDATE_MANIFEST_URL` 写入 `app_version.py`。

然后重新打包一次 exe（让内置更新地址生效），再打 GitHub Release：

```bat
git tag desktop-v1.0.8
git push origin desktop-v1.0.8
gh release create desktop-v1.0.8 dist/FuturesTerminal-win64.zip ...
```

Release 说明里加一行：**国内下载** → OSS zip 直链。

## 三、费用参考

- 存 100MB 安装包：约 **0.01 元/月**
- 100 次下载（50MB/次）：约 **2–3 元** 流量
- 新用户有 OSS 试用额度

## 四、安全

- `oss_release.env` 已加入 `.gitignore`
- 不要用主账号 AccessKey
- Bucket 只放公开安装包，不要放 config.json 或密钥
