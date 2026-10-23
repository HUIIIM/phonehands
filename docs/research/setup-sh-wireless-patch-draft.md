# setup.sh --wireless 模式 · Patch 草案（DRAFT，未应用）

> 对应 setup.sh 版本：v0.1.0（`scripts/remote-topology/setup.sh`）
> 状态：**草案，需 scripts 包评审 + 真机验证后才可合入。严禁直接应用。**
> 设计依据：`ios-wireless-spike.md` §2、§5
> 核心设计决策：Mac 侧永远只暴露 `127.0.0.1:$WDA_PORT`；无线模式只替换 STEP 5 的"转发源"
> （USB: iproxy → 无线: TCP 转发器 → phone_ip:8100）。STEP 6 tunnel、endpoint.json 结构、
> healthcheck.sh 调用方式全部不变。

所有代码片段均为**草案 sketch**（未在 Mac 上测试），插入点用"锚点"标注。
方括号标注：[待真机验证] / [待 scripts 包评审]。

---

## 1. 新增 CLI / Env（usage 头注释区 + 参数解析）

锚点：`while [ $# -gt 0 ]` 的 case 分支；`TUNNEL_MODE` 校验之后。

```bash
# 新增变量（默认值区附近）
WIRELESS=0
PHONE_IP="${PHONEHANDS_PHONE_IP:-}"

# 新增 case 分支
--wireless)        WIRELESS=1; shift ;;
--phone-ip)        PHONE_IP="$2"; shift 2 ;;
```

校验（放在 `case "$TUNNEL_MODE"` 之后）：

```bash
if [ "$WIRELESS" = "1" ]; then
  [ "$MOCK" = "0" ] || die "--wireless cannot be combined with --mock"
  [ -n "$PHONE_IP" ] || die "--wireless needs --phone-ip <iphone-wifi-ip> (or PHONEHANDS_PHONE_IP).
    Find it: iPhone Settings -> Wi-Fi -> (i) next to the network -> IP Address.
    Mac and iPhone must be on the SAME Wi-Fi network."
  # 安全门：无线模式下 WDA 经 WiFi 可达（HTTP 无认证），必须有 tunnel，不得裸奔
  # [待 scripts 包评审]：是否允许 --tunnel-mode mock + --wireless 的组合用于局域网测试
fi
```

usage 头注释追加：

```
#   setup.sh [--wireless --phone-ip IP] ...
# Env:
#   PHONEHANDS_PHONE_IP          iPhone Wi-Fi IP, required for --wireless
```

## 2. STEP 4（签名）追加手动步

锚点：STEP 4 的 heredoc（THE ONE MANUAL STEP）之后、`read -r _` 之前。

草案：在 heredoc 末尾追加一段（仅当 `WIRELESS=1` 时打印）：

```
  6. WIRELESS MODE EXTRA STEP (still by your hand, in Xcode):
     Xcode -> Window -> Devices and Simulators -> select this iPhone ->
     check "Connect via network". Wait for the network icon to appear
     next to the device name, THEN unplug the USB cable.
     (Xcode 9+ / iOS 11+ required. See DEPLOY.md wireless section.)
```

并把最后的 `read` 提示语改为区分："Press ENTER when Xcode Product -> Test has finished
AND (wireless mode) 'Connect via network' shows the network icon..."

注：这一步脚本**做不到也不碰**（Xcode UI + CoreDevice 内部状态），保持手动。[查文档确认：Xcode 是唯一官方切换入口]

## 3. STEP 5（转发）替换 —— 本 patch 的核心

锚点：`# ---------------------------------------------------------- step 5: USB forward`
整段替换为双分支：

```bash
echo; log_info "STEP 5/6 — forward (device 8100 -> localhost:$WDA_PORT)"
if [ "$MOCK" = "1" ]; then
  # ... 现有 mock 分支，原样保留 ...
elif [ "$WIRELESS" = "1" ]; then
  log_info "wireless mode: forwarding 127.0.0.1:$WDA_PORT -> $PHONE_IP:8100 (no USB, no iproxy)"
  if wda_status_ok "$PHONE_IP:8100"; then
    log_ok "WDA answers directly on $PHONE_IP:8100"
  else
    die "WDA not answering on $PHONE_IP:8100 — checklist: same Wi-Fi? WDA runner running
         (Xcode Product -> Test)? iPhone unlocked? 'Connect via network' paired?"
  fi
  # 轻量 TCP 转发器：让下游（tunnel/endpoint/healthcheck）继续只认 127.0.0.1:$WDA_PORT
  # [待真机验证] 转发器选型：python3 socket 双向 relay（mock 模式已有同构实现思路）或 socat
  start_bg "wifi-relay" python3 "$SCRIPT_DIR/wifi-relay.py" "$WDA_PORT" "$PHONE_IP" 8100
  wda_status_ok "127.0.0.1:$WDA_PORT" \
    || die "relay up but WDA not reachable through it."
  log_ok "wireless relay answering on 127.0.0.1:$WDA_PORT"
else
  # ... 现有 USB 分支（idevice_id + iproxy），原样保留 ...
fi
```

