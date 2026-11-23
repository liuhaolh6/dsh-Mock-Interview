| TC-SES-007 | I | AC-7 |  →  回来的 plan 完全一致 | ✅ |# 测试计划（G3）

> 依据 `docs/requirements/RC-001-mock-interview.md` 的 AC-1..AC-8 与 `docs/contracts.md` v1。
> 命名：`TC-<域>-<三位号>`；层级：U=unit（纯逻辑）、I=integration（打真实 handler / 真实临时目录）、E=e2e（打包契约）。
> 状态：🔴=已写用例、当前红；🟢=已实现并通过；⬜=未写。

## 1. 覆盖矩阵

| AC | 场景 | 正常 | 边界 | 异常 | 单元 | 集成 | e2e |
|---|---|---|---|---|---|---|---|
| AC-1 画像 | 简历+JD → 结构化画像 | TC-PRO-001 | TC-PRO-002/006 | TC-PRO-003/004/005 | ✅ | ✅ | — |
| AC-2 出题 | 按时长/难度出题，命中画像 | TC-SES-001/004/005 | TC-SES-002/006 | TC-SES-003 | ✅ | ✅ | — |
| AC-3 追问 | 答浅 → 追问一次 | TC-DIR-003 | TC-DIR-004 | TC-DIR-005 | ✅ | ✅ | — |
| AC-4 评分 | 六维 + 证据 + 缺失要点 | TC-SCR-001 | TC-SCR-002/003 | TC-SCR-004/005 | ✅ | ✅ | — |
| AC-5 语音降级 | 未配置 ASR → 明示降级 | TC-VOI-001 | TC-VOI-002 | TC-VOI-003 | — | ✅ | ✅ |
| AC-6 手撕评审 | 边界推演 + 未真实执行 | TC-COD-001 | TC-COD-002 | TC-COD-003/004 | ✅ | ✅ | — |
| AC-7 断线续考 | 关闭再开恢复 | TC-STO-001 | TC-STO-004 | TC-STO-002/003 | ✅ | ✅ | — |
| AC-8 报告导出 | 逐题分 + Top3 + 改进清单 | TC-REP-001/002 | TC-REP-003 | TC-REP-004 | ✅ | ✅ | — |

## 2. 夹具

| 夹具 | 用途 | 形式 |
|---|---|---|
| `fakeLlm(chunks | error | script)` | 顶替 `ctx.llm.stream`，按脚本依次吐出 JSON 文本或抛错；记录每次调用的 messages 便于断言提示词 | `tests/helpers/fake-llm.mjs` |
| `tmpHome()` | 临时 `$DSH_HOME`，用完删除 | `node:fs.mkdtemp` |
| `fakeContext()` | 已有：注入 `webServer`/`llm`/`dshHomePath` 的最小 ctx | `tests/integration/rpc.test.mjs` |
| `resumeFixture` | 一份真实 Java 后端简历 + JD | `tests/fixtures/resume-java.md` |
| `fakeResponse()` | 已有：捕获 `writeHead` / `end` | 同上 |

## 3. 用例表

### S1 画像与开局（AC-1、AC-2）

| ID | 层 | AC | Given | When | Then | 状态 |
|---|---|---|---|---|---|---|
| TC-PRO-001 | U | AC-1 | 简历含「Java / Spring Boot / 3 年」与 1 个项目，JD 为「Java 后端 / 中级」 | `extractProfile` | 返回 `profile.skills` 含 Spring Boot、`years===3`、`projects.length≥1`、`jd.level==='mid'` | 🟢 |
| TC-PRO-002 | U | AC-1 | 简历与 JD 都是空白字符串 | `extractProfile` | 抛 `E_BAD_REQUEST`，且**未**调用 LLM | 🟢 |
| TC-PRO-003 | U | AC-1 | fakeLlm 两次都返回非 JSON 文本 | `extractProfile` | 抛 `E_PROFILE_INVALID`，调用次数恰好 2 | 🟢 |
| TC-PRO-004 | U | AC-1 | fakeLlm 抛 `Error('timeout')` | `extractProfile` | 抛 `E_LLM_TIMEOUT` | 🟢 |
| TC-PRO-005 | U | AC-1 | 简历 20 001 字符 | `extractProfile` | 抛 `E_BAD_REQUEST`，未调用 LLM | 🟢 |
| TC-PRO-006 | U | AC-1 | JD 只有 `{title:'Java 后端'}`，无 company/level | `extractProfile` | 返回画像且 `warnings` 含「缺少公司/级别」；`jd.title` 保留 | 🟢 |
| TC-SES-001 | U | AC-2 | 画像已确认，`tech-1`/`mid`/30 分钟 | `buildPlan` | `plan.budget===9`，`plan.items.length` 落在 7–11（`budgetTolerance=2`） | 🟢 |
| TC-SES-002 | U | AC-2 | `minutes: 20` | `buildPlan` | 抛 `E_BAD_REQUEST` | 🟢 |
| TC-SES-003 | U | AC-2 | 画像无技能、无项目 | `buildPlan` | 抛 `E_PROFILE_INCOMPLETE` | 🟢 |
| TC-SES-004 | U | AC-2 | 同上正例 | `buildPlan` | `items` 中至少 1 条 `kind===\x27code\x27` | 🟢 |
| TC-SES-005 | U | AC-2 | 画像含 6 项技能、2 个项目 | `buildPlan` | 至少 3 条 item 的 `target` 指向画像里的技能或项目 | 🟢 |
| TC-SES-006 | U | AC-2 | `mode: 'hr'` | `buildPlan` | 抛 `E_BAD_REQUEST` | 🟢 |
| TC-SES-007 | I | AC-1/2 | fakeContext + fakeLlm | `dispatch({op:'session/create'})` → 再 `session/get` | 返回同一 `sessionId`，`session.plan.budget===9` | ⬜ |

