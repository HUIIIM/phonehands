# Android 包质量门禁自检表（2026-10-09）

<!-- SPDX-License-Identifier: BUSL-1.1 -->

> 包：`packages/android-backend`（TS）＋ `packages/android-helper`（Kotlin APK）
> ＋ `examples/android-wireless-demo`。标准：`docs/quality-gates.md`。
> 任一 FAIL 即打回。

| 门 | 结论 | 证据 |
|---|---|---|
| 1 测试门 | **PASS**（TS）/ **PENDING**（Kotlin） | TS：`npm test` = `c8 --check-coverage --lines 80 --reporter=text node --test tests/*.test.ts` → **32/32 通过，行覆盖率 91.87%**（≥80%）。含 mock 手机 WebSocket 集成测试（hello/frame/tap/swipe/screenshot/launch/observe 端到端）＋故障注入（静默手机→tap 超时标 `uncertain`，永不重放）。Kotlin：PENDING —— 本机无 Android SDK/Gradle（`gradle/javac/kotlinc/java` 均 NOT FOUND，`ANDROID_HOME` 未设），编译＋单测进 Phase 2 CI。 |
| 2 代码审查门 | **PASS**（self-review）/ 交叉 review 待集成时组织 | self-review：命名规范 ✓（AndroidXxx/动词方法）；错误处理全覆盖 ✓（ProtocolError fail-closed、ack 超时、token 校验）；日志脱敏 ✓（`describeMessage` 只记 token present/absent，单测喂假 secret 断言无残留）；BSL header ✓（全文件 grep 零缺失）。`grep -rni "TODO\|FIXME"` → 零命中。无 stub。 |
| 3 文档即契约门 | **PASS** | `docs/android-deploy.md` §7 有 claim→证据对照表（9 条 claim，每条对应测试用例或官方文档链接）。`PROTOCOL.md` 与 `AgentProtocol.kt`/`protocol.ts` 实现一致（字段级对照：hello/ack/frame/ping/pong）。demo README 的预期输出与实测输出一致（已跑通）。 |
| 4 真机复测门 | **PENDING** | blocker：备用 Android 真机未就绪＋一键远程拓扑未就绪。ETA：Phase 2（备用机＋拓扑到位后重跑全部 demo 链路并录屏存档）。mock 证据齐全（门 1）。 |
| 5 安全审计门 | **PASS** | ① BSL header：`grep -rL "SPDX-License-Identifier: BUSL-1.1" --include="*.ts" --include="*.kt" --include="*.gradle"` → 空。② secret：无 `.log` 文件；`password` 字样仅出现在 URL 凭据拒绝逻辑（`relay-url.ts:59`，安全特性本身）；`describeMessage` 单测喂假 token `SECRET-TOKEN-XYZ-123` 断言日志行无残留。③ loopback 默认：服务端默认绑 `127.0.0.1`（`DEFAULT_BIND_HOST`），外网需经 SSH 隧道/Tailscale（文档 §3）。④ 编译期只读开关：不适用（本包 MVP 无写 API 动作；`type` 未实现→`capabilityFor` 返回 null，fail-closed 有单测）。 |
| 6 视觉门 | **PASS**（包 README）/ PENDING（demo 视频） | 三个 README（android-backend / android-helper / android-wireless-demo）排印检查通过：标题层级一致、代码块均标语言、表格对齐。demo 视频未录制 —— 待门 4 真机就绪后按分镜录制。 |

**结论：无 FAIL。TS 侧可交付；Kotlin 侧代码完成、编译未验证（PENDING，blocker 注明）；真机复测 PENDING。交叉 review 由 coordinator 在集成时组织。**
