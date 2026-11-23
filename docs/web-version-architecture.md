# 网页版（H5）技术选型报告 — 下沙「今天吃什么」

> 状态：研究结论，供 lead 决策，不落代码。
> 背景：用户放弃小程序形态，改「网页版 H5 直接上云」，点链接就能用（避雷 + DeepSeek 深度思考问答）。
> 约束：成本低、时间短、国内访问稳定、lead 能直接部署、DeepSeek key 不能泄露。

---

## 0. 一句话结论

**把现有云函数「薄封装成 Node.js HTTP 后端」，用 WorkBuddy 自带的 `workbuddy_sites_deploy` 托管（单端口同时服务静态 H5 + `/api` 三个接口）；前端 WXML 重写成 HTML/CSS/JS；DeepSeek key 放后端 `.env`；600 店数据随后端打包进内存。** 唯一需要 WorkBuddy「云服务(BaaS)」的部分是可选增强，beta 阶段用不上。

---

## 1. 现状耦合点（迁移到底要改什么）

通读代码后，真正把后端绑在微信上的只有三处，其余几乎可原样搬：

| 模块 | 与微信耦合 | 迁移动作 |
|---|---|---|
| `recommend/service.js` `prompt.js` `whitelist.js` | 无 | **原样复用**（纯业务逻辑） |
| `recommend/llm.js` | 无（原生 `https` 调 DeepSeek，key 从 env 读） | **原样复用** |
| `shared/lib/data.js`（600 店加载） | 无（`fs.readFileSync` 读 JSON） | **原样复用** |
| `shared/lib/config.js` `errors.js` `validate.js` `time.js` | 无 | **原样复用** |
| `avoid-lookup/` 全部 | **零微信依赖** | **原样复用** |
| `recommend/index.js` + `usage-check/index.js` | ① `wx-server-sdk` ② `getWXContext()` 取 openid ③ `cloud.database()` | 换「HTTP 入口 + 新身份 + 新计数存储」 |
| `recommend/repo.js`（用量/封顶/缓存） | `cloud.database()` + `startTransaction()` | 换存储实现（见 §4） |
| `miniprogram/` 全部 WXML/WXSS | 整层是微信 UI | **重写为 HTML/CSS/JS（任何方案都躲不掉）** |

结论：**后端 90% 可复用**，真正的活是「把 3 个入口函数换成 HTTP 路由 + 换掉 openid 与云数据库」+「前端整层重写」。

---

## 2. 托管方案对比（4 选 1）

### 方案 A（推荐）：WorkBuddy `workbuddy_sites_deploy` — Node 后端 + 静态 H5

- 一个 Node HTTP 服务（`server.js`），监听 `$PORT`、绑 `0.0.0.0`，同端口：`/` 出静态 H5，`/api/recommend|avoid|usage` 出接口。
- DeepSeek key 放后端 `.env`，前端零 key。
- 600 店 JSON 随包，冷启动读进内存。
- 部署 = 调一次 `workbuddy_sites_deploy`，返回一个分享链接。

| 维度 | 结论 |
|---|---|
| 点链接即用 | ✅ 返回 HTTPS 链接 |
| 国内稳定 | ✅ WorkBuddy 腾讯系域名，大概率稳（需真机实测，见 §6） |
| 成本 | ✅ 无额外平台费（不触发 BaaS 开通） |
| lead 能否直接部署 | ✅ 一个工具搞定 |
| 时间 | ✅ 后端复用，只重写前端 + 换入口 |
| 代价 | 沙箱无常驻数据库 → 计数用内存（§4）；长响应 9~18s 需确认网关不截断（§6） |

### 方案 B：WorkBuddy `workbuddy_cloud_service`（BaaS）— 纯前端 + 免 key 大模型

前端直连 `cloud.llm`（免 key）+ `cloud.database`（PostgreSQL）+ `cloud.auth`（登录）。

| 维度 | 结论 |
|---|---|
| 免后端、免 key、托管 DB | ✅ |
| **调 DeepSeek** | ❌ `cloud.llm` 是 WorkBuddy 自己的模型网关目录，**不是 DeepSeek**，不满足「DeepSeek 深度思考」硬需求 |
| 现有非流式代码 | ❌ 该网关**只支持流式**（`stream:true` 强制） |
| **成本护栏（D1/C1，P0）** | ❌ 限次/封顶/白名单逻辑移到前端 = 打开 devtools 即可绕过，护栏形同虚设 |
| 身份 | ❌ 无匿名登录，需真实账号，openid 限次方案要改成登录制 |

**结论：排除。** 除非用户放弃 DeepSeek 且接受成本护栏可被绕过——这与已拍板 P0 直接冲突。

### 方案 C：腾讯云函数 HTTP 触发

给 3 个云函数开 HTTP 触发，拿到公网 URL，前端直接 fetch。

| 维度 | 结论 |
|---|---|
| 后端零重写 | ✅ |
| 国内稳定 | ✅ 腾讯云域名 |
| 身份 | ❌ HTTP 触发下无微信会话，`getWXContext()` 拿不到 openid → 限次身份必须重做（和方案 A 一样的活） |
| 部署 | ❌ lead 要碰腾讯云控制台 + 按量付费 + 配 HTTP 触发，不是一键 |
| 冷启动/费用 | ❌ 云函数 HTTP 按量计费、冷启动影响首字 |

**结论：可行但不如 A 快，且身份问题一样要解，lead 省不掉腾讯控制台操作。**

### 方案 D：Vercel / Netlify

| 维度 | 结论 |
|---|---|
| 国内访问 | ❌ Vercel/Netlify 域名国内常被墙/慢，与「国内稳定」直接冲突 |
| 额外依赖 | ❌ 需海外账号 + 外部 DB 存计数 |

