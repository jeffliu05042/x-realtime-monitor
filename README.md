# X Realtime Monitor

[![CI](https://github.com/jeffliu05042/x-realtime-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/jeffliu05042/x-realtime-monitor/actions/workflows/ci.yml)

一个免费、本地运行的 X（原 Twitter）账号监控器。它使用电脑上已经安装的 Chrome、Edge 或 Firefox 和一个独立登录目录，按顺序检查 1–10 个公开账号，并将新增帖子写入 JSONL 和 JSON 文件。

它不需要 X API key，也不会调用付费模型。代价是：这是一种非官方浏览器自动化方案，受 X 页面结构、风控及服务条款变化影响，不能承诺持续可用或秒级实时。

## 能做什么

- 一次人工登录，后续在同一专用浏览器目录中无人值守运行
- 每 120–300 秒轮询 1–10 个账号
- 单浏览器会话依次访问账号，避免同时打开大量页面
- 过滤转发，可选择是否保留回复
- 根据帖子 ID 跨轮询去重
- 追加写入 `posts.jsonl`，原子更新 `latest.json` 和 `state.json`
- 遇到登录失效或账号验证时立即停止，不尝试绕过验证码
- 页面显示自动翻译时，尽量从浏览器已经收到的 X GraphQL 响应恢复原文；无法确认原文时跳过该账号本轮数据

## 环境要求

- macOS，或 64 位 Windows 10/11
- Node.js 22.12.0 或更高版本
- 已安装 Chrome、Edge 或 Firefox。建议优先使用 Chrome 或 Edge
- 一个可以正常访问并登录 X 的网络环境

项目会在 GitHub Actions 的 macOS 和 Windows 环境中执行完整的 lint、类型检查和测试。浏览器登录与 X 页面访问依赖本机网络和账号状态，仍需在实际电脑上完成首次登录验证。

## 安装

```bash
git clone https://github.com/jeffliu05042/x-realtime-monitor.git
cd x-realtime-monitor
npm ci
```

macOS / Linux shell：

```bash
cp config.example.json config.json
```

Windows PowerShell：

```powershell
Copy-Item config.example.json config.json
```

打开 `config.json`：

1. 将 `accounts` 改成要关注的 X 用户名，可以带或不带 `@`，最多 10 个。
2. 阅读下方风险说明后，将 `browserAutomationRiskAccepted` 改为 `true`。
3. 默认每 120 秒检查一次；允许范围为 120–300 秒。

## 使用

先检查配置和浏览器路径，不会打开浏览器或访问 X：

```bash
node bin/x-monitor.js doctor --config config.json
```

第一次使用时建立专用登录会话：

```bash
node bin/x-monitor.js login --config config.json
```

浏览器打开后，手动完成登录和 X 要求的任何验证。确认已经显示 X 首页，再回到终端按 Enter。登录凭据只保存在配置指定的 `data/browser-profile` 中，程序不会读取或导出密码。

单次检查：

```bash
node bin/x-monitor.js check --config config.json
```

持续监控：

```bash
node bin/x-monitor.js run --config config.json
```

按 `Ctrl+C` 可安全停止。若希望开机运行，可在 macOS 的 `launchd` 或 Windows“任务计划程序”中执行上面的 `run` 命令；电脑必须保持开机、联网，并且专用 X 会话仍然有效。Windows“任务计划程序”强制结束进程时可能没有机会完成优雅退出，但已写入的 JSON 数据不会因此被清空。

也可以执行 `npm link`，之后把 `node bin/x-monitor.js` 简写成 `x-monitor`。

## 配置说明

```json
{
  "accounts": ["OpenAI"],
  "pollIntervalSeconds": 120,
  "fetchLimitPerAccount": 10,
  "includeReplies": false,
  "lookbackMinutes": 30,
  "browser": {
    "type": "auto",
    "executablePath": null,
    "profileDirectory": "data/browser-profile"
  },
  "output": {
    "directory": "data",
    "latestLimit": 200
  },
  "browserAutomationRiskAccepted": true
}
```

- `browser.type`：`auto`、`chrome`、`edge` 或 `firefox`。
- `browser.executablePath`：自动识别失败时填写浏览器可执行文件的绝对路径。
- `lookbackMinutes`：每轮只接收这个时间窗口内的帖子，避免首次运行导入大量旧内容。
- `latestLimit`：`latest.json` 最多保留的最新记录数。
- 所有相对路径都以 `config.json` 所在目录为基准。

不要让普通 Chrome/Edge 与本程序同时使用同一个浏览器资料目录。默认配置使用独立目录，不会触碰日常浏览器配置。

Windows 自动识别 Chrome、Edge 和 Firefox 的默认安装路径；若浏览器安装在自定义位置，请在 `browser.executablePath` 中填写完整路径，例如 `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`。

## 本地数据接口

默认输出到 `data/`：

- `posts.jsonl`：只追加的完整事件流，一行一个 JSON 对象，适合其他程序增量读取。
- `latest.json`：最新记录数组，按新到旧排列；通过临时文件替换方式更新，适合轮询读取。
- `state.json`：内部去重状态，不应作为业务接口修改。

单条记录示例：

```json
{
  "schema_version": 1,
  "source": "x_browser",
  "captured_at": "2026-08-11T02:30:00.000Z",
  "id": "1950000000000000001",
  "url": "https://x.com/example/status/1950000000000000001",
  "text": "Market update",
  "created_at": "2026-08-11T02:29:00.000Z",
  "author": { "username": "example" },
  "public_metrics": { "replies": 0, "reposts": 0, "likes": 0, "views": 0 },
  "is_reply": false,
  "is_repost": false
}
```

下游应用可以持续读取 `posts.jsonl`，也可以定时读取 `latest.json`。未来增加 HTTP 接口时，可以直接以这两个稳定文件为数据源，无需改变采集模块。

## “实时”的实际含义

本项目采用短轮询，不是 X 的服务器推送。默认最坏发现延迟约为 2 分钟加上 10 个账号的页面加载时间。降低到 120 秒已经是本项目允许的最短间隔；更激进的请求频率更容易触发限流或验证。

若出现以下错误，持续任务会停止：

- `X_LOGIN_REQUIRED`：运行 `login` 重新登录。
- `X_CHALLENGE_REQUIRED`：运行 `login`，在可见浏览器中人工完成验证。

程序不会自动点击验证码、复用隐蔽指纹或规避 X 的安全措施。

## 风险与合规

浏览器自动采集可能受到 [X 服务条款](https://x.com/en/tos)及所在地区规则约束，也可能导致限流、验证或账号限制。请只处理你有权访问的公开信息，控制频率，并自行判断是否适合使用。`browserAutomationRiskAccepted` 的显式开关用于防止在未阅读风险时误启动自动化。

浏览器目录包含登录 cookie，应像密码一样保护；`data/` 和 `config.json` 已被 Git 忽略。不要把它们提交或共享。

## 开发与检查

```bash
npm run check
```

浏览器控制基于 [Puppeteer](https://pptr.dev/)。架构思路参考了 [Tibo-monitor-Test](https://github.com/MizuIro-H/Tibo-monitor-Test)，但没有复制其未授权源码；本项目从头实现并采用 MIT License。
