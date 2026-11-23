# RPC 契约 v1（G2）

> 目标契约 = 本文件；**已实现契约** = `lib/contracts.js` 的 `ACTIONS`（当前仅 `ping`）。
> 规则：动作只有进了 `ACTIONS`、加了 `case`、加了用例，才算存在；`npm run lint` 会把
> 「文档有 / 代码无」之外的漂移（ACTIONS ↔ switch ↔ 双半 RPC 路径）直接判红。
> 本文件禁止出现 TBD；未定项一律写成「未知：<缺什么、谁确认>」。

## 1. 传输

| 项 | 约定 |
|---|---|
| 方法 / 路径 | `POST /api/dsh-mock-interview/rpc`（唯一端点，`RPC_PATH`） |
| 请求体 | `application/json`，顶层对象，字段 `op: string` 选择动作，其余字段随动作 |
| 响应体 | 成功 `{ "ok": true, "value": <payload> }`；失败 `{ "ok": false, "error": { "code": "E_*", "message": "人类可读" } }` |
| HTTP 状态 | 业务失败**恒 200**（信封表达错误）；仅传输层/未预期异常为 500 且仍返回同款信封 |
| 头 | 响应带 `content-type: application/json; charset=utf-8`、`cache-control: no-store` |
| 请求体上限 | 64 KB（`LIMITS.maxRequestBytes`）；超限 → `E_BAD_REQUEST` |
| 答案上限 | 单次作答 4 000 字符（`LIMITS.maxAnswerChars`）；简历文本 20 000 字符（`LIMITS.maxResumeChars`） |
| 会话文件上限 | 2 MB（`LIMITS.maxSessionBytes`）；超限 → `E_SESSION_TOO_LARGE` |
| LLM 超时 | 45 s（`LIMITS.llmTimeoutMs`）；重试一次后仍失败 → `E_LLM_TIMEOUT` |
| LLM 输出预算 | `LIMITS.llmMaxTokens = 4096`；推理模型会把预算先花在思考上，预算用尽即 `E_LLM_UNAVAILABLE`（截断），不当作评分 JSON 错误 |
| 幂等 | 只有 `ping`、`session/get`、`session/list`、`report/export`（相同路径重复导出覆盖同名文件）可重复调用；其余动作每调用一次都产生新状态 |

**2 MB 会话上限的依据**（2026-11-23 估算，非拍脑袋）：45 分钟档最多 13 题，最坏情况 = 3 道手撕各 20 000 字 + 10 道口头作答各 4 000 字（52 000）+ 13 份评分卡各 1 600 字（20 800）+ 15 条边界用例推演（3 900）+ 画像/计划/报告等元数据（12 000）≈ **136 700 字符**；中文按 UTF-8 三字节计 ≈ 0.39 MB，叠加 JSON 结构与转义 35% ≈ **0.53 MB**，即 2 MB 仍有 **≈3.8 倍**余量。全会话上限只用于拦「异常膨胀」（例如模型把整段上下文回吐进答案），正常使用不会触发。

## 2. 数据结构

