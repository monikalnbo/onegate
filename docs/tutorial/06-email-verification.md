# 06 注册与邮箱验证

这一章解决两件事：**允许谁自己注册**，以及**注册时怎么证明邮箱是他的**。
它比前面几章长，因为这里出错时用户只会说「收不到验证码」，你得自己会分层排查。

先看一句结论：**邮件服务没配好并验证过，注册接口会明确返回「暂未开放」，不会返回假验证码。**
所以「注册不能用」几乎总能从接口返回里一眼定位。

## 6.1 先分清四个东西

| 名字 | 是什么 | 在哪改 |
| --- | --- | --- |
| 注册总开关 `registration_enabled` | 允不允许注册 | 默认开；接口可关，见 6.4 |
| 注册方式 `registration_mode` | 验证码注册 / 直接注册 | 只能调接口改，见 6.4 |
| 邮件服务（SMTP） | 验证码从哪发出去 | 控制台「客户服务 → 注册邮件」 |
| `mail_ready` | 邮件服务是否**真正可用** | 由上面配置 + 一次成功验证共同决定 |

注册能不能用，取决于：总开关开着，且「邮件可用」或「注册方式不需要邮件」。

## 6.2 两种注册方式

| | `email_code`（默认） | `email_password` |
| --- | --- | --- |
| 用户填什么 | 邮箱 + 密码 → 收验证码 → 填验证码 | 邮箱 + 密码 |
| 要不要邮件服务 | **要**，不可用就注册不了 | 不要 |
| 注册返回 | **202**，`{"ok":true,"email":"...","requires_verification":true}`，**不下发登录 Cookie** | **201**，直接 `Set-Cookie: portal_session=...` |
| 能不能立刻用 | 不能，验证通过（**200** + Cookie）才行 | 能 |
| 未验证账号登录 | 403 `email_unverified`「请先完成账户邮箱验证」 | 不存在这个状态 |

`email_password` 模式下，账号创建即「可用」（`active=true`、密码已就绪），
所以 `email_unverified` 那道拦截不会触发——这是代码里的真实行为。

> 密码要求：**8 至 128 个字符**（服务端强制）。你如果见过「至少 10 位」的提示，
> 那是某套前端页面的文案；接口本身只要求 8 位，见 6.11 的差异清单。

## 6.3 改之前先备份

`relay.json` 里不只有配置，还有用户、验证记录、限流计数。改注册方式前先留一份。

```bash
sudo systemctl stop onegate
sudo -u onegate cp -a /opt/onegate/data/relay.json \
  "/opt/onegate/data/relay.json.bak-$(date +%Y%m%d-%H%M%S)"
sudo chmod 600 /opt/onegate/data/relay.json.bak-*
sudo systemctl start onegate
```

看到什么算成功：`ls -l /opt/onegate/data/relay.json.bak-*` 能看到文件且权限是 600。

失败了先查什么：备份文件属主不是 `onegate`，后面服务会写不动——用 `chown onegate:onegate` 修正。

> **为什么要停服务**：服务把整个数据文件读进内存，运行中直接替换文件，下一次写盘会覆盖你的修改，
> 甚至写坏文件。要么停服务再动文件，要么只调接口（推荐）。

## 6.4 切换注册方式：只有接口，没有页面开关

控制台左侧「客户服务 → 注册邮件」只管**发信配置**，页面里**没有**「注册方式」的下拉框。
这一点在仓库前端代码里可以核实：搜不到任何 `registration_mode` 控件。

所以只能调接口。先登录拿 Cookie：

```bash
ADMIN=https://admin.example.com
curl -s -c /tmp/onegate.cookie -X POST "$ADMIN/admin/login" \
  -H 'Content-Type: application/json' \
  -d '{"adminKey":"<你的管理员密钥>"}'
```

看到什么算成功：返回 `{"ok":true}`，`/tmp/onegate.cookie` 里出现 `relay_session`。

看一眼当前设置：

```bash
curl -s -b /tmp/onegate.cookie "$ADMIN/admin/api/portal-settings"
```

