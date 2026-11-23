# 交付报告（G5）

- 项目：`dsh-mock-interview`（DeepSeek Harness 插件，纯 ES 模块，零运行时依赖）
- 仓库：<https://github.com/liuhaolh6/dsh-Mock-Interview>
- 章程：`D:\project\04-docs\mock-interview-charter.md`
- 交付日期：2026-11-23
- 承诺范围：章程 §2 的 6 项 In scope；7 项 Out of scope 明确未做（见 §4）

## 0. v0.3.0（2026-11-23，体验打磨）

| 批次 | 内容 | 提交 | 守护用例 |
| --- | --- | --- | --- |
| C1 | 14 个错误码 → 标题 / 细节 / 下一步 / 可否重试；失败信封带 `hint`，500 兜底也有 | `5139abd` | TC-MSG-001..005、TC-MSG-010..013 |
| C2 | 进度感：`session/get` 带 `progress`；面板显示第 n/total 题、用时、平均分、已答数 | `5536c90` | TC-INS-001..004、TC-INS-010 |
| C3 | 空态与单主动作：`emptyReason`(`none`/`filtered`)、`readiness`(ready+blockers)；记录页与确认页各一个主按钮 | `c15510e` | TC-ONB-001..006、TC-ONB-010..011 |
| C4 | 键盘可达性：Ctrl/⌘+Enter 提交、输入法组合期不误发、焦点环、所有按钮 `type="button"` | `0e87c40` | TC-UX-001..005 |
| C5 | 记录统计与趋势：`stats` `trend` 由宿主聚合，记录页统计条 + 最近 10 场分数条 | `5536c90` | TC-INS-005..007、TC-INS-011 |
| C6 | 深浅色跟随：配色由 `ping` 下发，面板只读 `--mi-*`；两套配色逐对断言 ≥4.5:1 | `97d689e` | TC-THM-001..005、TC-THM-010..011 |
| C7 | 报告折叠与复制：逐题 `<details>`、`report/preview` 与导出同源 Markdown、剪贴板成败两态 | `f0c899d` | TC-REP-012..013、TC-UX-006..008 |
| — | 缺陷返修：报告页导出格式胶囊为空按钮（`Choice` 收到裸字符串）+ 英文字典 22 个空键 | `55541e0` | lint 新增「裸字符串」「i18n 双语齐全」「旧低对比色值」三条守卫 |

收口度量（v0.3.0）：`npm run build` 通过 · lint `0 error(s), 0 warning(s)`（59 个文件）· `npm test` **190/190** · `e2e` **14/14** · coverage 行 **98.33%** / 分支 **86.40%** / 函数 **96.95%**。

v0.3 明确没做（诚实记录）：

1. 语音作答仍不可用（无内置 ASR；TTS 可用，见 ADR-0005）——属于 v0.4 候选。
2. 面板 UI 没有由人逐屏连续点击验证；键盘与配色是**源码级 + 算术级**断言，不是人工走查。
3. 只有中文界面文案经人看过；英文词典由 lint 保证非空，未做语言质量审校。

## 0. v0.2.0（2026-11-23，功能补齐）

v0.1.0 交付后负责人过了一遍流程，结论是「功能完成度还行，但很粗糙」，于是 v0.2 先补功能、v0.3 再做体验打磨。四批按依赖顺序全部完成：

| 批次 | 内容 | 提交 | 用例 |
| --- | --- | --- | --- |
| B1 | 面试记录增删改查：改名/标签/备注、搜索、状态与模式筛选、排序分页、批量删除、从历史续考 | `5a90be7`、`1fa0e88` | TC-HIS-001..007、TC-HIS-100..105 |
| B2 | `schemaVersion` 1→2 视图迁移、写前一次性 `.v1.bak`、列表索引缓存（mtime 命中） | `7bc91da` | TC-MIG-001..005、TC-IDX-001..005 |
| B3 | 题库外置到 `data/bank.json`、按岗位关键词排序、连续两次空答跳题 | `2a2067b` | TC-BNK-001..006、TC-DIR-006、TC-BNK-101..102 |
| B4 | `report/export` 支持 `format: md|json`、报告含逐题原文与参考解、列表直接导出 | `95b24a2` | TC-REP-007、TC-REP-009..011 |

收口证据：`npm test` **155/155**、`npm run e2e` 6/6、`npm run lint` 0 error / 0 warning（44 文件）、coverage 行 **98.09%** / 分支 **86.71%** / 函数 96.45%。

v0.2 明确没做（留给 v0.3 或更远）：

- 体验打磨：空态引导、进度感、错误人话化、键盘操作、统计趋势、主题跟随、报告折叠；
- 语音作答仍依赖自备 ASR 端点；手撕代码仍是静态评审（不执行、不跑测试）；
- 题库目前只有 20 道内置题，没有按公司/岗位定制题库的管理界面。

## 1. 交付物

