<!-- SPDX-License-Identifier: BUSL-1.1 -->

# 排障手册（Top 30）

> 每条：症状 → 原因 → 一条命令/动作。前 10 条也在 README 里。

## 安装与构建

| # | 症状 | 原因 | 解法 |
|---|------|------|------|
| 1 | `npm install` 慢/超时 | 网络或 registry | 换 registry 重试；node 必须 ≥22（`node -v` 先看） |
| 2 | `npm run build` 报 tsc 错误 | TS 严格模式 | 按包逐个 `npm run build --workspace=@phonehands/<包名>` 看具体文件 |
| 3 | `npm test` 某包挂 | 依赖没装完或没编译 | `npm install && npm run build && npm test`，逐包看输出 |
| 4 | doctor 报 node 版本不够 | node < 22 | 升级 node（nvm 或官网安装包） |

## doctor 体检

| # | 症状 | 原因 | 解法 |
|---|------|------|------|
| 5 | usbmuxd FAIL | Mac 没起 usbmuxd 服务 | `brew services start usbmuxd` |
| 6 | Xcode 相关 SKIP | 非 macOS | 正常；iOS 真机链路本来就要 Mac |
| 7 | WDA 签名 FAIL/过期 | 免费 Apple ID 签名 7 天有效期 | `bash scripts/remote-topology/resign.sh`（手机亲手解锁） |
| 8 | tailscale/ssh WARN | 隧道工具缺 | 按需装：自托管走 headscale，兜底走 SSH 反向隧道 |

## API 引擎（Hinge adapter）

| # | 症状 | 原因 | 解法 |
|---|------|------|------|
| 9 | 登录报 412 | 邮箱验证挑战（Hinge 风控） | `submitEmailChallenge()`，按提示去邮箱完成验证 |
| 10 | session 加载被拒绝 | `~/.phonehands/hinge.session.json` 权限被改宽松 | 删掉重登：`rm ~/.phonehands/hinge.session.json` 后 `loginInteractive()` |
| 11 | OTP 提示拒绝运行 | stdin/stdout 不是 TTY（管道/CI 有回显风险） | 在真实终端里跑，不走管道 |
| 12 | 频繁 429 | 被限流 | 内置退避＋honor Retry-After；串行队列默认 800ms 间隔——别自己开并发 |
| 13 | 403 后任务停了 | Router 没切设备引擎？ | 先看 envelope 的 `backend`/`degraded`；三连失败才会标 degraded 触发降级（`capabilities.ts`） |
| 14 | 想调写方法但不存在 | Phase 1 编译期只读 | 设计如此；写走设备引擎（Phase 2） |
| 15 | Google 登录的号登不上 | API 引擎死穴（深研结论） | 走设备引擎真机登录（pause→你本人手机上完成→resume） |

## 设备引擎（iOS / WDA）

| # | 症状 | 原因 | 解法 |
|---|------|------|------|
| 16 | 手机 USB 不识别 | 没点"信任此电脑" | 手机上点信任；Mac 确认 usbmuxd 在跑 |
| 17 | WDA session 建不上 | WDA 没跑起来或签名掉了 | 先 `resign.sh`，再 `setup.sh` 重走 USB 转发 |
| 18 | `observe()` 返回 degraded:true | accessibility 树不可用（自绘 UI 等） | 正常回退：走截图→调用方给归一化框→`screenshotToTapPoint` 映射 |
| 19 | 点的位置偏了 | 截图与逻辑分辨率方向不一致 | `fallback.ts` 会 loud fail（MV427 闭环），检查 `windowSize()` 与截图方向 |
| 20 | 操作超时但不确定执行没 | 网络抖动/手机锁屏 | envelope `evidence.uncertain=true`——**绝不盲重放**，Router/人决定下一步 |
| 21 | 手机锁屏了 | 超出 MVP 范围 | 手动解锁；`DeviceLocked` wake 不在 Phase 1 |

## Android

| # | 症状 | 原因 | 解法 |
|---|------|------|------|
| 22 | agent 连不上手机 | `PHONEHANDS_RELAY_URL` 没配或打不通 | 格式 `ws(s)://host:port/phonehands-android`，见 `packages/android-helper/PROTOCOL.md` |
| 23 | helper APK 没反应 | 无障碍服务/截屏权限没开 | helper App 内按引导逐项开（实现中，真机验证排队） |
| 24 | 跨网连不上 | 中继没打通 | 先同网验证，再配 headscale/SSH 反向隧道 |

## 远程拓扑

| # | 症状 | 原因 | 解法 |
|---|------|------|------|
| 25 | `setup.sh` 卡住 | 某一步 FAIL 没看 | setup 是幂等可重跑的，看第一处 FAIL 行 |
| 26 | `healthcheck.sh` 报 relay FAIL | 走了第三方云中继 | 检查隧道配置；自托管是硬性设计，中继路径验证故意严格 |
| 27 | `test-mock.sh` 挂 | mock 链路逻辑问题 | 提 issue，贴完整输出（先脱敏） |

## 安全与 license

| # | 症状 | 原因 | 解法 |
|---|------|------|------|
| 28 | 日志里看到疑似 token | 脱敏漏了 | 立即按门 5 自查：`grep -rniE "password\|token\|secret\|otp\|auth" --include="*.log"`，提 P0 issue |
| 29 | 不确定某用法算不算商用 | BSL 边界 | 看 `docs/license-faq.md`（Phase 3）；裁决前按"拿不准就先问"处理 |
| 30 | 以上都没覆盖 | — | 按 `.github/ISSUE_TEMPLATE/bug_report.yml` 模板提 issue，贴 doctor 输出（脱敏后） |
