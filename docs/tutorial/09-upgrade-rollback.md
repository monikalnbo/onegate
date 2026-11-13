# 09 升级与回滚

升级本身只有四条命令。真正要小心的是**顺序**：先备份，再拉代码，再装依赖，最后重启。
顺序错了，出问题时你就没有退路。

## 9.1 升级前：先留退路

现在做什么：备份数据和记下当前版本。

```bash
cd /opt/onegate
sudo -u onegate git rev-parse --short HEAD
sudo systemctl stop onegate
sudo tar czf /root/onegate-pre-upgrade-$(date +%F-%H%M).tgz -C /opt/onegate data/
sudo chmod 600 /root/onegate-pre-upgrade-*.tgz
sudo systemctl start onegate
curl -s http://127.0.0.1:8787/health
```

看到什么算成功：打印出一个短提交号（记下来），备份文件存在，`health` 返回 `ok`。

失败了先查什么：`git rev-parse` 报 `not a git repository` —— 你的部署不是 git 拉的，
升级方式要改成「整目录替换」，见 9.4。

> 数据格式是向后兼容的：新版本能读旧数据。但**反过来不一定**——
> 用新版本跑过一段时间后，再回滚到旧版本，旧版本可能读不懂新写的数据。
> 所以回滚时通常要连同备份的数据一起退。

## 9.2 升级

现在做什么：按固定顺序走。

```bash
cd /opt/onegate
sudo -u onegate git pull
sudo -u onegate npm ci --omit=dev
sudo systemctl restart onegate
```

看到什么算成功：

```bash
curl -s http://127.0.0.1:8787/health
sudo systemctl status onegate --no-pager | head -5
```

`health` 返回 `ok`，服务是 `active (running)`。

失败了先查什么：

| 现象 | 原因 |
| --- | --- |
| `git pull` 冲突 | 你在服务器上改过仓库文件。先 `git status` 看清改了什么，把本地改动备份出去再处理，**不要** `git reset --hard` 直接抹掉 |
| `npm ci` 报锁文件不一致 | `package-lock.json` 与 `package.json` 不匹配，说明拉到的代码不完整，重新 pull |
| 启动即退出 | `sudo journalctl -u onegate -n 50 --no-pager` 看第一行错误 |
| 起来但 502 | 端口/监听地址变了，看 `.env` 是否被覆盖（`git pull` 不会动 `.env`，它是被忽略的） |

## 9.3 升级后：按顺序验四件事

不要只看 `health` 就收工。

1. **管理台能登录**：`https://admin.example.com/admin/`
2. **通道能通**：随便点一条通道的「测试」
3. **`/v1` 能调**：用 04 章那条 `curl` 再跑一次
4. **记录还在**：调用记录里能看到升级前的历史，用户和余额没丢

看到什么算成功：四条全过。

失败了先查什么：前三项过、第四项丢数据 —— 说明 `DATA_DIR` 指到了新目录。
检查 `.env` 的 `DATA_DIR`，以及 `systemd` 单元里的 `ReadWritePaths`。
程序不会删数据，只会读错地方。

想再稳一点，可以在隔离环境跑一次冒烟测试（不会碰你的数据目录，用的是临时目录和非特权端口）：

```bash
cd /opt/onegate
sudo -u onegate npm test
```

看到什么算成功：全部断言通过，末尾打印成功信息。失败会明确指出是哪一条断言。

## 9.4 如果不是 git 部署

手工上传代码的部署，升级就是「换目录 + 保数据」：

```bash
sudo systemctl stop onegate
sudo mv /opt/onegate /opt/onegate-old-$(date +%F)
# 把新版本解压/上传到 /opt/onegate
sudo cp -a /opt/onegate-old-*/data /opt/onegate/data
sudo chown -R onegate:onegate /opt/onegate
cd /opt/onegate && sudo -u onegate npm ci --omit=dev
sudo systemctl start onegate
```

看到什么算成功：同 9.3 的四条。

失败了先查什么：`data` 忘了拷 → 起来是空站；属主错了 → 写盘失败。
确认没问题后再删旧目录。

## 9.5 回滚

触发条件：升级后出现你无法在十分钟内定位的问题。**先回滚恢复服务，再慢慢查。**

### 方式 A：回滚代码（数据不动）

```bash
cd /opt/onegate
sudo -u onegate git log --oneline -5         # 找到升级前的提交
sudo -u onegate git checkout <升级前的提交号>
sudo -u onegate npm ci --omit=dev
sudo systemctl restart onegate
curl -s http://127.0.0.1:8787/health
```

看到什么算成功：服务起来，四件事验收通过。

失败了先查什么：新版本已经写过数据、旧版本读不懂 —— 这时数据也要一起退，
用 9.1 的备份按 08 章的恢复步骤做。

> 回滚是 `git checkout <提交号>`，把工作区切到那个提交（detached HEAD）。
> 之后想再回到主线：`git checkout main && git pull`。

### 方式 B：连数据一起回滚

```bash
sudo systemctl stop onegate
sudo rm -rf /opt/onegate/data
sudo tar xzf /root/onegate-pre-upgrade-YYYYMMDD-HHMM.tgz -C /opt/onegate
sudo chown -R onegate:onegate /opt/onegate/data
sudo chmod 700 /opt/onegate/data && sudo chmod 600 /opt/onegate/data/*
sudo systemctl start onegate
```

看到什么算成功：通道、密钥、账户、余额都回到升级前。

失败了先查什么：这等于用了一份旧快照，**升级后新增的调用记录、用户、余额都会消失**。
这是回滚的代价，不是 bug。所以升级前那次备份的时间点很关键。

## 9.6 升级检查清单

升级前：

- [ ] 有 `git rev-parse --short HEAD` 记下的提交号
- [ ] 有一份刚做的数据备份，且按 08 章验证过能解析
- [ ] 知道怎么回滚（两种方式都看懂了）
- [ ] 挑一个流量低的时间

升级后：

- [ ] `health` 返回 `ok`
- [ ] 管理台能登录
- [ ] 通道测试通过
- [ ] `/v1` 调用成功
- [ ] 历史记录、用户、余额都在

## 本章验收

- [ ] 完整走过一次 9.2 的四条命令
- [ ] 按 9.3 验过四件事
- [ ] 知道回滚时数据要不要一起退，以及为什么

下一章：[10 故障排查总表与安全红线](10-troubleshooting.md)。