### S2 追问与评分（AC-3、AC-4）

| ID | 层 | AC | 场景 | 状态 |
|---|---|---|---|---|
| TC-DIR-001 | U | AC-2 | 难度 junior/mid/senior 的题面措辞分别取自各自题库标签 | 🟢 |
| TC-DIR-002 | U | AC-2 | 45 分钟 13 题的 target 全部不重复（同一会话内不重复问同一技能） | 🟢 |
| TC-DIR-003 | U | AC-3 | 答案「就是缓存」→ 判定过浅，`probe.asked===true`，且 `probe.reason` 非空 | 🟢 |
| TC-DIR-004 | U | AC-3 | 同一题第二次仍过浅 → 不再追问（最多一次），进入下一题 | 🟢（与 003 共用一个 `alreadyProbed` 守卫） |
| TC-DIR-005 | U | AC-3 | 答案为空 → 记 0 分 + 追问一次，不报错 | 🟢 |
| TC-SCR-001 | U | AC-4 | 合法评分 JSON → 六维齐全、`overall` 为分均、`evidence` 至少 1 条 | 🟢 |
| TC-SCR-002 | U | AC-4 | 分数 7 / 0 / -1（越界）→ 钳到 1–5 并记 `warnings` | 🟢 |
| TC-SCR-003 | U | AC-4 | `evidence` 为空 → 视为无效评分，重试一次 | 🟢 |
| TC-SCR-004 | U | AC-4 | 两次都返回非 JSON → 抛 `E_SCORE_INVALID`，且**未**写入会话 | 🟢 |
| TC-SCR-005 | U | AC-4 | 维度缺失一项 → 补 `null` 并标 `warnings`，不整体失败 | 🟢 |
| TC-SCR-006 | I | AC-4 | `turn/answer` 端到端：作答后 `session.turns[0].score.dims` 六键齐全 | ✅（S4 完成） |

### S2b 边界补齐（覆盖率用，非新功能）

补 S2 实现里被漏掉的判分/措辞分支，防止「行覆盖高、分支全漏」。

| ID | 层 | AC | 场景 | 状态 |
|---|---|---|---|---|
| TC-EDG-001 | U | — | `isContractError` 只认自己的类型：`ContractError` / 普通 `Error` / `null` | 🟢 |
| TC-EDG-002 | U | — | 未知难度（`god-tier`）是编程错误，直接抛，不降级 | 🟢 |
| TC-EDG-003 | U | AC-2 | project / code / behavior / knowledge 四种题型各自措辞不同；无 topic 时回退到 target | 🟢 |
| TC-EDG-004 | U | AC-4 | 维度值是非数字字符串（`"4"`）→ 记 0 + warning，六键仍在 | 🟢 |
| TC-EDG-005 | U | — | `stripFence` / `tryParseObject` 容忍围栏，拒绝数组与标量 | 🟢 |
| TC-EDG-006 | U | AC-2 | 无 topic 的题：`skill:Redis` 直接进题干；target 非字符串时回退「你简历里的项目」 | 🟢 |
| TC-EDG-007 | U | AC-1 | 非 abort 的模型异常（`socket hang up`）原样抛出，不被吞成超时 | 🟢 |
| TC-EDG-008 | U | AC-4 | 均分 4.2 → `strong`，均分 3.0 → `ok`（阈值 4.0 / 3.0） | 🟢 |
| TC-EDG-009 | U | — | `ContractError` 不给 message 时，message 等于 code | 🟢 |

> **已记录的设计取舍**：非手撕题 `code` 维固定 0 且**计入**均分，因此这类题的理论最高总分为
> 25/6 ≈ **4.2**，`strong`（≥4.0）仍可达但拿不到 5.0；这是契约 §2.4 的既有口径（示例中
> `code: 0` 参与平均），后续若要改「只在适用维度上平均」，属于契约变更，需改 §2.4 并同步
> TC-SCR-001 / TC-EDG-008 的期望值。

