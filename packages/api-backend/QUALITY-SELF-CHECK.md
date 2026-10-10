<!-- SPDX-License-Identifier: BUSL-1.1 (pending GC final review) -->

# 质量门禁自检表 — @phonehands/api-backend

> 标准：`~/workspace/phonehands/docs/quality-gates.md`（董事长 2026-10-09 21:4x 质量令）。
> 交付日期：2026-10-09。有一门 FAIL 即打回。

| 门 | 结论 | 证据 |
|---|---|---|
| 1 测试门 | **PASS** | `npx c8 --check-coverage --lines 80 --reporter=text node --test tests/*.test.ts` → **33 pass / 0 fail**，行覆盖率 **97.28%**（≥80%）。故障注入三件套：403 不重试（`HttpStatusError`）✔、429 退避＋`Retry-After` 遵守后成功 ✔、超时熔断（hanging server → abort）✔、空响应按数据处理 ✔。测试命令已写入包 README（`npm test` 一键可跑）。 |
| 2 代码审查门 | **PENDING**（外部阻塞） | self-review 已完成：命名规范 ✔、错误处理全覆盖（`HttpStatusError`/`RateLimitedError`/`EmailChallengeRequired`/`SessionCorruptError`/`SessionInsecureError`）✔、日志脱敏 ✔、BSL header 23/23 文件 ✔；`grep -rniE "TODO\|FIXME"` 全包零命中 ✔。双 agent 交叉 review 待 parent 在集成时组织（blocker：集成排期；非本包可自行闭环项）。 |
| 3 文档即契约门 | **PASS** | claim→测试对照：①手机伪装三件套＋登录重随机 → `fingerprint.test.ts` 5 项；②地域/语言参数化（禁硬编码）→ 同上 2 项；③自我节流（串行/间隔/429 退避/`Retry-After`/重试预算/降级探针）→ `http-client.test.ts` 9 项；④登录状态机五步＋412 一等公民＋破坏性重登＋登出轮换 → `login-state-machine.test.ts` 5 项；⑤session 四件套＋严格权限门 → `session-store.test.ts` 9 项；⑥能力声明编译期只读 → `capabilities.test.ts` 3 项；⑦secret 脱敏 → `capabilities.test.ts` 2 项＋`http-client` 日志断言 1 项。文档与实现一致（envelope 口径已按实现修正为 adapter 层构建）。 |
| 4 真机复测门 | **PENDING**（外部阻塞） | blocker：一键远程拓扑＋备用机未就绪（topology 工作流 owner）。ETA：待 topology owner 给出。mock 证据齐全（本包无真机依赖面：纯 HTTP 客户端，网络行为由 localhost 故障注入全覆盖）。 |
| 5 安全审计门 | **PASS** | ①喂假 secret 断言：`auth token never appears in log output`（fake `top-secret-token-abc123`）✔、`sanitizeLogLine` 掩码断言 ✔；②BSL header：23/23 `.ts` 文件携带 `SPDX-License-Identifier: BUSL-1.1` ✔（`grep -rL` 零缺失）；③session 0600/0700 断言 ✔＋group/other 可读直接拒绝加载（`SessionInsecureError`）✔；④仓库内无真实 token/密码：测试仅用 `mock-token-*`/`000000` 等假值 ✔。 |
| 6 视觉门 | **PASS** | 包 README 排印检查：标题层级一致 ✔、代码块均带语言标注（ts/sh）✔、表格列对齐 ✔、无错别字（通读）✔。本包无视频交付物。 |

**结论：无 FAIL。两门 PENDING 均为外部阻塞项（交叉 review／真机拓扑），附 blocker 说明。**
