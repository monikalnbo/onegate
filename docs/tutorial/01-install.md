# 01 准备条件与最小可行安装

这一章的目标只有一个：**在你自己的机器上把 OneGate 跑起来，用浏览器打开后台登录页。**
还不接真实上游、不配域名、不开 HTTPS。先把「最小可用」跑通，后面每一步才有地基。

## 1.1 先确认你要准备什么

| 项 | 最低要求 | 说明 |
| --- | --- | --- |
| 服务器 | 1 核 1G | 数据都在 JSON 文件里，主要吃内存；并发高再加内存 |
| 操作系统 | Linux（Debian / Ubuntu 最省事） | 教程命令按 Debian/Ubuntu 写 |
| Node.js | **20.6.0 或更高** | 低版本没有 `--env-file`，`npm start` 会直接报错 |
| 域名 | 一个即可 | 只本地测试可以先不要；正式对外必须有，见 07 章 |
| 上游 | 任意 OpenAI 兼容服务的 `base_url` 和密钥 | 第四章才用；想先看效果可以不准备 |

现在做什么：在服务器上确认系统版本和 Node 版本。

```bash
cat /etc/os-release | head -3
node -v
```

看到什么算成功：系统能认出是 Debian/Ubuntu；`node -v` 输出 `v20.6.0` 或更高。

失败了先查什么：

- 提示 `node: command not found`：还没装，继续第 1.2 步。
- 版本是 `v18.x` 或 `v20.5.x`：太旧，先按 1.2 步升级。
- 版本是 `v22.x` / `v24.x`：可以，不用动。

## 1.2 安装 Node.js 20+

现在做什么：用 NodeSource 装 Node 22（写教程时的当前 LTS 线）。

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

看到什么算成功：`node -v` 显示 `v22.x` 之类的版本，且不低于 `v20.6.0`。

失败了先查什么：

- `curl: command not found`：先 `sudo apt update && sudo apt install -y curl ca-certificates`。
- 公司网络/国内网络拉不下来：换镜像或改用 nvm，只要最终 `node -v >= 20.6` 即可。
- 装完 `node -v` 还是旧版本：`which -a node` 看是否有多个 Node，清理旧的或用绝对路径。

> 为什么卡 20.6：`npm start` 实际执行的是 `node --env-file=.env server.mjs`，
> 这个参数从 Node 20.6 才有。版本不够时不需要改代码，升级 Node 即可。

## 1.3 安装基础工具

现在做什么：装 nginx、git 和证书工具（这一章只用得到 git，其余是 07 章要用的，一次装完省事）。

```bash
sudo apt update
sudo apt install -y git nginx certbot python3-certbot-nginx
```

看到什么算成功：命令没有报错，`git --version` 有输出。

失败了先查什么：`apt` 报锁被占用（`Could not get lock`），说明系统在自动更新，等一分钟再执行。

## 1.4 建一个专用用户和目录

不要用 root 跑服务。现在做什么：建系统用户 `onegate`，把代码放进去。

```bash
sudo useradd --system --home /opt/onegate --shell /usr/sbin/nologin onegate || true
sudo mkdir -p /opt/onegate
sudo chown -R onegate:onegate /opt/onegate
```

看到什么算成功：`id onegate` 能看到这个用户；`ls -ld /opt/onegate` 的属主是 `onegate`。

失败了先查什么：`useradd: user 'onegate' already exists` 是正常的（`|| true` 已兜住），继续下一步。

把代码放进去。你如果是从自己的仓库部署：

```bash
sudo -u onegate git clone <你的仓库地址> /opt/onegate
```

如果 `/opt/onegate` 已经不是空目录，clone 会失败。两种情况：
先 `ls -A /opt/onegate` 确认是空的；如果不是空的，把代码 clone 到临时目录再拷进来，别直接覆盖。

看到什么算成功：`ls /opt/onegate` 能看到 `server.mjs`、`package.json`、`lib/`、`public/`。

## 1.5 安装依赖

现在做什么：只装运行依赖，不装开发依赖。

```bash
cd /opt/onegate
sudo -u onegate npm ci --omit=dev
```

看到什么算成功：末尾显示安装了 2 个包（`bcryptjs`、`nodemailer`），没有报错。

失败了先查什么：

- 没有 `package-lock.json`：说明代码不完整，重新拉一次仓库。
- 权限错误 `EACCES`：目录属主不对，回到 1.4 步 `chown`。
- 需要编译工具：本项目的 2 个依赖都是纯 JS，正常不需要编译；如果报 `node-gyp`，说明装错了包或 Node 版本异常。

## 1.6 写 `.env`

现在做什么：复制模板，然后改到最少能跑。

```bash
sudo -u onegate cp .env.example .env
sudo -u onegate nano .env
```

最少要改的是这几行：

```dotenv
HOST=127.0.0.1
PORT=8787
DATA_DIR=/opt/onegate/data
RELAY_ADMIN_KEY=<用下面的命令生成>
PUBLIC_ORIGIN=http://127.0.0.1:8787
ADMIN_ORIGIN=http://127.0.0.1:8787
COOKIE_SECURE=false
```

生成管理员密钥：

```bash
openssl rand -base64 32
```

把输出粘到 `RELAY_ADMIN_KEY=` 后面，**不要加引号、不要留空格**。

几个值为什么这么填：

