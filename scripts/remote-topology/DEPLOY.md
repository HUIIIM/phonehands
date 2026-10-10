# PhoneHands 一键远程拓扑 · 部署手册

> 给部署者看的：按顺序一步一步做，每一步都有"预期看到什么"和"卡住怎么办"。
> 全程约 30 分钟。唯一需要你亲手点的只有 **1 步**（在 Xcode 里点一下签名）。

## 这是什么

一台 Mac 连着一部 iPhone，跑一条命令之后，远端（比如云端的 AI）就能通过**你自己的**加密通道操作这部手机。
屏幕画面和操作指令**不经过任何第三方公司的服务器**——这是我们和 TapKit 这类云中继方案最大的区别。

```
远端操作者 ──加密通道──> 你自己的中继 ──> Mac ──USB线──> iPhone(WDA)
              (headscale/SSH, 都是你自己的)
```

## 你需要准备的东西

| # | 东西 | 说明 |
|---|---|---|
| 1 | 一台 Mac | macOS，能上网 |
| 2 | 一部备用 iPhone | 不是你的主力机；系统 iOS 16+ |
| 3 | 一根数据线 | Mac 连 iPhone |
| 4 | 一个 Apple ID | 免费的就行（后面有付费版说明）；**脚本永远不会问你要密码** |
| 5 | 一台你自己的服务器（可选但推荐） | 用来装 headscale（自托管组网的大脑）；没有的话先看"如果卡住怎么办" |

> 花钱事项：一台 Mac Mini + 一部备用 iPhone 的预算走一键包审批（董事长批）。
> 下面步骤里**没有任何一步会花钱**。

## 总览：脚本替你做什么

运行 `setup.sh` 后，它会自动做 6 件事：

1. **体检**：检查环境缺什么（缺了会告诉你一条命令装上）
2. **装依赖**：装 node、python 等工具（装之前会先问你）
3. **下 WDA**：下载苹果官方测试框架 WebDriverAgent（操作手机的"手"）
4. **签名（唯一手点）**：在 Xcode 里选你的 Apple ID 点一下 Product → Test
5. **连手机**：Mac 通过 USB 连上 iPhone 的 WDA
6. **起通道**：headscale 自托管组网（默认）→ 输出远程操作端点 → 自动健康检查

## 步骤详解

### 第 0 步：打开终端，进到脚本目录

```bash
cd ~/workspace/phonehands/scripts/remote-topology
```

**预期看到什么**：`ls` 能看到 `setup.sh`、`healthcheck.sh`、`resign.sh`、`DEPLOY.md` 这些文件。

**如果卡住怎么办**：找不到目录 → 问给你这份手册的人要正确路径。

### 第 1 步：先体检（只检查，不改任何东西）

```bash
../phonehands-doctor.sh
```

**预期看到什么**：一行一行 `[PASS]` / `[WARN]`。`[SKIP]` 是正常的（Linux 才有的检查）。
如果有 `[FAIL]`，每一行下面都有一行 `fix:`，照着那条命令做就行。

**如果卡住怎么办**：

- `node` FAIL → Mac 上跑 `brew install node`
- `xcode` FAIL → 去 Mac App Store 安装 Xcode（完整版，不是只有命令行工具），装完跑 `sudo xcode-select -s /Applications/Xcode.app`
- `usbmuxd` WARN → `brew install libimobiledevice`

### 第 2 步：一键部署

```bash
./setup.sh
```

**预期看到什么**（按顺序）：

1. 体检又跑一遍 → 全 PASS（或只有 WARN）
2. 问你"Install with Homebrew? [y/N]" → 输 `y` 回车（装依赖）
3. 下载 WebDriverAgent → `WDA source ready`
4. **停下来等你**：屏幕上出现一个大框框，告诉你去 Xcode 里点签名（见下一步）
5. 你按回车后：检测到 iPhone → `WDA answering on 127.0.0.1:8100`
6. 起 headscale 通道 → 输出 `PHONEHANDS_RELAY_URL=ws://...` → 两次健康检查都 `PASS`

最后你会看到：

```
Remote operation endpoint: 100.x.x.x:8100        ← 远端就用这个地址
PHONEHANDS_RELAY_URL:         ws://100.x.x.x:8100/   ← 远端 export 这个变量
```

**把这两行发给远端操作的人**（比如云端 AI 的负责人）。注意：这是能操作你手机的入口，**只发给自己人，不要发到网上**。

**如果卡住怎么办**：

- `no iPhone detected` → 线没插好 / 手机没解锁 / 没点"信任此电脑"；重插、解锁、点信任，重跑（脚本可重跑，不会搞坏东西）
- `headscale needs a control-server URL` → 你还没准备服务器；两种走法：
  - 有服务器：`export PHONEHANDS_SSH_TUNNEL_HOST=你的用户名@你的服务器地址`，重跑（脚本会自动在你服务器上装 headscale，会先问你）
  - 没服务器：用 SSH 腿 `export PHONEHANDS_SSH_TUNNEL_HOST=... ./setup.sh --tunnel-mode ssh`，或临时用官方版 `./setup.sh --use-tailscale-official`（需要你去 tailscale.com 注册登录，数据不过他们服务器但账号是他们的——只是临时方案）
