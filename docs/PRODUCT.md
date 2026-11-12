<!-- SPDX-License-Identifier: MIT -->

# PhoneHands — 产品一页纸

> 状态：Phase 1 · early（mock 验证通过；真实 APK / 真实 headscale 端到端在 CI 中验证；物理真机复测待门 4b）· 版本：0.1.0（未发布）· 更新：2026-11-03
> 所属：[vertciti](https://vertciti.com) — 一家公司，一个人生。

## 一句话
做手机 agent 的开发者用它，把"调 App 接口"和"在真机上点屏"放在同一个 Action 接口后面；接口失效时任务自动切到真机继续完成，结果里如实写明走了哪条路。

## 解决什么问题
- **痛点**：agent 读数据最快的办法是调 App 的私有 HTTP 接口，但 App 一更新、一风控（403 / 429）就失效。失效常在夜里或周末发生，agent 整条任务停摆，要人来修。
- **现在的替代做法**：
  - 纯接口方案（各类 App 的非官方 API / MCP）：快，但一失效就全停。
  - 纯真机方案（Appium / WDA 脚本、各家 phone-use agent）：稳，但每一步都慢、贵。
  - 两套都写的团队要自己维护切换逻辑，降级往往悄悄发生，上层不知道数据其实来自另一条路。

## 给谁
- **首要用户**：写手机自动化 agent 的开发者（第一个适配器是 Hinge，只读）。
- **不是给谁**：
  - 想操作别人账号、批量养号、绕过平台风控的人：只操作你自己的账号，写操作默认不存在。
  - 想要托管 SaaS 的人：这是自托管的库和脚本，没有托管服务。

## 怎么用（三步）
1. `npm install && npm run build && npm test`：不需要手机，跑通构建、全部 mock 测试和降级演示（`examples/dual-demo`）。
2. 接设备：
   - iOS：Mac + USB iPhone，跑 `scripts/remote-topology/setup.sh`。
   - Android：装 helper APK，填 relay URL / token。
3. 在 agent 里用 `@phonehands/core` 的 Router 调 `read` / `observe` / `tap` 等动作。API 失效时自动切设备引擎，每个结果都带 `backend`、`degraded` 字段。

## 为什么是我们（差异化）
| 维度 | PhoneHands | 常见替代 |
|---|---|---|
| 失效处理 | Router 自动从 API 切到真机，结果里标 `degraded:true` | 失效即停，或悄悄换路 |
| 写操作安全 | 编译期只读开关：只读构建里所有写级动作在代码中不存在（测试断言） | 运行时开关，可被绕过 |
| 不确定输入 | 超时的写操作标 `uncertain`，**绝不自动重放** | 常见做法是盲目重试，可能重复发送 |
| 远程拓扑 | 自托管（headscale / SSH），WDA 默认只绑 loopback | 多依赖第三方云中继 |
| 凭据 | 框架不经手密码 / 验证码；session 文件 0600、原子写、schema 校验 | 常把 token 写进日志或明文配置 |

## 证据
- **测试**：每次 push / PR 都跑 `ci.yml`：tsc 构建、Biome lint、7 个工作区的 mock 测试、只读构建测试、`npm audit`、Android helper APK 编译。
- **真实运行**：
  - `android-emulator.yml`：真实 helper APK 装在 Android 系统上，经真实 relay 跑 observe / launch / tap / swipe 全部断言。
  - `headscale-e2e.yml`：真实 headscale v0.29.6 + 真实 Tailscale 客户端入网。
  - `ios-simulator.yml`：真实 WDA 协议链。
  - 降级录屏：`docs/assets/phonehands-demo-v2.gif`（本地服务 + mock 数据）。
- **不能证明的**：
  - 物理真机（厂商 ROM 的后台限制、真实移动网络）尚未复测（门 4b）。
  - Hinge 适配器只用 mock 服务测试过，没有对真实 Hinge 线上接口做持续验证。
  - 带 TLS 的真实服务器上，headscale 自带 DERP 的分支未验证。

## 边界与风险
- **不做**：
  - API 写操作（Phase 2）。
  - 微信类自绘 UI 的精准定位。
  - iOS 跨网真无线（受苹果平台限制）。
  - MCP 服务（目前没有）。
- **已知限制**：
  - 免费 Apple ID 签名 7 天过期，需要重签。
  - Android 仅手势模式下没有截图（需投屏授权）。
  - `http://` 控制面时 headscale 中转走 Tailscale 公共 DERP（只转发加密包，但能看到 IP）。
- **安全与隐私**：
  - 数据只在用户自己的机器和自己的服务器上；零埋点（[ANALYTICS.md](../ANALYTICS.md)）。
  - session 存在 `~/.phonehands/`（0700 目录，0600 文件），删除该目录即清除。
  - 漏洞私下报告见 [SECURITY.md](../SECURITY.md)。
- **平台条款**：API 引擎用逆向的 HTTP 客户端，处于平台服务条款的灰色地带；只用于你自己的账号。

## 与其他 vertciti 产品的组合
- **上游**：agent / 编排层（如 Jarvis）通过 `@phonehands/core` 的 Action 接口驱动手机。PhoneHands 只负责可靠地"读到 / 点到"，不做决策。
- **下游**：每个结果的 `backend` / `degraded` / `evidence` 字段可直接进入调用方的审计或可观测系统。降级事件是可消费的信号，不是日志噪音。

## 路线图
| 阶段 | 内容 | 退出标准 |
|---|---|---|
| Now（Phase 1） | 双引擎 + Router 降级、Hinge 只读适配器、iOS / Android 设备引擎、自托管远程拓扑、CI 内真实 APK / headscale 端到端 | 全部 CI 绿；门 4b 物理真机复测通过 |
| Next（Phase 2） | 写操作（默认关闭 + 白名单）、Android 输入法 / 文本输入、更多适配器 | 写操作有"旧红新绿"回归测试；只读构建仍无任何写级动作 |
| Later（Phase 3） | MCP 服务形态、多设备调度 | 对外发布 v1.0，带 SBOM 与签名产物 |

## 衡量指标
- **北极星**：任务完成率。API 失效时，任务仍由设备引擎完成的比例（目标 ≥ 95%，按 `degraded:true` 且 `ok:true` 统计）。
- **护栏**：
  - 未经标记的降级 = 0。
  - 不确定写操作被自动重放 = 0。
  - 日志 / 证据中的凭据泄漏 = 0（测试断言）。
  - CI 在 `main` 上保持全绿。
