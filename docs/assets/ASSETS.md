# 素材清单（ASSETS）— PhoneHands（HUIIIM/phonehands，私有仓）

> 标准：《GitHub 项目展示标准 v1.1》第 4.3 / 14 节（O7、O9）：逐件登记、设计件留可机扫源、源↔图对应。
> 本文件随第四波重写补建（2026-10-21），登记本目录全部素材。仓型定位：框架/工具（双引擎手机 agent），演示层以真实代码链路录制 GIF 为真实捕获。

| 文件 | 尺寸 | 性质 | 生成方式 / 来源 | 用在 README 哪里 |
|---|---|---|---|---|
| banner.svg | 1280x360（画布） | 设计源（O9） | 手写 SVG，色值只取品牌包 v1.0 令牌，字体为令牌栈 | banner.png 的源 |
| banner.png | 1280x360 | 设计渲染 | 由 banner.svg 渲染（2026-10-20）；回读主色：#FFFFFF 92.0% / #000000 2.1% / #FF4713 1.0% / #3F3F3F 0.8% | 顶部横幅（明版，`<picture>` 默认） |
| banner-dark.svg | 1280x360（画布） | 设计源（O9） | 同版式，墨黑基底反白 | banner-dark.png 的源 |
| banner-dark.png | 1280x360 | 设计渲染 | 由 banner-dark.svg 渲染（2026-10-20）；回读主色：#000000 92.0% / #FFFFFF 2.1% / #DEDEDE 1.2% / #FF4713 1.0% | 顶部横幅（暗版） |
| phonehands-social-preview.svg | 1280x640（画布） | 设计源（O9） | 手写 SVG，同令牌口径（本波复核色值普查 100% 令牌内） | phonehands-social-preview.png 的源 |
| phonehands-social-preview.png | 1280x640（2:1） | 设计渲染 | 由 phonehands-social-preview.svg 渲染，本波回读主色：#FFFFFF 92.7% / #000000 2.5% / #FF4713 1.3% | 仓库 social preview 备图（O2：发布波次于仓库设置中实际启用） |
| phonehands-demo-v2.gif | 640x360，64 帧，8.01s | 真实捕获 | 真实代码链路实录（本地服务 + mock 数据，README 图注已明示 mock 口径）：API 403 后 Router 切设备引擎；时长 8.01s 于 2026-10-21 逐帧复核，与图注「8 秒剪辑版」一致 | README 演示节（双语版均引用） |
| phonehands-demo-v1.gif | 640x360，168 帧，14.0s | 真实捕获 | 同链路早期剪辑版；现行双语 README 未引用，保留登记 | —（未引用） |
| phonehands-hero.png | 2048x1152 | 设计渲染（历史件） | 标准前旧素材，主色近黑藏青系（#03070A 等，非令牌）；现行双语 README 未引用，保留登记、不作展示面 | —（未引用） |

## DNA 采样（G12，2026-10-21 复核）

- 三件设计源 SVG 色值普查：只出现 #FF4713、#3F3F3F、#FFFFFF、#DEDEDE、#6B6B6B、#000000，100% 落在品牌包 v1.0 令牌表内；字体为令牌栈 `"Nunito Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif`；圆角 = none。
- 横幅状态行（「Phase 1 · mock-verified」）为真实状态文字，未用验证绿作装饰。

## 私有仓加审（标准第 11 节，2026-10-21）

- 双语 README 全文筛查：无内部路径、无组织结构信息、无凭证类内容；「门禁 4a/4b」为项目自有验证分级术语，README 内有完整定义，非未释义的内部代号。
- 「D-Day」为本项目自身文档通用的发布日称谓（docs 内多处同口径），非组织内部代号；登记在此备验收方复核。

## 本波更正（如实记录，G4）

- 定位句原有「4 ms / 4 毫秒」接管耗时数字：全仓检索（代码、测试、文档）无任何实测出处，已按「无据不写」于双语版同步删除；「20 条 matches」有 dual-demo 测试场景实据（`readMatches(20)` + 注入 403 降级），保留。
- 开发节测试数原为占位符 `__PH_TESTS__`，已填实测值（见下）。

## 实测读数（与 README 对账，G4）

- 全仓测试：**190 passed, 0 failed（7 个 workspace），2026-10-21 本机实跑**（`npm run build` 先行通过）：android-backend 32 / api-backend 33 / core 44 / device-backend 47 / hinge-adapter 28 / dual-demo 3 / integration-smoke 3。
- 远程拓扑 mock 验证：`bash scripts/remote-topology/test-mock.sh` 于 2026-10-21 实跑 **10 passed, 0 failed**，与 README 双处「10/10 PASS」记载一致。
- 提交数：`main` 14 次（2026-10-20，与 README 状态行一致）；版本 v0.1.0 未发布（CHANGELOG 同口径）。

## 欠项登记（标准 13.3，双登记：本表 + 第四波验收摘要）

| 欠项 | 现状 | 卡点 / 路径 | Owner / ETA |
|---|---|---|---|
| 演示视频（O8） | README 已声明 32 秒完整版随发布包提供；本波只有 8s GIF 剪辑 | 属发布波次件；视频简报/提示词须内置 DNA 约束 | 发布波次（随公开发布） |
| social preview 实际启用（O2） | 备图已就绪、未启用 | 仓库设置操作属发布动作（P4），本波不发布 | P4 发布时执行、P5 回读 |
| README.en.md 处置 | 旧英文版仍在仓根，与现行 README.md（EN 主版）内容重复且已过期 | 本波生产范围只动双语双版 + docs/assets，未删；发布时应删除或归档，避免三版漂移 | P4 发布时处置 |
| LICENSE 正式文件 | 未入仓（README 已如实声明：BSL 1.1 口径 pending GC 最终文本） | 等 GC 最终法律文本，非本线可办 | GC 裁决后随发布落地 |