```jsonc
// Profile —— 画像（AC-1），用户可逐字段编辑
{ "skills": ["Java", "Spring Boot"], "years": 3, "level": "mid",
  "projects": [{ "name": "订单中心", "role": "后端", "highlights": ["QPS 3k"] }],
  "jd": { "title": "Java 后端", "company": "某厂", "level": "mid" },
  "edited": false }

// Plan —— 出题计划（AC-2）
{ "mode": "tech-1", "difficulty": "mid", "minutes": 30, "budget": 9,
  "items": [{ "id": "q1", "kind": "skill|project|code|behavior", "topic": "JVM GC",
              "target": "skill:Java", "weight": 1 }] }
// target 三种前缀：`skill:<画像技能名>` / `project:<画像项目名>` / `bank:<题库主题>`。
// 同一会话内 target 不复重（先吃自己简历里的点，再用题库补足）；
// `topic` 是给考生看的主题名，`kind` 决定手撕/项目/行为题的措辞。

// Turn —— 一问一答（AC-3/4/6）
{ "questionId": "q1", "kind": "skill", "prompt": "…", "answer": "…",
  "inputMode": "text|voice|code", "askedAt": 0, "answeredAt": 0,
  "code": "只有 inputMode=code 才有", "cases": [{ "input": "", "expected": "", "actual": "", "ok": false }],
  "score": ScoreCard, "probe": { "asked": true, "reason": "回答只有结论" } }

// ScoreCard —— 六维（AC-4）
{ "dims": { "correctness": 3, "depth": 2, "structure": 3,
            "project": 4, "code": 0, "communication": 3 },   // 1–5 整数
  "overall": 2.5, "verdict": "weak|ok|strong",
  "evidence": ["考生原话"], "missing": ["缺：GC 分代假设"],
  "reference": ["参考要点"] }
// overall = **适用维度**的算术平均（保留 1 位小数），不是六维平均。
// 适用维度由题型决定（`APPLICABLE_DIMENSIONS`，2026-11-23 裁决，替代原「六维平均」口径）：
//   skill    → correctness, depth, structure, communication
//   project  → correctness, depth, structure, project, communication
//   behavior → depth, structure, project, communication
//   code     → correctness, depth, code, communication
// 不适用的维度仍照常出现在 dims 里（数字或 null），但不进均分、也不因缺失产生 warning。
// 例：skill 题 3/2/3/…/3 → (3+2+3+3)/4 = 2.75 → 2.8。
// verdict 阈值（按 overall）：≥4.0 strong / ≥3.0 ok / 其余 weak。
// 空作答 → 六维全 0、overall 0、missing ["未作答"]，不调模型。
// 适用维度缺失 → null（不计入均分）；越界（>5 或 <0）→ 钳到 1–5 并记 warnings。

// Report —— 报告（AC-8）
{ "sessionId": "...", "summary": "…", "radar": { "dims": {} },
  "weakTop3": ["…"], "actions": ["补 JVM 分代 / 练 3 道 GC 调优题"],
  "codeVerified": false }   // 手撕题恒 false：未真实执行

// Session —— 会话
{ "schemaVersion": 1, "id": "...", "createdAt": 0, "updatedAt": 0,
  "status": "draft|running|finished", "profile": Profile, "plan": Plan,
  "turns": [Turn], "report": Report|null }
```

## 3. 动作

### 3.1 `ping`
- 请求：`{ "op": "ping" }`
- 响应：`{ "pong": true, "version": "0.1.0", "schemaVersion": 1, "at": 1700000000000 }`
- 失败：无（仅传输层）。
- 边界：空体 → `E_UNKNOWN_ACTION`；非对象 → `E_BAD_REQUEST`。
- **状态：已实现**（TC-RPC-001..005、TC-WIR-003..005）。

### 3.2 `profile/extract`
- 请求：`{ "op": "profile/extract", "resumeText": "…", "jdText": "…" | "jd": {title, company, level} }`
- 响应：`{ "profile": Profile, "warnings": ["…"] }`
- 失败：`E_BAD_REQUEST`（两处输入皆空 / 超长）、`E_LLM_UNAVAILABLE`、`E_LLM_TIMEOUT`、`E_PROFILE_INVALID`（模型输出两次都不可解析为画像）。
- 边界：简历纯空白、JD 只给岗位名、简历含乱码 → 追加 `warnings`，仍返回可编辑画像（`skills` 可为空数组）。
- 幂等：否（同一输入两次抽取可能措辞不同；由用户在确认页定稿）。

### 3.3 `session/create`
- 请求：`{ "op": "session/create", "profile": Profile, "mode": "tech-1|project|algo|behavior", "difficulty": "junior|mid|senior", "minutes": 15|30|45 }`
- 响应：`{ "sessionId": "...", "plan": Plan }`
- 失败：`E_PROFILE_INCOMPLETE`（无技能且无项目）、`E_BAD_REQUEST`（枚举越界）、`E_LLM_TIMEOUT`。
- 边界：`minutes` 越界 → `E_BAD_REQUEST`；`budget` 由 `DURATIONS` 决定 5/9/13，允许 ±2 的实际出题偏差。
- 幂等：否（每次创建新会话）。

### 3.4 `session/get`
- 请求：`{ "op": "session/get", "sessionId": "..." }`
- 响应：`{ "session": Session }`
- 失败：`E_SESSION_NOT_FOUND`、`E_SCHEMA_VERSION`（文件版本高于插件，拒绝加载并提示升级）。
- 幂等：是（AC-7 断线续考的唯一入口）。

