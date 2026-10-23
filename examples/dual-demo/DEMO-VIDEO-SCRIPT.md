<!-- SPDX-License-Identifier: BUSL-1.1 -->

# phonehands demo 视频脚本 A《API 死了，任务没死》· 30 秒分镜

> 对应立项建议书 §4.2 脚本 A（主推）。本 mock 运行（`node dual-demo.ts`）即本片的**排练版**：
> 左屏日志 = 本次运行的真实日志行；右屏真机部分实拍时替换为真机录屏。
> 实拍前置：mock→real 映射见 §5。

## 总览

- **时长**：30 秒（竖屏 9:16，适配 TikTok / 小红书 / Reels / Shorts；另存 16:9 横版用于 X/YouTube）
- **结构**：左右分屏贯穿全片
  - **左屏**：终端日志（API 引擎的 JSON 日志滚动）
  - **右屏**：真机屏幕录屏（Hinge App 内 matches 列表）
- **核心字幕**（全片只出现一次，落在 26–30s）：**"接口会变，手不会。"**
- **英文版字幕**："APIs break. Hands don't."

## 分镜（时间轴）

| 时间 | 左屏（终端日志） | 右屏（真机） | 字幕 / 旁白 | 音效 |
|---|---|---|---|---|
| 0–3s | 黑屏起，标题卡：`phonehands — 给 AI 的两只手`；副标题：一只讲 API（快），一只点屏幕（真） | 同左（标题卡占满） | 无旁白，标题即钩子 | 键盘敲击 2 声 |
| 3–8s | 日志飞速滚动（本次运行 Phase 1 实录）：`action=read_matches backend=api latency_ms=84 degraded=false ok=true matches=20` ×3 行；JSON envelope 弹出：`backend: "api", degraded: false` | 真机静置黑屏（待命） | 左下小字：`⚡ API 引擎：毫秒级读取` | 轻快的打字机音 |
| 8–10s | 一行日志变红闪烁：`action=read_matches backend=api … ok=false error=HTTP_403_ENDPOINT_REMOVED`；紧接着：`action=router_degrade backend=api->device degraded=true` | 真机黑屏→亮起（Hinge 图标） | 左下小字变红：`Hinge 更新了 App，接口死了` | "叮" 的错误提示音 → 心跳声起 |
| 10–18s | 日志暂停 1 秒（呼吸感），随后恢复滚动：`action=read_matches backend=device latency_ms=445 degraded=true ok=true matches=20 source=accessibility-tree` | 真机录屏：agent 打开 Hinge → 点 Matches tab → 一条条划过 matches（与左屏 20 条数据同序） | 右下小字：`👆 设备引擎接管：真机，真点击` | 心跳声渐弱，转为稳定的点击音 |
| 18–26s | envelope 弹出：`backend: "device", degraded: true`；下方小字：`60 matches read across 3 calls` | 真机继续浏览，点开一条 match 的聊天页（停 2 秒） | 无 | 环境音渐弱 |
| 26–30s | 左右屏同时暗下，中央大字字幕：**接口会变，手不会。** → 落版：`phonehands` logo + GitHub 占位 | 同左 | 大字幕即全部 | 一声干净的"嗒"（落版） |

## 台词/字幕文案（定稿）

1. 开场标题：`phonehands — 给 AI 的两只手`（EN: `phonehands — two hands for your agent`）
2. 左下标注 1：`⚡ API 引擎：毫秒级读取`（EN: `API engine: millisecond reads`）
3. 左下标注 2（红）：`Hinge 更新了 App，接口死了`（EN: `Hinge shipped an update. The endpoint died.`）
4. 右下标注：`👆 设备引擎接管：真机，真点击`（EN: `Device engine takes over: real phone, real taps`）
5. 终幕大字：`接口会变，手不会。`（EN: `APIs break. Hands don't.`）

## 与本次 mock 运行的对应关系（剪辑对照表）

| 分镜时刻 | 取自本次运行的日志行（可直接用作左屏素材） |
|---|---|
| 3–8s | `action=read_matches backend=api latency_ms=84 degraded=false ok=true matches=20` |
| 8–10s 红闪 | `action=read_matches backend=api latency_ms=82 degraded=true ok=false error=HTTP_403_ENDPOINT_REMOVED` |
| 8–10s 降级 | `action=router_degrade backend=api->device latency_ms=0 degraded=true ok=true reason=4xx_streak>=1` |
| 10–18s | `action=read_matches backend=device latency_ms=445 degraded=true ok=true matches=20 source=accessibility-tree` |
| 18–26s | envelope `backend: "device", degraded: true` ＋ `60 matches read across 3 calls` |

> 注：latency 每次运行有随机抖动（API ~60–140ms，设备 ~380–850ms），剪辑时取数值好看的一次运行即可；
> 如需固定数值，把 `BackendOptions.latencyMs` 写死后重跑。

## 实拍清单（真机部分，右屏）

- [ ] 备用 iPhone（非主力机）＋ 已登录 Hinge 的**专用测试账号**（绝不用董事长/真实用户账号）
- [ ] Mac 侧跑通 WDA（`scripts/dual-tap-doctor` 自检全绿；doctor 由 doctor 包负责人交付）
- [ ] 右屏录屏：QuickTime 镜像录制真机屏幕，1080×1920
- [ ] 左屏录制：终端跑 `node dual-demo.ts`（集成真实后端后重录），字体调大（≥18pt），403 行后期标红闪烁
- [ ] 剪辑：左右分屏 1:1，中间 2px 分隔线；终幕大字用无衬线粗体，停留 ≥2.5s
- [ ] BGM：前 8s 轻快电子，8s 后转低沉心跳，26s 落版收干净
- [ ] 发布前走四闸＋GC＋CEO 终审（公开发布红线）；**本阶段绝不 publish**

## §5 mock → real 映射（集成时替换，不改脚本结构）

| mock（本片排练版） | real（实拍/生产版） | 替换点 |
|---|---|---|
| `MockHingeApiServer` | `@phonehands/api-backend` hinge adapter（真 HTTP 客户端） | `new ApiBackend(realHingeClient)` |
| `MockWdaServer` | `@phonehands/device-backend` WDA 链路（真 USB→WDA） | `new DeviceBackend(realWda)` |
| `Router` 降级阈值 `degradeAfter4xx: 1` | 生产建议 `3`（连续 3 次 4xx 才降级，防抖动） | Router 构造参数 |
| 模拟 latency（60–140ms / 380–850ms） | 真实测量（去掉 `latencyMs` 注入即为实测） | `BackendOptions` 置空 |

脚本结构（同一脚本、同一 Router、同一 envelope）集成时**零改动**——这正是 phonehands 要讲的故事：
**换引擎不换脚本。**
