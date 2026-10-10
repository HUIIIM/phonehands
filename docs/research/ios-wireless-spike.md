# iOS 无线研究 Spike：同 WiFi 无线调试 + WDA WiFi 监听

> track: iOS 无线研究轨道（research spike，不阻塞 MVP 主线）
> owner: 无线研究负责人（subagent 63927192-08a4-4576-9cfc-945f04a52b96）
> date: 2026-10-09
> status: 研究启动，结论待真机验证
> evidence_grade: 文档级（公开文档 + 第三方实证；本轨道无 Mac、无真机，零实测）
> redlines: 只用公开文档，不抄任何项目代码；不污染主线 scripts/；所有主张带诚实标注

诚实标注图例（全文统一）：
- [查文档确认] — Apple 官方文档 / 公开技术文档明确写明的
- [第三方实证] — 其他团队公开报告的实测结果（非我方验证）
- [推理] — 由已确认事实推导，未经实测
- [待真机验证] — 必须拿到 Mac + 真机才能确认

---

## 1. 研究问题

- Q1：Xcode 无线调试（"Connect via network"）的精确机制和操作序列是什么？
- Q2：配对记录存在哪？什么会弄断无线连接？
- Q3：WDA 能否脱离 USB、在 WiFi 下被直接驱动？
- Q4：跨网真无线（手机在兜里、Mac 在家里）为什么是墙？墙上有没有门？

---

## 2. Xcode 无线调试机制（同 WiFi）

### 2.1 链路分层 [查文档确认]

```
iPhone ──(1) lockdown 配对 Trust──▶ Mac 信任该设备
  │
  ├─(2) 发现：Bonjour/mDNS（_remotepairing._tcp），同 LAN 广播
  │
  ├─(3) 配对验证：RemotePairing（端到端加密，Apple 自己的协议）
  │
  └─(4) tunnel：CoreDevice tunnel（iOS 17.4+ 走 TCP；17.0–17.3 走 QUIC/UDP）
        tunnel 端口每次动态分配（递增）
        Xcode 的 install / debug / LLDB 全走这条 tunnel
```

要点：
- 无线调试是 Apple 官方机制，Xcode 9 + iOS 11 起引入（WWDC 2017 Session 404 "Cut the Cord"）[查文档确认]
- iOS 16+ 的设备还要求先开 **Developer Mode**（设置 → 隐私与安全性 → 开发者模式，重启确认）[查文档确认]
- iOS 17.4 是一个分水岭：CoreDevice tunnel 从 QUIC/UDP 切到 TCP；17.0–17.3 的 QUIC tunnel 有第三方工具明确不支持 [第三方实证]

### 2.2 精确操作序列 [查文档确认]

**首次配对（必须插线一次）：**
1. iPhone 解锁，用 USB 线连 Mac；iPhone 上点 **Trust**（信任此电脑）
2. iPhone 开 Developer Mode（iOS 16+），按提示重启并确认启用
3. Mac 和 iPhone 连**同一个 WiFi 网络**
4. Xcode → Window → Devices and Simulators (Cmd-Shift-2) → Devices 栏选中该 iPhone
5. 勾选 **Connect via network** → Xcode 执行配对；成功后设备名旁出现**网络图标**
6. 拔掉 USB 线，确认设备仍显示为已配对（网络图标在）

**之后（无线日常）：**
- 只要 Mac 和 iPhone 在同一 LAN，Xcode 自动发现设备，无需插线
- Run / Install / Debug / Instruments / Accessibility Inspector 全部可走无线 [查文档确认]

### 2.3 配对记录存哪

| 记录 | 位置 | 说明 | 标注 |
|---|---|---|---|
| lockdown 配对记录 | `/var/db/lockdown/*.plist`（Mac 系统级，需 root/sudo 读取） | 含 DeviceCertificate、HostCertificate、HostID、RootCertificate、RootPrivateKey、HostPrivateKey、SystemBUID、EscrowBag；删掉 → 下次连接重弹 Trust 对话框 | [查文档确认] |
| 第三方工具自存副本 | `~/.pymobiledevice3/`（如 `remote_<REMOTE-PAIRING-ID>.plist`） | 远程配对记录的自存格式 | [查文档确认] |
| "Connect via network" 勾选状态 | **确切文件未在公开文档中找到** | 由 CoreDevice/`remoted` 内部维护；Xcode UI 是唯一官方切换入口 | [待真机验证：勾选前后 diff `defaults read com.apple.dt.Xcode` + `log stream` 观察] |