### 3.5 `session/list`
- 请求：`{ "op": "session/list", "limit": 20, "offset": 0, "query": "", "status": "active|finished", "mode": "tech-1|project|algo|behavior", "difficulty": "junior|mid|senior", "tag": "", "sort": "recent|oldest|score" }`（除 `limit` 外全部可缺省）
- 响应：`{ "sessions": [{ id, title, createdAt, status, mode, difficulty, tags, turns: 5, overall: 3.1 }], "total": 12, "hasMore": true }`
- 失败：`E_BAD_REQUEST`（`limit` 非 1–100 整数、`offset` 非非负整数、`sort`/`status`/`mode`/`difficulty` 非法枚举）。
- 语义（v0.2 B1）：`query` 对 `title`、`tags`、`note`、`mode`、`difficulty` 做**不区分大小写的子串匹配**；各类筛选与搜索是 AND 关系，互不覆盖；`sort` 缺省 `recent`（`updatedAt` 降序），`oldest` 升序，`score` 按 `overall` 降序且 `null` 排最后；分页在排序之后切片，`hasMore = offset + 本次条数 < total`；响应不返回排序键 `updatedAt`/`note`（列表只给摘要）。
- 幂等：是。

### 3.6 `turn/answer`
- 请求：`{ "op": "turn/answer", "sessionId": "...", "questionId": "q1", "answer": "…", "inputMode": "text|voice" }`
- 响应：`{ "score": ScoreCard, "next": { "type": "probe|question|finish", "question"?: Question }, "sessionStatus": "running|finished" }`
- 失败：`E_SESSION_FINISHED`、`E_SESSION_NOT_FOUND`、`E_BAD_REQUEST`（答案超 4 000 字）、`E_SCORE_INVALID`、`E_LLM_TIMEOUT`。
- 边界：空答案视为「不会」→ 记 0 分；第一次空答追问一次，**连续两次空答即跳过该题**（见 §3.6.3）；同一 `questionId` 重复提交以最后一次为准（覆盖）。
- 幂等：否（每次提交推进一题）。

### 3.6.1 语音作答的降级语义（S6 实现记录）

宿主**从不接收、也不保存音频**：`turn/answer` 只接受浏览器用自备 ASR 端点转好的文本。
因此「语音」在本插件里等价于「带 `inputMode` 标记的文字」，失败模式只有三种：

| 请求 | 结果 | 错误码 | 可重试 |
| --- | --- | --- | --- |
| `inputMode:"voice"` 且**没有** `answer` 字段 | 明示未配置 ASR，提示改用文字或去设置里填端点 | `E_ASR_NOT_CONFIGURED` | 是（配置后重录） |
| `inputMode:"voice"` 且 `answer` 为空白 | 转写为空，提示重录 | `E_BAD_REQUEST` | 是 |
| `inputMode:"voice"` 且 `answer` 有内容 | 与文字作答完全同一条评分路径，turn 上记 `inputMode:"voice"` | — | — |

三种失败**都不落盘**：不会产生半条 turn，也不会把音频写进会话文件（`tests/integration/voice.test.mjs` 用正则断言会话 JSON 里没有 `audio|base64|blob`）。
### 3.6.3 连续空答的跳过语义（v0.2 B3 实现记录）

会话上记 `emptyStreak`：空答 +1，有内容归零。

| `emptyStreak` | 结果 |
| --- | --- |
| 1（第一次空答） | 记 0 分评分卡，追问一次（`next.type: "probe"`），原因「考生没有作答…」 |
| ≥2（连续第二次） | 记 0 分评分卡，**不追问**，直接下一题（`next.type: "question"`）或结束 |

理由是「卡住」和「答得浅」不是一回事：同一题问到第三次只会消耗剩余题量。分数照记，报告里这一题仍是 0 分。

### 3.6.2 模型调用的路由与失败语义（S6b 实现记录）

所有需要模型的动作用同一条宿主通道：`ctx.llm.stream(options)`。

- **必须带路由**：`GenerateOptions` 要求 `provider` 与 `model`，`provider` 决定 adapter。插件按序取：
  1. `agentDefaultModel.currentSelection()` 的 `provider` / `model`（用户自己选的默认模型）；
  2. `llm.listProviders()` 的第一个 provider + `llm.listModels(provider)` 的第一个 model（宿主还没选过默认值时的兜底）；
  3. 都没有 → `E_LLM_UNAVAILABLE`（文案「宿主没有可用的默认模型，无法评分」），**不**发一个没有路由的请求。