- `PUBLIC_ORIGIN` / `ADMIN_ORIGIN`：本地测试先写 `http://127.0.0.1:8787`。正式上线后必须改成真实域名，见 07 章。
- `COOKIE_SECURE=false`：只在纯 HTTP 本地测试时这么填。上了 HTTPS 必须改回 `true`，否则浏览器不发送会话 Cookie，登录后会立刻变回未登录。
- `RELAY_ADMIN_KEY` 留空也能启动，程序会生成随机密钥写到 `data/admin.key` 并在终端**只打印一次**。但这样不利于你自己管理，建议明确设置。

然后收紧权限：

```bash
sudo chmod 600 /opt/onegate/.env
sudo chown onegate:onegate /opt/onegate/.env
```

看到什么算成功：`ls -l /opt/onegate/.env` 显示 `-rw-------`，属主是 `onegate`。

失败了先查什么：登录时一直提示密钥错误，九成是这一行有引号或多了一个换行。用 `grep RELAY_ADMIN_KEY .env` 看一眼实际内容。

## 1.7 第一次启动

现在做什么：前台跑起来，先别急着交给 systemd。

```bash
sudo -u onegate bash -c 'cd /opt/onegate && node --env-file=.env server.mjs'
```

看到什么算成功：终端打印类似

```
Relay listening on 127.0.0.1:8787
```

保持这个终端不要关，另开一个终端验证：

```bash
curl -s http://127.0.0.1:8787/health
```

看到什么算成功：返回 `{"ok":true,"version":"1.0.0"}`。

失败了先查什么：

| 现象 | 先查 |
| --- | --- |
| `node: --env-file is not supported` | Node 低于 20.6，回 1.2 步升级 |
| `EADDRINUSE` | 8787 被占用：`sudo ss -ltnp \| grep 8787`，停掉占用进程或改 `PORT`（改完 `curl` 也要换端口） |
| `EACCES` 写数据目录 | `DATA_DIR` 的属主不是 `onegate`，`sudo chown -R onegate:onegate /opt/onegate/data` |
| `health` 连不上 | 服务没起来，看终端报错；`HOST` 是不是被改成了别的地址 |
| `health` 返回 404 | 请求路径写错了，应该是 `/health`，不要带 `/v1` |

按 `Ctrl+C` 停掉。相关内容：数据目录在首次启动时会自动创建，目录权限 0700，里面的文件 0600。

## 1.8 想先看效果？用演示模式

不想接真实上游、也不想花钱，可以本地造一个假上游。现在做什么：开三个终端。

终端 1，起 mock 上游：

```bash
cd /opt/onegate
sudo -u onegate node test/mock-upstream.mjs
```

终端 2，写入演示通道、密钥、价格、公告：

```bash
cd /opt/onegate
sudo -u onegate env DATA_DIR=/opt/onegate/data node scripts/seed-demo.mjs
```

这个脚本会打印一个演示密钥（形如 `sk-relay-...`），**只打印一次**，先复制下来。

终端 3，起网关：

```bash
sudo -u onegate bash -c 'cd /opt/onegate && node --env-file=.env server.mjs'
```

看到什么算成功：用终端 2 打印的密钥调用一次：

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Authorization: Bearer <终端2打印的演示密钥>" \
  -H "Content-Type: application/json" \
  -d '{"model":"mock-gpt","messages":[{"role":"user","content":"hi"}]}'
```

返回一个 OpenAI 格式的 JSON，`choices[0].message.content` 里有内容。

失败了先查什么：

- `401 Invalid API key`：密钥复制不全，或者 `Bearer` 后面多了空格。
- `503 No eligible channel for this model`：mock 上游没起来（终端 1 是否还在跑），或 `model` 不是 `mock-gpt`。
- 连接被拒：网关没起（终端 3），或端口不是 8787。

演示数据用完想清掉：停掉服务后删除 `DATA_DIR` 下的 `relay.json`，再重新启动即回到空状态。
**不要在生产数据目录上做这件事。**

## 1.9 交给 systemd（可选，但正式部署必做）

前台跑只能验证「能启动」。真正长期跑要交给 systemd。现在做什么：

```bash
sudo cp /opt/onegate/deploy/onegate.service /etc/systemd/system/onegate.service
sudo nano /etc/systemd/system/onegate.service
```

确认文件里这三处和你的实际路径一致：`User=onegate`、`WorkingDirectory=/opt/onegate`、
`ReadWritePaths=/opt/onegate/data`。如果 `DATA_DIR` 不在 `/opt/onegate/data`，
**必须**同步改 `ReadWritePaths`，否则运行时会写不进去。

然后：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now onegate
sudo systemctl status onegate --no-pager
```

看到什么算成功：状态是 `active (running)`，`curl -s http://127.0.0.1:8787/health` 仍返回 `ok`。

失败了先查什么：

```bash
sudo journalctl -u onegate -n 50 --no-pager
```

- 报 `.env` 读不到：`EnvironmentFile` 路径不对，或文件权限不允许 `onegate` 读。
- 报写数据目录失败：`ReadWritePaths` 与实际 `DATA_DIR` 不一致。
- 端口占用：同 1.7 步。

## 本章验收

全部满足才算这一章过了：

- [ ] `node -v` ≥ 20.6
- [ ] `curl http://127.0.0.1:8787/health` 返回 `{"ok":true,...}`
- [ ] 浏览器能打开 `http://127.0.0.1:8787/admin/`（如果服务器没有图形界面，用 `ssh -L 8787:127.0.0.1:8787 用户@服务器` 转发到本地再看）
- [ ] `.env` 权限是 600，`RELAY_ADMIN_KEY` 是随机长字符串
- [ ] 如果是正式部署，`systemctl status onegate` 是 running

下一章：[02 首次管理员登录](02-first-login.md)。
