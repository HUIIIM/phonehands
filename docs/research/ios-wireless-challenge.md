# Open Challenge: True Wireless iOS — Phone in Your Pocket, Mac at Home

> status: 草案，供 phonehands 发布日进 README §10（未解问题共研）
> bounty: 贡献者榜单 + 商业授权分成意向（随 BSL 1.1 最终文本由 GC 确认）
> redlines: 只做自己设备的方案；不抄任何项目代码；ToS 灰色地带必须诚实声明

---

## The challenge (one sentence)

Make an agent drive a **real iPhone over the real internet** — phone in your pocket on cellular,
Mac at home — with no USB cable, no same-WiFi requirement, and no third-party cloud in the middle.

## Why it's a wall (not a todo)

Three layers, all architectural — this is not a bug Apple will "fix":

1. **iOS sandbox bans background daemons.** A third-party app cannot keep a listening
   socket alive once it's backgrounded. When the phone is in your pocket, there is
   **no server on the device** to connect to. This is Apple's security architecture.
2. **The pairing listener only listens on Wi-Fi.** The daemon that accepts developer
   pairings over the network does not listen on cellular at all. On pure cellular,
   there isn't even a door — let alone an open one.
3. **The automation runner needs a Mac-side process.** WebDriverAgent only serves while
   a Mac-side `xcodebuild` runner keeps it alive. No computer nearby = nobody starts
   the runner = nothing to drive.

Anyone promising "true wireless, no computer needed, just works" today is selling you
a cloud relay (your screen goes through their servers) or a jailbreak. We promise
neither. That's why this is a *challenge*, not a roadmap item.

## Doors in the wall (what's already known)

The wall is "phone on any network, no computer around". The doors downgrade
"any network" to "same virtual LAN":

- **Door A — same tailnet + Bonjour bridging.** Put Tailscale on both the phone and the
  Mac. A small bridge on the Mac re-publishes the iPhone's pairing broadcast locally,
  the Mac thinks the phone is on the LAN, and the developer tunnel rides the tailnet.
  Cross-network Xcode debugging this way is publicly demonstrated by third parties.
- **Door B — WDA-over-tailnet (unverified, most interesting).** WebDriverAgent binds the
  phone's Wi-Fi IP and answers plain HTTP on port 8100 with no dependency on USB.
  *If* it also binds the tailnet interface, the Mac could drive
  `http://<phone-tailnet-ip>:8100` directly — no bridge, no USB, no LAN.
  Nobody has publicly verified this yet. That's the experiment we're inviting.

## What a solution looks like (acceptance)

A credible solution must demonstrate, on video + reproducible steps:

1. iPhone on **cellular only** (Wi-Fi off), in a different city from the Mac
2. Agent performs: launch app → tap → type → screenshot, end to end
3. **No third-party cloud** touches screen or commands (self-hosted only — this is
   non-negotiable for phonehands; TapKit-style relays don't count)
4. Setup reproducible by a single developer in ≤ 30 minutes, documented
5. Honest failure modes documented (what breaks it, how to recover)
6. ToS posture stated up front: whose device, whose account, what Apple policies apply

Partial credit explicitly welcome: a verified Door B experiment (even if it fails —
negative results with methodology count) earns a place on the leaderboard.

## How to participate

- Open a Discussion / PR against this repo with `[challenge-wireless]` in the title
- Include: setup steps, demo video (≤ 60s), failure-mode notes, and a signed statement
  that the work is your own (no copied code — mechanism learning is fine, code copying isn't)
- Maintainers reproduce on our rig (Mac Mini + spare iPhone, fixed topology) before listing

## Bounty

- **Leaderboard**: permanent "Wall-breakers" section in README, ranked by verification date
- **Commercial license revenue share**: contributors of accepted solutions are offered a
  share of phonehands commercial licensing revenue attributable to wireless operation
  (intent; final terms in the BSL 1.1 legal text, GC to confirm)
- **Co-authorship** of the resulting `docs/research/ios-wireless-breakthrough.md`

---

## 中文摘要

**公开挑战：iOS 跨网真无线**——手机在兜里（纯蜂窝、异地）、Mac 在家里，无 USB、无同 WiFi、无第三方云中转，让 agent 驱动真机。

**为什么是墙**：iOS 沙盒禁后台守护进程（兜里无 server）/ 配对监听只在 WiFi 下 / WDA runner 需 Mac 侧进程维持——三层都是架构级，不是 bug。

**已知的门**：Tailscale 同 tailnet 把"跨网"降级为"同虚拟 LAN"（跨网 Xcode 调试已有第三方实证）；**WDA-over-tailnet**（直连 `phone-tailnet-ip:8100`，无桥接）最值得验证，尚无公开实证——这正是我们邀请的实验。

**解法验收**：纯蜂窝异地真机端到端操作（开 App/点/输/截图）+ 可复现步骤 + 诚实故障模式 + 自托管（屏幕指令不过第三方云）+ ToS 声明。阴性结果（方法学完整）同样上榜。

**参与**：Discussion/PR 标题带 `[challenge-wireless]`，附步骤+60 秒内 demo 视频+原创声明；我们在固定拓扑 rig 上复现后上榜。

**悬赏**：README "破墙者"永久榜单 + 无线能力带来的商业授权收入分成意向（最终以 BSL 1.1 法律文本、GC 确认为准）+ 突破文档联署。
