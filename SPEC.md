# 技术规格与契约（SPEC）｜下沙「今天吃什么」微信小程序

> 阶段：Phase 1 定案。这份文件是**契约**，不是介绍：前后端、QA、运维只按这里实现，改动先改本文件再改代码（活规格）。
> 输入：`research/brief.md`（需求与验收）、`DECISIONS.md`（D1/D2/D3 已拍板）。
> 标注约定：`[假设]` = 待用户/环境确认，不确认也能往下走；`[锁定]` = 本文件已定，改动要走决策。
> 知识库出处见文末 §14。原文引自 `research/brief.md` 的数字均标注来源，未标 `[假设]` 的约束来自已拍板决策。

---

## 0. 契约优先级与不可推翻项

| 优先级 | 条目 | 来源 |
|---|---|---|
| P0 | 问答机器人全接大模型，不做本地规则排序、不做规则+模型混合兜底；到顶=停调用给静态提示/返回缓存 | D1、brief §0/§3/§5 |
| P0 | 开放全校，不做白名单体验版小范围内测（发布前类目资质另议） | D2 |
| P0 | 种子数据来自真实微信共享表格清洗，不另造 | D3 |
| P0 | 小程序前端构建产物不得出现任何模型 API Key | AC-08、F7-e |
| P1 | 避雷查询走本地数据，不调大模型 | F2、技术代劳表 |
| P1 | 不建账号，用微信静默标识（openid）做限次 | DECISIONS §四 |

> 冲突处理（C1）：限流、静态提示、缓存命中都**不算**"混合兜底"；唯一算推翻 D1 的动作是把排序/拍板判断交给本地规则。本 Spec 全文不设任何本地打分规则。

---

## 1. 约束识别（先写清规模/延迟/成本/合规/团队五类）

| 类别 | 约束 | 数值/来源 |
|---|---|---|
| 规模 | 全校学生，按 2 万学生、日活 5%–15%（1000–3000，激进 4500）估 | brief §5，`[假设]` 待 Q2 确认 |
| 数据 | 12 张表，好吃的约 520 行、好难吃约 167 行；种子总量千级，远未到需要向量库 | PROJECT_STATE §2 |
| 延迟 | 避雷查询 ≤1.5s（AC-01）；问答首字 <3s、完整 P95 <8s（AC-02） | brief §4 |
| 成本 | 月度封顶 ¥300 试运行（F7-b）；单人 10 次/日（F7-a） | brief §5、Q5，`[假设]` 跑一周再调 |
| 合规 | 面向不特定公众，类目资质待确认（Q3）；学生评价需张鑫宇点头授权（Q4）；脱敏是底线 | brief §6 |
| 团队 | 用户是大一学生，无后端运维能力；本机未装微信开发者工具（不影响出 Spec，Phase 3 换机验证） | brief §1、派单说明 |
| 环境 | Python 无 openpyxl，清洗脚本只能用标准库 `zipfile` + `xml.etree.ElementTree` 解析 xlsx | 派单说明，`[锁定]` |

> 五类约束的共同结论：这是一个**读多写少、数据千级、单人可维护、成本必须硬顶**的小程序。任何引入独立服务（向量库、Redis、常驻后端）的方案都与约束冲突。

---

## 2. 技术选型与方案对比

### 2.1 三方案对比（每案写"代价是什么"）

| 方案 | 组成 | 为什么适合/不适合 | 代价（关键） |
|---|---|---|---|
| **A 原生小程序 + 微信云开发（选用）** | WXML/WXSS/JS 原生 + 云函数(Node.js) + 云数据库 + 静态 JSON | 单端、只发微信、无跨平台需求；云开发免运维、免备案域名、Key 只在云函数天然满足 F7-e；本地数据读 JSON 满足 F2 且省钱 | 锁定微信生态，将来要发支付宝/抖音需重写；云函数冷启动对首字有几十~几百 ms 影响 |
| B Taro 3 + 云开发 | React 语法跨端，云函数同上 | 跨端是"以后可能要"，当前只有微信一端；多一层构建和框架 runtime | 多一层编译链和包体，调试链路变长；跨端能力用不上=白付成本，违反约束"不选未来 3 年的扩展性" |
| C Next.js + FastAPI + PostgreSQL + 独立部署 | Web/自建后端 | 适合 SaaS/内容站；本项目是微信小程序、无 Web 端 | 要自购服务器/域名/备案、要运维、Key 与限次全自建；与"单人可维护+¥300 封顶"直接冲突 |

评分（权重：学习成本/生态/部署成本/团队熟悉度=高，扩展性=低，依据 mvp-stack.md 矩阵）：A=4.8、B=4.0、C=2.6。**选 A**。

### 2.2 分层架构（依赖只能向下）

```
┌─ 表现层  小程序 pages/ + components/    只做：渲染、输入校验、调 services、展开证据
│                ↓ wx.cloud.callFunction
├─ 接口层  云函数 index.js（薄入口）       只做：openid 取会话、参数校验、路由分发、错误归一
│                ↓
├─ 业务层  services/（recommend/avoid/usage）只做：限次判定、缓存、注入拼装、白名单校验、成本累计
│                ↓
├─ 数据层  repo/ + data/restaurants.json   只做：读静态种子、读写 usage/counter/cache 集合
│                ↓
└─ 基础设施 微信云开发（云数据库/云函数） + 大模型 HTTP API（仅云函数可达）
```

### 2.3 目录结构树（Phase 3 工程按此落地）

```
app/
├── miniprogram/
│   ├── app.js / app.json / app.wxss        # 入口：注册、tabBar 配置，不写业务
│   ├── pages/
│   │   ├── index/                          # 今日推荐 / 问答（首页）
│   │   ├── avoid/                          # 避雷查询
│   │   ├── mine/                           # 我的清单（本地 storage）
│   │   └── why/                            # 「为什么推荐」展开层（半屏/独立页）
│   ├── components/
│   │   ├── verdict-badge/                  # 褒/贬/有争议 标签
│   │   ├── evidence-card/                  # 脱敏学生原话卡片
│   │   ├── usage-tip/                      # 用量提示与降级提示条
│   │   └── answer-stream/                  # 流式/打字机渲染容器
│   ├── services/
│   │   ├── recommend.js                    # 调 recommend 云函数 + 流式拼接
│   │   ├── avoid.js                        # 调 avoid-lookup
│   │   ├── usage.js                        # 调 usage-check
│   │   └── storage.js                      # 我的清单本地读写
│   ├── utils/
│   │   ├── safe-render.js                  # 文本转义（禁富文本直出，见 §9）
│   │   └── normalize.js                    # 店名归一化（前端查询展示用，不参与打分）
│   ├── types/index.d.ts                    # 与 §4 schema 对齐的 TS 声明（JSDoc 亦可）
│   └── assets/icons/                       # 统一 SVG 图标库（见 §9.5），禁止 emoji 图标
├── cloud-functions/
│   ├── recommend/
│   │   ├── index.js                        # 薄入口（<100 行）：取 openid、校验入参、调 service、错误归一
│   │   ├── service.js                      # 业务：限次→缓存→召回→注入→调模型→白名单校验→写缓存/计数
│   │   ├── llm.js                          # 大模型 HTTP 调用（Key 从环境变量读，超时在此）
│   │   ├── prompt.js                       # system 提示词常量 + 字段白名单投影
│   │   ├── whitelist.js                    # 返回店名白名单校验 + 库外店名拦截
│   │   ├── repo.js                         # usage/counter/cache 集合读写
│   │   └── package.json                    # 无第三方 Key 依赖；锁版本
│   ├── avoid-lookup/
│   │   ├── index.js                        # 薄入口
│   │   ├── service.js                      # 店名/商圈匹配 + 判定聚合 + 取 1–2 条证据
│   │   ├── repo.js                         # require('../shared/data/restaurants.json')，进程内缓存
│   │   └── package.json
│   ├── usage-check/
│   │   ├── index.js / service.js / repo.js / package.json
│   └── shared/
│       ├── data/restaurants.json           # 清洗产物（唯一权威，随函数打包，冷启动读入内存）
│       ├── lib/{errors,config,validate}.js # 错误码、配置 resolve、边界校验（九个边界，见 §9.2）
│       └── types/index.d.ts
├── data/
│   ├── restaurants.json                    # 与 shared/data 同步的仓库副本（单一份，构建时复制）
│   └── restaurants.schema.json            # §4.2 的 JSON Schema（校验脚本用）
├── scripts/
│   ├── clean_seed.py                       # F1 清洗：标准库 zipfile+ET，产出 data/restaurants.json
│   ├── validate_seed.py                    # 按 schema 校验 + 脱敏抽检
│   └── gates/                              # 从专家包 templates/gates 复制，Phase 3 起跑基线
├── docs/decisions/ADR-*.md                 # §13 ADR，五段式
├── openapi.yaml                            # §5 契约的机器可读版（前端生成类型/MSW mock）
└── SPEC.md                                  # 本文件
```

