<!-- SPDX-License-Identifier: BUSL-1.1 -->
# Security Policy · 安全策略

## Reporting a vulnerability · 报告漏洞

**Do not open a public issue.** Use **Security → Report a vulnerability** on
this repository; the report stays private between you and the maintainer.
If private reporting is unavailable, use the contact links on
[vertciti.com](https://vertciti.com).

**不要开公开 issue。** 请在本仓库 **Security → Report a vulnerability** 私下提交；
私密报告不可用时，走 [vertciti.com](https://vertciti.com) 上的联系方式。

- First response within 48 hours · 48 小时内首次回复
- No substantive response within 6 business days → escalated to the founder · 6 个工作日无实质回复即升级给创始人
- Credit in the fix notes if you want it · 修复说明里可署名致谢

## In scope · 重点范围

phonehands drives real phones, so these matter most:

- Anything that lets someone other than the owner control a phone: the WDA
  tunnel (`scripts/remote-topology/`), the Android relay
  (`packages/android-backend`), the helper APK (`packages/android-helper`).
- Secrets or personal data leaving the machine or landing in logs
  (session files, auth tokens, phone numbers, screen frames, accessibility text).
- Read-only build bypasses: any write-tier action reachable in a
  `PHONEHANDS_READ_ONLY=1` build.
- Supply chain: unpinned downloads or actions, dependency vulnerabilities.

## Supported versions · 支持版本

Only `main` (v0.1.0, unreleased) receives fixes.