- **失败是 chunk 不是异常**：adapter 出错时流以终止 chunk 返回，不抛异常。
  - `finish.reason.kind === 'error'` → `E_LLM_UNAVAILABLE`，消息取 `failure.message`；
  - `finish.reason.kind === 'aborted'` → `E_LLM_TIMEOUT`；
  - 流结束但**文本为空** → `E_LLM_UNAVAILABLE`（否则下游只会报出令人误解的「评分 JSON 不可解析」）。
- **消息形状**：adapter 只接受 `content` 为文本块数组的 `RequestMessage`；引擎侧写的是 `{ role, content: 字符串 }`，
  桥接层统一转成 `[{ type: "text", text }]`。assistant 历史需要模型来源元数据，插件不伪造，
  因此「上一次的回复」以「（你上一条回复）」开头并入 user 消息重放，不让 adapter 去猜 assistant 的来源。

- **只拼文本增量**：`text-delta` 的 `text`（兼容历史形状里的 `delta`/`content`）；`reasoning-delta` 不进答案。

### 3.7 `code/review`
- 请求：`{ "op": "code/review", "sessionId": "...", "questionId": "q3", "language": "java", "code": "…" }`
- 响应：`{ "score": ScoreCard, "verdict": "presumed-correct|presumed-wrong|unverifiable", "cases": [{ input, expected, actual, ok }], "executed": false }`
- 失败：`E_SCORE_INVALID`、`E_LLM_TIMEOUT`；**永不**执行代码，也永不因代码报错而失败。
- 边界：空代码 → `unverifiable`；超 20 000 字符 → `E_BAD_REQUEST`。
- `executed` 恒为 `false`，报告与 UI 必须渲染「未真实执行」（ADR-0004）。
- 落盘：评审通过后覆盖写同 `questionId` 的 turn（`inputMode:"code"`、`answer` 与 `code` 都是代码原文、`cases` 一并存），保证报告口径与 `turn/answer` 一致；会话 `finished` → `E_SESSION_FINISHED`，题目不在题单 → `E_BAD_REQUEST`。
- 评审语义（实现后钉死，G4/S3）：
  - `cases` 恒为 **5 条**。模型给多了截断，给少了用 `{ input:'', expected:'', actual:'', ok:false }` 补齐并加 warning；
    `ok` 严格按 `=== true` 判定，其余一律 `false`。
  - `verdict` 只接受三档枚举；模型给了别的一律降级 `unverifiable` 并加 warning（不静默改判）。
  - 模型输出不是合法 JSON 对象 → 重试一次，仍失败 → `E_SCORE_INVALID`（与本约定「评不出分」一致）。
  - **代码是数据，不是指令**：代码注释里出现「忽略以上指令」之类文字，只能改变评审结论，
    不能改变响应的结构（verdict / cases / score 三件套始终存在）——这条由 TC-COD-004 守护。
  - 响应里的 `score` 与 `turn/answer` 用同一套 `buildCard()` 归一（钳制 1..5、缺维 null、
    `overall` 取适用维度算术平均），避免手撕题和八股题两套评分口径；`buildCard(parsed, kind)` 是唯一入口。

### 2.1 `Report` 附加字段（S5 实现记录）

§2 只钉死了 `sessionId` / `summary` / `radar.dims` / `weakTop3` / `actions` / `codeVerified`。
实现另外带回以下字段（**只增不减，旧客户端可忽略**），UI 与导出直接消费它们：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `generatedAt` | number | 报告生成时刻（ms） |
| `mode` / `difficulty` / `minutes` | string / string / number | 会话配置快照，报告脱离会话也能读懂 |
| `planned` / `answered` | number | 计划题数 / 已答题数 |
| `sampleAdequate` | boolean | `answered >= 3`；false 时报告标注「样本不足，仅供参考」 |
| `overall` | number \| null | 逐题适用维度平均的再平均，保留 1 位；无分则 `null` |
| `dims` | Record<string, number\|null> | 与 `radar.dims` 同一份数据（雷达图与表格共用） |
| `items` | array | 逐题 `{questionId, kind, target, topic, overall, verdict, missing, inputMode, answer, reference, evidence, cases, warnings, probe}`（后 7 个字段 v0.2 B4 加入，用于复盘） |
| `weaknesses` | array | `{dimension, average, action}`，与 `weakTop3`/`actions` 同序 |

