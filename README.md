# dsh-mock-interview

DeepSeek Harness 插件：**模拟技术面试官**。把简历和目标岗位喂进去，它会按真实面试的节奏连问你——八股、简历项目深挖、手撕代码、行为面——支持文字和语音作答，每题给分并指出「哪句答错、缺什么、怎么补」，最后导出一份可复盘的 Markdown 报告。

> 当前状态：**G4 进行中（切片 S1–S5 已全绿）**。G1 骨架与挂载、G2 契约、G3 红基线均已收口；剩 S6 语音降级、S7 页面接线。
> 已实现：`lib/profile.mjs`（简历+JD → 画像）、`lib/session.mjs`（按时长定额、按本人技能/项目定靶、题库补足不重复）、
> `lib/director.mjs`（按难度定措辞、结论式回答追问一次）、`lib/scorer.mjs`（六维评分 + 越界钳制 + 无证据重试 + 空答 0 分）、
> `lib/store.mjs`（原子写、2 MB 写前拦截）、`lib/report.mjs`（六维雷达 + Top3 短板 + Markdown 导出），
> 共 103 条测试全绿。用例与覆盖矩阵见 [`docs/test-plan.md`](docs/test-plan.md)。已暴露的 RPC 动作 8 个（`ping`、`session/create`、`session/get`、`session/list`、`session/finish`、`session/delete`、`turn/answer`、`report/export`），
> 剩余切片 S6、S7 实现后才进 `ACTIONS`（契约 lint 强制双向一致；当前 8 个已实现动作全部登记）。

## 为什么要有它

背题库练不出临场反应。真实面试的难点是：追问到你答不上来、项目细节被戳穿、白板上写不出边界条件。这个插件就专门做这件事——它有自己的上下文，不占用、也不污染你日常和主 agent 的对话。

## 安装（本地开发版）

插件以 `link:` 方式挂进 profile，和 `dsh-collections` 同样的装法：

1. 编辑 `C:\Users\<你>\.dsh\profiles\<profile>\package.json`：

```jsonc
"dependencies": {
  "dsh-mock-interview": "link:D:/project/02-plugins/dsh-mock-interview"
},
"dsh": { "profile": { "bundles": [ /* ... */, "dsh-mock-interview" ] } }
```

2. 用 DSH 自带的 pnpm 装一次（PATH 上没有 pnpm 时）：

```bash
cd "C:/Users/<你>/.dsh/profiles/<profile>"
node "D:/agent/DeepseekHarness/resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs" install --prefer-offline
# → + dsh-mock-interview 0.1.0 <- D:\project\02-plugins\dsh-mock-interview
```

