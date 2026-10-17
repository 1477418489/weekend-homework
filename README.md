# 周末作业打卡

给住校初中生用的周末作业打卡与奖励结算站点。学生点完成，家长确认或直接代办，周六晚结算积分，积分兑换奖励。可部署在 Cloudflare Workers 上，支持定时备份到 WebDAV。

配合根目录的 [周末作业奖励制度.md](../周末作业奖励制度.md) 使用：那个文件写规则，这个站点负责执行和留痕。

## 功能

- **学生**：看本周清单、加作业、点「我完成了」。
- **用时自己填**：作业时间不固定，加作业时学生自己填预估分钟，打卡时顺手填实际用时，卡片和结算页显示「预估 / 实际 / 差值」合计，家长只看总账。
- **家长**：确认学生点过的完成、「直接完成并确认」（家长代办，页面和记录里都会标注）、撤销、评分（质量分 0–4）、打分结算、批准兑换。
- **管理员**：管账号、配置 WebDAV、手动/定时备份、导出 JSON。
- **动态选项**：常用作业、奖励、加分项、扣分项都能随时增删停用，加作业时可存为常用项；首次部署已预置一批初中常用作业（语文背诵课文、数学做试卷、历史背诵知识点等），同名同科目的不会重复插入。
- **每周固定作业**：常用作业可以标成「每周固定」（已预置英语 · 单词背诵默写、语法背诵默写、练习题三项）；学生本周建第一条作业时，系统自动把启用中的固定项一并建好，卡片带「固定」标签，删掉后本周不会再自动补回。
- **积分账户**：每周结算分累加，减去已批准的兑换，余额不清零、不透支。
- **折现比例**：家长在结算页设「1 积分 = X 元」（0 表示不折现），结算、账户页和已结算提示直接显示金额折算；已结算的周按当时比例存下来，之后改比例不影响历史记录。金额只是兑现参考，账本和兑换仍然是积分。
- **手动刷新**：右上角「刷新」按钮随时重拉本周作业、积分和账户数据，并显示「更新于 HH:mm:ss」；学生打卡、家长确认同时在不同设备上用时，点一下就能看到最新状态。
- **定时备份**：Cron 每天触发，把全部数据导出成 JSON 上传到指定 WebDAV 目录，按保留份数清理旧文件。

## 角色权限

| 操作 | 学生 | 家长 | 管理员 |
| --- | --- | --- | --- |
| 查看本周清单与积分 | ✅ | ✅ | ✅ |
| 添加作业 / 申请兑换 | ✅ | ✅ | ✅ |
| 点「我完成了」 | ✅ | ✅ | ✅ |
| 确认完成 / 直接代办 | — | ✅ | ✅ |
| 评分、加扣分、结算 | — | ✅ | ✅ |
| 批准兑换、改删选项 | — | ✅ | ✅ |
| 账号管理、WebDAV、备份、导出 | — | — | ✅ |

一个部署对应一个家庭：所有登录用户看到同一份清单，区别只在权限。学生看不到「结算」和「设置」页。

## 计分规则（跟制度文档一致）

满分 100，结算页会把系统算的值直接填好，家长可以改任意一项再保存。

| 项 | 规则 | 分值 |
| --- | --- | --- |
| A 清单分 | 本周第一条作业在周五 21:00 前建好 | 10 |
| B 计划分 | 所有作业都填了计划时段（≥一半给 5 分） | 10 |
| C 完成分 | 完成率 ≥90% / ≥80% / ≥70% / 更低 → 30 / 20 / 10 / 0 | 30 |
| D 质量分 | 每科取该科任务平均质量分，各科相加，封顶 20 | 20 |
| E 提前分 | 最后一条在周六 15:00 / 18:00 / 21:00 前完成 → 10 / 8 / 5，之后 0 | 10 |
| F 自检分 | 家长勾选（默认 10） | 10 |
| G 复盘分 | 家长勾选（默认 10） | 10 |
| H 连胜分 | 前两周完成率都 ≥90% | 10 |
| 加分 | 手动添加，或选项库一键添加 | 不限 |
| 扣分 | 手动添加，封顶 30 | −30 |