### 2.4 断点分析：什么会弄断它

**已文档化的断点** [查文档确认，除非另注]：

1. **不在同一 LAN / AP 客户端隔离** — mDNS 发现包到不了，Xcode 直接看不到设备。这是最常见的"昨天还行今天没了"。
2. **Mac 或手机开了 VPN** — CoreDevice tunnel 进程（`remoted` / `CoreDeviceService`）会被 wedge（卡死）。恢复手段按顺序：杀掉这两个进程 → 重插 USB 等 10 秒 → 开关手机飞行模式 5 秒 → 重启手机 → 最后手段 Xcode 里 Unpair Device 重配。
3. **Mac 睡眠 / WiFi 漫游** — 同上，tunnel 卡死，需手动恢复。
4. **iOS 私有 WiFi 地址（MAC 随机化，iOS 默认开）** — 配对记录靠 WiFiMACAddress 匹配设备，随机化后匹配失败报 "Device is not connected"（pymobiledevice3 v11.16.x 为此修过 bug）。
5. **Xcode 版本 vs iOS 版本不匹配** — DeviceSupport 对不上会报 "Failed to prepare device for development"（Xcode 14.2 + iOS 16.4 有过公开翻车）。
6. **remotepairingd 只在 iPhone 连 WiFi 时监听** — 纯蜂窝网络下无监听入口，Xcode 连不上。例外：先在 WiFi 下建好会话，再打开 设置 → 网络 → **Keep debugging on cellular**（默认关闭），会话可延续到蜂窝 [第三方实证]。
7. **Mac 终端类进程的"本地网络"隐私权限** — macOS 上被拒"本地网络"权限的进程发不出 mDNS 查询，表现为"网络上空无一物"；root 进程豁免 [第三方实证]。
8. **iOS / Xcode 大版本升级后** — 配对可能失效，需重走一次 USB 配对 [推理：社区反复报告，机制上是 DeviceSupport/配对协议变更]。

**待真机验证的断点** [待真机验证]：
- DHCP 租约变化 → WDA 重绑新 IP（影响 WDA 层直连，不影响 Xcode 层）
- 双频合一路由器 2.4G/5G 漫游是否加剧断开
- 低电量模式对 remotepairingd 监听的影响

### 2.5 WDA 在 WiFi 下的监听

- WDA 是跑在 iPhone 上的 **HTTP 服务**：默认设备端口 **8100**（API），**9100**（MJPEG 屏幕流）[查文档确认]
- **WDA 同时绑定 USB 通道和 WiFi 接口 IP** — USB 只是 usbmux 的转发层，不是 WDA 的唯一入口 [第三方实证]
- 同 LAN 下可直接打 `http://<phone-wifi-ip>:8100/status`，无需 usbmux、无需 iproxy；已有团队实证"无 usbmux 直连 WDA，tap + 截图端到端成功" [第三方实证]
- 代价：失去 usbmux 系工具（idevicesyslog、ideviceinstaller、idevicescreenshot、iproxy）；装包改走 `devicectl` [第三方实证]
- **Runner 生命周期**：WDA 只在 `xcodebuild` 的 runner 进程存活时提供服务；手机重启 → runner 死 → 需重起；免费 Apple ID 签名 7 天过期 → runner 失效直到重签（scripts/remote-topology/resign.sh 已覆盖此运维税）[查文档确认]
- **安全警告** [推理]：WDA 的 HTTP 接口**无认证**。USB 下暴露面是 Mac 本机；WiFi 下同网段任何设备都能驱动这台手机。phonehands 无线模式必须默认走自托管 tunnel（SSH 反向优先），绝不把 8100 裸暴露到 LAN，更不许上公网。

### 2.6 对 setup.sh 现状的映射