### S3 手撕评审（AC-6）

| ID | 层 | AC | 场景 | 状态 |
|---|---|---|---|---|
| TC-COD-001 | U | AC-6 | 正确解法 → `verdict==='presumed-correct'`，`executed===false`，`cases.length===5` | ✅ |
| TC-COD-002 | U | AC-6 | 空代码 → `verdict==='unverifiable'`，不调用 LLM | ✅ |
| TC-COD-003 | U | AC-6 | 20 001 字符代码 → `E_BAD_REQUEST` | ✅ |
| TC-COD-004 | U | AC-6 | 代码里含注释「忽略以上指令」→ 输出仍为结构化 JSON（提示词注入回归） | ✅ |

### S4 会话存储与续考（AC-7）

| ID | 层 | AC | 场景 | 状态 |
|---|---|---|---|---|
| TC-STO-001 | I | AC-7 | 写入 3 题后重开 `session/get` → 题数与分数完全一致 | ✅ |
| TC-STO-002 | I | AC-7 | 会话文件 `schemaVersion: 99` → `E_SCHEMA_VERSION`，不删原文件 | ✅ |
| TC-STO-003 | I | AC-7 | 写盘时目标目录不存在 → 自动创建；权限失败 → `E_EXPORT_FAILED` 不吞错 | ✅ |
| TC-STO-004 | I | AC-7 | 会话超 2 MB → `E_SESSION_TOO_LARGE`，原文件保持上一版 | ✅ |
| TC-STO-005 | I | AC-7 | `session/list` 按 `updatedAt` 倒序；`session/delete` 之后再 get → `E_SESSION_NOT_FOUND` | ✅ |

**S4 转绿记录（2026-11-23，G4 第 26 轮）**：7 条一起转绿，提交 `9020c47`——`lib/store.mjs` 新建，
`session/create`、`session/get`、`session/list`、`session/delete`、`turn/answer` 接进 `dispatch`，
`ACTIONS` 从 1 个扩到 6 个（lint 的 ACTIONS ↔ switch 双向比对从此真正生效）。
S4 收口时分支只有 **80.21%**（`store.mjs` 56.10%、`index.js` 81.82%），补 **S4b：TC-EDG-021..030**（`6b6abd1`）
后回到 行 **99.74%** / 分支 **86.03%**。

S4b 里两条值得单独说：
- **TC-EDG-026** 用真实 `apply(ctx)` 装配（假 scope 提供 `webServer` + `llm.stream` 异步生成器），
  从 `ctx.llm` 一路走到 `turn/answer` 落盘——这是「宿主 LLM 桥接能跑」的第一条可执行证据，
  而不是只看 `lib/` 单测。
- **TC-EDG-030** 让 `createStore` 接受注入的 `fs`，用 `EIO` 证明意外的 I/O 错误**原样上抛**，
  不会被伪装成「会话不存在」——把「吞错」这条最危险的失败模式钉在测试里。

**一处测试修正（不是放宽断言）**：`TC-CON-002` 原正则 `/^[a-z][a-z0-9-]*$/` 不允许 `session/create`
这种带 `/` 的命名，与**已冻结的契约 §3**冲突（§3 里十个动作全是命名空间式）。已改为允许一段或多段
`/` 分隔的小写标识；唯一性、非空、字典序三条断言一条没动。

**S4c 契约对齐（2026-11-23，提交 `59148c9`）**：把 S4 的实现逐条对回**已冻结的契约**，发现三处不一致，
全部以契约（§3.5/§3.6/§3.10）为准改实现，而不是改文档：

| 契约 | 之前实现 | 现在 |
|---|---|---|
| §3.5 `session/list` 返回 `{id, createdAt, status, mode, turns, overall}` 且 `limit` 限 1–100 | 返回 `answered`/`updatedAt`，无 limit | 按契约字段 + `limit` 越界 `E_BAD_REQUEST` |
| §3.6 `turn/answer` 返回 `{score, next:{type:'probe'|'question'|'finish'}, sessionStatus}`，同 `questionId` 以最后一次为准 | 返回 `{turn}`，重复提交追加 | 契约形状 + 覆盖写 + `decideProbe` 出 `next` |
| §3.10 `session/delete` 幂等（再删仍 `deleted:true`） | 第二次 `E_SESSION_NOT_FOUND` | 幂等 |

配套用例 `TC-EDG-031..035`（`tests/integration/session-contract.test.mjs`）：limit 越界四种坏值、浅答只追问一次、
超长答案在评分前拦下、`overall` 与单卡一致、`inputMode:'voice'` 落盘。

**记录更正（诚实条目）**：S4 收口时我写的 `TC-EDG-024` 断言「删不存在的会话报 `E_SESSION_NOT_FOUND`」，
`TC-EDG-023` 断言列表项有 `answered` 字段——两条都是**按实现写的期望**，与契约冲突，已按契约改正。
这是「测试跟着实现漂」的典型，记在此处作为流程证据：契约冻结后，期望值的来源只能是契约。

