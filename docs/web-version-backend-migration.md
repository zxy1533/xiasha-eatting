# 后端迁移盘点：微信云函数 → 网页版 H5 Node.js HTTP 后端

> 作者：后端（贝洛奇）｜性质：研究结论，不含代码改动｜日期：2026-11-23
> 输入：`cloud-functions/**`、`SPEC.md`、`DECISIONS.md`、`docs/decisions/ADR-*`
> 结论一句话：**纯业务逻辑（LLM/提示词/白名单/校验/种子数据）几乎全复用；真正要动的只有「入口层」和「数据层 repo」两处，预计 4~5 人日。**

---

## 0. 结论摘要（TL;DR）

| 维度 | 结论 |
|---|---|
| 复用比例 | 约 **70%** 代码原样复用（llm / prompt / whitelist / errors / time / validate / data / avoid-lookup.service / usage-check.service / 600 家种子） |
| 必须改 | 3 个 `index.js`（云函数入口 → HTTP handler）+ `recommend/repo.js`（微信云数据库 → 内存 store）+ `service.js` 小改（openid → 匿名/IP）+ `data.js`/`config.js` 路径微调 + 两个 `package.json` 去 `wx-server-sdk` |
| 可删 | `warnIfClientOpenid`、`cloud.getWXContext()`、跨集合事务 `db.startTransaction()`、`db.command` 的 CAS/inc、每日限次计数逻辑（已 0 不限） |
| 身份 | **完全去掉用户身份**（每日限次已取消，唯一需要的是防刷维度，用 IP） |
| Key | 服务端环境变量（`process.env.LLM_API_KEY`），与现状一致，只是从「云开发控制台」换成「云托管/云函数平台」 |
| 数据 | 600 店继续**打包进后端代码**（215KB，`readFileSync` 常驻内存），不进数据库 |
| 工作量 | 约 **4~5 人日**（净开发+自测，不含部署域名/备案/类目） |

**核心红利**：迁移不是「把云数据库换掉」，而是「把微信云数据库这套最重的东西删掉」。因为每日限次已取消、月封顶是全局单行、缓存是可丢数据，三者都能用**单进程内存**承载，比现在更简单。

---

## 1. 现状架构一句话

3 个云函数 + 共享库，依赖 `wx-server-sdk` 提供三样能力：

1. **身份**：`cloud.getWXContext().OPENID`（服务端取微信 openid）
2. **存储**：`cloud.database()`（文档型，`usage_daily` / `usage_month` / `reason_cache` 三集合）
3. **原子/事务**：`db.command`（`_.inc/_.lt/_.lte`）+ `db.startTransaction()`（daily+month 一起提交/回滚）

迁移就是把这三样能力**逐一带出去或删掉**，其余纯逻辑不动。

---

## 2. 逐文件迁移范围盘点

### 2.1 原样复用（0 改动或只动 import 路径）

| 文件 | 为什么能复用 | 是否要动 |
|---|---|---|
| `recommend/llm.js` | 原生 `https` 调 DeepSeek，Key 从 config（env）读，无任何 wx 依赖；超时/限长/错误归一已齐全 | **不动** |
| `recommend/prompt.js` | system 提示词 + `buildStoreDigest` + `buildMessages` + `buildCacheKey`（`crypto`），纯逻辑 | **不动** |
| `recommend/whitelist.js` | 模型输出校验（店名白名单/证据回溯/库外店名拦截/PII），纯逻辑 | **不动** |
| `shared/lib/errors.js` | 统一错误码/信封（`ok`/`fail`/`normalizeError`/`AppError`） | **不动** |
| `shared/lib/time.js` | 上海时区 `dateKey/monthKey` 计算 | **不动** |
| `shared/lib/validate.js` | `checkQuestion`/`checkExclude`/`checkQuery`/`normalizeName`/`normalizeQuestion`/`containsPII` | 几乎不动，仅 `warnIfClientOpenid` 可删（见 2.3） |
| `shared/lib/env.js` | 零依赖 `.env` loader，本地开发仍可用（生产用平台环境变量） | 可不动，或换 `dotenv`（非必需） |
| `shared/data/restaurants.json` | 600 家种子，215KB，公开只读数据 | **不动**（数据本身） |
| `avoid-lookup/service.js` | 本地查询逻辑，不调模型、不碰 wx | **不动** |
| `usage-check/service.js` | 用量计算逻辑 | 小改：去掉 `openid` 形参（见 2.2） |

> 结论：上面这 10 个文件承载了**全部业务价值**（拍板、防编造、防串味、成本护栏、查询），迁移后原样保留。

