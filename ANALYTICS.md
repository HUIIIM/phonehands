<!-- SPDX-License-Identifier: BUSL-1.1 -->

# ANALYTICS — PhoneHands 埋点政策

## 一句话：零埋点。

PhoneHands **不收集、不上传、不回传**任何使用数据。没有统计 SDK，没有崩溃上报，没有"匿名使用统计"。

## 为什么敢这么写

1. **自托管设计**：agent 跑在你自己的机器上，屏幕流和指令只走你自己的通道（headscale 自托管 / SSH 反向隧道）。`healthcheck.sh` 的中继路径验证会直接判 FAIL 任何经过第三方云中继的路径——连我们想看都看不到。
2. **审计日志在你本地**：全程审计日志写在你自己的磁盘上（设备引擎审计环已做坐标/文本/截图脱敏），不上传。
3. **更新检查**：没有自动更新电话。想升级自己 `git pull`。

## 验证方法（不信就查）

```bash
# 全仓搜网络外发：除了你显式配的 relay URL，不应有对外上报地址
grep -rniE "analytics|telemetry|tracking|segment\.|amplitude" \
  --include="*.ts" --include="*.sh" --include="*.kt" \
  packages/ adapters/ scripts/ examples/ | grep -v node_modules
# 预期：零命中（本政策的机械判据）
```

## 例外

无。本政策变更需走 release 流程并在 CHANGELOG 置顶声明——**静默加埋点视为安全事故**。
