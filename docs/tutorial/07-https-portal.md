# 07 域名、证书与对外门户

到这里所有东西都还只在 `127.0.0.1` 上。这一章把它挂到域名后面、上 HTTPS，
并纠正两个最常见的配置错误（Cookie 和安全来源）。

## 7.1 先决定用几个域名

| 方案 | 域名 | 适合 |
| --- | --- | --- |
| 一个域名 | `example.com` 同时放 API 和 `/admin/` | 自己用、人少 |
| 两个域名 | `example.com` 放 API/门户，`admin.example.com` 放管理台 | 推荐；管理台可以加 IP 白名单 |

两种都能用，差别只在 nginx 的 server 块数量和 `.env` 里的两个地址。

下面按「两个域名」写，一个域名的做法就是把 `admin` 那一段合并掉。

## 7.2 先把 DNS 指过来

现在做什么：在域名服务商那里加 A 记录（IPv6 就加 AAAA）。

```
example.com        A   <你的服务器 IPv4>
admin.example.com  A   <你的服务器 IPv4>
```

看到什么算成功：在你自己的电脑上：

```bash
dig +short example.com
dig +short admin.example.com
```

两个都返回你的服务器 IP。

失败了先查什么：刚加的记录要等 TTL（常见 10 分钟到几小时）；`dig` 返回空说明还没生效，
返回了别的 IP 说明改错了记录或还有旧的泛解析。

## 7.3 申请证书

现在做什么：用 certbot 的 nginx 插件，它会自动改配置。

```bash
sudo certbot --nginx -d example.com -d admin.example.com
```

按提示填邮箱、同意条款、选择是否跳转 HTTPS（选跳转）。

看到什么算成功：`/etc/letsencrypt/live/example.com/` 下有 `fullchain.pem` 和 `privkey.pem`；
浏览器打开 `https://example.com/` 有小锁。

失败了先查什么：

| 报错 | 原因 |
| --- | --- |
| `dns problem` / challenge failed | DNS 还没生效，回 7.2 |
| `too many failed authorizations` | 短时间内重试太多次，等一小时 |
| 80 端口不通 | 防火墙/安全组没放行 80；certbot 校验需要它 |
| `nginx: configuration file test failed` | 先修 nginx 配置再申请 |

> 证书 90 天有效，certbot 会装定时续期。验证续期：`sudo certbot renew --dry-run`。

## 7.4 改 nginx 配置

现在做什么：参考仓库里的 `deploy/nginx.conf.example`，把域名和证书路径换成你的。

最关键的三行，少了任何一行都会出问题：

```nginx
proxy_buffering off;
proxy_set_header Authorization $http_authorization;
proxy_set_header X-Real-IP $remote_addr;
```

- `proxy_buffering off`：流式输出（SSE）不被缓冲，否则会「卡很久然后一次性吐完」。
- `Authorization` 原样转发：不转发的话所有 `/v1` 请求都会 401。
- `X-Real-IP`：调用记录里的 IP 靠它，否则全是 `127.0.0.1`。

另外 `proxy_read_timeout` 要够长（示例给 600s），不然长回答会被 nginx 掐断。

检查并重载：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

看到什么算成功：`nginx -t` 输出 `syntax is ok` 和 `test is successful`。

失败了先查什么：`nginx -t` 不过就**不要** reload，按报错的行号改；
常见是证书路径写错、`server_name` 重复、漏了分号。

## 7.5 改 `.env` 里的两个地址（这一步最容易漏）

现在做什么：编辑 `.env`。

```dotenv
PUBLIC_ORIGIN=https://example.com
ADMIN_ORIGIN=https://admin.example.com
COOKIE_SECURE=true
```

然后重启：

```bash
sudo systemctl restart onegate
```

这三个值不是装饰：

1. **`PUBLIC_ORIGIN` / `ADMIN_ORIGIN`** 是所有写接口的来源白名单。
   浏览器发请求时会带 `Origin`，服务端只接受这两个值。留成 `http://127.0.0.1:8787`
   的话，门户注册、邮箱配置、给用户加额这些操作会返回 403 `origin_not_allowed`。
2. **`COOKIE_SECURE=true`** 让 Cookie 只在 HTTPS 下发送。
   线上如果还是 `false`，安全性打折；反过来，如果你在 HTTP 下设了 `true`，
   登录成功也会立刻掉回未登录。

看到什么算成功：浏览器打开 `https://admin.example.com/admin/` 能登录，刷新后仍然是登录状态。

失败了先查什么：

| 现象 | 原因 |
| --- | --- |
| 登录成功，刷新就退出 | `COOKIE_SECURE=true` 但实际走的是 HTTP，或反代没传 `X-Forwarded-Proto` |
| 保存邮件/注册设置 403 `origin_not_allowed` | `Origin` 带的是新域名，但 `.env` 还是旧值，或改完没重启 |
| `/v1` 401 但密钥没错 | nginx 没转发 `Authorization` 头 |
| 调用记录里 IP 全是 127.0.0.1 | 没传 `X-Real-IP` |

## 7.6 验证对外可用

现在做什么：全部用公网地址测一遍。

```bash
curl -s https://example.com/health
curl -s -o /dev/null -w '%{http_code}\n' https://admin.example.com/admin/
curl -s https://example.com/v1/models -H "Authorization: Bearer sk-relay-你的密钥"
```