**文件组织硬规则**（来自 code-organization.md，出现即退回）：单文件 ≤300 行；云函数 `index.js` 只做装配 <100 行；业务逻辑不进入口、不进 utils；类型/Schema 独立文件；`repo/` 不含业务判断。清洗脚本 `clean_seed.py` 例外可到 300 行上限，超了按"读 xlsx / 归一化 / 过滤 / 输出"拆 4 个模块。

---

## 3. 术语与代价（出现即写全，四行制）

```
[术语] 云开发
[人话] 腾讯替我们管服务器、数据库和函数，我们只写代码
[决定] 云函数 + 云数据库 + 静态 JSON，不自建后端
[代价] 中：锁定微信生态；迁移到别家要重写接口层

[术语] 大模型全接
[人话] 用户问一句，就真的问一次 AI，由 AI 拍板，不用写死的规则
[决定] recommend 每次判断都来自模型；到顶停调用给静态提示，绝不切本地规则
[代价] 高：成本和延迟跟调用量走，必须靠 §7 六条护栏焊死

[术语] 脱敏
[人话] 把同学原话里的昵称、头像、学号、精确时间抹掉，只留"这话说了什么"
[决定] 清洗阶段过滤 + 注入字段白名单 ≤5 + 返回前二次检查（§7-d）
[代价] 中：清洗要做两遍（入库前、发送前），证据可能变短

[术语] 缓存 key 防串味
[人话] 不同问题不能用同一份答案，key 要把"问了啥、圈了哪些店、排除哪些店"都算进去
[决定] SHA-256(normalize(q)+命中店ID集合+排除店ID集合+data_version+prompt_version)
[代价] 中：key 设计错了要回填历史缓存；已在 DECISIONS §四记为技术代劳

[术语] openid 限次
[人话] 不用注册登录，微信给每个用户一个隐藏编号，靠它数"今天问了几次"
[决定] 云函数从 wx.cloud 会话取 openid，不信前端传的 id；不建账号表
[代价] 中：跨设备/换微信无法同步"我的清单"；以后要同步得补账号

[术语] 月度封顶
[人话] 这个月 AI 花到 ¥300 就全局停，但查店名照常能用
[决定] 累计 token 成本写到 usage_month 集合，先扣额度再调用，≤¥300 才放行
[代价] 高：月中就停会伤体验，数值跑一周必调（Q5）

[术语] 整数分
[人话] 钱不用小数存，用"分"的整数，避免 0.1+0.2 那种误差
[决定] 成本累计用整数"微分"（1 元 = 1,000,000 微分，见 §4.4），禁浮点
[代价] 低：展示时除 1e6，注意前端别二次格式化
```

---

## 4. 数据模型

## 4.1 归属、金额、事务边界、时区、软删除（非功能声明）

- **数据归属维度**：本项目**单租户**（一个小程序、一个学校圈），无 `tenant_id`。唯一需要鉴权的归属维度是 **openid**（usage_daily / usage_month / reason_cache 的 owner），由云函数从微信会话取，**不接受客户端传入**。种子数据（restaurants/evidence）是公共只读数据，无归属过滤。
- **金额表示法**：整数分（本项目因单次成本不足 1 分，细化到**整数微分**：1 元 = 100 分 = 1,000,000 微分）。成本累计字段 `cost_micros` 为整数微分，禁止浮点（`float`/`double`）与字符串金额——浮点会累积误差，是资损类缺陷。示例：单次 ¥0.0033 → `3300` 微分；封顶 ¥300 → `300000000` 微分。金额只由云函数按 token 用量计算，前端不传金额。
- **时区**：所有"每日/每月"边界按 **Asia/Shanghai**（`dateKey = YYYY-MM-DD`，`monthKey = YYYY-MM`），在云函数用 UTC+8 计算，不依赖客户端时间（客户端时间可改）。
- **软删除**：种子是静态只读文件，删除=从 JSON 移除并记录 `data_version+1`；用量/缓存集合为日志型，物理删除超过保留期的行（缓存 7 天、用量 90 天），不做 `deleted_at`。
- **事务边界**：usage-check / recommend 的额度扣减必须原子：同一个云函数内，先对 `usage_daily` 用 `_.inc({count:1})` 条件更新 `where({_id: openid+dateKey, count: _.lt(limit)})` 成功后再发起大模型调用；扣减与写 `usage_month.cost_micros` 在同一云函数事务内完成（`db.startTransaction()`），任一步失败整体回滚、不发模型请求。缓存命中不扣额度、不写累计成本。

### 4.2 种子数据 `data/restaurants.json` 精确 JSON Schema（后端按此清洗 xlsx）

**顶层是一个数组**，每家店一个对象。`restaurants.schema.json` 用 draft-07，字段与下面一一对应。

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `id` | string | 是 | `^r_[0-9]{4,}$`，全局唯一、稳定 | 清洗后按店名归一化排序编号；改名不换 id（用 alias 解决） |
| `name` | string | 是 | 1–20 字，归一化后主店名 | 去空白/全半角/括号序号，保留原名分支到 `alias` |
| `verdict` | enum | 是 | `褒` / `贬` / `有争议` | 有正面+负面即 `有争议`，不得只取一边（brief F1 纸包鸡/稻川岛案例） |
| `evidence` | array[string] | 是 | 1–10 条，每条 8–60 字，已脱敏 | 学生原话数组；`有争议` 时至少各 1 条褒/贬；脱敏见 §7-d |
| `tags` | array[string] | 是 | 0–6 项，每项 ≤10 字 | 从文本抽取的口味/场景词（辣/便宜/堂食/外卖等）；**没有就不填，不编造** |
| `source_sheet` | string | 是 | 非空的原始工作表名 | 如"好吃的""好难吃""外卖省钱"，多表合并取主来源，其余进 `alias_sheets` |
| `mention_count` | integer | 是 | ≥1 | 该店在表格中出现的有效提及次数（剔"点了"刷屏后），用于置信度排序，不用于打分 |