### 2.2 必须改（关键改动点）

| 文件 | 现状 | 改成什么 | 改动量 |
|---|---|---|---|
| `recommend/index.js` | `wx-server-sdk` 入口，`cloud.init` / `cloud.database` / `cloud.getWXContext` | Express 路由（或 HTTP 云函数 handler）：从 `req.body` 取入参，身份换成 IP/匿名 | 中（整文件重写，<60 行） |
| `recommend/repo.js` | 微信云数据库：`db.collection().where().get()`、`db.command`、`db.startTransaction()`、CAS 条件更新 | **单机内存 store**（或 SQLite），月封顶/突发闸/缓存全部内存承载 | **大（迁移核心，约 50~80 行）** |
| `recommend/service.js` | `deps.openid`、`deps.db` | `deps.userKey`（IP 或空）、`deps.store`；`dailyId = ${openid}|${dateKey}` 逻辑删除 | 小 |
| `usage-check/index.js` | `wx-server-sdk` 入口 | HTTP handler，去掉 `getWXContext` | 中 |
| `usage-check/repo.js` | `db.collection().where().get()` | 新 store 的 `getMonth`/`getDaily` | 小 |
| `shared/lib/data.js` | `SEED_PATH = path.join(__dirname, '..', 'data', 'restaurants.json')` | 改为打包路径（`require('../data/restaurants.json')` 或部署产物绝对路径） | 小（1~2 行） |
| `shared/lib/config.js` | `loadLocalEnv(__dirname)` + `loadLocalEnv(...recommend 目录)` | 路径改到新目录结构 | 小 |
| `recommend/package.json` | `wx-server-sdk ~2.6.3` | 去掉 wx-server-sdk，加 `express`（若走 Express） | 小 |
| `usage-check/package.json` | 同上 | 同上 | 小 |
| **新增** `server.js` / `app.js` | 无 | Express 装配：CORS + JSON body + 3 条路由 + 错误捕获中间件 | 新增（<80 行） |

### 2.3 可删 / 可简化

| 项 | 为什么能删 | 删除后影响 |
|---|---|---|
| `cloud.getWXContext().OPENID` | 网页版无微信登录；每日限次已取消，无身份需求 | 无 |
| `warnIfClientOpenid`（validate.js） | openid 概念消失 | 无 |
| `dailyId = ${openid}|${dateKey}` | 每日限次=0 不限，daily 表仅剩观测意义 | 无 |
| `db.startTransaction()` 跨集合事务 | daily+month 一起提交的需求随 daily 表删除而消失；month 单行自增在单机内存是原子的 | 无（更简单） |
| `db.command` 的 `_.inc/_.lt/_.lte` CAS 条件更新 | 单进程事件循环内同步自增天然原子，无并发竞争 | 无（更简单） |
| `wx-server-sdk` 依赖 | 不再需要 | 无 |

---

## 3. 四个问题的回答

### 3.1 `repo.js`（用量计数 / 缓存 / 事务）怎么替代？有没有可简化的？

**微信云数据库能力 → 替代方案对比：**

| 微信能力 | 现状用途 | 网页后端替代 | 推荐 |
|---|---|---|---|
| `db.collection().where().get()` 主键读 | usage_daily/month、缓存读 | 内存 `Map` / 单变量 / SQLite | **内存** |
| `db.command` 的 `_.inc` 原子自增 | 扣次数、累成本 | JS 同步 `+=`（单进程天然原子） | **内存** |
| `db.command` 的 `_.lt/_.lte` + 条件更新 CAS | 防并发超限/超顶 | 同步「判断 + 自增」在同一 tick 内完成，无需 CAS | **内存** |
| `db.startTransaction()` 事务 | daily+month 一起回滚 | 无跨表需求（daily 已删） | **删除** |
| `.doc(key).set()` upsert 缓存 | 写 reason_cache | 内存 `Map.set(key, value)` + 写入时间戳做 TTL | **内存** |

**最省事方案：单进程内存 store（beta 阶段强烈推荐）**

理由：
1. **每日限次已取消**（`LIMIT_DAILY=0`，`service.js` 里 `limitDaily=Infinity`）→ `usage_daily` 表唯一剩余价值（每日计数）消失，整表可删。
2. **月封顶是全局单行**，不是按人，内存一个 `{cost_micros, calls}` 对象就够了；`Node.js` 单进程事件循环里，`month.cost_micros += estimate` 这种同步代码天然原子，不需要事务/CAS。
3. **缓存是可丢数据**（SPEC §4.4 RPO=24h），内存 `Map` + TTL，重启清零完全可接受。
4. **突发闸**（10s 窗口 ≤3 次）用内存 `Map<ip, {windowStart, count}>` 滑动窗口，比云数据库 CAS 更简单。