「完成」以最后一条任务的完成时间为准；家长代办的完成时间同样计入，但记录里会标「家长代办」，事后能看出区别。

## 部署到 Cloudflare

### 方式一：Workers Builds（推荐，推代码即部署）

1. Fork 或推送本目录到自己的 GitHub 仓库。
2. Cloudflare 控制台 → `Workers & Pages` → `Create application` → `Import a repository`，选中该仓库。
3. 构建配置：Build command 留空，Deploy command 改成 `npm run deploy`（默认的 `npx wrangler deploy` 会跳过建库、迁移和设置码，见「常见问题」），Node.js 版本 22。
4. Build 用的 API Token 要带 `Account → D1 → Edit`：Workers Builds 自动生成的 Token 只有 Workers Scripts / KV / R2 / Zone 权限，不含 D1，到 `My Profile → API Tokens` 编辑它补上，或在 Build 设置里换成自己的 Token。
5. 保存并部署。首次部署会自动创建 D1 数据库、写入 `database_id`、应用迁移，并在日志里打印「首次设置码」。
6. 打开 Worker 地址，输入设置码，创建管理员账号。之后所有部署都会保留账号和数据。

### 方式二：本地 wrangler

```sh
npm install
npx wrangler login
npm run deploy
```

脚本做的事：按 `wrangler.jsonc` 里的库名查找或创建 D1 → 把 `database_id` 写回配置 → 应用迁移 → 部署（并把 `package.json` 的版本号注入 `APP_VERSION`）→ 如果是空库，签发设置码。

`workers_dev` 默认开启，部署后可直接用 `*.workers.dev` 访问；也可以自行绑定自定义域名。

### 首次初始化

1. 打开站点，页面会显示「首次设置」。
2. 填入部署日志里的设置码 + 管理员用户名 + 密码。
3. 用管理员登录，在「设置」里建学生账号和家长账号。

设置码存在 `SETUP_TOKEN` Secret 里；数据库里一旦有用户，`/api/setup` 直接返回 409，设置码不再有效。

## WebDAV 定时备份

在「设置 → WebDAV 定时备份」里填：

| 字段 | 说明 |
| --- | --- |
| 地址 | 例如坚果云 `https://dav.jianguoyun.com/dav/` |
| 用户名 / 密码 | WebDAV 账号；也可改用 `WEBDAV_PASSWORD` Secret，Secret 优先 |
| 目录 | 相对地址的目录，支持中文，如 `周末备份`，会自动逐级创建 |
| 保留份数 | 只保留最近 N 份，旧的自动 DELETE |
| 定时备份 | 打开后由 Cron 每天跑；关掉则只能手动点「立即备份」 |

Cron 表达式写在 `wrangler.jsonc` 的 `triggers.crons`，默认 `0 18 * * *`（UTC 18:00 = 北京时间 02:00）。改了之后重新部署生效。

备份文件是 `homework-YYYYMMDD-HHmmss.json`（北京时间命名），内容包含 `users / options / tasks / bonus_items / week_scores / redemptions / settings` 七张表的全部数据、导出时间和行数统计。**注意：`users` 表含密码哈希，备份文件要按敏感数据保管。**

管理员还可以点「导出 JSON」随时手动下载一份同样格式的备份。

## 本地开发

```sh
npm install
copy .dev.vars.example .dev.vars   # Windows，内容里设置 SETUP_TOKEN
npm run dev                        # 应用迁移到本地 D1 并启动 wrangler
```

打开 Wrangler 输出的地址（默认 `http://127.0.0.1:8787`），用 `.dev.vars` 里的设置码初始化。

```sh
npm test        # 跑计分规则单元测试（Node 内置测试运行器，不需要 Cloudflare 账号）
```

本地 D1 数据在 `.wrangler/state` 下，删掉即可重置。手机联调可以直接用同局域网 IP 访问本地服务（Cookie 的 Secure 标记只在 HTTPS 下加，所以 HTTP 也能登录）。