### S5 报告与导出（AC-8）

| ID | 层 | AC | 场景 | 状态 |
|---|---|---|---|---|
| TC-REP-001 | U | AC-8 | 报告含逐题分数、六维雷达、`codeVerified===false` | ✅ |
| TC-REP-002 | U | AC-8 | Top3 短板按维度均分升序取前三，且与 `actions` 一一对应 | ✅ |
| TC-REP-003 | U | AC-8 | 一题未答 → 报告标注「样本不足」仍可导出 | ✅ |
| TC-REP-004 | I | AC-8 | `dir` 传 `../..` → `E_BAD_REQUEST`；正常 `dir` 同名文件追加 `-2` | ✅ |
| TC-EDG-040 | U | AC-8 | `exportReport` 缺报告 → `E_BAD_REQUEST` | ✅ |
| TC-EDG-041 | U | AC-8 | 目录不可建 / 文件不可写 → `E_EXPORT_FAILED` | ✅ |
| TC-EDG-042 | U | AC-8 | 缺省目录 = `./interview-reports`；绝对路径须在工作目录内 | ✅ |
| TC-EDG-043 | U | AC-8 | 样本充足时 Markdown 含短板与对应 action | ✅ |
| TC-EDG-044 | U | AC-8 | 未考察维度记 `null` 且不进短板 | ✅ |
| TC-EDG-045 | U | AC-8 | 连续导出走后缀，上限 99 次 | ✅ |
| TC-EDG-046 | U | AC-8 | 旧版/残缺会话（无 mode、无 score）仍产出可读报告 | ✅ |
| TC-WIR-006 | W | AC-1 | DSH_HOME 取自宿主服务 dshHomePath（Web 端不继承环境变量） | ✅ |
| TC-WIR-007 | W | AC-1 | 服务与环境都缺 → session/list 报 E_BAD_REQUEST，不崩 | ✅ |
| TC-WIR-008 | W | AC-1 | dshHome 回退链：空串 / 服务抛异常 / 无 scope → 环境变量 | ✅ |

