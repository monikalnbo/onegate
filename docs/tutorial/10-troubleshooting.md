# 10 故障排查总表与安全红线

前面九章都是「怎么做」，这一章是「坏了怎么办」，以及**哪些事永远不要做**。

排查的基本顺序，任何时候都适用：

```
1. 服务活着吗        curl 127.0.0.1:8787/health
2. 哪一层出错        浏览器 → nginx → 服务 → 上游
3. 看具体返回        状态码 + error.code，比用户描述准
4. 看日志            journalctl -u onegate
5. 才改配置          一次只改一处
```

## 10.1 按症状查

| 症状 | 最可能的原因 | 先做这个 |
| --- | --- | --- |
| 浏览器打不开任何页面 | 服务没起 / nginx 没起 | `curl 127.0.0.1:8787/health`；`systemctl status nginx` |
| 502 Bad Gateway | 后端不可达 | `curl 127.0.0.1:8787/health`；看 nginx error.log |
| 504 Gateway Timeout | 后端太慢或上游太慢 | 查通道超时设置、`proxy_read_timeout` |
| 登录成功，刷新就掉 | Cookie 的 `Secure` 与协议不匹配 | HTTP 下把 `COOKIE_SECURE=false`；HTTPS 下必须 `true` |
| 管理台一直 401 | 会话失效（重启过）或 Cookie 没带 | 重新登录；检查 `ADMIN_ORIGIN` |
| 登录 5 次后一直 429 | 失败锁定 300 秒 | 等 5 分钟，或换出口 IP |
| `/v1` 全部 401 | `Authorization` 没转发，或密钥不对 | nginx 加 `proxy_set_header Authorization $http_authorization;` |
| `/v1` 503 `No eligible channel` | 模型没匹配到任何通道 | 检查模型名、通道启用状态、冷却期 |
| `/v1` 502 `upstream_error` | 上游拒绝 | 通道卡片点「测试」看真实错误 |
| 流式卡很久后一次性输出 | nginx 缓冲没关 | `proxy_buffering off;` |
| 429 `concurrency_limit_exceeded` | 通道并发打满 | 调大并发上限，或加同模型通道 |
| 429 `rate_limit_exceeded` | 密钥 RPM 到了 | 看 `retry-after`；调大 RPM |
| 402 `quota_exceeded` | 密钥额度用完 | 「API 密钥」加额度，或额度上限设 0 |
| 403 `model_not_allowed` / `group_disabled` | 密钥分组限制 | 改分组模型列表 / 启用分组 |
| 保存邮件配置 403 `origin_not_allowed` | `Origin` 与 `PUBLIC_ORIGIN`/`ADMIN_ORIGIN` 不一致 | 改 `.env` 后重启 |
| 注册 503 `mail_unavailable` | 邮件没配好或没验证 | 「注册邮件」→「验证 SMTP 连接」 |
| 注册 503 `registration_unavailable` | 总开关关 / 邮件不可用 | 看 `/portal/meta` 的字段 |
| 收不到验证码 | 分层：接口 → 后台状态 → 投递 → 收件端 | 见 06 章 6.9 |
| 调用记录里成本是 0 | 模型没设价格 | 「设置」→ 模型价格 |
| 调用记录里 IP 全是 127.0.0.1 | nginx 没传 `X-Real-IP` | 加 `proxy_set_header X-Real-IP $remote_addr;` |
| 数据写不进去 | 目录属主或 `ReadWritePaths` 不对 | `chown -R onegate:onegate DATA_DIR` |
| 启动报 `EADDRINUSE` | 端口被占 | `ss -ltnp \| grep 8787` |
| 启动报 `--env-file is not supported` | Node < 20.6 | 升级 Node |
| 重启后所有人都要重新登录 | 设计如此，会话在内存里 | 正常现象 |

## 10.2 错误码速查

### 网关层（`/v1`）