两条判定规则（实现层固化，不得在 UI 侧另算）：
1. **未考察 ≠ 0 分**：维度值为 `null` 时不参与短板排序，也不计入 `overall`（否则「没考」会被当成「考砸」）。
2. **短板上限 3**：按维度均分升序取前三；不足三个测过的维度就有几个列几个，`weakTop3` 与 `actions` 恒等长。

### 2.2 `report/export` 的文件名规则（S5 实现记录）

```
<YYYY-MM-DD>-<sessionId 前 8 位>.md      // 首次导出
<YYYY-MM-DD>-<sessionId 前 8 位>-2.md    // 同名已存在
<YYYY-MM-DD>-<sessionId 前 8 位>-99.md   // 后缀探测上限，之后不再尝试
```

- 只允许写工作目录及其子目录：`dir` 越界（`../..`、绝对路径、`.` 本身）→ `E_BAD_REQUEST`，且**在落盘前**拦下。
- 永不覆盖：撞名加后缀；`mkdir` 与 `writeFile` 的异常统一映射 `E_EXPORT_FAILED`（`EACCES` / `ENOSPC` 等只进 detail，不外泄路径）。

### 3.8 `session/finish`
- 请求：`{ "op": "session/finish", "sessionId": "..." }`
- 响应：`{ "report": Report }`
- 失败：`E_SESSION_NOT_FOUND`、`E_SCORE_INVALID`、`E_LLM_TIMEOUT`。
- 边界：一题未答也能结束（报告标注「样本不足」）；重复调用返回同一份报告（幂等，`status` 已为 `finished` 时直接回放）。

### 3.9 `report/export`
- 请求：`{ "op": "report/export", "sessionId": "...", "dir": "./interview-reports", "format": "md|json" }`（`dir` 缺省即该值；`format` 缺省 `md`，v0.2 B4）
- 响应：`{ "path": "D:/project/interview-reports/2026-11-23-….md", "bytes": 4210 }`；`format:"json"` 时扩展名为 `.json`，内容是完整 `Report` 的格式化 JSON（可 `JSON.parse` 读回）
- 失败：`E_SESSION_NOT_FOUND`、`E_EXPORT_FAILED`（不可写/磁盘满）、`E_BAD_REQUEST`（`dir` 越出允许根目录）。
- 边界：同名文件追加 `-2`、`-3`（按扩展名各自计数）；相对路径只允许写到当前工作目录或其子目录，绝对路径由用户显式指定；`format` 只接受 `md` / `json`，其它值 `E_BAD_REQUEST`（不静默降级）。
- **只读语义**：导出任意历史记录都不修改该会话文件（未结束的会话也不会因为导出而被标成 finished），`TC-REP-011` 逐字节比对守护。
- 幂等：是（相同内容重复导出产生新文件，不覆盖已有报告）。

### 3.10 `session/delete`
- 请求（单条）：`{ "op": "session/delete", "sessionId": "..." }`
- 请求（批量）：`{ "op": "session/delete", "ids": ["...", "..."] }`
- 响应：单条 `{ "deleted": true }`（保持 v0.1 形状）；批量 `{ "deleted": 2 }`，`deleted` 是**实际存在并被删除**的条数。
- 失败：`E_BAD_REQUEST`（`sessionId` 与 `ids` 都缺、二者同时给、`ids` 非数组、`ids` 超 50 条或含非字符串）；`E_SESSION_NOT_FOUND` 不再出现（单条删除也是幂等的）。
- 幂等：是（单条重复删仍 `{deleted:true}`；批量里不存在的 id 记 0 条，不报错）。
- 边界：批量删除先删存在的、再返回计数；单个 id 的删除失败（非 `ENOENT`）整体报错，不静默跳过。