**结论：排除。**

---

## 3. 推荐架构（方案 A 展开）

```
浏览器（同学点链接）
   │  GET /  → 静态 H5（HTML/CSS/JS，原 index/avoid/mine/why 四页重写）
   │  POST /api/recommend   → 问答（DeepSeek 深度思考 + 全量 600 店）
   │  POST /api/avoid       → 避雷查询（纯本地 JSON，零 key 零 DB）
   │  GET  /api/usage       → 用量预检
   ▼
Node.js HTTP 服务（workbuddy_sites_deploy 沙箱，单端口）
   ├─ 路由层：原 3 个 index.js 的 exports.main → HTTP handler（薄改造）
   ├─ 业务层：service.js / prompt.js / whitelist.js 原样复用
   ├─ LLM 层：llm.js 原样复用（DeepSeek key 来自 process.env / .env）
   ├─ 数据层：data.js 读打包的 restaurants.json（215KB，进内存）
   └─ 计数层：repo.js 的 DB 换成内存实现（§4）
```

### 三个问题直接回答

1. **前后端怎么分**：前端只做渲染 + 调 `/api`；后端是唯一接触 DeepSeek key 和种子数据的地方。前端**不**直接碰 DeepSeek、不碰 600 店全量（只收后端给的答案）。

2. **DeepSeek key 放哪**：放**后端目录 `.env`**，Node 启动时 `loadLocalEnv` 读进 `process.env`（现有 `config.js` 已实现）。随部署上传到**私有沙箱**，浏览器永远拿不到。**绝不放前端、不放静态资源、不进 git。** 当前这把 key 已泄露（曾出现在聊天里），上线前必须先去 `platform.deepseek.com/api_keys` 重置。

3. **600 店数据放哪**：**随后端打包成 `restaurants.json` 进内存**（215KB，可忽略）。不需要数据库——现有 `data.js` 已经这么干，零改动。

---

## 4. 唯一需要新写/改造的部分

### 4.1 身份（openid → 匿名设备号）

HTTP 下没有微信会话，openid 拿不到。改用**前端 localStorage 生成一个匿名 `device_id`** 传给后端做限次键。

- 代价：用户清缓存就能重置次数。**beta（≤10 人、约 ¥30/月）可接受**；要更严再上 WorkBuddy 登录（`cloud.auth`，但那是 B 方案的一部分，beta 不做）。

### 4.2 用量/封顶/缓存存储（云数据库 → 内存）

`repo.js` 的 `usage_daily` / `usage_month` / `reason_cache` 三张表，beta 用**进程内存 Map** 实现：

- 计数原子性：Node 单线程，同步 `++` 即原子，比云数据库事务还简单（`startTransaction` 那段可整体删掉）。
- 代价：**沙箱重启/空闲回收会清零计数**。beta 阶段封顶远未触顶（¥30 vs ¥300），风险可忽略。
- 扩量路径：接 Supabase 免费 PostgreSQL（`reason_cache`/`usage_*` 三张表，PostgREST 兼容），或迁到真正后端。**这是明确的 beta-only 取舍，写死在这里。**

### 4.3 前端重写（最大工作量，任何方案都逃不掉）

`miniprogram/` 的 WXML/WXSS → HTML/CSS/JS：index（问答）、avoid（避雷）、mine（我的清单 localStorage）、why（为什么）。交互逻辑（打字机、换一批排除链、红笔删除线）照搬，只换 UI 层。

---

## 5. 选型代价表（给用户看）

| 决定 | 我选什么 | 人话 | 改的代价 |
|---|---|---|---|
| 托管 | WorkBuddy 站点托管（Node 后端） | 你点链接就能用，不用买服务器、不用备案 | 低：代码是标准 Node，以后可搬任何云 |
| 身份 | 匿名设备号 | 不用登录，浏览器自动记个号来数次数 | 中：清缓存能重置次数，以后要严就加登录 |
| 计数存储 | 进程内存 | beta 人少，重启丢计数无所谓 | 中：扩量时接个免费数据库 |
| 模型 | 继续 DeepSeek 深度思考 | 还是原来的「AI 先想再选店」 | 低：key 换环境变量即可 |

---

## 6. 关键风险（上线前必须验）

1. **域名国内访问性**：WorkBuddy 是腾讯系，域名大概率国内可访问，但**必须在真机/同学手机上点链接实测**（不能只看 lead 本机）。
2. **9~18s 长响应**：深度思考 + 全量 600 店，单次 9~18s。后端超时已放宽到 30s；**但 `workbuddy_sites_deploy` 的反向代理/网关是否允许 30s 长连接需实测**，若被网关截断要改成「先返回占位 + 轮询」或缩短注入（回到召回模式）。
3. **内存计数重启清零**：beta 可接受，扩量前必须接持久化（见 §4.2）。
4. **key 已泄露**：必须先重置再部署（§3 问题 2）。
5. **无数据库后的事务语义**：`repo.js` 的 `startTransaction` 整体替换为同步内存实现，需保留「先扣额度再调模型、失败回退」的语义（现有 `reserveQuota`/`settleCost` 逻辑照搬，去掉 DB 层即可）。

---

## 7. 需要 lead 决策的点

1. **接受「内存计数、重启清零」的 beta 取舍？**（推荐：接受，扩量再接 Supabase 免费 PG）
2. **是否继续要求「DeepSeek 深度思考」？** 若坚持，方案 B（免 key 大模型）不可用；若不坚持，可重估 B。
3. **域名国内访问性**需要一次真机验证（部署后由 frontend/QA 协同点链接测）。

> 本报告未使用用户 IMA 知识库（连接器未接入），全部依据本地代码 + WorkBuddy 云服务官方 SDK 文档 + `references/` 架构知识库。