## 接口一览

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/status` | 公开 | 返回 `setup` / `login` / `closed` 与版本号 |
| POST | `/api/setup` | 公开 | 首次初始化管理员（仅空库） |
| POST | `/api/login` `/api/logout` | 公开 / 登录 | 会话 Cookie 有效期 30 天 |
| GET | `/api/me` `/api/week` `/api/account` | 登录 | 当前用户 / 指定周数据 / 积分账户 |
| POST | `/api/tasks` | 登录 | 新增作业（本周第一条会同时带出每周固定作业） |
| PATCH / DELETE | `/api/tasks/:id` | 登录 / 家长 | 改字段（质量分仅家长）/ 删除 |
| POST | `/api/tasks/:id/done` | 登录 | 标记完成，可带 `actualMinutes`（实际用时） |
| POST | `/api/tasks/:id/confirm` | 家长 | 确认完成 |
| POST | `/api/tasks/:id/complete` | 家长 | 直接完成并确认（代办） |
| POST | `/api/tasks/:id/reopen` | 家长 | 撤销回待完成 |
| POST | `/api/tasks/confirm-done` | 家长 | 一键确认本周所有已完成任务 |
| GET / POST | `/api/options` | 登录 | 动态选项；PATCH / DELETE 需要家长 |
| POST / DELETE | `/api/bonus` `/api/bonus/:id` | 家长 | 加分、扣分项 |
| POST / DELETE | `/api/settle` | 家长 / 管理员 | 结算与撤销结算 |
| PUT | `/api/rate` | 家长 | 设置积分折现比例（元/分，0 关闭） |
| GET / POST | `/api/redemptions` | 登录 | 兑换申请 |
| POST | `/api/redemptions/:id/decide` | 家长 | 批准 / 驳回 |
| GET / POST / PATCH | `/api/users` | 管理员 | 账号管理 |
| GET / PUT | `/api/settings` | 管理员 | WebDAV 配置（密码不回显） |
| POST | `/api/backup/run` | 管理员 | 立即备份 |
| GET | `/api/backup/log` `/api/export` | 管理员 | 备份日志 / 导出数据 |

写操作要求 `Content-Type: application/json`，并校验 `Origin`；响应统一带 `Cache-Control: no-store`。

## 数据与安全

- 密码用 PBKDF2-SHA256（10 万次迭代）+ 随机盐存储，会话表按过期时间自动清理。
- 页面响应带 CSP、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff` 等安全头。
- 注意：WebDAV 密码存在 `settings` 表里，管理员可见；想更稳妥就用 `wrangler secret put WEBDAV_PASSWORD`。
- 非 HTTPS 访问时 Cookie 不加 `Secure`（方便局域网和本地调试），生产环境是 HTTPS，会正常加上。

## 常见问题

**部署后打开显示「还没初始化」**：数据库没有用户，也没读到 `SETUP_TOKEN`。重新跑一次 `npm run deploy`，或用 `npx wrangler secret put SETUP_TOKEN` 手动设置后再部署。

**部署日志报 `D1 binding 'DB' references database '00000000-0000-0000-0000-000000000000' which was not found`**：Deploy command 还是默认的 `npx wrangler deploy`，直接把 `wrangler.jsonc` 里的占位 ID 拿去部署了。建库、回写 ID、应用迁移、签发设置码都在 `scripts/deploy.mjs` 里，把 `Worker → Settings → Build → Deploy command` 改成 `npm run deploy` 再重试即可。改完如果卡在 `wrangler d1 list`，就是 Token 缺 `D1: Edit`。

**设置码失效了**：数据库中已有用户，初始化入口按设计关闭。忘记管理员密码时，用管理员账号在「设置 → 用户」里改，或在 Cloudflare 控制台直接改 D1。

**备份一直失败**：先在「设置」里点「立即备份」看日志。常见原因是地址没写全（要带 `/dav/` 之类的路径前缀）、密码错（HTTP 401）、对方不支持 MKCOL。日志会记录最近 200 条结果。

**周次怎么算的**：以周五为界，周五到周日属于本周（周一对齐到上一个周五）。这个口径写在 `worker/scoring.js` 的 `weekKeyOf`，有单元测试覆盖。
