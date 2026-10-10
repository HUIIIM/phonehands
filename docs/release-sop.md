<!-- SPDX-License-Identifier: BUSL-1.1 (pending GC final review) -->

# PhoneHands Release SOP

> 来自《PhoneHands 发布文档 checklist》Part B。学 iPhone Use：每次发布都是一次交付仪式。

## 版本号：心跳规则

- semver。0.x 阶段：**每天 1 个有用户可见变化的版本**。
- 版本号即心跳：没东西可发就写"今日无用户可见变化"，不硬发。
- **不为凑数发版**；不把 commit message 直接当 changelog。

## Changelog 三段式（中文口语）

每个 release 正文必须三段，缺一段不发：

1. **改了什么**——用户语言（例："安卓端现在不用插线了，同 WiFi 自动连"）。
2. **验证**——测试证据（例："验证：212 项单元测试、mock WDA 集成测试、真机复测通过"）。
3. **升级指引**——用户要做什么（例："git pull 后重跑 scripts/doctor.sh"）。

正文落盘位置：`CHANGELOG.md` 对应版本条目。

## 发布机械清单（逐项打勾）

- [ ] CHANGELOG.md 同步写（三段式）
- [ ] 测试全绿（覆盖率 ≥80% 门禁：TS 用 `c8 --check-coverage --lines 80`）
- [ ] BSL header 抽查（新文件）：`SPDX-License-Identifier: BUSL-1.1 (pending GC final review)`
- [ ] THIRD_PARTY_NOTICES.md：有新增依赖就更新
- [ ] 打 tag → GitHub Release（粘贴三段式正文）→ 发版
- [ ] 发版后 1 小时内：Discord #releases 公告＋X 一条（如有用户可见变化）

## 明确拒绝

- 不为凑数发版。
- 不把 commit message 直接当 changelog。
- 没过测试门禁不打 tag。
- BSL header 缺失的文件不进 release。