### 3.11 `session/update`（v0.2 B1）
- 请求：`{ "op": "session/update", "sessionId": "...", "title"?: "...", "tags"?: ["..."], "note"?: "..." }`
- 响应：`{ "session": SessionMeta }`，其中 `SessionMeta = { id, title, tags, note, status, mode, difficulty, createdAt, updatedAt, turns, overall }`
- 失败：`E_SESSION_NOT_FOUND`；`E_BAD_REQUEST`（三类字段一个都没给；`title` 非字符串或去空白后为空或超 80 字；`tags` 非字符串数组、超 10 个、含空项或单项超 24 字；`note` 非字符串或超 2 000 字）。
- 语义：
  - **部分更新**：只改给出的字段，未出现的字段保持原值；`title` 会 trim，`tags` 会 trim 并**去重保持首次出现顺序**，`note` 原样保存（不 trim 内部换行，仅整体 trim 首尾）。
  - `updatedAt` 每次成功更新都会推进，但 `createdAt` 不动。
  - 空 `tags: []` 是合法值（表示清空标签）；空 `title: ""` 不合法（标题不允许被清空）。
  - 更新后的会话仍可继续作答（`status` 不变），改名不会影响 `plan`/`turns`。
- 幂等：是（同样的 patch 连打两次结果一致，只有 `updatedAt` 变化）。

题库是数据（v0.2 B3 实现记录）

- 文件 `data/bank.json`，结构 `{ version, topics: [{ id, topic, kind, keywords }] }`；`kind: "code"` 的题目强制走手撕分支。
- 数组顺序就是默认提问顺序；`keywords` 只用于按岗位匹配排序，不影响展示文案。
- 匹配算法：把画像的 `skills` + `jd.title` + `jd.company` + 各项目 `highlights` 拼成词表，统计每题命中的`keywords`个数，命中多者在前，同分保持文件顺序；未命中的题保持文件顺序排在后面。
- 题库缺失/损坏/为空 → `E_INTERNAL` 且消息里带文件路径。这是部署故障，不做静默回退（回退会让「改了题库却没生效」无从发现）。
- `TC-BNK-001` 锁定题库顺序与 v0.1 常量一致，`TC-BNK-002` 锁定缺失即报错。

### 2.3 `Session` v2 结构与迁移（v0.2 B2 已实现）

```
schemaVersion: 2
title: string        // session/create 时自动生成，如「Java 后端 · 11-23 14:05」；可用 session/update 改
tags: string[]       // 用户自定义，参与 session/list 的 query/tag 筛选
note: string         // 复盘备注，只在 session/get 里返回全文
```

| 读到文件 | 行为 |
| --- | --- |
| `schemaVersion: 2` | 原样返回 |
| `schemaVersion: 1`（或无此字段，视为 1） | **只在内存里**补齐 v2 视图（`title` 由 `profile.jd.title` + 创建时间拼出），文件保持原样 |
| `schemaVersion > 2` | `E_SCHEMA_VERSION`，不读、不写、不备份 |
| JSON 损坏 / 不是对象 | `E_SESSION_NOT_FOUND` |

写回时（`session/update`、`turn/answer`、`code/review`、`session/finish` 都会写到盘）：

1. 首次把 v1 文件写成 v2 之前，先把**原始字节**复制成 `<id>.json.v1.bak`，只做一次（已有备份就跳过）；
2. 若盘上文件是更新插件写的（`schemaVersion > 2`），`put` 也拒绝覆写（`E_SCHEMA_VERSION`）——不能拿旧形状盖掉新字段；
3. 2 MB 上限仍在写盘之前判断，超限时旧文件与备份都不动。

列表索引（`index.json`，与记录同目录）：

- 每个条目记文件 `mtime` 与列表行；`mtime` 未变就不再读正文。
- 索引是**缓存不是真相**：文件被删则条目消失；文件被外部改动则 `mtime` 变化触发重读；索引损坏（非 JSON、版本不符）则整表重建，不报错。
- 写索引失败没有任何副作用（只是下一轮变冷）。


导出目录的判定（2026-11-23 修订，`TC-REP-004`/`TC-EDG-042` 守护）：

- 不传 `dir` → 落在部署默认工作目录下的 `interview-reports/`。
- 传**相对路径** → 相对该工作目录解析；解析后必须仍在工作目录内，`..`、`.` 与外部路径一律 `E_BAD_REQUEST`。
- 传**绝对路径** → 视为用户明确指定的目标目录，直接写入，不再拿工作目录做包含性判断（此前用宿主默认目录做基准，导致用户自己的 `D:/project/...` 被拒）。
- 撞名不覆盖：依次尝试 `-2` … `-99`，全满才 `E_EXPORT_FAILED`。

一致性提示：`verdict` 与 `cases` 自相矛盾时（全 `ok` 却 `presumed-wrong`，或有一条 `ok:false` 却 `presumed-correct`），实现**不改写** `verdict`，而是追加一条 warning：

