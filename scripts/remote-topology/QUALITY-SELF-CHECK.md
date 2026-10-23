# SPDX-License-Identifier: BUSL-1.1

# 质量门禁自检表 — PhoneHands scripts 包
# （remote-topology + phonehands-doctor.sh，董事长 2026-10-09 21:4x 质量令）

| 门 | 结论 | 证据 |
|---|---|---|
| 1 测试门 | PASS | shellcheck 0.10.0 `-S warning` 零警告（6 个 .sh）；`test-mock.sh` 10/10 通过（mock WDA /status＋截图链＋统一 schema＋--parse-json 合法/非法＋第三方中继判 FAIL＋resign 非 Mac 降级＋幂等重跑）；负路径矩阵 5 项（无 mock WDA 优雅失败 exit 1／无端点报错／非法 tunnel-mode 报错／坏 relay URL scheme 报错／ssh 缺 host 在 Mac 守卫处拦截）；`phonehands-doctor.sh` 本机全 PASS。一键可跑：`./remote-topology/test-mock.sh`。覆盖率记 N/A——理由：bash 无行覆盖率工具链（c8 只适用 TS），以 shellcheck＋测试矩阵为等效证据，见上。 |
| 2 代码审查门 | PASS（self-review）；交叉 review PENDING | self-review：命名统一 PHONEHANDS_*／错误处理全覆盖（set -euo pipefail＋die＋exit 码约定）／日志脱敏（redact() 实证见门 5）／BSL header 6/6。`grep -rniE "TODO\|FIXME"` 零命中。无 stub。交叉 review：由集成 coordinator 组织，本包未阻塞。 |
| 3 文档即契约门 | PASS | claim→证据对照见 `DEPLOY.md` 末节"本文档的 claim 与证据"（7 条：mock 可验证 6 条＋Mac 真机 1 条标 PENDING）；实现与文档已逐项核对（输出变量名 PHONEHANDS_RELAY_URL、健康检查 JSON 字段、切换命令 `--tunnel-mode ssh`／`--use-tailscale-official` 均与代码一致）。 |
| 4 真机复测门 | PENDING | blocker：Mac＋备用 iPhone（预算待董事长一键包审批；部署人力弟弟可搭把手）。mock 证据齐全（门 1）；Mac 实测待拓扑就绪后重跑 setup.sh 真机链路（签名/iproxy/headscale 入网/MagicDNS）。 |
| 5 安全审计门 | PASS | ① BSL header：6/6 `.sh` 含 `SPDX-License-Identifier: BUSL-1.1`（逐文件 grep 断言）；② `MIT` 字样零残留（仅 README"永不 MIT"字样）；③ 硬编码 secret：`grep -rniE "(password\|passwd)\s*[:=]..."` 零命中——脚本从不索取 Apple ID/密码/token，签名走 Xcode 亲手、隧道走密钥 SSH／headscale pre-auth key（值永不进日志）；④ 日志脱敏实证：`redact()` 把假 token 值替换为 `[REDACTED]`（`log_cmd` 全程包裹敏感命令）；⑤ endpoint/state 文件 600、状态目录 700。 |
| 6 视觉门 | PASS | DEPLOY.md 中文排印检查：标题层级 `#`→`##`→`###` 一致、步骤编号 0–4 连续、代码块均标 `bash`、预期输出样例与实现一致（门 3 已核）；README.md（包级×2）排印一致。无视频交付（本包无 demo 视频产出）。 |

**结论：0 FAIL。门 4 PENDING 为外部阻塞（Mac＋备用机），非本包缺陷；其余 5 门 PASS。**

## 附：修过的真 bug（自检过程发现）

1. `phonehands-doctor.sh` 的 `report()` 以 `[ -n "$fix" ] && printf` 结尾，无 fix 时返回 1，`set -e` 直接杀脚本——加 `return 0` 修复，回归验证全 PASS。
2. 四个脚本的 `--help` 用 `sed -n '2,/^#$/p'` 取注释头，范围提前终止（setup 只打出 1 行）——统一改 awk 实现，回归验证输出完整。
