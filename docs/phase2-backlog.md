# phonehands Phase 2 Backlog（合并候选 T3/T4/T8/T9/T10＋遗留项）

> 来源：内部研究笔记《phonehands 合并候选》（2026-10-09，董事长已过目）
> 状态：2026-10-09 立项，不阻塞 Phase 1 MVP。GC license 裁决前，所有"待核验"项只学模式、一行代码不抄。

## P2-1 Android 设备后端（T3：shuao-pro/android-mcp，MIT 公开口径）
- 新包 `packages/device-backend-android`，以 android-mcp 为底座（GC 裁决 LICENSE 全文后）。
- 拿：`get/set_privilege_mode` 三档（auto/shizuku/root）→ 映射我们的能力声明查表；37 工具分类 → 映射统一 Action 接口。
- 与 Phase 1 的 `packages/android-backend`（helper APK 无线路线）关系：两条 Android 路线（APK 无线优先／ADB-Shizuku 本地优先），Router 按 deviceType＋能力查表调度。

## P2-2 Instagram adapter（T2：vanxh/instagram-personal-mcp）
- API 引擎 adapter 矩阵第二个成员（Hinge→Instagram），证明 adapter 路线。
- 模式已在 Phase 1 并入 hinge adapter（默认拒绝＋精确放行、getpass 凭据）；代码待 GC 裁决。

## P2-3 网关级审批（T4：supreeth-ravi/agent-gate，license 待核验→模式）
- 可选 gateway 模式：命中 approval_required 策略的调用直接拦截（-32010 语义），人批后才重放；agent"忘了调审批"也绕不过去。

## P2-4 一键急停（T5 模式：qsh36/droidclaw2，GPL→只学模式）
- emergency stop：撕掉 agent run＋tool 进程＋PTY＋ADB 流；Red 安全模式（显式进入、30 分钟上限、自动回退）。core 已预留 `emergencyStop()` 接口桩。

## P2-5 认证交接实现参考（T8：mhmdibrahimm/human-intervention-mcp，license 待核验→模式）
- 排队版 pause/resume 的实现（它家无队列，我们自己实现排队＋可恢复）。

## P2-6 视觉定位引擎（T9：microsoft/OmniParser，MIT 公开口径待核验）
- Phase 2：device-backend fallback 链做**接口抽象**（LocatorProvider），不硬绑模型。
- Phase 3：实测选型（OmniParser vs UGround vs SeeClick，以 iOS 屏幕实测为准）。

## P2-7 审计日志格式（T10：josephkamau32/erp-lite-mcp，license 待核验→模式）
- approval_token 永不进 agent 上下文；admin 面与 MCP 面分离；append-only 审计日志＋敏感值脱敏。

## P2-8 Skills 矩阵（T7：agentskills，Apache-2.0 可用）
- Phase 1 末：`skills/hinge/SKILL.md`；Phase 2：每 adapter 一个 skill。

## GC License 裁决清单（裁决前不合入代码）
- [ ] emazaheri/ios-agent（MIT 公开口径）——Phase 1 已按"保留声明＋出处"并入，待追认
- [ ] shuao-pro/android-mcp（MIT badge 口径）
- [ ] vanxh/instagram-personal-mcp（待核验）
- [ ] microsoft/OmniParser（MIT 公开口径待核验）
- [ ] supreeth-ravi/agent-gate（待核验）
- [ ] mhmdibrahimm/human-intervention-mcp（待核验）
- [ ] josephkamau32/erp-lite-mcp（待核验）
- [ ] juanfont/headscale（BSD-3，依赖可用）
- 永不并入代码：GPL/AGPL/SSPL（droidclaw2 等）——只学模式

## P2-8 安全模式状态机（core，Normal / Yellow / Red）

- 现状：`packages/core/src/router.ts` 头部为设计文档注释（`STUB(P2-8)`），无实现。
- Phase 2 范围：模式状态机 enter/exit API；Yellow：写操作需逐 dispatch
  confirm 标志、deadline 收紧、审计提级；Red：必须显式进入，
  拒绝一切新 dispatch（emergencyStop 路径除外），在途跑完即停；
  Red 不许自动进入。
- 验收：三模式切换测试；Red 下 dispatch 被拒且有审计；无自动进 Red 的路径（代码审查）。
- 依赖：P2-4（Red 复用 emergencyStop 的 teardown 语义）。