**精确 schema（JSON Schema draft-07，落 `data/restaurants.schema.json`）：**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "RestaurantsSeed",
  "type": "array",
  "minItems": 1,
  "items": {
    "type": "object",
    "required": ["id","name","verdict","evidence","tags","source_sheet","mention_count"],
    "additionalProperties": false,
    "properties": {
      "id":            { "type": "string", "pattern": "^r_[0-9]{4,}$" },
      "name":          { "type": "string", "minLength": 1, "maxLength": 20 },
      "verdict":       { "enum": ["褒", "贬", "有争议"] },
      "evidence":      { "type": "array", "minItems": 1, "maxItems": 10,
                         "items": { "type": "string", "minLength": 8, "maxLength": 60 } },
      "tags":          { "type": "array", "maxItems": 6,
                         "items": { "type": "string", "maxLength": 10 } },
      "source_sheet":  { "type": "string", "minLength": 1, "maxLength": 30 },
      "mention_count": { "type": "integer", "minimum": 1 }
    }
  }
}
```

**样例（结构示意，非真实数据，标注 `[假设]`）：**

```json
{
  "id": "r_0001",
  "name": "稻川岛滑蛋饭",
  "verdict": "有争议",
  "evidence": ["真的很好吃，滑蛋很嫩", "超难吃，吃过一次就不愿再试"],
  "tags": ["滑蛋饭", "有争议"],
  "source_sheet": "好吃的",
  "mention_count": 2
}
```

**清洗规则（F1，`scripts/clean_seed.py`，Python 标准库）：**

1. xlsx 解析：`zipfile.ZipFile` 打开 → 读 `xl/workbook.xml` 取 sheet 名 → `xl/_rels/workbook.xml.rels` 映射 `sheetN.xml` → 读 `xl/sharedStrings.xml` 建共享字符串表 → `ET.fromstring` 遍历 `<row>/<c>`，`t="s"` 取共享串、`t="inlineStr"` 取 `<is><t>`、其余取 `<v>`。**[假设]** 若表格来自微信导出且无 sharedStrings，走 inlineStr 分支；两条分支都要有。
2. 合并近义表："好吃的 / 好吃的(2) / 好吃的 (2)" 归一组，"好难吃*" 归一组，保留 `source_sheet` 为主来源名。
3. 店名归一化：全角转半角、去首尾空白、去 `(2)`/空格括号序号、常见别名映射到主名（别名表人工维护，`[假设]` 由张鑫宇确认）。
4. 噪声过滤：纯"点了/打卡/蹲/求带/+1"等无实质内容行剔除；含交友、情绪倾诉、辱骂、昵称、学号、手机号的整行剔除（不仅是字段）。
5. 褒贬判定：来源表给初判（好吃的→褒，好难吃→贬）；同一 `id` 出现相反来源或文本含明确正反词 → `有争议`，并各保留 1 条证据。
6. 脱敏：正则替换 `@昵称`、手机号 `1\d{10}`→`[手机]`、学号（连续 8–12 位数字）→`[学号]`、精确到分钟的时间 →`[时间]`；证据不足 8 字的短句丢弃。
7. 抽检：`validate_seed.py` 校验 schema + 随机抽 20 条人工看一遍（brief F1 要求"人工抽检一轮"）。**授权未确认（Q4）前不得把产物用于公开小程序**。

### 4.3 云数据库集合（云开发，文档型）

三张表 + 一份静态种子。字段为云开发数据库文档字段（JSON 形态）。

**A. `restaurants`（可选镜像，权威源仍是静态 JSON）**：结构与 §4.2 单条完全一致，另加 `_id = id`、`data_version`（integer）、`updated_at`（string, ISO8601 UTC）。MVP 阶段**可不建此集合**，避免双写；Phase 3 若要做后台导入再启用。

**B. `evidence`（可选镜像）**：`_id`、`restaurant_id`（关联 `restaurants.id`）、`text`（脱敏原话）、`tone`（`褒`/`贬`/`中`）、`source_sheet`。MVP 阶段证据嵌在 `restaurants.evidence` 数组里，不单独建集合；保留此定义供将来拆表。

**C. `reason_cache`（理由缓存表）**：

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `_id` | string | = cacheKey | `sha256(normalize(q)\|命中店ID\|排除店ID\|data_version\|prompt_version)` |
| `question_norm` | string | ≤200 | 归一化后的问题文本，仅排障用，不进模型 |
| `hit_restaurant_ids` | array[string] | 1–8 | 本次召回注入的店 ID 集合（防串味核心） |
| `excluded_ids` | array[string] | 0–20 | "换一批"排除的店 ID 集合 |
| `answer` | object | 见 §5.2 recommend 出参 data.answer | 大模型生成的完整结果（含店名+理由+证据引用） |
| `data_version` | integer | ≥1 | 种子版本，变了 key 自然变，旧缓存不串 |
| `prompt_version` | string | 如 `v1` | 提示词版本，改提示词即失效旧缓存 |
| `created_at` | number | 毫秒时间戳 | 保留 7 天，TTL 清理 |

**D. `usage_daily` / `usage_month`（用量计数表，两张）**：

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `_id` | string | daily: `openid\|YYYY-MM-DD`；month: `YYYY-MM` | month 表为全局单行，不是按人 |
| `openid` | string | 仅 daily | 微信静默标识，服务端取 |
| `count` | integer | daily ≥0 | 当日调用次数，上限 10（`LIMIT_DAILY`） |
| `cost_micros` | integer | month ≥0 | 当月累计成本（微分），上限 `300000000` |
| `calls` | integer | month ≥0 | 当月总调用次数，观测用 |
| `updated_at` | number | 毫秒时间戳 | — |

> month 表为全局单行，是"月度总预算封顶"的单一真源；用 `_.inc` + 条件更新保证并发下不越顶。

### 4.4 索引 / 容量 / 备份（RPO / RTO）

- 索引：`reason_cache` 用 `_id` 主键即够；`usage_daily._id`、`usage_month._id` 主键即够。种子千级数据走内存匹配，**不建索引**（避免过早优化，见 data-modeling.md）。
- 容量：种子 <1MB，随小程序包/云函数包分发（主包 ≤2MB 约束内）；缓存与用量月增千级文档，远低于免费额度。
- **RPO / RTO `[假设]`**：缓存与用量是"可丢但影响成本护栏"的数据。RPO = 24 小时（最坏丢一天计数，用静态种子+本地 storage 兜住体验）；RTO = 4 小时（云开发托管，故障主要是配置/封顶误设，改配置即恢复）。**需用户确认**：若把 ¥300 封顶当硬财务红线，RPO 应降到 0（每笔调用后同步写成功再返回，见 §4.1 事务）；本 Spec 默认按 RPO=0 实现成本写入（同步事务），RTO=4h。`[假设]` 数值来自 brief §5/§6 推导，非用户明示。
- 备份范围：云数据库用量/缓存集合（每日自动快照，云开发自带）；静态种子 JSON（进 git）；配置（提示词版本、限额数值，进 git）；API Key（只存云开发环境变量，不备份进仓库，泄露即轮换）。第三方（大模型账单）由供应商侧保留，我方只存 token 用量。

---

## 5. 云函数接口契约（唯一签发：架构师）

> 统一走 `wx.cloud.callFunction({name, data})`。统一响应包装：`{ code: number, data: object, message: string }`，`code=0` 成功。**前端只用这一个信封**；云函数内部错误归一到 §5.4 错误码，不许把异常直接抛给前端（runtime-defensive.md §三）。`openid` 一律服务端取，入参里出现 `openid` 字段一律忽略并记录告警。

### 5.1 `usage-check`（限次预检）

- 入参 `data`：`{}`（可带 `client_ts` 仅日志用）。
- 出参 `data`：
```json
{ "daily_limit": 10, "daily_used": 3, "daily_remaining": 7,
  "monthly_cap_micros": 300000000, "monthly_used_micros": 9900000,
  "global_stopped": false, "reset_date_key": "2026-11-23" }
