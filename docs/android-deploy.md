# PhoneHands Android 部署文档

<!-- SPDX-License-Identifier: BUSL-1.1 -->

> 面向备用 Android 手机的部署说明。按本文走完，一部手机变成 agent 的
> 无线手。所有"依据"列在每节末尾 —— 门 3（文档即契约）：写"支持 X"
> 就必须有测 X 的用例或官方文档出处。

---

## 0. 中继架构（与 iOS 路径互补）

PhoneHands 是双引擎框架，Router 按 `devicePlatform` 调度：

| 路径 | 方向 | 链路 | devicePlatform |
|---|---|---|---|
| **Android**（本包） | 手机 → agent | 手机主动拨出 WebSocket 到自托管 relay（`PHONEHANDS_RELAY_URL`） | `android` |
| **iOS**（device-backend） | agent → 手机 | agent → SSH 反向隧道 → Mac → USB/WDA | `ios` |

- Android 路径不需要手机与 agent 同局域网、不需要 USB、不需要端口
  转发 —— 手机在 NAT/移动数据后也能连。这是真无线（iOS 沙盒禁后台
  守护进程，行业级无解；Android 允许前台服务常驻，故可解）。
- iOS 路径是"操作侧无线"：Mac Mini + 备用机固定拓扑，agent 经 SSH
  隧道连 Mac，再走 USB 到手机。
- **零第三方云**：两条路径的屏幕与指令都只经过你自己的机器
  （relay 跑在你自己的服务器/SSH 隧道/Tailscale 内）。与 TapKit 类
  云中继（屏幕过第三方服务器）的差异是架构级的，见主 README
  「诚实边界」。

### 环境变量迁移说明

- 旧名 `DUALTAP_RELAY_URL` 已废弃（项目更名 PhoneHands，董事长拍板）。
- 新名 **`PHONEHANDS_RELAY_URL`**，格式 `ws(s)://host:port/path`，
  默认 `ws://127.0.0.1:9011/phonehands-android`。
- agent 侧（`@phonehands/android-backend`）与手机侧（helper APK 设置页）
  读**同一个值**：手机拨什么，agent 就得监听什么。
- 路径 kind（healthcheck 用）：`PHONEHANDS_RELAY_PATH` 可强制指定
  `direct | ssh-tunnel | tailscale`；不指定时按 host 推断
  （loopback→direct，`*.ts.net`/100.x→tailscale）。
- healthcheck 统一 schema（与 iOS 侧对齐）：
  `{ relay, reachable, latency_ms, path }`，
  path ∈ `ssh-tunnel | tailscale | direct | usb`（Android 永不输出 `usb`）。

---

## 1. 权限申请步骤

在备用机上安装 `phonehands-android-helper` APK 后，按 App 内 4 步走：

### 1.1 无障碍服务（手势执行）

- 路径：设置 → 无障碍 → PhoneHands → 打开开关。
- 说明：Android 不提供 API 以编程方式开启无障碍服务，
  必须用户亲手拨开关（防恶意软件的设计）。