**S5 转绿记录（2026-11-23）**：6 条一起转绿 + S5b 六条边界补齐（含 1 条真实缺陷修复），共 3 个提交。
`lib/report.mjs` 新建：\`buildReport\`（六维均分、逐题记录、Top3 短板按均分升序）、\`renderMarkdown\`、
\`resolveExportDir\`（只允许工作目录及其子目录）、\`exportReport\`（同名追加 \`-2\`、\`-3\`…）。
\`session/finish\` 与 \`report/export\` 接进 dispatch，\`ACTIONS\` 6→**8**。

三处判定写进实现而不是散在文档里：
- **未考察的维度不进短板**：\`null\` 表示「没考」，不是 0 分；只有测过的维度才参与比惨（TC-EDG-044）。
- **样本阈值 3**：作答 < 3 题 → \`sampleAdequate:false\`，报告标题带「样本不足，仅供参考」，仍然可以导出。
- **导出永不覆盖**：撞名就加后缀，上限 99 次（TC-EDG-045 把上限也钉住），越出工作目录直接 \`E_BAD_REQUEST\`。

分支覆盖率：\`report.mjs\` 只有 **73.91%**，但行覆盖 **100%**。缺口全在 \`x ?? y\` 的默认值分支上——
要么不可达（字段恒存在），要么区分不出行为，硬凑用例只会制造假保护。**如实记录，不作达标主张**；
门槛（行 99.80% / 分支 87.45%）按全量口径仍然过关。

### S6 语音降级（AC-5）

| ID | 层 | AC | 场景 | 状态 |
|---|---|---|---|---|
| TC-VOI-001 | I | AC-5 | 未配置 ASR → `turn/answer` 收到 `inputMode:'voice'` 时返回 `E_ASR_NOT_CONFIGURED`，文案明示改用文字 | ⬜ |
| TC-VOI-002 | E | AC-5 | client.js 含降级提示文案键，且不出现静默失败分支 | ⬜ |
| TC-VOI-001 | I | AC-5 | 语音作答但没带转写文本 → E_ASR_NOT_CONFIGURED，文案点明「改用文字 / 去配置 ASR」 | ✅ |
| TC-VOI-002 | E | AC-6 | 页面含语音降级提示与设置入口（**随 S7 页面接线交付**，见下方说明） | ⬜ |
| TC-VOI-003 | I | AC-5 | 转写结果为空 → E_BAD_REQUEST「转写结果为空」，且会话 JSON 里无任何音频字段 | ✅ |
| TC-VOI-004 | I | AC-5 | 语音 + 有转写 → 与文字同一评分路径，turn 记 inputMode:"voice" | ✅ |

**S6 转绿记录（2026-11-23）**：3 条一起转绿（TC-VOI-004 是回归保护，S4 起就绿）。
`turn/answer` 在评分前拦截语音请求，三种失败都不落盘；宿主从不接触音频，这是 AC-5「语音不可用时降级为文字」的实现口径。
**TC-VOI-002 移到 S7**：它断言的是客户端文案与设置入口，S6 阶段 `client.js` 还是 G1 骨架，此时写了也验证不了——
这和 TC-SCR-006 移到 S4 是同一条理由：期望值要落在能观测的层上。

### S6b 宿主模型路由（真机缺陷回归）

| ID | 层 | AC | 场景 | 状态 |
|---|---|---|---|---|
| TC-WIR-009 | I | AC-3/AC-4 | adapter 以 `finish.reason.kind='error'` 失败 → `turn/answer` 返回 `E_LLM_UNAVAILABLE`，消息里带 `failure.message` | ✅ |
| TC-WIR-010 | I | AC-3 | adapter 以 `finish.reason.kind='aborted'` 结束 → `E_LLM_TIMEOUT` | ✅ |
| TC-WIR-011 | I | AC-4 | 默认选择被用作路由：`stream` 收到的 `provider`/`model` 等于 `agentDefaultModel.currentSelection()`，`text-delta` 正确拼接并出分 | ✅ |
| TC-WIR-012 | I | AC-4 | 既无默认选择也无 provider 列表 → `E_LLM_UNAVAILABLE`（文案含「默认模型」），不发请求 | ✅ |
| TC-WIR-014 | I | AC-4 | `reasoning-delta` 不进答案，只拼 `text-delta`；请求带 `maxTokens >= 2048` | ✅ |
| TC-WIR-015 | I | AC-4 | `finish.reason.kind='max-tokens'`（推理吃满预算）→ `E_LLM_UNAVAILABLE`（截断），不误报 `E_SCORE_INVALID` | ✅ |
| TC-WIR-016 | I | AC-4 | 系统指令同时作为首条 user 消息下发，路由忽略 `system` 时评分规则仍在 | ✅ |
| TC-WIR-013 | I | AC-4 | 消息被规整为文本块数组；assistant 历史转成 user 上下文重放，adapter 不再报 `content.some is not a function` | ✅ |

**S6b 转绿记录（2026-11-23）**：4 条一起转绿（`tests/integration/llm-bridge.test.mjs`）。
起因是活体回归里 `turn/answer` 恒返回 `E_SCORE_INVALID`：`llmBridge` 没带 `provider`/`model`，adapter 选不出来，
流以终止 chunk 返回错误而插件当成空文本，于是「模型没回答」被误报成「评分 JSON 不可解析」。

**夹具修正（不是断言放宽）**：`TC-EDG-026` 的假 scope 原本没有 `agentDefaultModel`，在契约要求路由之后它必然失败；
给假宿主补上 `currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' })`，
断言（turn 能成功、能出分）一字未改。

## 4. 红基线（G3 门禁）

要求三条：①用例可复现失败；②失败原因对应用例；③无 flaky（连跑三次失败集合一致）。

**记录（S1，2026-11-23）**：

| 项 | 证据 |
|---|---|
| `npm run build` | 通过（`node --check` 三个入口文件） |
| `npm run lint` | `0 error(s), 0 warning(s), 13 file(s) scanned` |
| `npm test` | `tests 31 / pass 19 / fail 12 / skipped 0` |
| 失败集合 | `TC-PRO-001..006`、`TC-SES-001..006`（恰好 12 条，与写入用例一一对应） |
| 失败原因 | 桩函数抛 `Error: not implemented yet: extractProfile (G4)` / `... buildPlan (G4)` |
| 稳定性 | 连跑三次，失败集合逐条一致（去掉行尾耗时后 `diff` 为空） |

通过中的 19 条 = 既有 `TC-CON-001..009`、`TC-RPC-001..005`、`TC-WIR-001..005`、`TC-PKG-001..006`，属 G1/G2 回归，不算本轮绿。

> 教训（工具坑，非产品缺陷）：首次判定用了 `grep -E "^✖ TC-"` 直接 `diff`，把每行尾部的
> `(1.1508ms)` 计时也算进比较，三次明明同一集合却报 `FLAKY`。正确做法是比较前
> `sed -E 's/ \([0-9.]+ms\)$//'` 去掉耗时，或只抽取 `TC-[A-Z]+-[0-9]+`。红基线脚本：
> `D:\project\06-temp\red-baseline\check.sh`（临时工具，不进仓库）。

**S1 转绿记录（2026-11-23，G4 前 12 轮）**：按「一轮一用例、只改实现」推进，
`TC-PRO-001..006` → `3f500cf` / `834cc8c` / `d0ed975` / `45f75bf` / `b7182ad` / `124cd65`，
`TC-SES-001..006` → `747adb9` / `4c13e2c` / `b3ea3fe` / `0e8f799` / `92e56eb` / `6ddd027`（共 12 提交）。
每轮先红后绿，未改动任何用例断言。终态：