```
- 说明：只读，不扣额度。前端进入首页调一次，展示"今日还可问 N 次"；`global_stopped=true` 时首页按钮置灰并显示静态提示（F7-b 到顶态）。

### 5.2 `recommend`（问答/拍板）

- 入参 `data`：
```json
{ "question": "晚上想吃点辣的，别太贵", "exclude": ["r_0007"], "session_id": "s_abc123" }
```
  - `question`：string，1–200 字，必填；`exclude`：array[string]，≤20 个种子 id，可空（"换一批"带已出现的店）；`session_id`：string，可空，用于同一次会话内排除链的日志关联。
- 出参 `data`：
```json
{
  "answer": {
    "restaurant_id": "r_0012",
    "restaurant_name": "某某麻辣烫",
    "reason": "你想吃辣又想省钱，这家在表里有'辣得够味还便宜'的原话。",
    "evidence": ["辣得够味还便宜，学生党常去"],
    "verdict": "褒"
  },
  "cached": true,
  "daily_remaining": 6,
  "degraded": false,
  "degrade_reason": ""
}
```
- `degraded=true` 时 `answer` 为空，前端按 `degrade_reason` 显示静态提示或跳转缓存结果（见 §7-a/b）。**任何情况下不返回本地规则算出的店。**

### 5.3 `avoid-lookup`（避雷查询，读本地数据）

- 入参 `data`：`{ "query": "纸包鸡" }`。`query`：string，1–40 字，店名或商圈关键词。
- 出参 `data`：
```json
{
  "matches": [
    { "id": "r_0002", "name": "纸包鸡", "verdict": "有争议",
      "evidence": ["有人说是yyds", "表里有人说不好吃捏"],
      "tags": ["鸡", "有争议"], "source_sheet": "好吃的", "mention_count": 3 }
  ],
  "found": true
}
```
- 查无此店：`found=false, matches=[]`，前端明确提示"表里没有这家"，**不编造**（AC-01）。最多返回 5 条匹配，按 `mention_count` 降序；商圈匹配走 `tags` 和 `name` 的包含匹配，**不调大模型**（F2）。

### 5.4 统一错误码（code 非 0 时 message 为人类可读中文，前端直接显示）

| code | 含义 | 触发点 | 前端动作 |
|---|---|---|---|
| 0 | 成功 | — | 正常渲染 |
| 40001 | 入参错误 | 九个边界校验（question 空/超长、query 超长） | 提示"换个说法试试" |
| 40301 | 当日限次已满 | usage_daily.count ≥ 10 | 显示静态提示，不发模型请求（AC-06） |
| 40302 | 月度预算封顶 | usage_month.cost_micros ≥ 300000000 | 全局停调用；避雷仍可用（AC-07） |
| 42901 | 频率过高 | 同 openid 10s 内 ≥3 次 | "慢一点再问"，指数退避 |
| 50001 | 大模型超时/异常 | llm.js 超时或 HTTP 非 2xx | 明确提示，不白屏（AC-09） |
| 50002 | 模型返回校验失败 | 返回库外店名/结构非法 | 静态提示 + 告警，不重试扣费 |
| 50003 | 配置错误 | Key 缺失/参数越界（启动即失败） | 运维告警，前端"服务暂不可用" |
| 40401 | 查无此店 | avoid-lookup 无匹配 | "表里没有这家" |

> 机器可读版本见 `openapi.yaml`（Phase 2 前必须存在，前端据此生成 TS 类型和 MSW mock）。

---

## 6. LLM 调用方案

### 6.1 模型锁定与经济参数

- **锁 `[锁定]`**：`deepseek-v4-flash`（非思考模式），OpenAI 兼容端点，云函数内用原生 `https` 调用（不引第三方 SDK，减少依赖面）。选它的理由：mvp-stack.md AI 能力表把 DeepSeek 列为最低单价按量档；官方定价页（api-docs.deepseek.com/pricing，2026-11-22 查）给出 V4-Flash cache miss 输入 $0.14/1M、输出 $0.28/1M，峰谷浮动。
- **`[假设]` 单价换算**：按 1 USD ≈ ¥7.2，取**高位**做保守预算：输入 ¥0.001/千 token（$0.14×7.2/1000≈¥0.001008）、输出 ¥0.002/千 token（$0.28×7.2/1000≈¥0.002016）。峰时按此、谷时约半价，预算按峰时算留安全垫。
- **可换**：模型名、单价、端点全放云函数环境变量 `LLM_MODEL` / `PRICE_IN_MICRO_PER_1K_TOKENS` / `PRICE_OUT_MICRO_PER_1K_TOKENS`；换型号只改配置 + 重跑 §8 成本表，**不改业务代码**。
- **Key**：`LLM_API_KEY` 只在云开发环境变量，云函数启动时校验存在（缺失即 50003 大声失败，见 §9.2）；前端构建产物不得出现（AC-08）。

### 6.2 System 提示词要点（`cloud-functions/recommend/prompt.js`）

1. 身份："你是下沙高校圈吃饭助手，只根据用户提供的餐馆数据替用户选 1 家。"
2. **只能用给定数据回答**：所有事实（店名、评价、标签）必须来自注入片段；禁止调用外部知识、禁止补充没给的信息。
3. **禁止库外店名**：只能从"候选餐馆列表"里挑恰好 1 家；列表里没有用户想要的，就说"这份表里没有合适的店"，不许自己编店名（AC-03）。
4. **恰好 1 家 + 至少 1 句理由**：输出严格 JSON（见 §6.5），理由必须引用至少 1 条注入的脱敏原话，不得编造新评价。
5. **排除项**：`exclude` 里的店不许再出现（F5 换一批）。
6. **不确定就承认**：数据不足或褒贬冲突时，理由里说明"表里有争议"，不强行拍胸脯。
7. 输出格式固定 JSON，不输出 Markdown、不输出多余解释。

### 6.3 注入字段白名单（≤5 个，AC-04）

只把这些字段拼进给模型的 `context.restaurants[]`（白名单之外一律不进 payload）：

| 白名单字段 | 来源 | 脱敏处理 |
|---|---|---|
| `name` | restaurants.name | 无个人信息 |
| `verdict` | restaurants.verdict | 无 |
| `evidence` | restaurants.evidence | 已脱敏原话，最多 2 条/店 |
| `tags` | restaurants.tags | 无 |
| `mention_count` | restaurants.mention_count | 无 |

**明确不注入**：`source_sheet`（非模型判断所需）、`id` 的展示分支、昵称、头像、学号、精确时间戳、用户 openid、`session_id`、客户端 IP。注入上限：每次召回 ≤8 家店、每店 ≤2 条证据、总输入 token ≤4000。白名单投影在 `prompt.js` 用显式字段挑选实现（白名单而非黑名单），防止将来加字段时误带 PII。

### 6.4 召回（不是打分，不违反 D1）

`service.js` 用简单的文本包含匹配，从种子里选 ≤8 家作为候选注入：用户问题分词后与 `name`/`tags` 求交集；命中的按 `mention_count` 降序取前 8。**这一步只是"挑出给模型看的片段"（RAG 召回），不排序出推荐、不产理由、不拍板**；选谁、为什么选，全部由模型决定（D1 边界）。无命中时注入全部种子里 `verdict=褒` 的前 8 家作为兜底上下文，并在提示词里注明"用户对口味无明确偏好"。

### 6.5 返回后校验（AC-03 不编造）

`whitelist.js` 做三件事，任一失败 → 返回 50002 + 静态提示，**不重试、不扣第二次费**：
1. `answer.restaurant_id` 必须属于本次 `hit_restaurant_ids` 集合；
2. `answer.restaurant_name` 必须与种子里该 id 的 `name` 完全一致（归一化后比较）；
3. 理由/证据里出现的任何店名，必须存在于 `hit_restaurant_ids` 对应的名字集合；用种子全量店名做正则扫描，发现库外店名即拦截。
4. 结构校验：必填键齐全、`evidence` 数组非空且每条来自注入片段、`reason` 长度 1–200 字。

### 6.6 流式 / 非流式权衡（结论：MVP 非流式，流式作为 P1 增强）

| 维度 | 非流式（选用） | 流式（暂不做） |
|---|---|---|
| 云函数实现 | 一次 `https` 请求拿完整 JSON 返回 | 云函数要维持长连接逐 chunk 回传，微信云函数对流式支持有限，需自建 SSE 代理 |
| 首字体验 | 无"逐字"效果，但有打字机 UI 模拟 | 真首字 <3s |
| 延迟达标 | 完整 P95 <8s 可达（§9.4 超时预算）；"首字 <3s"用打字机动画近似满足观感 | 真满足 |
| 成本/复杂度 | 低，符合单人维护 | 高，违背约束 |

**锁定 `[锁定]`**：MVP 用非流式 + 前端 `answer-stream` 组件做打字机渲染（拿到完整答案后逐字显示）。`[假设]` AC-02 的"流式首字 <3s"以"打字机首字 <3s"验收——前提是云函数 P50 <3s；若实测 P50 >3s，这是延迟问题不是流式问题，按 §9.4 调超时/缓存解决，不为此上流式架构。是否上真流式列为 Phase 2 待决项，需用户明确要"逐字蹦出"再评估。

### 6.7 缓存 key 设计（防串味，F7-c）

```
cacheKey = SHA256(
  normalize(question) + '|' +
  hit_restaurant_ids.sort().join(',') + '|' +
  (exclude || []).sort().join(',') + '|' +
  data_version + '|' +
  prompt_version
)
```

- `normalize`：去空白、全半角统一、常见同义问法映射表（`[假设]` 人工维护，如"吃啥"="吃什么"）。
- **为什么含命中店与上下文**：同一个"辣一点"在不同召回集（不同 `data_version` 或不同 `exclude`）下答案不同；把命中/排除/版本都算进 key，杜绝把 A 问题的答案串给 B 问题（brief §5 F7-c、DECISIONS §四）。
- 命中缓存：直接返回 `data.answer`，`cached=true`，**不扣额度、不调模型、不写成本**。
- 失效：TTL 7 天；`data_version` 或 `prompt_version` 变更即天然失效旧 key；不手动清缓存。

---

## 7. 护栏六条 F7-a~f 逐条落地（实现位置 + 数据结构 + 数值）

| 护栏 | 实现位置 | 数据结构 / 字段 | 具体数值 `[假设]` |
|---|---|---|---|
| F7-a 每人每日限次 | `recommend/service.js` 入口，调用模型前；`usage-check` 只预检不扣 | `usage_daily._id = openid\|dateKey`，`count`，条件更新 `where(count < limit)` 才放行 | `LIMIT_DAILY = 10` 次/人/日（brief §5 建议）；超限 code 40301，前端静态提示，大模型的 HTTP 请求数归零（AC-06） |
| F7-b 月度封顶 | `recommend/service.js` 事务：扣 daily.count + 累加 `usage_month.cost_micros`，**先判断剩余预算够不够本次预估成本**再调用 | `usage_month._id = monthKey`，`cost_micros`，`global_stopped = cost_micros >= CAP` | `MONTHLY_CAP = 300000000` 微分 = ¥300/月（brief §5 建议）；到顶 code 40302 全局停，`avoid-lookup` 不受影响（AC-07）；数值跑一周按 Q5 调 |
| F7-c 缓存 | `recommend/service.js` 在限次通过后、召回前查；命中直接返回 | `reason_cache._id = cacheKey`，`answer`，`hit_restaurant_ids`，TTL 7 天 | 缓存命中不扣次数、不花 ¥；目标命中率 20%–30%（brief §5 中性/保守）；`[假设]` key 含命中店+排除+版本（§6.7） |
| F7-d 脱敏后再发送 | ① `clean_seed.py` 清洗入库前；② `prompt.js` 白名单投影发送前；③ `whitelist.js` 返回前检查理由里有没有带 PII | 白名单 5 字段（§6.3）；正则：手机号/学号/时间戳/@昵称 | 字段白名单 ≤5（AC-04）；昵称、头像、学号、精确时间戳一律 0 出现 |
| F7-e Key 只在云函数 | 云开发环境变量 `LLM_API_KEY`；`llm.js` 从 `process.env` 读；`config.js` 启动校验存在 | 环境变量，不入 git、不入数据库、不入前端 bundle | 前端产物搜 Key 字符串结果为空（AC-08）；泄露立即轮换 |
| F7-f 并发/频率 | `recommend/service.js` 限次后加频率闸：`usage_daily.last_request_ms` 与 `burst` 计数 | `usage_daily` 增 `last_request_ms`（number）、`burst_window_start_ms`、`burst_count` | `[假设]` 同 openid 10 秒窗口内 ≤3 次（42901）；指数退避；add `_.lt` 条件更新防撞车 |

> **到顶动作的统一语义**：F7-a/b 到顶 → 停调用 + 静态提示或返回已有缓存结果；**绝不切本地规则**（C1 边界）。`avoid-lookup` 是本地数据查询，任何情况下可用。

---

## 8. 成本锁定与月度区间

### 8.1 公式（brief §5，机器人每轮=一次调用）

```
月成本 ≈ 日活 × 人均每日轮数 × (1 − 缓存命中率) × 单次成本 × 30
单次成本 = 输入token × 输入单价 + 输出token × 输出单价
```

### 8.2 锁模型后的单次成本与预留上界（单价来自 §6.1，token 量来自实测）

- 单价：输入 ¥0.001/千、输出 ¥0.002/千（与 `config` 的 `PRICE_IN/OUT_MICRO_PER_1K` = 994 / 1988 微分每千一致）。
- **实测单次**（deep-thinking 全量 600 店 digest）：约 28525 input + 1041 completion（completion 含 reasoning，按 output 计费）≈ **¥0.031**。
- **预留上界（`MAX_CALL_MICROS`，F7-b 月封顶闸的预扣值）**：**45000 input + 8000 output** = ceil(45000×994/1000) + ceil(8000×1988/1000) ≈ 60634 微分 ≈ **¥0.061**。扣费前按此预估 token 预扣，**必须 ≥ 实测**；高估只会让月封顶更早触发（安全侧），低估会让真实花费越过 ¥300 封顶。`PRICE_*` 是环境变量，改数值不改代码。
- 旧口径（召回 ≤8 家、非深度思考）单次 ¥0.0018–0.0048 已随深度思考模式停用，不再作为实现依据。§8.3 的 beta 月成本仍按旧 ¥0.0033 估算；按 deep-thinking 实测 ¥0.031 重算，0% 缓存下约 ¥93/月、有缓存更低，仍远低于 ¥300 封顶，§8.3「不触顶」结论不变。

### 8.3 月度区间（beta 实际规模 + 按 brief §5 三档场景 × 本 Spec 中位 ¥0.0033）

| 场景 | 日活 | 每日调用 | 人均轮数/日 | 缓存命中 | 未命中调用/月 | 月成本（中位） | 相对 ¥300 封顶 |
|---|---|---|---|---|---|---|---|
| **beta（当前，用户已确认）** | **≤10** | **约 100 次** | 10（封顶值） | 0%（保守不打折） | 3,000 | **¥9.9** | **不触顶（余量约 30 倍）** |
| 保守（全校，未来） | 1000 | 2,000 | 2 | 30% | 42,000 | ¥139 | 不触顶 |
| 中性（全校，未来） | 2500 | 7,500 | 3 | 20% | 180,000 | ¥594 | **月中触顶** |
| 激进（全校，未来） | 4500 | 22,500 | 5 | 10% | 567,000 | ¥1,871 | **快速触顶** |

计算示例：
- beta：100 次/日 × ¥0.0033 × 30 = **¥9.9/月**。口径说明：10 人 × 上限 10 次/人/日 = 100 次/日，恰好对上用户给的"每日约 100 次调用"；按 0% 缓存折扣取保守值（真实有缓存只会更低）。若有人把"每日 100 次"读成**每人**每天 100 次（10 人共 1,000 次/日），则 ¥99/月——但这违反 10 次/人/日 的护栏，且不是用户原话口径；两档都远低于 ¥300，结论不受影响。
- 中性：2500×3×0.8×0.0033×30 = ¥594。

**关键结论（beta 阶段已收敛，不是当前风险）**：用户在 Phase 1 决策卡给出 beta 规模前提——日活最多 10 人、每日约 100 次调用。按锁定单价，**beta 月成本约 ¥9.9，¥300 封顶不触顶**，余量约 30 倍；限次与封顶仍按 F7-a/b 正常生效，只是 beta 期间不会被触发。表中保守/中性/激进三档的触顶，是**按全校放大后的未来场景**——属于后续扩容时才做的成本决策（届时 DAU 真实数据出来，再决定维持 ¥300、提高封顶还是收紧限次），**不是当前风险，也不推翻已拍板的 D1**。

> 三条可选路径（提高封顶到 ¥600–1000 / 降到 5 次每人每日 / 维持现状）保留给扩容阶段评估，beta 不执行。参数是环境变量，改数值不改代码；本 Spec 先按现状（¥300/月、10 次/人/日）实现。

### 8.4 待用户确认变量（成本表敏感项）

| 变量 | 当前值 | 来源 | 谁确认 |
|---|---|---|---|
| 模型与单价 | deepseek-v4-flash，¥0.001/¥0.002 每千 token | §6.1 锁定+假设换算 | 用户可换型号 |
| **规模前提（beta，已确认）** | **日活 ≤10 人、每日约 100 次调用 → 约 ¥9.9/月，¥300 不触顶** | **用户 Phase 1 决策卡拍板** | **已确认** |
| 全校人数与日活（未来扩容） | 2 万人，日活 1000–4500 | brief §5 假设 | Q2，扩容阶段再定 |
| 人均轮数/日 | beta：10（受 10 次/人/日 上限约束）；全校：2–5 | 规模前提 + brief §5 | 扩容后实测 |
| 缓存命中率 | beta 预算按 0%（保守）；全校 10%–30% | §8.3 + brief §5 | 实测 |
| 封顶与限次 | ¥300/月、10 次/日（**beta 不变，环境变量**） | brief §5 建议 + 用户决策卡 | Q5，扩容阶段再调 |
| 峰谷电价 | 按峰时保守算，谷时约半价 | `[假设]` | 账单实测 |

> 规模前提已由用户在决策卡确认，不再是待确认变量；上表保留"未来扩容"行仅作容量上下文，不影响 beta 交付。

---

## 9. 质量属性（闭口，不留"开发时注意"）

### 9.1 安全（来自 security-baseline.md）

- 认证：无账号，openid 由微信会话提供，服务端取，不信任客户端 id（对象级越权头号事故已规避）。
- 授权：单租户公共数据，无 RBAC；usage 集合按 openid 隔离 `_id`，跨用户查不到（month 表全局是设计如此，不含个人信息）。
- 敏感数据清单：API Key（环境变量）、学生评价原文（脱敏后）、openid（服务端内部）。前端不存 Key、不存完整评价原表。
- 上传策略：**MVP 无上传入口**（不做 UGC，brief §3），无文件解析面。
- 注入：数据全部走参数化查询/文档查询，无 SQL 拼接；前端用 `text` 渲染，禁 `rich-text` 直出模型返回（XSS）。
- 日志：不记录 `question` 原文与 openid 明文（如需排障记 hash）；不记录任何 token/Key；异常堆栈不含请求体。
- 上线前 15 项检查表按 security-baseline.md §八逐项过（含"前端 bundle 搜不到 Key"）。

### 9.2 配置错误大声失败（runtime-defensive.md）

- 云函数启动即校验：`LLM_API_KEY` 存在、`LLM_MODEL` 非空、`LIMIT_DAILY ∈ [1,100]`、`MONTHLY_CAP ∈ [1e6, 1e9]` 微分、`PRICE_* > 0`；缺失或越界 → 抛错并告警（code 50003），**不许兜底默认值、不许静默跳过**。
- 大模型返回 JSON 是外部不可信输入：必在 `whitelist.js` 做结构/必填/类型校验（§6.5），不信任其"成功"字段。
- 错误归一化：云函数对外只有 §5.4 一种信封，一个失败调用方只需判断一个 `code`（runtime-defensive.md "调用方判断几种情况？>1 即缺陷"）。

### 9.3 可靠性 / 幂等 / 降级

- 幂等：`recommend` 的扣次数 + 写成本在同一事务（§4.1），失败整体回滚；**大模型调用不可重试**（付费操作零自动重试，runtime-defensive.md §三），超时就返回明确错误，交给用户重问。缓存查询只读，可安全重试。
- 重试边界：只读（avoid-lookup、usage-check、缓存命中）可指数退避重试 ≤3 次；付费调用零重试。
- 超时预算表（外层 > 内层，毫秒）：

| 层 | 超时 | 说明 |
|---|---|---|
| 小程序等待云函数 | 12000 | `wx.cloud.callFunction` 客户端超时 |
| 云函数处理总预算 | 10000 | 含召回+缓存+校验 |
| 大模型 HTTP 调用 | 8000 | 连接 2000 + 读取 6000，外层 > 内层 |
| 云数据库单操作 | 2000 | — |

- 降级清单：模型超时/空返回 → "服务有点忙，稍后再试"（50001）；库外店名 → "这次没挑出来，换个说法"（50002）；限次/封顶 → 静态提示或缓存结果（40301/40302）；无网 → 前端离线提示。全部不白屏不崩溃（AC-09）。
- 日均数据量小，无 7×24 承诺；RPO/RTO 见 §4.4。

### 9.4 性能预算

- 避雷查询：本地 JSON 内存匹配，目标 <200ms（AC-01 要求 1.5s，留 7 倍余量）。
- 问答：完整 P95 <8s（AC-02）；云函数冷启动用预置/常驻缓解 `[假设]` 云开发默认冷启动 <1s；首字 <3s 用打字机近似（§6.6）。
- 分页：无列表分页需求（种子千级、问答单条返回）；如将来加"所有店"列表，默认 20 条/页、上限 50。
- 包体：主包 ≤2MB，SVG 图标随包，不放大图（wechat-miniprogram.md）。

### 9.5 P0 界面与图标约束（团队级规则）

- **禁止 emoji 作为功能图标**：全项目锁定一套 **SVG 图标库** —— `[锁定]` 采用**内联 SVG symbol**（自绘 6–8 个线性图标：碗、放大镜、书签、时钟、信息、警告、刷新、返回），放 `miniprogram/assets/icons/`，统一 24×24、`currentColor` 描边。**不使用任何第三方 emoji 图标库，不混用**（由架构师按原生小程序栈选定）。
- 禁止紫→粉渐变方案：配色以暖橙/米白为主（食物主题），不出现该类渐变。
- 文案：不写"欢迎使用""Lorem ipsum"这类空话；直接说店能不能吃、为什么（brief §4 P0）。

### 9.6 数据演进 / 商业化 / 合规 / SEO

- 数据演进：静态种子加字段=向后兼容（前端忽略未知字段）；删字段/改类型=升 `data_version` 并同步缓存 key，单独发布。云数据库集合结构变化用 expand→migrate→contract 三阶段（data-modeling.md），不在饭点改结构。
- 商业化：**MVP 不收款、不做支付/下单**（brief §3）；只有成本侧预算封顶，金额用整数微分（§4.1）。
- 合规：采集字段只有 openid（限次必需）；不采手机号/位置/通讯录。存储区域=微信云开发（国内）。留存：用量 90 天、缓存 7 天。删除链路：暂无用户入口，Q4 授权未确认前不公开发布。是否涉未成年人=高校学生按成年人默认，`[假设]`。
- SEO/渲染：小程序无 SEO 需求，不设 canonical/hreflang；分享卡用 `onShareAppMessage` 返回标题+路径（wechat-miniprogram.md）。
- 对外复用：**不提供 SDK/组件库**，无版本策略需求。

---

## 10. 能力缝三角闭合 + 默认值 resolve

### 10.1 能力缝表（定义 / 实现 / 消费者 / 默认值 / 失败语义）

| 能力 | 定义（契约） | 实现（Provider） | 消费者 | 默认值 | 失败语义 |
|---|---|---|---|---|---|
| 大模型拍板 | §5.2 recommend 出参 | `llm.js` 调 deepseek-v4-flash | 首页问答、换一批 | model=deepseek-v4-flash | 超时/非法→50001/50002 静态提示，不重试 |
| 避雷查询 | §5.3 avoid-lookup 出参 | `repo.js` 读静态 JSON | 避雷页 | 最多 5 条、按 mention_count | 无匹配→found=false，"表里没有这家" |
| 用量限次 | §5.1 usage-check | `usage_daily`/`usage_month` 条件更新 | recommend 入口、首页提示 | 10 次/日、¥300/月 | 超限→40301/40302，停调用 |
| 理由缓存 | §4.3 reason_cache | `repo.js` 读写缓存 | recommend 入口 | TTL 7 天 | 缓存读失败当未命中，继续调用模型 |
| 种子数据 | §4.2 JSON Schema | `clean_seed.py` 产出 | avoid-lookup、recommend 召回 | `data_version=1` | schema 校验失败→构建期失败，不发版 |

> 无孤儿能力：每个"定义"都有消费者；没有"预留接口/未来扩展"的无主能力。

### 10.2 默认值显式 resolve（不在业务逻辑里散落 `??`）

`cloud-functions/shared/lib/config.js` 提供 `resolveConfig(env)`，启动时调用一次，返回冻结的配置对象；业务只接受已解析的 config：

| 配置项 | 默认值 | 取值范围 | 何时该改 |
|---|---|---|---|
| `LIMIT_DAILY` | 10 | 1–100 | Q5 决策后 |
| `MONTHLY_CAP_MICROS` | 300000000 | 1e6–1e9 | Q5 决策后 |
| `LLM_MODEL` | deepseek-v4-flash | 非空字符串 | 换模型 |
| `PRICE_IN_MICRO_PER_1K` | 1000（=¥0.001/千） | >0 | 账单实测校准 |
| `PRICE_OUT_MICRO_PER_1K` | 2000（=¥0.002/千） | >0 | 同上 |
| `RECALL_LIMIT` | 8 | 1–20 | 成本/质量权衡 |
| `CACHE_TTL_DAYS` | 7 | 1–30 | 缓存命中率实测 |
| `BUST_WINDOW_SEC` / `BUST_MAX` | 10 / 3 | — | 被刷时调紧 |

---

## 11. 页面清单与跳转（Phase 3 前端交付范围）

### 11.1 页面与组件

| 路径 | 作用 | Phase 3 要做 | 关键字段/交互 |
|---|---|---|---|
| `pages/index/index` | 今日推荐/问答首页（tabBar 1） | 是 | 输入框、发送按钮、`usage-tip` 显示剩余次数；流式打字机渲染答案；「为什么」入口 |
| `pages/avoid/avoid` | 避雷查询（tabBar 2） | 是 | 店名/商圈输入 → `avoid-lookup` → `verdict-badge` + `evidence-card` 列表；查无提示 |
| `pages/mine/mine` | 我的清单（tabBar 3） | 是 | 本地 storage 增删店名，不联网；标注"仅存本机" |
| `pages/why/why` | 「为什么推荐」展开 | 是 | 展示 `answer.reason` + `evidence` + verdict；从首页答案点开 |
| `components/verdict-badge` | 褒/贬/有争议标签 | 是 | 三态配色，文字直出 |
| `components/evidence-card` | 脱敏原话卡 | 是 | 文本渲染，不富文本 |
| `components/usage-tip` | 用量/降级提示 | 是 | 剩余次数、到顶静态提示、429 退避提示 |
| `components/answer-stream` | 打字机渲染 | 是 | 拿到完整答案后逐字显示（§6.6） |

### 11.2 跳转与主流程

```
启动 → app.js 初始化 → index（首页）
  index 输入问题 → recommend 云函数 → 答案卡 → 「为什么」→ why 页
  index「换一批」→ 带 exclude 再调 recommend
  avoid 页 → 输入店名 → avoid-lookup → 结果卡 → 「为什么」→ why（复用）
  mine 页 → 本地 storage 增删
  tabBar 切换：index / avoid / mine（wx.switchTab）
  到顶态：usage-tip 静态提示，recommend 按钮置灰，avoid 仍可用
