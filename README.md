# OneGate

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**自建 OpenAI 兼容 AI 网关 + 管理后台。** 用一个地址、一套密钥，把多个上游模型来源收拢到一处，
并且把「谁用了多少、花了多少、什么时候改过配置」记清楚。

> English summary: A self-hosted, OpenAI-compatible AI gateway with an admin console,
> per-key billing ledger, and audit trail. Zero framework, two runtime dependencies,
> JSON-file persistence. Read the Chinese sections below for setup; `DEPLOY.md` is the
> step-by-step deployment guide. Independently implemented — no code lineage from New API.

---

## 这是什么

你有一堆上游（官方 API、代理、不同账号），客户端却只想要一个 `base_url`。
OneGate 夹在中间：

```
客户端 SDK / 应用
      │  Authorization: Bearer sk-relay-…
      ▼
  ┌───────────────┐   加权轮询、失败切换、并发闸门
  │    OneGate    │──────────────────────────────► 上游 A（官方）
  │  /v1/*  网关  │──────────────────────────────► 上游 B（代理）
  └───────┬───────┘──────────────────────────────► 上游 C（备用）
          │
          ├─ 调用记录：状态码、延迟、首字时间、token、成本
          ├─ 审计：谁在什么时候改了通道/密钥/价格
          └─ 管理台 /admin/：通道、模型、密钥、用户、账本
```

支持 `/v1/models`、`/v1/chat/completions`、`/v1/embeddings`、`/v1/responses`，
对话与 Responses 都支持 SSE 流式。

## 和你听过的那些网关是什么关系

功能定位与 New API、One API 一类项目相同：OpenAI 兼容的多上游网关。

**本项目是独立实现，与 New API 无代码继承关系**：没有复制或改写它们的代码，也没有沿用其
文件结构。实现上的差别是刻意的——

| | OneGate | 常见的 New API 系部署 |
| --- | --- | --- |
| 运行时依赖 | 2 个（bcryptjs、nodemailer） | 通常需要 Go 后端 + 前端构建 + 数据库 |
| 持久化 | 原子写入的 JSON 文件 | MySQL/PostgreSQL + Redis |
| 前端 | 原生 JS + Canvas，无 CDN、无框架 | React / Semi UI 等 |
| 部署 | `node server.mjs` 或一个 systemd 单元 | Docker Compose + 数据库 + 缓存 |

这不是说谁更好：数据量大、需要多副本时，带数据库的方案更合适；只想在一台机器上跑、
希望备份就是拷贝一个目录时，这个项目更省事。选择取决于你的场景。

## 功能

**上游与路由**
- 多通道（来源），每个来源独立配置 `base_url`、密钥、模型列表、权重、启用状态
- 同一模型多通道加权轮询；通道失败进入冷却并自动切到下一个（最多 3 次尝试）
- 模型别名（客户端名 → 上游真实名），适配不同厂商的模型命名
- 反代适配：`path_prefix` 子路径、自定义请求头、`/v1` 去重
- 上游没返回 `usage` 时按文本长度估算，避免账目漏记
- 错误归一化成 OpenAI 风格的 `error.message/type/code`

**限流与保护**
- 来源级并发上限（1–512）、排队等待（最长 60s）、排队上限（1000），超限返回 429 `concurrency_limit_exceeded`
- 每个下游密钥的 RPM 限制
- 密钥额度（美元额度、用完即 402）
- 通道超时（1–600s）与失败重试（0–2 次）
- 管理员登录连续失败锁定（5 次 / 5 分钟）

**计费**
- 模型价格表（每 1M tokens 的输入/输出/缓存价）
- 来源倍率（0.01–100）× 密钥组倍率，独立密钥按此计费
- 账户密钥走门户账本：预扣额度 → 结算 → 余额流水，不会被重复计费
- 兑换码充值；可选的易支付风格在线收款（MD5 验签）

**账户门户（`/portal/*` 接口）**
- 邮箱验证码注册 / 邮箱密码注册、找回密码（验证码 10 分钟有效）
- 账户余额、额度流水、密钥自助管理、调用用量
- 邮件服务未配置时会明确提示「注册暂未开放」，不会返回假验证码

**运维与安全**
- 上游密钥、SMTP 密码、支付商户密钥使用 AES-256-GCM 加密落盘，密钥来自 `data/relay.secret`
- 管理台只显示掩码（`sk-…abcd`），导出同样掩码
- 下游密钥只存 SHA-256 哈希，明文仅在创建时返回一次
- 调用记录不含请求头与密钥明文；审计日志不含密钥内容
- 操作审计最多保留 500 条，调用记录默认 20000 条 / 90 天（可配）

## 目录结构

```
server.mjs              HTTP 入口：路由、/v1 代理、管理 API、静态资源
lib/
  store.mjs             JSON 持久化（原子写、字段级加密）
  auth.mjs              管理员会话、密钥哈希与校验、RPM
  channels.mjs          通道选择（加权轮询）与冷却
  limits.mjs            来源级并发闸门与排队
  upstream.mjs          上游请求、URL 拼装、错误归一、usage 估算
  pricing.mjs           价格表与用量估价
  portal.mjs            账户门户、账本、预扣/结算
  payments.mjs          在线收款（可选）
  mail.mjs              SMTP 配置、验证码邮件
  calllog.mjs           调用记录（结构化账本）
  metrics.mjs           按小时的指标桶
  logs.mjs              最近请求环形缓冲
public/                 管理台前端（原生 JS，无构建步骤）
  views/*.js            各页面模块
config/                 价格表与来源配置示例 JSON
scripts/                数据目录初始化、演示数据
deploy/                 systemd 单元与 nginx 示例
test/                   mock 上游与离线冒烟测试
tools/scan-secrets.sh   发布前敏感信息扫描
```

