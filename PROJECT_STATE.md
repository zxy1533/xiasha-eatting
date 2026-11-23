# 项目状态（PROJECT_STATE）

> 每次 Phase 切换、成员回传、需求变更后**增量更新**。新会话先读这一页。

## 1. 目标与阶段
- 一句话目标：做一个下沙高校圈的「今天吃什么」微信小程序，核心是避雷难吃饭店 + 内置问答机器人帮做选择
- 当前阶段：问答完成「AI 深度思考 + 从评价自提炼口味 + 多店返回」全链路，前后端已通、真调验证、全测试绿
- 档位：全团
- 形态：系统模式（真实可跑工程，不是原型）
- 关键变更：①多店返回 {summary, restaurants[]} ②摘要每家放全量原话(最多4条)让 AI 从评价自己提炼口味(辣/甜/清淡/油) ③去掉预写规则映射，把"加工"交给 AI ④前端首页列表渲染 + 换一家排除整批 ⑤whitelist 逐店校验(evidence 4条) 

## 2. 已完成
> 只写产物路径，不写「做完了」。

- [x] 用户决策弹卡 → 三项已拍板（问答全接大模型 / 开放全校 / 用真表格数据）
- [x] 输入材料通读 → `Desktop/吃什么小程序_专家协作与提示词包.md` + `微信xlsx（12表，好吃的520行/好难吃167行）`
- [x] Phase 0 需求与约束 → `research/brief.md`、`DECISIONS.md`
- [x] Phase 1 技术契约 → `SPEC.md`、`openapi.yaml`、`data/restaurants.schema.json`、`docs/decisions/ADR-0001~0006.md`
  - 选型：原生 WXML/WXSS/JS + 微信云开发（云函数 Node.js）。三云函数 recommend / avoid-lookup / usage-check。
  - 成本：锁低单价模型，单次 ¥0.0033（¥0.0018–0.0048）；beta 阶段 ¥9.9/月不触顶。
- [x] Phase 2 视觉契约 → `DESIGN.md`、`design-tokens.json`
  - 主张：学生自己攒的避雷小抄，朱红红笔 + 同学原话，不用星级；12 组对比度实测全达标。
- [x] 脚手架 + 工程装配 → `miniprogram/`（WorkBuddy 预览根）、项目根 `project.config.json`（云开发配置，cloudfunctionRoot 指向 cloud-functions/）
  - 修复 WorkBuddy 模板 CRLF/LF 哈希 bug（安装包层，非本项目）。

## 3. 进行中
| 谁 | 在做什么 | 做到哪 | 卡在哪 |
|---|---|---|---|
| 贝洛奇(后端) | xlsx 清洗 + 三云函数 + 护栏 + 自测 | 已交付（pass），lead 抽验 600 店/褒378贬97争议125 通过 | E29/E06 门禁已私信前端处理 |
| 贾思敏(前端) | 4 页面 + 5 组件 + services 双模式 + 打字机/红笔删除线 | 已交付（pass），lead 验 57 文件/JS 语法 0 失败/mock 源自真种子 | E29/E06 门禁已修，前后端接口对账通过 |

## 2.6 前端产物（Phase 3 另一半）
- `miniprogram/pages/{index,avoid,mine,why}/` 四页面；`components/{verdict-badge,evidence-card,usage-tip,answer-stream,toast-host}/`
- `services/{config,recommend,avoid,usage,storage,cloud-call,errors}.js`：`USE_MOCK` 单布尔切生产，云函数字段与后端对账一致
- `mock/restaurants.js`（12 家真店）、`assets/icons/*.svg`（内联 SVG，零 emoji）
- 自检：node 22/22、JSON 11/11、wx shim mock 14/14 + 生产 7/7；工程门禁 E01–E32 全 PASS（P0/P1 命中 0）；真机/真 LLM 未跑，不声称视觉已验收
- 门禁修复：后端转来的 4×E29 + 2×E06 已修（仅注释+日志，无行为变更）

## 2.5 后端产物（Phase 3 一半）
- `data/restaurants.json`（600 家种子，褒378/贬97/争议125，PII 0 命中，schema 0 违规；争议店褒贬均留原话）
- `cloud-functions/{recommend,avoid-lookup,usage-check}/` + `shared/lib/`；护栏 F7-a~f 落 repo.js/prompt.js/whitelist.js/config.js
- 测试：Python 16/16 + Node mock 13/13 + validate_seed + G03/G04 全过；真机/真 LLM 未跑（无 Key 无开发者工具，待换机补）

## 4. 待决策
> 每条必须带推荐项，否则用户无法决策。

| 问题 | 选项 | 代价 | 推荐 |
|---|---|---|---|
| 全接大模型+开放全校 vs 提示词包里的成本护栏 | A 照用户选择做，但强制焊上限次/封顶/缓存/降级 | A 需接云函数+额度管控 | A：不推翻用户选择，把护栏做进 Spec |
| 微信正式发布的类目与资质 | A 先 beta 跑通，发布前再补类目 | A 上线延后 | A：前端确认后再定 |
| 成本封顶与回复方式（2026-11-22 已拍板） | **用户定：beta 阶段日活≤10 人、每日约 100 次调用；回复用打字机效果（非流式）** | beta 月成本约 ¥99，¥300 封顶不触顶；最大风险解除 | 已锁定，参数写环境变量 |

## 5. 下一步
1. 架构师把 beta 参数回写 SPEC 成本段 → 设计师定视觉方向
2. 前端出第一版（**此处停下等用户确认**）
3. 后端做数据清洗 + 云函数 → QA 验收 → 运维交付