```

### 11.3 Phase 3 明确不做（前端侧）

- 不做投稿/点评/评论区入口（brief §3-1）。
- 不做登录页/手机号授权（无账号）。
- 不做支付、下单、地图、定位（brief 数据缺口 + §3-2）。
- 不做真流式 SSE 组件（§6.6 锁定非流式）。

---

## 12. 工期拆解（校对 PM 的 1.5–2 人月）

按页面和云函数粒度拆，单位=人日（1 人月按 20 人日）：

| 模块 | 粒度 | 人日 | 备注 |
|---|---|---|---|
| F1 数据清洗 | `clean_seed.py` + 别名表 + `validate_seed.py` + 抽检 20 条 | 3.0 | 最脏、最容易反复，前置 |
| 种子入库 | JSON 打包、data_version、schema 校验 | 0.5 | — |
| 云函数 usage-check | index/service/repo | 1.0 | 最简，先做 |
| 云函数 avoid-lookup | index/service/repo + 匹配规则 | 1.5 | 读本地数据 |
| 云函数 recommend | index/service/llm/prompt/whitelist/repo | 4.0 | 最重：限次+缓存+召回+模型+校验+事务 |
| openapi.yaml + TS 类型 | 生成前端类型与 mock | 0.5 | — |
| 页面 index | 输入、答案卡、打字机、换一批 | 2.5 | 核心体验 |
| 页面 avoid | 查询、结果卡、查无提示 | 1.0 | — |
| 页面 mine | storage 增删 | 0.5 | — |
| 页面 why + 3 个组件 | 展开层、徽章、证据卡、用量提示 | 1.5 | — |
| 联调 + AC-01~09 自测 | 含 50 条不编造抽检（AC-03） | 3.0 | QA 协同 |
| 部署/配置/异常态回归 | 云开发环境、Key、限次数值 | 1.5 | 换机装开发者工具 |
| **合计** | | **20.0 人日 ≈ 1.0 人月** | 净开发+自测 |

**校对结论**：PM 的 1.5–2 人月 **偏保守但合理**。净拆 1.0 人月，加上隐性成本（需求 10–15%、设计 10–15%、测试已计、部署已计、**风险预留 20–30%**，来自 development-costs.md §八）→ 约 **1.3–1.6 人月**，落在 PM 区间内。风险预留主要吃在：① 表格清洗反复（F1 最容易超）；② 微信类目资质（Q3，非开发量但卡上线）；③ 换成真流式（若用户要，另加 1–2 人日）。**建议按 1.5 人月排期，Q3/Q4 决议不计入开发工期。**

---

## 13. ADR（每条选型一条，五段式，存 `docs/decisions/`）

| 编号 | 决策 | 状态 |
|---|---|---|
| ADR-0001 | 原生小程序 + 微信云开发，不用跨端框架 | 已接受（本 Spec §2） |
| ADR-0002 | 问答全接大模型，不设本地规则兜底 | 已接受（D1，不可变） |
| ADR-0003 | 模型锁 deepseek-v4-flash，Key 只在云函数 | 已接受（本 Spec §6.1，可换型号） |
| ADR-0004 | 种子落静态 JSON，避雷查询读本地 | 已接受（技术代劳 + F2） |
| ADR-0005 | openid 限次、不建账号 | 已接受（DECISIONS §四） |
| ADR-0006 | MVP 非流式 + 打字机，真流式列 Phase 2 | 已接受（本 Spec §6.6） |

> ADR 模板五段：状态 / 背景 / 决定 / 后果 / 关联决策（另含备选方案表）。已接受后不可改，改主意新建 ADR 标注"取代"。

---

## 14. 知识库引用与端到端验证

### 14.1 引用出处（读完落地一条，标清出处）

| 知识库文件 | 本 Spec 落地条款 |
|---|---|
| `10-standards/spec-as-contract.md` | 点名文件/接口、明确不做（§3/§11.3）、版本锚定（§2.3/§6.1）、内嵌坑（§12、§4.2 清洗规则）、端到端验证（§14.2） |
| `40-architecture/mvp-stack.md` | 三方案评分与选型（§2.1）、DeepSeek 低价档（§6.1） |
| `40-architecture/ai-agent-patterns.md` | 召回→注入→校验的 RAG 管道与边界防御（§6.4/§6.5）、权限感知：模型只见白名单字段（§6.3） |
| `30-platforms/wechat-miniprogram.md` | 原生 WXML 选型、包体 ≤2MB、tabBar、分享、审核要点（§2/§9.4/§9.5/§9.6） |
| `20-quality/security-baseline.md` | openid 服务端取、Key 环境变量、日志脱敏、上线 15 项（§9.1） |
| `80-cost-models/development-costs.md` | 人月换算、隐性成本、风险预留 20–30%、报价"不包含"（§12） |
| `40-architecture/data-modeling.md` | 类型/约束/索引克制、三阶段迁移（§4.1/§4.3/§9.6） |
| `10-standards/runtime-defensive.md` | 九个校验边界、配置大声失败、错误归一化、付费零重试（§9.2/§9.3） |
| `10-standards/code-organization.md` | 目录树、单文件 ≤300 行、入口只装配（§2.3） |

> 用户 IMA 知识库：未提供 knowledge_base_id，且本次未使用（连接器未接入），全部依据本地 `references/`。

### 14.2 端到端验证步骤（规格收尾即验收，Phase 3 换机执行）

1. **构建期**：`python3 scripts/clean_seed.py` 产出 `data/restaurants.json` → `python3 scripts/validate_seed.py` 按 schema 校验通过；抽检 20 条无 PII、无"点了"噪声。
2. **Key 安全**：`grep -r "sk-" miniprogram/` 与前端 bundle 全部产物，结果为空（AC-08）。
3. **避雷查询（AC-01）**：开发者工具输入库内完整店名 → 1.5s 内返回判定+≥1 条脱敏原话；输入"不存在的店XYZ" → 提示"表里没有这家"。
4. **问答（AC-02/03）**：自然语言提问 → 打字机首字 <3s、完整 <8s、恰好 1 家 + ≥1 句理由；抓 50 条返回，店名 100% 在种子库（脚本比对 `hit_restaurant_ids`）。
5. **换一批（AC-05）**：连点 3 次，排除链生效，种子容量内不重复。
6. **限次（AC-06）**：把 `LIMIT_DAILY` 临时设 2，第 3 次抓包确认大模型 HTTP 请求数=0，前端静态提示。
7. **封顶（AC-07）**：把 `MONTHLY_CAP_MICROS` 临时设很小，触发后 recommend 停、avoid-lookup 仍返回。
8. **异常态（AC-09）**：断网、模型超时（临时把超时设 100ms）、返回空 JSON，三种情况均有提示不白屏。
9. **脱敏（AC-04）**：抓 recommend 发模型的 payload，字段⊆5 白名单，无昵称/头像/学号/精确时间戳。
10. **门禁基线**：`python3 scripts/gates/verify.py --phase 3` 与 `python3 scripts/gates/spec_check.py` 全绿；端到端暴露的问题沉淀为回归用例并回写本 Spec（活规格）。

## 14.3 必做项对账（spec_check 用，每条带可搜证据）

- [ ] 问答全接大模型、到顶停调用不切规则（证据：`cloud-functions/recommend/service.js`）
- [ ] 避雷查询读本地种子不调模型（证据：`cloud-functions/avoid-lookup/repo.js`）
- [ ] 每人每日 10 次限次（证据：`usage_daily.count`）
- [ ] 月度 ¥300 封顶全局停（证据：`usage_month.cost_micros`）
- [ ] 缓存含命中店与上下文防串味（证据：`reason_cache.hit_restaurant_ids`）
- [ ] 注入字段白名单 ≤5（证据：`prompt.js` 的 `WHITELIST_FIELDS`）
- [ ] 返回店名白名单校验（证据：`whitelist.js`）
- [ ] API Key 只在云函数环境变量（证据：`process.env.LLM_API_KEY`）
- [ ] 种子按精确 schema 清洗（证据：`data/restaurants.json` + `restaurants.schema.json`）
- [ ] 静态提示与异常态不白屏（证据：`components/usage-tip`）

## 14.4 明确不做（out-of-scope，禁止镀金）

- 不做本地规则排序 / 规则+模型混合兜底（D1）
- 不做用户发帖/点评/评论区（brief §3）
- 不做支付、下单、外卖履约（brief §3）
- 不做白名单体验版小范围内测发布（D2）
- 不做向量库 / Redis / 自建服务器（§1 约束）
- 不做真流式 SSE（§6.6，Phase 2 待决）
- 不做跨端（支付宝/抖音/H5）源码（§2.1）

## 14.5 验收方式（用户可自查）

- [ ] AC-01：输入库内店名，1.5s 内出判定+原话；查无明确提示
- [ ] AC-02：提问后恰好 1 家 + ≥1 句理由，完整回答 P95 <8s
- [ ] AC-03：50 条问答抽测，库外店名 0 次
- [ ] AC-04：payload 字段 ⊆5 白名单，无 PII
- [ ] AC-05：连点 3 次换一批不重复
- [ ] AC-06：达日限后大模型请求数归零
- [ ] AC-07：月度到顶后机器人停、避雷仍可用
- [ ] AC-08：前端产物搜不到 Key
- [ ] AC-09：无网/超时/空返回均有提示不白屏
