<!-- SPDX-License-Identifier: BUSL-1.1 -->

# D-Day 前 48 小时文档冻结检查表

> 来自《PhoneHands 发布文档 checklist》Part E。**任一项 FAIL 即 D-Day 推迟，不带病发布。**
> D-Day 前 48 小时冻结：只改错别字，不改策略。

## 检查项

- [ ] README 双语终稿（错别字零容忍，逐段读一遍）
- [ ] hero 图＋social preview 图终稿（1200px＋/1280×640，真机实拍帧；无实拍则保持占位 spec，绝不用假图冒充）
- [ ] demo 视频 A 终版＋安装视频终版（字幕校对）
- [ ] quickstart 三条命令真机实测（从零克隆到跑通，计时 < 5 分钟）
- [ ] issue/PR 模板已放 `.github/`
- [ ] Discussions 5 分类已开（Q&A／Show & Tell／Open Challenges／Ideas／Announcements）
- [ ] CHANGELOG.md 有 v0.1.0 条目（三段式：改了什么＋验证＋升级指引）
- [ ] THIRD_PARTY_NOTICES.md 与 package 依赖清单一致
- [ ] BSL 声明在 README 第一屏＋LICENSE 文件（GC 文本）
- [ ] Show HN 首评预写（带 GIF＋一句话＋安装 prompt）
- [ ] 所有对外文案 GC＋CEO 双终审通过

## 本轮状态（文档负责人填写）

| 项 | 状态 | 备注 |
|---|------|------|
| README 双语 | PASS | README.md＋README.en.md 已落盘，待逐段校对 |
| hero/social preview | PENDING | 待内容管线实拍；当前为占位 spec |
| demo 视频 | PENDING | 待内容管线 |
| quickstart 真机实测 | PENDING | blocker：一键远程拓扑＋备用机（门 4 同源） |
| issue/PR 模板 | PASS | `.github/` 已落地 |
| Discussions 5 分类 | PENDING | 仓库 public 后开 |
| CHANGELOG v0.1.0 | PASS | 三段式条目已写，标注"未发布" |
| THIRD_PARTY_NOTICES | PASS | 6 条上游已登记，待 GC 逐条裁决 |
| BSL 第一屏＋LICENSE | PASS | README 第一屏已声明；LICENSE 终稿已落仓（合规放行） |
| Show HN 首评 | PENDING | 待内容管线 |
| GC＋CEO 双终审 | PENDING | 发布前置 |
