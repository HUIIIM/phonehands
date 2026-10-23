<!-- SPDX-License-Identifier: BUSL-1.1 -->

# PhoneHands 更新记录

> 每条 release 正文三段式：**改了什么**（用户语言）→ **验证**（测试证据）→ **升级指引**（用户要做什么）。
> 不为凑数发版；commit message 不直接当 changelog。

---

## v0.1.0（未发布）

**改了什么**
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
