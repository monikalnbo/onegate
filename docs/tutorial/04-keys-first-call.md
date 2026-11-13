# 04 用户分组、API 密钥与第一次 /v1 调用

通道通了，但还没有人可以「用」。这一章造出第一个能用的密钥，并用 `curl` 真正打一次，
最后确认它在调用记录里留下了痕迹。

## 4.1 两种密钥，先搞清区别

OneGate 有两类下游密钥，长得一样（都是 `sk-relay-...`），计费方式不同：

| 类型 | 谁建的 | 怎么计费 | 适合 |
| --- | --- | --- | --- |
| **独立密钥** | 管理员在「API 密钥」页建 | 用「密钥额度」记账：剩多少扣多少，用完 402 | 给自己人、给脚本、给一次性试用 |
| **账户密钥** | 门户注册用户在门户里建 | 用「账户余额」记账，按用户组倍率 | 对外开放注册的用户 |

这一章先用**独立密钥**把链路打通。账户密钥在 06 章讲注册时一起出现。

## 4.2 密钥分组：限定能用哪些模型

分组不是必须的，但对外发密钥时强烈建议用。

现在做什么：控制台 →「资源」→「密钥分组」→ 新建。

| 字段 | 填什么 |
| --- | --- |
| 名称 | 例如 `基础用户` |
| 模型列表 | `["*"]` 表示全部允许；写具体名字就只允许这些 |
| 备注 | 随便写 |
| 启用 | 保持开启 |

看到什么算成功：新建的分组出现在列表里，点开能看到模型列表。

失败了先查什么：模型列表填成 `gpt-4o-mini, gpt-4` 这种逗号分隔的字符串，会被当成一个模型名。
界面/接口要的是数组。

> 分组里「组倍率」的计费作用见第 4.6 节和 05 章。不填就是 1。

## 4.3 建第一个独立密钥

现在做什么：「资源」→「API 密钥」→ 新建。

| 字段 | 填什么 | 限制 |
| --- | --- | --- |
| 名称 | 例如 `我的测试` | 必填 |
| RPM 限速 | 每分钟最多多少次 | `0` = 不限制；填了就按 60 秒窗口算 |
| 所属分组 | 选 4.2 建的分组，或留空 | 留空 = 不限制模型 |
| 额度上限（元） | 这个密钥总共能花多少（美元等值） | `0` = 不限制额度 |

看到什么算成功：弹窗里显示一次**完整明文密钥**，形如 `sk-relay-xxxx...`，并提示只显示这一次。

立刻复制存好。关闭后列表里只会显示 `sk-…末四位`，仓库里也只存哈希，**找不回来**。

失败了先查什么：关掉弹窗才想起来没复制 —— 删掉这个密钥，重新建一个。没有「再显示一次」的功能。

## 4.4 第一次调用

现在做什么：把密钥填进这条命令。

```bash
curl -s http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-relay-你的密钥" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "用一句话介绍你自己"}]
  }'
```

模型名必须是你 03 章里配过的名字。

看到什么算成功：返回 OpenAI 格式：

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [{"message": {"role": "assistant", "content": "..."}}],
  "usage": {"prompt_tokens": 12, "completion_tokens": 18, "total_tokens": 30}
}
```

失败了先查什么，按状态码对：

| 状态码 / 错误码 | 含义 | 先查什么 |
| --- | --- | --- |
| 401 `Invalid API key` | 密钥不认 | `Bearer` 后面有没有空格/换行；密钥是否被删或停用；是否复制全了 |
| 402 `quota_exceeded` | 这个密钥额度用完了 | 「API 密钥」里给它加额度，或把额度上限设为 0 |
| 403 `model_not_allowed` | 分组不允许这个模型 | 分组模型列表里加上它，或把密钥移出分组 |
| 403 `group_disabled` | 分组被停用 | 把分组启用回来 |
| 429 `rate_limit_exceeded` | 触发 RPM | 响应头 `retry-after` 是等几秒；调大 RPM 或降低并发 |
| 429 `concurrency_limit_exceeded` | 通道并发满了 | 见 03 章第 3.4 节，调并发上限或加通道 |
| 503 `No eligible channel for this model` | 没有任何通道服务这个模型 | 回 03 章：模型名是否一字不差、通道是否启用、是否在冷却 |
| 502 `upstream_error` | 上游拒绝 | 用通道卡片上的「测试」看具体错误 |

> 注意 `No eligible channel` 是 503，不是 404；`upstream_error` 是 502，不是 500。
> 看到这两个数字先想到「通道」而不是「客户端」。

## 4.5 试一次流式

现在做什么：

```bash
curl -N http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer sk-relay-你的密钥" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","stream":true,"messages":[{"role":"user","content":"数到三"}]}'
```

看到什么算成功：一行一行吐出 `data: {...}`，最后一行是 `data: [DONE]`。

失败了先查什么：

- 一次性全吐出来、或者卡很久才吐：本地直连不会有这问题；经过 nginx 时是缓冲没关，
  见 [07 章 7.4](07-https-portal.md#74-改-nginx-配置) 的 `proxy_buffering off;`。
- 没有任何输出就断开：上游不支持流式，或超时太短。

## 4.6 确认它落在调用记录里

这是这一步的重点：**没进记录，就等于没计费**。

现在做什么：控制台 →「工作台」→「调用记录」，或命令行：

```bash
curl -s -b /tmp/onegate.cookie "http://127.0.0.1:8787/admin/api/calls?limit=5"
```

（Cookie 怎么来：见 [06 章 6.4](06-email-verification.md#64-切换注册方式只有接口没有页面开关) 的 `curl -c` 命令行登录，
或浏览器登录后从开发者工具里取 `relay_session`。）

看到什么算成功：最新一条记录里有：

- `status` = 200
- `latency_ms` 有数字
- `prompt_tokens` / `completion_tokens` 有数字（上游没返回 usage 时是估算值，会带 `estimated` 标记）
- `channel_name` 是你 03 章配的那条
- `model` 是请求里的模型名
- 密钥只显示 `sk-…` 加末四位，**看不到完整密钥**

失败了先查什么：

- 记录为空：服务刚重启过？记录是持久化的，重启不会丢；确认你看的是同一个 `DATA_DIR`。
- token 数是估算的：上游没回 `usage`。程序按文本长度估算（约 3.6 字符/token），偏差 ±20%，属正常。
- 成本是 0：这个模型没设价格。见 05 章。

## 4.7 第一次用 SDK 调

Python 只需要换 `base_url`，密钥从环境变量读（不要写死在代码里）：

```python
import os
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8787/v1",
                api_key=os.environ["ONEGATE_API_KEY"])
print(client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "hi"}],
).choices[0].message.content)
```

```bash
export ONEGATE_API_KEY='你的密钥'   # 只存在于当前 shell，不要提交进仓库
```

Node 同理，把 `baseURL` 指向同一个地址。

看到什么算成功：和 `curl` 一样的输出。

失败了先查什么：SDK 报 404 —— `base_url` 一般要带 `/v1`，最终请求路径是 `/v1/chat/completions`。

## 本章验收

- [ ] 有一个可用密钥，明文已保存（或你确定不需要了）
- [ ] `curl` 返回 200，流式和普通各成功一次
- [ ] 调用记录里能看到这次请求，含状态、延迟、token、通道名
- [ ] 记录里看不到完整密钥

下一章：[05 模型价格与计费](05-pricing.md)。
