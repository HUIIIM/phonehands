<!-- SPDX-License-Identifier: BUSL-1.1 (pending GC final review) -->

# 5 分钟上手 PhoneHands

> 前置：node 22+、npm、git。目标：本机 mock 全链跑通，知道真机还需要什么。

## 第 1 分钟：体检

```bash
bash scripts/phonehands-doctor.sh
```

只读，不改系统。FAIL 行会直接给修复命令（比如缺 usbmuxd、node 版本不够）。

## 第 2–3 分钟：装＋编＋测

```bash
npm install
npm run build
npm test
```

全 workspace 测试都要绿。mock 测试（mock WDA、mock Hinge server、mock 隧道）**永远只碰 127.0.0.1**，不会连你的真实账号。

## 第 4 分钟：看"API 死了，任务没死"

```bash
cd examples/dual-demo && npm test
```

场景：先读 20 条 matches（API 引擎，毫秒级）→ 注入一个 403 → 设备引擎自动接管。
看输出里的 `backend` 和 `degraded` 字段——这就是 Router 的降级语义。

## 第 5 分钟：决定下一步

| 你想干嘛 | 看这里 |
|----------|--------|
| 真机 iOS | `scripts/remote-topology/DEPLOY.md`（需要 Mac＋Xcode＋USB iPhone，WDA 用你自己的 Apple ID 签名） |
| 真机 Android | `packages/android-helper/PROTOCOL.md`（helper APK 侧载＋`PHONEHANDS_RELAY_URL`；实现中，真机验证排队） |
| 写 Hinge 以外的 adapter | `docs/architecture.md` 的 adapter 开发指南 |
| 出问题了 | [troubleshooting.md](./troubleshooting.md)（Top 30） |

## 三条红线（现在就记住）

1. **只操作你自己的账号**——不做批量、不做代运营工具。
2. **密码/验证码永不进文件和日志**——OTP 只走无回显 TTY 提示。
3. **iOS 跨网真无线不承诺**——那是苹果的墙；iOS 走 Mac＋备用机固定拓扑。