看到什么算成功：返回里有 `mailReady`、`registration_mode`、`registration_enabled`、`billing_currency`。

切换成「邮箱验证码」：

```bash
curl -s -b /tmp/onegate.cookie -X PUT "$ADMIN/admin/api/portal-settings" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://admin.example.com' \
  -d '{"registration_mode":"email_code"}'
```

切换成「直接注册」：

```bash
curl -s -b /tmp/onegate.cookie -X PUT "$ADMIN/admin/api/portal-settings" \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://admin.example.com' \
  -d '{"registration_mode":"email_password"}'
```

看到什么算成功：返回 200 和更新后的设置对象，`registration_mode` 立刻变成新值，**不需要重启**。

失败了先查什么：

| 返回 | 原因 |
| --- | --- |
| 403 `origin_not_allowed`「请求来源校验失败」 | `Origin` 头没带，或值不等于 `PUBLIC_ORIGIN` / `ADMIN_ORIGIN` |
| 403 `admin_required` | Cookie 没带上或已过期，重新登录 |
| 400 `invalid_portal_settings`「账户设置包含无效字段」 | 传了白名单以外的字段。只接受 `billing_currency`、`credit_unit_cny`、`registration_mode` |
| 400 `invalid_registration_mode` | 值不是 `email_code` 或 `email_password` |
| 400 `invalid_billing_currency` | 币种和额度单位必须**同时**设（`CNY` + `1`）或**同时**清空（`null` + `null`） |

回滚：再调一次接口切回去，不用停机。

> **`Origin` 校验的范围，别记错。** 它只作用于门户的写接口和管理台的**账户/用户/收款/邮件**这几类写操作。
> 渠道、密钥、价格这些管理写操作只校验登录会话。所以「所有管理接口都要 Origin」是不对的。

## 6.5 配 SMTP：五个字段 + 一次验证

控制台 →「客户服务 → 注册邮件」，卡片标题是「邮箱验证服务」，副标题写着
「注册验证码和找回密码由此服务真实发送。」

| 界面字段 | 填什么 |
| --- | --- |
| SMTP 服务器 | 服务商给的 SMTP 主机名，例如 `smtp.example.com` |
| 连接方式 | 只有 `465 · 加密连接` 和 `587 · STARTTLS` 两项 |
| 用户名 | 服务商要求的 SMTP 用户名 |
| 密码 / 授权码 | 服务商生成的 SMTP 密码。保存后不回显，留空表示保持原值 |
| 发件邮箱 | 必须是已在服务商那边验证过的域名下的地址 |
| 发件人名称 | 收件人看到的显示名 |
| 启用 | 勾上才会真正发信 |

端口和加密方式是绑定的：465 = 隐式 TLS，587 = STARTTLS。
选错会在保存时直接报「SMTP 仅支持 465 加密连接或 587 STARTTLS。」
不支持 25 端口——云服务器基本也封了 25。

填完点「保存配置」。看到什么算成功：提示「配置已保存，请验证连接」。

### 然后必须点「验证 SMTP 连接」

这一步不发信，只做加密连接和身份认证。看到什么算成功：提示「SMTP 连接与身份验证通过」，
页面右上角徽标从「待配置或验证」变成「可用」。

### `mail_ready` 的四个条件

`mail_ready` 不是「填了配置」，而是四条同时成立：

1. `enabled === true`
2. host / port / username / password / from 都齐全且格式合法
3. 有过一次成功的连接验证（`last_verified_at` 非空）
4. 当前配置指纹与验证时一致

**第 4 条是最容易踩的坑**：改任何一项（哪怕只改「发件人名称」或换端口），
`mail_ready` 立刻变 false，必须重新点一次「验证 SMTP 连接」。
「昨天还好好的，今天注册就不能用」通常就是这个。

看到什么算成功：点「发送测试邮件」发到自己的邮箱，提示「测试邮件已交给 SMTP 服务，请检查收件箱」。

失败了先查什么：见 6.9 的表。

