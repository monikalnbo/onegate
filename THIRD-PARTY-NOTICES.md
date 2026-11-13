# 第三方依赖说明

本项目自身源码以 MIT 许可发布（见 `LICENSE`）。运行时只依赖两个 npm 包，二者均为宽松许可，
可以随 MIT 项目一起分发：

| 依赖 | 版本 | 许可 | 用途 | 上游 |
| --- | --- | --- | --- | --- |
| `bcryptjs` | 3.0.3 | BSD-3-Clause | 账户密码哈希与校验 | https://github.com/dcodeIO/bcrypt.js |
| `nodemailer` | 10.5.0 | MIT-0 | 发送注册验证码与找回密码邮件 | https://github.com/nodemailer/nodemailer |

安装依赖后，各包的完整许可证文本位于 `node_modules/<包名>/LICENSE`。
前端没有使用任何 CDN、UI 框架或图表库：`public/` 下的 HTML/CSS/JS 与 Canvas 图表均为本项目自写代码。

## 源代码来源声明

本仓库代码为**独立实现**，与 New API / One API 等项目**没有代码继承关系**：
没有复制、改写或包含它们的源代码，也没有沿用其文件结构与内部接口。

功能上同类（都是 OpenAI 兼容的 API 网关），但实现选择不同：本项目的持久化是原子写入的
JSON 文件（不依赖 SQLite/PostgreSQL/Redis），前端是原生 JS + Canvas（不依赖 React 和 CDN），
运行时只有上面两个依赖。