**月封顶和突发闸是否还需要保留？——保留，但大幅简化。**

| 护栏 | 是否保留 | 理由 |
|---|---|---|
| 每日限次（F7-a） | **不保留**（已 0 不限） | 用户已拍板，`usage_daily` 可删 |
| 月封顶（F7-b，¥300） | **保留** | 它是 D1「全接大模型」+ C1「成本风险」的财务红线刹车，与每日限次是两码事。即使 beta 月成本 ¥9.9 不触顶，仍是成本失控的最后一道闸，删了等于撤掉唯一财务护栏 |
| 突发闸（F7-f，10s≤3 次） | **保留** | 网页版公开 URL 没有微信生态天然挡，**比小程序更需要**防刷；按 IP 内存滑动窗口即可 |

**关键代码片段示意（内存 store 替代 repo.js 的核心，非完整实现）：**

```js
// store.js —— 单进程内存 store，替代微信云数据库的 repo
const { CODES, AppError } = require('../shared/lib/errors');

const month = { cost_micros: 0, calls: 0 };        // 全局单行：月封顶真源
const cache = new Map();                            // key -> { answer, created_at }
const burst = new Map();                            // ip -> { windowStart, count }

function reserveQuota(userKey, nowMs, p) {
  // 突发闸：滑动窗口 10s ≤ 3 次（F7-f）
  const w = burst.get(userKey);
  if (w && nowMs - w.windowStart < p.windowSec * 1000 && w.count >= p.burstMax) {
    throw new AppError(CODES.RATE_LIMIT);
  }
  if (!w || nowMs - w.windowStart >= p.windowSec * 1000) {
    burst.set(userKey, { windowStart: nowMs, count: 1 });
  } else {
    w.count += 1;
  }
  // 月封顶：先判断预算够不够本次预估成本（F7-b）
  if (month.cost_micros + p.estimateMicros > p.cap) {
    throw new AppError(CODES.MONTHLY_CAP);
  }
  month.cost_micros += p.estimateMicros;
  month.calls += 1;
  return { monthlyUsed: month.cost_micros };
}

function settleCost(monthKey, estimated, actual) {
  // LLM 失败/实际用量更小时，归还预留的差额（service.js 的 settleSafely 调用）
  const delta = Math.max(0, Math.min(estimated, actual)) - estimated;
  if (delta !== 0) month.cost_micros += delta;
}
```

> 注意：`reserveQuota` 的「判断 + 自增」必须写成**同步代码**，与 LLM 调用解耦——先预留，LLM 失败再 `settleCost` 归还（`service.js` 现有 `settleSafely` 逻辑原样保留）。

> 若后续要扩容到多实例（全校 DAU 1000+），内存 store 不满足「多实例共享计数」，届时再升级为 SQLite（better-sqlite3，单文件、有事务/条件 UPDATE）或云数据库。beta 阶段**不需要**提前做这件事（避免过早优化）。

### 3.2 用户身份（openid）怎么处理？

**结论：完全去掉用户身份。**

理由链：
1. 身份的唯一用途是**每日限次**（`usage_daily._id = openid|dateKey`，按人计数）——**已取消**。
2. `usage_month` 是**全局单行**（`_id = YYYY-MM`），不按人。
3. 缓存 `reason_cache` 按**问题内容**（`cacheKey`）不按人。
4. 「我的清单」目前是前端 `localStorage`，不联网，不依赖 openid。

所以没有任何业务需要「知道某个用户是谁」。

**唯一需要的是一个防刷维度**，用服务端 IP：
- `req.ip`（Express 自带，或 `x-forwarded-for`，注意可伪造但 beta 够用）
- 用于突发闸（F7-f）的 key
- 真正防成本失控靠「突发闸 + 月封顶」双层，IP 只是其中一个粗粒度维度

**三个候选方案对比（给主理人决策用）：**

| 方案 | 做法 | 代价 | 推荐 |
|---|---|---|---|
| **A 完全去掉身份（IP 防刷）** | 无任何用户标识，突发闸按 IP | IP 可伪造/换网绕过；但 beta 成本极低、无隐私采集、最省事 | **推荐** |
| B 匿名 UUID | 前端 `localStorage` 存 `crypto.randomUUID()`，请求头带上 | 多一个字段 + 前端改动；换浏览器/清缓存即丢身份；好处是防刷比 IP 稳一点 | 备选 |
| C 保留账号/微信登录 | 网页版接微信网页授权或手机号 | 违背「不建账号」决策，工程量 + 隐私合规大幅上升 | 不推荐 |