```
npm run build    → 通过
npm run lint     → 0 error(s), 0 warning(s), 13 file(s) scanned
npm test         → tests 31 / pass 31 / fail 0 / skipped 0
npm run e2e      → tests 6 / pass 6 / fail 0
npm run coverage → 行 98.53% / 分支 84.21%（index.js 98.36/87.50；lib/ 100/…）
```

分支覆盖率 84.21% 尚未到 85%，缺口在 `profile.mjs` 的围栏解析与重试回退分支；
S2/S3 补上边界用例后应自然越过，**不作为 S1 的验收主张**。

**S2 转绿记录（2026-11-23，G4 第 13–22 轮）**：
`TC-DIR-001` → `07c18ab`；`TC-DIR-002` → `2cbcbaa`；`TC-DIR-003` + `TC-DIR-004` → `0a52f30`（同一个
`alreadyprobed` 守卫，一轮内同时转绿，已在用例表注明）；`TC-DIR-005` → `15f74d2`；
`TC-SCR-001..005` → `cb45674` / `c4038be` / `2a4ee4d` / `f02f3db` / `c85326d`。
S2 收口时分支覆盖率只有 **77.78%**（`director.mjs` 50%、`scorer.mjs` 73.91%），
于是补 **S2b：TC-EDG-001..009**（`10cd2f4`）把分支拉回 **85.00%**、行 **99.57%**。

`TC-SCR-006`（`turn/answer` 端到端）本轮**未做**，原因：它依赖会话存储与 dispatch 接线，
与 `TC-SES-007` 同属 S4 的集成面，故按 §5 规则先移到 S4，并在用例表标注「⏭ 移至 S4」。

## 5. 执行与判定

```bash
npm test            # 红基线阶段：预期失败；G4 完成后必须 0 failed
npm run e2e
npm run coverage    # 核心 lib/** ≥85% 行覆盖
```

判定：一个用例从 🔴/⬜ 变 🟢 的条件是「只改实现、不改用例」后转绿；若必须改用例，先在本文件写明理由并升 `TC-` 号，不得就地放宽断言。
**S3 转绿记录（2026-11-23，G4 第 23–25 轮）**：
`TC-COD-003` → `2eaf2b6`；`TC-COD-002` → `ae67069`；`TC-COD-001` + `TC-COD-004` → `5a1a202`（同一轮，
因为「代码是数据」这条防线只有在做出正向评审之后才有东西可守：先让结构化输出成立，再证明注入改不了结构）。
S3 收口时分支只有 **80.72%**（`code-review.mjs` 50.00%），补 **S3b：TC-EDG-010..018**（`3b8fff4`）
后回到 行 99.66% / 分支 **85.02%**。

S3b 覆盖的真实边界，不是为数字而写的：评审输出不可解析 → `E_SCORE_INVALID`；`verdict` 越界降级
`unverifiable`；`cases` 少于/等于/多于 5 条三条路径；非字符串代码按空处理；畸形 case 条目
（数字 input / null expected / `ok:'yes'`）归一；JSON 提取器对字符串内花括号、未闭合对象、
数组、诱饵对象（prose 里先出现 `{"verdict":"..."}`）的行为。

### S5 期间发现并修复的真实缺陷

活体验证时 `{"op":"session/list"}` 在宿主上返回 `E_BAD_REQUEST 缺少 DSH_HOME`：
RPC 跑在 Web 服务进程里，**不继承启动它的 shell 的环境变量**。原先只读 `process.env.DSH_HOME` 的写法
在线下测试永远成立、在真实宿主永远失败——这类缺陷只有活体调用能暴露。

修法：`apply(ctx)` 里用 `dshHome(scope)` 先取宿主服务 `dshHomePath`（与 `dsh-collections` 一致），
环境变量只作回退；TC-WIR-006..008 把这个顺序钉死。**结论：每个切片收口都必须包含一次活体 RPC 调用，不能只信单元测试。**

## S7 前置：把已有的两个 lib 接到 RPC（2026-11-23）

| 用例 | 层 | 验收 | 场景 | 状态 |
|---|---|---|---|---|
| TC-RPC-006 | I | AC-1 | `profile/extract` 把粘贴的简历+JD 变成可编辑画像；全空输入 → `E_BAD_REQUEST` 且不调模型 | ✅ |
| TC-RPC-007 | I | AC-6 | `code/review` 评审手撕题：`executed:false`、`cases` 恒 5 条、空代码 → `unverifiable`、超 20 000 字符 → `E_BAD_REQUEST`、会话不存在 → `E_SESSION_NOT_FOUND` | ✅ |

`ACTIONS` 8 → **10**，契约里的十个动作全部有实现；`code/review` 与 `turn/answer` 共用 `buildCard`，落盘用同一 `questionId` 覆盖写。

