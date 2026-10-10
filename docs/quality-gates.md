# phonehands MVP 质量门禁（董事长 2026-10-09 21:4x 质量令）

> 任一 FAIL 即打回，不许"下轮补"。每个包交付时必须附《质量门禁自检表》，6 门逐项 PASS / FAIL / PENDING＋证据。
> PENDING 只允许**外部阻塞项**（注明 blocker＋ETA）；"下轮补"写法一律按 FAIL 计。

## 门 1：测试门
- 单元测试＋集成测试（mock WDA / mock Android / mock Hinge server），**行覆盖率 ≥80%**（TS：`c8 --check-coverage --lines 80`；bash：shellcheck 全过＋测试矩阵；Kotlin：现有单测＋编译检查）。
- Router 降级路径必须有**故障注入测试**：模拟 API 403、超时、空返回三件套。
- 测试命令一键可跑，写进包 README。

## 门 2：代码审查门
- 双 agent 交叉 review（coordinator 在集成时组织）＋ self-review checklist：命名规范 / 错误处理全覆盖 / 日志脱敏 / BSL header。
- **TODO/FIXME 不许进交付**；stub 必须显式标注 `STUB(issue#n)` 并关联 `docs/phase2-backlog.md` 或包内 ISSUES.md。

## 门 3：文档即契约门
- README / 部署文档里的**每个能力 claim，必须有对应测试或实测证据**；写"支持 X"就必须有测 X 的用例。
- 文档与实现不一致＝FAIL。

## 门 4：真机复测门
- mock 跑通 ≠ 完成。一键远程拓扑就绪后，全部 demo 链路在真机（含 Android 备用机）重跑，录屏存档。
- 拓扑未就绪前，本门记 **PENDING（blocker：一键远程拓扑＋备用机）**，不记 FAIL；但 mock 证据必须齐全。

## 门 5：安全审计门
- secret 永不落日志：交付前 `grep -rniE "password|token|secret|otp|auth" --include="*.log"` 审计＋喂假 secret 进日志路径断言无残留。
- BSL header 全文件：`grep -rL "SPDX-License-Identifier: BUSL-1.1" --include="*.ts" --include="*.sh" --include="*.kt"` 为空（除 NOTICE 声明的第三方改编文件）。
- loopback-only 默认（测试断言拒绝远程地址）；编译期只读开关测试断言。

## 门 6：视觉门（demo 视频＋README）
- 字幕错别字零容忍；GIF/视频逐帧检查；README 排印对齐检查（标题层级、代码块语言标注、表格对齐）。
- 代码包的包 README 同样适用排印检查。

---

## 《质量门禁自检表》模板（每个包交付时附）

| 门 | 结论 | 证据 |
|---|---|---|
| 1 测试门 | PASS/FAIL/PENDING | 测试命令＋通过数＋覆盖率数字 |
| 2 代码审查门 | PASS/FAIL/PENDING | self-review checklist 链接＋TODO grep 结果 |
| 3 文档即契约门 | PASS/FAIL/PENDING | claim→测试用例对照表 |
| 4 真机复测门 | PASS/PENDING | blocker＋ETA（拓扑未就绪时） |
| 5 安全审计门 | PASS/FAIL | grep 审计命令＋结果 |
| 6 视觉门 | PASS/FAIL/PENDING | README 检查记录／视频分镜状态 |

**有一门 FAIL，整个包不算交付。**