`verdict 与边界用例结论不一致：以用例为准，建议人工复核这段代码`

考生看到的报告里，用例明细才是证据，`verdict` 只是模型的判断。
### 4.0 错误提示的 hint 字段（v0.3 C1）

所有失败信封在 `error` 里除 `code` / `message` 外还带 `hint`：

```json
{
  "ok": false,
  "error": {
    "code": "E_LLM_UNAVAILABLE",
    "message": "model qwen not reachable",
    "hint": {
      "code": "E_LLM_UNAVAILABLE",
      "title": "模型暂时不可用",
      "detail": "宿主没有可用模型路由，或上游服务返回了错误。\n服务器原话：model qwen not reachable",
      "action": "稍等一会儿重试；一直失败请检查宿主的模型配置。",
      "retryable": true
    }
  }
}
```

- 文案来自 `lib/messages.mjs`，一个错误码一条，**客户端不得自建映射**（否则两半说法会漂移）。
- `retryable` 表达的是「重试是不是一个诚实承诺」，客户端据此决定是否显示「重试」按钮。
- `handle()` 的 500 兜底同样带 hint（`E_INTERNAL`），保证崩溃也不会露出裸错误码。
- 未知码回退到通用文案，`code` 原样保留，方便用户反馈。

### 3.12 进度与统计视图（v0.3 C2/C5）

进度和统计**在宿主算**，客户端只渲染。理由：面板若自己按 `turns.length` 推算「第几题」，一旦出现同题覆盖写就会和报告对不上。

`session/get` 的响应多一个 `progress`：

```json
{
  "session": { "…": "…" },
  "progress": {
    "index": 2, "total": 5, "answered": 1, "remaining": 4,
    "elapsedMs": 96000, "avgScore": 3.5, "finished": false
  }
}
```

`session/list` 的响应多两个聚合字段（描述**过滤后的全部记录**，不是当前页）：

```json
{
  "sessions": [], "total": 0, "hasMore": false,
  "stats": { "total": 3, "finished": 2, "active": 1, "avgScore": 3.5, "answeredTurns": 12 },
  "trend": [{ "id": "…", "overall": 4, "createdAt": 1795365943704 }]
}
```

- `index`：第一道未作答题的序号（1 起）；全部答完时等于 `total`。
- `answered`：去重后的已答题目数（同题覆盖不算两次）。
- `avgScore`：已评分题目的平均值，保留 1 位小数；没有评分时为 `null`（客户端显示 `–`）。
- `trend`：最近 10 场有分数的会话，按时间**从旧到新**，供记录页的趋势条使用。
- 这三个字段都是**只读派生值**，不落盘，不进 `Session` 结构。

### 3.13 空态与可开始性（v0.3 C3）

面板不猜「为什么这里是空的」，两个判定都在宿主算：

- `session/list` 的响应多一个 `emptyReason`：`'none'` = 从来没存过面试；`'filtered'` = 有记录但当前筛选/分页没有命中；有行时为 `null`。
- `profile/extract` 的响应多一个 `readiness`：`{ ready, blockers }`，`blockers` ⊆ `['skills','projects']`。技能与项目都空时 `ready:false`；只有一个也算可开始（题目会退到题库）。
- 确认页的主按钮以`用户将要提交的那两个输入框`为准（`skillsText`/`projectsText` 任一非空）。宿主给的 `readiness` 只用于解释「哪里还薄」，不覆盖用户的编辑。

### 3.1.1 配色由宿主下发（v0.3 C6）

`ping` 的响应多一个 `theme`（请求可带 `scheme: 'light' | 'dark'`，缺省为 `light`，未知值按 light 处理）：

```json
{
  "pong": true, "version": "0.4.0", "schemaVersion": 2, "at": 0,
  "theme": {
    "scheme": "dark", "bg": "#12161b", "surface": "#1b2027",
    "text": "#e6edf3", "muted": "#9aa4b2", "border": "#3d444d",
    "primary": "#2f6fed", "primaryText": "#ffffff",
    "ok": "#57d08a", "bad": "#ff8f88", "warn": "#e3b341", "bar": "#2f6fed"
  }
}
```