新增文件 `scripts/remote-topology/wifi-relay.py`（草案 sketch，[待真机验证]）：

```python
#!/usr/bin/env python3
# SPDX-License-Identifier: BUSL-1.1
# wifi-relay: dumb TCP relay 127.0.0.1:<local_port> -> <phone_ip>:8100
# so the rest of the chain (tunnel/endpoint/healthcheck) stays loopback-only.
# No secrets, no logic — pure byte pipe. [待真机验证]
import socket, threading, sys
local_port, phone_ip, phone_port = int(sys.argv[1]), sys.argv[2], int(sys.argv[3])
# ... accept loop + bidirectional pipe (同构于现有 mock-relay 思路) ...
```

[待 scripts 包评审]：是否直接复用 `start_mock_relay` 的内联 python 写法（把目标从 127.0.0.1:$WDA_PORT 换成 $PHONE_IP:8100），
避免新增文件。若复用，注意内联代码里 `bind(("127.0.0.1", src))` 不变，只改 `create_connection` 目标。

## 4. endpoint.json 字段扩展

锚点：`lib.sh` 的 `write_endpoint`（字段由调用方传入）。

草案：setup.sh 调用处追加两个字段（不改 `write_endpoint` 签名，用 python 侧加可选字段，或调用后追加）：

```json
{
  "endpoint": "host:port",
  "tunnel_mode": "...",
  "wda_port": 8100,
  "created_at": "...",
  "link_mode": "wireless",
  "phone_ip": "192.168.1.42"
}
```

USB 模式：`"link_mode": "usb"`（不写 phone_ip）。下游读取 endpoint 的代码用 `.get("link_mode", "usb")` 兼容老文件。
[待 scripts 包评审]

## 5. resign.sh 无线变体（本 patch 范围外，但必须同步记）

当前 resign.sh 强依赖 USB：`idevice_id -l` 找 UDID + `iproxy` 建转发。无线模式下：
- UDID 获取改用 `xcrun devicectl list devices`（能列出无线配对设备）[待真机验证]
- 转发改用 wifi-relay（同 §3）
- `xcodebuild -destination id=$UDID test` 本身支持无线目标（Xcode 配对已建好）[查文档确认：无线调试支持 build/install/test]

建议：resign.sh 加 `--wireless --phone-ip` 对称 flags，逻辑与 setup.sh §3 同构。不在本 patch 草案内，记为后续工作项。

## 6. DEPLOY.md 需要追加的无线章节（给弟弟看的操作序列）

1. 首次：iPhone 解锁 → 插 USB → 点 Trust → 开 Developer Mode（iOS 16+，重启确认）
2. Mac 和 iPhone 连**同一个 WiFi**
3. Xcode → Window → Devices and Simulators → 选中 iPhone → 勾 **Connect via network** → 看到网络图标
4. 跑 `setup.sh --wireless --phone-ip <iPhone 的 WiFi IP>`（IP 在 iPhone 设置 → 无线局域网 → (i) 里看）
5. 拔掉 USB 线
6. 以后：`setup.sh --wireless --phone-ip <IP>`（IP 变了就重设；DHCP 租约变化是已知限制，v1 不做自动发现）
7. 断了怎么办：先看手机和 Mac 是否同 WiFi → 手机开关一次飞行模式 → 重跑 setup.sh → 还不行插 USB 重配一次

## 7. 非目标（v1 不做）

- mDNS 自动发现 phone_ip（`dns-sd -B _remotepairing._tcp`）——v1 要求手动传 IP，减少魔法。[待真机验证后评估]
- WDA-over-Tailscale（门 B）——研究轨道事项，不进本 patch
- 自动勾选 Xcode "Connect via network"——脚本做不到，保持手动
- 公网暴露 WDA——永远不做（WDA 无认证）

## 8. 验收清单（合入前）

- [ ] 真机：同 WiFi 下 `curl http://<phone-ip>:8100/status` 200（spike 清单 V1）
- [ ] `setup.sh --wireless --phone-ip <IP>` 全流程跑通，拔线后 healthcheck 通过
- [ ] 默认 USB 路径零回归（现有 mock 测试 + Mac 实测）
- [ ] `--wireless` 无 `--phone-ip` 时报错信息可用
- [ ] endpoint.json 新字段向后兼容（老文件无 link_mode 时按 usb 处理）
- [ ] shellcheck 全过；secrets 政策复核（无新增 secret 面）

---

*本草案未应用。合入需：scripts 包评审通过 + §8 验收全过。*