## 快速开始（5 分钟）

要求：Node.js **20.6+**（需要内置 `--env-file` 支持）。

```bash
git clone <你的仓库地址> onegate
cd onegate
cp .env.example .env          # 按注释填写；至少改 RELAY_ADMIN_KEY
npm ci
node scripts/init-data.mjs    # 建空数据目录（可选，首次启动也会自动建）
npm start
```

浏览器打开 `http://127.0.0.1:8787/admin/`，用 `.env` 里的 `RELAY_ADMIN_KEY` 登录。

> 若 `RELAY_ADMIN_KEY` 留空，首次启动会生成一个随机密钥，写入 `data/admin.key`
> 并在终端**只打印一次**——请立刻保存。

想先看效果、不想接真实上游：

```bash
# 终端 1：本地 mock 上游（不联网、不花钱）
node test/mock-upstream.mjs
# 终端 2：写入演示通道/密钥/价格/公告
DATA_DIR=./data node scripts/seed-demo.mjs
# 终端 2：启动网关
npm start
```

用演示脚本打印的密钥调用一次：

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer <演示密钥>" \
  -H "Content-Type: application/json" \
  -d '{"model":"mock-gpt","messages":[{"role":"user","content":"hi"}]}'
```

### Docker Compose（可选）

```bash
cp .env.example .env      # 填 RELAY_ADMIN_KEY / PUBLIC_ORIGIN / ADMIN_ORIGIN
docker compose up -d --build
docker compose logs -f
```

容器以非 root 用户运行，端口只绑定 `127.0.0.1:8787`，数据落在 `./data`。
首次启动前确保 `./data` 对容器内 uid 1000 可写：`mkdir -p data && sudo chown -R 1000:1000 data`。

容器内端口固定为 `8787`（compose 里显式设了 `PORT=8787`），`.env` 的 `PORT` 只影响宿主机直接
`node server.mjs` 的运行方式；对外端口请改 compose 里 `"127.0.0.1:8787:8787"` 的左边。
若 `docker compose up --build` 提示缺少 buildx（老版本 compose），先手动构建再启动：

```bash
docker build -t onegate:local .
docker compose up -d
```

完整部署（域名、TLS、systemd、nginx、首个真实通道、故障排查）见 **[DEPLOY.md](DEPLOY.md)**。

## 安全说明

- **数据目录就是全部秘密**：`data/relay.json`（加密后的上游密钥、密钥哈希、账户、账本）、
  `data/relay.secret`（加密主密钥）、`data/admin.key`（管理员密钥）。权限 0600/0700。
  **备份这一个目录 = 备份整个网关；泄露它等于泄露全部密钥。**
- 后端默认只监听 `127.0.0.1`，由 nginx 对外。不要把 8787 直接暴露到公网。
- 生产必须使用 HTTPS。门户会话 Cookie 带 `Secure`；只有本地纯 HTTP 实验才设置
  `COOKIE_SECURE=false`。
- 管理员密钥等价于 root：长度至少 12 位，建议 `openssl rand -base64 32`，并定期轮换
  （控制台「设置」页可轮换）。
- 管理台建议放在独立子域并加 IP 白名单（`deploy/nginx.conf.example` 有示例注释）。
- 本项目不做内容审核，不代理任何上游账号的合规责任；请按上游服务条款使用。

## 配置

全部通过环境变量，完整清单见 [`.env.example`](.env.example)：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | 监听地址 |
| `DATA_DIR` | `./data` | 数据目录 |
| `RELAY_ADMIN_KEY` | 自动生成 | 管理员密钥 |
| `PUBLIC_ORIGIN` | `https://example.com` | 客户侧访问源（Origin 校验、邮件链接） |
| `ADMIN_ORIGIN` | `https://admin.example.com` | 管理台访问源 |
| `PUBLIC_BASE_PATH` | 空 | 反代子路径，如 `/gateway` |
| `COOKIE_SECURE` | `true` | 纯 HTTP 本地测试时才设 `false` |
| `RELAY_CALL_ROWS` | `20000` | 调用记录条数上限 |
| `RELAY_CALL_RETENTION_DAYS` | `90` | 调用记录保留天数 |
| `PORTAL_CODE_TTL_SECONDS` | `600` | 邮箱验证码有效期 |

价格表与来源也可以用 `config/*.example.json` 的格式通过管理 API 导入。

## 测试

```bash
npm test          # 离线冒烟：mock 上游 + 临时数据目录 + 非特权端口
npm run scan      # 发布前敏感信息扫描，必须 0 命中
```

`npm test` 会真实启动进程并走完「登录 → 建通道 → 建密钥 → 普通/流式调用 → 查记录 → 查审计」，
不需要任何真实上游密钥。

## 许可证与来源

- 本项目代码：[MIT](LICENSE)。把 `LICENSE` 里的 `<你的名字/组织>` 换成你自己。
- 第三方依赖：见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)（BSD-3-Clause / MIT-0，均为宽松许可）。
- 独立实现，与 New API 无代码继承关系；详见第三方说明中的「源代码来源声明」。

## 参与

见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。