> 若未来恢复每日限次或要做「跨设备同步我的清单」，再补方案 B（匿名 UUID），改造成本低（只是在入口加一个字段 + service 一个参数）。

### 3.3 DeepSeek key 放哪最安全？

**服务端环境变量**（`process.env.LLM_API_KEY`），与现状逻辑完全一致，只是平台从「微信云开发控制台环境变量」换成「云托管 / 云函数 / 任意 Node 平台的环境变量」。

| 环境 | Key 存放位置 |
|---|---|
| 生产 | 部署平台的环境变量/密钥管理（如 CloudBase 云托管环境变量、云函数配置、Vercel/Render env） |
| 本地开发 | `.env` 文件（`.gitignore` 已忽略，不进 git） |

**注意事项（含一个安全发现）：**
1. **发现的泄露风险**：当前仓库本地磁盘 `cloud-functions/recommend/.env` 内**明文存在真实 DeepSeek key**（`sk-02a6...`）。虽然 `.gitignore` 已排除（`git ls-files` 确认未进版本库），但该 key 在开发环境明文落地过，且本对话/历史任务中已出现过。**迁移时强烈建议轮换这个 key**（DeepSeek 控制台重新生成，旧 key 作废），新 key 只在部署平台注入。
2. 部署产物（镜像/函数包/前端 bundle）内**不得**出现 key 字符串——迁移后跑 `grep -r "sk-" <部署产物>` 验证（对应 SPEC AC-08）。
3. `config.js` 的 `resolveConfig` 已经在**冷启动时校验 key 缺失即抛 50003**，这个「配置错大声失败」逻辑原样保留，无需改。

### 3.4 600 家店数据怎么加载？

**打包进后端代码，`readFileSync`/`require` 常驻内存（推荐，与现状一致）。**

| 方案 | 做法 | 代价 | 推荐 |
|---|---|---|---|
| **A 打包进代码** | `require('../data/restaurants.json')` 或 `fs.readFileSync` 一次读入内存，进程内缓存（`data.js` 已有 `cachedSeed` 机制） | 215KB 打进部署包，可忽略；冷启动一次性读入，<20ms | **推荐** |
| B 静态文件 | 作为 public 资源/独立文件 | 会额外暴露全量数据给前端（无害但不必要）；多一次请求/配置 | 不推荐 |
| C 云数据库 | 入库 + 查询 | 违背 ADR-0004「静态 JSON 本地查询」决策；多网络跳、多成本 | 不推荐 |

`data.js` 唯一要改的是 `SEED_PATH`（相对路径）改成部署产物的打包路径，`loadSeed`/`search`/`getById`/`byName` 逻辑全部复用。

---

## 4. 迁移工作量清单（汇总）

### 4.1 三类文件清单

**复用（10 个，0 改动或只动路径）：**
- `recommend/llm.js`、`recommend/prompt.js`、`recommend/whitelist.js`
- `shared/lib/errors.js`、`shared/lib/time.js`、`shared/lib/validate.js`、`shared/lib/env.js`
- `shared/data/restaurants.json`
- `avoid-lookup/service.js`、`usage-check/service.js`（后者删 openid 形参）

**需改（10 个 + 1 新增）：**
- `recommend/index.js`、`usage-check/index.js`（入口改造）
- `recommend/repo.js`（→ `store.js` 内存实现，迁移核心）
- `recommend/service.js`（openid→IP/匿名，db→store）
- `usage-check/repo.js`（→ 新 store）
- `shared/lib/data.js`、`shared/lib/config.js`（路径微调）
- `recommend/package.json`、`usage-check/package.json`（去 wx-server-sdk）
- **新增** `server.js` / `app.js`（Express 装配 + CORS + 路由 + 错误中间件）

**可删（6 项）：**
- `cloud.getWXContext()` / `warnIfClientOpenid` / `dailyId` openid 前缀
- `db.startTransaction()` 跨集合事务
- `db.command` 的 `_.inc/_.lt/_.lte` CAS
- 每日限次计数逻辑（`usage_daily` 表）
- `wx-server-sdk` 依赖

### 4.2 关键改动点（一句话版）