## 6.6 发信链路与发信域名

链路很短：

```
浏览器 → POST /portal/register
        → 服务端生成 6 位验证码，只存哈希
        → lib/mail.mjs 用 nodemailer 连你的 SMTP（465 或 587）
        → 邮件服务商 → 收件方邮箱
```

验证码相关的事实（都在代码里）：

- 6 位纯数字，**有效期默认 600 秒**（`PORTAL_CODE_TTL_SECONDS`，默认 600）
- 只存 SHA-256 哈希，**不存明文**
- **一次性**：用过即失效
- 60 秒内不能重发（`resend_too_soon`）
- 同一个码错 5 次后，第 6 次起返回 429 `too_many_attempts`
- 验证码不会显示在页面上

### 发信域名要配的三类 DNS

要让邮件不被判垃圾，发件域名通常需要这些记录。**具体值一律以你的邮件服务商面板为准**，
不要抄别人的。

| 记录 | 作用 | 大致形态 |
| --- | --- | --- |
| DKIM（TXT） | 给邮件签名 | `selector._domainkey.example.com TXT "v=DKIM1; p=<公钥>"` |
| SPF（TXT） | 声明谁有权替你发信 | `send.example.com TXT "v=spf1 include:<服务商> ~all"` |
| DMARC（TXT） | 规定验证失败怎么办 | `_dmarc.example.com TXT "v=DMARC1; p=none;"` |
| 返回路径（CNAME 或 MX） | 接收退信 | 服务商面板会给出 |

建议 DMARC 先用 `p=none` 只观察，跑一段时间确认通过率后再收紧到 `quarantine`。

看到什么算成功：服务商面板里域名状态变成「已验证」；你能用这个域名下的地址发出测试信。

失败了先查什么：DNS 生效要几分钟到几小时，`dig` 查不到就先等；查得到但对不上，逐字符比对
（TXT 记录常常被拆成多段引号，粘贴时容易多空格）。

> **未核实（1）**：你的邮件服务商后台里该域名当前是否显示「已验证」，本教程无法替你确认。
> 需要你登录服务商控制台人工查看。
>
> **未核实（2）**：邮件最终进收件箱还是垃圾箱，本教程无法确认。服务商返回「已接收」只代表
> 它收下了，不等于收件方已投递。让对方同时看垃圾箱和拦截记录。
>
> **未核实（3）**：如果某个收件域（例如某些免费邮箱）出现 403 或类似拒收码，
> 具体原因由服务商判定，响应体通常不给原因字段。需要到服务商控制台看该次发送的详情。

## 6.7 用户会看到什么

> **开源仓库只带接口，不带门户前端页面。** `public/` 里只有管理台，没有注册页。
> 下面这段页面文案是某套已部署前端观察到的，**在开源版里属于未核实**；
> 接口行为（状态码、错误码）则是代码里可核对的。

如果有门户页面，`email_code` 模式下流程是：

1. 填邮箱和密码，点「创建账户并发送验证码」
2. 进入第 2 步「确认这是你的邮箱」，提示输入 6 位验证码
3. 收邮件，10 分钟内有效
4. 填码，验证通过后进入控制台
5. 没收到就点「重新发送验证码」，按钮进入 60 秒倒计时

验证码输入框只接受 6 位数字；同一个码只能用一次。

### 提示语与错误码对照