3. **重启 DSH Web 端**（bundle 只在启动时装配）。装好后侧边栏出现「模拟面试」图标，点开即是面试页；页面上的**连通性自检**能一键确认 host 半是否在线。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run build` | `node --check` 三个入口文件（`index.js` / `client.js` / `lib/contracts.js`） |
| `npm run lint` | 契约 lint：语法、`ACTIONS` ↔ dispatch switch 双向比对、错误码表、两条半边的 RPC 常量一致 |
| `npm test` | 单元 + 集成测试（`node --test`） |
| `npm run e2e` | 打包契约 e2e |
| `npm run coverage` | 覆盖率，核心 `lib/**` ≥ 85% 否则失败 |

S5 报告导出：`session/finish` 幂等、`report/export` 只写工作目录内、撞名加后缀（上限 99），未考察维度不拉低总分。

## 验证状态（2026-11-23）

Node `v24.20.0` / npm `11.19.0` 下实跑：

| 命令 | G1 收口 | G2 契约后 | G3 红基线 | G4 S1+S2+S3 | G4 S4（当前） |
|---|---|---|---|---|
| `npm install` | 0 依赖，无报错 | 同上 | 同上 | 同上 |
| `npm run build` | 3 个入口文件语法通过 | 3 个入口文件语法通过 | `node --check` 通过 | `node --check` 通过 |
| `npm run lint` | `0 error(s), 0 warning(s), 7 file(s) scanned` | `0 error(s), 0 warning(s), 7 file(s) scanned`（新增 tables 检查） | `0 error(s), 0 warning(s), 13 file(s) scanned` | `0 error(s), 0 warning(s), 22 file(s) scanned` | `0 error(s), 0 warning(s), 29 file(s) scanned` |
| `npm test` | 14 passed / 0 failed / 0 skipped | 19 passed / 0 failed / 0 skipped | 31 tests：19 passed / 12 failed（预期红） | 63 passed（S3） | 99 passed（S5） | **103 passed / 0 failed / 0 skipped**（S5 收口） |
| `npm run e2e` | 6 passed | 6 passed | 6 passed（未变动） | 6 passed |
| `npm run coverage` | 行 98.77% / 分支 87.80% | 行 99.02% / 分支 87.80% | 行 99.18% / 分支 88.89%（桩函数被调用即计覆盖，不可作依据） | 行 99.66% / 分支 85.02% | **行 99.80% / 分支 87.45%**（S5：`report.mjs` 行 100% / 分支 86.41%） |

那 12 条红色用例（`TC-PRO-001..006` + `TC-SES-001..006`）已在 G4 的 12 个「一轮一用例」提交里全部转绿，
失败原因从 `Error: not implemented yet: … (G4)` 变为真实边界处理；未改动任何断言。

**活体验证（已通过）**：插件以 `link:` 装入 `profiles/desktop` 并出现在 `dsh.profile.bundles` 后重启 Web 端，侧栏图标出现、页面可打开；
`POST /api/dsh-mock-interview/rpc {"op":"ping"}` → `{"ok":true,"value":{"pong":true,"version":"0.1.0","schemaVersion":1}}`（HTTP 200）；
`{"op":"nope"}` → `{"ok":false,"error":{"code":"E_UNKNOWN_ACTION"}}`（HTTP 200）。

**未验证**：页面仍未接上真实面试流程（S7），当前 UI 只有连通性自检；`llmBridge` 只用假模型验证过字节流拼接，未对真模型跑通；
`report/export` 的落盘只在本机 Windows 路径上验证过（`D:/project/…`），未验证只读文件系统下的降级表现。

## 结构

```
index.js              host 半：RPC 端点、调度、错误信封
client.js             Web 半：侧边栏图标 + main 页面
lib/contracts.js      action 表 / 错误码表 / schema 版本（三方消费，禁止漂移）
scripts/contract-lint.mjs   lint：语法 + 契约 + 双半接线
tests/{unit,integration,e2e}
docs/                 需求卡、ADR、用例表、验收清单、交付报告
```

## 能力边界（诚实版）

- **手撕代码不做真实执行**：用 LLM 静态评审 + 边界用例推演，报告会强制标注「未真实执行」。理由与后续计划见 `docs/adr/0004`。
- **语音可能降级**：TTS 走浏览器内置 `speechSynthesis`；语音转写需要你自备 OpenAI 兼容 ASR 端点，没配就只用文字作答，界面会说明原因，不会假装能听。
- **评分不是考试分数**：它给的是「哪里答得薄、下一步练什么」，同一答案重复评分会有小幅波动，波动过大时报告会标注。

## 隐私

简历与报告只存在本机 `$DSH_HOME/storages/dsh-mock-interview/`；录音不落盘（内存中转，转写完成即丢）。使用时简历内容会发给你自己配置的 LLM provider——插件首次使用会提示这一点。

## 协议

本项目按 `D:\project\04-docs\ai-coding-protocol.md` 的 L3 流程推进，章程见 `D:\project\04-docs\mock-interview-charter.md`。

仓库：<https://github.com/liuhaolh6/dsh-Mock-Interview>　需要 Node `^22.19.0 || >=24.0.0`。

## License

MIT