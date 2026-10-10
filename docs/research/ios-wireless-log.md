# iOS 无线研究 · 同步日志

> 轨道：phonehands iOS 无线研究 spike（不阻塞 MVP 主线）
> 节奏：每周五一条；有突破性发现可加急一条
> 每条格式：日期 / 本周进展 / 结论变化 / 下周计划 / 阻塞
> 诚实原则：无真机=无实测，所有"验证"类表述必须说明验证主体（我方/第三方/待验证）

---

## 2026-10-09（周五）—— 研究启动

**本周进展：**
- 研究轨道开工。啃完公开文档，完成三份交付：
  - `ios-wireless-spike.md`：Xcode 无线调试机制（首次 USB 配对 → Connect via network → 同 LAN 无线）+ WDA WiFi 监听 + 断点分析 + 跨网墙/门分析 + 真机验证清单（V1–V9）
  - `setup-sh-wireless-patch-draft.md`：`setup.sh --wireless` 模式 patch 草案（DRAFT，未应用，需 scripts 包评审）
  - `ios-wireless-challenge.md`：社区公开挑战文案（供发布日进 README §10）
- 关键机制结论（文档级，待真机验证）：
  1. 同 WiFi 无线是 Apple 官方机制（Xcode 9+/iOS 11+；iOS 17.4+ 走 TCP CoreDevice tunnel）；配对记录在 Mac `/var/db/lockdown/*.plist`；"Connect via network" 勾选状态的确切存储文件未在公开文档中找到
  2. WDA 不依赖 USB：绑定手机 WiFi IP，同 LAN 可直连 `phone-ip:8100`（第三方已实证 tap+截图）；phonehands 无线模式 = 只换 STEP 5 转发源，tunnel/endpoint/healthcheck 层零改动
  3. 跨网真无线三堵墙：iOS 沙盒禁后台守护进程 / remotepairingd 只在 WiFi 下监听 / WDA runner 需 Mac 侧 xcodebuild 维持。门：Tailscale 同 tailnet 降级成"同虚拟 LAN"（跨网 Xcode 调试已有开源实证）；WDA-over-tailnet 是最值得验证的一扇门

**结论变化：**
- 本轨道启动前口径是"真无线不承诺"；现修正为"真无线不承诺，但同 WiFi 无线可行、跨网有门可追"——MVP 的"一键远程拓扑"承诺不变，无线是 P1 加分项，不进 MVP 验收

**下周计划：**
- 等硬件：Mac Mini + 备用 iPhone 到位（一键包待董事长批，花钱事项）后，按 spike §7 清单 V1–V9 逐项真机验证
- scripts 包评审 patch 草案（评审结论记入下条日志）

**阻塞：**
- 无 Mac、无真机，本周零实测。所有 V1–V9 待硬件到位
- patch 草案未合入 scripts/（by design，等评审）