当前 `scripts/remote-topology/setup.sh`（v0.1.0）的 STEP 5 是 USB 专属：
`idevice_id -l` 找 UDID → `iproxy $WDA_PORT 8100 $UDID` → healthcheck `127.0.0.1:$WDA_PORT`。
无线模式下这一层的替换关系是**一对一**的：

```
USB 模式：   iproxy (usbmux 转发) : 127.0.0.1:$WDA_PORT → <usb>:8100
无线模式：   TCP 转发器           : 127.0.0.1:$WDA_PORT → <phone-wifi-ip>:8100
```

Mac 侧永远只暴露 `127.0.0.1:$WDA_PORT`，tunnel（STEP 6）、endpoint.json、healthcheck.sh **零改动**。这是无线模式设计的 single insight，详见 §5 与 patch 草案。

---

## 3. 跨网真无线：墙与门

### 3.1 为什么是墙 [查文档确认 + 推理]

董事长要的"手机在兜里、身边没电脑、Mac 在家里"跨网真无线，墙有三层：

1. **iOS 沙盒禁后台守护进程** — 第三方 App 进后台会被冻结/终止，无法常驻监听端口。手机在兜里时，设备上**没有活着的 server** 可供连接。这是 Apple 的安全架构，不是 bug，不会"修好"。
2. **remotepairingd 只在 WiFi 下监听** — 纯蜂窝网络下连配对入口都不存在（§2.4 第 6 条）。
3. **WDA runner 需要 Mac 侧有人起** — runner 靠 Mac 上的 `xcodebuild` 进程维持；身边没电脑 = 没人起 runner = WDA 不存在。

结论：**纯软件、零常驻、跨公网直连手机 = 不可能**。phonehands README 不承诺真无线是正确的诚实边界。

### 3.2 墙上的门（已有人走通，待我方验证）

墙是"手机在任意网络、身边无电脑"，门是"把跨网降级成同虚拟 LAN"：

- **门 A：Tailscale 同 tailnet + Bonjour 桥接** [第三方实证]：手机和 Mac 都装 Tailscale（同一 tailnet），Mac 侧桥接程序把 iPhone 的 Bonjour 配对广播"搬运"到 Mac 本地，`remotepairingd` 以为手机在 LAN 上，随后 tunnel 走 Tailscale 传输。有开源项目 5 天前刚更新、公开声明跨网 Xcode 调试跑通（要求：macOS 13+ Apple Silicon 管理员账号、iOS 17.4+、Xcode 15+、手机先连任意 WiFi 建会话）。
- **门 B：WDA-over-tailnet** [推理，待真机验证]：若 WDA 绑定 0.0.0.0（含 tailnet 虚拟网卡），Mac（同 tailnet）可直接打 `http://<phone-tailnet-ip>:8100`，**不需要任何桥接程序**。这是最值得验证的一扇门——如果成立，phonehands 的 device-backend 跨网无线 = "手机装 Tailscale + Mac 侧定时保活 runner"，架构极简。
- 门 B 的剩余代价：仍需 Mac 侧定时任务保活 runner、处理 7 天重签、DHCP/tailnet IP 变化重定向；屏幕流 9100 同理。

### 3.3 对 phonehands 的意义

- MVP 的"一键远程拓扑"（Mac Mini + 备用机固定拓扑）**不受影响**，它是今天就能交付的完整解法。
- 无线模式（同 WiFi）是 P1 加分项：备用机放家里任何位置，不用拴 USB 线。
- 跨网（门 B）是研究轨道持续追踪项，不进 MVP 承诺；社区公开挑战见 `ios-wireless-challenge.md`。

---

## 4. 诚实标注总表

