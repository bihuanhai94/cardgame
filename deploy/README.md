# 部署到 119.29.198.188 — 运维手册

目标：让 `https://poker.tyyunan.com` 上线，同时保证服务器上已有的两个生产服务
（`agent-hub` — `/root/agent-hub/hub.py` 的飞书 Bot，以及 `console_site` 的 uwsgi）
**全程不受影响**。

服务器基本情况（已由前期调查确认，不需要重新验证）：
- CentOS 7 / kernel 3.10 / glibc 2.17，官方 Node 构建无法运行
- gcc 4.8，无法编译现代原生模块（本项目零原生依赖，用的是内置 `node:sqlite`）
- 公网出站带宽约 4.5 Mbps，与现有服务共享
- nginx 自编译在 `/usr/local/nginx`，无 `http_v2`，已有的 include 有
  `agent-approval.conf` / `agent-hub.conf` / `agent-location.conf` / `redirects-legacy.conf`
- 内存 3.7G（约 2.9G 可用），磁盘 50G（38G 空闲）

按顺序执行，不要跳步。**Step 0 是去/不去的关卡，必须最先做。**

---

## Step 0（原 Step 1）：验证 glibc-217 版 Node 能在目标机运行 —— 上线前置关卡

这是整个方案唯一的技术不确定点。**必须最先在服务器上验证，全程只在 `/tmp` 里操作，不安装、不改任何配置。**

在服务器（SSH 登录后）执行：

```bash
cd /tmp
curl -fsSLO https://unofficial-builds.nodejs.org/download/release/v22.14.0/node-v22.14.0-linux-x64-glibc-217.tar.xz
tar xf node-v22.14.0-linux-x64-glibc-217.tar.xz
./node-v22.14.0-linux-x64-glibc-217/bin/node -v
./node-v22.14.0-linux-x64-glibc-217/bin/node --experimental-sqlite -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec('CREATE TABLE t(x)');d.prepare('INSERT INTO t VALUES (1)').run();console.log(d.prepare('SELECT SUM(x) s FROM t').get())"
```

**成功判定（必须两者都满足）：**
1. 第一条命令输出 `v22.14.0`
2. 第二条命令输出 `{ s: 1 }`

**如果任一步失败：停止部署，不要继续任何后续步骤。**
- 不要尝试在 CentOS 7 上编译 Node（gcc 4.8 太旧，大概率失败或产出不可靠的二进制）。
- 升级方案二选一：
  1. 改用 Go 重写服务端（spec 8.2 已记录该备选方案）；
  2. 换一台满足 glibc ≥ 2.28（或直接更新系统）的新服务器。
- 无论选哪个，都不要在本机继续 Step 1 及以后的步骤。

只有这一步通过，才继续下面的步骤。

---

## Step 1：在本地构建并上传发布包

在开发机（不是服务器）上执行：

```bash
pnpm -r build

tar czf /tmp/cardgame-dist.tar.gz \
  packages/shared/dist packages/shared/package.json \
  packages/server/dist packages/server/package.json \
  packages/web/dist package.json pnpm-lock.yaml

scp /tmp/cardgame-dist.tar.gz root@119.29.198.188:/tmp/
```

注意：这里的 `packages/web/dist` 应该是**未设置 `CDN_BASE`**、走本地 `/` 路径的构建，
仅用于 nginx `location /` 的直连兜底（见 Step 4 与 Step 6 的说明）。真正对外服务的
静态资源走 CDN，构建方式见 Step 6。

---

## Step 2：在服务器上运行 install.sh

前置条件：Step 0 已通过；`/tmp/cardgame-dist.tar.gz` 已上传；
`/tmp/node-v22.14.0-linux-x64-glibc-217` 仍在（Step 0 解压出来的那份，`install.sh` 会直接使用它）。

```bash
scp deploy/cardgame.service deploy/install.sh root@119.29.198.188:/tmp/
ssh root@119.29.198.188 'bash /tmp/install.sh'
```

`install.sh` 会做（且只做）：创建 `cardgame` 系统用户、建好
`/opt/cardgame/{app,data,node,logs}` 目录、把验证过的 Node 挪进
`/opt/cardgame/node`、解压发布包到 `/opt/cardgame/app`、用该 Node 自带的 npm 只装
`fastify@5 ws@8` 生产依赖（纯 JS，无编译）、安装并启动 systemd 服务。它**不会**碰
nginx——那是下面 Step 3 单独手工做的事。

