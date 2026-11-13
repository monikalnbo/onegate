# 从零部署 OneGate

本文假设你有一台干净的 Linux 服务器（Debian/Ubuntu 命令为主），一个域名，**没有**预装任何东西。
每一步都给出可直接复制的命令。遇到问题先看最后一节「常见问题」。

部署完成后你会得到：

- `https://api.example.com/v1/...` 给客户端调用
- `https://admin.example.com/` 管理控制台（也可以和上面共用域名）
- 第一次调用会出现在「调用记录」和「审计日志」里

> 命令里的 `example.com`、`/opt/onegate`、`onegate` 用户请按自己的情况替换。

---

## 0. 你需要准备

| 项 | 说明 |
| --- | --- |
| 服务器 | 1 核 1G 起步即可；数据都在 JSON 文件里，主要吃内存 |
| 域名 | 一个即可；想让后台单独用子域就准备两个 |
| 上游 | 任意 OpenAI 兼容服务的 `base_url` 和 API Key |
| Node.js | 20.6 或更高（见下一步） |

先更新系统并装基础工具：

```bash
sudo apt update && sudo apt install -y curl ca-certificates nginx git
```

## 1. 安装 Node.js 20+

用 NodeSource 或 nvm 都行。NodeSource 更省事：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # 应显示 v20.6.0 或更高
```

如果 `node -v` 低于 20.6，`node --env-file` 不可用，`npm start` 会报错。请先升级。

## 2. 建用户与目录

不要用 root 跑服务：

```bash
sudo useradd --system --home /opt/onegate --shell /usr/sbin/nologin onegate || true
sudo mkdir -p /opt/onegate
sudo git clone <你的仓库地址> /opt/onegate
sudo chown -R onegate:onegate /opt/onegate
cd /opt/onegate
```

## 3. 安装依赖并配置

```bash
sudo -u onegate npm ci --omit=dev
sudo -u onegate cp .env.example .env
sudo -u onegate nano .env
```

`.env` 至少改这几项（其余保持默认）：

```dotenv
HOST=127.0.0.1
PORT=8787
DATA_DIR=/opt/onegate/data
RELAY_ADMIN_KEY=<用 openssl rand -base64 32 生成>
PUBLIC_ORIGIN=https://api.example.com
ADMIN_ORIGIN=https://admin.example.com
COOKIE_SECURE=true
```

生成管理员密钥：

```bash
openssl rand -base64 32
```

把输出粘贴到 `RELAY_ADMIN_KEY=` 后面（不要加引号）。然后收紧权限：

```bash
sudo chmod 600 /opt/onegate/.env
sudo chown onegate:onegate /opt/onegate/.env
```

初始化空数据目录（可选，首次启动也会自动创建）：

```bash
sudo -u onegate env DATA_DIR=/opt/onegate/data node scripts/init-data.mjs
```

## 4. 先在本机跑起来

```bash
sudo -u onegate bash -c 'cd /opt/onegate && set -a && . ./.env && set +a && node server.mjs'
```

看到 `Relay listening on 127.0.0.1:8787` 就对了。另开一个终端验证：

```bash
curl -s http://127.0.0.1:8787/health
# {"ok":true,"version":"1.0.0"}
```

按 `Ctrl+C` 停掉，接下来交给 systemd。

> 如果提示端口被占用：`sudo ss -ltnp | grep 8787`，先停掉占用进程或改 `PORT`。

## 5. 交给 systemd

```bash
sudo cp /opt/onegate/deploy/onegate.service /etc/systemd/system/onegate.service
# 若路径/用户不同，先改文件里的 WorkingDirectory / User / EnvironmentFile
sudo systemctl daemon-reload
sudo systemctl enable --now onegate
sudo systemctl status onegate --no-pager
```

看到 `active (running)` 即可。日志：

```bash
sudo journalctl -u onegate -f
```

> 注意：`onegate.service` 里写了 `ProtectHome=true` 和 `ReadWritePaths=/opt/onegate/data`。
> 如果你的 `DATA_DIR` 在别处，记得同步改 `ReadWritePaths`，否则写入会失败。

## 6. 配 nginx 和 HTTPS

先用 certbot 申请证书（nginx 插件会自动改配置，可用 `--nginx`）：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com -d admin.example.com
```

然后参考 `deploy/nginx.conf.example`，把两个 server 块里的域名和证书路径换成你的。
关键三行（流式必须）：

```nginx
proxy_buffering off;
proxy_set_header Authorization $http_authorization;
proxy_set_header X-Real-IP $remote_addr;
```

检查并重载：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

打开 `https://admin.example.com/`，应该看到登录页。
输入 `RELAY_ADMIN_KEY` 的内容，进入控制台。

## 7. 建第一个通道和密钥

### 方式 A：控制台点击

1. 左侧「来源 / 通道」→ 新建
2. 填名称、`base_url`（例：`https://api.example.com/v1`，带不带 `/v1` 都可以）、上游 API Key
3. 模型列表填上游支持的模型名，例：`gpt-4o-mini`
4. 保存。通道卡片上会显示掩码后的密钥，可点「测试」发一次探测请求
5. 左侧「API 密钥」→ 新建，记下弹出的明文（只显示一次）

### 方式 B：命令行（适合脚本化）

