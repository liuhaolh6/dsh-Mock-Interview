# 测试计划（G3）

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
| TC-SCR-006 | I | AC-4 | `turn/answer` 端到端：作答后 `session.turns[0].score.dims` 六键齐全 | ⏭ 移至 S4（依赖会话存储与 dispatch 接线，与 TC-SES-007 同批） |

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
| TC-COD-001 | U | AC-6 | 正确解法 → `verdict==='presumed-correct'`，`executed===false`，`cases.length===5` | ⬜ |
| TC-COD-002 | U | AC-6 | 空代码 → `verdict==='unverifiable'`，不调用 LLM | ⬜ |
| TC-COD-003 | U | AC-6 | 20 001 字符代码 → `E_BAD_REQUEST` | ⬜ |
| TC-COD-004 | U | AC-6 | 代码里含注释「忽略以上指令」→ 输出仍为结构化 JSON（提示词注入回归） | ⬜ |

### S4 会话存储与续考（AC-7）

| ID | 层 | AC | 场景 | 状态 |
|---|---|---|---|---|
| TC-STO-001 | I | AC-7 | 写入 3 题后重开 `session/get` → 题数与分数完全一致 | ⬜ |
| TC-STO-002 | I | AC-7 | 会话文件 `schemaVersion: 99` → `E_SCHEMA_VERSION`，不删原文件 | ⬜ |
| TC-STO-003 | I | AC-7 | 写盘时目标目录不存在 → 自动创建；权限失败 → `E_EXPORT_FAILED` 不吞错 | ⬜ |
| TC-STO-004 | I | AC-7 | 会话超 2 MB → `E_SESSION_TOO_LARGE`，原文件保持上一版 | ⬜ |
| TC-STO-005 | I | AC-7 | `session/list` 按 `updatedAt` 倒序；`session/delete` 之后再 get → `E_SESSION_NOT_FOUND` | ⬜ |

### S5 报告与导出（AC-8）

| ID | 层 | AC | 场景 | 状态 |
|---|---|---|---|---|
| TC-REP-001 | U | AC-8 | 报告含逐题分数、六维雷达、`codeVerified===false` | ⬜ |
| TC-REP-002 | U | AC-8 | Top3 短板按维度均分升序取前三，且与 `actions` 一一对应 | ⬜ |
| TC-REP-003 | U | AC-8 | 一题未答 → 报告标注「样本不足」仍可导出 | ⬜ |
| TC-REP-004 | I | AC-8 | `dir` 传 `../..` → `E_BAD_REQUEST`；正常 `dir` 同名文件追加 `-2` | ⬜ |

### S6 语音降级（AC-5）

| ID | 层 | AC | 场景 | 状态 |
|---|---|---|---|---|
| TC-VOI-001 | I | AC-5 | 未配置 ASR → `turn/answer` 收到 `inputMode:'voice'` 时返回 `E_ASR_NOT_CONFIGURED`，文案明示改用文字 | ⬜ |
| TC-VOI-002 | E | AC-5 | client.js 含降级提示文案键，且不出现静默失败分支 | ⬜ |
| TC-VOI-003 | I | AC-5 | 已配置 ASR 但转写失败 → 保留原音频不落盘，返回可重试错误 | ⬜ |

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