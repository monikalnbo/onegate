# 08 备份与恢复

这一章只有一个中心句：**`DATA_DIR` 就是整个网关。** 备份它就是备份全部；
丢了它，通道密钥、下游密钥、账户余额、调用记录全都没了，而且**找不回来**。

## 8.1 里面到底有什么

`DATA_DIR`（默认 `./data`，正式部署一般是 `/opt/onegate/data`）目录权限 0700，文件 0600：

| 文件 | 内容 | 丢了会怎样 |
| --- | --- | --- |
| `relay.json` | 通道（上游密钥加密存储）、下游密钥哈希、用户与余额账本、调用记录、审计、门户设置 | 全丢 |
| `relay.secret` | 32 字节加密主密钥，`relay.json` 里的密文靠它解开 | 有 `relay.json` 也解不开上游密钥 |
| `admin.key` | 免配置时自动生成的管理员密钥（你显式设了 `RELAY_ADMIN_KEY` 就不存在） | 还能用 `.env` 里的密钥登录 |
| `metrics.json` | 按小时的指标桶 | 图表历史数据丢，账本不受影响 |
| `pricing.json` | 模型价格表 | 价格要重填 |

三点必须记住：

1. `relay.json` 和 `relay.secret` **必须一起备份**，只备一个等于没备。
2. 备份包里是**明文可解的全部秘密**（因为 `relay.secret` 就在里面）。
   备份文件本身要当成 root 密钥来保管。
3. `.env` 不在数据目录里，但也含管理员密钥，要单独备份或记在密码管理器里。

## 8.2 做一次备份

推荐停服务再打包，保证文件是同一时刻的一致快照。停机通常只有几秒。

```bash
sudo systemctl stop onegate
sudo tar czf /root/onegate-data-$(date +%F-%H%M).tgz -C /opt/onegate data/
sudo chmod 600 /root/onegate-data-*.tgz
sudo systemctl start onegate
```

看到什么算成功：

```bash
ls -lh /root/onegate-data-*.tgz
tar tzf /root/onegate-data-latest.tgz 2>/dev/null | head
```

（把 `-latest` 换成你实际的文件名。）能看到 `data/relay.json`、`data/relay.secret` 这两个条目。

失败了先查什么：

- `tar: data/: Cannot open` → `-C` 后面的目录不对，确认你的 `DATA_DIR`。
- 包很小（几 KB）→ 可能只打进了空目录，用 `tar tzf` 检查。
- 停服务失败 → `systemctl status onegate` 看原因，不要强杀进程。

> 不停服务也能备，但 `relay.json` 是原子写（临时文件 + rename），
> 备份时可能拿到「上一个版本」，也可能 `metrics.json` 还没刷盘。
> 要求严格一致就停服务。

## 8.3 验证备份真的能用

**没有验证过的备份不算备份。** 最省事的验证：解到临时目录，检查 JSON 能不能解析。

```bash
mkdir -p /tmp/restore-check
sudo tar xzf /root/onegate-data-YYYYMMDD-HHMM.tgz -C /tmp/restore-check
sudo -u onegate node -e "
  const fs=require('fs');
  const d=JSON.parse(fs.readFileSync('/tmp/restore-check/data/relay.json','utf8'));
  console.log('channels',(d.channels||[]).length);
  console.log('keys',(d.keys||[]).length);
  console.log('users',d.portal?.users?.length ?? 0);
  console.log('secret_bytes',fs.statSync('/tmp/restore-check/data/relay.secret').size);
"
```

看到什么算成功：四个数字打印出来，`secret_bytes` 是 32，通道/密钥数量和你印象中一致。

失败了先查什么：

| 报错 | 原因 |
| --- | --- |
| `Unexpected end of JSON input` | 备份时文件正被写，包不完整；重新备份 |
| `ENOENT ... relay.secret` | 只备了 `relay.json`，这份备份没用 |
| 通道数是 0 但你明明配过 | 备份的是空数据目录（`DATA_DIR` 指错了） |

**注意**：这一步会把含明文的备份解到 `/tmp`。验证完立刻删：

```bash
sudo rm -rf /tmp/restore-check
```

## 8.4 恢复

