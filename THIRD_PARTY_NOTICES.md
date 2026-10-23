<!-- SPDX-License-Identifier: BUSL-1.1 -->

# THIRD_PARTY_NOTICES — PhoneHands 第三方组件声明

> PhoneHands 本体走 BSL 1.1（pending GC 最终文本）。以下上游组件保留各自 license；
> "状态：待 GC 裁决"的条目，在裁决完成前不随 public release 一起发布。

## 1. appium/WebDriverAgent

- 用途：iPhone 上的 UI 自动化服务；`scripts/remote-topology/setup.sh` 从上游克隆、用用户自己的 Apple ID 在 Xcode 里构建。不 vendored、不改代码。
- License：BSD-3-Clause。
- 来源：https://github.com/appium/WebDriverAgent
- 状态：合规；脚本仅下载构建。

## 2. juanfont/headscale

- 用途：一键远程拓扑的默认隧道——自托管 Tailscale control server；`setup.sh` 装在**用户自己的服务器**上，Mac＋操作端组成 WireGuard mesh。不 vendored、不改代码。
- License：BSD-3-Clause。
- 来源：https://github.com/juanfont/headscale
- 状态：集成方向 Phase 1 已批准；**待 GC 最终裁决**后才随 public release 发布。

## 3. emazaheri/ios-agent

- 用途：`@phonehands/device-backend` 的架构与 WDA 客户端思路来源（`src/wda/transport.ts` 等 4 个文件为改编，保留其 MIT 头＋出处；其余为洁净室重写）。详见 `packages/device-backend/NOTICE.md`。
- License：**MIT（公开页面口径），待 GC 裁决**——页面声明与完整 license 文本已逐字收录在 `packages/device-backend/NOTICE.md`。
- 来源：https://github.com/emazaheri/ios-agent
- 状态：Phase 1 已按"保留声明＋出处"并入，待 GC 追认。

## 4. agentskills 标准

- 用途：`skills/hinge/SKILL.md` 的 frontmatter＋progressive disclosure 规范来源。
- License：Apache-2.0。
- 来源：agentskills 公开规范。
- 状态：仅遵循规范格式，未并入代码。

## 5. go-ios（ucsandman 生态思路）

- 用途：USB 直连 iOS 的工具链思路参考（iPhone Use 深研中的公开技术路线）；**本仓库当前未并入任何 go-ios 代码**。
- License：MIT（公开口径）。
- 来源：公开开源项目（ucsandman 相关生态）。
- 状态：思路参考；若未来并入代码，先走 GC license 裁决。

## 6. 洁净室学习（未并入代码，仅致谢）

- **ucsandman/SideTap**（公开文档）：WDA 签名运维思路（48h 预警、重签全本地、手机亲手解锁）——`resign.sh` 为独立 macOS/Xcode 实现，未抄代码。见 `scripts/remote-topology/NOTICE`。
- **vanxh/instagram-personal-mcp**（license 待核验）：T2 安全模式（写默认拒绝 allowlist、无回显 TTY）——仅学模式，未抄代码；license 兼容性待 GC 裁决。见 `adapters/hinge/README.md`。
- **iPhone Use 深研**：失败语义与发布节奏学习对象，无代码关系。

---

*新增依赖时同步更新本文件（release-sop 机械清单门禁项）。*