| code | HTTP | 含义 | 谁的锅 |
| --- | --- | --- | --- |
| `invalid_api_key` | 401 | 密钥不存在 / 停用 | 客户端密钥 |
| `rate_limit_exceeded` | 429 | 密钥 RPM 超限 | 客户端频率 |
| `quota_exceeded` | 402 | 密钥额度用完 | 额度 |
| `concurrency_limit_exceeded` | 429 | 通道并发打满 | 容量 |
| `group_disabled` | 403 | 密钥分组停用 | 配置 |
| `model_not_allowed` | 403 | 分组不允许该模型 | 配置 |
| `no_channel` | 503 | 没通道服务该模型（消息 `No eligible channel for this model`） | 配置 |
| `upstream_error` | 502 | 上游错误 | 上游 |
| `client_closed` | 499 | 客户端提前断开 | 客户端 |

### 门户层（`/portal/*`）

| code | HTTP | 含义 |
| --- | --- | --- |
| `invalid_email` | 400 | 邮箱格式不对 |
| `invalid_password` | 400 | 密码不在 8–128 字符 |
| `email_registered` | 409 | 邮箱已有账户或待完成验证 |
| `invalid_credentials` | 401 | 邮箱或密码不正确 |
| `email_unverified` | 403 | 未完成邮箱验证 |
| `account_disabled` | 403 | 账户被停用 |
| `account_unavailable` | 403 | 账户或密钥不可用 |
| `invalid_verification_code` | 400 | 验证码格式错 / 不正确 / 没有申请 |
| `code_expired` | 400 | 验证码过期 |
| `too_many_attempts` | 429 | 同一个码错满 5 次 |
| `resend_too_soon` | 429 | 60 秒内重复发送 |
| `mail_in_progress` | 429 | 上一封还在发 |
| `rate_limited` | 429 | 小时级限流 |
| `mail_unavailable` | 503 | 邮件服务未就绪 |
| `mail_delivery_failed` | 503 | 发信失败 |
| `registration_unavailable` | 503 | 注册未开放 |
| `balance_insufficient` | 402 | 账户余额不足 |
| `model_pricing_pending` | 503 | 模型未定价 |
| `origin_not_allowed` | 403 | 来源校验失败 |
| `payment_unavailable` | 503 | 在线支付未开通 |

看到错误码先查这张表，比翻日志快。表里有、但你实际遇到的码不在这里，说明版本不同，
以代码为准。

## 10.3 三个排查误区

**误区一：把所有问题都当成「邮件没配好」。**
验证码收不到确实常常是邮件问题，但如果接口返回 `202`，邮件已经交给 SMTP 了，
再反复点「验证 SMTP 连接」没有意义，要往投递和收件端查。

**误区二：为了「先跑起来」关掉校验。**
把 `COOKIE_SECURE` 改 false、把限流注释掉、把 `Origin` 校验放宽——这些都会在事后被忘掉。
临时改动要在同一个地方记一笔，并且当天恢复。

**误区三：直接编辑 `relay.json` 修数据。**
服务把整个文件读进内存，运行中改文件，下一次写盘会覆盖你的修改，还可能写坏。
要改数据，用管理接口；接口没有的（比如删用户），用停用代替。

## 10.4 安全红线

以下每一条都对应代码里的实际机制，不是泛泛而谈。

### 红线 1：`DATA_DIR` 等于全部秘密

- `relay.json` 里有加密后的上游密钥、下游密钥哈希、账户与余额；`relay.secret` 是解密钥。
- 两者放一起，等于明文秘密包。
- 所以：目录 0700、文件 0600、备份文件 600、不进 Git、不进 `public/`、不进聊天。
- 注销一个泄露的上游密钥，比事后解释容易得多。

### 红线 2：管理员密钥等价于 root