- 作用：`dispatchGesture` 做 tap / swipe（Phase 2 加 type）。
- 依据：[`AccessibilityService`](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)；
  手势分发 [`dispatchGesture`](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#dispatchGesture(android.accessibilityservice.GestureDescription,%20java.util.concurrent.Executor,%20android.accessibilityservice.AccessibilityService.GestureResultCallback))。

### 1.2 投屏授权（屏幕流）

- App 内点"允许投屏" → 系统弹一次性授权对话框 → 允许。
- 作用：`MediaProjection` + `ImageReader` 抓帧 → 下采样 360px JPEG → ~1fps 推流；
  `screenshot` 动作返回最新一帧（`frame_age_ms` 告诉 agent 新鲜度）。
- **诚实声明**：投屏授权 token 只活在内存里，进程死掉或重启后失效，
  Android 没有任何合法途径持久化它 —— 每次重启后需要重新点一次
  "允许投屏"。这是平台限制，不是我们的 bug。
- 依据：[`MediaProjectionManager.createScreenCaptureIntent()`](https://developer.android.com/reference/android/media/projection/MediaProjectionManager#createScreenCaptureIntent())；
  [`MediaProjection`](https://developer.android.com/reference/android/media/projection/MediaProjection)。

### 1.3 电池优化白名单（保活）

- App 内点"关闭电池优化" → 系统确认页 → 允许。
- 作用：让 Doze/应用待机不掐前台服务的 socket。
  不做这一步，灭屏一段时间后 WebSocket 会被系统杀掉，手机"掉线"。
- 依据：[`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`](https://developer.android.com/reference/android/provider/Settings#ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)；
  Doze 与应用待机说明 [Doze](https://developer.android.com/training/monitoring-device-state/doze-standby)。

### 1.4 通知权限（Android 13+）

- 首次启动前台服务时系统会弹通知权限请求，允许即可。
- 前台服务必须挂常驻通知（"PhoneHands agent running"），这是
  Android 的前台服务规范，不是可选项。
- 依据：[前台服务](https://developer.android.com/develop/guide/components/foreground-services)；
  [通知运行时权限](https://developer.android.com/develop/ui/views/notifications/notification-permission)；
  Android 14 起投屏类前台服务须声明
  `FOREGROUND_SERVICE_MEDIA_PROJECTION` 类型（[14 行为变更](https://developer.android.com/about/versions/14/changes/fgs-types-required)）。

---

## 2. 保活策略

| 手段 | 说明 | 依据 |
|---|---|---|
| 前台服务 | `AgentService` 以 `mediaProjection\|dataSync` 类型常驻，进程优先级最高档 | [前台服务](https://developer.android.com/develop/guide/components/foreground-services) |
| 指数退避重连 | 断线后 2s→60s 退避重拨，同一 `device_id`（服务端按 ID 去重，不会双计数） | mock 集成测试 `reconnect with same device_id`（`tests/e2e.test.ts`） |
| 心跳 | agent 每 30s 发 `ping`，手机回 `pong`；90s 无活动服务端掐线 | 服务端 `keepaliveSweep`，单测覆盖超时掐线逻辑 |
| Partial WakeLock | 抓帧期间持有（12h 上限，服务重启重拿），灭屏也能推流 | `PowerManager` 常识；真机复测门（门 4）验证 |
| 电池白名单 | 见 1.3；各厂商"后台弹出/自启动"还需在厂商管家里放行（小米/华为/OV 有各自的"自启动管理"） | 厂商文档（机型相关，部署时按真机补） |

**Doze 的诚实说明**：白名单解决的是"系统级 Doze 杀 socket"；
厂商深度定制（MIUI/Harmony 的激进后台清理）可能仍需在厂商设置里
手动放行。备用机建议长期插电 + 关自动系统更新。

---

## 3. 中继部署（手机 → agent 的三种拓扑）

relay 就是 `@phonehands/android-backend` 的 `AndroidRelayServer`，
默认监听 `127.0.0.1:9011`。

| 拓扑 | `PHONEHANDS_RELAY_URL`（手机填） | 说明 |
|---|---|---|
| 本机联调 | `ws://127.0.0.1:9011/phonehands-android` | USB 连电脑后 `adb reverse tcp:9011 tcp:9011`，手机的 127.0.0.1 就是电脑的 relay |
| SSH 反向隧道 | `wss://<跳板机域名>/phonehands-android` | 手机在外网：跳板机 `ssh -R 127.0.0.1:9011:localhost:9011 agent-box`，跳板机上 Nginx 终止 TLS 再转发到 `127.0.0.1:9011` |
| Tailscale | `ws://<agent 的 MagicDNS 名>.ts.net:9011/phonehands-android` | 两端进同一个 tailnet，WireGuard 端到端加密，不走公网（headscale 用 `<名>.phonehands.tailnet`） |

- 手机端明文 `ws://` 只放行 `127.0.0.1` / `localhost` / `*.ts.net` / `*.phonehands.tailnet`
  （`app/src/main/res/xml/network_security_config.xml`）；其它地址（局域网 IP、公网域名、tailnet 的 100.x IP 字面量）一律要 `wss://`，否则 Android 直接拒连。
- 跨公网一律用 `wss://`（TLS 终止在你自己的反向代理/Nginx）。
- relay 只要不是绑在 loopback（`bindHost` ≠ `127.0.0.1` / `::1` / `localhost`），**必须**配 `authToken`，否则 `AndroidRelayServer` 构造时直接报错拒绝启动。
- 共享密钥：agent 侧 `authToken`（loopback 上可选，其它地址必填），手机设置页填同样的 token；
  对不上服务端直接掐线（4403）。token 只走 `hello` 消息体，
  **永不进 URL、永不打日志**（门 5 有单测断言）。

---

## 4. 无线 ADB 备用路径（APK 不可用时）

当前台服务/APK 路走不通（比如备用机是不能装 APK 的特殊 ROM），
降级用无线 ADB直控。**这是文档化的备用钩子，不是默认路径。**

```bash
# 手机：开发者选项 → 无线调试 → 用配对码配对
adb pair <手机ip>:<配对端口>     # 输入 6 位配对码
adb connect <手机ip>:5555        # 无线调试页显示的端口

# 之后这四条就是 agent 的手（命令形状有单测锁定）：
adb -s <手机ip>:5555 shell input tap 540 1200
adb -s <手机ip>:5555 shell input swipe 100 200 300 400 300
adb -s <手机ip>:5555 exec-out screencap -p > screen.png
adb -s <手机ip>:5555 shell monkey -p com.example.app -c android.intent.category.LAUNCHER 1
```

- 无 root 要求；同一局域网（或 Tailscale IP）可用。
- 依据：[无线 ADB 官方文档](https://developer.android.com/tools/adb#wireless)。
- 代码钩子：`packages/android-backend/src/wireless-adb.ts`
  （只拼命令、不自动执行 —— 主路径永远是 WebSocket APK）。

---

## 5. Shizuku（可选增强，非必需）

- [Shizuku](https://shizuku.rikka.app/) 让普通 App 经用户一次性授权后
  调用高权限 API。我们的 APK 用标准无障碍 + 投屏 API 已覆盖
  MVP 全部动作，**不需要 Shizuku**。
- 可选场景：Phase 2 需要读系统级状态（如精确前台包名、免 root
  的 `appops` 调整）时再引入。引入前按门 3 补测试与文档。

---

## 6. 安全

- relay 默认只绑 `127.0.0.1`；要让手机从外网拨进来，前面必须有
  SSH 隧道或 Tailscale（第 3 节），不要直接把 9011 暴露到公网。
- token 校验在服务端做常量时间比较；日志里只记 present/absent。
- 认证屏（密码/验证码/指纹）走 pause/resume：APK 永远收不到凭据，
  人在手机上亲自完成 —— 与 iPhone Use 同一条铁律。
- 超时/断线的不确定手势**不自动重放**：先 `observe` 看清状态再决策
  （故障注入单测：`silent phone -> tap times out as UNCERTAIN`）。

---

## 7. claim → 证据对照表（门 3）

| 文档 claim | 证据 |
|---|---|
| tap/swipe/screenshot/launch/observe 可做 | `tests/e2e.test.ts` 五个端到端用例 |
| 手机主动拨出、NAT 后可连 | 架构：phone→agent 单向建连；e2e 用 mock 复现建连 |
| 断线重连不双计数 | `reconnect with same device_id` 用例 |
| token 错被拒绝、对进被接受 | `auth: wrong token is rejected` 用例 |
| 超时手势标 uncertain 不重放 | `silent phone -> tap times out as UNCERTAIN` 用例 |
| healthcheck 输出统一 schema | `healthcheck: unified schema` 用例；demo 末尾打印 |
| 坐标系为绝对像素 | `tap scaled to device px` 断言（180/360→540） |
| 无障碍/投屏/前台服务/电池白名单行为 | 上方各节官方文档链接 |
| 投屏重启后需重新授权 | Android 平台限制（MediaProjection 文档）；代码只内存持有 token |

**未验证项（诚实标注）**：APK 尚未编译（本机无 Android SDK，
见交付报告；Phase 2 用 CI 解决）；真机复测待备用机就绪（门 4 PENDING）。