```bash
ADMIN=https://admin.example.com
KEY='<RELAY_ADMIN_KEY>'

# 登录，保存 Cookie
curl -s -c /tmp/onegate.cookie -X POST "$ADMIN/admin/login" \
  -H 'Content-Type: application/json' \
  -d "{\"adminKey\":\"$KEY\"}"

# 建通道
curl -s -b /tmp/onegate.cookie -X POST "$ADMIN/admin/api/channels" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "示例上游",
    "base_url": "https://api.example.com/v1",
    "api_key": "sk-your-upstream-key",
    "models": ["gpt-4o-mini"],
    "max_concurrency": 8,
    "queue_ms": 5000,
    "timeout_ms": 120000,
    "retries": 2
  }'

# 建下游密钥（返回里的 key 只出现这一次）
curl -s -b /tmp/onegate.cookie -X POST "$ADMIN/admin/api/keys" \
  -H 'Content-Type: application/json' \
  -d '{"name":"first-key","rpm":60,"quota_usd":10}'
```

## 8. 第一次 `/v1` 调用

用上一步拿到的 `sk-relay-...`：

```bash
curl https://api.example.com/v1/chat/completions \
  -H "Authorization: Bearer sk-relay-<你的密钥>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role":"user","content":"用一句话介绍你自己"}]
  }'
```

流式：

```bash
curl -N https://api.example.com/v1/chat/completions \
  -H "Authorization: Bearer sk-relay-<你的密钥>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","stream":true,"messages":[{"role":"user","content":"数到三"}]}'
```

Python SDK 只需改 `base_url`：

```python
from openai import OpenAI
client = OpenAI(base_url="https://api.example.com/v1", api_key="sk-relay-...")
print(client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "hi"}],
).choices[0].message.content)
```

## 9. 确认记录和审计

```bash
curl -s -b /tmp/onegate.cookie "https://admin.example.com/admin/api/calls?limit=5"
curl -s -b /tmp/onegate.cookie "https://admin.example.com/admin/api/audit"
```

- `calls` 里应有这次请求的 `status`、`latency_ms`、`prompt_tokens`/`completion_tokens`、`channel_name`
- `audit` 里应有 `create source`、`create key`
- 两处都不应出现完整密钥，只有 `sk-…` 加末四位

控制台对应页面：「调用记录」「审计」。

## 10. 计费设置（可选）

1. 「模型价格」页填每个模型每 1M tokens 的输入/输出/缓存价格
2. 通道的「倍率」决定该来源的成本系数
3. 「API 密钥组」可设组倍率与允许的模型
4. 门户账户用「额度」记账，可通过兑换码或在线收款充值

不设价格也能用：价格为空时成本记为 0，额度不扣减。

## 11. 备份与升级

备份（整个秘密都在里面）：

```bash
sudo tar czf /root/onegate-data-$(date +%F).tgz -C /opt/onegate data/
sudo chmod 600 /root/onegate-data-*.tgz
```

升级：

```bash
cd /opt/onegate
sudo -u onegate git pull
sudo -u onegate npm ci --omit=dev
sudo systemctl restart onegate
curl -s http://127.0.0.1:8787/health
```

回滚：`git checkout <上一个提交>` 后重新 `npm ci` 并重启；数据格式向后兼容，旧数据文件可直接使用。

## 常见问题

**`node: --env-file is not supported`**
Node 低于 20.6。升级 Node，或临时用 `export $(grep -v '^#' .env | xargs) && node server.mjs`。

**启动报 `EADDRINUSE`**
8787 被占用。`sudo ss -ltnp | grep 8787` 找到进程；或者改 `.env` 的 `PORT` 并同步改 nginx。

**登录页一直提示密钥错误**
1. `.env` 里 `RELAY_ADMIN_KEY` 是否有换行/引号？不要加引号。
2. 是否改过 `.env` 但没重启？`sudo systemctl restart onegate`。
3. 连续错 5 次会锁 5 分钟，等一会或从另一个 IP 试。

**登录成功但页面空白 / 401**
Cookie 是 `Secure` 的，必须走 HTTPS 或 `localhost`。用 IP + HTTP 访问会拿不到会话。
本地测试可临时 `COOKIE_SECURE=false`。

**`/v1` 返回 401 `Invalid API key`**
- `Authorization: Bearer` 后面不能有空格或换行
- 密钥是否被删除/停用
- 用 `/v1/models` 先确认密钥有效

**`/v1` 返回 503 `No eligible channel for this model`**
模型名没有匹配到任何启用通道。检查通道 `models` 列表里是否包含请求的 `model`，
或给通道加模型别名。

**`/v1` 返回 502 `upstream_error`**
上游拒绝了请求。用通道卡片上的「测试」按钮看具体错误；常见原因是上游 key 错、
模型名不对、上游限流。上游 401/403 属于不可重试错误，会直接返回给客户端。

**流式返回很慢或一次性吐完**
nginx 没关缓冲。确认 `proxy_buffering off;`，并且响应头里有 `X-Accel-Buffering: no`。

**429 `concurrency_limit_exceeded`**
该来源同时处理的请求到了 `max_concurrency`，排队也没排上。调大并发，或多加一个同模型通道。

**`402 Key quota exhausted`**
密钥额度用完。控制台「API 密钥」里加额度或重置用量。

**邮件验证码收不到**
控制台「邮箱验证」页填 SMTP（465 或 587），点「验证连接」，再用「发送测试邮件」。
没有配置邮件时，注册接口会明确返回「暂未开放」，不会返回假验证码。
注意云服务器通常封 25 端口，必须用 465/587 的加密连接。

**数据目录写不进去**
systemd 的 `ReadWritePaths` 与 `DATA_DIR` 不一致，或目录属主不是 `onegate`：
`sudo chown -R onegate:onegate /opt/onegate/data`。
