<!-- SPDX-License-Identifier: BUSL-1.1 -->

# PhoneHands 更新记录

> 每条 release 正文三段式：**改了什么**（用户语言）→ **验证**（测试证据）→ **升级指引**（用户要做什么）。
> 不为凑数发版；commit message 不直接当 changelog。

---

## v0.1.0（未发布）

**改了什么**
- 独立评估修复（2026-10-26）：core 队列 deadline 与认证超时计时器不再 `unref`，超时承诺在短进程里也会兑现（core 测试 44/44，原先 8 个被取消）；新增 push/PR CI；Android relay 绑非 loopback 地址时必须配 token，加 hello 超时与消息大小上限；SSH 反向隧道默认只绑服务器 `127.0.0.1`；headscale 固定版本并校验 sha256；Android helper 明文 `ws://` 只放行 loopback 与 tailnet 域名；日志脱敏补上 Cookie / Basic / JWT / 手机号；zod 升到 4.6.7；workflow 全部按 SHA 固定并声明最小权限。
- 独立评估收尾（2026-10-27）：只读构建同时去掉 `launch_app` / `press_home`（所有写级动作都不存在）；observe 不再上传密码框内容；已存在的 `~/.phonehands` 收紧到 0700；构建标志文件不再写时间戳（构建不再弄脏工作区）；headscale 配置模板和入网命令对齐 v0.29（`dns:`、`noise.private_key_path`、按用户 ID 发 key、`hskey-auth-` 新格式）；Android helper 构建脚本改为 `.gradle.kts`（原文件是 Kotlin DSL 语法），CI 新增 APK 编译；新增 SECURITY.md、CODEOWNERS。
- 真机级端到端（2026-10-30）：CI 在 Android 模拟器上安装真实 helper APK 并经真实 relay 驱动 observe / launch / tap / swipe / screenshot（`android-emulator.yml`）；在 Linux runner 上用 `headscale-server-install.sh` / `headscale-mint-key.sh` 装真实 headscale v0.29.6 并让真实 Tailscale 客户端入网（`headscale-e2e.yml`）。顺带修复 helper 三个 bug：动作与连接共用单线程导致动作永不执行；无投屏授权时仍声明 mediaProjection 前台服务类型（Android 14 会崩）；设置页不能填 relay URL / token。headscale CLI 改用 `sudo -n`（socket 属 root）。
- 双引擎骨架立起来了：`@phonehands/core` 统一 Action 接口＋Router＋结果 envelope＋串行队列（读/写/降级演示三例可跑）。
- API 引擎（快的那只手）：Hinge 读 adapter 上线——点赞、匹配、聊天消息毫秒级结构化 JSON；只读是编译期锁死的，写方法在构建里根本不存在。
- 设备引擎（真的那只手）：WDA 纯 HTTP 客户端——点按、滑动、输入、截图、读 accessibility 树；树读不出来自动截图回退；不确定绝不重放。
- Android 那只手：手机主动向外连 agent（WebSocket），无须 USB、无须同局域网——Kotlin helper APK 源码＋协议已冻结，真机验证排队中。
- 一键远程拓扑：Mac 侧 `setup.sh` 一条命令把备用 iPhone 变成远程端点；`healthcheck.sh` 自带中继路径验证，第三方云中继直接判 FAIL。
- `phonehands-doctor.sh`：环境只读体检，哪项 FAIL 直接给修复命令。

**验证**
- `npm test` 全 workspace 绿：core（含 Router 故障注入：API 403/超时/空返回三件套）、api-backend（30+ 用例）、device-backend（mock WDA）、hinge-adapter（mock Hinge server，真实网络零触碰）、android-backend（协议/中继/e2e mock）。
- `bash scripts/remote-topology/test-mock.sh`：10 passed，0 failed。
- 门 4 真机复测：PENDING（blocker：一键远程拓扑＋备用机就绪），mock 证据齐全。

**升级指引**
- 这是首个版本，无升级动作。装完跑 `bash scripts/phonehands-doctor.sh` 确认环境，再 `npm run build && npm test`。