**验证服务已启动且没有影响 agent-hub：**

```bash
# 记录 agent-hub 现有 PID（在跑 install.sh 之前先记一次）
ssh root@119.29.198.188 'pgrep -f agent-hub/hub.py'

# install.sh 跑完之后
ssh root@119.29.198.188 'systemctl is-active cardgame && curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3100/api/login -H "content-type: application/json" -d "{\"nickname\":\"x\",\"password\":\"y\"}"'

# 再次确认 agent-hub 的 PID 与之前完全一致（没有重启、没有被波及）
ssh root@119.29.198.188 'pgrep -f agent-hub/hub.py'
```

期望：`systemctl is-active` 输出 `active`；登录接口返回 `401`（凭据不对，但服务已在跑）；
`agent-hub` 的 PID 前后完全相同的数字。**如果 PID 变了，立即 `systemctl stop cardgame`
并排查，不要继续后面的步骤。**

---

## Step 3：接入 nginx —— 全部署中唯一触碰共享资源的步骤

`deploy/cardgame.nginx.conf` 放到服务器的 `/usr/local/nginx/conf/` 下。

**执行顺序不可调换，每一步做完再做下一步：**

```bash
# 1) 备份现有配置
ssh root@119.29.198.188 'cp /usr/local/nginx/conf/nginx.conf /usr/local/nginx/conf/nginx.conf.bak.$(date +%s)'

# 2) 上传新配置文件（此时还没有被 include，纯新增，零风险）
scp deploy/cardgame.nginx.conf root@119.29.198.188:/usr/local/nginx/conf/

# 3) 手工编辑 nginx.conf：在 http {} 段末尾（与其它 include 放在一起）加一行：
#      include cardgame.nginx.conf;
#    用编辑器（vim/nano）手工加，不要用 sed 盲改这个文件。

# 4) 校验语法 —— 不通过绝不能进行下一步
ssh root@119.29.198.188 '/usr/local/nginx/sbin/nginx -t'

# 5) 只有 4) 显示 syntax is ok / test is successful 才能重载
ssh root@119.29.198.188 '/usr/local/nginx/sbin/nginx -s reload'

# 6) 验证现有两个服务没有受影响（状态码应与改动前一致）
ssh root@119.29.198.188 'curl -sk -o /dev/null -w "agent-hub: %{http_code}\n" https://127.0.0.1/ ; curl -sk -o /dev/null -w "console: %{http_code}\n" https://127.0.0.1:8443/'
```

**回滚（30 秒完成）：** 删掉 nginx.conf 里那一行 `include cardgame.nginx.conf;`，
然后：

```bash
ssh root@119.29.198.188 '/usr/local/nginx/sbin/nginx -t && /usr/local/nginx/sbin/nginx -s reload'
```

回滚不需要恢复备份文件——只删一行 include 即可，因为其余改动都是纯新增。

---

## Step 4：申请 TLS 证书（DNS-01，不占服务器的 80 端口）

在**本地开发机**执行，不在服务器上装 certbot：

```bash
certbot certonly --manual --preferred-challenges dns -d poker.tyyunan.com
```

按提示在 `tyyunan.com` 的 DNS 处添加 `_acme-challenge` 的 TXT 记录，验证通过后签发完成。

上传到服务器：

```bash
ssh root@119.29.198.188 'mkdir -p /opt/cardgame/certs'
scp /etc/letsencrypt/live/poker.tyyunan.com/fullchain.pem root@119.29.198.188:/opt/cardgame/certs/
scp /etc/letsencrypt/live/poker.tyyunan.com/privkey.pem root@119.29.198.188:/opt/cardgame/certs/
ssh root@119.29.198.188 'chmod 600 /opt/cardgame/certs/privkey.pem && /usr/local/nginx/sbin/nginx -s reload'
```

并把 `poker.tyyunan.com` 的 A 记录指向 `119.29.198.188`。

**证书 90 天后过期，且是手动 DNS-01 签发，无法自动续期**（这是「不碰服务器现有 80 端口」
换来的代价）。续期就是重复本节两条命令（重新 `certbot certonly` + 重新上传 + reload）。
**请在签发当天就设一个日历提醒（建议提前 2 周，即第 76 天左右），不要等到过期当天才处理。**

---

## Step 5：静态资源上 CDN（硬性要求，不是可选优化）

服务器出站带宽实测约 4.5 Mbps，且与 `agent-hub` 共享。**静态资源绝对不能走服务器直出**，
必须放到 CDN。这不是性能优化项，是容量硬约束——未来维护者请不要因为"看起来能直接从
nginx 提供"就把 CDN 步骤省掉。