看到什么算成功：

- `health` 返回 `{"ok":true,...}`
- 管理台返回 `200`（会先给登录页）
- `/v1/models` 返回模型列表

失败了先查什么：

| 现象 | 先查 |
| --- | --- |
| 502 Bad Gateway | 后端没起：`curl http://127.0.0.1:8787/health`；起来了就是 nginx `proxy_pass` 地址不对 |
| 504 | 超时，看 `proxy_read_timeout` |
| 静态页面能开但接口全 401 | `Authorization` 头没转发 |
| 一直 301 循环 | `PUBLIC_ORIGIN` 的协议和实际不一致，或 nginx 强制跳转配置冲突 |

## 7.7 关于「对外门户」

需要说清楚一件事：**开源仓库提供的是门户接口，没有自带的门户前端页面。**

`public/` 目录里只有管理台（`/admin/`）。用户注册、登录、看余额、管理自己的密钥，
是通过 `/portal/*` 这组接口完成的；仓库里没有 `public/portal/` 这样的页面。

接口清单（都在 `lib/portal.mjs` 里可以核对）：

| 路径 | 作用 |
| --- | --- |
| `GET /portal/meta` | 公开的注册/计费状态：`mail_ready`、`registration_mode` 等 |
| `POST /portal/register` | 注册（行为随注册方式不同，见 06 章） |
| `POST /portal/resend` | 重发验证码 |
| `POST /portal/verify` | 提交验证码 |
| `POST /portal/login` / `logout` | 登录 / 退出 |
| `POST /portal/forgot` / `reset` | 找回密码 |
| `GET /portal/me` | 当前账户 |
| `GET/POST /portal/keys`、`PATCH/DELETE /portal/keys/:id` | 自己的密钥 |
| `GET /portal/usage`、`/portal/ledger` | 用量与余额流水 |
| `POST /portal/redeem` | 兑换码 |
| `PUT /portal/password` | 改密码 |

所以你有两个选择：

1. **只用管理台 + 管理员发密钥**：完全够用，不涉及门户。
2. **自己写/接一套前端页面**，调上面这些接口。

如果你在某套部署里见过完整的注册页、登录页，那属于那份部署自己的前端，**不在本仓库里**，
本教程不把它写成步骤（属于「未核实」）。

先确认门户接口是通的：

```bash
curl -s https://example.com/portal/meta
```

看到什么算成功：返回里有 `mail_ready`、`registration_mode`、`registration_enabled`、
`billing_ready`、`currency` 等字段。

失败了先查什么：404 → 路径被反代吞了（`PUBLIC_BASE_PATH` 或 nginx `location` 写错）；
500 → 看服务日志。

## 7.8 子路径部署（可选）

如果整个网关要挂在 `https://example.com/gateway` 下：

1. `.env` 里设 `PUBLIC_BASE_PATH=/gateway`（这个值目前用于生成支付回调地址）。
2. nginx 里 `location /gateway/ { proxy_pass http://127.0.0.1:8787/; }`（注意末尾斜杠）。
3. `PUBLIC_ORIGIN` 仍然写 `https://example.com`（源站，不带路径）。

> 服务端会主动把路径开头的 `/relay` 前缀剥掉——这是为了兼容一套历史部署的路径。
> 换句话说，`/relay/portal/meta` 和 `/portal/meta` 都能命中同一个接口。
> 你的站点若**不是**挂在 `/relay` 下，这个行为对你没有影响；
> 但你若真的用了 `/relay` 作为子路径，不需要额外配置。

看到什么算成功：`curl https://example.com/gateway/health` 返回 `ok`。

失败了先查什么：`proxy_pass` 末尾少了 `/` 会把整个原始路径带过去，变成 `/gateway/health` 找不到。

## 7.9 管理台加固（强烈建议）

管理台等价于 root，多花五分钟值得：

```nginx
server {
    server_name admin.example.com;
    # 只允许你的出口 IP
    allow 203.0.113.10;    # 换成你的 IP（示例段）
    deny all;
    # ... 其余同前
}
```

另外：

- 管理台只走 HTTPS；`ADMIN_ORIGIN` 写 `https://` 开头。
- 管理员密钥至少 12 位，用 `openssl rand -base64 32` 生成。
- 不要和门户共用同一个域名后缀下的路径，除非你清楚两边 Cookie 的作用域。

看到什么算成功：非白名单 IP 访问管理台得到 403，你自己的 IP 正常。

失败了先查什么：把自己也锁在外面了 —— 通过服务器本机 `curl 127.0.0.1:8787/admin/`
确认服务正常，再改 nginx 白名单。**改白名单前先确认你的出口 IP 是固定的。**

## 本章验收

- [ ] `https://example.com/health` 返回 `ok`
- [ ] 管理台用域名能登录，刷新不掉登录
- [ ] `.env` 里 `PUBLIC_ORIGIN`、`ADMIN_ORIGIN` 是真实域名，`COOKIE_SECURE=true`
- [ ] `/v1/chat/completions` 经域名调用成功，流式不会一次性吐完
- [ ] 调用记录里的 IP 是真实客户端 IP，不是 127.0.0.1
- [ ] `curl https://example.com/portal/meta` 有返回

下一章：[08 备份与恢复](08-backup-restore.md)。
