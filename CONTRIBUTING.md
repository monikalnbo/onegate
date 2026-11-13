# 参与开发

## 环境

- Node.js 20.6+（需要内置 `--env-file`）
- 两个依赖：`npm ci`
- 无需数据库、无需前端构建

```bash
cp .env.example .env
npm ci
npm test            # 离线冒烟测试，不访问外网
npm start           # http://127.0.0.1:8787/admin/
```

## 开发约定

- 后端是纯 ESM，无框架；改动尽量保持依赖为零增长。
- 持久化只通过 `lib/store.mjs`：任何密钥必须先加密再落盘，不得写入明文新增字段。
- 调用记录、审计、日志里不得出现完整密钥、密码、验证码或 Authorization 头。
- 前端是原生 JS，无构建步骤；新增页面需同时改 `public/app.js` 的路由/导航与 `public/views/`。
- 面向用户的文案用中文；错误信息要能指导操作，不要只写 `error`。
- 提交前跑 `npm test` 和 `npm run scan`（0 命中）。

## 提交

1. 从 `main` 开分支
2. 一个提交做一件事，说明「为什么」而不只是「改了什么」
3. PR 描述里写：改了什么、怎么验证、有无数据格式变化（需要迁移的话说明）

## 报告问题

- 功能缺陷/使用问题：开 Issue，附版本（`/health` 的 `version`）、复现步骤、预期与实际
- 安全漏洞：**不要**开公开 Issue，见 [SECURITY.md](SECURITY.md)

## 许可证

提交即表示同意以 MIT 许可发布你的贡献。