- `tailscale up failed` → 服务器上的 headscale 没起来；让懂技术的人看服务器上 `sudo systemctl status headscale`

### 第 3 步：签名（全程唯一需要你亲手点的一步）

脚本会在第 4 步停下来，屏幕上写清楚了 5 个小步骤，照做：

1. iPhone 解锁，插线连 Mac，点"信任"
2. iPhone 开：设置 → 隐私与安全性 → 开发者模式（开了要重启一次）
3. Mac 上打开 Xcode，打开 `~/.phonehands/WebDriverAgent/WebDriverAgent.xcodeproj`
4. 选 `WebDriverAgentRunner` → Signing & Capabilities → Team 选你的 Apple ID（免费 Personal Team 就行）
5. 菜单 Product → Test；**手机全程保持解锁**

做完回到终端按回车，脚本会自动验证。

**如果卡住怎么办**：

- Xcode 报错 signing / provisioning → Team 没选对；确认选的是你自己的 Apple ID，不是别人的
- `WDA not answering` → 手机锁屏了 / Product → Test 没跑起来；解锁手机，Xcode 里重新 Product → Test
- **记住：任何人以任何理由问你要 Apple ID 密码，都是骗子。脚本永远不会问。**

### 第 4 步：验证远端能连上（在远端那台机器上跑）

```bash
export PHONEHANDS_RELAY_URL='ws://100.x.x.x:8100/'   # 第 2 步输出的那行，原样粘
./healthcheck.sh
```

**预期看到什么**：JSON 里 `"reachable": true`，最后打印 `healthcheck PASS`。

**如果卡住怎么办**：`"reachable": false` → 看 JSON 里 `relay_check.note` 写的原因；常见是 Mac 睡眠了（Mac 设置 → 电池 → 防止睡眠），或手机 USB 松了。

---

## 签名 7 天过期（重要，必读）

免费 Apple ID 签的 WDA **每 7 天过期一次**，过期后手机上的 WDA 打不开，远端就连不上了。
这是苹果的规矩，谁也绕不过，只能定期重签（约 2 分钟）。

### 每周检查一次

```bash
./resign.sh --check
```

**预期看到什么**：

- `87h remaining — healthy.` → 不用管
- `only 30h left (<= 48h warning window).` → 48 小时内会过期，准备重签
- `EXPIRED` → 已经过期，马上重签

### 一键重签

```bash
./resign.sh --resign
```

脚本会先让你**亲手解锁手机**（iOS 规定：锁屏手机不许装东西，脚本变不了），
然后自动重签、重装、验证。成功后会打印新的过期时间。

**建议**：在 Mac 上加个每周定时提醒（日历 / cron），跑 `--check` 看一眼。
示例 cron（每周一早上 9 点检查）：

```bash
0 9 * * 1 /path/to/remote-topology/resign.sh --check
```

**诚实说明**：苹果把每次重签都算在原来那个 7 天窗口里——没过期就重签**不会**把时钟延长。
所以 48 小时预警是提醒你"快到期了"，真正有效的重签发生在**过期当时/之后**，命令是同一个。

### 付费开发者账号路径（想省事就看这节）

| | 免费 Apple ID | 付费开发者账号 |
|---|---|---|
| 费用 | ¥0 | **$99 / 年**（约人民币 700+，按汇率） |
| 签名有效期 | 7 天 | **约 1 年** |
| 适合谁 | 先跑起来验证、预算还没批 | 长期 7×24 跑、不想每周惦记重签 |