| 用户看到的话 | HTTP | 错误码 | 触发条件 |
| --- | --- | --- | --- |
| 验证码格式不正确 | 400 | `invalid_verification_code` | 空、位数不对、含非数字 |
| 验证码不正确，请检查后重试 | 400 | `invalid_verification_code` | 6 位但不对（第 1–5 次） |
| 验证码已过期，请重新获取 | 400 | `code_expired` | 超过有效期 |
| 验证码错误次数过多，请重新获取 | 429 | `too_many_attempts` | 已错满 5 次 |
| 请先获取验证码，再完成注册 | 400 | `invalid_verification_code` | 没申请过就来验证 |
| 验证码无效或已过期 | 400 | `invalid_verification_code` | 账号已不存在/已验证/已停用 |
| 请等待 60 秒后再次发送 | 429 | `resend_too_soon` | 两次发码间隔不足 60 秒 |
| 验证邮件正在发送，请稍后重试 | 429 | `mail_in_progress` | 同一邮箱上一封还没发完 |
| 请求过于频繁，请稍后重试 | 429 | `rate_limited` | 触发小时级限流 |
| 请先完成账户邮箱验证 | 403 | `email_unverified` | 未验证账号尝试登录 |
| 这个邮箱已有账户或待完成的邮箱验证，请登录或完成原验证 | 409 | `email_registered` | 重复注册 |
| 邮箱验证服务暂未配置完成，请稍后重试 | 503 | `mail_unavailable` | 配置不全 / 没验证过 / 改过配置 |
| 验证邮件发送失败，请稍后重试 | 503 | `mail_delivery_failed` | SMTP 通了但这封没发出去 |
| 邮箱注册服务暂未开放 | 503 | `registration_unavailable` | 总开关关了，或验证码模式下邮件不可用 |
| 邮箱或密码不正确 | 401 | `invalid_credentials` | 登录密码错 |
| 账户已停用，请联系管理员 | 403 | `account_disabled` | 被停用 |

有的前端还会把 500 和带「后台 / SMTP / 配置」字样的错误统一显示成「服务暂未就绪」，
所以用户转述的话可能比日志更笼统——**排错以服务端返回的 JSON 为准**。

### 找回密码走同一套机制

入口是登录页的「忘记密码」。设计是防枚举的：**无论邮箱是否存在都返回一样的 200**，
不存在的邮箱不会触发发信；重置成功后该账号已有会话全部失效。

## 6.8 管理员自测（curl）

> 这些步骤会**创建真实账号并真实发信**。用你自己能收信的地址。
> 别把它当压测：每 IP 每小时 12 次发码、每邮箱每小时 8 次。

```bash
BASE=https://example.com          # 换成你的 PUBLIC_ORIGIN
EMAIL='you@example.com'           # 换成你能收信的地址
```

所有 POST 都要带 `Origin`，值必须是 `PUBLIC_ORIGIN`。

**(1) 没申请就验证 → 应被拒**

```bash
curl -s -o /tmp/r1.json -w '%{http_code}\n' -X POST "$BASE/portal/verify" \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d "{\"email\":\"$EMAIL\",\"code\":\"123456\"}"
cat /tmp/r1.json
```

预期 `400`「请先获取验证码，再完成注册」。

**(2) 注册 → 应受理且不下发 Cookie**

```bash
curl -s -D /tmp/h2.txt -o /tmp/r2.json -w '%{http_code}\n' -X POST "$BASE/portal/register" \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Test-Passw0rd-123\"}"
cat /tmp/r2.json
grep -i '^set-cookie' /tmp/h2.txt || echo 'NO_COOKIE(正确)'
```

预期 `202` + `requires_verification: true`，且没有 `Set-Cookie`。
如果返回 `503 registration_unavailable` 或 `mail_unavailable`，先去 6.5 验证 SMTP。

**(3) 60 秒内重发 → 应被限流**

```bash
curl -s -o /tmp/r3.json -w '%{http_code}\n' -X POST "$BASE/portal/resend" \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d "{\"email\":\"$EMAIL\"}"
cat /tmp/r3.json
```

预期 `429 resend_too_soon`。

**(4) 错误码 → 应被拒；正确码 → 应成功**

```bash
curl -s -o /tmp/r4.json -w '%{http_code}\n' -X POST "$BASE/portal/verify" \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d "{\"email\":\"$EMAIL\",\"code\":\"000000\"}"
```

预期 `400`「验证码不正确，请检查后重试」。

再从邮箱抄出真码：

