# SPDX-License-Identifier: BUSL-1.1

# remote-topology — PhoneHands 的"第三条腿"：一键远程拓扑

Mac + 备用 iPhone 的固定拓扑，一条命令变成远端可操作的端点。
自托管是硬性设计：屏幕流与指令**只走你自己的通道**（headscale mesh / SSH 反向隧道），
不经过任何第三方云——连组网的大脑（coordination server）都是你自己的 headscale。

## 自托管声明

- 默认隧道：**headscale 自托管**（juanfont/headscale，BSD-3，见 `NOTICE`，pending GC final ruling）。
  control server 装在**你自己的服务器**上，节点间是 WireGuard 端到端加密 mesh。
- 第二条腿：**SSH 反向隧道**（`--tunnel-mode ssh`），密钥认证，不经过第三方。
- 兜底：官方 Tailscale（`--use-tailscale-official`），需要第三方账号——仅临时用。
- `healthcheck.sh` 有"中继路径验证"：第三方云中继域名直接判 FAIL。

## 文件

| 文件 | 干什么 |
|---|---|
| `setup.sh` | Mac 侧一键部署：体检→装依赖→WDA 源码→引导签名→USB 转发→起隧道→输出端点→健康检查 |
| `healthcheck.sh` | 对端点做健康检查：WDA `/status` + 截图链路验证 + 中继路径验证；输出统一 JSON `{relay, reachable, latency_ms, path}`；`--parse-json` 可解析任意统一 schema 输出（给 Android 侧预留） |
| `resign.sh` | WDA 签名看门狗：查剩余有效期→48h 预警→一键重签（`xcodebuild test`，手机需亲手解锁） |
| `test-mock.sh` | mock 验证：本地 mock WDA + mock 隧道，验证 setup/healthcheck 链路逻辑 |
| `lib.sh` | 共享函数（日志/脱敏/后台进程/endpoint 文件/签名过期计算），被 source，不直接执行 |
| `DEPLOY.md` | 中文部署手册（写给非技术人员：准备→步骤→排错→7 天重签→付费账号→中继架构） |
| `NOTICE` | 第三方组件声明（headscale / WebDriverAgent / 洁净室思路来源） |

## 快速验证（无 Mac 可跑）

```bash
./test-mock.sh          # 全链路 mock 验证，约 20 秒
../phonehands-doctor.sh   # 本机环境体检（只读）
```

## 中继约定（与 Android 侧统一，Router 按 deviceType 调度）

- `PHONEHANDS_RELAY_URL`：`ssh://user@host:port`（SSH 腿）或 `ws(s)://host:port/path`（直连）。
- 健康检查统一 schema：`{relay, reachable, latency_ms, path}`，
  `path ∈ {ssh-tunnel, headscale, tailscale, direct, usb}`。
- iOS 路径：agent → SSH/自托管 headscale → Mac → USB/WiFi → WDA；
  Android 路径：手机 → WebSocket → 自托管 agent。两者互补。

## 状态

- Phase 1：mock 验证通过；Mac 真机链路待验证（门 4 PENDING，blocker：Mac + 备用机）。
- 不 publish（需 GC + CEO 终审）。
