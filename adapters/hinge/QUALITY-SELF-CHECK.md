<!-- SPDX-License-Identifier: BUSL-1.1 -->

# 质量门禁自检表 — @phonehands/hinge-adapter

> 标准：`~/workspace/phonehands/docs/quality-gates.md`（董事长 2026-10-09 21:4x 质量令）。
> 交付日期：2026-10-09。有一门 FAIL 即打回。

| 门 | 结论 | 证据 |
|---|---|---|
| 1 测试门 | **PASS** | `npx c8 --check-coverage --lines 80 --reporter=text node --test tests/*.test.ts` → **28 pass / 0 fail**，行覆盖率 **93.36%**（≥80%，含 mock server 集成测试）。故障注入三件套：`__fault=403` → `ok:false`＋`HTTP_403`＋不重试 ✔、超时熔断（api-backend 层）✔、`__fault=empty` 空响应 → `ok:true` 零条目 ✔、持久 429 → 重试耗尽＋`degraded:true` ✔。测试命令已写入包 README（`npm test` 一键可跑）。 |
| 2 代码审查门 | **PENDING**（外部阻塞） | self-review 已完成：命名规范 ✔、错误处理全覆盖（`WriteNotEnabledError`/`NoTtyError`/envelope error 码）✔、日志脱敏 ✔、BSL header 全文件 ✔；`grep -rniE "TODO\|FIXME"` 全包零命中 ✔。双 agent 交叉 review 待 parent 在集成时组织（blocker：集成排期）。T2 模式并入已做 license 隔离：只学模式、一行未抄，T2 license 兼容性标注"待 GC 裁决"。 |
| 3 文档即契约门 | **PASS** | claim→测试对照：①三读操作返回结构化 JSON＋core envelope → `hinge-adapter.test.ts` 前 4 项；②测试永不碰真实服务器（mock 127.0.0.1＋显式 baseUrl 无生产默认）→ mock 回环断言＋`baseUrl:""` 抛错 2 项；③OTP 走安全 TTY 无回显、不进参数/日志 → `secure-prompt.test.ts` 5 项（含无回显实证＋非 TTY 拒绝）；④写默认拒绝＋`HINGE_ALLOWED_WRITE_TOOLS` 精确放行 → `write-allowlist.test.ts` 5 项＋adapter 拒绝 2 项；⑤session 严格权限门 → api-backend `session-store.test.ts` 严格门 1 项（引用）；⑥自我节流 → 429/403 测试 3 项。SKILL.md（T7）已交付：`skills/hinge/SKILL.md`（agentskills 标准 frontmatter＋progressive disclosure）。 |
| 4 真机复测门 | **PENDING**（外部阻塞） | blocker：一键远程拓扑＋备用机未就绪（topology 工作流 owner）。ETA：待 topology owner 给出。mock 证据齐全（登录流/三读/分页/412/403/429/空响应全覆盖）。 |
| 5 安全审计门 | **PASS** | ①喂假 secret 断言：secure prompt 输出流永不含 secret（fake `428`）✔、adapter 日志无 token 残留（api-backend 层断言）✔、412 错误消息掩码邮箱 ✔；②BSL header：全部 `.ts` 文件携带 ✔（全仓 23/23）；③session 0600 断言＋0640/0644 拒绝加载 ✔；④loopback-only：mock 绑定 `127.0.0.1` 断言 ✔；⑤编译期只读：写能力表全 `supported:false`＋未知动作 fail-closed ✔。无真实账号、无真实 token 入库。 |
| 6 视觉门 | **PASS** | 包 README 排印检查：标题层级 ✔、代码块语言标注（ts/sh）✔、表格对齐 ✔、安全章节六条编号 ✔。SKILL.md frontmatter 格式符合 agentskills 标准 ✔。本包无视频交付物。 |

**结论：无 FAIL。两门 PENDING 均为外部阻塞项（交叉 review／真机拓扑），附 blocker 说明。**
