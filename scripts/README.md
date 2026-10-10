# SPDX-License-Identifier: BUSL-1.1 (pending GC final review)

# PhoneHands scripts

bash 工具包（`set -euo pipefail`，幂等可重跑）。

| 脚本 | 干什么 |
|---|---|
| `phonehands-doctor.sh` | 环境一键诊断：node 22+ / npm / python3 3.9+ / usbmuxd / Xcode / WDA 签名状态 / tailscale / ssh；逐项 PASS/FAIL/WARN/SKIP，FAIL 给一行修复命令。只读，不改系统。 |
| `remote-topology/` | 一键远程拓扑（第三条腿）：见该目录 `README.md` |

## 一键验证

```bash
./remote-topology/test-mock.sh   # mock 全链路验证
./phonehands-doctor.sh             # 本机体检
```

## 约定

- 所有 `.sh` 文件头含 `SPDX-License-Identifier: BUSL-1.1 (pending GC final review)`，永不 MIT。
- secret 永不进脚本、永不进日志（Apple ID/密码/token 只走用户亲手操作或环境变量，日志脱敏）。
- 改系统配置前先 echo 提示并征得确认（`--yes` 可跳过）。