| # | 主张 | 等级 | 来源 |
|---|---|---|---|
| 1 | Xcode 9+/iOS 11+ 支持无线调试，首次需 USB 配对 + 勾选 Connect via network | [查文档确认] | Apple WWDC 2017 S404；Microsoft Learn 无线部署文档 |
| 2 | lockdown 配对记录在 `/var/db/lockdown/*.plist`（需 root） | [查文档确认] | usbmux 技术解析（Medium）+ 第三方配对文档 |
| 3 | iOS 17.4+ CoreDevice tunnel 走 TCP；17.0–17.3 走 QUIC/UDP | [第三方实证] | roamrun README（要求 iOS 17.4+，明确不支持 QUIC 一代） |
| 4 | VPN/睡眠/WiFi 漫游会 wedge CoreDevice tunnel，需杀进程或重配 | [查文档确认] | 第三方排障手册（ON_DEVICE_INSTALL.md） |
| 5 | iOS 私有 WiFi 地址（MAC 随机化）会破坏配对记录匹配 | [查文档确认] | pymobiledevice3 v11.16.0/16.1 release notes |
| 6 | remotepairingd 只在 WiFi 下监听；纯蜂窝不行（除非 Keep debugging on cellular） | [第三方实证] | roamrun README |
| 7 | WDA 绑 WiFi IP，可无 usbmux 直连 phone-ip:8100 并 tap/截图 | [第三方实证] | viktorbarzin/infra commit（端到端验证声明） |
| 8 | WDA HTTP 无认证；WiFi 暴露 = 同网段可驱动 | [推理] | WDA 协议公开事实 + 安全常识 |
| 9 | 跨网真无线三堵墙：沙盒禁后台进程 / remotepairingd 只听 WiFi / runner 需 Mac 侧起 | [查文档确认+推理] | Apple 平台架构 + §2 机制 |
| 10 | Tailscale 同 tailnet 可桥接跨网 Xcode 调试 | [第三方实证] | roamrun README + zjz-connect 项目 README |
| 11 | WDA-over-tailnet 直连 phone-tailnet-ip:8100 可行 | [待真机验证] | 由 7+8 推导，未见公开实证 |
| 12 | "Connect via network" 勾选状态的确切存储文件 | [待真机验证] | 公开文档未找到 |

---

## 5. setup.sh --wireless 模式升级方案（摘要）

目标：**首次插线配对，之后无线**。设计约束：不碰现有 USB 路径（默认行为零变化）；tunnel/endpoint/healthcheck 层零改动；secrets 政策不变（脚本永不经手 Apple ID）。

1. **新增 CLI**：`--wireless` + `--phone-ip IP`（或 `PHONEHANDS_PHONE_IP`）；`--wireless` 且无 IP 时报错并提示获取方法（iPhone 设置 → 无线局域网 → (i) → IP 地址；或 `dns-sd -B _remotepairing._tcp`）。
2. **STEP 4（签名）追加手动步**：现有"Xcode Product → Test"之后，加一步 Xcode 勾选 **Connect via network**（Xcode UI 操作，脚本做不到也不碰；DEPLOY.md 写给弟弟看的操作序列见 §2.2）。
3. **STEP 5（转发）替换**：USB 的 `iproxy` 换成轻量 TCP 转发器（`127.0.0.1:$WDA_PORT → $PHONE_IP:8100`，python socket 或 socat；mock 模式已有同构代码可参照思路，不抄实现）。无 iproxy 依赖。
4. **STEP 6（tunnel）不变**；endpoint.json 新增 `"mode": "wireless"` + `"phone_ip"` 字段。
5. **resign.sh 需无线变体**：当前 `idevice_id -l` 只看得到 USB 设备；无线下改用 `xcrun devicectl list devices` 找无线设备，`xcodebuild -destination id=$UDID` 本身支持无线目标（Xcode 配对已建好）。
6. **安全门**：`--wireless` 必须配合 tunnel（默认 SSH 反向）；若用户显式 `--tunnel-mode mock` 之类裸奔组合，脚本拒绝并说明 WDA 无认证风险。
7. **验收**：拔线后 `healthcheck.sh --endpoint 127.0.0.1:$WDA_PORT` 通过；手机换 DHCP IP 后脚本能报错指引重设（不断言自动发现，v1 不做 mDNS 自动发现）。

完整 patch 草案（含插入点、代码草案、验收清单）见 `setup-sh-wireless-patch-draft.md`。**本草案未应用到 scripts/，需 scripts 包评审 + 真机验证后才可合入。**

---

## 6. 核心发现（3 条）