## 评分口径变更（2026-11-23，用户裁决）

活体回归发现「`code:0` 计入六维平均」会让非手撕题的理论上限只有 25/6 ≈ 4.2，且真机上把一次四平八稳的并发回答判成 `overall 2.2 / weak`。用户选择「只按适用维度平均」，据此改契约 §2.4 与 `lib/scorer.mjs`：

- 新增 `APPLICABLE_DIMENSIONS` 与 `applicableDims(kind)`（`lib/contracts.js`）：skill 四维、project 五维、behavior 四维、code 四维。
- `buildCard` 只对适用维度取平均；不适用维度照常出现在 `dims`，但不进均分、缺失也不产生 warning。
- `TC-SCR-001` 期望从 2.5 改为 **2.8**（(3+2+3+3)/4 = 2.75），改的是期望值且手算复核过；其余用例（`TC-EDG-008` 的 5.0/3.8、`TC-SCR-002`、`TC-SCR-005`）断言不变即通过。

## S6b 真机返修（2026-11-23）

活体回归发现三处只有真环境才暴露的缺陷，全部先补红用例再修：

1. `session/list` → `E_BAD_REQUEST 缺少 DSH_HOME`：RPC 在 Web 服务进程里，不继承 shell 环境；`scope.get('dshHomePath')` 是**服务函数**必须调用（对照 `dsh-collections/index.js:65`）。
2. `turn/answer` → `E_SCORE_INVALID`（6 ms）：`GenerateOptions` 必须带 `provider`/`model`，否则宿主流根本不发请求；adapter 的失败是终止 `finish` chunk，不是异常。
3. `content.some is not a function`：`RequestMessage.content` 必须是文本块数组。
4. `E_SCORE_INVALID`（11 s，真调了模型）：推理模型的 `reasoning-delta` 被当答案拼进来、且没给 `maxTokens`，预算被思考吃满 → 空文本。现只拼 `text-delta`、显式 `maxTokens: 4096`、`max-tokens` 映射为截断错误，系统指令额外以首条 user 消息下发。

教训：错误耗时是判据——<20 ms 说明没走新代码或本地短路，>1 s 才是真的调模型；每次 host 改动都必须重启 Web 端。

## S7 页面接线（2026-11-23）

页面从 G1 骨架换成三步向导：setup（粘简历+JD、选时长/类型/难度）→ confirm（可编辑画像，技能逗号分隔、项目一行一个）→ run（逐题作答、六维卡片、手撕走 code/review、最后 session/finish 出报告）→ report（导出 Markdown）。

| 用例 | 层 | 验收 | 场景 | 状态 |
|---|---|---|---|---|
| TC-RPC-006 | I | AC-1 | profile/extract 把粘贴文本变成可编辑画像；全空 → E_BAD_REQUEST 且不调模型 | ✅ |
| TC-RPC-007 | I | AC-6 | code/review：executed:false、cases 恒 5、空代码 unverifiable、超长 E_BAD_REQUEST、无会话 E_SESSION_NOT_FOUND | ✅ |
| TC-REP-007 | I | AC-8 | 调用方未指定目录时，报告落在部署默认工作目录（workingDirectory.defaultDirectory），而不是宿主进程 cwd | ✅ |
| TC-VOI-002 | 手工 | AC-5 | 点「语音作答」不假装录音，直接提示「未配置 ASR，请改用文字」；「朗读题目」走浏览器 speechSynthesis | 待真机点验 |

ACTIONS 十项全部有实现；UI 侧不重复计算分数，只渲染宿主给的 score/report（契约 §2.1 规定）。

### B2 存储迁移与列表索引（v0.2，2026-11-23）