| 类别 | 文件 | 说明 |
|---|---|---|
| 宿主半边 | `index.js` | 十项 RPC 动作、`llmBridge`、`dshHome` 五级回退、`webServer.register` 接线 |
| 页面半边 | `client.js` | 三步向导（录入 → 确认画像 → 逐题作答 → 报告）、胶囊选项、TTS 朗读、语音降级说明 |
| 领域逻辑 | `lib/profile.mjs` | 简历/JD → 画像（一次纠正性重试） |
| | `lib/session.mjs` | 时长 → 题量预算、`target` 去重、题目顺序 |
| | `lib/director.mjs` | 按题型与难度组题面、判断是否需要追问 |
| | `lib/scorer.mjs` | 六维评分卡、适用维度平均、越界钳制、缺维 null |
| | `lib/code-review.mjs` | 手撕静态评审、5 条边界用例推演、verdict 与用例矛盾告警 |
| | `lib/report.mjs` | 报告构建、Markdown 渲染、导出落点与撞名规避 |
| | `lib/store.mjs` | 会话 JSON 持久化（原子写、2 MB 写前拦截、schema 迁移） |
| | `lib/json.mjs` / `lib/errors.mjs` / `lib/contracts.js` | 围栏解析、错误类型、契约常量 |
| 契约 | `docs/contracts.md` | 6 个数据结构 + 10 个动作 + 13 个错误码 + 8 问核对 + 2 MB 依据 |
| 测试 | `tests/unit`（13 文件）/ `tests/integration`（10 文件）/ `tests/e2e`（1 文件） | 155 + 6 条用例 |
| 文档 | `docs/requirements/RC-001-mock-interview.md`、`docs/adr/0001..0005`、`docs/test-plan.md`、`docs/acceptance.md` | 需求卡、5 份 ADR、用例表、人工验收清单 |
| 工程 | `package.json`、`cordis.patch.yml`、`icon.svg`、`scripts/contract-lint.mjs`、`AGENTS.md`、`README.md` | 装配与自带 lint |

## 2. 验证证据（2026-11-23，Node v24.20.0 / npm 11.19.0，Windows）

```
npm run build  →  node --check index.js client.js lib/contracts.js（退出码 0）
npm run lint   →  0 error(s), 0 warning(s), 33 file(s) scanned
npm test       →  ℹ tests 119   ℹ pass 119   ℹ fail 0
npm run e2e    →  ℹ tests 6     ℹ pass 6     ℹ fail 0
npm run coverage → all files | 98.80 % 行 | 86.25 % 分支 | 95.33 % 函数
```

活体验证（宿主 Web 进程，端口 64391/52431 等，`POST /api/dsh-mock-interview/rpc`）：

| 动作 | 实测 | 结论 |
|---|---|---|
| `ping` | 47–53 ms | ok |
| `profile/extract` | 1 848 ms，4 技能 / 3 年 / 2 项目 | ok |
| `session/create` | 43 ms，5 题（15 分钟档） | ok |
| `turn/answer` | 5 173–7 713 ms，`overall 2.5–2.8`，六维齐全 | ok（真模型） |
| `code/review` | 6 324 ms，`executed:false`、`cases:5`、错误代码被判 weak | ok |
| `session/finish` | 报告 + 雷达（未考察维度为 `null`） | ok |
| `report/export` | 1 753 B Markdown，落指定目录 | ok |
| `session/list` / `get` / `delete` | 正常；重复删除恒 `{deleted:true}` | ok |

页面：图标在侧栏出现、面板可打开、选项可读（曾被报「白底白字」，已修并复核）。

## 3. 质量门槛对照（章程 §8）

| 门槛 | 要求 | 实测 | 结论 |
|---|---|---|---|
| 核心 `lib/**` 行覆盖率 | ≥ 85 % | 98.80 % | ✅ |
| 分支覆盖率 | ≥ 80 % | 86.25 % | ✅ |
| lint | 0 error | 0 error / 0 warning | ✅ |
| 测试 | 0 failed / 0 skipped | 119 pass / 0 fail / 0 skip | ✅ |
| 人工验收 | 10 步 | 10/10 通过，连续 UI 全流程待人点验 | ⚠️ 见 `docs/acceptance.md` |

## 4. 明确没做（章程 §2 Out of scope）

1. 不真实执行考生代码（只做静态评审 + 5 条边界用例推演，报告恒标 `codeVerified:false`）。
2. 不做视频面试。
3. 不做流式出字（每题整段返回）。
4. 不支持多用户并发隔离。
5. 不提供英文界面以外的多语言（字典有 zh/en，但话术以中文为主）。
6. 不劫持主 agent 会话（独立面板，`ADR-0001`）。
7. 不代写简历、不做简历美化。

## 5. 已知限制

- **语音**：TTS 用浏览器 `speechSynthesis`；ASR 未内置，未配置时按契约返回 `E_ASR_NOT_CONFIGURED` 并降级文字（`ADR-0005`）。
- **评分口径**：`overall` 只对适用维度取平均（`skill` 四维、`project` 五维、`behavior` 四维、`code` 四维），因此不同题型总分不可横向比较。
- **模型依赖**：走宿主 `llm` 服务与默认模型（`agentDefaultModel`），宿主没有可用模型时返回 `E_LLM_UNAVAILABLE`。
- **导出目录**：不传 `dir` 时落在宿主默认工作目录；传相对路径必须在该目录内，绝对路径按用户指定处理。
- **数据**：会话存 `$DSH_HOME/storages/dsh-mock-interview/sessions/`，单会话上限 2 MB（45 分钟 13 题最坏约 0.53 MB，3.8 倍余量）；卸载插件不会自动清理。

## 6. 后续建议（未排期）

1. ASR 接入（自备 OpenAI 兼容端点，密钥走 DSH credentials）。
2. 手撕题语言化提示词模板（现在语言只作为标签传给评审）。
3. 报告导出 PDF。
4. 题库外置为可编辑 JSON，让用户按岗位补充。
5. 真机跑一轮完整 UI 流程并录屏存档。

## 7. 变更记录

| 版本 | 日期 | 内容 |
|---|---|---|
| v0.1.0 | 2026-11-23 | 首个交付：G0 章程 → G1 骨架 → G2 契约 → G3 红基线 → G4 切片 S1–S7 → G5 交付 |