```bash
CODE='<收到的验证码>'
curl -s -D /tmp/h5.txt -o /tmp/r5.json -w '%{http_code}\n' -X POST "$BASE/portal/verify" \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d "{\"email\":\"$EMAIL\",\"code\":\"$CODE\"}"
cat /tmp/r5.json
grep -i '^set-cookie' /tmp/h5.txt
```

预期 `200`，响应头有 `Set-Cookie: portal_session=...; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`。

**(5) 同一个码再用一次 → 应失效**

重复上一步，预期 `400`「验证码无效或已过期」。

**(6) 错误次数上限**

同一个码错 5 次后，第 6 次应变成 `429 too_many_attempts`。

**(7) 清理测试账号**

没有删除用户的接口，正确做法是停用（停用同时清掉该用户所有会话）：

```bash
curl -s -b /tmp/onegate.cookie "$ADMIN/admin/api/users"
curl -s -b /tmp/onegate.cookie -X PATCH "$ADMIN/admin/api/users/<用户ID>" \
  -H 'Content-Type: application/json' -H 'Origin: https://admin.example.com' \
  -d '{"disabled":true}'
```

预期 `200`，`user.disabled` 为 true。

**不要手工编辑 `relay.json` 删用户**——内存里有副本，写盘会覆盖你的修改。

### 限流阈值（别踩）

| 键 | 上限 | 窗口 |
| --- | --- | --- |
| `register-ip` | 12 | 1 小时 |
| `register-email`（仅直接注册模式） | 8 | 1 小时 |
| `mail-ip` | 12 | 1 小时 |
| `mail:<邮箱>` | 8 | 1 小时 |
| `verify-ip` | 50 | 1 小时 |
| `login-ip` | 40 | 15 分钟 |
| `login-email` | 15 | 15 分钟 |
| `forgot-ip` | 12 | 1 小时 |
| `forgot:<邮箱>` | 1 | 60 秒 |
| `reset-ip` | 20 | 1 小时 |

超限统一返回 `429 rate_limited`，计数行 24 小时后自动清理。

## 6.9 收不到验证码：按顺序查

### 第一步：接口到底受理了没有

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/portal/register" \
  -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d '{"email":"you@example.com","password":"Test-Passw0rd-123"}'