- 它能登录管理台，能看到并改所有通道、发密钥、改价格、给账户加额。
- 至少 12 位随机；用 `openssl rand -base64 32`。
- 连续错 5 次锁 300 秒——这个锁**不要**为了「体验」去掉。
- 轮换后记得固化到会被读取的地方（见 02 章 2.3）。

### 红线 3：下游密钥只显示一次

- 创建时返回明文一次，之后只存 SHA-256 哈希，界面和导出都是 `sk-…末四位`。
- 丢了就重新建，没有找回。
- 不要在截图、日志、工单里贴完整密钥。

### 红线 4：验证码不能在日志里出现明文

- 网关本身做对了：验证码只存哈希，SMTP 调试输出关掉了。
- 但**任何旁路脚本、辅助服务、自建发码工具**都可能把 `code=` 打进日志。
  这类日志一旦泄露，等于泄露一批可用验证码。
- 自检：`grep -c 'code=' <日志文件>`，大于 0 就处理：
  去掉验证码字段 → 权限收紧到服务账号可读 → 清理历史文件。
- 排错时不要把日志里的验证码复制出去。

### 红线 5：不要把 8787 暴露到公网

- 后端只监听 `127.0.0.1`，由 nginx 转发。
- 需要时用 `ss -ltnp | grep 8787` 确认绑定地址不是 `0.0.0.0`。
- 直接把 Node 端口开在公网，等于绕过所有 TLS 和来源校验。

### 红线 6：写接口的来源校验不要放宽

- 门户的写接口、以及管理台的账户/用户分组/收款/邮件写操作，会校验 `Origin` 必须是
  `PUBLIC_ORIGIN` 或 `ADMIN_ORIGIN`。
- 这是防跨站写操作的。为了让脚本方便而放宽它，等于把这层防护关掉。
- 用脚本时正确做法是**带上正确的 `Origin` 头**，不是改服务端。

### 红线 7：不要为了测试改动生产参数

- 验证码 TTL、错误次数上限、限流阈值，都是防穷举的核心。
- 6 位数字只有 100 万种组合，去掉次数限制就能被爆破。
- 要演练就开隔离环境，或者等窗口自然过去。

### 红线 8：账户密钥和独立密钥别混用计费口径

- 账户密钥按用户余额结算，倍率走用户组；独立密钥走密钥额度，倍率是来源×密钥组。
- 给账户密钥加额度会被拒绝，这是防止「两个看不见的限额」的设计。
- 看到「账户密钥按用户余额结算」就去「用户管理」加额。

## 10.5 出问题时的最小信息集

找人帮忙或自己隔天回看时，有这几样就够了（**都不含密钥**）：

```bash
# 版本与运行状态
curl -s http://127.0.0.1:8787/health
sudo systemctl status onegate --no-pager | head -10

# 最近日志（不含请求体）
sudo journalctl -u onegate --since '30 min ago' --no-pager | tail -100

# 出问题的请求：状态码 + error.code + 时间
# 从浏览器网络面板或调用记录里取，不要贴 Authorization 头

# 环境自检（不会打印密钥）
node -v
ls -ld "$DATA_DIR"
```

贴日志前做一遍脱敏：把邮箱、域名、IP、任何 `sk-` 开头的串替换成占位符。

## 10.6 最后一页清单

- [ ] `health` 正常、服务 `active (running)`
- [ ] 管理台能登录，管理员密钥是随机的且已固化
- [ ] `DATA_DIR` 0700、文件 0600、备份已做且验证过
- [ ] 有至少两条同模型通道（或明确接受单点）
- [ ] 每个接入的模型都有价格
- [ ] HTTPS 生效，`COOKIE_SECURE=true`，`PUBLIC_ORIGIN`/`ADMIN_ORIGIN` 是真实域名
- [ ] 8787 没有暴露公网
- [ ] 邮件服务 `mail_ready=true`，能收到测试邮件
- [ ] 服务日志里没有验证码明文
- [ ] 知道升级和回滚各怎么做

回到目录：[教程首页](../README.md)。