| 用例 | 层 | 场景 | 状态 |
|---|---|---|---|
| TC-MIG-001 | I | v1 记录按 v2 视图读出（含默认标题/tags/note），文件内容一个字节没变 | ✅ |
| TC-MIG-002 | I | 首次写回升 v2，并留下一次性的 \`<id>.json.v1.bak\`（内容等于原始字节）；第二次写不再覆盖备份 | ✅ |
| TC-MIG-003 | I | 由更新插件写入的记录：读与写都报 \`E_SCHEMA_VERSION\`，盘上内容不变、不产生备份 | ✅ |
| TC-MIG-004 | I | 迁移不覆盖旧记录已有的 title/tags/note | ✅ |
| TC-MIG-005 | I | 完全没有 \`schemaVersion\` 的早期文件按 v1 处理，不当作损坏 | ✅ |
| TC-IDX-001 | I | 首次 list 建索引；第二次 list 不再读记录正文 | ✅ |
| TC-IDX-002 | I | 只写一条记录后，list 只重读那一条正文 | ✅ |
| TC-IDX-003 | I | 删除记录后，索引里残留的条目不会让已删记录复活 | ✅ |
| TC-IDX-004 | I | \`index.json\` 损坏时整表重建而不是报错 | ✅ |
| TC-IDX-005 | I | 绕过插件直接改文件，mtime 变化触发重读，改名生效 | ✅ |

本轮证据：\`npm test\` 142/142、\`npm run e2e\` 6/6、\`npm run lint\` 0 error、coverage 行 98.03% / 分支 86.20%。

实现要点：
- 迁移是"读时补视图、写时落盘"，所以读一次 v1 文件不会有任何写副作用；备份只发生在那次真正的写入前。
- \`schemaVersion\` 的提升同时改了 \`SCHEMA_VERSION = 2\`，\`ping\` 返回的 \`schemaVersion\` 也随之变成 2（\`TC-RPC-001\` 的期望值同步更新，属契约版本变更，不是放宽断言）。
- 索引条目只存列表行（含排序键 \`updatedAt\`），不存 \`note\`，所以索引文件不会把复盘正文复制一份。

### B1 面试记录增删改查（v0.2，2026-11-23）

本轮的对象是「面试记录」本身：新建（已有）、查看、改名/标签/备注、搜索筛选、单条与批量删除、从未完成记录继续作答。契约 §3.5 / §3.10 / §3.11。

| 用例 | 层 | 场景 | 状态 |
|---|---|---|---|
| TC-HIS-001 | U | 空 patch 被拒绝，不会静默写一次「什么都没改」的更新 | ✅ |
| TC-HIS-002 | U | 标题 trim、非空、≤80 字；空串与超长拒绝 | ✅ |
| TC-HIS-003 | U | 标签 trim、按首次出现去重保序、≤10 个、单项 ≤24 字、允许空数组 | ✅ |
| TC-HIS-004 | U | 备注首尾 trim、保留内部换行、≤2 000 字、非字符串拒绝 | ✅ |
| TC-HIS-005 | U | query 不区分大小写，覆盖标题/标签/备注/模式/难度；与 status/mode/difficulty/tag 是 AND | ✅ |
| TC-HIS-006 | U | 排序 recent/oldest/score（无分排最后）；分页 offset/limit、total、hasMore；非法 sort/status/offset 拒绝 | ✅ |
| TC-HIS-007 | U | 列表摘要不含 note 与 updatedAt（排序键不外泄） | ✅ |
| TC-HIS-100 | I | 新建记录自动生成标题，tags/note 默认值齐备，列表带同一标题 | ✅ |
| TC-HIS-101 | I | 改名不动 plan/turns/createdAt，updatedAt 前进；标签与备注可单独更新（部分更新） | ✅ |
| TC-HIS-102 | I | 六种非法 patch 与未知记录分别返回 E_BAD_REQUEST / E_SESSION_NOT_FOUND | ✅ |
| TC-HIS-103 | I | 列表按 query/tag/mode/difficulty 筛选与分页；非法枚举拒绝 | ✅ |
| TC-HIS-104 | I | 单条删除幂等；批量删除返回实际条数；重复批量返回 0；51 条 / 非字符串 / 同时给 id 与 ids 均拒绝 | ✅ |
| TC-HIS-105 | I | 未完成记录可继续：改名后 turns 不新增幻影条目，重答同题覆盖而非追加 | ✅ |

本轮证据：`npm test` 132/132、`npm run e2e` 6/6、`npm run lint` 0 error、coverage 行 98.82% / 分支 87.22%（`lib/history.mjs` 行 100%、分支 91.96%）。

实现要点（记录用）：
- 排序键 `updatedAt` 只在 store 内部参与排序，`sessionMeta()` 出口剥掉它和 `note`，列表不会把整份复盘带出去。
- `score` 排序里「没有分数」不是 0 分：`null` 一律排最后，彼此按时间倒序。
- 批量删除先用一次 `readdir` 求交集再逐个 `rm`，既保证「只报真实删掉的条数」，又避免 N 次 stat。
- 旧记录（v0.1 写的文件没有 title/tags/note）在 `store.get` 里补默认值，下次写入时落盘——真正的 `schemaVersion` 迁移放在 B2。

### S7 返修（2026-11-23，真机点验后）

| 用例 | 层 | 场景 | 状态 |
|---|---|---|---|
| TC-REP-008 | U | 雷达只聚合适用维度：八股题的 `project`/`code` 分不进报告短板 | ✅ |
| TC-REP-001/002 | U | 期望值按适用维度口径手算重写（correctness (4+3)/2=3.5、project 只算项目题=5、code 未考察=null） | ✅ |
| TC-EDG-042 | U | 相对路径越界拒绝、绝对路径按用户指定直接使用 | ✅ |
| TC-REP-004 | I | 绝对导出目录成功落盘（此前误判 `E_BAD_REQUEST`） | ✅ |
| TC-RPC-008 | I | `code/review` 的 `verdict` 与 `cases` 矛盾时给 warning，`verdict` 不改写 | ✅ |