**怎么换**：去 [developer.apple.com](https://developer.apple.com) 注册付费账号（$99/年，**这是花钱事项，走审批**），
然后把上面"第 3 步：签名"重新做一遍，Team 选你的付费团队。之后 `resign.sh` 照常用，
它会自动识别出你是 1 年有效期（会显示 `paid-style`）。

---

## 中继架构（技术节，非技术人员可跳过）

```
iOS 路径：   agent ──> SSH 隧道/自托管 headscale ──> Mac ──USB/WiFi──> WDA ──> iPhone
Android 路径：agent <── WebSocket ── 自托管 agent（手机直连，无云）
```

- 两条路径**互补**：iOS 那边 Mac 就是中继（苹果生态只能这样），Android 那边 helper 直连自托管中继。
- Router 按 `deviceType` 调度：`ios` 走上面的 iOS 链，`android` 走 WebSocket 链。
- 两边用**同一套**中继约定和健康检查 JSON（见下），方便 Router 统一解析：
  - 环境变量 `PHONEHANDS_RELAY_URL`，两种格式：
    - `ssh://user@host:port` —— SSH 反向隧道（自托管中继）
    - `ws(s)://host:port/path` —— 直连（headscale 组网 / 官方 Tailscale 兜底 / Android WS）
  - 健康检查统一输出：`{relay, reachable, latency_ms, path}`，
    其中 `path` 是 `ssh-tunnel` / `headscale` / `tailscale` / `direct` / `usb` 之一。
- **更名迁移说明**（2026-10-09）：项目由 dualtap 更名为 PhoneHands，
  所有 `DUALTAP_*` 环境变量已改为 `PHONEHANDS_*`（如 `PHONEHANDS_RELAY_URL`），
  旧变量名**不再支持**——请把之前 export 过的旧变量改掉。状态目录也由 `~/.dualtap/` 改为 `~/.phonehands/`。

## 为什么自托管（数据主权故事）

手机屏幕是最敏感的数据。市面上有两类做法：

- **TapKit（云中继）**：你的手机屏幕画面要先经过**他们公司的服务器**，再到 AI 那里。方便，但屏幕内容出过第三方。
- **iPhone Use（纯 USB）**：数据不出你的电脑，但 AI 必须和手机在同一台电脑跟前，没法远程。

我们的做法：**连组网的大脑（coordination server）都是你自己的**。

- 默认走 **headscale 自托管**：你在自己服务器上跑一个 headscale（开源，BSD-3），
  Mac 和远端操作机组成 WireGuard 加密 mesh——协调服务器是你的，数据通道是端到端加密的，
  第三方连"谁在跟谁说话"都看不到。
- 第二条腿 **SSH 反向隧道**：连 mesh 都不想搭时，一条 SSH 命令把端口反向打到你自己的服务器，
  照样不经过第三方。

### headscale vs 官方 Tailscale 功能差

| 功能 | headscale（自托管，默认） | 官方 Tailscale（`--use-tailscale-official` 兜底） |
|---|---|---|
| WireGuard mesh 组网 | 有 | 有 |
| MagicDNS（名字代替 IP） | 有（`phonehands-mac.phonehands.tailnet`） | 有 |
| ACL 访问控制 | 有（policy 文件） | 有（管理后台点选） |
| 节点注册 | pre-auth key（脚本自动办） | 浏览器登录点一下 |
| 管理后台 | 无官方后台（有第三方开源面板） | 有 |
| DERP 中转 | 默认关（纯直连；NAT 复杂环境可自建） | 官方 DERP 全球节点 |
| 数据/账号经过第三方 | **零** | 登录与协调走 Tailscale 账号体系 |

**一句话**：headscale 把"方便"换成了"主权"。长期跑，选 headscale；临时顶一下，用官方版。

### 切换命令

```bash
./setup.sh                                # 默认：headscale 自托管
./setup.sh --tunnel-mode ssh              # 切到 SSH 反向隧道腿（需 PHONEHANDS_SSH_TUNNEL_HOST）
./setup.sh --use-tailscale-official       # 临时兜底：官方 Tailscale（需 tailscale up 登录）
```

三种模式输出的 `PHONEHANDS_RELAY_URL` 格式一样，远端不用改代码。

---

## 安全提醒（必读）

1. `PHONEHANDS_RELAY_URL` 和 endpoint 地址 = **能操作你手机的钥匙**。只给自己人，不发群、不发网。
2. 脚本**永远不会**问你要 Apple ID、密码、验证码。问你要的都是骗子。
3. 手机只装你亲手签的 WDA；`~/.phonehands/` 目录权限是 700，只有你能看。
4. 远端操作全程有审计日志；发现不对劲，Mac 上跑 `./setup.sh` 重跑一遍或直接拔线。

## 来源声明

- headscale（juanfont/headscale）：BSD-3 开源，control server 二进制由脚本在**你的服务器**上从官方 release 下载，
  我们不改它一行代码。集成方向已定，**pending GC final ruling**（公开发布前需 GC 终审）。
- WebDriverAgent（appium/WebDriverAgent）：BSD-3，用你自己的 Apple ID 在 Xcode 里编译签名。
- WDA 签名运维思路（48h 预警、本地重签、锁屏手机装不了、中途重签不延长时钟）学自 SideTap 公开文档，
  洁净室实现，未抄代码。详见 `NOTICE` 文件。

## 本文档的 claim 与证据（质量门禁 3）

| 文档里的说法 | 证据 |
|---|---|
| `setup.sh --mock` 一次跑通、输出端点 | `test-mock.sh` 用例 1（mock WDA + tunnel + endpoint.json 断言） |
| 健康检查 JSON 含 `relay/reachable/latency_ms/path` | `test-mock.sh` 用例 2（schema 断言） |
| `--parse-json` 能解析统一 schema | `test-mock.sh` 用例 3（合法/非法各一） |
| 第三方云中继会被判 FAIL | `test-mock.sh` 用例 4（ngrok 域名断言） |
| `resign.sh --check` 非 Mac 优雅退出 | `test-mock.sh` 用例 5 |
| 脚本可重跑 | `test-mock.sh` 用例 6（跑两次都过） |
| Mac 真机链路（签名/iproxy/headscale 入网） | **未验证**（门 4 PENDING，blocker：Mac + 备用机） |