```

- `202` → 服务端已受理，问题在投递或收件端，往下走。
- `503 mail_unavailable` → 邮件服务没就绪，配置或验证问题，跟用户无关。
- `503 mail_delivery_failed` → 连上了但这一封没发出去，看 6.9 最后一段。

### 第二步：后台状态

「客户服务 → 注册邮件」右上角徽标必须是「可用」，「最近连接验证」是最近的时间。
不是的话点「验证 SMTP 连接」。

### 第三步：发一封测试信

同页「发送测试邮件」发到你自己邮箱。收到 → 链路通，问题在特定收件域；
收不到 → 看服务日志。

### 第四步：看服务日志

```bash
sudo journalctl -u onegate --since '30 min ago' --no-pager | tail -100
```

邮件相关失败会出现在这里。注意：程序本身不会把验证码打到日志里
（`lib/mail.mjs` 显式关掉了 SMTP 调试输出），日志里不应该有 6 位验证码。

### 第五步：才轮到用户侧

垃圾邮件箱、地址拼错、把发件地址拉黑、企业邮箱拦截。

### 常见现象对照

| 现象 | 大概率原因 | 怎么办 |
| --- | --- | --- |
| 注册返回 `mail_unavailable` | 配置不全 / 没验证过 / 改过配置 | 重新「验证 SMTP 连接」 |
| 注册返回 `mail_delivery_failed` | 凭据失效、服务商限流、收件域拒收 | 用「发送测试邮件」复现，查服务商控制台 |
| SMTP 验证失败（502） | 主机、端口、加密方式或密码错 | 确认 465 配 465、587 配 587 |
| 保存时报端口错误 | 用了 25 或其它端口 | 只支持 465 / 587 |
| 改完配置就注册不了 | 验证标记被清空 | 重新验证，见 6.5 第 4 条 |
| 提示等待 60 秒 | 正常限流 | 等满 60 秒 |
| 提示请求过于频繁 | 小时级限流，共享出口 IP 更易触发 | 等窗口过去，**不要关限流** |
| 用户收到但码无效 | 用了旧邮件里的码，或已过期 | 重新获取，用最新一封 |
| 用户收不到但测试信能收到 | 特定收件域的问题 | 让对方看垃圾箱/拦截记录，或换地址 |

## 6.10 换邮件服务商

只改配置，不改代码。四步：

1. 新服务商侧：验证发件域名、配好 DNS、拿到 SMTP 主机/端口/用户名/密码/发件地址。
2. 记下当前配置（密码不回显，自己另存一份）。
3. 「注册邮件」页填新值 → 保存 → **点「验证 SMTP 连接」**。
4. 发测试邮件给自己，确认真实收到。

回滚：把旧值填回去 → 保存 → 验证。不用重启、不用改 DNS（旧解析留着即可）。

换了**发件域名**才需要动 DNS：新域名重新配 DKIM/SPF/DMARC，等生效后再切换发件地址。

## 6.11 安全注意（这几条是硬要求）

### 验证码不能以明文出现在任何日志里

这是本次核对中发现的**真实待整改项**，写成通用的部署自检：

- 如果你在网关之外还挂了辅助脚本、旁路服务或自建发码工具，请检查它们的日志：
  如果日志里出现 `code=123456` 这种字段，**那份日志就等于一份可用验证码清单**。
- 判定方法：`grep -c 'code=' <你的日志文件>`，大于 0 就要处理。
- 处理顺序：
  1. 日志只记收件人哈希或域名、HTTP 状态、消息 id，**去掉验证码本身**；
  2. 文件权限收紧到只有服务账号可读（`640` 且属组正确，或 `600`）；
  3. 历史文件按保留策略清理。
- 排错时不要把日志里的验证码复制到工单、聊天或截图里。

### 密钥与密码的处理

- SMTP 密码用 AES-256-GCM 加密存在 `relay.json` 的 `pass_enc` 里，主密钥是 `data/relay.secret`。
- 管理接口**永不回显**密码，只返回「是否已配置」。
- 下游 API 密钥只存 SHA-256 哈希，明文只在创建时显示一次。
- 导出、列表、日志里都只出现 `sk-…末四位` 这种掩码。
- `relay.json`、`relay.secret`、`.env` 不进 Git、不截图、不发聊天。

### 不要为了测试关掉限流

6 位数字只有 100 万种组合，去掉次数限制就能被穷举。允许的测试方式只有两种：
等窗口自然过去，或在**隔离环境**里改参数演练。

## 6.12 本教程与部署实例的差异清单

写这一章时逐项核对过代码，以下差异请以你的实际部署为准：

| 项 | 开源仓库 | 曾观察到的部署实例 |
| --- | --- | --- |
| 门户注册/登录页面 | **没有**，只有 `/portal/*` 接口 | 有独立前端页面 |
| 密码长度提示 | 服务端 8–128 字符 | 页面提示「至少 10 个字符」 |
| 注册方式切换 | 只能 `PUT /admin/api/portal-settings` | 同左（确认无页面开关） |
| 站内路径前缀 | 硬编码会剥掉 `/relay` 前缀 | 实际部署在 `/relay` 下 |
| 管理员密钥轮换 | 内存生效，重启回退到 `.env`/`admin.key` | 需自行固化 |
| 旁路发码服务 | 不存在 | 存在一条独立服务（本教程不写它的路径） |

## 本章验收

- [ ] 知道当前是哪种注册方式，以及怎么用接口切
- [ ] 「注册邮件」页徽标是「可用」，最近验证时间是最近
- [ ] 「发送测试邮件」能真实收到
- [ ] 用 curl 走通一次 202 → 收码 → 200 → 拿到 `portal_session`
- [ ] 测试账号已停用
- [ ] 服务日志里没有验证码明文
- [ ] 知道三个「未核实」项分别是什么

下一章：[07 域名、证书与对外门户](07-https-portal.md)。
