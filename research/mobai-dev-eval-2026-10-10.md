# mobai-dev 技术评估：打假"Linux 沙盒构建 iOS"

> 董事长 X 帖（@interlap01，2026-10-10）："I don't need a spare Mac mini to build iOS apps from my phone anymore. Cursor and Claude cloud agents can build, test, and ship entire iOS apps from Linux sandboxes already included in my subscriptions."
> 仓库：github.com/MobAI-App/mobai-dev — "Everything a coding agent needs to build iOS apps from a Linux sandbox"
> 评估：只读＋最小实测（binary 下载运行），未注册任何账号、未花钱。D461 24h 内。
> 结论前置：**部分证伪。Mac 没有消失，只是变成了别人的 Mac，按分钟计费。**

---

## 一、真实性

| 项 | 实证 |
|---|---|
| 仓库存在 | ✅ MobAI-App/mobai-dev 真实存在 |
| star/fork | 97 / 7（6 周大，2026-08-31 创建，2026-10-07 有 push）——早期小项目 |
| license | 源码 MIT；**binary 另签专有许可**（LICENSE-BINARY.md，© 2026 Interlap，禁逆向/禁改） |
| 引擎仓库 | MobAI-App/ios-builder，1157 stars，Go，2026-10-10 当天有 push——相对成熟 |
| 发帖人身份 | ⚠️ **@interlap01 = Interlap = binary 版权方 = 卖家**。X 帖是供应商营销，非中立用户体验 |
| binary 可运行 | ✅ 实测：v1.3.4 `mobai-dev_linux_amd64`（85MB）在 x86_64 Linux 上下载运行，`--help` 正常（命令：preview/build/sign/sim/release/upload/submit 等 20+） |
| preview 引擎 | ⛔ 未实测：`engines install` 要求 MobAI 账号（免费但需邮箱验证码注册），未注册 |

## 二、技术原理：Mac 藏在哪

逐环节拆（全部来自仓库 README/docs 实证，非推断）：

| 环节 | 在哪跑 | 是否需要 Mac |
|---|---|---|
| **Preview**（SwiftUI/RN/Flutter 手机尺寸预览） | 纯 Linux | ❌ 不需要。原理：web 渲染近似（RN 走 react-native-web 类方案）＋ adapters/mocks 目录替换原生模块（camera/maps/权限等全 mock）。**是"长得像"，不是真 iOS runtime** |
| **Build**（编译 IPA） | **GitHub Actions macOS runner**（或 Codemagic/Bitrise） | ✅ **要——GitHub 的 Mac**。README 原话："A sandbox has no Xcode, so iOS builds run on a macOS runner in CI"。ios-builder 架构图：`builder ios build` → push 快照 → **macOS 上 Xcode 编译** → 回传 IPA。Linux 零编译 |
| **Simulator** | macOS runner（MobAI CI Devices） | ✅ 要——GitHub 的 Mac |
| **Sign**（签名） | 两种：① 你的证书+provisioning profile 进 CI secrets（证书需在 Mac 或 Apple 后台生成）；② `mobai-dev sign` 用 Apple ID + 2FA（免费 Apple ID = **7 天 profile，3 个 App——和我们已知的 7 天重签是同一个坑**） | ① 间接要 ② 不要但 7 天过期 |
| **Publish**（TestFlight/上架） | App Store Connect API | ❌ 不需要 Mac（上传环节） |
| **Drive physical phone**（真机驱动） | 他们的 MobAI 桌面 app + tailnet + 账号 | ❌ 不需要 Mac，但**供应商锁定**：免费 1 台，Pro $9.99/月多设备 |

**一句话：agent 坐在 Linux 里，编译坐在 GitHub 的 Mac 上。**

## 三、X 说法的逐句打假

1. "I don't need a spare Mac mini to build iOS apps" —— **窄义成立**。"不用买 Mac"这件事在 mobai-dev 出现之前就是真的（GitHub Actions/Codemagic/Bitrise 存在多年）。它的贡献是把这套东西打包成 coding agent 一句话能调的工具链，不是发明了无 Mac 编译。

2. "from Linux sandboxes **already included in my subscriptions**" —— **误导**。macOS CI 分钟**不在** Cursor/Claude 订阅里，是 GitHub/Codemagic/Bitrise 的账单：
   - 公开仓库：GitHub Actions 免费无限（真免费）
   - 私有仓库：Free 套餐 2000 min/月，**macOS 10x 系数 → 约 200 个 macOS 分钟** ≈ 13 次 15 分钟构建；超了 $0.08/分钟（一次构建 $1.20）
   - Apple Developer $99/年（TestFlight/上架，省不掉）
   - MobAI Pro $9.99/月（多设备真机驱动才要）

3. 真正的新东西：**agent-oriented 的 preview**（semantic tree 给 agent 读、按 label 点按、mock 世界一句话造 unhappy path）＋ 全链路一句话集成。这是 DX 创新，不是编译创新。

## 四、对我们决策的影响

### ① Mac mini 采购：不能省，继续走
- vphone-cli PoC 要的是**物理 Apple Silicon + Recovery 改 SIP**，云 CI 跑不了。mobai-dev 和它是两个正交问题，互不替代。
- PhoneHands 要的是**真机自动化**（Hinge），mobai-dev 的 preview/simulator 替代不了真机；它的真机驱动走 MobAI 供应商通道，不符合我们"自主可控"要求。
- 我们当前**没有"发布 iOS App"的需求**——mobai-dev 解决的是我们没有的问题。

### ② PhoneHands iOS 自动化链路：无直接帮助
mobai-dev 为"开发自家 App"设计，不是为"自动化第三方 App"。真机驱动依赖其桌面 app + 账号体系，引入供应商锁定，收益为零。

### ③ vphone-cli PoC：无影响
继续按原计划（备用 Mac 上纯能力 PoC，不碰真实账号）。

### ④ 未来有用（记入知识库，不行动）
- 哪天给 Miao 做 iOS companion App：直接用 ios-builder 的 GitHub Actions 模式（公开仓库免费），不用为构建买 Mac mini。
- **值得偷的思想**：preview 的 agent-oriented 设计（semantic tree + mock 世界 + 按 label 驱动）——Miao 将来做移动端 UI 迭代时可借鉴思路，与 DIL（ChatGPT Intelligent UI）方向同构。

## 五、风险清单

- 供应商锁定：binary 闭源禁逆向；engine 下载要账号；真机驱动要 app + Pro 订阅
- 项目早期：主仓 97 stars，6 周大；X 帖是卖家自荐
- 免费 Apple ID 签名 7 天过期——坑还在，只是换了个位置

## 六、结论

- ** verdict：部分证伪，不采用。**
- X claim 的诚实版本应该是："我不用**自己买** Mac mini 了，GitHub 的 Mac 按分钟租给我，agent 坐在 Linux 里指挥。"
- Mac mini 采购决策**不受影响**，继续走一键包。
- ios-builder CI 模式记入知识库（未来 iOS 发版用）；preview 的 agent-oriented 思想转 Miao 团队学习。

---
*实证文件：binary 实测（/tmp/mobai-dev，v1.3.4，x86_64 可运行）；README/ios-builder README 原文；GitHub API（repo/release/pricing）；MobAI pricing 页（Pro $9.99/mo）。X 原帖未独立拉取（oembed 被拒），引用董事长转述版本。*