- 面板不允许写死语义色：它把配色灌成 `--mi-*` 自定义属性，样式表只读 `var(--mi-ok, …)`。
- 两套配色的对比度由 `lib/theme.mjs` 的 `contrastRatio` 在 `TC-THM-001..003` 里断言（文本对 ≥ 4.5:1，边框 1.4–4.5:1）。
- `TC-THM-011` 守住「下发给面板的就是被测试过的那份」：中途改色会导致测试红。
- `scripts/contract-lint.mjs` 另外禁止 `#0f9d58` / `#d93a3f` 这两个在浅色底上不达标的旧值回到 `client.js`。

## 4. 错误码全表

| code | 触发 | 可重试 | 前端表现 |
|---|---|---|---|
| `E_BAD_REQUEST` | JSON 不合法 / 字段缺失 / 越界 / 超长 | 否 | 就地标红字段 |
| `E_UNKNOWN_ACTION` | `op` 不在 `ACTIONS` | 否 | 「插件与页面版本不一致，请刷新」 |
| `E_INTERNAL` | 未预期异常（500） | 视情况 | 显示 "出错并已记录"，不暴露栈 |
| `E_SCHEMA_VERSION` | 会话文件版本高于插件 | 否 | 提示升级插件，拒绝加载 |
| `E_PROFILE_INCOMPLETE` | 画像无技能且无项目 | 否 | 跳回画像确认页 |
| `E_PROFILE_INVALID` | 模型两次都没吐出可解析的画像 JSON | 是 | 「重新解析」按钮 |
| `E_SESSION_NOT_FOUND` | 会话 id 不存在 | 否 | 返回会话列表 |
| `E_SESSION_FINISHED` | 已结束会话继续作答 | 否 | 跳报告页 |
| `E_SESSION_TOO_LARGE` | 会话 > 2 MB | 否 | 提示结束当前会话并导出 |
| `E_LLM_UNAVAILABLE` | 宿主无可用模型 | 是（用户选模型后） | 引导到设置页 |
| `E_LLM_TIMEOUT` | 45 s 未返回（含 1 次重试） | 是 | 「重试」按钮 |
| `E_SCORE_INVALID` | 评分 JSON 两次都不可解析 | 是 | 保留原答案，可重评 |
| `E_EXPORT_FAILED` | 写盘失败 | 是 | 显示目标路径与原因 |
| `E_ASR_NOT_CONFIGURED` | 语音转写未配置 | 否 | 明示降级为文字（AC-5） |

## 5. 八问核对

| # | 问题 | 回答 |
|---|---|---|
| 1 | 输入是什么 | 单一 POST JSON，`op` + 动作字段；上限与枚举见 §1/§3 |
| 2 | 输出是什么 | 成功 `value` / 失败 `error` 信封；HTTP 恒 200；数据形状见 §2 |
| 3 | 失败怎么表现 | §4 全表；每个动作在 §3 列出全部可达错误码，无「其他」 |
| 4 | 边界在哪 | 空体、空答案、超长、越界 `minutes`、0 题结束、同名报告、损坏会话文件 |
| 5 | 并发如何 | 同一 `sessionId` 并发写 → 最后写赢（UI 串行化提交）；文件写入用临时文件 + rename 保原子 |
| 6 | 幂等吗 | §1 末行与 §3 逐动作标注；`session/get`、`list`、`finish`、`delete` 幂等 |
| 7 | 怎么迁移 | 会话文件带 `schemaVersion`；读到更高版本拒绝加载（`E_SCHEMA_VERSION`）；更低版本走显式迁移函数，失败则不静默丢数据 |
| 8 | 怎么观测 | 每请求一条日志：`op / sessionId / 耗时 / 结果码`；简历与答案正文**不入日志**；密钥统一 `***`；错误含 `code` 便于统计 |

## 6. 与代码的对应关系

| 契约元素 | 代码位置 | 守护方式 |
|---|---|---|
| `RPC_PATH`、`SCHEMA_VERSION` | `lib/contracts.js` | 双半常量比对（lint） |
| `ACTIONS` | 同上 | ACTIONS ↔ `dispatch` switch 双向比对（lint） |
| `ERROR_CODES` | 同上 | 代码里 `fail('E_*')` / `code: 'E_*'` 必须已声明（lint） |
| 枚举与上限 | 同上（`MODES`/`DIFFICULTIES`/`DURATIONS`/`DIMENSIONS`/`LIMITS`） | 单测 TC-CON-005..009 |
| 未实现动作 | 仅本文件 §3 | 进 `ACTIONS` 即视为已实现，必须带用例 |