1. **入口**：`exports.main(event)` → `app.post('/api/recommend', handler)`；入参从 `event` 变成 `req.body`；出参沿用 `{code, data, message}` 信封（前端契约不变）。
2. **身份**：删 `getWXContext`，突发闸 key 用 `req.ip`。
3. **数据层**：`repo.js` 三集合读写 → 内存 `Map`/变量（月封顶、缓存、突发闸），删事务。
4. **加载**：`data.js` 路径调整，其余复用。
5. **依赖**：去 `wx-server-sdk`，加 `express`。

### 4.3 工作量估算（人日）

| 模块 | 人日 | 说明 |
|---|---|---|
| Express 服务装配（app + 3 路由 + CORS + 错误中间件） | 0.5 | 新增 server.js/app.js |
| `repo.js` → 内存 store（月封顶/突发闸/缓存） | 0.5 | 迁移核心，约 50~80 行 |
| `service.js` 小改（openid→IP，db→store） | 0.5 | 逻辑不动 |
| 3 个 `index.js` → HTTP handler | 0.5 | 薄入口重写 |
| `data.js`/`config.js` 路径 + 打包 | 0.5 | 微调 |
| 联调 + 测试改造（现有 mock db → 内存 store） | 1.5 | 复用 `scripts/test_cloudfunctions.js` / `test_backend.py` 的测试框架 |
| 部署配置（环境变量/Key/CORS/轮换 key） | 0.5 | 含 key 轮换 |
| **合计** | **4.5 人日 ≈ 0.25 人月** | 不含域名/备案/微信类目资质 |

> 对比 SPEC §12 原小程序后端约 7~8 人日：迁移省下的正是「数据清洗（3 人日已做）+ 微信云数据库事务/CAS 那套最重的活」。

---

## 5. 需要决策的点（报给主理人，勿自行拍板）

| # | 决策 | 候选 | 我的推荐 | 代价 |
|---|---|---|---|---|
| D-mig-1 | **部署形态** | A 腾讯云开发「云托管/HTTP 云函数」跑 Express（仍可用云数据库，repo 改动更小）／B 通用 Node 云平台（Vercel/Render/云服务器）跑 Express + 内存/SQLite store | **看「直接上云」具体指哪个云**；若选 CloudBase 云托管可进一步复用 `@cloudbase/node-sdk`，repo 改动最小；若选通用平台则用本文内存 store | 选错存储层要返工 repo |
| D-mig-2 | **用户身份** | A 完全去掉身份（IP 防刷）／B 匿名 UUID／C 保留账号 | **A** | B/C 增加前端改动或合规负担 |
| D-mig-3 | **月封顶 + 突发闸是否保留** | A 保留（内存简化）／B 只保留突发闸／C 全删 | **A（两个都保留，内存实现）** | 全删 = 撤掉 D1 成本失控的最后刹车 |
| D-mig-4 | **DeepSeek key 是否轮换** | A 迁移时轮换（推荐，旧 key 已在开发环境明文落地）／B 沿用 | **A** | 轮换需重新生成并更新部署配置 |

> 说明：D-mig-1 是技术选型，本应由架构师定；但「网页版 H5 直接上云」的「云」具体指哪家会直接影响 repo 存储层的实现，故列为决策点，请架构师/主理人确认后回填。其余 D-mig-2/3/4 是范围与安全取舍。

---

## 6. 风险与注意事项

1. **Key 泄露**：`cloud-functions/recommend/.env` 含明文真实 key（未进 git，但本地落地过）。迁移时轮换。
2. **单机内存 store 的限制**：重启丢计数/缓存（可接受，缓存和用量都是可丢数据）；多实例不共享（beta 单实例够用）。若扩容到全校 DAU 1000+，需升级 SQLite/云数据库，届时再评估。
3. **IP 可伪造**：`x-forwarded-for` 客户端可伪造，突发闸按 IP 只是粗粒度防刷，真正的成本护栏靠月封顶（¥300 硬顶）。
4. **CORS**：网页版 H5 与后端跨域，必须配 CORS，且生产 `origin` 明确指定前端域名、**禁止 `*`**（后端口径）。
5. **超时预算**：原 SPEC §9.3 的「小程序 12s / 云函数 10s / LLM 8s」需要按新栈重新标定（Express 侧无云函数冷启动，可适当放宽 LLM 读取超时，但 DeepSeek thinking 实测 9~18s，`LLM_READ_TIMEOUT_MS=30000` 已设，需核对）。
6. **契约不变**：响应信封 `{code, data, message}` 与三个端点的出入参字段**保持不变**，前端迁移时 `services/recommend.js`、`avoid.js`、`usage.js` 只需把 `wx.cloud.callFunction` 换成 `fetch`，业务字段零改动。
