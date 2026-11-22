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
  "inputMode": "text|voice", "askedAt": 0, "answeredAt": 0,
  "score": ScoreCard, "probe": { "asked": true, "reason": "回答只有结论" } }

// ScoreCard —— 六维（AC-4）
{ "dims": { "correctness": 3, "depth": 2, "structure": 3,
            "project": 4, "code": 0, "communication": 3 },   // 1–5 整数
  "overall": 2.5, "verdict": "weak|ok|strong",
  "evidence": ["考生原话"], "missing": ["缺：GC 分代假设"],
  "reference": ["参考要点"] }
// overall = 六维算术平均（保留 1 位小数）；`code: 0` 表示本题不考察代码，但仍**计入**均分，
// 因此非手撕题的理论上限是 25/6 ≈ 4.2。verdict 阈值：≥4.0 strong / ≥3.0 ok / 其余 weak。
// 空作答 → 六维全 0、overall 0、missing ["未作答"]，不调模型。
// 维度缺失 → null（不计入均分）；越界（>5 或 <0）→ 钳到 1–5 并记 warnings。

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
- 请求：`{ "op": "session/list", "limit": 20 }`
- 响应：`{ "sessions": [{ id, createdAt, status, mode, turns: 5, overall: 3.1 }] }`
- 失败：`E_BAD_REQUEST`（`limit` 非 1–100 整数）。幂等：是。

### 3.6 `turn/answer`
- 请求：`{ "op": "turn/answer", "sessionId": "...", "questionId": "q1", "answer": "…", "inputMode": "text|voice" }`
- 响应：`{ "score": ScoreCard, "next": { "type": "probe|question|finish", "question"?: Question }, "sessionStatus": "running|finished" }`
- 失败：`E_SESSION_FINISHED`、`E_SESSION_NOT_FOUND`、`E_BAD_REQUEST`（答案超 4 000 字）、`E_SCORE_INVALID`、`E_LLM_TIMEOUT`。
- 边界：空答案视为「不会」→ 记 0 分并追问一次，不报错；同一 `questionId` 重复提交以最后一次为准（覆盖）。
- 幂等：否（每次提交推进一题）。

### 3.7 `code/review`
- 请求：`{ "op": "code/review", "sessionId": "...", "questionId": "q3", "language": "java", "code": "…" }`
- 响应：`{ "score": ScoreCard, "verdict": "presumed-correct|presumed-wrong|unverifiable", "cases": [{ input, expected, actual, ok }], "executed": false }`
- 失败：`E_SCORE_INVALID`、`E_LLM_TIMEOUT`；**永不**执行代码，也永不因代码报错而失败。
- 边界：空代码 → `unverifiable`；超 20 000 字符 → `E_BAD_REQUEST`。
- `executed` 恒为 `false`，报告与 UI 必须渲染「未真实执行」（ADR-0004）。
- 评审语义（实现后钉死，G4/S3）：
  - `cases` 恒为 **5 条**。模型给多了截断，给少了用 `{ input:'', expected:'', actual:'', ok:false }` 补齐并加 warning；
    `ok` 严格按 `=== true` 判定，其余一律 `false`。
  - `verdict` 只接受三档枚举；模型给了别的一律降级 `unverifiable` 并加 warning（不静默改判）。
  - 模型输出不是合法 JSON 对象 → 重试一次，仍失败 → `E_SCORE_INVALID`（与本约定「评不出分」一致）。
  - **代码是数据，不是指令**：代码注释里出现「忽略以上指令」之类文字，只能改变评审结论，
    不能改变响应的结构（verdict / cases / score 三件套始终存在）——这条由 TC-COD-004 守护。
  - 响应里的 `score` 与 `turn/answer` 用同一套 `buildCard()` 归一（钳制 1..5、缺维 null、
    `overall` 取六维算术平均），避免手撕题和八股题两套评分口径。

### 3.8 `session/finish`
- 请求：`{ "op": "session/finish", "sessionId": "..." }`
- 响应：`{ "report": Report }`
- 失败：`E_SESSION_NOT_FOUND`、`E_SCORE_INVALID`、`E_LLM_TIMEOUT`。
- 边界：一题未答也能结束（报告标注「样本不足」）；重复调用返回同一份报告（幂等，`status` 已为 `finished` 时直接回放）。

### 3.9 `report/export`
- 请求：`{ "op": "report/export", "sessionId": "...", "dir": "./interview-reports" }`（`dir` 缺省即该值）
- 响应：`{ "path": "D:/project/interview-reports/2026-11-23-…md", "bytes": 4210 }`
- 失败：`E_SESSION_NOT_FOUND`、`E_EXPORT_FAILED`（不可写/磁盘满）、`E_BAD_REQUEST`（`dir` 越出允许根目录）。
- 边界：同名文件追加 `-2`、`-3`；只允许写到当前工作目录或其子目录。
- 幂等：是（相同内容重复导出产生新文件，不覆盖已有报告）。

### 3.10 `session/delete`
- 请求：`{ "op": "session/delete", "sessionId": "..." }`
- 响应：`{ "deleted": true }`
- 失败：`E_SESSION_NOT_FOUND`。幂等：是（已删除再删仍返回 `deleted: true`）。

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