恢复要覆盖正在用的数据，必须停服务，并且**先把当前数据留一份**（万一是恢复错了还能退回来）。

```bash
sudo systemctl stop onegate

# 1. 先保住现在的（以防恢复的是错的包）
sudo tar czf /root/onegate-before-restore-$(date +%F-%H%M).tgz -C /opt/onegate data/

# 2. 清掉旧数据并解包
sudo rm -rf /opt/onegate/data
sudo tar xzf /root/onegate-data-YYYYMMDD-HHMM.tgz -C /opt/onegate

# 3. 权限必须是服务用户
sudo chown -R onegate:onegate /opt/onegate/data
sudo chmod 700 /opt/onegate/data
sudo chmod 600 /opt/onegate/data/*

# 4. 启动并验证
sudo systemctl start onegate
curl -s http://127.0.0.1:8787/health
```

看到什么算成功：

- `health` 返回 `ok`
- 打开管理台，通道列表、密钥列表、用户列表都在
- 通道卡片点「测试」能通（说明 `relay.secret` 和密文匹配，上游密钥解开了）

失败了先查什么：

| 现象 | 原因 |
| --- | --- |
| 启动报 `EACCES` | 属主不对，回到第 3 步 |
| 通道都在但测试全失败、日志说解密失败 | `relay.secret` 和 `relay.json` 不是同一次备份的 |
| 管理台登不上 | 管理员密钥不同：改用 `.env` 里的值，或恢复对应 `admin.key` |
| 用户全部掉线 | 会话存在内存里，重启本来就会掉，不是故障 |

## 8.5 备份策略（务实版）

不需要复杂方案，做到下面几条就够：

- **频率**：改过配置（通道/价格/门户设置）后立刻备一次；没改动时每天一次。
- **保留**：本地留 7 份日备份 + 每周 1 份月备份。备份很小，别省这点空间。
- **异地**：至少一份在另一台机器或对象存储。同一块盘上的备份，盘坏了等于没有。
- **权限**：`600`，属主 root 或专门备份账号；不要放在网站目录下。
- **加密**：往外传之前先加密，例如

  ```bash
  sudo gpg --symmetric --cipher-algo AES256 /root/onegate-data-YYYYMMDD-HHMM.tgz
  ```

  然后把 `.tgz` 删掉，只留 `.tgz.gpg`。口令记在密码管理器里。

- **演练**：每季度按 8.3 验一次，别等真出事才第一次解包。

一个可以直接用的每日脚本（放在 root 的 crontab 里）：

```bash
#!/bin/sh
set -eu
D=$(date +%F)
tar czf "/root/onegate-backup-$D.tgz" -C /opt/onegate data
chmod 600 "/root/onegate-backup-$D.tgz"
find /root -name 'onegate-backup-*.tgz' -mtime +30 -delete
```

它不停服务，属于「够用」级别的一致性；对账要求高就改成先 `systemctl stop` 再打包。

看到什么算成功：第二天 `ls /root/onegate-backup-*` 多了一个文件，大小和昨天接近。

失败了先查什么：cron 里 `%` 要转义、`PATH` 可能不含 `tar`，用绝对路径；`journalctl -u cron` 看执行记录。

## 8.6 不要做的事

- **不要把 `data/` 提交进 Git。** 里面的上游密钥虽然加密，但 `relay.secret` 同目录，
  一起提交等于公开全部秘密。仓库的 `.gitignore` 已经排除 `data/`，不要手动 `git add -f`。
- **不要把备份文件放进 `public/`。** 那会被当作静态资源对外提供。
- **不要在截图、工单、聊天里贴 `relay.json` 的内容。** 里面有账户邮箱、余额、调用记录。
- **不要只备份 `relay.json`。** 解不开的密文和没有一样。

## 本章验收

- [ ] 有一份今天的备份，权限 600
- [ ] 按 8.3 验证过：JSON 能解析、通道/密钥/user 数量正确、`relay.secret` 是 32 字节
- [ ] 知道恢复的完整四步，以及恢复前要先备份当前数据
- [ ] 至少有一份备份在另一台机器或对象存储上（或加密后外传）

下一章：[09 升级与回滚](09-upgrade-rollback.md)。