1. **同 WiFi 无线是 Apple 官方机制**（Xcode 9+/iOS 11+；iOS 17.4+ 走 TCP CoreDevice tunnel），配对记录在 `/var/db/lockdown`，断点集中在 mDNS 可见性、VPN、睡眠/漫游——phonehands 出 `--wireless` 模式技术上可行，且 tunnel 层零改动。
2. **WDA 不依赖 USB**：它绑定手机 WiFi IP，同 LAN 可直连 `phone-ip:8100`（第三方已实证 tap+截图），USB 只是转发层。无线模式 = 换转发源，下游全部复用。
3. **跨网真无线仍是墙**（沙盒禁后台进程 + remotepairingd 只听 WiFi + runner 需 Mac 侧起），但 Tailscale 把"跨网"降级为"同虚拟 LAN"：跨网 Xcode 调试已有开源实证；WDA-over-tailnet 是最值得验证的一扇门，进社区公开挑战。

## 7. 必须真机验证的清单

- [ ] V1：同 WiFi 下 `curl http://<phone-ip>:8100/status` 是否 200（WDA 绑 WiFi IP 的直接验证）
- [ ] V2：`http://<phone-ip>:9100` MJPEG 流同 WiFi 可达性
- [ ] V3：拔线后 Xcode "Connect via network" 配对的稳定性（24h 保活观察；记录断开时的恢复手段）
- [ ] V4：手机 DHCP IP 变化后，WDA 是否重绑新 IP（viktorbarzin 称会，需复现）
- [ ] V5：Mac 睡眠唤醒后，无线 WDA 链路是否自恢复（对照 §2.4 断点 2/3）
- [ ] V6：WDA-over-tailnet——手机+Mac 同 tailnet 时 `http://<phone-tailnet-ip>:8100/status` 可达性（门 B 核心验证）
- [ ] V7：无线下 `xcodebuild -destination id=<UDID> test` 能否重签/重起 runner（resign.sh 无线变体前置）
- [ ] V8："Connect via network" 勾选状态的存储位置（勾选前后 diff）
- [ ] V9：iOS 私有 WiFi 地址开启 vs 关闭对无线配对成功率的影响

---

## Sources（本研究引用的公开文档）

- Apple WWDC 2017 Session 404（via wwdc-journal 分析）：https://github.com/need2edit/wwdc-journal/blob/HEAD/analysis-2017/xcode9-developer-tools.md
- Microsoft Learn《Wireless deployment for .NET MAUI iOS apps》：https://learn.microsoft.com/et-ee/dotnet/maui/ios/wireless-deployment?view=net-maui-8.0
- usbmux / lockdown 配对机制解析：https://medium.com/@godwinjoseph.k/usbmux-the-magic-daemon-2b0cb2f60c20
- bryanrg22/ios-agent_automation《usb-to-wireless-journey》（lockdownd 5 步配对）：https://github.com/bryanrg22/ios-agent_automation/blob/HEAD/docs/usb-to-wireless-journey.md
- pymobiledevice3 v11.16.x release notes（MAC 随机化 / 本地网络权限 / mobdev2）：https://github.com/doronz88/pymobiledevice3/releases/tag/v11.16.3
- viktorbarzin/infra《drive the phone over Wi-Fi, not usbmuxd》（WDA 绑 WiFi IP 实证）：https://github.com/viktorbarzin/infra/commit/15aed67c8852087a2382dfd17f61fb02f9137f6e
- mh-mobile/roamrun（Tailscale 跨网 Xcode 调试）：https://github.com/mh-mobile/roamrun
- zjz-connect/xcode-deploy-link（RemotePairing over Tailscale 部署）：https://github.com/zjz-connect/xcode-deploy-link-deploy-beyond-local-network/blob/HEAD/README.md
- lebonhommepharma/natural《ON_DEVICE_INSTALL》（CoreDevice tunnel wedge 排障）：https://github.com/lebonhommepharma/natural/blob/HEAD/Docs/ON_DEVICE_INSTALL.md
- minitap-ai/mobile-use《ios-physical-device》（无线连接操作序列）：https://github.com/minitap-ai/mobile-use/blob/HEAD/skills/mobile-use-setup/references/ios-physical-device.md

*注：以上均为机制学习引用，未复制任何项目代码。*