```bash
# 1) 在腾讯云 COS 建桶（如 cardgame-static），开启静态网站与 CDN 加速
# 2) 用带 CDN_BASE 的方式构建
CDN_BASE=https://<你的CDN域名>/ pnpm --filter @cardgame/web build
# 3) 上传构建产物
coscmd upload -r packages/web/dist/ /
```

`packages/web/vite.config.ts` 已支持 `CDN_BASE` 环境变量（默认 `/`，不设置时构建行为不变）。

**验证：**

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" https://<你的CDN域名>/assets/index-*.js
```

期望：`200` 且体积与本地产物一致。随后在浏览器 DevTools 的 Network 面板确认 JS/CSS
全部来自 CDN 域名，只有 `/api` 与 `/ws` 走 `poker.tyyunan.com`。

---

## 数据库备份

服务器上没有 `sqlite3` 命令行工具。备份就是复制文件，注意 WAL 模式下要连同
`-wal` / `-shm` 一起复制，否则可能丢最近未 checkpoint 的写入。两种做法：

**方式 A（最简单，短暂停机）：**

```bash
ssh root@119.29.198.188 'systemctl stop cardgame && cp /opt/cardgame/data/cardgame.db* /backup/ && systemctl start cardgame'
```

**方式 B（不停机，用 WAL checkpoint）：**

```bash
ssh root@119.29.198.188 '/opt/cardgame/node/bin/node --experimental-sqlite -e "const {DatabaseSync}=require(\"node:sqlite\");const d=new DatabaseSync(\"/opt/cardgame/data/cardgame.db\");d.exec(\"PRAGMA wal_checkpoint(TRUNCATE)\")" && cp /opt/cardgame/data/cardgame.db* /backup/'
```

checkpoint 之后 `-wal` 文件会清空，此时单独复制主 `.db` 文件也是安全的。

---

## 目录布局速查

```
/opt/cardgame/
├── app/            # 代码（server dist、web dist、node_modules）
├── data/           # cardgame.db 及 -wal/-shm
├── node/           # glibc-217 版 Node（不进系统 PATH）
├── logs/           # out.log / err.log
└── certs/          # fullchain.pem / privkey.pem
```

## 常用运维命令

```bash
# 状态 / 启停 / 重启
systemctl status cardgame --no-pager
systemctl restart cardgame
systemctl stop cardgame
systemctl start cardgame

# 日志
tail -f /opt/cardgame/logs/out.log
tail -f /opt/cardgame/logs/err.log
journalctl -u cardgame -n 100 --no-pager
```

## 上线后核对（每次发新版都建议跑一遍）

```bash
ssh root@119.29.198.188 'free -h; systemctl status cardgame --no-pager | head -12; ls -la /opt/cardgame/data/'
```

期望：剩余可用内存仍在 2G 以上；`cardgame` 服务 `active`，内存占用 < 200M；数据库文件已生成。

**核对账本不变量**（服务启动时已自检一次，这里是人工二次确认，出问题时优先查这个）：

```bash
ssh root@119.29.198.188 '/opt/cardgame/node/bin/node --experimental-sqlite -e "const {DatabaseSync}=require(\"node:sqlite\");const d=new DatabaseSync(\"/opt/cardgame/data/cardgame.db\");console.log(d.prepare(\"SELECT COALESCE(SUM(delta),0) AS total FROM ledger_entries\").get())"'
```

期望：`{ total: 0 }`。如果不是 0，说明账本出现了不平账，先停服务再排查，不要继续对外提供服务。

## 故障排查

| 现象 | 先看哪里 |
|---|---|
| 服务起不来 | `journalctl -u cardgame -n 50`，`/opt/cardgame/logs/err.log` |
| 502 / 连不上 `/api` | `systemctl is-active cardgame`；确认监听在 `127.0.0.1:3100` |
| WebSocket 断线 | nginx `/ws` location 的 `proxy_read_timeout` 是否还是 3600s；nginx error log |
| 内存被限制 OOM | `systemctl status cardgame` 里的 `MemoryMax` 相关退出码；先看是不是本服务把自己的 1G 用满，agent-hub 不受影响 |
| 账本不为 0 | 立即停服务，参考"核对账本不变量"一节复查，不要继续写入 |
| agent-hub / console_site 受影响 | 立即执行 Step 3 的"回滚" |
